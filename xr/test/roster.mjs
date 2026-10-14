// Captures EVERY spell at the same two moments, in one browser session, and
// writes a contact sheet.
//
// This exists because "they all look the same" cannot be argued about from
// memory or checked one spell at a time — the whole point is the comparison,
// and a spell looks distinct in isolation right up until you put it beside the
// other twenty-nine.
//
// One session for the whole roster: booting Chrome and Vite per spell costs a
// minute each, and a software-rendered screenshot of this scene is ~3 SECONDS,
// so timing is driven off game state and never off a wall clock.
//
//   SPELLS=bolt,pierce   restrict to a list (default: every attack spell)
//   AT=0.5               fraction of the flight to capture
//
// Usage: node xr/test/roster.mjs <outdir>
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import puppeteer from 'puppeteer-core';
import { SPELLS } from '../../shared/src/spells.js';

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const OUT = process.argv[2];
const AT = parseFloat(process.env.AT || '0.5');
const SLOW = 10;
const LIST = process.env.SPELLS
  ? process.env.SPELLS.split(',')
  : Object.values(SPELLS).filter((s) => s.type === 'attack').map((s) => s.id);

mkdirSync(OUT, { recursive: true });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

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
const done = [];
try {
  const url = await waitUrl(vite);
  b = await puppeteer.launch({
    executablePath: CHROME, headless: 'new',
    args: ['--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader', '--no-sandbox'],
  });
  const page = await b.newPage();
  page.on('pageerror', (e) => console.log('PAGEERROR:', e.message));
  await page.setViewport({ width: 760, height: 500 });
  await page.evaluateOnNewDocument((slow) => { window.__vfxSlow = slow; }, SLOW);
  await page.goto(url, { waitUntil: 'networkidle2', timeout: 40000 });
  await page.waitForFunction('window.__game', { timeout: 20000 });
  await page.evaluate(() => window.__game.getState().startPractice());
  await page.waitForFunction(() => window.__game.getState().phase === 'live', { timeout: 15000 });
  await page.evaluate(() => {
    const d = window.__game.getState().driver;
    d.aiNextCast = Infinity; d.pendingCast = null; d.projectiles.length = 0;
  });

  for (const id of LIST) {
    // Clear the field so the previous spell's effects are not in frame.
    await page.evaluate(() => {
      const d = window.__game.getState().driver;
      d.projectiles.length = 0;
      window.__game.setState({ fx: [] });
      // Heal the dummy between casts. Thirty spells at full power kill it about
      // a third of the way down the roster, and every capture after that is the
      // victory overlay rather than a spell.
      d.ai.hp = 100;
      d.me.hp = 100;
      window.__game.setState({ hp: { you: 100, opponent: 100 }, outcome: null, phase: 'live' });
    });
    await wait(400);
    await page.evaluate((sid) => {
      const d = window.__game.getState().driver;
      d.me.mana = 100; d.me.cd = {};
      d._cast(d.me, 'you', sid, 0.95, performance.now());
    }, id);

    await page.waitForFunction((at) => {
      const t = window.__domainT;
      if (t) return t.manifest >= at;
      const f = window.__game.getState().fx.find((x) => x.kind !== 'number');
      return f && (performance.now() - f.born) / (f.travel || 2000) >= at;
    }, { timeout: 60000 }, AT).catch(() => {});
    await page.screenshot({ path: `${OUT}/${id}.png` });
    done.push(id);
    console.log(`  ${id}`);
  }

  writeFileSync(`${OUT}/index.json`, JSON.stringify(done, null, 2));
  console.log(`\n${done.length} spells captured to ${OUT}`);
} finally { await b?.close(); vite.kill('SIGTERM'); }
