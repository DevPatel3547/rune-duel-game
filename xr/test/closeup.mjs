// Character inspection harness: parks the camera right in front of the
// opponent and shoots several angles, so avatar geometry can be judged instead
// of guessed at from across the arena.
// Usage: node xr/test/closeup.mjs [outDir]
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import puppeteer from 'puppeteer-core';

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const OUT = process.argv[2] || '/tmp/runecloseup';
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
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  await page.setViewport({ width: 900, height: 1100 });
  await page.goto(url, { waitUntil: 'networkidle2', timeout: 40000 });
  await page.waitForFunction('window.__game', { timeout: 20000 });
  await page.evaluate(() => window.__game.getState().startPractice());
  await page.waitForFunction(() => window.__game.getState().phase === 'live', { timeout: 15000 });
  await page.evaluate(() => { window.__game.getState().driver.aiNextCast = Infinity; });
  await wait(2500);

  await page.waitForFunction('window.__three', { timeout: 10000 });
  // CameraRig drives the camera every frame; hand control to this harness.
  await page.evaluate(() => { window.__freeCamera = true; });

  const angles = [
    { name: 'front', pos: [0, 1.35, -2.6], look: [0, 1.15, -5] },
    { name: 'head', pos: [0, 1.75, -3.6], look: [0, 1.62, -5] },
    { name: 'side', pos: [2.2, 1.4, -4.0], look: [0, 1.15, -5] },
    { name: 'full', pos: [0, 1.5, -1.6], look: [0, 1.0, -5] },
  ];

  for (const a of angles) {
    await page.evaluate(({ pos, look }) => {
      const cam = window.__three.camera;
      cam.position.set(...pos);
      cam.lookAt(...look);
      cam.updateMatrixWorld();
    }, a);
    await wait(600);
    await page.screenshot({ path: `${OUT}/${a.name}.png` });
  }

  if (errors.length) console.log('console errors:', errors.slice(0, 8));
  console.log('closeups written to', OUT);
} finally {
  await browser?.close();
  vite.kill('SIGTERM');
}
