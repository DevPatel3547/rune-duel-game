import { storage } from '../game/storage.js';

export default function Home({ onNavigate }) {
  return (
    <div className="screen">
      <h1 className="title">⚡ RUNE DUEL</h1>
      <p className="tagline">Draw runes. Cast spells. Out-draw your rival.</p>
      <div className="menu">
        <button className="btn primary" onClick={() => onNavigate('war')}>⚔️ War of Wizards</button>
        <button className="btn" onClick={() => onNavigate('online')}>🌐 Online Duel</button>
        <button className="btn" onClick={() => onNavigate('ai')}>🤖 VS the Machine</button>
        <button className="btn" onClick={() => onNavigate('local')}>📱 Pass & Play</button>
        <button className="btn" onClick={() => onNavigate('training')}>✍️ Rune Training</button>
        <button className="btn ghost" onClick={() => onNavigate('deck')}>🃏 Edit Deck</button>
        <button className="btn ghost" onClick={() => onNavigate('howto')}>❓ How to Play</button>
        <label className="muted" style={{ display: 'flex', gap: 8, justifyContent: 'center', cursor: 'pointer' }}>
          <input
            type="checkbox"
            defaultChecked={storage.showGuide}
            onChange={(e) => { storage.showGuide = e.target.checked; }}
          />
          Show rune guide while drawing
        </label>
      </div>
    </div>
  );
}
