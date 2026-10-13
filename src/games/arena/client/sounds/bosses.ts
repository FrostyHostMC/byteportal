import type { Client, SynthKit } from '@platform/client';

/**
 * The bosses' voices, synthesised on each screen: their roars and cries, their blows, their
 * spells, their minions', and the stings of an entrance, a phase and a fall. The server plays them
 * by name (`bosses/*.ts`); the entrance and fall stings are the screens' own (`client/bosses.ts`).
 */
export function defineBossSounds(client: Client) {
  const a = client.audio;

  // --- Shared: the stings, a boss's cracks of light as it dies, its fall, blows turned away.

  // An entrance: a dark brass stab over a timpani boom, a metal shimmer ringing off.
  a.define('boss_sting', (s) => {
    for (const f of [55, 82.4, 110, 130.8]) s.tone({ wave: 'sawtooth', from: f, to: f * 0.985, duration: 2.6, attack: 0.015, volume: 0.2, lowpass: { freq: 2200, to: 500, time: 1.6 }, fm: { ratio: 1, depth: 0.25 } });
    s.tone({ from: 70, to: 38, duration: 1.4, volume: 0.9, attack: 0.005 });
    s.noise({ duration: 0.5, filter: 'lowpass', from: 900, to: 120, volume: 0.6 });
    s.tone({ wave: 'sine', from: 880, to: 870, duration: 2.2, volume: 0.07, attack: 0.05, fm: { ratio: 3.5, depth: 1.6, to: 0.3 } });
    s.noise({ duration: 1.2, filter: 'highpass', from: 6000, to: 4000, volume: 0.12, attack: 0.02, delay: 0.02 });
  }, { reverb: 0.6 });
  // A fall: a bright major chord and bells, the arena won back.
  a.define('boss_vanquished', (s) => {
    for (const [f, d] of [[130.8, 0], [196, 0.04], [261.6, 0.08], [329.6, 0.12], [392, 0.16]] as const) s.tone({ wave: 'sawtooth', from: f, duration: 2.8, attack: 0.03, volume: 0.12, delay: d, lowpass: { freq: 3200, to: 900, time: 2 }, fm: { ratio: 1, depth: 0.2 } });
    for (const [f, d] of [[1046, 0.2], [1318, 0.35], [1568, 0.5], [2093, 0.65]] as const) s.tone({ wave: 'sine', from: f, duration: 1.6, volume: 0.08, delay: d, fm: { ratio: 2.76, depth: 0.8, to: 0.1 } });
    s.tone({ from: 65, to: 40, duration: 1.2, volume: 0.7 });
  }, { reverb: 0.7 });
  // A phase: a war drum and a rising swell.
  a.define('boss_phase', (s) => {
    s.tone({ from: 95, to: 50, duration: 0.6, volume: 0.8 });
    s.noise({ duration: 0.3, filter: 'lowpass', from: 1400, to: 200, volume: 0.5 });
    for (const f of [146.8, 174.6, 220]) s.tone({ wave: 'sawtooth', from: f * 0.97, to: f, duration: 0.9, attack: 0.5, volume: 0.07, lowpass: 1200, delay: 0.05 });
  }, { reverb: 0.5 });
  // Light cracking out of a dying boss.
  a.define('boss_crack', (s) => {
    s.noise({ duration: 0.25, filter: 'bandpass', from: 3200 * s.pitch, to: 900, q: 2, volume: 0.6 });
    s.tone({ wave: 'square', from: 420 * s.pitch, to: 90, duration: 0.3, volume: 0.15, lowpass: 2400 });
    s.tone({ from: 70 * s.pitch, to: 40, duration: 0.4, volume: 0.5 });
  });
  // It falls: the ground shaking and a choir's dying note.
  a.define('boss_fall', (s) => {
    s.tone({ from: 55, to: 26, duration: 2.6, volume: 1 });
    s.noise({ duration: 2.2, filter: 'lowpass', from: 1200, to: 60, volume: 0.8 });
    for (const f of [220, 261.6, 329.6]) s.tone({ wave: 'triangle', from: f, to: f * 0.92, duration: 2.6, attack: 0.3, volume: 0.07, vibrato: { rate: 5, depth: 3 }, delay: 0.2 });
  }, { reverb: 0.7 });
  // A blow turned away (shielded, mid-roar): a dull ring.
  a.define('boss_deflect', (s) => {
    s.tone({ wave: 'sine', from: 1400 * s.pitch, to: 1350 * s.pitch, duration: 0.35, volume: 0.18, fm: { ratio: 2.76, depth: 1.5, to: 0.2 } });
    s.noise({ duration: 0.06, filter: 'highpass', from: 5000, volume: 0.25 });
  });
  // A blast staggers it: a heavy crunch and a grunt.
  a.define('boss_stagger', (s) => {
    s.noise({ duration: 0.4, filter: 'lowpass', from: 2000, to: 150, volume: 0.8 });
    s.tone({ wave: 'sawtooth', from: 120 * s.pitch, to: 60 * s.pitch, duration: 0.6, volume: 0.35, lowpass: 600, drive: 0.4 });
  });

  // --- The Bone Colossus.
  const bonesRattle = (s: SynthKit, n: number, delay = 0, vol = 0.25) => {
    for (let i = 0; i < n; i++) s.noise({ duration: 0.035, filter: 'bandpass', from: (1500 + Math.random() * 1500) * s.pitch, to: 900, q: 3, volume: vol, delay: delay + i * 0.05 + Math.random() * 0.03 });
  };
  a.define('colossus_roar', (s) => {
    for (const d of [0, 0.03]) s.tone({ wave: 'sawtooth', from: 48 * s.pitch, to: 34 * s.pitch, duration: 2.1, attack: 0.15, volume: 0.32, lowpass: { freq: 900, to: 300 }, vibrato: { rate: 9, depth: 3 }, drive: 0.5, delay: d });
    s.tone({ wave: 'square', from: 96 * s.pitch, to: 70 * s.pitch, duration: 1.9, attack: 0.2, volume: 0.1, lowpass: 700, vibrato: { rate: 13, depth: 4 } });
    s.noise({ duration: 1.9, filter: 'bandpass', from: 700, to: 250, q: 1.5, volume: 0.45, attack: 0.15 });
    bonesRattle(s, 18, 0.1, 0.2);
  }, { reverb: 0.6 });
  a.define('colossus_groan', (s) => {
    s.tone({ wave: 'sawtooth', from: 42 * s.pitch, to: 36 * s.pitch, duration: 1.4, attack: 0.3, volume: 0.25, lowpass: 400, vibrato: { rate: 4, depth: 2 } });
    bonesRattle(s, 5, 0.2, 0.12);
  });
  a.define('colossus_hurt', (s) => {
    bonesRattle(s, 4, 0, 0.3);
    s.tone({ wave: 'sawtooth', from: 70 * s.pitch, to: 50, duration: 0.35, volume: 0.25, lowpass: 600 });
  });
  // Its footfall: a deep thud and a rattle.
  a.define('colossus_step', (s) => {
    s.tone({ from: 60 * s.pitch, to: 30, duration: 0.45, volume: 0.7 });
    s.noise({ duration: 0.3, filter: 'lowpass', from: 700, to: 120, volume: 0.45 });
    bonesRattle(s, 3, 0.03, 0.1);
  });
  a.define('colossus_wind', (s) => {
    s.noise({ duration: 0.9, filter: 'bandpass', from: 300 * s.pitch, to: 900 * s.pitch, q: 2, volume: 0.35, attack: 0.5 });
    bonesRattle(s, 6, 0, 0.15);
  });
  a.define('colossus_sweep', (s) => {
    s.noise({ duration: 0.45, filter: 'bandpass', from: 1500, to: 250, q: 1.2, volume: 0.8 });
    s.tone({ from: 140, to: 60, duration: 0.45, volume: 0.3 });
  });
  a.define('colossus_stomp', (s) => {
    s.tone({ from: 85 * s.pitch, to: 24, duration: 1.2, volume: 1 });
    s.noise({ duration: 1, filter: 'lowpass', from: 1600, to: 90, volume: 0.85 });
    bonesRattle(s, 10, 0.05, 0.2);
  }, { reverb: 0.5 });
  a.define('colossus_snort', (s) => {
    for (const d of [0, 0.35]) s.noise({ duration: 0.3, filter: 'bandpass', from: 900 * s.pitch, to: 300, q: 1.5, volume: 0.6, delay: d });
    s.tone({ wave: 'sawtooth', from: 60, to: 45, duration: 0.8, volume: 0.25, lowpass: 400, delay: 0.1 });
  });
  a.define('colossus_crash', (s) => {
    s.tone({ from: 70, to: 22, duration: 1.4, volume: 1 });
    s.noise({ duration: 1.2, filter: 'lowpass', from: 3000, to: 100, volume: 0.9 });
    bonesRattle(s, 24, 0, 0.3);
  }, { reverb: 0.5 });
  a.define('colossus_rise', (s) => {
    s.noise({ duration: 2.2, filter: 'lowpass', from: 300, to: 900, volume: 0.6, attack: 1 });
    s.tone({ from: 30, to: 45, duration: 2.2, volume: 0.6, attack: 1 });
    bonesRattle(s, 20, 0.6, 0.15);
  });
  a.define('colossus_death', (s) => {
    for (const d of [0, 0.04]) s.tone({ wave: 'sawtooth', from: 60 * s.pitch, to: 22 * s.pitch, duration: 3, attack: 0.1, volume: 0.3, lowpass: { freq: 1200, to: 150 }, vibrato: { rate: 7, depth: 4 }, drive: 0.4, delay: d });
    bonesRattle(s, 40, 0.3, 0.22);
  }, { reverb: 0.6 });
  a.define('bone_whistle', (s) => {
    s.tone({ wave: 'sine', from: 1800 * s.pitch, to: 500 * s.pitch, duration: 1.3, volume: 0.12, attack: 0.2 });
    s.noise({ duration: 1.3, filter: 'bandpass', from: 3000, to: 800, q: 6, volume: 0.1, attack: 0.3 });
  });
  a.define('bone_crash', (s) => {
    s.noise({ duration: 0.5, filter: 'lowpass', from: 2600, to: 200, volume: 0.8 });
    s.tone({ from: 110 * s.pitch, to: 40, duration: 0.5, volume: 0.6 });
    bonesRattle(s, 10, 0.02, 0.3);
  });
  a.define('rib_creak', (s) => {
    s.tone({ wave: 'sawtooth', from: 180 * s.pitch, to: 120 * s.pitch, duration: 1, volume: 0.15, bandpass: { freq: 900, q: 4 }, vibrato: { rate: 23, depth: 15 } });
    bonesRattle(s, 8, 0.4, 0.2);
    s.noise({ duration: 0.8, filter: 'bandpass', from: 400, to: 1200, q: 2, volume: 0.25, delay: 0.5 });
  });

  // --- The Warden.
  a.define('warden_roar', (s) => {
    for (const [f, d] of [[52, 0], [55, 0.02], [78, 0.04]] as const) s.tone({ wave: 'sawtooth', from: f * s.pitch, to: f * 0.72 * s.pitch, duration: 1.8, attack: 0.1, volume: 0.28, lowpass: { freq: 1000, to: 350 }, fm: { ratio: 0.5, depth: 0.3 }, delay: d });
    s.noise({ duration: 1.5, filter: 'lowpass', from: 1100, to: 180, volume: 0.4, attack: 0.1 });
  }, { reverb: 0.6 });
  a.define('warden_laugh', (s) => {
    for (let i = 0; i < 5; i++) s.tone({ wave: 'sawtooth', from: (110 - i * 4) * s.pitch, to: (85 - i * 4) * s.pitch, duration: 0.16, volume: 0.25, lowpass: 900, delay: i * 0.2, vibrato: { rate: 30, depth: 6 } });
  }, { reverb: 0.6 });
  a.define('warden_death', (s) => {
    for (const d of [0, 0.03]) s.tone({ wave: 'sawtooth', from: 90 * s.pitch, to: 30 * s.pitch, duration: 2.8, attack: 0.05, volume: 0.3, lowpass: { freq: 1400, to: 200 }, vibrato: { rate: 6, depth: 5 }, delay: d });
    s.noise({ duration: 2.4, filter: 'bandpass', from: 1200, to: 300, q: 1, volume: 0.3, delay: 0.2 });
  }, { reverb: 0.7 });
  a.define('warden_step', (s) => {
    s.tone({ from: 75 * s.pitch, to: 40, duration: 0.3, volume: 0.45 });
    s.noise({ duration: 0.18, filter: 'lowpass', from: 900, to: 200, volume: 0.25 });
  });
  a.define('warden_swing', (s) => {
    s.noise({ duration: 0.3, filter: 'bandpass', from: 2400, to: 400, q: 1.4, volume: 0.6 });
  });
  a.define('soul_whoosh', (s) => {
    s.noise({ duration: 0.7, filter: 'bandpass', from: 400, to: 2400, q: 3, volume: 0.45 });
    s.tone({ wave: 'triangle', from: 220 * s.pitch, to: 440 * s.pitch, duration: 0.6, volume: 0.12, vibrato: { rate: 10, depth: 20 } });
  });
  const clinks = (s: SynthKit, n: number, delay = 0, vol = 0.18) => {
    for (let i = 0; i < n; i++) s.tone({ wave: 'sine', from: (2200 + Math.random() * 1600) * s.pitch, duration: 0.09, volume: vol, delay: delay + i * 0.06 + Math.random() * 0.02, fm: { ratio: 2.76, depth: 1.2 } });
  };
  a.define('chain_rattle', (s) => clinks(s, 12, 0, 0.14));
  a.define('chain_warn', (s) => {
    s.tone({ wave: 'square', from: 880, to: 870, duration: 0.12, volume: 0.12, lowpass: 3000 });
    s.tone({ wave: 'square', from: 880, to: 870, duration: 0.12, volume: 0.12, lowpass: 3000, delay: 0.16 });
  }, { reverb: 0 });
  a.define('chain_throw', (s) => {
    s.noise({ duration: 0.35, filter: 'highpass', from: 2500, to: 5000, volume: 0.4 });
    clinks(s, 6, 0, 0.12);
  });
  a.define('chain_yank', (s) => {
    s.noise({ duration: 0.25, filter: 'bandpass', from: 800, to: 2500, q: 2, volume: 0.5 });
    clinks(s, 8, 0, 0.2);
  });
  a.define('prison_hum', (s) => {
    s.tone({ wave: 'triangle', from: 110 * s.pitch, to: 220 * s.pitch, duration: 1.3, volume: 0.25, attack: 1, vibrato: { rate: 8, depth: 6 } });
    s.tone({ wave: 'sine', from: 330 * s.pitch, to: 660 * s.pitch, duration: 1.3, volume: 0.12, attack: 1 });
  });
  a.define('prison_slam', (s) => {
    s.tone({ wave: 'sine', from: 600, to: 580, duration: 0.8, volume: 0.25, fm: { ratio: 1.41, depth: 2.5, to: 0.2 } });
    s.noise({ duration: 0.3, filter: 'lowpass', from: 2500, to: 300, volume: 0.6 });
    s.tone({ from: 80, to: 40, duration: 0.5, volume: 0.6 });
  });

  // --- The Broodmother and her brood.
  const chitter = (s: SynthKit, n: number, f: number, vol: number, delay = 0) => {
    for (let i = 0; i < n; i++) s.tone({ wave: 'square', from: f * s.pitch * (0.9 + Math.random() * 0.2), to: f * 0.7 * s.pitch, duration: 0.025, volume: vol, delay: delay + i * 0.045 + Math.random() * 0.015, lowpass: 3500 });
  };
  a.define('brood_screech', (s) => {
    s.noise({ duration: 1.6, filter: 'bandpass', from: 3600 * s.pitch, to: 1500 * s.pitch, q: 4, volume: 0.55, attack: 0.05 });
    s.tone({ wave: 'sawtooth', from: 900 * s.pitch, to: 420 * s.pitch, duration: 1.5, volume: 0.12, vibrato: { rate: 26, depth: 40 }, bandpass: { freq: 1500, q: 2 } });
    chitter(s, 16, 1100, 0.08, 0.1);
  }, { reverb: 0.6 });
  // Her legs on the stone: a scatter of clicks.
  a.define('brood_step', (s) => {
    for (let i = 0; i < 4; i++) s.noise({ duration: 0.02, filter: 'bandpass', from: (1800 + Math.random() * 900) * s.pitch, to: 1200, q: 4, volume: 0.2, delay: i * 0.035 + Math.random() * 0.02 });
  });
  a.define('brood_hiss', (s) => {
    s.noise({ duration: 0.6, filter: 'highpass', from: 3500 * s.pitch, to: 2800, volume: 0.4, attack: 0.08 });
    chitter(s, 4, 900, 0.07);
  });
  a.define('brood_chitter', (s) => chitter(s, 10, 800, 0.09));
  a.define('brood_hurt', (s) => {
    s.noise({ duration: 0.25, filter: 'bandpass', from: 2800 * s.pitch, to: 1600, q: 3, volume: 0.5 });
    chitter(s, 3, 1000, 0.1);
  });
  a.define('brood_bite', (s) => {
    s.noise({ duration: 0.12, filter: 'bandpass', from: 1800, to: 700, q: 2, volume: 0.7 });
    s.tone({ wave: 'square', from: 300, to: 120, duration: 0.1, volume: 0.15, lowpass: 1500 });
    s.noise({ duration: 0.3, filter: 'highpass', from: 4000, volume: 0.15, delay: 0.08 });
  });
  a.define('brood_leap', (s) => {
    s.noise({ duration: 0.5, filter: 'bandpass', from: 600, to: 2200, q: 1.5, volume: 0.5 });
    chitter(s, 6, 1200, 0.08);
  });
  a.define('brood_land', (s) => {
    s.tone({ from: 80, to: 30, duration: 0.9, volume: 0.9 });
    s.noise({ duration: 0.7, filter: 'lowpass', from: 2000, to: 120, volume: 0.8 });
    chitter(s, 8, 700, 0.08, 0.1);
  }, { reverb: 0.4 });
  a.define('brood_lay', (s) => {
    for (let i = 0; i < 3; i++) s.noise({ duration: 0.3, filter: 'bandpass', from: 500, to: 250, q: 3, volume: 0.45, delay: i * 0.28 });
    s.tone({ wave: 'sine', from: 160, to: 90, duration: 0.9, volume: 0.2, vibrato: { rate: 6, depth: 10 } });
  });
  a.define('brood_death', (s) => {
    s.noise({ duration: 2.6, filter: 'bandpass', from: 3000, to: 500, q: 3, volume: 0.5 });
    s.tone({ wave: 'sawtooth', from: 700 * s.pitch, to: 120 * s.pitch, duration: 2.6, volume: 0.12, vibrato: { rate: 18, depth: 30 }, lowpass: 2000 });
    chitter(s, 30, 900, 0.06, 0.2);
  }, { reverb: 0.6 });
  a.define('web_charge', (s) => {
    s.noise({ duration: 0.6, filter: 'bandpass', from: 400 * s.pitch, to: 1600 * s.pitch, q: 5, volume: 0.35, attack: 0.4 });
  });
  a.define('web_spit', (s) => {
    s.noise({ duration: 0.2, filter: 'bandpass', from: 1200, to: 500, q: 2, volume: 0.6 });
    s.tone({ wave: 'sine', from: 300, to: 900, duration: 0.15, volume: 0.15 });
  });
  a.define('web_hit', (s) => {
    s.noise({ duration: 0.35, filter: 'lowpass', from: 1200, to: 300, volume: 0.5 });
    s.tone({ wave: 'sine', from: 200, to: 120, duration: 0.3, volume: 0.25 });
  });
  a.define('venom_spit', (s) => {
    for (let i = 0; i < 3; i++) s.noise({ duration: 0.15, filter: 'bandpass', from: 900, to: 400, q: 2, volume: 0.45, delay: i * 0.07 });
  });
  a.define('venom_splash', (s) => {
    s.noise({ duration: 0.5, filter: 'bandpass', from: 1400, to: 300, q: 1.2, volume: 0.45 });
    for (let i = 0; i < 5; i++) s.tone({ wave: 'sine', from: (500 + Math.random() * 600) * s.pitch, to: 900, duration: 0.06, volume: 0.08, delay: 0.1 + i * 0.07 });
  });
  a.define('egg_fling', (s) => {
    s.noise({ duration: 0.25, filter: 'bandpass', from: 700, to: 300, q: 2, volume: 0.45 });
  });
  a.define('egg_pulse', (s) => {
    s.tone({ wave: 'sine', from: 90 * s.pitch, to: 60, duration: 0.25, volume: 0.35 });
    s.noise({ duration: 0.15, filter: 'lowpass', from: 600, to: 200, volume: 0.25 });
  });
  a.define('egg_hatch', (s) => {
    s.noise({ duration: 0.45, filter: 'bandpass', from: 1300, to: 350, q: 1.3, volume: 0.7 });
    chitter(s, 12, 1400, 0.08, 0.1);
  });
  a.define('egg_squish', (s) => {
    s.noise({ duration: 0.18, filter: 'bandpass', from: 800 * s.pitch, to: 300, q: 2, volume: 0.5 });
  });
  a.define('egg_splat', (s) => {
    s.noise({ duration: 0.5, filter: 'lowpass', from: 1800, to: 200, volume: 0.7 });
    s.tone({ wave: 'sine', from: 140, to: 60, duration: 0.3, volume: 0.4 });
  });
  a.define('spiderling', (s) => chitter(s, 5, 1800, 0.06));

  // --- The Lich King.
  const choir = (s: SynthKit, fs: number[], o: { duration: number; volume: number; attack?: number; delay?: number; to?: number }) => {
    for (const f of fs) s.tone({ wave: 'triangle', from: f * s.pitch, to: f * (o.to ?? 1) * s.pitch, duration: o.duration, attack: o.attack ?? 0.3, volume: o.volume, vibrato: { rate: 5 + Math.random(), depth: f * 0.012 }, delay: o.delay });
  };
  a.define('lich_whisper', (s) => {
    s.noise({ duration: 1.6, filter: 'bandpass', from: 2400 * s.pitch, to: 1400 * s.pitch, q: 5, volume: 0.3, attack: 0.6 });
    choir(s, [146.8, 174.6, 220], { duration: 1.6, volume: 0.05, attack: 0.8 });
  }, { reverb: 0.8 });
  a.define('lich_roar', (s) => {
    choir(s, [73.4, 110, 146.8, 155.6, 220], { duration: 2.2, volume: 0.1, attack: 0.15, to: 0.94 });
    s.noise({ duration: 2, filter: 'bandpass', from: 1800, to: 500, q: 1.5, volume: 0.45, attack: 0.1 });
    s.tone({ wave: 'sawtooth', from: 55 * s.pitch, to: 40 * s.pitch, duration: 2, volume: 0.25, lowpass: 600, drive: 0.3 });
  }, { reverb: 0.8 });
  a.define('lich_hurt', (s) => {
    s.noise({ duration: 0.3, filter: 'bandpass', from: 2200 * s.pitch, to: 1000, q: 4, volume: 0.35 });
    s.tone({ wave: 'sine', from: 2600 * s.pitch, to: 2500, duration: 0.25, volume: 0.06, fm: { ratio: 1.41, depth: 2 } });
  });
  a.define('lich_death', (s) => {
    choir(s, [220, 261.6, 311.1, 370], { duration: 3.2, volume: 0.08, attack: 0.05, to: 0.5 });
    s.noise({ duration: 3, filter: 'bandpass', from: 3000, to: 400, q: 2, volume: 0.45 });
    for (let i = 0; i < 10; i++) s.tone({ wave: 'sine', from: (2500 + Math.random() * 2500) * s.pitch, duration: 0.3, volume: 0.06, delay: 1 + i * 0.12, fm: { ratio: 2.76, depth: 1 } });
  }, { reverb: 0.8 });
  a.define('lich_raise', (s) => {
    choir(s, [98, 116.5, 146.8], { duration: 1.3, volume: 0.12, attack: 0.5, to: 1.06 });
    s.noise({ duration: 1.1, filter: 'lowpass', from: 300, to: 900, volume: 0.35, attack: 0.6 });
  }, { reverb: 0.7 });
  const shimmer = (s: SynthKit, n: number, delay = 0, vol = 0.07) => {
    for (let i = 0; i < n; i++) s.tone({ wave: 'sine', from: (2000 + Math.random() * 3000) * s.pitch, duration: 0.4, volume: vol, delay: delay + i * 0.04, fm: { ratio: 3.1, depth: 0.8 } });
  };
  a.define('frost_charge', (s) => {
    s.noise({ duration: 0.8, filter: 'bandpass', from: 1500 * s.pitch, to: 5000 * s.pitch, q: 6, volume: 0.25, attack: 0.5 });
    shimmer(s, 6, 0.2, 0.04);
  });
  a.define('frost_bolt', (s) => {
    s.noise({ duration: 0.3, filter: 'highpass', from: 3000, to: 6000, volume: 0.35 });
    s.tone({ wave: 'sine', from: 1800, to: 600, duration: 0.25, volume: 0.15 });
  });
  a.define('frost_nova', (s) => {
    s.noise({ duration: 1, filter: 'highpass', from: 2000, to: 6000, volume: 0.6 });
    s.tone({ from: 90, to: 40, duration: 0.8, volume: 0.6 });
    shimmer(s, 14, 0.05, 0.06);
  }, { reverb: 0.5 });
  // A blink: frost gathered in a rush, a crack, gone.
  a.define('lich_blink', (s) => {
    s.noise({ duration: 0.35, filter: 'bandpass', from: 800 * s.pitch, to: 5000 * s.pitch, q: 3, volume: 0.45 });
    s.tone({ wave: 'sine', from: 2400 * s.pitch, to: 600, duration: 0.3, volume: 0.12, fm: { ratio: 2.76, depth: 1.2 } });
    shimmer(s, 6, 0.05, 0.05);
  });
  a.define('ice_spike', (s) => {
    s.noise({ duration: 0.18, filter: 'bandpass', from: 3500 * s.pitch, to: 1500, q: 2, volume: 0.5 });
    s.tone({ wave: 'sine', from: 1600 * s.pitch, to: 1500 * s.pitch, duration: 0.3, volume: 0.07, fm: { ratio: 2.76, depth: 1.5 } });
  });
  a.define('shield_up', (s) => {
    s.tone({ wave: 'sine', from: 220, to: 440, duration: 1.2, volume: 0.2, attack: 0.4, fm: { ratio: 1.5, depth: 0.5 } });
    shimmer(s, 10, 0.3, 0.05);
  }, { reverb: 0.6 });
  a.define('shield_break', (s) => {
    s.noise({ duration: 0.9, filter: 'highpass', from: 4000, to: 1500, volume: 0.8 });
    shimmer(s, 24, 0, 0.09);
    s.tone({ from: 70, to: 30, duration: 1, volume: 0.7 });
  }, { reverb: 0.6 });
  a.define('soul_storm', (s) => {
    choir(s, [73.4, 87.3, 110, 130.8], { duration: 3.5, volume: 0.09, attack: 1.2 });
    s.noise({ duration: 3.5, filter: 'bandpass', from: 300, to: 1400, q: 1, volume: 0.35, attack: 1.2 });
  }, { reverb: 0.8 });
  a.define('soul_crash', (s) => {
    s.noise({ duration: 0.45, filter: 'bandpass', from: 1800 * s.pitch, to: 400, q: 1.2, volume: 0.6 });
    s.tone({ wave: 'triangle', from: 660 * s.pitch, to: 120, duration: 0.4, volume: 0.15 });
    s.tone({ from: 90, to: 45, duration: 0.4, volume: 0.45 });
  });
  a.define('phylactery_hit', (s) => {
    s.tone({ wave: 'sine', from: 1200 * s.pitch, to: 1180 * s.pitch, duration: 0.5, volume: 0.15, fm: { ratio: 2.76, depth: 1.8, to: 0.2 } });
  });
  a.define('phylactery_break', (s) => {
    s.noise({ duration: 0.7, filter: 'highpass', from: 5000, to: 2000, volume: 0.7 });
    shimmer(s, 16, 0, 0.08);
    choir(s, [220, 277.2, 329.6], { duration: 1.2, volume: 0.06, attack: 0.02, to: 1.5 });
  }, { reverb: 0.6 });
}
