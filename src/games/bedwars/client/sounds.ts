import type { Client } from '@platform/client';

/**
 * Bed Wars' own sounds, synthesised on each screen (`client.audio.define`: nothing is recorded or
 * sent). The server plays them by name (`audio.play('bed_break')`).
 */
export function defineSounds(client: Client) {
  const a = client.audio;
  // A bed going: a splintering crash and a falling, ominous chord.
  a.define('bed_break', (s) => {
    s.noise({ duration: 0.5, filter: 'bandpass', from: 2600, to: 500, q: 1.2, volume: 0.6 });
    for (const [f, d] of [
      [392, 0],
      [311, 0.12],
      [233, 0.24],
    ])
      s.tone({ wave: 'sawtooth', from: f * s.pitch, to: f * 0.7 * s.pitch, duration: 0.9, delay: d, volume: 0.28, lowpass: 1800 });
  });
  // A purchase: two bright notes.
  a.define('buy', (s) => {
    s.tone({ wave: 'triangle', from: 880 * s.pitch, duration: 0.09, volume: 0.35 });
    s.tone({ wave: 'triangle', from: 1320 * s.pitch, duration: 0.14, delay: 0.08, volume: 0.35 });
  });
  // Crunching an apple.
  a.define('eat', (s) => {
    for (let i = 0; i < 3; i++) s.noise({ duration: 0.07, filter: 'bandpass', from: 1500 * s.pitch, to: 900, q: 2, volume: 0.4, delay: i * 0.11 });
  });
  // A final kill / elimination: a bell.
  a.define('final_kill', (s) => {
    s.tone({ wave: 'sine', from: 1046 * s.pitch, duration: 1.1, volume: 0.35 });
    s.tone({ wave: 'sine', from: 1568 * s.pitch, duration: 0.8, volume: 0.18, delay: 0.02 });
  });
  // Launching a fireball.
  a.define('fireball', (s) => {
    s.noise({ duration: 0.45, filter: 'lowpass', from: 2400, to: 400, volume: 0.5 });
    s.tone({ wave: 'sawtooth', from: 180 * s.pitch, to: 90, duration: 0.35, volume: 0.2, lowpass: 900 });
  });
}
