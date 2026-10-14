// Tiny Web-Audio synth for all game SFX — generated live from oscillators +
// noise, so there are zero audio files to ship (stays offline-friendly for the
// PWA). Browsers block audio until a user gesture, so call unlockAudio() on the
// first pointer/tap. Everything is wrapped so a missing AudioContext no-ops.
let ctx = null;
let master = null;
let muted = false;

function ac() {
  if (!ctx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = 0.32;
    master.connect(ctx.destination);
  }
  return ctx;
}

export function unlockAudio() {
  const c = ac();
  if (c && c.state === 'suspended') c.resume();
}
export function setMuted(m) { muted = m; if (master) master.gain.value = m ? 0 : 0.32; }
export function isMuted() { return muted; }

// Silence the synth while the game is in the background (tab hidden, app
// switched away) and bring it back on return: a running AudioContext keeps the
// audio hardware awake, and on a phone that is battery spent on nothing.
if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    if (!ctx) return;
    if (document.hidden) ctx.suspend().catch(() => {});
    else ctx.resume().catch(() => {});
  });
}

function tone({ type = 'sine', freq = 440, freqTo, dur = 0.2, gain = 0.3, when = 0, pan = 0, attack = 0.006 }) {
  const c = ac(); if (!c || muted) return;
  const t0 = c.currentTime + when;
  const osc = c.createOscillator(); osc.type = type;
  osc.frequency.setValueAtTime(freq, t0);
  if (freqTo) osc.frequency.exponentialRampToValueAtTime(Math.max(1, freqTo), t0 + dur);
  const g = c.createGain();
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(gain, t0 + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  let node = g;
  if (pan && c.createStereoPanner) { const p = c.createStereoPanner(); p.pan.value = Math.max(-1, Math.min(1, pan)); g.connect(p); node = p; }
  osc.connect(g); node.connect(master);
  osc.start(t0); osc.stop(t0 + dur + 0.03);
}

function noise({ dur = 0.2, gain = 0.3, when = 0, freq = 1400, q = 0.7, type = 'bandpass', pan = 0 }) {
  const c = ac(); if (!c || muted) return;
  const t0 = c.currentTime + when;
  const n = Math.max(1, Math.floor(c.sampleRate * dur));
  const buf = c.createBuffer(1, n, c.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / n);
  const src = c.createBufferSource(); src.buffer = buf;
  const f = c.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q;
  const g = c.createGain(); g.gain.setValueAtTime(gain, t0); g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  let node = g;
  if (pan && c.createStereoPanner) { const p = c.createStereoPanner(); p.pan.value = Math.max(-1, Math.min(1, pan)); g.connect(p); node = p; }
  src.connect(f); f.connect(g); node.connect(master);
  src.start(t0); src.stop(t0 + dur);
}

// ── SFX ────────────────────────────────────────────────────────────────────
// dir: 'out' (you cast) pans right→center, 'in' (incoming) center; keeps the
// duel spatial. spellType tweaks timbre a touch.
export function cast(spellId, dir = 'out') {
  const pan = dir === 'out' ? 0.2 : -0.2;
  tone({ type: 'sawtooth', freq: 260, freqTo: 880, dur: 0.16, gain: 0.22, pan });
  tone({ type: 'square', freq: 520, freqTo: 1300, dur: 0.1, gain: 0.08, pan, when: 0.01 });
}
export function buff() { // shield / reflect / surge
  tone({ type: 'sine', freq: 320, freqTo: 640, dur: 0.32, gain: 0.22 });
  tone({ type: 'triangle', freq: 480, freqTo: 720, dur: 0.32, gain: 0.12, when: 0.02 });
}
export function impact(missed = false, dir = 'in') {
  const pan = dir === 'out' ? 0.2 : -0.2;
  if (missed) { noise({ dur: 0.18, gain: 0.12, freq: 2600, pan }); return; }
  noise({ dur: 0.22, gain: 0.32, freq: 900, q: 0.5, pan });
  tone({ type: 'sine', freq: 160, freqTo: 60, dur: 0.24, gain: 0.3, pan });
}
export function fizzle() {
  tone({ type: 'triangle', freq: 240, freqTo: 90, dur: 0.26, gain: 0.16 });
}
export function lowMana() {
  tone({ type: 'square', freq: 180, dur: 0.08, gain: 0.12 });
  tone({ type: 'square', freq: 150, dur: 0.09, gain: 0.12, when: 0.1 });
}
export function blip() { tone({ type: 'sine', freq: 660, dur: 0.06, gain: 0.12 }); }
export function begin() {
  [523, 659, 784].forEach((f, i) => tone({ type: 'triangle', freq: f, dur: 0.3, gain: 0.18, when: i * 0.09 }));
}
export function win() {
  [523, 659, 784, 1046].forEach((f, i) => tone({ type: 'triangle', freq: f, dur: 0.5, gain: 0.2, when: i * 0.12 }));
}
export function lose() {
  [392, 330, 262, 196].forEach((f, i) => tone({ type: 'sine', freq: f, dur: 0.5, gain: 0.2, when: i * 0.14 }));
}
