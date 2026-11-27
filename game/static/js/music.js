// Background music: original tunes played by a small sequencer on Web Audio
// synths (no audio files). Each track is a loop of sections (verse, chorus,
// breakdown) whose drum fills and melody phrases are picked at random every
// time round, so the music keeps changing instead of looping the same bars.
//
//   menu      relaxed marimba groove for the menus and the lobby
//   race      bouncy, offbeat party tune for races
//   survival  driving minor-key groove for survival rounds
//   final     fast, tense track for the final
import { audio, buses } from "./sfx.js";

const midi = (n) => 440 * Math.pow(2, (n - 69) / 12);
const pick = (list) => list[Math.floor(Math.random() * list.length)];

// ---- instruments (each schedules one note at time t on the music bus)

function voice(t, freq, dur, { type = "square", gain = 0.1, attack = 0.005, release = null, filter = null, vibrato = 0, glide = 0 }) {
  const a = audio();
  const { music } = buses();
  if (!a || !music) return;
  const o = a.createOscillator(), g = a.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq * (glide ? 0.94 : 1), t);
  if (glide) o.frequency.exponentialRampToValueAtTime(freq, t + glide);
  if (vibrato) {
    const lfo = a.createOscillator(), lg = a.createGain();
    lfo.frequency.value = 5.5;
    lg.gain.setValueAtTime(0, t);
    lg.gain.linearRampToValueAtTime(vibrato, t + dur * 0.6);
    lfo.connect(lg).connect(o.frequency);
    lfo.start(t);
    lfo.stop(t + dur + 0.1);
  }
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(gain, t + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t + (release ?? dur));
  let out = o.connect(g);
  if (filter) {
    const f = a.createBiquadFilter();
    f.type = "lowpass";
    f.frequency.value = filter;
    out = out.connect(f);
  }
  out.connect(music);
  o.start(t);
  o.stop(t + (release ?? dur) + 0.05);
}

function drumNoise(t, dur, { freq, type = "highpass", gain = 0.1, q = 0.8 }) {
  const a = audio();
  const { music, noise } = buses();
  if (!a || !music) return;
  const src = a.createBufferSource();
  src.buffer = noise;
  const f = a.createBiquadFilter();
  f.type = type;
  f.frequency.value = freq;
  f.Q.value = q;
  const g = a.createGain();
  g.gain.setValueAtTime(gain, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  src.connect(f).connect(g).connect(music);
  src.start(t, Math.random() * 0.5);
  src.stop(t + dur + 0.02);
}

const kick = (t, g = 0.55) => {
  const a = audio(), { music } = buses();
  if (!a || !music) return;
  const o = a.createOscillator(), gn = a.createGain();
  o.frequency.setValueAtTime(150, t);
  o.frequency.exponentialRampToValueAtTime(42, t + 0.13);
  gn.gain.setValueAtTime(g, t);
  gn.gain.exponentialRampToValueAtTime(0.0001, t + 0.2);
  o.connect(gn).connect(music);
  o.start(t);
  o.stop(t + 0.22);
};
const snare = (t, g = 0.16) => { drumNoise(t, 0.14, { freq: 1700, type: "bandpass", gain: g, q: 0.7 }); voice(t, 190, 0.07, { type: "triangle", gain: g * 0.6 }); };
const clap = (t, g = 0.13) => { for (const d of [0, 0.012, 0.024]) drumNoise(t + d, 0.09, { freq: 1300, type: "bandpass", gain: g, q: 1.2 }); };
const hat = (t, g = 0.05, open = false) => drumNoise(t, open ? 0.18 : 0.035, { freq: 7500, gain: g });
const shaker = (t, g = 0.025) => drumNoise(t, 0.05, { freq: 5000, type: "bandpass", gain: g, q: 2 });
const tom = (t, n, g = 0.2) => voice(t, midi(n), 0.16, { type: "sine", gain: g, glide: 0.0 });

const bass = (t, n, len, g = 0.26) => voice(t, midi(n), len, { type: "triangle", gain: g, release: len * 0.9 });
const sub = (t, n, len, g = 0.07) => voice(t, midi(n), len, { type: "square", gain: g, filter: 500, release: len * 0.8 });
const stab = (t, chord, g = 0.045) => chord.forEach((n) => voice(t, midi(n + 12), 0.12, { type: "square", gain: g, filter: 2600 }));
const marimba = (t, n, g = 0.12) => { voice(t, midi(n), 0.35, { type: "sine", gain: g }); voice(t, midi(n) * 4, 0.08, { type: "sine", gain: g * 0.15 }); };
const lead = (t, n, len, g = 0.075) => voice(t, midi(n), len, { type: "square", gain: g, filter: 3200, vibrato: 7, glide: 0.03, release: len * 0.95 });
const pad = (t, chord, len, g = 0.03) => chord.forEach((n, i) => voice(t, midi(n) * (1 + (i - 1) * 0.003), len, { type: "sawtooth", gain: g, attack: len * 0.3, filter: 900 }));

// ---- chords (MIDI notes) and phrase shapes

const C = [60, 64, 67], Am = [57, 60, 64], F = [53, 57, 60], G = [55, 59, 62], Em = [52, 55, 59], Dm = [50, 53, 57];
const Bb = [46, 50, 53], Cmaj7 = [60, 64, 67, 71], Am7 = [57, 60, 64, 67], Dm7 = [50, 53, 57, 60], G7 = [55, 59, 62, 65];

// Melody phrases: 16 steps each, numbers index into the scale, null = rest.
const PHRASES = [
  [0, null, 2, null, 4, null, 2, 0, null, 4, 5, 4, 2, null, null, null],
  [4, null, 4, 5, 4, null, 2, null, 0, null, 2, null, 4, null, null, null],
  [7, null, 5, 4, 5, null, 4, 2, 4, null, null, 2, 0, null, null, null],
  [2, 4, 5, null, 7, null, 5, null, 4, 2, null, 4, null, null, 0, null],
  [0, 2, 4, 2, 0, null, null, 4, 5, null, 4, null, 2, null, null, null],
  [5, null, 4, null, 2, null, 4, null, 5, 7, null, 5, 4, null, null, null],
];

const TRACKS = {
  menu: {
    bpm: 100,
    form: [[Cmaj7, Am7, Dm7, G7], [Cmaj7, Am7, Dm7, G7], [F, Em, Dm7, G7]],
    scale: [60, 62, 64, 67, 69, 72, 74, 76],
    step(i, t, bar, chord, sec, dur, ctx) {
      if (i === 0) kick(t, 0.32);
      if (i === 8 && bar % 2) kick(t, 0.22);
      if (i % 2 === 1) shaker(t, 0.02);
      if (i === 0 || i === 8) bass(t, chord[0] - 24, dur * 7, 0.2);
      // Gentle arpeggio up and down the chord.
      if (i % 2 === 0) {
        const order = [0, 1, 2, 3, 2, 1, 2, 1];
        marimba(t, chord[order[(i / 2) % 8] % chord.length] + 12, 0.08);
      }
      // A light marimba tune on top in the last section.
      if (sec === 2 && ctx.phrase && i % 2 === 0) {
        const deg = ctx.phrase[i];
        if (deg !== null && deg !== undefined) marimba(t, this.scale[deg] + 12, 0.07);
      }
    },
  },
  race: {
    bpm: 128,
    form: [[C, Am, F, G], [C, Am, F, G], [F, G, Em, Am], [F, F, G, G]],
    scale: [60, 62, 64, 67, 69, 72, 74, 76, 79],
    step(i, t, bar, chord, sec, dur, ctx) {
      const breakdown = sec === 3;
      // Drums: four-on-the-floor in the chorus, half time in the breakdown, a fill to finish it.
      if (!breakdown) {
        if (i % 4 === 0) kick(t);
        if (i === 4 || i === 12) clap(t);
        if (i % 2 === 0) hat(t, i % 4 === 2 ? 0.06 : 0.035, i === 14 && bar % 2 === 1);
      } else {
        if (i === 0) kick(t);
        if (i === 8) snare(t, 0.12);
        if (bar === 3 && i >= 8) snare(t, 0.06 + (i - 8) * 0.015);
        if (i % 4 === 2) hat(t, 0.03);
      }
      // Bouncy bass: root, octave hop, fifth.
      const r = chord[0] - 24;
      const pattern = { 0: r, 3: r + 12, 6: r, 8: r, 10: r + 7, 11: r + 12, 14: r + 7 };
      if (i in pattern) bass(t, pattern[i], dur * 1.6);
      // Offbeat chord stabs give the skippy party feel.
      if (!breakdown && i % 4 === 2) stab(t, chord);
      if (breakdown && i === 0) pad(t, chord, dur * 16, 0.025);
      // Melody in the second verse and the chorus (a new phrase every bar or two).
      if ((sec === 1 || sec === 2) && ctx.phrase) {
        const deg = ctx.phrase[i];
        if (deg !== null && deg !== undefined) lead(t, this.scale[deg] + (sec === 2 ? 12 : 0), dur * 1.8, 0.065);
      }
    },
  },
  survival: {
    bpm: 120,
    form: [[Dm, C, Bb, C], [Dm, C, Bb, C], [Bb, C, Dm, Dm]],
    scale: [62, 65, 67, 69, 72, 74, 77, 79, 81],
    step(i, t, bar, chord, sec, dur, ctx) {
      if (i === 0 || i === 6 || i === 10) kick(t, 0.5);
      if (i === 4 || i === 12) snare(t, 0.14);
      hat(t, i % 2 ? 0.025 : 0.045);
      if (i % 2 === 0) bass(t, chord[0] - 24 + (i === 14 ? 12 : 0), dur * 1.5, 0.24);
      if (i % 2 === 0) sub(t, chord[0] - 12, dur * 1.5);
      if (i === 0) pad(t, chord, dur * 16, 0.022);
      if (sec >= 1 && ctx.phrase) {
        const deg = ctx.phrase[i];
        if (deg !== null && deg !== undefined && i % 2 === 0) lead(t, this.scale[deg], dur * 2.2, 0.055);
      }
    },
  },
  final: {
    bpm: 142,
    form: [[Am, F, C, G], [Am, F, C, G], [F, G, Am, Am], [Dm, Em, F, G]],
    scale: [57, 60, 62, 64, 67, 69, 72, 74, 76],
    step(i, t, bar, chord, sec, dur, ctx) {
      if (i % 4 === 0) kick(t, 0.55);
      if (i === 4 || i === 12) clap(t, 0.14);
      hat(t, i % 2 ? 0.03 : 0.05);
      bass(t, chord[0] - 24 + (i % 4 === 2 ? 12 : 0), dur * 0.9, 0.24);
      if (i === 0) pad(t, chord, dur * 16, 0.03);
      if (sec === 3 && bar === 3 && i >= 8) tom(t, 50 - (i - 8) * 2, 0.16);
      if (sec !== 0 && ctx.phrase) {
        const deg = ctx.phrase[i];
        if (deg !== null && deg !== undefined) lead(t, this.scale[deg] + 12, dur * 1.5, 0.06);
      }
    },
  },
};

class Music {
  constructor() {
    this.name = null;
    this.timer = null;
    this.out = null;
  }

  /** Start a track (fading out whatever was playing). Same track again: keep playing. */
  play(name) {
    if (name === this.name) return;
    this.stop();
    const a = audio();
    const track = TRACKS[name];
    if (!a || !track) return;
    this.name = name;
    this.track = track;
    this.stepDur = 60 / track.bpm / 4;
    this.pos = 0;                         // step within the whole form
    this.next = a.currentTime + 0.08;
    this.ctx = { phrase: null };
    const tick = () => this._schedule();
    this.timer = setInterval(tick, 25);
    tick();
  }

  /** Stop: nothing new is queued, and the last notes ring out naturally. */
  stop() {
    clearInterval(this.timer);
    this.timer = null;
    this.name = null;
  }

  _schedule() {
    const a = audio();
    if (!a || a.state !== "running") { if (a) this.next = a.currentTime + 0.05; return; }
    const tr = this.track;
    const barsPerSection = 4, stepsPerBar = 16;
    const total = tr.form.length * barsPerSection * stepsPerBar;
    while (this.next < a.currentTime + 0.12) {
      const p = this.pos % total;
      const sec = Math.floor(p / (barsPerSection * stepsPerBar));
      const bar = Math.floor(p / stepsPerBar) % barsPerSection;
      const i = p % stepsPerBar;
      // A fresh melody phrase every bar or two, so it never repeats exactly.
      if (i === 0 && (bar % 2 === 0 || Math.random() < 0.4)) this.ctx.phrase = Math.random() < 0.15 ? null : pick(PHRASES);
      tr.step.call(tr, i, this.next, bar, tr.form[sec][bar], sec, this.stepDur, this.ctx);
      this.next += this.stepDur;
      this.pos++;
    }
  }
}

export const music = new Music();
