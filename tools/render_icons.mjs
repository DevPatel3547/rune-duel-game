// Renders the native app's icon and launch splash from xr/branding/icon.svg.
//
//   xr/branding/icon-1024.png    App Store / home screen icon
//   xr/branding/splash-2732.png  launch screen (icon small, centred on the ground)
//
// Rendered through headless Chrome so SVG filters (the glow) come out exactly
// as a browser draws them, then flattened with sharp: Apple rejects an app
// icon whose PNG carries an alpha channel, even a fully opaque one.
// Run: node tools/render_icons.mjs
import { readFileSync } from 'node:fs';
import puppeteer from 'puppeteer-core';
import sharp from 'sharp';

const ROOT = new URL('..', import.meta.url).pathname;
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const GROUND = '#06070b';
const svg = readFileSync(ROOT + 'xr/branding/icon.svg', 'utf8');

async function render(page, size, html) {
  await page.setViewport({ width: size, height: size, deviceScaleFactor: 1 });
  await page.setContent(html, { waitUntil: 'load' });
  return page.screenshot({ type: 'png', clip: { x: 0, y: 0, width: size, height: size } });
}

const frame = (size, body) => `<!doctype html><html><head><style>
  html, body { margin: 0; width: ${size}px; height: ${size}px; background: ${GROUND}; overflow: hidden; }
  body { display: flex; align-items: center; justify-content: center; }
</style></head><body>${body}</body></html>`;

const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox'] });
try {
  const page = await browser.newPage();

  const icon = await render(page, 1024, frame(1024, svg));
  await sharp(icon).flatten({ background: GROUND }).removeAlpha().png().toFile(ROOT + 'xr/branding/icon-1024.png');

  // The splash shows the mark at a modest size, as the system launch screen
  // does for most games; it is on screen only while the arena loads.
  const mark = svg.replace('width="1024" height="1024"', 'width="640" height="640"');
  const splash = await render(page, 2732, frame(2732, `<div style="border-radius:140px;overflow:hidden;width:640px;height:640px">${mark}</div>`));
  await sharp(splash).flatten({ background: GROUND }).removeAlpha().png().toFile(ROOT + 'xr/branding/splash-2732.png');

  for (const f of ['icon-1024.png', 'splash-2732.png']) {
    const m = await sharp(ROOT + 'xr/branding/' + f).metadata();
    console.log(`${f}: ${m.width}x${m.height}, channels=${m.channels}, alpha=${m.hasAlpha}`);
  }
} finally {
  await browser.close();
}
