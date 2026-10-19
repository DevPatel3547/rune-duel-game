// What the match server decides for itself about a cast (shared/src/authority.js).
// Run: node shared/test/authority.test.js
import { TEMPLATES } from '../src/templates.js';
import { SPELLS, computePower } from '../src/spells.js';
import { recognizeAmong } from '../src/recognizer.js';
import { judgeCast, serverDrawTime, noteTrail, clearTrail, validStroke, DRAW_TIME } from '../src/authority.js';

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

console.log('\n[Authority] draw time is bounded by the server\'s clock:');
{
  const t = { startAt: 0, lastAt: 0 };
  check(serverDrawTime(0.05, t, 10_000) === DRAW_TIME.UNOBSERVED_S, `no live trail: a fast claim is scored at ${DRAW_TIME.UNOBSERVED_S}s`);
  check(serverDrawTime(2, t, 10_000) === 2, 'no live trail: a slower honest claim stands');
  check(serverDrawTime(undefined, t, 10_000) === DRAW_TIME.UNOBSERVED_S, 'a missing claim uses the unobserved floor');

  // trails every ~45 ms from 10.0 s to 11.5 s, then the cast arrives
  for (let now = 10_000; now <= 11_500; now += 45) noteTrail(t, now);
  check(t.startAt === 10_000, 'the first live trail starts the server\'s stroke clock');
  const timed = serverDrawTime(0.05, t, 11_520);
  check(Math.abs(timed - 1.52) < 1e-9, `claiming 0.05s for a stroke the server watched for 1.52s scores 1.52s (${timed})`);
  check(serverDrawTime(1.6, t, 11_520) === 1.6, 'an honest claim slightly longer than the observed span stands');
  check(serverDrawTime(99, t, 11_520) === DRAW_TIME.MAX_S, 'draw time is capped');
  const bolt = SPELLS.bolt.targetTime;
  check(computePower(1, serverDrawTime(0.05, t, 11_520), 'bolt') < computePower(1, bolt, 'bolt'),
    'the forged fast claim no longer earns the speed bonus');

  check(serverDrawTime(0.05, t, 11_500 + DRAW_TIME.TRAIL_GAP_MS + 1) === DRAW_TIME.UNOBSERVED_S,
    'a stale trail (abandoned stroke) is not used as evidence');
  noteTrail(t, 20_000);
  check(t.startAt === 20_000, 'a trail after a long silence starts a new stroke');
  clearTrail(t);
  check(t.startAt === 0 && t.lastAt === 0, 'casting clears the stroke clock');
  check(serverDrawTime(0, t, 0) >= DRAW_TIME.MIN_S, 'draw time has a floor');
}

console.log(failures ? `\nAUTHORITY FAILED ✗ (${failures})` : '\nAUTHORITY PASSED ✓');
process.exit(failures ? 1 : 0);
