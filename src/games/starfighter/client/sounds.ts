import type { Client } from '@platform/client';

/**
 * Starfighter's own sounds, synthesised on each screen (`client.audio.define`): the lasers (ours
 * and the Empire's), the proton torpedo, the capital ship's horn, the Bowtie howl. The server plays
 * them by name (`audio.play('laser')`).
 */
export function defineSounds(client: Client) {
  const a = client.audio;
  // Blaster "pew": a fast falling zap with a bright click.
  a.define('laser', (s) => {
    s.tone({ wave: 'square', from: 2400 * s.pitch, to: 260 * s.pitch, duration: 0.17, volume: 0.22, lowpass: 3800 });
    s.tone({ wave: 'sawtooth', from: 1200 * s.pitch, to: 180 * s.pitch, duration: 0.14, volume: 0.12, lowpass: 2400 });
    s.noise({ duration: 0.03, filter: 'highpass', from: 5000, to: 3000, volume: 0.15 });
  });
  // The Empire's: harsher and lower, with a growl.
  a.define('laser_enemy', (s) => {
    s.tone({ wave: 'sawtooth', from: 1300 * s.pitch, to: 150 * s.pitch, duration: 0.22, volume: 0.24, lowpass: 2600 });
    s.tone({ wave: 'square', from: 660 * s.pitch, to: 110 * s.pitch, duration: 0.2, volume: 0.12, lowpass: 1400 });
    s.noise({ duration: 0.08, from: 1400, to: 600, q: 2, volume: 0.12 });
  });
  a.define('torpedo', (s) => {
    s.noise({ duration: 0.7, from: 400 * s.pitch, to: 2600 * s.pitch, q: 3, volume: 0.35 });
    s.tone({ wave: 'triangle', from: 260 * s.pitch, to: 820 * s.pitch, duration: 0.6, volume: 0.25 });
  });
  // The capital ship's alarm horn for the boss wave.
  a.define('capital_horn', (s) => {
    for (const f of [58, 87, 116]) s.tone({ wave: 'sawtooth', from: f * s.pitch, to: f * 0.94 * s.pitch, duration: 1.8, attack: 0.25, volume: 0.28, lowpass: 900 });
    s.noise({ duration: 1.4, filter: 'lowpass', from: 600, to: 120, volume: 0.2 });
  });
  // The Bowtie howl: detuned saws with a fast wobble through a bandpass sweeping down as it passes.
  a.define('flyby', (s) => {
    const p = s.pitch;
    for (const f of [170, 176, 340])
      s.tone({ wave: 'sawtooth', from: f * p, to: f * 0.55 * p, duration: 0.85, attack: 0.12, volume: 0.5, vibrato: { rate: 23, depth: f * 0.06 }, bandpass: { freq: 1900 * p, to: 500 * p, q: 1.4 } });
    s.noise({ duration: 0.9, from: 2400 * p, to: 700 * p, q: 1.2, volume: 0.35 });
  });
}
