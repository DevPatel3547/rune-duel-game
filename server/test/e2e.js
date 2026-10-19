// End-to-end tests for the match server over real sockets. Boots the server,
// then plays it the way clients do: a full room-code duel to the finish, quick
// match pairing, server-side dodging and anti-cheat, resuming after a dropped
// connection, forfeiting after the grace period, and refusing old clients.
// Run: node server/test/e2e.js
import { spawn } from 'node:child_process';
import { io } from 'socket.io-client';
import { TEMPLATES, PROTOCOL_VERSION, judgeCast, computePower, DRAW_TIME } from '@rune/shared';

const PORT = 3107;
const SERVER = `http://localhost:${PORT}`;
const DECK = ['bolt', 'shield', 'vortex', 'pierce', 'leech'];
const ATTACKS = ['bolt', 'pierce', 'vortex'];

const server = spawn('node', ['src/index.js'], {
  cwd: new URL('..', import.meta.url).pathname,
  env: { ...process.env, PORT: String(PORT), RECONNECT_GRACE_MS: '1500', COUNTDOWN_MS: '300', READY_TIMEOUT_MS: '2500' },
});

const sockets = [];
let failures = 0;
const check = (cond, msg) => {
  if (cond) console.log(`  ✓ ${msg}`);
  else { console.error(`  ✗ FAIL: ${msg}`); failures++; }
};
const finish = (code, msg) => {
  console.log(msg);
  sockets.forEach((s) => s.close());
  server.kill('SIGKILL');
  process.exit(code);
};

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
// Test clients report 'ready' as soon as a match opens, as a client that has
// loaded the arena would. autoReady: false plays one that is still loading.
const connect = (auth = { v: PROTOCOL_VERSION }, { autoReady = true } = {}) => {
  const s = io(SERVER, { transports: ['websocket'], auth, reconnection: false, forceNew: true });
  if (autoReady) s.on('match_start', () => s.emit('ready'));
  sockets.push(s);
  return s;
};
const once = (s, event, ms = 8000) => new Promise((resolve, reject) => {
  const t = setTimeout(() => reject(new Error(`timed out waiting for "${event}"`)), ms);
  s.once(event, (d) => { clearTimeout(t); resolve(d); });
});
const call = (s, event, data) => new Promise((resolve) => s.emit(event, data, resolve));
// Resolve with the next 'cast' event made by `side`, ignoring other traffic.
const castBy = (s, side, ms = 4000) => new Promise((resolve, reject) => {
  const t = setTimeout(() => { s.off('events', h); reject(new Error(`timed out waiting for a cast by side ${side}`)); }, ms);
  const h = ({ events }) => {
    const e = events.find((x) => x.type === 'cast' && x.by === side);
    if (e) { clearTimeout(t); s.off('events', h); resolve(e); }
  };
  s.on('events', h);
});
// A stroke that bounces between the four corners: it is not any rune.
const scrawl = Array.from({ length: 64 }, (_, i) => [{ x: 0, y: 0 }, { x: 300, y: 300 }, { x: 300, y: 0 }, { x: 0, y: 300 }][i % 4]);
const ready = (...ss) => Promise.all(ss.map((s) => (s.connected ? null : once(s, 'connect'))));

// Simulate a human drawing: template points scaled to px with a little jitter.
const fakeDraw = (spellId) => TEMPLATES[spellId].map((p) => ({
  x: Math.round(p.x * 300 + 40 + (Math.random() - 0.5) * 8),
  y: Math.round(p.y * 300 + 40 + (Math.random() - 0.5) * 8),
}));

function waitListening() {
  return new Promise((resolve, reject) => {
    const to = setTimeout(() => reject(new Error('server did not start')), 10000);
    const scan = (d) => { if (/listening/i.test(String(d))) { clearTimeout(to); resolve(); } };
    server.stdout.on('data', scan);
    server.stderr.on('data', (d) => { process.stderr.write(d); scan(d); });
  });
}

setTimeout(() => finish(1, '\nE2E TIMEOUT ✗'), 120000).unref();

try {
  await waitListening();

  console.log('\n[Room code — a full duel to the finish]');
  {
    const a = connect(), b = connect();
    await ready(a, b);
    check(!(await call(a, 'create_room', { name: 'Ash', deck: ['bolt', 'bolt', 'bolt'] })).ok, 'an invalid spellbook is refused');
    const created = await call(a, 'create_room', { name: 'Ash', deck: DECK });
    check(created.ok && /^[A-Z2-9]{6}$/.test(created.code) && created.token, 'create_room returns a code and a session token');

    const startA = once(a, 'match_start'), startB = once(b, 'match_start');
    const joined = await call(b, 'join_room', { code: created.code.toLowerCase(), name: 'Mage', deck: DECK });
    check(joined.ok, 'join_room accepts the code case-insensitively');
    const [ma, mb] = await Promise.all([startA, startB]);
    check(ma.side === 0 && mb.side === 1 && ma.opponent.name === 'Mage' && mb.opponent.name === 'Ash',
      'both players get match_start with distinct sides and each other\'s names');
    await Promise.all([once(a, 'live'), once(b, 'live')]);

    const seen = { cast: 0, impact: 0 };
    a.on('events', ({ events }) => events.forEach((e) => { if (e.type in seen) seen[e.type]++; }));
    const caster = (s) => setInterval(() => {
      const id = ATTACKS[Math.floor(Math.random() * ATTACKS.length)];
      s.emit('cast', { spellId: id, points: fakeDraw(id), drawTime: 0.8 });
    }, 400);
    const la = caster(a), lb = caster(b);
    const [ga, gb] = await Promise.all([once(a, 'game_over', 60000), once(b, 'game_over', 60000)]);
    clearInterval(la); clearInterval(lb);
    check(seen.cast > 0 && seen.impact > 0, `clients receive cast and impact events (${seen.cast} casts, ${seen.impact} impacts)`);
    check(ga.draw ? gb.draw : ga.won !== gb.won, `exactly one winner is reported (${ga.won ? 'Ash' : gb.won ? 'Mage' : 'draw'})`);
    check(ga.hp.you === gb.hp.opponent && ga.hp.opponent === gb.hp.you, 'both clients agree on the final hp');
    a.close(); b.close();
  }

  console.log('\n[Quick match]');
  const q1 = connect(), q2 = connect();
  await ready(q1, q2);
  const status = once(q1, 'queue_status');
  check((await call(q1, 'quick_match', { name: 'Quick1', deck: DECK })).ok, 'quick_match is accepted');
  check((await status).searching === 1, 'a lone player is told they are searching');
  const s1 = once(q1, 'match_start'), s2 = once(q2, 'match_start');
  await call(q2, 'quick_match', { name: 'Quick2', deck: ['bolt', 'pierce', 'shield'] });
  const [m1, m2] = await Promise.all([s1, s2]);
  check(m1.side !== m2.side && m1.opponent.name === 'Quick2', 'two searching players are paired into one match');
  await Promise.all([once(q1, 'live'), once(q2, 'live')]);

  console.log('\n[Anti-cheat]');
  {
    const ack = once(q1, 'cast_ack');
    q1.emit('cast', { spellId: 'bolt', points: [{ x: 0, y: 0 }, { x: 1, y: 1 }], drawTime: 0.5 });
    check((await ack).fizzled, 'the server re-recognizes strokes: an invalid stroke fizzles');

    q2.emit('presence', { x: 0 });
    q2.emit('presence', { x: 5 });
    await wait(120);
    const st = await once(q1, 'state');
    check(st.opponent.x < 1, `teleporting is refused: lateral speed is capped (x=${st.opponent.x.toFixed(2)})`);
    await wait(600);

    // The client names 'bolt' and claims a perfect, instant draw, but the
    // stroke is a pierce: the server casts what it recognizes, at the power
    // it computes itself.
    const lied = castBy(q1, m2.side);
    const piercePts = fakeDraw('pierce');
    q2.emit('cast', { spellId: 'bolt', points: piercePts, drawTime: 0.01, accuracy: 1, power: 9 });
    const lie = await lied;
    check(lie.spellId === 'pierce', `the server re-recognizes the stroke and ignores the claimed spell (cast ${lie.spellId})`);
    // No live trail was streamed, so the server scores it at the unobserved draw time.
    const expected = computePower(judgeCast(piercePts, ['bolt', 'pierce', 'shield']).accuracy, DRAW_TIME.UNOBSERVED_S, 'pierce');
    check(Math.abs(lie.power - expected) < 1e-9 && lie.power < computePower(1, 0.01, 'pierce'),
      `claimed accuracy, power and draw time are ignored (power ${lie.power.toFixed(3)} = server's ${expected.toFixed(3)})`);

    const junk = once(q2, 'cast_ack');
    q2.emit('cast', { spellId: 'bolt', points: scrawl, drawTime: 0.5, accuracy: 1 });
    const jr = await junk;
    check(jr.fizzled && jr.spellId === null, 'a stroke that matches no rune in the deck fizzles, whatever spell is claimed');

    // q1 streams its live trail for 1.5 s, then claims it drew the rune in
    // 0.05 s. The server timed the stroke itself.
    const timedCast = castBy(q2, m1.side);
    const t0 = Date.now();
    while (Date.now() - t0 < 1500) { q1.emit('trail', { points: [[0, 0, 0]], active: true }); await wait(45); }
    const vortexPts = fakeDraw('vortex');
    q1.emit('cast', { spellId: 'vortex', points: vortexPts, drawTime: 0.05 });
    q1.emit('trail_end', { points: [] });
    const timed = await timedCast;
    const acc = judgeCast(vortexPts, DECK).accuracy;
    const timedCap = computePower(acc, 1.5, 'vortex'); // drawn for at least 1.5 s
    check(timed.spellId === 'vortex' && timed.power <= timedCap + 1e-9 && timed.power < computePower(acc, 0.05, 'vortex'),
      `draw time comes from the server's clock, not the claim (power ${timed.power.toFixed(3)} ≤ ${timedCap.toFixed(3)} for 1.5 s; the claim would give ${computePower(acc, 0.05, 'vortex').toFixed(3)})`);
    await wait(1500); // let mana recover for the next section
  }

  console.log('\n[Dodging is enforced by the server]');
  {
    const incoming = new Promise((resolve) => {
      const h = ({ events }) => {
        const hit = events.find((e) => e.type === 'impact' && e.by === m1.side);
        if (hit) { q2.off('events', h); resolve(hit); }
      };
      q2.on('events', h);
    });
    q2.emit('presence', { x: 0 });
    await wait(700);
    const launched = once(q1, 'events');
    q1.emit('cast', { spellId: 'bolt', points: fakeDraw('bolt'), drawTime: 0.8 });
    const launch = (await launched).events.find((e) => e.type === 'cast');
    check(launch?.spellId === 'bolt' && Math.abs(launch.aimedX) < 0.5, 'the bolt is aimed where the target stood at launch');
    for (let i = 1; i <= 10; i++) { await wait(80); q2.emit('presence', { x: i * 0.4 }); }
    const hit = await incoming;
    check(hit.dodged && hit.dmg === 0, 'stepping aside mid-flight dodges it');
  }

  console.log('\n[Reconnect]');
  const token = m1.token;
  {
    const dropped = once(q2, 'opponent_disconnected');
    // Kill the transport, as a dead network would. close() would be a
    // deliberate disconnect, which the server rightly treats as leaving.
    q1.io.engine.close();
    check((await dropped).graceMs > 0, 'the opponent is told the other player dropped');
    const back = connect();
    await ready(back);
    const returned = once(q2, 'opponent_reconnected');
    const r = await call(back, 'resume', { token });
    check(r.ok && r.match?.side === m1.side, 'resuming with the session token rejoins the same match');
    await returned;
    check(true, 'the opponent is told the player is back');
    const st = await once(back, 'state');
    check(typeof st.you.hp === 'number', 'the resumed connection receives live state');

    console.log('\n[Forfeit]');
    const over = once(q2, 'game_over', 6000);
    back.io.engine.close();
    const g = await over;
    check(g.won && g.walkover, 'a player who never returns forfeits after the grace period');
    const late = connect();
    await ready(late);
    check(!(await call(late, 'resume', { token })).ok, 'a forfeited session cannot be resumed');
  }

  console.log('\n[Loading handshake]');
  {
    const fast = connect(), slow = connect(undefined, { autoReady: false });
    await ready(fast, slow);
    const opened = Promise.all([once(fast, 'match_start'), once(slow, 'match_start')]);
    await call(fast, 'quick_match', { name: 'Fast', deck: DECK });
    await call(slow, 'quick_match', { name: 'Slow', deck: DECK });
    await opened;
    let early = false;
    const onCountdown = () => { early = true; };
    fast.on('countdown', onCountdown);
    await wait(700);
    fast.off('countdown', onCountdown);
    check(!early, 'the countdown waits while one player is still loading');
    const countdown = once(fast, 'countdown', 2000);
    slow.emit('ready');
    check((await countdown).ms > 0, 'it starts as soon as the last player has loaded');
    await Promise.all([once(fast, 'live'), once(slow, 'live')]);
    fast.disconnect(); slow.disconnect();
  }
  {
    const loaded = connect(), stuck = connect(undefined, { autoReady: false });
    await ready(loaded, stuck);
    const opened = Promise.all([once(loaded, 'match_start'), once(stuck, 'match_start')]);
    await call(loaded, 'quick_match', { name: 'Loaded', deck: DECK });
    await call(stuck, 'quick_match', { name: 'Stuck', deck: DECK });
    await opened;
    const t0 = Date.now();
    await once(loaded, 'countdown', 5000);
    check(Date.now() - t0 >= 2000, `a player who never loads cannot stall the match (${Date.now() - t0} ms)`);
    loaded.disconnect(); stuck.disconnect();
  }

  console.log('\n[Quitting]');
  {
    const x1 = connect(), x2 = connect();
    await ready(x1, x2);
    const started = Promise.all([once(x1, 'match_start'), once(x2, 'match_start')]);
    await call(x1, 'quick_match', { name: 'Quitter', deck: DECK });
    await call(x2, 'quick_match', { name: 'Stayer', deck: DECK });
    await started;
    await Promise.all([once(x1, 'live'), once(x2, 'live')]);
    // Hanging up without sending 'leave' first: a deliberate disconnect must
    // still forfeit at once, not wait out the reconnect grace period (1.5 s here).
    const t0 = Date.now();
    const over = once(x2, 'game_over', 4000);
    x1.disconnect();
    const g = await over;
    check(g.won && g.walkover && Date.now() - t0 < 1000, `a player who quits forfeits immediately (${Date.now() - t0} ms)`);
  }

  console.log('\n[Versioning]');
  {
    const old = connect({ v: PROTOCOL_VERSION - 1 });
    const err = await once(old, 'connect_error');
    check(err.message === 'update_required', 'an outdated client is told to update');
  }

  finish(failures ? 1 : 0, failures ? `\nE2E FAILED ✗ (${failures})` : '\nE2E PASSED ✓ online play: duel, quick match, anti-cheat, dodge, reconnect, forfeit, versioning');
} catch (e) {
  finish(1, `\nE2E ERROR ✗ — ${e.message}`);
}
