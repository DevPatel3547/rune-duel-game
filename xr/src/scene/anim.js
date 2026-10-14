// ============================================================================
// PROCEDURAL ANIMATION TOOLKIT
//
// Everything that makes motion read as *alive* rather than *interpolated*.
//
// The previous character animated by writing sine waves and lerps straight to
// joint rotations every frame. That is why it looked robotic: a lerp toward a
// target has no momentum, so it can stop dead the instant the target stops, and
// a raw sine has no relationship to what the body is doing. Real bodies have
// mass — they overshoot, settle, and every part lags slightly behind its parent.
//
// So: springs, not lerps. Each value carries velocity, is driven toward a
// target by a stiffness force, and is bled off by damping. Motion then arrives
// with follow-through and settles naturally, and — critically — a chain of
// springs each following the one above it produces secondary motion (cloth
// swish, staff sway, head lag) for free.
// ============================================================================

// ------------------------------------------------------------- 1D spring ----

// Semi-implicit Euler spring. Stable at the frame rates we care about and
// cheap enough to run dozens of per frame.
//
//   stiffness — how hard it pulls toward the target (higher = snappier)
//   damping   — how fast energy bleeds off.
//               < critical  → overshoots and wobbles (bouncy, alive)
//               = critical  → fastest approach with no overshoot
//               > critical  → sluggish, never overshoots
//   Critical damping is 2*sqrt(stiffness).
export class Spring {
  constructor(value = 0, stiffness = 120, damping = 20) {
    this.value = value;
    this.target = value;
    this.velocity = 0;
    this.stiffness = stiffness;
    this.damping = damping;
  }

  set(v) { this.value = v; this.target = v; this.velocity = 0; return this; }
  to(t) { this.target = t; return this; }

  update(dt) {
    // Sub-step on long frames. A single large dt can make a stiff spring
    // explode (the classic instability), which on screen looks like a limb
    // snapping to infinity for one frame.
    const steps = dt > 1 / 45 ? 2 : 1;
    const h = dt / steps;
    for (let i = 0; i < steps; i++) {
      const force = (this.target - this.value) * this.stiffness;
      this.velocity += (force - this.velocity * this.damping) * h;
      this.value += this.velocity * h;
    }
    return this.value;
  }

  // Kick the spring without moving the target — used for impacts, so a hit
  // visibly rocks a joint that then settles back to its pose.
  impulse(v) { this.velocity += v; return this; }
}

// Convenience: a spring tuned to overshoot slightly, which reads as "effort".
export const springy = (v, stiffness = 150) => new Spring(v, stiffness, Math.sqrt(stiffness) * 1.1);
// Convenience: a spring that never overshoots, for things that shouldn't wobble.
export const smooth = (v, stiffness = 90) => new Spring(v, stiffness, 2 * Math.sqrt(stiffness) * 1.15);

// ------------------------------------------------------------ 3D spring -----

// Three independent springs sharing parameters. Used for positions and for
// look-at targets, where per-axis independence is fine and cheaper than a
// proper quaternion spring.
export class Spring3 {
  constructor(x = 0, y = 0, z = 0, stiffness = 120, damping = 20) {
    this.x = new Spring(x, stiffness, damping);
    this.y = new Spring(y, stiffness, damping);
    this.z = new Spring(z, stiffness, damping);
  }
  to(x, y, z) { this.x.to(x); this.y.to(y); this.z.to(z); return this; }
  set(x, y, z) { this.x.set(x); this.y.set(y); this.z.set(z); return this; }
  update(dt) { this.x.update(dt); this.y.update(dt); this.z.update(dt); return this; }
  applyPosition(obj) { obj.position.set(this.x.value, this.y.value, this.z.value); }
  applyRotation(obj) { obj.rotation.set(this.x.value, this.y.value, this.z.value); }
}

// ---------------------------------------------------------- spring chain ----

// A line of segments where each follows the previous one on a spring. Give it
// the motion of a root (a shoulder, a hood, the top of a staff) and it produces
// the trailing, whipping follow-through of cloth or hair without a cloth solver.
//
// Successive links are progressively looser, so the tip lags furthest — the
// thing that makes a cape read as fabric rather than a rigid board.
export class SpringChain {
  constructor(links = 3, stiffness = 90, damping = 14, falloff = 0.78) {
    this.links = Array.from({ length: links }, (_, i) => ({
      x: new Spring(0, stiffness * Math.pow(falloff, i), damping * Math.pow(falloff, i * 0.5)),
      z: new Spring(0, stiffness * Math.pow(falloff, i), damping * Math.pow(falloff, i * 0.5)),
    }));
  }

  // drive with the root's angular offset; returns the per-link values
  update(dt, rootX, rootZ) {
    let px = rootX, pz = rootZ;
    for (const l of this.links) {
      l.x.to(px); l.z.to(pz);
      px = l.x.update(dt);
      pz = l.z.update(dt);
    }
    return this.links;
  }

  impulse(vx, vz) {
    this.links.forEach((l, i) => {
      const s = 1 - i / (this.links.length + 1);
      l.x.impulse(vx * s); l.z.impulse(vz * s);
    });
  }
}

// ------------------------------------------------------------- easing -------

export const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
export const lerp = (a, b, t) => a + (b - a) * t;
// Frame-rate independent exponential approach. Use where a spring is overkill
// (fades, blends), NOT for anything with visible mass.
export const damp = (a, b, lambda, dt) => lerp(a, b, 1 - Math.exp(-lambda * dt));

export const easeOutCubic = (t) => 1 - Math.pow(1 - t, 3);
export const easeInCubic = (t) => t * t * t;
export const easeInOutCubic = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
export const easeOutQuint = (t) => 1 - Math.pow(1 - t, 5);
// Overshoots past 1 then settles — anticipation's counterpart on the release.
export function easeOutBack(t, over = 1.7) {
  const c3 = over + 1;
  return 1 + c3 * Math.pow(t - 1, 3) + over * Math.pow(t - 1, 2);
}
// Dips below 0 before rising — the wind-up itself.
export function easeInBack(t, over = 1.7) {
  const c3 = over + 1;
  return c3 * t * t * t - over * t * t;
}

// --------------------------------------------------------------- noise ------

// Smooth 1D value noise. Wandering, non-repeating motion for idle sway; a bare
// sine visibly loops and the eye picks that up within seconds.
const H = (n) => {
  const s = Math.sin(n * 127.1) * 43758.5453;
  return s - Math.floor(s);
};
export function noise1(x) {
  const i = Math.floor(x), f = x - i;
  const u = f * f * (3 - 2 * f);
  return lerp(H(i), H(i + 1), u) * 2 - 1;
}
// Layered octaves — broad drift plus fine jitter, like a real body holding still.
export function fbm1(x, octaves = 3) {
  let v = 0, amp = 0.5, freq = 1, norm = 0;
  for (let i = 0; i < octaves; i++) {
    v += noise1(x * freq + i * 17.3) * amp;
    norm += amp;
    amp *= 0.5; freq *= 2.1;
  }
  return v / norm;
}

// ------------------------------------------------------------ phase clip ----

// A one-shot animation with named phases, which is how an attack is actually
// built: ANTICIPATION (coil back — telegraphs intent), STRIKE (fast commit),
// RECOVERY (settle). Returns 0..1 progress within the current phase so poses
// can be driven off it.
export class PhaseClip {
  // phases: [['anticipate', 0.34], ['strike', 0.12], ['recover', 0.5]] (seconds)
  constructor(phases) {
    this.phases = phases;
    this.total = phases.reduce((s, [, d]) => s + d, 0);
    this.t = Infinity; // idle until played
  }
  play() { this.t = 0; return this; }
  get playing() { return this.t < this.total; }
  update(dt) { if (this.t < this.total) this.t += dt; return this; }

  // → { phase, p, index } ; phase is null when idle
  get state() {
    if (this.t >= this.total) return { phase: null, p: 1, index: -1 };
    let acc = 0;
    for (let i = 0; i < this.phases.length; i++) {
      const [name, dur] = this.phases[i];
      if (this.t < acc + dur) return { phase: name, p: clamp01((this.t - acc) / dur), index: i };
      acc += dur;
    }
    return { phase: null, p: 1, index: -1 };
  }
}

// Dev-only time dilation for effects. Impact bursts live ~520ms, which under
// software rendering in the headless harness is two or three frames — far too
// fast to screenshot reliably. Setting window.__vfxSlow = 8 stretches them so
// they can actually be inspected. Has no effect in a production build.
// Every timed effect must route through this: one that reads performance.now()
// directly runs at full speed while the rest crawl, and finishes before the
// capture loop takes its first frame.
export const vfxScale = () => (
  (import.meta.env?.DEV && typeof window !== 'undefined' && window.__vfxSlow) || 1
);
