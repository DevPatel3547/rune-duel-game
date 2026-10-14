import { useRef, useMemo, useLayoutEffect } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { OPP_DIST } from '../config.js';
import { Q, TIER } from '../perf.js';
import { MeshReflectorMaterial } from '@react-three/drei';
import Water from './Water.jsx';
import { registerSun } from './Effects.jsx';
import { useHitFeel } from './feel.js';
import {
  stoneMaterialMaps, metalMaterialMaps, runeDiscTexture,
  glowSprite, nebulaEnvTexture, portalTexture,
} from './textures.js';
import { scannedMaterial, scannedToon, enableAO } from './materials.js';

// ============================================================================
// THE ARENA — a ruined sky-temple adrift in a nebula.
//
// Layout notes (world space): the player stands at the origin facing -Z, the
// opponent stands at z = -OPP_DIST. Everything here is composed around that
// fixed sightline:
//
//   * the dais fills the lower third and grounds both duelists,
//   * a colonnade rings the platform to give parallax and occlusion at the
//     edges of frame,
//   * a great arch + flanking monoliths sit BEHIND the opponent, because the
//     upper-centre of the screen was previously empty black and that is what
//     made the old build read as a void rather than a place,
//   * embers, shafts and floating rubble fill the mid-depth so the eye always
//     has something between the camera and the backdrop.
// ============================================================================

const NORMAL_STRONG = new THREE.Vector2(1.3, 1.3);

// The arch opening: straight jambs up to the springing line, then a semicircle.
// Dimensions are derived from the arch mesh below (legs at ±3.1 with 1.15 width
// → a 5.05 m clear span; head torus centred at y = 5.8).
const PORTAL_GEOM = (() => {
  const halfSpan = 2.52, springing = 5.8;
  const s = new THREE.Shape();
  s.moveTo(-halfSpan, -0.9);
  s.lineTo(-halfSpan, springing);
  s.absarc(0, springing, halfSpan, Math.PI, 0, true);
  s.lineTo(halfSpan, -0.9);
  s.closePath();
  const g = new THREE.ShapeGeometry(s, 32);
  // ShapeGeometry emits UVs equal to the raw object-space coordinates, so a
  // texture mapped onto it would be sampled far outside 0..1. Remap to the
  // bounding box.
  g.computeBoundingBox();
  const { min, max } = g.boundingBox;
  const uv = g.attributes.uv;
  for (let i = 0; i < uv.count; i++) {
    uv.setXY(i, (uv.getX(i) - min.x) / (max.x - min.x), (uv.getY(i) - min.y) / (max.y - min.y));
  }
  uv.needsUpdate = true;
  return g;
})();

const CX = 0, CZ = -OPP_DIST / 2;   // arena centre
const R_PLATFORM = 10.5;
const R_COLONNADE = 12.2;
const N_PILLARS = 20;

export default function Arena() {
  return (
    <group>
      <Sky />
      <Lighting />
      {/* The sea sits far enough below that the platform reads as suspended
          over it, not floating on it. */}
      <Water y={-7.5} arenaCenter={[CX, 0, CZ]} arenaRadius={R_PLATFORM} />
      <Dais />
      <RuneCircle />
      <Colonnade />
      <GreatArch />
      <Monoliths />
      <Braziers />
      <DistantIsles />
      <FloatingRubble />
      <Embers />
      <LightShafts />
    </group>
  );
}

// ------------------------------------------------------------------ sky ----

// The nebula serves as both backdrop and IBL source. Setting `scene.environment`
// is what makes the stone and metal pick up coloured reflections — without it
// every PBR surface reflects black and reads as matte plastic.
function Sky() {
  const { scene } = useThree();
  useLayoutEffect(() => {
    const tex = nebulaEnvTexture();
    const prevBg = scene.background;
    const prevEnv = scene.environment;
    scene.background = tex;
    scene.environment = tex;
    scene.environmentIntensity = 1.15;
    return () => { scene.background = prevBg; scene.environment = prevEnv; };
  }, [scene]);

  return (
    <>
      <fog attach="fog" args={['#150a26', 34, 260]} />
      <Aurora />
    </>
  );
}

// Slow curtains of light high above the arena. The sky was a smooth gradient,
// which reads as a backdrop; structured, moving light reads as weather.
function Aurora() {
  const ref = useRef();
  useFrame((s, dt) => {
    if (!ref.current) return;
    ref.current.rotation.y += dt * 0.006;
    ref.current.children.forEach((c, i) => {
      c.material.opacity = 0.05 + Math.sin(s.clock.elapsedTime * 0.16 + i * 1.7) * 0.035;
    });
  });
  return (
    <group ref={ref}>
      {[
        { r: 150, y: 52, h: 46, c: '#5f8cff', t: 0.9 },
        { r: 168, y: 40, h: 58, c: '#a05cff', t: 1.6 },
        { r: 132, y: 62, h: 36, c: '#4fd0d8', t: 2.4 },
      ].map((b, i) => (
        <mesh key={i} position={[0, b.y, 0]} rotation={[0, b.t, 0]}>
          <cylinderGeometry args={[b.r, b.r * 1.12, b.h, 40, 1, true, 0.5, 2.4]} />
          <meshBasicMaterial
            color={b.c} toneMapped={false} transparent opacity={0.06}
            side={THREE.DoubleSide} depthWrite={false} blending={THREE.AdditiveBlending}
          />
        </mesh>
      ))}
    </group>
  );
}

// -------------------------------------------------------------- lighting ---

// Cinematic three-point rig plus practicals. The old build lit everything with
// a weak ambient, so the whole frame sat at a few percent luminance — mud. Here
// the key is strong and warm, the rim is cold and hard (it separates the wizard
// from the background), and the fill is barely there so shadows stay deep.
function Lighting() {
  return (
    <>
      {/* Ambient + hemisphere carry more of the load than a classic film rig
          would: the colonnade throws very long shadows across the deck under a
          strong low key, and the lit gaps between them banded the floor with
          warm wedges that fought the arena's cool palette. */}
      <ambientLight intensity={0.42} color="#5b4488" />
      <hemisphereLight args={['#a98ff0', '#241238', 1.05]} />

      {/* KEY — high and off to the player's left, warm.
          normalBias does the heavy lifting against shadow acne on the deck,
          which this light rakes at a very grazing angle; a large negative
          constant bias alone just trades acne for peter-panning. */}
      <directionalLight
        position={[-3.0, 13, 3.0]}
        intensity={1.05}
        color="#e8dcff"
        castShadow={Q.shadows}
        shadow-mapSize={[2048, 2048]}
        // The deck is a single large, almost perfectly flat receiver, which is
        // the worst case for shadow-map self-intersection: tiny depth errors
        // across its tessellation show up as saw-toothed acne over the whole
        // floor. A generous normalBias pushes the comparison off the surface.
        // The cost is slight peter-panning, which is invisible for a character
        // shadow cast onto a floor.
        shadow-bias={-0.0015}
        shadow-normalBias={0.22}
        shadow-camera-near={1}
        shadow-camera-far={46}
        shadow-camera-left={-11}
        shadow-camera-right={11}
        shadow-camera-top={11}
        shadow-camera-bottom={-11}
      />

      {/* RIM — behind and above the opponent, cold; carves their silhouette */}
      <directionalLight position={[2.5, 6.5, -14]} intensity={2.6} color="#7fd4ff" />

      {/* FILL — soft, from the camera side, just enough to keep shadows readable */}
      <directionalLight position={[3, 3, 6]} intensity={0.34} color="#8f7dff" />

      {/* practical: the arcane glow rising off the rune circle */}
      <pointLight position={[CX, 0.8, CZ]} intensity={22} color="#9d6cff" distance={20} decay={2} />
      {/* practical: uplight on the opponent so the hood/face never goes fully black */}
      <pointLight position={[0, 0.6, -OPP_DIST + 1.1]} intensity={9} color="#b98cff" distance={7} decay={2} />
      {/* the great arch behind the opponent burns cold — a backlight source */}
      <pointLight position={[0, 5.6, -18.5]} intensity={70} color="#66d0ff" distance={30} decay={2} />
      {/* colonnade wash: without this the columns fall below the midtones and
          read as flat black cut-outs, taking all their carved detail with them */}
      <pointLight position={[0, 5.0, CZ]} intensity={48} color="#8f7ad8" distance={26} decay={1.6} />
    </>
  );
}

// ----------------------------------------------------------------- dais ----

// A tiered stone platform. Tiers (rather than one flat disc) give the silhouette
// a stepped edge that catches the key light and sells physical thickness.
function Dais() {
  // Scanned stone. Procedural noise gave these surfaces plausible roughness but
  // no history — no weathering, no wear where feet fall, no staining. That
  // history is most of what makes a surface read as real.
  const deckMat = useMemo(() => scannedToon('stone', {
    repeat: [7, 7], color: '#2a3145', normalScale: 0.9, rimStrength: 0.2,
  }), []);
  const rimMat = useMemo(() => scannedToon('rock', {
    repeat: [12, 2], color: '#232a3c', normalScale: 0.8, rimStrength: 0.30,
  }), []);
  const underMat = useMemo(() => scannedToon('rock', {
    repeat: [4, 3], color: '#12161f', normalScale: 0.9, rimStrength: 0.18,
  }), []);
  const inlayMat = useMemo(() => scannedToon('metal', {
    repeat: [10, 1], color: '#3aa8c8', rimColor: '#8af0ff', rimStrength: 1.0,
    normalScale: 0.5, side: THREE.DoubleSide,
  }), []);

  return (
    <group position={[CX, 0, CZ]}>
      {/* main deck */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, 0]} receiveShadow>
        <ringGeometry ref={enableAO} args={[0.001, R_PLATFORM, 96, 12]} />
        {Q.reflect ? (
          // Renders the scene again into a mirror buffer, so it is genuinely
          // expensive — half-resolution and blurred, which is also what makes
          // it read as polished stone rather than a mirror.
          <MeshReflectorMaterial
            map={deckMat.map}
            normalMap={deckMat.normalMap}
            roughnessMap={deckMat.roughnessMap}
            color="#2a3145"
            roughness={0.62}
            metalness={0.24}
            envMapIntensity={0.9}
            normalScale={NORMAL_STRONG}
            resolution={TIER === 'high' ? 1024 : 512}
            mixBlur={5}
            mixStrength={22}
            blur={[420, 120]}
            mirror={0.34}
            depthScale={0.9}
            minDepthThreshold={0.3}
            maxDepthThreshold={1.2}
            depthToBlurRatioBias={0.28}
          />
        ) : (
          <primitive object={deckMat} attach="material" />
        )}
      </mesh>

      {/* Stepped rim — three shallow cylinders under the deck.
          NOTE the y offsets: the first tier previously spanned exactly
          -0.34..0.00, putting its top cap perfectly coplanar with the deck at
          y = 0. Two coplanar surfaces z-fight, and because the deck is huge and
          viewed at a grazing angle that showed up as big jagged dark shards
          strewn across the floor. Every tier now sits clear of the one above. */}
      {[
        { r: R_PLATFORM + 0.02, h: 0.34, y: -0.20 },
        { r: R_PLATFORM + 0.42, h: 0.30, y: -0.52 },
        { r: R_PLATFORM + 0.86, h: 0.28, y: -0.82 },
      ].map((s, i) => (
        <mesh key={i} position={[0, s.y, 0]} receiveShadow>
          <cylinderGeometry ref={enableAO} args={[s.r, s.r + 0.16, s.h, 96]} />
          <primitive object={rimMat} attach="material" />
        </mesh>
      ))}

      {/* eroded underside — the platform is torn away beneath, it floats.
          Rotated 180° so the cone tapers DOWNWARD to a point; left unrotated a
          coneGeometry puts its apex up and its wide base at the bottom, which
          reads as an upside-down mountain hanging in frame. */}
      <mesh position={[0, -2.7, 0]} rotation={[Math.PI, 0, 0]}>
        <coneGeometry ref={enableAO} args={[R_PLATFORM + 0.5, 4.2, 32, 1]} />
        <primitive object={underMat} attach="material" />
      </mesh>

      {/* polished metal inlay band separating deck from rim */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.006, 0]}>
        <ringGeometry ref={enableAO} args={[R_PLATFORM - 0.42, R_PLATFORM - 0.06, 96]} />
        <primitive object={inlayMat} attach="material" />
      </mesh>

      {/* duelling marks: each fighter's stance ring */}
      <StanceRing z={-CZ - 0.15} color="#7fd4ff" />
      <StanceRing z={-OPP_DIST - CZ + 0.2} color="#ff8ad4" />
    </group>
  );
}

function StanceRing({ z, color }) {
  const ref = useRef();
  useFrame((s) => {
    if (ref.current) ref.current.material.opacity = 0.45 + Math.sin(s.clock.elapsedTime * 1.6) * 0.12;
  });
  return (
    <group position={[0, 0.012, z]}>
      <mesh ref={ref} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[0.62, 0.78, 64]} />
        <meshBasicMaterial color={color} toneMapped={false} transparent opacity={0.30} side={THREE.DoubleSide} depthWrite={false} polygonOffset polygonOffsetFactor={-6} polygonOffsetUnits={-6} />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.002, 0]}>
        <ringGeometry args={[0.80, 0.84, 64]} />
        <meshBasicMaterial color={color} toneMapped={false} transparent opacity={0.22} side={THREE.DoubleSide} depthWrite={false} polygonOffset polygonOffsetFactor={-6} polygonOffsetUnits={-6} />
      </mesh>
    </group>
  );
}

// ---------------------------------------------------------- rune circle ----

// Two counter-rotating inscribed discs floating just above the deck. Emissive
// only (no lighting contribution of their own beyond the practical above), so
// they read as light etched into the floor and feed the bloom pass.
function RuneCircle() {
  const outer = useRef();
  const inner = useRef();
  const tex = runeDiscTexture();

  useFrame((s, dt) => {
    // A heavy hit surges the circle: it flares and spins up, then settles.
    const surge = useHitFeel.getState().pulse;
    if (outer.current) outer.current.rotation.z += dt * (0.045 + surge * 0.9);
    if (inner.current) inner.current.rotation.z -= dt * (0.075 + surge * 1.4);
    const pulse = 0.26 + Math.sin(s.clock.elapsedTime * 0.9) * 0.05 + surge * 0.42;
    if (outer.current) outer.current.material.opacity = pulse;
    if (inner.current) inner.current.material.opacity = pulse * 0.8;
  });

  // polygonOffset (rather than a bigger Y gap) keeps these visually flush with
  // the stone while resolving the depth fight that otherwise speckles the floor
  // at grazing angles near the camera.
  return (
    <group position={[CX, 0.02, CZ]} rotation={[-Math.PI / 2, 0, 0]}>
      <mesh ref={outer}>
        <planeGeometry args={[13.6, 13.6]} />
        <meshBasicMaterial
          map={tex} color="#7a52d8" toneMapped={false} transparent opacity={0.26}
          blending={THREE.AdditiveBlending} depthWrite={false}
          polygonOffset polygonOffsetFactor={-4} polygonOffsetUnits={-4}
        />
      </mesh>
      <mesh ref={inner} position={[0, 0, 0.012]} scale={0.5}>
        <planeGeometry args={[13.6, 13.6]} />
        <meshBasicMaterial
          map={tex} color="#4a9fe0" toneMapped={false} transparent opacity={0.21}
          blending={THREE.AdditiveBlending} depthWrite={false}
          polygonOffset polygonOffsetFactor={-5} polygonOffsetUnits={-5}
        />
      </mesh>
    </group>
  );
}

// ------------------------------------------------------------ colonnade ----

// Ring of columns. Instanced: 16 pillars × 3 parts would otherwise be 48 draw
// calls, which matters on a phone. Two of them are deliberately broken off at
// different heights so the ring doesn't read as a perfect CAD array.
function Colonnade() {
  const shaftMat = useMemo(() => scannedToon('rock', {
    repeat: [2, 4], color: '#2b3245', normalScale: 0.85, rimStrength: 0.45,
  }), []);
  const blockMat = useMemo(() => scannedToon('stone', {
    repeat: [1, 1], color: '#2f3648', normalScale: 0.8, rimStrength: 0.45,
  }), []);
  const bandMat = useMemo(() => scannedToon('metal', {
    repeat: [3, 1], color: '#35d6ff', rimColor: '#c8f6ff', rimStrength: 1.2, normalScale: 0.4,
  }), []);

  // A fluted column profile revolved around Y — the taper and the swell near the
  // base ("entasis") is what makes a cylinder read as an actual column.
  const shaftGeom = useMemo(() => {
    const pts = [];
    for (let i = 0; i <= 14; i++) {
      const t = i / 14;
      const y = t * 5.0;
      const r = 0.40 - t * 0.10 + Math.sin(t * Math.PI) * 0.035;
      pts.push(new THREE.Vector2(r, y));
    }
    return new THREE.LatheGeometry(pts, 20);
  }, []);

  const layout = useMemo(() => {
    const out = [];
    for (let i = 0; i < N_PILLARS; i++) {
      const a = (i / N_PILLARS) * Math.PI * 2 + Math.PI / N_PILLARS;
      // leave a gap directly behind the opponent so the great arch reads clearly
      const towardArch = Math.abs(((a + Math.PI / 2) % (Math.PI * 2)) - Math.PI) < 0.25;
      if (towardArch) continue;
      // deterministic variation: a couple are ruined stubs
      const broken = i === 3 ? 0.42 : i === 9 ? 0.63 : i === 12 ? 0.78 : 1;
      out.push({
        x: CX + Math.cos(a) * R_COLONNADE,
        z: CZ + Math.sin(a) * R_COLONNADE,
        rot: -a,
        scale: broken,
        intact: broken === 1,
      });
    }
    return out;
  }, []);

  return (
    <group>
      {layout.map((p, i) => (
        <group key={i} position={[p.x, -0.9, p.z]} rotation={[0, p.rot, 0]}>
          {/* plinth */}
          <mesh position={[0, 0.18, 0]} receiveShadow>
            <boxGeometry args={[1.05, 0.36, 1.05]} />
            <primitive object={blockMat} attach="material" />
          </mesh>
          {/* shaft */}
          <mesh geometry={shaftGeom} position={[0, 0.36, 0]} scale={[1, p.scale, 1]} receiveShadow>
            <primitive object={shaftMat} attach="material" />
          </mesh>
          {p.intact && (
            <>
              {/* capital */}
              <mesh position={[0, 5.46, 0]}>
                <cylinderGeometry args={[0.52, 0.32, 0.3, 20]} />
                <primitive object={blockMat} attach="material" />
              </mesh>
              <mesh position={[0, 5.68, 0]}>
                <boxGeometry args={[1.06, 0.18, 1.06]} />
                <primitive object={blockMat} attach="material" />
              </mesh>
              {/* glowing gold band — catches the eye around the ring */}
              <mesh position={[0, 4.9, 0]}>
                <torusGeometry args={[0.34, 0.035, 8, 24]} />
                <primitive object={bandMat} attach="material" />
              </mesh>
            </>
          )}
          {/* jagged break at the top of ruined columns */}
          {!p.intact && (
            <mesh position={[0, 0.36 + 5.0 * p.scale, 0]}>
              <coneGeometry args={[0.36, 0.4, 7, 1]} />
              <primitive object={shaftMat} attach="material" />
            </mesh>
          )}
        </group>
      ))}
    </group>
  );
}

// ----------------------------------------------------------- great arch ----

// The focal backdrop directly behind the opponent. This is the piece that fixes
// the composition: it fills the upper-centre of frame, frames the opponent's
// silhouette, and gives the rim light a visible source.
function GreatArch() {
  const legMat = useMemo(() => scannedToon('rock', {
    repeat: [2, 5], color: '#262d3e', normalScale: 0.85, rimStrength: 0.4,
  }), []);
  const archMat = useMemo(() => scannedToon('rock', {
    repeat: [8, 1], color: '#262d3e', normalScale: 0.85, rimStrength: 0.5,
  }), []);
  const baseMat = useMemo(() => scannedToon('stone', {
    repeat: [2, 1], color: '#1e2432', normalScale: 0.8, rimStrength: 0.3,
  }), []);
  const keyMat = useMemo(() => scannedToon('metal', {
    repeat: [1, 1], color: '#8af0ff', rimColor: '#ffffff', rimStrength: 1.4, normalScale: 0.4,
  }), []);
  const portal = useRef();

  useFrame((s) => {
    if (portal.current) {
      const t = s.clock.elapsedTime;
      portal.current.material.opacity = 0.30 + Math.sin(t * 0.7) * 0.07 + Math.sin(t * 2.3) * 0.02;
    }
  });

  // Torus half-ring for the arch head, legs are tapered boxes.
  return (
    <group position={[0, 0, -18.5]}>
      {/* legs */}
      {[-3.1, 3.1].map((x) => (
        <group key={x} position={[x, 0, 0]}>
          <mesh position={[0, 2.6, 0]}>
            <boxGeometry args={[1.15, 6.4, 1.15]} />
            <primitive object={legMat} attach="material" />
          </mesh>
          <mesh position={[0, -0.75, 0]}>
            <boxGeometry args={[1.7, 1.1, 1.7]} />
            <primitive object={baseMat} attach="material" />
          </mesh>
        </group>
      ))}

      {/* arch head — half torus */}
      <mesh position={[0, 5.8, 0]} rotation={[0, 0, 0]}>
        <torusGeometry args={[3.1, 0.58, 12, 40, Math.PI]} />
        <primitive object={archMat} attach="material" />
      </mesh>

      {/* keystone */}
      <mesh position={[0, 8.95, 0]}>
        <boxGeometry args={[1.1, 1.0, 1.35]} />
        <primitive object={keyMat} attach="material" />
      </mesh>

      {/* the portal itself — a cold sheet of light filling the opening. This is
          what backlights the opponent and gives the frame its focal point.
          Built from a Shape so its silhouette actually matches the arch (square
          jambs, semicircular head); a plain plane overhangs the stonework and
          reads as a blue billboard hung behind the set. */}
      <mesh
        ref={(m) => { portal.current = m; if (m) registerSun(m); }}
        geometry={PORTAL_GEOM}
        position={[0, 0, -0.35]}
      >
        <meshBasicMaterial
          map={portalTexture()} color="#6fd6ff" toneMapped={false} transparent opacity={0.3}
          blending={THREE.AdditiveBlending} depthWrite={false} side={THREE.DoubleSide}
        />
      </mesh>
      {/* brighter core so the centre blooms hotter than the edges */}
      <mesh geometry={PORTAL_GEOM} position={[0, 0.35, -0.3]} scale={[0.55, 0.55, 1]}>
        <meshBasicMaterial
          map={portalTexture()} color="#eaf8ff" toneMapped={false} transparent opacity={0.26}
          blending={THREE.AdditiveBlending} depthWrite={false} side={THREE.DoubleSide}
        />
      </mesh>
    </group>
  );
}

// ------------------------------------------------------------ monoliths ----

// Colossal leaning slabs far behind the colonnade. Pure silhouette work — they
// add depth layers between the arch and the sky so the background isn't a
// single flat plane of nebula.
function Monoliths() {
  const slabMat = useMemo(() => scannedToon('rock', {
    repeat: [1, 5], color: '#171c28', normalScale: 0.8, rimStrength: 0.35,
  }), []);
  const slabs = useMemo(() => ([
    { p: [-16, 1.2, -22], r: [0.06, 0.5, 0.10], s: [3.2, 14, 1.7] },
    { p: [17, 0.2, -25], r: [-0.05, -0.4, -0.13], s: [3.6, 18, 1.9] },
    { p: [-23, -1.5, -31], r: [0.02, 0.9, 0.07], s: [4.2, 22, 2.4] },
    { p: [24, -2.5, -35], r: [0, -0.7, -0.05], s: [4.8, 26, 2.8] },
    { p: [-8, -5.5, -41], r: [0, 0.3, 0.12], s: [3.6, 20, 2.4] },
  ]), []);

  return slabs.map((m, i) => (
    <mesh key={i} position={m.p} rotation={m.r}>
      <boxGeometry args={m.s} />
      <primitive object={slabMat} attach="material" />
    </mesh>
  ));
}

// ------------------------------------------------------------- braziers ----

// Flame bowls flanking each duelist. Real point lights (so they actually warm
// the nearby stone) plus a cheap billboarded flame sprite.
function Braziers() {
  const brassMat = useMemo(() => scannedToon('metal', {
    repeat: [1, 2], color: '#4a5468', rimColor: '#ff4d5e', rimStrength: 0.9, normalScale: 0.4,
  }), []);
  // Pushed out to the platform edge and off to the flanks. Anything placed near
  // the centre line sits between the camera and the opponent and blocks the
  // duel; anything close to the camera is enormous at a 62° FOV.
  const spots = useMemo(() => {
    const R = 8.4;
    return [50, 130, 230, 310].map((deg) => {
      const a = (deg * Math.PI) / 180;
      return [CX + Math.cos(a) * R, 0, CZ + Math.sin(a) * R];
    });
  }, []);

  return spots.map((p, i) => <Brazier key={i} pos={p} seed={i} metal={brassMat} />);
}

function Brazier({ pos, seed, metal }) {
  const light = useRef();
  const flame = useRef();
  const glow = useRef();
  useFrame((s) => {
    const t = s.clock.elapsedTime;
    // layered sines = a flicker that never visibly loops
    const f = 0.78 + Math.sin(t * 11 + seed) * 0.12 + Math.sin(t * 23.7 + seed * 2) * 0.07;
    // fires gutter up when a heavy spell lands
    const surge = useHitFeel.getState().pulse;
    if (light.current) light.current.intensity = 3.4 * f * (1 + surge * 1.8);
    if (flame.current) {
      // scale the flame body only, and keep it small — a fat additive sphere
      // reads as a solid glowing egg rather than fire
      const w = 0.9 + f * 0.12 + surge * 0.25;
      flame.current.scale.set(w, 0.85 + f * 0.35 + surge * 0.9, w);
      flame.current.material.opacity = Math.min(0.85, 0.34 * f + surge * 0.3);
    }
    if (glow.current) glow.current.scale.setScalar(0.42 + f * 0.10 + surge * 0.35);
  });

  return (
    <group position={pos}>
      {/* stem */}
      <mesh position={[0, 0.42, 0]} castShadow receiveShadow>
        <cylinderGeometry args={[0.06, 0.10, 0.84, 10]} />
        <primitive object={metal} attach="material" />
      </mesh>
      {/* bowl */}
      <mesh position={[0, 0.92, 0]} castShadow>
        <cylinderGeometry args={[0.22, 0.10, 0.18, 14]} />
        <primitive object={metal} attach="material" />
      </mesh>
      {/* flame: a slim tapered cone, not a ball */}
      <mesh ref={flame} position={[0, 1.16, 0]}>
        <coneGeometry args={[0.15, 0.44, 10, 1, true]} />
        <meshBasicMaterial
          color="#ffb057" toneMapped={false} transparent opacity={0.5}
          blending={THREE.AdditiveBlending} depthWrite={false} side={THREE.DoubleSide}
        />
      </mesh>
      {/* soft halo sprite sells the heat without adding solid geometry */}
      {/* The halo has to stay small and faint: a large, opaque additive sprite
          on a bloom-heavy pipeline reads as a solid orange disc, not as heat. */}
      <sprite ref={glow} position={[0, 1.14, 0]} scale={0.45}>
        <spriteMaterial
          map={glowSprite()} color="#ff9440" transparent opacity={0.30}
          blending={THREE.AdditiveBlending} depthWrite={false} toneMapped={false}
        />
      </sprite>
      {/* Short falloff on purpose: these are set dressing that should pick out
          their own bowl and a little of the stone beneath, not floodlight the
          duelling floor with warm pools that fight the arcane palette. */}
      <pointLight ref={light} position={[0, 1.2, 0]} color="#ff9b4a" intensity={3.4} distance={3.4} decay={2} />
    </group>
  );
}

// -------------------------------------------------------- distant isles ----

// Other temples, adrift on the same sea. The background was previously empty
// dark past the colonnade, which reads as "nothing was built here" rather than
// as night. These give the world scale and imply the arena is one ruin among
// many — the difference between a dark backdrop and a dark *place*.
//
// Pure silhouette work: they sit far enough out that fog flattens them to
// shapes, so they are cheap boxes and cones with a single unlit material, plus
// a handful of window lights so they read as inhabited.
function DistantIsles() {
  const isles = useMemo(() => {
    // Deterministic layout — a background that reshuffles between sessions
    // would be noticeable and unsettling.
    const seed = (n) => { const x = Math.sin(n * 127.1) * 43758.5453; return x - Math.floor(x); };
    const out = [];
    const N = TIER === 'low' ? 5 : 9;
    for (let i = 0; i < N; i++) {
      // spread across the far arc, biased behind the opponent
      const a = -Math.PI / 2 + (seed(i) - 0.5) * 2.3;
      // Well beyond the fog's far plane start, so they always read as distant
      // silhouettes. Closer than this and they intrude on the arena.
      const dist = 150 + seed(i + 40) * 180;
      const y = -26 + seed(i + 80) * 34;
      const scale = 1.6 + seed(i + 120) * 3.2;
      out.push({
        pos: [Math.cos(a) * dist, y, Math.sin(a) * dist],
        scale,
        towers: 1 + Math.floor(seed(i + 160) * 3),
        lit: seed(i + 200) > 0.35,
        rot: seed(i + 240) * Math.PI,
      });
    }
    return out;
  }, []);

  return isles.map((s, i) => (
    <group key={i} position={s.pos} rotation={[0, s.rot, 0]} scale={s.scale}>
      {/* the island itself: a slab tapering to a broken point beneath */}
      <mesh>
        <cylinderGeometry args={[7, 5.4, 1.6, 9]} />
        <meshBasicMaterial color="#140c26" toneMapped={false} />
      </mesh>
      <mesh position={[0, -4.4, 0]} rotation={[Math.PI, 0, 0]}>
        <coneGeometry args={[5.4, 7.6, 9]} />
        <meshBasicMaterial color="#0f0920" toneMapped={false} />
      </mesh>
      {/* towers */}
      {Array.from({ length: s.towers }).map((_, t) => {
        const a = (t / s.towers) * Math.PI * 2;
        const h = 6 + (t % 3) * 4;
        return (
          <group key={t} position={[Math.cos(a) * 2.6, 0.8 + h / 2, Math.sin(a) * 2.6]}>
            <mesh>
              <boxGeometry args={[2.0, h, 2.0]} />
              <meshBasicMaterial color="#170e2c" toneMapped={false} />
            </mesh>
            <mesh position={[0, h / 2 + 1.1, 0]}>
              <coneGeometry args={[1.7, 2.2, 6]} />
              <meshBasicMaterial color="#120a24" toneMapped={false} />
            </mesh>
            {s.lit && (
              <mesh position={[0, h * 0.18, 1.02]}>
                <planeGeometry args={[0.42, 0.7]} />
                <meshBasicMaterial color="#ffb45e" toneMapped={false} transparent opacity={0.85} />
              </mesh>
            )}
          </group>
        );
      })}
    </group>
  ));
}

// --------------------------------------------------------------- rubble ----

// Chunks of the shattered platform hanging in the void around the arena. They
// drift and tumble slowly, which stops the mid-depth from feeling like a static
// matte painting.
function FloatingRubble() {
  const chunkMat = useMemo(() => scannedToon('rock', {
    repeat: [1, 1], color: '#1c2230', normalScale: 0.9, rimStrength: 0.5,
  }), []);
  const group = useRef();

  const chunks = useMemo(() => {
    const out = [];
    const n = TIER === 'low' ? 10 : TIER === 'mid' ? 18 : 28;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + (i % 3) * 0.4;
      const rad = 12.5 + (i % 5) * 2.4;
      out.push({
        pos: [CX + Math.cos(a) * rad, -1.2 - (i % 7) * 0.85, CZ + Math.sin(a) * rad],
        scale: 0.35 + (i % 4) * 0.28,
        rot: [i * 0.7, i * 1.3, i * 0.4],
        speed: 0.08 + (i % 5) * 0.03,
        phase: i * 1.7,
      });
    }
    return out;
  }, []);

  useFrame((s) => {
    if (!group.current) return;
    const t = s.clock.elapsedTime;
    group.current.children.forEach((m, i) => {
      const c = chunks[i];
      m.position.y = c.pos[1] + Math.sin(t * c.speed * 2 + c.phase) * 0.5;
      m.rotation.y = c.rot[1] + t * c.speed * 0.35;
      m.rotation.x = c.rot[0] + Math.sin(t * c.speed + c.phase) * 0.15;
    });
  });

  return (
    <group ref={group}>
      {chunks.map((c, i) => (
        <mesh key={i} position={c.pos} rotation={c.rot} scale={c.scale}>
          <dodecahedronGeometry args={[1, 0]} />
          <primitive object={chunkMat} attach="material" />
        </mesh>
      ))}
    </group>
  );
}

// --------------------------------------------------------------- embers ----

// GPU-animated motes rising through the arena. Animating in the vertex shader
// keeps this at one draw call and zero per-frame CPU work, so we can afford a
// few hundred even on a phone.
function Embers() {
  const count = TIER === 'low' ? 90 : TIER === 'mid' ? 220 : 420;
  const matRef = useRef();

  const geom = useMemo(() => {
    const g = new THREE.BufferGeometry();
    const pos = new Float32Array(count * 3);
    const seed = new Float32Array(count);   // per-mote phase/speed variation
    const size = new Float32Array(count);
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2;
      const r = Math.sqrt(Math.random()) * (R_PLATFORM + 1.5);
      pos[i * 3] = CX + Math.cos(a) * r;
      pos[i * 3 + 1] = Math.random() * 9;
      pos[i * 3 + 2] = CZ + Math.sin(a) * r;
      seed[i] = Math.random();
      size[i] = (0.4 + Math.random() * 0.9) * (Q.particleScale || 1);
    }
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1));
    g.setAttribute('aSize', new THREE.BufferAttribute(size, 1));
    return g;
  }, [count]);

  const material = useMemo(() => new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    uniforms: {
      uTime: { value: 0 },
      uMap: { value: glowSprite() },
      uColorA: { value: new THREE.Color('#ffb066') },
      uColorB: { value: new THREE.Color('#8f6cff') },
    },
    vertexShader: /* glsl */`
      attribute float aSeed;
      attribute float aSize;
      uniform float uTime;
      varying float vFade;
      varying float vMix;
      void main() {
        vec3 p = position;
        float life = 9.0;
        // rise, wrapping back to the floor — mod() gives an endless loop
        float t = mod(uTime * (0.22 + aSeed * 0.34) + aSeed * life, life);
        p.y = t;
        // lazy horizontal drift so they don't rise in straight lines
        p.x += sin(uTime * 0.35 + aSeed * 12.0) * 0.55;
        p.z += cos(uTime * 0.29 + aSeed * 9.0) * 0.55;
        // fade in off the floor, fade out at the top
        vFade = smoothstep(0.0, 1.4, t) * (1.0 - smoothstep(5.5, life, t));
        vMix = aSeed;
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        gl_PointSize = aSize * 26.0 / -mv.z;
        gl_Position = projectionMatrix * mv;
      }
    `,
    fragmentShader: /* glsl */`
      uniform sampler2D uMap;
      uniform vec3 uColorA;
      uniform vec3 uColorB;
      varying float vFade;
      varying float vMix;
      void main() {
        vec4 tex = texture2D(uMap, gl_PointCoord);
        vec3 col = mix(uColorA, uColorB, vMix);
        gl_FragColor = vec4(col, tex.a * vFade * 0.85);
        if (gl_FragColor.a < 0.01) discard;
      }
    `,
  }), []);

  useFrame((s) => { material.uniforms.uTime.value = s.clock.elapsedTime; });
  useLayoutEffect(() => () => { geom.dispose(); material.dispose(); }, [geom, material]);

  return <points geometry={geom} material={material} ref={matRef} frustumCulled={false} />;
}

// ---------------------------------------------------------- light shafts ---

// Fake volumetrics: additive cones angled with the key light. True volumetric
// scattering is far too expensive for a phone, but a handful of soft cones sold
// through bloom is indistinguishable at this scale.
function LightShafts() {
  if (!Q.effects) return null;
  // Kept well behind the duelists and deliberately very faint. Earlier values
  // put wide cones a couple of metres from the camera, where an additive cone
  // covers half the screen and reads as a solid tan wedge instead of as haze.
  // Only one shaft, and it hangs entirely above the deck. Cones that intersect
  // the floor draw hard tan wedges across the stone — the geometry becomes
  // visible as geometry, which is exactly what fake volumetrics must not do.
  const shafts = [
    { pos: [0, 8.0, -16.6], rot: [0.20, 0, 0], scale: [2.6, 6.0, 2.6], color: '#7fd4ff', op: 0.050 },
    { pos: [-2.4, 8.2, -17.0], rot: [0.18, 0.2, 0.10], scale: [1.1, 5.2, 1.1], color: '#9fe0ff', op: 0.032 },
    { pos: [2.6, 8.1, -17.2], rot: [0.18, -0.2, -0.10], scale: [1.1, 5.0, 1.1], color: '#9fe0ff', op: 0.030 },
  ];
  return shafts.map((s, i) => (
    <mesh key={i} position={s.pos} rotation={s.rot} scale={s.scale}>
      <coneGeometry args={[1, 1, 18, 1, true]} />
      <meshBasicMaterial
        color={s.color} toneMapped={false} transparent opacity={s.op}
        blending={THREE.AdditiveBlending} depthWrite={false} side={THREE.DoubleSide}
      />
    </mesh>
  ));
}
