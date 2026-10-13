import type { Client } from '@platform/client';

/**
 * Block Ice's sounds, synthesised on each screen: the puck (a wrister's snap, a slapper's crack,
 * the boards' thud, the glass's rattle, a post's ping, the twine, a clack on the ice), the bodies
 * (a skate's carve, a hit, a big one into the boards, a poke, a pad save and a glove's pop), the
 * arena (the goal horn, the period's horn, the whistle, the organ, the crowd's murmur and roar).
 */
export function defineSounds(client: Client) {
  const a = client.audio;
  const rnd = (lo: number, hi: number) => lo + Math.random() * (hi - lo);
  // A wrist shot: a quick snap of the blade.
  a.define('ice_wrist', (s) => {
    s.noise({ duration: 0.05, filter: 'bandpass', from: 2600, to: 1400, q: 1.6, volume: 0.5 });
    s.tone({ wave: 'triangle', from: 520 * s.pitch, to: 260 * s.pitch, duration: 0.06, volume: 0.25 });
  });
  // A slap shot: the stick cracking down on the ice and through the puck.
  a.define('ice_slap', (s) => {
    s.noise({ duration: 0.09, filter: 'highpass', from: 1800, volume: 0.7 });
    s.tone({ wave: 'square', from: 180 * s.pitch, to: 70 * s.pitch, duration: 0.12, volume: 0.35, lowpass: 1600, drive: 0.4 });
    s.noise({ duration: 0.04, delay: 0.015, filter: 'bandpass', from: 3500, q: 2, volume: 0.45 });
  });
  // The boards: a hollow thud, wood and plastic.
  a.define('ice_boards', (s) => {
    s.tone({ wave: 'sine', from: rnd(110, 130) * s.pitch, to: 60 * s.pitch, duration: 0.22, volume: 0.7 });
    s.noise({ duration: 0.12, filter: 'lowpass', from: 1300, to: 250, volume: 0.45 });
    s.tone({ wave: 'triangle', from: 300 * s.pitch, to: 180 * s.pitch, duration: 0.09, volume: 0.15 });
  });
  // The glass: a shivering rattle.
  a.define('ice_glass', (s) => {
    s.noise({ duration: 0.35, filter: 'bandpass', from: 4200, to: 2500, q: 2.5, volume: 0.35 });
    s.tone({ wave: 'sine', from: 1900 * s.pitch, duration: 0.4, volume: 0.08, fm: { ratio: 1.41, depth: 1.2, to: 0.3 }, vibrato: { rate: 30, depth: 40 } });
    s.tone({ wave: 'sine', from: 95 * s.pitch, to: 60 * s.pitch, duration: 0.25, volume: 0.4 });
  });
  // A post: PING.
  a.define('ice_post', (s) => {
    const f = rnd(1250, 1400) * s.pitch;
    s.tone({ wave: 'sine', from: f, to: f * 0.98, duration: 1.1, volume: 0.42, fm: { ratio: 2.76, depth: 1.6, to: 0.2 } });
    s.tone({ wave: 'sine', from: f * 2.7, duration: 0.4, volume: 0.12, fm: { ratio: 1.41, depth: 0.8 } });
    s.noise({ duration: 0.02, filter: 'highpass', from: 4000, volume: 0.4 });
  });
  // The twine: the puck into the back of the net.
  a.define('ice_twine', (s) => {
    s.noise({ duration: 0.28, attack: 0.01, filter: 'bandpass', from: 2400, to: 900, q: 1.1, volume: 0.45 });
    s.tone({ wave: 'sine', from: 140 * s.pitch, to: 80 * s.pitch, duration: 0.15, volume: 0.25 });
  });
  // The puck landing on the ice.
  a.define('ice_clack', (s) => {
    s.noise({ duration: 0.03, filter: 'bandpass', from: 3000, q: 2, volume: 0.4 });
    s.tone({ wave: 'triangle', from: 900 * s.pitch, to: 500 * s.pitch, duration: 0.04, volume: 0.15 });
  });
  // A skate's carve: steel scraping the ice.
  a.define('ice_stride', (s) => {
    s.noise({ duration: 0.18, attack: 0.04, filter: 'bandpass', from: rnd(5200, 6400), to: rnd(3800, 4600), q: 3, volume: 0.22 });
    s.noise({ duration: 0.12, attack: 0.02, filter: 'highpass', from: 7000, volume: 0.06 });
  });
  // A hit: bodies meeting.
  a.define('ice_hit', (s) => {
    s.noise({ duration: 0.1, filter: 'lowpass', from: 900, to: 160, volume: 0.75 });
    s.tone({ wave: 'sine', from: 120 * s.pitch, to: 50 * s.pitch, duration: 0.2, volume: 0.7 });
  });
  // Into the boards: the whole wall shudders.
  a.define('ice_crunch', (s) => {
    s.noise({ duration: 0.18, filter: 'lowpass', from: 1400, to: 140, volume: 0.9 });
    s.tone({ wave: 'sine', from: 90 * s.pitch, to: 38 * s.pitch, duration: 0.45, volume: 0.95, drive: 0.35 });
    s.tone({ wave: 'sawtooth', from: 65 * s.pitch, to: 45 * s.pitch, duration: 0.3, volume: 0.15, lowpass: 380, vibrato: { rate: 22, depth: 5 } });
  });
  // A poke, a block: stick on stick, a clack.
  a.define('ice_poke', (s) => {
    s.noise({ duration: 0.05, filter: 'bandpass', from: 1900, q: 3, volume: 0.5 });
    s.tone({ wave: 'triangle', from: 640 * s.pitch, to: 420 * s.pitch, duration: 0.06, volume: 0.25 });
  });
  // A pad save: a dull whump.
  a.define('ice_pad', (s) => {
    s.tone({ wave: 'sine', from: 150 * s.pitch, to: 70 * s.pitch, duration: 0.16, volume: 0.65 });
    s.noise({ duration: 0.08, filter: 'lowpass', from: 1000, to: 300, volume: 0.4 });
  });
  // A glove save: the pop of leather.
  a.define('ice_glove', (s) => {
    s.noise({ duration: 0.06, filter: 'bandpass', from: 1300, to: 700, q: 1.4, volume: 0.7 });
    s.tone({ wave: 'sine', from: 240 * s.pitch, to: 120 * s.pitch, duration: 0.09, volume: 0.5 });
  });
  // Flames: a roaring whoosh.
  a.define('ice_flame', (s) => {
    s.noise({ duration: 0.8, attack: 0.08, filter: 'lowpass', from: 3000, to: 400, volume: 0.5 });
    s.noise({ duration: 0.6, attack: 0.05, filter: 'bandpass', from: 900, to: 300, q: 0.8, volume: 0.3 });
    s.tone({ wave: 'sawtooth', from: 60 * s.pitch, to: 45 * s.pitch, duration: 0.7, volume: 0.12, lowpass: 260, drive: 0.5 });
  });
  // The goal horn: a huge low ship's horn, two notes a fifth apart, held.
  a.define(
    'ice_horn',
    (s) => {
      for (const [f, v] of [[110, 0.32], [165, 0.24], [220, 0.12]] as const) {
        s.tone({ wave: 'sawtooth', from: f * s.pitch, duration: 0.5, attack: 0.08, hold: 2.2, volume: v, lowpass: 900, drive: 0.25 });
      }
      s.tone({ wave: 'square', from: 55 * s.pitch, duration: 0.5, attack: 0.1, hold: 2.2, volume: 0.12, lowpass: 300 });
    },
    { reverb: 0.7 },
  );
  // The period's horn: shorter, harsher.
  a.define(
    'ice_buzzer',
    (s) => {
      s.tone({ wave: 'square', from: 185 * s.pitch, duration: 0.2, hold: 1.1, volume: 0.28, lowpass: 2000 });
      s.tone({ wave: 'sawtooth', from: 188 * s.pitch, duration: 0.2, hold: 1.1, volume: 0.16, lowpass: 1700 });
    },
    { reverb: 0.6 },
  );
  // The linesman's whistle (the faceoff).
  a.define('ice_whistle', (s) => {
    s.tone({ wave: 'sine', from: 3000 * s.pitch, duration: 0.1, hold: 0.22, volume: 0.22, vibrato: { rate: 34, depth: 120 } });
    s.noise({ duration: 0.15, hold: 0.18, filter: 'bandpass', from: 3100, q: 4, volume: 0.05 });
  });
  // The organ after a goal: a rising arpeggio and a big chord ("da-da-da-DAAA").
  a.define(
    'ice_organ_goal',
    (s) => {
      const notes = [392, 523.25, 659.25, 784];
      notes.forEach((f, i) => {
        const last = i === notes.length - 1;
        for (const [m, v] of [[1, 0.16], [2, 0.08], [0.5, 0.06]] as const) {
          s.tone({ wave: 'square', from: f * m * s.pitch, duration: last ? 0.5 : 0.12, hold: last ? 0.7 : 0.05, delay: 0.55 + i * 0.16, volume: v, lowpass: 2600, vibrato: last ? { rate: 6, depth: 4 } : undefined });
        }
      });
    },
    { reverb: 0.8 },
  );
  // The crowd going up: a swell of voices.
  a.define(
    'ice_cheer',
    (s) => {
      for (let i = 0; i < 3; i++) s.noise({ duration: 1.2, attack: 0.12, hold: 0.5, delay: i * 0.05, filter: 'bandpass', from: rnd(700, 1300), to: rnd(500, 900), q: 0.9, volume: 0.22 });
      s.noise({ duration: 1.1, attack: 0.1, hold: 0.4, filter: 'highpass', from: 2500, volume: 0.06 });
    },
    { reverb: 0.8 },
  );
  // The crowd's murmur, always there.
  a.defineLoop('ice_crowd', (l) => {
    l.noise({ freq: 520, filter: 'bandpass', q: 0.8, volume: 0.32 });
    l.noise({ freq: 1150, filter: 'bandpass', q: 1.1, volume: 0.16 });
    l.noise({ freq: 180, filter: 'lowpass', q: 0.7, volume: 0.12 });
  });
}
