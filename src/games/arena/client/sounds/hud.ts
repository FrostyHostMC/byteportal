import type { Client } from '@platform/client';
import type { SynthKit } from '@platform';

/**
 * The HUD's voices, synthesised on each screen: the announcer's stings (war horns, drums and a
 * choir's "ah"), hit confirms and the kill's crunch, coins, the heartbeat, the crowd in the stands
 * (its murmur and roar as loops, cheers, gasps, groans, claps and whistles), gore, and the music's
 * instruments (`ar_music`, played a beat at a time by `client/hud/music.ts` from `score`).
 */

/** A note's pitch: `n` semitones from the A below middle C (220 Hz). */
export const hz = (n: number) => 220 * Math.pow(2, n / 12);

/** Vowels' formants (Hz) and how loud each is: a choir's "ah", "oh", "oo", "eh". */
const VOWELS = {
  a: [
    [730, 1],
    [1090, 0.5],
    [2440, 0.12],
  ],
  o: [
    [570, 1],
    [840, 0.45],
    [2410, 0.08],
  ],
  u: [
    [300, 1],
    [870, 0.25],
    [2240, 0.05],
  ],
  e: [
    [530, 1],
    [1840, 0.35],
    [2480, 0.12],
  ],
} as const;
export type Vowel = keyof typeof VOWELS;

/** A voice singing `vowel` at `f` Hz: a buzz through the vowel's formants, swelling and wavering. */
export function sing(s: SynthKit, f: number, vowel: Vowel, o: { delay?: number; attack?: number; hold?: number; duration?: number; volume?: number; to?: number }) {
  const v = o.volume ?? 0.1;
  for (const [formant, loud] of VOWELS[vowel]) {
    for (const detune of [1, 1.006]) {
      s.tone({
        wave: 'sawtooth',
        from: f * detune,
        to: o.to ? o.to * detune : undefined,
        duration: o.duration ?? 0.6,
        attack: o.attack ?? 0.15,
        hold: o.hold ?? 0.3,
        delay: o.delay,
        volume: v * loud,
        bandpass: { freq: formant, q: 7 },
        vibrato: { rate: 5 + detune, depth: f * 0.012 },
      });
    }
  }
}

/** A war horn: brassy buzz at `f`, swelling. */
function horn(s: SynthKit, f: number, o: { delay?: number; attack?: number; hold?: number; duration?: number; volume?: number; to?: number }) {
  const v = o.volume ?? 0.2;
  for (const [mul, loud] of [
    [1, 1],
    [1.004, 0.7],
    [2, 0.25],
  ] as const) {
    s.tone({ wave: 'sawtooth', from: f * mul, to: o.to ? o.to * mul : undefined, duration: o.duration ?? 0.7, attack: o.attack ?? 0.09, hold: o.hold ?? 0.35, delay: o.delay, volume: v * loud, lowpass: { freq: 600, to: 1600, time: 0.25 }, fm: { ratio: 1, depth: 0.5, to: 0.2 } });
  }
}

/** A big drum: a deep thump and its skin. */
function taiko(s: SynthKit, delay = 0, volume = 0.5, pitch = 1) {
  s.tone({ from: 120 * pitch, to: 42 * pitch, duration: 0.5, attack: 0.002, delay, volume });
  s.noise({ duration: 0.14, filter: 'lowpass', from: 900, to: 120, volume: volume * 0.55, delay });
}

/** A bright brass stab: a chord of `notes` (Hz). */
function stab(s: SynthKit, notes: number[], delay = 0, volume = 0.1, duration = 0.35) {
  for (const f of notes) {
    for (const d of [1, 1.005]) s.tone({ wave: 'sawtooth', from: f * d, duration, attack: 0.012, delay, volume, lowpass: { freq: 3200, to: 900, time: duration }, fm: { ratio: 1, depth: 0.35, to: 0.1 } });
  }
}

/** A bell, ringing like metal. */
function bell(s: SynthKit, f: number, delay = 0, volume = 0.08) {
  s.tone({ from: f, duration: 1.4, attack: 0.002, delay, volume, fm: { ratio: 3.5, depth: 1.2, to: 0.1 } });
  s.tone({ from: f * 2.76, duration: 0.6, attack: 0.002, delay, volume: volume * 0.35 });
}

/** A noise swell like a cymbal's. */
function swell(s: SynthKit, duration: number, delay = 0, volume = 0.12) {
  s.noise({ duration: 0.6, attack: duration, filter: 'highpass', from: 3000, to: 7000, volume, delay });
}

// ---------------------------------------------------------------------------------------------
// The music's instruments
// ---------------------------------------------------------------------------------------------

export type Instrument = 'taiko' | 'tom' | 'clap' | 'hat' | 'shaker' | 'pluck' | 'bass' | 'stab' | 'choir' | 'horn' | 'bell' | 'roll';

/** One note of the music: an instrument, `t` seconds into the beat, how loud, its pitch(es) and length. */
export interface Note {
  i: Instrument;
  t: number;
  v: number;
  f?: number[];
  d?: number;
  vowel?: Vowel;
}

const INSTRUMENTS: Record<Instrument, (s: SynthKit, n: Note) => void> = {
  taiko: (s, n) => taiko(s, n.t, n.v, n.f?.[0] ?? 1),
  tom: (s, n) => {
    s.tone({ from: 210 * (n.f?.[0] ?? 1), to: 120 * (n.f?.[0] ?? 1), duration: 0.24, attack: 0.002, delay: n.t, volume: n.v });
    s.noise({ duration: 0.07, filter: 'bandpass', from: 1200, to: 600, q: 1.2, volume: n.v * 0.4, delay: n.t });
  },
  clap: (s, n) => {
    for (let i = 0; i < 3; i++) s.noise({ duration: i === 2 ? 0.16 : 0.03, filter: 'bandpass', from: 1500, to: 1100, q: 1.1, volume: n.v, delay: n.t + i * 0.011 });
  },
  hat: (s, n) => s.noise({ duration: n.d ?? 0.035, filter: 'highpass', from: 8000, to: 7000, volume: n.v, delay: n.t }),
  shaker: (s, n) => s.noise({ duration: 0.06, attack: 0.025, filter: 'bandpass', from: 6500, to: 5500, q: 2, volume: n.v, delay: n.t }),
  pluck: (s, n) => {
    for (const f of n.f ?? [220]) {
      s.tone({ wave: 'triangle', from: f, duration: n.d ?? 0.4, attack: 0.003, delay: n.t, volume: n.v, lowpass: { freq: 3400, to: 700, time: 0.3 } });
      s.tone({ wave: 'sine', from: f * 2, duration: 0.15, attack: 0.002, delay: n.t, volume: n.v * 0.25 });
    }
  },
  bass: (s, n) => {
    const f = n.f?.[0] ?? 73.4;
    s.tone({ wave: 'sawtooth', from: f, duration: n.d ?? 0.3, attack: 0.006, delay: n.t, volume: n.v, lowpass: { freq: 700, to: 180, time: 0.25 } });
    s.tone({ wave: 'sine', from: f, duration: n.d ?? 0.3, attack: 0.006, delay: n.t, volume: n.v * 0.9 });
  },
  stab: (s, n) => stab(s, n.f ?? [hz(-7), hz(-3), hz(0)], n.t, n.v, n.d ?? 0.3),
  choir: (s, n) => {
    for (const f of n.f ?? [hz(-19)]) sing(s, f, n.vowel ?? 'a', { delay: n.t, attack: 0.35, hold: (n.d ?? 1.5) - 0.6, duration: 0.6, volume: n.v });
  },
  horn: (s, n) => {
    for (const f of n.f ?? [hz(-19)]) horn(s, f, { delay: n.t, hold: (n.d ?? 0.8) - 0.3, volume: n.v });
  },
  bell: (s, n) => {
    for (const f of n.f ?? [hz(17)]) bell(s, f, n.t, n.v);
  },
  roll: (s, n) => {
    const d = n.d ?? 0.5;
    for (let t = 0; t < d; t += 0.045) s.tone({ from: 150, to: 90, duration: 0.12, attack: 0.002, delay: n.t + t, volume: n.v * (0.4 + (0.6 * t) / d) });
  },
};

/** The beat to play next (`ar_music`): the music kit fills it, plays the voice, and empties it. */
export const score: Note[] = [];

export function defineHudSounds(client: Client) {
  const a = client.audio;
  const dry = { reverb: 0 };

  // ---------- The music ----------
  // A beat of it, as the music kit has filled `score` (twice over: the beats take turns).
  for (const name of ['ar_music', 'ar_music_b']) {
    a.define(name, (s) => {
      for (const n of score) INSTRUMENTS[n.i](s, n);
    }, { reverb: 0.3 });
  }
  // The drone under it all: D, low, with its fifth, darkly filtered.
  a.defineLoop('ar_drone', (l) => {
    l.tone({ wave: 'sawtooth', freq: 73.42, volume: 0.32, lowpass: 320 });
    l.tone({ wave: 'sawtooth', freq: 110.0, volume: 0.18, lowpass: 360 });
    l.tone({ wave: 'sine', freq: 36.71, volume: 0.5 });
    l.tone({ wave: 'triangle', freq: 146.83, volume: 0.06, vibrato: { rate: 0.2, depth: 0.6 } });
  });

  // ---------- The announcer's stings ----------
  // A wave begins: a war horn and two drums.
  a.define('ar_sting_wave', (s) => {
    horn(s, hz(-19), { volume: 0.16, hold: 0.45 });
    horn(s, hz(-12), { volume: 0.1, hold: 0.45 });
    taiko(s, 0, 0.55);
    taiko(s, 0.2, 0.4, 1.1);
  }, { reverb: 0.4 });
  // The final wave: horns in a chord, the choir, a drum roll into a hit.
  a.define('ar_sting_final', (s) => {
    for (const n of [-31, -24, -19, -15]) horn(s, hz(n), { volume: 0.075, hold: 1.1, attack: 0.25 });
    for (const n of [-19, -15, -12]) sing(s, hz(n), 'a', { attack: 0.4, hold: 1, duration: 0.8, volume: 0.07 });
    for (let t = 0; t < 0.6; t += 0.05) taiko(s, t, 0.12 + t * 0.35, 1.2);
    taiko(s, 0.65, 0.7);
    swell(s, 0.6, 0, 0.1);
  }, { reverb: 0.5 });
  // A boss wave: a deep horn against its own half step, a low "oh", one huge drum.
  a.define('ar_sting_boss', (s) => {
    horn(s, hz(-31), { volume: 0.18, hold: 1.2, attack: 0.3 });
    horn(s, hz(-30), { volume: 0.08, hold: 1.2, attack: 0.5 });
    for (const n of [-24, -21]) sing(s, hz(n), 'o', { attack: 0.5, hold: 1, duration: 0.9, volume: 0.09 });
    taiko(s, 0, 0.8, 0.8);
    taiko(s, 0.9, 0.6, 0.75);
    s.noise({ duration: 1.6, filter: 'lowpass', from: 500, to: 80, volume: 0.25 });
  }, { reverb: 0.5 });
  // A new foe: a low horn's question and a drum.
  a.define('ar_sting_foe', (s) => {
    horn(s, hz(-24), { volume: 0.08, hold: 0.2, duration: 0.5, to: hz(-23) });
    taiko(s, 0, 0.3, 1.1);
    s.tone({ wave: 'triangle', from: hz(10), duration: 0.5, delay: 0.12, volume: 0.06 });
  }, { reverb: 0.4 });
  // A twist: two quick stabs and a shimmer.
  a.define('ar_sting_twist', (s) => {
    stab(s, [hz(-7), hz(-4), hz(0)], 0, 0.06, 0.18);
    stab(s, [hz(-6), hz(-3), hz(1)], 0.16, 0.07, 0.4);
    s.noise({ duration: 0.5, filter: 'highpass', from: 6000, to: 9000, volume: 0.05, delay: 0.16 });
  }, { reverb: 0.4 });
  // A wave won: a bright chord, resolving, and a bell.
  a.define('ar_sting_cleared', (s) => {
    stab(s, [hz(-7), hz(-3), hz(0)], 0, 0.07, 0.2);
    stab(s, [hz(-2), hz(2), hz(5)], 0.14, 0.085, 0.9);
    bell(s, hz(17), 0.14, 0.07);
    taiko(s, 0, 0.35, 1.2);
  }, { reverb: 0.5 });
  // The Crowd's Favour: brass climbing to a held chord, bells.
  a.define('ar_sting_favour', (s) => {
    const up = [hz(5), hz(9), hz(12), hz(17)];
    up.forEach((f, i) => stab(s, [f, f / 2], i * 0.07, 0.11, 0.2));
    stab(s, [hz(5), hz(9), hz(12), hz(17)], 0.3, 0.08, 1.1);
    taiko(s, 0.3, 0.6, 1.1);
    bell(s, hz(29), 0.3, 0.09);
    bell(s, hz(24), 0.42, 0.07);
    swell(s, 0.3, 0, 0.14);
  }, { reverb: 0.5 });
  // A feat (a multikill, a parry): one brass hit, higher the bigger the feat (`pitch`).
  a.define('ar_sting_feat', (s) => {
    stab(s, [hz(-7) * s.pitch, hz(-3) * s.pitch, hz(0) * s.pitch], 0, 0.1, 0.26);
    s.noise({ duration: 0.08, filter: 'highpass', from: 5000, volume: 0.09 });
    taiko(s, 0, 0.45, 1.3);
  }, { reverb: 0.3 });
  // Their own fall: a dull blow, the music draining away.
  a.define('ar_sting_out', (s) => {
    taiko(s, 0, 0.6, 0.7);
    horn(s, hz(-19), { volume: 0.1, to: hz(-26), hold: 0.4, duration: 1.2 });
    sing(s, hz(-17), 'o', { attack: 0.3, hold: 0.4, duration: 1, volume: 0.06, to: hz(-22) });
  }, { reverb: 0.5 });
  // Back in the fight: a quick climb.
  a.define('ar_sting_back', (s) => {
    [hz(-7), hz(-3), hz(0), hz(5)].forEach((f, i) => stab(s, [f], i * 0.06, 0.08, 0.18));
  }, { reverb: 0.3 });
  // A friend's fortunes (down, back up): a soft two-note call.
  a.define('ar_sting_ally', (s) => {
    s.tone({ wave: 'triangle', from: hz(7), duration: 0.18, volume: 0.12 });
    s.tone({ wave: 'triangle', from: hz(3), duration: 0.3, delay: 0.14, volume: 0.12 });
  }, dry);
  // Victory: a fanfare up to a held chord, the choir and the drums under it.
  a.define('ar_sting_victory', (s) => {
    const notes = [hz(-7), hz(-3), hz(0), hz(5)];
    notes.forEach((f, i) => stab(s, [f, f / 2], i * 0.13, 0.07, 0.22));
    stab(s, [hz(-7), hz(-3), hz(0), hz(5)], 0.55, 0.06, 2.2);
    for (const n of [-7, -3, 0]) sing(s, hz(n), 'a', { delay: 0.55, attack: 0.3, hold: 1.6, duration: 1, volume: 0.06 });
    for (let t = 0; t < 0.5; t += 0.05) taiko(s, t, 0.1 + t * 0.4, 1.3);
    taiko(s, 0.55, 0.8);
    bell(s, hz(17), 0.55, 0.06);
    swell(s, 0.5, 0.05, 0.12);
  }, { reverb: 0.6 });
  // Defeat: a horn falling through a minor chord, a last drum, a low "oh".
  a.define('ar_sting_defeat', (s) => {
    [hz(-12), hz(-15), hz(-19), hz(-24)].forEach((f, i) => horn(s, f, { delay: i * 0.4, volume: 0.11, hold: i === 3 ? 1.4 : 0.25, duration: i === 3 ? 1.6 : 0.4 }));
    for (const n of [-24, -21, -17]) sing(s, hz(n), 'o', { delay: 1.2, attack: 0.5, hold: 1.2, duration: 1.4, volume: 0.06 });
    taiko(s, 1.2, 0.8, 0.7);
  }, { reverb: 0.6 });
  // A level gained (the end screen).
  a.define('ar_level_up', (s) => {
    [hz(5), hz(9), hz(12)].forEach((f, i) => stab(s, [f], i * 0.09, 0.07, 0.15));
    stab(s, [hz(5), hz(9), hz(12), hz(17)], 0.27, 0.05, 1);
    bell(s, hz(29), 0.27, 0.05);
  }, { reverb: 0.4 });
  // The last seconds before a wave: a drum each.
  a.define('ar_count', (s) => {
    taiko(s, 0, 0.45, 1.25);
    s.noise({ duration: 0.03, filter: 'bandpass', from: 2600, q: 3, volume: 0.15 });
  }, { reverb: 0.3 });
  // Text arriving on a card: a soft tick.
  a.define('ar_tally', (s) => s.tone({ wave: 'triangle', from: 1800 * s.pitch, to: 1500 * s.pitch, duration: 0.05, volume: 0.2 }), dry);

  // ---------- Hits ----------
  // A hit landed: a dry knock, brighter for a heavier one (`pitch`).
  a.define('ar_hit', (s) => {
    s.tone({ wave: 'sine', from: 1900 * s.pitch, to: 1500 * s.pitch, duration: 0.05, attack: 0.001, volume: 0.32 });
    s.noise({ duration: 0.03, filter: 'highpass', from: 5000, volume: 0.14 });
  }, dry);
  // A heavy hit: a thump and a crunch of bone.
  a.define('ar_hit_heavy', (s) => {
    s.tone({ from: 150, to: 55, duration: 0.14, attack: 0.001, volume: 0.45 });
    s.noise({ duration: 0.12, filter: 'bandpass', from: 1600, to: 500, q: 0.8, volume: 0.3 });
    s.tone({ wave: 'square', from: 320, to: 180, duration: 0.05, volume: 0.06, drive: 0.6 });
  }, dry);
  // A kill: a meaty crunch under a bright confirm.
  a.define('ar_kill', (s) => {
    s.tone({ from: 130, to: 48, duration: 0.18, attack: 0.001, volume: 0.8 });
    s.noise({ duration: 0.1, filter: 'bandpass', from: 1100, to: 400, q: 0.9, volume: 0.5 });
    s.tone({ wave: 'triangle', from: 1568, duration: 0.07, attack: 0.002, volume: 0.2 });
    s.tone({ wave: 'triangle', from: 2349, duration: 0.16, delay: 0.055, attack: 0.002, volume: 0.2, fm: { ratio: 2, depth: 0.2, to: 0 } });
  }, dry);
  // A boss slain: a boom and a gong.
  a.define('ar_kill_boss', (s) => {
    s.tone({ from: 90, to: 28, duration: 1.4, attack: 0.002, volume: 0.8 });
    s.noise({ duration: 1.2, filter: 'lowpass', from: 2000, to: 90, volume: 0.5 });
    bell(s, hz(-12), 0.02, 0.12);
    bell(s, hz(-5), 0.02, 0.06);
  }, { reverb: 0.7 });
  // Gore: a wet splat where one dies.
  a.define('ar_gore', (s) => {
    s.noise({ duration: 0.22, filter: 'lowpass', from: 1700 * s.pitch, to: 200, volume: 0.5 });
    s.noise({ duration: 0.12, filter: 'bandpass', from: 380, q: 2, volume: 0.4, delay: 0.03 });
    s.tone({ from: 95 * s.pitch, to: 40, duration: 0.14, volume: 0.4 });
  });
  // A coin to the purse.
  a.define('ar_coin', (s) => {
    s.tone({ wave: 'triangle', from: 2350 * s.pitch, to: 2250 * s.pitch, duration: 0.09, attack: 0.001, volume: 0.22 });
    s.tone({ wave: 'triangle', from: 3520 * s.pitch, duration: 0.16, delay: 0.045, attack: 0.001, volume: 0.17 });
    s.noise({ duration: 0.02, filter: 'highpass', from: 7000, volume: 0.08 });
  }, dry);
  // Their heart, when it's nearly over: lub-dub.
  a.define('ar_heartbeat', (s) => {
    s.tone({ from: 62, to: 46, duration: 0.11, attack: 0.004, volume: 0.6 });
    s.tone({ from: 56, to: 42, duration: 0.13, delay: 0.17, attack: 0.004, volume: 0.45 });
  }, dry);

  // ---------- The crowd ----------
  // Thousands murmuring: noise in the bands a voice fills. Its loudness and brightness follow the fight.
  a.defineLoop('ar_crowd', (l) => {
    l.noise({ freq: 480, filter: 'bandpass', q: 0.9, volume: 1.1 });
    l.noise({ freq: 1150, filter: 'bandpass', q: 1.5, volume: 0.55 });
    l.noise({ freq: 2500, filter: 'bandpass', q: 2.5, volume: 0.12 });
  });
  // Their roar, swelling over it.
  a.defineLoop('ar_roar', (l) => {
    l.noise({ freq: 720, filter: 'bandpass', q: 1.1, volume: 0.6 });
    l.noise({ freq: 1400, filter: 'bandpass', q: 1.6, volume: 0.4 });
    l.noise({ freq: 3000, filter: 'bandpass', q: 3, volume: 0.1 });
    l.tone({ wave: 'sawtooth', freq: 190, volume: 0.03, bandpass: { freq: 760, q: 5 }, vibrato: { rate: 6, depth: 6 } });
    l.tone({ wave: 'sawtooth', freq: 240, volume: 0.025, bandpass: { freq: 1100, q: 5 }, vibrato: { rate: 5, depth: 8 } });
  });
  // A cheer: a burst of voices ("hey!"), a whistle or two.
  a.define('ar_cheer', (s) => {
    s.noise({ duration: 1.1, attack: 0.07, hold: 0.25, filter: 'bandpass', from: 900, to: 1300, q: 0.9, volume: 0.32 });
    for (let i = 0; i < 7; i++) {
      const f = (150 + Math.random() * 160) * s.pitch;
      sing(s, f, Math.random() < 0.5 ? 'e' : 'a', { delay: Math.random() * 0.15, attack: 0.05, hold: 0.15 + Math.random() * 0.2, duration: 0.4, volume: 0.035, to: f * 0.9 });
    }
    if (Math.random() < 0.6) s.tone({ from: 1700, glide: [[0.12, 2700], [0.35, 2300]], duration: 0.4, delay: 0.1 + Math.random() * 0.3, volume: 0.05 });
  }, { reverb: 0.8 });
  // A gasp: "ooh", falling.
  a.define('ar_gasp', (s) => {
    s.noise({ duration: 0.8, attack: 0.06, filter: 'bandpass', from: 1000, to: 600, q: 1.2, volume: 0.32 });
    for (let i = 0; i < 6; i++) {
      const f = 170 + Math.random() * 120;
      sing(s, f, 'o', { delay: Math.random() * 0.08, attack: 0.08, hold: 0.25, duration: 0.6, volume: 0.055, to: f * 0.8 });
    }
  }, { reverb: 0.8 });
  // A groan: "aww", sinking.
  a.define('ar_groan', (s) => {
    s.noise({ duration: 1.6, attack: 0.15, filter: 'bandpass', from: 800, to: 450, q: 1, volume: 0.3 });
    for (let i = 0; i < 7; i++) {
      const f = 160 + Math.random() * 110;
      sing(s, f, Math.random() < 0.5 ? 'a' : 'o', { delay: Math.random() * 0.12, attack: 0.15, hold: 0.5, duration: 1, volume: 0.035, to: f * 0.72 });
    }
  }, { reverb: 0.8 });
  // The stands clapping as one.
  a.define('ar_clap', (s) => {
    for (let i = 0; i < 14; i++) s.noise({ duration: 0.035, filter: 'bandpass', from: 1500 + Math.random() * 900, q: 1.4, volume: 0.2, delay: Math.random() * 0.05 });
  }, { reverb: 0.8 });
  // …and stamping.
  a.define('ar_stomp', (s) => {
    s.tone({ from: 75, to: 42, duration: 0.22, attack: 0.004, volume: 0.35 });
    s.noise({ duration: 0.12, filter: 'lowpass', from: 500, to: 120, volume: 0.25, delay: Math.random() * 0.02 });
  }, { reverb: 0.8 });
}
