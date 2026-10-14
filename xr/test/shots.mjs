// Visual QA harness: boots the dev server, drives the game into interesting
// states, and writes PNGs so we can actually LOOK at the graphics instead of
// guessing. Usage: node xr/test/shots.mjs [outDir]
//
// Renders with SwiftShader (software GL) so it works headless on any machine.
// Colors/bloom/composition are faithful; only the framerate is not.
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import puppeteer from 'puppeteer-core';

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const OUT = process.argv[2] || '/tmp/runeshots';
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

mkdirSync(OUT, { recursive: true });

async function waitForUrl(proc) {
  return new Promise((resolve, reject) => {
    const to = setTimeout(() => reject(new Error('vite did not start')), 30000);
    const scan = (d) => {
      const m = String(d).match(/(https?:\/\/localhost:\d+)\//);
      if (m) { clearTimeout(to); resolve(m[1]); }
    };
    proc.stdout.on('data', scan);
    proc.stderr.on('data', scan);
  });
}

const vite = spawn('npm', ['run', 'dev'], { cwd: new URL('..', import.meta.url).pathname, env: process.env });
let browser;
try {
  const url = await waitForUrl(vite);
  browser = await puppeteer.launch({
    executablePath: CHROME, headless: 'new', acceptInsecureCerts: true,
    args: ['--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--use-gl=angle', '--use-angle=swiftshader', '--no-sandbox'],
  });

  for (const vp of [
    { name: 'desktop', width: 1440, height: 900, isMobile: false, hasTouch: false },
    { name: 'phone', width: 390, height: 844, isMobile: true, hasTouch: true },
  ]) {
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
    await page.setViewport(vp);
    await page.goto(url, { waitUntil: 'networkidle2', timeout: 40000 });
    await page.waitForFunction('window.__game', { timeout: 20000 });
    await wait(2500);
    await page.screenshot({ path: `${OUT}/${vp.name}-menu.png` });

    await page.evaluate(() => window.__game.getState().startPractice());
    await page.waitForFunction(() => window.__game.getState().phase === 'live', { timeout: 15000 });
    // silence the AI so we get clean, non-random frames
    await page.evaluate(() => { window.__game.getState().driver.aiNextCast = Infinity; });
    await wait(2500);
    await page.screenshot({ path: `${OUT}/${vp.name}-arena.png` });

    // mid-flight projectile
    await page.evaluate(() => {
      const g = window.__game.getState();
      const t = window.__templates[g.deck[0]];
      g.submitCast(t.map((p) => ({ x: p.x, y: p.y })), 0.9);
    });
    await wait(320);
    await page.screenshot({ path: `${OUT}/${vp.name}-cast.png` });
    await wait(700);
    await page.screenshot({ path: `${OUT}/${vp.name}-impact.png` });

    if (errors.length) console.log(`[${vp.name}] console errors:`, errors.slice(0, 6));
    await page.close();
  }
  console.log('shots written to', OUT);
} finally {
  await browser?.close();
  vite.kill('SIGTERM');
}
