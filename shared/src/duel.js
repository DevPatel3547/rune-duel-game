// One duel simulation, run identically by the offline practice driver and the
// online match server.
//
// Before this existed the two sides each carried their own copy of the rules,
// and the server's copy fell behind: no dodging, no domain for Nova, no impact
// results for the client to show. Online matches were quietly a worse game
// than practice. With one simulation, anything added to the duel lands in both.
//
// The simulation knows nothing about rendering, sockets or input. It takes
// casts and lateral positions in, and hands back a list of events (a spell was
// cast, a spell landed or was dodged, the match ended) for the caller to
// present or broadcast. Sides are 0 and 1; `x` is each side's lateral offset in
// its OWN frame, which is what aiming and dodging are measured in.
import { computePower } from './spells.js';
import {
  RT, travelMs, newCombatant, castBlock, payCast, resolveImpact, applySelfCast, isSlowed,
} from './realtime.js';

// How far a duelist may stray from the centre mark, in metres.
export const MOVE_LIMIT = 5.2;
// Metres per second at full tilt.
export const MOVE_SPEED = 6.2;
// A spell misses if, when it lands, its target has moved this far from where it
// was aimed. Tuned against projectile flight time: a committed sidestep beats a
// slow spell, a twitch does not.
export const DODGE_RADIUS = 1.55;

export const dodged = (currentX, aimedX) => Math.abs(currentX - aimedX) > DODGE_RADIUS;

// Spells that get their own presentation instead of a thrown projectile.
export const SPECTACLE = { nova: 'domain', golem: 'summon', wyrm: 'summon', rupture: 'meteor' };

// How long a spell takes to resolve after it is cast, in ms. A domain resolves
// when its cut lands, partway through the sequence, not at the end.
export function flightMs(id) {
  const s = SPECTACLE[id];
  if (s === 'domain') return 2600;
  if (s === 'summon') return 4200;
  if (s === 'meteor') return 1900;
  return travelMs(id);
}

const clampX = (x) => Math.max(-MOVE_LIMIT, Math.min(MOVE_LIMIT, Number(x) || 0));

export class Duel {
  constructor() {
    this.sides = [newCombatant(), newCombatant()];
    this.x = [0, 0];
    this.projectiles = []; // { by, id, power, aimedX, undodgeable, impactAt }
    this.winner = undefined; // undefined = still going, 0|1 = winner, null = draw
  }

  get over() { return this.winner !== undefined; }

  setX(side, x) { this.x[side] = clampX(x); }

  // Try to cast. `power` may be given directly (the AI); otherwise it is derived
  // from recognizer accuracy and draw time. Returns { block } when the cast is
  // refused ('mana' | 'cooldown' | 'over'), else { ok, event }.
  cast(side, id, { accuracy = 0, drawTime = 1.2, power } = {}, now) {
    if (this.over) return { block: 'over' };
    const c = this.sides[side];
    const block = castBlock(c, id, now);
    if (block) return { block };

    const p = power ?? computePower(accuracy, drawTime, id, isSlowed(c, now));
    payCast(c, id, now);

    if (applySelfCast(c, id, now)) {
      return { ok: true, event: { type: 'cast', by: side, spellId: id, kind: 'selfcast', power: p } };
    }

    const spectacle = SPECTACLE[id];
    const travel = flightMs(id);
    // Aimed at where the target IS at launch. Sidestepping after the spell is
    // committed is what makes a dodge a decision rather than a reflex check.
    const aimedX = this.x[1 - side];
    this.projectiles.push({
      by: side, id, power: p, aimedX,
      // a domain is not aimed and cannot be side-stepped: it fills the space
      undodgeable: spectacle === 'domain',
      impactAt: now + travel,
    });
    return {
      ok: true,
      event: {
        type: 'cast', by: side, spellId: id, kind: spectacle || 'projectile',
        travel, power: p, aimedX, casterX: this.x[side],
      },
    };
  }

  // Advance by dt seconds of simulation at wall-clock `now` (ms). dt may be
  // dilated for hit-stop; `now` must stay real, because cooldowns and impacts
  // are absolute timestamps. Returns the events that happened this step.
  step(dt, now) {
    const events = [];
    if (this.over) return events;

    for (const c of this.sides) {
      c.mana = Math.min(RT.MANA_MAX, c.mana + RT.MANA_REGEN * dt);
      if (c.shield > 0 && c.shieldUntil <= now) c.shield = 0;
    }

    const flying = [];
    for (const p of this.projectiles) {
      if (now < p.impactAt) { flying.push(p); continue; }
      const target = 1 - p.by;
      if (!p.undodgeable && dodged(this.x[target], p.aimedX)) {
        events.push({ type: 'impact', by: p.by, spellId: p.id, dodged: true, aimedX: p.aimedX, dmg: 0, heal: 0, absorbed: 0 });
        continue;
      }
      const r = resolveImpact(this.sides[p.by], this.sides[target], p.id, p.power, now);
      events.push({ type: 'impact', by: p.by, spellId: p.id, dodged: false, aimedX: p.aimedX, power: p.power, ...r });
    }
    this.projectiles = flying;

    const dead0 = this.sides[0].hp <= 0;
    const dead1 = this.sides[1].hp <= 0;
    if (dead0 || dead1) {
      this.winner = dead0 && dead1 ? null : dead0 ? 1 : 0;
      events.push({ type: 'over', winner: this.winner });
    }
    return events;
  }
}
