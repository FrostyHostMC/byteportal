import type { BlockRef, Vec3 } from './types';

/** A `Blueprint` as plain data. */
export interface BlueprintData {
  origin: Vec3;
  size: Vec3;
  /** Palette index per cell (x fastest, then z, then y); -1 leaves the terrain. */
  cells: Int16Array;
  palette: BlockRef[];
}

/**
 * A voxel structure stamped into the world as it generates (in the Rust workers), so it is
 * there from the first frame, costs nothing at runtime, and survives chunk reloads.
 *
 * Coordinates are world coordinates inside the box `origin .. origin + size`. Cells you never
 * write keep the natural terrain; write `'air'` to carve.
 */
export class Blueprint {
  readonly origin: Vec3;
  readonly size: Vec3;
  private cells: Int16Array;
  private palette: BlockRef[] = [];
  private paletteIndex = new Map<BlockRef, number>();

  constructor(origin: Vec3, size: Vec3) {
    this.origin = { x: Math.floor(origin.x), y: Math.floor(origin.y), z: Math.floor(origin.z) };
    this.size = { x: Math.floor(size.x), y: Math.floor(size.y), z: Math.floor(size.z) };
    this.cells = new Int16Array(this.size.x * this.size.y * this.size.z).fill(-1);
  }

  /** As plain data, to send it to a client or a worker (`Blueprint.fromData` on the other side). */
  toData(): BlueprintData {
    return { origin: this.origin, size: this.size, cells: this.cells.slice(), palette: [...this.palette] };
  }

  static fromData(d: BlueprintData): Blueprint {
    const b = new Blueprint(d.origin, d.size);
    b.cells.set(d.cells);
    for (const block of d.palette) b.ref(block);
    return b;
  }

  /** Box centred on (cx, cz) horizontally, spanning y0..y1 inclusive. */
  static centered(cx: number, cz: number, radius: number, y0: number, y1: number): Blueprint {
    return new Blueprint({ x: cx - radius, y: y0, z: cz - radius }, { x: radius * 2 + 1, y: y1 - y0 + 1, z: radius * 2 + 1 });
  }

  private index(x: number, y: number, z: number): number {
    const lx = x - this.origin.x;
    const ly = y - this.origin.y;
    const lz = z - this.origin.z;
    if (lx < 0 || ly < 0 || lz < 0 || lx >= this.size.x || ly >= this.size.y || lz >= this.size.z) return -1;
    return (ly * this.size.z + lz) * this.size.x + lx;
  }

  private ref(block: BlockRef): number {
    let i = this.paletteIndex.get(block);
    if (i === undefined) {
      i = this.palette.length;
      this.palette.push(block);
      this.paletteIndex.set(block, i);
    }
    return i;
  }

  set(x: number, y: number, z: number, block: BlockRef): this {
    const i = this.index(Math.floor(x), Math.floor(y), Math.floor(z));
    if (i >= 0) this.cells[i] = this.ref(block);
    return this;
  }

  get(x: number, y: number, z: number): BlockRef | undefined {
    const i = this.index(Math.floor(x), Math.floor(y), Math.floor(z));
    if (i < 0 || this.cells[i] < 0) return undefined;
    return this.palette[this.cells[i]];
  }

  /** Fill an inclusive box. `block` may be a function for patterns. */
  fill(a: Vec3, b: Vec3, block: BlockRef | ((x: number, y: number, z: number) => BlockRef | undefined)): this {
    const [x0, x1] = [Math.min(a.x, b.x), Math.max(a.x, b.x)];
    const [y0, y1] = [Math.min(a.y, b.y), Math.max(a.y, b.y)];
    const [z0, z1] = [Math.min(a.z, b.z), Math.max(a.z, b.z)];
    for (let y = y0; y <= y1; y++)
      for (let z = z0; z <= z1; z++)
        for (let x = x0; x <= x1; x++) {
          const v = typeof block === 'function' ? block(x, y, z) : block;
          if (v !== undefined) this.set(x, y, z, v);
        }
    return this;
  }

  /**
   * Visit every column within `radius` of (cx, cz); the callback gets the horizontal distance
   * and angle so rings, walls and seats are one-liners.
   */
  columns(cx: number, cz: number, radius: number, fn: (x: number, z: number, dist: number, angle: number) => void): this {
    const r = Math.ceil(radius);
    for (let z = cz - r; z <= cz + r; z++)
      for (let x = cx - r; x <= cx + r; x++) {
        const d = Math.hypot(x + 0.5 - (cx + 0.5), z + 0.5 - (cz + 0.5));
        if (d <= radius) fn(x, z, d, Math.atan2(z - cz, x - cx));
      }
    return this;
  }

  /** A copy shifted by `offset` (place one build in several spots). */
  moved(offset: Vec3): Blueprint {
    const bp = new Blueprint(
      { x: this.origin.x + Math.floor(offset.x), y: this.origin.y + Math.floor(offset.y), z: this.origin.z + Math.floor(offset.z) },
      this.size,
    );
    bp.cells.set(this.cells);
    bp.palette = [...this.palette];
    bp.paletteIndex = new Map(this.paletteIndex);
    return bp;
  }

  /** Visit every written cell (block names as written). */
  forEach(fn: (x: number, y: number, z: number, block: BlockRef) => void) {
    const { x: sx, y: sy, z: sz } = this.size;
    for (let y = 0; y < sy; y++)
      for (let z = 0; z < sz; z++)
        for (let x = 0; x < sx; x++) {
          const c = this.cells[(y * sz + z) * sx + x];
          if (c >= 0) fn(x + this.origin.x, y + this.origin.y, z + this.origin.z, this.palette[c]);
        }
  }

  /** Resolve block names and pack for the generator. */
  build(resolve: (block: BlockRef) => number) {
    const ids = this.palette.map((b) => resolve(b));
    const data = new Uint8Array(this.cells.length);
    for (let i = 0; i < data.length; i++) data[i] = this.cells[i] < 0 ? 255 : ids[this.cells[i]];
    return { origin: this.origin, size: this.size, data };
  }
}
