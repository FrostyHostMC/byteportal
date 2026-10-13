import type { SynthKit } from '@platform';
import type { Client } from '@platform/client';
import { blaster, chirp, vent } from '../../client/sounds';

/**
 * The heroes' sounds, synthesised on each screen (`client.audio.define`; the server plays them by
 * name): a saber's hum (a loop each blade keeps, its pitch and loudness rising as it's swung:
 * `fx.ts`), its ignition, swings, cuts, clashes and deflections; the Force's push and pull, a
 * choke, lightning's crackle, the aura and the rage; the thrown saber's whirl; a leap and its
 * landing; the bowcaster and its bursting quarrels, a Wookiee's roar and charge; a wrist rocket,
 * a flamethrower, a jetpack. All made here from oscillators and noise.
 */

const rnd = (a: number, b: number) => a + Math.random() * (b - a);

/** A blade's hum (`bfh_hum`, the red blades' own): its pitch and loudness by how fast its tip is moving (blocks a second). */
export function humOf(hero: string, speed: number): { voice: string; pitch: number; volume: number } {
  const k = Math.min(1, speed / 16);
  const dark = hero === 'vader' || hero === 'emperor';
  return { voice: dark ? 'bfh_hum_dark' : 'bfh_hum', pitch: 1 + 0.38 * k * k, volume: (dark ? 0.7 : 1) * (0.18 + 0.72 * k) };
}

/** The saber's buzz: two detuned saws beating, low-passed (an FM edge on the first). */
function buzz(s: SynthKit, o: { from: number; to?: number; glide?: [number, number][]; duration: number; volume: number; delay?: number; attack?: number; hold?: number; cutoff?: number; drive?: number }) {
  const p = s.pitch;
  const glide = (k: number) => o.glide?.map(([t, f]) => [t, f * k * p] as [number, number]);
  const lowpass = o.cutoff ?? 700;
  s.tone({ wave: 'sawtooth', from: o.from * p, to: (o.to ?? o.from) * p, glide: glide(1), duration: o.duration, volume: o.volume, delay: o.delay, attack: o.attack, hold: o.hold, lowpass, drive: o.drive, fm: { ratio: 2, depth: 0.1 } });
  s.tone({ wave: 'sawtooth', from: o.from * 1.018 * p, to: (o.to ?? o.from) * 1.018 * p, glide: glide(1.018), duration: o.duration, volume: o.volume * 0.8, delay: o.delay, attack: o.attack, hold: o.hold, lowpass });
}

/**
 * A Wookiee's roar (made here, from nothing recorded): a throat's buzz climbing and falling, heard
 * through the formants of an open mouth (three bands, opening as it goes), gargling (a fast
 * vibrato), rasping (driven), a growl an octave down and breath over it. `len` long, `loud` loud.
 */
function roar(s: SynthKit, len: number, loud: number) {
  const p = s.pitch * rnd(0.95, 1.05);
  const k = len / 1.3;
  const contour = (m: number): [number, number][] => [
    [0.15 * k, 420 * m * p],
    [0.5 * k, 540 * m * p],
    [1.0 * k, 360 * m * p],
    [1.3 * k, 250 * m * p],
  ];
  const hold = Math.max(0.05, len - 0.6);
  for (const [f, v, q] of [
    [850, 0.15, 4],
    [1450, 0.12, 5],
    [2800, 0.05, 6],
  ] as const)
    s.tone({ wave: 'sawtooth', from: 230 * p, glide: contour(1), duration: 0.45, attack: 0.1, hold, volume: v * loud, bandpass: { freq: f, to: f * 1.15, q }, vibrato: { rate: 26, depth: 14 }, drive: 0.35 });
  s.tone({ wave: 'square', from: 115 * p, glide: contour(0.5), duration: 0.45, attack: 0.1, hold, volume: 0.03 * loud, lowpass: 600, vibrato: { rate: 26, depth: 7 }, drive: 0.5 });
  s.noise({ duration: 0.4, attack: 0.1, hold, filter: 'bandpass', from: 1600, to: 1100, q: 1.2, volume: 0.08 * loud });
}

/** Electricity: a buzzing arc (a hard-driven saw through a band) and cracks of it snapping. */
function arc(s: SynthKit, o: { len: number; loud: number; cracks: number }) {
  const p = s.pitch;
  s.tone({ wave: 'sawtooth', from: rnd(70, 130) * p, glide: [[o.len * 0.5, rnd(60, 150) * p], [o.len, rnd(60, 120) * p]], duration: o.len, attack: 0.004, volume: 0.13 * o.loud, drive: 0.9, bandpass: { freq: rnd(1800, 3200), q: 0.9 } });
  for (let i = 0; i < o.cracks; i++) {
    const at = Math.random() * o.len;
    s.noise({ duration: rnd(0.008, 0.03), delay: at, filter: 'highpass', from: rnd(2500, 6000), to: 1800, volume: rnd(0.12, 0.26) * o.loud });
    if (Math.random() < 0.4) s.tone({ wave: 'sine', from: rnd(2500, 4000) * p, glide: [[0.025, rnd(600, 900) * p]], duration: 0.025, delay: at, attack: 0.001, volume: 0.07 * o.loud });
  }
}

export function defineHeroSounds(client: Client) {
  const a = client.audio;

  // ---- The hum: each blade's own loop (fx.ts sets its pitch and loudness by how fast it moves) ----
  a.defineLoop('bfh_hum', (l) => {
    // The projector's motor hum, two buzzing saws beating slowly against it, an electric edge.
    l.tone({ wave: 'sawtooth', freq: 92, volume: 0.07, lowpass: 520 });
    l.tone({ wave: 'sawtooth', freq: 92.8, volume: 0.06, lowpass: 560 });
    l.tone({ wave: 'sine', freq: 184, volume: 0.04, fm: { ratio: 2, depth: 0.2 } });
    l.tone({ wave: 'sine', freq: 46, volume: 0.035 });
    l.tone({ wave: 'sawtooth', freq: 92.4, volume: 0.013, bandpass: { freq: 2300, q: 3 } });
    l.noise({ freq: 1300, q: 0.8, volume: 0.004 });
  });
  a.defineLoop('bfh_hum_dark', (l) => {
    // The red blades: lower, grittier, a growl in it.
    l.tone({ wave: 'sawtooth', freq: 78, volume: 0.07, lowpass: 480, drive: 0.35 });
    l.tone({ wave: 'sawtooth', freq: 78.9, volume: 0.06, lowpass: 520 });
    l.tone({ wave: 'sine', freq: 156, volume: 0.038, fm: { ratio: 0.5, depth: 0.25 } });
    l.tone({ wave: 'sine', freq: 39, volume: 0.038 });
    l.tone({ wave: 'sawtooth', freq: 78.4, volume: 0.015, bandpass: { freq: 1900, q: 3 }, drive: 0.5 });
    l.noise({ freq: 1100, q: 0.8, volume: 0.005 });
  });

  a.define('bfh_saber_ignite', (s) => {
    // A snap, then the blade roaring up to its hum.
    s.noise({ duration: 0.04, filter: 'highpass', from: 3000, to: 1500, volume: 0.15 });
    buzz(s, { from: 40, glide: [[0.2, 118], [0.45, 95]], duration: 0.5, hold: 0.15, attack: 0.02, volume: 0.085, cutoff: 1700 });
    s.noise({ duration: 0.28, attack: 0.03, filter: 'bandpass', from: 700, to: 3400, q: 1.4, volume: 0.1 });
    s.tone({ wave: 'sine', from: 80 * s.pitch, glide: [[0.2, 236 * s.pitch], [0.45, 184 * s.pitch]], duration: 0.4, attack: 0.03, hold: 0.1, volume: 0.05, fm: { ratio: 2, depth: 1.2, to: 0.2 } });
  });
  a.define('bfh_saber_swing', (s) => {
    // The hum swept past: rising and louder as the blade comes round, falling away after.
    const p = s.pitch;
    const k = rnd(0.95, 1.05);
    buzz(s, { from: 92 * k, glide: [[0.1, 150 * k], [0.32, 82 * k]], duration: 0.24, attack: 0.08, volume: 0.102, cutoff: 1300 });
    s.tone({ wave: 'sine', from: 184 * k * p, glide: [[0.1, 300 * k * p], [0.32, 164 * k * p]], duration: 0.24, attack: 0.08, volume: 0.06 });
    s.noise({ duration: 0.2, attack: 0.09, filter: 'bandpass', from: 500, to: 1700, q: 1.8, volume: 0.102 });
  });
  a.define('bfh_saber_hit', (s) => {
    // A blade through someone: a sizzling cut and a burn, the buzz catching.
    const p = s.pitch;
    s.noise({ duration: 0.3, hold: 0.04, filter: 'highpass', from: 3000, to: 1200, volume: 0.21 });
    s.noise({ duration: 0.4, attack: 0.02, filter: 'bandpass', from: 4400, to: 2600, q: 2, volume: 0.105 });
    s.tone({ wave: 'sine', from: 140 * p, to: 55, duration: 0.12, attack: 0.002, volume: 0.245 });
    buzz(s, { from: 140, to: 90, duration: 0.32, volume: 0.07, cutoff: 1500, drive: 0.6 });
  });
  a.define('bfh_saber_clash', (s) => {
    // Blades meeting: a crackling burst, a ring of metal in it, the buzz spitting.
    const p = s.pitch;
    s.noise({ duration: 0.2, filter: 'highpass', from: 1800, to: 700, volume: 0.45 });
    s.noise({ duration: 0.45, attack: 0.01, filter: 'bandpass', from: 5200, to: 3200, q: 1.6, volume: 0.15 });
    s.tone({ wave: 'sine', from: 740 * p, duration: 0.55, attack: 0.002, volume: 0.13, fm: { ratio: 1.41, depth: 2.2, to: 0.15 } });
    s.tone({ wave: 'sine', from: 1190 * p, duration: 0.4, attack: 0.002, volume: 0.08, fm: { ratio: 2.76, depth: 1.5, to: 0.1 } });
    s.tone({ wave: 'sawtooth', from: 105 * p, to: 70 * p, duration: 0.4, volume: 0.13, drive: 0.8, bandpass: { freq: 1500, q: 0.8 } });
    arc(s, { len: 0.18, loud: 0.8, cracks: 5 });
  });
  a.define('bfh_saber_deflect', (s) => {
    // A bolt turned: a ricochet's whine, the blade spitting.
    const p = s.pitch;
    s.noise({ duration: 0.03, filter: 'highpass', from: 4500, to: 3000, volume: 0.3 });
    s.tone({ wave: 'sine', from: 1300 * p, glide: [[0.02, 3400 * p], [0.16, 700 * p]], duration: 0.16, attack: 0.002, volume: 0.17, fm: { ratio: 2.41, depth: 0.7, to: 0.05 } });
    buzz(s, { from: 150, to: 110, duration: 0.16, volume: 0.1, cutoff: 1600 });
  });
  a.define('bfh_guard_break', (s) => {
    // A guard battered down: a heavy clash, a boom under it, the buzz sagging.
    s.noise({ duration: 0.45, filter: 'lowpass', from: 2600, to: 280, volume: 0.315 });
    s.tone({ wave: 'sine', from: 120 * s.pitch, to: 40, duration: 0.5, attack: 0.003, volume: 0.28 });
    s.tone({ wave: 'sine', from: 620 * s.pitch, duration: 0.5, attack: 0.002, volume: 0.07, fm: { ratio: 1.41, depth: 2, to: 0.1 } });
    buzz(s, { from: 150, to: 55, duration: 0.5, volume: 0.098, cutoff: 1100, drive: 0.5 });
  });

  // ---- The Force ----
  a.define('bfh_force_push', (s) => {
    // A wall of air shoved out: a deep whump, a rush rolling away.
    const p = s.pitch;
    s.tone({ wave: 'sine', from: 180 * p, glide: [[0.06, 90 * p], [0.5, 34 * p]], duration: 0.5, attack: 0.012, volume: 0.44 });
    s.noise({ duration: 0.55, attack: 0.02, filter: 'lowpass', from: 1500, to: 140, volume: 0.44 });
    s.noise({ duration: 0.45, attack: 0.04, delay: 0.02, filter: 'bandpass', from: 1300, to: 260, q: 1, volume: 0.176 });
    s.tone({ wave: 'sine', from: 55 * p, duration: 0.7, attack: 0.03, volume: 0.2 });
  });
  a.define('bfh_force_pull', (s) => {
    // Air drawn in, swelling, and the thump of it arriving.
    const p = s.pitch;
    s.noise({ duration: 0.06, attack: 0.36, filter: 'bandpass', from: 240, to: 1700, q: 1.3, volume: 0.0866 });
    s.tone({ wave: 'sine', from: 45 * p, to: 150 * p, duration: 0.06, attack: 0.36, volume: 0.0619 });
    s.tone({ wave: 'sine', from: 110 * p, to: 40, duration: 0.25, delay: 0.4, attack: 0.004, volume: 0.1114 });
    s.noise({ duration: 0.2, delay: 0.4, filter: 'lowpass', from: 900, to: 150, volume: 0.0743 });
  });
  a.define('bfh_force_stance', (s) => {
    // A calm taking hold: a shimmering fifth over the hum.
    const p = s.pitch;
    s.tone({ wave: 'triangle', from: 660 * p, duration: 0.5, attack: 0.15, hold: 0.25, volume: 0.0405, vibrato: { rate: 7, depth: 10 } });
    s.tone({ wave: 'triangle', from: 990 * p, duration: 0.5, attack: 0.2, hold: 0.2, delay: 0.05, volume: 0.027, vibrato: { rate: 6, depth: 14 } });
    s.tone({ wave: 'sine', from: 1320 * p, duration: 0.5, attack: 0.25, hold: 0.1, delay: 0.1, volume: 0.0135, fm: { ratio: 2, depth: 0.3 } });
    buzz(s, { from: 110, duration: 0.5, attack: 0.1, hold: 0.2, volume: 0.0315 });
  });
  a.define('bfh_saber_throw', (s) => {
    s.tone({ wave: 'sawtooth', from: 130 * s.pitch, to: 240 * s.pitch, duration: 0.4, attack: 0.04, volume: 0.18, lowpass: 1200, vibrato: { rate: 16, depth: 40 } });
    s.noise({ duration: 0.3, attack: 0.05, filter: 'bandpass', from: 600, to: 1800, q: 2, volume: 0.18 });
  });
  a.define('bfh_saber_spin', (s) => {
    s.tone({ wave: 'sawtooth', from: 170 * s.pitch, to: 120 * s.pitch, duration: 0.16, volume: 0.12, lowpass: 900 });
    s.noise({ duration: 0.12, filter: 'bandpass', from: 1400, to: 700, q: 2, volume: 0.08 });
  });
  a.define('bfh_saber_catch', (s) => {
    s.noise({ duration: 0.05, filter: 'highpass', from: 2600, to: 1500, volume: 0.25 });
    s.tone({ wave: 'sine', from: 120 * s.pitch, to: 60, duration: 0.1, attack: 0.002, volume: 0.25 });
    buzz(s, { from: 120, to: 92, duration: 0.3, volume: 0.1 });
  });
  a.define('bfh_force_choke', (s) => {
    // A grip closing: a low pressure, a strangled rasp catching, a thin tension over it.
    s.tone({ wave: 'sine', from: 58 * s.pitch, to: 46 * s.pitch, duration: 0.6, attack: 0.1, hold: 0.5, volume: 0.16 });
    for (let i = 0; i < 5; i++) s.noise({ duration: 0.13, attack: 0.03, filter: 'bandpass', from: 1150 - i * 70, to: 800, q: 8, volume: 0.075, delay: 0.1 + i * 0.23 });
    s.tone({ wave: 'sine', from: 1480 * s.pitch, duration: 0.5, attack: 0.3, hold: 0.4, volume: 0.0125, vibrato: { rate: 9, depth: 18 } });
  });
  a.define('bfh_force_rage', (s) => {
    buzz(s, { from: 72, to: 50, duration: 0.6, attack: 0.08, hold: 0.3, volume: 0.06, cutoff: 700, drive: 0.5 });
    s.noise({ duration: 0.7, attack: 0.05, filter: 'lowpass', from: 900, to: 160, volume: 0.075 });
    s.tone({ wave: 'sine', from: 50 * s.pitch, duration: 0.6, attack: 0.08, hold: 0.2, volume: 0.075 });
  });
  a.define('bfh_crackle', (s) => arc(s, { len: 0.14, loud: 1.4, cracks: 5 }));
  a.define('bfh_lightning_chain', (s) => {
    // Lightning leaping on: a snap like thunder close by, and the arc spitting.
    s.noise({ duration: 0.05, filter: 'highpass', from: 3000, to: 1500, volume: 0.4 });
    s.tone({ wave: 'square', from: 1100 * s.pitch, to: 110 * s.pitch, duration: 0.3, volume: 0.12, lowpass: 4000, drive: 0.5 });
    s.noise({ duration: 0.5, delay: 0.02, attack: 0.01, filter: 'lowpass', from: 1400, to: 120, volume: 0.3 });
    arc(s, { len: 0.3, loud: 1.1, cracks: 8 });
  });
  a.define('bfh_dark_aura', (s) => {
    // Darkness drawing in: a deep gritty drone, a falling moan, the air rumbling.
    buzz(s, { from: 55, duration: 0.8, attack: 0.3, hold: 0.5, volume: 0.0525, cutoff: 420, drive: 0.3 });
    s.tone({ wave: 'sine', from: 220 * s.pitch, to: 105 * s.pitch, duration: 0.9, attack: 0.2, hold: 0.3, volume: 0.042, vibrato: { rate: 3, depth: 6 } });
    s.noise({ duration: 0.9, attack: 0.3, hold: 0.3, filter: 'bandpass', from: 300, to: 120, q: 2, volume: 0.0525 });
  });
  a.define('bfh_saber_rush', (s) => {
    s.noise({ duration: 0.3, attack: 0.05, filter: 'bandpass', from: 600, to: 2400, q: 1.5, volume: 0.35 });
    buzz(s, { from: 110, glide: [[0.12, 220], [0.36, 140]], duration: 0.3, attack: 0.05, volume: 0.16, cutoff: 1500 });
  });
  a.define('bfh_force_leap', (s) => {
    s.noise({ duration: 0.35, attack: 0.08, filter: 'bandpass', from: 400, to: 1900, q: 1.2, volume: 0.18 });
    s.tone({ wave: 'sine', from: 170 * s.pitch, to: 480 * s.pitch, duration: 0.4, attack: 0.06, volume: 0.072 });
  });
  a.define('bfh_force_land', (s) => {
    // Coming down on the ground: a slam, the ground shaking, grit and stones thrown.
    s.noise({ duration: 0.04, filter: 'highpass', from: 2500, to: 1200, volume: 0.245 });
    s.tone({ wave: 'sine', from: 95 * s.pitch, to: 28 * s.pitch, duration: 0.8, attack: 0.004, volume: 0.455 });
    s.noise({ duration: 0.9, attack: 0.01, filter: 'lowpass', from: 900, to: 60, volume: 0.42 });
    for (let i = 0; i < 5; i++) s.noise({ duration: 0.015, delay: rnd(0.05, 0.4), filter: 'highpass', from: 3000, to: 2500, volume: rnd(0.05, 0.12) });
    buzz(s, { from: 100, to: 60, duration: 0.4, volume: 0.07 });
  });
  a.define('bfh_force_jump', (s) => {
    s.noise({ duration: 0.18, attack: 0.04, filter: 'bandpass', from: 500, to: 1300, q: 1.5, volume: 0.108 });
  });

  // ---- Chewblocca's ----
  a.define('bfh_bowcaster', (s) => {
    // The bowcaster: the limbs' twang, a heavy bolt leaving (a blaster's chirp, low and long), a boom under it.
    const p = s.pitch;
    s.tone({ wave: 'triangle', from: 430 * p, glide: [[0.02, 300 * p], [0.25, 175 * p]], duration: 0.25, attack: 0.001, volume: 0.0975, fm: { ratio: 1.5, depth: 0.8, to: 0.05 } });
    blaster(s, { top: 2600, bottom: 115, fall: 0.26, echoes: 2, gap: 0.05, metal: 0.7, grit: 0.4, thump: 1.2, snap: 1.1, loud: 0.75 });
    s.noise({ duration: 0.015, filter: 'highpass', from: 3200, to: 2400, volume: 0.1875 });
    s.tone({ wave: 'sine', from: 90 * p, to: 34, duration: 0.4, attack: 0.003, volume: 0.2625 });
    s.noise({ duration: 0.35, attack: 0.005, filter: 'lowpass', from: 1500, to: 150, volume: 0.15 });
  });
  a.define('bfh_quarrel', (s) => {
    // A quarrel bursting: a crack, the energy's zing, a thump, the blast rolling off, a sizzle, grit.
    const p = s.pitch;
    s.noise({ duration: 0.05, filter: 'highpass', from: 2500, to: 1000, volume: 0.4 });
    s.tone({ wave: 'sine', from: 3200 * p, glide: chirp(3200 * p, 420 * p, 0.2, 5), duration: 0.2, attack: 0.001, volume: 0.13, fm: { ratio: 2.41, depth: 1.2, to: 0.05 } });
    s.tone({ wave: 'sine', from: 110 * p, to: 36, duration: 0.35, attack: 0.002, volume: 0.45 });
    s.noise({ duration: 0.45, attack: 0.005, filter: 'lowpass', from: 2200, to: 150, volume: 0.3 });
    s.noise({ duration: 0.4, attack: 0.02, delay: 0.02, filter: 'bandpass', from: 5000, to: 3000, q: 2, volume: 0.09 });
    for (let i = 0; i < 4; i++) s.noise({ duration: 0.014, delay: rnd(0.04, 0.25), filter: 'highpass', from: 3500, to: 2800, volume: rnd(0.05, 0.1) });
  });
  a.define('bfh_roar', (s) => roar(s, 1.3, 0.6));
  a.define('bfh_charge', (s) => {
    // A charge: heavy strides, a growl rising, the air pushed aside.
    const p = s.pitch;
    for (let i = 0; i < 4; i++) {
      s.tone({ wave: 'sine', from: 82 * p, to: 38, duration: 0.14, delay: i * 0.17, attack: 0.003, volume: 0.36 });
      s.noise({ duration: 0.1, delay: i * 0.17, filter: 'lowpass', from: 800, to: 150, volume: 0.18 });
    }
    roar(s, 0.6, 0.5);
    s.noise({ duration: 0.3, attack: 0.25, filter: 'bandpass', from: 400, to: 1400, q: 1.2, volume: 0.1 });
  });
  a.define('bfh_knock', (s) => {
    // Someone bowled over: the hit, and their fall a moment later.
    const p = s.pitch;
    s.noise({ duration: 0.03, filter: 'highpass', from: 2000, to: 900, volume: 0.1344 });
    s.tone({ wave: 'sine', from: 120 * p, to: 40, duration: 0.25, attack: 0.002, volume: 0.216 });
    s.noise({ duration: 0.3, filter: 'lowpass', from: 900, to: 100, volume: 0.144 });
    s.tone({ wave: 'sine', from: 72 * p, to: 34, duration: 0.16, delay: 0.2, attack: 0.003, volume: 0.1344 });
    s.noise({ duration: 0.18, delay: 0.2, filter: 'lowpass', from: 600, to: 90, volume: 0.096 });
  });
  a.define('bowcaster_recock', (s) => {
    // Recocking: the string creaking back over a ratchet's clicks, then the heavy clack of it set, and it hums, charged.
    const len = 1.9;
    s.tone({ wave: 'sawtooth', from: 95, to: 150, duration: 0.25, attack: 0.3, hold: 0.45, delay: 0.1, volume: 0.0624, bandpass: { freq: 900, q: 6 }, vibrato: { rate: 30, depth: 4 } });
    for (let i = 0; i < 7; i++) {
      s.noise({ duration: 0.012, delay: 0.2 + i * 0.12, filter: 'bandpass', from: 3000, to: 2600, q: 5, volume: 0.2912 });
      s.tone({ wave: 'square', from: 1500 - i * 40, duration: 0.012, delay: 0.2 + i * 0.12, attack: 0.001, volume: 0.0624, lowpass: 3500 });
    }
    s.noise({ duration: 0.04, delay: len - 0.14, filter: 'bandpass', from: 1500, to: 1100, q: 4, volume: 0.624 });
    s.tone({ wave: 'sine', from: 190, to: 80, duration: 0.08, delay: len - 0.14, attack: 0.002, volume: 0.4576 });
    s.tone({ wave: 'sine', from: 220, glide: [[0.2, 440]], duration: 0.2, delay: len - 0.1, attack: 0.05, volume: 0.104, fm: { ratio: 2, depth: 0.3 } });
  });

  // ---- Boba Fetch's ----
  a.define('blaster_ee3', (s) => blaster(s, { top: 3700, bottom: 260, fall: 0.12, echoes: 1, gap: 0.03, metal: 0.5, grit: 0.45, thump: 0.5, snap: 1, loud: 0.8 }));
  a.define('vent_ee3', (s) => vent(s, 1.5));
  a.define('bfh_rocket', (s) => {
    // A rocket off his wrist: a pop, the motor catching with a hiss, a whistle screaming away.
    const p = s.pitch;
    s.noise({ duration: 0.06, filter: 'bandpass', from: 900, to: 400, q: 1, volume: 0.108 });
    s.tone({ wave: 'sine', from: 150 * p, to: 60, duration: 0.12, attack: 0.002, volume: 0.0945 });
    s.noise({ duration: 0.5, attack: 0.05, hold: 0.2, delay: 0.03, filter: 'bandpass', from: 1500, to: 3800, q: 1.3, volume: 0.054 });
    s.tone({ wave: 'sine', from: 700 * p, glide: [[0.15, 1300 * p], [0.8, 880 * p]], duration: 0.5, attack: 0.05, hold: 0.2, delay: 0.03, volume: 0.0108, fm: { ratio: 2, depth: 0.1 } });
    s.tone({ wave: 'sawtooth', from: 60 * p, to: 90 * p, duration: 0.4, attack: 0.03, hold: 0.2, delay: 0.03, volume: 0.0189, lowpass: 400, drive: 0.4 });
  });
  a.defineLoop('bfh_flame', (l) => {
    // The flamethrower burning: a roar of fuel, the gas hissing, a low whump in it.
    l.noise({ freq: 700, filter: 'lowpass', q: 0.7, volume: 0.15 });
    l.noise({ freq: 1800, q: 0.9, volume: 0.048 });
    l.noise({ freq: 240, q: 1.2, volume: 0.105 });
    l.tone({ wave: 'sawtooth', freq: 42, volume: 0.015, lowpass: 180, drive: 0.4, vibrato: { rate: 11, depth: 6 } });
  });
  a.define('bfh_flame_crackle', (s) => {
    // Fuel spitting in the flame.
    for (let i = 0; i < 3; i++) s.noise({ duration: rnd(0.008, 0.02), delay: rnd(0, 0.08), filter: 'highpass', from: rnd(2500, 4500), to: 2000, volume: rnd(0.08, 0.16) });
    s.noise({ duration: 0.05, filter: 'lowpass', from: 600, to: 200, volume: 0.06 });
  });
  a.define('bfh_flame', (s) => {
    // (A burst of it, for anything playing one.)
    s.noise({ duration: 0.3, attack: 0.05, filter: 'lowpass', from: 1200, to: 700, volume: 0.28 });
    s.noise({ duration: 0.3, attack: 0.05, filter: 'bandpass', from: 300, to: 240, q: 1.2, volume: 0.2 });
  });
  a.define('bfh_jet', (s) => {
    // The jetpack lighting: the igniter's clack, a whump, the roar swelling.
    const p = s.pitch;
    s.noise({ duration: 0.02, filter: 'bandpass', from: 2500, to: 2000, q: 4, volume: 0.098 });
    s.noise({ duration: 0.25, delay: 0.03, filter: 'lowpass', from: 1200, to: 200, volume: 0.2205 });
    s.tone({ wave: 'sine', from: 110 * p, to: 45, duration: 0.3, delay: 0.03, attack: 0.003, volume: 0.196 });
    s.noise({ duration: 0.4, attack: 0.12, delay: 0.03, filter: 'bandpass', from: 300, to: 1400, q: 1, volume: 0.1225 });
  });
  a.defineLoop('bfh_jet_burn', (l) => {
    // The jetpack burning: the thrust's roar, its hiss, a rumble beating under it.
    l.noise({ freq: 900, filter: 'lowpass', q: 0.7, volume: 0.0938 });
    l.noise({ freq: 2600, q: 1.2, volume: 0.0225 });
    l.noise({ freq: 180, q: 1, volume: 0.0562 });
    l.tone({ wave: 'sawtooth', freq: 55, volume: 0.0188, lowpass: 300, drive: 0.5 });
    l.tone({ wave: 'sawtooth', freq: 55.7, volume: 0.0131, lowpass: 300 });
  });
  a.define('bfh_jet_loop', (s) => {
    // (A burst of it, for anything playing one.)
    s.noise({ duration: 0.3, attack: 0.05, filter: 'lowpass', from: 1000, to: 800, volume: 0.2 });
    s.tone({ wave: 'sawtooth', from: 55 * s.pitch, duration: 0.3, attack: 0.05, volume: 0.06, lowpass: 300, drive: 0.5 });
  });
  a.define('bfh_hero_ready', (s) => {
    // A hero with a blaster ready: a bolt racked back and home, heavy and metal, and it powering up.
    for (const [at, f, v] of [
      [0, 900, 0.25],
      [0.13, 1250, 0.3],
    ] as const) {
      s.noise({ duration: 0.03, delay: at, filter: 'bandpass', from: 2200, to: 1600, q: 3, volume: v });
      s.tone({ wave: 'sine', from: f * s.pitch, duration: 0.09, delay: at, attack: 0.001, volume: 0.091, fm: { ratio: 1.41, depth: 1, to: 0.05 } });
    }
    s.tone({ wave: 'sine', from: 300, glide: [[0.35, 1400]], duration: 0.12, attack: 0.35, delay: 0.15, volume: 0.052, fm: { ratio: 2, depth: 0.2 } });
  });
}
