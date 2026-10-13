import type { Client } from '@platform/client';

/**
 * Skyship's own sounds, synthesised on each screen (`client.audio.define`): a beacon's bell as
 * it's lit, and the hull's thud against rock. The server plays them by name (`audio.play('bell')`).
 */
export function defineSounds(client: Client) {
  const a = client.audio;
  a.define('bell', (s) => {
    for (const [f, d] of [
      [784, 0],
      [1175, 0.14],
      [1568, 0.28],
    ])
      s.tone({ wave: 'sine', from: f * s.pitch, duration: 1.6, delay: d, attack: 0.004, volume: 0.22 });
  });
  a.define('thud', (s) => {
    s.noise({ duration: 0.6, filter: 'lowpass', from: 500, to: 70, volume: 0.7 });
    s.tone({ wave: 'sine', from: 95 * s.pitch, to: 38 * s.pitch, duration: 0.55, volume: 0.55 });
  });
}
