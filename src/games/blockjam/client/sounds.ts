import type { Client } from '@platform/client';

/**
 * Block Jam's sounds, synthesised on each screen: the ball (a dribble's thump, a bounce, the rim's
 * clank, the backboard's bang, the swish), the big moments (a slam, a block, flames, a steal, a
 * shove), the arena (the buzzer, the whistle, the crowd's murmur and its roar).
 */
export function defineSounds(client: Client) {
  const a = client.audio;
  const rnd = (lo: number, hi: number) => lo + Math.random() * (hi - lo);
  // A dribble: a quick hollow thump on the hardwood.
  a.define('jam_dribble', (s) => {
    s.tone({ wave: 'sine', from: rnd(140, 160) * s.pitch, to: 62 * s.pitch, duration: 0.11, volume: 0.5 });
    s.tone({ wave: 'triangle', from: 320 * s.pitch, to: 180 * s.pitch, duration: 0.05, volume: 0.12 });
    s.noise({ duration: 0.04, filter: 'lowpass', from: 1400, to: 300, volume: 0.22 });
  });
  // A loose ball bouncing.
  a.define('jam_bounce', (s) => {
    s.tone({ wave: 'sine', from: rnd(120, 140) * s.pitch, to: 55 * s.pitch, duration: 0.16, volume: 0.6 });
    s.noise({ duration: 0.05, filter: 'lowpass', from: 1200, to: 250, volume: 0.25 });
    s.tone({ wave: 'sine', from: 380 * s.pitch, to: 260 * s.pitch, duration: 0.08, volume: 0.1, delay: 0.01 });
  });
  // The rim: iron, ringing.
  a.define('jam_rim', (s) => {
    const f = rnd(620, 760) * s.pitch;
    s.tone({ wave: 'sine', from: f, to: f * 0.96, duration: 0.55, volume: 0.32, fm: { ratio: 2.76, depth: 2.2, to: 0.4 } });
    s.tone({ wave: 'sine', from: f * 2.4, duration: 0.25, volume: 0.1, fm: { ratio: 1.41, depth: 1 } });
    s.noise({ duration: 0.03, filter: 'highpass', from: 3000, volume: 0.3 });
  });
  // The backboard: a hard, flat bang.
  a.define('jam_board', (s) => {
    s.tone({ wave: 'triangle', from: 210 * s.pitch, to: 120 * s.pitch, duration: 0.14, volume: 0.45 });
    s.noise({ duration: 0.08, filter: 'bandpass', from: 1500, to: 700, q: 1.2, volume: 0.4 });
    s.tone({ wave: 'sine', from: 1100 * s.pitch, duration: 0.18, volume: 0.06, fm: { ratio: 1.41, depth: 0.6 } });
  });
  // The swish: through the net.
  a.define('jam_swish', (s) => {
    s.noise({ duration: 0.32, attack: 0.03, filter: 'bandpass', from: 5200, to: 1800, q: 1.4, volume: 0.42 });
    s.noise({ duration: 0.2, delay: 0.05, filter: 'highpass', from: 6000, to: 3500, volume: 0.15 });
  });
  // A slam: the rim hammered, the stanchion shuddering, a boom.
  a.define('jam_slam', (s) => {
    s.tone({ wave: 'sine', from: 95 * s.pitch, to: 38 * s.pitch, duration: 0.5, volume: 0.9, drive: 0.4 });
    s.noise({ duration: 0.25, filter: 'lowpass', from: 2400, to: 200, volume: 0.6 });
    s.tone({ wave: 'sine', from: 540 * s.pitch, to: 500 * s.pitch, duration: 0.9, volume: 0.3, fm: { ratio: 2.76, depth: 3, to: 0.5 } });
    s.tone({ wave: 'sawtooth', from: 70 * s.pitch, to: 50 * s.pitch, duration: 0.35, volume: 0.15, lowpass: 400, vibrato: { rate: 26, depth: 6 } });
  });
  // A block: a slap of the hand on the ball.
  a.define('jam_block', (s) => {
    s.noise({ duration: 0.07, filter: 'bandpass', from: 2400, to: 900, q: 1.5, volume: 0.65 });
    s.tone({ wave: 'sine', from: 260 * s.pitch, to: 110 * s.pitch, duration: 0.12, volume: 0.5 });
  });
  // Flames: a roaring whoosh.
  a.define('jam_flame', (s) => {
    s.noise({ duration: 0.8, attack: 0.08, filter: 'lowpass', from: 3000, to: 400, volume: 0.5 });
    s.noise({ duration: 0.6, attack: 0.05, filter: 'bandpass', from: 900, to: 300, q: 0.8, volume: 0.3 });
    s.tone({ wave: 'sawtooth', from: 60 * s.pitch, to: 45 * s.pitch, duration: 0.7, volume: 0.12, lowpass: 260, drive: 0.5 });
  });
  // A steal: a quick swipe.
  a.define('jam_steal', (s) => {
    s.noise({ duration: 0.12, filter: 'highpass', from: 2500, to: 5000, volume: 0.35 });
    s.tone({ wave: 'sine', from: 900 * s.pitch, to: 1600 * s.pitch, duration: 0.1, volume: 0.15 });
  });
  // A shove: a body hitting the floor.
  a.define('jam_shove', (s) => {
    s.noise({ duration: 0.12, filter: 'lowpass', from: 900, to: 150, volume: 0.7 });
    s.tone({ wave: 'sine', from: 110 * s.pitch, to: 45 * s.pitch, duration: 0.25, volume: 0.7 });
    s.tone({ wave: 'sine', from: rnd(2200, 2600) * s.pitch, to: 3200 * s.pitch, duration: 0.07, volume: 0.08, delay: 0.02 });
  });
  // The buzzer: long and harsh.
  a.define(
    'jam_buzzer',
    (s) => {
      s.tone({ wave: 'square', from: 196 * s.pitch, duration: 0.15, hold: 0.9, volume: 0.3, lowpass: 2200 });
      s.tone({ wave: 'sawtooth', from: 200.5 * s.pitch, duration: 0.15, hold: 0.9, volume: 0.18, lowpass: 1800 });
    },
    { reverb: 0.6 },
  );
  // The ref's whistle (the tip-off).
  a.define('jam_whistle', (s) => {
    s.tone({ wave: 'sine', from: 2900 * s.pitch, duration: 0.12, hold: 0.32, volume: 0.25, vibrato: { rate: 34, depth: 120 } });
    s.noise({ duration: 0.2, hold: 0.25, filter: 'bandpass', from: 3000, q: 4, volume: 0.06 });
  });
  // The crowd going up: a swell of voices.
  a.define(
    'jam_cheer',
    (s) => {
      for (let i = 0; i < 3; i++) s.noise({ duration: 1.2, attack: 0.12, hold: 0.5, delay: i * 0.05, filter: 'bandpass', from: rnd(700, 1300), to: rnd(500, 900), q: 0.9, volume: 0.22 });
      s.noise({ duration: 1.1, attack: 0.1, hold: 0.4, filter: 'highpass', from: 2500, volume: 0.06 });
    },
    { reverb: 0.8 },
  );
  // The crowd's murmur, always there.
  a.defineLoop('jam_crowd', (l) => {
    l.noise({ freq: 520, filter: 'bandpass', q: 0.8, volume: 0.32 });
    l.noise({ freq: 1150, filter: 'bandpass', q: 1.1, volume: 0.16 });
    l.noise({ freq: 180, filter: 'lowpass', q: 0.7, volume: 0.12 });
  });
}
