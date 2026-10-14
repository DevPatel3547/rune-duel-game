// ============================================================================
// ASSET PACKING — turn multi-megabyte photoscans into web-shippable textures.
//
// The raw Poly Haven downloads are 2-5MB each and there are ~15 of them. That
// is fine for offline rendering and completely unacceptable for a page that
// should be interactive in a couple of seconds.
//
// Two decisions here matter:
//
//   * SIZE. These are tiling detail textures viewed at a distance, not hero
//     assets inspected up close. 1024 is generous; 512 is invisible for the
//     roughness/AO channels, which carry no high-frequency detail the eye can
//     resolve at our camera distances.
//
//   * FORMAT. WebP at quality 80 is roughly a quarter the size of the source
//     JPEG at visually identical quality, and is supported everywhere this
//     game runs. Normal maps get higher quality, because compression artefacts
//     in a normal map become visible LIGHTING errors rather than just softer
//     pixels.
//
// Usage: node tools/pack_assets.mjs
import { mkdir, readFile, writeFile, readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';

const SRC = path.join(process.cwd(), 'assets', 'src');
const OUT = path.join(process.cwd(), 'xr', 'public', 'tex');

// map suffix -> { size, quality }
const RULES = {
  color:  { size: 1024, quality: 80 },
  nor_gl: { size: 1024, quality: 92 },   // artefacts here are lighting errors
  arm:    { size: 512,  quality: 82 },
  Rough:  { size: 512,  quality: 80 },
};

await mkdir(OUT, { recursive: true });
const manifest = JSON.parse(await readFile(path.join(SRC, 'manifest.json'), 'utf8'));
const packed = { textures: {}, credits: manifest.credits };

let before = 0, after = 0;

for (const [name, maps] of Object.entries(manifest.textures)) {
  packed.textures[name] = {};
  for (const [map, file] of Object.entries(maps)) {
    const rule = RULES[map];
    if (!rule) continue;
    const srcPath = path.join(SRC, file);
    const outName = `${name}_${map}.webp`;
    const outPath = path.join(OUT, outName);
    try {
      before += (await stat(srcPath)).size;
      await sharp(srcPath)
        .resize(rule.size, rule.size, { fit: 'fill' })
        .webp({ quality: rule.quality, effort: 6 })
        .toFile(outPath);
      after += (await stat(outPath)).size;
      packed.textures[name][map] = `tex/${outName}`;
    } catch (e) {
      console.log(`  ✗ ${name}/${map}: ${e.message}`);
    }
  }
  console.log(`packed ${name}: ${Object.keys(packed.textures[name]).join(', ')}`);
}

await writeFile(path.join(OUT, 'manifest.json'), JSON.stringify(packed, null, 2));
console.log(`\n${(before / 1048576).toFixed(1)}MB -> ${(after / 1048576).toFixed(1)}MB ` +
            `(${((1 - after / before) * 100).toFixed(0)}% smaller)`);
