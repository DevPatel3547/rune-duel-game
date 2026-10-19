// Online driver — a real-time 1v1 against another player over the match server.
//
// The server runs the same shared Duel simulation as practice mode and relays
// its events here, where they go through the same presentEvents() practice
// uses. That is what makes an online duel look and play exactly like practice.
// This driver adds only what is specific to a network: matchmaking, latency
// compensation, resuming after a dropped connection, and relaying presence so
// each player sees the other move and draw.
import { io } from 'socket.io-client';
import { RT, blankStatus, PROTOCOL_VERSION } from '@rune/shared';
import { bestMatch } from './shared.js';
import { presentEvents } from './present.js';
import { PRESENCE_HZ, TRAIL_HZ } from '../config.js';
import { socketTarget } from '../net.js';
import { resetFeel } from '../scene/feel.js';
import { accessToken, loadProfile, recordLocalResult, useAccount } from '../account.js';

export class OnlineDriver {
  constructor(get, set) {
    this.get = get;
    this.set = set;
    this.socket = null;
    this.alive = true;
    this.side = 0;
    this.token = null;     // resume token for the current match
    this.rtt = 150;        // smoothed round-trip time, ms
    this.oppGone = false;
    this.lastPresence = 0;
    this.lastTrail = 0;
    this._ping = null;
  }

  // action: 'quick' (matchmaking) | 'create' (private room) | 'join' (room code)
  connect(action, code) {
    const { get, set } = this;
    this.action = action;
    set({ status: 'Connecting…', phase: 'lobby', roomCode: null, queue: null, oppX: 0 });

    // undefined target = same origin (dev, where Vite proxies /socket.io)
    const socket = io(socketTarget(), {
      transports: ['websocket', 'polling'],
      auth: { v: PROTOCOL_VERSION },
      reconnectionDelayMax: 4000,
      timeout: 15000,
    });
    this.socket = socket;
    this._wire();

    let settled = false;
    return new Promise((resolve) => {
      const finish = (result) => {
        if (settled) return;
        settled = true;
        if (!result.ok) set({ netError: result.error || 'failed' });
        resolve(result);
      };

      socket.on('connect', async () => {
        this._startPing();
        if (settled) { this._resume(); return; }
        // A signed-in player sends their access token so the server can play
        // them under their profile and rating; a guest sends none.
        const payload = { name: get().name, deck: get().deck, auth: await accessToken() };

        if (action === 'quick') {
          socket.emit('quick_match', payload, (r) => {
            if (!r?.ok) { set({ status: r?.error || 'Could not start matchmaking.' }); return finish({ ok: false, error: r?.error }); }
            set({ status: 'Searching for an opponent…', queue: { position: 1, searching: 1 } });
            finish({ ok: true });
          });
        } else if (action === 'create') {
          socket.emit('create_room', payload, (r) => {
            if (!r?.ok) { set({ status: r?.error || 'Could not create a room.' }); return finish({ ok: false, error: r?.error }); }
            this.token = r.token;
            this.side = r.side;
            set({ status: 'Waiting for your opponent to join…', roomCode: r.code });
            finish({ ok: true, code: r.code });
          });
        } else {
          socket.emit('join_room', { ...payload, code }, (r) => {
            if (!r?.ok) { set({ status: r?.error || 'Could not join that room.' }); return finish({ ok: false, error: r?.error }); }
            this.token = r.token;
            this.side = r.side;
            set({ status: 'Joined — the duel is starting…', roomCode: r.code });
            finish({ ok: true, code: r.code });
          });
        }
      });

      socket.on('connect_error', (err) => {
        if (!this.alive) return;
        if (err?.message === 'update_required') {
          socket.disconnect();
          set({ status: 'A new version of Rune Duel is out — reload to play online.' });
          return finish({ ok: false, error: 'update_required' });
        }
        if (!settled) {
          socket.disconnect();
          set({ status: 'Could not reach the duel server. Check your connection and try again.' });
          return finish({ ok: false, error: 'offline' });
        }
        set({ status: 'Connection lost — reconnecting…' });
      });
    });
  }

  _wire() {
    const { socket, set, get } = this;

    socket.on('queue_status', ({ searching, online }) => {
      if (get().phase !== 'lobby') return;
      const others = Math.max(0, (online || 1) - 1);
      set({
        status: 'Searching for an opponent…',
        queue: { searching, online, others },
      });
    });

    // A match begins (fresh, or a rematch): reset to a full, live-ready duel.
    socket.on('match_start', (m) => {
      this.side = m.side;
      this.token = m.token;
      this.guestRecorded = false;
      this.oppGone = false;
      resetFeel();
      set({
        opponentName: m.opponent?.name || 'Opponent', roomCode: m.code, queue: null,
        status: '', phase: 'loading', countdownEndsAt: 0, round: 1,
        hp: { you: 100, opponent: 100 },
        resources: { mana: RT.START_MANA, shield: 0, cd: {} },
        effects: { you: blankStatus(), opponent: blankStatus() },
        options: [...get().deck],
        log: [], outcome: null, oppTrail: null, oppPresence: null, oppX: 0, oppShield: 0,
        lastResult: null, lastMatch: null, youSubmitted: false, oppSubmitted: false, fx: [],
        ratingChange: null,
      });
    });

    // Registered after the handler above, so the match state is already reset.
    socket.on('match_start', () => this._reportReadyWhenLoaded());

    // The server counts down once both players have loaded the arena.
    socket.on('countdown', ({ ms } = {}) => {
      set({ phase: 'countdown', countdownEndsAt: performance.now() + Math.max(0, (ms || 0) - this.rtt / 2) });
    });

    socket.on('live', () => set({ phase: 'live' }));

    // Simulation events from the server's Duel: casts, impacts, the result.
    // A cast event arrives roughly half a round trip after the server launched
    // it, so the animated flight is shortened by that much to land on time.
    socket.on('events', ({ events } = {}) => {
      if (!Array.isArray(events)) return;
      presentEvents(get, events, this.side, { travelAdjust: this.rtt / 2 });
    });

    // Authoritative snapshot: HP for both, your own mana/shield/cooldowns.
    socket.on('state', ({ phase, you, opponent } = {}) => {
      if (!you || !opponent) return;
      const now = performance.now();
      const cd = {};
      for (const [id, left] of Object.entries(you.cd || {})) cd[id] = now + left;
      set({
        hp: { you: you.hp, opponent: opponent.hp },
        resources: { mana: you.mana, shield: you.shield, cd },
        oppShield: opponent.shield ?? 0,
        // recover from a missed 'live' event
        ...(phase === 'live' && (get().phase === 'countdown' || get().phase === 'loading') ? { phase: 'live' } : {}),
      });
    });

    // Your cast was rejected (not enough mana / on cooldown / fizzled).
    socket.on('cast_ack', ({ spellId, block, fizzled } = {}) => {
      if (fizzled) set({ lastMatch: { spellId, fizzled: true, at: performance.now() } });
      else if (block) set({ lastMatch: { spellId, blocked: block, at: performance.now() } });
    });

    socket.on('game_over', ({ won, draw, walkover, hp } = {}) => {
      this._recordGuest({ won, draw, walkover });
      set({
        phase: 'over',
        outcome: { won, draw, walkover },
        ...(hp ? { hp: { you: hp.you, opponent: hp.opponent } } : {}),
        status: walkover && won ? 'Your opponent left — the win is yours.' : '',
      });
    });

    // A ranked result was recorded. The delta is shown on the result screen,
    // and the profile is refreshed so the menu shows the new rating.
    socket.on('rating_change', ({ delta } = {}) => {
      if (typeof delta !== 'number') return;
      set({ ratingChange: delta });
      loadProfile();
    });

    socket.on('opponent_disconnected', () => set({ status: 'Opponent lost connection — waiting for them to return…' }));
    socket.on('opponent_reconnected', () => this._note('Opponent is back.'));
    socket.on('opponent_left', () => {
      this.oppGone = true;
      if (get().phase === 'over') set({ status: 'Your opponent left the arena.' });
      else {
        this._recordGuest({ won: true, draw: false, walkover: true });
        set({ status: 'Your opponent left the arena.', phase: 'over', outcome: { won: true, draw: false, walkover: true } });
      }
    });
    socket.on('opponent_rematch', () => set({ status: 'Your opponent wants a rematch!' }));
    socket.on('rematch_unavailable', () => set({ status: 'Your opponent has left — find a new match from the menu.' }));
    socket.on('room_expired', () => set({ status: 'This room expired. Go back to the menu to open a new one.' }));
    socket.on('server_restart', () => set({ status: 'The duel server is restarting — hang tight…' }));

    socket.on('disconnect', (reason) => {
      if (!this.alive || reason === 'io client disconnect') return;
      set({ status: 'Connection lost — reconnecting…' });
    });

    // --- live presence in (see them move + draw) ---
    socket.on('opponent_presence', (pose) => set({ oppPresence: pose, oppX: Number(pose?.x) || 0 }));
    socket.on('opponent_trail', (data) => set({ oppTrail: { ...data, active: true } }));
    socket.on('opponent_trail_end', (data) => set((s) => ({ oppTrail: s.oppTrail ? { ...s.oppTrail, ...data, active: false } : null })));
  }

  // Guests keep their online record on this device (signed-in players' results
  // are recorded by the match server). Once per match, whichever end arrives.
  _recordGuest(outcome) {
    if (this.guestRecorded || useAccount.getState().session) return;
    this.guestRecorded = true;
    recordLocalResult(outcome, 'online');
  }

  // Back online after a drop. With a match token, rejoin that match; while
  // still searching, rejoin the queue.
  _resume() {
    const { socket, get, set } = this;
    if (!this.token) {
      if (this.action === 'quick' && get().phase === 'lobby') {
        accessToken().then((auth) => socket.emit('quick_match', { name: get().name, deck: get().deck, auth }, () => {}));
        set({ status: 'Searching for an opponent…' });
      } else {
        set({ status: 'Reconnected.' });
      }
      return;
    }
    socket.emit('resume', { token: this.token }, (r) => {
      if (!r?.ok) {
        this.oppGone = true;
        if (get().phase !== 'over') {
          set({ phase: 'over', outcome: { won: false, draw: false, walkover: true }, status: 'The match ended while you were disconnected.' });
        }
        return;
      }
      set({ status: '' });
      if (r.phase === 'live' && get().phase !== 'live') set({ phase: 'live' });
      if (r.phase === 'loading') this._reportReadyWhenLoaded();
    });
  }

  // Tell the server this client has built the arena; the countdown waits for it.
  _reportReadyWhenLoaded() {
    clearInterval(this._readyPoll);
    const check = () => {
      if (!this.alive || !this.socket) { clearInterval(this._readyPoll); return; }
      if (this.get().sceneReady) {
        clearInterval(this._readyPoll);
        this.socket.emit('ready');
      }
    };
    this._readyPoll = setInterval(check, 100);
    check();
  }

  // A passing notice that clears itself, unless something newer replaced it.
  _note(status, ms = 2500) {
    this.set({ status });
    clearTimeout(this._noteTimer);
    this._noteTimer = setTimeout(() => {
      if (this.alive && this.get().status === status) this.set({ status: '' });
    }, ms);
  }

  _startPing() {
    clearInterval(this._ping);
    const ping = () => {
      const t0 = performance.now();
      this.socket?.emit('ping_rt', () => {
        const rtt = performance.now() - t0;
        this.rtt = this.rtt * 0.7 + rtt * 0.3;
        this.set({ ping: Math.round(this.rtt) });
      });
    };
    ping();
    this._ping = setInterval(ping, 3000);
  }

  // Called by the 3D DesktopCaster via store.submitCast when you finish a rune.
  submit(points2d, drawTime) {
    if (this.get().phase !== 'live') return null;
    const match = bestMatch(points2d, this.get().deck); // local recognition for instant feedback
    if (!match.spellId || match.fizzled) {
      this.set({ lastMatch: { ...match, fizzled: true, at: performance.now() } });
      return match;
    }
    this.set({ lastMatch: { ...match, at: performance.now() } });
    // The server re-recognizes the raw points against our deck itself and casts
    // whatever IT recognizes; spellId is only a hint for logs and old servers.
    this.socket?.emit('cast', {
      spellId: match.spellId, points: points2d.slice(0, 1500), drawTime, x: this.get().move.x,
    });
    return match;
  }

  sendPresence(pose) {
    const now = performance.now();
    if (now - this.lastPresence < 1000 / PRESENCE_HZ) return;
    this.lastPresence = now;
    this.socket?.emit('presence', { ...pose, x: this.get().move.x });
  }

  sendTrail(payload) {
    const now = performance.now();
    if (now - this.lastTrail < 1000 / TRAIL_HZ) return;
    this.lastTrail = now;
    this.socket?.emit('trail', payload);
  }

  sendTrailEnd(payload) { this.socket?.emit('trail_end', payload); }

  rematch() {
    if (this.oppGone) { this.set({ status: 'Your opponent has left — find a new match from the menu.' }); return; }
    this.socket?.emit('rematch');
    this.set({ status: 'Rematch requested — waiting for your opponent…' });
  }

  cancel() { this.socket?.emit('cancel_queue'); }

  dispose() {
    this.alive = false;
    clearInterval(this._ping);
    clearTimeout(this._noteTimer);
    clearInterval(this._readyPoll);
    const { socket } = this;
    this.socket = null;
    if (!socket) return;
    // Wait for the server to record the leave before hanging up; disconnecting
    // straight after the emit could beat the message out, and the opponent
    // would sit through a reconnect grace period for a match that is over.
    try {
      if (socket.connected) socket.timeout(1000).emit('leave', () => socket.disconnect());
      else socket.disconnect();
    } catch {
      socket.disconnect();
    }
  }
}
