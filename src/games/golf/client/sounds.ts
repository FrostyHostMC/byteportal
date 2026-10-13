import type { Client } from '@platform/client';

/**
 * The course's voices, synthesised: the crack of a driver, the click of an iron, the tock of a
 * putt, the ball's thud, sand, water and leaves, the rattle of the cup, a crowd's applause, a
 * cart's hum, and birds in the trees.
 */
export function defineSounds(client: Client) {
  const a = client.audio;
  a.acoustics({ air: 0.6, reverb: { near: 0.05, far: 0.3, seconds: 1.4, damp: 0.6 } });
  // A metal driver: a bright, ringing crack.
  a.define('golf_drive', (s) => {
    s.noise({ duration: 0.05, from: 7000, to: 2500, filter: 'bandpass', q: 1.2, volume: 0.5 });
    s.tone({ wave: 'triangle', from: 1650 * s.pitch, to: 1500 * s.pitch, duration: 0.18, volume: 0.22, fm: { ratio: 2.76, depth: 0.8 } });
    s.tone({ wave: 'sine', from: 3200 * s.pitch, to: 3050 * s.pitch, duration: 0.09, volume: 0.1 });
  });
  // An iron: a crisp, shorter click, and a divot's brush.
  a.define('golf_iron', (s) => {
    s.noise({ duration: 0.035, from: 5500, to: 3000, filter: 'bandpass', q: 2, volume: 0.45 });
    s.tone({ wave: 'triangle', from: 1100 * s.pitch, to: 950 * s.pitch, duration: 0.07, volume: 0.18 });
    s.noise({ duration: 0.18, from: 1400, to: 500, filter: 'lowpass', volume: 0.12, delay: 0.02 });
  });
  a.define('golf_putt', (s) => {
    s.tone({ wave: 'sine', from: 900 * s.pitch, to: 700 * s.pitch, duration: 0.07, volume: 0.28 });
    s.noise({ duration: 0.02, from: 3000, to: 2000, filter: 'bandpass', q: 3, volume: 0.15 });
  });
  a.define('golf_bounce', (s) => {
    s.tone({ wave: 'sine', from: 180 * s.pitch, to: 90 * s.pitch, duration: 0.1, volume: 0.35 });
    s.noise({ duration: 0.06, from: 900, to: 300, filter: 'lowpass', volume: 0.15 });
  });
  a.define('golf_sand', (s) => s.noise({ duration: 0.3, from: 2600, to: 900, filter: 'bandpass', q: 0.8, volume: 0.3 }));
  a.define('golf_splash', (s) => {
    s.noise({ duration: 0.5, from: 3000, to: 400, filter: 'lowpass', volume: 0.45 });
    s.tone({ wave: 'sine', from: 600, to: 180, duration: 0.25, volume: 0.15 });
  });
  a.define('golf_tree', (s) => {
    s.noise({ duration: 0.45, from: 5000, to: 2500, filter: 'bandpass', q: 0.7, volume: 0.28, attack: 0.03 });
    s.noise({ duration: 0.3, from: 3500, to: 1800, filter: 'bandpass', q: 0.9, volume: 0.18, delay: 0.12 });
  });
  a.define('golf_knock', (s) => s.tone({ wave: 'square', from: 520, to: 300, duration: 0.07, volume: 0.18, lowpass: 1800 }));
  a.define('golf_lip', (s) => {
    s.tone({ wave: 'triangle', from: 1900, to: 1700, duration: 0.08, volume: 0.2 });
    s.tone({ wave: 'triangle', from: 1500, to: 1300, duration: 0.08, volume: 0.15, delay: 0.09 });
  });
  // Into the cup: a hollow rattle and the thunk at the bottom.
  a.define('golf_cup', (s) => {
    for (let i = 0; i < 4; i++) s.tone({ wave: 'triangle', from: (1400 - i * 150) * s.pitch, to: (1250 - i * 150) * s.pitch, duration: 0.05, volume: 0.22 - i * 0.03, delay: i * 0.055 });
    s.tone({ wave: 'sine', from: 260, to: 140, duration: 0.18, volume: 0.35, delay: 0.24 });
  });
  // A small gallery's applause.
  a.define(
    'golf_cheer',
    (s) => {
      for (let i = 0; i < 14; i++) s.noise({ duration: 0.09, from: 2600 + (i % 3) * 700, to: 1800, filter: 'bandpass', q: 1.5, volume: 0.16, delay: i * 0.07 + (i % 2) * 0.02 });
      s.noise({ duration: 1.3, from: 1800, to: 1200, filter: 'bandpass', q: 0.6, volume: 0.16, attack: 0.1 });
    },
    { reverb: 0.3 },
  );
  a.define('golf_tick', (s) => s.tone({ wave: 'sine', from: 1300, to: 1300, duration: 0.03, volume: 0.12 }), { reverb: 0 });
  a.define(
    'golf_tee',
    (s) => {
      s.tone({ wave: 'sine', from: 660, to: 660, duration: 0.25, volume: 0.12 });
      s.tone({ wave: 'sine', from: 990, to: 990, duration: 0.4, volume: 0.1, delay: 0.14 });
    },
    { reverb: 0 },
  );
  a.define('golf_cart_on', (s) => {
    s.tone({ wave: 'sawtooth', from: 120, to: 340, duration: 0.3, volume: 0.1, lowpass: 900 });
  });
  a.define('golf_bird', (s) => {
    const base = 2600 + Math.random() * 1400;
    for (let i = 0; i < 3; i++) s.tone({ wave: 'sine', from: base, glide: [[0.05, base * 1.25], [0.1, base * 0.9]], duration: 0.11, volume: 0.05, delay: i * 0.16 });
  });
  // The cart's electric hum, rising with its speed.
  a.defineLoop('golf_cart', (l) => {
    l.tone({ wave: 'sawtooth', freq: 95, volume: 0.05, lowpass: 600 });
    l.tone({ wave: 'sine', freq: 190, volume: 0.05 });
    l.noise({ freq: 700, filter: 'lowpass', volume: 0.03 });
  });
}
