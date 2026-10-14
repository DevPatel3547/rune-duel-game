// Rules of the shared duel simulation — the one engine both practice mode and
// the online server run. Deterministic: time is passed in, never read.
// Run: node shared/test/duel.test.js
import { Duel, DODGE_RADIUS, flightMs } from '../src/duel.js';
import { RT, rtOf, travelMs } from '../src/realtime.js';

let failures = 0;
function check(cond, msg) {
  if (cond) console.log(`  ✓ ${msg}`);
  else { console.error(`  ✗ FAIL: ${msg}`); failures++; }
}

// Step a duel forward in fixed 1/60 s ticks from `from` to `to` (ms), collecting events.
function run(duel, from, to) {
  const out = [];
  for (let t = from; t <= to; t += 1000 / 60) out.push(...duel.step(1 / 60, t));
  return out;
}

console.log('\n[Duel] casting:');
{
  const d = new Duel();
  const r = d.cast(0, 'bolt', { power: 1 }, 0);
  check(r.ok && r.event.kind === 'projectile', 'bolt launches a projectile');
  check(d.sides[0].mana === RT.START_MANA - rtOf('bolt').cost, 'casting spends mana');
  check(d.cast(0, 'bolt', { power: 1 }, 10).block === 'cooldown', 'recasting during cooldown is refused');
  d.sides[1].mana = 0;
  check(d.cast(1, 'pierce', { power: 1 }, 0).block === 'mana', 'casting without mana is refused');
}

console.log('\n[Duel] impact + dodge:');
{
  const d = new Duel();
  d.cast(0, 'bolt', { power: 1 }, 0);
  const early = run(d, 0, travelMs('bolt') - 50);
  check(!early.some((e) => e.type === 'impact'), 'nothing lands before the flight time');
  const later = run(d, travelMs('bolt') - 50 + 1000 / 60, travelMs('bolt') + 100);
  const hit = later.find((e) => e.type === 'impact');
  check(hit && !hit.dodged && hit.dmg > 0 && d.sides[1].hp < 100, `bolt lands and deals damage (${hit?.dmg})`);
}
{
  const d = new Duel();
  d.cast(0, 'bolt', { power: 1 }, 0);
  d.setX(1, DODGE_RADIUS + 0.5); // target steps aside mid-flight
  const hit = run(d, 0, travelMs('bolt') + 100).find((e) => e.type === 'impact');
  check(hit?.dodged && d.sides[1].hp === 100, 'a target that sidesteps far enough takes no damage');
}
{
  const d = new Duel();
  d.setX(1, 3); // already standing to the side when the spell is aimed
  d.cast(0, 'bolt', { power: 1 }, 0);
  const hit = run(d, 0, travelMs('bolt') + 100).find((e) => e.type === 'impact');
  check(hit && !hit.dodged && hit.aimedX === 3, 'spells are aimed at where the target stands at launch');
}
{
  const d = new Duel();
  d.sides[0].mana = 100;
  const r = d.cast(0, 'nova', { power: 1 }, 0);
  check(r.event.kind === 'domain', 'nova casts a domain');
  d.setX(1, 5);
  const hit = run(d, 0, flightMs('nova') + 100).find((e) => e.type === 'impact');
  check(hit && !hit.dodged && hit.dmg > 0, 'a domain cannot be side-stepped');
}
{
  const d = new Duel();
  d.setX(0, 99);
  check(d.x[0] === 5.2, 'lateral position is clamped to the arena');
}

console.log('\n[Duel] self-casts + shields:');
{
  const d = new Duel();
  const r = d.cast(1, 'shield', { power: 1 }, 0);
  check(r.event.kind === 'selfcast' && d.projectiles.length === 0, 'shield is a self-cast, not a projectile');
  d.cast(0, 'bolt', { power: 1 }, 0);
  const hit = run(d, 0, travelMs('bolt') + 100).find((e) => e.type === 'impact');
  check(hit.absorbed > 0, `a raised shield absorbs damage (${hit.absorbed})`);
}

console.log('\n[Duel] match end:');
{
  const d = new Duel();
  d.sides[1].hp = 1;
  d.cast(0, 'pierce', { power: 1 }, 0);
  const evs = run(d, 0, travelMs('pierce') + 100);
  const over = evs.find((e) => e.type === 'over');
  check(over && over.winner === 0 && d.over, 'reducing the opponent to 0 hp ends the match with a winner');
  check(d.cast(0, 'bolt', { power: 1 }, 5000).block === 'over', 'no casting after the match ends');
  check(d.step(1 / 60, 6000).length === 0, 'a finished duel emits no further events');
}
{
  const d = new Duel();
  d.sides[0].hp = 1; d.sides[1].hp = 1;
  d.cast(0, 'pierce', { power: 1 }, 0);
  d.cast(1, 'pierce', { power: 1 }, 0);
  const over = run(d, 0, travelMs('pierce') + 100).find((e) => e.type === 'over');
  check(over && over.winner === null, 'simultaneous knockouts are a draw');
}

console.log(failures === 0 ? '\nDUEL TESTS PASSED ✓\n' : `\n${failures} DUEL TEST(S) FAILED ✗\n`);
process.exit(failures === 0 ? 0 : 1);
