// Smoke-tests the LIVE deployed site in a real browser: loads the public URL,
// starts a duel through the actual menu button, and confirms the game runs with
// no 404s or console errors. Serving a 200 for index.html proves nothing about
// whether the app boots.
//
// Run: node xr/test/live.mjs [url]
import puppeteer from 'puppeteer-core';

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
// Pages is dead; the live site moved to Vercel 2026-08-18.
const URL_ = process.argv[2] || 'https://rune-duel.vercel.app';
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const ok = (c, m) => { if (!c) { console.error('  ✗ ' + m); process.exitCode = 1; } else console.log('  ✓ ' + m); };

const browser = await puppeteer.launch({
  executablePath: CHROME, headless: 'new',
  args: ['--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--use-gl=angle', '--use-angle=swiftshader', '--no-sandbox'],
});

try {
  for (const vp of [
    { name: 'desktop', width: 1440, height: 900, isMobile: false, hasTouch: false },
    { name: 'phone', width: 390, height: 844, isMobile: true, hasTouch: true },
  ]) {
    console.log(`\n[${vp.name}] ${URL_}`);
    const page = await browser.newPage();
    const bad = [];
    page.on('pageerror', (e) => bad.push('pageerror: ' + e.message));
    page.on('console', (m) => m.type() === 'error' && bad.push('console: ' + m.text()));
    page.on('response', (r) => { if (r.status() >= 400) bad.push(`${r.status()} ${r.url()}`); });
    await page.setViewport(vp);

    await page.goto(URL_, { waitUntil: 'networkidle2', timeout: 90000 });
    await page.waitForFunction(() => /RUNE\s*DUEL/i.test(document.body.innerText), { timeout: 25000 });
    ok(true, 'menu rendered');

    const started = await page.evaluate(() => {
      const b = [...document.querySelectorAll('button')].find((x) => /enter the arena/i.test(x.textContent));
      if (!b) return false;
      b.click();
      return true;
    });
    ok(started, 'clicked "Enter the Arena"');

    // Wait for the HUD to actually exist rather than sleeping a fixed 5s. The
    // bundle now carries a 1.1MB character and ~3MB of textures, so a cold CDN
    // fetch can easily outlast any arbitrary delay — which shows up as a
    // flaky "0 cards" failure that has nothing to do with the build.
    await page.waitForFunction(
      () => document.querySelectorAll('.book .scard').length > 0,
      { timeout: 30000 },
    ).catch(() => {});
    const state = await page.evaluate(() => ({
      cards: document.querySelectorAll('.book .scard').length,
      plates: document.querySelectorAll('.plate').length,
      canvas: !!document.querySelector('canvas'),
    }));
    ok(state.canvas, 'WebGL canvas present');
    ok(state.cards === 5, `spellbook rendered (${state.cards} cards)`);
    ok(state.plates === 2, `both fighter plates rendered (${state.plates})`);

    await page.screenshot({ path: `/tmp/live-${vp.name}.png` });
    ok(bad.length === 0, `no 404s or console errors${bad.length ? ' — ' + bad.slice(0, 4).join(' | ') : ''}`);
    await page.close();
  }
  console.log('\nLIVE SITE CHECK ' + (process.exitCode ? 'FAILED ✗' : 'PASSED ✓'));
} finally {
  await browser.close();
}
