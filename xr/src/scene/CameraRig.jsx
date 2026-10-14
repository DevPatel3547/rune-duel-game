import { useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { useXR } from '@react-three/xr';
import * as THREE from 'three';
import { useHitFeel, decayFeel } from './feel.js';
import { useGame } from '../store.js';
import { stepMovement, MOVE_LIMIT } from '../movement.js';
import { HEAD_HEIGHT, OPP_DIST, BASE_FOV } from '../config.js';

// ============================================================================
// CAMERA RIG — the difference between "an animation played" and "that hurt".
//
// Owns three things:
//   1. Idle breathing, so the view is never perfectly static (a locked camera
//      is the single loudest tell that you are looking at a tech demo).
//   2. Trauma-based shake on impact. Shake amplitude is trauma², which is the
//      standard trick: it makes small hits nearly imperceptible while big ones
//      are violent, instead of everything wobbling the same amount.
//   3. Advancing every feel envelope exactly once per frame. Effects.jsx and
//      the HUD only READ those values, so decay lives here and stays
//      authoritative.
//
// Skipped entirely in VR: moving a headset user's camera without their head
// moving is a fast route to motion sickness.
// ============================================================================

const BASE_POS = new THREE.Vector3(0, HEAD_HEIGHT, 0.4);
// Aim slightly below the opponent's chest. Looking at their head puts them dead
// centre and crops the arena; aiming lower seats them in the lower-middle third
// with the great arch above, which is the composition the set was built for.
const LOOK_AT = new THREE.Vector3(0, 1.15, -OPP_DIST);
const LOOK_TMP = new THREE.Vector3();

export default function CameraRig() {
  const { camera } = useThree();
  const inVR = !!useXR((s) => s.session);
  const t = useRef(0);
  const seed = useRef(Math.random() * 100);
  // Where the opponent is drawn, laterally, smoothed for the eye to follow.
  const oppLook = useRef(0);

  useFrame((_, rawDt) => {
    const dt = Math.min(0.05, rawDt);
    decayFeel(dt);
    if (inVR) return;
    // Dev escape hatch: this rig writes camera.position every frame, so the
    // visual QA harnesses cannot reposition the camera to inspect the scene
    // unless they can switch it off.
    if (import.meta.env?.DEV && typeof window !== 'undefined' && window.__freeCamera) return;

    const { shake, kick, focus } = useHitFeel.getState();
    t.current += dt;
    const time = t.current + seed.current;

    // ---- lateral movement ------------------------------------------------
    const g = useGame.getState();
    const live = g.screen === 'game' && (g.phase === 'live' || g.phase === 'countdown');
    if (!live) { g.move.input = 0; }
    const px = stepMovement(g.move, dt);
    // Lean into the sidestep and turn slightly toward the direction of travel:
    // a camera that slides without banking reads as a floating tripod.
    const leanRoll = -(g.move.vx / 4.6) * 0.055;
    const leanYaw = (g.move.vx / 4.6) * 0.035;

    // --- idle: a slow figure-eight sway, plus breathing ------------------
    const swayX = Math.sin(time * 0.42) * 0.022 + Math.sin(time * 0.19) * 0.014;
    const swayY = Math.sin(time * 0.63) * 0.013;
    const breath = Math.sin(time * 1.1) * 0.006;

    // --- trauma shake ----------------------------------------------------
    // squared falloff + high-frequency noise; three uncorrelated frequencies
    // per axis so it never resolves into a visible sine wave
    const s2 = shake * shake;
    const shakeX = s2 * 0.10 * (Math.sin(time * 47) + Math.sin(time * 31.3) * 0.6);
    const shakeY = s2 * 0.085 * (Math.sin(time * 53.7) + Math.sin(time * 37.1) * 0.6);
    const shakeRoll = s2 * 0.055 * Math.sin(time * 41.9);

    // --- impact kick: shove the eye backward, then settle -----------------
    const kickZ = kick * 0.16;

    camera.position.set(
      BASE_POS.x + px + swayX + shakeX,
      BASE_POS.y + swayY + breath + shakeY,
      BASE_POS.z + kickZ,
    );
    // Keep looking at the opponent as you strafe — the eye stays on the target
    // while the body slides, which is what makes a sidestep read as a dodge
    // rather than as the whole world panning.
    //
    // The eye also follows the OPPONENT. An online opponent strafes up to 5 m,
    // and at 18 m a portrait phone only frames about ±2.8 m — without tracking
    // they walk straight out of shot. Their own-frame x is mirrored here, and
    // smoothed slower than the avatar so the camera settles rather than jitters.
    oppLook.current += (-(g.oppX || 0) - oppLook.current) * Math.min(1, dt * 3.5);
    LOOK_TMP.set(LOOK_AT.x + px * 0.16 + oppLook.current * 0.92, LOOK_AT.y, LOOK_AT.z);
    camera.lookAt(LOOK_TMP);
    camera.rotateZ(shakeRoll + leanRoll + Math.sin(time * 0.31) * 0.004);
    camera.rotateY(leanYaw);

    // Nudge the FOV out on a hit — a subtle punch-out that reads as recoil.
    // Was hard-coded to 52 while <Canvas> was set to BASE_FOV. This rig rewrites
    // fov every frame, so it silently won: the arena was authored for 38 deg and
    // actually played at 52, which is why doubling the duelling distance made
    // the opponent small instead of making the space feel big.
    // ...and pull it IN for a spectacle cast. Eased (smoothstep on the
    // envelope) so the push-in starts gently instead of snapping.
    const f2 = focus * focus * (3 - 2 * focus);
    const targetFov = BASE_FOV + kick * 5.0 - f2 * 7.0;
    if (Math.abs(camera.fov - targetFov) > 0.01) {
      camera.fov += (targetFov - camera.fov) * Math.min(1, dt * 12);
      camera.updateProjectionMatrix();
    }
  });

  return null;
}

// Hit-stop: briefly slows the whole simulation on a heavy landing. Applied to
// the drivers rather than to rendering, so the visual stutter and the combat
// clock stay in agreement.
export function hitStopScale() {
  return useHitFeel.getState().hitStop > 0 ? 0.3 : 1;
}
