import type { SynthKit } from '@platform';
import type { Client } from '@platform/client';

const rnd = (a: number, b: number) => a + Math.random() * (b - a);

/** A struck bell: its partials (hum, prime, minor third, fifth, nominal), each dying away at its own rate. */
function bell(s: SynthKit, f: number, volume: number, decay: number, delay = 0) {
  const partials: [number, number, number][] = [
    [0.5, 0.35, 1],
    [1, 0.5, 0.8],
    [1.2, 0.3, 0.6],
    [1.5, 0.22, 0.5],
    [2, 0.28, 0.4],
    [2.74, 0.12, 0.25],
  ];
  for (const [k, v, d] of partials) s.tone({ wave: 'sine', from: f * k * s.pitch, duration: decay * d, attack: 0.004, volume: volume * v, delay });
  s.noise({ duration: 0.06, filter: 'bandpass', from: f * 6, to: f * 3, q: 2, volume: volume * 0.35, delay });
}

/** Iron on iron: a clank that rings a little (inharmonic, like metal). */
function clank(s: SynthKit, f: number, volume: number, delay = 0) {
  s.tone({ wave: 'triangle', from: f * s.pitch, duration: 0.35, attack: 0.002, volume, fm: { ratio: 2.76, depth: 1.4, to: 0.4 }, delay });
  s.noise({ duration: 0.05, filter: 'bandpass', from: f * 3, to: f * 2, q: 3, volume: volume * 0.6, delay });
}

/**
 * The maps' voices, synthesised on each screen: the traps (levers, spikes, fire and frost, the
 * blades, the bell, the hammer, the sluice, the icicles), the portcullises, the hazards, the
 * fly-over's sting; each map's wind and fires (loops) and what's heard far off on it now and then.
 */
export function defineMapSounds(client: Client) {
  const a = client.audio;

  // --- Levers and gates -------------------------------------------------------------------------
  // A heavy lever thrown: a ratchet, a thunk, iron ringing.
  a.define('trap_lever', (s) => {
    for (let i = 0; i < 4; i++) s.noise({ duration: 0.018, filter: 'bandpass', from: 2600, to: 2200, q: 5, volume: 0.35, delay: i * 0.045 });
    s.tone({ from: 130 * s.pitch, to: 55, duration: 0.18, volume: 0.6, delay: 0.18 });
    clank(s, 640, 0.25, 0.18);
  });
  // Not enough gold: a dull double buzz.
  a.define('trap_deny', (s) => {
    for (const d of [0, 0.13]) s.tone({ wave: 'square', from: 150 * s.pitch, to: 130 * s.pitch, duration: 0.1, volume: 0.16, lowpass: 900, delay: d });
  }, { reverb: 0 });
  // A portcullis winched up: chains rattling over a groaning winch.
  a.define('gate_up', (s) => {
    for (let i = 0; i < 16; i++) s.noise({ duration: 0.025, filter: 'bandpass', from: rnd(2400, 3600), to: 1800, q: 4, volume: rnd(0.12, 0.3), delay: i * 0.055 + Math.random() * 0.03 });
    s.tone({ wave: 'sawtooth', from: 62 * s.pitch, to: 84 * s.pitch, duration: 0.9, attack: 0.1, volume: 0.25, bandpass: { freq: 320, q: 3 }, vibrato: { rate: 9, depth: 3 } });
  });
  // …and dropped: a heavy iron thud into the stone.
  a.define('gate_down', (s) => {
    s.tone({ from: 85 * s.pitch, to: 32, duration: 0.5, volume: 0.9 });
    s.noise({ duration: 0.4, filter: 'lowpass', from: 1200, to: 100, volume: 0.6 });
    clank(s, 420, 0.3);
  });

  // --- Spikes -----------------------------------------------------------------------------------
  // Under the grates, the mechanism winding.
  a.define('trap_rattle', (s) => {
    s.noise({ duration: 0.35, filter: 'bandpass', from: 1400, to: 2200, q: 6, volume: 0.3 });
    for (let i = 0; i < 6; i++) s.noise({ duration: 0.02, filter: 'highpass', from: 3500, to: 2800, volume: 0.25, delay: i * 0.055 });
  });
  // The stab: a thump, and steel singing.
  a.define('trap_spikes', (s) => {
    s.tone({ from: 160 * s.pitch, to: 60, duration: 0.12, volume: 0.7 });
    s.noise({ duration: 0.14, filter: 'highpass', from: 7000, to: 3000, volume: 0.45 });
    s.tone({ wave: 'triangle', from: 1500 * s.pitch, to: 1100 * s.pitch, duration: 0.3, volume: 0.15, fm: { ratio: 2.76, depth: 0.7 } });
  });
  a.define('trap_spikes_down', (s) => {
    s.noise({ duration: 0.3, filter: 'bandpass', from: 900, to: 450, q: 4, volume: 0.35 });
    clank(s, 300, 0.25, 0.25);
  });

  // --- Fire and frost ---------------------------------------------------------------------------
  // Catching: a whoomph.
  a.define('trap_ignite', (s) => {
    s.noise({ duration: 0.35, filter: 'lowpass', from: 300, to: 3200, attack: 0.04, volume: 0.8 });
    s.tone({ wave: 'sawtooth', from: 55 * s.pitch, to: 110 * s.pitch, duration: 0.3, volume: 0.3, lowpass: 500, drive: 0.4 });
  });
  // Fire roaring out of a lion's mouth.
  a.defineLoop('trap_fire_loop', (l) => {
    l.noise({ freq: 700, filter: 'lowpass', q: 0.7, volume: 0.55 });
    l.noise({ freq: 2200, filter: 'bandpass', q: 0.9, volume: 0.22 });
    l.tone({ wave: 'sawtooth', freq: 52, volume: 0.12, lowpass: 180, drive: 0.3 });
  });
  // Frost blasting out of a vent: a cold hiss with a whistle in it.
  a.defineLoop('trap_frost_loop', (l) => {
    l.noise({ freq: 3200, filter: 'highpass', q: 0.7, volume: 0.32 });
    l.noise({ freq: 1300, filter: 'bandpass', q: 2, volume: 0.22 });
    l.tone({ wave: 'sine', freq: 2100, volume: 0.025, vibrato: { rate: 5, depth: 30 } });
  });

  // --- Blades, the bell, the hammer -------------------------------------------------------------
  // A chain paying out, a latch knocked free.
  a.define('trap_chain', (s) => {
    for (let i = 0; i < 10; i++) s.noise({ duration: 0.02, filter: 'bandpass', from: rnd(2000, 3200), to: 1600, q: 4, volume: rnd(0.15, 0.3), delay: i * 0.035 });
    clank(s, 520, 0.3, 0.38);
  });
  // A great blade going by: a rising and falling whoosh, steel singing faintly.
  a.define('trap_blade', (s) => {
    s.noise({ duration: 0.25, filter: 'bandpass', from: 400 * s.pitch, to: 1600 * s.pitch, q: 1.4, volume: 0.6, attack: 0.08 });
    s.noise({ duration: 0.25, filter: 'bandpass', from: 1600 * s.pitch, to: 380 * s.pitch, q: 1.4, volume: 0.55, delay: 0.2 });
    s.tone({ wave: 'sine', from: 880 * s.pitch, to: 820 * s.pitch, duration: 0.5, volume: 0.04, fm: { ratio: 1.41, depth: 0.3 }, delay: 0.15 });
  });
  // The great bell: a deep toll that hangs in the air.
  a.define('trap_bell', (s) => bell(s, 196, 0.42, 4.2));
  // The hammer's steam, before it drops.
  a.define('trap_hiss', (s) => {
    s.noise({ duration: 0.7, filter: 'highpass', from: 2400, to: 3600, attack: 0.06, volume: 0.4 });
  });
  // The hammer coming down: a huge slam, iron clanging, a rumble.
  a.define('trap_slam', (s) => {
    s.tone({ from: 75 * s.pitch, to: 24, duration: 0.9, volume: 1 });
    s.noise({ duration: 0.6, filter: 'lowpass', from: 2400, to: 90, volume: 0.8 });
    clank(s, 260, 0.45);
    clank(s, 1150, 0.12, 0.01);
  });

  // --- The sluice and the icicles ---------------------------------------------------------------
  // The alarm as the sluice opens: a gong.
  a.define('trap_gong', (s) => {
    s.tone({ wave: 'sine', from: 170 * s.pitch, to: 160 * s.pitch, duration: 2.6, attack: 0.005, volume: 0.45, fm: { ratio: 1.41, depth: 1.6, to: 0.2 } });
    s.tone({ wave: 'sine', from: 340 * s.pitch, duration: 1.8, attack: 0.005, volume: 0.15, fm: { ratio: 2.1, depth: 0.8, to: 0.1 } });
    s.noise({ duration: 0.08, filter: 'lowpass', from: 1500, to: 400, volume: 0.4 });
  });
  // Lava glugging down the channel.
  a.define('trap_pour', (s) => {
    for (let i = 0; i < 3; i++) s.tone({ wave: 'sine', from: rnd(160, 240) * s.pitch, to: 70, duration: 0.14, volume: 0.35, delay: i * rnd(0.06, 0.1) });
    s.noise({ duration: 0.3, filter: 'lowpass', from: 700, to: 250, volume: 0.3 });
  });
  // Ice cracking overhead.
  a.define('trap_crack', (s) => {
    for (let i = 0; i < 7; i++) s.noise({ duration: 0.015, filter: 'highpass', from: 4500, to: 3000, volume: rnd(0.3, 0.6), delay: i * rnd(0.03, 0.07) });
    s.tone({ wave: 'sawtooth', from: 280 * s.pitch, to: 240 * s.pitch, duration: 0.45, volume: 0.12, bandpass: { freq: 1100, q: 9 } });
  });
  // An icicle shattering.
  a.define('trap_icicle', (s) => {
    s.noise({ duration: 0.22, filter: 'highpass', from: 6000, to: 2500, volume: 0.5 });
    s.tone({ from: 140 * s.pitch, to: 70, duration: 0.08, volume: 0.35 });
    for (let i = 0; i < 4; i++) s.tone({ wave: 'triangle', from: rnd(2400, 4400) * s.pitch, duration: rnd(0.15, 0.3), volume: 0.06, delay: rnd(0, 0.12) });
  });

  // --- Hazards ----------------------------------------------------------------------------------
  a.define('hazard_sizzle', (s) => {
    s.noise({ duration: 0.5, filter: 'highpass', from: 3500, to: 5000, volume: 0.35 });
    for (let i = 0; i < 5; i++) s.noise({ duration: 0.012, filter: 'bandpass', from: 2400, to: 2000, q: 3, volume: 0.3, delay: rnd(0, 0.4) });
  });
  // Lava spitting a fighter out: a deep whoomp as it heaves, a hiss, a bubble or two bursting.
  a.define('hazard_spit', (s) => {
    s.noise({ duration: 0.4, filter: 'lowpass', from: 180, to: 1400, attack: 0.02, volume: 0.9 });
    s.tone({ wave: 'sine', from: 70 * s.pitch, to: 150 * s.pitch, duration: 0.25, volume: 0.55 });
    s.noise({ duration: 0.7, filter: 'highpass', from: 2600, to: 4800, attack: 0.08, volume: 0.32, delay: 0.1 });
    for (let i = 0; i < 3; i++) s.tone({ wave: 'sine', from: rnd(180, 300) * s.pitch, to: 70, duration: 0.1, volume: 0.3, delay: 0.15 + i * rnd(0.07, 0.12) });
  });
  // The frozen pool throwing a fighter out: a cold splash, ice tinkling.
  a.define('hazard_splash', (s) => {
    s.noise({ duration: 0.35, filter: 'bandpass', from: 900, to: 2600, q: 0.8, attack: 0.01, volume: 0.7 });
    s.noise({ duration: 0.6, filter: 'highpass', from: 4000, to: 6000, volume: 0.25, delay: 0.08 });
    for (let i = 0; i < 4; i++) s.tone({ wave: 'triangle', from: rnd(2600, 4200) * s.pitch, duration: 0.18, volume: 0.05, delay: 0.1 + rnd(0, 0.2) });
  });
  a.define('hazard_chill', (s) => {
    s.noise({ duration: 0.25, filter: 'highpass', from: 6000, to: 4000, volume: 0.25 });
    s.tone({ wave: 'triangle', from: 3200 * s.pitch, duration: 0.2, volume: 0.05 });
  });

  // --- The fly-over -----------------------------------------------------------------------------
  // The map's name on the card: a great drum, brass swelling over it, a cymbal behind.
  a.define('intro_sting', (s) => {
    s.tone({ from: 72, to: 38, duration: 0.9, volume: 0.9 });
    s.noise({ duration: 0.35, filter: 'lowpass', from: 600, to: 120, volume: 0.6 });
    for (const f of [146.8, 220, 293.7, 349.2]) s.tone({ wave: 'sawtooth', from: f * 0.985, to: f, duration: 1.4, attack: 0.18, hold: 0.7, volume: 0.07, lowpass: { freq: 500, to: 2600, time: 0.6 }, fm: { ratio: 1, depth: 0.35 } });
    s.noise({ duration: 1.6, filter: 'highpass', from: 7000, to: 5000, attack: 0.5, volume: 0.12 });
  }, { reverb: 0.4 });

  // --- The air ----------------------------------------------------------------------------------
  // The Colosseum: a warm wind over the rim.
  a.defineLoop('amb_arena_wind', (l) => {
    l.noise({ freq: 380, filter: 'lowpass', q: 0.7, volume: 0.42 });
    l.noise({ freq: 950, filter: 'bandpass', q: 0.8, volume: 0.22 });
    l.noise({ freq: 1800, filter: 'bandpass', q: 7, volume: 0.035 });
  });
  // The Necropolis: a hollow, moaning wind through the crypts.
  a.defineLoop('amb_crypt_wind', (l) => {
    l.noise({ freq: 260, filter: 'lowpass', q: 0.7, volume: 0.4 });
    l.noise({ freq: 520, filter: 'bandpass', q: 7, volume: 0.13 });
    l.noise({ freq: 790, filter: 'bandpass', q: 9, volume: 0.06 });
    l.tone({ wave: 'sine', freq: 55, volume: 0.05 });
  });
  // The Forge: the lava's low rumble and its bubbling.
  a.defineLoop('amb_forge', (l) => {
    l.tone({ wave: 'sawtooth', freq: 36, volume: 0.22, lowpass: 120 });
    l.noise({ freq: 170, filter: 'lowpass', q: 0.8, volume: 0.4 });
    l.noise({ freq: 420, filter: 'bandpass', q: 3, volume: 0.09 });
  });
  // The Sanctum: a thin cold wind with a whistle through the pillars.
  a.defineLoop('amb_ice_wind', (l) => {
    l.noise({ freq: 240, filter: 'lowpass', q: 0.7, volume: 0.38 });
    l.noise({ freq: 1150, filter: 'bandpass', q: 0.9, volume: 0.36 });
    l.noise({ freq: 660, filter: 'bandpass', q: 9, volume: 0.1 });
    l.noise({ freq: 1550, filter: 'bandpass', q: 11, volume: 0.045 });
  });
  // A brazier burning.
  a.defineLoop('amb_fire', (l) => {
    l.noise({ freq: 420, filter: 'lowpass', q: 0.6, volume: 0.32 });
    l.noise({ freq: 1500, filter: 'bandpass', q: 0.7, volume: 0.1 });
  });

  // Heard far off now and then: a hawk over the Colosseum, a horn from the gates.
  a.define('amb_hawk', (s) => {
    s.tone({ wave: 'sine', from: 3000 * s.pitch, glide: [[0.08, 3300], [0.6, 1700]], duration: 0.65, volume: 0.08, vibrato: { rate: 30, depth: 60 } });
    s.tone({ wave: 'sine', from: 2800 * s.pitch, glide: [[0.3, 1800]], duration: 0.35, volume: 0.05, delay: 0.75, vibrato: { rate: 30, depth: 50 } });
  });
  a.define('amb_horn', (s) => {
    s.tone({ wave: 'sawtooth', from: 196 * s.pitch, duration: 1.2, attack: 0.15, hold: 0.8, volume: 0.1, lowpass: 1100, fm: { ratio: 1, depth: 0.3 } });
    s.tone({ wave: 'sawtooth', from: 294 * s.pitch, duration: 1.4, attack: 0.15, hold: 0.9, volume: 0.1, lowpass: 1300, fm: { ratio: 1, depth: 0.3 }, delay: 1.3 });
  });
  // The Necropolis: crows, an owl, a far bell.
  a.define('amb_crow', (s) => {
    const n = 2 + Math.floor(Math.random() * 2);
    for (let i = 0; i < n; i++) s.tone({ wave: 'sawtooth', from: 920 * s.pitch, to: 640 * s.pitch, duration: 0.2, volume: 0.12, bandpass: { freq: 1500, q: 2 }, drive: 0.4, delay: i * 0.32 });
  });
  a.define('amb_owl', (s) => {
    s.tone({ wave: 'sine', from: 390 * s.pitch, to: 360 * s.pitch, duration: 0.4, attack: 0.08, volume: 0.12 });
    s.tone({ wave: 'sine', from: 380 * s.pitch, to: 350 * s.pitch, duration: 0.55, attack: 0.1, volume: 0.1, delay: 0.6 });
  });
  a.define('amb_bell', (s) => bell(s, 247, 0.12, 3.5));
  // The Forge: an anvil rung far off, the mountain's rumble, a vent letting go.
  a.define('amb_hammer', (s) => {
    for (const d of [0, 0.42, 0.84]) clank(s, 1050, 0.12, d);
  });
  a.define('amb_rumble', (s) => {
    s.noise({ duration: 2.2, filter: 'lowpass', from: 140, to: 60, attack: 0.5, volume: 0.7 });
    s.tone({ from: 34, to: 28, duration: 2, attack: 0.5, volume: 0.35 });
  });
  a.define('amb_steam', (s) => {
    s.noise({ duration: 1.4, filter: 'highpass', from: 2200, to: 3200, attack: 0.15, volume: 0.25 });
  });
  // The Sanctum: ice creaking, chimes on the wind.
  a.define('amb_creak', (s) => {
    s.tone({ wave: 'sawtooth', from: 140 * s.pitch, to: 175 * s.pitch, duration: 1.1, attack: 0.2, volume: 0.1, bandpass: { freq: 900, q: 10 } });
    for (let i = 0; i < 3; i++) s.noise({ duration: 0.015, filter: 'highpass', from: 4000, to: 3000, volume: 0.25, delay: 0.9 + i * 0.07 });
  });
  a.define('amb_chime', (s) => {
    [1760, 2093, 2637, 2349].forEach((f, i) => s.tone({ wave: 'triangle', from: f * s.pitch, duration: 1.6, attack: 0.003, volume: 0.05, delay: i * rnd(0.12, 0.25) }));
  });
}
