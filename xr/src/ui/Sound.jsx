import { useEffect, useRef } from 'react';
import { useGame } from '../store.js';
import { isProjectile } from '@rune/shared';
import * as sfx from '../audio.js';

// Non-visual: turns store changes into SFX. Cast/impact sounds for projectiles
// live in SpellFX (so both players' spells are covered); here we handle the
// feedback that doesn't fly — self-buffs, fizzles, no-mana, and the
// begin/victory/defeat stings — plus unlocking audio on the first gesture.
export default function Sound() {
  const lastMatch = useGame((s) => s.lastMatch);
  const outcome = useGame((s) => s.outcome);
  const phase = useGame((s) => s.phase);
  const prevPhase = useRef(phase);

  useEffect(() => {
    const unlock = () => sfx.unlockAudio();
    window.addEventListener('pointerdown', unlock);
    window.addEventListener('keydown', unlock);
    return () => { window.removeEventListener('pointerdown', unlock); window.removeEventListener('keydown', unlock); };
  }, []);

  useEffect(() => {
    if (!lastMatch) return;
    if (lastMatch.fizzled) sfx.fizzle();
    else if (lastMatch.blocked === 'mana') sfx.lowMana();
    else if (lastMatch.blocked === 'cooldown') sfx.blip();
    else if (lastMatch.spellId && !isProjectile(lastMatch.spellId)) sfx.buff(); // shield/reflect/surge
  }, [lastMatch]);

  useEffect(() => {
    if (phase === 'live' && prevPhase.current !== 'live') sfx.begin();
    prevPhase.current = phase;
  }, [phase]);

  useEffect(() => {
    if (!outcome) return;
    if (outcome.draw) sfx.blip();
    else if (outcome.won) sfx.win();
    else sfx.lose();
  }, [outcome]);

  return null;
}
