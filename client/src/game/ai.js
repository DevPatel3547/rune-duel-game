// AI opponent. Picks a spell from its two options with simple counter logic,
// then "draws" it with a simulated accuracy and speed for its difficulty.

import { SPELLS, computePower, FIZZLE_THRESHOLD } from '@rune/shared';

export const AI_LEVELS = {
  easy: { label: 'Apprentice', accuracy: [0.45, 0.68], speedMult: [1.3, 1.9], smart: 0 },
  medium: { label: 'Adept', accuracy: [0.65, 0.85], speedMult: [1.0, 1.5], smart: 0.5 },
  hard: { label: 'Archmage', accuracy: [0.85, 0.97], speedMult: [0.85, 1.15], smart: 0.9 },
};

const rand = (lo, hi) => lo + Math.random() * (hi - lo);

export function aiPickSpell(options, level, ctx) {
  const cfg = AI_LEVELS[level];
  // ctx: { myHp, oppHp, oppLastSpell, mySurge, oppSurge }
  if (Math.random() < cfg.smart) {
    // Counter logic, in priority order.
    if (ctx.oppSurge) {
      const def = options.find((s) => s === 'shield' || s === 'reflect');
      if (def) return def;
    }
    if (ctx.oppLastSpell === 'shield' && options.includes('pierce')) return 'pierce';
    if (ctx.oppLastSpell === 'nova' && options.includes('quake')) return 'quake';
    if (ctx.mySurge) {
      const big = [...options].sort((x, y) => SPELLS[y].baseDamage - SPELLS[x].baseDamage)[0];
      if (SPELLS[big].baseDamage > 0) return big;
    }
    if (ctx.myHp < 30 && options.includes('leech')) return 'leech';
    if (ctx.myHp < 25 && options.includes('shield')) return 'shield';
    if (ctx.oppHp <= 25) {
      const finisher = [...options].sort((x, y) => SPELLS[y].baseDamage - SPELLS[x].baseDamage)[0];
      if (SPELLS[finisher].baseDamage >= 15) return finisher;
    }
  }
  // Otherwise weighted random, leaning toward damage.
  const weighted = options.flatMap((s) => Array(SPELLS[s].baseDamage > 0 ? 2 : 1).fill(s));
  return weighted[Math.floor(Math.random() * weighted.length)];
}

export function aiDraw(spellId, level, slowed) {
  const cfg = AI_LEVELS[level];
  const accuracy = rand(...cfg.accuracy);
  const drawTime = SPELLS[spellId].targetTime * rand(...cfg.speedMult);
  if (accuracy < FIZZLE_THRESHOLD) return { spell: null, power: 0, accuracy, drawTime };
  return { spell: spellId, power: computePower(accuracy, drawTime, spellId, slowed), accuracy, drawTime };
}

// How long the AI "takes" before submitting, for realism.
export function aiThinkTime(level) {
  return rand(1800, level === 'hard' ? 3200 : 4500);
}
