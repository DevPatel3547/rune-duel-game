// Quick match never leaves a player waiting forever: after BOT_BACKFILL_MS a
// labelled server bot takes the other seat, draws real strokes (streamed as a
// live trail, then cast and re-recognized like anyone's), and plays the duel.
// Run: node server/test/bots.mjs
import { spawn } from 'node:child_process';
import { io } from 'socket.io-client';
import { PROTOCOL_VERSION } from '@rune/shared';

const PORT = Number(process.env.E2E_PORT) || 20000 + Math.floor(Math.random() * 30000);
const SERVER = `http://localhost:${PORT}`;
const server = spawn(process.execPath, ['src/index.js'], {
  cwd: new URL('..', import.meta.url).pathname,
  env: { ...process.env, PORT: String(PORT), HOST: '127.0.0.1', BOT_BACKFILL_MS: '1500', COUNTDOWN_MS: '200' },
  stdio: ['ignore', 'pipe', 'inherit'],
});
let failures = 0;
const check = (cond, msg) => {
  if (cond) console.log(`  ✓ ${msg}`);
  else { console.error(`  ✗ FAIL: ${msg}`); failures++; }
};
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const once = (s, event, ms = 8000) => new Promise((resolve, reject) => {
  const t = setTimeout(() => reject(new Error(`timed out waiting for "${event}"`)), ms);
  s.once(event, (d) => { clearTimeout(t); resolve(d); });
});
const health = async () => (await fetch(`${SERVER}/health`)).json();

async function main() {
  await new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('server did not start')), 15000);
    server.stdout.on('data', (d) => { if (/listening/i.test(String(d))) { clearTimeout(t); resolve(); } });
  });
  console.log('\n[Bots] quick match backfill:');
  const s = io(SERVER, { transports: ['websocket'], auth: { v: PROTOCOL_VERSION }, reconnection: false, forceNew: true });
  await once(s, 'connect');
  s.on('match_start', () => s.emit('ready'));
  const t0 = Date.now();
  const ack = await new Promise((r) => s.emit('quick_match', { name: 'Lonely', deck: ['bolt', 'shield', 'pierce'] }, r));
  check(ack.ok && ack.botAfterMs === 1500, 'the server says when a bot will step in');
  const m = await once(s, 'match_start', 5000);
  const waited = Date.now() - t0;
  check(m.opponent.bot === true && /^Bot /.test(m.opponent.name), `a labelled bot takes the seat (${m.opponent.name})`);
  check(waited >= 1400 && waited < 3000, `after the backfill delay, not before (${waited} ms)`);
  check(m.ranked === false, 'a bot match is never ranked');
  check((await health()).bots === 1, '/health counts the bot');

  const casts = [];
  let trails = 0;
  s.on('opponent_trail', (d) => { if (Array.isArray(d.points) && d.points.length) trails++; });
  s.on('events', ({ events }) => events.forEach((e) => { if (e.type === 'cast' && e.by !== m.side) casts.push(e); }));
  await once(s, 'live', 5000);
  // Stand still and watch. A human who does nothing loses, which is fine.
  const over = once(s, 'game_over', 25000).catch(() => null);
  await Promise.race([over, wait(15000)]);
  check(casts.length >= 3, `the bot casts on its own (${casts.length} casts: ${[...new Set(casts.map((c) => c.spellId))].join(', ')})`);
  check(casts.every((c) => m.opponent.deck.includes(c.spellId)), 'every bot cast is a rune from its own spellbook');
  check(casts.every((c) => c.power > 0 && c.power <= 1), 'bot power comes from the server\'s scoring (0..1)');
  check(trails >= 5, `the bot is seen drawing each rune live (${trails} trail updates)`);

  s.emit('leave');
  await wait(400);
  check((await health()).bots === 0, 'the bot leaves when the player does');
  s.close();
}

main()
  .catch((err) => { console.error('bots test crashed:', err.message); failures++; })
  .finally(() => {
    server.kill('SIGKILL');
    console.log(failures ? `\nBOTS FAILED ✗ (${failures})` : '\nBOTS PASSED ✓');
    process.exit(failures ? 1 : 0);
  });
