import type { Client } from '@platform/client';

/**
 * The run's voices, synthesised on each screen: a coin picked up, the merchant's bell and a sale,
 * the mystery chest (its creak, the music-box spin and its ticks, the reveal, the laugh when it
 * flies off, the thump when it lands), the crowd's roar for its Favour, going down and the
 * heartbeat after, a revive, the Phoenix Feather's flare, a level reached.
 */
export function defineRunSounds(client: Client) {
  const a = client.audio;
  // A bright clink, higher for more.
  a.define(
    'coin',
    (s) => {
      s.tone({ wave: 'triangle', from: 1900 * s.pitch, duration: 0.09, volume: 0.22 });
      s.tone({ wave: 'sine', from: 2850 * s.pitch, duration: 0.18, volume: 0.16, delay: 0.04, fm: { ratio: 1.41, depth: 0.4 } });
    },
    { reverb: 0.2 },
  );
  // Cha-ching: two struck bells and a drawer.
  a.define(
    'buy',
    (s) => {
      s.noise({ duration: 0.12, filter: 'bandpass', from: 2500, to: 1800, q: 2, volume: 0.25 });
      s.tone({ wave: 'sine', from: 1568, duration: 0.5, volume: 0.22, delay: 0.08, fm: { ratio: 2.76, depth: 0.5 } });
      s.tone({ wave: 'sine', from: 2093, duration: 0.6, volume: 0.2, delay: 0.16, fm: { ratio: 2.76, depth: 0.5 } });
    },
    { reverb: 0.2 },
  );
  // Something tossed from the hand: a quick swish, and a soft knock where it lands.
  a.define('item_drop', (s) => {
    s.noise({ duration: 0.14, filter: 'bandpass', from: 1400, to: 600, q: 1.5, volume: 0.2 });
    s.tone({ from: 160 * s.pitch, to: 90, duration: 0.12, volume: 0.25, delay: 0.32 });
  });
  // The merchant's hand bell.
  a.define('merchant', (s) => {
    for (let i = 0; i < 3; i++) s.tone({ wave: 'sine', from: 1320 * s.pitch, duration: 0.5, volume: 0.18, delay: i * 0.16, fm: { ratio: 2.76, depth: 0.9, to: 0.2 } });
  });
  // The chest's lid: a wooden creak and a hollow knock.
  a.define('chest_open', (s) => {
    s.tone({ wave: 'sawtooth', from: 180 * s.pitch, to: 260 * s.pitch, duration: 0.45, volume: 0.18, bandpass: { freq: 900, q: 5 }, vibrato: { rate: 30, depth: 12 } });
    s.tone({ from: 110, to: 70, duration: 0.25, volume: 0.4, delay: 0.42 });
    s.noise({ duration: 0.5, filter: 'lowpass', from: 3000, to: 600, volume: 0.15 });
  });
  // A music box winding through a few bars while it spins.
  a.define('chest_spin', (s) => {
    const tune = [784, 988, 1175, 988, 784, 1175, 1319, 1175, 988, 1319, 1568, 1319];
    tune.forEach((f, i) => s.tone({ wave: 'sine', from: f * s.pitch, duration: 0.5, volume: 0.13, delay: i * 0.27, fm: { ratio: 3.5, depth: 0.6, to: 0.1 } }));
  });
  a.define('chest_tick', (s) => s.tone({ wave: 'square', from: 2400 * s.pitch, duration: 0.025, volume: 0.08, lowpass: 3000 }), { reverb: 0.1 });
  // What it gives: a shimmering chord swelling up.
  a.define('chest_reveal', (s) => {
    for (const [i, f] of [523, 659, 784, 1047].entries()) s.tone({ wave: 'triangle', from: f * s.pitch, duration: 1.2, attack: 0.05 + i * 0.04, volume: 0.16, vibrato: { rate: 6, depth: 4 } });
    s.noise({ duration: 0.8, filter: 'highpass', from: 6000, to: 9000, volume: 0.08 });
  });
  // Bad luck: a mocking laugh, falling.
  a.define('chest_laugh', (s) => {
    for (let i = 0; i < 5; i++) s.tone({ wave: 'sawtooth', from: (320 - i * 30) * s.pitch, to: (240 - i * 25) * s.pitch, duration: 0.16, volume: 0.22, delay: i * 0.18, bandpass: { freq: 1100, q: 4 }, vibrato: { rate: 18, depth: 10 } });
  });
  a.define('chest_land', (s) => {
    s.tone({ from: 120 * s.pitch, to: 45, duration: 0.5, volume: 0.6 });
    s.noise({ duration: 0.4, filter: 'lowpass', from: 1500, to: 200, volume: 0.35 });
  });
  // The crowd boils over: a roar rising, and cheers above it.
  a.define(
    'roar',
    (s) => {
      s.noise({ duration: 2.6, filter: 'bandpass', from: 500, to: 900, q: 0.6, attack: 0.5, hold: 0.8, volume: 0.6 });
      s.noise({ duration: 2.2, filter: 'bandpass', from: 1800, to: 2600, q: 1.2, attack: 0.4, hold: 0.6, volume: 0.25 });
      for (let i = 0; i < 6; i++) s.tone({ wave: 'sawtooth', from: (420 + i * 55) * s.pitch, to: (520 + i * 40) * s.pitch, duration: 0.6, delay: 0.3 + i * 0.22, volume: 0.05, bandpass: { freq: 1400, q: 3 }, vibrato: { rate: 9, depth: 18 } });
    },
    { reverb: 0.6 },
  );
  // Going down: a heavy fall and a groan.
  a.define('downed', (s) => {
    s.tone({ from: 140 * s.pitch, to: 50, duration: 0.4, volume: 0.6 });
    s.noise({ duration: 0.3, filter: 'lowpass', from: 1200, to: 200, volume: 0.4 });
    s.tone({ wave: 'sawtooth', from: 160 * s.pitch, to: 110 * s.pitch, duration: 0.7, delay: 0.25, volume: 0.15, lowpass: 700, vibrato: { rate: 5, depth: 6 } });
  });
  a.define('heartbeat', (s) => {
    s.tone({ from: 70, to: 45, duration: 0.12, volume: 0.7, lowpass: 200 });
    s.tone({ from: 62, to: 42, duration: 0.14, volume: 0.5, delay: 0.17, lowpass: 200 });
  }, { reverb: 0 });
  // Up again: a rising, hopeful chime.
  a.define('revive', (s) => {
    for (const [i, f] of [392, 523, 659, 784].entries()) s.tone({ wave: 'triangle', from: f * s.pitch, duration: 0.5, volume: 0.18, delay: i * 0.08 });
  });
  // The Phoenix Feather: a whoosh of flame and a bright cry.
  a.define('phoenix', (s) => {
    s.noise({ duration: 1.1, filter: 'bandpass', from: 400, to: 2400, q: 0.8, volume: 0.5, attack: 0.1 });
    s.tone({ wave: 'sawtooth', from: 900 * s.pitch, to: 1800 * s.pitch, duration: 0.6, delay: 0.2, volume: 0.15, bandpass: { freq: 1800, q: 3 }, vibrato: { rate: 12, depth: 30 } });
    for (const [i, f] of [523, 784, 1047].entries()) s.tone({ wave: 'triangle', from: f * s.pitch, duration: 0.9, delay: 0.35 + i * 0.07, volume: 0.13 });
  });
  // A level reached: a short fanfare.
  a.define(
    'levelup',
    (s) => {
      const notes: [number, number, number][] = [
        [523, 0, 0.14],
        [659, 0.12, 0.14],
        [784, 0.24, 0.14],
        [1047, 0.36, 0.6],
      ];
      for (const [f, d, len] of notes) {
        s.tone({ wave: 'square', from: f, duration: len, delay: d, volume: 0.1, lowpass: 3200 });
        s.tone({ wave: 'triangle', from: f * 2, duration: len, delay: d, volume: 0.06 });
      }
    },
    { reverb: 0.3 },
  );
}
