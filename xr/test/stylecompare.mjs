// Renders the SAME cast under each VFX treatment and captures matched frames,
// so art directions can be compared instead of described.
//
// Usage: node xr/test/stylecompare.mjs <outdir> [spellId]
//
// Two things make the captures comparable:
//   * the spell is fired straight from the driver, so flight time and impact
//     point are identical across runs;
//   * effects are dilated (`__vfxSlow`) and sampled by GAME state rather than
//     by wall clock, because a screenshot under software rendering costs ~3s —
//     far longer than any effect lives. Sampling on a timer captures whatever
//     happens to be on screen, which is usually nothing.
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import puppeteer from 'puppeteer-core';

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const OUT = process.argv[2];
const SPELL = process.argv[3] || 'bolt';
const STYLES = (process.env.ONLY_STYLE || 'current,anime,ink').split(',');
const SLOW = 14;
const RIBBON_DEBUG = !!process.env.RIBBON_DEBUG;

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
mkdirSync(OUT, { recursive: true });

function waitUrl(p) {
  return new Promise((res, rej) => {
    const t = setTimeout(() => rej(new Error('no vite')), 30000);
    const s = (d) => {
      const m = String(d).match(/(https?:\/\/localhost:\d+)\//);
      if (m) { clearTimeout(t); res(m[1]); }
    };
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

  for (const style of STYLES) {
    const page = await b.newPage();
    const errs = [];
    page.on('pageerror', (e) => errs.push(e.message));
    page.on('console', (m) => m.type() === 'error' && errs.push(m.text()));
    await page.setViewport({ width: 1000, height: 660 });

    // The style is read once when a projectile mounts, so it has to be set
    // before the page's first cast — an init script guarantees that.
    await page.evaluateOnNewDocument((st, slow, dbg) => {
      window.__vfxStyle = st;
      window.__vfxSlow = slow;
      if (dbg) window.__ribbonDebug = true;
    }, style, SLOW, RIBBON_DEBUG);

    await page.goto(url, { waitUntil: 'networkidle2', timeout: 40000 });
    await page.waitForFunction('window.__game', { timeout: 20000 });
    await page.evaluate(() => window.__game.getState().startPractice());
    await page.waitForFunction(() => window.__game.getState().phase === 'live', { timeout: 15000 });
    await page.evaluate(() => {
      const d = window.__game.getState().driver;
      d.aiNextCast = Infinity;
      d.pendingCast = null;
      d.projectiles.length = 0;
    });
    await wait(1200);

    // ---- FLIGHT FRAME -----------------------------------------------------
    // The camera is first-person at the caster, so a spell the PLAYER fires
    // travels straight down the view axis and its entire trail is foreshortened
    // into the projectile — every treatment then looks identical because none
    // of the trail layers are geometrically visible. So the flight frame uses
    // an INCOMING spell that the player then strafes away from: the path runs
    // diagonally across the view and the ribbon, afterimages and speed lines
    // are all side-on.
    await page.evaluate((id, slow) => {
      const d = window.__game.getState().driver;
      d.ai.mana = 100;
      d._cast(d.ai, 'opp', id, 0.95, performance.now());
      window.__game.getState().move.x = 3.0;
      // `__vfxSlow` dilates impact bursts but NOT the flight, which runs on the
      // driver's travel time. A bolt crosses the arena in about a second — less
      // than the cost of one software-rendered screenshot — so the flight is
      // stretched too, with the damage clock kept in step.
      const fx = window.__game.getState().fx.find((f) => f.spellId === id && f.kind === 'projectile');
      if (fx) fx.travel *= slow;
      for (const proj of d.projectiles) {
        proj.impactAt = performance.now() + (proj.impactAt - performance.now()) * slow;
      }
    }, SPELL, SLOW);

    await page.waitForFunction(() => {
      const f = window.__game.getState().fx.find((x) => x.kind === 'projectile');
      return f && (performance.now() - f.born) / f.travel > 0.35;
    }, { timeout: 30000 }).catch(() => {});
    if (RIBBON_DEBUG) {
      const prog = await page.evaluate(() => {
        const f = window.__game.getState().fx.find((x) => x.kind === 'projectile');
        return f ? (performance.now() - f.born) / f.travel : null;
      });
      console.log(`  flight progress=${prog?.toFixed(2)}`);
    }
    await page.screenshot({ path: `${OUT}/${SPELL}-${style}-flight.png` });

    // ---- IMPACT FRAME -----------------------------------------------------
    // Fired by the player at the opponent so the burst lands out in the arena,
    // in full view, rather than on top of the camera.
    await page.evaluate(() => {
      const d = window.__game.getState().driver;
      d.projectiles.length = 0;
      window.__game.setState({ fx: [] });
      window.__game.getState().move.x = 0;
    });
    await wait(800);
    await page.evaluate((id) => {
      const d = window.__game.getState().driver;
      d.me.mana = 100;
      d.me.cd = {};
      d._cast(d.me, 'you', id, 0.95, performance.now());
    }, SPELL);

    await page.waitForFunction(
      () => window.__game.getState().fx.some((f) => f.kind === 'number'),
      { timeout: 40000 },
    ).catch(() => {});
    await page.screenshot({ path: `${OUT}/${SPELL}-${style}-impact.png` });

    console.log(`${style.padEnd(8)} captured${errs.length ? `  ERRORS: ${errs.slice(0, 3).join(' | ')}` : ''}`);
    await page.close();
  }
  console.log('style comparison written to', OUT);
} finally { await b?.close(); vite.kill('SIGTERM'); }
