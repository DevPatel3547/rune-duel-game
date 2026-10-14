import { useRef, useState, useEffect } from 'react';
import {
  SPELLS, SPELL_IDS, MAX_HP, blankStatus, scoreAgainst, computePower,
  FIZZLE_THRESHOLD, resolveRound,
} from '@rune/shared';
import { sfx, buzz } from '../audio/sfx.js';
import { storage } from '../game/storage.js';
import { aiPickSpell, aiDraw, aiThinkTime, AI_LEVELS } from '../game/ai.js';
import DrawCanvas from './DrawCanvas.jsx';
import { HPBars, StatusChips, RoundTimer, PickPhase, SpellBanner, ResolveOverlay } from './MatchParts.jsx';

const ROUND_MS = 15000;
const RESOLVE_MS = 4200;

const pickTwo = (deck) => [...deck].sort(() => Math.random() - 0.5).slice(0, 2);
const clampHp = (v) => Math.max(0, Math.min(MAX_HP, v));

function freshGame() {
  return {
    hp: { you: MAX_HP, opp: MAX_HP },
    status: { you: blankStatus(), opp: blankStatus() },
    round: 0,
    phase: 'intro', // intro | handoff | pick | draw | waiting | resolve | end
    player: 'you',  // local mode: whose turn
    options: [],
    selected: null,
    subs: { you: null, opp: null },
    aiDeck: [...SPELL_IDS].sort(() => Math.random() - 0.5).slice(0, 5),
    youLastSpell: null,
    oppLastSpell: null,
    resolveData: null,
    deadline: 0,
    winner: null,
  };
}

// Drives "vs AI" and local pass-and-play matches. Online lives in OnlineMatch.
export default function Match({ mode, aiLevel = 'medium', deck, onExit }) {
  const G = useRef(freshGame());
  const timers = useRef([]);
  const [, setTick] = useState(0);
  const rerender = () => setTick((t) => t + 1);

  const youName = mode === 'ai' ? 'You' : 'Player 1';
  const oppName = mode === 'ai' ? AI_LEVELS[aiLevel].label : 'Player 2';

  const later = (fn, ms) => { timers.current.push(setTimeout(fn, ms)); };
  useEffect(() => () => timers.current.forEach(clearTimeout), []);

  const startRound = () => {
    const g = G.current;
    g.round++;
    g.subs = { you: null, opp: null };
    g.selected = null;
    g.resolveData = null;
    const round = g.round;

    if (mode === 'ai') {
      g.options = pickTwo(deck);
      const aiOptions = pickTwo(g.aiDeck);
      const choice = aiPickSpell(aiOptions, aiLevel, {
        myHp: g.hp.opp, oppHp: g.hp.you,
        oppLastSpell: g.youLastSpell,
        mySurge: g.status.opp.surge, oppSurge: g.status.you.surge,
      });
      const cast = aiDraw(choice, aiLevel, g.status.opp.slowed);
      later(() => {
        if (g.round !== round || g.phase === 'resolve' || g.phase === 'end') return;
        g.subs.opp = cast;
        maybeResolve();
      }, aiThinkTime(aiLevel));
      g.phase = 'pick';
      g.deadline = Date.now() + ROUND_MS;
      later(() => {
        if (g.round !== round || g.subs.you || g.phase === 'resolve' || g.phase === 'end') return;
        g.subs.you = { spell: null, power: 0, accuracy: 0 };
        sfx.fizzle();
        g.phase = 'waiting';
        maybeResolve();
        rerender();
      }, ROUND_MS);
    } else {
      g.player = 'you';
      g.phase = 'handoff';
    }
    rerender();
  };

  const startLocalTurn = () => {
    const g = G.current;
    g.options = pickTwo(deck);
    g.selected = null;
    g.phase = 'pick';
    g.deadline = Date.now() + ROUND_MS;
    const round = g.round;
    const player = g.player;
    later(() => {
      if (g.round !== round || g.player !== player || g.subs[player] || g.phase === 'resolve' || g.phase === 'end') return;
      g.subs[player] = { spell: null, power: 0, accuracy: 0 };
      sfx.fizzle();
      advanceLocal();
    }, ROUND_MS);
    rerender();
  };

  const advanceLocal = () => {
    const g = G.current;
    if (g.player === 'you') {
      g.player = 'opp';
      g.phase = 'handoff';
      rerender();
    } else {
      doResolve();
    }
  };

  const maybeResolve = () => {
    const g = G.current;
    if (g.subs.you && g.subs.opp && g.phase !== 'resolve' && g.phase !== 'end') doResolve();
    else rerender();
  };

  const doResolve = () => {
    const g = G.current;
    g.phase = 'resolve';
    const r = resolveRound(g.subs.you, g.subs.opp, g.status.you, g.status.opp);
    g.hp.you = clampHp(g.hp.you - r.damage.a + r.heal.a);
    g.hp.opp = clampHp(g.hp.opp - r.damage.b + r.heal.b);
    g.status = { you: r.status.a, opp: r.status.b };
    g.youLastSpell = g.subs.you.spell;
    g.oppLastSpell = g.subs.opp.spell;
    g.resolveData = {
      youCast: g.subs.you, oppCast: g.subs.opp,
      damage: { you: r.damage.a, opponent: r.damage.b },
      heal: { you: r.heal.a, opponent: r.heal.b },
      log: r.log.map((l) => l.replace(/P1/g, youName).replace(/P2/g, oppName)),
    };

    if (g.subs.you.spell) sfx.cast(g.subs.you.spell);
    if (g.subs.opp.spell) later(() => sfx.cast(g.subs.opp.spell), 180);
    if (r.damage.a > 0 || r.damage.b > 0) later(() => { sfx.hit(); buzz(60); }, 450);
    if (r.heal.a > 0 || r.heal.b > 0) later(() => sfx.heal(), 700);

    later(() => {
      if (g.hp.you <= 0 || g.hp.opp <= 0) {
        g.phase = 'end';
        g.winner = g.hp.you <= 0 && g.hp.opp <= 0 ? 'draw' : (g.hp.opp <= 0 ? 'you' : 'opp');
        storage.bumpMatches();
        if (mode === 'ai') (g.winner === 'you' ? sfx.win : sfx.lose)();
        else sfx.win();
        rerender();
      } else {
        startRound();
      }
    }, RESOLVE_MS);
    rerender();
  };

  const onPick = (id) => {
    const g = G.current;
    g.selected = id;
    g.phase = 'draw';
    sfx.pick();
    rerender();
  };

  const onDrawComplete = (points, time) => {
    const g = G.current;
    const who = mode === 'local' ? g.player : 'you';
    const accuracy = scoreAgainst(points, g.selected);
    if (accuracy < FIZZLE_THRESHOLD) {
      g.subs[who] = { spell: null, power: 0, accuracy };
      sfx.fizzle(); buzz(80);
    } else {
      g.subs[who] = {
        spell: g.selected,
        power: computePower(accuracy, time, g.selected, g.status[who].slowed),
        accuracy,
      };
      sfx.recognize(); buzz(25);
      storage.setBest(g.selected, Math.round(accuracy * 100));
    }
    if (mode === 'ai') { g.phase = 'waiting'; maybeResolve(); }
    else advanceLocal();
  };

  const rematch = () => {
    timers.current.forEach(clearTimeout);
    timers.current = [];
    G.current = freshGame();
    startRound();
  };

  useEffect(() => {
    const id = setTimeout(startRound, 600);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const g = G.current;
  const activePlayer = mode === 'local' ? g.player : 'you';
  const activeStatus = g.status[activePlayer];
  const turnName = mode === 'local' ? (g.player === 'you' ? 'Player 1' : 'Player 2') : null;

  return (
    <div className="screen">
      <div className="match">
        <div className="back-row">
          <button className="btn small ghost" onClick={onExit}>✕ Quit</button>
          <h2 style={{ textAlign: 'center' }}>{g.round > 0 ? `Round ${g.round}` : 'Rune Duel'}</h2>
          <span style={{ width: 60 }} />
        </div>

        <HPBars youName={youName} oppName={oppName} youHp={g.hp.you} oppHp={g.hp.opp} />
        <StatusChips status={activeStatus} />

        {(g.phase === 'pick' || g.phase === 'draw') && (
          <RoundTimer deadline={g.deadline} totalMs={ROUND_MS} />
        )}

        {g.phase === 'intro' && <p className="muted waiting-pulse" style={{ marginTop: '30vh' }}>Get ready…</p>}

        {g.phase === 'handoff' && (
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', gap: 16 }}>
            <div style={{ fontSize: '3rem' }}>📱</div>
            <h2>Pass to {turnName}</h2>
            <p className="muted">No peeking. Tap when ready.</p>
            <button className="btn primary" style={{ maxWidth: 260 }} onClick={startLocalTurn}>
              I'm {turnName} — Start
            </button>
          </div>
        )}

        {g.phase === 'pick' && <PickPhase options={g.options} onPick={onPick} />}

        {g.phase === 'draw' && (
          <>
            <SpellBanner spellId={g.selected} />
            <DrawCanvas
              spellId={g.selected}
              ghost={storage.showGuide}
              shaking={activeStatus.shaken}
              disabled={false}
              onComplete={onDrawComplete}
            />
          </>
        )}

        {g.phase === 'waiting' && (
          <div style={{ flex: 1, display: 'grid', placeItems: 'center' }}>
            <p className="muted waiting-pulse">Spell locked in — waiting for {oppName}…</p>
          </div>
        )}

        {g.phase === 'resolve' && g.resolveData && (
          <ResolveOverlay {...g.resolveData} youName={youName} oppName={oppName} />
        )}

        {g.phase === 'end' && (
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', gap: 14 }}>
            <div className={`end-title ${g.winner === 'you' ? 'win' : g.winner === 'draw' ? '' : 'lose'}`}>
              {mode === 'ai'
                ? (g.winner === 'you' ? '🏆 VICTORY' : g.winner === 'draw' ? '🤝 DRAW' : '💀 DEFEAT')
                : (g.winner === 'draw' ? '🤝 DRAW' : `🏆 ${g.winner === 'you' ? 'Player 1' : 'Player 2'} WINS`)}
            </div>
            <p className="muted">{youName} {g.hp.you} HP — {oppName} {g.hp.opp} HP</p>
            <button className="btn primary" style={{ maxWidth: 260 }} onClick={rematch}>⚔️ Rematch</button>
            <button className="btn ghost" style={{ maxWidth: 260 }} onClick={onExit}>Back to menu</button>
          </div>
        )}
      </div>
    </div>
  );
}
