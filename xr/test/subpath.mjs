// Verifies a PRODUCTION build works when served from a sub-path (as a GitHub
// Pages project site is). This is the classic static-deploy failure: the build
// looks fine locally at the domain root, then every asset 404s once it lives
// under /<repo>/. Serves xr/dist at /RuneDuel/ and asserts the game boots,
// registers its service worker, and starts a real duel.
//
// Run: VITE_BASE=/RuneDuel/ npm run build -w xr && node xr/test/subpath.mjs
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import puppeteer from 'puppeteer-core';

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const BASE = '/RuneDuel/';
const DIST = new URL('../dist/', import.meta.url).pathname;
const PORT = 4178;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const TYPES = {
  '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
  '.png': 'image/png', '.json': 'application/json',
  '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml',
};

const ok = (c, m) => { if (!c) { console.error('  ✗ ' + m); throw new Error(m); } console.log('  ✓ ' + m); };

const server = createServer(async (req, res) => {
  const url = decodeURIComponent(req.url.split('?')[0]);
  if (!url.startsWith(BASE)) { res.writeHead(404).end('outside base'); return; }
  let rel = url.slice(BASE.length) || 'index.html';
  if (rel.endsWith('/')) rel += 'index.html';
  // block path traversal escaping dist
  const path = join(DIST, normalize(rel).replace(/^(\.\.[/\\])+/, ''));
  try {
    const body = await readFile(path);
    res.writeHead(200, { 'content-type': TYPES[extname(path)] || 'application/octet-stream' });
    res.end(body);
  } catch {
    res.writeHead(404).end('not found');
  }
});

await new Promise((r) => server.listen(PORT, r));
const url = `http://localhost:${PORT}${BASE}`;
console.log('serving dist at', url);

let browser;
try {
  browser = await puppeteer.launch({
    executablePath: CHROME, headless: 'new',
    args: ['--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--use-gl=angle', '--use-angle=swiftshader', '--no-sandbox'],
  });
  const page = await browser.newPage();
  const bad = [];
  page.on('pageerror', (e) => bad.push('pageerror: ' + e.message));
  page.on('console', (m) => m.type() === 'error' && bad.push('console: ' + m.text()));
  page.on('response', (r) => { if (r.status() >= 400) bad.push(`${r.status()} ${r.url()}`); });

  await page.setViewport({ width: 1280, height: 800 });
  await page.goto(url, { waitUntil: 'networkidle2', timeout: 45000 });

  await page.waitForFunction(() => /RUNE\s*DUEL/i.test(document.body.innerText), { timeout: 20000 });
  ok(true, 'app boots from the sub-path');

  ok(bad.length === 0, `no 404s or console errors${bad.length ? ' — ' + bad.slice(0, 5).join(' | ') : ''}`);

  const sw = await page.evaluate(async () => {
    const r = await navigator.serviceWorker.getRegistration();
    return r ? r.scope : null;
  });
  ok(sw && sw.endsWith(BASE), `service worker registered at the right scope (${sw})`);

  const man = await page.evaluate(async () => {
    const link = document.querySelector('link[rel="manifest"]');
    const res = await fetch(link.href);
    return res.ok ? res.json() : null;
  });
  ok(man && man.start_url === BASE && man.scope === BASE, 'manifest start_url + scope match the sub-path');

  // the game itself must actually run, not merely render its menu
  await page.waitForFunction('window.__game', { timeout: 10000 }).catch(() => {});
  const started = await page.evaluate(async () => {
    // production build has no dev hooks, so drive it through the real UI
    const btn = [...document.querySelectorAll('button')].find((b) => /enter the arena/i.test(b.textContent));
    if (!btn) return false;
    btn.click();
    return true;
  });
  ok(started, 'started a duel through the real menu button');
  await wait(3500);
  const inGame = await page.evaluate(() => !!document.querySelector('.book .scard'));
  ok(inGame, 'duel is running (spellbook HUD present)');

  console.log('\nSUBPATH DEPLOY CHECK PASSED ✓');
} finally {
  await browser?.close();
  server.close();
}
