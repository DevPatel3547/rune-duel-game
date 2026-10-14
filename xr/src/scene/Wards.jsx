import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { SHIELD_ABSORB } from '@rune/shared';
import { useGame } from '../store.js';
import { OPP_DIST, HEAD_HEIGHT } from '../config.js';
import { damp } from './anim.js';
import { flareSprite } from './textures.js';

// ============================================================================
// WARDS — a raised shield stays visible for as long as it lasts.
//
// Shield, Ward, Bulwark and Reflect hold for seconds, but their cast effect was
// a 0.9 s bloom. After it faded nothing in the world showed that a wizard was
// protected, so the decision the shield layer exists for — hold fire, or switch
// to Pierce? — had to be made by squinting at a bar. Online you could not see
// the opponent's shield at all.
//
// Now each duelist wears a hex barrier whose strength tracks what is left of
// it. It flares when it absorbs a hit and shatters when it breaks.
//
// The opponent's is a dome around them, lit at its silhouette by a Fresnel
// term. The player's is the front of a sphere seen from INSIDE, and there the
// Fresnel term is useless — from the centre every point faces the eye — so it
// is masked in SCREEN space instead: clear through the middle, where you aim,
// rising only toward the edges of the frame.
// ============================================================================

const vert = /* glsl */`
  varying vec2 vUv;
  varying vec3 vN;
  varying vec3 vV;
  void main() {
    vUv = uv;
    vec4 wp = modelMatrix * vec4(position, 1.0);
    vN = normalize(mat3(modelMatrix) * normal);
    vV = normalize(cameraPosition - wp.xyz);
    gl_Position = projectionMatrix * viewMatrix * wp;
  }
`;

const frag = /* glsl */`
  uniform vec3 uColor;
  uniform float uStrength;  // 0..~1.2, what is left of the shield
  uniform float uFlash;     // 0..1, a hit being absorbed
  uniform float uTime;
  uniform vec2 uHexScale;
  uniform float uInside;    // 1 for the player's own ward, seen from within
  uniform vec2 uRes;        // drawing buffer size, for the screen-space mask
  varying vec2 vUv;
  varying vec3 vN;
  varying vec3 vV;

  // Distance to the edge of a unit hexagon, and the hex cell a point falls in.
  float hexDist(vec2 p) {
    p = abs(p);
    return max(dot(p, normalize(vec2(1.0, 1.7320508))), p.x);
  }
  vec4 hexCell(vec2 uv) {
    vec2 r = vec2(1.0, 1.7320508);
    vec2 h = r * 0.5;
    vec2 a = mod(uv, r) - h;
    vec2 b = mod(uv - h, r) - h;
    vec2 gv = dot(a, a) < dot(b, b) ? a : b;
    return vec4(gv, uv - gv);
  }

  void main() {
    vec4 c = hexCell(vUv * uHexScale);
    float edge = smoothstep(0.40, 0.49, hexDist(c.xy));
    float rnd = fract(sin(dot(c.zw, vec2(12.9898, 78.233))) * 43758.5453);
    // cells ripple in and out of brightness, so the barrier reads as energy
    float shimmer = 0.5 + 0.5 * sin(uTime * 2.4 + rnd * 6.2831);
    float fres = pow(1.0 - abs(dot(normalize(vN), normalize(vV))), 2.4);

    // Inside: fade by distance from the centre of the screen, elliptical to its
    // shape, so a portrait phone keeps the same clear window as a monitor.
    // Clear through the centre and most of each side; the barrier gathers in
    // the corners, where it frames the duel without covering any of it.
    vec2 q = gl_FragCoord.xy / uRes - 0.5;
    float frame = smoothstep(0.38, 0.72, length(q));
    float mask = mix(1.0, frame, uInside);
    float glow = mix(fres, frame, uInside);

    float body = (edge * (0.30 + shimmer * 0.25) + glow * 0.95) * mask;
    float a = body * uStrength + uFlash * (0.25 + edge * 0.85 + glow * 0.6) * mask;
    vec3 col = uColor * (1.0 + uFlash * 1.6) + vec3(1.0) * edge * uFlash * 0.7;
    gl_FragColor = vec4(col * a, a);
  }
`;

function wardMaterial(color, hexScale, inside) {
  return new THREE.ShaderMaterial({
    vertexShader: vert,
    fragmentShader: frag,
    uniforms: {
      uColor: { value: new THREE.Color(color) },
      uStrength: { value: 0 },
      uFlash: { value: 0 },
      uTime: { value: 0 },
      uHexScale: { value: new THREE.Vector2(hexScale[0], hexScale[1]) },
      uInside: { value: inside ? 1 : 0 },
      uRes: { value: new THREE.Vector2(1, 1) },
    },
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
    toneMapped: false,
  });
}

export default function Wards() {
  return (
    <>
      <Ward side="opponent" />
      <Ward side="you" />
    </>
  );
}

const SHARDS = 18;

function Ward({ side }) {
  const mine = side === 'you';
  const color = useGame((s) => s.wards[side]);

  // Hex cells stay regular only if cells-per-radian match on both axes. A full
  // sphere's UVs span 2π across and π down, hence 22 × 11. The player's segment
  // covers 0.32 of U over 0.64π and 0.6 of V over 0.6π — the same 2:1 ratio,
  // just more cells so they read at arm's length.
  const material = useMemo(() => wardMaterial(color, mine ? [96, 48] : [22, 11], mine), []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { material.uniforms.uColor.value.set(color); }, [color, material]);

  const geometry = useMemo(() => (mine
    // front of a sphere centred on the player: phi around 1.5π faces −Z
    ? new THREE.SphereGeometry(1.7, 48, 24, Math.PI * 1.18, Math.PI * 0.64, Math.PI * 0.2, Math.PI * 0.6)
    : new THREE.SphereGeometry(1.1, 48, 32)), [mine]);
  useEffect(() => () => { material.dispose(); geometry.dispose(); }, [material, geometry]);

  // Fixed outward directions for the shatter, generated once.
  const dirs = useMemo(() => Array.from({ length: SHARDS }, () => new THREE.Vector3(
    Math.random() * 2 - 1, Math.random() * 1.4 - 0.4, Math.random() * 2 - 1,
  ).normalize()), []);

  const group = useRef();
  const shell = useRef();
  const shards = useRef([]);
  const st = useRef({ strength: 0, last: 0, flash: 0, shatter: 0, lateral: 0 });

  useFrame((state, rawDt) => {
    const dt = Math.min(0.05, rawDt);
    const g = useGame.getState();
    const s = st.current;
    if (mine) state.gl.getDrawingBufferSize(material.uniforms.uRes.value);
    const raw = mine ? (g.resources?.shield ?? 0) : (g.oppShield ?? 0);

    // A drop in the shield is a hit being absorbed; a drop to nothing is the
    // ward breaking (or running out, which should read the same way: gone).
    if (raw < s.last - 0.5) {
      if (raw <= 0.5) s.shatter = 1;
      else s.flash = 1;
    }
    s.last = raw;

    const target = Math.min(1.2, raw / SHIELD_ABSORB);
    s.strength = damp(s.strength, target, target > s.strength ? 9 : 7, dt);
    s.flash = Math.max(0, s.flash - dt * 3.4);
    s.shatter = Math.max(0, s.shatter - dt * 2.2);

    const visible = s.strength > 0.01 || s.flash > 0 || s.shatter > 0;
    if (group.current) group.current.visible = visible;
    if (!visible) return;

    material.uniforms.uTime.value += dt;
    // the player's own barrier is kept faint: it frames the view, never fogs it
    material.uniforms.uStrength.value = s.strength * (mine ? 0.75 : 1);
    material.uniforms.uFlash.value = (s.flash + s.shatter * 0.8) * (mine ? 0.55 : 1);

    if (group.current) {
      if (mine) {
        group.current.position.set(g.move.x, HEAD_HEIGHT - 0.15, 0.4);
      } else {
        s.lateral = damp(s.lateral, -(g.oppX || 0), 9, dt);
        group.current.position.set(s.lateral, 1.18, -OPP_DIST);
      }
    }
    if (shell.current) {
      // a breaking ward bursts outward as it goes
      const burst = s.shatter > 0 ? 1 + (1 - s.shatter) * 0.28 : 1;
      shell.current.scale.set(burst, burst * (mine ? 1 : 1.28), burst);
    }

    shards.current.forEach((sp, i) => {
      if (!sp) return;
      sp.visible = s.shatter > 0;
      if (!sp.visible) return;
      const travel = 1.1 + (1 - s.shatter) * 1.6;
      sp.position.copy(dirs[i]).multiplyScalar(travel).setY(dirs[i].y * travel * 1.28);
      sp.material.opacity = s.shatter * 0.9;
      sp.scale.setScalar(0.12 + s.shatter * 0.12);
    });
  });

  return (
    <group ref={group} visible={false}>
      <mesh ref={shell} geometry={geometry} material={material} renderOrder={5} />
      {/* shards fly from the opponent's dome; a burst of them at the camera
          would just be noise in the player's face */}
      {!mine && dirs.map((_, i) => (
        <sprite key={i} ref={(el) => { shards.current[i] = el; }} visible={false}>
          <spriteMaterial
            map={flareSprite()} color={color} transparent opacity={0}
            blending={THREE.AdditiveBlending} depthWrite={false} toneMapped={false}
          />
        </sprite>
      ))}
    </group>
  );
}
