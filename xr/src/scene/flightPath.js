import * as THREE from 'three';
// The flight path as a PURE function of normalised progress. Pulling this out
// of the frame loop is what lets the trail be sampled analytically instead of
// recorded frame by frame — a recorded trail is only as long as the frame rate
// allows, so on a slow device (or in the software-rendered harness, which runs
// this scene at well under 1 fps) it collapses to a stub. Sampling the curve
// gives the same ribbon at 5 fps as at 120.
//
// Deliberately excludes `jitter` and the `erratic` wobble: those are per-frame
// randomness that cannot be reproduced for an arbitrary t, and a trail should
// be the smooth sweep of the motion anyway, not a recording of its noise.
const PATH_AXIS = new THREE.Vector3();
const PATH_SIDE = new THREE.Vector3();

export function pathPoint(from, to, p, t, travel, out) {
  const te = p.motion === 'dart' ? t
    : p.motion === 'lob' ? t * t * 0.35 + t * 0.65
    : (t < 0.5 ? t : 1 - Math.pow(1 - t, 1.6));
  out.copy(from).lerp(to, te);
  out.y += Math.sin(t * Math.PI) * p.arc;

  PATH_AXIS.copy(to).sub(from).setY(0).normalize();
  PATH_SIDE.set(-PATH_AXIS.z, 0, PATH_AXIS.x);

  // LATERAL SWEEP — the single most important term in this function.
  //
  // The player's own spells fly directly AWAY from a first-person camera, so a
  // trail behind one is foreshortened into the projectile and is, geometrically,
  // invisible. Every ribbon, afterimage and speed line was therefore doing
  // nothing during actual play; it only ever showed up in captures that were
  // deliberately staged side-on. Bulging the flight out to one side and back
  // puts the whole arc across the screen instead of down the barrel, which is
  // what makes a spell something you WATCH travel rather than a dot that grows.
  if (p.sweep) out.addScaledVector(PATH_SIDE, Math.sin(t * Math.PI) * p.sweep);
  // `age` is derived from t rather than read off the clock, so the curve can be
  // evaluated at any point along the flight, not just "now".
  const age = (t * travel) / 1000;
  if (p.motion === 'spiral') {
    const r = 0.42 * (1 - t * 0.65);
    const a = age * 9 * Math.sign(p.spin || 1);
    out.addScaledVector(PATH_SIDE, Math.cos(a) * r);
    out.y += Math.sin(a) * r;
  } else if (p.motion === 'drift') {
    out.addScaledVector(PATH_SIDE, Math.sin(age * 2.1) * 0.22);
    out.y += Math.sin(age * 1.6 + 1.2) * 0.12;
  }
  return out;
}
