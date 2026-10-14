// Simultaneous round resolution. Pure function — same code runs on the
// client (local/AI modes) and the server (online, so clients can't cheat).

import {
  SPELLS, SHIELD_ABSORB, REFLECT_RATIO, LEECH_RATIO, SURGE_MULT,
  DRAIN_MULT, NOVA_DISRUPT_MULT, ANCHOR_ROUNDS, blankStatus,
} from './spells.js';

// cast: { spell: spellId|null, power: 0..1 }  (spell null = fizzle/timeout)
// status: { surge, drained, slowed, shaken, anchor }
// Returns { damage: {a,b}, heal: {a,b}, status: {a,b}, log: [], events: {a,b} }
export function resolveRound(castA, castB, statusA, statusB) {
  const log = [];
  const sides = {
    a: { cast: castA, status: statusA, opp: 'b' },
    b: { cast: castB, status: statusB, opp: 'a' },
  };

  const active = (k) => sides[k].cast.spell !== null && sides[k].cast.power > 0;
  const spellOf = (k) => (active(k) ? sides[k].cast.spell : null);
  const name = { a: 'P1', b: 'P2' };

  // 1. Void strips the opponent's special effects this round.
  const stripped = {
    a: spellOf('b') === 'void',
    b: spellOf('a') === 'void',
  };
  const hasEffects = (k) => active(k) && !stripped[k];

  for (const k of ['a', 'b']) {
    if (!active(k)) log.push(`${name[k]}'s rune fizzled!`);
    else if (stripped[k] && spellOf(k) !== 'void') log.push(`Void strips ${name[k]}'s ${SPELLS[spellOf(k)].name}!`);
  }

  // 2. Effective power: surge (consumed) and drain debuff from last round.
  const power = {};
  for (const k of ['a', 'b']) {
    let p = active(k) ? sides[k].cast.power : 0;
    if (sides[k].status.surge && active(k)) {
      p *= SURGE_MULT;
      log.push(`${name[k]}'s Surge doubles their power!`);
    }
    if (sides[k].status.drained && active(k)) {
      p *= DRAIN_MULT;
      log.push(`${name[k]} is Drained — power reduced.`);
    }
    power[k] = p;
  }

  // 3. Nova disrupted by enemy Quake (if quake's effects aren't stripped).
  for (const k of ['a', 'b']) {
    const o = sides[k].opp;
    if (spellOf(k) === 'nova' && spellOf(o) === 'quake' && hasEffects(o)) {
      power[k] *= NOVA_DISRUPT_MULT;
      log.push(`Quake disrupts ${name[k]}'s Nova!`);
    }
  }

  // 4. Raw outgoing damage.
  const outgoing = {};
  for (const k of ['a', 'b']) {
    outgoing[k] = active(k) ? SPELLS[spellOf(k)].baseDamage * power[k] : 0;
  }

  // 5. Reflect.
  const incoming = { a: outgoing.b, b: outgoing.a }; // damage arriving at each side
  const reflectA = spellOf('a') === 'reflect' && hasEffects('a');
  const reflectB = spellOf('b') === 'reflect' && hasEffects('b');
  if (reflectA && reflectB) {
    log.push('Both mirrors face each other — everything cancels!');
    incoming.a = 0; incoming.b = 0;
  } else if (reflectA && incoming.a > 0) {
    log.push(`P1 reflects ${SPELLS[spellOf('b')].name} back at ${Math.round(REFLECT_RATIO * 100)}% power!`);
    incoming.b += incoming.a * REFLECT_RATIO;
    incoming.a = 0;
  } else if (reflectB && incoming.b > 0) {
    log.push(`P2 reflects ${SPELLS[spellOf('a')].name} back at ${Math.round(REFLECT_RATIO * 100)}% power!`);
    incoming.a += incoming.b * REFLECT_RATIO;
    incoming.b = 0;
  }

  // 6. Shield (bypassed by Pierce).
  for (const k of ['a', 'b']) {
    const o = sides[k].opp;
    if (spellOf(k) === 'shield' && hasEffects(k) && incoming[k] > 0) {
      if (spellOf(o) === 'pierce' && hasEffects(o)) {
        log.push(`${name[o]}'s Pierce goes straight through the Shield!`);
      } else {
        const absorb = Math.min(incoming[k], SHIELD_ABSORB * power[k]);
        incoming[k] -= absorb;
        log.push(`${name[k]}'s Shield absorbs ${Math.round(absorb)} damage.`);
      }
    }
  }

  // 7. Final damage + leech healing.
  const damage = { a: Math.round(incoming.a), b: Math.round(incoming.b) };
  const heal = { a: 0, b: 0 };
  for (const k of ['a', 'b']) {
    const o = sides[k].opp;
    if (spellOf(k) === 'leech' && hasEffects(k) && damage[o] > 0 && !(reflectA || reflectB)) {
      heal[k] = Math.round(damage[o] * LEECH_RATIO);
      log.push(`${name[k]} leeches ${heal[k]} HP back!`);
    }
  }

  // 8. Next-round statuses.
  const next = { a: blankStatus(), b: blankStatus() };
  for (const k of ['a', 'b']) {
    const o = sides[k].opp;
    const anchored = sides[o].status.anchor > 0;
    if (hasEffects(k)) {
      const s = spellOf(k);
      if (s === 'vortex') {
        if (anchored) log.push(`${name[o]}'s Anchor shrugs off the slow.`);
        else { next[o].slowed = true; log.push(`${name[o]} is slowed next round.`); }
      }
      if (s === 'quake') {
        if (anchored) log.push(`${name[o]}'s Anchor holds steady through the Quake.`);
        else { next[o].shaken = true; log.push(`${name[o]}'s canvas will shake next round!`); }
      }
      if (s === 'drain') { next[o].drained = true; log.push(`${name[o]}'s next spell is weakened.`); }
      if (s === 'surge') { next[k].surge = true; log.push(`${name[k]} is charging up...`); }
      if (s === 'anchor') { next[k].anchor = ANCHOR_ROUNDS; log.push(`${name[k]} drops Anchor — immune to disruption.`); }
    }
    // Carry remaining anchor rounds (a fresh anchor overrides).
    if (next[k].anchor === 0 && sides[k].status.anchor > 0) {
      next[k].anchor = sides[k].status.anchor - 1;
    }
  }

  return { damage, heal, status: next, log, power };
}
