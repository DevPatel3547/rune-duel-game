import * as THREE from 'three';

// Projects an air-drawn 3D stroke onto the flat "page" the player sees, so the
// existing $1 unistroke recognizer (which is 2D) can score it. We freeze a
// camera-facing basis at the moment the stroke begins: horizontal axis = the
// head's right vector flattened to the ground plane, vertical axis = world up.
// Depth (toward/away from the player) is intentionally discarded — you can draw
// at any arm distance and it still reads the same glyph.
export class StrokeProjector {
  constructor(headQuat) {
    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(headQuat);
    right.y = 0;
    if (right.lengthSq() < 1e-6) right.set(1, 0, 0); // looking straight down
    right.normalize();
    this.right = right;
    this.up = new THREE.Vector3(0, 1, 0);
    this.origin = null;
    this._v = new THREE.Vector3();
  }

  // worldPoint: THREE.Vector3. Returns { x, y } in the recognizer's y-down space.
  project(worldPoint) {
    if (!this.origin) this.origin = worldPoint.clone();
    this._v.copy(worldPoint).sub(this.origin);
    const x = this._v.dot(this.right);
    const y = this._v.dot(this.up);
    // ×1000: keep the recognizer working in comfortable integer-ish magnitudes
    // (it re-normalizes scale anyway). y negated → screen-style y-down.
    return { x: x * 1000, y: -y * 1000 };
  }
}

// Reduce a dense stroke to at most `max` evenly spaced points before sending it
// to the recognizer / server (server caps at 1500; recognizer wants ~64).
export function downsample(points, max = 96) {
  if (points.length <= max) return points;
  const out = [];
  const step = (points.length - 1) / (max - 1);
  for (let i = 0; i < max; i++) out.push(points[Math.round(i * step)]);
  return out;
}
