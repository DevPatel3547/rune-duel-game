import { useRef, useState, useEffect, useMemo } from 'react';
import { Canvas, useThree, useFrame } from '@react-three/fiber';
import { Stars, Billboard, Text } from '@react-three/drei';
import * as THREE from 'three';
import { SPELLS, scoreAgainst, FIZZLE_THRESHOLD } from '@rune/shared';
import { StrokeProjector, downsample } from '../draw/projection.js';
import GlowTrail from '../draw/GlowTrail.jsx';
import { useLane, RUNE_SPELL, SPELL_RUNES } from './laneStore.js';
import { step, stepAI, UNITS, BOLTS } from './sim.js';

// ---- world mapping: lane x(0..1) → world z ---------------------------------
const NEAR_Z = -2.5;   // just in front of the player
const FAR_Z = -26;     // the enemy tower
const xToZ = (x) => NEAR_Z + x * (FAR_Z - NEAR_Z);
const STEP = 1 / 30;

const spellMeta = (key) => UNITS[key] || BOLTS[key];

// ============================================================================
export default function LaneApp() {
  const screen = useLane((s) => s.screen);
  return (
    <>
      <Canvas
        dpr={[1, 2]}
        gl={{ antialias: true, powerPreference: 'high-performance' }}
        camera={{ position: [0, 1.7, 2], fov: 60, near: 0.05, far: 200 }}
        onCreated={({ camera }) => camera.lookAt(0, 1.2, FAR_Z)}
      >
        <Scene battle={screen === 'battle'} />
      </Canvas>
      {screen === 'menu' ? <Menu /> : <LaneHUD />}
    </>
  );
}

// ---- the 3D world ----------------------------------------------------------
function Scene({ battle }) {
  return (
    <>
      <color attach="background" args={['#0a0614']} />
      <fog attach="fog" args={['#0c0820', 14, 60]} />
      <Stars radius={80} depth={50} count={2600} factor={3} saturation={0} fade speed={0.4} />
      <ambientLight intensity={0.45} />
      <hemisphereLight args={['#6a4fb0', '#140a1e', 0.6]} />
      <directionalLight position={[6, 12, 4]} intensity={0.7} color="#cdbfff" />
      <pointLight position={[0, 4, FAR_Z + 3]} intensity={1.2} color="#ff6a8a" distance={28} />
      <pointLight position={[0, 3, 1]} intensity={0.9} color="#7fb4ff" distance={16} />
      <Ground />
      <EnemyTower />
      <YourBase />
      {battle && (
        <>
          <SimDriver />
          <Minions />
          <Flashes />
          <DrawLayer />
        </>
      )}
    </>
  );
}

function Ground() {
  return (
    <group>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, FAR_Z / 2 + 1]} receiveShadow>
        <planeGeometry args={[60, 80]} />
        <meshStandardMaterial color="#120c20" roughness={0.95} metalness={0.1} />
      </mesh>
      {/* glowing lane edges */}
      {[-2.8, 2.8].map((x) => (
        <mesh key={x} position={[x, 0.02, FAR_Z / 2 + 1]} rotation={[-Math.PI / 2, 0, 0]}>
          <planeGeometry args={[0.08, 80]} />
          <meshBasicMaterial color="#5b3fd0" toneMapped={false} transparent opacity={0.8} />
        </mesh>
      ))}
      {/* center seam */}
      <mesh position={[0, 0.02, FAR_Z / 2 + 1]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[0.04, 80]} />
        <meshBasicMaterial color="#3a2f60" toneMapped={false} transparent opacity={0.5} />
      </mesh>
    </group>
  );
}

function TowerMesh({ z, color, accent }) {
  const ref = useRef();
  useFrame((_, dt) => { if (ref.current) ref.current.rotation.y += dt * 0.5; });
  return (
    <group position={[0, 0, z]}>
      <mesh position={[0, 1.1, 0]}>
        <cylinderGeometry args={[0.6, 1.1, 2.2, 6]} />
        <meshStandardMaterial color={color} roughness={0.6} metalness={0.4} />
      </mesh>
      <mesh ref={ref} position={[0, 2.7, 0]}>
        <octahedronGeometry args={[0.7, 0]} />
        <meshStandardMaterial color={accent} emissive={accent} emissiveIntensity={1.6} roughness={0.2} toneMapped={false} />
      </mesh>
      <pointLight position={[0, 2.7, 0]} color={accent} intensity={1.6} distance={10} />
    </group>
  );
}

function EnemyTower() {
  const hp = useLane((s) => s.towers.foe.hp);
  const max = useLane((s) => s.towers.foe.max);
  return (
    <group>
      <TowerMesh z={FAR_Z} color="#3a1530" accent="#ff5a7a" />
      <Billboard position={[0, 4.2, FAR_Z]}>
        <BarMesh frac={hp / max} w={3} color="#ff5a7a" />
        <Text position={[0, 0.4, 0]} fontSize={0.5} color="#ffb0c0" outlineWidth={0.03} outlineColor="#000">
          ENEMY CRYSTAL
        </Text>
      </Billboard>
    </group>
  );
}

function YourBase() {
  // sits behind/around the player — a glowing ring so you feel anchored.
  return (
    <mesh position={[0, 0.03, 2.6]} rotation={[-Math.PI / 2, 0, 0]}>
      <ringGeometry args={[1.0, 1.3, 40]} />
      <meshBasicMaterial color="#ffd24a" toneMapped={false} transparent opacity={0.7} side={THREE.DoubleSide} />
    </mesh>
  );
}

function BarMesh({ frac, w = 2, color = '#5be08a' }) {
  const f = Math.max(0, Math.min(1, frac));
  return (
    <group>
      <mesh><planeGeometry args={[w + 0.06, 0.34]} /><meshBasicMaterial color="#0c0a16" transparent opacity={0.85} /></mesh>
      <mesh position={[-w / 2 + (f * w) / 2, 0, 0.001]}>
        <planeGeometry args={[Math.max(0.001, f * w), 0.26]} />
        <meshBasicMaterial color={color} toneMapped={false} />
      </mesh>
    </group>
  );
}

// ---- entities --------------------------------------------------------------
function Minions() {
  const minions = useLane((s) => s.minions);
  return minions.map((m) => <Minion key={m.id} m={m} />);
}

function Minion({ m }) {
  const isYou = m.side === 'you';
  return (
    <group position={[m.lane, m.r * 0.6, xToZ(m.x)]}>
      <mesh castShadow>
        <icosahedronGeometry args={[m.r, 0]} />
        <meshStandardMaterial color={m.color} emissive={m.color} emissiveIntensity={isYou ? 0.5 : 0.35} roughness={0.35} metalness={0.3} toneMapped={false} />
      </mesh>
      {/* a single glowing eye on the side it marches toward */}
      <mesh position={[0, m.r * 0.2, isYou ? -m.r * 0.9 : m.r * 0.9]}>
        <sphereGeometry args={[m.r * 0.2, 8, 8]} />
        <meshBasicMaterial color="#fff" toneMapped={false} />
      </mesh>
      <Billboard position={[0, m.r + 0.4, 0]}>
        <BarMesh frac={m.hp / m.max} w={Math.max(0.5, m.r * 1.6)} color={isYou ? '#5be08a' : '#ff7a6a'} />
      </Billboard>
    </group>
  );
}

function Flashes() {
  const flashes = useLane((s) => s.flashes);
  return flashes.map((f) => <Flash key={f.id} f={f} />);
}

function Flash({ f }) {
  const ref = useRef();
  const born = useRef(performance.now());
  useFrame(() => {
    const e = (performance.now() - born.current) / 600;
    if (ref.current) {
      const s = 0.3 + e * 2.2;
      ref.current.scale.setScalar(s);
      ref.current.material.opacity = Math.max(0, 1 - e);
    }
  });
  const y = f.kind === 'heal' ? 1.2 : 0.6;
  return (
    <mesh ref={ref} position={[0, y, xToZ(f.x)]} rotation={[-Math.PI / 2, 0, 0]}>
      <ringGeometry args={[0.3, 0.5, 24]} />
      <meshBasicMaterial color={f.color} toneMapped={false} transparent opacity={1} side={THREE.DoubleSide} />
    </mesh>
  );
}

// ---- real-time simulation driver ------------------------------------------
function SimDriver() {
  const acc = useRef(0);
  const syncAcc = useRef(0);
  const difficulty = useLane.getState().difficulty;
  useFrame((_, dt) => {
    const m = useLane.getState().match;
    if (!m || m.status !== 'playing') return;
    acc.current += Math.min(dt, 0.1);
    while (acc.current >= STEP) {
      step(m, STEP);
      stepAI(m, STEP, difficulty);
      acc.current -= STEP;
    }
    syncAcc.current += dt;
    if (syncAcc.current >= 1 / 30) { syncAcc.current = 0; useLane.getState().sync(m); }
  });
  return null;
}

// ---- drawing: pointer/touch → recognize → cast -----------------------------
const DRAW_PLANE = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0); // z = 0, in front of you

function recognize(pts2d) {
  let best = { runeId: null, score: 0 };
  for (const runeId of Object.keys(RUNE_SPELL)) {
    const s = scoreAgainst(pts2d, runeId);
    if (s > best.score) best = { runeId, score: s };
  }
  if (!best.runeId || best.score < FIZZLE_THRESHOLD) return null;
  return { spellKey: RUNE_SPELL[best.runeId], score: best.score };
}

function DrawLayer() {
  const { camera, gl } = useThree();
  const draw = useRef({ active: false, proj: null, pts3: [], pts2: [] });
  const [trail, setTrail] = useState({ points: [], color: '#cdebff', opacity: 1 });
  const flash = useRef(null);
  const ray = useRef(new THREE.Raycaster()).current;
  const ndc = useRef(new THREE.Vector2()).current;
  const hit = useRef(new THREE.Vector3()).current;
  const q = useRef(new THREE.Quaternion()).current;

  const planePoint = (e) => {
    const rect = gl.domElement.getBoundingClientRect();
    ndc.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    ndc.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
    ray.setFromCamera(ndc, camera);
    return ray.ray.intersectPlane(DRAW_PLANE, hit) ? hit : null;
  };

  useEffect(() => {
    const el = gl.domElement;
    const down = (e) => {
      if (useLane.getState().status !== 'playing') return;
      const p = planePoint(e); if (!p) return;
      clearTimeout(flash.current);
      camera.getWorldQuaternion(q);
      draw.current = { active: true, proj: new StrokeProjector(q), pts3: [], pts2: [] };
      push(p);
      setTrail({ points: [], color: '#cdebff', opacity: 1 });
      el.setPointerCapture?.(e.pointerId);
    };
    const move = (e) => { if (draw.current.active) { const p = planePoint(e); if (p) push(p); } };
    const up = () => finish();
    el.addEventListener('pointerdown', down);
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
    return () => {
      el.removeEventListener('pointerdown', down);
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
      el.removeEventListener('pointercancel', up);
    };
  }, [gl, camera]); // eslint-disable-line react-hooks/exhaustive-deps

  function push(p) {
    const d = draw.current;
    d.pts3.push([p.x, p.y, p.z]);
    d.pts2.push(d.proj.project(p));
    setTrail((t) => ({ ...t, points: d.pts3.slice() }));
  }

  function finish() {
    const d = draw.current;
    if (!d.active) return;
    d.active = false;
    if (d.pts2.length < 8) { setTrail({ points: [], color: '#cdebff', opacity: 1 }); return; }
    const res = recognize(downsample(d.pts2, 96));
    const meta = res && spellMeta(res.spellKey);
    if (res && meta) {
      useLane.getState().castSpell(res.spellKey, meta.name, meta.color);
    } else {
      useLane.getState().castSpell(null);
    }
    const color = meta ? meta.color : '#7a7a8a';
    setTrail({ points: d.pts3.slice(), color, opacity: 1 });
    let o = 1;
    const fade = () => { o -= 0.1; if (o <= 0) return setTrail({ points: [], color, opacity: 0 }); setTrail((t) => ({ ...t, opacity: o })); flash.current = setTimeout(fade, 40); };
    flash.current = setTimeout(fade, 260);
  }

  return <GlowTrail points={trail.points} color={trail.color} size={0.06} opacity={trail.opacity} />;
}

// ============================================================================
// DOM overlays
function Menu() {
  const name = useLane((s) => s.name);
  const difficulty = useLane((s) => s.difficulty);
  const setName = useLane((s) => s.setName);
  const setDifficulty = useLane((s) => s.setDifficulty);
  const start = useLane((s) => s.start);
  return (
    <div className="overlay">
      <div className="card">
        <h1>RUNE&nbsp;DUEL <span className="vrTag">WAR</span></h1>
        <p className="tag">Draw runes to summon minions and sling spells. March your horde down the lane and smash the enemy crystal before they smash yours.</p>
        <label className="row"><span>Name</span><input value={name} onChange={(e) => setName(e.target.value)} maxLength={16} /></label>
        <div className="deckHead" style={{ marginBottom: 8 }}>Difficulty</div>
        <div className="diff" style={{ marginBottom: 18 }}>
          {['easy', 'normal', 'hard'].map((d) => (
            <button key={d} className={'pill' + (difficulty === d ? ' on' : '')} onClick={() => setDifficulty(d)}>{d}</button>
          ))}
        </div>
        <button className="go" onClick={start}>Enter the War ▶</button>
        <div className="vrLine">Drag with the mouse or draw with your finger. Each rune casts a different spell — see the spellbook in-match.</div>
      </div>
    </div>
  );
}

function LaneHUD() {
  const status = useLane((s) => s.status);
  const towers = useLane((s) => s.towers);
  const mana = useLane((s) => s.mana);
  const castInfo = useLane((s) => s.cast);
  const leave = useLane((s) => s.leave);
  const start = useLane((s) => s.start);
  const manaPct = Math.round((mana.you / 100) * 100);

  return (
    <>
      {/* top: enemy crystal HP */}
      <div className="laneTop">
        <div className="crystalLabel">🔮 Enemy Crystal</div>
        <div className="hpTrack"><div className="hpFill foe" style={{ width: `${(towers.foe.hp / towers.foe.max) * 100}%` }} /></div>
      </div>

      {/* recognized-spell flash */}
      {castInfo && (
        <div className="castFlash" style={{ color: castInfo.ok ? castInfo.color : '#ff7a8a' }} key={castInfo.name + Math.random()}>
          {castInfo.ok ? castInfo.name : (castInfo.reason === 'mana' ? 'Not enough mana' : 'Fizzled!')}
        </div>
      )}

      {/* bottom dock: your crystal, mana, spellbook */}
      <div className="laneDock">
        <button className="bar leave" onClick={leave}>‹ Menu</button>
        <div className="dockBars">
          <div className="miniRow"><span>🏰 Your Crystal</span><div className="hpTrack sm"><div className="hpFill you" style={{ width: `${(towers.you.hp / towers.you.max) * 100}%` }} /></div></div>
          <div className="miniRow"><span>✨ Mana</span><div className="hpTrack sm"><div className="hpFill mana" style={{ width: `${manaPct}%` }} /></div><b>{Math.floor(mana.you)}</b></div>
        </div>
        <Spellbook mana={mana.you} />
      </div>

      {status !== 'playing' && (
        <div className="overlay">
          <div className="card endCard">
            <h1 className={status === 'won' ? 'winTitle' : 'loseTitle'}>{status === 'won' ? '🏆 VICTORY' : '💀 DEFEAT'}</h1>
            <p className="tag">{status === 'won' ? 'Their crystal is shattered. The lane is yours.' : 'Your crystal fell. Regroup and try again.'}</p>
            <button className="go" onClick={start}>⚔️ Rematch</button>
            <button className="go alt" onClick={leave} style={{ marginTop: 8 }}>Back to menu</button>
          </div>
        </div>
      )}
    </>
  );
}

function Spellbook({ mana }) {
  return (
    <div className="spellbook">
      {SPELL_RUNES.map(([runeId, key]) => {
        const meta = spellMeta(key);
        const sp = SPELLS[runeId];
        const affordable = mana >= meta.cost;
        return (
          <div key={runeId} className={'spellChip' + (affordable ? '' : ' broke')} style={{ borderColor: meta.color }}>
            <span className="se" style={{ color: meta.color }}>{sp.emoji}</span>
            <span className="sn">{meta.name}</span>
            <span className="sc">{meta.cost}</span>
          </div>
        );
      })}
    </div>
  );
}
