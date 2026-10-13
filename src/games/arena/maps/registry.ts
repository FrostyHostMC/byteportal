import type { BlueprintLike, Vec3 } from '@platform';
import type { Model } from './models';

/**
 * The Arena's maps. Each stands in the one void world at its own place (`origin`, 512 blocks from
 * the next, so one never shows from another), all on the ground at `FLOOR`; a run is fought on one
 * of them (`run/state.ts`: `map()`), and everything that places things (the director's spawns,
 * the monsters' brains, rewards, the lookout) asks the current map rather than assuming the
 * Colosseum. Every place a map names is in the world (its origin already added). Add a map: a file
 * here exporting an `ArenaMap`, listed in `MAPS`.
 */

/** The ground every map stands on (its surface; fighters stand at FLOOR + 1). */
export const FLOOR = 70;

/** Where monsters come in: a pen or a doorway (`at`, feet), facing into the arena (`yaw`). */
export interface Gate {
  at: Vec3;
  /** The way into the arena from the gate (radians, as `entities.spawn`'s yaw). */
  yaw: number;
  /** Spread either side of `at` monsters are scattered over (default 1.5). */
  spread?: number;
}

/** A keyframe of the opening fly-over: the camera at `at`, looking at `look`. */
export interface IntroKey {
  at: Vec3;
  look: Vec3;
}

/** A box of whole blocks, both corners inside it. */
export interface Box {
  min: Vec3;
  max: Vec3;
}

/**
 * A gate's portcullis: iron bars across its arch, `width` blocks wide and `height` high, standing
 * on `at` (the bottom middle of the arch, feet level) across the way `yaw` faces (a gate's yaw).
 * It rises when monsters come through and drops again once the way's clear (`maps/gates.ts`).
 */
export interface Portcullis {
  at: Vec3;
  yaw: number;
  width: number;
  height: number;
}

/**
 * A floor lever that sets a trap off: its foot at `at`, its front (where whoever pulls it stands)
 * turned to `face` (as a `Decor`'s).
 */
export interface Lever {
  at: Vec3;
  face: number;
}

/** A jet of fire or frost: from `at` along `dir` (of length 1), `length` blocks long. */
export interface Jet {
  at: Vec3;
  dir: Vec3;
  length: number;
}

/** A blade on a pole swinging from `pivot` along `axis`, `length` blocks down to its edge. */
export interface Pendulum {
  pivot: Vec3;
  axis: 'x' | 'z';
  length: number;
}

/**
 * A trap: a lever fighters pull for gold (`price`), which sets it going for `time` seconds; it can't
 * be pulled again for `cooldown` seconds after (from the pull). It hurts monsters in its `zone`
 * (never fighters), crediting whoever pulled it (`maps/traps.ts`); every screen shows it working
 * (`client/maps/traps.ts`).
 *
 * - `spikes`: iron spikes shoot up through the grates of its zone (the floor's cells) and stab
 *   whatever stands there, again and again.
 * - `jets`: fire (a soul fire's green, or frost, which slows) roars out of `jets` along the floor.
 * - `pendulum`: scythe blades swing to and fro on their poles, cutting through whatever's under
 *   their arc (`blades`).
 * - `bell`: the great bell (`bell`) tolls three times, a holy blast at each toll through
 *   everything within `reach`.
 * - `crusher`: a drop hammer (`head`: the box it hangs in) slams down onto its zone over and
 *   over, `drop` blocks.
 * - `sluice`: the sluice opens and lava pours along a dry channel (`channel`: the cells, in the
 *   order it reaches them), burning what's in it; then it drains.
 * - `icicles`: icicles break off the vault over its zone and fall, shattering on whatever's below.
 */
export type TrapSpec = {
  id: string;
  name: string;
  lever: Lever;
  price: number;
  time: number;
  cooldown: number;
  zone: Box[];
} & (
  | { kind: 'spikes' }
  | { kind: 'jets'; element: 'fire' | 'soul' | 'frost'; jets: Jet[] }
  | { kind: 'pendulum'; blades: Pendulum[] }
  | { kind: 'bell'; bell: Vec3; reach: number }
  | { kind: 'crusher'; head: Box; drop: number }
  | { kind: 'sluice'; channel: Vec3[] }
  | { kind: 'icicles'; vault: number }
);

export type TrapKind = TrapSpec['kind'];

/** Ground that hurts whoever's in it: lava burns, the frozen pool's water bites and slows. */
export interface Hazard {
  kind: 'lava' | 'frost';
  zone: Box[];
}

/**
 * A set piece standing on the map as a prop (a banner, a statue, the emperor in his box): `model`
 * at `at`, turned so its front (+z) faces `face` (radians: 0 toward +z, a quarter turn toward +x).
 */
export interface Decor {
  model: Model;
  at: Vec3;
  face: number;
}

/** A fire burning on every screen (a brazier, a torch's flame, a soul fire): its flames, `size` across. */
export interface Fire {
  at: Vec3;
  size: number;
  /** Fire's own (default), a soul fire's green, a cold blue flame. */
  tint?: 'fire' | 'soul' | 'frost';
}

/**
 * The air on screen (`client/maps/air.ts`): what drifts in it (dust in the sunlight, mist and
 * wisps, embers and ash, snow), the wind (where it blows toward, radians: 0 toward +x, turning
 * toward +z; blocks a second, steady and in a gust), its loop (`client/sounds/maps.ts`) and the
 * calls heard far off now and then (a crow, a bell, a hammer).
 */
export interface MapAir {
  kind: 'dust' | 'mist' | 'embers' | 'snow';
  heading: number;
  wind: number;
  gust: number;
  loop: string;
  calls: string[];
  /** An aurora overhead, rippling (the Sanctum). */
  aurora?: boolean;
}

export interface ArenaMap {
  id: string;
  name: string;
  /** A line under its name (the vote, the intro card). */
  line: string;
  /** Its colour (the intro's card, the vote), and its picture in menus (a block). */
  color: string;
  icon: string;
  /** Where it stands: its middle (x, z). Everything below is in the world, this already added. */
  origin: { x: number; z: number };
  /** Its blocks: built once, as part of the world (every screen builds them too). */
  build(): BlueprintLike[];
  /** Where its fighters start, come back to and rewards drop (feet). */
  center: Vec3;
  /**
   * How far the fighting floor reaches from `center` (blocks): creatures that keep away (archers,
   * necromancers, goblins) turn along it rather than into the wall.
   */
  radius: number;
  /** Where monsters come in. */
  gates: Gate[];
  /** Where a fallen fighter watches from until the wave's over, looking at `center` (feet). */
  lookout: Vec3;
  /** Time of day for the fight (0..1), and how far it falls by the last wave. */
  time: number;
  dusk?: number;
  /** The opening fly-over (`client/maps/intro.ts`): over the map, then down to each fighter. */
  intro: IntroKey[];
  /** Spots a boss makes its entrance at (default: the gates, a few blocks in). */
  bossGates?: Gate[];
  /** Where the shop stands between waves (feet), facing `center`. */
  shop?: Vec3;
  /** Where the mystery chest may stand (feet): it's at one of them, and moves on now and then. */
  chests?: Vec3[];
  /** Its gates' portcullises, its traps, its hazards. */
  portcullises?: Portcullis[];
  traps?: TrapSpec[];
  hazards?: Hazard[];
  /**
   * Its crowd, if it has one: points in the stands where spectators sit (the HUD's crowd is heard
   * from round them; they throw petals into the pit when they cheer, `client/maps/crowd.ts`), or
   * false: nobody watches here, and no crowd's heard.
   */
  crowd?: { at: Vec3[] } | false;
  /** Its set pieces (props), what burns on it (each screen draws the flames), and its air. */
  decor?: Decor[];
  fires?: Fire[];
  air: MapAir;
}

/** A point `d` blocks along `yaw`'s facing from `g` (into the arena), `side` to its right. */
export function along(g: Gate, d: number, side = 0): Vec3 {
  const fx = -Math.sin(g.yaw);
  const fz = -Math.cos(g.yaw);
  return { x: g.at.x + fx * d + -fz * side, y: g.at.y, z: g.at.z + fz * d + fx * side };
}

/** Whether `p` is in `b` (the blocks' whole cells: a body's feet in a cell count). */
export function inBox(b: Box, p: Vec3, pad = 0): boolean {
  return p.x >= b.min.x - pad && p.x < b.max.x + 1 + pad && p.y >= b.min.y - pad && p.y < b.max.y + 1 + pad && p.z >= b.min.z - pad && p.z < b.max.z + 1 + pad;
}

/** The map whose ground `p` is over (within `reach` of its origin), if any. */
export function mapNear<M extends ArenaMap>(maps: readonly M[], p: { x: number; z: number }, reach = 160): M | null {
  for (const m of maps) if (Math.abs(p.x - m.origin.x) < reach && Math.abs(p.z - m.origin.z) < reach) return m;
  return null;
}
