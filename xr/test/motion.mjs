// Captures a CAST as a frame sequence so animation can be judged as motion
// rather than guessed at from a still. Fires the AI's telegraph + release and
// grabs frames across the anticipation, strike and recovery, then contact-sheets
// them into one image.
// Usage: node xr/test/motion.mjs [outDir]
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import puppeteer from 'puppeteer-core';

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const OUT = process.argv[2] || '/tmp/runemotion';
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
  await page.setViewport({ width: 620, height: 620 });
  await page.goto(url, { waitUntil: 'networkidle2', timeout: 40000 });
  await page.waitForFunction('window.__game', { timeout: 20000 });
  await page.evaluate(() => window.__game.getState().startPractice());
  await page.waitForFunction(() => window.__game.getState().phase === 'live', { timeout: 15000 });
  // hold the AI so we control exactly when it casts
  await page.evaluate(() => { window.__game.getState().driver.aiNextCast = Infinity; });
  await page.waitForFunction('window.__three', { timeout: 10000 });
  await page.evaluate(() => { window.__freeCamera = true; });
  await page.evaluate(() => {
    const c = window.__three.camera;
    c.position.set(1.8, 1.6, -2.2); c.lookAt(0, 1.15, -5); c.updateMatrixWorld();
  });
  await wait(1500);

  // trigger one AI cast and sample across the whole action
  await page.evaluate(() => { window.__game.getState().driver.aiNextCast = 0; });
  const frames = [];
  for (let i = 0; i < 12; i++) {
    const f = `${OUT}/f${String(i).padStart(2, '0')}.png`;
    await page.screenshot({ path: f });
    frames.push(f);
    await wait(130);
  }

  // contact sheet, assembled in-page so we need no image libraries
  const sheet = await page.evaluate(async (srcs) => {
    const imgs = await Promise.all(srcs.map((s) => new Promise((res) => {
      const im = new Image(); im.onload = () => res(im); im.src = s;
    })));
    const cols = 4, rows = Math.ceil(imgs.length / cols), cw = 310, ch = 310;
    const c = document.createElement('canvas');
    c.width = cols * cw; c.height = rows * ch;
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#000'; ctx.fillRect(0, 0, c.width, c.height);
    imgs.forEach((im, i) => {
      ctx.drawImage(im, (i % cols) * cw, Math.floor(i / cols) * ch, cw, ch);
      ctx.fillStyle = '#0f0'; ctx.font = 'bold 18px monospace';
      ctx.fillText(`${i * 130}ms`, (i % cols) * cw + 8, Math.floor(i / cols) * ch + 22);
    });
    return c.toDataURL('image/png');
  }, frames.map((f) => 'file://' + f)).catch(() => null);

  if (sheet) {
    const { writeFile } = await import('node:fs/promises');
    await writeFile(`${OUT}/sheet.png`, Buffer.from(sheet.split(',')[1], 'base64'));
    console.log('contact sheet:', `${OUT}/sheet.png`);
  } else {
    console.log('frames written to', OUT, '(sheet assembly unavailable)');
  }
} finally { await b?.close(); vite.kill('SIGTERM'); }
