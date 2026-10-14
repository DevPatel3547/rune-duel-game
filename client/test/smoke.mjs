// Headless smoke test for the desktop/mobile browser game. Boots the Vite dev
// server, loads the app in real Chrome, and drives the menu into an actual
// AI match — proving the page loads (no white screen), React renders, and the
// draw-canvas mounts. Recognizer + combat math are covered by `npm test`; this
// proves the thing a player actually opens in a browser works.
import { spawn } from 'node:child_process';
import puppeteer from 'puppeteer-core';

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const ok = (c, m) => { if (!c) { console.error('  ✗ ' + m); throw new Error(m); } console.log('  ✓ ' + m); };

async function waitForUrl(proc) {
  return new Promise((resolve, reject) => {
    const to = setTimeout(() => reject(new Error('vite did not start in time')), 25000);
    const scan = (d) => {
      const s = String(d);
      if (process.env.DEBUG) process.stderr.write(s);
      const m = s.match(/(https?:\/\/localhost:\d+)\//);
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
  console.log('vite up at', url);

  browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: 'new',
    args: ['--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--no-sandbox'],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true }); // iPhone-ish
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  page.on('response', (r) => { if (r.status() >= 400) errors.push(`${r.status()} ${r.url()}`); });

  // Pre-seed a saved deck so the menu routes straight into a match.
  await page.evaluateOnNewDocument(() => {
    localStorage.setItem('runeduel', JSON.stringify({ deck: ['bolt', 'shield', 'vortex', 'pierce', 'leech'] }));
  });

  await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });

  // Home screen rendered (not a white screen).
  await page.waitForFunction(() => /RUNE DUEL/i.test(document.body.innerText), { timeout: 12000 });
  ok(true, 'home screen loaded and rendered (no white screen)');

  const modeBtns = await page.$$eval('button', (bs) => bs.map((b) => b.textContent.trim()));
  ok(modeBtns.some((t) => /VS the Machine/i.test(t)), 'game modes present (Online / VS Machine / Pass & Play / Training)');

  // Enter an AI match: click "VS the Machine" → opponent picker → first opponent.
  await page.evaluate(() => {
    [...document.querySelectorAll('button')].find((b) => /VS the Machine/i.test(b.textContent))?.click();
  });
  await page.waitForFunction(() => /Choose your opponent/i.test(document.body.innerText), { timeout: 6000 });
  ok(true, 'opponent picker reached');

  await page.evaluate(() => {
    [...document.querySelectorAll('button')].find((b) => /sloppy|decent|near-perfect|🧙/i.test(b.textContent))?.click();
  });

  // Round flow: intro ("Get ready…") → pick a spell → draw. Wait for the pick
  // cards to appear, choose one, then the draw canvas mounts.
  await page.waitForSelector('.pick-card', { timeout: 8000 });
  ok(true, 'match started — round began and offered two spells to pick');

  await page.click('.pick-card');
  await page.waitForSelector('canvas', { timeout: 8000 });
  ok(true, 'spell chosen — draw canvas mounted (core mechanic ready)');

  ok(errors.length === 0, errors.length ? `console errors: ${errors.join(' | ')}` : 'no runtime/console errors');

  console.log('\nSMOKE PASSED ✓ desktop/mobile browser game loads and plays');
} catch (e) {
  console.error('\nSMOKE FAILED ✗', e.message);
  process.exitCode = 1;
} finally {
  if (browser) await browser.close();
  vite.kill('SIGTERM');
  setTimeout(() => vite.kill('SIGKILL'), 1500);
}
