// Top-down 2.5D battlefield renderer. Pure draw from game state; no mutation.
import { FIELD, WIZARD, MINION, METEOR, CRYSTAL_HP } from './content.js';

// Field space (0..1, 0..1) → canvas pixels. Lane is a portrait strip.
const px = (fx, w) => fx * w;
const py = (fy, h) => fy * h;

export function draw(ctx, game, view) {
  const { w, h } = view;
  ctx.clearRect(0, 0, w, h);

  drawBackground(ctx, w, h);
  drawLane(ctx, w, h);
  drawCrystal(ctx, game.enemy.crystal, w, h, FIELD.enemyCrystalY, '#ff5a6e', game.t);
  drawCrystal(ctx, game.player.crystal, w, h, FIELD.playerCrystalY, '#4ab7ff', game.t);

  for (const m of game.minions) drawMinion(ctx, m, w, h, game.t);
  for (const pr of game.projectiles) drawProjectile(ctx, pr, w, h);
  drawWizard(ctx, game.enemy.wizardX, WIZARD.enemyY, w, h, '#ff8b9a', false);
  drawWizard(ctx, game.player.wizardX, WIZARD.y, w, h, '#7fd4ff', game.player.stunUntil > game.t);
  if (game.meteor) drawMeteor(ctx, game.meteor, w, h, game.t);
  for (const b of game.bursts) drawBurst(ctx, b, w, h, game.t);
  for (const f of game.floaters) drawFloater(ctx, f, w, h, game.t);

  if (view.stroke && view.stroke.length > 1) drawStroke(ctx, view.stroke, view.strokeColor || '#8ab0ff');
}

function drawBackground(ctx, w, h) {
  const g = ctx.createLinearGradient(0, 0, 0, h);
  g.addColorStop(0, '#241326');
  g.addColorStop(0.5, '#161225');
  g.addColorStop(1, '#0f1a26');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
}

function drawLane(ctx, w, h) {
  const x0 = px(FIELD.laneMinX, w), x1 = px(FIELD.laneMaxX, w);
  const g = ctx.createLinearGradient(x0, 0, x1, 0);
  g.addColorStop(0, 'rgba(120,140,255,0.05)');
  g.addColorStop(0.5, 'rgba(150,120,255,0.12)');
  g.addColorStop(1, 'rgba(120,140,255,0.05)');
  ctx.fillStyle = g;
  ctx.fillRect(x0, 0, x1 - x0, h);
  ctx.strokeStyle = 'rgba(150,170,255,0.15)';
  ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(x0, 0); ctx.lineTo(x0, h); ctx.moveTo(x1, 0); ctx.lineTo(x1, h); ctx.stroke();
}

function drawCrystal(ctx, crystal, w, h, fy, color, t) {
  const cx = px(0.5, w), cy = py(fy, h);
  const r = Math.min(w, h) * 0.06;
  const frac = Math.max(0, crystal.hp / crystal.maxHp);

  // Ward bubble.
  if (crystal.wardUntil > t && crystal.ward > 0) {
    ctx.beginPath();
    ctx.arc(cx, cy, r * 1.9, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(74,183,255,0.5)';
    ctx.lineWidth = 3;
    ctx.stroke();
    ctx.fillStyle = 'rgba(74,183,255,0.08)';
    ctx.fill();
  }

  // Crystal gem (diamond).
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(Math.PI / 4);
  ctx.shadowColor = color; ctx.shadowBlur = 24 * frac + 6;
  ctx.fillStyle = color;
  ctx.globalAlpha = 0.35 + 0.55 * frac;
  ctx.fillRect(-r * 0.7, -r * 0.7, r * 1.4, r * 1.4);
  ctx.globalAlpha = 1;
  ctx.shadowBlur = 0;
  ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.5;
  ctx.strokeRect(-r * 0.7, -r * 0.7, r * 1.4, r * 1.4);
  ctx.restore();

  // HP bar under/over the crystal.
  const barW = r * 2.6, barH = 7;
  const by = fy < 0.5 ? cy + r * 1.4 : cy - r * 1.4 - barH;
  ctx.fillStyle = 'rgba(0,0,0,0.5)';
  ctx.fillRect(cx - barW / 2, by, barW, barH);
  ctx.fillStyle = frac > 0.5 ? '#5ee08a' : frac > 0.25 ? '#ffcc4a' : '#ff5a6e';
  ctx.fillRect(cx - barW / 2, by, barW * frac, barH);
  ctx.strokeStyle = 'rgba(255,255,255,0.3)';
  ctx.strokeRect(cx - barW / 2, by, barW, barH);
  ctx.fillStyle = '#fff';
  ctx.font = '600 11px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText(`${Math.ceil(crystal.hp)}`, cx, by + barH + 11);
}

function drawWizard(ctx, fx, fy, w, h, color, stunned) {
  const cx = px(fx, w), cy = py(fy, h);
  const r = WIZARD.radius * Math.min(w, h);
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fillStyle = color;
  ctx.shadowColor = color; ctx.shadowBlur = 14;
  ctx.fill();
  ctx.shadowBlur = 0;
  ctx.font = `${r * 1.3}px system-ui`;
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText(stunned ? '💫' : '🧙', cx, cy);
  ctx.textBaseline = 'alphabetic';
}

function drawMinion(ctx, m, w, h, t) {
  const cx = px(m.x, w), cy = py(m.y, h);
  const r = MINION.radius * Math.min(w, h);
  const buffed = m.buffUntil > t;
  const color = m.side === 'p' ? '#6cc5ff' : '#ff7a8a';
  if (buffed) {
    ctx.beginPath(); ctx.arc(cx, cy, r * 1.5, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(255,255,255,0.8)'; ctx.lineWidth = 2; ctx.stroke();
  }
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fillStyle = color;
  ctx.shadowColor = color; ctx.shadowBlur = 8; ctx.fill(); ctx.shadowBlur = 0;
  ctx.font = `${r * 1.4}px system-ui`;
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText('👹', cx, cy);
  ctx.textBaseline = 'alphabetic';
  // hp ring
  const frac = Math.max(0, m.hp / m.maxHp);
  ctx.beginPath();
  ctx.arc(cx, cy, r + 3, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * frac);
  ctx.strokeStyle = frac > 0.4 ? '#8affc0' : '#ff5a6e';
  ctx.lineWidth = 2.5; ctx.stroke();
}

function drawProjectile(ctx, pr, w, h) {
  const cx = px(pr.x, w), cy = py(pr.y, h);
  ctx.beginPath();
  ctx.arc(cx, cy, 6, 0, Math.PI * 2);
  ctx.fillStyle = '#ffe58a';
  ctx.shadowColor = '#ffd24a'; ctx.shadowBlur = 16; ctx.fill(); ctx.shadowBlur = 0;
}

function drawMeteor(ctx, mt, w, h, t) {
  const cx = px(mt.x, w), cy = py(mt.y, h);
  const r = METEOR.radius * Math.min(w, h);
  const prog = (t - mt.castAt) / (mt.landAt - mt.castAt);
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.strokeStyle = `rgba(255,90,60,${0.5 + 0.4 * Math.sin(t * 18)})`;
  ctx.lineWidth = 3; ctx.stroke();
  ctx.fillStyle = 'rgba(255,90,60,0.12)'; ctx.fill();
  // closing reticle
  ctx.beginPath();
  ctx.arc(cx, cy, r * (1 - prog), 0, Math.PI * 2);
  ctx.strokeStyle = 'rgba(255,180,80,0.9)'; ctx.lineWidth = 2; ctx.stroke();
}

function drawBurst(ctx, b, w, h, t) {
  const prog = (t - b.born) / b.life;
  const cx = px(b.x, w), cy = py(b.y, h);
  const r = b.maxR * Math.min(w, h) * (0.3 + prog);
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.strokeStyle = b.color;
  ctx.globalAlpha = 1 - prog;
  ctx.lineWidth = 4; ctx.stroke();
  ctx.globalAlpha = 1;
}

function drawFloater(ctx, f, w, h, t) {
  const age = t - f.born;
  const cx = px(f.x, w), cy = py(f.y, h) - age * 40;
  ctx.globalAlpha = Math.max(0, 1 - age / 0.9);
  ctx.fillStyle = f.color;
  ctx.font = '700 14px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText(f.text, cx, cy);
  ctx.globalAlpha = 1;
}

function drawStroke(ctx, pts, color) {
  ctx.beginPath();
  pts.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
  ctx.strokeStyle = color;
  ctx.lineWidth = 5; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  ctx.shadowColor = color; ctx.shadowBlur = 16; ctx.stroke(); ctx.shadowBlur = 0;
}
