import type { GameContext, Vec3 } from '@platform';

/** One cell of a route: where to stand (feet), what to dig out first, and whether it needs a block placed under it. */
export interface Step {
  x: number;
  y: number;
  z: number;
  dig: Vec3[];
  bridge: boolean;
}

export interface Bounds {
  x0: number;
  x1: number;
  z0: number;
  z1: number;
  y0: number;
  y1: number;
}

const DIRS: [number, number][] = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
  [1, 1],
  [1, -1],
  [-1, 1],
  [-1, -1],
];

/** Costs: walking is 1 per block; laying a bridge and digging are slower, so routes prefer land and existing bridges. */
const BRIDGE = 3.2;
const DIG = 3.5;

/**
 * Grid path-finding for walkers that can bridge and dig (Bed Wars bots). Cells are standing
 * positions (feet); a walker fits in two blocks of headroom, steps up one block, drops up to
 * three, can bridge straight out over the void, and can dig through blocks `breakable` allows.
 */
export class Nav {
  private cache = new Map<number, boolean>();

  constructor(
    private game: GameContext,
    private bounds: Bounds,
    private breakable: (x: number, y: number, z: number) => boolean,
  ) {}

  private id(x: number, y: number, z: number): number {
    const b = this.bounds;
    return ((x - b.x0) * (b.z1 - b.z0 + 1) + (z - b.z0)) * 256 + y;
  }

  private inside(x: number, y: number, z: number): boolean {
    const b = this.bounds;
    return x >= b.x0 && x <= b.x1 && z >= b.z0 && z <= b.z1 && y >= b.y0 && y <= b.y1;
  }

  /** Solid, as of the last `find` (cached for the search). */
  private solid(x: number, y: number, z: number): boolean {
    const k = this.id(x, y, z);
    let s = this.cache.get(k);
    if (s === undefined) {
      const w = this.game.world;
      const id = w.getBlock(x, y, z);
      s = id !== 0 && (id < 0 || (w.blockInfo(id)?.solid ?? false));
      this.cache.set(k, s);
    }
    return s;
  }

  private open(x: number, y: number, z: number): boolean {
    return !this.solid(x, y, z) && !this.solid(x, y + 1, z);
  }

  /**
   * Weighted A* from `from` until `goal` accepts a cell. `toward` steers the search. If the goal
   * isn't reached within `budget` cells, returns the route to the closest cell it did reach (so a
   * long trip still makes progress and re-plans from there); null only if it got nowhere.
   */
  find(from: Vec3, toward: Vec3, goal: (x: number, y: number, z: number) => boolean, budget = 4000): Step[] | null {
    this.cache.clear();
    const sx = Math.floor(from.x);
    const sz = Math.floor(from.z);
    let sy = Math.floor(from.y + 0.05);
    // Standing in something (knocked into a corner): try the cell above.
    if (!this.open(sx, sy, sz) && this.open(sx, sy + 1, sz)) sy++;
    const h = (x: number, z: number, y: number) => Math.hypot(x + 0.5 - toward.x, z + 0.5 - toward.z) + Math.abs(y - toward.y) * 0.5;
    // Greedy over open void (where each cell costs a bridge), so long trips don't flood the map.
    const W = 2.2;
    const start = this.id(sx, sy, sz);
    const g = new Map<number, number>([[start, 0]]);
    const came = new Map<number, { from: number; step: Step }>();
    const heap = new Heap();
    heap.push(start, h(sx, sz, sy) * W);
    let best = start;
    let bestH = h(sx, sz, sy);
    const cells = new Map<number, [number, number, number]>([[start, [sx, sy, sz]]]);
    const closed = new Set<number>();
    let n = 0;
    while (heap.size && n < budget) {
      const cur = heap.pop();
      if (closed.has(cur)) continue;
      closed.add(cur);
      n++;
      const [x, y, z] = cells.get(cur)!;
      if (goal(x, y, z)) return this.unwind(came, cur);
      const hc = h(x, z, y);
      if (hc < bestH) {
        bestH = hc;
        best = cur;
      }
      const gc = g.get(cur)!;
      for (const [dx, dz] of DIRS) {
        const diag = dx !== 0 && dz !== 0;
        const nx = x + dx;
        const nz = z + dz;
        if (!this.inside(nx, y, nz)) continue;
        // No cutting corners on diagonals, and diagonals never bridge or dig.
        if (diag && (!this.open(x + dx, y, z) || !this.open(x, y, z + dz))) continue;
        let step: Step | null = null;
        let cost = diag ? 1.42 : 1;
        if (this.open(nx, y, nz)) {
          if (this.solid(nx, y - 1, nz)) {
            step = { x: nx, y, z: nz, dig: [], bridge: false };
          } else {
            for (let d = 1; d <= 3 && !step; d++) {
              if (this.solid(nx, y - 1 - d, nz)) {
                step = { x: nx, y: y - d, z: nz, dig: [], bridge: false };
                cost += 0.4 * d;
              }
            }
            if (!step && !diag) {
              step = { x: nx, y, z: nz, dig: [], bridge: true };
              cost = BRIDGE;
            }
          }
        } else if (!diag) {
          if (this.solid(nx, y, nz) && !this.solid(nx, y + 1, nz) && !this.solid(nx, y + 2, nz) && !this.solid(x, y + 2, z)) {
            // Step up.
            step = { x: nx, y: y + 1, z: nz, dig: [], bridge: false };
            cost = 1.5;
          } else {
            // Dig through (only blocks placed during the match).
            const dig: Vec3[] = [];
            let ok = true;
            for (const yy of [y, y + 1]) {
              if (this.solid(nx, yy, nz)) {
                if (this.breakable(nx, yy, nz)) dig.push({ x: nx, y: yy, z: nz });
                else ok = false;
              }
            }
            if (ok && dig.length) {
              step = { x: nx, y, z: nz, dig, bridge: !this.solid(nx, y - 1, nz) };
              cost = 1 + DIG * dig.length;
            }
          }
        }
        if (!step) continue;
        const k = this.id(step.x, step.y, step.z);
        const ng = gc + cost;
        if (ng < (g.get(k) ?? Infinity)) {
          g.set(k, ng);
          came.set(k, { from: cur, step });
          cells.set(k, [step.x, step.y, step.z]);
          heap.push(k, ng + h(step.x, step.z, step.y) * W);
        }
      }
    }
    return best === start ? null : this.unwind(came, best);
  }

  private unwind(came: Map<number, { from: number; step: Step }>, end: number): Step[] {
    const out: Step[] = [];
    let k = end;
    for (let c = came.get(k); c; c = came.get(k)) {
      out.push(c.step);
      k = c.from;
    }
    return out.reverse();
  }
}

/** Binary min-heap of ids by priority. */
class Heap {
  private ids: number[] = [];
  private pri: number[] = [];

  get size(): number {
    return this.ids.length;
  }

  push(id: number, p: number) {
    const ids = this.ids;
    const pri = this.pri;
    let i = ids.length;
    ids.push(id);
    pri.push(p);
    while (i > 0) {
      const up = (i - 1) >> 1;
      if (pri[up] <= p) break;
      ids[i] = ids[up];
      pri[i] = pri[up];
      i = up;
    }
    ids[i] = id;
    pri[i] = p;
  }

  pop(): number {
    const ids = this.ids;
    const pri = this.pri;
    const top = ids[0];
    const lastId = ids.pop()!;
    const lastP = pri.pop()!;
    const n = ids.length;
    if (n) {
      let i = 0;
      for (;;) {
        const l = i * 2 + 1;
        if (l >= n) break;
        const r = l + 1;
        const c = r < n && pri[r] < pri[l] ? r : l;
        if (pri[c] >= lastP) break;
        ids[i] = ids[c];
        pri[i] = pri[c];
        i = c;
      }
      ids[i] = lastId;
      pri[i] = lastP;
    }
    return top;
  }
}
