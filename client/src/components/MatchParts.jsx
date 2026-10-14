import { useEffect, useState } from 'react';
import { SPELLS } from '@rune/shared';
import RunePreview from './RunePreview.jsx';

export function HPBars({ youName, oppName, youHp, oppHp }) {
  return (
    <div className="hp-row">
      <div className="hp-bar-wrap">
        <span className="hp-name">{oppName}</span>
        <div className="hp-track"><div className="hp-fill opp" style={{ width: `${oppHp}%` }} /></div>
        <span className="hp-num">{oppHp}</span>
      </div>
      <div className="hp-bar-wrap">
        <span className="hp-name">{youName}</span>
        <div className="hp-track"><div className="hp-fill you" style={{ width: `${youHp}%` }} /></div>
        <span className="hp-num">{youHp}</span>
      </div>
    </div>
  );
}

export function StatusChips({ status }) {
  if (!status) return <div className="status-chips" />;
  return (
    <div className="status-chips">
      {status.slowed && <span className="chip warn">🌀 Slowed</span>}
      {status.shaken && <span className="chip warn">🌋 Shaking</span>}
      {status.drained && <span className="chip warn">🌙 Drained</span>}
      {status.surge && <span className="chip good">🔺 Surging ×2</span>}
      {status.anchor > 0 && <span className="chip good">⚓ Anchored ({status.anchor})</span>}
    </div>
  );
}

export function RoundTimer({ deadline, totalMs }) {
  const [pct, setPct] = useState(100);
  useEffect(() => {
    const tick = () => {
      const left = Math.max(0, deadline - Date.now());
      setPct((left / totalMs) * 100);
    };
    tick();
    const id = setInterval(tick, 150);
    return () => clearInterval(id);
  }, [deadline, totalMs]);
  return (
    <div className="timer-track">
      <div className={`timer-fill${pct < 30 ? ' urgent' : ''}`} style={{ width: `${pct}%` }} />
    </div>
  );
}

export function PickPhase({ options, onPick }) {
  return (
    <>
      <div className="spell-banner">
        <div className="name">Choose your spell</div>
        <div className="hint">then draw its rune — fast and clean</div>
      </div>
      <div className="pick-row">
        {options.map((id) => (
          <button key={id} className="pick-card" onClick={() => onPick(id)}>
            <span className="emoji">{SPELLS[id].emoji}</span>
            <span className="name" style={{ color: SPELLS[id].color }}>{SPELLS[id].name}</span>
            <div className="meta">
              {SPELLS[id].baseDamage > 0 ? `${SPELLS[id].baseDamage} dmg` : 'no dmg'} · {SPELLS[id].targetTime}s
            </div>
            <div style={{ display: 'flex', justifyContent: 'center', marginTop: 6 }}>
              <RunePreview spellId={id} size={44} />
            </div>
          </button>
        ))}
      </div>
    </>
  );
}

export function SpellBanner({ spellId }) {
  const s = SPELLS[spellId];
  return (
    <div className="spell-banner">
      <div className="name" style={{ color: s.color }}>{s.emoji} {s.name}</div>
      <div className="hint">{s.desc}</div>
    </div>
  );
}

export function ResolveOverlay({ youCast, oppCast, damage, heal, log, youName, oppName }) {
  const fmt = (cast) => cast.spell
    ? { emoji: SPELLS[cast.spell].emoji, name: SPELLS[cast.spell].name, color: SPELLS[cast.spell].color, pow: `${Math.round(cast.power * 100)}% power` }
    : { emoji: '💨', name: 'Fizzled', color: '#8a96b8', pow: '—' };
  const you = fmt(youCast);
  const opp = fmt(oppCast);
  return (
    <div className="resolve-overlay">
      <div className="clash">
        <div className="cast" style={{ color: you.color }}>
          <span className="emoji">{you.emoji}</span>
          <div className="label">{you.name}</div>
          <div className="pow">{you.pow}</div>
          <div className="pow">{youName}</div>
        </div>
        <div className="vs">VS</div>
        <div className="cast" style={{ color: opp.color, animationDelay: '0.12s' }}>
          <span className="emoji">{opp.emoji}</span>
          <div className="label">{opp.name}</div>
          <div className="pow">{opp.pow}</div>
          <div className="pow">{oppName}</div>
        </div>
      </div>
      <div style={{ display: 'flex', gap: 40 }}>
        {damage.you > 0 && <span className="dmg-float hurt">-{damage.you} you</span>}
        {heal.you > 0 && <span className="dmg-float healed">+{heal.you} you</span>}
        {damage.opponent > 0 && <span className="dmg-float hurt">-{damage.opponent} them</span>}
        {heal.opponent > 0 && <span className="dmg-float healed">+{heal.opponent} them</span>}
      </div>
      <div className="resolve-log">
        {log.map((line, i) => <p key={i} style={{ animationDelay: `${0.3 + i * 0.25}s` }}>{line}</p>)}
      </div>
    </div>
  );
}

export function Flash({ color }) {
  return <div className="flash" style={{ background: color }} />;
}
