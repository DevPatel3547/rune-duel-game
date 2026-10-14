// ============================================================================
// FONT PIPELINE — self-hosted typefaces.
//
// The interface was set in Trebuchet MS with a system-UI fallback, which is one
// of the loudest possible tells that something was assembled rather than
// designed: no shipped game uses the default UI stack for its title.
//
// Two faces, doing different jobs, which is the whole discipline of type in an
// interface:
//
//   * GRENZE — a blackletter-inflected serif for display. Sharp, angular, with
//     real historical character. Titles, spell names, big numbers.
//   * SPECTRAL — a screen-optimised serif for everything that must stay
//     readable small: body copy, labels, tooltips.
//
// Both are SIL Open Font Licence, which permits embedding and redistribution.
//
// They are SELF-HOSTED rather than linked from Google's CDN: a third-party font
// request blocks first paint on a network the player does not control, leaks
// their IP to a third party, and breaks entirely offline — which is fatal for a
// PWA whose whole promise is that it works with the network off.
//
// Usage: node tools/fetch_fonts.mjs
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const OUT = path.join(process.cwd(), 'xr', 'public', 'fonts');
await mkdir(OUT, { recursive: true });

// Ask as a modern browser so Google serves woff2 rather than legacy formats.
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
           '(KHTML, like Gecko) Chrome/120.0 Safari/537.36';

const FAMILIES = [
  { q: 'Grenze:wght@400;700;900', file: 'grenze' },
  { q: 'Spectral:wght@400;500;600;700', file: 'spectral' },
];

const faces = [];

for (const fam of FAMILIES) {
  const css = await (await fetch(
    `https://fonts.googleapis.com/css2?family=${fam.q.replace(/ /g, '+')}&display=swap`,
    { headers: { 'User-Agent': UA } },
  )).text();

  // Keep only the latin subset; the game ships no other scripts and each extra
  // subset is another file the player downloads for nothing.
  const blocks = css.split('@font-face').slice(1);
  let n = 0;
  for (const b of blocks) {
    if (!/unicode-range:[^;]*U\+0000/.test(b)) continue;  // latin block only
    const url = b.match(/url\((https:[^)]+\.woff2)\)/)?.[1];
    const weight = b.match(/font-weight:\s*(\d+)/)?.[1] || '400';
    const style = b.match(/font-style:\s*(\w+)/)?.[1] || 'normal';
    if (!url) continue;
    const name = `${fam.file}-${weight}${style === 'italic' ? 'i' : ''}.woff2`;
    const buf = Buffer.from(await (await fetch(url)).arrayBuffer());
    await writeFile(path.join(OUT, name), buf);
    faces.push({ family: fam.file, weight, style, file: name, bytes: buf.length });
    n++;
    console.log(`  ✓ ${name}  ${(buf.length / 1024).toFixed(0)}KB`);
  }
  console.log(`${fam.file}: ${n} face(s)`);
}

// Emit the @font-face CSS so the app never touches a third-party origin.
const css = faces.map((f) => `@font-face {
  font-family: '${f.family === 'grenze' ? 'Grenze' : 'Spectral'}';
  font-style: ${f.style};
  font-weight: ${f.weight};
  /* swap: show fallback text immediately rather than blocking on the font —
     an invisible UI while a font loads is worse than a brief reflow */
  font-display: swap;
  src: url('/fonts/${f.file}') format('woff2');
}`).join('\n\n');

await writeFile(path.join(OUT, 'fonts.css'), css + '\n');
const total = faces.reduce((s, f) => s + f.bytes, 0);
console.log(`\n${faces.length} faces, ${(total / 1024).toFixed(0)}KB total -> xr/public/fonts/`);
