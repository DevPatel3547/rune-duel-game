// Real-time duel engine. Unlike resolveRound() (turn-based, simultaneous single
// exchange), this models a LIVE fight: mana regenerates over time, every spell
// has a mana cost + cooldown, attacks fly across the arena as projectiles and
// resolve on impact, and either wizard can cast whenever they can afford it.
// Pure + framework-free so the driver (and unit tests) can drive it deterministically.
import { SPELLS, MAX_HP, SHIELD_ABSORB } from './spells.js';

export const RT = {
  MANA_MAX: 100,
  MANA_REGEN: 16, // mana per second
  START_MANA: 60,
  // Base travel time across the arena. Deliberately slow: at 700 ms a spell
  // crossed faster than the eye could track it, so a duel read as numbers
  // changing rather than as objects being thrown. Slower flight also creates
  // the window in which shielding is a real decision. Raised again when the
  // duelling distance went 5 m -> 9 m, to keep the apparent speed the same.
  // Scaled with the arena when duelling distance doubled. Holding the old 1650
  // would have doubled every projectile's SPEED rather than its journey, which
  // is the opposite of what the extra room is for — a spell should be something
  // you watch coming.
  PROJECTILE_MS: 2350,
  // Per-spell multiplier on that base — a Pierce should feel like a dart and a
  // Nova like a boulder. Keeping the shape here (rather than in the renderer)
  // means the server's authoritative timing and the client's visuals agree.
  TRAVEL_SCALE: {
    pierce: 0.55,   // fastest rune in the game; it should look it
    fang:   0.6,
    lance:  0.68,
    bolt:   0.78,
    brand:  0.85,
    thorn:  0.95,
    frost:  1.0,
    snare:  1.0,
    siphon: 1.05,
    tide:   1.1,
    hex:    1.15,
    eclipse: 1.2,
    crown:  1.25,
    maul:   1.35,
    rupture: 1.45,
    ruin:   1.5,
    // Summons are the journey, not the delivery — you are meant to watch the
    // thing cross the arena and decide what to do about it.
    golem:  2.1,
    wyrm:   2.0,
    leech:  1.0,
    drain:  1.05,
    vortex: 1.12,
    void:   1.15,
    anchor: 1.3,
    quake:  1.4,
    nova:   1.7,    // the big commit — you can see it coming
  },
  // How long the AI visibly winds up before a spell actually launches. This is
  // the telegraph: enemy anticipation should be generous, because it is the
  // player's cue to react.
  TELEGRAPH_MS: 620,
  SLOW_MS: 2200, // how long vortex/drain slow the target
  SHIELD_MS: 6000, // how long a raised shield lasts before decaying
};

// Flight time for one spell, in ms.
export const travelMs = (id) => Math.round(RT.PROJECTILE_MS * (RT.TRAVEL_SCALE[id] ?? 1));

// Per-spell mana cost + cooldown (seconds). Tuned so bread-and-butter attacks
// fire roughly every 1.2–1.8s, defenses are more expensive, and Nova is a real
// commitment (big mana + long cooldown for the biggest hit in the game).
export const SPELL_RT = {
  bolt:    { cost: 30, cd: 1.2 },
  vortex:  { cost: 28, cd: 1.6 },
  shield:  { cost: 24, cd: 3.5 },
  quake:   { cost: 32, cd: 2.2 },
  pierce:  { cost: 26, cd: 1.1 },
  reflect: { cost: 26, cd: 4.0 },
  leech:   { cost: 28, cd: 1.8 },
  surge:   { cost: 22, cd: 5.0 },
  void:    { cost: 22, cd: 2.8 },
  anchor:  { cost: 20, cd: 3.0 },
  drain:   { cost: 26, cd: 1.9 },
  nova:    { cost: 58, cd: 4.5 },

  // Expansion. Cheap-and-fast at the top, heavy commitments at the bottom, and
  // the summons priced above everything except Nova.
  fang:    { cost: 16, cd: 0.8 },
  lance:   { cost: 24, cd: 1.1 },
  frost:   { cost: 22, cd: 1.5 },
  tide:    { cost: 26, cd: 1.6 },
  thorn:   { cost: 22, cd: 1.7 },
  snare:   { cost: 20, cd: 2.0 },
  brand:   { cost: 25, cd: 1.5 },
  hex:     { cost: 27, cd: 1.8 },
  siphon:  { cost: 27, cd: 1.9 },
  eclipse: { cost: 30, cd: 2.2 },
  crown:   { cost: 34, cd: 2.4 },
  maul:    { cost: 36, cd: 2.6 },
  rupture: { cost: 40, cd: 3.0 },
  ruin:    { cost: 48, cd: 3.8 },
  ward:    { cost: 18, cd: 2.4 },
  bulwark: { cost: 30, cd: 4.5 },
  golem:   { cost: 52, cd: 5.5 },
  wyrm:    { cost: 55, cd: 6.0 },
};
export const rtOf = (id) => SPELL_RT[id] || { cost: 30, cd: 1.5 };

export function newCombatant(mana = RT.START_MANA) {
  return { hp: MAX_HP, mana, shield: 0, shieldUntil: 0, surge: false, slowUntil: 0, cd: {} };
}

// Why a side can't cast right now: 'mana' | 'cooldown' | null (=ok).
export function castBlock(c, id, now) {
  const rt = rtOf(id);
  if (c.mana < rt.cost) return 'mana';
  if ((c.cd[id] || 0) > now) return 'cooldown';
  return null;
}

// Spend mana + start the spell's cooldown. Mutates c.
export function payCast(c, id, now) {
  const rt = rtOf(id);
  c.mana = Math.max(0, c.mana - rt.cost);
  c.cd[id] = now + rt.cd * 1000;
}

export const isProjectile = (id) => SPELLS[id].baseDamage > 0;
export const isSlowed = (c, now) => (c.slowUntil || 0) > now;

// Instant self-cast buffs (no projectile flies). Returns a label if handled, or
// null if the spell should instead fly at the opponent as a projectile.
export function applySelfCast(c, id, now) {
  if (id === 'shield')  { c.shield = SHIELD_ABSORB;        c.shieldUntil = now + RT.SHIELD_MS; return 'shield'; }
  if (id === 'reflect') { c.shield = Math.max(c.shield, SHIELD_ABSORB * 0.9); c.shieldUntil = now + RT.SHIELD_MS; return 'reflect'; }
  // Ward trades absorb for tempo, Bulwark trades tempo for absorb — the two
  // ends Shield sits between. Both must be listed here or they would read as
  // attacks, launch a projectile at the enemy, and do nothing at all.
  if (id === 'ward')    { c.shield = Math.max(c.shield, SHIELD_ABSORB * 0.6); c.shieldUntil = now + RT.SHIELD_MS * 0.7; return 'ward'; }
  if (id === 'bulwark') { c.shield = Math.max(c.shield, SHIELD_ABSORB * 1.5); c.shieldUntil = now + RT.SHIELD_MS * 1.2; return 'bulwark'; }
  if (id === 'surge')   { c.surge = true; return 'surge'; }
  return null;
}

// An attack lands on `target`, cast by `caster` with normalized power (0..1).
// Mutates both combatants; returns { dmg, heal, absorbed } for logs/FX.
export function resolveImpact(caster, target, id, power, now) {
  const sp = SPELLS[id];
  let dmg = sp.baseDamage * (0.55 + power * 0.85); // power .4→~0.9x, 1.0→~1.4x
  if (caster.surge) { dmg *= 2; caster.surge = false; }

  let absorbed = 0;
  const shieldUp = target.shield > 0 && (target.shieldUntil || 0) > now;
  if (shieldUp && id !== 'pierce') { // Pierce ignores shields entirely
    absorbed = Math.min(target.shield, dmg);
    target.shield -= absorbed;
    dmg -= absorbed;
  }

  dmg = Math.max(0, Math.round(dmg));
  target.hp = Math.max(0, target.hp - dmg);

  let heal = 0;
  if (id === 'leech') { heal = Math.round(dmg * 0.5); caster.hp = Math.min(MAX_HP, caster.hp + heal); }
  if (id === 'vortex' || id === 'drain') target.slowUntil = now + RT.SLOW_MS;

  return { dmg, heal, absorbed };
}

// Advance passive state (mana regen, shield/slow expiry). Mutates c.
export function regen(c, dt, now) {
  c.mana = Math.min(RT.MANA_MAX, c.mana + RT.MANA_REGEN * dt);
  if (c.shield > 0 && (c.shieldUntil || 0) <= now) c.shield = 0;
}
