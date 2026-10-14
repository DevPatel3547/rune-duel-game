// Enemy wizard AI. Acts through the same castSpell()/launchMeteor() API the
// player uses. Difficulty scales its draw "power", think cadence, and meteor use.

import { castSpell, launchMeteor } from './engine.js';
import { FIELD, WAR_SPELLS } from './content.js';

const TUNING = {
  novice: { think: [1.8, 3.0], power: [0.35, 0.6], meteorChance: 0.15, aggression: 0.5 },
  adept:  { think: [1.1, 2.0], power: [0.55, 0.8], meteorChance: 0.4, aggression: 0.75 },
  archmage:{ think: [0.7, 1.3], power: [0.78, 1.0], meteorChance: 0.65, aggression: 1.0 },
};

const rand = (lo, hi) => lo + Math.random() * (hi - lo);

export function aiTick(game) {
  if (game.status !== 'playing') return;
  const cfg = TUNING[game.difficulty] || TUNING.adept;
  const ai = game.enemy.ai;
  if (game.t < ai.nextThink) return;
  ai.nextThink = game.t + rand(cfg.think[0], cfg.think[1]);

  const power = rand(cfg.power[0], cfg.power[1]);
  const myMinions = game.minions.filter((m) => m.side === 'e').length;
  const foeMinions = game.minions.filter((m) => m.side === 'p');
  const foeFront = foeMinions.length;

  // Priority list, gated by mana; first affordable + useful choice wins.
  const wantWard = game.enemy.crystal.hp < game.enemy.crystal.maxHp * 0.5
    && game.enemy.crystal.wardUntil < game.t;

  // Occasionally test the player's dodge.
  if (!game.meteor && Math.random() < cfg.meteorChance) {
    launchMeteor(game);
  }

  const tryCast = (id, target) => castSpell(game, 'e', id, power, target).ok;

  if (wantWard && tryCast('ward')) return;

  // Clear a threatening player push with an AoE centered on their front line.
  if (foeFront >= 2) {
    const cluster = foeMinions.reduce((a, m) => ({ x: a.x + m.x, y: a.y + m.y }), { x: 0, y: 0 });
    const target = { x: cluster.x / foeFront, y: cluster.y / foeFront };
    if (tryCast('nova', target) || tryCast('quake', target)) return;
  }

  // Keep bodies on the board.
  if (myMinions < 2 + cfg.aggression * 2 && tryCast('summon')) return;

  // Otherwise chip with a bolt, or bank mana.
  if (Math.random() < cfg.aggression) tryCast('bolt');
}
