import type { Client } from '@platform/client';

/**
 * Sky Obby's own sounds, synthesised on each screen (`client.audio.define`): the checkpoint
 * chime, the launch pad's boing, sand crumbling, the respawn, the cannons, the blinking
 * platforms. The server plays them by name (`audio.play('boing')`).
 */
export function defineSounds(client: Client) {
  const a = client.audio;
  // A checkpoint: a quick rising triad.
  a.define('checkpoint', (s) => {
    [523, 659, 784].forEach((f, i) => s.tone({ wave: 'triangle', from: f * s.pitch, duration: 0.22, delay: i * 0.07, volume: 0.3 }));
    s.tone({ wave: 'sine', from: 1568 * s.pitch, duration: 0.5, delay: 0.21, volume: 0.12 });
  });
  // A launch pad: a springy upward sweep.
  a.define('boing', (s) => {
    s.tone({ wave: 'sine', from: 180 * s.pitch, to: 720 * s.pitch, duration: 0.28, volume: 0.4, vibrato: { rate: 18, depth: 30 } });
    s.noise({ duration: 0.12, filter: 'bandpass', from: 900, to: 2400, q: 1.5, volume: 0.15 });
  });
  // Sand starting to give way.
  a.define('crumble', (s) => {
    for (let i = 0; i < 4; i++) s.noise({ duration: 0.09, filter: 'bandpass', from: 1100 * s.pitch, to: 600, q: 1.4, volume: 0.35, delay: i * 0.08 });
  });
  // Back at the checkpoint: a soft falling whoosh.
  a.define('respawn', (s) => {
    s.tone({ wave: 'sine', from: 660 * s.pitch, to: 220 * s.pitch, duration: 0.35, volume: 0.25 });
    s.noise({ duration: 0.3, filter: 'lowpass', from: 2400, to: 300, volume: 0.2 });
  });
  // A cannon firing a bolt.
  a.define('cannon', (s) => {
    s.noise({ duration: 0.25, filter: 'lowpass', from: 1800, to: 200, volume: 0.5 });
    s.tone({ wave: 'square', from: 900 * s.pitch, to: 160 * s.pitch, duration: 0.18, volume: 0.14, lowpass: 2600 });
  });
  // The blinking platforms switching on.
  a.define('blink', (s) => {
    s.tone({ wave: 'triangle', from: 1200 * s.pitch, duration: 0.06, volume: 0.2 });
    s.tone({ wave: 'triangle', from: 1800 * s.pitch, duration: 0.08, delay: 0.05, volume: 0.15 });
  });
}
