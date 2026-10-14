// Shared spatial constants for the arena. The local player always stands at the
// world origin facing -Z; the opponent stands across the arena at -Z facing back.

// Duelling distance. Doubled from 9 m so spells have real room to travel and a
// summon has somewhere to march from — at 9 m a construct crossing the arena was
// on top of you before you could read it.
//
// Distance and FIELD OF VIEW are one decision, not two: at 18 m a 52-degree lens
// shrinks the opponent to a smudge. The camera runs a longer lens to compensate
// (see App.jsx / CameraRig), which keeps the figure readable and, as a bonus,
// compresses the arena the way an anime fight is actually shot — long lens, flat
// planes, subject held at a constant size while the world moves behind them.
export const OPP_DIST = 18;

// The camera's resting field of view. Lives here because TWO places set it —
// the <Canvas> initial camera and the rig that rewrites fov every frame — and
// when they disagreed the rig silently won: the arena was authored for 38° and
// played at 52°, so doubling the duelling distance just made the opponent
// small instead of making the space big.
export const BASE_FOV = 38;

export const HEAD_HEIGHT = 1.62;

// Where spells originate / land (world space, the local player's point of view).
export const YOU_CAST = [0, 1.3, -0.7];
export const YOU_CHEST = [0, 1.3, -0.3];
export const OPP_CHEST = [0, 1.32, -OPP_DIST + 0.35];

// Network tick rates (ms).
export const PRESENCE_HZ = 22;
export const TRAIL_HZ = 30;

// Map an opponent-local point (they also stand at origin facing -Z) into THIS
// player's world, so the two face each other across the arena.
export function mirrorPoint([x, y, z]) {
  return [-x, y, -z - OPP_DIST];
}
