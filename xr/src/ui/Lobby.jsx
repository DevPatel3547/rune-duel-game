import { useEffect, useState } from 'react';
import { useGame } from '../store.js';

// Where an invite link should point. Inside the native app the page origin is
// capacitor://localhost, which means nothing to a friend, so builds for the
// app set VITE_PUBLIC_URL to the public site.
const SITE = import.meta.env?.VITE_PUBLIC_URL
  || (typeof window !== 'undefined' ? window.location.origin + window.location.pathname : '');

// Shown while an online duel is being set up: searching the quick match queue,
// or holding a private room open until a friend joins. Replaces a status line
// in the corner, which left players staring at an empty arena wondering
// whether anything was happening.
export default function Lobby() {
  const mode = useGame((s) => s.mode);
  const phase = useGame((s) => s.phase);
  if (mode !== 'online') return null;
  if (phase === 'loading') return <RivalFound />;
  if (phase !== 'lobby') return null;
  return <LobbyCard />;
}

// Between being matched and the countdown: both players are loading the arena.
function RivalFound() {
  const name = useGame((s) => s.name);
  const opponentName = useGame((s) => s.opponentName);
  return (
    <div className="lobby">
      <div className="lobbyCard found">
        <div className="foundTag">Rival found</div>
        <div className="versus">
          <span className="vName you">{name}</span>
          <span className="vs">VS</span>
          <span className="vName foe">{opponentName}</span>
        </div>
        <p className="lobbyStatus">Preparing the arena…</p>
      </div>
    </div>
  );
}

function LobbyCard() {
  const status = useGame((s) => s.status);
  const roomCode = useGame((s) => s.roomCode);
  const queue = useGame((s) => s.queue);
  const netError = useGame((s) => s.netError);
  const onlineAction = useGame((s) => s.onlineAction);
  const leave = useGame((s) => s.leave);
  const startOnline = useGame((s) => s.startOnline);
  const startPractice = useGame((s) => s.startPractice);

  const [elapsed, setElapsed] = useState(0);
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    const t0 = Date.now();
    const id = setInterval(() => setElapsed(Math.floor((Date.now() - t0) / 1000)), 1000);
    return () => clearInterval(id);
  }, [roomCode, netError]);

  const share = async () => {
    const url = `${SITE}?room=${roomCode}`;
    const text = `Duel me in Rune Duel — room ${roomCode}`;
    try {
      if (navigator.share) { await navigator.share({ title: 'Rune Duel', text, url }); return; }
      await navigator.clipboard.writeText(`${text}: ${url}`);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch { /* share sheet dismissed */ }
  };

  if (netError) {
    return (
      <div className="lobby">
        <div className="lobbyCard">
          <div className="lobbySigil broken" aria-hidden="true"><Sigil /></div>
          <h2>{netError === 'update_required' ? 'Update available' : 'Can’t reach the arena'}</h2>
          <p className="lobbyStatus">{status}</p>
          <div className="lobbyBtns">
            {netError === 'update_required'
              ? <button className="go" onClick={() => window.location.reload()}>Reload</button>
              : <button className="go" onClick={() => startOnline(onlineAction?.action || 'quick', onlineAction?.code)}>Try again</button>}
            <button className="go alt" onClick={() => startPractice()}>Practice offline</button>
          </div>
          <button className="lobbyCancel" onClick={leave}>Back to menu</button>
        </div>
      </div>
    );
  }

  const clock = `${Math.floor(elapsed / 60)}:${String(elapsed % 60).padStart(2, '0')}`;

  return (
    <div className="lobby">
      <div className="lobbyCard">
        <div className="lobbySigil" aria-hidden="true"><Sigil /></div>

        {roomCode ? (
          <>
            <h2>Your private room</h2>
            <div className="roomCode" aria-label={`Room code ${roomCode.split('').join(' ')}`}>
              {roomCode.split('').map((ch, i) => <span key={i}>{ch}</span>)}
            </div>
            <p className="lobbyStatus">Send this code to a friend. The duel starts the moment they join.</p>
            <div className="lobbyBtns">
              <button className="go" onClick={share}>{copied ? 'Invite copied' : 'Share invite'}</button>
            </div>
          </>
        ) : (
          <>
            <h2>Seeking a rival</h2>
            <p className="lobbyStatus">{status || 'Searching for an opponent…'}</p>
            <div className="lobbyMeta">
              <span className="liveDot" />
              <span>{clock}</span>
              {queue?.others != null && (
                <span>· {queue.others} other wizard{queue.others === 1 ? '' : 's'} online</span>
              )}
            </div>
            {elapsed >= 20 && (
              <div className="lobbyHint">
                <p>The arena is quiet right now. Keep searching, or sharpen your runes against the AI.</p>
                <button className="go alt" onClick={() => startPractice()}>Practice vs AI instead</button>
              </div>
            )}
          </>
        )}

        <button className="lobbyCancel" onClick={leave}>Cancel</button>
      </div>
    </div>
  );
}

// A rotating rune ring — the arena's own casting-circle motif, so the waiting
// screen feels like part of the game rather than a web spinner.
function Sigil() {
  return (
    <svg viewBox="0 0 120 120">
      <circle cx="60" cy="60" r="52" fill="none" stroke="currentColor" strokeWidth="1.2" opacity="0.35" />
      <g className="ringOuter">
        <circle cx="60" cy="60" r="46" fill="none" stroke="currentColor" strokeWidth="2" strokeDasharray="4 9" />
      </g>
      <g className="ringInner">
        <polygon points="60,22 93,79 27,79" fill="none" stroke="currentColor" strokeWidth="1.6" opacity="0.8" />
        <polygon points="60,98 27,41 93,41" fill="none" stroke="currentColor" strokeWidth="1.6" opacity="0.55" />
      </g>
      <circle className="core" cx="60" cy="60" r="7" fill="currentColor" />
    </svg>
  );
}
