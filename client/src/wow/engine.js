// War of Wizards — authoritative real-time simulation (flat-screen).
// Pure-ish: everything lives on a `game` state object; step() advances it by dt.
// Both the human and the AI act through the same castSpell()/moveWizard() API,
// so the two sides obey identical rules.

import { FIELD, CRYSTAL_HP, MANA, WIZARD, MINION, METEOR, WAR_SPELLS, STARTER_HAND } from './content.js';

const LANE_LEN = FIELD.playerCrystalY - FIELD.enemyCrystalY; // vertical travel span

let _id = 1;
const nextId = () => _id++;

export function createGame({ difficulty = 'adept' } = {}) {
  const mkSide = () => ({
    mana: MANA.start,
    cooldowns: {},          // spellId -> time (game.t) when castable again
    crystal: { hp: CRYSTAL_HP, maxHp: CRYSTAL_HP, ward: 0, wardUntil: 0 },
  });
  return {
    t: 0,
    status: 'playing',      // 'playing' | 'won' | 'lost'
    difficulty,
    hand: [...STARTER_HAND],
    player: { ...mkSide(), wizardX: 0.5, stunUntil: 0 },
    enemy:  { ...mkSide(), wizardX: 0.5, ai: { nextThink: 0.8 } },
    minions: [],            // { id, side:'p'|'e', x, y, hp, maxHp, buffUntil }
    projectiles: [],        // { id, side, x, y, ty, damage, spellId }
    bursts: [],             // transient visuals { x, y, r, maxR, born, life, color }
    meteor: null,           // { x, y, castAt, landAt } — enemy's dodgeable attack
    floaters: [],           // damage numbers { x, y, text, born, color }
    lastCast: null,         // { side, spellId, power, t } for UI feedback
  };
}

const sideState = (game, side) => (side === 'p' ? game.player : game.enemy);
const foeState  = (game, side) => (side === 'p' ? game.enemy : game.player);

// Where a freshly summoned unit / fired projectile starts, and where it aims.
const homeCrystalY = (side) => (side === 'p' ? FIELD.playerCrystalY : FIELD.enemyCrystalY);
const foeCrystalY  = (side) => (side === 'p' ? FIELD.enemyCrystalY : FIELD.playerCrystalY);
const wizardRow    = (side) => (side === 'p' ? WIZARD.y : WIZARD.enemyY);

function addFloater(game, x, y, text, color) {
  game.floaters.push({ x, y, text, color, born: game.t });
}

// ── Casting ──────────────────────────────────────────────────────────────
// power is 0..1 (accuracy×0.6 + speed×0.4). target is field-space {x,y} of the
// drawn stroke's centroid (used by aoe spells). Returns { ok, reason }.
export function castSpell(game, side, spellId, power, target) {
  const spell = WAR_SPELLS[spellId];
  if (!spell) return { ok: false, reason: 'unknown' };
  const S = sideState(game, side);
  if (game.t < (S.cooldowns[spellId] || 0)) return { ok: false, reason: 'cooldown' };
  if (S.mana < spell.cost) return { ok: false, reason: 'mana' };

  S.mana -= spell.cost;
  S.cooldowns[spellId] = game.t + spell.cooldownSec;
  game.lastCast = { side, spellId, power, t: game.t };
  const p = Math.max(0.15, Math.min(1, power));

  switch (spell.kind) {
    case 'projectile': {
      const sx = side === 'p' ? game.player.wizardX : game.enemy.wizardX;
      game.projectiles.push({
        id: nextId(), side, x: sx, y: wizardRow(side),
        ty: foeCrystalY(side), damage: spell.damage * p, spellId,
      });
      break;
    }
    case 'summon': {
      const n = Math.round(spell.countBase + spell.countBonus * p);
      for (let i = 0; i < n; i++) {
        const spread = (i - (n - 1) / 2) * 0.075;
        const x = clampLane(0.5 + spread + (Math.random() - 0.5) * 0.03);
        game.minions.push({
          id: nextId(), side, x,
          y: homeCrystalY(side) + (side === 'p' ? -0.02 : 0.02),
          hp: MINION.hp * (0.7 + 0.5 * p), maxHp: MINION.hp * (0.7 + 0.5 * p),
          buffUntil: 0,
        });
      }
      break;
    }
    case 'aoe': {
      const tx = target ? clampLane(target.x) : 0.5;
      const ty = target ? clamp01(target.y) : foeCrystalY(side);
      game.bursts.push({ x: tx, y: ty, r: 0, maxR: spell.radius, born: game.t, life: 0.45, color: spell.color });
      const foeSide = side === 'p' ? 'e' : 'p';
      let hits = 0;
      for (const m of game.minions) {
        if (m.side !== foeSide) continue;
        if (Math.hypot(m.x - tx, m.y - ty) <= spell.radius) {
          m.hp -= spell.damage * p; hits++;
        }
      }
      // Nova / quake also singe the enemy crystal if burst overlaps it.
      const fc = foeCrystalY(side);
      if (Math.abs(ty - fc) <= spell.radius && Math.abs(tx - 0.5) <= spell.radius) {
        damageCrystal(game, foeState(game, side), spell.damage * p * 0.6, 0.5, fc);
      }
      if (hits) addFloater(game, tx, ty, `${hits}×`, spell.color);
      break;
    }
    case 'ward': {
      const c = S.crystal;
      c.ward = Math.max(c.ward, spell.absorb * p);
      c.wardUntil = game.t + spell.durationSec;
      break;
    }
    case 'buff': {
      for (const m of game.minions) if (sideChar(side) === m.side) m.buffUntil = game.t + spell.durationSec;
      break;
    }
    default: break;
  }
  return { ok: true };
}

const sideChar = (side) => side; // 'p'|'e' already

// Enemy lobs a telegraphed meteor at the player's wizard — the dodge test.
export function launchMeteor(game) {
  game.meteor = {
    x: game.player.wizardX, y: WIZARD.y,
    castAt: game.t, landAt: game.t + METEOR.telegraphSec,
  };
}

export function moveWizard(game, side, x) {
  const S = sideState(game, side);
  S.wizardX = clampLane(x);
}

function damageCrystal(game, foe, amount, x, y) {
  if (foe.crystal.wardUntil > game.t && foe.crystal.ward > 0) {
    const absorbed = Math.min(foe.crystal.ward, amount);
    foe.crystal.ward -= absorbed;
    amount -= absorbed;
    addFloater(game, x, y, `⛨${Math.round(absorbed)}`, '#4ab7ff');
    if (foe.crystal.ward <= 0) foe.crystal.wardUntil = 0;
  }
  if (amount > 0) {
    foe.crystal.hp -= amount;
    addFloater(game, x, y, `-${Math.round(amount)}`, '#ff5a6e');
  }
}

// ── Simulation step ────────────────────────────────────────────────────────
export function step(game, dt) {
  if (game.status !== 'playing') return;
  game.t += dt;

  // Mana regen.
  game.player.mana = Math.min(MANA.max, game.player.mana + MANA.regenPerSec * dt);
  game.enemy.mana = Math.min(MANA.max, game.enemy.mana + MANA.regenPerSec * dt);

  stepMeteor(game);
  stepMinions(game, dt);
  stepProjectiles(game, dt);
  reap(game);
  expireVisuals(game);

  if (game.enemy.crystal.hp <= 0) { game.enemy.crystal.hp = 0; game.status = 'won'; }
  else if (game.player.crystal.hp <= 0) { game.player.crystal.hp = 0; game.status = 'lost'; }
}

function stepMeteor(game) {
  const mt = game.meteor;
  if (!mt) return;
  if (game.t >= mt.landAt) {
    const wx = game.player.wizardX;
    game.bursts.push({ x: mt.x, y: mt.y, r: 0, maxR: METEOR.radius, born: game.t, life: 0.4, color: '#ff7a3a' });
    if (Math.abs(wx - mt.x) <= METEOR.radius) {
      // Caught in the blast — stunned, lose mana.
      game.player.stunUntil = game.t + WIZARD.hitStunSec;
      game.player.mana = Math.max(0, game.player.mana - WIZARD.hitManaLoss);
      addFloater(game, mt.x, mt.y, 'HIT!', '#ff5a6e');
    } else {
      addFloater(game, mt.x, mt.y, 'dodged', '#8affc0');
    }
    game.meteor = null;
  }
}

function stepMinions(game, dt) {
  for (const m of game.minions) {
    const buffed = m.buffUntil > game.t;
    const dmgMult = buffed ? WAR_SPELLS.rally.dmgMult : 1;
    const spdMult = buffed ? WAR_SPELLS.rally.speedMult : 1;
    const dir = m.side === 'p' ? -1 : 1; // p walks up (y down), e walks down
    const foe = m.side === 'p' ? 'e' : 'p';

    // Find the nearest opposing minion in this minion's lane band.
    let engaged = null, best = MINION.aggroRange;
    for (const o of game.minions) {
      if (o.side !== foe) continue;
      if (Math.abs(o.x - m.x) > 0.14) continue;
      const d = Math.abs(o.y - m.y);
      if (d < best) { best = d; engaged = o; }
    }

    if (engaged) {
      engaged.hp -= MINION.contactDPS * dmgMult * dt;
    } else {
      // March toward the enemy crystal.
      const speed = (LANE_LEN / MINION.crossSec) * spdMult;
      m.y += dir * speed * dt;
      const fc = m.side === 'p' ? FIELD.enemyCrystalY : FIELD.playerCrystalY;
      const reached = m.side === 'p' ? m.y <= fc + 0.02 : m.y >= fc - 0.02;
      if (reached) {
        m.y = fc + (m.side === 'p' ? 0.02 : -0.02);
        const foeSide = m.side === 'p' ? game.enemy : game.player;
        damageCrystal(game, foeSide, MINION.contactDPS * dmgMult * dt, m.x, fc);
      }
    }
  }
}

function stepProjectiles(game, dt) {
  const SPEED = 0.9; // field-units per second, straight up/down the lane
  for (const pr of game.projectiles) {
    const dir = pr.side === 'p' ? -1 : 1;
    pr.y += dir * SPEED * dt;
    const foe = pr.side === 'p' ? 'e' : 'p';

    // Hit the first opposing minion it passes.
    let hitM = null, bestD = 0.05;
    for (const m of game.minions) {
      if (m.side !== foe) continue;
      const d = Math.hypot(m.x - pr.x, m.y - pr.y);
      if (d < bestD) { bestD = d; hitM = m; }
    }
    if (hitM) {
      hitM.hp -= pr.damage;
      addFloater(game, hitM.x, hitM.y, `-${Math.round(pr.damage)}`, '#ffd24a');
      pr._dead = true;
      continue;
    }
    // Reached the enemy crystal.
    const fc = foeCrystalY(pr.side);
    const past = pr.side === 'p' ? pr.y <= fc : pr.y >= fc;
    if (past) {
      const foeSide = pr.side === 'p' ? game.enemy : game.player;
      damageCrystal(game, foeSide, pr.damage, pr.x, fc);
      pr._dead = true;
    }
  }
  game.projectiles = game.projectiles.filter((p) => !p._dead);
}

function reap(game) {
  game.minions = game.minions.filter((m) => {
    if (m.hp > 0) return true;
    game.bursts.push({ x: m.x, y: m.y, r: 0, maxR: 0.04, born: game.t, life: 0.25, color: '#888' });
    return false;
  });
}

function expireVisuals(game) {
  game.bursts = game.bursts.filter((b) => game.t - b.born < b.life);
  game.floaters = game.floaters.filter((f) => game.t - f.born < 0.9);
  for (const s of ['player', 'enemy']) {
    const c = game[s].crystal;
    if (c.wardUntil <= game.t) { c.ward = 0; }
  }
}

// Helpers exported for UI (mana/cooldown affordance).
export function canCast(game, side, spellId) {
  const spell = WAR_SPELLS[spellId];
  const S = sideState(game, side);
  return S.mana >= spell.cost && game.t >= (S.cooldowns[spellId] || 0);
}
export function cooldownLeft(game, side, spellId) {
  const S = sideState(game, side);
  return Math.max(0, (S.cooldowns[spellId] || 0) - game.t);
}

function clamp01(v) { return Math.max(0, Math.min(1, v)); }
function clampLane(v) { return Math.max(FIELD.laneMinX, Math.min(FIELD.laneMaxX, v)); }
