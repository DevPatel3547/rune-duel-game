import { useRef, useState, useEffect } from 'react';
import { useThree, useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { useGame, spellInfo } from '../store.js';
import { StrokeProjector, downsample } from './projection.js';
import { PRESENCE_HZ } from '../config.js';
import { roleForPoint, MOVE_LIMIT } from '../movement.js';
import GlowTrail from './GlowTrail.jsx';
import CastingCircle, { circleBegin, circleEnd } from './CastingCircle.jsx';

// Non-VR drawing. We listen for pointer events directly on the WebGL canvas and
// intersect the ray with a fixed plane floating in front of the player, instead
// of relying on R3F's mesh picking — this is rock-solid across browsers and
// matches the VR projection exactly.
const DRAW_PLANE = new THREE.Plane(new THREE.Vector3(0, 0, 1), 1.15); // z = -1.15

export default function DesktopCaster() {
  const { camera, gl } = useThree();
  const draw = useRef({ active: false, proj: null, pts3: [], pts2: [], start: 0 });
  const [trail, setTrail] = useState({ points: [], color: '#cdebff', opacity: 1 });
  const lastHand = useRef([0, 1.3, -1]);
  const presenceAcc = useRef(0);
  const flash = useRef(null);
  const ray = useRef(new THREE.Raycaster()).current;
  const ndc = useRef(new THREE.Vector2()).current;
  const hitPt = useRef(new THREE.Vector3()).current;
  const q = useRef(new THREE.Quaternion()).current;
  const p = useRef(new THREE.Vector3()).current;

  // Screen pointer → world point on the drawing plane. Returns null if the ray
  // misses (e.g. pointing away from the plane).
  const planePoint = (e) => {
    const rect = gl.domElement.getBoundingClientRect();
    ndc.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    ndc.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
    ray.setFromCamera(ndc, camera);
    return ray.ray.intersectPlane(DRAW_PLANE, hitPt) ? hitPt : null;
  };

  useEffect(() => {
    const el = gl.domElement;

    // A pointer is bound to the role of the zone it STARTED in and keeps it
    // until release, even if it wanders across the boundary. Without this,
    // every dodge would start a half-drawn rune and every downward rune stroke
    // would drift the player sideways.
    const roles = new Map();      // pointerId -> 'move' | 'draw'
    const moveOrigin = new Map(); // pointerId -> clientX at press

    const recomputeMoveInput = () => {
      const g = useGame.getState();
      let input = 0;
      for (const [id, role] of roles) {
        if (role !== 'move') continue;
        const cur = moveOrigin.get(id);
        if (!cur) continue;
        // Displacement from where the finger landed, normalised over a
        // comfortable thumb travel. Relative rather than absolute, so the band
        // works wherever on it you happen to press.
        const dx = (cur.now - cur.start) / (el.clientWidth * 0.22);
        input += Math.max(-1, Math.min(1, dx));
      }
      g.move.input = Math.max(-1, Math.min(1, input));
    };

    const onDown = (e) => {
      const g = useGame.getState();
      if (g.phase === 'over') { g.rematch(); return; }
      if (g.phase !== 'live' && g.phase !== 'drawing') return;

      const rect = el.getBoundingClientRect();
      const role = roleForPoint(e.clientY, rect);
      roles.set(e.pointerId, role);
      el.setPointerCapture?.(e.pointerId);

      if (role === 'move') {
        moveOrigin.set(e.pointerId, { start: e.clientX, now: e.clientX });
        recomputeMoveInput();
        return;
      }
      // Only one stroke at a time; a second drawing finger is ignored rather
      // than corrupting the one in progress.
      if (draw.current.active) return;
      const pt = planePoint(e);
      if (!pt) return;
      clearTimeout(flash.current);
      camera.getWorldQuaternion(q);
      draw.current = { active: true, id: e.pointerId, proj: new StrokeProjector(q), pts3: [], pts2: [], start: performance.now() };
      pushPoint(pt);
      setTrail({ points: [], color: '#e8d6a8', opacity: 1 });
      circleBegin('#d9a441');
    };

    const onMove = (e) => {
      const role = roles.get(e.pointerId);
      if (role === 'move') {
        const o = moveOrigin.get(e.pointerId);
        if (o) { o.now = e.clientX; recomputeMoveInput(); }
        return;
      }
      if (!draw.current.active || draw.current.id !== e.pointerId) return;
      const pt = planePoint(e);
      if (pt) pushPoint(pt);
    };

    const onUp = (e) => {
      const role = roles.get(e.pointerId);
      roles.delete(e.pointerId);
      moveOrigin.delete(e.pointerId);
      if (role === 'move') { recomputeMoveInput(); return; }
      if (draw.current.active && draw.current.id === e.pointerId) finish();
    };

    // Desktop: unambiguous, so no zoning needed.
    const onKey = (down) => (e) => {
      const g = useGame.getState();
      const k = e.key.toLowerCase();
      const dir = (k === 'a' || k === 'arrowleft') ? 'left'
        : (k === 'd' || k === 'arrowright') ? 'right' : null;
      if (!dir) return;
      if (down) g.move.keys.add(dir); else g.move.keys.delete(dir);
      e.preventDefault();
    };
    const onKeyDown = onKey(true);
    const onKeyUp = onKey(false);

    el.addEventListener('pointerdown', onDown);
    el.addEventListener('pointermove', onMove);
    el.addEventListener('pointerup', onUp);
    el.addEventListener('pointercancel', onUp);
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    return () => {
      el.removeEventListener('pointerdown', onDown);
      el.removeEventListener('pointermove', onMove);
      el.removeEventListener('pointerup', onUp);
      el.removeEventListener('pointercancel', onUp);
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
    };
  }, [gl, camera]); // eslint-disable-line react-hooks/exhaustive-deps

  function pushPoint(pt) {
    const d = draw.current;
    d.pts3.push([pt.x, pt.y, pt.z]);
    d.pts2.push(d.proj.project(pt));
    lastHand.current = [pt.x, pt.y, pt.z];
    setTrail((t) => ({ ...t, points: d.pts3.slice() }));
  }

  function finish() {
    const d = draw.current;
    if (!d.active) return;
    d.active = false;
    const g = useGame.getState();
    if (d.pts2.length < 8) {
      circleEnd(false, '#8a7f6a');
      setTrail({ points: [], color: '#e8d6a8', opacity: 1 });
      return;
    }
    const drawTime = (performance.now() - d.start) / 1000;
    const match = g.submitCast(downsample(d.pts2, 96), drawTime);
    g.sendTrailEnd({ points: downsample(d.pts3, 64) });
    const ok = !!(match && match.spellId && !match.fizzled && !match.blocked);
    const color = ok ? (spellInfo(match.spellId)?.color || '#fff') : '#8a7f6a';
    // The circle resolving is the primary feedback: it collapses inward on a
    // successful cast and blows apart on a fizzle, which reads faster than any
    // text toast.
    circleEnd(ok, color);
    setTrail({ points: d.pts3.slice(), color, opacity: 1 });
    let o = 1;
    const fade = () => {
      o -= 0.08;
      if (o <= 0) return setTrail({ points: [], color, opacity: 0 });
      setTrail((t) => ({ ...t, opacity: o }));
      flash.current = setTimeout(fade, 40);
    };
    flash.current = setTimeout(fade, 320);
  }

  useFrame((_, dt) => {
    const g = useGame.getState();
    if (g.mode !== 'online') return;
    presenceAcc.current += dt;
    if (presenceAcc.current < 1 / PRESENCE_HZ) return;
    presenceAcc.current = 0;
    camera.getWorldPosition(p); camera.getWorldQuaternion(q);
    g.sendPresence({
      head: { p: [p.x, p.y, p.z], q: [q.x, q.y, q.z, q.w] },
      hands: [{ p: lastHand.current, q: [0, 0, 0, 1], draw: draw.current.active }],
    });
    if (draw.current.active) g.sendTrail({ points: downsample(draw.current.pts3, 80), active: true });
  });

  return (
    <>
      <CastingCircle />
      <GlowTrail points={trail.points} color={trail.color} size={0.055} opacity={trail.opacity} />
    </>
  );
}
