import { useEffect, useState } from 'react';
import {
  ACCOUNTS_AVAILABLE, PROVIDERS, useAccount, signIn, signOut, renameMe, fetchLeaderboard, fetchMyMatches, localStats,
} from '../account.js';
import { IS_NATIVE } from '../native.js';

// The account card on the main menu. A guest sees sign-in buttons and their
// on-device record; a signed-in player sees their profile, rating and record,
// and can open the leaderboard and their match history.
//
// Renders nothing at all when the build has no Supabase configuration, so the
// menu of a guest-only build is exactly what it was before.
export default function AccountPanel() {
  const session = useAccount((s) => s.session);
  const profile = useAccount((s) => s.profile);
  const ready = useAccount((s) => s.ready);
  const error = useAccount((s) => s.error);
  const [board, setBoard] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [draft, setDraft] = useState('');

  if (!ACCOUNTS_AVAILABLE) return null;

  if (!ready) {
    return <div className="account"><div className="accountLoading">Checking your account…</div></div>;
  }

  if (!session) {
    const guest = localStats();
    return (
      <div className="account guest">
        <div className="sectionHead">Account</div>
        <p className="accountBlurb">
          Sign in to play <b>ranked</b>, climb the leaderboard and keep your record on every device.
          Guests can play everything, and their record stays on this device.
        </p>
        <div className="accountRecord muted">
          Guest record: {guest.wins}W · {guest.losses}L{guest.draws ? ` · ${guest.draws}D` : ''}
        </div>
        <div className="signInRow">
          {/* Sign in with Apple is listed first: App Store guidelines require
              it to be offered at least as prominently as other providers. */}
          {PROVIDERS.includes('apple') && (
            <button className="signIn apple" onClick={() => signIn('apple')}>
              <span aria-hidden="true"></span> Sign in with Apple
            </button>
          )}
          <button className="signIn google" onClick={() => signIn('google')}>
            <span aria-hidden="true" className="gMark">G</span> Sign in with Google
          </button>
        </div>
        {error && <div className="accountError">{error}</div>}
        <button className="linkBtn" onClick={() => setBoard(true)}>View leaderboard</button>
        {board && <Leaderboard onClose={() => setBoard(false)} />}
      </div>
    );
  }

  const p = profile;
  const saveName = async () => {
    if (await renameMe(draft)) setRenaming(false);
  };

  return (
    <div className="account signedIn">
      <div className="sectionHead">Account</div>
      <div className="profileRow">
        <div className="profileMain">
          {renaming ? (
            <div className="renameRow">
              <input value={draft} maxLength={16} onChange={(e) => setDraft(e.target.value)} autoFocus />
              <button className="go alt" onClick={saveName}>Save</button>
              <button className="linkBtn" onClick={() => setRenaming(false)}>Cancel</button>
            </div>
          ) : (
            <div className="profileName">
              {p?.display_name || 'Wizard'}
              <button className="linkBtn" onClick={() => { setDraft(p?.display_name || ''); setRenaming(true); }}>Rename</button>
            </div>
          )}
          <div className="accountRecord">
            {p ? `${p.wins}W · ${p.losses}L${p.draws ? ` · ${p.draws}D` : ''}` : '…'}
          </div>
        </div>
        <div className="ratingBadge" title={p ? `Peak ${p.peak_rating}` : ''}>
          <span className="ratingNum">{p?.rating ?? '—'}</span>
          <span className="ratingLabel">rating</span>
        </div>
      </div>
      {error && <div className="accountError">{error}</div>}
      <div className="accountActions">
        <button className="go alt" onClick={() => setBoard(true)}>Leaderboard</button>
        <button className="linkBtn" onClick={signOut}>Sign out</button>
      </div>
      {board && <Leaderboard onClose={() => setBoard(false)} />}
    </div>
  );
}

function Leaderboard({ onClose }) {
  const session = useAccount((s) => s.session);
  const [tab, setTab] = useState('top');
  const [rows, setRows] = useState(null);
  const [history, setHistory] = useState(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let alive = true;
    fetchLeaderboard().then((r) => { if (alive) setRows(r); }).catch(() => { if (alive) setFailed(true); });
    if (session) fetchMyMatches().then((m) => { if (alive) setHistory(m); }).catch(() => {});
    return () => { alive = false; };
  }, [session]);

  const me = session?.user?.id;

  return (
    <div className="lobby" role="dialog" aria-modal="true" aria-label="Leaderboard">
      <div className="lobbyCard boardCard">
        <div className="boardTabs">
          <button className={'pill' + (tab === 'top' ? ' on' : '')} onClick={() => setTab('top')}>Top players</button>
          {session && <button className={'pill' + (tab === 'mine' ? ' on' : '')} onClick={() => setTab('mine')}>My matches</button>}
        </div>

        {tab === 'top' && (
          failed ? <p className="lobbyStatus">Could not load the leaderboard. Check your connection.</p>
          : !rows ? <p className="lobbyStatus">Loading…</p>
          : !rows.length ? <p className="lobbyStatus">No ranked players yet. Five ranked games puts you on the board.</p>
          : (
            <ol className="boardList">
              {rows.map((r) => (
                <li key={r.id} className={r.id === me ? 'me' : ''}>
                  <span className="pos">{r.position}</span>
                  <span className="who">{r.display_name}</span>
                  <span className="rec">{r.wins}-{r.losses}</span>
                  <span className="rt">{r.rating}</span>
                </li>
              ))}
            </ol>
          )
        )}

        {tab === 'mine' && (
          !history ? <p className="lobbyStatus">Loading…</p>
          : !history.length ? <p className="lobbyStatus">No online matches yet.</p>
          : (
            <ol className="boardList history">
              {history.map((m) => (
                <li key={m.id} className={m.won ? 'won' : m.draw ? '' : 'lost'}>
                  <span className="pos">{m.won ? 'W' : m.draw ? 'D' : 'L'}</span>
                  <span className="who">vs {m.opponent}{m.reason === 'forfeit' ? ' (forfeit)' : ''}</span>
                  <span className="rec">{new Date(m.created_at).toLocaleDateString()}</span>
                  <span className="rt">{m.ranked && m.delta != null ? (m.delta >= 0 ? `+${m.delta}` : m.delta) : '—'}</span>
                </li>
              ))}
            </ol>
          )
        )}

        <button className="lobbyCancel" onClick={onClose}>{IS_NATIVE ? 'Done' : 'Close'}</button>
      </div>
    </div>
  );
}
