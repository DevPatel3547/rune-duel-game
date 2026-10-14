import { useEffect, useMemo, useRef, useState } from 'react';
import { useGame, spellInfo } from '../store.js';
import { TEMPLATES, rtOf, RT, SHIELD_ABSORB } from '@rune/shared';
import { useHitFeel } from '../scene/feel.js';
import { MOVE_BAND, MOVE_LIMIT } from '../movement.js';

// ── Heads-up display ───────────────────────────────────────────────────────
// Plain DOM rather than world-space 3D text: it scales cleanly from a phone in
// portrait to a desktop monitor, respects notch safe-areas, and stays crisp at
// any resolution. The 3D scene owns only diegetic elements (floating damage
// numbers, the intro banner).
//
// PERFORMANCE CONTRACT: React renders only on discrete changes (deck, names,
// outcome). Every continuously-varying value — bar widths, cooldown sweeps,
// the damage vignette — is written straight to the DOM from a single rAF loop
// via refs. Driving these through state would re-render the tree 60×/second
// while a duel is running.

// Turn a rune template into an SVG polyline so each card shows the exact shape
// (and, via the dot, where the stroke starts) the player must trace.
function runePath(spellId) {
  const raw = TEMPLATES[spellId] || [];
  if (!raw.length) return { pts: '', start: null };
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const p of raw) { minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x); minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y); }
  const w = Math.max(maxX - minX, 1e-3), h = Math.max(maxY - minY, 1e-3);
  const s = 72 / Math.max(w, h);
  // centre the glyph in the 100-box regardless of its aspect ratio
  const ox = 50 - ((maxX - minX) * s) / 2;
  const oy = 50 - ((maxY - minY) * s) / 2;
  const map = (p) => [ox + (p.x - minX) * s, oy + (p.y - minY) * s];
  const pts = raw.map((p) => map(p).map((n) => n.toFixed(1)).join(',')).join(' ');
  return { pts, start: map(raw[0]) };
}

export default function GameHUD() {
  const inVR = useGame((s) => s.inVR);
  const phase = useGame((s) => s.phase);
  const deck = useGame((s) => s.deck);
  const name = useGame((s) => s.name);
  const opponentName = useGame((s) => s.opponentName);

  const show = phase === 'live' || phase === 'countdown' || phase === 'over';
  if (inVR || !show) return <Outcome />;

  return (
    <>
      <DamageVignette />
      <div className="hud" aria-hidden="true">
        <div className="hudTop">
          <FighterPlate side="you" name={name} />
          <div className="vsMark"><span>VS</span></div>
          <FighterPlate side="opp" name={opponentName} />
        </div>
        <Feedback />
        <Countdown />
        <MoveBand />
        <Spellbook deck={deck} />
      </div>
      <Outcome />
    </>
  );
}

// ---------------------------------------------------------- fighter plate --

// Health uses a two-layer bar: a fast foreground and a slow "lag" layer behind
// it in a hot colour. The gap between them is the damage you just took, which
// makes the size of a hit legible at a glance — a single bar sliding down tells
// you the new value but not the magnitude of the change.
function FighterPlate({ side, name }) {
  const you = side === 'you';
  const hp = useRef(null), lag = useRef(null), manaEl = useRef(null);
  const shieldEl = useRef(null), plate = useRef(null), hpText = useRef(null);

  const nHp = useRef(100), nLag = useRef(100), nMana = useRef(RT.START_MANA), nShield = useRef(0);

  useEffect(() => {
    let raf;
    const tick = () => {
      const g = useGame.getState();
      const target = (you ? g.hp.you : g.hp.opponent) ?? 100;

      nHp.current += (target - nHp.current) * 0.22;
      // the lag bar chases, but only downward and more slowly; on heals it
      // snaps up so the hot layer never sits *above* current health
      if (nLag.current > nHp.current) nLag.current += (nHp.current - nLag.current) * 0.055;
      else nLag.current = nHp.current;

      if (hp.current) hp.current.style.width = pct(nHp.current / 100);
      if (lag.current) lag.current.style.width = pct(nLag.current / 100);
      if (hpText.current) {
        const v = Math.max(0, Math.round(nHp.current));
        if (hpText.current.textContent !== String(v)) hpText.current.textContent = v;
      }
      // low-health warning state
      if (plate.current) plate.current.classList.toggle('critical', target > 0 && target <= 30);

      if (you) {
        const r = g.resources || {};
        nMana.current += ((r.mana ?? 0) - nMana.current) * 0.28;
        nShield.current += ((r.shield ?? 0) - nShield.current) * 0.3;
        if (manaEl.current) manaEl.current.style.width = pct(nMana.current / RT.MANA_MAX);
        if (shieldEl.current) {
          const f = nShield.current / SHIELD_ABSORB;
          shieldEl.current.style.width = pct(f);
          shieldEl.current.style.opacity = f > 0.01 ? 1 : 0;
        }
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [you]);

  return (
    <div className={'plate ' + (you ? 'mine' : 'foe')} ref={plate}>
      <div className="sigil"><WizardSigil foe={!you} /></div>
      <div className="pbody">
        <div className="prow">
          <span className="pname">{name}</span>
          <span className="phpnum"><b ref={hpText}>100</b><i>hp</i></span>
        </div>

        <div className="bar hpbar">
          <i className="lag" ref={lag} />
          <i className="val" ref={hp} />
          {/* fixed tick marks every 25 hp read as a segmented gauge and give
              the eye reference points for how much a hit actually removed */}
          <i className="ticks" />
          {you && <i className="shield" ref={shieldEl} />}
        </div>

        {you && (
          <div className="bar manabar">
            <i className="val" ref={manaEl} />
          </div>
        )}
      </div>
    </div>
  );
}

// An inline sigil beats an emoji portrait: emoji render differently on every
// platform (and as a flat colour glyph on some), which instantly reads as
// placeholder art.
function WizardSigil({ foe }) {
  const a = foe ? '#ff8ad4' : '#7fd4ff';
  const b = foe ? '#b04ad8' : '#5a7bff';
  return (
    <svg viewBox="0 0 48 48" aria-hidden="true">
      <defs>
        <linearGradient id={foe ? 'sgF' : 'sgY'} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={a} />
          <stop offset="1" stopColor={b} />
        </linearGradient>
      </defs>
      {/* hooded head silhouette */}
      <path
        d="M24 6c-7 0-12 5.4-12 12.4 0 4.2 1.5 7 3.4 9.4l-2.2 8.6h21.6l-2.2-8.6c1.9-2.4 3.4-5.2 3.4-9.4C36 11.4 31 6 24 6z"
        fill={`url(#${foe ? 'sgF' : 'sgY'})`} opacity="0.28"
      />
      <path
        d="M24 6c-7 0-12 5.4-12 12.4 0 4.2 1.5 7 3.4 9.4l-2.2 8.6h21.6l-2.2-8.6c1.9-2.4 3.4-5.2 3.4-9.4C36 11.4 31 6 24 6z"
        fill="none" stroke={a} strokeWidth="1.6" strokeLinejoin="round"
      />
      {/* glowing eyes */}
      <path d="M18.5 21.5l4 1.4-4 1.2z" fill={a} />
      <path d="M29.5 21.5l-4 1.4 4 1.2z" fill={a} />
    </svg>
  );
}

// -------------------------------------------------------------- vignette ----

// Red screen edges when YOU take damage. Driven straight off the shared feel
// envelope, so it decays in lockstep with the camera shake from the same hit.
function DamageVignette() {
  const el = useRef(null);
  useEffect(() => {
    let raf;
    const tick = () => {
      const v = useHitFeel.getState().damageVig;
      if (el.current) el.current.style.opacity = Math.min(1, v * 0.85).toFixed(3);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);
  return <div className="dmgVig" ref={el} aria-hidden="true" />;
}

// ------------------------------------------------------------ move band ----

// The dodge zone is invisible geometry, so it needs an affordance or nobody
// finds it. A faint strip with a position pip: the pip is the only part that
// moves, and it doubles as confirmation that a drag registered.
function MoveBand() {
  const pip = useRef(null);
  const band = useRef(null);
  useEffect(() => {
    let raf;
    const tick = () => {
      const m = useGame.getState().move;
      if (pip.current) {
        pip.current.style.transform = `translateX(${((m.x / MOVE_LIMIT) * 46).toFixed(2)}%)`;
      }
      if (band.current) {
        // brighten while actually strafing, so the control confirms itself
        band.current.style.opacity = (0.34 + Math.min(1, Math.abs(m.vx) / 4.6) * 0.5).toFixed(2);
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  return (
    <div className="moveBand" ref={band} style={{ height: `${MOVE_BAND * 100}%` }}>
      <div className="moveRail">
        <i className="movePip" ref={pip} />
      </div>
      <span className="moveHint">drag to sidestep</span>
    </div>
  );
}

// -------------------------------------------------------------- feedback ----

function Feedback() {
  const lastMatch = useGame((s) => s.lastMatch);
  const [toast, setToast] = useState(null);
  useEffect(() => {
    if (!lastMatch) return;
    const sp = lastMatch.spellId ? spellInfo(lastMatch.spellId) : null;
    let text, sub = null, color, kind = 'ok';
    if (lastMatch.fizzled || !sp) { text = 'FIZZLED'; sub = 'rune not recognised'; color = '#ff7a8a'; kind = 'bad'; }
    else if (lastMatch.blocked === 'mana') { text = sp.name; sub = 'not enough mana'; color = '#7fa8ff'; kind = 'bad'; }
    else if (lastMatch.blocked === 'cooldown') { text = sp.name; sub = 'still cooling'; color = '#9b8fc0'; kind = 'bad'; }
    else {
      const acc = Math.round((lastMatch.score || 0) * 100);
      text = sp.name;
      sub = acc >= 90 ? `PERFECT · ${acc}%` : acc >= 75 ? `GREAT · ${acc}%` : `${acc}%`;
      color = sp.color;
      kind = acc >= 90 ? 'perfect' : 'ok';
    }
    const t = { text, sub, color, kind, k: Math.random() };
    setToast(t);
    const id = setTimeout(() => setToast((cur) => (cur === t ? null : cur)), 1150);
    return () => clearTimeout(id);
  }, [lastMatch]);

  if (!toast) return null;
  return (
    <div className={'castToast ' + toast.kind} key={toast.k} style={{ '--c': toast.color }}>
      <b>{toast.text}</b>
      {toast.sub && <em>{toast.sub}</em>}
    </div>
  );
}

// ------------------------------------------------------------- countdown ----

// 3 · 2 · 1 · DUEL. A fight needs a start line. The count is read off a
// timestamp every frame, so a dropped frame can never put it out of step with
// the moment the duel actually goes live.
function Countdown() {
  const phase = useGame((s) => s.phase);
  const endsAt = useGame((s) => s.countdownEndsAt);
  const [label, setLabel] = useState(null);

  useEffect(() => {
    if (phase === 'countdown') {
      let raf;
      let last;
      const tick = () => {
        const left = endsAt - performance.now();
        const n = left > 0 ? String(Math.min(3, Math.ceil(left / 1000))) : null;
        if (n !== last) { last = n; setLabel(n); }
        raf = requestAnimationFrame(tick);
      };
      raf = requestAnimationFrame(tick);
      return () => cancelAnimationFrame(raf);
    }
    if (phase === 'live') {
      setLabel('DUEL');
      const id = setTimeout(() => setLabel(null), 800);
      return () => clearTimeout(id);
    }
    setLabel(null);
    return undefined;
  }, [phase, endsAt]);

  if (!label) return null;
  return <div className={'countdown' + (label === 'DUEL' ? ' go' : '')} key={label}>{label}</div>;
}

// ------------------------------------------------------------- spellbook ----

function Spellbook({ deck }) {
  return <div className="book">{deck.map((id) => <SpellCard key={id} id={id} />)}</div>;
}

function SpellCard({ id }) {
  const sp = spellInfo(id);
  const cost = rtOf(id).cost;
  const { pts, start } = useMemo(() => runePath(id), [id]);
  const cardRef = useRef(null), veilRef = useRef(null), numRef = useRef(null);

  useEffect(() => {
    let raf;
    let lastLabel = '';
    const tick = () => {
      const g = useGame.getState();
      const res = g.resources || {};
      const now = performance.now();
      const cdLeft = Math.max(0, ((res.cd && res.cd[id]) || 0) - now);
      const frac = cdLeft > 0 ? Math.min(1, cdLeft / (rtOf(id).cd * 1000)) : 0;
      const affordable = (res.mana ?? 0) >= cost;

      if (veilRef.current) veilRef.current.style.transform = `scaleY(${frac.toFixed(3)})`;
      if (cardRef.current) {
        const el = cardRef.current;
        el.classList.toggle('cooling', frac > 0.02);
        el.classList.toggle('broke', !affordable && frac <= 0.02);
        el.classList.toggle('ready', affordable && frac <= 0.02);
      }
      if (numRef.current) {
        const label = frac > 0.02 ? (cdLeft / 1000).toFixed(1) : '';
        if (label !== lastLabel) { numRef.current.textContent = label; lastLabel = label; }
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [id, cost]);

  return (
    <div className="scard" ref={cardRef} style={{ '--sp': sp.color }}>
      <div className="sglow" />
      <svg viewBox="0 0 100 100" className="srune" aria-hidden="true">
        <polyline points={pts} fill="none" stroke={sp.color} strokeWidth="7" strokeLinecap="round" strokeLinejoin="round" />
        {start && <circle cx={start[0]} cy={start[1]} r="6.5" fill={sp.color} />}
      </svg>
      <i ref={veilRef} className="cdveil" />
      <span ref={numRef} className="cdnum" />
      <div className="sfoot">
        <b>{sp.name}</b>
        <span className="scost">{cost}</span>
      </div>
    </div>
  );
}

// --------------------------------------------------------------- outcome ----

function Outcome() {
  const phase = useGame((s) => s.phase);
  const outcome = useGame((s) => s.outcome);
  const status = useGame((s) => s.status);
  const rematch = useGame((s) => s.rematch);
  const leave = useGame((s) => s.leave);
  const mode = useGame((s) => s.mode);
  const startOnline = useGame((s) => s.startOnline);
  const startPractice = useGame((s) => s.startPractice);
  const ratingChange = useGame((s) => s.ratingChange);
  if (phase !== 'over' || !outcome) return null;

  const title = outcome.draw ? 'DRAW' : outcome.won ? 'VICTORY' : 'DEFEAT';
  const cls = outcome.draw ? 'draw' : outcome.won ? 'win' : 'lose';
  const sub = outcome.draw ? 'Both wizards fell.'
    : outcome.walkover && outcome.won ? 'Your rival fled the arena.'
    : outcome.walkover ? 'The duel ended while you were away.'
    : outcome.won ? 'The arena is yours.'
    : 'Your rival stands over you.';
  const rematchPending = status && /rematch/i.test(status);
  // A rematch needs the same opponent; once they have gone, offer a new one.
  const opponentGone = mode === 'online' && outcome.walkover;

  // The opponent left mid-duel. It ends for THEM; the player who stayed keeps
  // the win and chooses what happens next instead of being thrown out too.
  if (opponentGone && outcome.won) {
    const keepFighting = () => {
      const { hp } = useGame.getState();
      startPractice({ opponentName: 'Arena Warden', carry: { you: hp.you, opponent: hp.opponent } });
    };
    return (
      <div className="outcome">
        <div className="oCard win">
          <div className="oRule" />
          <div className="oTitle fled">RIVAL FLED</div>
          <div className="oSub">Your opponent left the duel. The win is yours.</div>
          <div className="oRule" />
          <div className="oBtns stacked">
            <button className="oBtn primary" onClick={keepFighting}>Keep fighting (vs AI)</button>
            <button className="oBtn" onClick={() => startOnline('quick')}>Find new match</button>
            <button className="oBtn" onClick={leave}>Menu</button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="outcome">
      <div className={'oCard ' + cls}>
        <div className="oRule" />
        <div className="oTitle">{title}</div>
        <div className="oSub">{rematchPending ? status : sub}</div>
        {mode === 'online' && typeof ratingChange === 'number' && (
          <div className={'oRating ' + (ratingChange >= 0 ? 'up' : 'down')}>
            {ratingChange >= 0 ? `+${ratingChange}` : `−${Math.abs(ratingChange)}`} rating
          </div>
        )}
        <div className="oRule" />
        <div className="oBtns">
          {opponentGone
            ? <button className="oBtn primary" onClick={() => startOnline('quick')}>New match</button>
            : <button className="oBtn primary" onClick={rematch}>Play again</button>}
          <button className="oBtn" onClick={leave}>Menu</button>
        </div>
      </div>
    </div>
  );
}

const pct = (f) => (Math.max(0, Math.min(1, f)) * 100).toFixed(2) + '%';
