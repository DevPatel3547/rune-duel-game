import { useEffect, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { useGame } from '../store.js';

// Reports when the duel scene is actually ready to play: everything mounted
// (the wizard model suspends until it has loaded, which holds this back too)
// and a couple of frames rendered, so every material's shader has compiled.
//
// Entering the arena compiles every shader at once. On a phone that can take
// seconds, and a countdown started before it finished would eat the opening of
// the duel. Both drivers wait for this flag before counting down.
export default function ReadyProbe() {
  const { gl, scene, camera } = useThree();
  const frames = useRef(0);

  useEffect(() => {
    // Compile up front rather than letting it happen piecemeal on the first
    // frames of the fight.
    try { gl.compile(scene, camera); } catch { /* the render will compile instead */ }
    return () => useGame.getState().set({ sceneReady: false });
  }, [gl, scene, camera]);

  useFrame(() => {
    if (frames.current >= 2) return;
    frames.current += 1;
    if (frames.current === 2) useGame.getState().set({ sceneReady: true });
  });

  return null;
}
