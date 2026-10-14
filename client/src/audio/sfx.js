// All game audio is synthesized with the Web Audio API — zero audio files.

let ctx = null;
function ac() {
  if (!ctx) ctx = new (window.AudioContext || window.webkitAudioContext)();
  if (ctx.state === 'suspended') ctx.resume();
  return ctx;
}

function tone({ freq = 440, end = freq, dur = 0.15, type = 'sine', gain = 0.18, delay = 0 }) {
  try {
    const a = ac();
    const t = a.currentTime + delay;
    const osc = a.createOscillator();
    const g = a.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    osc.frequency.exponentialRampToValueAtTime(Math.max(20, end), t + dur);
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(g).connect(a.destination);
    osc.start(t);
    osc.stop(t + dur + 0.05);
  } catch { /* audio blocked — fine */ }
}

function noise({ dur = 0.2, gain = 0.1, freq = 1200, delay = 0 }) {
  try {
    const a = ac();
    const t = a.currentTime + delay;
    const buf = a.createBuffer(1, a.sampleRate * dur, a.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    const src = a.createBufferSource();
    src.buffer = buf;
    const filter = a.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = freq;
    const g = a.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(filter).connect(g).connect(a.destination);
    src.start(t);
  } catch { /* ignore */ }
}

export const sfx = {
  recognize() { tone({ freq: 880, end: 1320, dur: 0.12, type: 'sine', gain: 0.15 }); },
  fizzle() { tone({ freq: 300, end: 90, dur: 0.35, type: 'sawtooth', gain: 0.1 }); noise({ dur: 0.25, freq: 400, gain: 0.05 }); },
  cast(spellId) {
    const freqs = {
      bolt: [1200, 200], vortex: [400, 800], shield: [500, 700], quake: [150, 60],
      pierce: [1600, 2200], reflect: [900, 900], leech: [350, 550], surge: [600, 1800],
      void: [220, 110], anchor: [180, 120], drain: [700, 250], nova: [400, 1600],
    };
    const [f, e] = freqs[spellId] || [500, 500];
    tone({ freq: f, end: e, dur: 0.3, type: spellId === 'quake' || spellId === 'anchor' ? 'square' : 'sawtooth', gain: 0.12 });
    if (spellId === 'nova') tone({ freq: 800, end: 2400, dur: 0.5, type: 'sine', gain: 0.1, delay: 0.1 });
  },
  hit() { noise({ dur: 0.18, freq: 250, gain: 0.18 }); tone({ freq: 140, end: 60, dur: 0.2, type: 'square', gain: 0.12 }); },
  heal() { tone({ freq: 520, end: 780, dur: 0.25, type: 'sine', gain: 0.12 }); tone({ freq: 660, end: 990, dur: 0.25, type: 'sine', gain: 0.08, delay: 0.08 }); },
  pick() { tone({ freq: 660, end: 660, dur: 0.06, type: 'sine', gain: 0.1 }); },
  win() { [523, 659, 784, 1047].forEach((f, i) => tone({ freq: f, end: f, dur: 0.35, type: 'sine', gain: 0.14, delay: i * 0.13 })); },
  lose() { [400, 350, 300, 200].forEach((f, i) => tone({ freq: f, end: f * 0.9, dur: 0.4, type: 'sawtooth', gain: 0.08, delay: i * 0.16 })); },
  countdown() { tone({ freq: 440, end: 440, dur: 0.08, type: 'sine', gain: 0.08 }); },
};

export function buzz(ms = 30) {
  if (navigator.vibrate) navigator.vibrate(ms);
}
