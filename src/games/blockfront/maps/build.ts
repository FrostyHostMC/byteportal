import type { Blueprint, BlockRef, Vec3 } from '@platform';

export { hash } from './kit';

/**
 * What Blockfront's maps are built with: a canvas (a Blueprint, or a place on one moved and
 * turned), the block-state helpers, and shapes that are fiddly by hand: rounded walls, domes
 * smoothed with slabs and stairs, pixel sprites.
 */

export type Facing = 'north' | 'east' | 'south' | 'west';
export type Fill = BlockRef | ((x: number, y: number, z: number) => BlockRef | undefined);

export const stairs = (m: string, f: Facing, top = false) => `${m}_stairs[facing=${f},half=${top ? 'top' : 'bottom'}]`;
export const slab = (m: string, top = false) => `${m}_slab[type=${top ? 'top' : 'bottom'}]`;
export const facing = (b: string, f: Facing) => `${b}[facing=${f}]`;

/** The way from one point toward another, along whichever axis it mostly is. */
export function toward(dx: number, dz: number): Facing {
  return Math.abs(dx) >= Math.abs(dz) ? (dx > 0 ? 'east' : 'west') : dz > 0 ? 'south' : 'north';
}
export const OPPOSITE: Record<Facing, Facing> = { north: 'south', south: 'north', east: 'west', west: 'east' };
/** A step one block the way something faces. */
export const STEP: Record<Facing, [number, number]> = { north: [0, -1], south: [0, 1], east: [1, 0], west: [-1, 0] };

/** What things are drawn on: a Blueprint, or a `Place` on one. */
export interface Canvas {
  set(x: number, y: number, z: number, block: BlockRef): unknown;
  get(x: number, y: number, z: number): BlockRef | undefined;
}

const TURN: Record<Facing, Facing> = { north: 'east', east: 'south', south: 'west', west: 'north' };

/**
 * A spot on a canvas to build something in its own coordinates, moved to (ox, oz) and turned
 * `turns` quarter turns clockwise from above (what faces west faces north after one), with the
 * blocks that face a way (stairs, ladders) and lie along an axis turned with it. The ships and
 * props here are built nose west (toward -x), so `new Place(bp, x, z, 1)` points one north.
 */
export class Place implements Canvas {
  constructor(
    private c: Canvas,
    private ox: number,
    private oz: number,
    private turns = 0,
  ) {}

  private at(x: number, z: number): [number, number] {
    switch (((this.turns % 4) + 4) % 4) {
      case 1:
        return [this.ox - z, this.oz + x];
      case 2:
        return [this.ox - x, this.oz - z];
      case 3:
        return [this.ox + z, this.oz - x];
      default:
        return [this.ox + x, this.oz + z];
    }
  }

  private turned(block: BlockRef): BlockRef {
    const n = ((this.turns % 4) + 4) % 4;
    if (!n || typeof block !== 'string') return block;
    return block
      .replace(/facing=(north|east|south|west)/, (_, f: Facing) => {
        let g = f;
        for (let i = 0; i < n; i++) g = TURN[g];
        return `facing=${g}`;
      })
      .replace(/axis=(x|z)/, (_, a: string) => (n % 2 ? `axis=${a === 'x' ? 'z' : 'x'}` : `axis=${a}`));
  }

  set(x: number, y: number, z: number, block: BlockRef) {
    const [wx, wz] = this.at(x, z);
    this.c.set(wx, y, wz, this.turned(block));
  }

  get(x: number, y: number, z: number) {
    const [wx, wz] = this.at(x, z);
    return this.c.get(wx, y, wz);
  }
}

/**
 * One canvas over several Blueprints: each cell goes to the first whose box holds it (the others
 * never see it). A map spread wide (its floor out to the view distance, mountains round it) keeps
 * each box tight round what's in it instead of one huge mostly empty box.
 */
export class Patchwork implements Canvas {
  constructor(readonly parts: Blueprint[]) {}

  private part(x: number, y: number, z: number): Blueprint | undefined {
    for (const b of this.parts) {
      const o = b.origin;
      if (x >= o.x && y >= o.y && z >= o.z && x < o.x + b.size.x && y < o.y + b.size.y && z < o.z + b.size.z) return b;
    }
    return undefined;
  }

  set(x: number, y: number, z: number, block: BlockRef) {
    this.part(Math.floor(x), Math.floor(y), Math.floor(z))?.set(x, y, z, block);
  }

  get(x: number, y: number, z: number) {
    return this.part(Math.floor(x), Math.floor(y), Math.floor(z))?.get(x, y, z);
  }
}

/** Fill an inclusive box on a canvas. */
export function box(c: Canvas, x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, b: Fill) {
  for (let y = Math.min(y0, y1); y <= Math.max(y0, y1); y++)
    for (let z = Math.min(z0, z1); z <= Math.max(z0, z1); z++)
      for (let x = Math.min(x0, x1); x <= Math.max(x0, x1); x++) {
        const v = typeof b === 'function' ? b(x, y, z) : b;
        if (v !== undefined) c.set(x, y, z, v);
      }
}

/** Distance from a round thing's middle (cx, cz: its centre, on a block's middle or corner) to a block's. */
export const dist = (x: number, z: number, cx: number, cz: number) => Math.hypot(x + 0.5 - cx, z + 0.5 - cz);

/** Every column of a disc round (cx, cz) (world units: `cx = 10.5` is block 10's middle), with its distance. */
export function disc(cx: number, cz: number, r: number, fn: (x: number, z: number, d: number) => void) {
  for (let z = Math.floor(cz - r - 1); z <= Math.ceil(cz + r + 1); z++)
    for (let x = Math.floor(cx - r - 1); x <= Math.ceil(cx + r + 1); x++) {
      const d = dist(x, z, cx, cz);
      if (d <= r) fn(x, z, d);
    }
}

/** Whether a column is on the rim of a disc: inside it, with a side neighbour outside. */
export const rim = (x: number, z: number, cx: number, cz: number, r: number) =>
  dist(x, z, cx, cz) <= r && (dist(x + 1, z, cx, cz) > r || dist(x - 1, z, cx, cz) > r || dist(x, z + 1, cx, cz) > r || dist(x, z - 1, cx, cz) > r);

/**
 * A round wall: the rim of a disc, from y0 to y1, of `thick` blocks. `block` may pick per cell
 * (a band of grime at the bottom, windows round the top).
 */
export function ring(c: Canvas, cx: number, cz: number, r: number, y0: number, y1: number, block: Fill, thick = 1) {
  disc(cx, cz, r, (x, z, d) => {
    if (thick === 1 ? !rim(x, z, cx, cz, r) : d <= r - thick) return;
    for (let y = y0; y <= y1; y++) {
      const b = typeof block === 'function' ? block(x, y, z) : block;
      if (b !== undefined) c.set(x, y, z, b);
    }
  });
}

/**
 * A dome over (cx, cz) rising from y0 (the first course above the wall top): `r` across, `h`
 * high, in `mat` with its slabs and stairs smoothing the curve (`mat_slab`, `mat_stairs` must
 * exist). Hollow if `thick` is given (a dome over a hall), else solid (a cap).
 */
export function dome(c: Canvas, cx: number, cz: number, r: number, h: number, y0: number, mat: string, thick = 0) {
  const height = (x: number, z: number, rr: number, hh: number) => {
    const d = dist(x, z, cx, cz);
    return d >= rr ? -1 : hh * Math.sqrt(1 - (d / rr) ** 2);
  };
  disc(cx, cz, r, (x, z) => {
    const top = height(x, z, r, h);
    if (top <= 0) return;
    const inner = thick ? height(x, z, r - thick, h - thick) : -1;
    const full = Math.floor(top);
    const frac = top - full;
    const from = inner > 0 ? Math.max(0, Math.floor(inner)) : 0;
    for (let y = from; y < full; y++) c.set(x, y0 + y, z, mat);
    if (frac < 0.3) return;
    if (frac > 0.72) {
      c.set(x, y0 + full, z, mat);
      return;
    }
    // Steep here (the column toward the middle stands a good bit higher): stairs up toward it; else a slab.
    const dx = cx - (x + 0.5);
    const dz = cz - (z + 0.5);
    const f = toward(dx, dz);
    const [sx, sz] = STEP[f];
    const next = height(x + sx, z + sz, r, h);
    c.set(x, y0 + full, z, next - top > 0.6 ? stairs(mat, f) : slab(mat));
  });
}

// ---------------------------------------------------------------------------------------------
// Sprites
// ---------------------------------------------------------------------------------------------

/**
 * Stamp a sprite (rows top first) onto a plane: `at(u, v)` maps column u (left to right as the
 * reader sees it) and row-from-bottom v to a cell.
 */
export function sprite(c: Canvas, rows: string[], colors: Record<string, BlockRef>, at: (u: number, v: number) => Vec3) {
  const h = rows.length;
  rows.forEach((row, r) =>
    [...row].forEach((ch, u) => {
      const b = colors[ch];
      if (b === undefined) return;
      const p = at(u, h - 1 - r);
      c.set(p.x, p.y, p.z, b);
    }),
  );
}
