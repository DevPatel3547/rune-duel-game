// Captures spell VFX at the exact frames that matter — mid-flight and at the
// peak of the impact — because the general screenshot harness usually samples
// between them and shows an empty arena.
// Usage: node xr/test/vfxshot.mjs <outdir> [spellId]
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import puppeteer from 'puppeteer-core';

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const OUT = process.argv[2];
const SPELL = process.argv[3] || 'bolt';
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
mkdirSync(OUT, { recursive: true });

function waitUrl(p) {
  return new Promise((res, rej) => {
    const t = setTimeout(() => rej(new Error('no vite')), 30000);
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
  const errs = [];
  page.on('pageerror', (e) => errs.push(e.message));
  page.on('console', (m) => m.type() === 'error' && errs.push(m.text()));
  await page.setViewport({ width: 1100, height: 720 });
  await page.goto(url, { waitUntil: 'networkidle2', timeout: 40000 });
  await page.waitForFunction('window.__game', { timeout: 20000 });
  await page.evaluate(() => window.__game.getState().startPractice());
  await page.waitForFunction(() => window.__game.getState().phase === 'live', { timeout: 15000 });
  await page.evaluate(() => {
    const d = window.__game.getState().driver;
    d.aiNextCast = Infinity;
    // Silencing future casts is not enough: a telegraphed cast is already
    // committed and an earlier one may still be in flight, and either will
    // land in the middle of the capture.
    d.pendingCast = null;
    d.projectiles.length = 0;
    // Hold effects open: at software-render frame rates a 520ms burst is a
    // couple of frames and cannot be captured by timing alone.
    // Effects live ~0.5s; under software rendering that is two or three
    // frames, so they are dilated for capture. Raise this to inspect a single
    // moment of an effect in detail.
    window.__vfxSlow = 12;
  });
  await wait(2000);

  // Fire the spell straight from the driver so timing is deterministic.
  await page.evaluate((id) => {
    const d = window.__game.getState().driver;
    d.me.mana = 100;
    d._cast(d.me, 'you', id, 0.95, performance.now());
  }, SPELL);

  // Wait out the flight, THEN sample tightly: the impact burst lives ~520ms,
  // and under software rendering a coarse sweep lands either side of it and
  // shows an empty arena.
  const travel = await page.evaluate(() => {
    const fx = window.__game.getState().fx.find((f) => f.kind === 'projectile');
    return fx ? fx.travel : 1600;
  });
  // Some spells ARE the journey — a summoned construct walks the arena for
  // seconds before it lands — so waiting for the damage misses them entirely.
  // Sample across the whole flight for those, and around the impact otherwise.
  // Match on the spell we actually fired: the AI's own projectiles share the
  // queue, and picking "the first non-number fx" grabs one of those instead.
  const kind = await page.evaluate((id) =>
    (window.__game.getState().fx.find((f) => f.spellId === id && f.kind !== 'number')
      || {}).kind || 'projectile', SPELL);

  if (kind === 'summon' || kind === 'meteor' || kind === 'domain') {
    // A domain runs ~3.7s across four beats; 10 frames at 220ms stops during
    // the cut and never shows the recede.
    const frames = kind === 'domain' ? 22 : 10;
    for (let i = 0; i < frames; i++) {
      await page.screenshot({ path: `${OUT}/${SPELL}-${String(i).padStart(2, '0')}.png` });
      const d = await page.evaluate(() => window.__domainT || null);
      if (d) console.log(`  ${String(i).padStart(2, '0')}  t=${d.t}/${d.total}  collapse=${d.collapse} manifest=${d.manifest} sever=${d.sever} recede=${d.recede}`);
      await wait(220);
    }
  } else {
    await page.waitForFunction(() => {
      const g = window.__game.getState();
      return g.fx.some((f) => f.kind === 'number') || g.hp.opponent < 100;
    }, { timeout: 20000 }).catch(() => {});
    for (let i = 0; i < 8; i++) {
      await page.screenshot({ path: `${OUT}/${SPELL}-${String(i).padStart(2, '0')}.png` });
      await wait(60);
    }
  }
  if (errs.length) console.log('ERRORS:', errs.slice(0, 5));
  console.log('vfx shots written to', OUT);
} finally { await b?.close(); vite.kill('SIGTERM'); }
