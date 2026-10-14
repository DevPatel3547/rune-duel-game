import { useMemo, useRef, useState, useEffect } from 'react';
import { useThree, useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { useGame } from '../store.js';
import { spellInfo } from '../store.js';
import { StrokeProjector, downsample } from './projection.js';
import { mirrorPoint, PRESENCE_HZ, TRAIL_HZ } from '../config.js';
import GlowTrail from './GlowTrail.jsx';

const HAND_COLORS = ['#7fb4ff', '#ffce6a']; // left, right wands

// Drives both VR controllers AND Quest hands (gl.xr.getController fires
// 'select' on a pinch too). Pull the trigger / pinch to draw a rune in the air.
export default function VRHands() {
  const { gl, camera } = useThree();

  // Controllers + a tip anchor at the end of each wand (the "pen nib").
  const hands = useMemo(() => [0, 1].map((i) => {
    const c = gl.xr.getController(i);
    const tip = new THREE.Object3D();
    tip.position.set(0, 0, -0.09);
    c.add(tip);
    return { c, tip };
  }), [gl]);

  const draw = useRef({ active: false, hand: -1, proj: null, pts3: [], pts2: [], start: 0, netAcc: 0 });
  const presenceAcc = useRef(0);
  const [trail, setTrail] = useState({ points: [], color: '#cdebff', opacity: 1 });
  const flashTimer = useRef(null);

  const tmpPos = useRef(new THREE.Vector3()).current;
  const tmpQuat = useRef(new THREE.Quaternion()).current;

  // --- begin / end a stroke -------------------------------------------------
  useEffect(() => {
    const onStart = (i) => () => {
      const g = useGame.getState();
      if (g.phase === 'over') { g.rematch(); return; }
      if (g.phase !== 'drawing' || g.youSubmitted) return;
      if (draw.current.active) return;
      clearTimeout(flashTimer.current);
      camera.getWorldQuaternion(tmpQuat);
      draw.current = {
        active: true, hand: i, proj: new StrokeProjector(tmpQuat),
        pts3: [], pts2: [], start: performance.now(), netAcc: 0,
      };
      setTrail({ points: [], color: '#cdebff', opacity: 1 });
    };
    const onEnd = (i) => () => {
      const d = draw.current;
      if (!d.active || d.hand !== i) return;
      d.active = false;
      finalizeStroke(d);
    };

    const cleanups = hands.map(({ c }, i) => {
      const s = onStart(i); const e = onEnd(i);
      c.addEventListener('selectstart', s);
      c.addEventListener('selectend', e);
      return () => { c.removeEventListener('selectstart', s); c.removeEventListener('selectend', e); };
    });
    return () => cleanups.forEach((fn) => fn());
  }, [hands, camera]); // eslint-disable-line react-hooks/exhaustive-deps

  function finalizeStroke(d) {
    const g = useGame.getState();
    if (d.pts2.length < 8) { // too short — fizzle the gesture, don't submit
      setTrail({ points: [], color: '#cdebff', opacity: 1 });
      return;
    }
    const drawTime = (performance.now() - d.start) / 1000;
    const pts2 = downsample(d.pts2, 96);
    const match = g.submitCast(pts2, drawTime);
    g.sendTrailEnd({ points: downsample(d.pts3, 64) });

    // Flash the recognized spell's colour, then fade the trail out.
    const color = match && match.spellId && !match.fizzled
      ? (spellInfo(match.spellId)?.color || '#ffffff') : '#7a7a8a';
    setTrail({ points: d.pts3.slice(), color, opacity: 1 });
    let o = 1;
    const fade = () => {
      o -= 0.08;
      if (o <= 0) { setTrail({ points: [], color, opacity: 0 }); return; }
      setTrail((t) => ({ ...t, opacity: o }));
      flashTimer.current = setTimeout(fade, 40);
    };
    flashTimer.current = setTimeout(fade, 320);
  }

  // --- per-frame sampling + presence streaming ------------------------------
  useFrame((_, dt) => {
    const g = useGame.getState();

    // Stream head + both hand poses to the opponent.
    presenceAcc.current += dt;
    if (g.mode === 'online' && presenceAcc.current >= 1 / PRESENCE_HZ) {
      presenceAcc.current = 0;
      camera.getWorldPosition(tmpPos); camera.getWorldQuaternion(tmpQuat);
      const head = { p: [tmpPos.x, tmpPos.y, tmpPos.z], q: [tmpQuat.x, tmpQuat.y, tmpQuat.z, tmpQuat.w] };
      const handPoses = hands.map(({ c }, i) => {
        c.getWorldPosition(tmpPos); c.getWorldQuaternion(tmpQuat);
        return { p: [tmpPos.x, tmpPos.y, tmpPos.z], q: [tmpQuat.x, tmpQuat.y, tmpQuat.z, tmpQuat.w], draw: draw.current.active && draw.current.hand === i };
      });
      g.sendPresence({ head, hands: handPoses });
    }

    // Sample the active stroke.
    const d = draw.current;
    if (d.active) {
      hands[d.hand].tip.getWorldPosition(tmpPos);
      d.pts3.push([tmpPos.x, tmpPos.y, tmpPos.z]);
      d.pts2.push(d.proj.project(tmpPos));
      d.netAcc += dt;
      if (d.netAcc >= 1 / 60) { // refresh the visible trail ~60Hz
        d.netAcc = 0;
        setTrail((t) => ({ ...t, points: d.pts3.slice() }));
        if (g.mode === 'online') g.sendTrail({ points: downsample(d.pts3, 80), active: true });
      }
    }
  });

  return (
    <>
      {hands.map(({ c }, i) => (
        <primitive key={i} object={c}>
          <Wand color={HAND_COLORS[i]} />
        </primitive>
      ))}
      <GlowTrail points={trail.points} color={trail.color} size={0.045} opacity={trail.opacity} />
    </>
  );
}

// A simple glowing wand: a slim handle with a bright casting nib at the tip.
function Wand({ color }) {
  return (
    <group rotation={[-Math.PI / 2, 0, 0]}>
      <mesh position={[0, 0.05, 0]}>
        <cylinderGeometry args={[0.008, 0.012, 0.16, 12]} />
        <meshStandardMaterial color="#2a2030" roughness={0.6} metalness={0.3} />
      </mesh>
      <mesh position={[0, 0.14, 0]}>
        <sphereGeometry args={[0.022, 16, 16]} />
        <meshStandardMaterial color={color} emissive={color} emissiveIntensity={2.2} toneMapped={false} />
      </mesh>
      <pointLight position={[0, 0.15, 0]} color={color} intensity={1.4} distance={1.2} />
    </group>
  );
}
