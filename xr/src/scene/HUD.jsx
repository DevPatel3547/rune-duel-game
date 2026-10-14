import { Text, Billboard } from '@react-three/drei';
import { useGame } from '../store.js';

// The in-world HUD is now just the dramatic intro banner. Everything readable —
// both fighters' HP, your mana, spellbook, cast feedback, and the end screen —
// lives in the responsive DOM overlay (`ui/GameHUD.jsx`), so it scales cleanly
// to any screen and never crowds the 3D view.
export default function HUD() {
  return <StatusText />;
}

function StatusText() {
  const phase = useGame((s) => s.phase);
  let msg = '';
  let color = '#cdebff';
  // The countdown itself is the DOM 3-2-1 in GameHUD.
  if (phase === 'lobby' || phase === 'idle') msg = 'Waiting…';
  if (!msg) return null;
  return (
    <Billboard position={[0, 2.0, -2.6]}>
      <Text fontSize={0.22} color={color} outlineWidth={0.01} outlineColor="#000" anchorX="center">
        {msg}
      </Text>
    </Billboard>
  );
}
