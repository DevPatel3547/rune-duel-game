// A model of a human hand drawing a rune, for bots and tests.
//
// Bots in Rune Duel do not get to name a spell and a score: they produce a
// stroke, the stroke goes through the same recognizer and the same anti-cheat
// checks as a human's, and they get whatever that stroke earns. That only
// means something if the stroke looks like a hand made it, so this adds the
// ways real strokes differ from a template: an uneven aspect and slant, a slow
// wobble along the path, fine tremor, and a speed profile that starts and
// ends slowly. Skill sets how much of each, and how fast.
import { TEMPLATES } from './templates.js';
import { SPELLS } from './spells.js';

/** @typedef {{ x: number, y: number, t: number }} TimedPoint */

/**
 * Per-skill hand: noise amplitudes (fractions of the rune's size) and draw
 * speed as a multiple of the spell's target time.
 * @type {Record<string, { rot: number, aspect: number, shear: number, wobble: number, tremor: number, speed: [number, number] }>}
 */
export const HANDS = {
  easy:   { rot: 0.45, aspect: 0.35, shear: 0.35, wobble: 0.16, tremor: 0.03, speed: [1.6, 2.4] },
  normal: { rot: 0.25, aspect: 0.22, shear: 0.22, wobble: 0.09, tremor: 0.015, speed: [1.1, 1.6] },
  hard:   { rot: 0.12, aspect: 0.1, shear: 0.1, wobble: 0.04, tremor: 0.006, speed: [0.85, 1.15] },
};

/** Deterministic PRNG (mulberry32), for reproducible tests. */
export function seededRandom(seed = 1) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Points evenly spaced by arc length along a polyline.
function resampleByLength(pts, n) {
  const seg = [];
  let total = 0;
  for (let i = 1; i < pts.length; i++) {
    const d = Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
    seg.push(d);
    total += d;
  }
  const out = [];
  let i = 0, acc = 0;
  for (let k = 0; k < n; k++) {
    const target = (total * k) / (n - 1);
    while (i < seg.length - 1 && acc + seg[i] < target) { acc += seg[i]; i++; }
    const f = seg[i] ? Math.min(1, (target - acc) / seg[i]) : 0;
    out.push({ x: pts[i].x + (pts[i + 1].x - pts[i].x) * f, y: pts[i].y + (pts[i + 1].y - pts[i].y) * f });
  }
  return out;
}

/**
 * Draw `spellId` the way a hand of the given skill would.
 * @param {string} spellId
 * @param {'easy'|'normal'|'hard'} [skill]
 * @param {() => number} [rng]
 * @param {{ size?: number, points?: number }} [opts]
 * @returns {{ points: TimedPoint[], drawTime: number }} points in pixels, t in seconds from the first point
 */
export function synthStroke(spellId, skill = 'normal', rng = Math.random, { size = 260, points = 72 } = {}) {
  const template = TEMPLATES[spellId];
  if (!template) throw new Error(`unknown rune: ${spellId}`);
  const hand = HANDS[skill] || HANDS.normal;
  const r = (amp) => (rng() * 2 - 1) * amp;

  const rot = r(hand.rot);
  const sx = 1 + r(hand.aspect), sy = 1 + r(hand.aspect), sh = r(hand.shear);
  const cos = Math.cos(rot), sin = Math.sin(rot);
  const ph1 = rng() * Math.PI * 2, ph2 = rng() * Math.PI * 2;
  const w1 = r(hand.wobble), w2 = r(hand.wobble);

  const base = resampleByLength(template, points);
  const drawTime = SPELLS[spellId].targetTime * (hand.speed[0] + rng() * (hand.speed[1] - hand.speed[0]));
  const out = base.map((p, i) => {
    const u = i / (points - 1);
    let x = (p.x - 0.5) * sx + (p.y - 0.5) * sh;
    let y = (p.y - 0.5) * sy;
    [x, y] = [x * cos - y * sin, x * sin + y * cos];
    // slow wobble across the whole stroke, plus fine tremor
    x += w1 * Math.sin(u * Math.PI * 2 + ph1) + r(hand.tremor);
    y += w2 * Math.sin(u * Math.PI * 3 + ph2) + r(hand.tremor);
    // ease in and out: the pen accelerates away from the start and slows
    // into the end, so equal path steps take unequal time
    const t = drawTime * (u < 0.5 ? Math.sqrt(u / 2) : 1 - Math.sqrt((1 - u) / 2));
    return { x: (x + 0.5) * size + 40, y: (y + 0.5) * size + 40, t };
  });
  return { points: out, drawTime };
}
