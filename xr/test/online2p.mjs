// Two real browsers play an online duel through the real client and server:
// quick match pairing, a cast from one player landing on the other, the
// opponent's strafe showing up on the other screen, and a forfeit on leave.
// Saves screenshots of the menu, the lobby and a live duel.
// Run: node xr/test/online2p.mjs [outDir]
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import puppeteer from 'puppeteer-core';

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const ROOT = new URL('../..', import.meta.url).pathname;
const OUT = process.argv[2] || new URL('./out/', import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
let failures = 0;
const ok = (c, m) => { if (c) console.log('  ✓ ' + m); else { failures++; console.error('  ✗ ' + m); } };

function waitFor(proc, re, label) {
  return new Promise((res, rej) => {
    const t = setTimeout(() => rej(new Error(`${label} did not start`)), 40000);
    const scan = (d) => { const m = String(d).match(re); if (m) { clearTimeout(t); res(m); } };
    proc.stdout.on('data', scan);
    proc.stderr.on('data', scan);
  });
}

const server = spawn('node', ['src/index.js'], { cwd: ROOT + 'server', env: { ...process.env, PORT: '3001' } });
// Surface anything the server logs as an error — a handler exception would
// otherwise only show up as a client waiting forever.
server.stderr.on('data', (d) => process.stderr.write(`  [server] ${d}`));
// Its own process group: `npm run dev` forks the real vite process, and killing
// only npm would leave vite running and holding the port for the next run.
const vite = spawn('npm', ['run', 'dev'], { cwd: ROOT + 'xr', env: process.env, detached: true });
let browser;
let diagnose = null;

try {
  await waitFor(server, /listening/i, 'match server');
  const [, url] = await waitFor(vite, /(https?:\/\/localhost:\d+)\//, 'vite');

  browser = await puppeteer.launch({
    executablePath: CHROME, headless: 'new',
    // Two WebGL pages share one browser here, and Chrome throttles whichever is
    // in the background — pausing its rAF and starving its socket heartbeats,
    // which no real player with the game on screen experiences.
    args: [
      '--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader', '--no-sandbox',
      '--disable-background-timer-throttling', '--disable-renderer-backgrounding',
      '--disable-backgrounding-occluded-windows',
    ],
  });

  const errors = { A: [], B: [] };
  const open = async (label, viewport) => {
    const ctx = await browser.createBrowserContext();
    const page = await ctx.newPage();
    page.on('pageerror', (e) => errors[label].push(e.message));
    page.on('console', (m) => { if (m.type() === 'error') errors[label].push(m.text()); });
    await page.setViewport(viewport);
    await page.goto(url + '/?q=low', { waitUntil: 'networkidle2', timeout: 60000 });
    await page.waitForFunction('window.__game', { timeout: 30000, polling: 100 });
    return page;
  };

  console.log('\n[Two players, one duel]');
  const A = await open('A', { width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const B = await open('B', { width: 1280, height: 800 });
  await wait(1500);
  await A.screenshot({ path: OUT + 'menu-phone.png' });
  await B.screenshot({ path: OUT + 'menu-desktop.png' });

  // Failure dump covering every stage — matchmaking included, where the socket
  // trace is not installed yet.
  diagnose = async () => {
    for (const [label, p] of [['A', A], ['B', B]]) {
      const d = await p.evaluate(() => {
        const g = window.__game.getState();
        return {
          net: window.__net, phase: g.phase, mode: g.mode, side: g.driver?.side,
          connected: g.driver?.socket?.connected, status: g.status, queue: g.queue,
          netError: g.netError, roomCode: g.roomCode, hp: g.hp, moveX: g.move.x, oppX: g.oppX,
          lastMatch: g.lastMatch, fxSeen: [...(window.__fxSeen || [])],
        };
      }).catch((e) => ({ evalError: e.message }));
      console.error(`  [${label}]`, JSON.stringify(d), 'errors:', JSON.stringify(errors[label]));
    }
  };

  await A.evaluate(() => { const g = window.__game.getState(); g.setName('Ash'); g.startOnline('quick'); });
  await A.waitForFunction(() => window.__game.getState().queue?.online != null, { timeout: 15000, polling: 100 });
  ok(await A.evaluate(() => window.__game.getState().phase === 'lobby'), 'a player searching sits in the lobby');
  await wait(600);
  await A.screenshot({ path: OUT + 'lobby-phone.png' });

  // Count rendered frames on both pages, to tell a stalled renderer from a
  // stalled network.
  const countFrames = (p) => p.evaluate(() => {
    window.__frames = 0;
    const tick = () => { window.__frames++; requestAnimationFrame(tick); };
    requestAnimationFrame(tick);
  });
  await Promise.all([countFrames(A), countFrames(B)]);

  const tPaired = Date.now();
  await B.evaluate(() => { const g = window.__game.getState(); g.setName('Mage'); g.startOnline('quick'); });
  // Generous: a page entering the 3D arena compiles every shader at once, and
  // software rendering on a busy machine can take a long time over it.
  const live = async (p, label) => {
    await p.waitForFunction(() => window.__game.getState().phase === 'live', { timeout: 90000, polling: 100 });
    const frames = await p.evaluate(() => window.__frames);
    console.log(`    ${label} live after ${((Date.now() - tPaired) / 1000).toFixed(1)} s (${frames} frames rendered)`);
  };
  await Promise.all([live(A, 'A'), live(B, 'B')]);
  ok(true, 'quick match pairs the two browsers and the duel goes live');
  // Record every socket event each browser receives, for diagnosis on failure.
  const tap = (p) => p.evaluate(() => {
    // Effects remove themselves when their animation ends, so record each one
    // as it appears rather than hoping to catch it still on screen.
    window.__fxSeen = new Set();
    window.__game.subscribe((s) => s.fx.forEach((f) => window.__fxSeen.add(`${f.kind}/${f.dir || ''}/${f.incoming ? 'in' : ''}`)));
    window.__net = [];
    window.__game.getState().driver.socket.onAny((ev, data) => {
      if (ev === 'state' || ev === 'opponent_presence') return;
      window.__net.push(ev === 'events'
        ? `events:${data.events.map((e) => `${e.type}/${e.kind || ''}/by${e.by}${e.type === 'impact' ? `/dmg${e.dmg}${e.dodged ? '/DODGED' : ''}/aim${e.aimedX}` : ''}`).join(',')}`
        : ev);
    });
  });
  await Promise.all([tap(A), tap(B)]);
  diagnose = async () => {
    for (const [label, p] of [['A', A], ['B', B]]) {
      const d = await p.evaluate(() => {
        const g = window.__game.getState();
        return {
          net: window.__net, phase: g.phase, side: g.driver?.side, hp: g.hp, moveX: g.move.x, oppX: g.oppX,
          lastMatch: g.lastMatch, fxSeen: [...(window.__fxSeen || [])], status: g.status,
        };
      }).catch((e) => ({ evalError: e.message }));
      console.error(`  [${label}]`, JSON.stringify(d), 'errors:', JSON.stringify(errors[label]));
    }
  };
  ok(await A.evaluate(() => window.__game.getState().opponentName) === 'Mage'
    && await B.evaluate(() => window.__game.getState().opponentName) === 'Ash', 'each sees the other\'s name');

  // A draws a Bolt the way the caster would submit it.
  const cast = await A.evaluate(() => {
    const T = window.__templates.bolt;
    const pts = T.map((p) => ({ x: p.x * 300 + 40 + (Math.random() - 0.5) * 6, y: p.y * 300 + 40 + (Math.random() - 0.5) * 6 }));
    return window.__game.getState().submitCast(pts, 0.7);
  });
  ok(cast?.spellId === 'bolt' && !cast.fizzled, 'the drawn rune is recognized as Bolt');
  await B.waitForFunction(() => window.__game.getState().fx.some((f) => f.kind === 'projectile' && f.dir === 'in') || window.__fxSeen.has('projectile/in/'), { timeout: 30000, polling: 100 });
  ok(true, 'the defender sees the projectile coming at them');
  await wait(900);
  await A.screenshot({ path: OUT + 'duel-phone-attacker.png' });
  await B.screenshot({ path: OUT + 'duel-desktop-defender.png' });

  await B.waitForFunction(() => window.__game.getState().hp.you < 100, { timeout: 30000, polling: 100 });
  await A.waitForFunction(() => window.__game.getState().hp.opponent < 100, { timeout: 30000, polling: 100 });
  const [hpB, hpOppA] = await Promise.all([
    B.evaluate(() => window.__game.getState().hp.you),
    A.evaluate(() => window.__game.getState().hp.opponent),
  ]);
  ok(hpB === hpOppA, `both screens agree on the damage (${100 - hpB})`);
  await B.waitForFunction(() => window.__fxSeen.has('number//in'), { timeout: 30000, polling: 100 });
  ok(true, 'the defender gets a floating damage number');

  // B steps aside; A should see the opponent move. Position is set directly
  // (as test:dodge does): movement integrates per rendered frame, and
  // software-rendered headless Chrome manages only a few frames a second.
  await B.evaluate(() => { const m = window.__game.getState().move; m.x = 3; m.vx = 0; });
  await A.waitForFunction(() => Math.abs(window.__game.getState().oppX) > 1, { timeout: 30000, polling: 100 });
  ok(true, `the attacker sees the opponent strafe (x=${(await A.evaluate(() => window.__game.getState().oppX)).toFixed(2)})`);
  await wait(1500);
  await A.screenshot({ path: OUT + 'strafe-phone.png' });

  await B.evaluate(() => window.__game.getState().leave());
  await A.waitForFunction(() => window.__game.getState().outcome?.walkover, { timeout: 30000, polling: 100 });
  ok(await A.evaluate(() => window.__game.getState().outcome.won), 'when one player leaves, the other wins by walkover');
  await wait(500);
  await A.screenshot({ path: OUT + 'walkover-phone.png' });

  // Rendering-backend chatter from SwiftShader, and Vite's dev-only hot reload
  // socket reconnecting — neither exists in a production build.
  const noise = (e) => !/WebGL|GPU stall|swiftshader|Automatic fallback|WebSocket is already in CLOSING/i.test(e);
  ok(!errors.A.filter(noise).length && !errors.B.filter(noise).length,
    `no runtime errors${[...errors.A, ...errors.B].filter(noise).length ? ': ' + [...errors.A, ...errors.B].filter(noise).join(' | ') : ''}`);
} catch (e) {
  failures++;
  console.error('  ✗ ' + e.message);
  await diagnose?.();
} finally {
  await browser?.close();
  server.kill('SIGKILL');
  try { process.kill(-vite.pid, 'SIGKILL'); } catch { vite.kill('SIGKILL'); }
  console.log(failures ? `\nONLINE 2P FAILED ✗ (${failures})` : '\nONLINE 2P PASSED ✓ two browsers dueled live through the real server');
  console.log(`screenshots: ${OUT}`);
  process.exit(failures ? 1 : 0);
}
