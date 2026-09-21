// Sons synthétisés à la volée : aucun fichier à télécharger.

let ctx = null;
let master = null;
let enabled = true;
let vibeOn = true;

export function setEnabled(v) { enabled = v; }
export function setVibrate(v) { vibeOn = v; }

/** À appeler depuis un geste utilisateur (iOS exige un déverrouillage). */
export function unlock() {
  if (!ctx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = 0.35;
    master.connect(ctx.destination);
  }
  if (ctx.state === "suspended") ctx.resume();
}

function tone({ freq = 440, to = freq, dur = 0.12, type = "square", gain = 0.3, delay = 0 }) {
  if (!enabled || !ctx) return;
  const t0 = ctx.currentTime + delay;
  const osc = ctx.createOscillator();
  const g = ctx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t0);
  if (to !== freq) osc.frequency.exponentialRampToValueAtTime(Math.max(20, to), t0 + dur);
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(gain, t0 + 0.012);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  osc.connect(g).connect(master);
  osc.start(t0);
  osc.stop(t0 + dur + 0.05);
}

function noise({ dur = 0.25, gain = 0.3, freq = 900, q = 1, delay = 0 }) {
  if (!enabled || !ctx) return;
  const t0 = ctx.currentTime + delay;
  const len = Math.floor(ctx.sampleRate * dur);
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
  const src = ctx.createBufferSource();
  src.buffer = buf;
  const filt = ctx.createBiquadFilter();
  filt.type = "bandpass";
  filt.frequency.value = freq;
  filt.Q.value = q;
  const g = ctx.createGain();
  g.gain.setValueAtTime(gain, t0);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  src.connect(filt).connect(g).connect(master);
  src.start(t0);
}

export const sfx = {
  shoot: () => tone({ freq: 880, to: 220, dur: 0.09, type: "square", gain: 0.18 }),
  miss: () => tone({ freq: 200, to: 120, dur: 0.08, type: "triangle", gain: 0.1 }),
  hit: (combo = 1) => {
    const f = 420 + Math.min(combo, 12) * 55;
    tone({ freq: f, to: f * 1.6, dur: 0.13, type: "square", gain: 0.22 });
    noise({ dur: 0.18, freq: 1600, gain: 0.16 });
  },
  armor: () => tone({ freq: 160, to: 90, dur: 0.14, type: "sawtooth", gain: 0.2 }),
  hurt: () => {
    tone({ freq: 240, to: 70, dur: 0.32, type: "sawtooth", gain: 0.3 });
    noise({ dur: 0.3, freq: 320, gain: 0.25 });
  },
  heal: () => {
    tone({ freq: 660, dur: 0.1, type: "sine", gain: 0.2 });
    tone({ freq: 990, dur: 0.16, type: "sine", gain: 0.18, delay: 0.09 });
  },
  bomb: () => {
    noise({ dur: 0.7, freq: 180, q: 0.6, gain: 0.45 });
    tone({ freq: 90, to: 30, dur: 0.6, type: "sawtooth", gain: 0.3 });
  },
  spawn: () => tone({ freq: 120, to: 420, dur: 0.22, type: "sine", gain: 0.14 }),
  bossIn: () => {
    [110, 138, 165].forEach((f, i) => tone({ freq: f, to: f * 1.5, dur: 0.5, type: "sawtooth", gain: 0.22, delay: i * 0.16 }));
  },
  bossHit: () => {
    tone({ freq: 300, to: 900, dur: 0.2, type: "square", gain: 0.3 });
    noise({ dur: 0.25, freq: 2200, gain: 0.2 });
  },
  win: () => [523, 659, 784, 1047].forEach((f, i) => tone({ freq: f, dur: 0.22, type: "triangle", gain: 0.24, delay: i * 0.13 })),
  lose: () => [440, 392, 330, 247].forEach((f, i) => tone({ freq: f, dur: 0.3, type: "triangle", gain: 0.24, delay: i * 0.17 })),
  ui: () => tone({ freq: 620, to: 780, dur: 0.06, type: "sine", gain: 0.12 }),
  shutter: () => { noise({ dur: 0.08, freq: 3000, gain: 0.3 }); tone({ freq: 1400, to: 600, dur: 0.07, type: "square", gain: 0.12 }); },
};

export function vibrate(pattern) {
  if (!vibeOn || !navigator.vibrate) return;
  try { navigator.vibrate(pattern); } catch (e) { /* ignoré */ }
}
