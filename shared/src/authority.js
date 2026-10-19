// What the match server decides for itself about a cast, instead of taking the
// client's word for it. Pure functions (time is passed in), so they are unit
// tested in shared/test and run unchanged by server/src/index.js.
//
//  - WHICH spell: the raw stroke is re-recognized against the caster's own
//    spellbook with the same recognizer the client uses. The spell the client
//    names is ignored.
//  - HOW WELL: accuracy is the server's own score of that stroke. Any accuracy
//    or power the client sends is ignored.
//  - HOW FAST: draw time can only be bounded, not measured, because the stroke
//    starts on the client. The server times the stroke itself from the live
//    'trail' updates every client streams while drawing, and never lets the
//    claimed draw time be shorter than that. A cast with no live trail behind
//    it is scored as if drawn at UNOBSERVED_S.

import { recognizeAmong } from './recognizer.js';

export const DRAW_TIME = {
  MIN_S: 0.25,          // no rune is drawn faster than this
  MAX_S: 15,            // longer than this is scored as this
  UNOBSERVED_S: 1.2,    // floor for a cast the server never saw being drawn
  // Trails arrive at ~22-60 Hz while drawing. A longer silence means the
  // previous stroke was abandoned, and the next trail starts a new one.
  TRAIL_GAP_MS: 500,
};

export const MAX_STROKE_POINTS = 2000;

export function validStroke(points) {
  return Array.isArray(points) && points.length >= 8 && points.length <= MAX_STROKE_POINTS
    && points.every((p) => p && Number.isFinite(p.x) && Number.isFinite(p.y));
}

// Track the stroke a player is drawing from their live trail updates.
// `timing` is a per-player { startAt, lastAt } record the caller keeps.
export function noteTrail(timing, now) {
  if (!timing.lastAt || now - timing.lastAt > DRAW_TIME.TRAIL_GAP_MS) timing.startAt = now;
  timing.lastAt = now;
}

export function clearTrail(timing) {
  timing.startAt = 0;
  timing.lastAt = 0;
}

// Seconds the server will score this cast as having taken to draw.
export function serverDrawTime(claimed, timing, now) {
  const n = Number(claimed);
  const claim = Number.isFinite(n) && n > 0 ? n : 0;
  const observed = timing?.startAt && timing.lastAt && now - timing.lastAt <= DRAW_TIME.TRAIL_GAP_MS
    ? (now - timing.startAt) / 1000
    : null;
  const floor = observed ?? DRAW_TIME.UNOBSERVED_S;
  return Math.max(DRAW_TIME.MIN_S, Math.min(DRAW_TIME.MAX_S, Math.max(claim, floor)));
}

// The server's verdict on a cast: { spellId, accuracy, fizzled }. spellId is
// the spell recognized from the stroke among `deck`, never the client's claim.
export function judgeCast(points, deck) {
  if (!validStroke(points)) return { spellId: null, accuracy: 0, fizzled: true };
  const m = recognizeAmong(points, deck);
  return { spellId: m.fizzled ? null : m.spellId, accuracy: m.score, fizzled: m.fizzled };
}
