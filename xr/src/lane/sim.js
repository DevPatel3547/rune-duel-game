// Real-time lane battle simulation — the heart of the War-of-Wizards-style game.
// Pure logic, no rendering, so it can be unit-tested and run identically on
// client and (later) server. Lane coordinate `x` runs 0..1: 0 = YOUR tower end,
// 1 = the ENEMY tower end. Your minions march 0→1, enemy minions march 1→0.

export const LANE = {
  TOWER_HP: 1000,
  MANA_MAX: 100,
  MANA_START: 40,
  MANA_REGEN: 9, // per second
  TOWER_RANGE: 0.13, // how close a minion must be for the tower to hit it
  TOWER_DPS: 26,
  ENGAGE_DIST: 0.05, // x-distance at which opposing minions lock and fight
  MINION_REACH_DPS: 55, // damage a minion does to a tower it has reached
};

// Minion archetypes — drawing different runes summons different units (Stage 4
// wires the full set; the sim already supports them all).
export const UNITS = {
  imp: { name: 'Imps', count: 3, hp: 55, atk: 16, speed: 0.072, cost: 22, color: '#7fe06a', r: 0.26 },
  brute: { name: 'Brutes', count: 2, hp: 120, atk: 24, speed: 0.05, cost: 34, color: '#ff8a4a', r: 0.34 },
  giant: { name: 'Giant', count: 1, hp: 320, atk: 30, speed: 0.034, cost: 55, color: '#c062ff', r: 0.5 },
  wisp: { name: 'Wisps', count: 4, hp: 32, atk: 11, speed: 0.1, cost: 20, color: '#5ec8ff', r: 0.2 },
};

// Direct-damage / utility spells (not summons).
export const BOLTS = {
  fireball: { kind: 'bolt', name: 'Fireball', cost: 24, dmg: 90, color: '#ff6a3a' },
  meteor: { kind: 'bolt', name: 'Meteor', cost: 40, dmg: 70, splash: true, color: '#ff3a5a' },
  heal: { kind: 'heal', name: 'Mend', cost: 26, amount: 90, color: '#6affa8' },
};

let _id = 0;
export const nextId = () => ++_id;

export function createMatch() {
  return {
    status: 'playing', // 'playing' | 'won' | 'lost'
    t: 0,
    mana: { you: LANE.MANA_START, foe: LANE.MANA_START },
    towers: {
      you: { hp: LANE.TOWER_HP, max: LANE.TOWER_HP },
      foe: { hp: LANE.TOWER_HP, max: LANE.TOWER_HP },
    },
    minions: [],
    flashes: [], // transient VFX markers {id, kind, x, born, color}
    aiTimer: 3,
  };
}

function spawnWave(state, side, unitKey) {
  const u = UNITS[unitKey];
  if (!u) return false;
  const base = side === 'you' ? 0.04 : 0.96;
  for (let i = 0; i < u.count; i++) {
    state.minions.push({
      id: nextId(), side, unit: unitKey,
      x: base + (side === 'you' ? -1 : 1) * i * 0.02,
      lane: (i - (u.count - 1) / 2) * 0.5, // visual spread across the lane width
      hp: u.hp, max: u.hp, atk: u.atk, speed: u.speed, r: u.r, color: u.color,
      engaged: false,
    });
  }
  return true;
}

// Cast a spell for `side`. Returns { ok, reason }. Spends mana on success.
export function cast(state, side, spellKey) {
  if (state.status !== 'playing') return { ok: false, reason: 'over' };
  const unit = UNITS[spellKey];
  const bolt = BOLTS[spellKey];
  const cost = unit ? unit.cost : bolt ? bolt.cost : null;
  if (cost == null) return { ok: false, reason: 'unknown' };
  if (state.mana[side] < cost) return { ok: false, reason: 'mana' };

  if (unit) {
    spawnWave(state, side, spellKey);
  } else if (bolt.kind === 'heal') {
    const tw = state.towers[side];
    tw.hp = Math.min(tw.max, tw.hp + bolt.amount);
    state.flashes.push({ id: nextId(), kind: 'heal', x: side === 'you' ? 0 : 1, born: state.t, color: bolt.color });
  } else if (bolt.kind === 'bolt') {
    // Hit the enemy minion nearest to YOUR side's frontline; if none, chip the tower.
    const foe = side === 'you' ? 'foe' : 'you';
    const targets = state.minions.filter((m) => m.side === foe);
    if (targets.length) {
      // frontline = closest to the caster
      targets.sort((a, b) => (side === 'you' ? a.x - b.x : b.x - a.x));
      const hit = targets[0];
      hit.hp -= bolt.dmg;
      if (bolt.splash) targets.slice(1, 3).forEach((m) => { m.hp -= bolt.dmg * 0.5; });
      state.flashes.push({ id: nextId(), kind: 'bolt', x: hit.x, born: state.t, color: bolt.color });
    } else {
      state.towers[foe].hp -= bolt.dmg * 0.5;
      state.flashes.push({ id: nextId(), kind: 'bolt', x: foe === 'foe' ? 1 : 0, born: state.t, color: bolt.color });
    }
  }
  state.mana[side] -= cost;
  return { ok: true };
}

// Advance the whole match by dt seconds (call with small fixed steps).
export function step(state, dt) {
  if (state.status !== 'playing') return state;
  state.t += dt;

  // mana regen
  state.mana.you = Math.min(LANE.MANA_MAX, state.mana.you + LANE.MANA_REGEN * dt);
  state.mana.foe = Math.min(LANE.MANA_MAX, state.mana.foe + LANE.MANA_REGEN * dt);

  const mins = state.minions;

  // 1) reset engagement, then find melee pairs
  for (const m of mins) m.engaged = false;
  for (let i = 0; i < mins.length; i++) {
    const a = mins[i];
    for (let j = i + 1; j < mins.length; j++) {
      const b = mins[j];
      if (a.side === b.side) continue;
      if (Math.abs(a.x - b.x) <= LANE.ENGAGE_DIST) {
        a.engaged = b.engaged = true;
        a.hp -= b.atk * dt;
        b.hp -= a.atk * dt;
      }
    }
  }

  // 2) towers shoot the nearest enemy minion in range; minions that reached a
  //    tower chew on it; un-engaged minions advance.
  const youFront = []; const foeFront = [];
  for (const m of mins) {
    const atEnemyTower = m.side === 'you' ? m.x >= 0.97 : m.x <= 0.03;
    if (atEnemyTower) {
      const tw = m.side === 'you' ? state.towers.foe : state.towers.you;
      tw.hp -= LANE.MINION_REACH_DPS * dt;
      m.x = m.side === 'you' ? 0.97 : 0.03;
      continue;
    }
    if (!m.engaged) m.x += (m.side === 'you' ? 1 : -1) * m.speed * dt;
    if (m.side === 'you' && m.x > 1 - LANE.TOWER_RANGE) foeFront.push(m); // near foe tower
    if (m.side === 'foe' && m.x < LANE.TOWER_RANGE) youFront.push(m); // near your tower
  }
  // your tower defends (hits closest foe minion), foe tower defends likewise
  const closestTo = (arr, end) => arr.sort((a, b) => Math.abs(a.x - end) - Math.abs(b.x - end))[0];
  const yt = closestTo(youFront, 0); if (yt) yt.hp -= LANE.TOWER_DPS * dt;
  const ft = closestTo(foeFront, 1); if (ft) ft.hp -= LANE.TOWER_DPS * dt;

  // 3) cull the dead, expire flashes
  state.minions = mins.filter((m) => m.hp > 0);
  state.flashes = state.flashes.filter((f) => state.t - f.born < 0.6);

  // 4) win / loss
  if (state.towers.foe.hp <= 0) { state.towers.foe.hp = 0; state.status = 'won'; }
  else if (state.towers.you.hp <= 0) { state.towers.you.hp = 0; state.status = 'lost'; }

  return state;
}

// Dead-simple AI: bank mana, then push a wave; harder = pushes sooner/bigger.
export function stepAI(state, dt, difficulty = 'normal') {
  if (state.status !== 'playing') return;
  const cfg = {
    easy: { every: 7, prefer: ['imp', 'wisp'] },
    normal: { every: 5, prefer: ['imp', 'brute', 'wisp'] },
    hard: { every: 3.5, prefer: ['brute', 'giant', 'imp'] },
  }[difficulty] || { every: 5, prefer: ['imp', 'brute'] };

  state.aiTimer -= dt;
  if (state.aiTimer <= 0) {
    state.aiTimer = cfg.every;
    const affordable = cfg.prefer.filter((k) => UNITS[k].cost <= state.mana.foe);
    const pick = affordable[Math.floor(Math.random() * affordable.length)] || cfg.prefer[0];
    cast(state, 'foe', pick);
  }
}
