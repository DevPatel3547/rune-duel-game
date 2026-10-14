// Rune shape templates for the $1 recognizer.
// All shapes are unistroke (one continuous line) and defined in unit space
// (0..1, y down). Point ORDER matters — the recognizer compares the path
// point-by-point, so draw direction is part of the rune.

function lerp(a, b, t) {
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
}

// Densify a polyline so every segment contributes proportional points.
function polyline(pts, total = 64) {
  const segs = [];
  let length = 0;
  for (let i = 1; i < pts.length; i++) {
    const d = Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
    segs.push(d);
    length += d;
  }
  const out = [pts[0]];
  for (let i = 1; i < pts.length; i++) {
    const n = Math.max(2, Math.round((segs[i - 1] / length) * total));
    for (let j = 1; j <= n; j++) out.push(lerp(pts[i - 1], pts[i], j / n));
  }
  return out;
}

function param(fn, total = 64) {
  const out = [];
  for (let i = 0; i <= total; i++) out.push(fn(i / total));
  return out;
}

const P = (x, y) => ({ x, y });

export const TEMPLATES = {
  // Lightning bolt: descending double zigzag ⚡
  bolt: polyline([P(0.62, 0.02), P(0.25, 0.5), P(0.56, 0.5), P(0.2, 0.98)]),

  // Tight inward spiral, 2.5 turns
  vortex: param((t) => {
    const angle = t * Math.PI * 2 * 2.5;
    const r = 0.46 * (1 - 0.82 * t);
    return P(0.5 + r * Math.cos(angle - Math.PI / 2), 0.5 + r * Math.sin(angle - Math.PI / 2));
  }, 80),

  // Wide dome arc, left to right
  shield: param((t) => {
    const angle = Math.PI - t * Math.PI; // 180° -> 0°
    return P(0.5 + 0.45 * Math.cos(angle), 0.82 - 0.72 * Math.sin(angle));
  }),

  // W shape, left to right
  quake: polyline([P(0.05, 0.12), P(0.3, 0.9), P(0.5, 0.32), P(0.7, 0.9), P(0.95, 0.12)]),

  // Single diagonal slash, top-left to bottom-right
  pierce: polyline([P(0.1, 0.1), P(0.9, 0.9)]),

  // Γ — across the top, then straight down
  reflect: polyline([P(0.22, 0.14), P(0.78, 0.14), P(0.78, 0.92)]),

  // S-curve drawn bottom to top
  leech: param((t) => P(0.5 + 0.2 * Math.sin(t * Math.PI * 1.8 + 0.3), 0.95 - 0.9 * t)),

  // Caret ^ — up then down
  surge: polyline([P(0.15, 0.88), P(0.5, 0.1), P(0.85, 0.88)]),

  // Ø — full circle from the top, then a slash down through it
  void: (() => {
    const circle = param((t) => {
      const angle = -Math.PI / 2 + t * Math.PI * 2;
      return P(0.5 + 0.38 * Math.cos(angle), 0.5 + 0.38 * Math.sin(angle));
    }, 52);
    const slash = polyline([P(0.5, 0.12), P(0.86, 0.94)], 14);
    return circle.concat(slash);
  })(),

  // J hook — straight down, then curl left and up
  anchor: (() => {
    const stem = polyline([P(0.58, 0.05), P(0.58, 0.62)], 28);
    const hook = param((t) => {
      const angle = 0 + t * Math.PI; // sweep right -> bottom -> left
      return P(0.39 + 0.19 * Math.cos(angle), 0.62 + 0.3 * Math.sin(angle));
    }, 30);
    return stem.concat(hook);
  })(),

  // Crescent C — open to the right, drawn top to bottom
  drain: param((t) => {
    const angle = -Math.PI / 2 - t * Math.PI; // top -> left -> bottom
    return P(0.62 + 0.42 * Math.cos(angle), 0.5 + 0.44 * Math.sin(angle));
  }),

  // Five-point star in one stroke
  nova: polyline([
    P(0.5, 0.05), P(0.29, 0.95), P(0.95, 0.38), P(0.05, 0.38), P(0.71, 0.95), P(0.5, 0.05),
  ], 90),

  // ======================================================================
  // EXPANSION — 18 more runes, taking the roster to 30.
  //
  // Two properties of the recognizer define the whole design space here:
  //   * rotation invariance is BOUNDED to ±45°, so two shapes more than 45°
  //     apart in orientation stay distinct (a caret and a V; a W and an M);
  //   * points are compared index-by-index with no reversal invariance, so the
  //     SAME shape drawn the other way round is a different rune. That is what
  //     makes 30 achievable without inventing 30 unrelated squiggles.
  // Straight lines are avoided — scaled to the reference square they degenerate
  // and collide with everything. Pierce is the one exception and it predates
  // this set.
  // ======================================================================

  // Figure-eight. This started as Bolt's zigzag drawn upward and collided with
  // it outright: a zigzag has 180-degree rotational symmetry, so reversing it
  // produces a path the indicative-angle normalisation folds straight back onto
  // the original — BEFORE the bounded search ever runs. Reversal only buys
  // separation on shapes that are not symmetric (see Shield/Bulwark, which do
  // survive it). A crossing double loop shares its topology with nothing else
  // in the set.
  // A "D": straight down the spine, then bowed back. Two earlier attempts here
  // both failed the jitter bar for the same reason — a shape that CROSSES ITSELF
  // (a zigzag, then a figure-eight) collapses toward Brand's Z once a human hand
  // is simulated, because the crossing lets the resampled path read as corners.
  // A closed convex outline with one flat side has no such failure mode, and the
  // flat spine is what keeps it clear of Eclipse's circle.
  rupture: (() => {
    const spine = polyline([P(0.3, 0.06), P(0.3, 0.94)], 30);
    const bow = param((t) => {
      const a = Math.PI / 2 - t * Math.PI;
      return P(0.3 + 0.56 * Math.cos(a) * Math.sin(t * Math.PI) * 1.6, 0.5 + 0.44 * Math.sin(a));
    }, 44);
    return spine.concat(bow);
  })(),

  // Spiral OUT from the centre — Vortex run backwards
  hex: param((t) => {
    const angle = t * Math.PI * 2 * 2.5;
    const r = 0.46 * (0.18 + 0.82 * t);
    return P(0.5 + r * Math.cos(angle - Math.PI / 2), 0.5 + r * Math.sin(angle - Math.PI / 2));
  }, 80),

  // V — the caret inverted
  frost: polyline([P(0.15, 0.12), P(0.5, 0.9), P(0.85, 0.12)]),

  // M — the W inverted
  crown: polyline([P(0.05, 0.88), P(0.3, 0.1), P(0.5, 0.68), P(0.7, 0.1), P(0.95, 0.88)]),

  // Closed square, from the top-left, clockwise
  ward: polyline([P(0.16, 0.16), P(0.84, 0.16), P(0.84, 0.84), P(0.16, 0.84), P(0.16, 0.16)], 80),

  // Closed triangle, from the apex, clockwise
  thorn: polyline([P(0.5, 0.08), P(0.92, 0.9), P(0.08, 0.9), P(0.5, 0.08)], 72),

  // Horizontal sine, left to right — Leech's S laid on its side and doubled
  tide: param((t) => P(0.04 + 0.92 * t, 0.5 + 0.34 * Math.sin(t * Math.PI * 2.4)), 72),

  // Check mark
  fang: polyline([P(0.12, 0.52), P(0.38, 0.9), P(0.9, 0.1)]),

  // U — down, across, up
  maul: (() => {
    const down = polyline([P(0.16, 0.08), P(0.16, 0.6)], 18);
    const bowl = param((t) => {
      const angle = Math.PI - t * Math.PI;
      return P(0.5 - 0.34 * Math.cos(angle), 0.6 + 0.32 * Math.sin(angle));
    }, 30);
    const up = polyline([P(0.84, 0.6), P(0.84, 0.08)], 18);
    return down.concat(bowl, up);
  })(),

  // Bare circle, counter-clockwise from the top — Void without its slash, and
  // wound the other way
  eclipse: param((t) => {
    const angle = -Math.PI / 2 - t * Math.PI * 2;
    return P(0.5 + 0.4 * Math.cos(angle), 0.5 + 0.4 * Math.sin(angle));
  }, 72),

  // Loop then a straight tail dropping away
  snare: (() => {
    const loop = param((t) => {
      const angle = Math.PI / 2 + t * Math.PI * 2;
      return P(0.5 + 0.3 * Math.cos(angle), 0.34 + 0.3 * Math.sin(angle));
    }, 48);
    const tail = polyline([P(0.5, 0.64), P(0.5, 0.98)], 16);
    return loop.concat(tail);
  })(),

  // Barbed diagonal — a lance with a hook flicked back off the point
  lance: (() => {
    const shaft = polyline([P(0.08, 0.9), P(0.82, 0.16)], 40);
    const barb = polyline([P(0.82, 0.16), P(0.9, 0.52)], 16);
    return shaft.concat(barb);
  })(),

  // Z — across, diagonal back, across
  brand: polyline([P(0.14, 0.14), P(0.86, 0.14), P(0.14, 0.86), P(0.86, 0.86)], 76),

  // Dome drawn RIGHT to LEFT — Shield's arc, reversed
  bulwark: param((t) => {
    const angle = t * Math.PI;
    return P(0.5 + 0.45 * Math.cos(angle), 0.82 - 0.72 * Math.sin(angle));
  }),

  // Crescent open to the LEFT — Drain mirrored
  siphon: param((t) => {
    const angle = -Math.PI / 2 + t * Math.PI;
    return P(0.38 + 0.42 * Math.cos(angle), 0.5 + 0.44 * Math.sin(angle));
  }),

  // Spiral in, then break out on a straight exit
  ruin: (() => {
    const coil = param((t) => {
      const angle = t * Math.PI * 2 * 1.8;
      const r = 0.4 * (1 - 0.7 * t);
      return P(0.44 + r * Math.cos(angle - Math.PI / 2), 0.5 + r * Math.sin(angle - Math.PI / 2));
    }, 52);
    const exit = polyline([P(0.44, 0.38), P(0.96, 0.9)], 20);
    return coil.concat(exit);
  })(),

  // --- summons: heavier, more deliberate shapes for the biggest casts ---

  // Bracket [ — the gate a construct steps through
  golem: polyline([P(0.82, 0.1), P(0.24, 0.1), P(0.24, 0.9), P(0.82, 0.9)], 76),

  // Serpentine — two horizontal coils, the long body of the thing you call
  wyrm: param((t) => {
    const angle = t * Math.PI * 4;
    return P(0.06 + 0.88 * t, 0.5 + 0.3 * Math.sin(angle));
  }, 88),

};
