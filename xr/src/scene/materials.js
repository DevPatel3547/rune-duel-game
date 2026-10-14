import * as THREE from 'three';
import { TIER } from '../perf.js';
import { toonMaterial } from './toon.js';

// ============================================================================
// SCANNED PBR MATERIALS
//
// Real photoscanned material from Poly Haven (CC0), replacing the procedural
// noise textures for every surface that is meant to look like a physical
// substance.
//
// WHY THIS AND NOT MORE PROCEDURAL WORK: noise can reproduce the statistics of
// a surface — its roughness distribution, its frequency content — but not its
// HISTORY. Real fabric has wear where it folds; real metal has pitting where it
// was struck; real stone weathers unevenly because water ran down it in
// particular places. That history is most of what the eye uses to judge whether
// a surface is real, and no amount of fbm produces it.
//
// The 'arm' convention packs Ambient occlusion / Roughness / Metalness into the
// R / G / B channels of one image, which is exactly the layout three.js reads
// when the same texture is assigned to aoMap, roughnessMap and metalnessMap —
// one fetch and one sampler instead of three.
// ============================================================================

const BASE = `${import.meta.env.BASE_URL || '/'}`.replace(/\/+$/, '/');
const loader = new THREE.TextureLoader();
const cache = new Map();

function load(url, { srgb = false, repeat = [1, 1] } = {}) {
  const key = `${url}@${repeat[0]}x${repeat[1]}@${srgb}`;
  if (cache.has(key)) return cache.get(key);
  const t = loader.load(BASE + url);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(repeat[0], repeat[1]);
  t.anisotropy = TIER === 'high' ? 8 : 4;
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  cache.set(key, t);
  return t;
}

// Build a full PBR material from a packed scan set.
//   name   — cloth | leather | metal | rock | stone
//   repeat — how many times it tiles across the surface
// Cel-shaded variant of a scanned material. Keeps the photoscanned colour and
// normal detail — which still reads through banding and is most of what stops
// toon shading looking like flat vector art — but quantises the lighting so the
// set matches the characters. A toon character in a photoreal environment is
// the worst of both: neither reads as intentional.
export function scannedToon(name, {
  repeat = [1, 1],
  color = '#ffffff',
  rimColor = '#35d6ff',
  rimPower = 3.0,
  rimStrength = 0.35,
  normalScale = 0.7,
  stops,
  levels,
  side = THREE.FrontSide,
} = {}) {
  return toonMaterial({
    color,
    map: load(`tex/${name}_color.webp`, { srgb: true, repeat }),
    normalMap: load(`tex/${name}_nor_gl.webp`, { repeat }),
    normalScale, rimColor, rimPower, rimStrength, stops, levels, side,
  });
}

export function scannedMaterial(name, {
  repeat = [1, 1],
  color = '#ffffff',
  roughness = 1,
  metalness = 0,
  normalScale = 1,
  envMapIntensity = 1,
  side = THREE.FrontSide,
  aoIntensity = 1,
} = {}) {
  const mat = new THREE.MeshStandardMaterial({
    color: new THREE.Color(color),
    roughness,
    metalness,
    envMapIntensity,
    side,
  });

  mat.map = load(`tex/${name}_color.webp`, { srgb: true, repeat });
  mat.normalMap = load(`tex/${name}_nor_gl.webp`, { repeat });
  mat.normalScale = new THREE.Vector2(normalScale, normalScale);

  // One image drives three channels. three.js reads G for roughness and B for
  // metalness automatically when the same texture is bound to both.
  const arm = load(`tex/${name}_arm.webp`, { repeat });
  mat.roughnessMap = arm;
  mat.metalnessMap = arm;
  mat.aoMap = arm;
  mat.aoMapIntensity = aoIntensity;

  return mat;
}

// aoMap samples uv2 in three.js. Meshes built from primitives only have uv, so
// without this the AO channel is silently ignored.
export function enableAO(geometry) {
  if (geometry && geometry.attributes.uv && !geometry.attributes.uv2) {
    geometry.setAttribute('uv2', geometry.attributes.uv);
  }
  return geometry;
}
