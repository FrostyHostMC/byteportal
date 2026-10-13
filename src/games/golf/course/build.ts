import { Blueprint } from '@platform';
import { BASE, CHUNK, LAYERS, WATER } from '../scale';
import type { Course } from './course';
import { Surf } from './types';

/**
 * The course in the world's blocks: what's walked on and what the water is. The course is drawn
 * as smooth turf over the top (`client/terrain.ts`); these blocks are its footing, and nobody sees
 * them: `turf` up to the ground's whole blocks, a `turf_n` layer (n eighths of a block) on top, so
 * feet stand within a sixteenth of the drawn ground. Ponds and creeks are real water (drawn with
 * the world's water, reflections and all), filling every column whose ground is near or under the
 * water's level, so the drawn banks meet it. Tree trunks are solid (the trees are drawn too).
 *
 * It's stamped as the world generates, in tiles of one chunk each (16 × 16 columns, as tall as
 * that tile needs), over every square the course is drawn in; the plain beyond is the world's.
 */
export function buildCourse(course: Course): Blueprint[] {
  const tiles = new Map<number, Tile>();
  const key = (tx: number, tz: number) => (tx + 2048) * 4096 + (tz + 2048);
  const tileOf = (x: number, z: number) => {
    const tx = Math.floor(x / 16);
    const tz = Math.floor(z / 16);
    const k = key(tx, tz);
    let t = tiles.get(k);
    if (!t) tiles.set(k, (t = new Tile(tx, tz)));
    return t;
  };

  for (const c of course.chunks)
    for (let tz = c.z0 / 16; tz < (c.z0 + CHUNK) / 16; tz++)
      for (let tx = c.x0 / 16; tx < (c.x0 + CHUNK) / 16; tx++) {
        const t = new Tile(tx, tz);
        t.lay(course, c.shaped);
        tiles.set(key(tx, tz), t);
      }

  // Trunks: solid from the ground up.
  for (const tree of course.trees) {
    const x = Math.floor(tree.x);
    const z = Math.floor(tree.z);
    const t = tileOf(x, z);
    for (let y = Math.floor(tree.base); y < tree.base + tree.trunk; y++) t.put(x, y, z, 'turf');
  }

  return [...tiles.values()].filter((t) => t.used).map((t) => t.blueprint());
}

/** A pond's or creek's column (or one at its edge): water there, not in a bunker that happens to be low. */
function wet(course: Course, x: number, z: number): boolean {
  for (const [dx, dz] of [
    [0.5, 0.5],
    [0, 0],
    [1, 0],
    [0, 1],
    [1, 1],
  ])
    if (course.ground(x + dx, z + dz).surf === Surf.Water) return true;
  return false;
}

/** A chunk's column of the course: cells written by (x, y, z), turned into a Blueprint at the end. */
class Tile {
  readonly x0: number;
  readonly z0: number;
  private cells = new Map<number, string>();
  private y0 = Infinity;
  private y1 = -Infinity;
  used = false;

  constructor(tx: number, tz: number) {
    this.x0 = tx * 16;
    this.z0 = tz * 16;
  }

  put(x: number, y: number, z: number, block: string) {
    const lx = x - this.x0;
    const lz = z - this.z0;
    if (lx < 0 || lz < 0 || lx >= 16 || lz >= 16 || y < 0 || y > 255) return;
    this.cells.set((y * 16 + lz) * 16 + lx, block);
    if (y < this.y0) this.y0 = y;
    if (y > this.y1) this.y1 = y;
    this.used = true;
  }

  /** Every column's footing (the plain's too: the drawn ground covers it, so its grass goes). */
  lay(course: Course, shaped: boolean) {
    for (let lz = 0; lz < 16; lz++)
      for (let lx = 0; lx < 16; lx++) {
        const x = this.x0 + lx;
        const z = this.z0 + lz;
        if (!shaped) {
          this.put(x, BASE - 1, z, 'turf');
          continue;
        }
        // (Only ground near the water's level can be a pond's: `wet` samples the land five times.)
        const h = course.height(x + 0.5, z + 0.5);
        this.column(x, z, h, h < WATER + 0.25 && wet(course, x, z));
      }
  }

  private column(x: number, z: number, h: number, wet: boolean) {
    // Water in a pond's columns and those at its edge a little over the level (the drawn banks cover them).
    if (wet && h < WATER + 0.25) {
      const level = Math.floor(WATER);
      const bed = Math.min(Math.floor(h), level);
      for (let y = bed; y <= level; y++) this.put(x, y, z, 'water');
      for (let y = level + 1; y < BASE; y++) this.put(x, y, z, 'air');
      return;
    }
    const q = Math.round(h * LAYERS) / LAYERS;
    const top = Math.floor(q);
    const n = Math.round((q - top) * LAYERS);
    // Whole blocks up to the top (the plain's own ground under BASE stays; its grass goes).
    for (let y = Math.min(top - 1, BASE - 1); y < top; y++) this.put(x, y, z, 'turf');
    if (n > 0) this.put(x, top, z, `turf_${n}`);
    for (let y = n > 0 ? top + 1 : top; y < BASE; y++) this.put(x, y, z, 'air');
  }

  blueprint(): Blueprint {
    const bp = new Blueprint({ x: this.x0, y: this.y0, z: this.z0 }, { x: 16, y: this.y1 - this.y0 + 1, z: 16 });
    for (const [i, block] of this.cells) {
      const lx = i % 16;
      const lz = Math.floor(i / 16) % 16;
      const y = Math.floor(i / 256);
      bp.set(this.x0 + lx, y, this.z0 + lz, block);
    }
    return bp;
  }
}
