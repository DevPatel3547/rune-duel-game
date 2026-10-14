import { useEffect, useMemo, useState } from 'react';
import { useGame } from '../store.js';
import { SPELL_IDS, SPELLS, TEMPLATES } from '@rune/shared';
import GameHUD from './GameHUD.jsx';
import Lobby from './Lobby.jsx';
import InstallPrompt from './InstallPrompt.jsx';
import AccountPanel from './AccountPanel.jsx';
import Sound from './Sound.jsx';
import { setMuted, isMuted } from '../audio.js';
import { ONLINE_AVAILABLE, SERVER_URL } from '../net.js';
import { TIER, setTier } from '../perf.js';

export default function Menu({ store }) {
  const screen = useGame((s) => s.screen);
  const [vrSupported, setVrSupported] = useState(false);

  useEffect(() => {
    let alive = true;
    navigator.xr?.isSessionSupported?.('immersive-vr').then((ok) => { if (alive) setVrSupported(!!ok); }).catch(() => {});
    return () => { alive = false; };
  }, []);

  const enterVR = async () => {
    try { await store.enterVR(); } catch (e) { useGame.getState().set({ status: 'Could not enter VR: ' + e.message }); }
  };

  return (
    <>
      <Sound />
      {screen === 'game'
        ? <><GameBar enterVR={enterVR} vrSupported={vrSupported} /><GameHUD /><Lobby /></>
        : <MainMenu enterVR={enterVR} vrSupported={vrSupported} />}
    </>
  );
}

// How many players the match server currently has. Polled only while the menu
// is open; a quiet failure just hides the line.
function useOnlineCount() {
  const [count, setCount] = useState(null);
  useEffect(() => {
    // Only against a configured server. In local development the page's own
    // origin proxies to a match server that may not be running.
    if (!SERVER_URL) return undefined;
    let alive = true;
    const poll = async () => {
      try {
        const r = await fetch(`${SERVER_URL}/health`, { cache: 'no-store' });
        const j = await r.json();
        if (alive) setCount(typeof j.online === 'number' ? j.online : null);
      } catch {
        if (alive) setCount(null);
      }
    };
    poll();
    const id = setInterval(poll, 15000);
    return () => { alive = false; clearInterval(id); };
  }, []);
  return count;
}

// An invite link (?room=ABC123) prefills the join box.
function inviteCode() {
  try {
    const code = new URLSearchParams(window.location.search).get('room');
    return code && /^[A-Za-z2-9]{6}$/.test(code) ? code.toUpperCase() : '';
  } catch {
    return '';
  }
}

function MainMenu({ vrSupported }) {
  const name = useGame((s) => s.name);
  const deck = useGame((s) => s.deck);
  const difficulty = useGame((s) => s.difficulty);
  const status = useGame((s) => s.status);
  const setName = useGame((s) => s.setName);
  const setDifficulty = useGame((s) => s.setDifficulty);
  const toggleDeck = useGame((s) => s.toggleDeck);
  const startPractice = useGame((s) => s.startPractice);
  const startOnline = useGame((s) => s.startOnline);
  const [code, setCode] = useState(inviteCode);
  const online = useOnlineCount();
  const invited = useMemo(() => !!inviteCode(), []);

  return (
    <div className="overlay">
      <div className="card">
        <div className="brand">
          <h1>RUNE&nbsp;DUEL</h1>
          <div className="brandRule" />
          <p className="tag">
            Draw runes to cast spells. Out-duel a rival sorcerer across the arena —
            live, on your phone or computer.
          </p>
        </div>

        <label className="row">
          <span>Name</span>
          <input value={name} onChange={(e) => setName(e.target.value)} maxLength={16} />
        </label>

        <div className="deck">
          <div className="sectionHead">Your spellbook <em>{deck.length}/5</em></div>
          <div className="chips">
            {SPELL_IDS.map((id) => (
              <button
                key={id}
                className={'chip' + (deck.includes(id) ? ' on' : '')}
                style={deck.includes(id) ? { borderColor: SPELLS[id].color, color: SPELLS[id].color } : {}}
                onClick={() => toggleDeck(id)}
                title={`${SPELLS[id].name} — ${SPELLS[id].desc}`}
              >
                {/* the actual rune, so the picker teaches the shape you'll trace */}
                <RuneGlyph id={id} />
                {SPELLS[id].name}
              </button>
            ))}
          </div>
        </div>

        <div className="modes">
          <div className={'mode online' + (ONLINE_AVAILABLE ? '' : ' off') + (invited ? ' invited' : '')}>
            <h3>Online Duel</h3>
            {ONLINE_AVAILABLE ? (
              <>
                <p>Get matched with a live opponent, or challenge a friend with a room code.</p>
                {/* "0 online" on an empty server only tells a new player to leave */}
                {online > 0 && (
                  <div className="onlineCount"><span className="liveDot" />{online} wizard{online === 1 ? '' : 's'} online</div>
                )}
                <button className="go" onClick={() => startOnline('quick')}>Quick Match</button>
                <div className="orLine"><span>or duel a friend</span></div>
                <button className="go alt" onClick={() => startOnline('create')}>Create a room</button>
                <div className="joinRow">
                  <input
                    placeholder="CODE" value={code} aria-label="Room code"
                    onChange={(e) => setCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''))}
                    maxLength={6}
                  />
                  <button className="go alt" disabled={code.length !== 6} onClick={() => startOnline('join', code)}>Join</button>
                </div>
              </>
            ) : (
              // Better to say so than to show a button that hangs forever on a
              // connection to a server this build was never given.
              <>
                <p>Live duels need a match server, which this build isn't connected to yet.</p>
                <div className="soon">Coming soon</div>
              </>
            )}
          </div>

          <div className="mode">
            <h3>Practice</h3>
            <p>Duel an AI sorcerer. Works offline. Drag or touch to draw your rune.</p>
            <div className="diff">
              {['easy', 'normal', 'hard'].map((d) => (
                <button key={d} className={'pill' + (difficulty === d ? ' on' : '')} onClick={() => setDifficulty(d)}>{d}</button>
              ))}
            </div>
            <button className="go" onClick={() => startPractice()}>Enter the Arena</button>
          </div>
        </div>

        <div className="quality">
          <div className="sectionHead">Graphics</div>
          <div className="diff">
            {[
              ['low', 'Low', 'Fastest — no shadows, effects or reflections'],
              ['mid', 'Medium', 'Shadows and lighting effects'],
              ['high', 'High', 'Adds reflections and sharper ambient occlusion'],
            ].map(([id, label, hint]) => (
              <button
                key={id}
                className={'pill' + (TIER === id ? ' on' : '')}
                onClick={() => setTier(id)}
                title={hint}
              >
                {label}
              </button>
            ))}
          </div>
          <p className="qualityHint">
            Detected <b>{TIER}</b> for this device. Drop it if the duel stutters.
          </p>
        </div>

        {status ? <div className="status">{status}</div> : null}

        <AccountPanel />

        <InstallPrompt />

        <div className="vrLine">
          {vrSupported
            ? <span>🥽 VR headset detected (optional) — pick a mode, then tap <b>Enter VR</b>. Otherwise just play on screen.</span>
            : <span>Drag with the mouse or draw with your finger. On desktop, A/D or the arrow keys sidestep.</span>}
        </div>
      </div>
    </div>
  );
}

// Miniature of a spell's rune, drawn from the same template the recognizer
// scores against — so what the menu shows is exactly what the game expects.
function RuneGlyph({ id }) {
  const pts = useMemo(() => {
    const raw = TEMPLATES[id] || [];
    if (!raw.length) return '';
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const p of raw) {
      minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
      minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y);
    }
    const sc = 76 / Math.max(maxX - minX, maxY - minY, 1e-3);
    const ox = 50 - ((maxX - minX) * sc) / 2;
    const oy = 50 - ((maxY - minY) * sc) / 2;
    return raw
      .map((p) => `${(ox + (p.x - minX) * sc).toFixed(1)},${(oy + (p.y - minY) * sc).toFixed(1)}`)
      .join(' ');
  }, [id]);

  return (
    <svg className="glyph" viewBox="0 0 100 100" aria-hidden="true">
      <polyline
        points={pts} fill="none" stroke="currentColor" strokeWidth="9"
        strokeLinecap="round" strokeLinejoin="round"
      />
    </svg>
  );
}

function GameBar({ enterVR, vrSupported }) {
  const status = useGame((s) => s.status);
  const phase = useGame((s) => s.phase);
  const inVR = useGame((s) => s.inVR);
  const mode = useGame((s) => s.mode);
  const ping = useGame((s) => s.ping);
  const leave = useGame((s) => s.leave);
  const rematch = useGame((s) => s.rematch);

  const [muted, setMutedState] = useState(isMuted());
  if (inVR) return null; // DOM is hidden inside the headset anyway
  if (mode === 'online' && (phase === 'lobby' || phase === 'loading')) return null; // the lobby card owns the screen

  const toggleMute = () => { const m = !muted; setMuted(m); setMutedState(m); };

  return (
    <div className="gamebar">
      <button className="gbtn leave" onClick={leave}>‹ Menu</button>
      <button className="gbtn mute" onClick={toggleMute} aria-label={muted ? 'Unmute' : 'Mute'}>{muted ? '🔇' : '🔊'}</button>
      {vrSupported && <button className="gbtn vr" onClick={enterVR}>🥽 Enter VR</button>}
      {phase === 'over' && <button className="gbtn again" onClick={rematch}>↻ Play again</button>}
      <div className="barStatus">
        {status || (mode === 'practice' ? 'Practice — drag to draw your rune' : 'Online duel — drag to draw')}
      </div>
      {mode === 'online' && ping != null && (
        <div className={'ping' + (ping > 220 ? ' bad' : ping > 120 ? ' meh' : '')}>{ping} ms</div>
      )}
    </div>
  );
}
