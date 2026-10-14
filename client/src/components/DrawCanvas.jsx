import { useRef, useEffect, useCallback } from 'react';
import { TEMPLATES, SPELLS } from '@rune/shared';

// The drawing surface. Renders a glowing ink trail as you draw, optionally a
// faint ghost outline of the target rune, and reports the raw stroke +
// elapsed time on pointer-up.
export default function DrawCanvas({ spellId, ghost, shaking, disabled, onComplete }) {
  const wrapRef = useRef(null);
  const canvasRef = useRef(null);
  const stroke = useRef({ points: [], drawing: false, startTime: 0 });

  const color = spellId ? SPELLS[spellId].color : '#6c8cff';

  const redraw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const dpr = window.devicePixelRatio || 1;
    const w = canvas.width / dpr;
    const h = canvas.height / dpr;
    ctx.clearRect(0, 0, w, h);

    // Ghost outline of the target rune.
    if (ghost && spellId && TEMPLATES[spellId]) {
      const pad = Math.min(w, h) * 0.18;
      const size = Math.min(w, h) - pad * 2;
      const ox = (w - size) / 2;
      const oy = (h - size) / 2;
      ctx.beginPath();
      const pts = TEMPLATES[spellId];
      pts.forEach((p, i) => {
        const x = ox + p.x * size;
        const y = oy + p.y * size;
        if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      });
      ctx.strokeStyle = 'rgba(138, 150, 184, 0.22)';
      ctx.lineWidth = 10;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.setLineDash([2, 14]);
      ctx.stroke();
      ctx.setLineDash([]);
      // Start dot so players know where the stroke begins.
      ctx.beginPath();
      ctx.arc(ox + pts[0].x * size, oy + pts[0].y * size, 7, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(255, 210, 74, 0.45)';
      ctx.fill();
    }

    // The player's ink trail.
    const pts = stroke.current.points;
    if (pts.length > 1) {
      ctx.beginPath();
      pts.forEach((p, i) => { if (i === 0) ctx.moveTo(p.x, p.y); else ctx.lineTo(p.x, p.y); });
      ctx.strokeStyle = color;
      ctx.lineWidth = 5;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.shadowColor = color;
      ctx.shadowBlur = 16;
      ctx.stroke();
      ctx.shadowBlur = 0;
    }
  }, [ghost, spellId, color]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (!canvas || !wrap) return;
    const resize = () => {
      const dpr = window.devicePixelRatio || 1;
      const rect = wrap.getBoundingClientRect();
      canvas.width = rect.width * dpr;
      canvas.height = rect.height * dpr;
      canvas.getContext('2d').setTransform(dpr, 0, 0, dpr, 0, 0);
      redraw();
    };
    resize();
    const obs = new ResizeObserver(resize);
    obs.observe(wrap);
    return () => obs.disconnect();
  }, [redraw]);

  // Clear the trail whenever the target spell changes.
  useEffect(() => {
    stroke.current = { points: [], drawing: false, startTime: 0 };
    redraw();
  }, [spellId, redraw]);

  const getPos = (e) => {
    const rect = canvasRef.current.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  };

  const onDown = (e) => {
    if (disabled) return;
    e.preventDefault();
    canvasRef.current.setPointerCapture(e.pointerId);
    stroke.current = { points: [getPos(e)], drawing: true, startTime: performance.now() };
    redraw();
  };

  const onMove = (e) => {
    if (!stroke.current.drawing) return;
    e.preventDefault();
    const events = e.getCoalescedEvents ? e.getCoalescedEvents() : [e];
    for (const ev of events) stroke.current.points.push(getPos(ev));
    redraw();
  };

  const onUp = (e) => {
    if (!stroke.current.drawing) return;
    e.preventDefault();
    stroke.current.drawing = false;
    const elapsed = (performance.now() - stroke.current.startTime) / 1000;
    const points = stroke.current.points;
    if (points.length >= 8) {
      onComplete(points, elapsed);
    } else {
      stroke.current.points = []; // accidental tap — let them try again
      redraw();
    }
  };

  return (
    <div ref={wrapRef} className={`canvas-wrap${disabled ? '' : ' glow'}${shaking ? ' shaking' : ''}`}>
      <canvas
        ref={canvasRef}
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={onUp}
      />
      {!disabled && stroke.current.points.length === 0 && (
        <div className="canvas-hint">draw the rune in one stroke</div>
      )}
    </div>
  );
}
