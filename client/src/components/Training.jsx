import { useState } from 'react';
import { SPELLS, SPELL_IDS, scoreAgainst, computePower, FIZZLE_THRESHOLD } from '@rune/shared';
import { storage } from '../game/storage.js';
import { sfx, buzz } from '../audio/sfx.js';
import DrawCanvas from './DrawCanvas.jsx';
import { SpellBanner } from './MatchParts.jsx';

// Practice room: draw a rune over and over, get scored, chase your best.
export default function Training({ onExit }) {
  const [spellId, setSpellId] = useState('bolt');
  const [last, setLast] = useState(null);
  const [ghost, setGhost] = useState(true);
  const [drawKey, setDrawKey] = useState(0); // bump to clear canvas

  const onComplete = (points, time) => {
    const accuracy = scoreAgainst(points, spellId);
    const fizzled = accuracy < FIZZLE_THRESHOLD;
    const power = fizzled ? 0 : computePower(accuracy, time, spellId);
    const acc = Math.round(accuracy * 100);
    if (fizzled) { sfx.fizzle(); buzz(80); }
    else if (acc >= 95) { sfx.win(); buzz(40); }
    else { sfx.recognize(); buzz(20); }
    storage.setBest(spellId, acc);
    setLast({ acc, time: time.toFixed(2), power: Math.round(power * 100), fizzled });
    setTimeout(() => setDrawKey((k) => k + 1), 900);
  };

  return (
    <div className="screen">
      <div className="match">
        <div className="back-row">
          <button className="btn small ghost" onClick={onExit}>← Back</button>
          <h2>Rune Training</h2>
          <button className="btn small ghost" onClick={() => setGhost((g) => !g)}>
            {ghost ? '👁 Guide on' : '👁 Guide off'}
          </button>
        </div>

        <div className="rune-scroller">
          {SPELL_IDS.map((id) => (
            <button
              key={id}
              className={`rune-chip${id === spellId ? ' active' : ''}`}
              onClick={() => { setSpellId(id); setLast(null); setDrawKey((k) => k + 1); }}
            >
              {SPELLS[id].emoji} {SPELLS[id].name}
            </button>
          ))}
        </div>

        <SpellBanner spellId={spellId} />

        <div className="training-stats">
          <div className="stat">
            <div className="num" style={{ color: last?.fizzled ? 'var(--hp-opp)' : 'var(--text)' }}>
              {last ? `${last.acc}%` : '—'}
            </div>
            <div className="lbl">accuracy</div>
          </div>
          <div className="stat">
            <div className="num">{last ? `${last.time}s` : '—'}</div>
            <div className="lbl">draw time</div>
          </div>
          <div className="stat">
            <div className="num" style={{ color: 'var(--gold)' }}>{last ? `${last.power}` : '—'}</div>
            <div className="lbl">power</div>
          </div>
          <div className="stat">
            <div className="num">{storage.bestFor(spellId) || '—'}</div>
            <div className="lbl">best acc</div>
          </div>
        </div>

        <DrawCanvas
          key={`${spellId}-${drawKey}`}
          spellId={spellId}
          ghost={ghost}
          shaking={false}
          disabled={false}
          onComplete={onComplete}
        />
      </div>
    </div>
  );
}
