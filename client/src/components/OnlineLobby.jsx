import { useRef, useState, useEffect } from 'react';
import { SPELLS } from '@rune/shared';
import { getSocket } from '../socket/client.js';
import { storage } from '../game/storage.js';

// Create/join a room by 6-letter code, lock decks, then hand off to OnlineMatch.
export default function OnlineLobby({ deck, onMatchStart, onExit }) {
  const socketRef = useRef(null);
  const [step, setStep] = useState('menu'); // menu | joining | room
  const [name, setName] = useState(storage.name || '');
  const [code, setCode] = useState('');
  const [roomCode, setRoomCode] = useState('');
  const [players, setPlayers] = useState([]);
  const [locked, setLocked] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    const socket = getSocket();
    socketRef.current = socket;

    const onLobby = ({ players }) => setPlayers(players);
    const onMatch = (data) => onMatchStart(socket, data.you, data.opponent);
    const onOppLeft = () => { setError('Opponent disconnected.'); setStep('menu'); setLocked(false); };

    socket.on('lobby_update', onLobby);
    socket.on('match_start', onMatch);
    socket.on('opponent_left', onOppLeft);
    return () => {
      socket.off('lobby_update', onLobby);
      socket.off('match_start', onMatch);
      socket.off('opponent_left', onOppLeft);
    };
  }, [onMatchStart]);

  const saveName = () => { if (name.trim()) storage.name = name.trim(); };

  const create = () => {
    saveName();
    setError('');
    socketRef.current.emit('create_room', { name: name.trim() || 'Player' }, (res) => {
      if (res.ok) { setRoomCode(res.code); setStep('room'); }
      else setError(res.error || 'Could not create room.');
    });
  };

  const join = () => {
    saveName();
    setError('');
    socketRef.current.emit('join_room', { code, name: name.trim() || 'Player' }, (res) => {
      if (res.ok) { setRoomCode(res.code); setStep('room'); }
      else setError(res.error || 'Could not join.');
    });
  };

  const lockDeck = () => {
    socketRef.current.emit('set_deck', { deck }, (res) => {
      if (res?.ok) setLocked(true);
      else setError(res?.error || 'Deck rejected.');
    });
  };

  return (
    <div className="screen">
      <div className="back-row">
        <button className="btn small ghost" onClick={onExit}>← Back</button>
        <h2>Online Duel</h2>
      </div>

      {step === 'menu' && (
        <div className="menu">
          <input
            className="field" placeholder="Your name" maxLength={16}
            value={name} onChange={(e) => setName(e.target.value)}
          />
          <button className="btn primary" onClick={create}>🏰 Create Room</button>
          <button className="btn" onClick={() => { saveName(); setStep('joining'); }}>🚪 Join with Code</button>
          <p className="error-text">{error}</p>
        </div>
      )}

      {step === 'joining' && (
        <div className="menu">
          <input
            className="field code" placeholder="CODE" maxLength={6} autoFocus
            value={code} onChange={(e) => setCode(e.target.value.toUpperCase())}
            onKeyDown={(e) => e.key === 'Enter' && join()}
          />
          <button className="btn primary" disabled={code.length !== 6} onClick={join}>Join Room</button>
          <button className="btn ghost" onClick={() => setStep('menu')}>Back</button>
          <p className="error-text">{error}</p>
        </div>
      )}

      {step === 'room' && (
        <div className="menu">
          <p className="muted">Room code — send this to your opponent:</p>
          <div className="field code" style={{ fontSize: '1.8rem', padding: 18 }}>{roomCode}</div>
          <button
            className="btn small ghost"
            onClick={() => navigator.clipboard?.writeText(roomCode)}
          >📋 Copy code</button>

          <p className="muted" style={{ marginTop: 10 }}>
            {players.length < 2 ? 'Waiting for opponent to join…' : `${players.map((p) => p.name).join(' vs ')}`}
          </p>

          <p className="muted" style={{ fontSize: '0.78rem' }}>
            Your deck: {deck.map((id) => SPELLS[id].emoji).join(' ')}
          </p>

          <button className="btn primary" disabled={locked} onClick={lockDeck}>
            {locked ? 'Deck locked — waiting…' : '🔒 Lock in deck'}
          </button>
          <p className="error-text">{error}</p>
        </div>
      )}
    </div>
  );
}
