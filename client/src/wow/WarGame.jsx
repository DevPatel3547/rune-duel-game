import { useRef, useEffect, useState, useCallback } from 'react';
import { scoreAgainst, computePower, FIZZLE_THRESHOLD } from '@rune/shared';
import { createGame, step, castSpell, moveWizard, canCast, cooldownLeft } from './engine.js';
import { aiTick } from './ai.js';
import { draw } from './render.js';
import { WAR_SPELLS, WIZARD, WAR_SPELL_IDS } from './content.js';

const DIFFICULTIES = [
  { id: 'novice', label: 'Apprentice', sub: 'sloppy, slow to react' },
  { id: 'adept', label: 'Adept', sub: 'a real fight' },
  { id: 'archmage', label: 'Archmage', sub: 'near-perfect, ruthless' },
];

export default function WarGame({ onExit }) {
  const [difficulty, setDifficulty] = useState(null);
  const [armed, setArmed] = useState('summon');
  const [hud, setHud] = useState(null); // periodic snapshot for the HUD
  const gameRef = useRef(null);
  const canvasRef = useRef(null);
  const wrapRef = useRef(null);
  const strokeRef = useRef({ points: [], drawing: false, startTime: 0, mode: null });
  const armedRef = useRef('summon');
  const rafRef = useRef(0);

  useEffect(() => { armedRef.current = armed; }, [armed]);

  // Boot the match once a difficulty is chosen.
  useEffect(() => {
    if (!difficulty) return;
    gameRef.current = createGame({ difficulty });
    setArmed('summon');
    let last = performance.now();
    let hudAccum = 0;

    const view = () => {
      const c = canvasRef.current;
      const rect = c.getBoundingClientRect();
      return { w: rect.width, h: rect.height };
    };

    const frame = (now) => {
      const game = gameRef.current;
      let dt = (now - last) / 1000;
      last = now;
      if (dt > 0.05) dt = 0.05; // clamp after tab-switches
      if (game.status === 'playing') {
        step(game, dt);
        aiTick(game);
      }
      const c = canvasRef.current;
      if (c) {
        const ctx = c.getContext('2d');
        const v = view();
        const sr = strokeRef.current;
        draw(ctx, game, {
          w: v.w, h: v.h,
          stroke: sr.mode === 'draw' ? sr.points : null,
          strokeColor: WAR_SPELLS[armedRef.current]?.color,
        });
      }
      hudAccum += dt;
      if (hudAccum > 0.1 || game.status !== 'playing') {
        hudAccum = 0;
        setHud({
          t: game.t,
          status: game.status,
          mana: game.player.mana,
          pCrystal: game.player.crystal.hp,
          eCrystal: game.enemy.crystal.hp,
          stunned: game.player.stunUntil > game.t,
          cds: WAR_SPELL_IDS.reduce((a, id) => { a[id] = cooldownLeft(game, 'p', id); return a; }, {}),
        });
      }
      rafRef.current = requestAnimationFrame(frame);
    };
    rafRef.current = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(rafRef.current);
  }, [difficulty]);

  // Keep the canvas backing store crisp.
  useEffect(() => {
    const c = canvasRef.current, wrap = wrapRef.current;
    if (!c || !wrap) return;
    const resize = () => {
      const dpr = window.devicePixelRatio || 1;
      const rect = wrap.getBoundingClientRect();
      c.width = rect.width * dpr;
      c.height = rect.height * dpr;
      c.getContext('2d').setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    const obs = new ResizeObserver(resize);
    obs.observe(wrap);
    return () => obs.disconnect();
  }, [difficulty]);

  const getPos = (e) => {
    const rect = canvasRef.current.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  };

  const onDown = useCallback((e) => {
    const game = gameRef.current;
    if (!game || game.status !== 'playing') return;
    e.preventDefault();
    canvasRef.current.setPointerCapture(e.pointerId);
    const rect = canvasRef.current.getBoundingClientRect();
    const p = getPos(e);
    // Grab the wizard if you press near it → dodge-drag mode.
    const wx = game.player.wizardX * rect.width;
    const wy = WIZARD.y * rect.height;
    const grab = WIZARD.radius * Math.min(rect.width, rect.height) * 2.2;
    if (Math.hypot(p.x - wx, p.y - wy) <= grab) {
      strokeRef.current = { points: [p], drawing: true, startTime: performance.now(), mode: 'wizard' };
      return;
    }
    // Otherwise begin drawing the armed rune.
    strokeRef.current = { points: [p], drawing: true, startTime: performance.now(), mode: 'draw' };
  }, []);

  const onMove = useCallback((e) => {
    const sr = strokeRef.current;
    if (!sr.drawing) return;
    e.preventDefault();
    const evs = e.getCoalescedEvents ? e.getCoalescedEvents() : [e];
    for (const ev of evs) sr.points.push(getPos(ev));
    if (sr.mode === 'wizard') {
      const rect = canvasRef.current.getBoundingClientRect();
      moveWizard(gameRef.current, 'p', sr.points[sr.points.length - 1].x / rect.width);
    }
  }, []);

  const onUp = useCallback((e) => {
    const sr = strokeRef.current;
    if (!sr.drawing) return;
    e.preventDefault();
    sr.drawing = false;
    const game = gameRef.current;
    if (sr.mode !== 'draw' || game.status !== 'playing') { sr.points = []; return; }
    if (game.player.stunUntil > game.t) { sr.points = []; flash('stunned!'); return; }

    const spell = WAR_SPELLS[armedRef.current];
    const pts = sr.points;
    if (pts.length < 8) { sr.points = []; return; }
    const elapsed = (performance.now() - sr.startTime) / 1000;
    const acc = scoreAgainst(pts, spell.runeId);
    if (acc < FIZZLE_THRESHOLD) { flash('fizzled — draw it cleaner'); sr.points = []; return; }
    if (!canCast(game, 'p', armedRef.current)) {
      flash(game.player.mana < spell.cost ? 'not enough mana' : 'on cooldown');
      sr.points = []; return;
    }
    const rect = canvasRef.current.getBoundingClientRect();
    const cx = pts.reduce((a, q) => a + q.x, 0) / pts.length;
    const cy = pts.reduce((a, q) => a + q.y, 0) / pts.length;
    const power = computePower(acc, elapsed, spell.runeId);
    castSpell(game, 'p', armedRef.current, power, { x: cx / rect.width, y: cy / rect.height });
    sr.points = [];
  }, []);

  const [toast, setToast] = useState('');
  const toastRef = useRef(0);
  const flash = (msg) => {
    setToast(msg);
    clearTimeout(toastRef.current);
    toastRef.current = setTimeout(() => setToast(''), 1100);
  };

  // ── Pre-game difficulty picker ──
  if (!difficulty) {
    return (
      <div className="war-menu">
        <button className="war-back" onClick={onExit}>← back</button>
        <h1>⚔️ War of Wizards</h1>
        <p className="war-tag">Summon minions. Draw spells. Shatter their crystal before they shatter yours.</p>
        <div className="war-diffs">
          {DIFFICULTIES.map((d) => (
            <button key={d.id} className="war-diff" onClick={() => setDifficulty(d.id)}>
              <b>{d.label}</b><span>{d.sub}</span>
            </button>
          ))}
        </div>
        <ul className="war-how">
          <li><b>Tap a spell</b> below to arm it, then <b>draw its rune on the field</b> to cast. Cleaner + faster = stronger.</li>
          <li>🌀 <b>Summon</b> pushes the lane. ⚡ <b>Bolt</b> snipes. 🌋 <b>Quake</b> clears waves. 🛡️ <b>Ward</b> guards your crystal.</li>
          <li>When a <b>meteor</b> targets you, <b>drag your wizard</b> 🧙 to dodge.</li>
        </ul>
      </div>
    );
  }

  const over = hud && hud.status !== 'playing';
  return (
    <div className="war-root">
      <div ref={wrapRef} className="war-field">
        <canvas
          ref={canvasRef}
          onPointerDown={onDown}
          onPointerMove={onMove}
          onPointerUp={onUp}
          onPointerCancel={onUp}
        />
        {toast && <div className="war-toast">{toast}</div>}
        {hud?.stunned && <div className="war-stun">💫 stunned</div>}
      </div>

      <div className="war-hud">
        <div className="war-mana">
          <div className="war-mana-fill" style={{ width: `${(hud?.mana ?? 0)}%` }} />
          <span>{Math.floor(hud?.mana ?? 0)} mana</span>
        </div>
        <div className="war-hand">
          {gameRef.current?.hand.map((id) => {
            const s = WAR_SPELLS[id];
            const cd = hud?.cds?.[id] || 0;
            const affordable = (hud?.mana ?? 0) >= s.cost && cd <= 0;
            return (
              <button
                key={id}
                className={`war-card${armed === id ? ' armed' : ''}${affordable ? '' : ' cant'}`}
                style={{ '--c': s.color }}
                onClick={() => setArmed(id)}
              >
                <span className="war-card-emoji">{s.emoji}</span>
                <span className="war-card-name">{s.name}</span>
                <span className="war-card-cost">{s.cost}</span>
                {cd > 0 && <span className="war-card-cd">{cd.toFixed(1)}s</span>}
              </button>
            );
          })}
        </div>
      </div>

      {over && (
        <div className="war-over">
          <h2>{hud.status === 'won' ? '🏆 Crystal shattered — you win!' : '💥 Your crystal fell'}</h2>
          <div className="war-over-btns">
            <button onClick={() => setDifficulty(null)}>Change difficulty</button>
            <button className="primary" onClick={() => { setDifficulty(null); setTimeout(() => setDifficulty(difficulty), 0); }}>
              Rematch
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
