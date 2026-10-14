// All 30 spells. baseDamage scales with draw power (0..1).
// targetTime (seconds) is the baseline for the speed score.

export const MAX_HP = 100;
export const SHIELD_ABSORB = 40;
export const REFLECT_RATIO = 0.8;
export const LEECH_RATIO = 0.5;
export const SURGE_MULT = 2.0;
export const DRAIN_MULT = 0.7;
export const NOVA_DISRUPT_MULT = 0.4;
export const SLOW_PENALTY = 0.5; // seconds added to draw time
export const FIZZLE_THRESHOLD = 0.4; // recognizer confidence below this = fizzle
export const ANCHOR_ROUNDS = 2;

export const SPELLS = {
  bolt: {
    id: 'bolt', name: 'Bolt', emoji: '⚡', color: '#ffd24a',
    baseDamage: 25, targetTime: 0.9, type: 'attack',
    desc: 'Pure direct damage. High ceiling on a clean draw.',
    counter: 'Absorbed by Shield',
  },
  vortex: {
    id: 'vortex', name: 'Vortex', emoji: '🌀', color: '#b06cff',
    baseDamage: 18, targetTime: 1.2, type: 'attack',
    desc: 'Damage + slows the opponent\'s next draw.',
    counter: 'Slow blocked by Anchor',
  },
  shield: {
    id: 'shield', name: 'Shield', emoji: '🛡️', color: '#4ab7ff',
    baseDamage: 0, targetTime: 0.7, type: 'defense',
    desc: 'Absorbs up to 40 incoming damage this round.',
    counter: 'Bypassed by Pierce',
  },
  quake: {
    id: 'quake', name: 'Quake', emoji: '🌋', color: '#ff8c3a',
    baseDamage: 20, targetTime: 1.0, type: 'attack',
    desc: 'Damage + shakes the enemy canvas next round. Disrupts Nova.',
    counter: 'Shake blocked by Anchor',
  },
  pierce: {
    id: 'pierce', name: 'Pierce', emoji: '🗡️', color: '#ff4a5e',
    baseDamage: 20, targetTime: 0.6, type: 'attack',
    desc: 'Ignores Shield completely. Fastest rune in the game.',
    counter: 'Reflected hard by Reflect',
  },
  reflect: {
    id: 'reflect', name: 'Reflect', emoji: '🪞', color: '#cfd8e6',
    baseDamage: 0, targetTime: 0.9, type: 'defense',
    desc: 'Sends the incoming spell back at 80% power.',
    counter: 'Nullified by Void',
  },
  leech: {
    id: 'leech', name: 'Leech', emoji: '🧛', color: '#52e07a',
    baseDamage: 15, targetTime: 1.1, type: 'attack',
    desc: 'Deals damage and heals you for half of it.',
    counter: 'Heal stripped by Void',
  },
  surge: {
    id: 'surge', name: 'Surge', emoji: '🔺', color: '#ffffff',
    baseDamage: 0, targetTime: 0.8, type: 'utility',
    desc: 'No damage now — your NEXT spell hits at double power.',
    counter: 'Risky: you take a free hit this round',
  },
  void: {
    id: 'void', name: 'Void', emoji: '⭕', color: '#4a3f7a',
    baseDamage: 10, targetTime: 1.3, type: 'utility',
    desc: 'Strips ALL special effects off the enemy spell this round.',
    counter: 'None. This IS the counter.',
  },
  anchor: {
    id: 'anchor', name: 'Anchor', emoji: '⚓', color: '#c9935a',
    baseDamage: 8, targetTime: 1.4, type: 'defense',
    desc: 'Immune to slows and shakes for 2 rounds. Chip damage.',
    counter: 'Pierce ignores defenses',
  },
  drain: {
    id: 'drain', name: 'Drain', emoji: '🌙', color: '#7a4ad8',
    baseDamage: 12, targetTime: 1.2, type: 'attack',
    desc: 'Damage + the enemy\'s next spell loses 30% power.',
    counter: 'Weaken stripped by Void',
  },
  nova: {
    id: 'nova', name: 'Nova', emoji: '⭐', color: '#ffc83d',
    baseDamage: 45, targetTime: 2.0, type: 'attack',
    desc: 'Biggest hit in the game. Slow to draw. Quake guts it.',
    counter: 'Quake same round drops it to 40% power',
  },

  // ======================================================================
  // EXPANSION — 18 more, taking the roster to 30 (including two summons).
  //
  // Grouped by ROLE rather than sprinkled: the original twelve already cover
  // the counter triangle, so these widen the texture instead of re-cutting it —
  // fast chip attacks, heavy commitments, two more defences, and the summons,
  // which are the slowest and most expensive things in the game because you
  // watch them cross the arena.
  // ======================================================================

  // --- fast, cheap pressure ---
  fang: {
    id: 'fang', name: 'Fang', emoji: '🦷', color: '#ff6b8a',
    baseDamage: 14, targetTime: 0.6, type: 'attack',
    desc: 'Quickest rune in the game. Small bite, almost no commitment.',
    counter: 'Absorbed by Shield',
  },
  lance: {
    id: 'lance', name: 'Lance', emoji: '🗡️', color: '#ff4d4d',
    baseDamage: 22, targetTime: 0.85, type: 'attack',
    desc: 'A barbed thrust. Fast and straight, like Pierce with weight.',
    counter: 'Absorbed by Shield',
  },
  frost: {
    id: 'frost', name: 'Frost', emoji: '❄️', color: '#7fd8ff',
    baseDamage: 16, targetTime: 1.0, type: 'attack',
    desc: 'Bites and chills — light damage, drags the next draw.',
    counter: 'Slow blocked by Anchor',
  },
  tide: {
    id: 'tide', name: 'Tide', emoji: '🌊', color: '#3fb0d8',
    baseDamage: 19, targetTime: 1.1, type: 'attack',
    desc: 'A rolling wave. Wide and hard to read the timing of.',
    counter: 'Absorbed by Shield',
  },

  // --- heavy commitments ---
  rupture: {
    id: 'rupture', name: 'Rupture', emoji: '🪨', color: '#e08a3c',
    baseDamage: 34, targetTime: 1.5, type: 'attack',
    desc: 'Splits the ground open under them. Slow, and it lands like it.',
    counter: 'Quake disrupts it',
  },
  maul: {
    id: 'maul', name: 'Maul', emoji: '🔨', color: '#d2691e',
    baseDamage: 30, targetTime: 1.4, type: 'attack',
    desc: 'Overhead crush. Big, obvious, and hurts if it connects.',
    counter: 'Absorbed by Shield',
  },
  ruin: {
    id: 'ruin', name: 'Ruin', emoji: '💀', color: '#a24bd6',
    baseDamage: 38, targetTime: 1.7, type: 'attack',
    desc: 'A collapsing coil. Second only to Nova, and nearly as expensive.',
    counter: 'Quake disrupts it',
  },
  crown: {
    id: 'crown', name: 'Crown', emoji: '👑', color: '#ffd76a',
    baseDamage: 27, targetTime: 1.3, type: 'attack',
    desc: 'Three descending strikes in one cast.',
    counter: 'Absorbed by Shield',
  },

  // --- curse / control ---
  hex: {
    id: 'hex', name: 'Hex', emoji: '🕸️', color: '#8e5bd6',
    baseDamage: 17, targetTime: 1.2, type: 'attack',
    desc: 'An unwinding curse. Damage now, sluggishness after.',
    counter: 'Slow blocked by Anchor',
  },
  snare: {
    id: 'snare', name: 'Snare', emoji: '🪤', color: '#9ad24b',
    baseDamage: 12, targetTime: 1.0, type: 'attack',
    desc: 'Little damage; pins them so the next spell is harder to dodge.',
    counter: 'Slow blocked by Anchor',
  },
  brand: {
    id: 'brand', name: 'Brand', emoji: '🔥', color: '#ff8c42',
    baseDamage: 20, targetTime: 1.1, type: 'attack',
    desc: 'Marks them. Burns on contact and keeps burning.',
    counter: 'Absorbed by Shield',
  },
  eclipse: {
    id: 'eclipse', name: 'Eclipse', emoji: '🌑', color: '#5b4bd6',
    baseDamage: 24, targetTime: 1.3, type: 'attack',
    desc: 'Swallows the light around them. Ignores half a shield.',
    counter: 'Pierced by Pierce',
  },
  siphon: {
    id: 'siphon', name: 'Siphon', emoji: '🩸', color: '#d64b6b',
    baseDamage: 18, targetTime: 1.15, type: 'attack',
    desc: 'Drinks what it deals — the other half of Leech.',
    counter: 'Absorbed by Shield',
  },
  thorn: {
    id: 'thorn', name: 'Thorn', emoji: '🌵', color: '#5bd68e',
    baseDamage: 15, targetTime: 1.0, type: 'attack',
    desc: 'A ring of spikes. Punishes whoever swung last.',
    counter: 'Absorbed by Shield',
  },

  // --- defence ---
  ward: {
    id: 'ward', name: 'Ward', emoji: '🔷', color: '#4bd6d6',
    baseDamage: 0, targetTime: 0.9, type: 'defense',
    desc: 'A squared barrier. Less absorb than Shield, far shorter cooldown.',
    counter: 'Pierce ignores it',
  },
  bulwark: {
    id: 'bulwark', name: 'Bulwark', emoji: '🛡️', color: '#6b8cff',
    baseDamage: 0, targetTime: 1.1, type: 'defense',
    desc: 'The heavy dome. Soaks more than Shield and costs you the tempo.',
    counter: 'Pierce ignores it',
  },

  // --- summons: the slowest, most expensive casts in the game ---
  golem: {
    id: 'golem', name: 'Golem', emoji: '🗿', color: '#b0a08a',
    baseDamage: 32, targetTime: 1.8, type: 'attack',
    desc: 'Tears a gate and sends something through it. You watch it walk.',
    counter: 'Quake disrupts it',
  },
  wyrm: {
    id: 'wyrm', name: 'Wyrm', emoji: '🐉', color: '#4bd67a',
    baseDamage: 36, targetTime: 1.9, type: 'attack',
    desc: 'Calls a long thing that comes the whole way down the arena.',
    counter: 'Quake disrupts it',
  },
};

export const SPELL_IDS = Object.keys(SPELLS);
export const STARTER_DECK = ['bolt', 'shield', 'vortex', 'pierce', 'leech'];
export const DECK_SIZE = 5;

export function blankStatus() {
  return { surge: false, drained: false, slowed: false, shaken: false, anchor: 0 };
}

// power = 0.6 * accuracy + 0.4 * speed
export function computePower(accuracy, drawTime, spellId, slowed = false) {
  const spell = SPELLS[spellId];
  const effectiveTime = Math.max(0.15, drawTime + (slowed ? SLOW_PENALTY : 0));
  const speed = Math.min(1, spell.targetTime / effectiveTime);
  const acc = Math.max(0, Math.min(1, accuracy));
  return acc * 0.6 + speed * 0.4;
}
