// ============================================================================
// VFX STYLE
//
// A single switch for how spell effects are CONSTRUCTED, so competing art
// directions can be rendered from the same game state and compared frame for
// frame instead of argued about in the abstract.
//
//   'current' — soft additive glow. One eroding halo sprite, one tapered
//               additive ribbon, one burst. Everything is the same material
//               tinted differently, which is why every spell reads as the same
//               blob in a different colour.
//   'anime'   — layered. Hard three-band cel colour (white core / saturated
//               body / dark edge), a SMOOTHED ribbon, speed lines, afterimages
//               and a multi-part impact. The point is quantity and variety of
//               elements: an anime attack is a dozen overlapping things, and
//               that density is most of what separates it from engine glow.
//   'ink'     — the same layering, but every element is a brush form from
//               `inkStroke`/`inkArc` with a heavy dark outline and a flatter,
//               more limited palette. Reads as drawn rather than emitted.
//
// The default is what ships. `window.__vfxStyle` overrides it in dev only, so
// the comparison harness can capture all three from one build.
// ============================================================================

export const STYLES = ['current', 'anime', 'ink'];

// Ships as the layered treatment. The old soft-glow build stays reachable via
// `window.__vfxStyle = 'current'` in dev, purely so a regression can be diffed
// against it.
export const DEFAULT_STYLE = 'anime';

export const vfxStyle = () => {
  if (import.meta.env?.DEV && typeof window !== 'undefined' && window.__vfxStyle) {
    return STYLES.includes(window.__vfxStyle) ? window.__vfxStyle : DEFAULT_STYLE;
  }
  return DEFAULT_STYLE;
};

// Cel palettes are built by VALUE, not by hue: a white-hot core, the spell's
// own colour for the body, and a dark edge that is the spell colour crushed
// toward black rather than a neutral grey — a grey outline greys out the whole
// effect, which is the single fastest way to make cel shading look cheap.
import * as THREE from 'three';

export function celBands(hex) {
  const body = new THREE.Color(hex);
  // The core used to sit 78% of the way to white. Every spell's brightest
  // region was therefore WHITE, bloom spread that white over the hottest part
  // of the effect, and a yellow Bolt and an orange Quake became the same warm
  // dot. Keeping the hue in the core is most of what makes thirty spells
  // distinguishable at a glance; the heat comes from additive blending, not
  // from desaturating toward paper.
  const core = body.clone().lerp(new THREE.Color('#ffffff'), 0.3);
  const edge = body.clone().multiplyScalar(0.18);
  return { core, body, edge };
}
