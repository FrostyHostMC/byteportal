/**
 * Development: Blockfront's sounds and short scenes of them, for the sound board
 * (`/tools/sounds.html`): the versions to compare, the scenes, the board's groups, and playing
 * them live or rendering them offline.
 *
 * Versions: the game's voices as they are, and any older copies of its sound files dropped in
 * `tools/.before/` (untracked: `sounds.ts` exporting `defineSounds`, `hero-sounds.ts` exporting
 * `defineHeroSounds`), to compare.
 */
import { Sfx, type OfflineSfx } from '../src/platform/audio/sfx';
import type { Client, ClientLoop } from '../src/platform/api/client';
import type { Vec3 } from '../src/platform/api/types';
import { VOICES } from '../src/platform/client-kits/sounds';
import { defineSounds } from '../src/games/blockfront/client/sounds';
import { defineHeroSounds, humOf } from '../src/games/blockfront/heroes/client/sounds';
import { hits } from '../src/games/blockfront/client/hits';
import { defineFrostWind } from '../src/games/blockfront/client/weather';
import { heroJumps } from '../src/games/blockfront/heroes/client/jumps';
import type { HeroScene } from '../src/games/blockfront/heroes/client/state';

type Define = (client: Client) => void;
export interface Version {
  name: string;
  defines: Define[];
  /** Whether its blades hum as loops (else one-shot `bfh_hum` every second or so, as the first cut). */
  loops: boolean;
}

const before = import.meta.glob(['./.before/sounds.ts', './.before/hero-sounds.ts'], { eager: true }) as Record<string, { defineSounds?: Define; defineHeroSounds?: Define }>;
/** The kits that define voices of their own in `setup` (the hit markers, the jumps), and the frost wind. */
const kitVoices: Define = (c) => {
  hits().setup?.(c);
  heroJumps({} as HeroScene).setup?.(c);
  defineFrostWind(c);
};
export const VERSIONS: Version[] = [{ name: 'now', defines: [defineSounds, defineHeroSounds, kitVoices], loops: true }];
const old = Object.values(before).flatMap((m) => [m.defineSounds, m.defineHeroSounds].filter((d): d is Define => !!d));
if (old.length) VERSIONS.push({ name: 'before', defines: old, loops: false });

/** Anything a kit's `setup` reaches for besides the audio (the HUD, events): it takes the call and does nothing. */
const nothing: unknown = new Proxy(() => nothing, { get: (_, k) => (k === Symbol.toPrimitive ? () => '' : nothing), apply: () => nothing });

/** A client with only its audio, onto `sfx` (the rest does nothing). */
function clientOf(sfx: Sfx): Client {
  const audio = {
    play: (n: string, o?: { at?: Vec3; volume?: number; pitch?: number }) => sfx.play(n, o),
    define: (n: string, v: Parameters<Sfx['define']>[1], o?: { reverb?: number }) => sfx.define(n, v, o),
    loop: (n: string, o?: { at?: Vec3; volume?: number; pitch?: number }) => sfx.loop(n, o),
    defineLoop: (n: string, v: Parameters<Sfx['defineLoop']>[1]) => sfx.defineLoop(n, v),
    acoustics: (a: Parameters<Sfx['acoustics']>[0]) => sfx.acoustics(a),
  };
  return new Proxy({}, { get: (_, k) => (k === 'audio' ? audio : nothing) }) as unknown as Client;
}

export function load(sfx: Sfx, v: Version) {
  for (const [n, voice] of Object.entries(VOICES)) sfx.define(n, voice);
  const c = clientOf(sfx);
  for (const d of v.defines) d(c);
  sfx.setListener({ x: 0, y: 0, z: 0 }, 0);
}

/** What a scene plays with: sounds (at `here` unless it says), loops, and things later. */
export interface Stage {
  here: Vec3 | undefined;
  loops: boolean;
  play(name: string, o?: { at?: Vec3; volume?: number; pitch?: number }): void;
  loop(name: string, o?: { at?: Vec3; volume?: number; pitch?: number }): ClientLoop;
  at(time: number, run: () => void): void;
}
export type Scene = (s: Stage) => void;

const rnd = (a: number, b: number) => a + Math.random() * (b - a);
const off = (p: Vec3 | undefined, dx: number, dz: number): Vec3 => ({ x: (p?.x ?? 0) + dx, y: p?.y ?? 0, z: (p?.z ?? 0) + dz });

/** Fire `n` shots of `voice`, `gap` apart, starting at `t`. */
const burst = (s: Stage, voice: string, n: number, gap: number, t = 0, at?: Vec3, volume = 1) => {
  for (let i = 0; i < n; i++) s.at(t + i * gap, () => s.play(voice, { at: at ?? s.here, volume, pitch: rnd(0.97, 1.03) }));
};

/** A blade's hum through a swing's motion: `speed(t)` blocks a second, over `len` seconds. */
function hum(s: Stage, hero: 'luke' | 'vader', len: number, speed: (t: number) => number) {
  if (!s.loops) {
    for (let t = 0; t < len; t += 0.95) s.at(t, () => s.play('bfh_hum', { at: s.here, volume: 0.55, pitch: hero === 'vader' ? 0.85 : 1 }));
    return;
  }
  const l = s.loop(humOf(hero, 0).voice, { at: s.here, volume: 0 });
  for (let t = 0; t <= len; t += 1 / 60) {
    const tone = humOf(hero, speed(t));
    s.at(t, () => l.set({ pitch: tone.pitch, volume: tone.volume }));
  }
  s.at(len, () => l.stop());
}

/** A wind loop through one gust curve (the same every time, to compare winds), `set` from its strength. */
function windScene(s: Stage, voice: string, at: (g: number) => { volume: number; pitch: number }) {
  if (!s.loops) return;
  const w = s.loop(voice, { volume: 0 });
  for (let t = 0; t <= 8; t += 1 / 30) {
    const g = Math.max(0, Math.min(1, 0.5 + 0.6 * Math.sin(t * 0.9) * Math.sin(t * 0.31 + 1)));
    s.at(t, () => w.set(at(g)));
  }
  s.at(8, () => w.stop());
}

/** How fast a swing moves the tip: a bump `len` long, peaking at `peak`. */
const swingAt = (t: number, t0: number, len: number, peak: number) => (t < t0 || t > t0 + len ? 0 : peak * Math.sin(((t - t0) / len) * Math.PI) ** 2);

export const SCENES: Record<string, { seconds: number; play: Scene; note?: string }> = {
  'rifle burst (Empire)': { seconds: 2, play: (s) => burst(s, 'blaster_rifle_empire', 7, 0.15) },
  'rifle burst (Rebels)': { seconds: 2, play: (s) => burst(s, 'blaster_rifle_rebels', 7, 0.15) },
  'repeater burst': { seconds: 2, play: (s) => burst(s, 'blaster_heavy_empire', 14, 60 / 720) },
  'pistol taps': { seconds: 2, play: (s) => burst(s, 'blaster_pistol_rebels', 4, 0.3) },
  'exchange of fire': {
    seconds: 4,
    play: (s) => {
      burst(s, 'blaster_rifle_rebels', 5, 0.16, 0, s.here);
      burst(s, 'blaster_rifle_empire', 6, 0.15, 0.7, off(s.here, 12, -18), 1);
      burst(s, 'blaster_heavy_empire', 10, 0.083, 1.6, off(s.here, -20, -25), 1);
      for (let i = 0; i < 4; i++) s.at(0.9 + i * 0.3, () => s.play('bolt_hit', { at: off(s.here, rnd(-3, 3), rnd(-3, 1)), volume: 0.8, pitch: rnd(0.9, 1.1) }));
      s.at(1.3, () => s.play('bolt_whizz', { at: off(s.here, 1, 0), volume: 1 }));
      s.at(2.2, () => s.play('bolt_whizz', { at: off(s.here, -1, 0), volume: 1 }));
      s.at(2.6, () => s.play('bolt_burn', { at: off(s.here, 0, -4), volume: 0.75 }));
    },
  },
  'saber: idle hum': { seconds: 3, play: (s) => hum(s, 'luke', 3, () => 0) },
  'saber: idle hum (red)': { seconds: 3, play: (s) => hum(s, 'vader', 3, () => 0) },
  'saber: swings': {
    seconds: 3,
    note: 'three swings of the combo: the hum swept, and each swing’s whoosh',
    play: (s) => {
      const swings = [0.3, 0.95, 1.6];
      hum(s, 'luke', 3, (t) => swings.reduce((m, t0) => Math.max(m, swingAt(t, t0, 0.35, 22)), 0));
      for (const [i, t0] of swings.entries()) s.at(t0, () => s.play('bfh_saber_swing', { at: s.here, pitch: [1, 1.12, 0.86][i] }));
    },
  },
  'saber: duel': {
    seconds: 4,
    play: (s) => {
      const mine = [0.3, 1.0, 1.9, 2.8];
      hum(s, 'luke', 4, (t) => mine.reduce((m, t0) => Math.max(m, swingAt(t, t0, 0.35, 22)), 0));
      hum(s, 'vader', 4, (t) => [0.6, 1.4, 2.3].reduce((m, t0) => Math.max(m, swingAt(t, t0, 0.4, 18)), 0));
      for (const t0 of mine) s.at(t0, () => s.play('bfh_saber_swing', { at: s.here, pitch: rnd(0.9, 1.1) }));
      s.at(0.72, () => s.play('bfh_saber_clash', { at: s.here }));
      s.at(1.58, () => s.play('bfh_saber_clash', { at: s.here, pitch: 1.05 }));
      s.at(2.1, () => s.play('bfh_saber_deflect', { at: s.here }));
      s.at(2.45, () => s.play('bfh_saber_hit', { at: s.here }));
    },
  },
  'saber: thrown': {
    seconds: 2.5,
    play: (s) => {
      s.play('bfh_saber_throw', { at: s.here });
      if (!s.loops) {
        for (let t = 0; t < 2; t += 4 / 60) s.at(t, () => s.play('bfh_saber_spin', { at: s.here, volume: 0.6 }));
        return;
      }
      const l = s.loop('bfh_hum_dark', { at: s.here, volume: 0 });
      for (let t = 0; t <= 2; t += 1 / 60) {
        const turn = Math.sin(t * Math.PI * 2 * 3.2);
        s.at(t, () => l.set({ pitch: 1.12 + 0.2 * turn, volume: 0.12 + 0.05 * turn }));
      }
      s.at(2, () => {
        l.stop();
        s.play('bfh_saber_catch', { at: s.here });
      });
    },
  },
  'lightning (1.5 s)': {
    seconds: 2,
    play: (s) => {
      s.play('bfh_lightning_chain', { at: s.here });
      for (let t = 0; t < 1.5; t += 1 / 60) if (Math.random() < 0.35) s.at(t, () => s.play('bfh_crackle', { at: s.here, pitch: rnd(0.85, 1.2), volume: 0.8 }));
    },
  },
  'bowcaster volley': {
    seconds: 3,
    note: 'three quarrels, each bursting where it lands 12 blocks off',
    play: (s) => {
      for (let i = 0; i < 3; i++) {
        s.at(i * 0.63, () => s.play('bfh_bowcaster', { at: s.here, pitch: rnd(0.97, 1.03) }));
        s.at(i * 0.63 + 0.14, () => s.play('bfh_quarrel', { at: off(s.here, rnd(-3, 3), -12), pitch: rnd(0.9, 1.1) }));
      }
    },
  },
  'EE-3 burst': { seconds: 2, play: (s) => burst(s, 'blaster_ee3', 8, 60 / 470) },
  'Wookiee charge': {
    seconds: 2,
    play: (s) => {
      s.play('bfh_charge', { at: s.here });
      s.at(0.62, () => s.play('bfh_knock', { at: off(s.here, 0, -2) }));
    },
  },
  'jetpack flight': {
    seconds: 4,
    note: 'lift-off, a climb, a hover and a drop',
    play: (s) => {
      s.play('bfh_jet', { at: s.here });
      if (!s.loops) {
        for (let t = 0.1; t < 3.5; t += 0.3) s.at(t, () => s.play('bfh_jet_loop', { at: s.here, volume: 0.8 }));
        return;
      }
      const l = s.loop('bfh_jet_burn', { at: s.here, volume: 0 });
      for (let t = 0.1; t <= 3.5; t += 1 / 30) {
        const climb = t < 1.2 ? 0.8 : t < 2.5 ? 0 : -0.7;
        s.at(t, () => l.set({ volume: rnd(0.85, 1), pitch: 1 + 0.2 * climb + rnd(-0.03, 0.03) }));
      }
      s.at(3.5, () => l.stop());
    },
  },
  'flamethrower (2 s)': {
    seconds: 3,
    play: (s) => {
      if (!s.loops) {
        for (let t = 0; t < 2; t += 0.28) s.at(t, () => s.play('bfh_flame', { at: s.here, volume: 0.9 }));
        return;
      }
      const l = s.loop('bfh_flame', { at: s.here, volume: 0 });
      for (let t = 0; t <= 2; t += 1 / 30) {
        s.at(t, () => l.set({ volume: rnd(0.8, 1), pitch: rnd(0.93, 1.07) }));
        if (Math.random() < 7 / 30) s.at(t, () => s.play('bfh_flame_crackle', { at: s.here, pitch: rnd(0.8, 1.3), volume: 0.8 }));
      }
      s.at(2, () => l.stop());
    },
  },
  'desert wind (steady gusts)': { seconds: 8, play: (s) => windScene(s, 'amb_wind', (g) => ({ volume: 0.065 + g * 0.15, pitch: 0.75 + g * 0.55 })) },
  'frost wind (steady gusts)': { seconds: 8, play: (s) => windScene(s, 'bf_frost_wind', (g) => ({ volume: 0.06 + g * 0.15, pitch: 0.8 + g * 0.45 })) },
  'hits and a kill': {
    seconds: 2,
    play: (s) => {
      for (let i = 0; i < 4; i++) s.at(i * 0.15, () => s.play(i === 2 ? 'bf_hit_head' : 'bf_hit', { volume: 0.9 }));
      s.at(0.75, () => s.play('bf_kill', { volume: 0.9 }));
    },
  },
  'jumps and landings': {
    seconds: 3,
    play: (s) => {
      s.play('bfh_jump', { at: s.here, volume: 0.7 });
      s.at(0.45, () => s.play('bfh_jump2', { at: s.here, volume: 0.8 }));
      s.at(1.2, () => s.play('bfh_land', { at: s.here, volume: 1 }));
      s.at(1.8, () => s.play('bfh_jump', { at: s.here, volume: 0.7, pitch: 0.8 }));
      s.at(2.4, () => s.play('bfh_land', { at: s.here, volume: 0.6, pitch: 0.78 }));
    },
  },
  'wind (gusting)': {
    seconds: 8,
    play: (s) => {
      if (!s.loops) {
        for (let t = 0; t < 8; t += rnd(1.9, 2.6)) s.at(t, () => s.play('amb_wind', { volume: 0.9, pitch: rnd(0.85, 1.15) }));
        return;
      }
      const w = s.loop('amb_wind', { volume: 0 });
      let g = 0.3;
      let aim = 0.3;
      let turn = 0;
      for (let t = 0; t <= 8; t += 1 / 30) {
        if (t >= turn) {
          turn = t + rnd(1.5, 4.5);
          aim = Math.random() < 0.4 ? rnd(0.7, 1) : rnd(0.1, 0.5);
        }
        g += (aim - g) * (0.8 / 30);
        const v = g;
        s.at(t, () => w.set({ volume: 0.065 + v * 0.15, pitch: 0.75 + v * 0.55 }));
      }
      s.at(8, () => w.stop());
    },
  },
  'far firefight': {
    seconds: 5,
    play: (s) => {
      if (!s.loops) {
        s.play('amb_firefight', { at: off(undefined, 50, -60), volume: 3.2 });
        s.at(2, () => s.play('amb_firefight', { at: off(undefined, -40, -70), volume: 3.2 }));
        return;
      }
      burst(s, 'blaster_rifle_empire', 5, 0.22, 0, off(undefined, 50, -60), 0.35);
      burst(s, 'blaster_rifle_rebels', 4, 0.25, 1.5, off(undefined, 58, -52), 0.35);
      burst(s, 'blaster_heavy_empire', 8, 0.11, 2.8, off(undefined, 45, -64), 0.35);
      s.at(3.4, () => s.play('amb_boom', { at: off(undefined, -60, -70), volume: 3.5 }));
    },
  },
  'starfighters over': {
    seconds: 3.5,
    play: (s) => {
      s.play('amb_scream', { at: off(undefined, 0, -30), volume: 3 });
      s.at(0.5, () => s.play('amb_roar', { at: off(undefined, 10, -35), volume: 3 }));
      burst(s, 'amb_sky_laser', 3, 0.18, 0.9, off(undefined, 10, -35), 3);
    },
  },
};

/** The board's sounds, by group (a name a version hasn't is played as `vent` or skipped). */
export const GROUPS: Record<string, string[]> = {
  Blasters: ['blaster_rifle_rebels', 'blaster_rifle_empire', 'blaster_heavy_rebels', 'blaster_heavy_empire', 'blaster_sniper_rebels', 'blaster_sniper_empire', 'blaster_pistol_rebels', 'blaster_pistol_empire'],
  Heat: ['vent_rifle', 'vent_heavy', 'vent_sniper', 'vent_pistol', 'overheat', 'blaster_overheat'],
  Bolts: ['bolt_hit', 'bolt_burn', 'bolt_whizz', 'hitmarker', 'kill'],
  Detonator: ['detonator_arm', 'toss', 'clink', 'detonator_blast', 'explosion'],
  Sabers: ['bfh_saber_ignite', 'bfh_saber_swing', 'bfh_saber_hit', 'bfh_saber_clash', 'bfh_saber_deflect', 'bfh_guard_break', 'bfh_saber_throw', 'bfh_saber_catch'],
  Force: ['bfh_force_push', 'bfh_force_pull', 'bfh_force_stance', 'bfh_force_choke', 'bfh_force_rage', 'bfh_crackle', 'bfh_lightning_chain', 'bfh_dark_aura', 'bfh_saber_rush', 'bfh_force_leap', 'bfh_force_land', 'bfh_force_jump'],
  'HUD and stingers': ['post_gained', 'post_lost', 'ui_hero_ready', 'low_tickets', 'ui_heartbeat', 'respawn', 'hero_arrives', 'match_start', 'victory', 'defeat'],
  Chewblocca: ['bfh_bowcaster', 'bfh_quarrel', 'bowcaster_recock', 'bfh_roar', 'bfh_charge', 'bfh_knock', 'bfh_hero_ready'],
  'Boba Fetch': ['blaster_ee3', 'vent_ee3', 'bfh_rocket', 'bfh_jet'],
  Sky: ['amb_scream', 'amb_roar', 'amb_sky_laser', 'amb_sky_laser_imp', 'amb_boom'],
};
const FALLBACK: Record<string, string> = { vent_rifle: 'vent', vent_heavy: 'vent', vent_sniper: 'vent', vent_pistol: 'vent', vent_ee3: 'vent', bowcaster_recock: 'vent', blaster_ee3: 'blaster_pistol' };

/** Where a sound's put for the board's distance and side. */
export function placed(dist: number, side: number): Vec3 | undefined {
  if (!dist) return undefined;
  const a = side * 1.2;
  return { x: Math.sin(a) * dist, y: 0, z: -Math.cos(a) * dist };
}

/** A stage onto `sfx`, `v`'s, playing live (`at` in real time) or offline. */
export function stage(sfx: Sfx | OfflineSfx, v: Version, here: Vec3 | undefined, offline: boolean): Stage {
  const has = (n: string) => (sfx as unknown as { custom: Map<string, unknown> }).custom.has(n);
  return {
    here,
    loops: v.loops,
    play: (n, o) => sfx.play(has(n) ? n : (FALLBACK[n] ?? n), { at: o?.at ?? here, volume: o?.volume, pitch: o?.pitch }),
    loop: (n, o) => sfx.loop(n, o),
    at: offline ? (t, run) => (sfx as OfflineSfx).at(t, run) : (t, run) => (t <= 0 ? run() : void setTimeout(run, t * 1000)),
  };
}

/** Each version's live sound, made (and unlocked) the first time it's asked for: call it from a click. */
const live = new Map<string, Sfx>();
export function liveSfx(v: Version): Sfx {
  let s = live.get(v.name);
  if (!s) {
    s = new Sfx();
    s.unlock();
    load(s, v);
    live.set(v.name, s);
  }
  return s;
}

/** Play a scene (by its name) or a sound (by its name) live, in version `v`, at the board's distance and side. */
export function playLive(v: Version, what: string, dist: number, side: number) {
  const st = stage(liveSfx(v), v, placed(dist, side), false);
  const sc = SCENES[what];
  if (sc) sc.play(st);
  else st.play(what);
}

/** Render a scene or a sound offline in version `v`, as a WAV (base64). */
export async function renderWav(v: Version, what: string, seconds?: number, o: { dist?: number; side?: number } = {}) {
  const sc = SCENES[what];
  const sfx = Sfx.offline(seconds ?? sc?.seconds ?? 3);
  load(sfx, v);
  const st = stage(sfx, v, placed(o.dist ?? 0, o.side ?? 0), true);
  if (sc) sc.play(st);
  else st.play(what);
  return wav(await sfx.render());
}

/** A rendering as a 16-bit WAV, base64. */
export function wav(buf: AudioBuffer): string {
  const n = buf.length;
  const ch = buf.numberOfChannels;
  const out = new DataView(new ArrayBuffer(44 + n * ch * 2));
  const str = (o: number, s: string) => [...s].forEach((c, i) => out.setUint8(o + i, c.charCodeAt(0)));
  str(0, 'RIFF');
  out.setUint32(4, 36 + n * ch * 2, true);
  str(8, 'WAVEfmt ');
  out.setUint32(16, 16, true);
  out.setUint16(20, 1, true);
  out.setUint16(22, ch, true);
  out.setUint32(24, buf.sampleRate, true);
  out.setUint32(28, buf.sampleRate * ch * 2, true);
  out.setUint16(32, ch * 2, true);
  out.setUint16(34, 16, true);
  str(36, 'data');
  out.setUint32(40, n * ch * 2, true);
  const data = [...Array(ch)].map((_, c) => buf.getChannelData(c));
  for (let i = 0; i < n; i++) for (let c = 0; c < ch; c++) out.setInt16(44 + (i * ch + c) * 2, Math.max(-1, Math.min(1, data[c][i])) * 32767, true);
  let bin = '';
  const bytes = new Uint8Array(out.buffer);
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

