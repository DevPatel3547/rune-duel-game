import * as THREE from 'three';

// ============================================================================
// CEL SHADING
//
// A deliberate pivot away from chasing photorealism. Stylisation is not a
// consolation prize here — it is the correct call. Realism is a race against
// hand-sculpted assets and motion capture that a runtime-generated browser game
// cannot win; anime styling is a race against ART DIRECTION, which is winnable,
// and it is what the reference material (JJK, Demon Slayer) actually looks
// like.
//
// Three techniques carry the whole look:
//
//   1. BANDED LIGHTING. Instead of a smooth diffuse falloff, dot(N,L) is
//      quantised into a few discrete steps, giving the hard light/shadow
//      terminator that reads as painted cel art. Done with a gradient map:
//      a tiny 1-D texture sampled with NEAREST filtering, which is the
//      cheapest possible way to express the ramp and lets the number and
//      placement of bands be art-directed rather than hard-coded.
//
//   2. INVERTED HULL OUTLINES. A duplicate of the mesh, normals flipped,
//      pushed out along its normals and rendered with front-face culling. The
//      result is a black silhouette peeking out around every edge. This
//      dominates game production over post-process edge detection because it
//      costs one extra draw call instead of a full screen pass, and the line
//      weight can vary per object.
//
//   3. RIM LIGHT. A bright fringe where the surface turns away from the
//      camera. Near-essential in this style: it separates a dark character
//      from a dark background, which flat banded shading otherwise fails to do.
// ============================================================================

const rampCache = new Map();

// Build the 1-D lighting ramp. `stops` are the band boundaries in 0..1; the
// value between two stops is flat, which is the entire point.
export function toonRamp(stops = [0.32, 0.62], levels = [0.18, 0.62, 1.0]) {
  const key = stops.join(',') + '|' + levels.join(',');
  if (rampCache.has(key)) return rampCache.get(key);

  const W = 64;
  const data = new Uint8Array(W * 4);
  for (let i = 0; i < W; i++) {
    const t = i / (W - 1);
    let band = 0;
    for (let s = 0; s < stops.length; s++) if (t >= stops[s]) band = s + 1;
    const v = Math.round(THREE.MathUtils.clamp(levels[band] ?? 1, 0, 1) * 255);
    data[i * 4] = data[i * 4 + 1] = data[i * 4 + 2] = v;
    data[i * 4 + 3] = 255;
  }
  const tex = new THREE.DataTexture(data, W, 1, THREE.RGBAFormat);
  // NEAREST is mandatory: linear filtering re-introduces the smooth gradient
  // the banding exists to remove.
  tex.minFilter = tex.magFilter = THREE.NearestFilter;
  tex.generateMipmaps = false;
  tex.needsUpdate = true;
  rampCache.set(key, tex);
  return tex;
}

// A cel-shaded material. Optionally keeps a colour/normal map so scanned
// texture detail still shows through the banding.
export function toonMaterial({
  color = '#ffffff',
  map = null,
  normalMap = null,
  normalScale = 0.6,
  rimColor = '#8fe8ff',
  rimPower = 2.6,
  rimStrength = 0.55,
  stops,
  levels,
  side = THREE.FrontSide,
  transparent = false,
} = {}) {
  const mat = new THREE.MeshToonMaterial({
    color: new THREE.Color(color),
    gradientMap: toonRamp(stops, levels),
    map, normalMap, side, transparent,
  });
  if (normalMap) mat.normalScale = new THREE.Vector2(normalScale, normalScale);

  mat.userData.rim = {
    color: { value: new THREE.Color(rimColor) },
    power: { value: rimPower },
    strength: { value: rimStrength },
  };

  // Rim light injected into the toon material's fragment stage. Added AFTER
  // lighting so it is a true fringe rather than something the shading can
  // darken away.
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uRimColor = mat.userData.rim.color;
    shader.uniforms.uRimPower = mat.userData.rim.power;
    shader.uniforms.uRimStrength = mat.userData.rim.strength;

    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
        uniform vec3 uRimColor;
        uniform float uRimPower;
        uniform float uRimStrength;`)
      .replace('#include <dithering_fragment>', `
        {
          vec3 V = normalize(vViewPosition);
          float rim = 1.0 - clamp(dot(normalize(normal), V), 0.0, 1.0);
          rim = pow(rim, uRimPower);
          gl_FragColor.rgb += uRimColor * rim * uRimStrength;
        }
        #include <dithering_fragment>`);
  };

  return mat;
}

// The outline shell. Rendered with FRONT faces culled so only the parts of the
// expanded hull that sit *behind* the real mesh survive, appearing as a line
// around the silhouette.
export function outlineMaterial({ color = '#08060c', thickness = 0.012 } = {}) {
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    uniforms: {
      uColor: { value: new THREE.Color(color) },
      uThickness: { value: thickness },
    },
    vertexShader: /* glsl */`
      uniform float uThickness;
      void main() {
        // Expand along the normal in VIEW space, scaled by depth, so the line
        // keeps a constant apparent weight instead of thinning with distance.
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vec3 n = normalize(normalMatrix * normal);
        mv.xyz += n * uThickness * -mv.z;
        gl_Position = projectionMatrix * mv;
      }
    `,
    fragmentShader: /* glsl */`
      uniform vec3 uColor;
      void main() { gl_FragColor = vec4(uColor, 1.0); }
    `,
  });
  return mat;
}

// Give an object a cel outline by adding a mirrored shell of every mesh in it.
export function addOutline(root, { thickness = 0.012, color = '#08060c' } = {}) {
  const shells = [];
  root.traverse((o) => {
    if (!o.isMesh && !o.isSkinnedMesh) return;
    if (o.userData.isOutline) return;
    const shell = o.isSkinnedMesh
      ? new THREE.SkinnedMesh(o.geometry, outlineMaterial({ thickness, color }))
      : new THREE.Mesh(o.geometry, outlineMaterial({ thickness, color }));
    if (o.isSkinnedMesh) {
      // Share the skeleton so the outline deforms with the character rather
      // than floating in bind pose.
      shell.bind(o.skeleton, o.bindMatrix);
    }
    shell.userData.isOutline = true;
    shell.renderOrder = -1;
    shell.frustumCulled = false;
    shells.push({ shell, parent: o.parent, src: o });
  });
  shells.forEach(({ shell, parent, src }) => {
    shell.position.copy(src.position);
    shell.quaternion.copy(src.quaternion);
    shell.scale.copy(src.scale);
    parent.add(shell);
  });
  return shells.map((s) => s.shell);
}
