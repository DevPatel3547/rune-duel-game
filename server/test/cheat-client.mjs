// A deliberately malicious client. It boots the real match server, joins a
// private room against a passive opponent, and tries each forgery a modified
// client could send. Every attack has an expected server response; the script
// prints a markdown table of what happened and exits non-zero if any attack
// got through.
//
// Run: node server/test/cheat-client.mjs   (add --markdown for the table only)
import { spawn } from 'node:child_process';
import { io } from 'socket.io-client';
import { TEMPLATES, PROTOCOL_VERSION, SPELLS, DRAW_TIME, judgeCast } from '@rune/shared';

const PORT = Number(process.env.E2E_PORT) || 20000 + Math.floor(Math.random() * 30000);
const SERVER = `http://localhost:${PORT}`;
const DECK = ['bolt', 'vortex', 'pierce', 'leech', 'drain'];
const MARKDOWN_ONLY = process.argv.includes('--markdown');
const log = (...a) => { if (!MARKDOWN_ONLY) console.log(...a); };

const server = spawn(process.execPath, ['src/index.js'], {
  cwd: new URL('..', import.meta.url).pathname,
  env: { ...process.env, PORT: String(PORT), HOST: '127.0.0.1', COUNTDOWN_MS: '200', BOT_BACKFILL_MS: '0', LOG_LEVEL: 'error' },
  stdio: ['ignore', 'pipe', 'inherit'],
});
const sockets = [];
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const once = (s, event, ms = 8000) => new Promise((resolve, reject) => {
  const t = setTimeout(() => reject(new Error(`timed out waiting for "${event}"`)), ms);
  s.once(event, (d) => { clearTimeout(t); resolve(d); });
});
const call = (s, event, data) => new Promise((resolve) => s.emit(event, data, resolve));
const connect = () => {
  const s = io(SERVER, { transports: ['websocket'], auth: { v: PROTOCOL_VERSION }, reconnection: false, forceNew: true });
  s.on('match_start', () => s.emit('ready'));
  sockets.push(s);
  return s;
};
// The next thing the server says about a cast by `side`: a cast event, or an ack.
const outcome = (attacker, watcher, side, ms = 3000) => new Promise((resolve) => {
  const done = (v) => { clearTimeout(t); watcher.off('events', h); attacker.off('cast_ack', a); resolve(v); };
  const t = setTimeout(() => done({ none: true }), ms);
  const h = ({ events }) => { const e = events.find((x) => x.type === 'cast' && x.by === side); if (e) done({ cast: e }); };
  const a = (ack) => done({ ack });
  watcher.on('events', h);
  attacker.on('cast_ack', a);
});
// A dense stroke along a template, in the client's recognizer space.
const stroke = (id) => {
  const t = TEMPLATES[id];
  const out = [];
  for (let i = 1; i < t.length; i++) {
    for (let k = 0; k < 4; k++) {
      const f = k / 4;
      out.push({ x: (t[i - 1].x + (t[i].x - t[i - 1].x) * f) * 300 + 40, y: (t[i - 1].y + (t[i].y - t[i - 1].y) * f) * 300 + 40 });
    }
  }
  out.push({ x: t.at(-1).x * 300 + 40, y: t.at(-1).y * 300 + 40 });
  return out.length > 96 ? Array.from({ length: 96 }, (_, i) => out[Math.round((i * (out.length - 1)) / 95)]) : out;
};
// The draw time the server must have used, recovered from the power it
// announced: power = accuracy * 0.6 + min(1, target / time) * 0.4.
const scoredTime = (e, points) => {
  const acc = judgeCast(points, DECK).accuracy;
  const speed = (e.power - acc * 0.6) / 0.4;
  return speed >= 0.999 ? `≤ ${SPELLS[e.spellId].targetTime}` : SPELLS[e.spellId].targetTime / speed;
};
const fmt = (t) => (typeof t === 'number' ? `${t.toFixed(2)} s` : `${t} s`);

const rows = [];
let failures = 0;
function record(attack, expected, got, pass) {
  rows.push({ attack, expected, got, pass });
  if (!pass) failures++;
  log(`  ${pass ? '✓' : '✗ FAIL:'} ${attack} — ${got}`);
}

function waitListening() {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('server did not start')), 15000);
    server.stdout.on('data', (d) => { if (/listening/i.test(String(d))) { clearTimeout(t); resolve(); } });
  });
}

async function main() {
  await waitListening();
  const cheat = connect();
  const victim = connect();
  await Promise.all([once(cheat, 'connect'), once(victim, 'connect')]);
  const made = await call(cheat, 'create_room', { name: 'Cheater', deck: DECK });
  const started = Promise.all([once(cheat, 'match_start'), once(victim, 'match_start')]);
  await call(victim, 'join_room', { name: 'Victim', deck: ['bolt', 'pierce', 'vortex'], code: made.code });
  const [mc] = await started;
  await Promise.all([once(cheat, 'live'), once(victim, 'live')]);
  const side = mc.side;
  log('\n[Cheat client] each forgery against the real match server:');

  // Between attacks the victim sidesteps every incoming spell, so the duel
  // lasts long enough to try them all, and mana and cooldowns recover.
  let vx = 2.5;
  victim.emit('presence', { x: vx });
  const rest = async () => {
    const to = -vx;
    for (let i = 1; i <= 10; i++) { await wait(60); victim.emit('presence', { x: vx + ((to - vx) * i) / 10 }); }
    vx = to;
    await wait(1500);
  };
  await wait(900);

  { // 1. Name one spell, draw another, claim perfection.
    const pts = stroke('pierce');
    const r = outcome(cheat, victim, side);
    cheat.emit('cast', { spellId: 'bolt', points: pts, drawTime: 0.01, accuracy: 1, power: 9 });
    const { cast } = await r;
    record('Claim "bolt" with accuracy 1, power 9; draw a pierce', 'the server casts what it recognizes, at its own power',
      cast ? `cast ${cast.spellId} at power ${cast.power.toFixed(2)}` : 'no cast', cast?.spellId === 'pierce' && cast.power <= 1);
    await rest();
  }
  { // 2. No trail at all, claim an instant draw.
    const pts = stroke('bolt');
    const r = outcome(cheat, victim, side);
    cheat.emit('cast', { points: pts, drawTime: 0.01 });
    const { cast } = await r;
    const t = cast && scoredTime(cast, pts);
    record('Cast with no live trail, claim 0.01 s', `scored at ≥ ${DRAW_TIME.UNOBSERVED_S} s`,
      cast ? `scored at ${fmt(t)}` : 'no cast', typeof t === 'number' && t >= DRAW_TIME.UNOBSERVED_S - 0.02);
    await rest();
  }
  { // 3. The 0.1.0 hole: one trail packet 5 ms before the cast.
    const pts = stroke('pierce');
    const r = outcome(cheat, victim, side);
    cheat.emit('trail', { points: [[0, 0, 0]], points2d: pts, active: true });
    await wait(5);
    cheat.emit('cast', { points: pts, drawTime: 0.01 });
    const { cast } = await r;
    const t = cast && scoredTime(cast, pts);
    record('One trail packet 5 ms before the cast, claim 0.01 s (worked in 0.1.0: scored 0.25 s)', `scored at ≥ ${DRAW_TIME.UNOBSERVED_S} s`,
      cast ? `scored at ${fmt(t)}` : 'no cast', typeof t === 'number' && t >= DRAW_TIME.UNOBSERVED_S - 0.02);
    cheat.emit('trail_end', {});
    await rest();
  }
  { // 4. Two packets that reveal the whole stroke 10 ms apart.
    const pts = stroke('bolt');
    const r = outcome(cheat, victim, side);
    cheat.emit('trail', { points2d: pts.slice(0, 4), active: true });
    await wait(10);
    cheat.emit('trail', { points2d: pts, active: true });
    cheat.emit('cast', { points: pts, drawTime: 0.01 });
    const { cast } = await r;
    const t = cast && scoredTime(cast, pts);
    record('Trail that "reveals" the whole stroke in 10 ms, claim 0.01 s', `scored at ≥ ${DRAW_TIME.UNOBSERVED_S} s`,
      cast ? `scored at ${fmt(t)}` : 'no cast', typeof t === 'number' && t >= DRAW_TIME.UNOBSERVED_S - 0.02);
    cheat.emit('trail_end', {});
    await rest();
  }
  { // 5. Stream a genuine-looking trail of one rune, cast a different one.
    const decoy = stroke('vortex');
    const pts = stroke('pierce');
    const r = outcome(cheat, victim, side);
    for (let i = 1; i <= 8; i++) {
      cheat.emit('trail', { points2d: decoy.slice(0, Math.ceil((decoy.length * i) / 8)), active: true });
      await wait(40);
    }
    cheat.emit('cast', { points: pts, drawTime: 0.01 });
    const { cast } = await r;
    const t = cast && scoredTime(cast, pts);
    record('Stream a trail of a different rune, then cast, claim 0.01 s', `scored at ≥ ${DRAW_TIME.UNOBSERVED_S} s`,
      cast ? `cast ${cast.spellId}, scored at ${fmt(t)}` : 'no cast', typeof t === 'number' && t >= DRAW_TIME.UNOBSERVED_S - 0.02);
    cheat.emit('trail_end', {});
    await rest();
  }
  { // 6. A scripted perfect stroke streamed over 1.0 s: it cannot beat the clock.
    const pts = stroke('bolt');
    const r = outcome(cheat, victim, side, 5000);
    const t0 = Date.now();
    while (Date.now() - t0 < 1000) {
      const frac = Math.min(1, (Date.now() - t0) / 1000 + 0.05);
      cheat.emit('trail', { points2d: pts.slice(0, Math.max(2, Math.ceil(pts.length * frac))), active: true });
      await wait(33);
    }
    cheat.emit('cast', { points: pts, drawTime: 0.01 });
    const { cast } = await r;
    const t = cast && scoredTime(cast, pts);
    record('Script a perfect stroke, stream it over 1.0 s, claim 0.01 s', 'scored at ≥ the 1.0 s the server watched',
      cast ? `scored at ${fmt(t)}` : 'no cast', typeof t === 'number' && t >= 0.98);
    cheat.emit('trail_end', {});
    await rest();
  }
  { // 7. A rune that is not in the spellbook.
    const pts = stroke('nova');
    const r = outcome(cheat, victim, side);
    cheat.emit('cast', { spellId: 'nova', points: pts, drawTime: 0.5 });
    const res = await r;
    const got = res.cast ? `cast ${res.cast.spellId}` : res.ack?.fizzled ? 'fizzled' : 'nothing';
    record('Cast Nova, which is not in the spellbook', 'never cast as nova', got, res.cast?.spellId !== 'nova');
    await rest();
  }
  { // 8. Teleport out of the way.
    cheat.emit('presence', { x: 0 });
    cheat.emit('presence', { x: 5 });
    await wait(150);
    const st = await once(victim, 'state');
    record('Teleport sideways 5 m in one update', 'movement capped to run speed',
      `opponent seen at x = ${st.opponent.x.toFixed(2)}`, st.opponent.x < 1);
  }
  { // 9. Smuggle arbitrary data to the opponent through a relay.
    const got = once(victim, 'opponent_trail', 3000).catch(() => null);
    cheat.emit('trail', { points: [[0, 1, 0]], active: true, html: '<img src=x onerror=alert(1)>', points2d: stroke('bolt') });
    const relayed = await got;
    const keys = relayed ? Object.keys(relayed).sort().join(', ') : 'nothing';
    record('Add extra fields to a relayed trail', 'only checked fields reach the opponent', `opponent received: ${keys}`,
      !!relayed && !('html' in relayed) && !('points2d' in relayed));
  }

  const table = [
    '| Attack | Expected | What the server did | |',
    '|---|---|---|---|',
    ...rows.map((r) => `| ${r.attack} | ${r.expected} | ${r.got} | ${r.pass ? 'blocked' : '**GOT THROUGH**'} |`),
  ].join('\n');
  if (MARKDOWN_ONLY) console.log(table);
  else console.log(`\n${table}\n\n${failures ? `CHEAT CLIENT: ${failures} attack(s) got through ✗` : 'CHEAT CLIENT: every attack was refused ✓'}`);
}

main()
  .catch((err) => { console.error('cheat client crashed:', err.message); failures++; })
  .finally(() => {
    sockets.forEach((s) => s.close());
    server.kill('SIGKILL');
    process.exit(failures ? 1 : 0);
  });
