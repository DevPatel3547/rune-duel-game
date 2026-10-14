// Rune Duel match server — real-time and authoritative.
//
// Runs the same shared Duel simulation as offline practice. A client sends a
// `cast` with its raw stroke; the server re-scores the stroke (anti-cheat),
// casts it in the room's Duel, and relays the resulting events to both
// players, who present them exactly as practice mode does. A fixed tick
// advances the simulation, lands projectiles and streams authoritative state.
//
// Also handles matchmaking (quick match queue + private room codes), resuming
// a match after a dropped connection, and basic abuse limits.

import express from 'express';
import { createServer } from 'node:http';
import { randomBytes } from 'node:crypto';
import { Server } from 'socket.io';
import { identify, recordMatch } from './accounts.js';
import {
  SPELLS, DECK_SIZE, FIZZLE_THRESHOLD, scoreAgainst, Duel, SPECTACLE, MOVE_LIMIT, MOVE_SPEED, PROTOCOL_VERSION,
} from '@rune/shared';

const PORT = Number(process.env.PORT) || 3001;
const TICK_MS = 33;                 // ~30 Hz simulation
const SNAPSHOT_EVERY = 2;           // state broadcast every N ticks (~15 Hz)
const COUNTDOWN_MS = Number(process.env.COUNTDOWN_MS) || 3000;
// Longest a match waits for a client to finish loading the arena.
const READY_TIMEOUT_MS = Number(process.env.READY_TIMEOUT_MS) || 10000;
// How long a player who drops mid-match has to come back before forfeiting.
const RECONNECT_GRACE_MS = Number(process.env.RECONNECT_GRACE_MS) || 15000;
const LOBBY_TTL_MS = 10 * 60 * 1000; // an unjoined private room expires
const MAX_ROOMS = 5000;
const MIN_DECK = 3;

// Comma-separated list of web origins allowed to connect. Unset = allow all
// (local development). Requests with no Origin header — native apps, tests —
// are always allowed; origin checks only mean anything for browsers.
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || '')
  .split(',').map((s) => s.trim()).filter(Boolean);
const originAllowed = (origin) => !origin || !ALLOWED_ORIGINS.length || ALLOWED_ORIGINS.includes(origin);

const rooms = new Map();     // code -> room
const sessions = new Map();  // resume token -> { room, side }
let queue = [];              // quick match: [{ socket, name, deck, account, rating }]

const app = express();
app.disable('x-powered-by');
app.get('/health', (req, res) => {
  // The menu reads the online-player count from here, cross-origin. socket.io
  // handles CORS for its own endpoint; this plain route has to do it itself.
  const origin = req.headers.origin;
  if (origin && originAllowed(origin)) {
    res.set('Access-Control-Allow-Origin', origin);
    res.set('Vary', 'Origin');
  }
  let playing = 0;
  for (const r of rooms.values()) if (matchInProgress(r)) playing++;
  res.json({
    ok: true, protocol: PROTOCOL_VERSION, online: io.engine.clientsCount,
    rooms: rooms.size, playing, searching: queue.length, uptime: Math.round(process.uptime()),
  });
});

const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: { origin: (origin, cb) => cb(null, originAllowed(origin)) },
  allowRequest: (req, cb) => cb(null, originAllowed(req.headers.origin)),
  maxHttpBufferSize: 64 * 1024,
  // Generous on purpose. A heartbeat only catches connections that die
  // silently — a real network drop closes the transport at once. Tight values
  // instead drop healthy players whose phone stalls for a few seconds, which
  // is exactly what happens while it compiles the arena's shaders at match start.
  pingInterval: 20000,
  pingTimeout: 25000,
});

io.use((socket, next) => {
  if (Number(socket.handshake.auth?.v) !== PROTOCOL_VERSION) return next(new Error('update_required'));
  next();
});

// ── validation ─────────────────────────────────────────────────────────────
function cleanName(name) {
  const s = String(name ?? '').replace(/[\u0000-\u001f\u007f<>]/g, '').trim().slice(0, 16);
  return s || 'Wizard';
}

function validDeck(deck) {
  return Array.isArray(deck) && deck.length >= MIN_DECK && deck.length <= DECK_SIZE
    && new Set(deck).size === deck.length
    && deck.every((id) => typeof id === 'string' && Object.hasOwn(SPELLS, id));
}

function validStroke(points) {
  return Array.isArray(points) && points.length >= 8 && points.length <= 2000
    && points.every((p) => p && Number.isFinite(p.x) && Number.isFinite(p.y));
}

// Token bucket: allows `burst` events at once, refilling at `perSecond`.
function limiter(perSecond, burst) {
  let tokens = burst, last = Date.now();
  return () => {
    const now = Date.now();
    tokens = Math.min(burst, tokens + ((now - last) / 1000) * perSecond);
    last = now;
    if (tokens < 1) return false;
    tokens -= 1;
    return true;
  };
}

const reply = (ack, value) => { if (typeof ack === 'function') ack(value); };

function makeCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code;
  do {
    code = Array.from({ length: 6 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
  } while (rooms.has(code));
  return code;
}

// ── rooms ──────────────────────────────────────────────────────────────────
// mode: 'quick' (matchmade, can be ranked) | 'room' (private, never ranked)
function newRoom(mode = 'room') {
  const room = {
    code: makeCode(), mode, players: [], phase: 'lobby', duel: null,
    loop: null, liveTimer: null, tickCount: 0, lastTick: 0, createdAt: Date.now(),
  };
  rooms.set(room.code, room);
  return room;
}

// account: { id, name, rating } for a signed-in player, null for a guest
function addPlayer(room, socket, name, deck, account = null) {
  const player = {
    side: room.players.length, socket, name, deck,
    userId: account?.id || null,
    rating: account?.rating ?? null,
    token: randomBytes(18).toString('base64url'),
    connected: true, left: false, graceTimer: null, rematch: false,
    x: 0, xAt: Date.now(),
  };
  room.players.push(player);
  sessions.set(player.token, { room, side: player.side });
  socket.data.room = room;
  socket.data.side = player.side;
  return player;
}

const opponentOf = (room, side) => room.players[1 - side];
const emitTo = (player, event, data) => { if (player?.connected) player.socket.emit(event, data); };
const emitRoom = (room, event, data) => room.players.forEach((p) => emitTo(p, event, data));
const matchInProgress = (room) => room.phase === 'loading' || room.phase === 'countdown' || room.phase === 'live';
// Ratings move only in matchmade games between two different signed-in players.
const isRanked = (room) => room.mode === 'quick' && room.players.length === 2
  && room.players.every((p) => p.userId) && room.players[0].userId !== room.players[1].userId;

function matchInfo(room, side) {
  const me = room.players[side], opp = opponentOf(room, side);
  return {
    side, code: room.code, token: me.token, countdownMs: COUNTDOWN_MS, ranked: isRanked(room),
    you: { name: me.name, deck: me.deck, rating: me.rating },
    opponent: { name: opp.name, deck: opp.deck, rating: opp.rating },
  };
}

function disposeRoom(room) {
  clearInterval(room.loop);
  clearTimeout(room.liveTimer);
  clearTimeout(room.readyTimer);
  for (const p of room.players) {
    clearTimeout(p.graceTimer);
    sessions.delete(p.token);
    if (p.socket.data.room === room) p.socket.data.room = null;
  }
  rooms.delete(room.code);
}

// ── match lifecycle ────────────────────────────────────────────────────────
// A match opens in 'loading': each client builds the arena — on a phone that
// means compiling every shader, which can take seconds — and reports 'ready'.
// The countdown starts only once both have, so the slower device never loses
// the opening of a duel. Capped, so a client that never loads cannot stall it.
function startMatch(room) {
  room.duel = new Duel();
  room.phase = 'loading';
  room.tickCount = 0;
  room.lastTick = Date.now();
  room.startedAt = Date.now();
  room.players.forEach((p) => { p.rematch = false; p.ready = false; p.x = 0; p.xAt = Date.now(); });
  room.players.forEach((p) => emitTo(p, 'match_start', matchInfo(room, p.side)));

  clearTimeout(room.liveTimer);
  clearTimeout(room.readyTimer);
  room.readyTimer = setTimeout(() => beginCountdown(room), READY_TIMEOUT_MS);

  clearInterval(room.loop);
  room.loop = setInterval(() => tickRoom(room), TICK_MS);
}

function markReady(room, side) {
  if (room.phase !== 'loading' || !room.players[side]) return;
  room.players[side].ready = true;
  if (room.players.every((p) => p.ready)) beginCountdown(room);
}

function beginCountdown(room) {
  clearTimeout(room.readyTimer);
  if (rooms.get(room.code) !== room || room.phase !== 'loading') return;
  room.phase = 'countdown';
  emitRoom(room, 'countdown', { ms: COUNTDOWN_MS });
  room.liveTimer = setTimeout(() => {
    if (rooms.get(room.code) !== room || room.phase !== 'countdown') return;
    room.phase = 'live';
    emitRoom(room, 'live');
  }, COUNTDOWN_MS);
}

function tickRoom(room) {
  const { duel } = room;
  if (!duel) return;
  const now = Date.now();
  // Real elapsed time rather than TICK_MS: timers drift under load, and mana
  // regeneration must not slow down with them.
  const dt = Math.min(0.25, (now - room.lastTick) / 1000);
  room.lastTick = now;

  if (room.phase === 'live') {
    room.players.forEach((p) => duel.setX(p.side, p.x));
    const events = duel.step(dt, now);
    if (events.length) emitRoom(room, 'events', { events });
    if (duel.over) { endMatch(room); return; }
  }

  if (++room.tickCount % SNAPSHOT_EVERY === 0) {
    for (const p of room.players) {
      if (!p.connected) continue;
      const me = duel.sides[p.side], opp = duel.sides[1 - p.side];
      // Cooldowns go out as milliseconds REMAINING: the client's clock is not
      // this server's clock, so absolute timestamps would be meaningless there.
      const cd = {};
      for (const [id, at] of Object.entries(me.cd)) if (at > now) cd[id] = Math.round(at - now);
      p.socket.volatile.emit('state', {
        // The phase rides along so a client that missed the one-off 'live'
        // event cannot sit in the countdown forever.
        phase: room.phase,
        you: { hp: Math.round(me.hp), mana: me.mana, shield: me.shield, cd },
        // the opponent's shield is public: their ward is visible in the arena
        opponent: { hp: Math.round(opp.hp), shield: Math.round(opp.shield), x: opponentOf(room, p.side)?.x ?? 0 },
      });
    }
  }
}

function endMatch(room, { forfeitBy } = {}) {
  clearInterval(room.loop);
  room.loop = null;
  clearTimeout(room.liveTimer);
  clearTimeout(room.readyTimer);
  if (room.phase === 'over' || !room.duel) return;
  room.phase = 'over';
  const { duel } = room;
  if (forfeitBy !== undefined) duel.winner = 1 - forfeitBy;
  for (const p of room.players) {
    emitTo(p, 'game_over', {
      won: duel.winner === p.side,
      draw: duel.winner === null,
      walkover: forfeitBy !== undefined,
      hp: {
        you: Math.max(0, Math.round(duel.sides[p.side].hp)),
        opponent: Math.max(0, Math.round(duel.sides[1 - p.side].hp)),
      },
    });
  }

  // Record the result. Whether it is rated, and by how much, is decided by the
  // database in one transaction. Fire-and-forget: a slow database must never
  // hold up anyone's result screen.
  const [a, b] = room.players;
  if (a && b) {
    recordMatch({
      mode: room.mode, a, b,
      result: duel.winner === 0 ? 'a' : duel.winner === 1 ? 'b' : 'draw',
      reason: forfeitBy !== undefined ? 'forfeit' : 'ko',
      durationMs: Date.now() - (room.startedAt || Date.now()),
      hpA: duel.sides[0].hp,
      hpB: duel.sides[1].hp,
    }).then((row) => {
      if (!row?.ranked) return;
      emitTo(a, 'rating_change', { delta: row.rating_delta_a });
      emitTo(b, 'rating_change', { delta: row.rating_delta_b });
    });
  }
}

// Lateral movement comes from the client, so it is checked: clamped to the
// arena, and limited to what the move speed could actually cover since the
// last update. A modified client can wobble but cannot teleport out of a hit.
function moveTo(player, x) {
  const target = Number(x);
  if (!Number.isFinite(target)) return;
  const now = Date.now();
  const maxStep = MOVE_SPEED * 1.3 * ((now - player.xAt) / 1000) + 0.25;
  const clamped = Math.max(-MOVE_LIMIT, Math.min(MOVE_LIMIT, target));
  player.x += Math.max(-maxStep, Math.min(maxStep, clamped - player.x));
  player.xAt = now;
}

function handleCast(room, side, { spellId, points, drawTime, x } = {}) {
  if (!room || room.phase !== 'live') return;
  const player = room.players[side];
  if (typeof spellId !== 'string' || !player.deck.includes(spellId)) return;
  if (x !== undefined) moveTo(player, x);

  // Anti-cheat: the server re-scores the raw stroke instead of trusting the
  // client's claim about what was drawn and how well.
  const accuracy = validStroke(points) ? scoreAgainst(points, spellId) : 0;
  if (accuracy < FIZZLE_THRESHOLD) {
    player.socket.emit('cast_ack', { spellId, fizzled: true });
    return;
  }

  const now = Date.now();
  room.duel.setX(side, player.x);
  const time = Math.max(0.25, Math.min(15, Number(drawTime) || 1.2));
  const r = room.duel.cast(side, spellId, { accuracy, drawTime: time }, now);
  if (r.block) {
    player.socket.emit('cast_ack', { spellId, block: r.block });
    return;
  }
  emitRoom(room, 'events', { events: [r.event] });
}

// ── leaving ────────────────────────────────────────────────────────────────
function dequeue(socket) {
  const before = queue.length;
  queue = queue.filter((q) => q.socket !== socket);
  if (queue.length !== before) broadcastQueue();
}

// A deliberate exit: forfeits any match in progress immediately.
function leaveRoom(socket) {
  const room = socket.data.room;
  if (!room) return;
  const player = room.players[socket.data.side];
  socket.data.room = null;
  if (!player || player.socket !== socket) return;
  clearTimeout(player.graceTimer);
  player.connected = false;
  player.left = true;
  if (matchInProgress(room)) endMatch(room, { forfeitBy: player.side });
  emitTo(opponentOf(room, player.side), 'opponent_left');
  if (room.players.every((p) => p.left)) disposeRoom(room);
}

// An unexpected drop: hold the seat open for the grace period.
function dropConnection(socket) {
  const room = socket.data.room;
  if (!room) return;
  const player = room.players[socket.data.side];
  if (!player || player.socket !== socket) return;
  player.connected = false;
  const inMatch = matchInProgress(room);
  if (inMatch) emitTo(opponentOf(room, player.side), 'opponent_disconnected', { graceMs: RECONNECT_GRACE_MS });

  clearTimeout(player.graceTimer);
  player.graceTimer = setTimeout(() => {
    if (player.connected || !rooms.has(room.code)) return;
    player.left = true;
    if (matchInProgress(room)) endMatch(room, { forfeitBy: player.side });
    emitTo(opponentOf(room, player.side), 'opponent_left');
    if (room.players.every((p) => p.left)) disposeRoom(room);
  }, RECONNECT_GRACE_MS);
}

// ── matchmaking ────────────────────────────────────────────────────────────
function broadcastQueue() {
  const online = io.engine.clientsCount;
  queue.forEach((q, i) => q.socket.emit('queue_status', { position: i + 1, searching: queue.length, online }));
}

function pairQueue() {
  queue = queue.filter((q) => q.socket.connected);
  while (queue.length >= 2) {
    // The longest-waiting player, matched with the closest rating among the
    // rest. Guests have no rating and count as a new player's 1000.
    const a = queue.shift();
    const ra = a.rating ?? 1000;
    let best = 0;
    for (let i = 1; i < queue.length; i++) {
      if (Math.abs((queue[i].rating ?? 1000) - ra) < Math.abs((queue[best].rating ?? 1000) - ra)) best = i;
    }
    const [b] = queue.splice(best, 1);
    const room = newRoom('quick');
    addPlayer(room, a.socket, a.name, a.deck, a.account);
    addPlayer(room, b.socket, b.name, b.deck, b.account);
    startMatch(room);
  }
  broadcastQueue();
}

// ── connection ─────────────────────────────────────────────────────────────
io.on('connection', (socket) => {
  socket.data.room = null;
  socket.data.side = -1;
  const castAllowed = limiter(6, 10);
  const presenceAllowed = limiter(40, 60);
  const actionAllowed = limiter(4, 8);

  // Every handler is guarded: one malformed payload must never take the
  // process — and every match on it — down.
  const on = (event, fn, allowed = actionAllowed) => socket.on(event, (...args) => {
    if (!allowed()) return;
    try {
      // handlers that look up an account are async; a rejection must be
      // logged, not left to crash the process as an unhandled promise
      const result = fn(...args);
      if (result && typeof result.catch === 'function') result.catch((err) => console.error(`[${event}]`, err));
    } catch (err) { console.error(`[${event}]`, err); }
  });

  // `auth` is an optional Supabase access token. A signed-in player plays under
  // their profile name and rating; anyone else is a guest.
  on('create_room', async ({ name, deck, auth } = {}, ack) => {
    if (rooms.size >= MAX_ROOMS) return reply(ack, { ok: false, error: 'The arena is full — try again shortly.' });
    if (!validDeck(deck)) return reply(ack, { ok: false, error: 'Invalid spellbook.' });
    const account = await identify(auth);
    if (!socket.connected) return;
    dequeue(socket);
    leaveRoom(socket);
    const room = newRoom('room');
    const p = addPlayer(room, socket, account?.name || cleanName(name), deck, account);
    reply(ack, { ok: true, code: room.code, token: p.token, side: p.side });
  });

  on('join_room', async ({ code, name, deck, auth } = {}, ack) => {
    const find = () => rooms.get(String(code ?? '').toUpperCase().trim());
    const check = (room) => {
      if (!room || room.players.some((p) => p.left)) return 'Room not found.';
      if (room.players.length >= 2) return 'That room is already full.';
      if (room.players[0].socket === socket) return "That's your own room.";
      return null;
    };
    if (!validDeck(deck)) return reply(ack, { ok: false, error: 'Invalid spellbook.' });
    const early = check(find());
    if (early) return reply(ack, { ok: false, error: early });
    const account = await identify(auth);
    if (!socket.connected) return;
    // the room may have filled or closed while the account was looked up
    const room = find();
    const late = check(room);
    if (late) return reply(ack, { ok: false, error: late });
    dequeue(socket);
    leaveRoom(socket);
    const p = addPlayer(room, socket, account?.name || cleanName(name), deck, account);
    reply(ack, { ok: true, code: room.code, token: p.token, side: p.side });
    startMatch(room);
  });

  on('quick_match', async ({ name, deck, auth } = {}, ack) => {
    if (!validDeck(deck)) return reply(ack, { ok: false, error: 'Invalid spellbook.' });
    const account = await identify(auth);
    if (!socket.connected) return;
    leaveRoom(socket);
    queue = queue.filter((q) => q.socket !== socket);
    queue.push({ socket, name: account?.name || cleanName(name), deck, account, rating: account?.rating ?? null });
    reply(ack, { ok: true });
    pairQueue();
  });

  on('cancel_queue', () => dequeue(socket));

  on('resume', ({ token } = {}, ack) => {
    const s = sessions.get(String(token ?? ''));
    if (!s || rooms.get(s.room.code) !== s.room) return reply(ack, { ok: false });
    const { room, side } = s;
    const player = room.players[side];
    if (player.left) return reply(ack, { ok: false });
    clearTimeout(player.graceTimer);
    if (player.socket !== socket) player.socket.data.room = null; // retire the stale socket
    player.socket = socket;
    player.connected = true;
    socket.data.room = room;
    socket.data.side = side;
    reply(ack, {
      ok: true, phase: room.phase, code: room.code,
      match: room.duel && room.players.length === 2 ? matchInfo(room, side) : null,
    });
    emitTo(opponentOf(room, side), 'opponent_reconnected');

    // Casts broadcast while this player was away never reached them, so spells
    // still in the air would land out of nowhere. Replay those with the flight
    // time they have left.
    if (room.phase === 'live' && room.duel.projectiles.length) {
      const now = Date.now();
      socket.emit('events', {
        events: room.duel.projectiles.map((p) => ({
          type: 'cast', by: p.by, spellId: p.id, kind: SPECTACLE[p.id] || 'projectile',
          travel: Math.max(0, p.impactAt - now), power: p.power, aimedX: p.aimedX, casterX: 0,
        })),
      });
    }
  });

  on('cast', (payload) => handleCast(socket.data.room, socket.data.side, payload || {}), castAllowed);

  // The client has built the arena and can start the countdown.
  on('ready', () => {
    const room = socket.data.room;
    if (room) markReady(room, socket.data.side);
  });

  // --- presence relay: see the other wizard move and draw live ---
  on('presence', (pose) => {
    const room = socket.data.room;
    if (!room || !pose || typeof pose !== 'object') return;
    const me = room.players[socket.data.side];
    if (pose.x !== undefined) moveTo(me, pose.x);
    const opp = opponentOf(room, socket.data.side);
    if (opp?.connected) opp.socket.volatile.emit('opponent_presence', { ...pose, x: me.x });
  }, presenceAllowed);

  const relay = (event, out, volatile) => on(event, (data) => {
    const room = socket.data.room;
    if (!room || !data || typeof data !== 'object') return;
    if (data.points !== undefined && (!Array.isArray(data.points) || data.points.length > 120)) return;
    const opp = opponentOf(room, socket.data.side);
    if (!opp?.connected) return;
    (volatile ? opp.socket.volatile : opp.socket).emit(out, data);
  }, presenceAllowed);
  relay('trail', 'opponent_trail', true);
  relay('trail_end', 'opponent_trail_end', false);
  relay('emote', 'opponent_emote', false);

  on('rematch', () => {
    const room = socket.data.room;
    if (!room || room.phase !== 'over') return;
    const opp = opponentOf(room, socket.data.side);
    if (!opp || opp.left) { socket.emit('rematch_unavailable'); return; }
    room.players[socket.data.side].rematch = true;
    emitTo(opp, 'opponent_rematch');
    if (room.players.every((p) => p.rematch)) startMatch(room);
  });

  // Round-trip timing, so the client can shorten animated flights by its lag.
  on('ping_rt', (ack) => reply(ack, Date.now()), presenceAllowed);

  on('leave', (ack) => { dequeue(socket); leaveRoom(socket); reply(ack, { ok: true }); });

  socket.on('disconnect', (reason) => {
    dequeue(socket);
    // The client hung up on purpose — it closed the duel — so that is leaving,
    // even if its 'leave' never made it out ahead of the disconnect. Anything
    // else (a dead network, a backgrounded phone) holds the seat open.
    if (reason === 'client namespace disconnect') leaveRoom(socket);
    else dropConnection(socket);
  });
});

// Private rooms nobody joined would otherwise sit in memory forever.
setInterval(() => {
  const now = Date.now();
  for (const room of rooms.values()) {
    if (room.phase === 'lobby' && now - room.createdAt > LOBBY_TTL_MS) {
      emitRoom(room, 'room_expired');
      disposeRoom(room);
    }
  }
}, 60 * 1000).unref();

// The host sends SIGTERM before replacing this machine on a deploy. Tell
// players, so their client shows "restarting" and reconnects, rather than
// dropping them silently.
function shutdown() {
  io.emit('server_restart');
  httpServer.close();
  setTimeout(() => process.exit(0), 1500).unref();
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

httpServer.listen(PORT, '0.0.0.0', () => {
  console.log(`⚡ Rune Duel match server listening on :${PORT} (protocol v${PROTOCOL_VERSION})`);
});
