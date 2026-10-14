// ============================================================================
// VFX TEXTURE LIBRARY
//
// The reason the old effects read as "blobs" was not polish — it was that they
// had no textures at all. They were untextured additive geometry that faded
// uniformly, and a uniform fade of a round shape is, definitionally, a blob.
//
// Professional real-time VFX is built on textures: noise for motion and break
// -up, EROSION masks so an effect dissolves with intricate edges instead of
// fading flat, and shaped gradients so the silhouette reads as fire or energy
// rather than as a sphere.
//
// Everything is generated on a canvas at boot — the app ships no binary assets.
// ============================================================================

import * as THREE from 'three';

const cache = new Map();
const memo = (k, f) => { if (!cache.has(k)) cache.set(k, f()); return cache.get(k); };

// ------------------------------------------------------------- noise -------

function hash2(x, y, seed) {
  let h = x * 374761393 + y * 668265263 + seed * 1274126177;
  h = (h ^ (h >> 13)) >>> 0;
  h = Math.imul(h, 1274126177) >>> 0;
  return ((h ^ (h >> 16)) >>> 0) / 4294967296;
}
const smooth = (t) => t * t * (3 - 2 * t);

function valueNoise(x, y, period, seed) {
  const xi = Math.floor(x), yi = Math.floor(y);
  const xf = x - xi, yf = y - yi;
  const w = (n) => ((n % period) + period) % period;
  const a = hash2(w(xi), w(yi), seed), b = hash2(w(xi + 1), w(yi), seed);
  const c = hash2(w(xi), w(yi + 1), seed), d = hash2(w(xi + 1), w(yi + 1), seed);
  const u = smooth(xf), v = smooth(yf);
  return (a * (1 - u) + b * u) * (1 - v) + (c * (1 - u) + d * u) * v;
}

function fbm(x, y, oct, period, seed) {
  let s = 0, amp = 0.5, f = 1, norm = 0;
  for (let i = 0; i < oct; i++) {
    s += valueNoise(x * f, y * f, period * f, seed + i * 31) * amp;
    norm += amp; amp *= 0.5; f *= 2;
  }
  return s / norm;
}

// Worley / cellular noise. This is the workhorse for fire, energy and smoke:
// its cell structure gives effects the wispy, tendrilled break-up that value
// noise alone never produces.
function worley(x, y, period, seed) {
  const xi = Math.floor(x), yi = Math.floor(y);
  let best = 10;
  for (let oy = -1; oy <= 1; oy++) {
    for (let ox = -1; ox <= 1; ox++) {
      const cx = xi + ox, cy = yi + oy;
      const wx = ((cx % period) + period) % period;
      const wy = ((cy % period) + period) % period;
      const px = cx + hash2(wx, wy, seed);
      const py = cy + hash2(wx, wy, seed + 999);
      const d = Math.hypot(px - x, py - y);
      if (d < best) best = d;
    }
  }
  return Math.min(1, best);
}

function canvas(size) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  return c;
}

function toTex(c, { repeat = 1 } = {}) {
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(repeat, repeat);
  t.needsUpdate = true;
  return t;
}

// ------------------------------------------------------------ exports ------

// Seamless fbm cloud — the general-purpose scroll/erosion driver.
export function noiseTexture(size = 256) {
  return memo(`noise${size}`, () => {
    const c = canvas(size), ctx = c.getContext('2d');
    const img = ctx.createImageData(size, size);
    const S = 6;
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const v = fbm((x / size) * S, (y / size) * S, 5, S, 7) * 255;
        const i = (y * size + x) * 4;
        img.data[i] = img.data[i + 1] = img.data[i + 2] = v;
        img.data[i + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
    return toTex(c);
  });
}

// Inverted worley: bright cell interiors with dark veins. Scrolled through an
// erosion threshold this reads as licking flame or crackling energy.
export function cellTexture(size = 256) {
  return memo(`cell${size}`, () => {
    const c = canvas(size), ctx = c.getContext('2d');
    const img = ctx.createImageData(size, size);
    const S = 7;
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const w1 = worley((x / size) * S, (y / size) * S, S, 13);
        const w2 = worley((x / size) * S * 2.3, (y / size) * S * 2.3, S * 2, 29);
        const v = Math.pow(1 - w1, 1.4) * 0.72 + Math.pow(1 - w2, 1.6) * 0.28;
        const i = (y * size + x) * 4;
        img.data[i] = img.data[i + 1] = img.data[i + 2] = Math.min(255, v * 255);
        img.data[i + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
    return toTex(c);
  });
}

// Radial mask with a RAGGED edge. A clean radial gradient is the blob; the
// ragged rim is what makes the silhouette read as energy.
export function burstMask(size = 256) {
  return memo(`burst${size}`, () => {
    const c = canvas(size), ctx = c.getContext('2d');
    const img = ctx.createImageData(size, size);
    const half = size / 2;
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const dx = (x - half) / half, dy = (y - half) / half;
        const d = Math.hypot(dx, dy);
        const ang = Math.atan2(dy, dx);
        // spikes around the rim, at two frequencies so it is not a star
        const spike = 0.72
          + Math.sin(ang * 9) * 0.10
          + Math.sin(ang * 17 + 1.3) * 0.06
          + fbm(Math.cos(ang) * 3 + 5, Math.sin(ang) * 3, 3, 8, 41) * 0.22;
        const a = Math.max(0, 1 - d / spike);
        const i = (y * size + x) * 4;
        img.data[i] = img.data[i + 1] = img.data[i + 2] = 255;
        img.data[i + 3] = Math.pow(a, 1.5) * 255;
      }
    }
    ctx.putImageData(img, 0, 0);
    return toTex(c);
  });
}

// A tapered streak, bright at one end — for trails, shards and sparks. Gives a
// projectile a direction instead of a symmetric halo.
export function streakMask(size = 256) {
  return memo(`streak${size}`, () => {
    const c = canvas(size), ctx = c.getContext('2d');
    const img = ctx.createImageData(size, size);
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const u = x / size, v = y / size;
        // taper along x, thin toward the tail
        const width = 0.5 * Math.pow(1 - u, 0.7);
        const dy = Math.abs(v - 0.5);
        let a = Math.max(0, 1 - dy / Math.max(width, 1e-3));
        a *= Math.pow(1 - u, 0.55);
        a *= 0.75 + fbm(u * 9, v * 5, 3, 10, 61) * 0.5;
        const i = (y * size + x) * 4;
        img.data[i] = img.data[i + 1] = img.data[i + 2] = 255;
        img.data[i + 3] = Math.min(255, Math.pow(Math.max(0, a), 1.3) * 255);
      }
    }
    ctx.putImageData(img, 0, 0);
    return toTex(c);
  });
}

// ---------------------------------------------------- anime / ink-wash ----

// A brush-stroke mask: a tapered sweep with a dry, broken edge, the way a
// loaded brush behaves as it lifts. This is the base shape of nearly every
// anime attack effect — a slash, a breath, an energy arc are all one stroke.
//
// The important property is a HARD boundary. Anime VFX are painted with flat
// tones and crisp edges; a soft radial falloff is what makes an effect read as
// generic engine glow rather than as drawn art.
export function inkStroke(size = 512) {
  return memo(`ink${size}`, () => {
    const c = canvas(size), ctx = c.getContext('2d');
    const img = ctx.createImageData(size, size);
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const u = x / size, v = y / size;
        // spine of the stroke: bows across the quad
        const spine = 0.5 + Math.sin(u * Math.PI) * 0.10 - 0.05;
        // thickness swells in the middle and tapers hard at both ends
        const taper = Math.pow(Math.sin(Math.PI * Math.min(1, Math.max(0, u))), 0.55);
        const halfW = 0.30 * taper;
        const d = Math.abs(v - spine);

        // dry-brush break-up along the stroke
        const grain = fbm(u * 14, v * 5, 4, 16, 23);
        let a = d < halfW ? 1 : 0;
        // erode the edge with noise so it is broken rather than mathematically
        // smooth, but keep the transition SHORT so it stays hard
        const edge = (halfW - d) / Math.max(halfW, 1e-4);
        a *= edge > 0.32 ? 1 : Math.max(0, (edge / 0.32) - grain * 0.55);
        // streaks of missing ink through the body of the stroke
        if (grain > 0.72 && edge < 0.8) a *= 0.25;

        const i = (y * size + x) * 4;
        img.data[i] = img.data[i + 1] = img.data[i + 2] = 255;
        img.data[i + 3] = Math.max(0, Math.min(1, a)) * 255;
      }
    }
    ctx.putImageData(img, 0, 0);
    return toTex(c);
  });
}

// Concentric arcs with hard edges — the crest structure Demon Slayer uses for
// water breathing, and the shockwave ring for impacts.
export function inkArc(size = 512) {
  return memo(`inkarc${size}`, () => {
    const c = canvas(size), ctx = c.getContext('2d');
    const img = ctx.createImageData(size, size);
    const half = size / 2;
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const dx = (x - half) / half, dy = (y - half) / half;
        const r = Math.hypot(dx, dy);
        const ang = Math.atan2(dy, dx);
        // three nested arcs, each a hard band
        const wobble = fbm(Math.cos(ang) * 3 + 9, Math.sin(ang) * 3, 3, 8, 71) * 0.09;
        let a = 0;
        for (const [c0, w] of [[0.94, 0.055], [0.72, 0.038], [0.52, 0.026]]) {
          const band = Math.abs(r - (c0 + wobble));
          if (band < w) a = Math.max(a, 1 - (band / w) * 0.35);
        }
        // taper the arcs out toward the ends so they read as brush strokes
        const sweep = Math.cos(ang * 0.5);
        a *= Math.max(0, Math.pow(Math.abs(sweep), 0.5));
        const i = (y * size + x) * 4;
        img.data[i] = img.data[i + 1] = img.data[i + 2] = 255;
        img.data[i + 3] = Math.max(0, Math.min(1, a)) * 255;
      }
    }
    ctx.putImageData(img, 0, 0);
    return toTex(c);
  });
}

export function disposeVfxTextures() {
  for (const t of cache.values()) t?.dispose?.();
  cache.clear();
}
