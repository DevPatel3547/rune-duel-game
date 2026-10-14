// State + actions for the real-time lane battle. The mutable `match` object
// (from sim.js) lives here but is NOT what React renders — every sim tick the
// driver copies a lightweight snapshot into the reactive fields below.
import { create } from 'zustand';
import { createMatch, cast } from './sim.js';

// Which drawn rune casts which spell. The left value is a $1 template id from
// @rune/shared; the right is a sim spell key (UNITS or BOLTS).
export const RUNE_SPELL = {
  vortex: 'imp',     // 🌀 summon a pack of imps
  quake: 'brute',    // 🌋 summon brutes
  void: 'giant',     // ⭕ summon a giant
  surge: 'wisp',     // 🔺 summon fast wisps
  bolt: 'fireball',  // ⚡ direct damage
  nova: 'meteor',    // ⭐ splash damage
  leech: 'heal',     // 🌙 mend your tower
};
export const SPELL_RUNES = Object.entries(RUNE_SPELL); // [runeId, spellKey][]

export const useLane = create((set, get) => ({
  screen: 'menu', // 'menu' | 'battle'
  name: 'Wizard',
  difficulty: 'normal',

  // mutable engine state (not for rendering)
  match: null,

  // reactive snapshot the scene + HUD render from
  status: 'playing',
  towers: { you: { hp: 1000, max: 1000 }, foe: { hp: 1000, max: 1000 } },
  mana: { you: 40, foe: 40 },
  minions: [],
  flashes: [],
  cast: null, // last recognized cast, for the HUD flash: { name, color, ok, reason }

  setName: (name) => set({ name: name.slice(0, 16) || 'Wizard' }),
  setDifficulty: (difficulty) => set({ difficulty }),

  start: () => {
    const match = createMatch();
    set({
      match, screen: 'battle', status: 'playing',
      towers: match.towers, mana: match.mana, minions: [], flashes: [], cast: null,
    });
  },

  // Called by the drawing layer with a recognized spell key (or null = fizzle).
  castSpell: (spellKey, label, color) => {
    const { match } = get();
    if (!match) return;
    if (!spellKey) { set({ cast: { name: 'Fizzled', color: '#ff7a8a', ok: false } }); return; }
    const r = cast(match, 'you', spellKey);
    set({ cast: { name: label, color, ok: r.ok, reason: r.reason } });
  },

  // The driver pushes a fresh snapshot here each sim tick.
  sync: (m) => set({
    status: m.status,
    towers: { you: { ...m.towers.you }, foe: { ...m.towers.foe } },
    mana: { you: m.mana.you, foe: m.mana.foe },
    minions: m.minions.map((x) => ({ ...x })),
    flashes: m.flashes.map((x) => ({ ...x })),
  }),

  leave: () => set({ screen: 'menu', match: null, minions: [], flashes: [] }),
}));

// Dev-only: expose the lane store so the headless smoke test can drive a match.
if (typeof window !== 'undefined' && import.meta.env?.DEV) {
  window.__lane = useLane;
}
