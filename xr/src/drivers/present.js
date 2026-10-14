// Turns duel simulation events into what the player sees: projectiles,
// self-cast blooms, floating damage numbers, the combat log and the result.
//
// Used by BOTH drivers. Practice feeds it events straight from its local Duel;
// online feeds it the same events relayed by the server. That is what keeps
// the two modes looking identical — there is exactly one place that decides
// how a cast or a hit is shown.
//
// Coordinates: every event carries x in the acting side's OWN frame. The local
// player stands at +x in this world, and the opponent faces us across the
// arena, so their own-frame x appears mirrored (-x) here.
import { SPELLS } from '@rune/shared';
import { YOU_CAST, OPP_CHEST, YOU_CHEST } from '../config.js';
import { focusFeel } from '../scene/feel.js';

const oppPoint = (x, base) => [base[0] - x, base[1], base[2]];
const myPoint = (x, base) => [base[0] + x, base[1], base[2]];

// mySide: which Duel side is the local player. opts.travelAdjust shortens a
// projectile's animated flight (online: the event arrived that many ms late).
export function presentEvents(get, events, mySide, opts = {}) {
  for (const ev of events) {
    if (ev.type === 'cast') presentCast(get, ev, mySide, opts);
    else if (ev.type === 'impact') presentImpact(get, ev, mySide);
    else if (ev.type === 'over') presentOver(get, ev, mySide);
  }
}

function presentCast(get, ev, mySide, { travelAdjust = 0 }) {
  const g = get();
  const out = ev.by === mySide;
  const color = SPELLS[ev.spellId].color;
  const dir = out ? 'out' : 'in';

  if (ev.kind === 'selfcast') {
    // The ward that stays up (scene/Wards.jsx) takes the colour of the spell
    // that raised it, so a Bulwark does not look like a Ward.
    g.set({ wards: { ...g.wards, [out ? 'you' : 'opponent']: color } });
    // Self-buffs used to produce no visual at all, so raising a shield felt
    // like nothing happened. Bloom it around whoever cast it.
    g.pushFx({ kind: 'selfcast', spellId: ev.spellId, dir, at: out ? YOU_CHEST : OPP_CHEST, color });
    return;
  }

  const from = out
    ? [ev.casterX + YOU_CAST[0], YOU_CAST[1], YOU_CAST[2]]
    : oppPoint(ev.casterX, OPP_CHEST);
  const to = out ? oppPoint(ev.aimedX, OPP_CHEST) : myPoint(ev.aimedX, YOU_CHEST);

  // A summoned construct is nearly two metres tall. Spawning it at the caster's
  // own chest puts it inside the camera's near plane, where it is invisible
  // while filling the view. Portals open out in the arena, a third of the way
  // toward the target.
  const spawn = ev.kind === 'summon'
    ? [from[0] + (to[0] - from[0]) * 0.3, 0, from[2] + (to[2] - from[2]) * 0.3]
    : from;

  // The biggest spells in the game get the camera's attention, whoever cast them.
  if (ev.kind === 'domain') focusFeel(1);
  else if (ev.kind === 'summon' || ev.kind === 'meteor') focusFeel(0.7);

  // Never shorten a flight to nothing: a spell that arrives on screen already
  // landed reads as a bug, so a very late event still gets a brief flight.
  const travel = Math.max(ev.travel * 0.35, ev.travel - travelAdjust);

  g.pushFx({
    kind: ev.kind, spellId: ev.spellId, dir,
    from: spawn, to, travel, hit: 1, power: ev.power, color,
  });
}

function presentImpact(get, ev, mySide) {
  const g = get();
  const sp = SPELLS[ev.spellId];
  const iWasHit = ev.by !== mySide;
  const casterLabel = iWasHit ? g.opponentName : 'You';

  if (ev.dodged) {
    g.pushFx({
      kind: 'number', value: 0, dodge: true,
      at: iWasHit ? myPoint(ev.aimedX, YOU_CHEST) : oppPoint(ev.aimedX, OPP_CHEST),
      color: '#8ce8ff', incoming: iWasHit,
    });
    g.pushLog([iWasHit ? 'You sidestepped it' : `${g.opponentName} sidestepped it`]);
    return;
  }

  // Surface the numbers in the world so a hit is legible without reading the
  // HP bar: floating damage at the victim, and a heal tick for Leech.
  g.pushFx({
    kind: 'number', value: ev.dmg, absorbed: ev.absorbed,
    at: iWasHit ? YOU_CHEST : OPP_CHEST,
    color: ev.absorbed && !ev.dmg ? '#7fd4ff' : sp.color,
    incoming: iWasHit,
  });
  if (ev.heal > 0) {
    g.pushFx({
      kind: 'number', value: ev.heal, heal: true,
      at: iWasHit ? OPP_CHEST : YOU_CHEST, color: '#52e07a',
      incoming: !iWasHit,
    });
  }
  if (ev.dmg > 0 || ev.heal > 0) {
    g.pushLog([
      `${casterLabel} ${sp.emoji} ${sp.name}` +
      (ev.dmg ? ` → ${ev.dmg} dmg` : '') + (ev.heal ? ` (+${ev.heal} hp)` : '') +
      (ev.absorbed ? ` [${ev.absorbed} blocked]` : ''),
    ]);
  }
}

function presentOver(get, ev, mySide) {
  if (get().phase === 'over') return;
  get().set({
    phase: 'over',
    outcome: { won: ev.winner === mySide, draw: ev.winner === null },
  });
}
