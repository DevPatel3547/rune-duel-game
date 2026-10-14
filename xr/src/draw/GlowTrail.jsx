import { useMemo, useEffect } from 'react';
import * as THREE from 'three';

const CAP = 1024;

// A soft round sprite so each sample reads as a glowing orb, not a hard square.
let DOT_TEX = null;
function dotTexture() {
  if (DOT_TEX) return DOT_TEX;
  const s = 64;
  const c = document.createElement('canvas');
  c.width = c.height = s;
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.35, 'rgba(255,255,255,0.85)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, s, s);
  DOT_TEX = new THREE.CanvasTexture(c);
  return DOT_TEX;
}

// Renders a stroke (array of [x,y,z] world points) as an additive glowing
// ribbon of orbs plus a connecting core line. Updates cheaply in place.
export default function GlowTrail({ points, color = '#9fd8ff', size = 0.05, opacity = 1 }) {
  const { geometry, pointsMat, lineMat, line, pts } = useMemo(() => {
    const geo = new THREE.BufferGeometry();
    const arr = new Float32Array(CAP * 3);
    const attr = new THREE.BufferAttribute(arr, 3);
    attr.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('position', attr);
    const pm = new THREE.PointsMaterial({
      size, map: dotTexture(), transparent: true, depthWrite: false,
      blending: THREE.AdditiveBlending, sizeAttenuation: true,
    });
    const lm = new THREE.LineBasicMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0.5,
    });
    return {
      geometry: geo, pointsMat: pm, lineMat: lm,
      line: new THREE.Line(geo, lm), pts: new THREE.Points(geo, pm),
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Push the latest points into the shared buffer.
  useEffect(() => {
    const arr = geometry.attributes.position.array;
    const n = Math.min(points.length, CAP);
    for (let i = 0; i < n; i++) {
      arr[i * 3] = points[i][0];
      arr[i * 3 + 1] = points[i][1];
      arr[i * 3 + 2] = points[i][2];
    }
    geometry.setDrawRange(0, n);
    geometry.attributes.position.needsUpdate = true;
    geometry.computeBoundingSphere();
  }, [points, geometry]);

  useEffect(() => {
    const col = new THREE.Color(color);
    pointsMat.color = col;
    lineMat.color = col;
    pointsMat.size = size;
    pointsMat.opacity = opacity;
    lineMat.opacity = 0.5 * opacity;
  }, [color, size, opacity, pointsMat, lineMat]);

  useEffect(() => () => {
    geometry.dispose(); pointsMat.dispose(); lineMat.dispose();
  }, [geometry, pointsMat, lineMat]);

  return (
    <>
      <primitive object={line} />
      <primitive object={pts} />
    </>
  );
}
