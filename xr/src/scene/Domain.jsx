import { useRef, useMemo, useEffect } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { useGame } from '../store.js';
import { OPP_DIST } from '../config.js';
import { glowSprite } from './textures.js';
import { inkArc, inkStroke, burstMask } from './vfxTextures.js';
import { createVfxMaterial, stepVfx } from './VfxMaterial.js';
import { toonMaterial, addOutline } from './toon.js';
import { impactFeel } from './feel.js';
import { clamp01, easeOutCubic, vfxScale } from './anim.js';

// ============================================================================
// DOMAIN EXPANSION
//
// The ultimate. Reference is Malevolent Shrine: a *demonic Buddhist shrine* —
// a distorted zushi hung with bovine skulls and horns, with grotesque mouths
// for entrances. Critically it is described as organic and unsettling rather
// than clean and geometric, which is the opposite of how one would naturally
// build a shrine out of boxes, and the note that made this design work.
//
// A domain is not a projectile. It TAKES OVER THE SPACE: the world drains to
// near-black, the structure erupts around the arena, and everything inside is
// cut. So it runs in four beats —
//
//   1. COLLAPSE  the world folds inward, colour drains
//   2. MANIFEST  the shrine erupts, bone by bone
//   3. SEVER     the cut lands — the whole screen flashes
//   4. RECEDE    the domain withdraws
//
// The timing is deliberately slow. An ultimate that resolves in half a second
// is a spell; one that holds the screen for four seconds is an event.
// ============================================================================

const RAW_BEATS = { collapse: 900, manifest: 1200, sever: 500, recede: 1100 };

const CZ = -OPP_DIST / 2;

// The shrine is sized FROM the arena rather than in absolute metres. It was
// authored against a 9m duelling distance; when that doubled, a cage of radius
// 8 sat in the middle of an 18m floor like a garden fence. Deriving it means the
// composition survives the next time the arena changes.
const S = OPP_DIST / 9;

// Scratch objects, reused per frame so the flash placement allocates nothing.
const _p = new THREE.Vector3();
const _q = new THREE.Quaternion();

export default function Domain() {
  const fx = useGame((s) => s.fx);
  const active = fx.find((f) => f.kind === 'domain');
  return active ? <Shrine key={active.id} fx={active} /> : null;
}

function Shrine({ fx }) {
  const removeFx = useGame((s) => s.removeFx);
  const { scene } = useThree();
  const born = useRef(performance.now());
  const struck = useRef(false);
  const prevBg = useRef(null);

  // Beats are captured once per cast so the sequence cannot change length
  // mid-flight, and so the capture harness's dilation applies to the whole run.
  const BEATS = useMemo(() => {
    const k = vfxScale();
    return { collapse: 900 * k, manifest: 1200 * k, sever: 500 * k, recede: 1100 * k };
  }, []);
  const TOTAL = BEATS.collapse + BEATS.manifest + BEATS.sever + BEATS.recede;

  const group = useRef();
  const ringRef = useRef();
  const flashRef = useRef();
  const bonesRef = useRef();
  const skullRef = useRef();
  const slashRefs = useRef([]);
  const lintelRef = useRef();
  const emberRef = useRef();
  const cracksRef = useRef();

  // --- materials --------------------------------------------------------
  const boneMat = useMemo(() => toonMaterial({
    // Near-white bone blows straight out under bloom, which flattens the cel
    // banding into one white shape — the thing that made these read as plastic
    // cones. A mid bone value keeps all three bands distinguishable.
    color: '#7d7466', rimColor: '#ff4d5e', rimPower: 2.0, rimStrength: 1.35,
    stops: [0.42, 0.74], levels: [0.16, 0.52, 0.92],
  }), []);
  const darkMat = useMemo(() => toonMaterial({
    color: '#1a0d12', rimColor: '#e01e37', rimPower: 1.8, rimStrength: 1.4,
    stops: [0.5], levels: [0.15, 0.7],
  }), []);
  const arcMat = useMemo(() => createVfxMaterial({
    mask: inkArc(), color: '#e01e37', rimColor: '#ffd0d6',
    scroll: 0.2, distort: 0.03, cellMix: 0.2, rimWidth: 0.06,
  }), []);
  const slashMat = useMemo(() => createVfxMaterial({
    mask: inkStroke(), color: '#ff2d44', rimColor: '#ffffff',
    scroll: 0.5, distort: 0.04, cellMix: 0.3, rimWidth: 0.05,
  }), []);
  useEffect(() => () => {
    [boneMat, darkMat, arcMat, slashMat].forEach((m) => m.dispose());
  }, [boneMat, darkMat, arcMat, slashMat]);

  // --- the shrine skeleton ---------------------------------------------
  // Ribs arranged as a cage around the arena, deliberately irregular: a clean
  // radial array reads as architecture, and the reference is explicitly NOT
  // clean.
  // COMPOSITION NOTE: the first build put these at radius 13 and 13-18 units
  // tall. Everything manifested correctly — and was entirely outside a 52 deg
  // field of view, wrapped around and above the camera. A domain has to be
  // framed like a shot: the structure leans INWARD so it arches into view
  // overhead, and it is biased toward the far side so the player is looking
  // into it rather than standing in the middle of a fence.
  const ribs = useMemo(() => {
    const out = [];
    const N = 18;
    // The camera stands at the player, which is +OPP_DIST/2 on this group's z.
    // A rib on that side, leaning inward, passes directly over the eye — where
    // a nine-metre cone seen end-on is a slab across the top of the frame, not
    // architecture. The note above always said the cage should be biased toward
    // the FAR side so the player looks INTO it; this is that, implemented:
    // near-side ribs are pushed out, shortened, and stood up straight.
    const camZ = OPP_DIST / 2;
    for (let i = 0; i < N; i++) {
      const a = (i / N) * Math.PI * 2 + Math.sin(i * 2.3) * 0.12;
      // 0 on the far side, 1 directly over the camera
      const nearness = clamp01((Math.sin(a) * camZ + camZ) / (2 * camZ));
      const r = ((7.8 + Math.sin(i * 1.7) * 1.3) + nearness * 4.5) * S;
      out.push({
        a, r,
        h: (8.2 + Math.sin(i * 3.1) * 2.2) * (1 - nearness * 0.45) * S,
        // leans in hard on the far side so the cage arches into view; stands
        // near-vertical beside the player so nothing hangs over the camera
        lean: (0.46 + Math.sin(i * 0.9) * 0.12) * (1 - nearness * 0.85),
        delay: (i / N) * 0.5 + Math.abs(Math.sin(i * 5.1)) * 0.18,
        thick: (0.26 + Math.abs(Math.sin(i * 2.7)) * 0.20) * S,
        // Spurs jutting off each rib. A tapered cylinder is a cone no matter
        // how it is shaded; it is the irregular outgrowths that make the
        // silhouette read as bone, and the reference is explicitly not clean.
        spurs: Array.from({ length: 3 }, (_, k) => ({
          at: 0.28 + k * 0.24 + Math.sin(i * 3.7 + k) * 0.06,
          len: (0.34 + Math.abs(Math.sin(i * 2.2 + k * 1.9)) * 0.55) * S,
          roll: i * 1.3 + k * 2.1,
          tilt: 0.5 + Math.sin(i + k * 2.7) * 0.45,
        })),
      });
    }
    return out;
  }, []);

  // Ash and embers drifting through the space. A dozen big shapes is the same
  // "one blob" problem at arena scale — a domain has to feel OCCUPIED, and a
  // few hundred drifting motes do that for one draw call where more geometry
  // would cost real frames.
  const embers = useMemo(() => {
    const N = 320;
    const pos = new Float32Array(N * 3);
    const seed = new Float32Array(N * 2);
    // The camera stands at the player, which in this group's local space is
    // +OPP_DIST/2 on z. Size-attenuated point sprites spawned around it balloon
    // to fill the screen — an additive red haze over the whole frame that hides
    // everything behind it. Keep the field clear of the eye.
    const CAM_LOCAL_Z = OPP_DIST / 2;
    const CLEAR = 4.2 * S;
    for (let i = 0; i < N; i++) {
      let x = 0; let z = 0;
      for (let tries = 0; tries < 12; tries++) {
        const a = Math.random() * Math.PI * 2;
        const r = (2 + Math.sqrt(Math.random()) * 6.5) * S;
        x = Math.cos(a) * r;
        z = Math.sin(a) * r;
        if (Math.hypot(x, z - CAM_LOCAL_Z) > CLEAR) break;
      }
      pos[i * 3] = x;
      pos[i * 3 + 1] = Math.random() * 11;
      pos[i * 3 + 2] = z;
      seed[i * 2] = 0.25 + Math.random() * 1.4;      // fall speed
      seed[i * 2 + 1] = Math.random() * Math.PI * 2; // sway phase
    }
    return { N, pos, seed, base: pos.slice() };
  }, []);

  const emberMat = useMemo(() => new THREE.PointsMaterial({
    color: '#ff5a48', size: 0.055, transparent: true, opacity: 0,
    depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false,
    map: glowSprite(), sizeAttenuation: true,
  }), []);
  useEffect(() => () => emberMat.dispose(), [emberMat]);

  // Cracks get a plain basic material, NOT a clone of the VFX shader. A
  // ShaderMaterial's fade lives in a `uOpacity` uniform that `stepVfx` drives
  // on ONE instance; setting `.opacity` on a clone of it silently does nothing,
  // so every clone renders at full additive brightness forever. Fourteen of
  // those on the floor is what washed the entire frame pink.
  const crackMat = useMemo(() => new THREE.MeshBasicMaterial({
    color: '#ff2d44', map: inkStroke(), transparent: true, opacity: 0,
    depthWrite: false, side: THREE.DoubleSide, toneMapped: false,
    blending: THREE.AdditiveBlending,
  }), []);
  useEffect(() => () => crackMat.dispose(), [crackMat]);

  // Cracks splitting the floor outward from under the target. Flat, hard-edged
  // and radial, so the ground reads as broken rather than merely lit.
  const cracks = useMemo(() => Array.from({ length: 14 }, (_, i) => ({
    a: (i / 14) * Math.PI * 2 + Math.sin(i * 3.3) * 0.24,
    len: (3.2 + Math.abs(Math.sin(i * 1.9)) * 4.4) * S,
    w: (0.07 + Math.abs(Math.sin(i * 2.7)) * 0.13) * S,
    delay: Math.abs(Math.sin(i * 4.7)) * 0.4,
  })), []);

  // Torii-like lintels stacked overhead — the shrine reading.
  // Pushed higher and narrower than the first pass: at radius 7 and y 6.6 the
  // widest ring hangs straight over the camera, where a 6-segment torus shows
  // as a flat grey slab across the top of the frame rather than as a ring.
  const lintels = useMemo(() => ([
    { y: 7.8 * S, r: 5.4 * S, t: 0.30 * S, delay: 0.50 },
    { y: 9.4 * S, r: 4.1 * S, t: 0.24 * S, delay: 0.66 },
    { y: 10.8 * S, r: 2.9 * S, t: 0.18 * S, delay: 0.80 },
  ]), []);

  useEffect(() => {
    prevBg.current = scene.background;
    return () => { scene.background = prevBg.current; };
  }, [scene]);

  // Cel outlines on the structure. Without them the ribs are pale cones against
  // a dark arena with no edge at all — the exact "flat and cheap" reading.
  useEffect(() => {
    // Outline weight is `thickness * view depth`, so it is tuned per SCALE, not
    // copied between objects. The character's 0.012 sits 2m from the eye; these
    // ribs stand 12-15m out, where the same number would wrap each one in a
    // shell wider than the bone itself.
    if (bonesRef.current) addOutline(bonesRef.current, { thickness: 0.009 });
    if (skullRef.current) addOutline(skullRef.current, { thickness: 0.011 });
  }, []);

  // DEV: `window.__domainHide = 'lintels,skull'` drops parts of the structure so
  // an offending element can be bisected out in one capture instead of guessed at.
  const hidden = useMemo(() => new Set(
    (import.meta.env?.DEV && typeof window !== 'undefined' && window.__domainHide
      ? String(window.__domainHide).split(',') : []).map((x) => x.trim()),
  ), []);

  useFrame(({ camera }, dt) => {
    const now = performance.now();
    const t = now - born.current;
    if (t > TOTAL) { removeFx(fx.id); return; }

    const collapse = clamp01(t / BEATS.collapse);
    const manifest = clamp01((t - BEATS.collapse) / BEATS.manifest);
    const severT = (t - BEATS.collapse - BEATS.manifest) / BEATS.sever;
    const sever = clamp01(severT);
    const recede = clamp01((t - BEATS.collapse - BEATS.manifest - BEATS.sever) / BEATS.recede);

    // 1. the world drains — this is what says "the space is his now"
    if (scene.background && scene.background.isColor !== true) {
      scene.background = new THREE.Color('#05010a');
    }
    if (scene.background?.isColor) {
      const k = Math.max(collapse * (1 - recede), 0);
      scene.background.setRGB(0.02 + 0.03 * (1 - k), 0.004, 0.04 * (1 - k) + 0.01);
    }

    const alive = (1 - recede);

    if (import.meta.env?.DEV) {
      window.__domainT = {
        t: Math.round(t), total: Math.round(TOTAL),
        collapse: +collapse.toFixed(2), manifest: +manifest.toFixed(2),
        sever: +sever.toFixed(2), recede: +recede.toFixed(2),
      };
    }

    if (group.current) {
      group.current.visible = true;
      group.current.rotation.y += dt * 0.035;
    }

    // 2. bones erupt, each on its own delay
    if (bonesRef.current) {
      bonesRef.current.visible = !hidden.has('ribs');
      bonesRef.current.children.forEach((m, i) => {
        const r = ribs[i];
        if (!r) return;
        const p = clamp01((manifest - r.delay) / Math.max(0.2, 1 - r.delay));
        const e = easeOutCubic(p) * alive;
        m.scale.y = Math.max(0.001, e);
        m.visible = e > 0.01;
      });
    }
    // lintels drop in on their own delays — they carried a `delay` all along
    // and nothing ever read it, so they appeared fully formed at frame one
    if (lintelRef.current) {
      lintelRef.current.visible = !hidden.has('lintels');
      lintelRef.current.children.forEach((m, i) => {
        const l = lintels[i];
        if (!l) return;
        const p = clamp01((manifest - l.delay) / Math.max(0.2, 1 - l.delay));
        const e = easeOutCubic(p) * alive;
        m.visible = e > 0.01;
        m.scale.setScalar(e);
        m.position.y = l.y + (1 - e) * 2.5 * S;
      });
    }

    if (skullRef.current) {
      skullRef.current.visible = !hidden.has('skull');
      const p = easeOutCubic(clamp01((manifest - 0.35) / 0.5)) * alive;
      skullRef.current.scale.setScalar(p * 2.2 * S);
      skullRef.current.visible = p > 0.01;
      skullRef.current.position.y = (4.0 + (1 - p) * 3) * S;
    }

    if (ringRef.current) {
      ringRef.current.visible = !hidden.has('sigil');
      // A GROUND sigil lies on the ground. Billboarding it to the camera turned
      // an 11-unit disc into a red wall filling the entire view — which is what
      // washed the whole frame out and hid the shrine behind it.
      const rs = (2 + manifest * 9) * (1 - recede * 0.35) * S;
      ringRef.current.scale.set(rs, rs, 1);
      stepVfx(arcMat, dt, 0.1 + recede * 0.7, alive * (0.35 + manifest * 0.5));
    }

    // embers drift down and sway; they arrive with the collapse and outlive it
    if (emberRef.current) {
      emberRef.current.visible = !hidden.has('embers');
      const arr = emberRef.current.geometry.attributes.position.array;
      const tSec = t / 1000;
      for (let i = 0; i < embers.N; i++) {
        const sp = embers.seed[i * 2];
        const ph = embers.seed[i * 2 + 1];
        let y = embers.base[i * 3 + 1] - tSec * sp * 0.6 * S;
        // wrap rather than respawn, so the field never thins out
        y = ((y % (11 * S)) + 11 * S) % (11 * S);
        arr[i * 3] = embers.base[i * 3] + Math.sin(tSec * 0.7 + ph) * 0.35;
        arr[i * 3 + 1] = y;
        arr[i * 3 + 2] = embers.base[i * 3 + 2] + Math.cos(tSec * 0.5 + ph) * 0.35;
      }
      emberRef.current.geometry.attributes.position.needsUpdate = true;
      emberMat.opacity = collapse * alive * 0.32;
    }

    // cracks tear outward during the manifest
    if (cracksRef.current) {
      cracksRef.current.visible = !hidden.has('cracks');
      cracksRef.current.children.forEach((m, i) => {
        const c = cracks[i];
        const p = clamp01((manifest - c.delay) / Math.max(0.2, 1 - c.delay));
        const e = easeOutCubic(p) * alive;
        m.visible = e > 0.01;
        m.scale.set(c.w, c.len * e, 1);
        m.position.set(Math.cos(c.a) * c.len * e * 0.5, 0.04, Math.sin(c.a) * c.len * e * 0.5);
        m.material.opacity = e * 0.55;
      });
    }

    // 3. the cut. Every slash fires at once and the frame blows out.
    slashRefs.current.forEach((m, i) => {
      if (!m) return;
      const s = clamp01((sever - i * 0.13) / 0.30);
      m.visible = s > 0.01 && recede < 0.5;
      // At scale 11 five camera-facing quads simply fill the view and the frame
      // goes flat pink. A cut should read as a stroke ACROSS the shrine, not
      // as a curtain in front of it.
      m.scale.setScalar((1.4 + s * 4.5) * S);
      m.lookAt(camera.position);
      m.rotation.z = i * 1.1 + s * 0.4;
    });
    if (sever > 0 && !struck.current) {
      struck.current = true;
      impactFeel(3.0, fx.dir === 'in');
    }
    if (flashRef.current && group.current) {
      const f = sever > 0 ? Math.max(0, 1 - Math.abs(severT - 0.35) * 5) : 0;
      flashRef.current.material.opacity = f * 0.42;
      flashRef.current.visible = f > 0.01;
      // The flash is a child of a group that is both offset to CZ and slowly
      // rotating, and `position` is PARENT-LOCAL — copying a world-space camera
      // position into it parks the plane half an arena away, facing nowhere.
      // Place it just in front of the camera in world space, then convert.
      camera.getWorldPosition(_p);
      camera.getWorldQuaternion(_q);
      _p.add(new THREE.Vector3(0, 0, -1).applyQuaternion(_q));
      group.current.worldToLocal(_p);
      flashRef.current.position.copy(_p);
      // Same for orientation: undo the parent's world rotation so the plane
      // ends up square to the camera rather than square to the group.
      group.current.getWorldQuaternion(flashRef.current.quaternion);
      flashRef.current.quaternion.invert().multiply(_q);
    }
    stepVfx(slashMat, dt, 0.15 + sever * 0.4, alive);
  });

  return (
    <group ref={group} position={[0, 0, CZ]}>
      {/* rib cage */}
      <group ref={bonesRef}>
        {ribs.map((r, i) => (
          <group
            key={i}
            position={[Math.cos(r.a) * r.r, 0, Math.sin(r.a) * r.r]}
            rotation={[Math.cos(r.a) * r.lean, -r.a, Math.sin(r.a) * r.lean]}
            scale={[1, 0.001, 1]}
          >
            {/* tapered shaft; origin at the base so it grows upward */}
            <mesh material={boneMat} position={[0, r.h / 2, 0]}>
              <cylinderGeometry args={[r.thick * 0.3, r.thick, r.h, 7, 1]} />
            </mesh>
            {r.spurs.map((sp, k) => (
              <mesh
                key={k}
                material={boneMat}
                position={[0, r.h * sp.at, 0]}
                rotation={[Math.sin(sp.roll) * sp.tilt, sp.roll, Math.cos(sp.roll) * sp.tilt]}
              >
                <coneGeometry args={[r.thick * 0.42, sp.len, 5]} />
              </mesh>
            ))}
          </group>
        ))}
      </group>

      {/* the skull at the crown — the shrine's face */}
      <group ref={skullRef} position={[0, 4.0 * S, -1.6 * S]}>
        <mesh material={boneMat}>
          <sphereGeometry args={[1, 16, 12]} />
        </mesh>
        {/* horns */}
        {[-1, 1].map((s) => (
          <mesh key={s} position={[s * 0.72, 0.55, 0]} rotation={[0.2, 0, -s * 0.9]} material={boneMat}>
            <coneGeometry args={[0.24, 1.7, 7]} />
          </mesh>
        ))}
        {/* eye sockets + maw, dark so they read as holes */}
        {[-1, 1].map((s) => (
          <mesh key={s} position={[s * 0.36, 0.12, 0.82]} material={darkMat}>
            <sphereGeometry args={[0.26, 12, 10]} />
          </mesh>
        ))}
        <mesh position={[0, -0.55, 0.72]} rotation={[0.35, 0, 0]} material={darkMat}>
          <boxGeometry args={[0.9, 0.5, 0.5]} />
        </mesh>
      </group>

      {/* embers */}
      <points ref={emberRef} material={emberMat}>
        <bufferGeometry>
          <bufferAttribute attach="attributes-position" args={[embers.pos, 3]} />
        </bufferGeometry>
      </points>

      {/* floor cracks */}
      <group ref={cracksRef}>
        {cracks.map((c, i) => (
          <mesh key={i} rotation={[-Math.PI / 2, 0, -c.a]} material={crackMat.clone()}>
            <planeGeometry args={[1, 1]} />
          </mesh>
        ))}
      </group>

      {/* stacked lintels */}
      <group ref={lintelRef}>
        {lintels.map((l, i) => (
          <mesh key={i} position={[0, l.y, 0]} rotation={[Math.PI / 2, 0, 0]} material={boneMat}>
            {/* enough segments to read as a ring; at 6 the cross-section shows
                as flat facets the size of billboards from directly underneath */}
            <torusGeometry args={[l.r, l.t, 10, 48]} />
          </mesh>
        ))}
      </group>

      {/* ground sigil */}
      <mesh ref={ringRef} position={[0, 0.06, 0]} rotation={[-Math.PI / 2, 0, 0]} material={arcMat}>
        <planeGeometry args={[1, 1]} />
      </mesh>

      {/* the cut */}
      {Array.from({ length: 5 }).map((_, i) => (
        <mesh
          key={i}
          ref={(m) => { slashRefs.current[i] = m; }}
          position={[0, 1.4 + i * 0.55, -1.2]}
          material={slashMat}
          visible={false}
        >
          <planeGeometry args={[1, 0.42]} />
        </mesh>
      ))}

      {/* full-frame blowout at the moment of the cut */}
      <mesh ref={flashRef} visible={false}>
        <planeGeometry args={[60, 40]} />
        <meshBasicMaterial color="#ffe8ea" transparent opacity={0} depthTest={false} depthWrite={false} toneMapped={false} />
      </mesh>
    </group>
  );
}
