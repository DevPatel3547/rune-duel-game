import { useRef, useMemo, useEffect, useState } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { useGame } from '../store.js';
import { glowSprite, flareSprite, puffSprite } from './textures.js';
import { burstMask, streakMask } from './vfxTextures.js';
import { createVfxMaterial, stepVfx } from './VfxMaterial.js';
import { impactFeel, castFeel } from './feel.js';
import * as sfx from '../audio.js';
import { vfxScale } from './anim.js';
import { vfxStyle } from './vfxStyle.js';
import { pathPoint } from './flightPath.js';
import { CelRibbon, SpeedLines, Afterimages, AnimeImpact } from './AnimeFX.jsx';
import { haptic } from '../native.js';

// ============================================================================
// SPELL VFX
//
// Three beats per cast, because that is what makes a spell feel like it has
// weight: a MUZZLE FLASH at the caster's hands (something happened), a
// PROJECTILE with its own motion and trail (something is coming), and an
// IMPACT burst (something landed). The old build had only the middle one, and
// its "impact" was a 40-frame ring that was effectively invisible.
//
// Every spell also gets its own visual profile — a Bolt should not look like a
// Nova with a different tint. Shape, spin, arc, trail width and particle
// behaviour all key off the spell id.
// ============================================================================

// `motion` gives each spell a distinct flight path, which is what makes it
// identifiable before it lands:
//   spiral  — orbits its own axis while travelling (Vortex, Drain)
//   lob     — heavy arc, slow, obviously incoming (Quake, Nova, Anchor)
//   dart    — dead straight, fast (Pierce)
//   drift   — lazy sine wander (Leech, Void)
//   erratic — jitters like unstable current (Bolt)
//
// `land` is the signature the impact leaves on the arena.

//
// `anime` carries the layered-treatment parameters. Every attack gets the same
// LAYER STACK — the density is the point — but the mix is what separates them:
// a dart leaves a long thin line and punches a small clean hole; a boulder
// leaves almost no trail and throws a great deal of debris. Handing every spell
// the same numbers would restore exactly the "they all look the same" problem
// the layers exist to solve.
//
//   span    how far back along the flight the ribbon reaches (0-1)
//   ribbon  ribbon width multiplier on `trail`
//   lines   speed-line count — velocity, so darts get many and lobs get few
//   ghosts  afterimage count
//   shards  radiating spikes at impact
//   debris  thrown motes at impact
//   ring    shock-ring size multiplier
const PROFILES = {
  bolt:    { shape: 'shard',  arc: 0.29, spin: 14, core: 0.391, trail: 0.32, sparks: 20, burst: 1.0, jitter: 0.045, sweep: 1.7, motion: 'erratic', land: 'arc',
             anime: { span: 0.34, ribbon: 6,  lines: 18, ghosts: 5, shards: 11, debris: 14, ring: 1.0 } },
  pierce:  { shape: 'lance',  arc: 0.03, spin: 26, core: 0.289, trail: 0.224, sparks: 14, burst: 0.85, jitter: 0.0, sweep: 0.5, motion: 'dart', land: 'pierce',
             // A puncture: the longest, thinnest line in the game, and an
             // impact that is a few hard spikes rather than a scatter.
             anime: { span: 0.62, ribbon: 4,  lines: 22, ghosts: 6, shards: 5,  debris: 6,  ring: 0.65 } },
  nova:    { shape: 'star',   arc: 0.89, spin: 3,  core: 0.748,  trail: 0.608, sparks: 42, burst: 2.0, jitter: 0.02, sweep: 2.4, motion: 'lob', land: 'nova',
             anime: { span: 0.40, ribbon: 7,  lines: 10, ghosts: 4, shards: 14, debris: 22, ring: 1.7 } },
  quake:   { shape: 'rock',   arc: 1.13, spin: 5,  core: 0.629, trail: 0.48, sparks: 30, burst: 1.5, jitter: 0.01, sweep: -2.2, motion: 'lob', land: 'quake',
             // Mass, not speed: barely any trail, barely any speed lines, and
             // the heaviest debris throw of the set.
             anime: { span: 0.22, ribbon: 5,  lines: 6,  ghosts: 3, shards: 9,  debris: 26, ring: 1.6 } },
  vortex:  { shape: 'ring',   arc: 0.48, spin: 18, core: 0.459, trail: 0.416, sparks: 22, burst: 1.15, jitter: 0.02, sweep: 2.9, motion: 'spiral', land: 'vortex',
             // A long span is what makes the corkscrew legible — a short one
             // samples less than a single turn and the spiral reads as a wobble.
             anime: { span: 0.70, ribbon: 5,  lines: 14, ghosts: 6, shards: 10, debris: 12, ring: 1.25 } },
  drain:   { shape: 'ring',   arc: 0.42, spin: -12, core: 0.408, trail: 0.384, sparks: 18, burst: 1.0, jitter: 0.02, sweep: -2.6, motion: 'spiral', land: 'drain',
             anime: { span: 0.66, ribbon: 5,  lines: 12, ghosts: 6, shards: 8,  debris: 10, ring: 1.1 } },
  leech:   { shape: 'orb',    arc: 0.55, spin: 8,  core: 0.425, trail: 0.416, sparks: 20, burst: 1.0, jitter: 0.03, sweep: 2.2, motion: 'drift', land: 'leech',
             anime: { span: 0.46, ribbon: 6,  lines: 8,  ghosts: 5, shards: 7,  debris: 10, ring: 1.0 } },
  void:    { shape: 'void',   arc: 0.35, spin: 6,  core: 0.51,  trail: 0.32, sparks: 16, burst: 0.9, jitter: 0.0, sweep: -1.8, motion: 'drift', land: 'void',
             // The one spell that eats light instead of emitting it, so it gets
             // the fewest bright elements and leans on the dark outline band.
             anime: { span: 0.50, ribbon: 6,  lines: 5,  ghosts: 7, shards: 6,  debris: 8,  ring: 1.15 } },
  anchor:  { shape: 'rock',   arc: 0.89, spin: 4,  core: 0.476,  trail: 0.32, sparks: 16, burst: 1.1, jitter: 0.0, sweep: -1.9, motion: 'lob', land: 'quake',
             anime: { span: 0.26, ribbon: 5,  lines: 6,  ghosts: 3, shards: 8,  debris: 18, ring: 1.35 } },

  // ---- expansion roster -------------------------------------------------
  // Each of these has to be identifiable in flight, or thirty spells is just
  // twelve spells and eighteen recolours. Shape, motion and the anime mix all
  // carry a share of that.
  fang:    { shape: 'shard',  arc: 0.16, spin: 22, core: 0.255, trail: 0.192, sparks: 10, burst: 0.6, jitter: 0.02, sweep: 1.2, motion: 'dart', land: 'arc',
             anime: { span: 0.30, ribbon: 4,  lines: 20, ghosts: 6, shards: 4,  debris: 5,  ring: 0.55 } },
  lance:   { shape: 'lance',  arc: 0.08, spin: 20, core: 0.34,  trail: 0.256, sparks: 16, burst: 0.95, jitter: 0.0, sweep: -0.8, motion: 'dart', land: 'pierce',
             anime: { span: 0.58, ribbon: 4,  lines: 20, ghosts: 6, shards: 6,  debris: 8,  ring: 0.75 } },
  frost:   { shape: 'shard',  arc: 0.38, spin: 9,  core: 0.391, trail: 0.352, sparks: 22, burst: 0.9, jitter: 0.015, sweep: 2.0, motion: 'drift', land: 'vortex',
             anime: { span: 0.44, ribbon: 6,  lines: 11, ghosts: 5, shards: 10, debris: 14, ring: 1.05 } },
  tide:    { shape: 'ring',   arc: 0.55, spin: 7,  core: 0.51,  trail: 0.544, sparks: 26, burst: 1.1, jitter: 0.0, sweep: 3.4, motion: 'drift', land: 'vortex',
             // A wave is all trail: the widest ribbon in the set, long span.
             anime: { span: 0.72, ribbon: 9,  lines: 8,  ghosts: 4, shards: 8,  debris: 16, ring: 1.5 } },
  rupture: { shape: 'rock',   arc: 1.0, spin: 4,  core: 0.68,  trail: 0.416, sparks: 34, burst: 1.7, jitter: 0.01, sweep: -2.8, motion: 'lob', land: 'quake',
             // Ground-breaker: almost no trail, the heaviest debris in the game.
             anime: { span: 0.20, ribbon: 5,  lines: 5,  ghosts: 3, shards: 12, debris: 30, ring: 1.8 } },
  maul:    { shape: 'rock',   arc: 0.94, spin: 6,  core: 0.646,  trail: 0.384, sparks: 28, burst: 1.5, jitter: 0.01, sweep: 2.5, motion: 'lob', land: 'quake',
             anime: { span: 0.24, ribbon: 5,  lines: 6,  ghosts: 3, shards: 10, debris: 24, ring: 1.55 } },
  ruin:    { shape: 'void',   arc: 0.71, spin: -9, core: 0.714,  trail: 0.512, sparks: 38, burst: 1.85, jitter: 0.02, sweep: -3.2, motion: 'spiral', land: 'nova',
             anime: { span: 0.68, ribbon: 7,  lines: 12, ghosts: 6, shards: 13, debris: 20, ring: 1.65 } },
  crown:   { shape: 'star',   arc: 0.64, spin: 5,  core: 0.578,  trail: 0.416, sparks: 26, burst: 1.35, jitter: 0.02, sweep: 1.6, motion: 'lob', land: 'arc',
             anime: { span: 0.36, ribbon: 6,  lines: 10, ghosts: 4, shards: 12, debris: 16, ring: 1.3 } },
  hex:     { shape: 'ring',   arc: 0.45, spin: -15, core: 0.442, trail: 0.384, sparks: 20, burst: 1.05, jitter: 0.025, sweep: -2.7, motion: 'spiral', land: 'drain',
             anime: { span: 0.66, ribbon: 5,  lines: 12, ghosts: 6, shards: 9,  debris: 12, ring: 1.15 } },
  snare:   { shape: 'ring',   arc: 0.32, spin: 11, core: 0.374,  trail: 0.32, sparks: 14, burst: 0.8, jitter: 0.0, sweep: 2.3, motion: 'drift', land: 'vortex',
             anime: { span: 0.50, ribbon: 5,  lines: 9,  ghosts: 5, shards: 7,  debris: 9,  ring: 1.0 } },
  brand:   { shape: 'shard',  arc: 0.35, spin: 16, core: 0.425, trail: 0.384, sparks: 24, burst: 1.05, jitter: 0.04, sweep: -1.5, motion: 'erratic', land: 'arc',
             anime: { span: 0.38, ribbon: 6,  lines: 16, ghosts: 5, shards: 11, debris: 15, ring: 1.05 } },
  eclipse: { shape: 'void',   arc: 0.42, spin: 5,  core: 0.578,  trail: 0.352, sparks: 18, burst: 1.2, jitter: 0.0, sweep: 2.1, motion: 'drift', land: 'void',
             // Eats light rather than emitting it, so it leans on the outline.
             anime: { span: 0.52, ribbon: 7,  lines: 4,  ghosts: 8, shards: 7,  debris: 10, ring: 1.3 } },
  siphon:  { shape: 'orb',    arc: 0.48, spin: -10, core: 0.425, trail: 0.416, sparks: 20, burst: 1.0, jitter: 0.03, sweep: -2.4, motion: 'drift', land: 'leech',
             anime: { span: 0.48, ribbon: 6,  lines: 8,  ghosts: 5, shards: 7,  debris: 10, ring: 1.0 } },
  thorn:   { shape: 'shard',  arc: 0.42, spin: 13, core: 0.391, trail: 0.32, sparks: 22, burst: 0.95, jitter: 0.02, sweep: 1.4, motion: 'drift', land: 'arc',
             anime: { span: 0.40, ribbon: 5,  lines: 10, ghosts: 4, shards: 14, debris: 12, ring: 0.95 } },
  golem:   { shape: 'rock',   arc: 0.48, spin: 2,  core: 0.816,  trail: 0.32, sparks: 30, burst: 1.7, jitter: 0.0, sweep: 0.0, motion: 'lob', land: 'quake',
             anime: { span: 0.18, ribbon: 5,  lines: 4,  ghosts: 2, shards: 12, debris: 28, ring: 1.75 } },
  wyrm:    { shape: 'ring',   arc: 0.74, spin: 8,  core: 0.68,  trail: 0.576, sparks: 32, burst: 1.75, jitter: 0.01, sweep: 3.6, motion: 'spiral', land: 'nova',
             anime: { span: 0.80, ribbon: 8,  lines: 10, ghosts: 7, shards: 12, debris: 20, ring: 1.6 } },
};

const DEFAULT_ANIME = { span: 0.42, ribbon: 6, lines: 14, ghosts: 5, shards: 9, debris: 16, ring: 1.0 };
const DEFAULT_PROFILE = { sweep: 1.8, shape: 'orb', arc: 0.48, spin: 8, core: 0.408, trail: 0.384, sparks: 20, burst: 1.0, jitter: 0.02, motion: 'drift', land: 'arc' };

// How much each shared layer contributes, by silhouette family.
//
// A contact sheet of all thirty spells showed fourteen of them as the same
// crescent comet in different colours. Every projectile drew the same stack —
// an eroding halo at seven times the core, a three-band ribbon, octahedron
// ghosts — and the per-spell core sat underneath it at a fraction of the size,
// so the core's shape never reached the screen. Shape families now decide the
// mix: a shard or a boulder IS its silhouette and gets no halo at all; a ring
// or an orb is energy and keeps it.
const FAMILY = {
  shard: { halo: 0,    core: 1.8, ribbon: 0.7,  ghosts: 1 },
  lance: { halo: 0,    core: 1.7, ribbon: 0.45, ghosts: 1 },
  rock:  { halo: 0,    core: 1.6, ribbon: 0.5,  ghosts: 0.6 },
  star:  { halo: 0.55, core: 1.4, ribbon: 0.8,  ghosts: 1 },
  ring:  { halo: 0.6,  core: 1.2, ribbon: 1,    ghosts: 1 },
  void:  { halo: 0.8,  core: 1.2, ribbon: 1,    ghosts: 1 },
  orb:   { halo: 1,    core: 1,   ribbon: 1,    ghosts: 1 },
};

const profileOf = (id) => PROFILES[id] || DEFAULT_PROFILE;
const familyOf = (p) => FAMILY[p.shape] || FAMILY.orb;
const animeOf = (p) => p.anime || DEFAULT_ANIME;

export default function SpellFX() {
  const fx = useGame((s) => s.fx);
  return fx.map((f) => {
    if (f.kind === 'projectile') return <Projectile key={f.id} fx={f} />;
    if (f.kind === 'selfcast') return <SelfCastFX key={f.id} fx={f} />;
    if (f.kind === 'number') return <DamageNumber key={f.id} fx={f} />;
    return null;
  });
}

// --------------------------------------------------------- damage numbers --

// Floating combat text. Rendered in the world (not the DOM HUD) so the number
// appears on the wizard it belongs to — which is what tells you at a glance
// whether a hit landed on you or on them, without reading a bar.
function DamageNumber({ fx }) {
  const removeFx = useGame((s) => s.removeFx);
  const sprite = useRef();
  const start = useRef(performance.now());

  const { texture, aspect } = useMemo(() => {
    const label = fx.dodge ? 'DODGED'
      : fx.heal ? `+${fx.value}`
      : fx.value > 0 ? `${fx.value}`
      : fx.absorbed ? 'BLOCKED' : 'MISS';
    const big = fx.value >= 30;
    const w = 256, h = 128;
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const ctx = c.getContext('2d');
    ctx.font = `900 ${label.length > 4 ? 46 : big ? 86 : 68}px ui-sans-serif, system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    // heavy outline + shadow so the text stays readable over bloom and bright FX
    ctx.lineJoin = 'round';
    ctx.shadowColor = 'rgba(0,0,0,0.9)';
    ctx.shadowBlur = 12;
    ctx.strokeStyle = 'rgba(0,0,0,0.92)';
    ctx.lineWidth = 10;
    ctx.strokeText(label, w / 2, h / 2);
    ctx.shadowBlur = 0;
    ctx.fillStyle = fx.color || '#fff';
    ctx.fillText(label, w / 2, h / 2);

    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    t.needsUpdate = true;
    return { texture: t, aspect: w / h };
  }, [fx.value, fx.heal, fx.absorbed, fx.dodge, fx.color]);

  useEffect(() => () => texture.dispose(), [texture]);

  // Sideways offset so a number never sits dead-centre over the wizard's face,
  // and so simultaneous hits don't stack into an unreadable pile.
  const drift = useMemo(() => (Math.random() < 0.5 ? -1 : 1) * (0.34 + Math.random() * 0.22), []);
  const LIFE = 1050;

  // Damage dealt TO the player is anchored at the player's own chest, which is
  // ~0.3 m from the camera — a world-space sprite there fills the screen. Push
  // incoming numbers out to a readable standoff in front of the camera instead
  // of trying to scale them down at arm's length.
  const anchor = useMemo(() => (
    fx.incoming ? [fx.at[0] + drift * 1.6, fx.at[1] + 0.15, fx.at[2] - 2.6] : fx.at
  ), [fx.incoming, fx.at, drift]);

  useFrame(() => {
    const e = (performance.now() - start.current) / LIFE;
    if (e >= 1) { removeFx(fx.id); return; }
    if (!sprite.current) return;
    // pop in, then float up and fade
    const pop = e < 0.12 ? e / 0.12 : 1;
    // Sprite scale is in WORLD units, so these are metres of glyph height at a
    // ~4.5 m sightline. Earlier values (0.46–0.62) put a single digit across a
    // fifth of the screen and buried the fight behind it.
    const s = (fx.value >= 30 ? 0.46 : 0.34) * (0.7 + pop * 0.3);
    sprite.current.scale.set(s * aspect, s, 1);
    sprite.current.position.set(
      anchor[0] + drift * (0.55 + e * 0.35),
      anchor[1] + 0.30 + e * 0.6,
      anchor[2] + 0.15,
    );
    sprite.current.material.opacity = e < 0.7 ? 1 : 1 - (e - 0.7) / 0.3;
  });

  return (
    <sprite ref={sprite} position={anchor}>
      <spriteMaterial map={texture} transparent opacity={0} depthWrite={false} depthTest={false} toneMapped={false} />
    </sprite>
  );
}

// ------------------------------------------------------------ projectile ---

function Projectile({ fx }) {
  const removeFx = useGame((s) => s.removeFx);
  const p = profileOf(fx.spellId);
  const fam = familyOf(p);

  const group = useRef();
  const core = useRef();
  const halo = useRef();
  const light = useRef();
  const muzzle = useRef();
  const [tail, setTail] = useState([]);

  // Locked in at mount: switching treatment mid-flight would swap the whole
  // layer stack in the middle of the animation.
  const style = useMemo(() => vfxStyle(), []);
  // Flight progress, mirrored out of the frame loop so the analytic trail knows
  // where the head currently is without going through React state.
  const progress = useRef(0);
  const A = useMemo(() => animeOf(p), [p]);

  const phase = useRef('fly');
  const impactAt = useRef(0);
  const tailAcc = useRef(0);
  // The burst has to mount through React state — a ref flip does not re-render,
  // so the impact would never appear.
  const [struck, setStruck] = useState(false);

  const haloMat = useMemo(() => createVfxMaterial({
    mask: burstMask(),
    color: fx.color,
    rimColor: '#fff6de',
    // Never fully erodes in flight — uErode is parked low so the shape churns
    // and breathes without dissolving before it arrives.
    scroll: 0.5, distort: 0.07, rimWidth: 0.12, cellMix: 0.65,
  }), [fx.color]);
  useEffect(() => () => haloMat.dispose(), [haloMat]);

  const from = useMemo(() => new THREE.Vector3(...fx.from), [fx.from]);
  const to = useMemo(() => new THREE.Vector3(...fx.to), [fx.to]);
  const pos = useMemo(() => new THREE.Vector3(), []);
  const missed = !fx.hit || fx.hit <= 0;
  const color = useMemo(() => new THREE.Color(fx.color), [fx.color]);

  useEffect(() => {
    sfx.cast(fx.spellId, fx.dir);
    // firing your own spell gives a small kick; incoming casts must not shake
    // the player's camera or every enemy cast would read as a hit
    if (fx.dir === 'out') castFeel(p.burst * 0.4);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useFrame(({ camera }, dt) => {
    const now = performance.now();
    if (halo.current) {
      halo.current.lookAt(camera.position);
      // a slow pulse in the erosion keeps the silhouette alive in flight
      stepVfx(haloMat, dt, 0.18 + Math.sin(now * 0.006) * 0.10, missed ? 0.4 : 0.95);
    }

    if (phase.current === 'fly') {
      const t = Math.min(1, (now - fx.born) / fx.travel);
      // ease out slightly so it decelerates into the target — a linear lerp
      // reads as a moving sprite rather than a thrown object
      // Per-spell easing: a dart holds speed, a lob decelerates hard as it
      // rises and accelerates into the ground.
      pathPoint(from, to, p, t, fx.travel, pos);
      progress.current = t;

      // The per-frame noise stays OUT of the shared path function: it is what
      // gives Bolt its unstable-current character, but it cannot be evaluated
      // at an arbitrary t, so the trail is drawn from the smooth curve and only
      // the head carries the wobble.
      if (p.motion === 'erratic') {
        AXIS.copy(to).sub(from).setY(0).normalize();
        SIDE2.set(-AXIS.z, 0, AXIS.x);
        pos.addScaledVector(SIDE2, (Math.random() - 0.5) * 0.09);
      }

      if (p.jitter) {
        pos.x += (Math.random() - 0.5) * p.jitter;
        pos.y += (Math.random() - 0.5) * p.jitter;
      }

      if (group.current) {
        group.current.position.copy(pos);
        group.current.rotation.z += p.spin * dt;
        group.current.rotation.x += p.spin * 0.35 * dt;
        // lances and shards fly point-first
        if (p.shape === 'lance' || p.shape === 'shard') {
          group.current.lookAt(to);
          group.current.rotateZ(now * 0.02);
        }
      }
      if (light.current) light.current.position.copy(pos);

      // muzzle flash lives for the first ~120 ms at the launch point
      if (muzzle.current) {
        const m = Math.max(0, 1 - (now - fx.born) / 130);
        muzzle.current.scale.setScalar((0.25 + (1 - m) * 0.75) * p.burst * 1.2);
        muzzle.current.material.opacity = m * 0.95;
        muzzle.current.visible = m > 0;
      }

      tailAcc.current += dt;
      if (tailAcc.current > 0.014) {
        tailAcc.current = 0;
        // The layered styles draw a long sweeping ribbon, which needs a lot
        // more of the path than the 18 samples the additive trail used — at 18
        // the ribbon is a stub a few centimetres behind the core and reads as
        // nothing at all.
        // Only the legacy additive ribbon records a trail. The layered styles
        // sample the flight curve directly, so recording one would be a React
        // state update every 14ms for nothing.
        if (style === 'current') setTail((prev) => [...prev, [pos.x, pos.y, pos.z]].slice(-18));
      }

      if (t >= 1) {
        phase.current = 'impact';
        impactAt.current = now;
        setStruck(true);
        sfx.impact(missed, fx.dir);
        if (!missed) {
          // fx.power carries the normalised magnitude the driver resolved this
          // hit at, so a Nova shakes the screen and a chip hit does not
          impactFeel((fx.power ?? 0.5) * p.burst, fx.dir === 'in');
          if (fx.dir === 'in') haptic(Math.min(1, 0.3 + p.burst * 0.3));
        }
      }
    } else {
      // Must use the same dilation as the burst it owns, or the projectile
      // unmounts on the real 520ms clock and takes the (slowed) impact effect
      // down with it before a single frame of it has been drawn.
      const e = (now - impactAt.current) / (520 * vfxScale());
      if (e >= 1) { removeFx(fx.id); return; }
      if (core.current) core.current.visible = false;
      if (halo.current) halo.current.visible = false;
      if (light.current) {
        light.current.position.copy(to);
        light.current.intensity = (1 - e) * (1 - e) * (missed ? 3 : 26 * p.burst);
      }
    }
  });

  return (
    <group>
      {/* launch flash, parked at the caster's hands */}
      <sprite ref={muzzle} position={fx.from} scale={0.3}>
        <spriteMaterial
          map={flareSprite()} color={fx.color} transparent opacity={0}
          blending={THREE.AdditiveBlending} depthWrite={false} toneMapped={false}
        />
      </sprite>

      {/* the projectile body */}
      <group ref={group}>
        <ProjectileCore shape={p.shape} size={p.core * fam.core} color={fx.color} missed={missed} coreRef={core} />
        {/* A round sprite is a blob by construction. This is a ragged,
            eroding silhouette that churns as it flies, so the spell has a
            shape rather than a glow. Only energy families get one: on a
            shard, lance or boulder it hid the very shape that tells them apart. */}
        {fam.halo > 0 && (
          <mesh ref={halo} material={haloMat} scale={p.core * 7 * fam.halo}>
            <planeGeometry args={[1, 1]} />
          </mesh>
        )}
        {/* Speed lines are parented to the body so they travel with it; at the
            scene root they would sit at the origin and streak nowhere. */}
        {style !== 'current' && (
          <SpeedLines color={fx.color} count={A.lines} length={p.core * 14} />
        )}
      </group>

      <pointLight ref={light} color={fx.color} intensity={missed ? 2 : 7} distance={4.5} decay={2} />

      {/* Trail: one additive band in the current style, three smoothed cel
          bands in the layered ones. */}
      {style === 'current'
        ? (tail.length > 1 && <GlowRibbon points={tail} color={color} width={p.trail} />)
        : (
          <CelRibbon
            from={from} to={to} profile={p} progress={progress} travel={fx.travel}
            // `trail` already carries the arena scale-up; the per-spell factor is a
            // RATIO on top of it, so it needs pulling back or the two compound into
            // a slab wider than the caster.
            color={fx.color} width={p.trail * A.ribbon * 0.34 * fam.ribbon} span={A.span} ink={style === 'ink'}
          />
        )}

      {style !== 'current' && (
        <Afterimages
          from={from} to={to} profile={p} progress={progress} travel={fx.travel}
          color={fx.color} size={p.core * 1.9} count={Math.max(1, Math.round(A.ghosts * fam.ghosts))}
          shape={p.shape} ink={style === 'ink'}
        />
      )}

      {struck && (
        <>
          {style === 'current'
            ? <ImpactBurst at={to} color={fx.color} scale={p.burst} missed={missed} sparks={p.sparks} />
            : (
              <>
                {/* The layered styles keep the existing burst as the base and
                    stack on top of it — removing it loses the light and the
                    hit stops feeling hot. */}
                <ImpactBurst at={to} color={fx.color} scale={p.burst * 0.7} missed={missed} sparks={p.sparks} />
                {!missed && (
                  <AnimeImpact
                    at={to} color={fx.color} scale={p.burst} ink={style === 'ink'}
                    shards={A.shards} debris={A.debris} ring={A.ring}
                  />
                )}
              </>
            )}
          {!missed && <LandingMark kind={p.land} at={to} color={fx.color} scale={p.burst} />}
        </>
      )}
    </group>
  );
}

// Distinct silhouettes per spell family.
function ProjectileCore({ shape, size, color, missed, coreRef }) {
  const s = missed ? size * 0.6 : size;
  const mat = (
    <meshBasicMaterial color={color} toneMapped={false} transparent opacity={missed ? 0.55 : 1} />
  );
  switch (shape) {
    case 'shard':
      return <mesh ref={coreRef}><octahedronGeometry args={[s, 0]} />{mat}</mesh>;
    case 'lance':
      return (
        <mesh ref={coreRef} rotation={[Math.PI / 2, 0, 0]}>
          <coneGeometry args={[s * 0.5, s * 4.5, 6]} />{mat}
        </mesh>
      );
    case 'star':
      return (
        <group ref={coreRef}>
          <mesh><icosahedronGeometry args={[s, 0]} />{mat}</mesh>
          <mesh rotation={[0.6, 0.4, 0]} scale={[1.9, 0.22, 0.22]}>
            <boxGeometry args={[s, s, s]} />{mat}
          </mesh>
          <mesh rotation={[-0.4, 1.1, 0]} scale={[0.22, 1.9, 0.22]}>
            <boxGeometry args={[s, s, s]} />{mat}
          </mesh>
        </group>
      );
    case 'rock':
      return (
        <mesh ref={coreRef}>
          <dodecahedronGeometry args={[s, 0]} />
          <meshStandardMaterial
            color={color} emissive={color} emissiveIntensity={1.6}
            roughness={0.85} metalness={0.1} flatShading toneMapped={false}
          />
        </mesh>
      );
    case 'ring':
      return (
        <mesh ref={coreRef} rotation={[Math.PI / 2, 0, 0]}>
          <torusGeometry args={[s, s * 0.32, 8, 20]} />{mat}
        </mesh>
      );
    case 'void':
      // a dark core rimmed with light — the only spell that eats light instead
      // of emitting it, which is exactly its role in the counter system
      return (
        <group ref={coreRef}>
          <mesh><sphereGeometry args={[s, 16, 14]} /><meshBasicMaterial color="#05040a" toneMapped={false} /></mesh>
          <mesh scale={1.22}><sphereGeometry args={[s, 16, 14]} />
            <meshBasicMaterial color={color} toneMapped={false} transparent opacity={0.45} side={THREE.BackSide} />
          </mesh>
        </group>
      );
    default:
      return <mesh ref={coreRef}><sphereGeometry args={[s, 18, 16]} />{mat}</mesh>;
  }
}

// ---------------------------------------------------------------- impact ---

// Expanding shockwave + flare + radial sparks + smoke puff. Scaled by the
// spell's burst weight so the same code covers a chip hit and a Nova.
function ImpactBurst({ at, color, scale, missed, sparks }) {
  const ring = useRef();
  const ring2 = useRef();
  const flare = useRef();
  const erodeA = useRef();
  const erodeB = useRef();
  const pts = useRef();
  const start = useRef(performance.now());

  // Two eroding layers at different rates and rotations. A single layer reads
  // as one flat card; two counter-scrolling layers give the blast depth and
  // stop the noise pattern from being legible as a texture.
  const erodeMatA = useMemo(() => createVfxMaterial({
    mask: burstMask(),
    color: missed ? '#6a7180' : color,
    rimColor: missed ? '#aab3c4' : '#fff2d0',
    scroll: 0.42, distort: 0.055, rimWidth: 0.10, cellMix: 0.55,
  }), [color, missed]);
  const erodeMatB = useMemo(() => createVfxMaterial({
    mask: burstMask(),
    color: missed ? '#5a616f' : color,
    rimColor: missed ? '#9aa3b5' : '#ffffff',
    scroll: -0.3, distort: 0.08, rimWidth: 0.07, rimPower: 2.0, cellMix: 0.8,
  }), [color, missed]);
  useEffect(() => () => { erodeMatA.dispose(); erodeMatB.dispose(); }, [erodeMatA, erodeMatB]);

  const S = missed ? scale * 0.45 : scale;

  // Spark directions are fixed at spawn so each particle flies a straight,
  // slowing arc — recomputing random directions per frame would just jitter.
  const { geom, vel } = useMemo(() => {
    const n = missed ? Math.round(sparks * 0.4) : sparks;
    const g = new THREE.BufferGeometry();
    const pos = new Float32Array(n * 3);
    const v = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      // even-ish sphere distribution
      const th = Math.acos(2 * Math.random() - 1);
      const ph = Math.random() * Math.PI * 2;
      const sp = (1.6 + Math.random() * 3.4) * S;
      v[i * 3] = Math.sin(th) * Math.cos(ph) * sp;
      v[i * 3 + 1] = Math.abs(Math.cos(th)) * sp * 0.9 + 0.5;
      v[i * 3 + 2] = Math.sin(th) * Math.sin(ph) * sp;
    }
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    return { geom: g, vel: v };
  }, [sparks, missed, S]);

  useEffect(() => () => geom.dispose(), [geom]);

  useFrame(({ camera }) => {
    camPos.copy(camera.position);
    const e = Math.min(1, (performance.now() - start.current) / (520 * vfxScale()));
    const grow = 1 - Math.pow(1 - e, 3);   // fast out, settling

    if (ring.current) {
      ring.current.scale.setScalar((0.2 + grow * 2.6) * S);
      ring.current.material.opacity = (1 - e) * 0.9;
    }
    if (ring2.current) {
      // a second, slower ring gives the shockwave thickness
      const g2 = 1 - Math.pow(1 - Math.max(0, e - 0.10), 3);
      ring2.current.scale.setScalar((0.15 + g2 * 1.7) * S);
      ring2.current.material.opacity = (1 - e) * 0.55;
    }
    if (flare.current) {
      const f = Math.max(0, 1 - e * 2.6);
      flare.current.scale.setScalar((0.5 + (1 - f) * 2.4) * S);
      flare.current.material.opacity = f;
    }
    // Erosion drives the dissolve; the mesh also grows, so the blast expands
    // AND breaks apart rather than doing one or the other.
    if (erodeA.current) {
      erodeA.current.scale.setScalar((0.5 + grow * 1.5) * S);
      erodeA.current.lookAt(camPos);
      stepVfx(erodeMatA, 0.016, Math.min(1, e * 1.05), 1);
    }
    if (erodeB.current) {
      erodeB.current.scale.setScalar((0.34 + grow * 1.05) * S);
      erodeB.current.lookAt(camPos);
      stepVfx(erodeMatB, 0.016, Math.min(1, e * 1.35), 0.85);
    }
    if (pts.current) {
      const arr = pts.current.geometry.attributes.position.array;
      const t = e * 0.52;
      for (let i = 0; i < arr.length / 3; i++) {
        arr[i * 3] = vel[i * 3] * t;
        arr[i * 3 + 1] = vel[i * 3 + 1] * t - 4.2 * t * t;   // gravity
        arr[i * 3 + 2] = vel[i * 3 + 2] * t;
      }
      pts.current.geometry.attributes.position.needsUpdate = true;
      pts.current.material.opacity = Math.max(0, 1 - e * 1.25);
      pts.current.material.size = (0.075 + (1 - e) * 0.05) * S;
    }
  });

  return (
    <group position={at}>
      {/* shockwave rings, billboarded toward the camera via sprite-like planes */}
      <mesh ref={ring}>
        <ringGeometry args={[0.34, 0.44, 44]} />
        <meshBasicMaterial color={missed ? '#93a0b8' : color} toneMapped={false} transparent opacity={0} side={THREE.DoubleSide} depthWrite={false} blending={THREE.AdditiveBlending} />
      </mesh>
      <mesh ref={ring2} rotation={[Math.PI / 2, 0, 0]}>
        <ringGeometry args={[0.36, 0.50, 44]} />
        <meshBasicMaterial color={missed ? '#93a0b8' : color} toneMapped={false} transparent opacity={0} side={THREE.DoubleSide} depthWrite={false} blending={THREE.AdditiveBlending} />
      </mesh>

      <sprite ref={flare} scale={1}>
        <spriteMaterial map={flareSprite()} color={missed ? '#c3cbd8' : color} transparent opacity={0} blending={THREE.AdditiveBlending} depthWrite={false} toneMapped={false} />
      </sprite>

      {/* The eroding body of the blast. This is the piece that stops the
          impact reading as a blob: instead of a round sprite fading out, a
          ragged silhouette DISSOLVES through a scrolling noise field, opening
          holes and separating tendrils, with a hot rim tracking the dissolving
          edge. */}
      <mesh ref={erodeA} material={erodeMatA}>
        <planeGeometry args={[1, 1]} />
      </mesh>
      <mesh ref={erodeB} material={erodeMatB} rotation={[0, 0, 1.1]}>
        <planeGeometry args={[1, 1]} />
      </mesh>

      <points ref={pts} geometry={geom} frustumCulled={false}>
        <pointsMaterial
          map={glowSprite()} color={missed ? '#aab3c4' : color} size={0.09}
          transparent opacity={1} depthWrite={false} blending={THREE.AdditiveBlending}
          sizeAttenuation toneMapped={false}
        />
      </points>
    </group>
  );
}

// --------------------------------------------------------- landing marks --

// The signature each spell leaves on the arena. The generic burst says
// "something landed"; this says WHICH thing landed, which is what lets a player
// read an exchange without watching the projectile the whole way in.
function LandingMark({ kind, at, color, scale }) {
  const removeAt = useRef(performance.now());
  const g1 = useRef(), g2 = useRef(), g3 = useRef();
  const LIFE = (kind === 'nova' ? 1500 : kind === 'quake' ? 1200 : 900) * vfxScale();

  // Radial cracks for ground-shattering spells: fixed angles chosen once so
  // they do not crawl between frames.
  const cracks = useMemo(() => Array.from({ length: 7 }, (_, i) => ({
    a: (i / 7) * Math.PI * 2 + Math.random() * 0.5,
    len: 0.6 + Math.random() * 0.9,
  })), []);

  useFrame(() => {
    const e = Math.min(1, (performance.now() - removeAt.current) / LIFE);
    const grow = 1 - Math.pow(1 - e, 3);
    const fade = 1 - e;

    if (g1.current) {
      // ground ring: expands and fades for every kind
      const w = kind === 'nova' ? 7 : kind === 'quake' ? 5 : 2.6;
      g1.current.scale.setScalar((0.3 + grow * w) * scale);
      g1.current.material.opacity = fade * fade * 0.8;
    }
    if (g2.current) {
      if (kind === 'vortex' || kind === 'drain') {
        // a spinning funnel that drags inward
        g2.current.rotation.y += kind === 'drain' ? -0.22 : 0.22;
        g2.current.scale.set((1 - grow * 0.6) * scale, (1 + grow * 0.9) * scale, (1 - grow * 0.6) * scale);
        g2.current.material.opacity = fade * 0.55;
      } else if (kind === 'nova') {
        // a dome of light that swallows the arena
        g2.current.scale.setScalar((0.4 + grow * 5.5) * scale);
        g2.current.material.opacity = Math.max(0, (1 - e * 1.6)) * 0.5;
      } else if (kind === 'leech') {
        // tendrils drawn back toward the caster
        g2.current.scale.set(scale, (1 + grow * 2.2) * scale, scale);
        g2.current.material.opacity = fade * 0.5;
      } else {
        g2.current.visible = false;
      }
    }
    if (g3.current) {
      g3.current.children.forEach((c, i) => {
        const k = cracks[i];
        if (!k) return;
        c.scale.set(grow * k.len * scale, 1, 1);
        c.material.opacity = fade * 0.75;
      });
    }
  });

  const showCracks = kind === 'quake' || kind === 'nova';

  return (
    <group position={[at.x, 0.02, at.z]}>
      {/* scorch ring on the floor */}
      <mesh ref={g1} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[0.5, 0.62, 48]} />
        <meshBasicMaterial
          color={color} toneMapped={false} transparent opacity={0} side={THREE.DoubleSide}
          depthWrite={false} blending={THREE.AdditiveBlending}
          polygonOffset polygonOffsetFactor={-8} polygonOffsetUnits={-8}
        />
      </mesh>

      {/* the spell-specific body */}
      <mesh ref={g2} position={[0, at.y - 0.02, 0]}>
        {kind === 'nova'
          ? <sphereGeometry args={[1, 20, 16]} />
          : <cylinderGeometry args={[0.55, 0.15, 1.2, 20, 1, true]} />}
        <meshBasicMaterial
          color={color} toneMapped={false} transparent opacity={0}
          side={THREE.DoubleSide} depthWrite={false} blending={THREE.AdditiveBlending}
        />
      </mesh>

      {showCracks && (
        <group ref={g3} rotation={[-Math.PI / 2, 0, 0]}>
          {cracks.map((k, i) => (
            <mesh key={i} rotation={[0, 0, k.a]} position={[0, 0, 0]}>
              <planeGeometry args={[1, 0.055]} />
              <meshBasicMaterial
                color={color} toneMapped={false} transparent opacity={0}
                depthWrite={false} blending={THREE.AdditiveBlending}
                polygonOffset polygonOffsetFactor={-9} polygonOffsetUnits={-9}
              />
            </mesh>
          ))}
        </group>
      )}
    </group>
  );
}

// -------------------------------------------------------------- self-cast --

// Shield / Reflect / Surge don't fly anywhere — they bloom around the caster.
function SelfCastFX({ fx }) {
  const removeFx = useGame((s) => s.removeFx);
  const dome = useRef();
  const ring = useRef();
  const start = useRef(performance.now());

  useFrame(() => {
    const e = Math.min(1, (performance.now() - start.current) / 900);
    if (e >= 1) { removeFx(fx.id); return; }
    const grow = 1 - Math.pow(1 - e, 3);
    if (dome.current) {
      dome.current.scale.setScalar(0.3 + grow * 1.0);
      dome.current.material.opacity = Math.sin(e * Math.PI) * 0.45;
    }
    if (ring.current) {
      ring.current.scale.setScalar(0.3 + grow * 1.6);
      ring.current.material.opacity = (1 - e) * 0.8;
    }
  });

  return (
    <group position={fx.at}>
      <mesh ref={dome}>
        <sphereGeometry args={[1, 24, 18]} />
        <meshBasicMaterial
          color={fx.color} toneMapped={false} transparent opacity={0}
          blending={THREE.AdditiveBlending} depthWrite={false} side={THREE.BackSide} wireframe
        />
      </mesh>
      <mesh ref={ring} rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.9, 0]}>
        <ringGeometry args={[0.7, 0.86, 48]} />
        <meshBasicMaterial color={fx.color} toneMapped={false} transparent opacity={0} side={THREE.DoubleSide} depthWrite={false} blending={THREE.AdditiveBlending} />
      </mesh>
      <pointLight color={fx.color} intensity={6} distance={4} decay={2} />
    </group>
  );
}

// --------------------------------------------------------------- ribbon ----

// A camera-facing trail built from a triangle strip that tapers to nothing at
// the tail. The previous trail was a THREE.Points cloud, which visibly breaks
// into separate dots whenever the projectile moves faster than the sample rate.
function GlowRibbon({ points, color, width }) {
  const mesh = useRef();

  const { geometry, material } = useMemo(() => {
    const CAP = 64;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(CAP * 2 * 3), 3));
    g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(CAP * 2 * 2), 2));
    const idx = [];
    for (let i = 0; i < CAP - 1; i++) {
      const a = i * 2;
      idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
    g.setIndex(idx);
    const m = new THREE.MeshBasicMaterial({
      color, transparent: true, opacity: 0.9, depthWrite: false,
      blending: THREE.AdditiveBlending, side: THREE.DoubleSide, toneMapped: false,
      map: glowSprite(),
    });
    return { geometry: g, material: m };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => () => { geometry.dispose(); material.dispose(); }, [geometry, material]);
  useEffect(() => { material.color.copy(color); }, [color, material]);

  useFrame(({ camera }) => {
    const n = Math.min(points.length, 64);
    if (n < 2) { geometry.setDrawRange(0, 0); return; }
    const pos = geometry.attributes.position.array;
    const uv = geometry.attributes.uv.array;

    for (let i = 0; i < n; i++) {
      const cur = points[i];
      const nxt = points[Math.min(n - 1, i + 1)];
      const prv = points[Math.max(0, i - 1)];
      DIR.set(nxt[0] - prv[0], nxt[1] - prv[1], nxt[2] - prv[2]);
      if (DIR.lengthSq() < 1e-8) DIR.set(0, 1, 0);
      DIR.normalize();
      // billboard: perpendicular to both the trail direction and the view ray
      VIEW.set(cur[0], cur[1], cur[2]).sub(camera.position).normalize();
      SIDE.crossVectors(DIR, VIEW).normalize();

      // taper: full width at the head, zero at the tail
      const w = (i / (n - 1)) * width * 0.5;
      const a = i * 6, b = i * 4;
      pos[a] = cur[0] + SIDE.x * w; pos[a + 1] = cur[1] + SIDE.y * w; pos[a + 2] = cur[2] + SIDE.z * w;
      pos[a + 3] = cur[0] - SIDE.x * w; pos[a + 4] = cur[1] - SIDE.y * w; pos[a + 5] = cur[2] - SIDE.z * w;
      uv[b] = i / (n - 1); uv[b + 1] = 0;
      uv[b + 2] = i / (n - 1); uv[b + 3] = 1;
    }
    geometry.attributes.position.needsUpdate = true;
    geometry.attributes.uv.needsUpdate = true;
    geometry.setDrawRange(0, (n - 1) * 6);
    geometry.computeBoundingSphere();
  });

  return <mesh ref={mesh} geometry={geometry} material={material} frustumCulled={false} />;
}

const camPos = new THREE.Vector3();
const AXIS = new THREE.Vector3();
const SIDE2 = new THREE.Vector3();
const DIR = new THREE.Vector3();
const VIEW = new THREE.Vector3();
const SIDE = new THREE.Vector3();
