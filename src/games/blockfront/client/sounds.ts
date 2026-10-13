import type { SynthKit } from '@platform';
import type { Client } from '@platform/client';

/**
 * Blockfront's sounds, synthesised on each screen (`client.audio.define`), all our own:
 *
 * - **Blasters** (`blaster_<kind>_<side>`, each blaster's look names its own): a bolt leaving is a
 *   chirp falling fast then slower, as a struck steel cable rings, with its echoes running after
 *   it (each longer and fainter), a snap, a metallic sheen and a thump. The Rebels' brighter and
 *   ringing, the Empire's lower and grittier; the rifle, the heavy repeater (short, it fires fast),
 *   the cycler (a crack and a boom) and the pistol each their own. Venting (`vent_<kind>`, as long
 *   as that blaster's vent), the dry click of an overheated trigger (`overheat`) and the alarm as
 *   it overheats (`blaster_overheat`).
 * - **Bolts** (the bolts kit plays them where they land): a crack, a zap and a sizzle on a wall
 *   (`bolt_hit`), a thud and a burn on someone (`bolt_burn`), and one going by (`bolt_whizz`).
 * - **The detonator**: arming beeps quickening, the toss, a clink off the ground, its zing going off.
 * - **UI**: a post gained and lost, a hero ready, low reinforcements, deploying, a heartbeat at
 *   low health; the match's opening and victory / defeat stingers (short brass fanfares).
 * - **Ambience** (`client/ambience.ts` plays them): the wind (a loop, gusting), a firefight far off
 *   (real blaster fire, far enough to be mostly its echo), a blast now and then.
 * - **The sky** (`skies.ts` plays them as starfighters pass over): the eye fighters' scream, the
 *   wing fighters' roar, their cannons far off.
 *
 * The world's acoustics are set here too: far sounds muffle, and everything rings a little off the
 * spaceport's walls (a reverb); the HUD's own sounds stay dry.
 */

/** A note's frequency, `n` semitones from A4. */
const note = (n: number) => 440 * 2 ** (n / 12);
const rnd = (a: number, b: number) => a + Math.random() * (b - a);

/**
 * A falling chirp's path: from `top` to `bottom` Hz over `fall` seconds, fast at first then slower,
 * as a wave in a struck wire spreads (the high part arrives first): f = top / (1 + t/τ)².
 */
export function chirp(top: number, bottom: number, fall: number, points = 7): [number, number][] {
  const k = Math.sqrt(top / bottom) - 1;
  const out: [number, number][] = [];
  for (let i = 1; i <= points; i++) {
    const t = fall * (i / points) ** 1.4;
    out.push([t, top / (1 + (k * t) / fall) ** 2]);
  }
  return out;
}

/** How a blaster sounds (see `blaster`). */
export interface Shot {
  /** The chirp: where it starts and ends (Hz) and how long it takes to fall (seconds). */
  top: number;
  bottom: number;
  fall: number;
  /** Echoes chasing it (how many, how far apart). */
  echoes: number;
  gap: number;
  /** A metallic ring over it (FM depth), grit (drive), a thump under it, the snap at the muzzle (0..1). */
  metal: number;
  grit: number;
  thump: number;
  snap: number;
  loud: number;
}

/**
 * A blaster shot: the chirp (a sine with a touch of FM, an inharmonic partial for the ring and one
 * an octave down for body), the echoes after it, a snap of noise and a thump. Each shot differs a
 * little (the wire never rings the same twice).
 */
export function blaster(s: SynthKit, o: Shot) {
  const p = s.pitch * rnd(0.97, 1.03);
  const v = o.loud * 0.72;
  const ring = (delay: number, stretch: number, vol: number) => {
    const fall = o.fall * stretch;
    const top = o.top * p * (stretch > 1 ? 0.8 : 1);
    const bottom = o.bottom * p;
    const attack = delay ? 0.006 : 0.002;
    s.tone({ wave: 'sine', from: top, glide: chirp(top, bottom, fall), duration: fall, delay, attack, volume: 0.36 * vol * v, fm: { ratio: 2, depth: 0.3, to: 0.05 }, drive: o.grit });
    s.tone({ wave: 'sine', from: top * 1.52, glide: chirp(top * 1.52, bottom * 1.52, fall * 0.8), duration: fall * 0.8, delay: delay + 0.001, attack, volume: 0.12 * vol * v * (0.5 + o.metal), fm: { ratio: 2.41, depth: o.metal, to: 0.1 } });
    // (The body only under the shot itself: the echoes are thin.)
    if (!delay) s.tone({ wave: 'triangle', from: top * 0.5, glide: chirp(top * 0.5, bottom * 0.5, fall * 1.2), duration: fall * 1.2, attack: attack + 0.001, volume: 0.2 * vol * v, lowpass: 2200 });
  };
  ring(0, 1, 1);
  for (let i = 1; i <= o.echoes; i++) ring(o.gap * i * rnd(0.9, 1.1), 1 + 0.45 * i, 0.42 ** i);
  s.noise({ duration: 0.018, filter: 'highpass', from: 5200 * p, to: 3000, volume: 0.32 * o.snap * v });
  s.noise({ duration: 0.05, filter: 'bandpass', from: 2400 * p, to: 900, q: 1.4, volume: 0.22 * o.snap * v });
  if (o.thump) s.tone({ wave: 'sine', from: 170 * p, to: 55, duration: 0.09, attack: 0.002, volume: 0.5 * o.thump * v });
}

/** A brass section's note: detuned saws through a lowpass that opens as it's blown, a triangle an octave under; `len` held. */
function brass(s: SynthKit, freq: number, at: number, len: number, loud = 1, bright = 2000) {
  const v = 0.052 * loud;
  const hold = Math.max(0, len - 0.35);
  const vib = len > 0.7 ? { rate: 5.2, depth: freq * 0.005 } : undefined;
  for (const [d, w] of [
    [1, 1],
    [1.005, 0.8],
    [0.996, 0.7],
  ] as const)
    s.tone({ wave: 'sawtooth', from: freq * d, duration: 0.32, hold, delay: at, attack: 0.05, volume: v * w, lowpass: { freq: bright * 0.25, to: bright, time: 0.09, q: 1.5 }, vibrato: vib });
  s.tone({ wave: 'triangle', from: freq / 2, duration: 0.3, hold, delay: at, attack: 0.04, volume: v * 1.3 });
}

/** A timpani: a low sine that thuds in a little sharp and settles, a skin of noise, a long ring. */
function drum(s: SynthKit, freq: number, at: number, loud = 1) {
  s.tone({ wave: 'sine', from: freq * 1.3, glide: [[0.06, freq]], duration: 1.1, delay: at, attack: 0.004, volume: 0.5 * loud });
  s.tone({ wave: 'sine', from: freq * 1.5 * 1.2, glide: [[0.06, freq * 1.5]], duration: 0.5, delay: at, attack: 0.004, volume: 0.14 * loud });
  s.noise({ duration: 0.22, delay: at, filter: 'lowpass', from: 900, to: 120, volume: 0.22 * loud });
}

/** A cymbal: a swell (`swell` seconds) or a crash. */
function cymbal(s: SynthKit, at: number, loud = 1, swell = 0) {
  s.noise({ duration: 1.4, delay: at, attack: swell || 0.003, filter: 'highpass', from: 5200, to: 3800, volume: 0.09 * loud });
  s.noise({ duration: 0.9, delay: at, attack: swell || 0.003, filter: 'bandpass', from: 7400, to: 6000, q: 1.2, volume: 0.06 * loud });
}

/** A vent: a clack as it opens, steam hissing out for `len` seconds, a clunk and a rising tick as it's cool. */
export function vent(s: SynthKit, len: number) {
  s.noise({ duration: 0.04, filter: 'bandpass', from: 1800, to: 1300, q: 4, volume: 0.25 });
  s.tone({ wave: 'sine', from: 200, to: 90, duration: 0.07, volume: 0.18 });
  s.noise({ duration: len * 0.6, attack: 0.03, hold: len * 0.25, delay: 0.03, filter: 'highpass', from: 5200, to: 2600, volume: 0.05 });
  s.noise({ duration: len * 0.5, attack: 0.05, delay: 0.03, filter: 'bandpass', from: 2400, to: 900, q: 1.5, volume: 0.03 });
  s.tone({ wave: 'sine', from: 1400, to: 300, duration: len * 0.8, delay: 0.05, volume: 0.035 });
  s.noise({ duration: 0.03, delay: len - 0.12, filter: 'bandpass', from: 1500, to: 1100, q: 4, volume: 0.26 });
  s.tone({ wave: 'triangle', from: 620, glide: [[0.05, 930]], duration: 0.12, delay: len - 0.08, volume: 0.1 });
}

export function defineSounds(client: Client) {
  const a = client.audio;
  // Far sounds muffle; everything rings a little, far fights mostly their echo.
  a.acoustics({ air: 1, reverb: { near: 0.14, far: 0.5, seconds: 1.7, damp: 0.55 } });

  // ---- Blasters: the Rebels' brighter and ringing, the Empire's lower and grittier ----
  a.define('blaster_rifle_rebels', (s) => blaster(s, { top: 4300, bottom: 320, fall: 0.15, echoes: 2, gap: 0.034, metal: 0.9, grit: 0, thump: 0.35, snap: 0.8, loud: 1.15 }));
  a.define('blaster_rifle_empire', (s) => blaster(s, { top: 3500, bottom: 240, fall: 0.14, echoes: 2, gap: 0.03, metal: 0.55, grit: 0.35, thump: 0.45, snap: 1, loud: 1 }));
  a.define('blaster_heavy_rebels', (s) => blaster(s, { top: 3300, bottom: 300, fall: 0.085, echoes: 1, gap: 0.026, metal: 0.7, grit: 0.1, thump: 0.55, snap: 0.7, loud: 0.85 }));
  a.define('blaster_heavy_empire', (s) => blaster(s, { top: 2800, bottom: 220, fall: 0.08, echoes: 1, gap: 0.024, metal: 0.4, grit: 0.45, thump: 0.6, snap: 0.9, loud: 0.85 }));
  const cycler = (s: SynthKit, o: { top: number; bottom: number; grit: number; metal: number }) => {
    blaster(s, { ...o, fall: 0.3, echoes: 3, gap: 0.055, thump: 1, snap: 1.3, loud: 0.9 });
    // The crack of it, the boom rolling after.
    s.noise({ duration: 0.12, filter: 'highpass', from: 3000, to: 900, volume: 0.3 });
    s.tone({ wave: 'sine', from: 95 * s.pitch, to: 32, duration: 0.7, attack: 0.004, volume: 0.45 });
    s.noise({ duration: 0.8, delay: 0.04, attack: 0.02, filter: 'lowpass', from: 1100, to: 90, volume: 0.2 });
  };
  a.define('blaster_sniper_rebels', (s) => cycler(s, { top: 5600, bottom: 170, grit: 0, metal: 1 }));
  a.define('blaster_sniper_empire', (s) => cycler(s, { top: 4600, bottom: 130, grit: 0.3, metal: 0.6 }));
  a.define('blaster_pistol_rebels', (s) => blaster(s, { top: 4800, bottom: 430, fall: 0.11, echoes: 1, gap: 0.03, metal: 0.8, grit: 0, thump: 0.3, snap: 0.9, loud: 1.15 }));
  a.define('blaster_pistol_empire', (s) => blaster(s, { top: 4000, bottom: 340, fall: 0.1, echoes: 1, gap: 0.028, metal: 0.5, grit: 0.3, thump: 0.35, snap: 1, loud: 0.95 }));
  // (The first cut's names, for anything still naming them.)
  a.define('blaster_rifle', (s) => blaster(s, { top: 4000, bottom: 280, fall: 0.15, echoes: 2, gap: 0.032, metal: 0.7, grit: 0.15, thump: 0.4, snap: 0.9, loud: 1 }));
  a.define('blaster_heavy', (s) => blaster(s, { top: 3000, bottom: 260, fall: 0.085, echoes: 1, gap: 0.025, metal: 0.55, grit: 0.25, thump: 0.55, snap: 0.8, loud: 0.85 }));
  a.define('blaster_sniper', (s) => cycler(s, { top: 5100, bottom: 150, grit: 0.15, metal: 0.8 }));
  a.define('blaster_pistol', (s) => blaster(s, { top: 4400, bottom: 380, fall: 0.1, echoes: 1, gap: 0.03, metal: 0.65, grit: 0.15, thump: 0.3, snap: 0.9, loud: 0.95 }));

  // Heat: venting (R, or overheated: as long as that blaster's vent), the dry click of an
  // overheated trigger, the alarm as it overheats.
  a.define('vent_rifle', (s) => vent(s, 1.6));
  a.define('vent_heavy', (s) => vent(s, 2.4));
  a.define('vent_sniper', (s) => vent(s, 2.2));
  a.define('vent_pistol', (s) => vent(s, 1.2));
  a.define('vent', (s) => vent(s, 1.6));
  a.define(
    'overheat',
    (s) => {
      s.noise({ duration: 0.025, filter: 'bandpass', from: 2600, to: 1800, q: 5, volume: 0.448 });
      s.tone({ wave: 'square', from: 520, to: 480, duration: 0.05, volume: 0.112, lowpass: 1600 });
      s.noise({ duration: 0.18, delay: 0.02, filter: 'highpass', from: 6000, to: 3500, volume: 0.096 });
    },
    { reverb: 0.2 },
  );
  a.define(
    'blaster_overheat',
    (s) => {
      for (let i = 0; i < 3; i++) s.tone({ wave: 'square', from: 1180, to: 1150, duration: 0.06, delay: i * 0.1, volume: 0.09, lowpass: 3000 });
      // A burst of steam, and the power sinking.
      s.noise({ duration: 0.5, attack: 0.01, filter: 'highpass', from: 6000, to: 2800, volume: 0.24 });
      s.tone({ wave: 'sawtooth', from: 320, to: 70, duration: 0.45, volume: 0.13, lowpass: { freq: 1400, to: 300 }, drive: 0.3 });
    },
    { reverb: 0.3 },
  );

  // ---- Bolts landing, burning, going by ----
  a.define('bolt_hit', (s) => {
    const p = s.pitch;
    s.noise({ duration: 0.03, filter: 'highpass', from: 4000 * p, to: 1600, volume: 0.65 });
    s.tone({ wave: 'sine', from: 2600 * p, glide: chirp(2600 * p, 260 * p, 0.07, 4), duration: 0.07, attack: 0.002, volume: 0.312, fm: { ratio: 2.41, depth: 0.6, to: 0.05 } });
    s.tone({ wave: 'sine', from: 150 * p, to: 55, duration: 0.09, attack: 0.002, volume: 0.468 });
    // The sizzle in the scorch, and chips ticking off.
    s.noise({ duration: 0.34, attack: 0.012, delay: 0.015, filter: 'bandpass', from: 5200 * p, to: 3400, q: 2.2, volume: 0.169 });
    for (let i = 0; i < 3; i++) s.noise({ duration: 0.012, delay: rnd(0.03, 0.14), filter: 'highpass', from: 3500, to: 3000, volume: rnd(0.05, 0.1) });
  });
  a.define('bolt_burn', (s) => {
    const p = s.pitch;
    s.tone({ wave: 'sine', from: 130 * p, to: 50, duration: 0.13, attack: 0.002, volume: 0.5 });
    s.noise({ duration: 0.08, filter: 'lowpass', from: 1200, to: 250, volume: 0.28 });
    s.noise({ duration: 0.03, filter: 'highpass', from: 4500, to: 3000, volume: 0.22 });
    s.noise({ duration: 0.3, attack: 0.015, delay: 0.01, filter: 'bandpass', from: 3600 * p, to: 2400, q: 2.5, volume: 0.16 });
  });
  a.define('bolt_whizz', (s) => {
    // Coming, going: the pitch rises as it closes and drops away past, loudest going by.
    const p = s.pitch;
    s.tone({ wave: 'sawtooth', from: 700 * p, glide: [[0.1, 950 * p], [0.3, 330 * p]], duration: 0.2, attack: 0.1, volume: 0.1, bandpass: { freq: 1500 * p, to: 600, q: 2.5 } });
    s.tone({ wave: 'sine', from: 900 * p, glide: [[0.1, 1150 * p], [0.3, 380 * p]], duration: 0.2, attack: 0.1, volume: 0.16 });
    s.noise({ duration: 0.18, attack: 0.09, filter: 'bandpass', from: 4200 * p, to: 1800, q: 1.8, volume: 0.18 });
  });

  // ---- The thermal detonator ----
  a.define('detonator_arm', (s) => {
    // Beeps quickening, a hum rising under them.
    let t = 0;
    for (const gap of [0.13, 0.11, 0.09, 0.075, 0.062, 0.052, 0.045]) {
      s.tone({ wave: 'square', from: 1850, duration: 0.03, delay: t, volume: 0.08, lowpass: 3600 });
      t += gap;
    }
    s.tone({ wave: 'sine', from: 180, to: 520, duration: 0.15, attack: t, volume: 0.1, fm: { ratio: 2, depth: 0.2 } });
  });
  a.define('toss', (s) => {
    s.noise({ duration: 0.16, attack: 0.05, filter: 'bandpass', from: 450, to: 1600, q: 1.3, volume: 0.35 });
  });
  a.define('clink', (s) => {
    const p = s.pitch;
    s.tone({ wave: 'sine', from: 2350 * p, duration: 0.22, attack: 0.001, volume: 0.16, fm: { ratio: 1.41, depth: 0.8, to: 0.05 } });
    s.tone({ wave: 'sine', from: 3720 * p, duration: 0.12, attack: 0.001, volume: 0.08 });
    s.noise({ duration: 0.02, filter: 'highpass', from: 5000, to: 4000, volume: 0.2 });
  });

  // ---- Sabers and heroes (the heroes' own voices may replace these) ----
  a.define('saber_swing', (s) => {
    const p = s.pitch;
    s.tone({ wave: 'sawtooth', from: 95 * p, glide: [[0.1, 150 * p], [0.3, 85 * p]], duration: 0.22, attack: 0.07, volume: 0.2, lowpass: { freq: 500, to: 1400, time: 0.12 } });
    s.noise({ duration: 0.2, attack: 0.08, filter: 'bandpass', from: 600, to: 1500, q: 1.8, volume: 0.18 });
  });
  a.define('saber_hit', (s) => {
    s.noise({ duration: 0.3, filter: 'highpass', from: 2500, to: 1100, volume: 0.35 });
    s.tone({ wave: 'sawtooth', from: 130, to: 85, duration: 0.3, volume: 0.14, lowpass: 1400, drive: 0.6 });
  });
  a.define('hero_arrives', (s) => {
    drum(s, 55, 0, 0.65);
    cymbal(s, 0.05, 0.6);
    for (const [i, n] of [-14, -7, -2].entries()) brass(s, note(n), 0.05 + i * 0.16, 1.4 - i * 0.16, 0.8);
  });

  // ---- UI ----
  a.define('post_gained', (s) => {
    brass(s, note(-2), 0, 0.3, 0.8, 2600);
    brass(s, note(3), 0.13, 0.85, 0.85, 2800);
    s.tone({ wave: 'triangle', from: note(15), duration: 0.4, hold: 0.1, delay: 0.14, volume: 0.05 });
  });
  a.define('post_lost', (s) => {
    brass(s, note(-2), 0, 0.3, 0.7, 1700);
    brass(s, note(-9), 0.15, 0.95, 0.75, 1300);
    drum(s, 41, 0.15, 0.3);
  });
  a.define('ui_hero_ready', (s) => {
    for (const [i, n] of [3, 10, 15, 22].entries()) s.tone({ wave: 'triangle', from: note(n), duration: 0.5, delay: i * 0.07, volume: 0.13 });
    s.tone({ wave: 'sine', from: note(27), duration: 0.6, hold: 0.25, delay: 0.28, volume: 0.07, vibrato: { rate: 7, depth: 12 } });
  });
  a.define('low_tickets', (s) => {
    for (let i = 0; i < 2; i++) {
      brass(s, note(-26), i * 0.42, 0.34, 1.3, 900);
      brass(s, note(-25), i * 0.42, 0.34, 0.9, 900);
    }
    drum(s, 41, 0, 0.6);
  });
  a.define(
    'ui_heartbeat',
    (s) => {
      s.tone({ wave: 'sine', from: 75, to: 45, duration: 0.14, attack: 0.004, volume: 0.35 });
      s.tone({ wave: 'sine', from: 66, to: 40, duration: 0.16, delay: 0.2, attack: 0.004, volume: 0.25 });
    },
    { reverb: 0 },
  );
  a.define('respawn', (s) => {
    s.noise({ duration: 0.3, attack: 0.2, filter: 'bandpass', from: 300, to: 2400, q: 1.1, volume: 0.12 });
    s.tone({ wave: 'sine', from: 220, to: 660, duration: 0.3, attack: 0.15, volume: 0.08, fm: { ratio: 2, depth: 0.3 } });
    s.tone({ wave: 'triangle', from: note(3), duration: 0.35, delay: 0.42, volume: 0.07 });
  });

  // ---- Stingers: the match opening, victory, defeat ----
  a.define('match_start', (s) => {
    drum(s, 49, 0, 0.8);
    drum(s, 49, 0.2, 0.56);
    cymbal(s, 0.3, 0.6, 0.8);
    // A rising call: up a fourth, up again, and a held chord.
    brass(s, note(-14), 0.38, 0.28, 0.96);
    brass(s, note(-9), 0.62, 0.28, 0.96);
    brass(s, note(-7), 0.86, 0.26, 0.88);
    for (const n of [-9, -5, 0]) brass(s, note(n), 1.12, 1.7, 0.88, 2400);
    brass(s, note(-21), 1.12, 1.7, 0.88, 1200);
    drum(s, 41, 1.12, 0.72);
    cymbal(s, 1.12, 0.7);
  });
  a.define('victory', (s) => {
    drum(s, 55, 0);
    for (const [i, n] of [-7, -2, 2, 5].entries()) brass(s, note(n), 0.08 + i * 0.13, 0.13, 1.2, 2600);
    for (const n of [-2, 2, 5, 10]) brass(s, note(n), 0.62, 1.9, 1.1, 2800);
    brass(s, note(-14), 0.62, 1.9, 1.1, 1200);
    drum(s, 55, 0.62);
    cymbal(s, 0.62, 1);
    s.tone({ wave: 'triangle', from: note(22), duration: 1.0, hold: 0.4, delay: 0.66, volume: 0.04, vibrato: { rate: 6, depth: 10 } });
  });
  a.define('defeat', (s) => {
    drum(s, 41, 0, 0.9);
    brass(s, note(-12), 0.05, 0.4, 1.2, 1300);
    brass(s, note(-13), 0.45, 0.4, 1.2, 1200);
    for (const n of [-24, -17, -13]) brass(s, note(n), 0.9, 1.9, 1.1, 1000);
    drum(s, 36, 0.9, 1);
    cymbal(s, 0.9, 0.5);
  });

  // ---- Ambience ----
  a.defineLoop('amb_wind', (l) => {
    // A low rush, a sweeping band over it, a thin whistle; the gusts are the loop's pitch and loudness.
    l.noise({ freq: 160, filter: 'lowpass', q: 0.7, volume: 0.55 });
    l.noise({ freq: 520, filter: 'bandpass', q: 0.7, volume: 0.5 });
    l.noise({ freq: 1700, filter: 'bandpass', q: 6, volume: 0.07 });
  });
  a.define('amb_boom', (s) => {
    // A blast far off: a low thud, and its rumble rolling round the rocks.
    s.tone({ wave: 'sine', from: 70 * s.pitch, to: 28, duration: 1.4, attack: 0.01, volume: 0.4 });
    s.noise({ duration: 1.8, attack: 0.03, filter: 'lowpass', from: 600, to: 50, volume: 0.3 });
    s.noise({ duration: 1.2, delay: 0.35, attack: 0.2, filter: 'lowpass', from: 300, to: 60, volume: 0.15 });
  });

  // ---- The sky (skies.ts plays them as starfighters pass over, starting a second before they're nearest) ----
  a.define('amb_scream', (s) => {
    // An eye fighter: a wavering howl through a sweeping band, rising as it comes and falling away past.
    const p = s.pitch;
    for (const d of [1, 1.013, 0.988])
      s.tone({ wave: 'sawtooth', from: 700 * d * p, glide: [[0.95, 860 * d * p], [2.6, 330 * d * p]], duration: 1.6, attack: 0.95, volume: 0.0315, bandpass: { freq: 1100 * p, to: 480, q: 1.3 }, vibrato: { rate: 23, depth: 20 }, fm: { ratio: 0.5, depth: 0.08 } });
    s.noise({ duration: 1.6, attack: 0.9, filter: 'bandpass', from: 2200, to: 500, q: 0.8, volume: 0.084 });
    s.tone({ wave: 'sine', from: 110 * p, glide: [[0.95, 130 * p], [2.4, 55 * p]], duration: 1.4, attack: 0.9, volume: 0.098 });
  });
  a.define('amb_roar', (s) => {
    // A wing fighter: a deep engine roar under a steady whine, rising as it comes and falling past.
    const p = s.pitch;
    s.noise({ duration: 1.7, attack: 0.8, filter: 'lowpass', from: 1300 * p, to: 240, volume: 0.252 });
    for (const d of [1, 1.02]) s.tone({ wave: 'sawtooth', from: 80 * d * p, glide: [[0.9, 100 * d * p], [2.5, 58 * d * p]], duration: 1.6, attack: 0.85, volume: 0.091, lowpass: { freq: 900, to: 450 }, drive: 0.25 });
    s.tone({ wave: 'triangle', from: 1300 * p, glide: [[0.9, 1500 * p], [2.4, 900 * p]], duration: 1.5, attack: 0.8, volume: 0.042, vibrato: { rate: 6, depth: 8 } });
  });
  a.define('amb_sky_laser', (s) => blaster(s, { top: 3000, bottom: 200, fall: 0.2, echoes: 1, gap: 0.04, metal: 0.8, grit: 0.1, thump: 0.5, snap: 0.5, loud: 0.22 }));
  a.define('amb_sky_laser_imp', (s) => blaster(s, { top: 2400, bottom: 160, fall: 0.18, echoes: 1, gap: 0.035, metal: 0.4, grit: 0.5, thump: 0.5, snap: 0.6, loud: 0.25 }));

  // ---- The thermal detonator going off (client/detonator.ts, over the platform's blast) ----
  a.define('detonator_blast', (s) => {
    // A bright electric zing over the bang, a sizzle, and a hum dying away.
    s.tone({ wave: 'sawtooth', from: 400, glide: [[0.04, 2600], [0.5, 380]], duration: 0.45, volume: 0.08, bandpass: { freq: 2400, to: 900, q: 1.5 }, drive: 0.5 });
    s.noise({ duration: 0.8, attack: 0.01, filter: 'highpass', from: 7000, to: 2600, volume: 0.2 });
    s.tone({ wave: 'sine', from: 160, to: 45, duration: 1.1, delay: 0.04, volume: 0.28, fm: { ratio: 1.5, depth: 0.4, to: 0.02 } });
  });
}