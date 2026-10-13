import type { Client } from '@platform/client';

/**
 * The Arena's creature voices, synthesised on each screen (`client.audio.define`: nothing is
 * recorded or sent). The server plays them by name: the monsters' `sounds`, the Warden's slam and
 * roar, the Sapper's fuse, the Necromancer's spell, Stormcaller's thunder and Volatile's pop.
 */
export function defineCreatureSounds(client: Client) {
  const a = client.audio;
  // A wet, wobbling groan.
  a.define('zombie', (s) => {
    s.tone({ wave: 'sawtooth', from: 95 * s.pitch, to: 70 * s.pitch, duration: 0.8, attack: 0.12, volume: 0.55, bandpass: { freq: 520, q: 3 }, vibrato: { rate: 7, depth: 6 } });
  });
  // Rattling bones.
  a.define('skeleton', (s) => {
    for (let i = 0; i < 5; i++) s.noise({ duration: 0.03, filter: 'highpass', from: 3200 * s.pitch, to: 2400, volume: 0.3, delay: i * 0.045 + Math.random() * 0.02 });
  });
  // Hiss and clicking.
  a.define('spider', (s) => {
    s.noise({ duration: 0.45, from: 4500 * s.pitch, to: 3000 * s.pitch, q: 3, volume: 0.25 });
    for (let i = 0; i < 4; i++) s.tone({ wave: 'square', from: 900 * s.pitch, to: 700, duration: 0.03, volume: 0.08, delay: 0.08 * i });
  });
  // A low grunt.
  a.define('brute', (s) => {
    s.tone({ wave: 'sawtooth', from: 70 * s.pitch, to: 48 * s.pitch, duration: 0.8, volume: 0.5, lowpass: 500 });
    s.tone({ from: 45 * s.pitch, to: 35, duration: 0.8, volume: 0.5 });
  });
  // The Warden's ground slam: a deep thud and a rumble.
  a.define('slam', (s) => {
    s.tone({ from: 90 * s.pitch, to: 28, duration: 0.9, volume: 1.0 });
    s.noise({ duration: 0.7, filter: 'lowpass', from: 1400, to: 120, volume: 0.7 });
  });
  // The Warden's roar.
  a.define('boss', (s) => {
    s.tone({ wave: 'sawtooth', from: 52 * s.pitch, to: 38 * s.pitch, duration: 1.5, volume: 0.45, lowpass: 700 });
    s.tone({ wave: 'sawtooth', from: 55 * s.pitch, to: 40 * s.pitch, duration: 1.5, volume: 0.45, lowpass: 700 });
    s.noise({ duration: 1.2, filter: 'lowpass', from: 900, to: 150, volume: 0.35 });
  });
  // The Sapper: a gruff cackle.
  a.define('sapper', (s) => {
    for (let i = 0; i < 3; i++) s.tone({ wave: 'square', from: 210 * s.pitch, to: 150 * s.pitch, duration: 0.09, volume: 0.22, lowpass: 1200, delay: i * 0.11 });
  });
  // A lit fuse: a sputtering hiss.
  a.define('fuse', (s) => {
    s.noise({ duration: 1.1, filter: 'highpass', from: 5000, to: 3500, volume: 0.45 });
    for (let i = 0; i < 8; i++) s.noise({ duration: 0.02, filter: 'bandpass', from: 2400, to: 2000, q: 4, volume: 0.35, delay: i * 0.13 + Math.random() * 0.05 });
  });
  // The Necromancer's spell: a hollow, wavering chord.
  a.define('necro', (s) => {
    for (const f of [110, 131, 165]) s.tone({ wave: 'triangle', from: f * s.pitch, to: f * 0.94 * s.pitch, duration: 1.1, attack: 0.25, volume: 0.22, vibrato: { rate: 5, depth: 4 } });
    s.noise({ duration: 0.9, filter: 'bandpass', from: 700, to: 300, q: 2, volume: 0.15 });
  });
  // The Treasure Goblin: a quick, high giggle.
  a.define('goblin', (s) => {
    for (let i = 0; i < 4; i++) s.tone({ wave: 'square', from: (900 - i * 60) * s.pitch, to: (720 - i * 60) * s.pitch, duration: 0.06, volume: 0.14, lowpass: 3000, delay: i * 0.075 });
  });
  // Its loot bursting out: a jingle of coins.
  a.define('coins', (s) => {
    for (let i = 0; i < 7; i++) s.tone({ wave: 'triangle', from: (1800 + Math.random() * 900) * s.pitch, to: 1500 * s.pitch, duration: 0.12, volume: 0.18, delay: i * 0.05 + Math.random() * 0.03 });
  });
  // Stormcaller's lightning: a crack, then thunder rolling away.
  a.define('thunder', (s) => {
    s.noise({ duration: 0.12, filter: 'highpass', from: 4000, to: 1500, volume: 0.9 });
    s.noise({ duration: 1.3, filter: 'lowpass', from: 900, to: 90, volume: 0.8, delay: 0.05 });
    s.tone({ from: 70 * s.pitch, to: 32, duration: 1.1, volume: 0.6, delay: 0.05 });
  });
  // Volatile: a slain monster's pop.
  a.define('pop', (s) => {
    s.noise({ duration: 0.25, filter: 'lowpass', from: 2400, to: 300, volume: 0.6 });
    s.tone({ from: 160 * s.pitch, to: 60, duration: 0.2, volume: 0.5 });
  });
}
