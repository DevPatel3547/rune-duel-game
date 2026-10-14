// Helpers shared by the online and practice drivers.
import { scoreAgainst, SPELLS, FIZZLE_THRESHOLD } from '@rune/shared';
import { YOU_CAST, OPP_CHEST, YOU_CHEST } from '../config.js';

// Given the 2 rune options this round and the player's drawn 2D stroke, return
// the option they most likely intended. War-of-Wizards style: the player just
// draws — we figure out which glyph it was. Below the fizzle threshold = miss.
export function bestMatch(points2d, options) {
  let best = { spellId: null, score: 0 };
  for (const id of options) {
    const s = scoreAgainst(points2d, id);
    if (s > best.score) best = { spellId: id, score: s };
  }
  best.fizzled = best.score < FIZZLE_THRESHOLD;
  return best;
}

// Drive the shared resolution animation: projectiles fly, HP eases to the
// authoritative values, log scrolls. Used by BOTH drivers so online and
// practice look identical.
export function playResult(get, set, res) {
  const g = get();
  set({
    phase: 'resolving',
    lastResult: res,
    youSubmitted: false,
    oppSubmitted: false,
  });
  if (res.log?.length) g.pushLog(res.log);

  // Spawn the two projectiles (only if a real spell was cast that round).
  const TRAVEL = 750;
  if (res.you.spell) {
    g.pushFx({
      kind: 'projectile', spellId: res.you.spell, dir: 'out',
      from: YOU_CAST, to: OPP_CHEST, travel: TRAVEL,
      hit: res.damage.opponent, color: SPELLS[res.you.spell].color,
    });
  }
  if (res.opponent.spell) {
    g.pushFx({
      kind: 'projectile', spellId: res.opponent.spell, dir: 'in',
      from: OPP_CHEST, to: YOU_CHEST, travel: TRAVEL,
      hit: res.damage.you, color: SPELLS[res.opponent.spell].color,
    });
  }

  // Ease HP to the authoritative numbers slightly after impact.
  setTimeout(() => {
    set({ hp: { you: res.hp.you, opponent: res.hp.opponent } });
  }, TRAVEL - 60);
}
