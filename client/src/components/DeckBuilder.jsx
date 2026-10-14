import { useState } from 'react';
import { SPELLS, SPELL_IDS, DECK_SIZE, STARTER_DECK } from '@rune/shared';
import { storage } from '../game/storage.js';
import { sfx } from '../audio/sfx.js';
import RunePreview from './RunePreview.jsx';

export default function DeckBuilder({ onDone, onExit }) {
  const [deck, setDeck] = useState(() => storage.deck || STARTER_DECK);

  const toggle = (id) => {
    sfx.pick();
    setDeck((d) => {
      if (d.includes(id)) return d.filter((s) => s !== id);
      if (d.length >= DECK_SIZE) return d;
      return [...d, id];
    });
  };

  const save = () => {
    storage.deck = deck;
    onDone ? onDone(deck) : onExit();
  };

  return (
    <div className="screen">
      <div className="back-row">
        <button className="btn small ghost" onClick={onExit}>← Back</button>
        <h2>Build your deck — pick {DECK_SIZE}</h2>
      </div>
      <div className="spell-grid">
        {SPELL_IDS.map((id) => {
          const s = SPELLS[id];
          return (
            <div
              key={id}
              className={`spell-card${deck.includes(id) ? ' selected' : ''}`}
              onClick={() => toggle(id)}
            >
              <RunePreview spellId={id} />
              <div className="head">
                <span style={{ fontSize: '1.3rem' }}>{s.emoji}</span>
                <span className="name" style={{ color: s.color }}>{s.name}</span>
              </div>
              <div className="stats">
                <span>{s.baseDamage > 0 ? `⚔ ${s.baseDamage}` : '—'}</span>
                <span>⏱ {s.targetTime}s</span>
              </div>
              <div className="desc">{s.desc}</div>
              <div className="desc" style={{ marginTop: 3, opacity: 0.75 }}>↳ {s.counter}</div>
            </div>
          );
        })}
      </div>
      <div className="deck-bar">
        <div className="deck-slots">
          {Array.from({ length: DECK_SIZE }, (_, i) => (
            <div key={i} className="deck-slot">{deck[i] ? SPELLS[deck[i]].emoji : ''}</div>
          ))}
        </div>
        <button className="btn primary small" disabled={deck.length !== DECK_SIZE} onClick={save}>
          {deck.length === DECK_SIZE ? '✓ Save deck' : `${deck.length}/${DECK_SIZE}`}
        </button>
      </div>
    </div>
  );
}
