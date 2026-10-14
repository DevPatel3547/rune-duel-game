import { useRef, useState, useEffect } from 'react';
import { MAX_HP, blankStatus } from '@rune/shared';
import { sfx, buzz } from '../audio/sfx.js';
import { storage } from '../game/storage.js';
import { compressPoints } from '../socket/client.js';
import DrawCanvas from './DrawCanvas.jsx';
import { HPBars, StatusChips, RoundTimer, PickPhase, SpellBanner, ResolveOverlay } from './MatchParts.jsx';

// Online match: the server is authoritative — this component just renders
// server events and sends the player's stroke up for scoring.
export default function OnlineMatch({ socket, you, opponent, onExit }) {
  const G = useRef({
    phase: 'starting', // starting | pick | draw | waiting | resolve | end
    round: 0,
    hp: { you: MAX_HP, opponent: MAX_HP },
    status: { you: blankStatus(), opponent: blankStatus() },
    options: [],
    selected: null,
    deadline: 0,
    timeoutMs: 15000,
    resolveData: null,
    result: null, // { won, draw }
    oppLeft: false,
    oppWantsRematch: false,
    sentRematch: false,
  });
  const [, setTick] = useState(0);
  const rerender = () => setTick((t) => t + 1);

  useEffect(() => {
    const g = G.current;

    const onRoundStart = (data) => {
      g.phase = 'pick';
      g.round = data.round;
      g.options = data.options;
      g.selected = null;
      g.resolveData = null;
      g.hp = data.hp;
      g.status = data.status;
      g.deadline = Date.now() + data.timeoutMs;
      g.timeoutMs = data.timeoutMs;
      rerender();
    };

    const onRoundResult = (data) => {
      g.phase = 'resolve';
      g.hp = data.hp;
      g.resolveData = {
        youCast: data.you, oppCast: data.opponent,
        damage: data.damage, heal: data.heal, log: data.log,
      };
      if (data.you.spell) sfx.cast(data.you.spell); else sfx.fizzle();
      if (data.opponent.spell) setTimeout(() => sfx.cast(data.opponent.spell), 180);
      if (data.damage.you > 0 || data.damage.opponent > 0) setTimeout(() => { sfx.hit(); buzz(60); }, 450);
      if (data.heal.you > 0 || data.heal.opponent > 0) setTimeout(() => sfx.heal(), 700);
      rerender();
    };

    const onGameOver = (data) => {
      g.phase = 'end';
      g.result = data;
      storage.bumpMatches();
      (data.won ? sfx.win : sfx.lose)();
      rerender();
    };

    const onMatchStart = () => {
      // rematch accepted — server restarts rounds
      g.phase = 'starting';
      g.sentRematch = false;
      g.oppWantsRematch = false;
      g.hp = { you: MAX_HP, opponent: MAX_HP };
      rerender();
    };

    const onOppLeft = () => { g.oppLeft = true; g.phase = 'end'; rerender(); };
    const onOppRematch = () => { g.oppWantsRematch = true; rerender(); };

    socket.on('round_start', onRoundStart);
    socket.on('round_result', onRoundResult);
    socket.on('game_over', onGameOver);
    socket.on('match_start', onMatchStart);
    socket.on('opponent_left', onOppLeft);
    socket.on('opponent_rematch', onOppRematch);
    return () => {
      socket.off('round_start', onRoundStart);
      socket.off('round_result', onRoundResult);
      socket.off('game_over', onGameOver);
      socket.off('match_start', onMatchStart);
      socket.off('opponent_left', onOppLeft);
      socket.off('opponent_rematch', onOppRematch);
    };
  }, [socket]);

  const onPick = (id) => {
    G.current.selected = id;
    G.current.phase = 'draw';
    sfx.pick();
    rerender();
  };

  const onDrawComplete = (points, time) => {
    const g = G.current;
    socket.emit('submit_draw', {
      spellId: g.selected,
      points: compressPoints(points),
      drawTime: time,
    });
    sfx.recognize(); buzz(25);
    g.phase = 'waiting';
    rerender();
  };

  const g = G.current;

  return (
    <div className="screen">
      <div className="match">
        <div className="back-row">
          <button className="btn small ghost" onClick={onExit}>✕ Quit</button>
          <h2 style={{ textAlign: 'center' }}>{g.round > 0 ? `Round ${g.round}` : 'Rune Duel'}</h2>
          <span style={{ width: 60 }} />
        </div>

        <HPBars youName={you.name} oppName={opponent.name} youHp={g.hp.you} oppHp={g.hp.opponent} />
        <StatusChips status={g.status.you} />

        {(g.phase === 'pick' || g.phase === 'draw') && (
          <RoundTimer deadline={g.deadline} totalMs={g.timeoutMs} />
        )}

        {g.phase === 'starting' && (
          <p className="muted waiting-pulse" style={{ marginTop: '30vh' }}>
            Dueling {opponent.name} — get ready…
          </p>
        )}

        {g.phase === 'pick' && <PickPhase options={g.options} onPick={onPick} />}

        {g.phase === 'draw' && (
          <>
            <SpellBanner spellId={g.selected} />
            <DrawCanvas
              spellId={g.selected}
              ghost={storage.showGuide}
              shaking={g.status.you.shaken}
              disabled={false}
              onComplete={onDrawComplete}
            />
          </>
        )}

        {g.phase === 'waiting' && (
          <div style={{ flex: 1, display: 'grid', placeItems: 'center' }}>
            <p className="muted waiting-pulse">Spell locked in — waiting for {opponent.name}…</p>
          </div>
        )}

        {g.phase === 'resolve' && g.resolveData && (
          <ResolveOverlay {...g.resolveData} youName="You" oppName={opponent.name} />
        )}

        {g.phase === 'end' && (
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', gap: 14 }}>
            {g.oppLeft ? (
              <>
                <div className="end-title">🚪</div>
                <p className="muted">{opponent.name} left the duel.</p>
              </>
            ) : (
              <>
                <div className={`end-title ${g.result?.won ? 'win' : g.result?.draw ? '' : 'lose'}`}>
                  {g.result?.won ? '🏆 VICTORY' : g.result?.draw ? '🤝 DRAW' : '💀 DEFEAT'}
                </div>
                <p className="muted">You {g.hp.you} HP — {opponent.name} {g.hp.opponent} HP</p>
                {g.oppWantsRematch && <p className="muted waiting-pulse">{opponent.name} wants a rematch!</p>}
                <button
                  className="btn primary" style={{ maxWidth: 260 }}
                  disabled={g.sentRematch}
                  onClick={() => { g.sentRematch = true; socket.emit('rematch'); rerender(); }}
                >
                  {g.sentRematch ? 'Waiting for opponent…' : '⚔️ Rematch'}
                </button>
              </>
            )}
            <button className="btn ghost" style={{ maxWidth: 260 }} onClick={onExit}>Back to menu</button>
          </div>
        )}
      </div>
    </div>
  );
}
