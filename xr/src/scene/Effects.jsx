import { useRef, useMemo, useState } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import {
  EffectComposer, Bloom, Vignette, SMAA, ChromaticAberration, Noise, GodRays,
} from '@react-three/postprocessing';
import { BlendFunction } from 'postprocessing';
import { N8AOPostPass } from 'n8ao';
import { useXR } from '@react-three/xr';
import * as THREE from 'three';
import { Q, TIER } from '../perf.js';
import { useHitFeel } from './feel.js';

// ============================================================================
// POST-PROCESSING
//
// Order matters: AO must run before bloom, so that darkened creases are not
// then re-brightened by the bloom pass sampling them.
//
// AMBIENT OCCLUSION is the single biggest "is this real" lever left. Direct
// lighting alone leaves every contact point — where a pillar meets the floor,
// inside the wizard's hood, under the robe hem — lit as brightly as an exposed
// surface, which is what makes untextured 3D read as plastic. AO darkens
// crevices and contact points and instantly grounds objects in the scene.
//
// Bloom does the emissive work: every glow in the game (portal, rune circle,
// braziers, spell cores, the wizard's eyes) is authored above the bloom
// threshold so it reads as light rather than as bright-coloured paint.
//
// Chromatic aberration and bloom overdrive are driven by combat, so an impact
// physically disturbs the image instead of merely playing an animation.
// ============================================================================

export default function Effects() {
  const inVR = !!useXR((s) => s.session);
  // The god-ray pass needs the emitter mesh itself. It is created by the arena
  // and registered here, so Effects does not have to know where the light is.
  const [sun, setSun] = useState(null);
  useSunRegistration(setSun);
  if (inVR || !Q.effects) return null;
  return <Stack sun={sun} />;
}

// The portal in the great arch is the scene's light source. Arena publishes its
// mesh via this tiny registry rather than threading a ref through the tree.
let SUN_MESH = null;
const SUN_LISTENERS = new Set();
export function registerSun(mesh) {
  SUN_MESH = mesh;
  SUN_LISTENERS.forEach((fn) => fn(mesh));
}
function useSunRegistration(setSun) {
  useMemo(() => {
    if (SUN_MESH) setSun(SUN_MESH);
    SUN_LISTENERS.add(setSun);
    return () => SUN_LISTENERS.delete(setSun);
  }, [setSun]);
}

function Stack({ sun }) {
  const { scene, camera } = useThree();
  const ca = useRef();
  const bloom = useRef();
  const offset = useRef(new THREE.Vector2()).current;

  // N8AO ships as a raw postprocessing Pass, not an R3F component, so it is
  // constructed once and dropped into the composer as a primitive.
  const ao = useMemo(() => {
    if (!Q.ao) return null;
    const pass = new N8AOPostPass(scene, camera);
    // aoRadius is in WORLD UNITS. The arena deck is ~15 m across, and a radius
    // anywhere near 1 m makes distant floor pixels sample geometry metres away,
    // which came back as large jagged dark shards smeared over the whole floor.
    // Contact occlusion is a centimetres-scale effect: keep it small.
    pass.configuration.aoRadius = 0.35;
    pass.configuration.distanceFalloff = 0.4;
    pass.configuration.intensity = TIER === 'high' ? 2.6 : 2.0;
    pass.configuration.aoSamples = TIER === 'high' ? 24 : 12;
    pass.configuration.denoiseSamples = TIER === 'high' ? 12 : 6;
    pass.configuration.denoiseRadius = 8;
    // Full-res: at half res the denoiser cannot resolve the thin contact bands
    // this scene is full of (hood, hem, pillar bases) and they alias badly.
    pass.configuration.halfRes = false;
    // tint occlusion toward the scene's cool shadow colour rather than pure
    // black, which keeps crevices from reading as holes punched in the image
    pass.configuration.color = new THREE.Color('#120a24');
    return pass;
  }, [scene, camera]);

  useFrame(() => {
    const { shake, flash } = useHitFeel.getState();
    if (ca.current) {
      // UV-space offsets, so these are tiny by nature: 0.01 shifts the red and
      // blue channels a full 1% of the screen apart and fringes every edge in
      // the frame. This should be felt, not seen.
      const amt = 0.00015 + shake * 0.0016;
      offset.set(amt, amt * 0.6);
      ca.current.offset = offset;
    }
    if (bloom.current) bloom.current.intensity = BLOOM_BASE + flash * 0.75;
  });

  return (
    <EffectComposer multisampling={0} enableNormalPass={false}>
      {ao ? <primitive object={ao} /> : <></>}
      {/* TRUE VOLUMETRIC LIGHT SCATTERING, not the cones this replaced. The
          pass radially blurs the frame away from the light's screen position,
          masked by what occludes it — so the colonnade and the opponent
          actually cut shadows into the beams. `decay`/`density`/`weight` are
          the classic Mitchell parameters: how fast a sample loses energy, how
          far apart samples march, and how much each contributes. */}
      {sun && Q.godrays ? (
        <GodRays
          sun={sun}
          blendFunction={BlendFunction.SCREEN}
          samples={TIER === 'high' ? 60 : 30}
          density={0.86}
          decay={0.92}
          weight={0.22}
          exposure={0.26}
          clampMax={0.7}
          blur
        />
      ) : <></>}
      <Bloom
        ref={bloom}
        mipmapBlur
        intensity={BLOOM_BASE}
        luminanceThreshold={0.95}
        luminanceSmoothing={0.28}
        radius={0.78}
      />
      <ChromaticAberration
        ref={ca}
        blendFunction={BlendFunction.NORMAL}
        offset={[0.00015, 0.0001]}
        radialModulation
        modulationOffset={0.22}
      />
      <Vignette eskil={false} offset={0.22} darkness={0.82} />
      {/* a whisper of grain — kills the colour banding that is very visible in
          the dark nebula gradients on 8-bit displays */}
      <Noise premultiply blendFunction={BlendFunction.SOFT_LIGHT} opacity={0.16} />
      {/* NOTE: tone mapping stays on the renderer (ACES, set in App.jsx). three
          applies it per-material, so adding a ToneMapping pass here would apply
          the curve twice and wash the frame out. */}
      {Q.smaa ? <SMAA /> : <></>}
    </EffectComposer>
  );
}

const BLOOM_BASE = TIER === 'high' ? 1.15 : 0.85;
