// Captures the rune-drawing experience: the casting circle mid-stroke and at
// resolution. This is what the player looks at on every single cast, so it
// needs its own harness rather than being sampled by luck.
// Usage: node xr/test/drawshot.mjs <outdir>
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import puppeteer from 'puppeteer-core';

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const OUT = process.argv[2];
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
  await page.evaluate(() => { window.__game.getState().driver.aiNextCast = Infinity; });
  await wait(2000);

  // Drive a real stroke through the canvas with genuine pointer events, so the
  // whole input path (zone capture, projection, circle) is exercised.
  const box = { x: 550, y: 300 };
  await page.mouse.move(box.x - 120, box.y - 80);
  await page.mouse.down();
  for (let i = 0; i <= 14; i++) {
    const t = i / 14;
    await page.mouse.move(box.x - 120 + t * 240, box.y - 80 + Math.sin(t * Math.PI) * 150);
    if (i === 5) await page.screenshot({ path: `${OUT}/mid-stroke.png` });
    await wait(45);
  }
  await page.screenshot({ path: `${OUT}/full-stroke.png` });
  await page.mouse.up();
  for (let i = 0; i < 4; i++) {
    await page.screenshot({ path: `${OUT}/resolve-${i}.png` });
    await wait(110);
  }

  if (errs.length) console.log('ERRORS:', errs.slice(0, 5));
  console.log('draw shots written to', OUT);
} finally { await b?.close(); vite.kill('SIGTERM'); }
