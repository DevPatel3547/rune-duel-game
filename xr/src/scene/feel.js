// Transient combat feedback — the "juice" layer.
//
// Kept in its own tiny store, deliberately OUTSIDE the main game store: these
// values change every single frame, and routing them through `useGame` would
// re-render the React tree 60 times a second. Consumers read it imperatively
// via `useHitFeel.getState()` inside useFrame and mutate refs directly.
//
// One event (a spell landing) feeds several systems at once — camera kick,
// chromatic aberration, bloom overdrive, HUD damage vignette — so they all
// share a single decaying envelope and stay in sync.
import { create } from 'zustand';

export const useHitFeel = create(() => ({
  shake: 0,       // 0..1 camera trauma
  flash: 0,       // 0..1 bloom/exposure punch
  damageVig: 0,   // 0..1 red screen edge (only when YOU are hit)
  hitStop: 0,     // seconds of remaining time dilation
  kick: 0,        // 0..1 forward camera lurch
  pulse: 0,       // 0..1 the arena answering a heavy hit (runes surge, fires flare)
  focus: 0,       // 0..1 the camera tightening on a spectacle cast
}));

const set = useHitFeel.setState;
const get = useHitFeel.getState;

// Call when a spell connects.
//   power    0..1-ish magnitude (damage / 30 works well)
//   incoming true when the local player is the one being hit
export function impactFeel(power = 0.5, incoming = false) {
  const p = Math.max(0, Math.min(1.4, power));
  const s = get();
  set({
    // additive so a flurry of hits compounds, clamped so it never goes silly
    shake: Math.min(1, s.shake + p * (incoming ? 0.85 : 0.42)),
    flash: Math.min(1, s.flash + p * 0.7),
    kick: Math.min(1, s.kick + p * (incoming ? 0.9 : 0.25)),
    damageVig: incoming ? Math.min(1, s.damageVig + p * 0.95) : s.damageVig,
    // The set reacts too. A hit that only moves the camera happens to the
    // player; one that makes the room answer happens in a place.
    pulse: Math.min(1, s.pulse + p * 0.75),
    // hit-stop only for meaningful hits — stopping time on a chip of damage
    // reads as a stutter, not as impact
    hitStop: p > 0.35 ? Math.max(s.hitStop, incoming ? 0.075 : 0.045) : s.hitStop,
  });
}

// A softer version for casting your own spell (muzzle kick).
export function castFeel(power = 0.3) {
  const s = get();
  set({ shake: Math.min(1, s.shake + power * 0.12), kick: Math.min(1, s.kick + power * 0.18) });
}

// A spectacle cast — a domain, a summon, a meteor — pulls the lens in, the way
// a fight is shot when something enormous is about to happen. Rises at once and
// eases out over a couple of seconds, so the push-in carries the whole beat.
export function focusFeel(amount = 1) {
  const s = get();
  set({ focus: Math.min(1, Math.max(s.focus, amount)) });
}

// Advance all envelopes. Called once per frame from a single driver component
// so the decay rate is authoritative and frame-rate independent.
export function decayFeel(dt) {
  const s = get();
  if (!s.shake && !s.flash && !s.damageVig && !s.hitStop && !s.kick && !s.pulse && !s.focus) return;
  const k = (v, rate) => (v > 0.0005 ? v * Math.exp(-rate * dt) : 0);
  set({
    shake: k(s.shake, 7.5),
    flash: k(s.flash, 9.0),
    kick: k(s.kick, 8.0),
    damageVig: k(s.damageVig, 3.2),   // lingers — it's a status read
    pulse: k(s.pulse, 2.6),           // the room settles slowly
    focus: k(s.focus, 1.1),           // and the lens slowest of all
    hitStop: Math.max(0, s.hitStop - dt),
  });
}

export function resetFeel() {
  set({ shake: 0, flash: 0, damageVig: 0, hitStop: 0, kick: 0, pulse: 0, focus: 0 });
}
