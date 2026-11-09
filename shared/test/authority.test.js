// What the match server decides for itself about a cast (shared/src/authority.js).
// Run: node shared/test/authority.test.js
import { TEMPLATES } from '../src/templates.js';
import { SPELLS, computePower } from '../src/spells.js';
import { recognizeAmong } from '../src/recognizer.js';
import {
  judgeCast, serverDrawTime, noteTrail, clearTrail, validStroke, DRAW_TIME, newStrokeTiming, trailEvidence,
} from '../src/authority.js';

let failures = 0;
function check(cond, msg) {
  if (cond) console.log(`  ✓ ${msg}`);
  else { console.error(`  ✗ FAIL: ${msg}`); failures++; }
}

const DECK = ['bolt', 'shield', 'vortex', 'pierce', 'leech'];
const draw = (id) => TEMPLATES[id].map((p, i) => ({ x: p.x * 300 + 40 + ((i * 37) % 7) - 3, y: p.y * 300 + 40 + ((i * 53) % 7) - 3 }));
// A stroke that bounces between the four corners: it is not any rune.
const scrawl = Array.from({ length: 64 }, (_, i) => [{ x: 0, y: 0 }, { x: 300, y: 300 }, { x: 300, y: 0 }, { x: 0, y: 300 }][i % 4]);

console.log('\n[Authority] the server recognizes the spell itself:');
for (const id of DECK) {
  const v = judgeCast(draw(id), DECK);
  check(!v.fizzled && v.spellId === id, `a drawn ${id} is recognized as ${id} within the deck (accuracy ${v.accuracy.toFixed(2)})`);
}
{
  const v = judgeCast(draw('pierce'), ['bolt', 'pierce', 'shield']);
  check(v.spellId === 'pierce', 'what the stroke looks like decides the spell — there is no claimed spell to trust');
  const notInDeck = judgeCast(draw('pierce'), ['bolt', 'shield', 'vortex']);
  check(notInDeck.spellId !== 'pierce', `a rune outside the deck can never be cast (got ${notInDeck.spellId})`);
  const junk = judgeCast(scrawl, DECK);
  check(junk.fizzled && junk.spellId === null, `a stroke that matches no deck rune fizzles (best ${recognizeAmong(scrawl, DECK).score.toFixed(2)})`);
  check(judgeCast([{ x: 0, y: 0 }, { x: 1, y: 1 }], DECK).fizzled, 'a too-short stroke fizzles');
  check(judgeCast(draw('bolt').map((p, i) => (i === 3 ? { x: NaN, y: 0 } : p)), DECK).fizzled, 'a stroke with non-finite points fizzles');
  check(!validStroke(Array.from({ length: 2001 }, (_, i) => ({ x: i, y: i }))), 'an oversized stroke is invalid');
  check(judgeCast(draw('bolt'), []).fizzled, 'an empty deck casts nothing');
}

console.log('\n[Authority] draw time is bounded by what the server watched:');
// The client's own helper: at most `max` evenly spaced points.
const downsample = (pts, max = 96) => (pts.length <= max ? pts
  : Array.from({ length: max }, (_, i) => pts[Math.round((i * (pts.length - 1)) / (max - 1))]));
// A dense stroke along a rune template, as a hand would produce it.
const dense = (id) => {
  const t = TEMPLATES[id];
  const out = [];
  for (let i = 1; i < t.length; i++) {
    for (let k = 0; k < 6; k++) {
      const f = k / 6;
      out.push({ x: (t[i - 1].x + (t[i].x - t[i - 1].x) * f) * 300 + 40, y: (t[i - 1].y + (t[i].y - t[i - 1].y) * f) * 300 + 40 });
    }
  }
  out.push({ x: t[t.length - 1].x * 300 + 40, y: t[t.length - 1].y * 300 + 40 });
  return out;
};
// Stream an honest stroke: one trail every `hz`, each carrying the stroke so
// far, from `t0` for `seconds`. Returns the cast points and the cast time.
function drawHonestly(timing, id, t0, seconds, hz = 30) {
  const full = dense(id);
  const every = 1000 / hz;
  let now = t0;
  for (; now <= t0 + seconds * 1000; now += every) {
    const frac = Math.min(1, (now - t0) / (seconds * 1000) + 0.04);
    noteTrail(timing, now, downsample(full.slice(0, Math.max(2, Math.round(full.length * frac))), 96));
  }
  return { cast: downsample(full, 96), at: t0 + seconds * 1000 + 10 };
}
{
  const t = newStrokeTiming();
  const vortex = downsample(dense('vortex'), 96);
  check(serverDrawTime(0.05, t, 10_000, vortex) === DRAW_TIME.UNOBSERVED_S, `no live trail: a fast claim is scored at ${DRAW_TIME.UNOBSERVED_S}s`);
  check(serverDrawTime(2, t, 10_000, vortex) === 2, 'no live trail: a slower honest claim stands');
  check(serverDrawTime(undefined, t, 10_000, vortex) === DRAW_TIME.UNOBSERVED_S, 'a missing claim uses the unobserved floor');
  check(serverDrawTime(0.05, t, 10_000) === DRAW_TIME.UNOBSERVED_S, 'no cast stroke to check against: the unobserved floor');

  // The exploit this replaced: ONE trail packet just before the cast used to
  // count as a 5 ms "observed" stroke and skip the floor entirely.
  noteTrail(t, 9_995, vortex);
  check(trailEvidence(t, vortex, 10_000).reason === 'single_packet', 'a single trail packet is not evidence');
  check(serverDrawTime(0.01, t, 10_000, vortex) === DRAW_TIME.UNOBSERVED_S,
    `one trail packet 5 ms before the cast no longer bypasses the ${DRAW_TIME.UNOBSERVED_S}s floor`);
  clearTrail(t);

  // Two packets 5 ms apart that "reveal" the whole stroke: faster than a hand.
  noteTrail(t, 9_990, vortex.slice(0, 8));
  noteTrail(t, 9_995, vortex);
  check(trailEvidence(t, vortex, 10_000).reason === 'too_fast', 'a trail that reveals the stroke impossibly fast is rejected');
  check(serverDrawTime(0.01, t, 10_000, vortex) === DRAW_TIME.UNOBSERVED_S, '... and scored at the unobserved floor');
  clearTrail(t);

  // A trail of one shape, then a cast of another.
  const h = drawHonestly(t, 'vortex', 20_000, 1.4);
  const bolt = downsample(dense('bolt'), 96);
  check(trailEvidence(t, bolt, h.at).reason !== 'ok', `a trail for a different stroke is rejected (${trailEvidence(t, bolt, h.at).reason})`);
  check(serverDrawTime(0.05, t, h.at, bolt) === DRAW_TIME.UNOBSERVED_S, '... and scored at the unobserved floor');

  // The same trail, honestly followed by its own cast.
  const ev = trailEvidence(t, h.cast, h.at);
  check(ev.ok, `an honest trail is accepted (coverage ${ev.coverage?.toFixed(2)}, first ${ev.firstCoverage?.toFixed(2)})`);
  const timed = serverDrawTime(0.05, t, h.at, h.cast);
  check(timed >= 1.4 && timed < 1.6, `claiming 0.05s for a stroke the server watched for 1.4s scores ${timed.toFixed(2)}s`);
  check(serverDrawTime(1.7, t, h.at, h.cast) === 1.7, 'an honest claim slightly longer than the observed span stands');
  check(serverDrawTime(99, t, h.at, h.cast) === DRAW_TIME.MAX_S, 'draw time is capped');
  check(computePower(1, serverDrawTime(0.05, t, h.at, h.cast), 'vortex') < computePower(1, 0.05, 'vortex'),
    'the forged fast claim no longer earns the speed bonus');
  check(serverDrawTime(0.05, t, h.at + DRAW_TIME.TRAIL_GAP_MS + 1, h.cast) === DRAW_TIME.UNOBSERVED_S,
    'a stale trail (abandoned stroke) is not used as evidence');
  clearTrail(t);

  // A trail that only began when the stroke was nearly done.
  const late = downsample(dense('vortex'), 96);
  noteTrail(t, 30_000, late.slice(0, 80));
  noteTrail(t, 30_400, late);
  check(trailEvidence(t, late, 30_410).reason === 'start_unseen', 'a trail that missed the start of the stroke is rejected');
  clearTrail(t);

  // Honest players are never charged for speed: a 0.2 s Pierce flick.
  const f = drawHonestly(t, 'pierce', 40_000, 0.2);
  const flick = serverDrawTime(0.2, t, f.at, f.cast);
  check(trailEvidence(t, f.cast, f.at).ok && flick <= 0.26, `an honest 0.2 s flick is scored at ${flick.toFixed(2)}s, not penalised`);

  noteTrail(t, 90_000, f.cast);
  check(t.startAt === 90_000 && t.count === 1, 'a trail after a long silence starts a new stroke');
  clearTrail(t);
  check(t.startAt === 0 && t.lastAt === 0 && t.points === null, 'casting clears the stroke evidence');
  check(serverDrawTime(0, t, 0) >= DRAW_TIME.MIN_S, 'draw time has a floor');
}

console.log(failures ? `\nAUTHORITY FAILED ✗ (${failures})` : '\nAUTHORITY PASSED ✓');
process.exit(failures ? 1 : 0);
