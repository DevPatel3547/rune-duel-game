// Device-tier detection → quality knobs. Runs once at boot. We keep the flashy
// stuff (bloom, tone-mapping, big starfields, shadows) on capable machines and
// dial it back on phones so the duel stays at a smooth framerate everywhere.
// An explicit override always wins over detection. Two reasons this exists:
//   * players on hardware we guess wrong about need an escape hatch — the
//     reflective floor and AO are by far the most expensive things here, and a
//     mid-range phone that reports 8 cores can still choke on them;
//   * the headless test harness renders through SwiftShader, where a mirror
//     floor runs at well under 1 fps and the fixed-timestep simulation then
//     correctly (but unhelpfully) advances in slow motion.
//
// Set via ?q=low|mid|high, and remembered so a player who dials it down keeps
// their choice.
const TIERS = ['low', 'mid', 'high'];

function overrideTier() {
  if (typeof window === 'undefined') return null;
  try {
    const q = new URLSearchParams(window.location.search).get('q');
    if (TIERS.includes(q)) {
      window.localStorage?.setItem('rd.quality', q);
      return q;
    }
    const saved = window.localStorage?.getItem('rd.quality');
    if (TIERS.includes(saved)) return saved;
  } catch {
    // private-mode storage or a cross-origin frame — detection is a fine
    // fallback, this must never break boot
  }
  return null;
}

export function detectTier() {
  const forced = overrideTier();
  if (forced) return forced;
  if (typeof navigator === 'undefined') return 'high';
  const mem = navigator.deviceMemory || 4;              // GB (Chrome only; guess 4)
  const cores = navigator.hardwareConcurrency || 4;
  const coarse = typeof window !== 'undefined' && window.matchMedia?.('(pointer: coarse)').matches;
  const mobile = /android|iphone|ipad|ipod|mobile/i.test(navigator.userAgent) || !!coarse;

  let score = 0;
  score += mem >= 8 ? 2 : mem >= 4 ? 1 : 0;
  score += cores >= 8 ? 2 : cores >= 4 ? 1 : 0;
  if (mobile) score -= 1;

  if (score >= 3) return 'high';
  if (score >= 1) return 'mid';
  return 'low';
}

// Per-tier settings consumed across the scene.
// `reflect` = a real reflective floor, which re-renders the scene into a mirror
// buffer every frame — desktop GPUs only.
// `ao` = screen-space ambient occlusion. It is the most expensive single pass
// here (it samples the depth buffer many times per pixel), so it is off on
// low-end devices and runs at half resolution below the high tier.
export const QUALITY = {
  low:  { dpr: [1, 1.5], aa: false, shadows: false, effects: false, ao: false, reflect: false, godrays: false, stars: 1400, particleScale: 0.6 },
  mid:  { dpr: [1, 2],   aa: true,  shadows: true,  effects: true,  smaa: false, ao: true,  reflect: false, godrays: true,  stars: 2600, particleScale: 1.0 },
  high: { dpr: [1, 2],   aa: true,  shadows: true,  effects: true,  smaa: true,  ao: true,  reflect: true,  godrays: true,  stars: 4000, particleScale: 1.25 },
};

export const TIER = detectTier();
export const Q = QUALITY[TIER];

// Change the quality tier and reload. A live swap would mean rebuilding the
// renderer, the post pipeline and every tier-dependent material, so a reload is
// both simpler and more reliable.
export function setTier(tier) {
  if (!TIERS.includes(tier) || typeof window === 'undefined') return;
  try { window.localStorage?.setItem('rd.quality', tier); } catch { /* ignore */ }
  const url = new URL(window.location.href);
  url.searchParams.set('q', tier);
  window.location.replace(url.toString());
}
