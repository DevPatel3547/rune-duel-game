import { useRef, useMemo, useEffect } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { useGame } from '../store.js';
import { OPP_DIST } from '../config.js';
import { glowSprite } from './textures.js';
import { burstMask } from './vfxTextures.js';
import { createVfxMaterial, stepVfx } from './VfxMaterial.js';
import { Spring, fbm1, damp, clamp01, vfxScale } from './anim.js';
import { impactFeel } from './feel.js';
import { toonMaterial, addOutline } from './toon.js';

// ============================================================================
// SUMMONS AND SKY-STRIKES
//
// The duel was two people throwing bolts at each other. What makes this genre
// feel big is not shader quality — reference play is full of creatures pouring
// out of portals and meteors coming down out of the sky. The spectacle IS the
// game feel.
//
// Two things live here:
//
//   SUMMON  — a portal tears open, a construct climbs out and MARCHES across
//             the arena at the opponent, then detonates on arrival. It exists
//             in the world for several seconds, which is the whole point: it
//             is a threat you watch approach, not an instant.
//
//   METEOR  — the sky itself answers. A rock falls from far above with a long
//             telegraph shadow on the ground, so the target has time to move.
//
// Both resolve through the same fx queue as everything else, so the drivers
// and the server need no special cases.
// ============================================================================

export default function Summons() {
  const fx = useGame((s) => s.fx);
  return fx.map((f) => {
    if (f.kind === 'summon') {
      return f.spellId === 'wyrm' ? <Serpent key={f.id} fx={f} /> : <Construct key={f.id} fx={f} />;
    }
    if (f.kind === 'meteor') return <Meteor key={f.id} fx={f} />;
    return null;
  });
}

// ------------------------------------------------------------- construct ---

// Scaled with the arena: the march is the point, and at 18m a 2.6s crossing
// is a sprint rather than an approach you get to react to.
const WALK_MS = 4200;

// The construct was reported as "builds but never renders" and stayed disabled
// for two phases on that basis. It renders fine. It was built out of #241a33,
// #1b1428 and #201829 — near-black standard materials — and then Phase T dropped
// the whole arena to a near-black cel palette, so it was a black silhouette on a
// black ground with no rim to separate it. Not a render bug: a VALUE bug.
//
// It now uses the same toon treatment as everything else, at a value that reads
// against the floor, with a hot rim and an outline so the silhouette survives at
// the far end of an 18m arena.
function Construct({ fx }) {
  const removeFx = useGame((s) => s.removeFx);
  const root = useRef();
  const body = useRef();
  const legL = useRef();
  const legR = useRef();
  const portal = useRef();
  const born = useRef(performance.now());
  const seed = useMemo(() => Math.random() * 10, []);
  const dead = useRef(false);

  const from = useMemo(() => new THREE.Vector3(...fx.from), [fx.from]);
  const to = useMemo(() => new THREE.Vector3(...fx.to), [fx.to]);

  const stoneMat = useMemo(() => toonMaterial({
    color: '#6f6480', rimColor: fx.color, rimPower: 1.9, rimStrength: 1.6,
    stops: [0.42, 0.74], levels: [0.2, 0.58, 0.96],
  }), [fx.color]);
  const plateMat = useMemo(() => toonMaterial({
    color: '#544a63', rimColor: fx.color, rimPower: 2.1, rimStrength: 1.4,
    stops: [0.45], levels: [0.18, 0.7],
  }), [fx.color]);
  useEffect(() => () => { stoneMat.dispose(); plateMat.dispose(); }, [stoneMat, plateMat]);

  useEffect(() => {
    // Outline weight is thickness x view depth; a construct that marches from
    // 18m to 2m needs a modest value or the line swallows it at spawn.
    if (root.current) addOutline(root.current, { thickness: 0.008 });
  }, []);

  const glowMat = useMemo(() => createVfxMaterial({
    mask: burstMask(), color: fx.color, rimColor: '#ffe6b0',
    scroll: 0.34, distort: 0.05, cellMix: 0.6,
  }), [fx.color]);
  useEffect(() => () => glowMat.dispose(), [glowMat]);

  useFrame(({ camera }, dt) => {
    const now = performance.now();
    // Routed through vfxScale like every other timed effect. Without it the
    // march runs at full speed while the capture harness crawls, and the
    // construct has been and gone before a single frame is taken.
    const e = (now - born.current) / (WALK_MS * vfxScale());

    if (e >= 1 && !dead.current) {
      dead.current = true;
      impactFeel(1.2, fx.dir === 'in');
      removeFx(fx.id);
      return;
    }
    if (!root.current) return;

    // 0-0.18 climbing out of the portal, then marching
    const emerge = clamp01(e / 0.18);
    const travel = clamp01((e - 0.18) / 0.82);

    root.current.position.lerpVectors(from, to, travel);
    root.current.position.y = from.y - (1 - emerge) * 1.6;   // rises from below
    root.current.lookAt(to.x, root.current.position.y, to.z);

    // A heavy, deliberate gait: the body drops on each footfall, and the legs
    // swing out of phase. Slow and weighty is what makes it read as a threat.
    const stride = now * 0.005;
    if (body.current) {
      body.current.position.y = Math.abs(Math.sin(stride)) * -0.09;
      body.current.rotation.z = Math.sin(stride) * 0.06;
      body.current.rotation.x = 0.06 + Math.sin(stride * 2) * 0.03;
    }
    if (legL.current) legL.current.rotation.x = Math.sin(stride) * 0.75;
    if (legR.current) legR.current.rotation.x = -Math.sin(stride) * 0.75;

    if (portal.current) {
      // the portal shrinks once it has finished delivering
      const p = 1 - clamp01((e - 0.18) / 0.18);
      portal.current.scale.setScalar(0.2 + emerge * 1.5 * p + 0.001);
      portal.current.visible = p > 0.01;
      portal.current.lookAt(camera.position);
      stepVfx(glowMat, dt, 0.25 + (1 - p) * 0.5, p);
    }
  });

  const c = fx.color;
  return (
    <group>
      {/* the tear it climbs out of */}
      <mesh ref={portal} position={fx.from} material={glowMat}>
        <planeGeometry args={[1.9, 1.9]} />
      </mesh>

      <group ref={root} position={fx.from}>
        <group ref={body}>
          {/* torso: a heavy slab, not a humanoid — it should read as a
              construct at a glance, distinct from the wizards */}
          <mesh position={[0, 1.15, 0]} castShadow>
            <boxGeometry args={[0.78, 1.05, 0.52]} />
            <primitive object={stoneMat} attach="material" />
          </mesh>
          {/* glowing core */}
          <mesh position={[0, 1.2, 0.28]}>
            <sphereGeometry args={[0.16, 14, 12]} />
            <meshBasicMaterial color={c} toneMapped={false} />
          </mesh>
          <pointLight position={[0, 1.2, 0.3]} color={c} intensity={5} distance={5} decay={2} />
          {/* shoulders + head */}
          <mesh position={[0, 1.78, 0]} castShadow>
            <boxGeometry args={[0.44, 0.34, 0.42]} />
            <primitive object={plateMat} attach="material" />
          </mesh>
          {[-1, 1].map((s) => (
            <mesh key={s} position={[s * 0.10, 1.80, 0.20]}>
              <planeGeometry args={[0.07, 0.035]} />
              <meshBasicMaterial color={c} toneMapped={false} />
            </mesh>
          ))}
          {/* arms hanging heavy */}
          {[-1, 1].map((s) => (
            <mesh key={s} position={[s * 0.52, 1.18, 0]} rotation={[0.1, 0, s * 0.08]} castShadow>
              <boxGeometry args={[0.22, 0.92, 0.24]} />
              <primitive object={plateMat} attach="material" />
            </mesh>
          ))}
        </group>
        {/* legs, pivoting at the hip */}
        {[[-1, legL], [1, legR]].map(([s, ref], i) => (
          <group key={i} ref={ref} position={[s * 0.22, 0.66, 0]}>
            <mesh position={[0, -0.33, 0]} castShadow>
              <boxGeometry args={[0.26, 0.7, 0.28]} />
              <primitive object={plateMat} attach="material" />
            </mesh>
          </group>
        ))}
      </group>
    </group>
  );
}

// --------------------------------------------------------------- serpent ---

// Wyrm used to summon the same stone construct as Golem, recoloured — two of
// the biggest spells in the game were the same creature. A wyrm is the
// opposite of a golem: not a heavy walker but a long sinuous body that coils
// out of the portal and swims through the air at the target, so it reads
// differently in silhouette, in motion and in the height it travels at.
const SERPENT_SEGMENTS = 16;

function Serpent({ fx }) {
  const removeFx = useGame((s) => s.removeFx);
  const portal = useRef();
  const segs = useRef([]);
  const head = useRef();
  const rootRef = useRef();
  const born = useRef(performance.now());
  const dead = useRef(false);

  const from = useMemo(() => new THREE.Vector3(...fx.from), [fx.from]);
  const to = useMemo(() => new THREE.Vector3(...fx.to), [fx.to]);
  const scratch = useMemo(() => new THREE.Vector3(), []);
  const ahead = useMemo(() => new THREE.Vector3(), []);

  const scaleMat = useMemo(() => toonMaterial({
    color: '#3f5a78', rimColor: fx.color, rimPower: 1.7, rimStrength: 1.8,
    stops: [0.4, 0.72], levels: [0.18, 0.56, 0.95],
  }), [fx.color]);
  const glowMat = useMemo(() => createVfxMaterial({
    mask: burstMask(), color: fx.color, rimColor: '#e8f4ff',
    scroll: 0.34, distort: 0.05, cellMix: 0.6,
  }), [fx.color]);
  useEffect(() => () => { scaleMat.dispose(); glowMat.dispose(); }, [scaleMat, glowMat]);

  useEffect(() => {
    if (rootRef.current) addOutline(rootRef.current, { thickness: 0.008 });
  }, []);

  // Where the body is at a point along its journey (0 = portal, 1 = target),
  // with the swimming wave applied.
  const bodyAt = (u, time, out) => {
    const k = clamp01(u);
    out.lerpVectors(from, to, k);
    // it rises out of the portal and cruises above chest height
    out.y = from.y + Math.min(1, k * 6) * 2.1 + Math.sin(time * 2.2 + k * 9) * 0.35;
    // the lateral S-wave that makes it swim rather than slide
    out.x += Math.sin(time * 3.1 - k * 14) * 1.1 * Math.min(1, k * 4);
    return out;
  };

  useFrame(({ camera }, dt) => {
    const now = performance.now();
    const e = (now - born.current) / (WALK_MS * vfxScale());
    if (e >= 1 && !dead.current) {
      dead.current = true;
      impactFeel(1.3, fx.dir === 'in');
      removeFx(fx.id);
      return;
    }
    const time = now / 1000;
    // the head leads; the tail trails a fixed length of the journey behind it
    const headU = clamp01((e - 0.12) / 0.88);
    const bodyLen = 0.2;

    segs.current.forEach((m, i) => {
      if (!m) return;
      const u = headU - (i / (SERPENT_SEGMENTS - 1)) * bodyLen;
      m.visible = u > -0.02;
      bodyAt(u, time, m.position);
      m.scale.setScalar(0.34 * (1 - (i / SERPENT_SEGMENTS) * 0.78));
    });

    if (head.current) {
      bodyAt(headU, time, scratch);
      bodyAt(headU + 0.02, time, ahead);
      head.current.position.copy(scratch);
      head.current.lookAt(ahead);
    }

    if (portal.current) {
      const p = 1 - clamp01((e - 0.25) / 0.2);
      portal.current.scale.setScalar(0.2 + clamp01(e / 0.12) * 1.6 * p + 0.001);
      portal.current.visible = p > 0.01;
      portal.current.lookAt(camera.position);
      stepVfx(glowMat, dt, 0.25 + (1 - p) * 0.5, p);
    }
  });

  const c = fx.color;
  return (
    <group>
      <mesh ref={portal} position={[fx.from[0], fx.from[1] + 1.2, fx.from[2]]} material={glowMat}>
        <planeGeometry args={[2.2, 2.2]} />
      </mesh>
      <group ref={rootRef}>
        {Array.from({ length: SERPENT_SEGMENTS }).map((_, i) => (
          <mesh key={i} ref={(el) => { segs.current[i] = el; }} castShadow>
            <sphereGeometry args={[1, 12, 10]} />
            <primitive object={scaleMat} attach="material" />
          </mesh>
        ))}
        <group ref={head}>
          {/* a long wedge skull pointing along the direction of travel */}
          <mesh rotation={[Math.PI / 2, 0, 0]} position={[0, 0, 0.32]} castShadow>
            <coneGeometry args={[0.36, 0.95, 8]} />
            <primitive object={scaleMat} attach="material" />
          </mesh>
          {[-1, 1].map((s) => (
            <mesh key={s} position={[s * 0.16, 0.12, 0.42]}>
              <sphereGeometry args={[0.055, 8, 6]} />
              <meshBasicMaterial color={c} toneMapped={false} />
            </mesh>
          ))}
          <pointLight color={c} intensity={6} distance={6} decay={2} />
        </group>
      </group>
    </group>
  );
}

// ---------------------------------------------------------------- meteor ---

const FALL_MS = 1900;

function Meteor({ fx }) {
  const removeFx = useGame((s) => s.removeFx);
  const rock = useRef();
  const shadow = useRef();
  const trail = useRef();
  const light = useRef();
  const born = useRef(performance.now());
  const struck = useRef(false);

  const to = useMemo(() => new THREE.Vector3(...fx.to), [fx.to]);
  // Starts inside the shot. At 18 m the camera frames only about 7 m of
  // height, so a rock dropped from 42 m spent almost its whole fall above the
  // top of the screen and arrived as a flash at the last instant.
  const from = useMemo(() => new THREE.Vector3(to.x + 3.5, 9, to.z + 4), [to]);

  const fireMat = useMemo(() => createVfxMaterial({
    mask: burstMask(), color: fx.color, rimColor: '#fff0c0',
    scroll: 0.7, distort: 0.09, cellMix: 0.75,
  }), [fx.color]);
  useEffect(() => () => fireMat.dispose(), [fireMat]);

  useFrame(({ camera }, dt) => {
    const now = performance.now();
    const e = (now - born.current) / (FALL_MS * vfxScale());

    if (e >= 1) {
      if (!struck.current) {
        struck.current = true;
        impactFeel(2.0, fx.dir === 'in');
      }
      if (e >= 1.25) { removeFx(fx.id); return; }
    }

    const t = Math.min(1, e);
    // accelerate under gravity rather than travelling linearly
    const g = t * t;
    if (rock.current) {
      rock.current.position.lerpVectors(from, to, g);
      rock.current.rotation.x += dt * 3.2;
      rock.current.rotation.z += dt * 2.1;
      rock.current.visible = t < 1;
    }
    if (trail.current) {
      trail.current.position.copy(rock.current.position);
      trail.current.lookAt(camera.position);
      trail.current.scale.setScalar(1.6 + t * 1.4);
      stepVfx(fireMat, dt, 0.2 + t * 0.25, t < 1 ? 1 : 0);
    }
    if (light.current) {
      light.current.position.copy(rock.current.position);
      light.current.intensity = t < 1 ? 14 + t * 26 : Math.max(0, 60 * (1.25 - e) * 4);
    }
    // The ground shadow IS the telegraph: it tells the target where this is
    // going to land, early enough to move. Without it the meteor is unfair.
    if (shadow.current) {
      shadow.current.scale.setScalar(0.5 + g * 2.6);
      shadow.current.material.opacity = t < 1 ? 0.15 + g * 0.5 : 0;
    }
  });

  return (
    <group>
      <mesh ref={shadow} position={[to.x, 0.04, to.z]} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[0.55, 0.78, 40]} />
        <meshBasicMaterial
          color={fx.color} toneMapped={false} transparent opacity={0} side={THREE.DoubleSide}
          depthWrite={false} blending={THREE.AdditiveBlending}
          polygonOffset polygonOffsetFactor={-8} polygonOffsetUnits={-8}
        />
      </mesh>
      <mesh ref={trail} material={fireMat}>
        <planeGeometry args={[1, 1]} />
      </mesh>
      <mesh ref={rock}>
        <dodecahedronGeometry args={[1.05, 0]} />
        <meshStandardMaterial
          color="#3a2418" emissive={fx.color} emissiveIntensity={2.2}
          roughness={0.9} metalness={0.1} flatShading toneMapped={false}
        />
      </mesh>
      <pointLight ref={light} color={fx.color} intensity={14} distance={26} decay={2} />
    </group>
  );
}
