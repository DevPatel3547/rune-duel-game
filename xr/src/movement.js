// ============================================================================
// PLAYER MOVEMENT — sidestep to dodge.
//
// The duel used to be a shooting gallery: you stood on a mark and traded hits,
// and the only agency was how fast you drew. Being able to move turns an
// incoming spell into a decision.
//
// CONTROL SCHEME (the hard part)
//
// Drawing a rune is a slow, shaped, continuous drag. Strafing is also a drag.
// Putting both on the same surface without rules means every dodge starts a
// half-drawn rune and every rune drifts the player sideways.
//
// The resolution is standard practice for touch games and it is the one thing
// here that must not be got wrong:
//
//   * The screen is split into zones. The lower band is MOVEMENT, everything
//     above it is DRAWING.
//   * A pointer is captured by whichever zone it STARTED in and keeps that role
//     until release, even if it wanders across the boundary. A drag that begins
//     on the move band never becomes a rune, and a rune that strays low never
//     becomes a dodge.
//   * Each pointer is tracked by id, so a finger drawing and a finger strafing
//     coexist — which is exactly how you dodge mid-cast.
//
// Desktop gets A/D and the arrow keys, which have no such ambiguity.
// ============================================================================

// How far the player may stray from the centre mark, in metres. Wide enough
// that dodging is real, tight enough that both duelists stay framed.
//
// These, the move speed and the dodge radius are game rules, so they live in
// the shared duel simulation that the online server also enforces.
import { MOVE_LIMIT, MOVE_SPEED } from '@rune/shared';
export { MOVE_LIMIT, MOVE_SPEED, DODGE_RADIUS, dodged } from '@rune/shared';

// Fraction of the viewport height, measured from the bottom, that acts as the
// movement band.
export const MOVE_BAND = 0.26;

export function createMovementState() {
  return {
    x: 0,          // current lateral offset in metres
    vx: 0,         // velocity, for lean and for smoothing
    input: 0,      // -1..1 desired direction this frame
    // pointerId -> { role: 'move' | 'draw', startX }
    pointers: new Map(),
    keys: new Set(),
  };
}

// Which role a pointer starting at this screen position should take.
export function roleForPoint(clientY, rect) {
  const rel = (clientY - rect.top) / rect.height;
  return rel > 1 - MOVE_BAND ? 'move' : 'draw';
}

// Advance the position. Returns the new x.
export function stepMovement(m, dt) {
  const keyInput = (m.keys.has('right') ? 1 : 0) - (m.keys.has('left') ? 1 : 0);
  const target = Math.max(-1, Math.min(1, m.input + keyInput));

  // Accelerate toward the requested direction rather than snapping, so a
  // sidestep has weight and a released input coasts to a stop.
  const desired = target * MOVE_SPEED;
  const accel = target !== 0 ? 26 : 16;   // decelerate a little softer
  m.vx += (desired - m.vx) * Math.min(1, accel * dt);
  m.x += m.vx * dt;

  if (m.x > MOVE_LIMIT) { m.x = MOVE_LIMIT; m.vx = Math.min(0, m.vx); }
  if (m.x < -MOVE_LIMIT) { m.x = -MOVE_LIMIT; m.vx = Math.max(0, m.vx); }
  return m.x;
}

export function resetMovement(m) {
  m.x = 0; m.vx = 0; m.input = 0;
  m.pointers.clear();
  m.keys.clear();
}
