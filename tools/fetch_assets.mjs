// ============================================================================
// ASSET FETCH — real photoscanned PBR textures and an HDRI, from Poly Haven.
//
// Everything in this project was procedurally generated until now, and that has
// a hard ceiling: noise functions can imitate the STATISTICS of a surface but
// not its history — the wear pattern of a real fabric, the pitting on real
// metal, the way real stone weathers unevenly. Photoscanned material is what
// AAA games actually ship, and it is the one change procedural generation
// cannot match.
//
// LICENSING: Poly Haven publishes everything CC0 (public domain dedication),
// so this is safe to redistribute in a deployed build. Credited in ASSETS.md
// regardless, because CC0 does not require attribution but crediting scan
// authors is the decent thing to do.
//
// COST: this trades the project's "zero binary assets" property for fidelity.
// Textures are downsized and re-encoded before shipping (see pack_assets.mjs),
// and the service worker runtime-caches them rather than precaching, so a cold
// first load stays fast and offline still works after one visit.
//
// Usage: node tools/fetch_assets.mjs
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';

const OUT = path.join(process.cwd(), 'assets', 'src');
const API = 'https://api.polyhaven.com';

// Chosen for what the arena actually needs, at the smallest resolution that
// survives close inspection at our camera distances.
// Poly Haven is inconsistent about map naming across assets — colour may be
// 'Diffuse', 'col_1', 'col_2' or 'col_03' depending on when it was scanned — so
// each entry lists candidates and the first that exists wins.
const COLOR_CANDIDATES = ['Diffuse', 'col_1', 'col_2', 'col_03', 'coll1', 'coll2', 'Color', 'albedo'];

const WANT = [
  // [polyhaven slug, our name, resolution]
  ['fabric_pattern_07', 'cloth',   '2k'],
  ['leather_red_02',    'leather', '2k'],
  ['metal_plate',       'metal',   '2k'],
  ['rock_wall_10',      'rock',    '2k'],
  ['concrete_wall_008', 'stone',   '2k'],
];

// Every material wants the same three channels. 'arm' packs
// AO/Roughness/Metalness into one RGB texture, which is exactly the layout
// three.js can read from a single image — one fetch instead of three.
const MAPS = ['__color', 'nor_gl', 'arm', 'Rough'];

const HDRI = ['satara_night_no_lamps', 'sky', '2k'];

async function jget(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${r.status} ${url}`);
  return r.json();
}

async function download(url, dest) {
  if (existsSync(dest)) { console.log('  · cached', path.basename(dest)); return; }
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${r.status} ${url}`);
  const buf = Buffer.from(await r.arrayBuffer());
  await writeFile(dest, buf);
  console.log(`  ✓ ${path.basename(dest)}  ${(buf.length / 1024 / 1024).toFixed(1)}MB`);
}

// Poly Haven's file tree nests as files[mapType][resolution][format].
function pick(files, mapType, res) {
  const m = files[mapType];
  if (!m) return null;
  const r = m[res] || m['2k'] || m['1k'] || Object.values(m)[0];
  if (!r) return null;
  // prefer jpg for colour, png for normals (fewer compression artefacts in the
  // channels that drive lighting)
  return r.jpg?.url || r.png?.url || Object.values(r)[0]?.url || null;
}

await mkdir(OUT, { recursive: true });
const manifest = { textures: {}, hdri: null, credits: [] };

for (const [slug, name, res] of WANT) {
  console.log(`\n${name}  (${slug})`);
  let files;
  try {
    files = await jget(`${API}/files/${slug}`);
  } catch (e) {
    console.log(`  ✗ unavailable: ${e.message}`);
    continue;
  }
  let info = null;
  try { info = await jget(`${API}/info/${slug}`); } catch { /* credits optional */ }
  if (info?.authors) {
    manifest.credits.push({ asset: slug, name, authors: Object.keys(info.authors) });
  }

  manifest.textures[name] = {};
  for (const map of MAPS) {
    // resolve the colour channel from whichever name this asset happens to use
    let key = map, url = null;
    if (map === '__color') {
      for (const c of COLOR_CANDIDATES) {
        url = pick(files, c, res);
        if (url) { key = 'color'; break; }
      }
    } else {
      url = pick(files, map, res);
    }
    if (!url) { console.log(`  · no ${map}`); continue; }
    const ext = path.extname(new URL(url).pathname) || '.jpg';
    const dest = path.join(OUT, `${name}_${key}${ext}`);
    try {
      await download(url, dest);
      manifest.textures[name][key] = path.basename(dest);
    } catch (e) {
      console.log(`  ✗ ${key}: ${e.message}`);
    }
  }
}

// HDRI for image-based lighting: a real captured sky drives far more plausible
// reflections and ambient than a hand-authored gradient ever will.
console.log(`\nhdri (${HDRI[0]})`);
try {
  const files = await jget(`${API}/files/${HDRI[0]}`);
  const url = files?.hdri?.[HDRI[2]]?.hdr?.url || files?.hdri?.['1k']?.hdr?.url;
  if (url) {
    const dest = path.join(OUT, 'sky.hdr');
    await download(url, dest);
    manifest.hdri = 'sky.hdr';
    const info = await jget(`${API}/info/${HDRI[0]}`).catch(() => null);
    if (info?.authors) manifest.credits.push({ asset: HDRI[0], name: 'sky', authors: Object.keys(info.authors) });
  } else {
    console.log('  ✗ no hdr url');
  }
} catch (e) {
  console.log(`  ✗ ${e.message}`);
}

await writeFile(path.join(OUT, 'manifest.json'), JSON.stringify(manifest, null, 2));
console.log('\nmanifest written:', Object.keys(manifest.textures).join(', '), manifest.hdri ? '+ hdri' : '');
