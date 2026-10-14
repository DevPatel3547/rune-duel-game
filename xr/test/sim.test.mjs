// Pure, fast tests for the lane-battle simulation (no browser). Deterministic
// checks of the core rules: minions march, melee trades damage, towers defend,
// minions destroy a reached crystal, mana gates casting, and a match can be won.
import { createMatch, step, stepAI, cast, LANE, UNITS } from '../src/lane/sim.js';

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✓ ' + m); } else { fail++; console.error('  ✗ ' + m); } };

// run the sim forward `secs` seconds in fixed steps
const run = (s, secs, fn) => {
  const STEP = 1 / 30;
  for (let t = 0; t < secs; t += STEP) { step(s, STEP); fn?.(s); }
  return s;
};

console.log('\n[Lane sim]');

// 1) summon spends mana and adds the right number of minions
{
  const s = createMatch();
  const mana0 = s.mana.you;
  const r = cast(s, 'you', 'imp');
  ok(r.ok, 'cast imp succeeds with starting mana');
  ok(s.minions.length === UNITS.imp.count, `imp wave spawns ${UNITS.imp.count} minions`);
  ok(s.mana.you === mana0 - UNITS.imp.cost, 'mana is spent by the spell cost');
}

// 2) mana gate: an unaffordable spell is rejected
{
  const s = createMatch();
  s.mana.you = 5;
  const r = cast(s, 'you', 'giant');
  ok(!r.ok && r.reason === 'mana', 'too-expensive spell is blocked (reason: mana)');
  ok(s.minions.length === 0, 'no minion spawned when mana is insufficient');
}

// 3) minions march down the lane
{
  const s = createMatch();
  cast(s, 'you', 'imp');
  const x0 = s.minions[0].x;
  run(s, 2);
  ok(s.minions[0] && s.minions[0].x > x0 + 0.1, 'a free minion advances up the lane');
}

// 4) a minion that reaches the enemy crystal damages it
{
  const s = createMatch();
  s.minions.push({ id: 1, side: 'you', unit: 'giant', x: 0.99, lane: 0, hp: 9999, max: 9999, atk: 30, speed: 0.03, r: 0.5, color: '#fff', engaged: false });
  const before = s.towers.foe.hp;
  run(s, 1);
  ok(s.towers.foe.hp < before, 'a minion at the enemy crystal deals damage to it');
}

// 5) opposing minions fight and at least one dies
{
  const s = createMatch();
  s.minions.push({ id: 1, side: 'you', unit: 'wisp', x: 0.5, lane: 0, hp: 20, max: 32, atk: 11, speed: 0.1, r: 0.2, color: '#fff', engaged: false });
  s.minions.push({ id: 2, side: 'foe', unit: 'brute', x: 0.51, lane: 0, hp: 120, max: 120, atk: 24, speed: 0.05, r: 0.34, color: '#fff', engaged: false });
  run(s, 3);
  ok(s.minions.length < 2, 'when opposing minions clash, the weaker one dies');
}

// 6) fireball with no enemy minions chips the enemy tower
{
  const s = createMatch();
  s.mana.you = 100;
  const before = s.towers.foe.hp;
  cast(s, 'you', 'fireball');
  ok(s.towers.foe.hp < before, 'fireball with no targets chips the enemy crystal');
}

// 7) a full match can be won: spam giants with infinite mana, AI on easy
{
  const s = createMatch();
  let won = false;
  const STEP = 1 / 30;
  for (let t = 0; t < 120 && s.status === 'playing'; t += STEP) {
    s.mana.you = 100; // pretend we always have mana
    if (Math.floor(t * 30) % 30 === 0) cast(s, 'you', 'giant');
    step(s, STEP);
    stepAI(s, STEP, 'easy');
    if (s.status === 'won') won = true;
  }
  ok(won, 'a relentless giant push destroys the enemy crystal (win condition fires)');
}

console.log(`\n${fail === 0 ? 'LANE SIM TESTS PASSED ✓' : `LANE SIM TESTS FAILED ✗ (${fail})`}  (${pass} passed)`);
process.exit(fail === 0 ? 0 : 1);
