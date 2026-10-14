import { useMemo } from 'react';
import * as THREE from 'three';
import { TEMPLATES } from '@rune/shared';

// Draws a rune template as a glowing line in a unit-ish card, so the player can
// see the exact shape (and stroke direction, via the brightening tip) to trace.
export default function RunePreview({ spellId, size = 0.26, color = '#cdebff' }) {
  const { geom, mat } = useMemo(() => {
    const raw = TEMPLATES[spellId] || [];
    // normalize the template into a centered [-0.5,0.5] box, y-up
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const p of raw) { minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x); minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y); }
    const w = Math.max(maxX - minX, 1e-3); const h = Math.max(maxY - minY, 1e-3);
    const sc = size / Math.max(w, h);
    const positions = new Float32Array(raw.length * 3);
    raw.forEach((p, i) => {
      positions[i * 3] = ((p.x - (minX + maxX) / 2)) * sc;
      positions[i * 3 + 1] = -((p.y - (minY + maxY) / 2)) * sc; // flip to y-up
      positions[i * 3 + 2] = 0;
    });
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    const m = new THREE.LineBasicMaterial({ color, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false });
    return { geom: g, mat: m };
  }, [spellId, size, color]);

  return <line><primitive object={geom} attach="geometry" /><primitive object={mat} attach="material" /></line>;
}
