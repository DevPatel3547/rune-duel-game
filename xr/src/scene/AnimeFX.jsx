import { useRef, useMemo, useEffect } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { inkStroke, inkArc, streakMask } from './vfxTextures.js';
import { celBands } from './vfxStyle.js';
import { pathPoint } from './flightPath.js';
import { clamp01, vfxScale } from './anim.js';

// ============================================================================
// ANIME FX LAYERS
//
// Extra layers that sit ON TOP of the existing projectile, for the 'anime' and
// 'ink' styles. Deliberately additive to the current build rather than a
// rewrite of it, so a treatment can be judged against the same flight path,
// timing and impact moment.
//
// The governing idea: an anime attack is not one shape. A single frame of one
// has a core, a rimmed body, a smooth ribbon of momentum, radiating speed
// lines, ghosted afterimages, scattered debris and a shockwave — eight or ten
// overlapping elements. Any one of them alone is a blob. It is the DENSITY
// that reads as animation.
//
// Two rules keep that density from becoming mud:
//   1. HARD EDGES. Every mask is thresholded. Soft falloff on ten layers just
//      makes a bigger soft blob.
//   2. VALUE SEPARATION. Core is near-white, body is saturated, edge is the
//      body colour crushed toward black. Layers that share a value merge.
// ============================================================================

const DIR = new THREE.Vector3();
const VIEW = new THREE.Vector3();
const SIDE = new THREE.Vector3();

// ------------------------------------------------------------- cel ribbon --

// The trail, sampled ANALYTICALLY from the flight curve rather than recorded
// frame by frame.
//
// The recorded approach is what the original additive ribbon does, and it has a
// fatal dependency: one sample per rendered frame means the trail's length is a
// function of frame rate. In the software-rendered harness this scene runs at
// well under 1 fps and the trail was TWO samples long — a stub at the head, and
// no amount of retexturing it would have helped. On a weak phone it degrades
// the same way, precisely when you can least afford the effect to vanish.
//
// Sampling `pathPoint` over a trailing slice of the flight gives an identical
// ribbon at any frame rate, and it is smooth by construction, which is the
// property being asked for in the first place.
//
// Drawn as THREE nested bands of decreasing width and increasing value. Three
// flat bands is what makes a trail read as painted; one gradient reads as a
// light source.
export function CelRibbon({ from, to, profile, progress, travel, color, width, ink = false, span = 0.45 }) {
  const bands = useMemo(() => celBands(color), [color]);
  const SEG = 40;

  // Blending is chosen PER BAND, not per style. This is the whole trick:
  //   * the outer band is the OUTLINE, so it must be normal-blended — additive
  //     blending can only add light and literally cannot draw something dark,
  //     which is why the first pass had an outline band that was invisible;
  //   * the inner two are ENERGY, so they must be additive or the trail reads
  //     as a painted stripe with no heat in it.
  // Hot core inside a hard dark edge is what the reference style actually does,
  // and neither blending mode gets there alone.
  const layers = useMemo(() => ([
    { w: 1.00, c: bands.edge, o: 0.92, add: false },
    { w: 0.66, c: bands.body, o: 1.0, add: !ink },
    { w: 0.28, c: bands.core, o: 1.0, add: true },
  ]), [bands, ink]);

  // DEBUG: `window.__ribbonDebug` forces every band to unlit magenta with
  // depth testing off, to separate a geometry failure from a material one.
  const debug = import.meta.env?.DEV && typeof window !== 'undefined' && window.__ribbonDebug;

  const built = useMemo(() => layers.map(() => {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(SEG * 2 * 3), 3));
    g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(SEG * 2 * 2), 2));
    const idx = [];
    for (let i = 0; i < SEG - 1; i++) {
      const a = i * 2;
      idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
    g.setIndex(idx);
    return g;
  }), [layers]);

  const mats = useMemo(() => layers.map((l) => (debug ? new THREE.MeshBasicMaterial({
    color: 0xff00ff, side: THREE.DoubleSide, depthTest: false, transparent: false,
  }) : new THREE.MeshBasicMaterial({
    color: l.c, transparent: true, opacity: l.o, depthWrite: false,
    side: THREE.DoubleSide, toneMapped: false,
    // Ink keeps normal blending so the dark edge band actually reads as dark.
    // Additive blending cannot draw an outline at all — it can only add light,
    // which is exactly why the current build has no outlines anywhere.
    blending: l.add ? THREE.AdditiveBlending : THREE.NormalBlending,
    // NO map on the energy bands. `glowSprite` is a RADIAL gradient: stretched
    // across a long thin strip its alpha is near zero except for a spot in the
    // middle. Flat colour is also simply correct — a painted trail has no
    // internal gradient, and the three bands supply all the structure.
    // Ink breaks the two outer bands up with a dry-brush mask; the core stays
    // solid so the hottest part of the trail never goes patchy.
    map: ink && l.w > 0.3 ? inkStroke() : null,
  }))), [layers, ink, debug]);

  useEffect(() => () => {
    built.forEach((g) => g.dispose());
    mats.forEach((m) => m.dispose());
  }, [built, mats]);

  const pts = useMemo(() => Array.from({ length: SEG }, () => new THREE.Vector3()), []);

  useFrame(({ camera }) => {
    const head = progress.current;
    if (head <= 0.001) { built.forEach((g) => g.setDrawRange(0, 0)); return; }

    // The ribbon covers a trailing slice of the flight, clamped so it never
    // reaches back past the launch point.
    const tail = Math.max(0, head - span);
    for (let i = 0; i < SEG; i++) {
      const t = tail + (head - tail) * (i / (SEG - 1));
      pathPoint(from, to, profile, t, travel, pts[i]);
    }

    layers.forEach((l, li) => {
      const g = built[li];
      const pos = g.attributes.position.array;
      const uv = g.attributes.uv.array;
      for (let i = 0; i < SEG; i++) {
        const cur = pts[i];
        const nxt = pts[Math.min(SEG - 1, i + 1)];
        const prv = pts[Math.max(0, i - 1)];
        DIR.copy(nxt).sub(prv);
        if (DIR.lengthSq() < 1e-10) DIR.set(0, 1, 0);
        DIR.normalize();
        VIEW.copy(cur).sub(camera.position).normalize();
        SIDE.crossVectors(DIR, VIEW).normalize();

        // Taper with a curve rather than linearly: a brush stroke swells past
        // the head and draws to a fine point; a linear taper reads as a
        // stretched triangle.
        const u = i / (SEG - 1);
        // Pinch to nothing near the lens. The player's own spells launch from
        // their hands, under a metre from the camera, and a ribbon there filled
        // half the screen with a giant hook — the one shape the contact sheet
        // showed on nine different spells. Past a few metres it reads as a trail.
        const camDist = cur.distanceTo(camera.position);
        const near = Math.min(1, Math.max(0, (camDist - 1.5) / 4.5));
        const w = Math.pow(u, 0.5) * width * 0.5 * l.w * near * near;
        const a = i * 6, b = i * 4;
        pos[a] = cur.x + SIDE.x * w; pos[a + 1] = cur.y + SIDE.y * w; pos[a + 2] = cur.z + SIDE.z * w;
        pos[a + 3] = cur.x - SIDE.x * w; pos[a + 4] = cur.y - SIDE.y * w; pos[a + 5] = cur.z - SIDE.z * w;
        uv[b] = u; uv[b + 1] = 0;
        uv[b + 2] = u; uv[b + 3] = 1;
      }
      g.attributes.position.needsUpdate = true;
      g.attributes.uv.needsUpdate = true;
      g.setDrawRange(0, (SEG - 1) * 6);
      g.computeBoundingSphere();
    });
  });

  return (
    <>
      {built.map((g, i) => (
        // Ordered by hand: three coplanar transparent bands have no reliable
        // depth order, and letting the sorter decide makes the core flicker
        // behind the edge as the camera moves.
        <mesh key={i} geometry={g} material={mats[i]} renderOrder={10 + i} frustumCulled={false} />
      ))}
    </>
  );
}

// ------------------------------------------------------------ speed lines --

// Thin streaks trailing straight back along the flight axis. This is the most
// recognisably anime element in the whole set and costs almost nothing: it is
// how hand-drawn animation conveys speed without motion blur.
export function SpeedLines({ color, count = 14, length = 1.6, spread = 0.30 }) {
  const group = useRef();
  const seeds = useMemo(() => Array.from({ length: count }, (_, i) => ({
    a: (i / count) * Math.PI * 2 + Math.sin(i * 3.7),
    r: 0.06 + Math.abs(Math.sin(i * 2.1)) * spread,
    len: length * (0.30 + Math.abs(Math.sin(i * 1.3)) * 0.5),
    speed: 5 + Math.abs(Math.sin(i * 4.9)) * 9,
    phase: Math.abs(Math.sin(i * 7.3)),
  })), [count, length, spread]);

  const mat = useMemo(() => new THREE.MeshBasicMaterial({
    color: celBands(color).core, transparent: true, opacity: 0.85,
    depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false,
    map: streakMask(), side: THREE.DoubleSide,
  }), [color]);
  useEffect(() => () => mat.dispose(), [mat]);

  useFrame(({ camera }, dt) => {
    if (!group.current) return;
    const k = vfxScale();
    group.current.children.forEach((m, i) => {
      const s = seeds[i];
      // Each line cycles: born tight to the core, streaks backward, fades.
      s.phase = (s.phase + (dt * s.speed) / (6 * k)) % 1;
      const p = s.phase;
      // Splay outward as they stream back, rather than sitting on a fixed
      // radius — parallel lines read as a cage around the projectile, and it
      // is the divergence that says "moving fast" instead of "enclosed".
      const spreadOut = s.r * (0.5 + p * 1.6);
      m.position.set(Math.cos(s.a) * spreadOut, Math.sin(s.a) * spreadOut, 0.15 + p * s.len);
      m.scale.set(0.075, s.len * (1 - p) * 0.8 + 0.06, 1);
      m.material.opacity = Math.sin(p * Math.PI) * 1.0;
      m.lookAt(camera.position);
      m.rotation.z = s.a;
    });
  });

  return (
    <group ref={group}>
      {seeds.map((_, i) => (
        <mesh key={i} material={mat.clone()}>
          <planeGeometry args={[1, 1]} />
        </mesh>
      ))}
    </group>
  );
}

// ------------------------------------------------------------ afterimages --

// Ghosted copies of the core lagging behind it. Cheap, and it is what makes a
// fast object read as fast rather than as teleporting between frames.
//
// Positioned off the same analytic path as the ribbon, for the same reason: a
// recorded trail at 5 fps stacks every ghost on top of the head.
export function Afterimages({ from, to, profile, progress, travel, color, size, count = 5, ink = false, shape = 'shard' }) {
  const group = useRef();
  const bands = useMemo(() => celBands(color), [color]);
  const scratch = useMemo(() => new THREE.Vector3(), []);
  const mat = useMemo(() => new THREE.MeshBasicMaterial({
    color: ink ? bands.edge : bands.body, transparent: true, opacity: 0.5,
    depthWrite: false, toneMapped: false,
    blending: ink ? THREE.NormalBlending : THREE.AdditiveBlending,
  }), [bands, ink]);
  useEffect(() => () => mat.dispose(), [mat]);

  useFrame(() => {
    if (!group.current) return;
    const head = progress.current;
    group.current.children.forEach((m, i) => {
      // Spaced evenly back along the flight, not along recorded history.
      const t = head - ((i + 1) / (count + 1)) * 0.30;
      if (t <= 0) { m.visible = false; return; }
      m.visible = true;
      pathPoint(from, to, profile, t, travel, scratch);
      m.position.copy(scratch);
      const f = 1 - (i + 1) / (count + 1);
      m.scale.setScalar(size * (0.5 + f * 1.0));
      m.material.opacity = f * (ink ? 0.7 : 0.55);
      m.rotation.y += 0.04;
      m.rotation.z += 0.03;
    });
  });

  return (
    <group ref={group}>
      {Array.from({ length: count }).map((_, i) => (
        // Ghosts echo the spell's own silhouette. Octahedra behind every spell
        // gave a lance and a boulder the same faceted trail.
        <mesh key={i} material={mat.clone()}>
          {shape === 'lance' ? <coneGeometry args={[0.35, 2.4, 6]} />
            : shape === 'rock' ? <dodecahedronGeometry args={[0.9, 0]} />
            : shape === 'ring' ? <torusGeometry args={[0.8, 0.25, 6, 14]} />
            : shape === 'star' ? <icosahedronGeometry args={[0.9, 0]} />
            : shape === 'void' || shape === 'orb' ? <sphereGeometry args={[0.8, 10, 8]} />
            : <octahedronGeometry args={[1, 0]} />}
        </mesh>
      ))}
    </group>
  );
}

// ---------------------------------------------------------- anime impact --

// The impact is where density matters most, because it is the frame the player
// actually looks at. Five simultaneous elements, each on its own curve:
//
//   1. CROSS FLARE  two crossed hard-edged bars — the anime "hit" punctuation
//   2. SHOCK RING   a hard expanding annulus, edge-on to the ground
//   3. SHARDS       radiating tapered spikes, staggered so they do not read
//                   as one starburst sprite
//   4. DEBRIS       motes thrown outward on ballistic arcs, each with a streak
//   5. LINGER       a slow dark puff that stays after the light has gone, so
//                   the hit leaves a mark instead of vanishing cleanly
export function AnimeImpact({ at, color, scale = 1, ink = false, shards: shardCount = 9, debris: debrisCount = 16, ring: ringScale = 1 }) {
  const born = useRef(performance.now());
  const bands = useMemo(() => celBands(color), [color]);

  const crossRef = useRef();
  const ringRef = useRef();
  const shardsRef = useRef();
  const debrisRef = useRef();
  const lingerRef = useRef();

  const LIFE = 620 * vfxScale();

  // A flash is LIGHT, so it stays additive in every style — drawn with normal
  // blending it becomes an opaque bar sitting in front of the scene, which is
  // what turned the ink cross into a grey plank across the frame.
  const flatMat = useMemo(() => new THREE.MeshBasicMaterial({
    color: bands.core, transparent: true, opacity: 1, depthWrite: false,
    side: THREE.DoubleSide, toneMapped: false,
    blending: THREE.AdditiveBlending,
    map: ink ? inkStroke() : undefined,
  }), [bands, ink]);
  const ringMat = useMemo(() => new THREE.MeshBasicMaterial({
    color: bands.body, transparent: true, opacity: 1, depthWrite: false,
    side: THREE.DoubleSide, toneMapped: false, map: inkArc(),
    blending: ink ? THREE.NormalBlending : THREE.AdditiveBlending,
  }), [bands, ink]);
  // Filling the shards with the dark edge value drains every bit of energy out
  // of them — they read as wet sticks. The body colour is the fill in both
  // styles; ink differs only in blending, so it stays a flat painted shape
  // instead of glowing.
  const shardMat = useMemo(() => new THREE.MeshBasicMaterial({
    color: bands.body, transparent: true, opacity: 1,
    depthWrite: false, side: THREE.DoubleSide, toneMapped: false,
    blending: ink ? THREE.NormalBlending : THREE.AdditiveBlending,
    map: ink ? inkStroke() : undefined,
  }), [bands, ink]);
  const lingerMat = useMemo(() => new THREE.MeshBasicMaterial({
    color: bands.edge, transparent: true, opacity: 0, depthWrite: false,
    side: THREE.DoubleSide, toneMapped: false, map: inkStroke(),
  }), [bands]);

  useEffect(() => () => {
    [flatMat, ringMat, shardMat, lingerMat].forEach((m) => m.dispose());
  }, [flatMat, ringMat, shardMat, lingerMat]);

  const shards = useMemo(() => Array.from({ length: shardCount }, (_, i) => ({
    a: (i / shardCount) * Math.PI * 2 + Math.sin(i * 2.9) * 0.3,
    len: 0.7 + Math.abs(Math.sin(i * 1.7)) * 1.5,
    delay: Math.abs(Math.sin(i * 5.3)) * 0.22,
  })), [shardCount]);

  const debris = useMemo(() => Array.from({ length: debrisCount }, (_, i) => ({
    dir: new THREE.Vector3(
      Math.cos((i / debrisCount) * Math.PI * 2 + i) * (0.6 + Math.abs(Math.sin(i * 3.1))),
      0.5 + Math.abs(Math.sin(i * 2.3)) * 1.6,
      Math.sin((i / debrisCount) * Math.PI * 2 + i) * (0.6 + Math.abs(Math.sin(i * 1.9))),
    ),
    size: 0.03 + Math.abs(Math.sin(i * 4.1)) * 0.05,
  })), [debrisCount]);

  useFrame(({ camera }) => {
    const e = clamp01((performance.now() - born.current) / LIFE);

    // 1. cross flare — violently fast in, fast out. It exists for three frames.
    if (crossRef.current) {
      const f = Math.max(0, 1 - e * 4.5);
      crossRef.current.visible = f > 0.01;
      crossRef.current.scale.setScalar((0.35 + (1 - f) * 0.7) * scale);
      crossRef.current.lookAt(camera.position);
      crossRef.current.children.forEach((m) => { m.material.opacity = f; });
    }

    // 2. shock ring — expands and thins, lying flat so it reads against the floor
    if (ringRef.current) {
      const f = Math.pow(e, 0.45);
      ringRef.current.visible = e < 0.95;
      ringRef.current.scale.setScalar((0.5 + f * 5.0) * scale * ringScale);
      ringRef.current.material.opacity = (1 - f) * 0.9;
    }

    // 3. shards
    if (shardsRef.current) {
      shardsRef.current.children.forEach((m, i) => {
        const s = shards[i];
        const p = clamp01((e - s.delay) / (1 - s.delay));
        const out = Math.pow(p, 0.4);
        m.visible = p > 0 && p < 0.98;
        m.position.set(Math.cos(s.a) * out * s.len * scale, 0.15, Math.sin(s.a) * out * s.len * scale);
        m.scale.set(0.09 * scale * (1 - p), s.len * scale * (1 - p * 0.5), 1);
        m.lookAt(camera.position);
        m.rotation.z = -s.a + Math.PI / 2;
        m.material.opacity = 1 - p;
      });
    }

    // 4. debris on ballistic arcs
    if (debrisRef.current) {
      debrisRef.current.children.forEach((m, i) => {
        const d = debris[i];
        const t = e * 1.5;
        m.visible = e < 0.9;
        m.position.set(
          d.dir.x * t * scale,
          Math.max(0.02, (d.dir.y * t - 2.4 * t * t) * scale),
          d.dir.z * t * scale,
        );
        m.scale.setScalar(d.size * scale * (1 - e * 0.6));
        m.material.opacity = 1 - e;
      });
    }

    // 5. linger — comes in AFTER the flash and outlives it
    if (lingerRef.current) {
      const f = Math.sin(clamp01((e - 0.25) / 0.75) * Math.PI);
      lingerRef.current.visible = f > 0.01;
      lingerRef.current.scale.setScalar((1.2 + e * 1.8) * scale);
      lingerRef.current.lookAt(camera.position);
      lingerRef.current.material.opacity = f * 0.5;
    }
  });

  return (
    <group position={at}>
      <group ref={crossRef}>
        <mesh material={flatMat}><planeGeometry args={[1.1, 0.07]} /></mesh>
        <mesh material={flatMat} rotation={[0, 0, Math.PI / 2]}><planeGeometry args={[1.1, 0.07]} /></mesh>
        <mesh material={flatMat} rotation={[0, 0, Math.PI / 4]}><planeGeometry args={[0.62, 0.04]} /></mesh>
        <mesh material={flatMat} rotation={[0, 0, -Math.PI / 4]}><planeGeometry args={[0.62, 0.04]} /></mesh>
      </group>

      <mesh ref={ringRef} material={ringMat} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.05, 0]}>
        <planeGeometry args={[1, 1]} />
      </mesh>

      <group ref={shardsRef}>
        {shards.map((_, i) => (
          <mesh key={i} material={shardMat.clone()}><planeGeometry args={[1, 1]} /></mesh>
        ))}
      </group>

      <group ref={debrisRef}>
        {debris.map((_, i) => (
          <mesh key={i} material={shardMat.clone()}><tetrahedronGeometry args={[1, 0]} /></mesh>
        ))}
      </group>

      <mesh ref={lingerRef} material={lingerMat}>
        <planeGeometry args={[1, 1]} />
      </mesh>
    </group>
  );
}
