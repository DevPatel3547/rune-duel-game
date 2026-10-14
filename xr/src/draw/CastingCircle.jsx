import { useRef, useMemo, useLayoutEffect } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { runeDiscTexture, glowSprite } from '../scene/textures.js';
import { noiseTexture } from '../scene/vfxTextures.js';

// ============================================================================
// THE CASTING CIRCLE
//
// The signature visual of gesture-magic games: the instant you begin drawing, a
// sigil blooms in the air in front of you and the stroke burns into it. Its
// absence is most of why casting here felt like sketching on glass — and the
// player looks at this more than anything else in the game.
//
// Three states, driven imperatively from the caster (which runs on raw pointer
// events, so routing this through React state would re-render the tree on every
// move):
//
//   idle     — invisible
//   drawing  — bloomed open, rings counter-rotating, breathing
//   resolve  — a hit flares and collapses INWARD as the spell leaves;
//              a fizzle blows APART. Same envelope, opposite sign, which is
//              what makes success and failure legible without reading text.
//
// Everything is additive, unlit and depth-tested off, so it survives against a
// bright arena and never gets occluded by the player's own stroke.
// ============================================================================

const RESOLVE_MS = 560;

export default function CastingCircle({ planeZ = -1.15, y = 1.34 }) {
  const group = useRef();
  const outer = useRef();
  const inner = useRef();
  const halo = useRef();
  const flash = useRef();
  const dust = useRef();

  const st = useRef({
    active: false,
    open: 0,
    spin: 0,
    resolveAt: 0,
    outcome: null,
    color: new THREE.Color('#c9a24a'),
  }).current;

  const tex = runeDiscTexture();

  // Motes drawn inward while charging — the circle should feel like it is
  // gathering something, not merely spinning.
  const motes = useMemo(() => {
    const N = 90;
    const g = new THREE.BufferGeometry();
    const pos = new Float32Array(N * 3);
    const seed = new Float32Array(N);
    for (let i = 0; i < N; i++) {
      const a = Math.random() * Math.PI * 2;
      const r = 0.30 + Math.random() * 0.55;
      pos[i * 3] = Math.cos(a) * r;
      pos[i * 3 + 1] = Math.sin(a) * r;
      pos[i * 3 + 2] = (Math.random() - 0.5) * 0.12;
      seed[i] = Math.random();
    }
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1));
    return g;
  }, []);

  const moteMat = useMemo(() => new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, depthTest: false,
    blending: THREE.AdditiveBlending,
    uniforms: {
      uTime: { value: 0 }, uOpen: { value: 0 },
      uMap: { value: glowSprite() }, uColor: { value: new THREE.Color('#e8c46a') },
    },
    vertexShader: /* glsl */`
      attribute float aSeed;
      uniform float uTime; uniform float uOpen;
      varying float vA;
      void main() {
        vec3 p = position;
        // spiral inward on a loop; the pull is what reads as "gathering"
        float t = fract(uTime * (0.28 + aSeed * 0.3) + aSeed);
        float r = mix(0.62, 0.06, t);
        float a = atan(p.y, p.x) + t * 2.4 + aSeed * 6.28;
        p.xy = vec2(cos(a), sin(a)) * r * length(position.xy);
        vA = (1.0 - t) * uOpen;
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        // PIXELS, not world units: at ~1.15m this must stay in single digits.
        gl_PointSize = (1.6 + aSeed * 3.4) * uOpen * 1.15 / -mv.z;
        gl_Position = projectionMatrix * mv;
      }
    `,
    fragmentShader: /* glsl */`
      uniform sampler2D uMap; uniform vec3 uColor;
      varying float vA;
      void main() {
        float a = texture2D(uMap, gl_PointCoord).a * vA;
        if (a < 0.01) discard;
        gl_FragColor = vec4(uColor, a);
      }
    `,
  }), []);

  useLayoutEffect(() => {
    CIRCLE = st;
    return () => { if (CIRCLE === st) CIRCLE = null; };
  }, [st]);
  useLayoutEffect(() => () => { motes.dispose(); moteMat.dispose(); }, [motes, moteMat]);

  useFrame((_, dt) => {
    const now = performance.now();
    const resolving = st.resolveAt > 0;
    const rp = resolving ? Math.min(1, (now - st.resolveAt) / RESOLVE_MS) : 0;
    if (resolving && rp >= 1) { st.resolveAt = 0; st.outcome = null; }

    st.open += ((st.active ? 1 : 0) - st.open) * Math.min(1, dt * (st.active ? 15 : 8));
    st.spin += dt * (0.4 + st.open * 1.9);

    const vis = st.open > 0.01 || resolving;
    if (group.current) group.current.visible = vis;
    if (!vis) return;

    // Success draws inward as the spell departs; failure blows apart.
    const collapse = st.outcome === 'ok' ? -rp * 0.6
      : st.outcome === 'fail' ? rp * 1.1 : 0;
    const s = (0.5 + st.open * 0.5) * (1 + collapse);
    const fade = resolving ? (1 - rp) * (1 - rp) : st.open;

    if (outer.current) {
      outer.current.rotation.z = st.spin * 0.32;
      outer.current.scale.setScalar(s);
      outer.current.material.opacity = fade * 0.5;
      outer.current.material.color.copy(st.color);
    }
    if (inner.current) {
      inner.current.rotation.z = -st.spin * 0.58;
      inner.current.scale.setScalar(s * 0.6);
      inner.current.material.opacity = fade * 0.38;
      inner.current.material.color.copy(st.color);
    }
    if (halo.current) {
      halo.current.scale.setScalar(s * 1.5);
      halo.current.material.opacity = fade * 0.12;
      halo.current.material.color.copy(st.color);
    }
    if (flash.current) {
      const f = resolving ? Math.max(0, 1 - rp * 3.2) : 0;
      flash.current.scale.setScalar(s * (1.4 + rp * 2.6));
      flash.current.material.opacity = f * 0.9;
      flash.current.material.color.copy(st.color);
      flash.current.visible = f > 0.01;
    }
    moteMat.uniforms.uTime.value += dt;
    moteMat.uniforms.uOpen.value = st.active ? st.open : fade * 0.5;
    moteMat.uniforms.uColor.value.copy(st.color);
  });

  return (
    <group ref={group} position={[0, y, planeZ]} visible={false}>
      <sprite ref={halo} scale={1}>
        <spriteMaterial map={glowSprite()} transparent opacity={0} depthWrite={false} depthTest={false} blending={THREE.AdditiveBlending} toneMapped={false} />
      </sprite>
      <mesh ref={outer}>
        <planeGeometry args={[0.82, 0.82]} />
        <meshBasicMaterial map={tex} transparent opacity={0} depthWrite={false} depthTest={false} blending={THREE.AdditiveBlending} toneMapped={false} />
      </mesh>
      <mesh ref={inner}>
        <planeGeometry args={[0.82, 0.82]} />
        <meshBasicMaterial map={tex} transparent opacity={0} depthWrite={false} depthTest={false} blending={THREE.AdditiveBlending} toneMapped={false} />
      </mesh>
      <points geometry={motes} material={moteMat} frustumCulled={false} />
      <sprite ref={flash} scale={1}>
        <spriteMaterial map={glowSprite()} transparent opacity={0} depthWrite={false} depthTest={false} blending={THREE.AdditiveBlending} toneMapped={false} />
      </sprite>
    </group>
  );
}

// Imperative handle — see the note at the top about why this is not React state.
export let CIRCLE = null;

export function circleBegin(color) {
  if (!CIRCLE) return;
  CIRCLE.active = true;
  CIRCLE.resolveAt = 0;
  CIRCLE.outcome = null;
  if (color) CIRCLE.color.set(color);
}
export function circleTint(color) {
  if (CIRCLE && color) CIRCLE.color.set(color);
}
export function circleEnd(ok, color) {
  if (!CIRCLE) return;
  CIRCLE.active = false;
  CIRCLE.outcome = ok ? 'ok' : 'fail';
  CIRCLE.resolveAt = performance.now();
  if (color) CIRCLE.color.set(color);
}
