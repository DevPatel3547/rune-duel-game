import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';

// ============================================================================
// HANDS
//
// Previously a sphere. At the old 5 m duelling distance you could almost get
// away with that; at 9 m the silhouette matters more than the detail, and a
// featureless ball reads as a mitten on every frame.
//
// Built as a palm plus five digits, each digit a chain of tapered segments
// whose joints curl progressively. `curl` (0 = open, 1 = fist) drives the whole
// hand from one number, so a caster can open its hand to release a spell and
// close it around a staff with a single animated value.
//
// Geometry is shared across every finger segment and instanced by transform —
// one small cylinder reused ~30 times costs far less than 30 unique meshes.
// ============================================================================

// A tapered segment whose origin is the joint at its base, so rotating the
// parent group swings it about the knuckle rather than its midpoint.
const SEGMENT = new THREE.CylinderGeometry(1, 0.82, 1, 7);
SEGMENT.translate(0, 0.5, 0);   // base at the origin, extending +Y
const KNUCKLE = new THREE.SphereGeometry(1, 8, 6);

// Finger layout in palm-local space. x spreads across the palm, `len` is the
// total finger length, `base` the knuckle height. The little finger sits lower
// and shorter, the index highest — that asymmetry is most of what makes a hand
// read as a hand rather than a rake.
const FINGERS = [
  { x: -0.028, z: 0.004, len: 0.075, r: 0.0115, spread: -0.16, base: 0.020 },
  { x: -0.009, z: 0.008, len: 0.082, r: 0.0120, spread: -0.05, base: 0.024 },
  { x:  0.010, z: 0.006, len: 0.078, r: 0.0115, spread: 0.05, base: 0.022 },
  { x:  0.028, z: 0.000, len: 0.064, r: 0.0100, spread: 0.17, base: 0.016 },
];

// curl: 0 open, 1 closed. Each joint bends more than the one before it, which
// is how a real finger closes — the tip curls hardest.
//
// The three joint groups are captured into `joints` so the parent can drive
// them imperatively every frame. Re-rendering React to animate a finger would
// be absurd at 60 Hz.
function Finger({ x, z, len, r, spread, base, mat, joints }) {
  const l1 = len * 0.44, l2 = len * 0.33, l3 = len * 0.23;
  const j1 = useRef(), j2 = useRef(), j3 = useRef();
  joints.push({ j1, j2, j3 });
  return (
    <group position={[x, base, z]} rotation={[0, 0, -spread]}>
      <group ref={j1}>
        <mesh geometry={KNUCKLE} scale={r * 1.1} material={mat} />
        <mesh geometry={SEGMENT} scale={[r, l1, r]} material={mat} />
        <group ref={j2} position={[0, l1, 0]}>
          <mesh geometry={KNUCKLE} scale={r * 0.94} material={mat} />
          <mesh geometry={SEGMENT} scale={[r * 0.86, l2, r * 0.86]} material={mat} />
          <group ref={j3} position={[0, l2, 0]}>
            <mesh geometry={SEGMENT} scale={[r * 0.72, l3, r * 0.72]} material={mat} />
            <mesh geometry={KNUCKLE} position={[0, l3, 0]} scale={r * 0.66} material={mat} />
          </group>
        </group>
      </group>
    </group>
  );
}

// `curl` is a fixed pose; `curlSpring` (anything exposing `.value`) overrides it
// per frame for hands that open and close.
export default function Hand({ curl = 0.25, curlSpring = null, mat, scale = 1 }) {
  const joints = useMemo(() => [], []);
  const thumb1 = useRef(), thumb2 = useRef();
  // Reset on every render so refs collected during this pass do not accumulate
  // across hot reloads.
  joints.length = 0;

  useFrame(() => {
    const c = Math.max(0, Math.min(1, curlSpring ? curlSpring.value : curl));
    for (const f of joints) {
      if (f.j1.current) f.j1.current.rotation.x = c * 1.15;
      if (f.j2.current) f.j2.current.rotation.x = c * 1.35;
      if (f.j3.current) f.j3.current.rotation.x = c * 1.25;
    }
    if (thumb1.current) thumb1.current.rotation.x = c * 0.75;
    if (thumb2.current) thumb2.current.rotation.x = c * 0.95;
  });

  return (
    <group scale={scale}>
      {/* palm — flattened so the hand has a back and an edge, not a ball */}
      <mesh scale={[0.052, 0.042, 0.028]} material={mat}>
        <sphereGeometry args={[1, 12, 10]} />
      </mesh>
      {/* heel of the hand, filling the gap to the wrist */}
      <mesh position={[0, -0.030, 0]} scale={[0.040, 0.026, 0.026]} material={mat}>
        <sphereGeometry args={[1, 10, 8]} />
      </mesh>

      {FINGERS.map((f, i) => (
        <Finger key={i} {...f} mat={mat} joints={joints} />
      ))}

      {/* thumb: rooted lower and rotated out of the palm plane, which is the
          single feature that stops a hand reading as a paddle */}
      <group position={[-0.040, -0.012, 0.016]} rotation={[0.5, 0.2, 0.95]}>
        <group ref={thumb1}>
          <mesh geometry={KNUCKLE} scale={0.0135} material={mat} />
          <mesh geometry={SEGMENT} scale={[0.0125, 0.034, 0.0125]} material={mat} />
          <group ref={thumb2} position={[0, 0.034, 0]}>
            <mesh geometry={SEGMENT} scale={[0.0105, 0.028, 0.0105]} material={mat} />
            <mesh geometry={KNUCKLE} position={[0, 0.028, 0]} scale={0.0095} material={mat} />
          </group>
        </group>
      </group>
    </group>
  );
}
