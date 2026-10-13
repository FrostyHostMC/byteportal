import type { ItemBase, ItemMove, Vec3, ViewAnimation } from '@platform';

/**
 * The gun kit's shared part: rules the host and the shooter's own screen both play, so both fire,
 * spread, reload and slow down the same way: the screen shows a shot the moment it's fired, and
 * the host (which decides what it hit) agrees about where it went.
 */

/**
 * A hitscan gun: each shot is a ray (a few for shotguns) that hits the first thing along it,
 * checked against where targets were on the shooter's own screen (so what you aim at is what you
 * hit, however far away the server is). Firing, recoil, aiming down the sights and reloading
 * happen at once on the shooter's screen; the host decides the hits. Right-click aims, R
 * reloads, and an empty gun reloads by itself.
 */
export interface GunItem extends ItemBase {
  kind: 'gun';
  /** Damage per bullet (per pellet): up close, and at `falloff[1]` blocks and beyond. */
  damage: number | [near: number, far: number];
  /** Where damage starts to fall off and where it bottoms out, in blocks. Default [20, 50]. */
  falloff?: [number, number];
  /** Damage multiplier for a head hit. Default 1.5. */
  headshot?: number;
  /** Rounds per minute. */
  rpm: number;
  /** Keeps firing while the trigger is held. Default false: a shot per click. */
  auto?: boolean;
  /** Rounds in a magazine, and spare rounds carried (default three magazines' worth). */
  magazine: number;
  reserve?: number;
  /** Seconds to reload a magazine; with `shells`, seconds per round loaded (shotguns), and firing stops it. */
  reload: number;
  shells?: boolean;
  /** Bullets per shot (shotguns). Default 1. */
  pellets?: number;
  /**
   * The cone shots land in, in degrees (half angle): from the hip, aiming down the sights, and
   * extra while moving or in the air; each shot adds `bloom`, which settles again quickly.
   */
  spread?: { hip?: number; aim?: number; move?: number; air?: number; bloom?: number };
  /** Kick per shot in degrees: up, and at most sideways; `recover` (0..1) is how much of it the view settles back from. */
  recoil?: { up?: number; side?: number; recover?: number };
  /**
   * Aiming down the sights (right mouse): `zoom` (the view's field of view divided by it; default
   * 1.3), seconds to raise (0.2), speed while aiming (0.6), and what's seen: the gun's own
   * `iron` sights (default); a red `dot` or a `holo` sight's ring and dot, glowing on the target
   * through the optic's window (`color`, default red; model the optic with its window open and
   * its `sight` point in the window's middle); or a `scope` (the view fills with the scope).
   */
  aim?: {
    zoom?: number;
    time?: number;
    move?: number;
    sight?: 'iron' | 'dot' | 'holo' | 'scope';
    color?: string;
    /**
     * Aim assist for someone on a controller (0 none, 1 strong; default 0.6): the view slows
     * over a player in sight and turns a little with them as they move. Mouse aim is never helped.
     * A number is the strength; `AimAssist` gives its shape too (over the game's `guns.assist`).
     */
    assist?: number | AimAssist;
  };
  /** Blocks. Default 150. */
  range?: number;
  /** Movement speed while it's held (a heavy gun is slower). Default 1. */
  mobility?: number;
  /**
   * Worked after each shot, a beat after it (0.08 s): a `pump` (the support hand back and forth),
   * a `bolt` (the gun rolled over to work it), a `lever` (the gun rocked on the support hand, the
   * firing hand swinging the lever down and back), a `hammer` cocked by the thumb (a
   * single-action revolver: the gun canted in and tipped up), or a first-person animation of the
   * game's own (`ViewAnimation`, the hand's motion; keep it shorter than the time between shots).
   * A humanoid figure works a `lever` and a `hammer` too (`HumanoidPoses.lever`, `.hammer`).
   */
  action?: GunAction;
  /** The tracer's colour, or false for none. Default a warm yellow. */
  tracer?: string | false;
  knockback?: number;
  /**
   * In a world with destructible blocks (`world.destructible`), what each bullet (each pellet)
   * carves out where it hits one: a channel `radius` round and `depth` deep, in blocks (see
   * `world.carve`). Each shot on the same spot goes about `depth + radius` further in (the next
   * one lands at the bottom of the last one's pit). Default `{ radius: 0.1, depth: 0.05 }`: a
   * pit a few pixels across, and about seven shots on one spot through a block. `false`: this
   * gun doesn't carve.
   */
  carve?: { radius?: number; depth?: number } | false;
  /**
   * Wall-banging: bullets go through walls with up to `depth` blocks of material in them all told
   * (a block-thick wall head on is 1, at a slant more; what's been shot out of it doesn't count),
   * losing `damageLoss` of their damage for each block they go through (default 0.4; 1 would
   * lose it all in a block). Bedrock and blocks that can't be broken stop them. They leave a hole
   * where they go in and where they come out. Off by default.
   */
  penetration?: { depth: number; damageLoss?: number };
}

/** A gun's action, worked after each shot (`GunItem.action`). */
export type GunAction = 'pump' | 'bolt' | 'lever' | 'hammer' | ViewAnimation;

/** How guns play in a game: the gun kit's options (`guns(options)` on the host, and on each screen). */
export interface GunOptions {
  /** Aiming down the sights slows the holder to the gun's `aim.move`. Default true. */
  aimSlows?: boolean;
  /** Aiming down the sights stops a sprint, and so does holding the trigger. Both default true. */
  aimStopsSprint?: boolean;
  fireStopsSprint?: boolean;
  /** An empty gun reloads by itself. Default true; off, it waits for R. */
  autoReload?: boolean;
  /**
   * How many shots a screen may get ahead of its gun's rate (3, at least 1). Lag bunches shots
   * up, so the host takes each one the gun could have fired give or take this many: lower is
   * stricter with a cheat that fires too fast, higher kinder to a poor connection.
   */
  rateSlack?: number;
  /** Aim assist's shape for every gun (see `AimAssist`); a gun's own `aim.assist` goes over it. */
  assist?: AimAssist;
}

/**
 * Aim assist's shape (controllers only). Over a target near the crosshair the stick turns slower,
 * and while the sticks move the view turns a little with the target as it (or you) moves.
 */
export interface AimAssist {
  /** 0 none, 1 strong. Default 0.6. */
  strength?: number;
  /**
   * Who's near enough the crosshair: within `radius` blocks of its line (1.1, about a body's
   * width round them), plus `angle` degrees more (about 1.43, so far-off targets get a little extra).
   */
  cone?: { radius?: number; angle?: number };
  /** How much the stick slows over a target at full strength: from the hip (0.45) and aiming down the sights (0.6). It eases off toward the cone's edge. */
  slow?: { hip?: number; aim?: number };
  /** How much of a target's movement the view turns with, at full strength: from the hip (0.4) and aiming (0.6). */
  follow?: { hip?: number; aim?: number };
}

export const DEG = Math.PI / 180;

/** A gun's rounds and what it's doing. The host keeps one per gun a player carries; their screen keeps its own the same way. */
export interface GunState {
  mag: number;
  reserve: number;
  /** Seconds left of the reload (a shotgun: of the round going in); -1 when not reloading. */
  reload: number;
  /** Seconds until it can fire again (the fire rate, a pump, a raise after switching). */
  cooldown: number;
  /** Shots so far: each shot's spread is seeded by it, the same on both sides. */
  serial: number;
  /** Extra spread from recent shots, in degrees. */
  bloom: number;
  /** Aimed down the sights, 0..1. */
  aim: number;
  /** Shots the host may still take from a client (it can't fire faster than the gun). */
  tokens: number;
}

/** A gun's settings with the defaults filled in. */
export interface Gun {
  def: GunItem;
  near: number;
  far: number;
  falloff: [number, number];
  headshot: number;
  range: number;
  pellets: number;
  interval: number;
  spread: { hip: number; aim: number; move: number; air: number; bloom: number };
  recoil: { up: number; side: number; recover: number };
  aim: { zoom: number; time: number; move: number; sight: 'iron' | 'dot' | 'holo' | 'scope'; color: string };
  reserve: number;
  mobility: number;
  /** What each bullet carves out of a destructible block it hits (null: nothing). */
  carve: { radius: number; depth: number } | null;
  /** Wall-banging (`penetration`): how much material a bullet goes through, and what it loses a block (null: none). */
  penetration: { depth: number; loss: number } | null;
}

/** A bullet's carve unless the gun says (`GunItem.carve`): about seven on one spot hole a block. */
export const DEFAULT_CARVE = { radius: 0.1, depth: 0.05 };

const cache = new WeakMap<GunItem, Gun>();

export function gun(def: GunItem): Gun {
  let g = cache.get(def);
  if (g) return g;
  const [near, far] = typeof def.damage === 'number' ? [def.damage, def.damage] : def.damage;
  g = {
    def,
    near,
    far,
    falloff: def.falloff ?? [20, 50],
    headshot: def.headshot ?? 1.5,
    range: def.range ?? 150,
    pellets: Math.max(1, Math.floor(def.pellets ?? 1)),
    interval: 60 / Math.max(1, def.rpm),
    spread: { hip: 2.5, aim: 0.25, move: 1.5, air: 3, bloom: 0.35, ...def.spread },
    recoil: { up: 1, side: 0.35, recover: 0.75, ...def.recoil },
    aim: { zoom: def.aim?.zoom ?? 1.3, time: def.aim?.time ?? 0.2, move: def.aim?.move ?? 0.6, sight: def.aim?.sight ?? 'iron', color: def.aim?.color ?? '#ff2a2a' },
    reserve: def.reserve ?? def.magazine * 3,
    mobility: def.mobility ?? 1,
    carve: def.carve === false ? null : { radius: Math.max(0, def.carve?.radius ?? DEFAULT_CARVE.radius), depth: Math.max(0, def.carve?.depth ?? DEFAULT_CARVE.depth) },
    penetration: def.penetration && def.penetration.depth > 0 ? { depth: Math.min(8, def.penetration.depth), loss: Math.min(1, Math.max(0, def.penetration.damageLoss ?? 0.4)) } : null,
  };
  cache.set(def, g);
  return g;
}

export const isGun = (d: { kind: string } | undefined): d is GunItem => d?.kind === 'gun';

export function freshGun(def: GunItem): GunState {
  const g = gun(def);
  return { mag: def.magazine, reserve: g.reserve, reload: -1, cooldown: 0, serial: 0, bloom: 0, aim: 0, tokens: 2 };
}

/** Seconds a gun takes to come up after switching to it (no firing meanwhile). */
export const RAISE = 0.35;

/**
 * A game's gun rules (the gun kit's options, `GunOptions`) with the defaults filled in. The host's
 * half of the kit and each shooter's screen take the same options, so they agree.
 */
export interface GunRules {
  aimSlows: boolean;
  aimStopsSprint: boolean;
  fireStopsSprint: boolean;
  autoReload: boolean;
  rateSlack: number;
  /** The game's aim assist shape (each gun's goes over it: see `assistOf`). */
  assist: AimAssist;
}

/** A game's gun options, with the defaults filled in. */
export function resolveGunRules(o: GunOptions = {}): GunRules {
  return {
    aimSlows: o.aimSlows ?? true,
    aimStopsSprint: o.aimStopsSprint ?? true,
    fireStopsSprint: o.fireStopsSprint ?? true,
    autoReload: o.autoReload ?? true,
    rateSlack: Math.max(1, o.rateSlack ?? 3),
    assist: o.assist ?? {},
  };
}

export const DEFAULT_GUN_RULES = resolveGunRules();

/**
 * How holding a gun and the mouse change movement: its weight; aiming slows (to the gun's
 * `aim.move`) and stops sprinting, and so does firing, unless the game's rules say otherwise.
 */
export function gunMove(def: GunItem, buttons: number, rules: GunRules = DEFAULT_GUN_RULES): ItemMove {
  const g = gun(def);
  const aiming = (buttons & 4) !== 0;
  const firing = (buttons & 1) !== 0;
  return { speed: g.mobility * (aiming && rules.aimSlows ? g.aim.move : 1), noSprint: (aiming && rules.aimStopsSprint) || (firing && rules.fireStopsSprint) };
}

/** Aim assist's shape with the defaults filled in (see `AimAssist`); `angle` in radians. */
export interface Assist {
  strength: number;
  radius: number;
  angle: number;
  slow: { hip: number; aim: number };
  follow: { hip: number; aim: number };
}

/** A gun's aim assist: its own `aim.assist` (a strength, or a shape) over the game's, over the defaults. */
export function assistOf(g: Gun, rules: GunRules): Assist {
  const a = g.def.aim?.assist;
  const own: AimAssist = typeof a === 'number' ? { strength: a } : (a ?? {});
  const game = rules.assist;
  const angle = own.cone?.angle ?? game.cone?.angle;
  return {
    strength: own.strength ?? game.strength ?? 0.6,
    radius: own.cone?.radius ?? game.cone?.radius ?? 1.1,
    angle: angle === undefined ? 0.025 : angle * DEG,
    slow: { hip: own.slow?.hip ?? game.slow?.hip ?? 0.45, aim: own.slow?.aim ?? game.slow?.aim ?? 0.6 },
    follow: { hip: own.follow?.hip ?? game.follow?.hip ?? 0.4, aim: own.follow?.aim ?? game.follow?.aim ?? 0.6 },
  };
}

/** The spread cone's half angle in degrees for a shot now. `moving` is 0..1 (a fraction of walking speed). */
export function spreadDeg(g: Gun, s: { aim: number; moving: number; air: boolean; crouch: boolean; bloom: number }): number {
  const sp = g.spread;
  let d = sp.hip + (sp.aim - sp.hip) * s.aim;
  d += Math.min(1, s.moving) * sp.move * (1 - 0.7 * s.aim);
  if (s.air) d += sp.air;
  if (s.crouch) d *= 0.8;
  return d + s.bloom;
}

/** After a shot: the bloom it adds (capped), in degrees. */
export function addBloom(g: Gun, bloom: number): number {
  return Math.min(g.spread.bloom * 8, bloom + g.spread.bloom);
}

/** Bloom settling between shots. */
export function settleBloom(g: Gun, bloom: number, dt: number): number {
  return Math.max(0, bloom - dt * Math.max(2, g.spread.bloom * 12));
}

/** Aiming down the sights moves toward held or not over the gun's aim time. */
export function stepAim(g: Gun, aim: number, held: boolean, dt: number): number {
  const k = dt / Math.max(0.05, g.aim.time);
  return held ? Math.min(1, aim + k) : Math.max(0, aim - k * 1.4);
}

/** A unit vector along yaw / pitch (yaw 0 looks toward -z). */
export function lookDir(yaw: number, pitch: number): Vec3 {
  const cp = Math.cos(pitch);
  return { x: -Math.sin(yaw) * cp, y: Math.sin(pitch), z: -Math.cos(yaw) * cp };
}

/** Small deterministic random numbers from a seed (the same on every machine). */
function rand(seed: number): () => number {
  let a = (seed * 2654435761) >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * The directions a shot's bullets go: spread evenly over the cone (a shotgun's pellets in rings,
 * a rifle's bullet anywhere in it), seeded by the shot's serial so the host and the shooter's
 * screen agree.
 */
export function pelletDirs(g: Gun, yaw: number, pitch: number, spread: number, serial: number): Vec3[] {
  const f = lookDir(yaw, pitch);
  // Right and up, perpendicular to the look.
  const r = { x: Math.cos(yaw), y: 0, z: -Math.sin(yaw) };
  const u = { x: f.y * r.z - f.z * r.y, y: f.z * r.x - f.x * r.z, z: f.x * r.y - f.y * r.x };
  const rnd = rand(serial + 1);
  const t = Math.tan(spread * DEG);
  const out: Vec3[] = [];
  const n = g.pellets;
  for (let i = 0; i < n; i++) {
    let a: number;
    let d: number;
    if (n === 1) {
      a = rnd() * Math.PI * 2;
      d = Math.sqrt(rnd());
    } else {
      // A spread pattern: a pellet near the middle, the rest round a ring, all a little jittered.
      a = (i / n) * Math.PI * 2 + rnd() * 0.6;
      d = i === 0 ? rnd() * 0.25 : 0.55 + rnd() * 0.45;
    }
    const ox = Math.cos(a) * d * t;
    const oy = Math.sin(a) * d * t;
    const x = f.x + r.x * ox + u.x * oy;
    const y = f.y + r.y * ox + u.y * oy;
    const z = f.z + r.z * ox + u.z * oy;
    const l = Math.hypot(x, y, z);
    out.push({ x: x / l, y: y / l, z: z / l });
  }
  return out;
}

/** A bullet's damage at a distance, and on the head. */
export function damageAt(g: Gun, dist: number, head: boolean, through = 0): number {
  const [a, b] = g.falloff;
  const k = b > a ? Math.min(1, Math.max(0, (dist - a) / (b - a))) : dist >= b ? 1 : 0;
  // Through a wall, less for each block of it.
  const wall = through > 0 && g.penetration ? Math.max(0, 1 - g.penetration.loss * through) : 1;
  return (g.near + (g.far - g.near) * k) * (head ? g.headshot : 1) * wall;
}

/** A reload makes sense: not already reloading, room in the magazine, rounds to spare. */
export function canReload(g: Gun, s: GunState): boolean {
  return s.reload < 0 && s.mag < g.def.magazine && s.reserve > 0;
}

export function startReload(g: Gun, s: GunState) {
  s.reload = g.def.reload;
}

/**
 * The reload goes on: a magazine goes in at the end; a shotgun loads a round at a time and keeps
 * going until it's full, out of rounds, or the trigger's pulled. True when rounds went in.
 */
export function stepReload(g: Gun, s: GunState, dt: number, trigger: boolean): boolean {
  if (s.reload < 0) return false;
  s.reload -= dt;
  if (s.reload > 0) return false;
  if (g.def.shells) {
    s.mag++;
    s.reserve--;
    s.reload = s.mag < g.def.magazine && s.reserve > 0 && !trigger ? s.reload + g.def.reload : -1;
  } else {
    const n = Math.min(g.def.magazine - s.mag, s.reserve);
    s.mag += n;
    s.reserve -= n;
    s.reload = -1;
  }
  return true;
}

/**
 * What a player's own screen gets from the gun kit (`me.items.gun`), when there's anything to say:
 * how fast they reload, a multiple of each gun's own pace (`Guns.setReloadSpeed`; 1 when unsaid),
 * so the screen reloads as fast as the host does.
 */
export interface GunOwn {
  reloadSpeed: number;
}

/** A held gun as everyone's screen has it (`hand.state`): its rounds, a reload, its last shot, how far it's aimed. */
export interface GunShown {
  mag: number;
  reserve: number;
  /** Seconds left of the reload (a shotgun's: of the round going in), -1 when not reloading. */
  reload: number;
  serial: number;
  aim: number;
}

/** A shot as other screens draw it (the `gun.shot` message): who fired what, and where each bullet ended (and what it hit). */
export interface ShotWire {
  by: string;
  item: string;
  /** Per bullet: [x, y, z, what it hit: 0 nothing, 1 a block, 2 someone], and the block's face and id. */
  ends: [number, number, number, number][];
  normals: ([number, number, number] | null)[];
  blocks: number[];
  /**
   * Per bullet, the walls it went through (wall-banging), if any did: each [in x, y, z, its face
   * x, y, z, out x, y, z, that face x, y, z, the block].
   */
  walls?: number[][][];
}
