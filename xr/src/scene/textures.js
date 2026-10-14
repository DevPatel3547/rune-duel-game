// Procedurally generated PBR textures + environment map.
//
// Why procedural: the app is an offline-capable PWA and we refuse to ship (or
// fetch) binary texture assets. Everything here is synthesised on a <canvas> at
// boot, which costs a few ms and keeps the install footprint at zero while
// still giving materials real albedo/normal/roughness detail — the difference
// between "flat untextured primitive" and something that reads as carved stone.
//
// Everything is cached per-key so repeated calls are free.
import * as THREE from 'three';
import { TIER } from '../perf.js';

const cache = new Map();
const memo = (key, make) => {
  if (!cache.has(key)) cache.set(key, make());
  return cache.get(key);
};

// Texture resolution scales with device tier — a phone doesn't need 1K stone.
const RES = TIER === 'high' ? 1024 : TIER === 'mid' ? 512 : 256;

// ---------------------------------------------------------------- noise ----

// Deterministic 2D hash → [0,1). Cheap and stable across reloads, so the arena
// looks identical every session (important: a wandering texture reads as a bug).
function hash2(x, y, seed) {
  let h = x * 374761393 + y * 668265263 + seed * 1274126177;
  h = (h ^ (h >> 13)) >>> 0;
  h = Math.imul(h, 1274126177) >>> 0;
  return ((h ^ (h >> 16)) >>> 0) / 4294967296;
}

const smooth = (t) => t * t * (3 - 2 * t);

// Tiling value noise: wraps at `period` so the texture repeats seamlessly.
function valueNoise(x, y, period, seed) {
  const xi = Math.floor(x), yi = Math.floor(y);
  const xf = x - xi, yf = y - yi;
  const w = (n) => ((n % period) + period) % period;
  const x0 = w(xi), x1 = w(xi + 1), y0 = w(yi), y1 = w(yi + 1);
  const a = hash2(x0, y0, seed), b = hash2(x1, y0, seed);
  const c = hash2(x0, y1, seed), d = hash2(x1, y1, seed);
  const u = smooth(xf), v = smooth(yf);
  return (a * (1 - u) + b * u) * (1 - v) + (c * (1 - u) + d * u) * v;
}

// Fractal Brownian motion — stacked octaves give the broad-to-fine detail that
// makes a surface look like material rather than TV static.
function fbm(x, y, octaves, period, seed) {
  let sum = 0, amp = 0.5, freq = 1, norm = 0;
  for (let o = 0; o < octaves; o++) {
    sum += valueNoise(x * freq, y * freq, period * freq, seed + o * 31) * amp;
    norm += amp;
    amp *= 0.5; freq *= 2;
  }
  return sum / norm;
}

// -------------------------------------------------------------- helpers ----

function makeCanvas(size) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  return c;
}

function toTexture(canvas, { repeat = 1, srgb = false } = {}) {
  const t = new THREE.CanvasTexture(canvas);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(repeat, repeat);
  t.anisotropy = 4;
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.needsUpdate = true;
  return t;
}

// Tiling is a per-texture property, so several meshes sharing one THREE.Texture
// cannot each have their own repeat — setting it on one silently changes them
// all. We therefore hand out cloned texture sets keyed by tiling factor, and
// memoise those clones so the number of variants (and GPU uploads) stays small.
// Clones share the underlying canvas image, so this costs sampler state, not
// another CPU-side bitmap.
function tiled(maps, key, [rx, ry]) {
  return memo(`${key}@${rx}x${ry}`, () => {
    const out = {};
    for (const [slot, tex] of Object.entries(maps)) {
      const c = tex.clone();
      c.wrapS = c.wrapT = THREE.RepeatWrapping;
      c.repeat.set(rx, ry);
      c.needsUpdate = true;
      out[slot] = c;
    }
    return out;
  });
}

// Derive a tangent-space normal map from a height field via Sobel gradients.
// Doing this from the same noise that drives albedo keeps lighting and colour
// detail in agreement, which is what sells the illusion of relief.
function heightToNormal(height, size, strength = 2.0) {
  const canvas = makeCanvas(size);
  const ctx = canvas.getContext('2d');
  const img = ctx.createImageData(size, size);
  const at = (x, y) => height[((y + size) % size) * size + ((x + size) % size)];

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      // Sobel
      const dx =
        (at(x + 1, y - 1) + 2 * at(x + 1, y) + at(x + 1, y + 1)) -
        (at(x - 1, y - 1) + 2 * at(x - 1, y) + at(x - 1, y + 1));
      const dy =
        (at(x - 1, y + 1) + 2 * at(x, y + 1) + at(x + 1, y + 1)) -
        (at(x - 1, y - 1) + 2 * at(x, y - 1) + at(x + 1, y - 1));

      let nx = -dx * strength, ny = -dy * strength, nz = 1;
      const len = Math.hypot(nx, ny, nz);
      nx /= len; ny /= len; nz /= len;

      const i = (y * size + x) * 4;
      img.data[i] = (nx * 0.5 + 0.5) * 255;
      img.data[i + 1] = (ny * 0.5 + 0.5) * 255;
      img.data[i + 2] = (nz * 0.5 + 0.5) * 255;
      img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return canvas;
}

// --------------------------------------------------------------- stone -----

// Dark arcane basalt: mottled colour, fine grain, subtle veining. Returns the
// full PBR set so a mesh can use map + normalMap + roughnessMap together.
export function stoneMaterialMaps(repeat = [1, 1]) {
  return tiled(stoneBase(), 'stone', repeat);
}

function stoneBase() {
  return memo('stone:base', () => {
    const size = RES;
    const height = new Float32Array(size * size);
    const albedo = makeCanvas(size);
    const actx = albedo.getContext('2d');
    const aimg = actx.createImageData(size, size);
    const rough = makeCanvas(size);
    const rctx = rough.getContext('2d');
    const rimg = rctx.createImageData(size, size);

    const S = 8; // noise cells across the texture

    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const u = (x / size) * S, v = (y / size) * S;

        const base = fbm(u, v, 5, S, 11);
        // veins: ridged noise (abs of a signed field) reads as cracks/marbling
        const vein = 1 - Math.abs(fbm(u * 1.7 + 3, v * 1.7, 4, S * 1.7, 27) * 2 - 1);
        const grain = fbm(u * 9, v * 9, 3, S * 9, 53);

        const h = base * 0.62 + Math.pow(vein, 3) * 0.26 + grain * 0.12;
        height[y * size + x] = h;

        // deep violet-tinted charcoal, veins slightly warmer
        const l = 0.10 + h * 0.20;
        const veinLift = Math.pow(vein, 6) * 0.14;
        const i = (y * size + x) * 4;
        aimg.data[i] = (l * 0.95 + veinLift * 1.25) * 255;
        aimg.data[i + 1] = (l * 0.82 + veinLift * 0.85) * 255;
        aimg.data[i + 2] = (l * 1.35 + veinLift * 1.6) * 255;
        aimg.data[i + 3] = 255;

        // polished in the hollows, rougher on the raised grain
        const r = 0.34 + (1 - h) * 0.42 + grain * 0.12;
        const rv = Math.max(0, Math.min(1, r)) * 255;
        rimg.data[i] = rimg.data[i + 1] = rimg.data[i + 2] = rv;
        rimg.data[i + 3] = 255;
      }
    }
    actx.putImageData(aimg, 0, 0);
    rctx.putImageData(rimg, 0, 0);

    return {
      map: toTexture(albedo, { srgb: true }),
      normalMap: toTexture(heightToNormal(height, size, 2.2)),
      roughnessMap: toTexture(rough),
    };
  });
}

// Weathered metal for pillar bands, staff fittings, arena trim.
export function metalMaterialMaps(repeat = [1, 1]) {
  return tiled(metalBase(), 'metal', repeat);
}

function metalBase() {
  return memo('metal:base', () => {
    const size = RES / 2;
    const height = new Float32Array(size * size);
    const albedo = makeCanvas(size);
    const actx = albedo.getContext('2d');
    const aimg = actx.createImageData(size, size);
    const rough = makeCanvas(size);
    const rctx = rough.getContext('2d');
    const rimg = rctx.createImageData(size, size);
    const S = 6;

    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const u = (x / size) * S, v = (y / size) * S;
        // anisotropic streaks: stretch the noise along one axis so it reads as
        // brushed/hammered metal rather than generic mottling
        const streak = fbm(u * 0.6, v * 5, 4, S * 5, 71);
        const patina = fbm(u * 2, v * 2, 4, S * 2, 91);
        const h = streak * 0.5 + patina * 0.5;
        height[y * size + x] = h;

        const i = (y * size + x) * 4;
        // tarnished bronze-violet
        const l = 0.22 + h * 0.30;
        aimg.data[i] = l * 255 * 1.15;
        aimg.data[i + 1] = l * 255 * 0.92;
        aimg.data[i + 2] = l * 255 * 1.05;
        aimg.data[i + 3] = 255;

        const r = 0.20 + patina * 0.55;
        const rv = Math.max(0, Math.min(1, r)) * 255;
        rimg.data[i] = rimg.data[i + 1] = rimg.data[i + 2] = rv;
        rimg.data[i + 3] = 255;
      }
    }
    actx.putImageData(aimg, 0, 0);
    rctx.putImageData(rimg, 0, 0);

    return {
      map: toTexture(albedo, { srgb: true }),
      normalMap: toTexture(heightToNormal(height, size, 1.4)),
      roughnessMap: toTexture(rough),
    };
  });
}

// ---------------------------------------------------------- robe cloth -----

// Soft directional weave for the wizard's robe — keeps the fabric from reading
// as moulded plastic under the key light.
export function clothMaterialMaps(repeat = [2, 2]) {
  return tiled(clothBase(), 'cloth', repeat);
}

function clothBase() {
  return memo('cloth:base', () => {
    const size = RES / 2;
    const height = new Float32Array(size * size);
    const S = 10;
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const u = (x / size) * S, v = (y / size) * S;
        const weave = Math.sin(u * Math.PI * 8) * Math.sin(v * Math.PI * 8) * 0.08;
        const drape = fbm(u * 0.8, v * 2.4, 4, S, 131);
        height[y * size + x] = drape * 0.85 + weave + 0.1;
      }
    }
    return { normalMap: toTexture(heightToNormal(height, size, 1.1)) };
  });
}

// ------------------------------------------------------------ rune ring ----

// The big glyph-inscribed disc inlaid into the arena floor. Drawn with the 2D
// canvas API (crisp vector shapes beat noise for something meant to look
// deliberately carved) and used as an emissive mask.
export function runeDiscTexture() {
  return memo('runeDisc', () => {
    const size = 1024;
    const c = makeCanvas(size);
    const ctx = c.getContext('2d');
    const R = size / 2;
    ctx.clearRect(0, 0, size, size);
    ctx.translate(R, R);

    ctx.strokeStyle = '#ffffff';
    ctx.lineCap = 'round';

    // concentric rings of varying weight
    const rings = [0.97, 0.93, 0.72, 0.69, 0.44, 0.30, 0.28];
    rings.forEach((r, i) => {
      ctx.beginPath();
      ctx.arc(0, 0, R * r, 0, Math.PI * 2);
      ctx.lineWidth = i % 2 === 0 ? 4 : 1.5;
      ctx.globalAlpha = i % 2 === 0 ? 0.9 : 0.5;
      ctx.stroke();
    });

    // radial spokes between the outer rings
    ctx.globalAlpha = 0.55;
    ctx.lineWidth = 2;
    for (let i = 0; i < 48; i++) {
      const a = (i / 48) * Math.PI * 2;
      const inner = i % 4 === 0 ? 0.74 : 0.88;
      ctx.beginPath();
      ctx.moveTo(Math.cos(a) * R * inner, Math.sin(a) * R * inner);
      ctx.lineTo(Math.cos(a) * R * 0.92, Math.sin(a) * R * 0.92);
      ctx.stroke();
    }

    // glyph band — abstract angular marks around the mid ring
    ctx.globalAlpha = 0.95;
    ctx.lineWidth = 3.5;
    for (let i = 0; i < 24; i++) {
      const a = (i / 24) * Math.PI * 2;
      ctx.save();
      ctx.rotate(a);
      ctx.translate(0, -R * 0.565);
      const seed = i * 7;
      ctx.beginPath();
      // deterministic little glyph made of 3 strokes
      for (let s = 0; s < 3; s++) {
        const x0 = (hash2(seed, s, 3) - 0.5) * 34;
        const y0 = (hash2(seed, s, 5) - 0.5) * 34;
        const x1 = (hash2(seed, s, 7) - 0.5) * 34;
        const y1 = (hash2(seed, s, 11) - 0.5) * 34;
        ctx.moveTo(x0, y0);
        ctx.lineTo(x1, y1);
      }
      ctx.stroke();
      ctx.restore();
    }

    // interlaced star polygon in the middle — the classic summoning-circle look
    ctx.globalAlpha = 0.8;
    ctx.lineWidth = 3;
    const N = 7, step = 3;
    ctx.beginPath();
    for (let i = 0; i <= N; i++) {
      const a = ((i * step) / N) * Math.PI * 2 - Math.PI / 2;
      const x = Math.cos(a) * R * 0.28, y = Math.sin(a) * R * 0.28;
      i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    }
    ctx.closePath();
    ctx.stroke();

    const t = new THREE.CanvasTexture(c);
    t.anisotropy = 8;
    t.needsUpdate = true;
    return t;
  });
}

// ------------------------------------------------------------- sprites -----

// Soft radial falloff — the workhorse sprite for embers, sparks, glows.
export function glowSprite() {
  return memo('glowSprite', () => {
    const s = 128;
    const c = makeCanvas(s);
    const ctx = c.getContext('2d');
    const g = ctx.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(0.18, 'rgba(255,255,255,0.75)');
    g.addColorStop(0.45, 'rgba(255,255,255,0.20)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, s, s);
    const t = new THREE.CanvasTexture(c);
    t.needsUpdate = true;
    return t;
  });
}

// A four-point star flare for impact flashes and the staff crystal.
export function flareSprite() {
  return memo('flareSprite', () => {
    const s = 256;
    const c = makeCanvas(s);
    const ctx = c.getContext('2d');
    const R = s / 2;
    ctx.translate(R, R);

    const core = ctx.createRadialGradient(0, 0, 0, 0, 0, R * 0.42);
    core.addColorStop(0, 'rgba(255,255,255,1)');
    core.addColorStop(0.4, 'rgba(255,255,255,0.5)');
    core.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = core;
    ctx.fillRect(-R, -R, s, s);

    // anamorphic spikes
    ctx.globalCompositeOperation = 'lighter';
    for (const [rot, len, w] of [[0, 1.0, 0.055], [Math.PI / 2, 0.62, 0.04], [Math.PI / 4, 0.34, 0.02], [-Math.PI / 4, 0.34, 0.02]]) {
      ctx.save();
      ctx.rotate(rot);
      const g = ctx.createLinearGradient(-R * len, 0, R * len, 0);
      g.addColorStop(0, 'rgba(255,255,255,0)');
      g.addColorStop(0.5, 'rgba(255,255,255,0.9)');
      g.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = g;
      ctx.fillRect(-R * len, -R * w, R * len * 2, R * w * 2);
      ctx.restore();
    }
    const t = new THREE.CanvasTexture(c);
    t.needsUpdate = true;
    return t;
  });
}

// A soft smoke/energy puff with irregular edges, for impact clouds.
export function puffSprite() {
  return memo('puffSprite', () => {
    const s = 128;
    const c = makeCanvas(s);
    const ctx = c.getContext('2d');
    const img = ctx.createImageData(s, s);
    for (let y = 0; y < s; y++) {
      for (let x = 0; x < s; x++) {
        const dx = (x - s / 2) / (s / 2), dy = (y - s / 2) / (s / 2);
        const d = Math.hypot(dx, dy);
        const n = fbm((x / s) * 5, (y / s) * 5, 4, 5, 17);
        const a = Math.max(0, 1 - d / (0.55 + n * 0.45));
        const i = (y * s + x) * 4;
        img.data[i] = img.data[i + 1] = img.data[i + 2] = 255;
        img.data[i + 3] = Math.pow(a, 1.6) * 255;
      }
    }
    ctx.putImageData(img, 0, 0);
    const t = new THREE.CanvasTexture(c);
    t.needsUpdate = true;
    return t;
  });
}

// The sheet of light filling the great arch. A flat additive colour reads as a
// painted backdrop, so this carries a vertical gradient (hottest just above the
// opponent's head, falling off toward the keystone) plus soft edge falloff and
// a few drifting striations to imply depth behind the opening.
export function portalTexture() {
  return memo('portal', () => {
    const w = 256, h = 512;
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const ctx = c.getContext('2d');

    const g = ctx.createLinearGradient(0, h, 0, 0);
    g.addColorStop(0.00, 'rgba(255,255,255,0.10)');
    g.addColorStop(0.18, 'rgba(255,255,255,0.95)');
    g.addColorStop(0.45, 'rgba(255,255,255,0.55)');
    g.addColorStop(1.00, 'rgba(255,255,255,0.08)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);

    // vertical striations — reads as light falling through a deep opening
    ctx.globalCompositeOperation = 'lighter';
    for (let i = 0; i < 26; i++) {
      const x = hash2(i, 9, 13) * w;
      const bw = 2 + hash2(i, 3, 17) * 16;
      const a = 0.02 + hash2(i, 5, 19) * 0.07;
      ctx.fillStyle = `rgba(255,255,255,${a})`;
      ctx.fillRect(x, 0, bw, h);
    }

    // soften the left/right edges so the sheet doesn't end on a hard line
    ctx.globalCompositeOperation = 'destination-in';
    const edge = ctx.createLinearGradient(0, 0, w, 0);
    edge.addColorStop(0, 'rgba(0,0,0,0)');
    edge.addColorStop(0.22, 'rgba(0,0,0,1)');
    edge.addColorStop(0.78, 'rgba(0,0,0,1)');
    edge.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = edge;
    ctx.fillRect(0, 0, w, h);

    const t = new THREE.CanvasTexture(c);
    t.needsUpdate = true;
    return t;
  });
}

// ---------------------------------------------------------- environment ----

// A procedural nebula sky as an equirectangular texture. Serves double duty:
// it's the visible backdrop AND `scene.environment`, so every PBR surface picks
// up plausible coloured reflections instead of reflecting flat black. This is
// the single cheapest change that stops metal/stone looking like matte plastic.
export function nebulaEnvTexture() {
  return memo('nebulaEnv', () => {
    const w = 1024, h = 512;
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const ctx = c.getContext('2d');
    const img = ctx.createImageData(w, h);

    for (let y = 0; y < h; y++) {
      // v: 0 at the zenith, 1 at the nadir
      const v = y / h;
      for (let x = 0; x < w; x++) {
        const u = x / w;
        // sample in a wrapping space so the seam at u=0/1 is invisible
        const a = u * Math.PI * 2;
        const nx = Math.cos(a) * 2.2, ny = Math.sin(a) * 2.2, nz = v * 3.4;

        const cloud = fbm(nx + nz, ny + nz * 0.5, 5, 16, 7);
        const cloud2 = fbm(nx * 2.3 - 4, ny * 2.3 + nz, 4, 16, 41);

        // vertical gradient: deep indigo overhead → warmer magenta at the horizon
        const horizon = Math.pow(v, 1.5);
        let r = 0.020 + horizon * 0.10;
        let g = 0.012 + horizon * 0.030;
        let b = 0.055 + horizon * 0.13;

        // two nebula bands in different hues
        const band1 = Math.pow(Math.max(0, cloud - 0.42), 1.7) * 1.9;
        const band2 = Math.pow(Math.max(0, cloud2 - 0.52), 2.0) * 1.5;
        r += band1 * 0.42 + band2 * 0.10;
        g += band1 * 0.13 + band2 * 0.20;
        b += band1 * 0.62 + band2 * 0.55;

        const i = (y * w + x) * 4;
        img.data[i] = Math.min(255, r * 255);
        img.data[i + 1] = Math.min(255, g * 255);
        img.data[i + 2] = Math.min(255, b * 255);
        img.data[i + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);

    // stars on top — denser near the zenith so they don't fight the horizon glow
    ctx.globalCompositeOperation = 'lighter';
    for (let i = 0; i < 1400; i++) {
      const x = hash2(i, 1, 3) * w;
      const y = Math.pow(hash2(i, 2, 5), 1.7) * h;
      const s = hash2(i, 3, 7);
      const r = s * 1.5 + 0.3;
      const bright = 0.35 + s * 0.65;
      const g2 = ctx.createRadialGradient(x, y, 0, x, y, r * 3);
      const tint = hash2(i, 4, 11);
      const col = tint > 0.7 ? `${180},${205},255` : tint > 0.4 ? `255,255,255` : `255,225,200`;
      g2.addColorStop(0, `rgba(${col},${bright})`);
      g2.addColorStop(1, `rgba(${col},0)`);
      ctx.fillStyle = g2;
      ctx.beginPath();
      ctx.arc(x, y, r * 3, 0, Math.PI * 2);
      ctx.fill();
    }

    const t = new THREE.CanvasTexture(c);
    t.mapping = THREE.EquirectangularReflectionMapping;
    t.colorSpace = THREE.SRGBColorSpace;
    t.needsUpdate = true;
    return t;
  });
}

// Dispose everything (used on teardown / HMR so we don't leak GPU memory).
export function disposeTextures() {
  for (const v of cache.values()) {
    if (v?.isTexture) v.dispose();
    else if (v && typeof v === 'object') Object.values(v).forEach((t) => t?.isTexture && t.dispose());
  }
  cache.clear();
}
