// One frame of the Domain Expansion at a chosen beat.
//
// A full `vfxshot` run costs ~4 minutes, because a software-rendered screenshot
// of this scene is ~3 SECONDS — the single most misleading fact about this
// harness, and the cause of more than one phantom bug. This waits on the beat
// it is asked for and grabs exactly one frame, so a bisect is a minute.
//
//   AT=0.8                 manifest progress to capture at (default 0.8)
//   HIDE=ribs,lintels,...  drop parts of the structure to isolate one element
//
// Usage: AT=0.8 HIDE=lintels node xr/test/domainshot.mjs <outdir>
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import puppeteer from 'puppeteer-core';
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const OUT = process.argv[2];
const AT = parseFloat(process.env.AT || '0.8');
const SPELL = process.env.SPELL || 'nova';
const HIDE = process.env.HIDE || '';
mkdirSync(OUT, { recursive: true });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
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
  b = await puppeteer.launch({ executablePath: CHROME, headless: 'new',
    args: ['--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader', '--no-sandbox'] });
  const page = await b.newPage();
  page.on('pageerror', (e) => console.log('PAGEERROR:', e.message));
  await page.setViewport({ width: 900, height: 600 });
  await page.evaluateOnNewDocument((slow, hide) => {
    window.__vfxSlow = slow;
    if (hide) window.__domainHide = hide;
  }, 26, HIDE);
  await page.goto(url, { waitUntil: 'networkidle2', timeout: 40000 });
  await page.waitForFunction('window.__game', { timeout: 20000 });
  await page.evaluate(() => window.__game.getState().startPractice());
  await page.waitForFunction(() => window.__game.getState().phase === 'live', { timeout: 15000 });
  await page.evaluate(() => {
    const d = window.__game.getState().driver;
    d.aiNextCast = Infinity; d.pendingCast = null; d.projectiles.length = 0;
  });
  await wait(1000);
  await page.evaluate((id) => {
    const d = window.__game.getState().driver;
    d.me.mana = 100;
    d.me.cd = {};
    d._cast(d.me, 'you', id, 0.95, performance.now());
  }, SPELL);
  // A domain reports its own beat; everything else is sampled on how far its
  // fx has travelled. Waiting on a timer captures whatever happens to be on
  // screen, which at ~3s a screenshot is usually nothing.
  await page.waitForFunction((at) => {
    const t = window.__domainT;
    if (t) return t.manifest >= at && t.sever === 0;
    const f = window.__game.getState().fx.find((x) => x.kind !== 'number');
    return f && (performance.now() - f.born) / (f.travel || 2000) >= at;
  }, { timeout: 120000 }, AT).catch(() => console.log('beat wait timed out'));
  const st = await page.evaluate(() => window.__domainT
    || (window.__game.getState().fx.find((x) => x.kind !== 'number') || null));
  await page.screenshot({ path: `${OUT}/frame.png` });
  console.log('captured at', JSON.stringify(st), HIDE ? `(hidden: ${HIDE})` : '');
} finally { await b?.close(); vite.kill('SIGTERM'); }
