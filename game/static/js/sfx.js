// Sound effects, made on the fly with the Web Audio API (no audio files).
// Every sound is built from a few oscillators or bursts of filtered noise
// shaped by envelopes, so they're tiny, original and easy to tweak. Each play
// varies a little in pitch, so repeated sounds never sound canned.
//
// What makes them sound "big" rather than beepy:
//   - layers: most sounds mix a body (thump), a character (pitched tone) and
//     a sparkle (high noise or a ping)
//   - space: everything goes through a small generated room reverb, with
//     jingles sent wetter than footsteps
//   - position: sounds from other players and obstacles are panned left or
//     right and fade with distance (see `at`)
//   - voices: the characters squeak little vowel sounds ("hup!", "oof!",
//     "waaah!") through two formant filters, each character at its own pitch
//   - ambience: a quiet bed for each world (waves, wind, a city hum...)
//
// Mixing: sound effects and music (music.js) have their own volume, both go
// through a compressor so a busy moment never gets harsh or too loud, and
// big moments (qualifying, the crown) briefly duck the music.

let ctx = null, sfxBus = null, musicBus = null, duckGain = null, noiseBuf = null, reverbIn = null;
let volume = 0.7, musicVolume = 0.5;

/** Room reverb: a convolver fed with a short burst of decaying stereo noise. */
function makeReverb(a, seconds = 1.6, decay = 3.2) {
  const len = Math.floor(a.sampleRate * seconds);
  const buf = a.createBuffer(2, len, a.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch);
    for (let i = 0; i < len; i++) {
      const t = i / len;
      // A few early reflections, then a smooth tail.
      const early = i < a.sampleRate * 0.06 && Math.random() < 0.004 ? 0.8 : 0;
      d[i] = ((Math.random() * 2 - 1) * Math.pow(1 - t, decay) + early) * 0.6;
    }
  }
  const conv = a.createConvolver();
  conv.buffer = buf;
  return conv;
}

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
    // Reverb send: sounds feed it separately (see out()), it returns into the sfx bus.
    const verb = makeReverb(ctx);
    const verbTone = ctx.createBiquadFilter();
    verbTone.type = "lowpass";
    verbTone.frequency.value = 5200;
    reverbIn = ctx.createGain();
    reverbIn.gain.value = 1;
    reverbIn.connect(verb).connect(verbTone).connect(sfxBus);
    duckGain = ctx.createGain();
    duckGain.connect(comp);
    musicBus = ctx.createGain();
    musicBus.gain.value = musicVolume * 0.55;
    musicBus.connect(duckGain);
    noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
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
  ambience.refresh();
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
const rnd = (a, b) => a + Math.random() * (b - a);

// ---------------------------------------------------------------- position

// Where the sound being played comes from: pan -1 (left) .. 1 (right), vol 0..1,
// and `pitch` (a character's voice). Set by at(); plain calls play centred.
let spot = { pan: 0, vol: 1, pitch: 1 };

/** Play `fn` as if it came from a spot: {pan, vol, pitch}. */
export function at(where, fn) {
  const prev = spot;
  spot = { pan: 0, vol: 1, pitch: 1, ...where };
  try { fn(); } finally { spot = prev; }
}

/** Connect a sound's last node to the output: panned, scaled for distance, with some reverb. */
function out(node, t, wet) {
  const a = ctx;
  let n = node;
  if (spot.pan && a.createStereoPanner) {
    const p = a.createStereoPanner();
    p.pan.setValueAtTime(Math.max(-1, Math.min(1, spot.pan)), t);
    n = n.connect(p);
  }
  if (spot.vol !== 1) {
    const g = a.createGain();
    g.gain.value = spot.vol;
    n = n.connect(g);
  }
  n.connect(sfxBus);
  // Far-away sounds are relatively wetter, which makes them feel distant.
  const send = wet + (1 - spot.vol) * 0.25;
  if (send > 0.01) {
    const s = a.createGain();
    s.gain.value = send;
    n.connect(s).connect(reverbIn);
  }
}

const silent = () => !audio() || volume <= 0 || spot.vol <= 0.01;

// ---------------------------------------------------------------- building blocks

/** A pitched tone: frequency sweeps from f0 to f1 over `dur` seconds. */
function tone(f0, f1, dur, { type = "sine", gain = 0.3, delay = 0, attack = 0.005, pitch = 1, vibrato = 0, vibRate = 9,
  wet = 0.12, filter = null, curve = "exp" } = {}) {
  if (silent()) return;
  const a = ctx;
  const t = a.currentTime + delay;
  const o = a.createOscillator(), g = a.createGain();
  o.type = type;
  o.frequency.setValueAtTime(f0 * pitch, t);
  if (curve === "lin") o.frequency.linearRampToValueAtTime(Math.max(20, f1 * pitch), t + dur);
  else o.frequency.exponentialRampToValueAtTime(Math.max(20, f1 * pitch), t + dur);
  if (vibrato) {
    const lfo = a.createOscillator(), lg = a.createGain();
    lfo.frequency.value = vibRate;
    lg.gain.value = vibrato;
    lfo.connect(lg).connect(o.frequency);
    lfo.start(t);
    lfo.stop(t + dur + 0.05);
  }
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(gain, t + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  let n = o.connect(g);
  if (filter) {
    const f = a.createBiquadFilter();
    f.type = "lowpass";
    f.frequency.value = filter;
    n = n.connect(f);
  }
  out(n, t, wet);
  o.start(t);
  o.stop(t + dur + 0.02);
}

/** A burst of filtered noise (thuds, whooshes, crashes). */
function noise(dur, { freq = 1200, q = 0.8, type = "lowpass", gain = 0.3, delay = 0, sweep = null, attack = 0.002, wet = 0.1 } = {}) {
  if (silent()) return;
  const a = ctx;
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
  out(src.connect(f).connect(g), t, wet);
  src.start(t, Math.random() * 1.5);
  src.stop(t + dur + 0.02);
}

/** A soft "thump": a sine dropping in pitch, like a kick drum (body hits, landings). */
const thump = (f = 120, dur = 0.14, gain = 0.3, delay = 0) =>
  tone(f * 1.8, f * 0.5, dur, { gain, delay, attack: 0.002, wet: 0.05 });

/** A bright metallic "ping" (bumpers, chimes): two inharmonic sines. */
function ping(f, dur = 0.5, gain = 0.1, delay = 0) {
  tone(f, f * 0.998, dur, { gain, delay, attack: 0.002, wet: 0.3 });
  tone(f * 2.76, f * 2.75, dur * 0.5, { gain: gain * 0.4, delay, attack: 0.002, wet: 0.3 });
}

// Vowel formants (Hz) for the characters' squeaky voices.
const VOWELS = { a: [800, 1250], o: [460, 820], u: [330, 720], e: [420, 2000], i: [300, 2300], ah: [700, 1100] };

/**
 * A cartoon voice: a buzzy source through two vowel filters, gliding from
 * pitch f0 to f1 and from vowel v0 to v1 ("u" -> "a" = "wah").
 */
function voice(v0, v1, f0, f1, dur, { gain = 0.16, delay = 0, vibrato = 0, wet = 0.15 } = {}) {
  if (silent()) return;
  const a = ctx;
  const t = a.currentTime + delay;
  const p = spot.pitch || 1;
  const o = a.createOscillator();
  o.type = "sawtooth";
  o.frequency.setValueAtTime(f0 * p, t);
  o.frequency.exponentialRampToValueAtTime(f1 * p, t + dur);
  if (vibrato) {
    const lfo = a.createOscillator(), lg = a.createGain();
    lfo.frequency.value = 7;
    lg.gain.value = vibrato * p;
    lfo.connect(lg).connect(o.frequency);
    lfo.start(t);
    lfo.stop(t + dur + 0.05);
  }
  const mix = a.createGain();
  mix.gain.value = 1;
  const [A0, B0] = VOWELS[v0], [A1, B1] = VOWELS[v1];
  for (const [fa, fb, k] of [[A0, A1, 1], [B0, B1, 0.5]]) {
    const f = a.createBiquadFilter();
    f.type = "bandpass";
    f.Q.value = 7;
    f.frequency.setValueAtTime(fa, t);
    f.frequency.linearRampToValueAtTime(fb, t + dur * 0.8);
    const g = a.createGain();
    g.gain.value = k;
    o.connect(f).connect(g).connect(mix);
  }
  const env = a.createGain();
  env.gain.setValueAtTime(0.0001, t);
  env.gain.exponentialRampToValueAtTime(gain * 2.2, t + 0.015);
  env.gain.setValueAtTime(gain * 2.2, t + dur * 0.6);
  env.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  out(mix.connect(env), t, wet);
  o.start(t);
  o.stop(t + dur + 0.05);
}

const notes = (list, type = "triangle", gain = 0.22, step = 0.11, len = 1.6, wet = 0.3) =>
  list.forEach((f, i) => tone(f, f * 1.002, step * len, { type, gain, delay: i * step, wet }));

/** A crowd of voices cheering, plus a round of applause. */
function cheer(seconds = 1.6, gain = 0.1, delay = 0) {
  if (silent()) return;
  const vowels = ["a", "e", "o", "ah"];
  for (let i = 0; i < 9; i++) {
    const v = vowels[i % vowels.length];
    const f = rnd(260, 520);
    voice(v, "a", f, f * rnd(1.1, 1.4), seconds * rnd(0.4, 0.8), { gain: gain * 0.35, delay: delay + rnd(0, 0.25), vibrato: 6, wet: 0.4 });
  }
  noise(seconds, { freq: 1400, type: "bandpass", q: 0.6, gain: gain * 0.6, attack: 0.15, delay, wet: 0.35 });
  // Applause: lots of tiny claps.
  for (let i = 0; i < Math.round(seconds * 26); i++) {
    noise(0.03, { freq: rnd(1500, 3500), type: "bandpass", q: 1.5, gain: gain * rnd(0.4, 0.9), delay: delay + rnd(0, seconds), wet: 0.3 });
  }
}

// Limit how often the same sound can play, so a crowd doesn't turn into noise.
const last = new Map();
function throttle(name, gap) {
  const now = performance.now();
  if (now - (last.get(name) || 0) < gap) return false;
  last.set(name, now);
  return true;
}

let stepSide = 0;

/** Each character's own voice pitch, from its id (the same every round). */
export function voicePitch(id) {
  let h = 0;
  for (const ch of String(id)) h = (h * 31 + ch.charCodeAt(0)) | 0;
  return 0.82 + ((Math.abs(h) % 1000) / 1000) * 0.45;
}

export const sfx = {
  // ---- interface
  click: () => { tone(1500, 1100, 0.045, { type: "triangle", gain: 0.07, pitch: vary(0.04), wet: 0.05 }); noise(0.02, { freq: 4000, type: "highpass", gain: 0.03, wet: 0 }); },
  hover: () => { if (throttle("hover", 60)) tone(2200, 2400, 0.03, { gain: 0.02, wet: 0.05 }); },
  swoosh: () => {
    noise(0.5, { freq: 350, sweep: 3600, type: "bandpass", q: 1.6, gain: 0.2, attack: 0.18, wet: 0.2 });
    tone(220, 660, 0.4, { type: "triangle", gain: 0.03, attack: 0.2, wet: 0.2 });
  },
  introSting: () => {
    duck(0.3, 1.4);
    noise(0.25, { freq: 5000, type: "highpass", gain: 0.06, wet: 0.3 });  // cymbal swell
    notes([523, 659, 784], "square", 0.07, 0.09, 1.6, 0.35);
    notes([262, 330, 392], "triangle", 0.1, 0.09, 1.6, 0.2);
    tone(1047, 1047, 0.6, { type: "triangle", gain: 0.15, delay: 0.27, vibrato: 8, wet: 0.45 });
    thump(70, 0.3, 0.25, 0.27);
  },

  // ---- characters (yours at full volume; other players via at())
  step: (surface = "floor") => {
    stepSide ^= 1;
    const g = vary(0.2);
    if (surface === "ice") {
      noise(0.08, { freq: 3000, type: "bandpass", q: 3, gain: 0.22 * g, wet: 0.05 });
      tone(1800, 2400, 0.05, { gain: 0.025, wet: 0.05 });            // a little squeak
    } else if (surface === "snow") {
      noise(0.09, { freq: 1600, type: "bandpass", q: 0.7, gain: 0.16 * g, attack: 0.01, wet: 0.03 });   // crunch
      noise(0.05, { freq: 500, gain: 0.1 * g, wet: 0 });
    } else if (surface === "metal") {
      noise(0.04, { freq: stepSide ? 2400 : 2000, type: "bandpass", q: 6, gain: 0.05 * g, wet: 0.15 });
      tone(stepSide ? 1180 : 1040, 1000, 0.06, { type: "triangle", gain: 0.015, wet: 0.2 });   // clink
      thump(150, 0.05, 0.06);
    } else if (surface === "belt") {
      noise(0.05, { freq: 600, type: "bandpass", q: 2, gain: 0.28 * g, wet: 0.03 });
      thump(110, 0.05, 0.06 * g);
    } else {
      noise(0.05, { freq: stepSide ? 900 : 720, type: "bandpass", q: 1.8, gain: 0.065 * g, wet: 0.03 });
      thump(stepSide ? 150 : 130, 0.06, 0.07 * g);
    }
  },
  jump: () => {
    tone(260, 720, 0.15, { type: "sine", gain: 0.16, pitch: vary(), wet: 0.1 });            // spring
    tone(520, 1440, 0.1, { type: "triangle", gain: 0.03, pitch: vary(), wet: 0.1 });
    noise(0.08, { freq: 700, sweep: 1800, type: "bandpass", q: 1, gain: 0.05, wet: 0.02 });  // push off
    if (Math.random() < 0.55) voice("u", "a", 420, 560, 0.11, { gain: 0.09, delay: 0.01 });   // "hup!"
  },
  dive: () => {
    noise(0.26, { freq: 700, sweep: 3000, type: "bandpass", q: 1.3, gain: 0.22, attack: 0.03, wet: 0.08 });
    tone(520, 200, 0.2, { gain: 0.06, pitch: vary(), wet: 0.05 });
    voice("i", "a", 620, 480, 0.18, { gain: 0.1 });   // "hyaa!"
  },
  land: (impact = 1) => {
    if (!throttle("land", 80)) return;
    const k = Math.min(1.4, Math.max(0.5, impact));
    thump(95 * vary(0.1), 0.16, 0.26 * k);
    noise(0.1, { freq: 300 * vary(0.15), gain: 0.2 * k, wet: 0.03 });
    tone(220, 110, 0.12, { type: "triangle", gain: 0.05 * k, pitch: vary(), wet: 0.05 });  // jelly squish
  },
  hit: () => {
    thump(90, 0.2, 0.32);
    noise(0.16, { freq: 2600, sweep: 400, gain: 0.25, wet: 0.1 });
    tone(880, 620, 0.08, { type: "square", gain: 0.04, filter: 2400, wet: 0.15 });           // wood-block bonk
    voice("o", "u", 360, 230, 0.2, { gain: 0.12, delay: 0.03 });                              // "oof"
    // Dizzy twinkle.
    [1568, 2093, 1760].forEach((f, i) => tone(f, f, 0.18, { gain: 0.025, delay: 0.12 + i * 0.07, wet: 0.4 }));
  },
  bump: () => {
    tone(330, 660, 0.3, { gain: 0.16, pitch: vary(0.05), vibrato: 60, vibRate: 22, wet: 0.15 }); // boing!
    ping(1320 * vary(0.03), 0.4, 0.06);
    thump(160, 0.08, 0.15);
  },
  pad: () => {
    tone(140, 980, 0.38, { type: "triangle", gain: 0.2, pitch: vary(0.05), vibrato: 30, vibRate: 18, wet: 0.2 });
    tone(280, 1900, 0.3, { gain: 0.04, delay: 0.03, wet: 0.25 });
    thump(80, 0.12, 0.25);
    voice("u", "i", 420, 760, 0.3, { gain: 0.08, delay: 0.05 });   // "wheee"
  },
  fall: () => {
    tone(1300, 260, 0.9, { type: "sine", gain: 0.06, vibrato: 25, wet: 0.35 });                   // slide whistle
    voice("a", "o", 640, 300, 0.75, { gain: 0.13, vibrato: 25 });                                // "waaah"
  },
  splash: () => {
    noise(0.5, { freq: 2400, sweep: 500, gain: 0.3, attack: 0.004, wet: 0.2 });
    thump(70, 0.25, 0.22);
    for (let i = 0; i < 6; i++) tone(rnd(500, 900), rnd(1200, 2000), 0.06, { gain: 0.03, delay: 0.12 + i * rnd(0.04, 0.09), wet: 0.3 });  // bubbles
  },
  respawn: () => {
    tone(300, 900, 0.18, { gain: 0.1, wet: 0.3 });
    tone(900, 1350, 0.12, { gain: 0.05, delay: 0.14, wet: 0.4 });
    noise(0.3, { freq: 5000, type: "highpass", gain: 0.03, attack: 0.1, wet: 0.4 });   // shimmer
  },
  checkpoint: () => {
    notes([988, 1319, 1568, 1976], "triangle", 0.12, 0.065, 1.8, 0.45);
    noise(0.4, { freq: 7000, type: "highpass", gain: 0.03, attack: 0.05, delay: 0.1, wet: 0.5 });
  },
  lifelost: () => { notes([660, 494], "triangle", 0.13, 0.14, 1.6, 0.35); voice("o", "u", 380, 300, 0.3, { gain: 0.08, delay: 0.1 }); },
  finishLine: () => {
    // Crossing the line: a party popper and the crowd.
    noise(0.12, { freq: 1800, gain: 0.25, wet: 0.2 });
    thump(140, 0.1, 0.2);
    for (let i = 0; i < 8; i++) tone(rnd(1800, 3600), rnd(2000, 4000), 0.05, { gain: 0.03, delay: 0.05 + i * 0.03, wet: 0.4 });
    voice("e", "a", 520, 700, 0.3, { gain: 0.11, delay: 0.08 });   // "yay!"
  },

  // ---- obstacles (played when they come close to you)
  whoosh: (speed = 1) => { if (throttle("whoosh", 160)) noise(0.3, { freq: 450 * speed, sweep: 1900 * speed, type: "bandpass", q: 2.4, gain: 0.3, attack: 0.09, wet: 0.08 }); },
  swing: () => {
    if (!throttle("swing", 250)) return;
    noise(0.5, { freq: 250, sweep: 1300, type: "bandpass", q: 3, gain: 0.15, attack: 0.22, wet: 0.1 });
    tone(70, 110, 0.45, { gain: 0.05, attack: 0.2, wet: 0.05 });   // weight of the hammer
  },
  slide: () => {
    if (!throttle("slide", 300)) return;
    noise(0.34, { freq: 260, sweep: 170, gain: 0.28, attack: 0.06, wet: 0.05 });
    tone(55, 50, 0.3, { type: "sawtooth", gain: 0.05, filter: 300, wet: 0 });    // grinding rumble
  },
  piston: () => {
    if (!throttle("piston", 200)) return;
    noise(0.12, { freq: 3000, sweep: 800, type: "highpass", gain: 0.1, wet: 0.1 });   // hiss of air
    thump(80, 0.12, 0.2, 0.03);
    tone(240, 230, 0.08, { type: "square", gain: 0.02, filter: 1500, delay: 0.03, wet: 0.2 });  // clank
  },
  roll: () => { if (throttle("roll", 600)) { noise(0.7, { freq: 160, sweep: 90, gain: 0.16, attack: 0.18, wet: 0.05 }); tone(45, 40, 0.6, { gain: 0.05, attack: 0.2, wet: 0 }); } },
  slam: () => {   // a giant bouncing ball landing
    if (!throttle("slam", 120)) return;
    thump(55, 0.35, 0.4);
    noise(0.3, { freq: 400, sweep: 90, gain: 0.25, wet: 0.15 });
    tone(180, 110, 0.25, { type: "triangle", gain: 0.06, vibrato: 20, vibRate: 25, wet: 0.2 });   // rubbery wobble
  },
  blinkWarn: () => {   // a vanishing platform starts flashing
    if (!throttle("blinkWarn", 350)) return;
    [2637, 3136].forEach((f, i) => tone(f, f * 1.01, 0.09, { type: "triangle", gain: 0.07, delay: i * 0.06, wet: 0.4 }));
  },
  blinkOut: () => {    // ...and vanishes
    if (!throttle("blinkOut", 150)) return;
    tone(2200, 500, 0.22, { type: "triangle", gain: 0.08, wet: 0.4 });
    noise(0.15, { freq: 6000, type: "highpass", gain: 0.03, wet: 0.4 });
  },
  door: () => {
    if (!throttle("door", 60)) return;
    noise(0.4, { freq: 2600, sweep: 400, gain: 0.3, wet: 0.15 });
    thump(110, 0.15, 0.2);
    for (let i = 0; i < 5; i++) tone(rnd(300, 900), rnd(150, 400), 0.08, { type: "square", gain: 0.015, filter: 1800, delay: rnd(0, 0.2), wet: 0.2 });  // splinters
  },
  bonk: () => { tone(160, 110, 0.18, { type: "square", gain: 0.08, filter: 1200, wet: 0.1 }); thump(120, 0.12, 0.25); noise(0.08, { freq: 500, gain: 0.18 }); },
  crack: () => { if (throttle("crack", 90)) { noise(0.12, { freq: 3200, type: "highpass", gain: 0.14, wet: 0.1 }); noise(0.05, { freq: 1500, type: "bandpass", q: 3, gain: 0.08, delay: 0.05 }); } },
  tile: () => { if (throttle("tile", 90)) { tone(420, 90, 0.42, { gain: 0.08, pitch: vary(), wet: 0.25 }); noise(0.3, { freq: 900, sweep: 200, gain: 0.06, delay: 0.05, wet: 0.2 }); } },
  cannon: () => {
    if (!throttle("cannon", 120)) return;
    thump(50, 0.4, 0.4);
    noise(0.5, { freq: 700, sweep: 70, gain: 0.32, wet: 0.25 });
    noise(0.08, { freq: 5000, type: "highpass", gain: 0.08 });
  },

  // ---- the show
  beep: (n = 1) => {
    const f = n === 3 ? 523 : n === 2 ? 587 : 659;
    tone(f, f, 0.18, { type: "square", gain: 0.06, filter: 2600, wet: 0.3 });
    tone(f * 2, f * 2, 0.12, { type: "sine", gain: 0.04, wet: 0.3 });
    thump(90, 0.1, 0.15);
  },
  go: () => {
    duck(0.5, 0.8);
    // An air-horn style chord, a whistle and the crowd.
    for (const f of [440, 554, 659]) tone(f, f * 1.01, 0.5, { type: "sawtooth", gain: 0.035, filter: 2200, wet: 0.35 });
    tone(1320, 1320, 0.4, { type: "triangle", gain: 0.07, wet: 0.35 });
    thump(60, 0.35, 0.3);
    noise(0.6, { freq: 5000, type: "highpass", gain: 0.05, wet: 0.4 });
    cheer(1.0, 0.06, 0.05);
  },
  qualified: () => {
    duck(0.3, 1.8);
    notes([523, 659, 784, 1047], "triangle", 0.17, 0.09, 1.6, 0.4);
    notes([262, 330, 392, 523], "square", 0.04, 0.09, 1.6, 0.2);
    tone(1568, 1568, 0.6, { type: "sine", gain: 0.07, delay: 0.36, vibrato: 10, wet: 0.5 });
    sfx.finishLine();
    cheer(1.6, 0.09, 0.15);
  },
  crown: () => {
    duck(0.2, 3.2);
    notes([523, 659, 784, 1047, 1319, 1568], "triangle", 0.17, 0.1, 1.6, 0.45);
    notes([262, 330, 392, 523], "square", 0.05, 0.15, 2, 0.3);
    thump(55, 0.5, 0.35, 0.55);
    noise(1.2, { freq: 6000, type: "highpass", gain: 0.05, delay: 0.5, wet: 0.5 });
    cheer(2.6, 0.12, 0.3);
  },
  eliminated: () => {
    duck(0.35, 1.8);
    // A sad trombone: wah, wah, wah, waaaah.
    [392, 370, 349].forEach((f, i) => tone(f, f * 0.98, 0.3, { type: "sawtooth", gain: 0.14, filter: 1300, delay: i * 0.26, wet: 0.3 }));
    tone(330, 250, 0.9, { type: "sawtooth", gain: 0.14, filter: 1200, delay: 0.78, vibrato: 9, vibRate: 6, wet: 0.35 });
    voice("o", "u", 300, 220, 0.5, { gain: 0.06, delay: 0.85 });
  },
  showOver: () => notes([784, 659, 523, 392], "triangle", 0.11, 0.13, 1.6, 0.4),
};

// ---------------------------------------------------------------- ambience

/**
 * A quiet background bed for each world, looping until changed:
 *   water/tropical  waves washing in and out
 *   sky/snow        wind
 *   future/neon     a soft electric hum
 */
export const ambience = {
  env: null,
  nodes: [],
  set(env) {
    if (env === this.env) return;
    this.stop();
    this.env = env;
    if (!env) return;
    const a = audio();
    if (!a) return;
    const master = a.createGain();
    master.gain.value = 0;
    master.connect(sfxBus);
    master.gain.setTargetAtTime(volume > 0 ? 1 : 0, a.currentTime, 0.8);
    const nodes = [master];
    const loop = (freq, type, q, gain, lfoRate, lfoDepth, sweep = 0) => {
      const src = a.createBufferSource();
      src.buffer = noiseBuf;
      src.loop = true;
      const f = a.createBiquadFilter();
      f.type = type;
      f.frequency.value = freq;
      f.Q.value = q;
      const g = a.createGain();
      g.gain.value = gain;
      const lfo = a.createOscillator(), lg = a.createGain();
      lfo.frequency.value = lfoRate;
      lg.gain.value = lfoDepth;
      lfo.connect(lg).connect(g.gain);
      if (sweep) {
        const l2 = a.createOscillator(), g2 = a.createGain();
        l2.frequency.value = lfoRate * 0.7;
        g2.gain.value = sweep;
        l2.connect(g2).connect(f.frequency);
        l2.start();
        nodes.push(l2);
      }
      src.connect(f).connect(g).connect(master);
      src.start(0, Math.random());
      lfo.start();
      nodes.push(src, lfo);
    };
    const hum = (freq, gain) => {
      const o = a.createOscillator(), g = a.createGain();
      o.frequency.value = freq;
      g.gain.value = gain;
      o.connect(g).connect(master);
      o.start();
      nodes.push(o);
    };
    if (env === "water" || env === "tropical") {
      loop(500, "lowpass", 0.5, 0.035, 0.11, 0.03);         // waves
      loop(2500, "bandpass", 0.6, 0.006, 0.17, 0.005);      // foam
    } else if (env === "sky" || env === "snow") {
      loop(600, "bandpass", 1.5, 0.03, 0.09, 0.022, 350);   // wind
      loop(1800, "bandpass", 3, 0.004, 0.13, 0.004, 600);   // whistle
    } else if (env === "future" || env === "neon") {
      hum(55, 0.012);
      hum(110.6, 0.006);
      loop(300, "lowpass", 0.7, 0.012, 0.05, 0.006);
    } else if (env === "candy") {
      loop(700, "lowpass", 0.5, 0.025, 0.12, 0.02);         // soft fizzy sea
      loop(6000, "highpass", 0.5, 0.003, 0.4, 0.003);
    }
    this.nodes = nodes;
  },
  stop() {
    if (!this.nodes.length) { this.env = null; return; }
    const a = ctx, [master, ...rest] = this.nodes;
    master.gain.setTargetAtTime(0, a.currentTime, 0.3);
    setTimeout(() => { for (const n of rest) { try { n.stop(); } catch { /* already stopped */ } } master.disconnect(); }, 1500);
    this.nodes = [];
    this.env = null;
  },
  refresh() {
    const m = this.nodes[0];
    if (m && ctx) m.gain.setTargetAtTime(volume > 0 ? 1 : 0, ctx.currentTime, 0.1);
  },
};
