import type { SynthKit, SynthVoice } from '@platform';
import type { ClientKit } from '@platform/client';

/** A tone: `wave` from `from` to `to` Hz over `duration` seconds, `delay` in, peaking at `volume` (through a lowpass at `lowpass` Hz, if given). */
const tone = (s: SynthKit, wave: OscillatorType, from: number, to: number, delay: number, duration: number, volume: number, lowpass?: number) =>
  s.tone({ wave, from, to, delay, duration, volume, ...(lowpass ? { lowpass } : {}) });

/** Noise through a `filter` sweeping `from` -> `to` Hz over `duration` seconds, `delay` in, at `volume`. */
const noise = (s: SynthKit, delay: number, duration: number, filter: BiquadFilterType, from: number, to: number, volume: number, q = 1) =>
  s.noise({ delay, duration, filter, from, to, volume, q });

/**
 * The voices the platform's games have always had: weapons, creatures, blasts, fire. They're
 * ordinary definitions (`client.audio.define`), so a game can leave any out, change it, or copy
 * the kit. (The engine keeps only its world's and its screens' own: hit, hurt, pickup, heal,
 * click, spawn, countdown, lock, alarm, wave, victory, defeat.)
 */
export const VOICES: Record<string, SynthVoice> = {
  swing(s) {
    noise(s, 0, 0.16, 'bandpass', 700 * s.pitch, 2600 * s.pitch, 0.5, 1.2);
  },
  crit(s) {
    const p = s.pitch;
    tone(s, 'sine', 190 * p, 50, 0, 0.16, 1.0);
    noise(s, 0, 0.06, 'highpass', 3000, 2000, 0.4);
    tone(s, 'triangle', 1500 * p, 1900 * p, 0.02, 0.12, 0.18);
  },
  mob_hurt(s) {
    const p = s.pitch;
    tone(s, 'square', 190 * p, 110 * p, 0, 0.16, 0.18, 900);
    noise(s, 0, 0.1, 'bandpass', 500, 300, 0.25, 2);
  },
  mob_death(s) {
    const p = s.pitch;
    tone(s, 'sawtooth', 300 * p, 55 * p, 0, 0.6, 0.3, 900);
    noise(s, 0.05, 0.4, 'lowpass', 1200, 200, 0.25);
  },
  bow_draw(s) {
    noise(s, 0, 0.45, 'bandpass', 300 * s.pitch, 1100 * s.pitch, 0.12, 6);
  },
  bow_shoot(s) {
    const p = s.pitch;
    tone(s, 'triangle', 190 * p, 85 * p, 0, 0.16, 0.5);
    noise(s, 0, 0.18, 'bandpass', 1800, 700, 0.3);
  },
  arrow_hit(s) {
    tone(s, 'sine', 240 * s.pitch, 90, 0, 0.08, 0.5);
    noise(s, 0, 0.03, 'highpass', 2000, 1500, 0.25);
  },
  explosion(s) {
    const p = s.pitch;
    tone(s, 'sine', 110 * p, 32, 0, 0.55, 0.9);
    noise(s, 0, 0.9, 'lowpass', 2400 * p, 160, 0.8);
    noise(s, 0.02, 0.25, 'highpass', 3000, 1200, 0.25);
  },
  explosion_big(s) {
    const p = s.pitch;
    tone(s, 'sine', 80 * p, 24, 0, 1.4, 1.0);
    noise(s, 0, 2.2, 'lowpass', 1600 * p, 90, 0.9);
    noise(s, 0.15, 1.6, 'lowpass', 700 * p, 70, 0.6);
    noise(s, 0, 0.3, 'highpass', 2500, 900, 0.3);
  },
  // Something small and hard knocking on the ground (a grenade bouncing).
  bounce(s) {
    const p = s.pitch;
    tone(s, 'triangle', 520 * p, 300 * p, 0, 0.05, 0.35, 3000);
    tone(s, 'sine', 180 * p, 90 * p, 0, 0.07, 0.4);
    noise(s, 0, 0.03, 'bandpass', 2600 * p, 1800 * p, 0.2, 3);
  },
  // A bottle breaking: a crack and a spray of glass.
  glass(s) {
    const p = s.pitch;
    noise(s, 0, 0.05, 'highpass', 5000 * p, 3000 * p, 0.5);
    noise(s, 0.02, 0.35, 'bandpass', 6500 * p, 4200 * p, 0.3, 4);
    [2900, 3700, 4600].forEach((f, i) => tone(s, 'sine', f * p, f * p * 0.97, 0.03 + i * 0.04, 0.12, 0.08));
  },
  // Fire: a soft roar with crackles in it.
  fire(s) {
    const p = s.pitch;
    noise(s, 0, 0.7, 'lowpass', 900 * p, 500 * p, 0.35);
    for (let i = 0; i < 5; i++) noise(s, Math.random() * 0.6, 0.015, 'highpass', 3500, 2500, 0.3);
  },
  // Fly-by.
  whoosh(s) {
    noise(s, 0, 0.6, 'bandpass', 500 * s.pitch, 1800 * s.pitch, 0.4, 1.5);
  },
  // A generic gunshot: a thump, a blast of noise and a crack on top.
  gunshot(s) {
    const p = s.pitch;
    tone(s, 'sine', 150 * p, 42, 0, 0.13, 0.9);
    noise(s, 0, 0.2, 'lowpass', 6000 * p, 500, 0.75);
    noise(s, 0, 0.035, 'highpass', 4000, 2500, 0.45);
  },
  // Magazine out, magazine in, the charging handle.
  gun_reload(s) {
    const p = s.pitch;
    noise(s, 0.05, 0.05, 'bandpass', 2200 * p, 1600 * p, 0.35, 3);
    tone(s, 'square', 700 * p, 420 * p, 0.05, 0.04, 0.12, 2400);
    noise(s, 0.55, 0.06, 'bandpass', 1800 * p, 1200 * p, 0.45, 3);
    tone(s, 'square', 520 * p, 300 * p, 0.56, 0.05, 0.16, 2000);
    noise(s, 0.85, 0.09, 'bandpass', 3000 * p, 1400 * p, 0.35, 2);
  },
  // Pulling the trigger on nothing.
  gun_empty(s) {
    tone(s, 'square', 1900 * s.pitch, 1300 * s.pitch, 0, 0.025, 0.15, 5000);
    noise(s, 0, 0.02, 'highpass', 4500, 3000, 0.2);
  },
  // A pump or bolt worked: back, forward.
  gun_cycle(s) {
    const p = s.pitch;
    noise(s, 0.08, 0.08, 'bandpass', 1400 * p, 900 * p, 0.35, 2);
    tone(s, 'square', 480 * p, 300 * p, 0.12, 0.04, 0.12, 1800);
    noise(s, 0.26, 0.07, 'bandpass', 1800 * p, 1200 * p, 0.35, 2);
    tone(s, 'square', 620 * p, 420 * p, 0.3, 0.04, 0.14, 2000);
  },
  // A shot landed: a sharp little tick.
  hitmarker(s) {
    tone(s, 'square', 2600 * s.pitch, 2100 * s.pitch, 0, 0.035, 0.12, 6000);
    noise(s, 0, 0.025, 'highpass', 5000, 4000, 0.18);
  },
  // A kill: a bright double ding over a thump.
  kill(s) {
    const p = s.pitch;
    tone(s, 'sine', 180 * p, 60, 0, 0.12, 0.5);
    tone(s, 'triangle', 1320 * p, 1320 * p, 0, 0.18, 0.22);
    tone(s, 'triangle', 1760 * p, 1760 * p, 0.07, 0.3, 0.2);
  },
};

/** The platform's standard voices (`VOICES`), defined when the game's client starts. */
export function voices(list: Record<string, SynthVoice> = VOICES): ClientKit {
  return {
    name: 'sounds.voices',
    setup(client) {
      for (const [name, voice] of Object.entries(list)) client.audio.define(name, voice);
    },
  };
}

/** Every sound the platform's games have always had. */
export function standard(): ClientKit[] {
  return [voices()];
}
