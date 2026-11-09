// Server-side bots, so Quick Match always finds a duel.
//
// A bot is a virtual player in a normal room. It is told everything a human
// client is told (through a stand-in socket), it sees only what a human could
// see in the arena (HP, shields, spells in flight), and it acts only through
// the same doors a client uses: it streams a live trail while it "draws",
// then casts the raw stroke, which the server re-recognizes and times exactly
// as it does a human's (shared/src/authority.js). It cannot name a spell or
// a score. Every bot is labelled as one: its name starts with "Bot", and
// match_start tells the client `opponent.bot: true`.
import { SPELLS, castBlock, synthStroke, DODGE_RADIUS, MOVE_LIMIT } from '@rune/shared';

const NAMES = ['Ember', 'Quill', 'Sable', 'Wisp', 'Thorne', 'Vesper', 'Ash', 'Morrow'];
export const BOT_DECKS = [
  ['bolt', 'shield', 'pierce', 'leech', 'vortex'],
  ['bolt', 'reflect', 'quake', 'drain', 'pierce'],
  ['pierce', 'shield', 'leech', 'void', 'bolt'],
];

// How each skill plays: seconds between decisions to cast, the chance it
// reacts to an incoming spell (shield or sidestep), and its hand (strokeModel).
const STYLE = {
  easy:   { every: [2.6, 4.0], react: 0.25 },
  normal: { every: [1.6, 2.6], react: 0.5 },
  hard:   { every: [0.9, 1.6], react: 0.8 },
};
const TRAIL_MS = 33;
const THINK_MS = 120;
const pick = (arr, rng) => arr[Math.floor(rng() * arr.length)];
const between = ([a, b], rng) => a + rng() * (b - a);

export function botIdentity(rng = Math.random) {
  return { name: `Bot ${pick(NAMES, rng)}`, deck: [...pick(BOT_DECKS, rng)] };
}

/**
 * A socket stand-in for a bot: the server's emit calls become bot events.
 * @param {(event: string, data: any) => void} onEvent
 */
export function botSocket(onEvent) {
  const sock = {
    id: `bot-${Math.random().toString(36).slice(2, 10)}`,
    connected: true,
    data: {},
    emit: (event, data) => { try { onEvent(event, data); } catch (err) { console.error('[bot]', err); } },
  };
  sock.volatile = { emit: sock.emit };
  return sock;
}

/**
 * The bot's brain. `api` is what the server lets it do:
 *   view() -> { duel, side, phase }   what it can see
 *   ready(), trail(points2d, points3d), trailEnd(), cast(points, drawTime),
 *   move(x), rematch(), leave()
 */
export class Bot {
  constructor(api, { skill = 'normal', rng = Math.random } = {}) {
    this.api = api;
    this.skill = STYLE[skill] ? skill : 'normal';
    this.style = STYLE[this.skill];
    this.rng = rng;
    this.timers = new Set();
    this.drawing = false;
    this.x = 0;
    this.nextCastAt = 0;
    this.reacted = new Set();
  }

  later(fn, ms) {
    const t = setTimeout(() => { this.timers.delete(t); fn(); }, ms);
    this.timers.add(t);
    return t;
  }

  stop() {
    this.timers.forEach(clearTimeout);
    this.timers.clear();
    clearInterval(this.loop);
    this.loop = null;
    this.drawing = false;
  }

  on(event) {
    if (event === 'match_start') {
      this.stop();
      // a short, human-looking load time
      this.later(() => this.api.ready(), 400 + this.rng() * 600);
    } else if (event === 'live') {
      this.start();
    } else if (event === 'state') {
      if (!this.loop && this.api.view().phase === 'live') this.start();
    } else if (event === 'game_over') {
      this.stop();
    } else if (event === 'opponent_rematch') {
      this.later(() => this.api.rematch(), 700 + this.rng() * 800);
    } else if (event === 'opponent_left' || event === 'room_expired') {
      this.stop();
      this.api.leave();
    }
  }

  start() {
    if (this.loop) return;
    this.nextCastAt = Date.now() + 800 + this.rng() * 900;
    this.loop = setInterval(() => this.think(), THINK_MS);
  }

  think() {
    const { duel, side, phase } = this.api.view();
    if (phase !== 'live' || !duel || duel.over) return;
    const now = Date.now();
    const me = duel.sides[side];
    const foe = duel.sides[1 - side];
    const deck = this.api.deck();
    const castable = (id) => deck.includes(id) && !castBlock(me, id, now);

    // React to a spell on its way in: sidestep it, or raise a ward.
    for (const p of duel.projectiles) {
      if (p.by === side || this.reacted.has(p)) continue;
      this.reacted.add(p);
      if (this.rng() > this.style.react) continue;
      if (!p.undodgeable && this.rng() < 0.6) {
        const dir = this.x > 0 ? -1 : this.x < 0 ? 1 : (this.rng() < 0.5 ? -1 : 1);
        this.walkTo(Math.max(-MOVE_LIMIT, Math.min(MOVE_LIMIT, this.x + dir * (DODGE_RADIUS + 0.8))));
      } else if (!this.drawing && castable('shield') && SPELLS[p.id]?.id !== 'pierce') {
        this.draw('shield');
        return;
      }
    }

    if (this.drawing || now < this.nextCastAt) return;
    // Pierce goes through a ward; otherwise any attack it can afford.
    const attacks = deck.filter((id) => SPELLS[id].type === 'attack' && castable(id));
    let id = foe.shield > 0 && attacks.includes('pierce') ? 'pierce' : pick(attacks, this.rng);
    if (!id && me.hp < 40 && castable('leech')) id = 'leech';
    if (!id) return; // out of mana: wait for it
    this.draw(id);
    this.nextCastAt = now + between(this.style.every, this.rng) * 1000;
  }

  // Draw a rune over real time, streaming the trail, then cast the stroke.
  draw(id) {
    this.drawing = true;
    const { points, drawTime } = synthStroke(id, this.skill, this.rng);
    const started = Date.now();
    const total = drawTime * 1000;
    const tick = () => {
      if (!this.drawing) return;
      const elapsed = Date.now() - started;
      const sofar = points.filter((p) => p.t * 1000 <= elapsed);
      if (sofar.length >= 2) {
        const flat = sofar.map(({ x, y }) => ({ x, y }));
        // the glyph as the opponent sees it, in front of the bot's chest
        const shown = flat.filter((_, i) => i % 2 === 0).slice(0, 80)
          .map((p) => [((p.x - 40) / 260 - 0.5) * 0.55, 1.5 + (0.5 - (p.y - 40) / 260) * 0.55, -0.05]);
        this.api.trail(flat, shown);
      }
      if (elapsed < total) { this.later(tick, TRAIL_MS); return; }
      this.drawing = false;
      this.api.cast(points.map(({ x, y }) => ({ x, y })), drawTime);
      this.api.trailEnd();
    };
    tick();
  }

  // Sidestep at running pace; the server caps the speed anyway.
  walkTo(target) {
    const steps = 8;
    const from = this.x;
    for (let i = 1; i <= steps; i++) {
      this.later(() => { this.x = from + ((target - from) * i) / steps; this.api.move(this.x); }, i * 45);
    }
  }
}
