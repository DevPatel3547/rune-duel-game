// Verifies the dodge mechanic end to end: an incoming spell that is out-stepped
// must deal no damage, and the same spell taken standing still must land.
// This is a gameplay rule, not a visual, so it gets a real assertion.
import { spawn } from 'node:child_process';
import puppeteer from 'puppeteer-core';

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const ok = (c, m) => { if (!c) { console.error('  ✗ ' + m); throw new Error(m); } console.log('  ✓ ' + m); };

function waitUrl(p) {
  return new Promise((res, rej) => {
    const t = setTimeout(() => rej(new Error('vite did not start')), 30000);
    const s = (d) => { const m = String(d).match(/(https?:\/\/localhost:\d+)\//); if (m) { clearTimeout(t); res(m[1]); } };
    p.stdout.on('data', s); p.stderr.on('data', s);
  });
}

const vite = spawn('npm', ['run', 'dev'], { cwd: new URL('..', import.meta.url).pathname, env: process.env });
let b;
try {
  const url = await waitUrl(vite);
  b = await puppeteer.launch({
    executablePath: CHROME, headless: 'new',
    args: ['--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader', '--no-sandbox'],
  });
  const page = await b.newPage();
  await page.setViewport({ width: 900, height: 700 });
  // low tier: this asserts game rules, and the mirror floor makes headless
  // rendering slow enough that the fixed-timestep sim crawls
  await page.goto(url + '/?q=low', { waitUntil: 'networkidle2', timeout: 40000 });
  await page.waitForFunction('window.__game', { timeout: 20000 });

  const runTrial = async (dodge) => page.evaluate(async (shouldDodge) => {
    const G = window.__game.getState;
    G().startPractice();
    // the duel goes live after the arena loads and the 3-2-1 finishes
    while (G().phase !== 'live') await new Promise((r) => setTimeout(r, 100));
    const d = G().driver;
    d.aiNextCast = Infinity;          // we drive the cast ourselves
    G().move.x = 0; G().move.vx = 0; G().move.input = 0;
    const hpBefore = G().hp.you;

    // Fire one bolt at the player from the AI, aimed at x = 0.
    d._cast(d.ai, 'opp', 'bolt', 0.9, performance.now());
    await new Promise((r) => setTimeout(r, 120));
    // Step aside (or don't) while it is in flight.
    if (shouldDodge) { G().move.x = 2.6; }
    // Wait until it has actually landed. An impact resolves on the first
    // simulated frame after its arrival time, and through software rendering
    // on a busy machine that frame can be seconds away — a fixed wait races it.
    const t0 = performance.now();
    while (d.projectiles.length && performance.now() - t0 < 30000) {
      await new Promise((r) => setTimeout(r, 100));
    }
    const hpAfter = G().hp.you;
    G().leave();
    return { hpBefore, hpAfter, damage: hpBefore - hpAfter };
  }, dodge);

  const hit = await runTrial(false);
  ok(hit.damage > 0, `standing still takes the hit (${hit.damage} damage)`);

  const miss = await runTrial(true);
  ok(miss.damage === 0, `sidestepping evades it (${miss.damage} damage)`);

  console.log('\nDODGE CHECK PASSED ✓');
} finally {
  await b?.close();
  vite.kill('SIGTERM');
}
