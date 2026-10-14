import { useEffect } from 'react';
import { useXR } from '@react-three/xr';
import { useGame } from '../store.js';
import Arena from './Arena.jsx';
import OpponentAvatar from './OpponentAvatar.jsx';
import SpellFX from './SpellFX.jsx';
import Summons from './Summons.jsx';
import Domain from './Domain.jsx';
import HUD from './HUD.jsx';
import VRHands from '../draw/VRHands.jsx';
import DesktopCaster from '../draw/DesktopCaster.jsx';
import Effects from './Effects.jsx';
import CameraRig from './CameraRig.jsx';
import ReadyProbe from './ReadyProbe.jsx';
import Wards from './Wards.jsx';

// Everything that lives inside the WebXR <Canvas>. Switches the casting input
// between real VR controllers/hands and the desktop mouse based on the session.
export default function SceneRoot() {
  const session = useXR((s) => s.session);
  const inVR = !!session;
  const screen = useGame((s) => s.screen);
  const setInVR = useGame((s) => s.setInVR);

  useEffect(() => { setInVR(inVR); }, [inVR, setInVR]);

  return (
    <>
      <Arena />
      {/* mounted on the menu too, so the idle sway is there before a duel starts */}
      <CameraRig />
      {screen === 'game' && (
        <>
          <OpponentAvatar />
          <SpellFX />
          <Wards />
          <Summons />
          <Domain />
          <HUD />
          {inVR ? <VRHands /> : <DesktopCaster />}
          <ReadyProbe />
        </>
      )}
      <Effects />
    </>
  );
}
