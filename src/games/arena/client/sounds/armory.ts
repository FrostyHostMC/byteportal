import type { Client } from '@platform/client';

/**
 * The arsenal's voices, synthesised on each screen: swings by weight (a dagger's flick to a
 * greatsword's heave), hits by what lands (a blade's cut, a hammer's crunch, a spear's thwack),
 * the shield's block and the parry's ring, the warhammer's charge and slam, the spear's flight
 * and its call home, the crossbow's twang and its ratchet, the three spells and what they do,
 * the forge's anvil, a legendary's choir, potions and blessings.
 */
export function defineArmorySounds(client: Client) {
  const a = client.audio;

  // --- swings --------------------------------------------------------------------------------
  a.define('arena_swing', (s) => {
    s.noise({ duration: 0.2, filter: 'bandpass', from: 900 * s.pitch, to: 2600 * s.pitch, q: 1.4, volume: 0.42, attack: 0.03 });
    s.noise({ duration: 0.12, filter: 'bandpass', from: 2600 * s.pitch, to: 700 * s.pitch, q: 1.2, volume: 0.25, delay: 0.12 });
  });
  a.define('arena_swing_light', (s) => {
    s.noise({ duration: 0.1, filter: 'bandpass', from: 2200 * s.pitch, to: 4400 * s.pitch, q: 1.6, volume: 0.35, attack: 0.015 });
  });
  a.define('arena_swing_heavy', (s) => {
    s.noise({ duration: 0.38, filter: 'bandpass', from: 380 * s.pitch, to: 1400 * s.pitch, q: 1.1, volume: 0.6, attack: 0.08 });
    s.noise({ duration: 0.2, filter: 'lowpass', from: 1400 * s.pitch, to: 300, volume: 0.35, delay: 0.3 });
    s.tone({ from: 90 * s.pitch, to: 60 * s.pitch, duration: 0.35, volume: 0.18, attack: 0.1 });
  });
  a.define('arena_thrust', (s) => {
    s.noise({ duration: 0.13, filter: 'bandpass', from: 1500 * s.pitch, to: 3400 * s.pitch, q: 2, volume: 0.4, attack: 0.01 });
    s.tone({ wave: 'triangle', from: 320 * s.pitch, to: 180 * s.pitch, duration: 0.1, volume: 0.08 });
  });

  // --- hits ----------------------------------------------------------------------------------
  a.define('arena_hit_blade', (s) => {
    s.noise({ duration: 0.09, filter: 'bandpass', from: 2800 * s.pitch, to: 1400, q: 1.5, volume: 0.55 });
    s.tone({ wave: 'triangle', from: 190 * s.pitch, to: 80, duration: 0.12, volume: 0.5 });
    s.tone({ from: 1300 * s.pitch, duration: 0.25, volume: 0.05, fm: { ratio: 1.41, depth: 1.2 }, delay: 0.01 });
  });
  a.define('arena_hit_light', (s) => {
    s.noise({ duration: 0.06, filter: 'highpass', from: 3200 * s.pitch, to: 2200, volume: 0.45 });
    s.tone({ wave: 'triangle', from: 240 * s.pitch, to: 120, duration: 0.07, volume: 0.3 });
  });
  a.define('arena_hit_heavy', (s) => {
    s.tone({ wave: 'triangle', from: 130 * s.pitch, to: 45, duration: 0.28, volume: 0.75, drive: 0.3 });
    s.noise({ duration: 0.22, filter: 'lowpass', from: 2400 * s.pitch, to: 260, volume: 0.6 });
    s.noise({ duration: 0.06, filter: 'bandpass', from: 1800, to: 1200, q: 2, volume: 0.35 });
  });
  a.define('arena_hit_blunt', (s) => {
    s.tone({ from: 95 * s.pitch, to: 36, duration: 0.32, volume: 0.9, drive: 0.25 });
    s.noise({ duration: 0.28, filter: 'lowpass', from: 900 * s.pitch, to: 110, volume: 0.7 });
    for (let i = 0; i < 3; i++) s.noise({ duration: 0.03, filter: 'bandpass', from: 1400 + i * 300, to: 900, q: 3, volume: 0.25, delay: 0.02 + i * 0.03 });
  });
  a.define('arena_hit_pierce', (s) => {
    s.noise({ duration: 0.08, filter: 'bandpass', from: 1600 * s.pitch, to: 900, q: 2.5, volume: 0.5 });
    s.tone({ wave: 'triangle', from: 260 * s.pitch, to: 110, duration: 0.09, volume: 0.45 });
  });

  // --- the shield ----------------------------------------------------------------------------
  // A blow on the shield: the boards' thunk and the rim's ring.
  a.define('arena_block', (s) => {
    s.tone({ wave: 'square', from: 170 * s.pitch, to: 105 * s.pitch, duration: 0.14, volume: 0.35, lowpass: 900 });
    s.noise({ duration: 0.1, filter: 'bandpass', from: 1100 * s.pitch, to: 600, q: 2, volume: 0.45 });
    s.tone({ from: 640 * s.pitch, duration: 0.35, volume: 0.1, fm: { ratio: 1.41, depth: 1.6, to: 0.3 } });
  });
  // A parry: a bright, ringing clang that hangs in the air.
  a.define('arena_parry', (s) => {
    s.noise({ duration: 0.05, filter: 'highpass', from: 5000, to: 3000, volume: 0.6 });
    s.tone({ from: 1180 * s.pitch, duration: 0.9, volume: 0.3, fm: { ratio: 2.76, depth: 2.5, to: 0.2 } });
    s.tone({ from: 1760 * s.pitch, duration: 0.7, volume: 0.18, delay: 0.01 });
    s.tone({ from: 2640 * s.pitch, duration: 0.45, volume: 0.1, delay: 0.02 });
    s.tone({ wave: 'triangle', from: 220 * s.pitch, to: 140, duration: 0.12, volume: 0.35 });
  });
  a.define('arena_bash', (s) => {
    s.tone({ from: 115 * s.pitch, to: 55, duration: 0.2, volume: 0.7 });
    s.noise({ duration: 0.12, filter: 'lowpass', from: 1600, to: 200, volume: 0.5 });
  });
  // Aegis: a radiant chord bursting out.
  a.define('arena_aegis', (s) => {
    for (const f of [523, 659, 784, 1046]) s.tone({ from: f * s.pitch, duration: 0.9, attack: 0.02, volume: 0.13 });
    s.noise({ duration: 0.5, filter: 'bandpass', from: 600, to: 4000, q: 1, volume: 0.3 });
  });
  // Dazed: a little circling twitter.
  a.define('arena_daze', (s) => {
    for (let i = 0; i < 3; i++) s.tone({ from: (1700 + i * 200) * s.pitch, to: (2300 + i * 150) * s.pitch, duration: 0.07, volume: 0.07, delay: i * 0.09 });
  });

  // --- the warhammer -------------------------------------------------------------------------
  a.define('arena_charge', (s) => {
    s.tone({ wave: 'sawtooth', from: 55 * s.pitch, to: 120 * s.pitch, duration: 0.9, attack: 0.3, volume: 0.22, lowpass: { freq: 300, to: 900 } });
    s.noise({ duration: 0.9, filter: 'lowpass', from: 200, to: 900, volume: 0.2, attack: 0.4 });
  });
  a.define('arena_slam', (s) => {
    s.noise({ duration: 0.09, filter: 'highpass', from: 3000, to: 1200, volume: 0.6 });
    s.tone({ from: 75 * s.pitch, to: 24, duration: 1.0, volume: 1.0, drive: 0.2 });
    s.noise({ duration: 0.8, filter: 'lowpass', from: 1800 * s.pitch, to: 90, volume: 0.8 });
    for (let i = 0; i < 6; i++) s.noise({ duration: 0.04, filter: 'bandpass', from: 900 + Math.random() * 900, to: 500, q: 3, volume: 0.2, delay: 0.1 + i * 0.07 + Math.random() * 0.04 });
  });

  // --- the spear -----------------------------------------------------------------------------
  a.define('arena_spear_throw', (s) => {
    s.noise({ duration: 0.32, filter: 'bandpass', from: 700 * s.pitch, to: 3200 * s.pitch, q: 1.6, volume: 0.5, attack: 0.04 });
    s.tone({ wave: 'triangle', from: 150 * s.pitch, to: 90, duration: 0.12, volume: 0.25 });
  });
  a.define('arena_spear_hit', (s) => {
    s.tone({ wave: 'triangle', from: 230 * s.pitch, to: 85, duration: 0.12, volume: 0.6 });
    s.noise({ duration: 0.1, filter: 'bandpass', from: 1300 * s.pitch, to: 700, q: 2, volume: 0.5 });
  });
  // Stuck fast: a thunk and the shaft quivering.
  a.define('arena_spear_stick', (s) => {
    s.tone({ wave: 'square', from: 300 * s.pitch, to: 240, duration: 0.08, volume: 0.3, lowpass: 1400 });
    s.tone({ wave: 'triangle', from: 170 * s.pitch, duration: 0.45, volume: 0.2, vibrato: { rate: 26, depth: 30 }, delay: 0.04 });
  });
  // Called home: a rising whistle.
  a.define('arena_spear_recall', (s) => {
    s.tone({ from: 480 * s.pitch, to: 1400 * s.pitch, duration: 0.45, volume: 0.18, attack: 0.05, vibrato: { rate: 9, depth: 18 } });
    s.noise({ duration: 0.45, filter: 'bandpass', from: 900, to: 2800, q: 2, volume: 0.25, attack: 0.1 });
  });
  a.define('arena_spear_catch', (s) => {
    s.noise({ duration: 0.05, filter: 'lowpass', from: 2000, to: 500, volume: 0.5 });
    s.tone({ wave: 'triangle', from: 210 * s.pitch, to: 150, duration: 0.07, volume: 0.35 });
  });

  // --- the crossbow --------------------------------------------------------------------------
  a.define('arena_xbow_shot', (s) => {
    s.noise({ duration: 0.04, filter: 'highpass', from: 4000, to: 2500, volume: 0.6 });
    s.tone({ wave: 'triangle', from: 210 * s.pitch, to: 150 * s.pitch, duration: 0.4, volume: 0.45, vibrato: { rate: 34, depth: 14 } });
    s.tone({ from: 85 * s.pitch, to: 50, duration: 0.12, volume: 0.6 });
    s.noise({ duration: 0.18, filter: 'bandpass', from: 1800, to: 3500, q: 1.5, volume: 0.25, delay: 0.02 });
  });
  // Spanning: the windlass's ratchet, the string creaking back.
  a.define('arena_xbow_crank', (s) => {
    for (let i = 0; i < 7; i++) s.noise({ duration: 0.025, filter: 'bandpass', from: 3200 * s.pitch, to: 2600, q: 4, volume: 0.28, delay: 0.12 + i * 0.12 });
    s.tone({ wave: 'sawtooth', from: 140 * s.pitch, to: 180 * s.pitch, duration: 0.85, volume: 0.05, lowpass: 600, delay: 0.1 });
  });
  a.define('arena_xbow_ready', (s) => {
    s.noise({ duration: 0.03, filter: 'bandpass', from: 2400, to: 2000, q: 4, volume: 0.45 });
    s.tone({ wave: 'square', from: 520 * s.pitch, to: 420, duration: 0.05, volume: 0.12, lowpass: 2000, delay: 0.06 });
  });
  a.define('arena_bolt_hit', (s) => {
    s.noise({ duration: 0.06, filter: 'bandpass', from: 2200 * s.pitch, to: 1200, q: 2.5, volume: 0.5 });
    s.tone({ wave: 'triangle', from: 300 * s.pitch, to: 130, duration: 0.09, volume: 0.45 });
  });
  a.define('arena_bolt_wall', (s) => {
    s.tone({ wave: 'square', from: 520 * s.pitch, to: 380, duration: 0.06, volume: 0.25, lowpass: 1800 });
    s.tone({ wave: 'triangle', from: 210 * s.pitch, duration: 0.25, volume: 0.12, vibrato: { rate: 30, depth: 25 }, delay: 0.03 });
  });

  // --- spells --------------------------------------------------------------------------------
  a.define('arena_cast', (s) => {
    s.noise({ duration: 0.3, filter: 'bandpass', from: 500, to: 2200, q: 1.5, volume: 0.35 });
    s.tone({ from: 330 * s.pitch, to: 660 * s.pitch, duration: 0.25, volume: 0.12 });
  });
  // A fireball loosed: a roaring whoomp.
  a.define('arena_cast_fire', (s) => {
    s.noise({ duration: 0.38, filter: 'lowpass', from: 400 * s.pitch, to: 2600 * s.pitch, volume: 0.55, attack: 0.04 });
    s.tone({ wave: 'sawtooth', from: 95 * s.pitch, to: 190 * s.pitch, duration: 0.3, volume: 0.18, lowpass: 700 });
  });
  // An ice shard: a crystalline ting.
  a.define('arena_cast_frost', (s) => {
    s.tone({ from: (1568 + Math.random() * 200) * s.pitch, duration: 0.18, volume: 0.1 });
    s.tone({ from: 2350 * s.pitch, duration: 0.12, volume: 0.06, delay: 0.01 });
    s.noise({ duration: 0.07, filter: 'highpass', from: 6000, to: 4000, volume: 0.2 });
  });
  // Lightning: a sharp electric snap.
  a.define('arena_cast_storm', (s) => {
    s.tone({ wave: 'sawtooth', from: 2200 * s.pitch, to: 180 * s.pitch, duration: 0.12, volume: 0.25, drive: 0.6 });
    s.noise({ duration: 0.15, filter: 'highpass', from: 5000, to: 2000, volume: 0.5 });
  });
  a.define('arena_zap', (s) => {
    for (let i = 0; i < 5; i++) s.noise({ duration: 0.025, filter: 'highpass', from: 3000 + Math.random() * 3000, to: 2000, volume: 0.35, delay: i * 0.04 + Math.random() * 0.02 });
    s.tone({ wave: 'sawtooth', from: 900 * s.pitch, to: 120, duration: 0.25, volume: 0.12, drive: 0.5 });
  });
  a.define('arena_fireburst', (s) => {
    s.noise({ duration: 0.6, filter: 'lowpass', from: 3200 * s.pitch, to: 180, volume: 0.8 });
    s.tone({ from: 95 * s.pitch, to: 40, duration: 0.45, volume: 0.6 });
    for (let i = 0; i < 6; i++) s.noise({ duration: 0.03, filter: 'bandpass', from: 2400, to: 1800, q: 3, volume: 0.2, delay: 0.08 + i * 0.06 + Math.random() * 0.04 });
  });
  a.define('arena_ignite', (s) => {
    s.noise({ duration: 0.4, filter: 'bandpass', from: 500 * s.pitch, to: 1600 * s.pitch, q: 1.2, volume: 0.35, attack: 0.06 });
  });
  a.define('arena_freeze', (s) => {
    for (let i = 0; i < 6; i++) s.noise({ duration: 0.03, filter: 'highpass', from: 5000 + Math.random() * 2000, to: 3500, volume: 0.3, delay: i * 0.035 });
    s.tone({ from: 2600 * s.pitch, to: 1900 * s.pitch, duration: 0.35, volume: 0.08 });
    s.tone({ from: 1300 * s.pitch, to: 900 * s.pitch, duration: 0.4, volume: 0.06, fm: { ratio: 2.76, depth: 1 } });
  });
  a.define('arena_shatter', (s) => {
    s.noise({ duration: 0.35, filter: 'highpass', from: 4500, to: 2500, volume: 0.6 });
    for (let i = 0; i < 8; i++) s.tone({ from: (2200 + Math.random() * 2600) * s.pitch, duration: 0.12, volume: 0.06, delay: Math.random() * 0.15 });
    s.tone({ from: 220 * s.pitch, to: 110, duration: 0.12, volume: 0.3 });
  });

  // --- the legendaries' tricks ---------------------------------------------------------------
  a.define('arena_wave', (s) => {
    s.noise({ duration: 0.45, filter: 'bandpass', from: 2400, to: 600, q: 1.4, volume: 0.45 });
    s.tone({ from: 880 * s.pitch, duration: 0.4, volume: 0.08, fm: { ratio: 1.41, depth: 1 } });
  });
  a.define('arena_execute', (s) => {
    s.tone({ wave: 'triangle', from: 160 * s.pitch, to: 40, duration: 0.35, volume: 0.8, drive: 0.4 });
    s.noise({ duration: 0.2, filter: 'bandpass', from: 2400, to: 900, q: 1.5, volume: 0.6 });
  });
  a.define('arena_starfall', (s) => {
    s.tone({ from: 2400 * s.pitch, to: 400 * s.pitch, duration: 0.18, volume: 0.15 });
    s.noise({ duration: 0.7, filter: 'lowpass', from: 2600, to: 120, volume: 0.7, delay: 0.12 });
    s.tone({ from: 80 * s.pitch, to: 30, duration: 0.6, volume: 0.7, delay: 0.12 });
  });

  // --- the forge, loot, armour, potions, blessings -------------------------------------------
  // The anvil's ring, struck twice, then the hiss of the quench.
  a.define('arena_forge', (s) => {
    for (const d of [0, 0.22]) {
      s.tone({ from: 820 * s.pitch, duration: 0.8, volume: 0.22, fm: { ratio: 1.41, depth: 2.2, to: 0.4 }, delay: d });
      s.tone({ from: 1640 * s.pitch, duration: 0.4, volume: 0.08, delay: d });
      s.noise({ duration: 0.03, filter: 'highpass', from: 4000, to: 3000, volume: 0.4, delay: d });
    }
    s.noise({ duration: 0.7, filter: 'highpass', from: 6000, to: 3000, volume: 0.3, delay: 0.5, attack: 0.05 });
  });
  // A legendary: a rising choir-like chord.
  a.define('arena_legendary', (s) => {
    for (const [i, f] of [392, 494, 587, 784].entries()) s.tone({ wave: 'triangle', from: f * s.pitch, duration: 1.4, attack: 0.25 + i * 0.08, hold: 0.4, volume: 0.1, vibrato: { rate: 5, depth: 3 } });
    s.tone({ from: 1568 * s.pitch, duration: 1.2, attack: 0.5, volume: 0.05 });
  });
  a.define('arena_armor', (s) => {
    s.noise({ duration: 0.12, filter: 'lowpass', from: 1500, to: 400, volume: 0.4 });
    for (let i = 0; i < 3; i++) s.tone({ wave: 'triangle', from: (1500 + i * 300) * s.pitch, duration: 0.07, volume: 0.08, delay: 0.05 + i * 0.06 });
  });
  a.define('arena_uncork', (s) => {
    s.tone({ from: 650 * s.pitch, to: 260, duration: 0.05, volume: 0.3 });
    s.noise({ duration: 0.03, filter: 'highpass', from: 3000, to: 2000, volume: 0.25 });
  });
  a.define('arena_gulp', (s) => {
    for (const d of [0, 0.14]) s.tone({ from: 190 * s.pitch, to: 120, duration: 0.1, volume: 0.25, lowpass: 600, delay: d });
  });
  a.define('arena_bless_common', (s) => {
    s.tone({ from: 880 * s.pitch, duration: 0.5, volume: 0.12 });
    s.tone({ from: 1320 * s.pitch, duration: 0.4, volume: 0.07, delay: 0.08 });
  });
  a.define('arena_bless_rare', (s) => {
    for (const [i, f] of [660, 880, 1320].entries()) s.tone({ from: f * s.pitch, duration: 0.6, volume: 0.1, delay: i * 0.08 });
  });
  a.define('arena_bless_epic', (s) => {
    for (const [i, f] of [523, 659, 784, 1046, 1318].entries()) s.tone({ wave: i % 2 ? 'triangle' : 'sine', from: f * s.pitch, duration: 0.9, volume: 0.1, delay: i * 0.07 });
    s.noise({ duration: 0.6, filter: 'bandpass', from: 2000, to: 6000, q: 1, volume: 0.12 });
  });
}
