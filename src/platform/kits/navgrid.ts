import type { BlockInfo, GameContext, Vec3 } from '@platform';

/**
 * Where bots can walk: every cell of a box a body can stand in (something under its feet, two
 * blocks of room), linked to its neighbours by a step (stairs, a slab), a jump (a block up), or a
 * drop (a few down), and A* over that. Built from the world's blocks once they've loaded, and kept
 * up with them after (`blockChange`): a block broken or placed, a hole shot or blown through a
 * wall. A damaged block is only in the way where what's left of it is: a hole a body fits through
 * is a way through the wall, walked straight across it.
 *
 * Built only on the public API (`world.getBlock` / `blockInfo` / `carved` / `fits`, the
 * `blockChange` event), so copy it into your game and change anything.
 *
 * ```ts
 * const nav = navGrid(game, { bounds: MAP.bounds });
 * const path = nav.path(bot.position, goal); // the cells to walk through, or null
 * ```
 */
export function navGrid(game: GameContext, opts: NavGridOptions): NavGrid {
  return new Grid(game, opts);
}

export interface NavGridOptions {
  /** The box to walk in (a map's playable area): cells whose feet are inside it. */
  bounds: { min: Vec3; max: Vec3 };
  /** Keep up with the world as it changes (the `blockChange` event). Default true. */
  live?: boolean;
  /** The furthest a body drops off a ledge, in blocks. Default 3. */
  drop?: number;
}

/** A place to stand. */
export interface NavCell {
  /** The block it's in: `y` is where the feet are (the top of the block under them). */
  readonly x: number;
  readonly y: number;
  readonly z: number;
  /**
   * Where to walk to, to go through it: its middle, or where a body fits through a hole in a
   * wall there (off the middle, and up a little if the wall's foot is still there to step over).
   */
  readonly at: Vec3;
  /** A way through something carved (a hole in a wall): only crossed straight, never cut across diagonally. */
  readonly hole: boolean;
  /** Unique for as long as the grid lives (a changed block gives the cells around it new ones). */
  readonly id: number;
  /** Where a body can go from here. */
  readonly edges: readonly NavEdge[];
}

export interface NavEdge {
  readonly to: NavCell;
  /** Roughly the distance, plus a little for a jump or a long drop, and more for wading. */
  readonly cost: number;
  /** Up a block that isn't stairs or a slab: jump. */
  readonly jump: boolean;
}

export interface NavGrid {
  /**
   * Built: the world inside the bounds has loaded. Every question builds it the first time it can
   * (unloaded chunks count as solid, so it waits for them); until then they have no answers.
   */
  readonly ready: boolean;
  /** How many cells there are. */
  readonly size: number;
  /**
   * Goes up whenever a change to the world opens a new way (a cell or a link that wasn't there:
   * a hole through a wall, a block broken), so a path planned before it might now be shorter.
   */
  readonly opened: number;
  /** Build it now, from the world's blocks (again, if it was built). False if the bounds haven't loaded yet. */
  build(): boolean;
  /** The cell someone standing at `p` is in, or the nearest one near it. */
  cellAt(p: Vec3): NavCell | null;
  /** A cell anywhere on the grid (somewhere to wander to). */
  random(rnd?: () => number): NavCell | null;
  /** A* from one point to another: the cells to walk through (not the one it starts in), or null. `limit` caps the cells it looks at. */
  path(from: Vec3, to: Vec3, limit?: number): NavCell[] | null;
  /** Whether stepping from one cell to the next needs a jump. */
  needsJump(a: NavCell, b: NavCell): boolean;
  /** Whether a cell is still on the grid (a block placed on it, say, takes it away). */
  has(cell: NavCell): boolean;
  /** Stop keeping up with the world. */
  dispose(): void;
}

/** What the grid needs to know about a kind of block. */
interface Kind {
  solid: boolean;
  /** Walked up without a jump (a bottom slab, stairs): its top is no more than a body steps up by itself. */
  step: boolean;
  liquid: boolean;
  /** Taller than a block (a fence): nothing to stand on, and in the way of the cell above too. */
  tall: boolean;
}

/** Whether a body fits in a cell, and where: a hole's crossing directions, and the point to aim for. */
interface Probe {
  /** Crossable along x (east-west), along z (north-south). */
  alongX: boolean;
  alongZ: boolean;
  ox: number;
  oz: number;
  sill: number;
}

type Cell = NavCell & {
  at: Vec3;
  hole: boolean;
  alongX: boolean;
  alongZ: boolean;
  edges: NavEdge[];
  /** Where it is in `list`. */
  index: number;
};

/** What `path` keeps between searches (see there). */
interface Scratch {
  g: Float64Array;
  came: Int32Array;
  seen: Uint32Array;
  closed: Uint32Array;
  stamp: number;
  open: Heap;
}

/** The largest drop a cell's links look down for. */
const MAX_DROP = 6;
/** A body's half width, and a hair less, so a body inside a cell never touches the next one. */
const HALF = 0.3;
const INSET = HALF + 0.01;
/** Heights a hole's floor may be, over the cell's: what's left of the wall's foot, stepped over (a body steps up 0.6 by itself). */
const SILLS = [0, 0.25, 0.5];
/** How far off the middle of a cell a hole may be, across the way through it. */
const OFFSETS = [0, -0.19, 0.19];

// Cells by position: x and z within 32768 of the origin, y within 256 below and above 0.
const colKey = (x: number, z: number) => (x + 32768) * 65536 + (z + 32768);
const cellKey = (x: number, y: number, z: number) => colKey(x, z) * 1024 + (y + 512);

class Grid implements NavGrid {
  private cells = new Map<number, Cell>();
  private list: Cell[] = [];
  /** Cells by column, lowest first. */
  private columns = new Map<number, Cell[]>();
  private kinds = new Map<number, Kind>();
  /** Blocks changed since the grid last caught up. */
  private pending = new Map<number, [number, number, number]>();
  private off: (() => void) | null = null;
  private built = false;
  private nextId = 0;
  private search: Scratch | null = null;
  private readonly drop: number;
  private readonly x0: number;
  private readonly x1: number;
  private readonly y0: number;
  private readonly y1: number;
  private readonly z0: number;
  private readonly z1: number;
  opened = 0;

  constructor(
    private game: GameContext,
    opts: NavGridOptions,
  ) {
    const { min, max } = opts.bounds;
    this.x0 = Math.floor(min.x);
    this.x1 = Math.ceil(max.x);
    this.z0 = Math.floor(min.z);
    this.z1 = Math.ceil(max.z);
    this.y0 = Math.floor(min.y) + 1;
    this.y1 = Math.ceil(max.y);
    this.drop = Math.max(0, Math.min(MAX_DROP, Math.round(opts.drop ?? 3)));
    if (opts.live !== false)
      this.off = game.events.on('blockChange', ({ x, y, z }) => {
        // Only what could change a cell inside the box (a cell looks a few blocks up and down).
        if (!this.built || x < this.x0 - 1 || x > this.x1 + 1 || z < this.z0 - 1 || z > this.z1 + 1 || y < this.y0 - 3 || y > this.y1 + this.drop + 3) return;
        this.pending.set(cellKey(x, y, z), [x, y, z]);
      });
  }

  get ready(): boolean {
    if (!this.built) this.build();
    return this.built;
  }

  get size(): number {
    return this.list.length;
  }

  dispose() {
    this.off?.();
    this.off = null;
  }

  has(cell: NavCell): boolean {
    this.catchUp();
    return this.cells.get(cellKey(cell.x, cell.y, cell.z)) === cell;
  }

  /** Whether every chunk inside the bounds has loaded (unloaded ones read as -1). */
  private loaded(): boolean {
    const w = this.game.world;
    const y = Math.max(0, Math.min(255, this.y0));
    for (let x = this.x0; ; x = Math.min(x + 16, this.x1)) {
      for (let z = this.z0; ; z = Math.min(z + 16, this.z1)) {
        if (w.getBlock(x, y, z) < 0) return false;
        if (z >= this.z1) break;
      }
      if (x >= this.x1) break;
    }
    return true;
  }

  build(): boolean {
    if (!this.loaded()) return false;
    this.cells.clear();
    this.columns.clear();
    this.list = [];
    this.pending.clear();
    this.kinds.clear();
    for (let x = this.x0; x <= this.x1; x++)
      for (let z = this.z0; z <= this.z1; z++)
        for (let y = this.y0; y <= this.y1; y++) {
          const p = this.probe(x, y, z);
          if (p) this.add(x, y, z, p);
        }
    for (const c of this.list) c.edges = this.link(c);
    // Built again: paths planned on the old grid are worth planning again.
    if (this.built) this.opened++;
    this.built = true;
    return true;
  }

  // ---- What's where ----

  private kind(x: number, y: number, z: number): Kind {
    const w = this.game.world;
    const id = w.getBlock(x, y, z);
    let k = this.kinds.get(id);
    if (!k) {
      // Unloaded counts as solid: nobody walks into the unknown.
      k = id < 0 ? { solid: true, step: false, liquid: false, tall: false } : kindOf(w.blockInfo(id));
      this.kinds.set(id, k);
    }
    return k;
  }

  /** Something solid, whole or partly carved, that a body can't count on passing (a carved block is only open where `probe` finds a hole). */
  private blocked(x: number, y: number, z: number): boolean {
    return this.kind(x, y, z).solid || this.kind(x, y - 1, z).tall;
  }

  /** A solid block with bits carved out of it. */
  private carved(x: number, y: number, z: number): boolean {
    return this.game.world.carved(x, y, z) > 0;
  }

  /**
   * Whether a body can stand in the cell with its feet at `y`: solid under it, room for it. A
   * carved block there (in the wall, or the floor) is only open where a body fits through it, so
   * that's tried: across the cell along x and along z, a little off the middle, and up over
   * what's left of the wall's foot.
   */
  private probe(x: number, y: number, z: number): Probe | null {
    const below = this.kind(x, y - 1, z);
    if (!below.solid || below.tall) return null;
    const a = this.kind(x, y, z);
    const b = this.kind(x, y + 1, z);
    const hurtA = a.solid && this.carved(x, y, z);
    if (a.solid && !hurtA) return null;
    const hurtB = b.solid && this.carved(x, y + 1, z);
    if (b.solid && !hurtB) return null;
    if (!hurtA && !hurtB && !this.carved(x, y - 1, z)) return OPEN;
    const w = this.game.world;
    const fits = (px: number, py: number, pz: number) => w.fits({ x: px, y: py, z: pz });
    // Something under the feet: lower the body a little and it touches it.
    const stands = (px: number, py: number, pz: number) => !fits(px, py - 0.3, pz);
    for (const sill of SILLS) {
      const fy = y + sill;
      let alongX = false;
      let alongZ = false;
      let ox = 0;
      let oz = 0;
      for (const o of OFFSETS)
        if (fits(x + INSET, fy, z + 0.5 + o) && fits(x + 1 - INSET, fy, z + 0.5 + o) && stands(x + 0.5, fy, z + 0.5 + o)) {
          alongX = true;
          oz = o;
          break;
        }
      for (const o of OFFSETS)
        if (fits(x + 0.5 + o, fy, z + INSET) && fits(x + 0.5 + o, fy, z + 1 - INSET) && stands(x + 0.5 + o, fy, z + 0.5)) {
          alongZ = true;
          ox = o;
          break;
        }
      if (alongX || alongZ) return { alongX, alongZ, ox: alongZ ? ox : 0, oz: alongX ? oz : 0, sill };
    }
    return null;
  }

  private add(x: number, y: number, z: number, p: Probe): Cell {
    const c: Cell = {
      x,
      y,
      z,
      at: { x: x + 0.5 + p.ox, y: y + p.sill, z: z + 0.5 + p.oz },
      hole: p !== OPEN,
      alongX: p.alongX,
      alongZ: p.alongZ,
      id: this.nextId++,
      edges: [],
      index: this.list.length,
    };
    this.cells.set(cellKey(x, y, z), c);
    this.list.push(c);
    const k = colKey(x, z);
    const col = this.columns.get(k);
    if (!col) this.columns.set(k, [c]);
    else {
      col.push(c);
      col.sort((a, b) => a.y - b.y);
    }
    return c;
  }

  private remove(c: Cell) {
    this.cells.delete(cellKey(c.x, c.y, c.z));
    const last = this.list.pop()!;
    if (last !== c) {
      this.list[c.index] = last;
      last.index = c.index;
    }
    const k = colKey(c.x, c.z);
    const col = this.columns.get(k);
    if (col) {
      col.splice(col.indexOf(c), 1);
      if (!col.length) this.columns.delete(k);
    }
    // Anyone still holding it (a path) finds no way on from it.
    c.edges = [];
  }

  /** Where a body can go from `c`: to each side and diagonally, a block up, level, or down a few. */
  private link(c: Cell): NavEdge[] {
    const edges: NavEdge[] = [];
    // Room for a body at a cell's height in the column next to it (holes don't count: they're crossed straight).
    const free = (x: number, y: number, z: number) => !this.blocked(x, y, z) && !this.blocked(x, y + 1, z);
    for (let dx = -1; dx <= 1; dx++)
      for (let dz = -1; dz <= 1; dz++) {
        if (!dx && !dz) continue;
        const diagonal = dx && dz;
        // Diagonals only where both sides are open (no cutting corners), and never through a hole.
        if (diagonal && (c.hole || !(free(c.x + dx, c.y, c.z) && free(c.x, c.y, c.z + dz)))) continue;
        // Out of a hole only the ways it goes through.
        if (c.hole && !(dz === 0 ? c.alongX : c.alongZ)) continue;
        for (let dy = 1; dy >= -this.drop; dy--) {
          const n = this.cells.get(cellKey(c.x + dx, c.y + dy, c.z + dz));
          if (!n) continue;
          // Into a hole: level, and along it.
          if (n.hole && (diagonal || dy !== 0 || !(dz === 0 ? n.alongX : n.alongZ))) break;
          // Up a block: a step (stairs, slabs) or a jump (room overhead).
          let jump = false;
          if (dy === 1) {
            if (!this.kind(n.x, n.y - 1, n.z).step) {
              if (this.blocked(c.x, c.y + 2, c.z)) break;
              jump = true;
            }
          }
          // Down: nothing in the way over the lower cell at this one's height.
          if (dy < 0 && (this.blocked(n.x, c.y, n.z) || this.blocked(n.x, c.y + 1, n.z))) break;
          const d = Math.hypot(dx, dz, dy * 0.5);
          edges.push({ to: n, cost: d + (jump ? 0.8 : 0) + (dy < -1 ? 0.5 : 0) + (this.kind(n.x, n.y, n.z).liquid ? 3 : 0), jump });
          break;
        }
      }
    return edges;
  }

  /**
   * Catch up with blocks that changed: the cells whose floor or room they are (and a sill's
   * headroom) are looked at again, then the links of every cell near them.
   */
  private catchUp() {
    if (!this.built) {
      this.build();
      return;
    }
    if (!this.pending.size) return;
    const changed = [...this.pending.values()];
    this.pending.clear();
    const look = new Map<number, [number, number, number]>();
    // Columns whose cells' links to redo, with the heights.
    const relink = new Map<number, [number, number, number, number]>();
    for (const [x, y, z] of changed) {
      for (let yy = y - 2; yy <= y + 1; yy++) look.set(cellKey(x, yy, z), [x, yy, z]);
      for (let dx = -1; dx <= 1; dx++)
        for (let dz = -1; dz <= 1; dz++) {
          const k = colKey(x + dx, z + dz);
          const r = relink.get(k);
          // A cell's links reach down a drop and up a block (and that cell's floor and room).
          const lo = y - 3;
          const hi = y + this.drop + 2;
          if (r) {
            r[2] = Math.min(r[2], lo);
            r[3] = Math.max(r[3], hi);
          } else relink.set(k, [x + dx, z + dz, lo, hi]);
        }
    }
    let opened = false;
    for (const [k, [x, y, z]] of look) {
      if (x < this.x0 || x > this.x1 || z < this.z0 || z > this.z1 || y < this.y0 || y > this.y1) continue;
      const had = this.cells.get(k);
      const p = this.probe(x, y, z);
      if (had && p && had.hole === (p !== OPEN) && had.alongX === p.alongX && had.alongZ === p.alongZ && had.at.y === y + p.sill) {
        had.at = { x: x + 0.5 + p.ox, y: y + p.sill, z: z + 0.5 + p.oz };
        continue;
      }
      if (had) this.remove(had);
      if (p) {
        this.add(x, y, z, p);
        opened = true;
      }
    }
    for (const [x, z, lo, hi] of relink.values()) {
      for (const c of this.columns.get(colKey(x, z)) ?? []) {
        if (c.y < lo || c.y > hi) continue;
        const before = new Set(c.edges.map((e) => e.to.id));
        c.edges = this.link(c);
        if (!opened && c.edges.some((e) => !before.has(e.to.id))) opened = true;
      }
    }
    if (opened) this.opened++;
  }

  // ---- Questions ----

  cellAt(p: Vec3): NavCell | null {
    this.catchUp();
    const x = Math.floor(p.x);
    const z = Math.floor(p.z);
    const y = Math.round(p.y);
    for (const dy of [0, 1, -1, 2, -2]) {
      const c = this.cells.get(cellKey(x, y + dy, z));
      if (c) return c;
    }
    let best: Cell | null = null;
    let bd = 9;
    for (let dx = -2; dx <= 2; dx++)
      for (let dz = -2; dz <= 2; dz++) {
        for (const c of this.columns.get(colKey(x + dx, z + dz)) ?? []) {
          const d = Math.abs(c.x + 0.5 - p.x) + Math.abs(c.z + 0.5 - p.z) + Math.abs(c.y - p.y) * 2;
          if (d < bd) {
            bd = d;
            best = c;
          }
        }
      }
    return best;
  }

  random(rnd: () => number = Math.random): NavCell | null {
    this.catchUp();
    return this.list.length ? this.list[Math.floor(rnd() * this.list.length)] : null;
  }

  path(from: Vec3, to: Vec3, limit = 6000): NavCell[] | null {
    const a = this.cellAt(from) as Cell | null;
    const b = this.cellAt(to) as Cell | null;
    if (!a || !b) return null;
    if (a === b) return [b];
    // A* over the cells by their place in `list`: what it knows of each (its cost so far, the
    // cell it came from, whether it's done) in arrays kept between searches, current when their
    // stamp is this search's (dozens of bots plan a few times a second each: Maps were most of it).
    const list = this.list;
    const s = this.scratch(list.length);
    const stamp = s.stamp;
    const h = (c: NavCell) => Math.hypot(c.x - b.x, c.z - b.z, (c.y - b.y) * 0.7);
    s.seen[a.index] = stamp;
    s.g[a.index] = 0;
    const open = s.open;
    open.clear();
    open.push(a.index, h(a));
    let n = 0;
    while (open.size && n++ < limit) {
      const ci = open.pop();
      const c = list[ci];
      if (c === b) {
        const out: NavCell[] = [];
        for (let k = ci; k !== a.index; k = s.came[k]) out.push(list[k]);
        return out.reverse();
      }
      if (s.closed[ci] === stamp) continue;
      s.closed[ci] = stamp;
      const gc = s.g[ci];
      for (const e of c.edges) {
        const to = e.to as Cell;
        const ti = to.index;
        // (A cell gone since: its place in the list is someone else's now.)
        if (list[ti] !== to) continue;
        const t = gc + e.cost;
        if (s.seen[ti] !== stamp || t < s.g[ti]) {
          s.seen[ti] = stamp;
          s.g[ti] = t;
          s.came[ti] = ci;
          open.push(ti, t + h(to));
        }
      }
    }
    return null;
  }

  /** The searches' arrays, for `n` cells, with a new stamp. */
  private scratch(n: number): Scratch {
    let s = this.search;
    if (!s || s.g.length < n) {
      const size = Math.max(n, 1024, (s?.g.length ?? 0) * 2);
      s = this.search = { g: new Float64Array(size), came: new Int32Array(size), seen: new Uint32Array(size), closed: new Uint32Array(size), stamp: 0, open: s?.open ?? new Heap() };
    }
    if (++s.stamp === 0xffffffff) {
      s.seen.fill(0);
      s.closed.fill(0);
      s.stamp = 1;
    }
    return s;
  }

  needsJump(a: NavCell, b: NavCell): boolean {
    return a.edges.some((e) => e.to === b && e.jump);
  }
}

/** A cell with nothing carved about it: open every way, walked through the middle. */
const OPEN: Probe = { alongX: true, alongZ: true, ox: 0, oz: 0, sill: 0 };

/**
 * A kind of block, for walking. Slabs and stairs are told by their state (a slab's `type`,
 * stairs' `half`), then by `shape` and collision `height` (a game's own shapes).
 */
function kindOf(b: BlockInfo | null): Kind {
  if (!b) return { solid: true, step: false, liquid: false, tall: false };
  const st = b.state ?? {};
  let step: boolean;
  if ('type' in st) step = st.type === 'bottom';
  else if ('half' in st) step = st.half === 'bottom';
  else if (b.shape === 'stairs' || b.shape === 'slab') step = true;
  else step = b.height > 0 && b.height <= 0.6;
  return { solid: b.solid, step: b.solid && step, liquid: b.liquid, tall: b.solid && b.height > 1 };
}

/** A binary min-heap of cells (their places in the grid's list) by priority. */
class Heap {
  private at = new Int32Array(1024);
  private p = new Float64Array(1024);
  size = 0;
  clear() {
    this.size = 0;
  }
  push(c: number, pri: number) {
    if (this.size === this.at.length) {
      const at = new Int32Array(this.size * 2);
      const p = new Float64Array(this.size * 2);
      at.set(this.at);
      p.set(this.p);
      this.at = at;
      this.p = p;
    }
    const { at, p } = this;
    let i = this.size++;
    at[i] = c;
    p[i] = pri;
    while (i > 0) {
      const j = (i - 1) >> 1;
      if (p[j] <= p[i]) break;
      swap(at, p, i, j);
      i = j;
    }
  }
  pop(): number {
    const { at, p } = this;
    const top = at[0];
    const n = --this.size;
    if (n) {
      at[0] = at[n];
      p[0] = p[n];
      let i = 0;
      for (;;) {
        const l = i * 2 + 1;
        const r = l + 1;
        let m = i;
        if (l < n && p[l] < p[m]) m = l;
        if (r < n && p[r] < p[m]) m = r;
        if (m === i) break;
        swap(at, p, i, m);
        i = m;
      }
    }
    return top;
  }
}

function swap(at: Int32Array, p: Float64Array, i: number, j: number) {
  const c = at[i];
  at[i] = at[j];
  at[j] = c;
  const q = p[i];
  p[i] = p[j];
  p[j] = q;
}
