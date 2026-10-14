// Central game state, shared by the DOM menu and the 3D scene.
// zustand works equally well inside and outside React, which is exactly what we
// need: the socket/practice drivers push updates from outside the component tree.
import { create } from 'zustand';
import { SPELLS, STARTER_DECK, blankStatus, TEMPLATES } from '@rune/shared';
import { createMovementState, resetMovement } from './movement.js';

let fxId = 0;

export const useGame = create((set, get) => ({
  // --- screen / session ---------------------------------------------------
  screen: 'menu', // 'menu' | 'game'
  mode: null, // 'practice' | 'online'
  inVR: false,
  status: '', // human-readable connection/info line

  // --- online session -----------------------------------------------------
  onlineAction: null, // { action, code } — what to retry after a failure
  roomCode: null,     // private room code while waiting / in match
  queue: null,        // quick match: { searching, online, others }
  ping: null,         // smoothed round trip to the match server, ms
  netError: null,     // 'offline' | 'update_required' | … when setup failed

  // --- match start ----------------------------------------------------------
  sceneReady: false,  // the duel scene has loaded and rendered (see ReadyProbe)
  countdownEndsAt: 0, // performance.now() at which the 3-2-1 reaches zero
  ratingChange: null, // rating gained or lost in the last ranked match

  // --- player config ------------------------------------------------------
  name: 'Wizard',
  deck: [...STARTER_DECK], // 5 spell ids
  difficulty: 'normal', // practice AI

  // --- match state --------------------------------------------------------
  phase: 'idle', // idle | lobby | countdown | live | over  (live = real-time duel)
  round: 0,
  hp: { you: 100, opponent: 100 },
  resources: { mana: 60, shield: 0, cd: {} }, // your live mana / shield / cooldowns
  effects: { you: blankStatus(), opponent: blankStatus() },
  options: null, // [spellId, spellId] for this round
  timeoutMs: 15000,
  roundStartedAt: 0,
  opponentName: 'Opponent',
  youSubmitted: false,
  oppSubmitted: false,
  lastResult: null, // { you, opponent, damage, heal, log }
  lastMatch: null, // { spellId, score, fizzled } — your latest recognized draw
  outcome: null, // { won, draw }
  log: [],

  // --- realtime presence (opponent) --------------------------------------
  // head/hands transforms come in the OPPONENT's own local frame; the scene
  // mirrors them across the arena.
  oppPresence: null, // { head:{p,q}, hands:[{p,q,pinch}] }
  oppTrail: null, // { spellId, points:[[x,y,z]...], active }
  oppX: 0, // opponent's lateral offset in THEIR frame (mirrored when drawn)
  oppShield: 0, // what is left of the opponent's shield, in absorb points
  wards: { you: '#7fd4ff', opponent: '#ff8ad4' }, // colour of each side's last ward

  // --- visual effects queue (projectiles, impacts) ------------------------
  fx: [],

  // --- player movement ----------------------------------------------------
  // Mutable and read every frame by the camera rig, the caster and the
  // drivers, so it deliberately lives OUTSIDE reactive state: a lateral
  // position that changes 60x/second must never re-render React.
  move: createMovementState(),

  // --- driver (online socket OR local practice) ---------------------------
  driver: null,

  // ====================== setters used by drivers ========================
  set, // expose raw set for drivers
  pushFx: (spec) => set((s) => ({ fx: [...s.fx, { id: ++fxId, born: performance.now(), ...spec }] })),
  removeFx: (id) => set((s) => ({ fx: s.fx.filter((f) => f.id !== id) })),
  pushLog: (lines) => set((s) => ({ log: [...lines, ...s.log].slice(0, 8) })),

  // ====================== actions from the UI ============================
  setName: (name) => set({ name: name.slice(0, 16) || 'Wizard' }),
  setDifficulty: (difficulty) => set({ difficulty }),
  toggleDeck: (id) => set((s) => {
    if (s.deck.includes(id)) {
      if (s.deck.length <= 3) return {}; // keep at least 3 in the deck
      return { deck: s.deck.filter((d) => d !== id) };
    }
    if (s.deck.length >= 5) return {}; // deck is full
    return { deck: [...s.deck, id] };
  }),

  setInVR: (inVR) => set({ inVR }),

  // opts: { opponentName, carry: { you, opponent } } — carry continues a duel
  // at the given HP (used when an online opponent leaves and the player keeps
  // fighting the AI).
  startPractice: async (opts = {}) => {
    const { driver } = get();
    if (driver) driver.dispose();
    const { PracticeDriver } = await import('./drivers/practice.js');
    const d = new PracticeDriver(get, set, opts);
    set({ driver: d, mode: 'practice', screen: 'game', status: '' });
    d.start();
  },

  startOnline: async (action, code) => {
    const { driver } = get();
    if (driver) driver.dispose();
    const { OnlineDriver } = await import('./drivers/online.js');
    const d = new OnlineDriver(get, set);
    set({
      driver: d, mode: 'online', screen: 'game', phase: 'lobby',
      onlineAction: { action, code }, roomCode: null, queue: null, ping: null, netError: null,
    });
    return d.connect(action, code);
  },

  // Called by the scene when the player finishes drawing a rune.
  // points2d feeds the recognizer; points3d is the world trail (for replaying
  // your own cast as a projectile). drawTime in seconds.
  submitCast: (points2d, drawTime) => {
    const { driver, phase } = get();
    if (!driver || (phase !== 'live' && phase !== 'drawing')) return null;
    return driver.submit(points2d, drawTime);
  },

  // Streamed every frame while the player is moving / drawing.
  sendPresence: (pose) => get().driver?.sendPresence?.(pose),
  sendTrail: (payload) => get().driver?.sendTrail?.(payload),
  sendTrailEnd: (payload) => get().driver?.sendTrailEnd?.(payload),

  rematch: () => get().driver?.rematch?.(),

  leave: () => {
    const { driver } = get();
    if (driver) driver.dispose();
    set({
      driver: null, screen: 'menu', mode: null, phase: 'idle', round: 0,
      hp: { you: 100, opponent: 100 }, resources: { mana: 60, shield: 0, cd: {} },
      options: null, lastResult: null,
      outcome: null, log: [], oppPresence: null, oppTrail: null, oppX: 0, oppShield: 0, fx: [],
      youSubmitted: false, oppSubmitted: false, status: '',
      roomCode: null, queue: null, ping: null, netError: null,
    });
    resetMovement(get().move);
  },
}));

// Convenience selector helpers
export const spellInfo = (id) => SPELLS[id];

// Dev-only: expose the store + rune templates so headless smoke tests can drive
// the game (start a match, feed a known-good glyph, assert the round resolves).
if (typeof window !== 'undefined' && import.meta.env?.DEV) {
  window.__game = useGame;
  window.__templates = TEMPLATES;
}
