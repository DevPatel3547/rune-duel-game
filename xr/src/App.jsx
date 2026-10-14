import { useMemo, useState } from 'react';
import { Canvas } from '@react-three/fiber';
import { PerformanceMonitor } from '@react-three/drei';
import { XR, createXRStore } from '@react-three/xr';
import * as THREE from 'three';
import SceneRoot from './scene/SceneRoot.jsx';
import Menu from './ui/Menu.jsx';
import { HEAD_HEIGHT, OPP_DIST, BASE_FOV } from './config.js';
import { Q } from './perf.js';

export default function App() {
  // One XR store for the whole app; the DOM "Enter VR" button calls enterVR().
  const store = useMemo(() => createXRStore({
    // we render our own glowing wands, so hide the default controller rays/models
    controller: { rayPointer: { rayModel: false }, model: false },
    hand: { rayPointer: { rayModel: false }, model: false },
    foveation: 0.5,
    // No emulated headset. On localhost the library otherwise injects an
    // "Enter XR" pill, which then shows up in every test capture and store
    // screenshot while never existing on a real phone. A real headset still
    // offers VR through the menu.
    emulate: false,
  }), []);

  // Render resolution adapts to how the device is actually coping, between the
  // tier's floor and ceiling. The tier is a guess made once at boot; a phone
  // that heats up and throttles mid-duel should get softer, not stutter.
  // Never above the screen's own pixel density: past that is invisible work.
  const [dpr, setDpr] = useState(() => pixelRatio(0.5));

  return (
    <>
      <Canvas
        dpr={dpr}
        // PCFSoft: percentage-closer filtering with a wider kernel. Hard
        // shadow edges are one of the loudest "this is a tech demo" tells.
        shadows={Q.shadows ? { type: THREE.PCFSoftShadowMap } : false}
        gl={{
          antialias: Q.aa,
          powerPreference: 'high-performance',
          toneMapping: THREE.ACESFilmicToneMapping,
          // The scene is lit for a filmic curve now (strong key + hard cold rim
          // against deep shadow), so exposure sits at 1.0 and the highlights are
          // allowed to roll off rather than being lifted in software.
          toneMappingExposure: 1.0,
        }}
        // near is deliberately not tiny: the arena is full of near-coplanar
        // floor decals (rune circle, inlay band, stance rings) and a 0.05 near
        // plane spends most of the depth buffer's precision on the first few
        // centimetres, which speckles the floor with z-fighting at grazing
        // angles. Nothing ever gets closer than ~0.3 m to the eye here.
        camera={{ position: [0, HEAD_HEIGHT, 0.4], fov: BASE_FOV, near: 0.2, far: 260 }}
        onCreated={(state) => {
          const { camera } = state;
          // Dev-only handle on the renderer/scene/camera. The visual QA harnesses
          // (test/shots.mjs, test/closeup.mjs) use this to reposition the camera
          // and inspect the scene graph; r3f's own internals are not a stable
          // public surface to reach into from outside.
          if (import.meta.env?.DEV && typeof window !== 'undefined') window.__three = state;
          // R3F aims the default camera at the world origin; for desktop we want
          // to look horizontally across the arena at the opponent. (In VR the
          // headset drives the camera, so this initial pose is just a fallback.)
          camera.position.set(0, HEAD_HEIGHT, 0.4);
          camera.lookAt(0, 1.15, -OPP_DIST);
          camera.updateMatrixWorld();
        }}
      >
        <PerformanceMonitor
          bounds={(refresh) => (refresh > 90 ? [55, 90] : [45, 58])}
          flipflops={4}
          onChange={({ factor }) => setDpr(pixelRatio(factor))}
          onFallback={() => setDpr(pixelRatio(0))}
        />
        <XR store={store}>
          <SceneRoot />
        </XR>
      </Canvas>
      <Menu store={store} />
    </>
  );
}

// factor 0..1 across the tier's dpr range, capped at the screen's density.
function pixelRatio(factor) {
  const [lo, hi] = Q.dpr;
  const screen = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;
  return Math.round(Math.min(screen, lo + (hi - lo) * factor) * 10) / 10;
}
