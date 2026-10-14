// Sanity tests: rune confusion matrix + resolution engine.
// Run: node shared/test/run-tests.js

import { TEMPLATES } from '../src/templates.js';
import { recognize, scoreAgainst } from '../src/recognizer.js';
import { resolveRound } from '../src/resolve.js';
import { blankStatus, FIZZLE_THRESHOLD } from '../src/spells.js';

let failures = 0;
function check(cond, msg) {
  if (cond) console.log(`  ✓ ${msg}`);
  else { console.error(`  ✗ FAIL: ${msg}`); failures++; }
}

// --- Recognizer: each rune, jittered, must classify as itself ---
console.log('\n[Recognizer] jittered self-classification (simulating a human hand):');
function jitter(points, magnitude, seed) {
  let s = seed;
  const rand = () => { s = (s * 16807) % 2147483647; return (s / 2147483647) - 0.5; };
  return points.map((p) => ({ x: p.x + rand() * magnitude, y: p.y + rand() * magnitude }));
}

for (const [id, pts] of Object.entries(TEMPLATES)) {
  let ok = 0;
  const trials = 20;
  for (let t = 1; t <= trials; t++) {
    const drawn = jitter(pts, 0.06, t * 7919 + 13);
    const result = recognize(drawn);
    if (result.id === id && result.score >= FIZZLE_THRESHOLD) ok++;
  }
  check(ok >= trials * 0.9, `${id}: ${ok}/${trials} recognized correctly`);
}

console.log('\n[Recognizer] cross-confusion (each rune must NOT score higher as another):');
for (const [id, pts] of Object.entries(TEMPLATES)) {
  const self = scoreAgainst(pts, id);
  let worst = null;
  for (const other of Object.keys(TEMPLATES)) {
    if (other === id) continue;
    const s = scoreAgainst(pts, other);
    if (s >= self) worst = `${other} (${s.toFixed(2)} vs self ${self.toFixed(2)})`;
  }
  check(!worst, `${id}: self-score ${self.toFixed(2)} beats all others${worst ? ' — beaten by ' + worst : ''}`);
}

// --- Resolution engine ---
console.log('\n[Resolve] combat math:');
const S = blankStatus;

let r = resolveRound({ spell: 'bolt', power: 1 }, { spell: 'shield', power: 1 }, S(), S());
check(r.damage.b === 0, `perfect Shield fully absorbs perfect Bolt (dmg=${r.damage.b})`);

r = resolveRound({ spell: 'pierce', power: 1 }, { spell: 'shield', power: 1 }, S(), S());
check(r.damage.b === 20, `Pierce ignores Shield (dmg=${r.damage.b})`);

r = resolveRound({ spell: 'pierce', power: 1 }, { spell: 'reflect', power: 1 }, S(), S());
check(r.damage.a === 16 && r.damage.b === 0, `Reflect bounces Pierce back at 80% (dmgA=${r.damage.a})`);

r = resolveRound({ spell: 'reflect', power: 1 }, { spell: 'reflect', power: 1 }, S(), S());
check(r.damage.a === 0 && r.damage.b === 0, 'double Reflect cancels');

r = resolveRound({ spell: 'reflect', power: 1 }, { spell: 'void', power: 1 }, S(), S());
check(r.damage.a === 10, `Void strips Reflect, raw 10 lands (dmgA=${r.damage.a})`);

r = resolveRound({ spell: 'nova', power: 1 }, { spell: 'quake', power: 1 }, S(), S());
check(r.damage.b === 18, `Quake disrupts Nova to 40% (dmg=${r.damage.b}, expected 18)`);

r = resolveRound({ spell: 'bolt', power: 1 }, { spell: 'bolt', power: 1 }, { ...S(), surge: true }, S());
check(r.damage.b === 50, `Surge doubles Bolt (dmg=${r.damage.b})`);

r = resolveRound({ spell: 'bolt', power: 1 }, { spell: 'bolt', power: 1 }, { ...S(), drained: true }, S());
check(r.damage.b === 18, `Drain cuts Bolt to 70% (dmg=${r.damage.b})`);

r = resolveRound({ spell: 'leech', power: 1 }, { spell: 'bolt', power: 1 }, S(), S());
check(r.heal.a === 8, `Leech heals half of 15 dealt (heal=${r.heal.a})`);

r = resolveRound({ spell: 'vortex', power: 1 }, { spell: 'bolt', power: 1 }, S(), S());
check(r.status.b.slowed === true, 'Vortex slows opponent next round');

r = resolveRound({ spell: 'vortex', power: 1 }, { spell: 'bolt', power: 1 }, S(), { ...S(), anchor: 2 });
check(r.status.b.slowed === false && r.status.b.anchor === 1, 'Anchor blocks slow and ticks down');

r = resolveRound({ spell: null, power: 0 }, { spell: 'bolt', power: 0.8 }, S(), S());
check(r.damage.a === 20 && r.damage.b === 0, `fizzle takes full hit (dmgA=${r.damage.a})`);

r = resolveRound({ spell: 'surge', power: 1 }, { spell: 'bolt', power: 1 }, S(), S());
check(r.status.a.surge === true && r.damage.a === 25, 'Surge charges but eats a free hit');

console.log(failures === 0 ? '\nALL TESTS PASSED ✓\n' : `\n${failures} TEST(S) FAILED ✗\n`);
process.exit(failures === 0 ? 0 : 1);
