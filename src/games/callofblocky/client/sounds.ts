import type { SynthKit } from '@platform';
import type { Client } from '@platform/client';

/**
 * Call of Blocky's sounds, all synthesised on each screen (`client.audio.define`: nothing is
 * recorded or sent): each gun its own voice (a punch, a blast of noise, a crack, a tail), the
 * reloads, the katana, the lethals, and the stingers: a surf-rock riff to start a match, brass for
 * a streak. The weapons play theirs through their looks (`./looks`); the server plays the rest by
 * name (`audio.play('streak')`).
 */

/** A gunshot: a low punch, a blast of filtered noise, a supersonic crack and an echoing tail. */
function shot(s: SynthKit, o: { punch: number; body: number; bright: number; crack: number; tail: number; loud?: number }) {
  const p = s.pitch;
  const v = o.loud ?? 1;
  s.tone({ wave: 'sine', from: o.punch * p, to: 38, duration: o.body * 0.7, volume: 0.9 * v });
  s.tone({ wave: 'square', from: o.punch * 1.6 * p, to: 60, duration: 0.05, volume: 0.18 * v, lowpass: 900 });
  s.noise({ duration: o.body, filter: 'lowpass', from: o.bright * p, to: 400, volume: 0.75 * v });
  s.noise({ duration: 0.03, filter: 'highpass', from: 5200, to: 3000, volume: o.crack * v });
  if (o.tail > 0) {
    s.noise({ duration: o.tail, delay: 0.04, filter: 'lowpass', from: 1400 * p, to: 160, volume: 0.16 * v });
    s.noise({ duration: o.tail * 0.8, delay: 0.16, filter: 'lowpass', from: 900 * p, to: 120, volume: 0.07 * v });
  }
}

function click(s: SynthKit, delay: number, f: number, v = 0.3) {
  s.tone({ wave: 'square', from: f * s.pitch, to: f * 0.6 * s.pitch, duration: 0.035, volume: v * 0.5, delay, lowpass: 3200 });
  s.noise({ duration: 0.04, delay, filter: 'bandpass', from: f * 2.6, to: f * 1.8, q: 3, volume: v });
}

/** Misirlou-ish surf tremolo: fast picked notes up a Phrygian dominant run and back. */
function surf(s: SynthKit, notes: number[], step: number, picks: number) {
  notes.forEach((n, i) => {
    const f = 164.81 * 2 ** (n / 12);
    for (let k = 0; k < picks; k++) {
      const delay = i * step + (k * step) / picks;
      s.tone({ wave: 'sawtooth', from: f, to: f * 0.995, duration: (step / picks) * 0.9, volume: 0.16, delay, lowpass: 2600, attack: 0.004 });
      s.tone({ wave: 'square', from: f / 2, to: f / 2, duration: (step / picks) * 0.9, volume: 0.05, delay, lowpass: 900, attack: 0.004 });
    }
  });
}

export function defineSounds(client: Client) {
  const a = client.audio;
  a.define('shot_rifle', (s) => shot(s, { punch: 140, body: 0.2, bright: 5200, crack: 0.45, tail: 0.35 }));
  // The FAMAS: a quick, snappy 5.56, brighter and shorter than the Big Kahuna's.
  a.define('shot_famas', (s) => shot(s, { punch: 165, body: 0.15, bright: 6200, crack: 0.5, tail: 0.28, loud: 0.92 }));
  a.define('shot_smg', (s) => shot(s, { punch: 190, body: 0.11, bright: 7000, crack: 0.35, tail: 0.18, loud: 0.8 }));
  a.define('shot_shotgun', (s) => shot(s, { punch: 95, body: 0.42, bright: 3000, crack: 0.3, tail: 0.6, loud: 1.2 }));
  a.define('shot_sniper', (s) => {
    shot(s, { punch: 120, body: 0.28, bright: 4200, crack: 0.8, tail: 0.9, loud: 1.2 });
    // The echo off the far end of the street.
    s.noise({ duration: 0.5, delay: 0.32, filter: 'lowpass', from: 1100, to: 140, volume: 0.1 });
  });
  a.define('shot_pistol', (s) => shot(s, { punch: 210, body: 0.12, bright: 4200, crack: 0.5, tail: 0.25, loud: 0.85 }));
  // The Wolf: a fat, subsonic .45 thump. Marsellus: a heavy rifle round with a long tail.
  a.define('shot_tommy', (s) => shot(s, { punch: 160, body: 0.15, bright: 3800, crack: 0.22, tail: 0.24, loud: 0.85 }));
  a.define('shot_lmg', (s) => shot(s, { punch: 115, body: 0.22, bright: 4600, crack: 0.5, tail: 0.42, loud: 1.05 }));
  a.define('shot_marksman', (s) => {
    shot(s, { punch: 130, body: 0.24, bright: 5000, crack: 0.7, tail: 0.6, loud: 1.1 });
    s.noise({ duration: 0.35, delay: 0.26, filter: 'lowpass', from: 1000, to: 150, volume: 0.07 });
  });
  // Rock Salt: both barrels' worth of boom, low and wide. Bad Mother: a magnum's crack and ring.
  a.define('shot_sawnoff', (s) => shot(s, { punch: 78, body: 0.5, bright: 2600, crack: 0.35, tail: 0.75, loud: 1.35 }));
  a.define('shot_revolver', (s) => {
    shot(s, { punch: 150, body: 0.2, bright: 3600, crack: 0.75, tail: 0.5, loud: 1.1 });
    s.tone({ wave: 'triangle', from: 1900 * s.pitch, to: 1750 * s.pitch, duration: 0.25, volume: 0.04, delay: 0.02 });
  });
  // A mortar shell coming in: a falling whistle, then (the blast's own sound) the crump.
  a.define('mortar', (s) => {
    s.tone({ wave: 'sine', from: 2300 * s.pitch, to: 700 * s.pitch, duration: 1.15, volume: 0.22, attack: 0.05 });
    s.tone({ wave: 'triangle', from: 2350 * s.pitch, to: 720 * s.pitch, duration: 1.15, volume: 0.06, attack: 0.05 });
  });
  a.define('reload_mag', (s) => {
    click(s, 0.05, 900, 0.35); // magazine out
    click(s, 0.55, 700, 0.45); // magazine in
    click(s, 0.9, 1200, 0.35); // charging handle back…
    click(s, 1.0, 1000, 0.4); // …and home
  });
  a.define('reload_pistol', (s) => {
    click(s, 0.05, 1100, 0.3);
    click(s, 0.6, 850, 0.4);
    click(s, 0.95, 1400, 0.4);
  });
  // The drum: the old one slid out sideways, the new one in, the knob back.
  a.define('reload_drum', (s) => {
    click(s, 0.1, 800, 0.35);
    s.noise({ duration: 0.18, delay: 0.14, filter: 'bandpass', from: 900, to: 600, q: 2, volume: 0.2 });
    s.noise({ duration: 0.2, delay: 1.3, filter: 'bandpass', from: 700, to: 1000, q: 2, volume: 0.2 });
    click(s, 1.5, 650, 0.5);
    click(s, 2.2, 1300, 0.35);
    click(s, 2.32, 1000, 0.45);
  });
  // The belt: the cover up, the box off and on, a new belt laid in, the cover slammed, the handle.
  a.define('reload_belt', (s) => {
    click(s, 0.1, 1100, 0.4);
    s.noise({ duration: 0.2, delay: 0.5, filter: 'bandpass', from: 600, to: 400, q: 2, volume: 0.25 });
    click(s, 1.9, 600, 0.5);
    for (let n = 0; n < 5; n++) s.noise({ duration: 0.05, delay: 2.5 + n * 0.09, filter: 'bandpass', from: 2400, to: 1800, q: 3, volume: 0.14 });
    click(s, 3.6, 700, 0.6);
    click(s, 4.3, 1200, 0.4);
    click(s, 4.45, 950, 0.45);
  });
  // Broken open, the empties flicked out, two in, snapped shut.
  a.define('reload_break', (s) => {
    click(s, 0.08, 700, 0.45);
    for (const d of [0.32, 0.4]) s.tone({ wave: 'triangle', from: 2600 * s.pitch, to: 2300 * s.pitch, duration: 0.06, volume: 0.08, delay: d });
    click(s, 1.0, 900, 0.3);
    click(s, 1.35, 900, 0.3);
    click(s, 1.8, 520, 0.6);
  });
  // The cylinder swung out, the empties tipped out, the speedloader, the cylinder shut.
  a.define('reload_revolver', (s) => {
    click(s, 0.08, 1300, 0.35);
    for (let n = 0; n < 4; n++) s.tone({ wave: 'triangle', from: (2400 + n * 170) * s.pitch, to: 2100 * s.pitch, duration: 0.05, volume: 0.06, delay: 0.35 + n * 0.05 });
    click(s, 1.2, 1000, 0.35);
    click(s, 1.85, 800, 0.5);
  });
  // An ammo bag grabbed: the can's lid, a rattle of rounds.
  a.define('ammo', (s) => {
    click(s, 0, 900, 0.4);
    for (let n = 0; n < 4; n++) s.tone({ wave: 'triangle', from: (2000 + n * 240) * s.pitch, to: 1800 * s.pitch, duration: 0.05, volume: 0.07, delay: 0.08 + n * 0.045 });
    click(s, 0.3, 650, 0.45);
  });
  a.define('reload_shell', (s) => {
    s.noise({ duration: 0.08, filter: 'bandpass', from: 1500, to: 900, q: 2, volume: 0.22 });
    click(s, 0.1, 800, 0.3);
  });
  a.define('pump', (s) => {
    s.noise({ duration: 0.09, delay: 0.1, filter: 'bandpass', from: 1300, to: 700, q: 2, volume: 0.35 });
    click(s, 0.16, 520, 0.4);
    s.noise({ duration: 0.08, delay: 0.3, filter: 'bandpass', from: 1700, to: 1100, q: 2, volume: 0.35 });
    click(s, 0.36, 660, 0.45);
  });
  a.define('bolt', (s) => {
    click(s, 0.2, 900, 0.35);
    s.noise({ duration: 0.12, delay: 0.26, filter: 'bandpass', from: 1800, to: 900, q: 2, volume: 0.25 });
    s.noise({ duration: 0.1, delay: 0.46, filter: 'bandpass', from: 1200, to: 1900, q: 2, volume: 0.25 });
    click(s, 0.58, 1100, 0.4);
  });
  a.define('katana', (s) => {
    s.noise({ duration: 0.22, filter: 'bandpass', from: 1800 * s.pitch, to: 5200 * s.pitch, q: 1.5, volume: 0.45 });
    s.tone({ wave: 'sine', from: 2900 * s.pitch, to: 2700 * s.pitch, duration: 0.3, volume: 0.05, delay: 0.05 });
  });
  a.define('katana_hit', (s) => {
    s.noise({ duration: 0.12, filter: 'highpass', from: 3500, to: 1800, volume: 0.5 });
    s.tone({ wave: 'sine', from: 160, to: 50, duration: 0.18, volume: 0.8 });
    s.tone({ wave: 'triangle', from: 1900, to: 1700, duration: 0.4, volume: 0.08, delay: 0.03 });
  });
  // A streak: a brass stab, up a fourth.
  a.define('streak', (s) => {
    for (const [f, d] of [
      [233, 0],
      [311, 0],
      [370, 0],
      [311, 0.14],
      [415, 0.14],
      [466, 0.14],
    ] as const) {
      s.tone({ wave: 'sawtooth', from: f, to: f * 1.005, duration: d ? 0.5 : 0.12, volume: 0.1, delay: d, lowpass: 2200, attack: 0.01, vibrato: { rate: 6, depth: 4 } });
    }
  });
  // The match is on: a surf-guitar run.
  // The lethals: a pin pulled and the spoon flying, a lighter struck on the rag, a throw, a knock on the ground.
  a.define('pin', (s) => {
    s.tone({ wave: 'triangle', from: 2800 * s.pitch, to: 2500 * s.pitch, duration: 0.08, volume: 0.18 });
    s.noise({ duration: 0.04, filter: 'highpass', from: 4200, to: 3000, volume: 0.25 });
    click(s, 0.12, 1600, 0.35);
    s.tone({ wave: 'sine', from: 3400 * s.pitch, to: 3100 * s.pitch, duration: 0.18, volume: 0.08, delay: 0.14 });
  });
  a.define('lighter', (s) => {
    click(s, 0, 1900, 0.4);
    s.noise({ duration: 0.08, delay: 0.05, filter: 'highpass', from: 6000, to: 4000, volume: 0.2 });
    s.noise({ duration: 0.5, delay: 0.1, filter: 'lowpass', from: 1400 * s.pitch, to: 500, volume: 0.28 });
  });
  a.define('toss', (s) => {
    s.noise({ duration: 0.22, filter: 'bandpass', from: 600 * s.pitch, to: 1500 * s.pitch, q: 1.4, volume: 0.35 });
  });
  a.define('clink', (s) => {
    s.tone({ wave: 'triangle', from: 1250 * s.pitch, to: 900 * s.pitch, duration: 0.07, volume: 0.28, lowpass: 4000 });
    s.tone({ wave: 'sine', from: 210 * s.pitch, to: 110 * s.pitch, duration: 0.08, volume: 0.35 });
    s.noise({ duration: 0.03, filter: 'bandpass', from: 3000, to: 2200, q: 3, volume: 0.18 });
  });
  a.define('match_start', (s) => surf(s, [0, 1, 4, 5, 7, 8, 7, 5, 4, 1, 0], 0.11, 3));
  a.define('match_end', (s) => surf(s, [12, 11, 8, 7, 5, 4, 1, 0], 0.16, 4));
  // A spawn: a quick rising whoosh.
  a.define('respawn', (s) => {
    s.noise({ duration: 0.35, filter: 'bandpass', from: 400, to: 2600, q: 1.2, volume: 0.25 });
    s.tone({ wave: 'triangle', from: 330, to: 660, duration: 0.25, volume: 0.1, delay: 0.1 });
  });
  // Low health: a heartbeat.
  a.define('heartbeat', (s) => {
    s.tone({ wave: 'sine', from: 70, to: 45, duration: 0.12, volume: 0.6 });
    s.tone({ wave: 'sine', from: 64, to: 40, duration: 0.12, volume: 0.45, delay: 0.2 });
  });
  // Killstreaks: one ready to call in (a radio blip under the brass), the Hellstorm's launch and
  // its rush through the air, the chopper's rotor (a thud a beat) and its cannon.
  a.define('streak_ready', (s) => {
    s.tone({ wave: 'square', from: 1320, to: 1320, duration: 0.06, volume: 0.12, lowpass: 3000 });
    s.tone({ wave: 'square', from: 1760, to: 1760, duration: 0.08, volume: 0.12, delay: 0.08, lowpass: 3000 });
    for (const [f, d] of [
      [311, 0.18],
      [392, 0.18],
      [466, 0.18],
      [622, 0.36],
    ] as const) {
      s.tone({ wave: 'sawtooth', from: f, to: f * 1.004, duration: d > 0.3 ? 0.6 : 0.16, volume: 0.1, delay: d, lowpass: 2400, attack: 0.01, vibrato: { rate: 6, depth: 4 } });
    }
  });
  a.define('missile_launch', (s) => {
    s.tone({ wave: 'sine', from: 90, to: 40, duration: 0.5, volume: 0.7 });
    s.noise({ duration: 1.4, filter: 'lowpass', from: 3200, to: 500, volume: 0.55 });
    s.noise({ duration: 1.1, delay: 0.1, filter: 'bandpass', from: 700, to: 1600, q: 1.2, volume: 0.3 });
  });
  a.define('missile_air', (s) => {
    s.noise({ duration: 0.42, filter: 'bandpass', from: 900 * s.pitch, to: 1300 * s.pitch, q: 1.5, volume: 0.3 });
    s.noise({ duration: 0.42, filter: 'lowpass', from: 420 * s.pitch, to: 380 * s.pitch, volume: 0.35 });
  });
  a.define('rotor', (s) => {
    s.tone({ wave: 'sine', from: 78, to: 46, duration: 0.11, volume: 0.55 });
    s.noise({ duration: 0.13, filter: 'lowpass', from: 520, to: 160, volume: 0.45 });
  });
  a.define('chopper_gun', (s) => shot(s, { punch: 85, body: 0.22, bright: 2600, crack: 0.25, tail: 0.3, loud: 0.9 }));
  // The Briefcase: its fuse ticking (a hard little beep, higher near the end), the latches
  // snapping shut as it's armed, and the wire snipped as it's cracked.
  a.define('case_beep', (s) => {
    s.tone({ wave: 'square', from: 1960 * s.pitch, to: 1960 * s.pitch, duration: 0.07, volume: 0.22, lowpass: 5000 });
    s.tone({ wave: 'sine', from: 980 * s.pitch, to: 980 * s.pitch, duration: 0.07, volume: 0.12 });
  });
  a.define('case_armed', (s) => {
    click(s, 0, 1300, 0.45);
    click(s, 0.09, 1500, 0.45);
    s.tone({ wave: 'sawtooth', from: 233, to: 233, duration: 0.5, volume: 0.1, delay: 0.2, lowpass: 1600, vibrato: { rate: 7, depth: 6 } });
    s.tone({ wave: 'sawtooth', from: 277, to: 277, duration: 0.5, volume: 0.08, delay: 0.2, lowpass: 1600 });
  });
  a.define('case_defused', (s) => {
    s.noise({ duration: 0.05, filter: 'highpass', from: 5200, to: 3600, volume: 0.35 });
    click(s, 0.02, 2200, 0.4);
    s.tone({ wave: 'sine', from: 1200, to: 300, duration: 0.45, volume: 0.14, delay: 0.08 });
  });
}
