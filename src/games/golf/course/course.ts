import { BASE, CHUNK, CUP_R, LAYERS, WATER, YARD, lerp, mulberry, noise2, smooth, yawOf } from '../scale';
import { Surf, type GreenSpec, type HazardSpec, type HoleSpec, type Tree } from './types';

/**
 * The course as the ball, the cart and the builder see it: a landscape worked out from the holes'
 * specs (`holes.ts`) by plain arithmetic, the same on the server and every screen. `sample(x, z)`
 * is the ground at any point: its height (smooth: the ball rolls on it, the greens' slopes are
 * real) and what it is (fairway, green, bunker…). The world's blocks are this, rounded to half
 * blocks (`build.ts`), so the ball, drawn on the blocks, rolls where they are.
 */

/** A leg of a hole's line of play. */
interface Leg {
  ax: number;
  az: number;
  /** Its direction (unit) and the right of it. */
  dx: number;
  dz: number;
  len: number;
  /** How far along the hole it starts. */
  v0: number;
}

/** An ellipse on the ground (a bunker, a pond): its middle, its axes (unit), radii in blocks. */
interface Blob {
  x: number;
  z: number;
  ex: number;
  ez: number;
  ra: number;
  rc: number;
  depth: number;
  seed: number;
}

interface Green {
  x: number;
  z: number;
  /** The line of play's direction at the green (unit) and the green's own axis (turned). */
  dx: number;
  dz: number;
  ex: number;
  ez: number;
  ra: number;
  rc: number;
  /** Height at its middle (before tilt and bumps), and the tilt: rise per block back and right. */
  base: number;
  back: number;
  right: number;
  bumps: { a: number; c: number; h: number; r2: number }[];
  pin: { x: number; z: number; y: number };
  seed: number;
}

export interface Hole {
  index: number;
  spec: HoleSpec;
  name: string;
  par: 3 | 4 | 5;
  /** The line of play's length (blocks) and in yards. */
  len: number;
  yards: number;
  legs: Leg[];
  /** Where the ball is teed (world), and the tee box's height. */
  tee: { x: number; z: number; y: number; yaw: number };
  green: Green;
  bunkers: Blob[];
  ponds: Blob[];
  creek: { v: number; half: number; tan: number } | null;
  /** Half the corridor's width (fairway, rough and the woods along it), blocks. */
  half: number;
  /** The box it shapes (world). */
  box: { x0: number; z0: number; x1: number; z1: number };
  /** Where the cart path runs: which side, and the carts' parking spot by the tee and by the green. */
  side: 1 | -1;
  cartTee: { x: number; z: number; yaw: number };
  cartGreen: { x: number; z: number; yaw: number };
  /** Elevation along the way: [v (blocks), height over the plain]. */
  elev: [number, number][];
  fwFrom: number;
  widths: [number, number][] | null;
  shifts: [number, number][];
}

/** What `sample` found at a point (reused: copy what you keep). */
export interface Ground {
  /** Height of the ground (smooth), and what it is. */
  y: number;
  surf: Surf;
  /** The hole whose ground it is (-1 off every hole), and where along it / across it (blocks). */
  hole: number;
  v: number;
  u: number;
}

/** The ranks of surfaces where two holes' grounds meet: the more particular wins. */
const RANK: readonly number[] = [0, 1, 1, 3, 5, 6, 5, 7, 8, 4];

const FRINGE = 1.4;
const TEE_HALF = { a: 4.5, c: 3.5 };
const PATH_HALF = 1.3;

export class Course {
  readonly holes: Hole[];
  readonly trees: Tree[] = [];
  /** The trees, by cell of 16 blocks. */
  private treeCells = new Map<number, Tree[]>();
  /** The world box the course shapes (every hole's), and where it's in bounds. */
  readonly box: { x0: number; z0: number; x1: number; z1: number };
  private scratch: Ground = { y: 0, surf: Surf.Out, hole: -1, v: 0, u: 0 };

  constructor(specs: HoleSpec[], seed = 7) {
    this.holes = specs.map((s, i) => makeHole(s, i));
    const b = { x0: Infinity, z0: Infinity, x1: -Infinity, z1: -Infinity };
    for (const h of this.holes) {
      b.x0 = Math.min(b.x0, h.box.x0);
      b.z0 = Math.min(b.z0, h.box.z0);
      b.x1 = Math.max(b.x1, h.box.x1);
      b.z1 = Math.max(b.z1, h.box.z1);
    }
    this.box = b;
    // Pins at whole blocks: the cup's block sits flush in the green.
    for (const h of this.holes) settleGreen(h, this);
    for (const h of this.holes) h.tee.y = this.ground(h.tee.x, h.tee.z).y;
    this.plantTrees(seed);
  }

  // -------------------------------------------------------------------------------------------
  // The ground
  // -------------------------------------------------------------------------------------------

  /** The ground at (x, z): its smooth height and what it is. The object is reused: copy what you keep. */
  ground(x: number, z: number, out: Ground = this.scratch): Ground {
    let wsum = 0;
    let hsum = 0;
    let best = -1;
    let surf: Surf = Surf.Out;
    let bv = 0;
    let bu = 0;
    let bw = 0;
    for (const h of this.holes) {
      if (x < h.box.x0 || x > h.box.x1 || z < h.box.z0 || z > h.box.z1) continue;
      const s = sampleHole(h, x, z);
      if (s.w <= 0) continue;
      wsum += s.w;
      hsum += s.w * (s.y - BASE);
      if (best < 0 || RANK[s.surf] > RANK[surf] || (RANK[s.surf] === RANK[surf] && s.w > bw)) {
        best = h.index;
        surf = s.surf;
        bv = s.v;
        bu = s.u;
        bw = s.w;
      }
    }
    out.y = BASE + (wsum > 1 ? hsum / wsum : hsum);
    out.surf = best < 0 ? Surf.Out : surf;
    out.hole = best;
    out.v = bv;
    out.u = bu;
    return out;
  }

  height(x: number, z: number): number {
    return this.ground(x, z).y;
  }

  /** The slope: how much the ground rises per block east (x) and south (z). */
  slope(x: number, z: number, out = { x: 0, z: 0 }) {
    const e = 0.2;
    out.x = (this.height(x + e, z) - this.height(x - e, z)) / (2 * e);
    out.z = (this.height(x, z + e) - this.height(x, z - e)) / (2 * e);
    return out;
  }

  /**
   * The top of the blocks in the column at (x, z), what feet stand on: the smooth height (at the
   * column's middle) rounded to an eighth of a block. The ground as drawn is the smooth height.
   */
  blockTop(x: number, z: number): number {
    return Math.round(this.height(Math.floor(x) + 0.5, Math.floor(z) + 0.5) * LAYERS) / LAYERS;
  }

  /**
   * The squares the course is drawn in (`CHUNK` blocks a side), over its whole box: each with its
   * corner, and whether any hole shapes it (else it's the flat plain, trees and all).
   */
  get chunks(): { id: string; x0: number; z0: number; shaped: boolean }[] {
    if (this.chunkList) return this.chunkList;
    const list: { id: string; x0: number; z0: number; shaped: boolean }[] = [];
    const b = this.box;
    for (let cz = Math.floor(b.z0 / CHUNK); cz <= Math.floor(b.z1 / CHUNK); cz++)
      for (let cx = Math.floor(b.x0 / CHUNK); cx <= Math.floor(b.x1 / CHUNK); cx++) {
        const x0 = cx * CHUNK;
        const z0 = cz * CHUNK;
        const shaped = this.holes.some((h) => h.box.x0 < x0 + CHUNK && h.box.x1 > x0 && h.box.z0 < z0 + CHUNK && h.box.z1 > z0);
        list.push({ id: `golf_chunk_${cx}_${cz}`, x0, z0, shaped });
      }
    return (this.chunkList = list);
  }
  private chunkList: { id: string; x0: number; z0: number; shaped: boolean }[] | null = null;

  /** In bounds: on some hole's ground (its corridor and a margin round it). */
  inBounds(x: number, z: number): boolean {
    for (const h of this.holes) {
      if (x < h.box.x0 || x > h.box.x1 || z < h.box.z0 || z > h.box.z1) continue;
      const p = project(h, x, z);
      if (Math.abs(p.u) < h.half + 20 && p.v > -30 && p.v < h.len + 38) return true;
    }
    return false;
  }

  // -------------------------------------------------------------------------------------------
  // Trees
  // -------------------------------------------------------------------------------------------

  /** The trees near (x, z) (within about 16 blocks). */
  treesNear(x: number, z: number): Tree[] {
    const out: Tree[] = [];
    const cx = Math.floor(x / 16);
    const cz = Math.floor(z / 16);
    for (let i = -1; i <= 1; i++)
      for (let j = -1; j <= 1; j++) {
        const list = this.treeCells.get(cellKey(cx + i, cz + j));
        if (list) out.push(...list);
      }
    return out;
  }

  private addTree(t: Tree) {
    this.trees.push(t);
    const k = cellKey(Math.floor(t.x / 16), Math.floor(t.z / 16));
    let list = this.treeCells.get(k);
    if (!list) this.treeCells.set(k, (list = []));
    list.push(t);
  }

  /** Room for a tree at (x, z): off everything that's played on, and not in another tree. */
  private roomFor(x: number, z: number, gap: number): boolean {
    const g = this.ground(x, z);
    if (g.surf !== Surf.Deep && g.surf !== Surf.Out && g.surf !== Surf.Rough) return false;
    for (const h of this.holes) {
      if (x < h.box.x0 - 10 || x > h.box.x1 + 10 || z < h.box.z0 - 10 || z > h.box.z1 + 10) continue;
      if (Math.hypot(x - h.tee.x, z - h.tee.z) < 11) return false;
      if (Math.hypot(x - h.green.x, z - h.green.z) < Math.max(h.green.ra, h.green.rc) + 9) return false;
      for (const b of [...h.bunkers, ...h.ponds]) if (blobDist(b, x, z) < 1.7) return false;
      const p = project(h, x, z);
      if (p.v > -12 && p.v < h.len + 12) {
        if (Math.abs(p.u - pathU(h, p.v)) < 4.5) return false;
        const fw = fairwayHalf(h, p.v);
        if (fw > 0 && Math.abs(p.u - fairwayShift(h, p.v)) < fw + 5) return false;
      }
      if (Math.hypot(x - h.cartTee.x, z - h.cartTee.z) < 6 || Math.hypot(x - h.cartGreen.x, z - h.cartGreen.z) < 6) return false;
    }
    for (const t of this.treesNear(x, z)) if (Math.hypot(t.x - x, t.z - z) < gap) return false;
    return true;
  }

  private plantTrees(seed: number) {
    const rnd = mulberry(seed * 7919 + 17);
    const kinds = (h: Hole, r: number): Tree['kind'] => {
      // Each hole has its own mix: parkland oaks, birch groves, spruce on the far holes.
      const mix = [0.75, 0.2, 0.05, 0.55, 0.35, 0.1, 0.4, 0.2, 0.4][h.index % 9];
      return r < mix ? 'oak' : r < mix + (1 - mix) * 0.55 ? 'birch' : 'spruce';
    };
    const plant = (h: Hole, x: number, z: number, gap: number) => {
      if (!this.roomFor(x, z, gap)) return;
      const kind = kinds(h, rnd());
      const base = this.height(Math.floor(x) + 0.5, Math.floor(z) + 0.5);
      const t: Tree =
        kind === 'oak'
          ? { x: Math.floor(x) + 0.5, z: Math.floor(z) + 0.5, base, kind, trunk: 4 + Math.floor(rnd() * 2), cy: 0, r: 2.6, h: 1.9 }
          : kind === 'birch'
            ? { x: Math.floor(x) + 0.5, z: Math.floor(z) + 0.5, base, kind, trunk: 5 + Math.floor(rnd() * 2), cy: 0, r: 2.1, h: 1.9 }
            : { x: Math.floor(x) + 0.5, z: Math.floor(z) + 0.5, base, kind, trunk: 7 + Math.floor(rnd() * 3), cy: 0, r: 2.4, h: 3.4 };
      t.cy = kind === 'spruce' ? t.trunk * 0.62 : t.trunk + 0.3;
      this.addTree(t);
    };
    for (const h of this.holes) {
      const woods = h.spec.woods ?? 0.7;
      // The woods along both sides, from behind the tee to behind the green.
      for (let v = -18; v < h.len + 24; v += 3.2 + rnd() * 2.4) {
        for (const side of [-1, 1]) {
          if (rnd() > woods) continue;
          const fw = Math.max(fairwayHalf(h, v), 7);
          const u = fairwayShift(h, v) + side * (fw + 10 + rnd() * (h.half - fw - 4));
          const p = pointAt(h, v, u);
          plant(h, p.x, p.z, 4.2);
        }
      }
      // Now and then one standing out in the rough, and the architect's own.
      for (let v = 40; v < h.len - 20; v += 30 + rnd() * 40) {
        if (rnd() > 0.45 * woods) continue;
        const side = rnd() < 0.5 ? -1 : 1;
        const u = fairwayShift(h, v) + side * (fairwayHalf(h, v) + 6 + rnd() * 5);
        const p = pointAt(h, v, u);
        plant(h, p.x, p.z, 6);
      }
      for (const c of h.spec.trees ?? []) {
        const v = alongOf(h, c.at[0]);
        for (let i = 0; i < c.count; i++) {
          const a = rnd() * Math.PI * 2;
          const d = Math.sqrt(rnd()) * c.spread * YARD;
          const p = pointAt(h, v + Math.cos(a) * d, c.at[1] * YARD + Math.sin(a) * d);
          plant(h, p.x, p.z, 3.6);
        }
      }
    }
  }

  // -------------------------------------------------------------------------------------------
  // Holes
  // -------------------------------------------------------------------------------------------

  /** The pin of a hole (the cup's middle, on the green's surface). */
  pin(i: number) {
    return this.holes[i].green.pin;
  }

  /** Where along the hole and across it a point is (blocks). */
  frame(i: number, x: number, z: number) {
    const p = project(this.holes[i], x, z);
    return { v: p.v, u: p.u };
  }

  /** A point of a hole, by along and across (blocks). */
  point(i: number, v: number, u: number) {
    return pointAt(this.holes[i], v, u);
  }

  /** The yaw along a hole's line of play at `v`. */
  yawAt(i: number, v: number): number {
    const leg = legAt(this.holes[i], v);
    return yawOf(leg.dx, leg.dz);
  }

  /** How the green tilts at a point (for reading it): the ground's slope. */
  onGreen(i: number, x: number, z: number): boolean {
    const g = this.holes[i].green;
    return greenEdge(g, x, z) <= FRINGE;
  }

  /** The cup at a point? (Within the cup's radius of the pin.) */
  inCup(i: number, x: number, z: number): boolean {
    const p = this.holes[i].green.pin;
    return Math.hypot(x - p.x, z - p.z) < CUP_R;
  }
}

const cellKey = (i: number, j: number) => (i + 4096) * 8192 + (j + 4096);

// ---------------------------------------------------------------------------------------------
// Building a hole
// ---------------------------------------------------------------------------------------------

function makeHole(spec: HoleSpec, index: number): Hole {
  const len = spec.yards * YARD;
  // The line of play: legs from the tee, turning at the doglegs.
  const legs: Leg[] = [];
  let heading = (spec.heading * Math.PI) / 180;
  let x = spec.tee[0];
  let z = spec.tee[1];
  const cuts = [0, ...(spec.bends ?? []).map((b) => b[0]), 1];
  for (let i = 0; i + 1 < cuts.length; i++) {
    const l = (cuts[i + 1] - cuts[i]) * len;
    const dx = Math.sin(heading);
    const dz = -Math.cos(heading);
    legs.push({ ax: x, az: z, dx, dz, len: l, v0: cuts[i] * len });
    x += dx * l;
    z += dz * l;
    if (i < (spec.bends ?? []).length) heading += (spec.bends![i][1] * Math.PI) / 180;
  }
  const end = legs[legs.length - 1];
  const green = makeGreen(spec.green, x, z, end.dx, end.dz, index);
  const elev = spec.elevation.map(([f, h]): [number, number] => [f * len, h]);
  const hole: Hole = {
    index,
    spec,
    name: spec.name,
    par: spec.par,
    len,
    yards: spec.yards,
    legs,
    tee: { x: spec.tee[0], z: spec.tee[1], y: 0, yaw: yawOf(legs[0].dx, legs[0].dz) },
    green,
    bunkers: [],
    ponds: [],
    creek: null,
    half: 0,
    box: { x0: 0, z0: 0, x1: 0, z1: 0 },
    side: spec.path,
    cartTee: { x: 0, z: 0, yaw: 0 },
    cartGreen: { x: 0, z: 0, yaw: 0 },
    elev,
    fwFrom: (spec.fairway?.from ?? 0) * YARD,
    widths: spec.fairway ? spec.fairway.widths.map(([f, w]): [number, number] => [f * len, (w * YARD) / 2]) : null,
    shifts: (spec.fairway?.shift ?? []).map(([f, s]): [number, number] => [f * len, s * YARD]),
  };
  const maxFw = hole.widths ? Math.max(...hole.widths.map((w) => w[1])) : 6;
  hole.half = Math.max(30, maxFw + 20);
  hole.bunkers = (spec.bunkers ?? []).map((b, i) => placeBlob(hole, b, index * 100 + i, b.depth ?? 1.3));
  hole.ponds = (spec.ponds ?? []).map((b, i) => placeBlob(hole, b, index * 100 + 50 + i, 0));
  if (spec.creek) hole.creek = { v: alongOf(hole, spec.creek.at), half: (spec.creek.width * YARD) / 2, tan: Math.tan(((spec.creek.turn ?? 0) * Math.PI) / 180) };
  // Its box: every leg, the green and its hazards, and a margin for the woods.
  const pts: [number, number][] = [];
  for (const l of legs) {
    pts.push([l.ax, l.az], [l.ax + l.dx * l.len, l.az + l.dz * l.len]);
  }
  pts.push([legs[0].ax - legs[0].dx * 30, legs[0].az - legs[0].dz * 30], [x + end.dx * 36, z + end.dz * 36]);
  const m = hole.half + 14;
  hole.box = {
    x0: Math.floor(Math.min(...pts.map((p) => p[0])) - m),
    z0: Math.floor(Math.min(...pts.map((p) => p[1])) - m),
    x1: Math.ceil(Math.max(...pts.map((p) => p[0])) + m),
    z1: Math.ceil(Math.max(...pts.map((p) => p[1])) + m),
  };
  // Carts park beside the tee and beside the green, on the path's side, facing the way of play.
  const t = pointAt(hole, 3, hole.side * (TEE_HALF.c + 4.5));
  hole.cartTee = { x: t.x, z: t.z, yaw: yawOf(legs[0].dx, legs[0].dz) };
  const gr = pointAt(hole, len - green.ra * 0.3, hole.side * (Math.max(green.rc, green.ra) + FRINGE + 7));
  hole.cartGreen = { x: gr.x, z: gr.z, yaw: yawOf(end.dx, end.dz) };
  return hole;
}

function makeGreen(g: GreenSpec, x: number, z: number, dx: number, dz: number, seed: number): Green {
  const t = ((g.turn ?? 0) * Math.PI) / 180;
  // The green's axis: the line of play turned (right positive) by `turn`.
  const rx = -dz;
  const rz = dx;
  const ex = dx * Math.cos(t) + rx * Math.sin(t);
  const ez = dz * Math.cos(t) + rz * Math.sin(t);
  const pa = g.pin[0] * YARD;
  const pc = g.pin[1] * YARD;
  return {
    x,
    z,
    dx,
    dz,
    ex,
    ez,
    ra: g.size[0] * YARD,
    rc: g.size[1] * YARD,
    base: 0,
    // Tilts and rolls as a green's are (a percent or two, rolls a few inches over a few yards).
    back: (g.slope.back / 100) * 0.6,
    right: (g.slope.right / 100) * 0.6,
    bumps: (g.bumps ?? []).map(([a, c, h, r]) => ({ a: a * YARD, c: c * YARD, h: h * 0.45, r2: (r * YARD * 1.8) ** 2 })),
    pin: { x: x + dx * pa + rx * pc, z: z + dz * pa + rz * pc, y: 0 },
    seed,
  };
}

/** Raise the green on the land, then shift it so the pin's height is a whole block. */
function settleGreen(h: Hole, course: Course) {
  const g = h.green;
  // The hole is cut in the middle of a column (the ground's blocks are whole there).
  g.pin.x = Math.floor(g.pin.x) + 0.5;
  g.pin.z = Math.floor(g.pin.z) + 0.5;
  g.base = landAt(h, g.x, g.z, h.len, 0) + (h.spec.green.raise ?? 0.6);
  const raw = greenHeight(g, g.pin.x, g.pin.z);
  g.base += Math.round(raw) - raw;
  g.pin.y = greenHeight(g, g.pin.x, g.pin.z);
  // A check: the course's ground at the pin is the green's.
  const at = course.ground(g.pin.x, g.pin.z);
  if (Math.abs(at.y - g.pin.y) > 1e-6) g.pin.y = at.y;
}

function placeBlob(h: Hole, b: HazardSpec, seed: number, depth: number): Blob {
  const ra = b.size[0] * YARD;
  const rc = b.size[1] * YARD;
  const turn = ((b.turn ?? 0) * Math.PI) / 180;
  if (b.green) {
    // Round the green: out from its middle on that side, past its edge by the gap.
    const g = h.green;
    const side = (b.green[0] * Math.PI) / 180;
    const ox = g.dx * Math.cos(side) + -g.dz * Math.sin(side);
    const oz = g.dz * Math.cos(side) + g.dx * Math.sin(side);
    const edge = edgeDistance(g, ox, oz);
    const d = edge + FRINGE + b.green[1] * YARD + rc;
    // Its long axis along the green's edge (across the way out), turned.
    const tx = -oz;
    const tz = ox;
    return {
      x: g.x + ox * d,
      z: g.z + oz * d,
      ex: tx * Math.cos(turn) + ox * Math.sin(turn),
      ez: tz * Math.cos(turn) + oz * Math.sin(turn),
      ra,
      rc,
      depth,
      seed,
    };
  }
  const [along, across] = b.at!;
  const v = alongOf(h, along);
  const p = pointAt(h, v, across * YARD);
  const leg = legAt(h, v);
  return {
    x: p.x,
    z: p.z,
    ex: leg.dx * Math.cos(turn) - leg.dz * Math.sin(turn),
    ez: leg.dz * Math.cos(turn) + leg.dx * Math.sin(turn),
    ra,
    rc,
    depth,
    seed,
  };
}

/** How far from the green's middle its edge is, going out along (ox, oz). */
function edgeDistance(g: Green, ox: number, oz: number): number {
  const a = ox * g.ex + oz * g.ez;
  const c = ox * -g.ez + oz * g.ex;
  return 1 / Math.sqrt((a / g.ra) ** 2 + (c / g.rc) ** 2);
}

/** Yards along (negative: short of the green) to blocks along the line. */
function alongOf(h: Hole, along: number): number {
  return along >= 0 ? along * YARD : h.len + along * YARD;
}

// ---------------------------------------------------------------------------------------------
// The line of play
// ---------------------------------------------------------------------------------------------

const proj = { v: 0, u: 0, leg: 0 };

/** Where a point is along a hole (blocks from the tee) and across it (right positive). */
function project(h: Hole, x: number, z: number) {
  let best = Infinity;
  const n = h.legs.length;
  for (let i = 0; i < n; i++) {
    const l = h.legs[i];
    const px = x - l.ax;
    const pz = z - l.az;
    let t = px * l.dx + pz * l.dz;
    // The first leg runs on back past the tee, the last on past the green.
    const lo = i === 0 ? -1e9 : 0;
    const hi = i === n - 1 ? 1e9 : l.len;
    t = t < lo ? lo : t > hi ? hi : t;
    const cx = px - l.dx * t;
    const cz = pz - l.dz * t;
    const d = cx * cx + cz * cz;
    if (d < best) {
      best = d;
      proj.v = l.v0 + t;
      // Right of (dx, dz) is (-dz, dx).
      proj.u = cx * -l.dz + cz * l.dx;
      proj.leg = i;
    }
  }
  return proj;
}

function legAt(h: Hole, v: number): Leg {
  for (let i = h.legs.length - 1; i >= 0; i--) if (v >= h.legs[i].v0) return h.legs[i];
  return h.legs[0];
}

function pointAt(h: Hole, v: number, u: number) {
  const l = legAt(h, v);
  const t = v - l.v0;
  return { x: l.ax + l.dx * t - l.dz * u, z: l.az + l.dz * t + l.dx * u };
}

/** Piecewise smooth interpolation of keys [v, value]. */
function keyed(keys: [number, number][], v: number): number {
  if (v <= keys[0][0]) return keys[0][1];
  for (let i = 1; i < keys.length; i++) {
    if (v <= keys[i][0]) {
      const [v0, a] = keys[i - 1];
      const [v1, b] = keys[i];
      const t = (v - v0) / (v1 - v0);
      return a + (b - a) * t * t * (3 - 2 * t);
    }
  }
  return keys[keys.length - 1][1];
}

function elevAt(h: Hole, v: number): number {
  return keyed(h.elev, v);
}

/** The fairway's half-width at `v` (blocks), 0 where there's none. */
function fairwayHalf(h: Hole, v: number): number {
  if (!h.widths || v < h.fwFrom || v > h.len - h.green.ra * 0.6) return 0;
  return keyed(h.widths, v) * (1 + 0.07 * noise2(v / 11, h.index * 3.1, 11));
}

function fairwayShift(h: Hole, v: number): number {
  return h.shifts.length ? keyed(h.shifts, v) : 0;
}

/** The cart path's line across the hole at `v`: beside the fairway, round the green. */
function pathU(h: Hole, v: number): number {
  const fw = Math.max(keyedOr(h, v), 7);
  const g = h.green;
  const nearGreen = smooth(h.len - g.ra - 26, h.len - g.ra - 6, v);
  const byFairway = fairwayShift(h, v) + h.side * (fw + 6.5);
  const byGreen = h.side * (Math.max(g.rc, g.ra) + FRINGE + 4.5);
  return lerp(byFairway, byGreen, nearGreen);
}

function keyedOr(h: Hole, v: number): number {
  return h.widths ? keyed(h.widths, v) : 7;
}

// ---------------------------------------------------------------------------------------------
// The ground of one hole
// ---------------------------------------------------------------------------------------------

const hs = { y: 0, surf: Surf.Out as Surf, w: 0, v: 0, u: 0 };

function greenHeight(g: Green, x: number, z: number): number {
  const px = x - g.x;
  const pz = z - g.z;
  const a = px * g.dx + pz * g.dz;
  const c = px * -g.dz + pz * g.dx;
  let y = g.base + g.back * a + g.right * c;
  for (const b of g.bumps) {
    const d2 = (a - b.a) ** 2 + (c - b.c) ** 2;
    y += b.h * Math.exp(-d2 / b.r2);
  }
  return y;
}

/** How far outside the green's edge a point is (blocks; negative inside). */
function greenEdge(g: Green, x: number, z: number): number {
  const px = x - g.x;
  const pz = z - g.z;
  const a = px * g.ex + pz * g.ez;
  const c = px * -g.ez + pz * g.ex;
  const dn = Math.sqrt((a / g.ra) ** 2 + (c / g.rc) ** 2);
  const wob = 1 + 0.06 * noise2(Math.atan2(c / g.rc, a / g.ra) * 1.6 + 40, g.seed * 1.7, 3);
  const r = Math.hypot(a, c);
  if (dn < 1e-6) return -Math.min(g.ra, g.rc);
  return r - (r / dn) * wob;
}

/** How far into a blob a point is: under 1 inside (its edge wavers a little). */
function blobDist(b: Blob, x: number, z: number): number {
  const px = x - b.x;
  const pz = z - b.z;
  const a = px * b.ex + pz * b.ez;
  const c = px * -b.ez + pz * b.ex;
  const d = Math.sqrt((a / b.ra) ** 2 + (c / b.rc) ** 2);
  return d / (1 + 0.09 * noise2(Math.atan2(c / b.rc, a / b.ra) * 1.9 + 7, b.seed * 0.37, 5));
}

/** The land of a hole before anything's built on it: its rise and fall along the way, and a roll (gentler on the fairway). */
function landAt(h: Hole, x: number, z: number, v: number, u: number): number {
  const fw = fairwayHalf(h, v);
  const off = Math.abs(u - fairwayShift(h, v));
  const onFw = fw > 0 ? smooth(fw + 5, fw - 2, off) : 0;
  // Rolling land: long swells, humps and hollows, stronger out in the rough.
  const roll = noise2(x / 43, z / 43, 3) * 1.9 + noise2(x / 17, z / 17, 9) * 0.55 + noise2(x / 7.5, z / 7.5, 13) * 0.12;
  return BASE + elevAt(h, v) + roll * lerp(1, 0.5, onFw);
}

function sampleHole(h: Hole, x: number, z: number) {
  const p = project(h, x, z);
  const v = p.v;
  const u = p.u;
  hs.v = v;
  hs.u = u;
  const au = Math.abs(u);
  // How much of the corridor's shaping this point gets.
  const w = smooth(h.half + 12, h.half, au) * smooth(-32, -20, v) * smooth(h.len + 38, h.len + 24, v);
  const g = h.green;
  const edge = greenEdge(g, x, z);
  const wg = smooth(FRINGE + 7.5, FRINGE, edge);
  hs.w = Math.max(w, wg);
  if (hs.w <= 0) return hs;

  // The land: the hole's rise and fall, and a roll to it (less on the fairway).
  const fw = fairwayHalf(h, v);
  const off = Math.abs(u - fairwayShift(h, v));
  let y = landAt(h, x, z, v, u);

  // The tee box: a level pad, a little proud of the land.
  const tl = h.legs[0];
  const ta = (x - h.tee.x) * tl.dx + (z - h.tee.z) * tl.dz;
  const tc = (x - h.tee.x) * -tl.dz + (z - h.tee.z) * tl.dx;
  const tdist = Math.hypot(Math.max(Math.abs(ta) - TEE_HALF.a, 0), Math.max(Math.abs(tc) - TEE_HALF.c, 0));
  if (tdist < 4) {
    const teeY = Math.round(BASE + elevAt(h, 0) + 0.9);
    y = lerp(y, teeY, smooth(4, 0, tdist));
  }

  // The green, built up and tilted, its shoulders blending into the land.
  if (wg > 0) y = lerp(y, greenHeight(g, x, z), wg);

  // Bunkers: bowls dug into whatever's there.
  let sand = false;
  for (const b of h.bunkers) {
    const d = blobDist(b, x, z);
    if (d < 1.15) {
      y -= b.depth * smooth(1.15, 0.72, d);
      if (d < 1) sand = true;
    }
  }

  // Ponds and the creek: water, with banks down to it.
  for (const b of h.ponds) {
    const d = blobDist(b, x, z);
    if (d < 1.5) y = Math.min(y, d < 1 ? WATER - 0.45 - 1.4 * (1 - d * d) : lerp(WATER - 0.45, y, smooth(1, 1.5, d)));
  }
  if (h.creek && au < h.half + 14) {
    const c = h.creek;
    const d = Math.abs(v - c.v + u * c.tan) / c.half;
    if (d < 1.9) y = Math.min(y, d < 1 ? WATER - 0.45 - 1.1 * (1 - d * d) : lerp(WATER - 0.45, y, smooth(1, 1.9, d)));
  }

  // The cart path: a strip along the side, over the water on a causeway.
  const pu = pathU(h, v);
  const onPath = Math.abs(u - pu) < PATH_HALF && v > TEE_HALF.a + 1 && v < h.len + 2 && edge > FRINGE + 0.5;
  if (onPath) y = Math.max(y, WATER + 0.35);

  hs.y = y;
  // What it is: water, sand, the green, the tee, the path, the fairway, rough.
  const tee = Math.abs(ta) <= TEE_HALF.a && Math.abs(tc) <= TEE_HALF.c;
  hs.surf = onPath
    ? Surf.Path
    : y < WATER - 0.1
      ? Surf.Water
      : sand
        ? Surf.Sand
        : edge <= 0
          ? Surf.Green
          : edge <= FRINGE
            ? Surf.Fringe
            : tee
              ? Surf.Tee
              : fw > 0 && off < fw
                ? Surf.Fairway
                : off < Math.max(fw, 6) + 8.5
                  ? Surf.Rough
                  : w > 0.05
                    ? Surf.Deep
                    : Surf.Out;
  return hs;
}
