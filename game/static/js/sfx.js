// Sound effects, made on the fly with the Web Audio API (no audio files).
// Every sound is a few oscillators or a burst of filtered noise shaped by an
// envelope, so they're tiny, original and easy to tweak. Each play varies a
// little in pitch, so repeated sounds (footsteps, jumps) never sound canned.
//
// Mixing: sound effects and music (music.js) have their own volume, both go
// through a compressor so a busy moment never gets harsh or too loud, and
// big moments (qualifying, the crown) briefly duck the music.

let ctx = null, sfxBus = null, musicBus = null, duckGain = null, noiseBuf = null;
let volume = 0.7, musicVolume = 0.5;

/** The shared audio context (created on first use). */
export function audio() {
  if (!ctx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -16;
    comp.knee.value = 12;
    comp.ratio.value = 4;
    comp.attack.value = 0.004;
    comp.release.value = 0.2;
    comp.connect(ctx.destination);
    sfxBus = ctx.createGain();
    sfxBus.gain.value = volume;
    sfxBus.connect(comp);
    duckGain = ctx.createGain();
    duckGain.connect(comp);
    musicBus = ctx.createGain();
    musicBus.gain.value = musicVolume * 0.55;
    musicBus.connect(duckGain);
    noiseBuf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }
  if (ctx.state === "suspended") ctx.resume();
  return ctx;
}

export const buses = () => ({ music: musicBus, noise: noiseBuf });

// Browsers only allow sound after the player has clicked or pressed a key.
for (const ev of ["pointerdown", "keydown"]) {
  window.addEventListener(ev, () => audio(), { capture: true });
}
// Pause all audio while the tab is hidden; pick up again when it's back.
document.addEventListener("visibilitychange", () => {
  if (!ctx) return;
  if (document.hidden) ctx.suspend();
  else ctx.resume();
});

export function setVolume(v) {
  volume = Math.max(0, Math.min(1, v));
  if (sfxBus) sfxBus.gain.value = volume;
}

export function setMusicVolume(v) {
  musicVolume = Math.max(0, Math.min(1, v));
  if (musicBus) musicBus.gain.setTargetAtTime(musicVolume * 0.55, ctx.currentTime, 0.05);
}

/** Briefly lower the music under a big sound (a fanfare, the crown). */
export function duck(amount = 0.35, seconds = 1.6) {
  const a = audio();
  if (!a) return;
  const t = a.currentTime;
  duckGain.gain.cancelScheduledValues(t);
  duckGain.gain.setTargetAtTime(amount, t, 0.04);
  duckGain.gain.setTargetAtTime(1, t + seconds, 0.35);
}

const vary = (amt = 0.07) => 1 + (Math.random() * 2 - 1) * amt;

/** A pitched tone: frequency sweeps from f0 to f1 over `dur` seconds. */
function tone(f0, f1, dur, { type = "sine", gain = 0.3, delay = 0, attack = 0.005, pitch = 1, vibrato = 0, bus } = {}) {
  const a = audio();
  if (!a || volume <= 0) return;
  const t = a.currentTime + delay;
  const o = a.createOscillator(), g = a.createGain();
  o.type = type;
  o.frequency.setValueAtTime(f0 * pitch, t);
  o.frequency.exponentialRampToValueAtTime(Math.max(20, f1 * pitch), t + dur);
  if (vibrato) {
    const lfo = a.createOscillator(), lg = a.createGain();
    lfo.frequency.value = 9;
    lg.gain.value = vibrato;
    lfo.connect(lg).connect(o.frequency);
    lfo.start(t);
    lfo.stop(t + dur + 0.05);
  }
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(gain, t + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(bus || sfxBus);
  o.start(t);
  o.stop(t + dur + 0.02);
}

/** A burst of filtered noise (thuds, whooshes, crashes). */
function noise(dur, { freq = 1200, q = 0.8, type = "lowpass", gain = 0.3, delay = 0, sweep = null, attack = 0.002 } = {}) {
  const a = audio();
  if (!a || volume <= 0) return;
  const t = a.currentTime + delay;
  const src = a.createBufferSource();
  src.buffer = noiseBuf;
  const f = a.createBiquadFilter();
  f.type = type;
  f.Q.value = q;
  f.frequency.setValueAtTime(freq, t);
  if (sweep) f.frequency.exponentialRampToValueAtTime(sweep, t + dur);
  const g = a.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(gain, t + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  src.connect(f).connect(g).connect(sfxBus);
  src.start(t, Math.random() * 0.5);
  src.stop(t + dur + 0.02);
}

const notes = (list, type = "triangle", gain = 0.22, step = 0.11, len = 1.6) =>
  list.forEach((f, i) => tone(f, f * 1.002, step * len, { type, gain, delay: i * step }));

// Limit how often the same sound can play, so a crowd doesn't turn into noise.
const last = new Map();
function throttle(name, gap) {
  const now = performance.now();
  if (now - (last.get(name) || 0) < gap) return false;
  last.set(name, now);
  return true;
}

let stepSide = 0;

export const sfx = {
  // ---- interface
  click: () => tone(1400, 900, 0.05, { type: "square", gain: 0.05, pitch: vary(0.05) }),
  swoosh: () => noise(0.45, { freq: 400, sweep: 3200, type: "bandpass", q: 1.5, gain: 0.22, attack: 0.15 }),
  introSting: () => {
    duck(0.3, 1.2);
    notes([523, 659, 784], "square", 0.09, 0.09);
    tone(1047, 1047, 0.45, { type: "triangle", gain: 0.16, delay: 0.27, vibrato: 8 });
  },

  // ---- your character
  step: () => {
    stepSide ^= 1;
    noise(0.05, { freq: stepSide ? 900 : 700, type: "bandpass", q: 2, gain: 0.07 * vary(0.2) });
    tone(170, 120, 0.05, { gain: 0.05, pitch: vary(0.1) });
  },
  jump: () => tone(300, 700, 0.16, { type: "sine", gain: 0.2, pitch: vary() }),
  dive: () => { noise(0.2, { freq: 800, sweep: 2600, type: "bandpass", q: 1.2, gain: 0.24 }); tone(520, 200, 0.18, { gain: 0.09, pitch: vary() }); },
  land: () => {
    if (!throttle("land", 80)) return;
    noise(0.1, { freq: 280 * vary(0.15), gain: 0.32 });
    tone(140, 70, 0.1, { gain: 0.12, pitch: vary() });  // a soft squish under the thump
  },
  hit: () => {
    noise(0.18, { freq: 1900, sweep: 300, gain: 0.32 });
    tone(300, 90, 0.24, { type: "square", gain: 0.09, pitch: vary() });
    tone(900, 1300, 0.12, { type: "sine", gain: 0.06, delay: 0.05, pitch: vary(0.1) });  // cartoon "bonk"
  },
  bump: () => { tone(520, 240, 0.24, { gain: 0.24, pitch: vary(), vibrato: 25 }); tone(780, 360, 0.18, { gain: 0.07, delay: 0.02 }); },
  pad: () => { tone(160, 920, 0.34, { type: "triangle", gain: 0.24, pitch: vary(0.05) }); tone(320, 1500, 0.3, { gain: 0.05, delay: 0.03 }); },
  fall: () => tone(700, 120, 0.7, { type: "sine", gain: 0.17, vibrato: 18 }),
  respawn: () => { tone(400, 900, 0.16, { gain: 0.12 }); tone(900, 1300, 0.1, { gain: 0.06, delay: 0.12 }); },
  checkpoint: () => notes([988, 1319, 1568], "triangle", 0.15, 0.07),
  lifelost: () => notes([660, 440], "triangle", 0.14, 0.12),

  // ---- obstacles (played when they come close to you)
  whoosh: (speed = 1) => { if (throttle("whoosh", 160)) noise(0.28, { freq: 500 * speed, sweep: 1800 * speed, type: "bandpass", q: 2.2, gain: 0.13, attack: 0.08 }); },
  swing: () => { if (throttle("swing", 250)) noise(0.42, { freq: 300, sweep: 1400, type: "bandpass", q: 3, gain: 0.15, attack: 0.18 }); },
  slide: () => { if (throttle("slide", 300)) { noise(0.3, { freq: 220, sweep: 160, gain: 0.12, attack: 0.05 }); } },
  piston: () => { if (throttle("piston", 200)) { tone(110, 60, 0.12, { type: "square", gain: 0.08 }); noise(0.08, { freq: 2400, type: "highpass", gain: 0.1, delay: 0.02 }); } },
  roll: () => { if (throttle("roll", 600)) noise(0.6, { freq: 160, sweep: 90, gain: 0.16, attack: 0.15 }); },
  door: () => { if (throttle("door", 60)) { noise(0.35, { freq: 2400, sweep: 400, gain: 0.32 }); tone(300, 120, 0.3, { type: "sawtooth", gain: 0.05 }); } },
  bonk: () => { tone(160, 110, 0.18, { type: "square", gain: 0.11 }); noise(0.08, { freq: 500, gain: 0.22 }); },
  crack: () => { if (throttle("crack", 90)) noise(0.12, { freq: 3200, type: "highpass", gain: 0.16 }); },
  tile: () => { if (throttle("tile", 90)) tone(420, 90, 0.42, { gain: 0.09, pitch: vary() }); },
  cannon: () => { if (throttle("cannon", 120)) { noise(0.4, { freq: 600, sweep: 80, gain: 0.36 }); tone(90, 40, 0.3, { gain: 0.22 }); } },

  // ---- the show
  beep: () => tone(660, 660, 0.16, { type: "square", gain: 0.09 }),
  go: () => { duck(0.5, 0.6); tone(990, 990, 0.38, { type: "square", gain: 0.11 }); tone(1320, 1320, 0.38, { type: "triangle", gain: 0.08 }); noise(0.5, { freq: 5000, type: "highpass", gain: 0.05 }); },
  qualified: () => { duck(0.3, 1.4); notes([523, 659, 784, 1047], "triangle", 0.19, 0.09); tone(1568, 1568, 0.5, { type: "sine", gain: 0.07, delay: 0.36, vibrato: 10 }); },
  crown: () => {
    duck(0.2, 2.6);
    notes([523, 659, 784, 1047, 1319, 1568], "triangle", 0.19, 0.1);
    notes([262, 330, 392, 523], "square", 0.06, 0.15, 2);
    noise(0.9, { freq: 6000, type: "highpass", gain: 0.05, delay: 0.5 });
  },
  eliminated: () => { duck(0.35, 1.4); notes([392, 370, 349], "sawtooth", 0.07, 0.22); tone(330, 220, 0.6, { type: "sawtooth", gain: 0.07, delay: 0.66, vibrato: 14 }); },
  showOver: () => notes([784, 659, 523, 392], "triangle", 0.12, 0.13),
};
