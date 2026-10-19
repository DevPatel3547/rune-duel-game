// $1 Unistroke Recognizer (Wobbrock, Wilson, Li — UW). Reimplemented for Rune Duel.
// Uses bounded rotation invariance (±45°) via golden section search, which keeps
// direction-dependent runes (e.g. Pierce's diagonal vs other lines) distinct.

import { TEMPLATES } from './templates.js';
import { FIZZLE_THRESHOLD } from './spells.js';

const NUM_POINTS = 64;
const SQUARE_SIZE = 250;
const ANGLE_RANGE = (45 * Math.PI) / 180;
const ANGLE_PRECISION = (2 * Math.PI) / 180;
const PHI = 0.5 * (-1 + Math.sqrt(5));
const HALF_DIAGONAL = 0.5 * Math.sqrt(2 * SQUARE_SIZE * SQUARE_SIZE);

function pathLength(pts) {
  let d = 0;
  for (let i = 1; i < pts.length; i++) d += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
  return d;
}

function resample(points, n = NUM_POINTS) {
  const I = pathLength(points) / (n - 1);
  let D = 0;
  const pts = points.map((p) => ({ x: p.x, y: p.y }));
  const out = [{ ...pts[0] }];
  for (let i = 1; i < pts.length; i++) {
    const d = Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
    if (D + d >= I) {
      const qx = pts[i - 1].x + ((I - D) / d) * (pts[i].x - pts[i - 1].x);
      const qy = pts[i - 1].y + ((I - D) / d) * (pts[i].y - pts[i - 1].y);
      const q = { x: qx, y: qy };
      out.push(q);
      pts.splice(i, 0, q);
      D = 0;
    } else {
      D += d;
    }
  }
  while (out.length < n) out.push({ ...out[out.length - 1] });
  return out.slice(0, n);
}

function centroid(pts) {
  let x = 0, y = 0;
  for (const p of pts) { x += p.x; y += p.y; }
  return { x: x / pts.length, y: y / pts.length };
}

function indicativeAngle(pts) {
  const c = centroid(pts);
  return Math.atan2(c.y - pts[0].y, c.x - pts[0].x);
}

function rotateBy(pts, angle) {
  const c = centroid(pts);
  const cos = Math.cos(angle), sin = Math.sin(angle);
  return pts.map((p) => ({
    x: (p.x - c.x) * cos - (p.y - c.y) * sin + c.x,
    y: (p.x - c.x) * sin + (p.y - c.y) * cos + c.y,
  }));
}

function scaleToSquare(pts, size = SQUARE_SIZE) {
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const p of pts) {
    minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
    minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y);
  }
  const w = Math.max(maxX - minX, 1e-6);
  const h = Math.max(maxY - minY, 1e-6);
  return pts.map((p) => ({ x: ((p.x - minX) / w) * size, y: ((p.y - minY) / h) * size }));
}

function translateToOrigin(pts) {
  const c = centroid(pts);
  return pts.map((p) => ({ x: p.x - c.x, y: p.y - c.y }));
}

function pathDistance(a, b) {
  let d = 0;
  for (let i = 0; i < a.length; i++) d += Math.hypot(a[i].x - b[i].x, a[i].y - b[i].y);
  return d / a.length;
}

function distanceAtAngle(pts, template, angle) {
  return pathDistance(rotateBy(pts, angle), template);
}

function distanceAtBestAngle(pts, template) {
  let a = -ANGLE_RANGE, b = ANGLE_RANGE;
  let x1 = PHI * a + (1 - PHI) * b;
  let f1 = distanceAtAngle(pts, template, x1);
  let x2 = (1 - PHI) * a + PHI * b;
  let f2 = distanceAtAngle(pts, template, x2);
  while (Math.abs(b - a) > ANGLE_PRECISION) {
    if (f1 < f2) {
      b = x2; x2 = x1; f2 = f1;
      x1 = PHI * a + (1 - PHI) * b;
      f1 = distanceAtAngle(pts, template, x1);
    } else {
      a = x1; x1 = x2; f1 = f2;
      x2 = (1 - PHI) * a + PHI * b;
      f2 = distanceAtAngle(pts, template, x2);
    }
  }
  return Math.min(f1, f2);
}

export function normalizeStroke(points) {
  if (!points || points.length < 8) return null;
  let pts = resample(points);
  pts = rotateBy(pts, -indicativeAngle(pts));
  pts = scaleToSquare(pts);
  return translateToOrigin(pts);
}

// Preprocess all rune templates once.
const PROCESSED = {};
for (const [id, raw] of Object.entries(TEMPLATES)) {
  PROCESSED[id] = normalizeStroke(raw);
}

// Score a drawn stroke against ONE intended rune. Returns 0..1.
export function scoreAgainst(points, spellId) {
  const stroke = normalizeStroke(points);
  if (!stroke || !PROCESSED[spellId]) return 0;
  const d = distanceAtBestAngle(stroke, PROCESSED[spellId]);
  return Math.max(0, 1 - d / HALF_DIAGONAL);
}

// Classify a stroke against all runes. Returns { id, score } best match.
export function recognize(points) {
  const stroke = normalizeStroke(points);
  if (!stroke) return { id: null, score: 0 };
  let best = { id: null, score: 0 };
  for (const [id, tmpl] of Object.entries(PROCESSED)) {
    const score = Math.max(0, 1 - distanceAtBestAngle(stroke, tmpl) / HALF_DIAGONAL);
    if (score > best.score) best = { id, score };
  }
  return best;
}

// Classify a stroke against a chosen set of runes — a player's spellbook.
// Returns { spellId, score, fizzled }: the closest rune in `ids`, and whether
// even that one is below the fizzle threshold. This is the function both the
// client (instant feedback) and the match server (the copy that counts) run,
// so the two can never disagree about what a drawing meant.
export function recognizeAmong(points, ids) {
  let best = { spellId: null, score: 0 };
  for (const id of ids || []) {
    const s = scoreAgainst(points, id);
    if (s > best.score) best = { spellId: id, score: s };
  }
  best.fizzled = best.score < FIZZLE_THRESHOLD;
  return best;
}
