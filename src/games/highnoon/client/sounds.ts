import type { SynthKit } from '@platform';
import type { Client } from '@platform/client';

/**
 * Dry Gulch's sounds, all synthesised on each screen (`client.audio.define`: nothing is recorded
 * or sent): a black-powder crack with a long canyon echo for each gun, a round thumbed into the
 * gate, the lever, the dry click of an empty chamber, a ricochet's whine; the church bell that
 * starts a round, a whistled "wah-wah" for the last one standing, spurs. The guns play theirs
 * through their looks (`./looks`); the server plays the rest by name (`audio.play('bell')`).
 */

/** A shot: a low boom, a blast of noise, a crack, and the echo coming back off the mesas. */
function shot(s: SynthKit, o: { boom: number; body: number; bright: number; crack: number; echo: number; loud?: number }) {
  const p = s.pitch;
  const v = o.loud ?? 1;
  s.tone({ wave: 'sine', from: o.boom * p, to: 34, duration: o.body * 0.9, volume: 0.95 * v });
  s.noise({ duration: o.body, filter: 'lowpass', from: o.bright * p, to: 300, volume: 0.8 * v });
  s.noise({ duration: 0.025, filter: 'highpass', from: 4800, to: 2600, volume: o.crack * v });
  // The echo: twice, fainter and duller, off the far rocks.
  s.noise({ duration: o.echo, delay: 0.22, filter: 'lowpass', from: 1300 * p, to: 140, volume: 0.2 * v });
  s.noise({ duration: o.echo * 0.8, delay: 0.55, filter: 'lowpass', from: 800 * p, to: 110, volume: 0.09 * v });
}

function click(s: SynthKit, delay: number, f: number, v = 0.3) {
  s.tone({ wave: 'square', from: f * s.pitch, to: f * 0.55 * s.pitch, duration: 0.03, volume: v * 0.45, delay, lowpass: 3600 });
  s.noise({ duration: 0.035, delay, filter: 'bandpass', from: f * 2.4, to: f * 1.7, q: 4, volume: v });
}

/** A bell: a few inharmonic partials ringing down. */
function bell(s: SynthKit, f: number, delay = 0, v = 0.3) {
  for (const [k, a] of [
    [1, 1],
    [2.02, 0.5],
    [2.74, 0.35],
    [4.1, 0.2],
    [0.5, 0.4],
  ] as const)
    s.tone({ wave: 'sine', from: f * k, to: f * k * 0.998, duration: 2.4 / Math.sqrt(k), volume: v * a, delay, attack: 0.004 });
}

export function defineSounds(client: Client) {
  const a = client.audio;
  a.define('shot_revolver', (s) => shot(s, { boom: 170, body: 0.16, bright: 3800, crack: 0.5, echo: 0.6, loud: 0.95 }));
  a.define('shot_rifle', (s) => shot(s, { boom: 120, body: 0.24, bright: 4600, crack: 0.7, echo: 0.9, loud: 1.1 }));
  a.define('load_round', (s) => {
    click(s, 0.0, 1500, 0.25); // the gate
    click(s, 0.12, 900, 0.35); // the round in
  });
  a.define('lever', (s) => {
    click(s, 0.02, 700, 0.4); // down…
    s.noise({ duration: 0.08, delay: 0.05, filter: 'bandpass', from: 2400, to: 1200, q: 2, volume: 0.12 });
    click(s, 0.2, 1100, 0.45); // …and home
  });
  a.define('dry_fire', (s) => click(s, 0, 2400, 0.35));
  a.define('ricochet', (s) => {
    s.tone({ wave: 'sine', from: 3400 * s.pitch, to: 900 * s.pitch, duration: 0.45, volume: 0.12, vibrato: { rate: 30, depth: 60 } });
    s.noise({ duration: 0.05, filter: 'highpass', from: 5000, to: 3000, volume: 0.15 });
  });
  a.define('spurs', (s) => {
    for (const d of [0, 0.07, 0.13]) s.tone({ wave: 'triangle', from: 5200 * s.pitch, to: 4800 * s.pitch, duration: 0.09, volume: 0.05, delay: d });
  });
  a.define('bell', (s) => {
    bell(s, 392, 0, 0.28);
    bell(s, 392, 0.9, 0.24);
  });
  a.define('draw', (s) => {
    // The bell's last stroke and a sharp brass stab: go.
    bell(s, 523, 0, 0.3);
    for (const f of [392, 523, 659]) s.tone({ wave: 'sawtooth', from: f * s.pitch, to: f * s.pitch, duration: 0.35, volume: 0.07, lowpass: 2400, attack: 0.01 });
  });
  a.define('tick', (s) => s.noise({ duration: 0.03, filter: 'bandpass', from: 2800, to: 2600, q: 8, volume: 0.25 }));
  a.define('whistle', (s) => {
    // Ooo-ee-ooo: the whistled motif of a Western showdown.
    const notes: [number, number, number][] = [
      [880, 1320, 0],
      [1320, 1320, 0.28],
      [880, 880, 0.5],
      [880, 660, 0.9],
    ];
    for (const [f, t, d] of notes) s.tone({ wave: 'sine', from: f * s.pitch, to: t * s.pitch, duration: 0.3, volume: 0.13, delay: d, vibrato: { rate: 6, depth: 10 }, attack: 0.03 });
  });
  a.define('cash', (s) => {
    click(s, 0, 2000, 0.3);
    s.tone({ wave: 'triangle', from: 2637 * s.pitch, to: 2637 * s.pitch, duration: 0.5, volume: 0.1, delay: 0.05 });
    s.tone({ wave: 'triangle', from: 3136 * s.pitch, to: 3136 * s.pitch, duration: 0.5, volume: 0.08, delay: 0.12 });
  });
  a.define('dead_eye', (s) => {
    s.tone({ wave: 'sine', from: 180 * s.pitch, to: 60 * s.pitch, duration: 0.5, volume: 0.35 });
    s.noise({ duration: 0.4, filter: 'bandpass', from: 1200, to: 300, q: 1.5, volume: 0.12 });
  });
}
