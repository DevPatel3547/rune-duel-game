// War of Wizards (flat-screen recreation) — content + tuning.
//
// The genre is a wizard tower-defense MOBA: two wizards, each with a crystal.
// You summon minions that march the lane and destroy the enemy crystal, while
// casting gesture-drawn spells to push, defend, and snipe. Win by reducing the
// enemy crystal to 0 HP.
//
// Every castable spell reuses an existing rune template (see shared/templates),
// so the $1 recognizer scores the player's draw exactly like before — power is
// determined by how cleanly/quickly you draw it.

export const FIELD = {
  // Logical field is 0..1 in x (lane width) and 0..1 in y (lane length).
  // y = 1.0 is the player's crystal (bottom), y = 0.0 is the enemy's (top).
  playerCrystalY: 0.93,
  enemyCrystalY: 0.07,
  laneMinX: 0.12,
  laneMaxX: 0.88,
};

export const CRYSTAL_HP = 300;

export const MANA = {
  max: 100,
  start: 45,
  regenPerSec: 11,
};

// Player wizard sits near their crystal; dodging = sliding it along the bottom.
export const WIZARD = {
  y: 0.86, // player wizard row
  enemyY: 0.14, // enemy wizard row
  radius: 0.045,
  hitStunSec: 1.1, // cast lockout after being hit by a dodgeable spell
  hitManaLoss: 20,
};

// Minion archetype. Power of the summon scales count + hp.
export const MINION = {
  hp: 34,
  contactDPS: 7, // damage per second while touching an enemy unit/crystal
  crossSec: 13, // seconds to walk the full lane at base speed
  radius: 0.03,
  aggroRange: 0.09, // how close before two opposing minions lock and fight
};

// The enemy's dodgeable attack: a telegraphed meteor aimed at your wizard's x.
export const METEOR = {
  telegraphSec: 1.25,
  radius: 0.11,
  crystalIfMiss: false, // it targets the wizard, not the crystal
};

// ── Spells ─────────────────────────────────────────────────────────────────
// runeId       -> which rune template the player draws (recognizer key)
// cost         -> mana
// kind         -> how the engine resolves it
// The player's opening hand is `STARTER_HAND`.

export const WAR_SPELLS = {
  bolt: {
    id: 'bolt', runeId: 'bolt', name: 'Bolt', emoji: '⚡', color: '#ffd24a',
    cost: 14, kind: 'projectile', cooldownSec: 1.4,
    damage: 46, // × power; hits first enemy unit in the lane, else the crystal
    desc: 'Fast bolt up the lane. Kills the frontline or chips the crystal.',
  },
  summon: {
    id: 'summon', runeId: 'vortex', name: 'Summon Swarm', emoji: '🌀', color: '#b06cff',
    cost: 26, kind: 'summon', cooldownSec: 3.2,
    countBase: 2, countBonus: 2, // 2..4 imps depending on power
    desc: 'Open a portal. Imps march the lane and smash the enemy crystal.',
  },
  quake: {
    id: 'quake', runeId: 'quake', name: 'Quake', emoji: '🌋', color: '#ff8c3a',
    cost: 24, kind: 'aoe', cooldownSec: 3.0,
    damage: 30, radius: 0.16, // × power to every enemy minion in the burst
    desc: 'Ground burst where you draw it. Clears a wave of minions.',
  },
  ward: {
    id: 'ward', runeId: 'shield', name: 'Crystal Ward', emoji: '🛡️', color: '#4ab7ff',
    cost: 22, kind: 'ward', cooldownSec: 5.0,
    absorb: 90, durationSec: 8, // × power absorb bubble on your crystal
    desc: 'Shield your crystal. Absorbs incoming damage for a while.',
  },
  rally: {
    id: 'rally', runeId: 'surge', name: 'Rally', emoji: '🔺', color: '#ffffff',
    cost: 20, kind: 'buff', cooldownSec: 6.0,
    dmgMult: 1.8, speedMult: 1.5, durationSec: 6,
    desc: 'Enrage every friendly minion — faster, harder-hitting for a bit.',
  },
  nova: {
    id: 'nova', runeId: 'nova', name: 'Nova', emoji: '⭐', color: '#ffc83d',
    cost: 42, kind: 'aoe', cooldownSec: 7.0,
    damage: 60, radius: 0.22,
    desc: 'The big one. Slow to draw, but wipes a whole push.',
  },
};

// Opening hand — the four cards that teach the full loop.
export const STARTER_HAND = ['summon', 'bolt', 'quake', 'ward'];

export const WAR_SPELL_IDS = Object.keys(WAR_SPELLS);
