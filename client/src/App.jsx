import { useState, useCallback } from 'react';
import { STARTER_DECK } from '@rune/shared';
import { storage } from './game/storage.js';
import { dropSocket } from './socket/client.js';
import { AI_LEVELS } from './game/ai.js';
import Home from './components/Home.jsx';
import DeckBuilder from './components/DeckBuilder.jsx';
import Match from './components/Match.jsx';
import OnlineLobby from './components/OnlineLobby.jsx';
import OnlineMatch from './components/OnlineMatch.jsx';
import Training from './components/Training.jsx';
import HowToPlay from './components/HowToPlay.jsx';
import WarGame from './wow/WarGame.jsx';

export default function App() {
  const [screen, setScreen] = useState('war');
  const [aiLevel, setAiLevel] = useState('medium');
  const [online, setOnline] = useState(null); // { socket, you, opponent }
  const [pendingMode, setPendingMode] = useState(null); // mode waiting on deck build

  const deck = storage.deck || STARTER_DECK;

  const goHome = () => { dropSocket(); setOnline(null); setScreen('home'); };

  const navigate = (target) => {
    // First time entering any battle mode without a saved deck → build one first.
    const needsDeck = ['online', 'ai', 'local'].includes(target);
    if (needsDeck && !storage.deck) {
      setPendingMode(target);
      setScreen('deck');
      return;
    }
    setScreen(target === 'ai' ? 'ai-level' : target);
  };

  const onDeckDone = () => {
    if (pendingMode) {
      const next = pendingMode;
      setPendingMode(null);
      setScreen(next === 'ai' ? 'ai-level' : next);
    } else {
      setScreen('home');
    }
  };

  const onMatchStart = useCallback((socket, you, opponent) => {
    setOnline({ socket, you, opponent });
    setScreen('online-match');
  }, []);

  switch (screen) {
    case 'war':
      return <WarGame onExit={() => setScreen('home')} />;
    case 'deck':
      return <DeckBuilder onDone={onDeckDone} onExit={goHome} />;
    case 'ai-level':
      return (
        <div className="screen">
          <div className="back-row">
            <button className="btn small ghost" onClick={goHome}>← Back</button>
            <h2>Choose your opponent</h2>
          </div>
          <div className="menu">
            {Object.entries(AI_LEVELS).map(([key, cfg]) => (
              <button
                key={key}
                className={`btn${key === 'medium' ? ' primary' : ''}`}
                onClick={() => { setAiLevel(key); setScreen('match-ai'); }}
              >
                {key === 'easy' ? '🧙' : key === 'medium' ? '🧙‍♂️' : '🧙‍♀️'} {cfg.label}
                <div style={{ fontSize: '0.75rem', opacity: 0.7, fontWeight: 400 }}>
                  {key === 'easy' ? 'sloppy drawer, no game sense' : key === 'medium' ? 'decent hands, some reads' : 'near-perfect runes, counters you'}
                </div>
              </button>
            ))}
          </div>
        </div>
      );
    case 'match-ai':
      return <Match mode="ai" aiLevel={aiLevel} deck={deck} onExit={goHome} />;
    case 'local':
      return <Match mode="local" deck={deck} onExit={goHome} />;
    case 'online':
      return <OnlineLobby deck={deck} onMatchStart={onMatchStart} onExit={goHome} />;
    case 'online-match':
      return online
        ? <OnlineMatch socket={online.socket} you={online.you} opponent={online.opponent} onExit={goHome} />
        : <Home onNavigate={navigate} />;
    case 'training':
      return <Training onExit={goHome} />;
    case 'howto':
      return <HowToPlay onExit={goHome} />;
    default:
      return <Home onNavigate={navigate} />;
  }
}
