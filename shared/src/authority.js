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
//    starts on the client. Every client streams live 'trail' updates while
//    drawing, each carrying the stroke so far. The server times those itself
//    and checks them against the stroke that is finally cast: the trail must
//    have watched most of it being drawn, from near its start, along the same
//    path, and no faster than a hand can move. Only then does the watched span
//    bound the draw time. A cast without such evidence (no trail, a single
//    packet, a trail for some other shape) is scored as drawn at UNOBSERVED_S.

import { recognizeAmong } from './recognizer.js';

export const DRAW_TIME = {
  MIN_S: 0.25,          // no rune is drawn faster than this
  MAX_S: 15,            // longer than this is scored as this
  UNOBSERVED_S: 1.2,    // floor for a cast the server never saw being drawn
  // Trails arrive at ~22-60 Hz while drawing. A longer silence means the
  // previous stroke was abandoned, and the next trail starts a new one.
  TRAIL_GAP_MS: 500,
  // Fastest plausible hand, in bounding-box diagonals of path per second. A
  // straight Pierce flicked in 0.1 s is ~10; generous on purpose, so no honest
  // player is ever charged for being quick. Used to charge the parts of a
  // stroke the server did not watch being drawn, and to reject a trail that
  // "reveals" a stroke faster than a hand can move.
  MAX_REL_SPEED: 14,
  // The trail must have watched most of the stroke being drawn ...
  MIN_COVERAGE: 0.6,
  // ... starting near its beginning ...
  MAX_FIRST_COVERAGE: 0.5,
  // ... along the same path the cast claims (mean / worst distance from the
  // trail to the cast stroke, as a fraction of the stroke's size).
  MAX_MEAN_DEVIATION: 0.06,
  MAX_WORST_DEVIATION: 0.2,
};

export const MAX_STROKE_POINTS = 2000;
const MAX_TRAIL_POINTS = 160;

export function validStroke(points) {
  return Array.isArray(points) && points.length >= 8 && points.length <= MAX_STROKE_POINTS
    && points.every((p) => p && Number.isFinite(p.x) && Number.isFinite(p.y));
}

/** @param {{x:number,y:number}[]} pts */
function pathLength(pts) {
  let d = 0;
  for (let i = 1; i < pts.length; i++) d += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
  return d;
}

/** @param {{x:number,y:number}[]} pts */
function diagonal(pts) {
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const p of pts) {
    minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
    minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y);
  }
  return Math.hypot(maxX - minX, maxY - minY);
}

// The 2D points a trail carries, or null when they are missing or malformed.
function trailPoints(points2d) {
  if (!Array.isArray(points2d) || points2d.length < 2 || points2d.length > MAX_TRAIL_POINTS) return null;
  const out = [];
  for (const p of points2d) {
    if (!p || !Number.isFinite(p.x) || !Number.isFinite(p.y)) return null;
    out.push({ x: p.x, y: p.y });
  }
  return out;
}

/**
 * Track the stroke a player is drawing from their live trail updates.
 * `timing` is a per-player record the caller keeps (see newStrokeTiming).
 * `points2d` is the stroke so far, in the recognizer's 2D space.
 */
export function noteTrail(timing, now, points2d) {
  if (!timing.lastAt || now - timing.lastAt > DRAW_TIME.TRAIL_GAP_MS) {
    timing.startAt = now;
    timing.count = 0;
    timing.firstLen = null;
    timing.points = null;
  }
  timing.lastAt = now;
  timing.count = (timing.count || 0) + 1;
  const pts = trailPoints(points2d);
  if (pts) {
    if (timing.firstLen == null) { timing.firstLen = pathLength(pts); timing.firstAt = now; }
    timing.points = pts;
  }
}

export function newStrokeTiming() {
  return { startAt: 0, lastAt: 0, count: 0, firstLen: null, firstAt: 0, points: null };
}

export function clearTrail(timing) {
  Object.assign(timing, newStrokeTiming());
}

// Distance from p to the segment a-b.
function segDist(p, a, b) {
  const dx = b.x - a.x, dy = b.y - a.y;
  const L = dx * dx + dy * dy;
  const t = L ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / L)) : 0;
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

/**
 * Does the trail the server watched agree with the stroke that was cast?
 * Returns { ok, reason, coverage, firstCoverage, span } — `reason` names the
 * first check that failed, for tests and logs.
 */
export function trailEvidence(timing, castPoints, now) {
  const fail = (reason, extra = {}) => ({ ok: false, reason, ...extra });
  if (!timing?.startAt || !timing.lastAt) return fail('no_trail');
  if (now - timing.lastAt > DRAW_TIME.TRAIL_GAP_MS) return fail('stale');
  if ((timing.count || 0) < 2) return fail('single_packet');
  if (!timing.points || timing.firstLen == null) return fail('no_points');
  if (!validStroke(castPoints)) return fail('bad_stroke');

  const castLen = pathLength(castPoints);
  const diag = diagonal(castPoints);
  if (!(castLen > 0) || !(diag > 0)) return fail('degenerate');

  const trail = timing.points;
  const coverage = pathLength(trail) / castLen;
  const firstCoverage = timing.firstLen / castLen;
  const span = (now - timing.startAt) / 1000;
  const info = { coverage, firstCoverage, span };
  if (coverage < DRAW_TIME.MIN_COVERAGE) return fail('low_coverage', info);
  if (firstCoverage > DRAW_TIME.MAX_FIRST_COVERAGE) return fail('start_unseen', info);

  // Every trail point must lie on the cast stroke.
  let sum = 0, worst = 0;
  for (const p of trail) {
    let best = Infinity;
    for (let i = 1; i < castPoints.length; i++) best = Math.min(best, segDist(p, castPoints[i - 1], castPoints[i]));
    sum += best; worst = Math.max(worst, best);
  }
  const mean = sum / trail.length / diag;
  if (mean > DRAW_TIME.MAX_MEAN_DEVIATION || worst / diag > DRAW_TIME.MAX_WORST_DEVIATION) {
    return fail('path_mismatch', { ...info, mean, worst: worst / diag });
  }

  // The part of the stroke revealed while the server watched cannot have
  // appeared faster than a hand moves.
  const watchedS = Math.max(1e-3, (timing.lastAt - (timing.firstAt || timing.startAt)) / 1000);
  const revealed = Math.max(0, coverage - firstCoverage) * castLen / diag;
  if (revealed / watchedS > DRAW_TIME.MAX_REL_SPEED * 1.5) return fail('too_fast', { ...info, revealRate: revealed / watchedS });
  return { ok: true, reason: 'ok', ...info };
}

/**
 * Seconds the server will score this cast as having taken to draw.
 * Never shorter than the evidence allows:
 *  - with credible trail evidence: the span it watched, plus the unwatched
 *    start and end of the stroke at the fastest plausible hand speed;
 *  - without it (no trail, one packet, a trail that does not match the cast,
 *    or one that appeared impossibly fast): UNOBSERVED_S.
 * An honest claim longer than the floor always stands.
 */
export function serverDrawTime(claimed, timing, now, castPoints) {
  const n = Number(claimed);
  const claim = Number.isFinite(n) && n > 0 ? n : 0;
  let floor = DRAW_TIME.UNOBSERVED_S;
  if (castPoints) {
    const ev = trailEvidence(timing, castPoints, now);
    if (ev.ok) {
      const rel = pathLength(castPoints) / diagonal(castPoints);
      const unwatched = (ev.firstCoverage + Math.max(0, 1 - ev.coverage)) * rel;
      floor = ev.span + unwatched / DRAW_TIME.MAX_REL_SPEED;
    }
  }
  return Math.max(DRAW_TIME.MIN_S, Math.min(DRAW_TIME.MAX_S, Math.max(claim, floor)));
}

// The server's verdict on a cast: { spellId, accuracy, fizzled }. spellId is
// the spell recognized from the stroke among `deck`, never the client's claim.
export function judgeCast(points, deck) {
  if (!validStroke(points)) return { spellId: null, accuracy: 0, fizzled: true };
  const m = recognizeAmong(points, deck);
  return { spellId: m.fizzled ? null : m.spellId, accuracy: m.score, fizzled: m.fizzled };
}
