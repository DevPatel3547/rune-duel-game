import { useRef, useMemo, useLayoutEffect } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { Q, TIER } from '../perf.js';

// ============================================================================
// THE VOID SEA
//
// The arena is a broken temple floating in a nebula; beneath it lies an
// endless, slow, luminous ocean. It exists for one reason: the frame had
// nothing below the horizon, so the platform read as a model on a black table
// rather than a place suspended over something.
//
// TECHNIQUE
//
// * GERSTNER (trochoidal) WAVES, not sine. A sine wave moves water vertically
//   only, which reads as a rippling sheet. Gerstner also moves each vertex
//   HORIZONTALLY, backwards under the crest, which sharpens peaks and flattens
//   troughs — the actual shape of water. Summing a few waves at different
//   angles, wavelengths and steepnesses gives a surface that never visibly
//   repeats.
//
// * ANALYTIC NORMALS. Because a Gerstner sum is differentiable, the surface
//   normal comes out of the same maths as the displacement — exact, free, and
//   immune to the faceting you get from finite-difference normals on a coarse
//   mesh.
//
// * SCHLICK FRESNEL. Water is almost transparent looking straight down and
//   almost a mirror at grazing angles. Getting that ratio right is most of what
//   makes water look like water rather than blue plastic.
//
// * CREST FOAM derived from wave steepness — foam appears where the surface is
//   most compressed, which is where it appears in reality.
//
// The mesh is a single large disc with radial tessellation: dense near the
// arena where waves are legible, sparse toward the horizon where they are sub
// -pixel anyway.
// ============================================================================

const vertexShader = /* glsl */`
  uniform float uTime;
  uniform vec4  uWaveA;   // xy = direction, z = steepness, w = wavelength
  uniform vec4  uWaveB;
  uniform vec4  uWaveC;
  uniform vec4  uWaveD;

  varying vec3  vWorldPos;
  varying vec3  vNormal;
  varying float vCrest;   // 0..1 how compressed the surface is here
  varying float vDist;

  // One Gerstner wave. Accumulates its contribution into the tangent/binormal
  // so the caller can cross them for an exact normal.
  vec3 gerstner(vec4 w, vec3 p, inout vec3 tangent, inout vec3 binormal) {
    float steepness = w.z;
    float wavelength = w.w;
    float k = 6.28318530718 / wavelength;      // wave number
    float c = sqrt(9.8 / k);                   // deep-water phase speed
    vec2  d = normalize(w.xy);
    float f = k * (dot(d, p.xz) - c * uTime);
    float a = steepness / k;                   // amplitude from steepness

    tangent  += vec3(
      -d.x * d.x * (steepness * sin(f)),
       d.x        * (steepness * cos(f)),
      -d.x * d.y * (steepness * sin(f))
    );
    binormal += vec3(
      -d.x * d.y * (steepness * sin(f)),
       d.y        * (steepness * cos(f)),
      -d.y * d.y * (steepness * sin(f))
    );

    return vec3(
      d.x * (a * cos(f)),
      a * sin(f),
      d.y * (a * cos(f))
    );
  }

  void main() {
    vec3 p = (modelMatrix * vec4(position, 1.0)).xyz;
    vec3 origin = p;

    vec3 tangent  = vec3(1.0, 0.0, 0.0);
    vec3 binormal = vec3(0.0, 0.0, 1.0);

    // Waves fade out toward the horizon: past a few hundred metres they are far
    // below a pixel, and animating them there only produces shimmer aliasing.
    float dist = length(p.xz);
    float atten = 1.0 - smoothstep(90.0, 320.0, dist);

    p += gerstner(uWaveA, origin, tangent, binormal) * atten;
    p += gerstner(uWaveB, origin, tangent, binormal) * atten;
    p += gerstner(uWaveC, origin, tangent, binormal) * atten;
    p += gerstner(uWaveD, origin, tangent, binormal) * atten;

    vec3 n = normalize(cross(binormal, tangent));

    vWorldPos = p;
    vNormal   = n;
    vDist     = dist;
    // Steepness of the surface stands in for compression: the flatter the
    // normal points away from up, the more the water is piling up.
    vCrest    = clamp((1.0 - n.y) * 3.2, 0.0, 1.0);

    gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
  }
`;

const fragmentShader = /* glsl */`
  uniform float uTime;
  uniform vec3  uShallow;
  uniform vec3  uDeep;
  uniform vec3  uFoam;
  uniform vec3  uSkyTint;
  uniform vec3  uArenaPos;
  uniform vec3  uArenaGlow;
  uniform float uArenaRadius;
  uniform samplerCube uEnv;
  uniform float uHasEnv;

  varying vec3  vWorldPos;
  varying vec3  vNormal;
  varying float vCrest;
  varying float vDist;

  void main() {
    vec3 N = normalize(vNormal);
    vec3 V = normalize(cameraPosition - vWorldPos);

    // --- Fresnel (Schlick). Water's normal-incidence reflectance is ~0.02;
    //     at grazing angles it approaches 1 and the surface becomes a mirror.
    float f0 = 0.02;
    float fres = f0 + (1.0 - f0) * pow(1.0 - max(dot(N, V), 0.0), 5.0);

    // --- Body colour. "Depth" here is a stylised proxy: the further from the
    //     viewer along the surface, the deeper the water reads.
    float depthMix = smoothstep(6.0, 90.0, vDist);
    vec3 body = mix(uShallow, uDeep, depthMix);

    // --- Reflection: sample the nebula environment along the reflected ray.
    vec3 R = reflect(-V, N);
    vec3 refl = uSkyTint;
    if (uHasEnv > 0.5) {
      // Deliberately biased, not physical: the raw environment is a desaturated
      // grey-violet, and reflecting it faithfully made the sea look like wet
      // concrete. Push it toward the arena's palette and lift the contrast.
      vec3 env = textureCube(uEnv, R).rgb;
      refl = mix(uSkyTint, env * vec3(1.15, 0.85, 1.45), 0.72);
      refl *= refl * 2.2;      // gamma-ish squash: dark stays dark, highlights pop
    }

    // --- The arena is the brightest thing in the scene, so it must pour light
    //     onto the water beneath it or the two read as unrelated layers.
    float toArena = distance(vWorldPos.xz, uArenaPos.xz);
    float spill = 1.0 - smoothstep(uArenaRadius * 0.2, uArenaRadius * 2.2, toArena);
    spill = spill * spill;   // quadratic falloff, as light actually behaves
    // stretch the reflection vertically the way a real reflection smears
    float shimmer = 0.5 + 0.5 * sin(vWorldPos.z * 1.6 + uTime * 0.9 + vWorldPos.x * 0.4);
    vec3 spillCol = uArenaGlow * spill * (0.20 + shimmer * 0.40);

    // --- Specular glint from the cold key behind the arch.
    vec3 L = normalize(vec3(0.1, 0.55, -1.0));
    vec3 H = normalize(L + V);
    float spec = pow(max(dot(N, H), 0.0), 90.0) * 0.28;

    // --- Foam on the crests, broken up so it does not band.
    float foamMask = smoothstep(0.72, 1.0, vCrest);
    foamMask *= 0.6 + 0.4 * sin(vWorldPos.x * 3.1 + vWorldPos.z * 2.7 + uTime * 1.4);
    foamMask *= 1.0 - smoothstep(60.0, 200.0, vDist);

    vec3 col = mix(body, refl, clamp(fres, 0.0, 0.42));
    col += spillCol;
    // wave faces turned toward the arena pick up its glow
    col += uArenaGlow * vCrest * spill * 0.55;
    col += spec;
    col = mix(col, uFoam, clamp(foamMask, 0.0, 0.30));

    // Fade into the fog colour at the horizon so there is no hard edge where
    // the disc ends.
    float horizon = smoothstep(220.0, 400.0, vDist);
    col = mix(col, uSkyTint * 0.55, horizon);

    gl_FragColor = vec4(col, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

export default function Water({ y = -14, arenaCenter = [0, 0, -4.5], arenaRadius = 10.5 }) {
  const mat = useRef();
  const { scene } = useThree();

  // Radial mesh: dense near the arena, sparse at the horizon. A uniform grid
  // would either waste hundreds of thousands of vertices on the horizon or
  // leave the near water too coarse to show a wave.
  const geometry = useMemo(() => {
    const rings = TIER === 'high' ? 150 : TIER === 'mid' ? 96 : 56;
    const segs = TIER === 'high' ? 160 : TIER === 'mid' ? 110 : 70;
    const g = new THREE.RingGeometry(0.6, 420, segs, rings);
    // RingGeometry lies in XY; lay it flat.
    g.rotateX(-Math.PI / 2);
    return g;
  }, []);

  const uniforms = useMemo(() => ({
    uTime: { value: 0 },
    // direction.xy, steepness, wavelength. Steepness must sum to < 1 across all
    // waves or the surface self-intersects and turns inside out at the crests.
    uWaveA: { value: new THREE.Vector4(1.0, 0.35, 0.24, 30.0) },
    uWaveB: { value: new THREE.Vector4(-0.7, 0.9, 0.20, 17.0) },
    uWaveC: { value: new THREE.Vector4(0.25, -1.0, 0.13, 11.0) },
    uWaveD: { value: new THREE.Vector4(-0.9, -0.4, 0.09, 6.5) },
    uShallow: { value: new THREE.Color('#2b1c66') },
    uDeep: { value: new THREE.Color('#050310') },
    uFoam: { value: new THREE.Color('#8f7fc4') },
    uSkyTint: { value: new THREE.Color('#1d1140') },
    uArenaPos: { value: new THREE.Vector3(...arenaCenter) },
    uArenaGlow: { value: new THREE.Color('#5a3fa8') },
    uArenaRadius: { value: arenaRadius },
    uEnv: { value: null },
    uHasEnv: { value: 0 },
  }), [arenaCenter, arenaRadius]);

  // The scene's environment is an equirectangular texture; the shader wants a
  // cubemap to sample by direction, so convert once.
  useLayoutEffect(() => {
    const src = scene.environment;
    if (!src) return;
    if (src.mapping === THREE.CubeReflectionMapping || src.isCubeTexture) {
      uniforms.uEnv.value = src;
      uniforms.uHasEnv.value = 1;
      return;
    }
    // Only worth the conversion where the reflection will actually be seen.
    if (!Q.effects) return;
    let cubeRT;
    try {
      const renderer = window.__three?.gl;
      if (!renderer) return;
      cubeRT = new THREE.WebGLCubeRenderTarget(256);
      cubeRT.fromEquirectangularTexture(renderer, src);
      uniforms.uEnv.value = cubeRT.texture;
      uniforms.uHasEnv.value = 1;
    } catch {
      // reflection is an enhancement, never a requirement
      uniforms.uHasEnv.value = 0;
    }
    return () => cubeRT?.dispose();
  }, [scene.environment, uniforms]);

  useLayoutEffect(() => () => geometry.dispose(), [geometry]);

  useFrame((_, dt) => {
    if (mat.current) mat.current.uniforms.uTime.value += dt;
  });

  return (
    <mesh geometry={geometry} position={[0, y, 0]} frustumCulled={false} renderOrder={-2}>
      <shaderMaterial
        ref={mat}
        uniforms={uniforms}
        vertexShader={vertexShader}
        fragmentShader={fragmentShader}
        side={THREE.DoubleSide}
        // Fog is applied in-shader via the horizon fade; letting three inject
        // its own fog chunks would double it.
        fog={false}
      />
    </mesh>
  );
}
