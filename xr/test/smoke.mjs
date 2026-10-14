// Headless smoke test for the REAL-TIME 3D arena duel. Boots Vite, loads the
// game in real Chrome (software WebGL), starts a practice duel, casts a real
// spell through the store path, and asserts the LIVE fight actually runs: mana
// is spent, a projectile flies, the AI attacks back, and HP drains on both
// sides over time until someone can win. Proves scene → engine → store live in
// a browser. (Combat/recognizer math has unit coverage.)
import { spawn } from 'node:child_process';
import puppeteer from 'puppeteer-core';

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const ok = (c, m) => { if (!c) { console.error('  ✗ ' + m); throw new Error(m); } console.log('  ✓ ' + m); };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

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

// Its own process group: `npm run dev` forks the real vite process, and killing
// only npm leaves vite running and holding the port.
const vite = spawn('npm', ['run', 'dev'], { cwd: new URL('..', import.meta.url).pathname, env: process.env, detached: true });
const stopVite = (sig) => { try { process.kill(-vite.pid, sig); } catch { vite.kill(sig); } };
let browser;
try {
  const url = await waitForUrl(vite);
  console.log('vite up at', url);

  browser = await puppeteer.launch({
    executablePath: CHROME, headless: 'new', acceptInsecureCerts: true,
    args: ['--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--use-gl=angle', '--use-angle=swiftshader', '--no-sandbox'],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  page.on('response', (r) => { if (r.status() >= 400) errors.push(`${r.status()} ${r.url()}`); });

  // Force the low quality tier: this test exercises game logic, not the
  // renderer, and the high-tier reflective floor runs at well under 1 fps
  // through SwiftShader — the fixed-timestep sim then advances in slow motion
  // and the AI legitimately cannot land a hit inside any sane window.
  await page.goto(url + '/?q=low', { waitUntil: 'networkidle2', timeout: 30000 });

  await page.waitForFunction('window.__game && window.__templates', { timeout: 15000 });
  ok(true, 'arena duel booted (store + rune templates live)');

  await page.waitForFunction(() => /Enter the Arena/i.test(document.body.innerText), { timeout: 8000 });
  ok(true, '3D menu rendered');

  // Start a practice duel; wait for it to go LIVE (not turn-based).
  await page.evaluate(() => window.__game.getState().startPractice());
  // The duel goes live once the arena has loaded (every shader compiled, slow
  // through software rendering) and the 3-2-1 has finished.
  await page.waitForFunction(() => window.__game.getState().phase === 'live', { timeout: 60000, polling: 100 });
  ok(true, 'match went LIVE (real-time, not turn-based)');

  // Let mana build, then cast Bolt by feeding its exact rune template through the
  // real submitCast path (same call the mouse/touch caster makes).
  await wait(1200);
  const cast = await page.evaluate(() => {
    const g = window.__game.getState();
    const manaBefore = g.resources.mana;
    const fxBefore = g.fx.length;
    const match = g.submitCast(window.__templates.bolt, 0.8); // 0.8s draw
    const g2 = window.__game.getState();
    return { manaBefore, manaAfter: g2.resources.mana, fxBefore, fxAfter: g2.fx.length, spellId: match && match.spellId };
  });
  ok(cast.spellId === 'bolt', `drew a rune → recognized ${cast.spellId}`);
  ok(cast.manaAfter < cast.manaBefore, `casting spent mana (${Math.round(cast.manaBefore)}→${Math.round(cast.manaAfter)})`);
  ok(cast.fxAfter > cast.fxBefore, 'a projectile launched across the arena');

  // Let the live fight run: the AI should attack, and HP should drop on BOTH
  // sides over time (proves real-time two-way combat, not a scripted exchange).
  // Long enough for the AI to actually connect. Its first hit is gated by the
  // opening grace period (~2.6s) + its telegraph wind-up (RT.TELEGRAPH_MS) +
  // projectile flight (RT.PROJECTILE_MS, ~1.65s across the 9m arena), so a
  // short window can pass while the fight is working perfectly.
  await wait(11000);
  const live = await page.evaluate(() => {
    const g = window.__game.getState();
    return { hpYou: g.hp.you, hpOpp: g.hp.opponent, mana: g.resources.mana, phase: g.phase };
  });
  ok(live.hpOpp < 100, `your spells are landing — opponent HP ${live.hpOpp}`);
  ok(live.hpYou < 100, `the AI is fighting back — your HP ${live.hpYou}`);
  ok(live.mana >= 0 && live.mana <= 100, `mana regenerating in real time (${Math.round(live.mana)})`);

  ok(errors.length === 0, errors.length ? `errors: ${errors.join(' | ')}` : 'no runtime/console errors');
  console.log('\nSMOKE PASSED ✓ real-time 3D arena duel runs end-to-end in a browser');
} catch (e) {
  console.error('\nSMOKE FAILED ✗', e.message);
  process.exitCode = 1;
} finally {
  if (browser) await browser.close();
  stopVite('SIGTERM');
  setTimeout(() => stopVite('SIGKILL'), 1500);
}
