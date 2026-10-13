import { Blueprint, type Vec3 } from '@platform';

/**
 * The course: ten stages of platforms floating in the void, laid out in a zig-zag that climbs
 * north-east from the start island. It's built once, from fixed numbers, so everyone runs the same
 * course and times compare.
 *
 * Stages are written in a local frame: `f` forward along the stage's heading, `l` sideways, `y` up.
 * Every jump is checked against the player's physics as it's laid (see `JUMP`), so a course that
 * builds is a course that can be run.
 */

/** What a block does when you stand on it. */
export type Kind = 'checkpoint' | 'pad' | 'crumble' | 'blinkA' | 'blinkB' | 'finish';

export interface Special {
  kind: Kind;
  /** Checkpoints: the stage this pad starts (0 = the start island). */
  stage?: number;
  /** Pads: the velocity they launch you with. */
  launch?: Vec3;
  /** Crumbling blocks: the platform they fall with. */
  group?: number;
}

export interface Cell {
  x: number;
  y: number;
  z: number;
  block: string;
}

export interface Stage {
  name: string;
  hint: string;
  /** Where you stand at this stage's checkpoint (feet), facing `yaw`, along the stage. */
  spawn: Vec3;
  yaw: number;
  /** Below this you've fallen off the stage. */
  fallY: number;
  /** Index of this stage's checkpoint in `waypoints`. */
  firstWaypoint: number;
}

/** A turret beside the Crossfire walkway that fires bolts across it. */
export interface Cannon {
  from: Vec3;
  dir: Vec3;
  period: number;
  offset: number;
  range: number;
}

export interface Waypoint extends Vec3 {
  stage: number;
}

export interface Course {
  stages: Stage[];
  blueprints: Blueprint[];
  /** Blocks that do something, by `key(x, y, z)`. */
  special: Map<string, Special>;
  /** Crumbling platforms, each the cells that fall together. */
  crumble: Cell[][];
  /** The two sets of blinking platforms. */
  blinkA: Cell[];
  blinkB: Cell[];
  cannons: Cannon[];
  /** The route, platform by platform (feet positions): for bots and tests. */
  waypoints: Waypoint[];
  /** The start island's top, `x0 <= x < x1` (the clock starts when you leave it). */
  start: { x0: number; x1: number; z0: number; z1: number; y: number };
  /** Where to stand once you've finished, and where the finish marker goes. */
  finish: Vec3;
  finishYaw: number;
}

export const key = (x: number, y: number, z: number) => `${x},${y},${z}`;

/** How far you can jump (see `check`), by how much higher you land (see `world.rs`: jump 9 m/s, gravity 32, sprint 5.6 m/s). */
const JUMP = { up: 2, level: 3, down1: 3.6, down: 4 };

/** Launch pads: straight up and a little forward (+4 blocks), and the long leap at the end. */
const PAD_UP = 17;
const PAD_FORWARD = 6;
const LEAP_UP = 14;
const LEAP_FORWARD = 12;

type Heading = 'east' | 'north';
const HEADINGS: Record<Heading, { fx: number; fz: number }> = { east: { fx: 1, fz: 0 }, north: { fx: 0, fz: 1 } };

interface Rect {
  f0: number;
  f1: number;
  l0: number;
  l1: number;
  y: number;
  /** The platform throws you (pads): the next jump isn't a jump. */
  launches?: boolean;
}

interface HopOptions {
  /** Air blocks between the last platform and this one (0 = right next to it). */
  g: number;
  dy?: number;
  /** Length along the stage and width across it. */
  len?: number;
  width?: number;
  /** Sideways shift from where you leave the last platform. */
  lat?: number;
  block: string;
  special?: Special;
  /** Crumbling: its own group. */
  crumble?: boolean;
}

class Builder {
  readonly cells = new Map<string, Cell & { stage: number }>();
  readonly special = new Map<string, Special>();
  readonly crumble: Cell[][] = [];
  readonly blinkA: Cell[] = [];
  readonly blinkB: Cell[] = [];
  readonly cannons: Cannon[] = [];
  readonly waypoints: Waypoint[] = [];
  readonly stages: Stage[] = [];
  stage = 0;
  private ox = 0;
  private oz = 0;
  private fx = 1;
  private fz = 0;
  last: Rect = { f0: 0, f1: 0, l0: 0, l1: 0, y: 0 };
  /** Where across the last platform you leave it. */
  exitL = 0;

  /** World cell of a local cell. The sideways axis is the heading turned left. */
  at(f: number, l: number) {
    return { x: this.ox + f * this.fx - l * this.fz, z: this.oz + f * this.fz + l * this.fx };
  }

  get forward(): Vec3 {
    return { x: this.fx, y: 0, z: this.fz };
  }

  get left(): Vec3 {
    return { x: -this.fz, y: 0, z: this.fx };
  }

  set(f: number, y: number, l: number, block: string, special?: Special) {
    const { x, z } = this.at(f, l);
    this.put(x, y, z, block, special);
  }

  put(x: number, y: number, z: number, block: string, special?: Special) {
    const k = key(x, y, z);
    this.cells.set(k, { x, y, z, block, stage: this.stage });
    if (special) this.special.set(k, special);
    else this.special.delete(k);
  }

  has(f: number, y: number, l: number) {
    const { x, z } = this.at(f, l);
    return this.cells.has(key(x, y, z));
  }

  waypoint(f: number, l: number, y: number) {
    const { x, z } = this.at(f, l);
    this.waypoints.push({ x: x + 0.5, y: y + 1, z: z + 0.5, stage: this.stage });
  }

  /** Face a new way from the middle of the platform at local (f, l). */
  turn(f: number, l: number, heading: Heading) {
    const c = this.at(f, l);
    this.ox = c.x;
    this.oz = c.z;
    ({ fx: this.fx, fz: this.fz } = HEADINGS[heading]);
  }

  /**
   * Check a jump from the last platform to `to` is one a player can make. The gap is measured
   * between the middles of the nearest blocks, less one: what a runner actually covers, so a
   * diagonal hop counts for more than a straight one over the same number of air blocks.
   */
  check(to: Rect, what: string) {
    const from = this.last;
    if (from.launches) return;
    const df = Math.max(0, to.f0 - from.f1, from.f0 - to.f1);
    const dl = Math.max(0, to.l0 - from.l1, from.l0 - to.l1);
    const gap = Math.hypot(df, dl) - 1;
    const dy = to.y - from.y;
    const max = dy >= 2 ? -1 : dy === 1 ? JUMP.up : dy === 0 ? JUMP.level : dy === -1 ? JUMP.down1 : JUMP.down;
    if (gap > max) throw new Error(`obby: stage ${this.stage + 1} ${what}: a ${gap.toFixed(1)}-block gap rising ${dy} can't be jumped`);
  }

  /** A platform ahead of the last one. */
  hop(o: HopOptions): Rect {
    const len = o.len ?? 1;
    const width = o.width ?? 1;
    const f0 = this.last.f1 + 1 + o.g;
    const lc = this.exitL + (o.lat ?? 0);
    const half = (width - 1) / 2;
    const r: Rect = { f0, f1: f0 + len - 1, l0: lc - Math.floor(half), l1: lc + Math.ceil(half), y: this.last.y + (o.dy ?? 0) };
    this.check(r, `hop to f${f0}`);
    let group: Cell[] | undefined;
    if (o.crumble) this.crumble.push((group = []));
    for (let f = r.f0; f <= r.f1; f++)
      for (let l = r.l0; l <= r.l1; l++) {
        const special = o.crumble ? { kind: 'crumble' as const, group: this.crumble.length - 1 } : o.special;
        this.set(f, r.y, l, o.block, special);
        const { x, z } = this.at(f, l);
        const cell = { x, y: r.y, z, block: o.block };
        group?.push(cell);
        if (special?.kind === 'blinkA') this.blinkA.push(cell);
        if (special?.kind === 'blinkB') this.blinkB.push(cell);
      }
    if (len > 1) {
      this.waypoint(r.f0, lc, r.y);
      this.waypoint(r.f1, lc, r.y);
    } else {
      this.waypoint(r.f0, lc, r.y);
    }
    r.launches = o.special?.kind === 'pad';
    this.last = r;
    this.exitL = lc;
    return r;
  }

  /** A beam running sideways: jump onto its near end, walk along it, leave from the far end. */
  sideBeam(o: { g: number; dy?: number; length: number; side: 1 | -1; block: string }) {
    const f = this.last.f1 + 1 + o.g;
    const a = this.exitL;
    const b = this.exitL + o.side * (o.length - 1);
    const r: Rect = { f0: f, f1: f, l0: Math.min(a, b), l1: Math.max(a, b), y: this.last.y + (o.dy ?? 0) };
    this.check(r, `beam at f${f}`);
    for (let l = r.l0; l <= r.l1; l++) this.set(f, r.y, l, o.block);
    this.waypoint(f, a, r.y);
    this.waypoint(f, b, r.y);
    this.last = r;
    this.exitL = b;
  }

  /** A pad that launches you along the stage. */
  pad(o: { g: number; width: number; up: number; forward: number; block?: string }) {
    const fw = this.forward;
    return this.hop({
      g: o.g,
      width: o.width,
      block: o.block ?? 'sea_lantern',
      special: { kind: 'pad', launch: { x: fw.x * o.forward, y: o.up, z: fw.z * o.forward } },
    });
  }

  /**
   * The checkpoint that ends this stage and starts the next: a 5×5 pad with a glowing heart, and
   * a stub of rock under it like a little sky island. The next stage heads off `heading`.
   */
  checkpoint(o: { g: number; dy?: number; lat?: number; heading: Heading; name: string; hint: string }) {
    const f0 = this.last.f1 + 1 + o.g;
    const fc = f0 + 2;
    const lc = this.exitL + (o.lat ?? 0);
    const y = this.last.y + (o.dy ?? 0);
    const r: Rect = { f0, f1: f0 + 4, l0: lc - 2, l1: lc + 2, y };
    this.check(r, 'checkpoint');
    this.stage++;
    const special: Special = { kind: 'checkpoint', stage: this.stage };
    for (let f = r.f0; f <= r.f1; f++)
      for (let l = r.l0; l <= r.l1; l++) {
        const inner = Math.abs(f - fc) <= 1 && Math.abs(l - lc) <= 1;
        this.set(f, y, l, inner ? 'glowstone' : 'stone_bricks', special);
        if (Math.abs(f - fc) <= 1 && Math.abs(l - lc) <= 1) this.set(f, y - 1, l, 'stone');
      }
    this.set(fc, y - 2, lc, 'stone');
    this.waypoint(fc, lc, y);
    this.beginStage(fc, lc, y, o.heading, o.name, o.hint);
  }

  beginStage(fc: number, lc: number, y: number, heading: Heading, name: string, hint: string) {
    this.turn(fc, lc, heading);
    this.last = { f0: -2, f1: 2, l0: -2, l1: 2, y };
    this.exitL = 0;
    const c = this.at(0, 0);
    this.stages.push({
      name,
      hint,
      spawn: { x: c.x + 0.5, y: y + 1, z: c.z + 0.5 },
      yaw: Math.atan2(-this.fx, -this.fz),
      fallY: 0,
      firstWaypoint: this.waypoints.length - 1,
    });
  }

  /** Per-stage blueprints (each just big enough), and how low you can fall on each stage. */
  finish() {
    const bounds = new Map<number, { x0: number; x1: number; y0: number; y1: number; z0: number; z1: number }>();
    for (const c of this.cells.values()) {
      const b = bounds.get(c.stage);
      if (!b) bounds.set(c.stage, { x0: c.x, x1: c.x, y0: c.y, y1: c.y, z0: c.z, z1: c.z });
      else {
        b.x0 = Math.min(b.x0, c.x);
        b.x1 = Math.max(b.x1, c.x);
        b.y0 = Math.min(b.y0, c.y);
        b.y1 = Math.max(b.y1, c.y);
        b.z0 = Math.min(b.z0, c.z);
        b.z1 = Math.max(b.z1, c.z);
      }
    }
    const blueprints = [...bounds.entries()].map(([stage, b]) => {
      const bp = new Blueprint({ x: b.x0, y: b.y0, z: b.z0 }, { x: b.x1 - b.x0 + 1, y: b.y1 - b.y0 + 1, z: b.z1 - b.z0 + 1 });
      for (const c of this.cells.values()) if (c.stage === stage) bp.set(c.x, c.y, c.z, c.block);
      return bp;
    });
    this.stages.forEach((s, i) => {
      // Lowest platform on the stage (not the rock under it).
      let low = s.spawn.y - 1;
      for (const w of this.waypoints) if (w.stage === i) low = Math.min(low, w.y - 1);
      s.fallY = low - 8;
    });
    return blueprints;
  }
}

const START_Y = 80;

function build(): Course {
  const b = new Builder();

  // The start island: grass, a few flowers, and rock tapering away underneath.
  b.turn(0, 0, 'east');
  for (let r = 0; r <= 4; r++) {
    const y = START_Y - r;
    const half = 4 - r;
    for (let f = -half; f <= half; f++)
      for (let l = -half; l <= half; l++) {
        const block = r === 0 ? 'grass_block' : r === 1 ? 'dirt' : 'stone';
        b.set(f, y, l, block, r === 0 ? { kind: 'checkpoint', stage: 0 } : undefined);
      }
  }
  for (const [f, l, flower] of [
    [-3, -3, 'poppy'],
    [-3, 3, 'dandelion'],
    [-4, 0, 'cornflower'],
    [2, -4, 'poppy'],
    [1, 4, 'dandelion'],
  ] as const)
    b.set(f, START_Y + 1, l, flower);
  b.waypoint(0, 0, START_Y);
  b.beginStage(0, 0, START_Y, 'east', 'First Steps', 'Sprint (Ctrl or double-tap W) and jump the gaps');
  b.last = { f0: -4, f1: 4, l0: -4, l1: 4, y: START_Y };

  // 1. First Steps: wide planks, short gaps.
  const planks = 'oak_planks';
  b.hop({ g: 1, len: 2, width: 3, block: planks });
  b.hop({ g: 2, len: 2, width: 3, lat: 1, block: planks });
  b.hop({ g: 1, dy: 1, len: 2, width: 3, block: planks });
  b.hop({ g: 2, width: 3, lat: -1, block: planks });
  b.hop({ g: 2, len: 2, width: 3, block: planks });
  b.hop({ g: 1, dy: 1, width: 3, lat: 1, block: planks });
  b.hop({ g: 2, len: 2, width: 3, lat: -1, block: planks });
  b.hop({ g: 3, len: 3, width: 3, block: planks });
  b.checkpoint({ g: 2, heading: 'north', name: 'The Climb', hint: 'Single blocks, one step higher each time' });

  // 2. The Climb: single blocks, up one each.
  const bricks = 'stone_bricks';
  b.hop({ g: 1, dy: 1, block: bricks });
  b.hop({ g: 1, dy: 1, lat: 1, block: bricks });
  b.hop({ g: 2, dy: 1, block: bricks });
  b.hop({ g: 1, dy: 1, lat: -1, block: bricks });
  b.hop({ g: 1, dy: 1, lat: -1, block: bricks });
  b.hop({ g: 2, block: bricks });
  b.hop({ g: 1, dy: 1, lat: 1, block: bricks });
  b.hop({ g: 1, dy: 1, block: bricks });
  b.hop({ g: 1, dy: 1, lat: 1, block: bricks });
  b.hop({ g: 1, dy: 1, block: bricks });
  b.checkpoint({ g: 2, lat: -1, heading: 'east', name: 'Balance Beams', hint: 'Hold Shift to sneak: you won’t walk off an edge' });

  // 3. Balance Beams: one block wide, some running sideways.
  const beam = 'birch_planks';
  b.hop({ g: 1, len: 5, block: beam });
  b.hop({ g: 2, len: 4, lat: 2, block: beam });
  b.sideBeam({ g: 1, length: 5, side: 1, block: beam });
  b.hop({ g: 2, len: 4, block: beam });
  b.hop({ g: 1, dy: 1, len: 3, lat: -1, block: beam });
  b.sideBeam({ g: 2, length: 5, side: -1, block: beam });
  b.hop({ g: 2, len: 5, block: beam });
  b.hop({ g: 2, dy: -1, len: 3, lat: 1, block: beam });
  b.checkpoint({ g: 2, lat: 1, heading: 'north', name: 'Floor is Lava', hint: 'Posts in a lava lake. Don’t touch the lava.' });

  // 4. Floor is Lava: posts standing in a lava lake.
  const lavaY = b.last.y;
  const lavaFrom = b.last.f1 + 1;
  const posts: Rect[] = [];
  const post = (o: Omit<HopOptions, 'block'>) => posts.push(b.hop({ ...o, block: 'stone_bricks' }));
  post({ g: 2 });
  post({ g: 1, lat: 1 });
  post({ g: 2, lat: 1 });
  post({ g: 2, lat: -1 });
  post({ g: 3 });
  post({ g: 1, dy: 1 });
  post({ g: 2, lat: -1 });
  post({ g: 2, lat: -1 });
  post({ g: 1, dy: -1, lat: 1 });
  post({ g: 2 });
  post({ g: 3 });
  const lavaTo = b.last.f1 + 2;
  const lavaL0 = Math.min(...posts.map((p) => p.l0)) - 2;
  const lavaL1 = Math.max(...posts.map((p) => p.l1)) + 2;
  for (const p of posts) for (let y = lavaY - 1; y < p.y; y++) b.set(p.f0, y, p.l0, 'stone_bricks');
  for (let f = lavaFrom; f <= lavaTo; f++)
    for (let l = lavaL0; l <= lavaL1; l++) {
      if (!b.has(f, lavaY - 1, l)) b.set(f, lavaY - 1, l, 'lava');
      b.set(f, lavaY - 2, l, 'obsidian');
    }
  b.checkpoint({ g: 1, heading: 'east', name: 'Crumble', hint: 'Keep moving: the sand gives way under you' });

  // 5. Crumble: sand that falls a moment after you land on it, and comes back later.
  const sand = { block: 'sand', crumble: true };
  b.hop({ g: 1, len: 2, ...sand });
  b.hop({ g: 2, lat: 1, ...sand });
  b.hop({ g: 2, len: 2, ...sand });
  b.hop({ g: 1, dy: 1, lat: -1, ...sand });
  b.hop({ g: 2, ...sand });
  b.hop({ g: 2, len: 2, lat: 1, ...sand });
  b.hop({ g: 3, ...sand });
  b.hop({ g: 1, dy: 1, ...sand });
  b.hop({ g: 2, len: 2, lat: -1, ...sand });
  b.hop({ g: 2, ...sand });
  b.checkpoint({ g: 2, heading: 'north', name: 'Bounce', hint: 'Step on the glowing pads to launch up to the next ledge' });

  // 6. Bounce: launch pads up a staircase of ledges, four blocks at a time.
  const ledge = 'white_concrete';
  b.hop({ g: 1, len: 3, width: 3, block: ledge });
  for (let i = 0; i < 3; i++) {
    b.pad({ g: 0, width: 3, up: PAD_UP, forward: PAD_FORWARD });
    b.hop({ g: 2, dy: 4, len: 3, width: 3, block: ledge });
  }
  b.hop({ g: 0, len: 2, width: 3, block: ledge });
  b.checkpoint({ g: 2, heading: 'east', name: 'Blink', hint: 'Red and blue take turns. Glass means it’s about to vanish.' });

  // 7. Blink: red and blue platforms take turns to exist.
  const red = { block: 'red_wool', special: { kind: 'blinkA' as const } };
  const blue = { block: 'blue_wool', special: { kind: 'blinkB' as const } };
  b.hop({ g: 2, len: 2, width: 3, ...red });
  b.hop({ g: 2, len: 2, width: 3, lat: 1, ...blue });
  b.hop({ g: 2, len: 2, width: 3, ...red });
  b.hop({ g: 2, len: 2, width: 3, lat: -1, ...blue });
  b.hop({ g: 2, dy: 1, len: 2, width: 3, ...red });
  b.hop({ g: 2, len: 2, width: 3, ...blue });
  b.checkpoint({ g: 2, heading: 'north', name: 'The Spiral', hint: 'Round and round, and up' });

  // 8. The Spiral: a turn and a half round a sandstone tower, a block higher each step. Steps go
  // round the circle at an even stride (rounding every few degrees would bunch them up and spread
  // them out), starting on the near side and finishing on the far side, facing on. Taking the
  // first block at least 2 from the last means the next is never more than 2.83 away (one more
  // on each axis), a comfortable jump up.
  const base = b.last.y;
  const fc = b.last.f1 + 1 + 6;
  const lc = b.exitL;
  const radius = 4;
  const stride = 2;
  let prev: { f: number; l: number } | null = null;
  for (let a = Math.PI, i = 0; a <= 4 * Math.PI + 1e-9; a += 0.005) {
    const f = Math.floor(fc + 0.5 + Math.cos(a) * radius);
    const l = Math.floor(lc + 0.5 + Math.sin(a) * radius);
    if (prev && Math.hypot(f - prev.f, l - prev.l) < stride) continue;
    // Round the tower "ahead" changes with every step, so each is placed where it is, not hopped.
    const r: Rect = { f0: f, f1: f, l0: l, l1: l, y: base + 1 + i++ };
    b.check(r, `spiral step ${i}`);
    b.set(f, r.y, l, 'yellow_wool');
    b.waypoint(f, l, r.y);
    b.last = r;
    b.exitL = l;
    prev = { f, l };
  }
  const top = b.last.y + 2;
  for (let y = base - 3; y <= top; y++)
    for (let f = fc - 1; f <= fc + 1; f++) for (let l = lc - 1; l <= lc + 1; l++) b.set(f, y, l, (y - base) % 4 === 0 ? 'glowstone' : 'sandstone');
  b.checkpoint({ g: 2, lat: 0, heading: 'east', name: 'Crossfire', hint: 'Cannons fire across the walkway. Time your run.' });

  // 9. Crossfire: a walkway with cannons either side firing bolts across it.
  const walk = 'gray_concrete';
  const segs = [b.hop({ g: 1, len: 6, width: 3, block: walk }), b.hop({ g: 1, len: 6, width: 3, block: walk }), b.hop({ g: 1, len: 6, width: 3, block: walk })];
  const walkY = segs[0].y;
  const cannonAt = [
    { f: segs[0].f0 + 3, side: 1, period: 2.2, offset: 0 },
    { f: segs[1].f0 + 1, side: -1, period: 2.0, offset: 0.7 },
    { f: segs[1].f1, side: 1, period: 2.4, offset: 1.3 },
    { f: segs[2].f0 + 3, side: -1, period: 1.8, offset: 0.4 },
  ];
  for (const c of cannonAt) {
    const l = b.exitL + c.side * 6;
    for (let y = walkY - 2; y <= walkY + 3; y++) b.set(c.f, y, l, y === walkY + 2 ? 'glowstone' : 'obsidian');
    const m = b.at(c.f, l - c.side);
    const lv = b.left;
    b.cannons.push({
      from: { x: m.x + 0.5, y: walkY + 2.5, z: m.z + 0.5 },
      dir: { x: -lv.x * c.side, y: 0, z: -lv.z * c.side },
      period: c.period,
      offset: c.offset,
      range: 12,
    });
  }
  b.checkpoint({ g: 2, heading: 'north', name: 'Leap of Faith', hint: 'Run at the pad. Trust it.' });

  // 10. Leap of Faith: a runway, a launch pad, and a long flight down to the finish island.
  b.hop({ g: 2, len: 3, width: 3, block: 'white_concrete' });
  const leap = b.pad({ g: 0, width: 3, up: LEAP_UP, forward: LEAP_FORWARD });
  const islandY = leap.y - 3;
  const f0 = leap.f1 + 5;
  const f1 = f0 + 10;
  const ic = b.exitL;
  for (let r = 0; r <= 5; r++) {
    const y = islandY - r;
    for (let f = f0 + r; f <= f1 - r; f++)
      for (let l = ic - 5 + r; l <= ic + 5 - r; l++)
        b.set(f, y, l, r === 0 ? 'grass_block' : r === 1 ? 'dirt' : 'stone', r === 0 ? { kind: 'finish' } : undefined);
  }
  // A glowing post at each corner: the finish gate.
  for (const [f, l] of [
    [f0, ic - 5],
    [f0, ic + 5],
    [f1, ic - 5],
    [f1, ic + 5],
  ])
    for (let y = islandY + 1; y <= islandY + 3; y++) b.set(f, y, l, y === islandY + 3 ? 'glowstone' : 'stone_bricks');
  const mid = Math.floor((f0 + f1) / 2);
  b.waypoint(mid, ic, islandY);
  const fin = b.at(mid, ic);

  const blueprints = b.finish();
  return {
    stages: b.stages,
    blueprints,
    special: b.special,
    crumble: b.crumble,
    blinkA: b.blinkA,
    blinkB: b.blinkB,
    cannons: b.cannons,
    waypoints: b.waypoints,
    start: { x0: -4, x1: 5, z0: -4, z1: 5, y: START_Y },
    finish: { x: fin.x + 0.5, y: islandY + 1, z: fin.z + 0.5 },
    finishYaw: b.stages[b.stages.length - 1].yaw,
  };
}

export const course = build();
