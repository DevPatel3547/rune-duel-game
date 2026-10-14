import * as THREE from 'three';
import { noiseTexture, cellTexture } from './vfxTextures.js';

// ============================================================================
// THE EROSION MATERIAL
//
// This is the single technique that separates a professional real-time effect
// from a blob. Instead of fading an effect's alpha uniformly — which shrinks a
// round shape into a smaller round shape — the alpha is thresholded against a
// scrolling noise field. As the threshold rises, the effect DISSOLVES: holes
// open in it, tendrils separate, the silhouette breaks up into intricate
// detail, exactly the way fire and energy actually disperse.
//
// Two further pieces come free once erosion exists:
//
//   * The EROSION RIM. Sampling just above and just below the threshold gives a
//     thin band tracking the dissolving edge. Rendering that band far hotter
//     than the body is what produces the burning, white-hot edge on every good
//     fire or magic effect.
//
//   * DISTORTION. Offsetting the mask lookup by a second scrolling noise makes
//     the shape churn rather than merely slide, which is what stops a scrolling
//     texture from reading as a scrolling texture.
//
// Uniforms are driven per-frame by the effect that owns the material.
// ============================================================================

const vert = /* glsl */`
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const frag = /* glsl */`
  uniform sampler2D uMask;     // the effect's silhouette
  uniform sampler2D uNoise;    // erosion / distortion driver
  uniform sampler2D uCell;     // cellular break-up
  uniform vec3  uColor;        // body colour
  uniform vec3  uRimColor;     // colour of the dissolving edge (hotter)
  uniform float uErode;        // 0 = whole, 1 = fully dissolved
  uniform float uRimWidth;
  uniform float uRimPower;
  uniform float uTime;
  uniform float uScroll;       // how fast the noise moves through the shape
  uniform float uDistort;
  uniform float uOpacity;
  uniform float uCellMix;      // how much cellular structure to blend in

  varying vec2 vUv;

  void main() {
    vec2 uv = vUv;

    // --- distortion: churn the lookup with a second, slower noise ---------
    vec2 dUv = uv * 1.7 + vec2(uTime * 0.05, -uTime * 0.07);
    float dn = texture2D(uNoise, dUv).r - 0.5;
    uv += dn * uDistort;

    // --- silhouette -------------------------------------------------------
    float mask = texture2D(uMask, uv).a;
    if (mask <= 0.001) discard;

    // --- erosion field ----------------------------------------------------
    vec2 nUv = uv * 2.1 + vec2(-uTime * uScroll, uTime * uScroll * 0.6);
    float n = texture2D(uNoise, nUv).r;
    float cell = texture2D(uCell, uv * 1.6 + vec2(uTime * uScroll * 0.4, 0.0)).r;
    n = mix(n, n * 0.45 + cell * 0.55, uCellMix);

    // Fold the silhouette into the field so the shape erodes from its edges
    // inward rather than uniformly across the quad.
    float field = n * 0.62 + mask * 0.38;

    // Threshold sweeps as uErode rises. IMPORTANT: the erosion term alone can
    // collapse to zero everywhere if the noise happens to sit below the
    // threshold, which silently produces an invisible effect. A guaranteed
    // base term (the plain silhouette, fading with erosion) keeps the effect
    // present no matter what the noise does; erosion then carves detail INTO
    // it rather than being solely responsible for whether anything is drawn.
    float t = uErode * 1.05;
    float carved = smoothstep(t, t + 0.20, field);
    float base = mask * (1.0 - uErode);
    float alpha = max(base * 0.42, carved * mask * 0.85);
    if (alpha <= 0.003) discard;

    // --- the burning rim --------------------------------------------------
    // The band tracking the dissolving edge — rendered far hotter than the
    // body, which is what produces the burning edge on real fire and magic.
    float rim = smoothstep(t, t + uRimWidth, field) *
                (1.0 - smoothstep(t + uRimWidth, t + uRimWidth * 2.4, field));
    rim *= mask;

    // Intensities are deliberately well above 1.0. These materials are
    // additive and unlit, and the bloom threshold sits at 0.95 — an effect
    // authored at "correct" 0..1 values simply never blooms, and reads as a
    // dull wash against an arena full of emissive light.
    // Above 1.0 so the effect crosses the 0.95 bloom threshold, but only just:
    // at 1.8/4.5 the blast blew the whole frame to white.
    vec3 col = uColor * 1.05;
    col += uRimColor * pow(rim, uRimPower) * 1.9;
    col += uColor * pow(mask, 3.0) * 0.9;

    gl_FragColor = vec4(col, clamp(alpha * uOpacity, 0.0, 1.0));
  }
`;

export function createVfxMaterial({
  mask,
  color = '#ffffff',
  rimColor = '#ffffff',
  scroll = 0.28,
  distort = 0.05,
  rimWidth = 0.09,
  rimPower = 1.4,
  cellMix = 0.5,
  blending = THREE.AdditiveBlending,
  depthWrite = false,
  // Impact effects spawn AT the thing they hit, so a camera-facing quad there
  // sits half inside that mesh and gets depth-rejected. Effects of this kind
  // are conventionally drawn on top for exactly this reason.
  depthTest = false,
  side = THREE.DoubleSide,
} = {}) {
  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite,
    depthTest,
    blending,
    side,
    toneMapped: false,
    vertexShader: vert,
    fragmentShader: frag,
    uniforms: {
      uMask: { value: mask },
      uNoise: { value: noiseTexture() },
      uCell: { value: cellTexture() },
      uColor: { value: new THREE.Color(color) },
      uRimColor: { value: new THREE.Color(rimColor) },
      uErode: { value: 0 },
      uRimWidth: { value: rimWidth },
      uRimPower: { value: rimPower },
      uTime: { value: 0 },
      uScroll: { value: scroll },
      uDistort: { value: distort },
      uOpacity: { value: 1 },
      uCellMix: { value: cellMix },
    },
  });
}

// Advance a vfx material's clock and erosion in one call.
export function stepVfx(mat, dt, erode, opacity = 1) {
  if (!mat) return;
  mat.uniforms.uTime.value += dt;
  mat.uniforms.uErode.value = erode;
  mat.uniforms.uOpacity.value = opacity;
}
