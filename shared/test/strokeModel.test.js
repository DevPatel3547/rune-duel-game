// The synthetic hand bots draw with (shared/src/strokeModel.js).
// Run: node shared/test/strokeModel.test.js
import {
  synthStroke, seededRandom, HANDS, TEMPLATES, recognizeAmong, noteTrail, newStrokeTiming, trailEvidence, serverDrawTime,
} from '../src/index.js';

let failures = 0;
const check = (cond, msg) => {
  if (cond) console.log(`  ✓ ${msg}`);
  else { console.error(`  ✗ FAIL: ${msg}`); failures++; }
};
const ids = Object.keys(TEMPLATES);

console.log('\n[Stroke model] synthetic strokes are recognizable, and sloppier at lower skill (SYNTHETIC data):');
const meanAcc = {};
for (const skill of Object.keys(HANDS)) {
  const rng = seededRandom(7);
  let right = 0, n = 0, acc = 0;
  for (const id of ids) {
    for (let k = 0; k < 10; k++) {
      const deck = [id, ...ids.filter((x) => x !== id).sort(() => rng() - 0.5).slice(0, 4)];
      const m = recognizeAmong(synthStroke(id, skill, rng).points, deck);
      n++;
      if (!m.fizzled && m.spellId === id) { right++; acc += m.score; }
    }
  }
  meanAcc[skill] = acc / right;
  check(right / n >= 0.9, `${skill}: ${(100 * right / n).toFixed(1)}% recognized as the intended rune in a 5-rune deck (mean accuracy ${meanAcc[skill].toFixed(2)})`);
}
check(meanAcc.easy < meanAcc.normal && meanAcc.normal < meanAcc.hard, 'higher skill draws cleaner runes');

{
  const rng = seededRandom(3);
  const a = synthStroke('vortex', 'normal', seededRandom(11));
  const b = synthStroke('vortex', 'normal', seededRandom(11));
  check(JSON.stringify(a) === JSON.stringify(b), 'the same seed draws the same stroke');
  check(a.points.every((p, i) => i === 0 || p.t >= a.points[i - 1].t), 'timestamps never go backwards');
  check(Math.abs(a.points.at(-1).t - a.drawTime) < 1e-9 && a.points[0].t === 0, 'the stroke spans exactly its draw time');

  // A bot that streams its stroke as a live trail, the way the server's bots
  // do, is timed by the server like an honest human.
  const { points, drawTime } = synthStroke('bolt', 'hard', rng);
  const timing = newStrokeTiming();
  const t0 = 50_000;
  for (let ms = 0; ms <= drawTime * 1000; ms += 33) {
    const sofar = points.filter((p) => p.t * 1000 <= ms);
    if (sofar.length >= 2) noteTrail(timing, t0 + ms, sofar);
  }
  const castAt = t0 + drawTime * 1000 + 15;
  const ev = trailEvidence(timing, points, castAt);
  check(ev.ok, `a bot's streamed trail is accepted as evidence (coverage ${ev.coverage?.toFixed(2)})`);
  const scored = serverDrawTime(drawTime, timing, castAt, points);
  check(Math.abs(scored - drawTime) < 0.05, `and its draw time is scored as drawn (${scored.toFixed(2)} s for ${drawTime.toFixed(2)} s)`);
}

console.log(failures ? `\nSTROKE MODEL FAILED ✗ (${failures})` : '\nSTROKE MODEL PASSED ✓');
process.exit(failures ? 1 : 0);
