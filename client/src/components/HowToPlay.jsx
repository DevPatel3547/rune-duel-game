import { SPELLS, SPELL_IDS } from '@rune/shared';
import RunePreview from './RunePreview.jsx';

export default function HowToPlay({ onExit }) {
  return (
    <div className="screen">
      <div className="back-row">
        <button className="btn small ghost" onClick={onExit}>← Back</button>
        <h2>How to Play</h2>
      </div>
      <div className="howto">
        <h3>The duel</h3>
        <p>
          Both players cast at the same time, every round. Pick one of the two spells
          offered from your deck, then <b>draw its rune in one stroke</b>. Lift your
          finger and it's locked in. When both spells are in, they clash.
        </p>

        <h3>Power = how well you draw</h3>
        <p>
          Your draw is scored on <b>accuracy (60%)</b> and <b>speed (40%)</b>. A perfect
          fast draw hits for full damage. A sloppy scrawl <b>fizzles</b> — you cast
          nothing and eat the hit. You choose how much to rush. That's the whole game.
        </p>

        <h3>The counter web</h3>
        <p>
          <b>Shield</b> blocks damage — but <b>Pierce</b> goes straight through it.
          <b> Reflect</b> bounces spells back — but <b>Void</b> strips it bare.
          <b> Quake</b> ruins a <b>Nova</b>. <b>Anchor</b> shrugs off slows and shakes.
          Read your opponent's deck before the match and plan around it.
        </p>

        <h3>The 12 runes</h3>
        {SPELL_IDS.map((id) => {
          const s = SPELLS[id];
          return (
            <p key={id} style={{ display: 'flex', alignItems: 'center', gap: 10, margin: '8px 0' }}>
              <RunePreview spellId={id} size={40} />
              <span><b style={{ color: s.color }}>{s.emoji} {s.name}</b> — {s.desc}</span>
            </p>
          );
        })}

        <h3>Tips</h3>
        <p>
          The yellow dot on each rune shows where the stroke <b>starts</b> — direction
          matters. Warm up in Rune Training before going online. And never draw a Nova
          when your opponent is holding a Quake.
        </p>
      </div>
    </div>
  );
}
