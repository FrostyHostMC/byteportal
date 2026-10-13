import type { Client } from '@platform/client';

/**
 * The bestiary's voices, synthesised on each screen (`client.audio.define`: nothing is recorded or
 * sent); the server plays them by name: the monsters' `sounds`, their tells and blows, the elites'.
 */
export function defineBestiarySounds(client: Client) {
  const a = client.audio;

  // The Knight: a hollow groan inside a helm, the clink of plate.
  a.define('knight', (s) => {
    s.tone({ wave: 'sawtooth', from: 82 * s.pitch, to: 70 * s.pitch, duration: 0.9, attack: 0.15, volume: 0.4, bandpass: { freq: 420, q: 4 }, vibrato: { rate: 5, depth: 3 } });
    for (let i = 0; i < 3; i++) s.tone({ from: 2400 * s.pitch, duration: 0.12, volume: 0.06, delay: 0.5 + i * 0.13, fm: { ratio: 2.76, depth: 2 } });
  });
  a.define('knight_hurt', (s) => {
    s.tone({ from: 1800 * s.pitch, duration: 0.25, volume: 0.18, fm: { ratio: 1.41, depth: 3, to: 0.5 } });
    s.tone({ wave: 'sawtooth', from: 120 * s.pitch, to: 80 * s.pitch, duration: 0.3, volume: 0.3, lowpass: 600 });
  });
  // Down: plate crashing to the sand.
  a.define('knight_death', (s) => {
    for (let i = 0; i < 6; i++) s.tone({ from: (1600 + Math.random() * 1400) * s.pitch, duration: 0.2, volume: 0.1, delay: i * 0.07 + Math.random() * 0.03, fm: { ratio: 2.76, depth: 2.5 } });
    s.noise({ duration: 0.5, filter: 'lowpass', from: 1500, to: 200, volume: 0.45, delay: 0.1 });
    s.tone({ wave: 'sawtooth', from: 90 * s.pitch, to: 45, duration: 0.7, volume: 0.3, lowpass: 400 });
  });
  // Its sword raised: steel drawn and a breath in.
  a.define('knight_raise', (s) => {
    s.noise({ duration: 0.4, filter: 'bandpass', from: 2500, to: 5200, q: 6, volume: 0.25, attack: 0.05 });
    s.tone({ from: 3100 * s.pitch, duration: 0.5, volume: 0.07, attack: 0.1, fm: { ratio: 2.76, depth: 0.8 } });
  });
  // Its swing: a heavy whoosh.
  a.define('knight_swing', (s) => {
    s.noise({ duration: 0.3, filter: 'bandpass', from: 600, to: 1800, q: 1.5, volume: 0.6 });
    s.tone({ wave: 'sawtooth', from: 90 * s.pitch, to: 55, duration: 0.3, volume: 0.25, lowpass: 400 });
  });
  // A blow turned on a shield: a clang that rings.
  a.define('shield_block', (s) => {
    s.noise({ duration: 0.05, filter: 'highpass', from: 3000, volume: 0.6 });
    s.tone({ from: 820 * s.pitch, duration: 0.7, volume: 0.32, fm: { ratio: 1.41, depth: 2.2, to: 0.4 } });
    s.tone({ from: 1240 * s.pitch, duration: 0.45, volume: 0.18, fm: { ratio: 2.76, depth: 1.2 } });
    s.tone({ from: 170 * s.pitch, to: 120, duration: 0.25, volume: 0.35 });
  });

  // The Wraith: a breathy, wavering moan.
  a.define('wraith', (s) => {
    s.noise({ duration: 1.3, filter: 'bandpass', from: 600 * s.pitch, to: 1100 * s.pitch, q: 8, volume: 0.35, attack: 0.3 });
    s.tone({ wave: 'triangle', from: 330 * s.pitch, to: 250 * s.pitch, duration: 1.3, attack: 0.4, volume: 0.12, vibrato: { rate: 4, depth: 14 } });
  });
  a.define('wraith_hurt', (s) => {
    s.noise({ duration: 0.35, filter: 'bandpass', from: 1500 * s.pitch, to: 700, q: 6, volume: 0.35 });
    s.tone({ wave: 'triangle', from: 520 * s.pitch, to: 300 * s.pitch, duration: 0.3, volume: 0.14 });
  });
  // Fading out: a breath drawn in, rising.
  a.define('wraith_fade', (s) => {
    s.noise({ duration: 0.45, filter: 'bandpass', from: 400, to: 3200, q: 5, volume: 0.35, attack: 0.3 });
    s.tone({ wave: 'sine', from: 200 * s.pitch, to: 900 * s.pitch, duration: 0.45, attack: 0.3, volume: 0.12 });
  });
  // Back in: a cold snap.
  a.define('blink', (s) => {
    s.noise({ duration: 0.18, filter: 'highpass', from: 2500, to: 6000, volume: 0.45 });
    s.tone({ wave: 'sine', from: 1400 * s.pitch, to: 300 * s.pitch, duration: 0.25, volume: 0.2 });
  });
  // The drain: a low, pulling hum with a whisper over it.
  a.define('drain', (s) => {
    s.tone({ wave: 'sawtooth', from: 70 * s.pitch, to: 90 * s.pitch, duration: 2.3, attack: 0.2, hold: 1.7, volume: 0.22, lowpass: 380, vibrato: { rate: 9, depth: 6 } });
    s.noise({ duration: 2.3, filter: 'bandpass', from: 2400, to: 1200, q: 4, volume: 0.14, attack: 0.3, hold: 1.5 });
  });
  a.define('drain_break', (s) => {
    s.noise({ duration: 0.3, filter: 'highpass', from: 4000, to: 1500, volume: 0.4 });
    s.tone({ from: 600 * s.pitch, to: 140, duration: 0.3, volume: 0.2 });
  });

  // Slimes: a wet squelch, high for the little ones.
  a.define('slime', (s) => {
    s.tone({ from: 320 * s.pitch, to: 110 * s.pitch, duration: 0.18, volume: 0.35, lowpass: 900 });
    s.noise({ duration: 0.15, filter: 'lowpass', from: 1200 * s.pitch, to: 300, volume: 0.25 });
  });
  a.define('slime_hurt', (s) => {
    s.tone({ from: 220 * s.pitch, to: 480 * s.pitch, duration: 0.14, volume: 0.3, lowpass: 1200 });
    s.noise({ duration: 0.12, filter: 'bandpass', from: 900, q: 2, volume: 0.2 });
  });
  // Bursting: a splat.
  a.define('splat', (s) => {
    s.noise({ duration: 0.35, filter: 'lowpass', from: 2200 * s.pitch, to: 200, volume: 0.6 });
    s.tone({ from: 180 * s.pitch, to: 60, duration: 0.3, volume: 0.4 });
    for (let i = 0; i < 4; i++) s.tone({ from: (500 + Math.random() * 300) * s.pitch, to: 200, duration: 0.07, volume: 0.12, delay: 0.08 + i * 0.05 });
  });

  // The Imp: a nasty little cackle.
  a.define('imp', (s) => {
    for (let i = 0; i < 5; i++) s.tone({ wave: 'square', from: (720 + (i % 2) * 140) * s.pitch, to: 560 * s.pitch, duration: 0.07, volume: 0.12, lowpass: 2600, delay: i * 0.08 });
  });
  a.define('imp_hurt', (s) => {
    s.tone({ wave: 'square', from: 1100 * s.pitch, to: 600 * s.pitch, duration: 0.15, volume: 0.13, lowpass: 2400 });
  });
  // A ball of fire thrown: a roar of flame.
  a.define('fireball', (s) => {
    s.noise({ duration: 0.5, filter: 'bandpass', from: 500, to: 1600, q: 1, volume: 0.45, attack: 0.03 });
    s.tone({ wave: 'sawtooth', from: 110 * s.pitch, to: 70, duration: 0.4, volume: 0.15, lowpass: 500, drive: 0.4 });
  });

  // The Golem: stone grinding on stone.
  a.define('golem', (s) => {
    s.noise({ duration: 1.1, filter: 'lowpass', from: 500 * s.pitch, to: 180, volume: 0.45, attack: 0.15 });
    for (let i = 0; i < 6; i++) s.noise({ duration: 0.05, filter: 'bandpass', from: 900, q: 3, volume: 0.2, delay: 0.1 + i * 0.14 + Math.random() * 0.05 });
    s.tone({ wave: 'sawtooth', from: 48 * s.pitch, to: 40 * s.pitch, duration: 1, volume: 0.25, lowpass: 200 });
  });
  a.define('golem_hurt', (s) => {
    s.noise({ duration: 0.2, filter: 'bandpass', from: 1400, to: 500, q: 2, volume: 0.45 });
    s.tone({ from: 90 * s.pitch, to: 60, duration: 0.2, volume: 0.3 });
  });
  a.define('golem_death', (s) => {
    s.noise({ duration: 1.6, filter: 'lowpass', from: 1800, to: 80, volume: 0.8 });
    for (let i = 0; i < 8; i++) s.tone({ from: (120 + Math.random() * 80) * s.pitch, to: 50, duration: 0.15, volume: 0.25, delay: i * 0.12 });
  });
  a.define('golem_step', (s) => {
    s.tone({ from: 70 * s.pitch, to: 35, duration: 0.3, volume: 0.45 });
    s.noise({ duration: 0.2, filter: 'lowpass', from: 600, to: 100, volume: 0.25 });
  });
  a.define('golem_punch', (s) => {
    s.noise({ duration: 0.25, filter: 'bandpass', from: 300, to: 900, q: 1.2, volume: 0.5 });
    s.tone({ from: 110 * s.pitch, to: 45, duration: 0.3, volume: 0.45 });
  });
  // Charging the pound: a rumble rising, runes humming.
  a.define('golem_charge', (s) => {
    s.noise({ duration: 1.25, filter: 'lowpass', from: 150, to: 900, volume: 0.45, attack: 0.9 });
    s.tone({ wave: 'sawtooth', from: 55 * s.pitch, to: 110 * s.pitch, duration: 1.25, attack: 1, volume: 0.25, lowpass: { freq: 300, to: 1400 } });
    s.tone({ wave: 'sine', from: 440 * s.pitch, to: 880 * s.pitch, duration: 1.2, attack: 1, volume: 0.08, vibrato: { rate: 12, depth: 10 } });
  });
  // The pound: the ground hit hard, a boom and rocks falling.
  a.define('pound', (s) => {
    s.tone({ from: 85 * s.pitch, to: 24, duration: 1.1, volume: 1 });
    s.noise({ duration: 0.9, filter: 'lowpass', from: 1600, to: 90, volume: 0.8 });
    for (let i = 0; i < 6; i++) s.noise({ duration: 0.06, filter: 'bandpass', from: 1200, q: 2, volume: 0.18, delay: 0.25 + i * 0.1 + Math.random() * 0.05 });
  });

  // The Minotaur: a snort and a low bellow.
  a.define('minotaur', (s) => {
    s.noise({ duration: 0.25, filter: 'bandpass', from: 900, to: 400, q: 2, volume: 0.35 });
    s.tone({ wave: 'sawtooth', from: 95 * s.pitch, to: 75 * s.pitch, duration: 0.7, attack: 0.1, volume: 0.35, lowpass: 600, delay: 0.15 });
  });
  a.define('minotaur_hurt', (s) => {
    s.tone({ wave: 'sawtooth', from: 150 * s.pitch, to: 90 * s.pitch, duration: 0.35, volume: 0.35, lowpass: 900 });
    s.noise({ duration: 0.2, filter: 'bandpass', from: 700, q: 2, volume: 0.25 });
  });
  a.define('minotaur_death', (s) => {
    s.tone({ wave: 'sawtooth', from: 110 * s.pitch, to: 40 * s.pitch, duration: 1.4, volume: 0.45, lowpass: 700, vibrato: { rate: 6, depth: 4 } });
    s.noise({ duration: 1, filter: 'lowpass', from: 900, to: 120, volume: 0.35, delay: 0.3 });
  });
  // Its bellow before it charges: a roar that swells.
  a.define('bellow', (s) => {
    s.tone({ wave: 'sawtooth', from: 70 * s.pitch, to: 95 * s.pitch, duration: 1.1, attack: 0.25, volume: 0.45, lowpass: { freq: 400, to: 1100 }, vibrato: { rate: 7, depth: 5 } });
    s.tone({ wave: 'sawtooth', from: 105 * s.pitch, to: 140 * s.pitch, duration: 1.1, attack: 0.25, volume: 0.25, lowpass: 900 });
    s.noise({ duration: 1, filter: 'bandpass', from: 500, to: 1200, q: 1.5, volume: 0.25, attack: 0.3 });
  });
  // The charge: hooves drumming.
  a.define('stampede', (s) => {
    for (let i = 0; i < 9; i++) {
      s.tone({ from: 80 * s.pitch, to: 40, duration: 0.12, volume: 0.45, delay: i * 0.19 });
      s.noise({ duration: 0.08, filter: 'lowpass', from: 900, to: 200, volume: 0.25, delay: i * 0.19 + 0.02 });
    }
  });
  // Into the wall: a crash, and its head ringing.
  a.define('crash', (s) => {
    s.noise({ duration: 0.6, filter: 'lowpass', from: 2400, to: 150, volume: 0.9 });
    s.tone({ from: 100 * s.pitch, to: 30, duration: 0.6, volume: 0.8 });
    for (let i = 0; i < 3; i++) s.tone({ wave: 'sine', from: 1800 + i * 450, duration: 1.2, volume: 0.05, delay: 0.2 + i * 0.1, vibrato: { rate: 9, depth: 30 } });
  });

  // The Cultist: a low muttering.
  a.define('cultist', (s) => {
    for (let i = 0; i < 4; i++) s.tone({ wave: 'sawtooth', from: (130 + (i % 2) * 18) * s.pitch, duration: 0.22, volume: 0.13, bandpass: { freq: 600, q: 3 }, delay: i * 0.2 });
  });
  a.define('cultist_hurt', (s) => {
    s.tone({ wave: 'sawtooth', from: 260 * s.pitch, to: 160 * s.pitch, duration: 0.25, volume: 0.25, bandpass: { freq: 900, q: 2 } });
  });
  // Its chant: voices in a minor chord, swelling.
  a.define('chant', (s) => {
    for (const f of [98, 116.5, 146.8]) s.tone({ wave: 'sawtooth', from: f * s.pitch, duration: 1.1, attack: 0.4, volume: 0.12, bandpass: { freq: 700, q: 2 }, vibrato: { rate: 5, depth: 2 } });
    s.noise({ duration: 1, filter: 'bandpass', from: 300, to: 900, q: 3, volume: 0.1, attack: 0.4 });
  });
  // The blessing landing: a dark chord's stab.
  a.define('empower', (s) => {
    for (const f of [196, 233, 293.7]) s.tone({ wave: 'triangle', from: f * s.pitch, to: f * 0.98, duration: 0.7, volume: 0.15 });
    s.noise({ duration: 0.4, filter: 'highpass', from: 3000, volume: 0.15 });
  });
  // The rite: a heartbeat under a rising drone.
  a.define('ritual', (s) => {
    s.tone({ wave: 'sawtooth', from: 65 * s.pitch, to: 130 * s.pitch, duration: 2.8, attack: 2, volume: 0.25, lowpass: { freq: 300, to: 1200 } });
    for (let i = 0; i < 6; i++) {
      const t = 2.6 * (1 - Math.pow(0.78, i + 1)) / (1 - Math.pow(0.78, 6));
      s.tone({ from: 70, to: 40, duration: 0.18, volume: 0.5, delay: t });
    }
  });
  // It's given itself: a burst of blood and a shriek from below.
  a.define('sacrifice', (s) => {
    s.noise({ duration: 0.6, filter: 'lowpass', from: 2500, to: 200, volume: 0.7 });
    s.tone({ wave: 'sawtooth', from: 900 * s.pitch, to: 120 * s.pitch, duration: 0.8, volume: 0.25, drive: 0.5, lowpass: 2000 });
    s.tone({ from: 60, to: 30, duration: 0.8, volume: 0.6 });
  });

  // Bats: squeaks, and a shriek before the dive.
  a.define('bat', (s) => {
    for (let i = 0; i < 2; i++) s.tone({ wave: 'sine', from: 3600 * s.pitch, to: 2800 * s.pitch, duration: 0.05, volume: 0.12, delay: i * 0.09 });
  });
  a.define('bat_shriek', (s) => {
    s.tone({ wave: 'sawtooth', from: 2800 * s.pitch, to: 4200 * s.pitch, duration: 0.35, volume: 0.13, lowpass: 6000, vibrato: { rate: 30, depth: 120 } });
  });
  a.define('bat_death', (s) => {
    s.tone({ wave: 'sine', from: 3200 * s.pitch, to: 900 * s.pitch, duration: 0.25, volume: 0.14 });
  });

  // An elite comes in: a low horn and a ring of gold.
  a.define('elite', (s) => {
    s.tone({ wave: 'sawtooth', from: 110 * s.pitch, duration: 0.9, attack: 0.08, volume: 0.25, lowpass: 900, fm: { ratio: 1, depth: 0.4 } });
    s.tone({ wave: 'sawtooth', from: 164.8 * s.pitch, duration: 0.9, attack: 0.08, volume: 0.18, lowpass: 900 });
    s.tone({ from: 1760 * s.pitch, duration: 0.8, volume: 0.06, delay: 0.1, fm: { ratio: 2.76, depth: 0.6 } });
  });
  // An elite down: a bright fall of chimes.
  a.define('elite_down', (s) => {
    for (const [i, f] of [1568, 1318.5, 1046.5, 784].entries()) s.tone({ wave: 'triangle', from: f * s.pitch, duration: 0.5, volume: 0.13, delay: i * 0.07 });
    s.tone({ from: 98, to: 60, duration: 0.5, volume: 0.35 });
  });
  // A ward taking a blow, and breaking.
  a.define('ward_hit', (s) => {
    s.tone({ wave: 'sine', from: 1300 * s.pitch, to: 1000 * s.pitch, duration: 0.25, volume: 0.15, fm: { ratio: 1.5, depth: 0.5 } });
  });
  a.define('ward_break', (s) => {
    s.noise({ duration: 0.5, filter: 'highpass', from: 6000, to: 2500, volume: 0.45 });
    for (let i = 0; i < 6; i++) s.tone({ from: (2000 + Math.random() * 2000) * s.pitch, duration: 0.15, volume: 0.07, delay: i * 0.04, fm: { ratio: 2.76, depth: 1 } });
  });
  // Frost: a crackling freeze.
  a.define('freeze', (s) => {
    s.noise({ duration: 0.5, filter: 'highpass', from: 7000, to: 3000, volume: 0.35 });
    for (let i = 0; i < 8; i++) s.noise({ duration: 0.02, filter: 'bandpass', from: 5000, q: 6, volume: 0.25, delay: i * 0.05 + Math.random() * 0.03 });
    s.tone({ wave: 'sine', from: 2400 * s.pitch, to: 1600 * s.pitch, duration: 0.5, volume: 0.06 });
  });
}
