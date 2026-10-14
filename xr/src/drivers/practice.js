// Real-time practice driver: a fully offline LIVE duel against an AI wizard.
// You draw ANY spell in your deck whenever you can afford the mana, spells fly
// across the arena in real time, and the AI attacks on its own clock.
//
// The rules live in the shared Duel simulation, which the online server runs
// too; this driver only supplies the local player's input, the AI's decisions,
// and the frame loop. Side 0 is you, side 1 is the AI.
import {
  SPELLS, MAX_HP, FIZZLE_THRESHOLD, blankStatus, TEMPLATES, RT, castBlock, Duel,
} from '@rune/shared';
import { bestMatch } from './shared.js';
import { presentEvents } from './present.js';
import { hitStopScale } from '../scene/CameraRig.jsx';
import { resetFeel } from '../scene/feel.js';

// Simulation step. 60 Hz is fine for mana/cooldown bookkeeping and keeps the
// catch-up loop cheap.
const FIXED_DT = 1 / 60;
// Never simulate more than this much real time in one frame.
const MAX_CATCHUP = 0.25;
// The 3-2-1 before a duel, matching the match server's.
const COUNTDOWN_MS = 3000;

// AI cadence + skill per difficulty: how often it casts, its draw accuracy, and
// how "fast" it draws (feeds computePower for stronger hits on higher difficulty).
// `every` = seconds between the AI's casts (randomized in range). Tuned so even
// an idle player isn't melted — easy is forgiving, hard is relentless.
export const AI = {
  easy:   { every: [3.0, 4.6], acc: [0.40, 0.70], time: [1.5, 2.6] },
  normal: { every: [2.0, 3.2], acc: [0.56, 0.84], time: [1.1, 1.9] },
  hard:   { every: [1.1, 2.0], acc: [0.78, 0.97], time: [0.7, 1.2] },
};

const ME = 0;
const FOE = 1;

export class PracticeDriver {
  constructor(get, set, { opponentName = 'Training Dummy', difficulty, carry } = {}) {
    this.get = get;
    this.set = set;
    this.opponentName = opponentName;
    this.difficulty = difficulty;
    // HP to continue from, for the first round only (a rematch starts fresh)
    this.carry = carry || null;
    this.alive = true;
    this._raf = 0;
    this._timers = [];
  }

  // The visual QA harnesses in xr/test reach into these to stage shots.
  get me() { return this.duel.sides[ME]; }
  get ai() { return this.duel.sides[FOE]; }
  get projectiles() { return this.duel.projectiles; }

  start() {
    resetFeel();
    this.duel = new Duel();
    if (this.carry) {
      this.me.hp = Math.max(1, this.carry.you);
      this.ai.hp = Math.max(1, this.carry.opponent);
      this.carry = null;
    }
    this.now = performance.now();
    this.pendingCast = null;
    this.acc = 0;
    this.aiNextCast = this.now + 2600; // grace period before the AI's first cast

    this.set({
      opponentName: this.opponentName, phase: 'loading', countdownEndsAt: 0, round: 1,
      hp: { you: Math.round(this.me.hp), opponent: Math.round(this.ai.hp) },
      resources: { mana: this.me.mana, shield: 0, cd: {} },
      effects: { you: blankStatus(), opponent: blankStatus() },
      options: [...this.get().deck], // whole deck is castable now
      log: [], outcome: null, oppTrail: null, oppX: 0, oppShield: 0, lastResult: null, lastMatch: null,
      youSubmitted: false, oppSubmitted: false,
    });

    // Once the arena has loaded, count down 3-2-1 and go live.
    this._whenLoaded(() => {
      this.set({ phase: 'countdown', countdownEndsAt: performance.now() + COUNTDOWN_MS });
      this._timers.push(setTimeout(() => {
        if (!this.alive) return;
        // grace before the AI's first cast, measured from the start of the fight
        this.aiNextCast = performance.now() + 1100;
        this.set({ phase: 'live' });
      }, COUNTDOWN_MS));
    });
    this._raf = requestAnimationFrame(this._loop);
  }

  _whenLoaded(fn) {
    const check = () => {
      if (!this.alive) return;
      if (this.get().sceneReady) fn();
      else this._timers.push(setTimeout(check, 100));
    };
    check();
  }

  _loop = (t) => {
    if (!this.alive) return;

    // FIXED TIMESTEP. Clamping a variable dt (the obvious approach) silently
    // slows the whole simulation whenever the frame rate drops: at 4 fps a
    // 250 ms frame clamps to 50 ms, so mana regenerates at a fifth of real
    // speed and the AI can never afford to cast. Instead, accumulate real
    // elapsed time and consume it in fixed steps.
    const elapsed = (t - this.now) / 1000;
    this.now = t;
    // Cap the catch-up: after a long stall (backgrounded tab) we deliberately
    // drop the missed time rather than running hundreds of steps at once.
    this.acc = Math.min((this.acc || 0) + elapsed, MAX_CATCHUP);

    if (this.get().phase === 'live') {
      const scale = hitStopScale();
      while (this.acc >= FIXED_DT) {
        this.acc -= FIXED_DT;
        // Hit-stop dilates the SIMULATION, not the wall clock: `t` stays real
        // (cooldowns and projectile arrivals are absolute timestamps); only the
        // step size shrinks.
        this._tick(FIXED_DT * scale, t);
      }
    } else {
      this.acc = 0;
    }
    this._raf = requestAnimationFrame(this._loop);
  };

  _tick(dt, now) {
    this.duel.setX(ME, this.get().move.x);

    // AI decides on its own clock, then releases after its wind-up
    if (now >= this.aiNextCast) this._aiThink(now);
    this._releasePending(now);

    presentEvents(this.get, this.duel.step(dt, now), ME);

    // publish a snapshot for the HUD (HP eases toward these in the scene) —
    // including on the step that ends the match, so the loser's bar reaches 0
    this.set({
      hp: { you: Math.round(this.me.hp), opponent: Math.round(this.ai.hp) },
      resources: { mana: this.me.mana, shield: this.me.shield, cd: { ...this.me.cd } },
      oppShield: this.ai.shield,
    });
  }

  // ---- player casting (called from the 3D DesktopCaster via store.submitCast) ----
  submit(points2d, drawTime) {
    if (!this.alive || this.get().phase !== 'live') return null;
    const match = bestMatch(points2d, this.get().deck);
    if (!match.spellId || match.fizzled) {
      this.set({ lastMatch: { ...match, fizzled: true } });
      return match;
    }
    this.duel.setX(ME, this.get().move.x);
    const r = this.duel.cast(ME, match.spellId, { accuracy: match.score, drawTime }, this.now);
    if (r.block) {
      this.set({ lastMatch: { ...match, blocked: r.block } });
      return { ...match, blocked: r.block };
    }
    this._afterCast(r.event);
    this.set({ lastMatch: match });
    return match;
  }

  // Cast at a fixed power, bypassing recognition. Kept with this signature for
  // the visual QA harnesses (xr/test/*.mjs), which stage specific spells.
  _cast(caster, side, id, power, now) {
    const s = side === 'you' ? ME : FOE;
    if (s === ME) this.duel.setX(ME, this.get().move.x);
    const r = this.duel.cast(s, id, { power }, now);
    if (r.ok) this._afterCast(r.event);
    return r;
  }

  _afterCast(event) {
    presentEvents(this.get, [event], ME);
    // reflect the spend into the store immediately so the HUD (and tests) see it
    // this frame rather than waiting for the next tick.
    if (event.by === ME) {
      this.set({ resources: { mana: this.me.mana, shield: this.me.shield, cd: { ...this.me.cd } } });
    }
  }

  _aiThink(now) {
    const cfg = AI[this.difficulty || this.get().difficulty] || AI.normal;
    const deck = this.get().deck;
    const castable = deck.filter((id) => !castBlock(this.ai, id, now));
    // prefer an attack; if low on mana it'll wait for the next tick
    const id = castable.find((x) => SPELLS[x].type === 'attack') || castable[0];
    if (id) {
      const acc = Math.random() < 0.92 ? rand(cfg.acc) : 0.3; // occasional fizzle
      if (acc >= FIZZLE_THRESHOLD) {
        // TELEGRAPH: commit to the spell now, but do not release it until the
        // wind-up has played. The avatar starts its anticipation the moment
        // oppTrail goes active, so the player gets a readable warning.
        this._showDummyTrail(id);
        this.pendingCast = { id, accuracy: acc, drawTime: rand(cfg.time), releaseAt: now + RT.TELEGRAPH_MS };
      }
    }
    this.aiNextCast = now + rand(cfg.every) * 1000;
  }

  _releasePending(now) {
    const p = this.pendingCast;
    if (!p || now < p.releaseAt) return;
    this.pendingCast = null;
    // the fight may have ended during the wind-up; the duel also re-checks
    // affordability, since mana may have been spent in the meantime
    if (this.get().phase !== 'live') return;
    const r = this.duel.cast(FOE, p.id, { accuracy: p.accuracy, drawTime: p.drawTime, power: p.power }, now);
    if (r.ok) this._afterCast(r.event);
  }

  _showDummyTrail(spellId) {
    // Build a 3D glyph from the rune template at the dummy's chest so you see it
    // "drawing" the spell it's casting. (OpponentAvatar mirrors these across.)
    const raw = TEMPLATES[spellId];
    if (!raw) return;
    const pts = raw.map((p) => [(p.x - 0.5) * 0.55, 1.5 + (0.5 - p.y) * 0.55, -0.05]);
    this.set({ oppTrail: { spellId, points: [], active: true } });
    let i = 0;
    const step = () => {
      if (!this.alive || this.get().phase === 'over') return;
      i = Math.min(pts.length, i + Math.ceil(pts.length / 12));
      this.set({ oppTrail: { spellId, points: pts.slice(0, i), active: i < pts.length } });
      if (i < pts.length) this._timers.push(setTimeout(step, Math.round(RT.TELEGRAPH_MS / 14)));
      else this._timers.push(setTimeout(() => { if (this.alive) this.set({ oppTrail: null }); }, 400));
    };
    step();
  }

  rematch() {
    this._timers.forEach(clearTimeout);
    this._timers = [];
    cancelAnimationFrame(this._raf);
    this.start();
  }
  sendPresence() {}
  sendTrail() {}
  sendTrailEnd() {}

  dispose() {
    this.alive = false;
    resetFeel();
    cancelAnimationFrame(this._raf);
    this._timers.forEach(clearTimeout);
    this._timers = [];
  }
}

function rand([a, b]) { return a + Math.random() * (b - a); }
