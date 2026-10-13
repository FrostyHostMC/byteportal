import type { Blueprint, BlockRef, Vec3 } from '@platform';

/**
 * What every Call of Blocky map is, and the pieces they're built from: the pulp street
 * furniture (palms, the Big Kahuna Burger truck, the convertible, the cab), pixel lettering for
 * signs, and the block-state helpers. Each map builds its own Blueprint with these.
 */

/** Where a fighter appears: feet position, `yaw` 0 looks toward -z. */
export interface SpawnPoint {
  x: number;
  y: number;
  z: number;
  yaw: number;
}

/** A bomb site for The Briefcase: where the case is planted (`at`, feet level), and how near counts. */
export interface Site {
  name: 'A' | 'B';
  /** What it's called on the HUD ("the kitchen"). */
  label: string;
  at: Vec3;
  radius: number;
}

export interface Terraform {
  x: number;
  z: number;
  radius: number;
  blend: number;
  height: number;
}

/**
 * A map. Every map is built into the one world (each far from the others, so only the one being
 * played is ever drawn), and the game moves play to the map it's on: its spawns, its bounds (the
 * bots' walking grid), its hotspots.
 *
 * - `floorY`: the y players stand at on the ground (the top of the ground blocks is `floorY`).
 *   All maps share it (the world's plain ground and its unbreakable layer are at `floorY - 1`).
 * - `bounds`: the playable box (bots walk inside it; under it is out of the map).
 * - `sea`: open water round it (Hijacked's): whoever's feet go under this y has gone overboard,
 *   and is out of the map as surely as under its bounds.
 * - `spawns`: where fighters appear in a free-for-all, and respawn in Team Deathmatch.
 * - `teams`: each team's side (Team Deathmatch's first spawns), the first team's first.
 * - `bomb`: The Briefcase: where the attackers and the defenders start, and the two sites.
 * - `home`: where people come in, and what the home page looks at, while a match is on it.
 * - `overview`: a camera looking over it.
 * - `hotspots`: places worth fighting over (bots drift toward them).
 */
export interface MapSpec {
  id: string;
  name: string;
  /** A line about it, for the banner at the start of a match. */
  blurb: string;
  floorY: number;
  structures: Blueprint[];
  terraform: Terraform[];
  bounds: { min: Vec3; max: Vec3 };
  sea?: number;
  spawns: SpawnPoint[];
  teams: [SpawnPoint[], SpawnPoint[]];
  bomb: { attack: SpawnPoint[]; defend: SpawnPoint[]; sites: [Site, Site] };
  home: SpawnPoint;
  overview: { position: Vec3; target: Vec3 };
  hotspots: Vec3[];
}

export type Facing = 'north' | 'east' | 'south' | 'west';
export type Fill = BlockRef | ((x: number, y: number, z: number) => BlockRef | undefined);

export const stairs = (m: string, f: Facing, top = false) => `${m}_stairs[facing=${f},half=${top ? 'top' : 'bottom'}]`;
export const slab = (m: string, top = false) => `${m}_slab[type=${top ? 'top' : 'bottom'}]`;
export const torch = (f: Facing) => `torch[facing=${f}]`;

/** A steady pseudo-random number in [0, 1) for a column (weathering, scatter). */
export function hash(x: number, z: number, k = 0): number {
  let h = Math.imul(x, 374761393) + Math.imul(z, 668265263) + Math.imul(k, 1274126177);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** Yaw that looks from (x, z) toward (tx, tz). */
export const yawTo = (x: number, z: number, tx: number, tz: number) => Math.atan2(-(tx - x), -(tz - z));
/** A spawn standing in block (x, z) on the floor at y, facing (tx, tz). */
export const spawnAt = (x: number, y: number, z: number, tx: number, tz: number): SpawnPoint => ({ x: x + 0.5, y, z: z + 0.5, yaw: yawTo(x, z, tx, tz) });

// ---------------------------------------------------------------------------------------------
// Canvases: a Blueprint, or a place on one, moved and turned
// ---------------------------------------------------------------------------------------------

/** What a prop is drawn on: a Blueprint, or a `Place` on one. */
export interface Canvas {
  set(x: number, y: number, z: number, block: BlockRef): unknown;
  fill(a: Vec3, b: Vec3, block: BlockRef | ((x: number, y: number, z: number) => BlockRef | undefined)): unknown;
}

const TURN: Record<Facing, Facing> = { north: 'east', east: 'south', south: 'west', west: 'north' };

/**
 * A spot on a Blueprint to build something in its own coordinates, moved to (ox, oz) and turned
 * `turns` quarter turns (clockwise from above: what faces -x, west, faces north after one), with
 * the blocks that face a way (stairs, torches, beds) and lie along an axis (logs, poles) turned
 * with it. The props here all face -x, so `new Place(bp, x, z, 1)` parks a car nose north.
 */
export class Place implements Canvas {
  constructor(
    private bp: Canvas,
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
    this.bp.set(wx, y, wz, this.turned(block));
  }

  fill(a: Vec3, b: Vec3, block: BlockRef | ((x: number, y: number, z: number) => BlockRef | undefined)) {
    for (let y = Math.min(a.y, b.y); y <= Math.max(a.y, b.y); y++)
      for (let z = Math.min(a.z, b.z); z <= Math.max(a.z, b.z); z++)
        for (let x = Math.min(a.x, b.x); x <= Math.max(a.x, b.x); x++) {
          const v = typeof block === 'function' ? block(x, y, z) : block;
          if (v !== undefined) this.set(x, y, z, v);
        }
  }
}

// ---------------------------------------------------------------------------------------------
// Pixel fonts and sprites
// ---------------------------------------------------------------------------------------------

export const FONT: Record<string, string[]> = {
  A: ['.X.', 'X.X', 'XXX', 'X.X', 'X.X'],
  B: ['XX.', 'X.X', 'XX.', 'X.X', 'XX.'],
  C: ['.XX', 'X..', 'X..', 'X..', '.XX'],
  D: ['XX.', 'X.X', 'X.X', 'X.X', 'XX.'],
  E: ['XXX', 'X..', 'XX.', 'X..', 'XXX'],
  F: ['XXX', 'X..', 'XX.', 'X..', 'X..'],
  G: ['.XX', 'X..', 'X.X', 'X.X', '.XX'],
  H: ['X.X', 'X.X', 'XXX', 'X.X', 'X.X'],
  I: ['XXX', '.X.', '.X.', '.X.', 'XXX'],
  J: ['..X', '..X', '..X', 'X.X', '.X.'],
  K: ['X.X', 'X.X', 'XX.', 'X.X', 'X.X'],
  L: ['X..', 'X..', 'X..', 'X..', 'XXX'],
  M: ['X...X', 'XX.XX', 'X.X.X', 'X...X', 'X...X'],
  N: ['X..X', 'XX.X', 'X.XX', 'X..X', 'X..X'],
  O: ['.X.', 'X.X', 'X.X', 'X.X', '.X.'],
  P: ['XX.', 'X.X', 'XX.', 'X..', 'X..'],
  R: ['XX.', 'X.X', 'XX.', 'X.X', 'X.X'],
  S: ['.XX', 'X..', '.X.', '..X', 'XX.'],
  T: ['XXX', '.X.', '.X.', '.X.', '.X.'],
  U: ['X.X', 'X.X', 'X.X', 'X.X', 'XXX'],
  V: ['X.X', 'X.X', 'X.X', 'X.X', '.X.'],
  W: ['X...X', 'X...X', 'X.X.X', 'XX.XX', 'X...X'],
  Y: ['X.X', 'X.X', '.X.', '.X.', '.X.'],
  ' ': ['.', '.', '.', '.', '.'],
};

/** Big 7-row letters for the diner sign. */
export const FONT7: Record<string, string[]> = {
  S: ['.XXX.', 'X...X', 'X....', '.XXX.', '....X', 'X...X', '.XXX.'],
  L: ['X...', 'X...', 'X...', 'X...', 'X...', 'X...', 'XXXX'],
  I: ['XXX', '.X.', '.X.', '.X.', '.X.', '.X.', 'XXX'],
  M: ['X...X', 'XX.XX', 'X.X.X', 'X.X.X', 'X...X', 'X...X', 'X...X'],
};

/** Rows of a text (top first) laid out left to right with 1-column gaps. */
export function layout(text: string, font: Record<string, string[]>): string[] {
  const glyphs = [...text].map((c) => font[c] ?? font[' ']);
  const h = glyphs[0].length;
  const rows: string[] = [];
  for (let r = 0; r < h; r++) rows.push(glyphs.map((g) => g[r]).join('.'));
  return rows;
}

/**
 * Stamp a sprite (rows top first) onto a vertical plane. `at(u, v)` maps the sprite column u
 * (left to right as seen by the viewer) and row-from-bottom v to a world cell.
 */
export function sprite(bp: Canvas, rows: string[], colors: Record<string, BlockRef>, at: (u: number, v: number) => Vec3, scale = 1) {
  const h = rows.length;
  rows.forEach((row, r) => {
    [...row].forEach((ch, c) => {
      const block = colors[ch];
      if (block === undefined) return;
      for (let a = 0; a < scale; a++)
        for (let b = 0; b < scale; b++) {
          const p = at(c * scale + a, (h - 1 - r) * scale + b);
          bp.set(p.x, p.y, p.z, block);
        }
    });
  });
}

/** Add a 1-cell outline (key 'K') round the filled cells of a sprite. */
export function outlined(rows: string[]): string[] {
  const h = rows.length + 2;
  const w = Math.max(...rows.map((r) => r.length)) + 2;
  const at = (r: number, c: number) => {
    const row = rows[r - 1];
    if (!row) return '.';
    return row[c - 1] ?? '.';
  };
  const out: string[] = [];
  for (let r = 0; r < h; r++) {
    let s = '';
    for (let c = 0; c < w; c++) {
      const v = at(r, c);
      if (v !== '.') {
        s += v;
        continue;
      }
      let edge = false;
      for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) if (at(r + dr, c + dc) !== '.') edge = true;
      s += edge ? 'K' : '.';
    }
    out.push(s);
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------------------------

/**
 * A palm standing on y0: a tall banded trunk that leans only near the top (no ledge anyone could
 * climb), and a crown of long drooping fronds.
 */
export function palm(bp: Canvas, x: number, z: number, height: number, lean: [number, number], y0: number) {
  let tx = x;
  let tz = z;
  const kink = Math.max(7, Math.floor(height * 0.75));
  for (let i = 0; i < height; i++) {
    if (i === kink) {
      tx += lean[0];
      tz += lean[1];
    }
    bp.set(tx, y0 + i, tz, i % 3 === 2 ? 'birch_planks' : 'sandstone');
  }
  const top = y0 + height;
  bp.set(tx, top, tz, 'birch_leaves');
  const dirs: [number, number][] = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, 1], [1, -1], [-1, -1]];
  for (const [dx, dz] of dirs) {
    const diag = dx !== 0 && dz !== 0;
    const len = diag ? 4 : 5;
    for (let k = 1; k <= len; k++) {
      const drop = k <= 2 ? 0 : k <= 4 ? 1 : 2;
      bp.set(tx + dx * k, top - drop, tz + dz * k, 'birch_leaves');
      // Frond tips hang down a little further.
      if (k === len) bp.set(tx + dx * k, top - drop - 1, tz + dz * k, 'birch_leaves');
    }
  }
  bp.set(tx, top + 1, tz, 'birch_leaves');
  // Coconuts.
  bp.set(tx + 1, top - 1, tz, 'brown_concrete');
  bp.set(tx - 1, top - 1, tz + 1, 'brown_concrete');
  bp.set(tx, top - 1, tz - 1, 'brown_concrete');
}

export function hydrant(bp: Canvas, x: number, y: number, z: number) {
  bp.set(x, y, z, 'red_concrete');
  bp.set(x, y + 1, z, slab('brick'));
}

/** The Big Kahuna Burger truck standing on y, nose toward -x: cab at x0, box body behind, open back doors at x0 + 9. */
export function foodTruck(bp: Canvas, x0: number, y: number, z0: number) {
  const fill = (xa: number, ya: number, za: number, xb: number, yb: number, zb: number, block: Fill) => bp.fill({ x: xa, y: ya, z: za }, { x: xb, y: yb, z: zb }, block);
  const x1 = x0 + 9;
  const z1 = z0 + 3;
  // Cab: bumper and hood, windscreen, roof.
  fill(x0, y, z0, x0, y, z1, 'iron_block');
  fill(x0 + 1, y, z0, x0 + 2, y + 3, z1, 'white_concrete');
  fill(x0 + 1, y + 1, z0 + 1, x0 + 1, y + 2, z1 - 1, 'air'); // windscreen
  fill(x0 + 2, y + 1, z0 + 1, x0 + 2, y + 1, z1 - 1, stairs('spruce', 'east')); // seats
  fill(x0 + 2, y + 2, z0 + 1, x0 + 2, y + 2, z1 - 1, 'air');
  fill(x0 + 1, y + 3, z0, x0 + 2, y + 3, z1, 'yellow_concrete');
  // Box body.
  fill(x0 + 3, y, z0, x1, y + 3, z1, (x, yy, z) => {
    const wall = z === z0 || z === z1 || x === x0 + 3;
    if (yy === y + 3) return 'yellow_concrete';
    if (!wall) return yy === y ? slab('birch') : 'air';
    if (yy === y) return 'red_concrete';
    if (yy === y + 2 && z !== z0) return 'red_concrete';
    return 'white_concrete';
  });
  // Open back: doors swung out to the sides.
  fill(x1, y, z0 + 1, x1, y + 2, z1 - 1, (_x, yy) => (yy === y ? slab('birch') : 'air'));
  fill(x1 + 1, y, z0 - 1, x1 + 1, y + 2, z0 - 1, 'white_concrete');
  fill(x1 + 1, y, z1 + 1, x1 + 1, y + 2, z1 + 1, 'white_concrete');
  // Serving hatch on the north side (vault through), with an awning at roof height.
  fill(x0 + 4, y + 1, z0, x0 + 8, y + 2, z0, 'air');
  fill(x0 + 4, y, z0, x0 + 8, y, z0, 'red_concrete');
  fill(x0 + 4, y + 3, z0 - 1, x0 + 8, y + 3, z0 - 1, (x) => (x % 2 === 0 ? 'red_concrete' : 'white_concrete'));
  // Counter inside the hatch, grill at the back of it.
  fill(x0 + 5, y + 1, z1 - 1, x0 + 7, y + 1, z1 - 1, 'iron_block');
  // Side door on the south side.
  fill(x0 + 4, y + 1, z1, x0 + 5, y + 2, z1, 'air');
  fill(x0 + 4, y, z1, x0 + 5, y, z1, slab('birch'));
  // Wheels.
  for (const x of [x0 + 1, x0 + 6, x0 + 7]) {
    bp.set(x, y, z0, 'black_concrete');
    bp.set(x, y, z1, 'black_concrete');
  }
  // Lamp inside.
  bp.set(x0 + 6, y + 3, z0 + 1, 'sea_lantern');
  // Neon burger on the roof.
  const bx = x0 + 6;
  const burger = ['.YYY.', 'YYYYY', 'LLLLL', 'RRRRR', '.YYY.'];
  for (const z of [z0 + 1, z0 + 2]) sprite(bp, burger, { Y: 'neon_yellow', L: 'lime_concrete', R: 'neon_red' }, (u, v) => ({ x: bx - 2 + u, y: y + 4 + v, z }));
}

/**
 * A 1960s convertible standing on y, nose toward -x: a long low body, chrome windscreen posts,
 * white bench seats standing proud of the belt line, tail fins.
 */
export function convertible(bp: Canvas, x0: number, y: number, z0: number, body: BlockRef = 'red_concrete') {
  const x1 = x0 + 5;
  const z1 = z0 + 2;
  bp.fill({ x: x0, y, z: z0 }, { x: x1, y, z: z1 }, body);
  for (const x of [x0 + 1, x1 - 1]) {
    bp.set(x, y, z0, 'black_concrete');
    bp.set(x, y, z1, 'black_concrete');
  }
  bp.fill({ x: x0, y: y + 1, z: z0 }, { x: x1, y: y + 1, z: z1 }, (x, _y, z) => {
    const side = z === z0 || z === z1;
    if (x === x0) return body; // hood
    if (x === x0 + 1) return side ? 'iron_block' : undefined; // windscreen posts
    if (x === x0 + 3) return 'white_concrete'; // front bench's back
    if (x === x1) return side ? body : 'white_concrete'; // fins, rear bench's back
    return side ? body : undefined; // doors
  });
  bp.set(x0 - 1, y, z0 + 1, 'iron_block'); // chrome bumper
}

/** A yellow cab standing on y, nose toward -x, with a checker stripe and a roof light. */
export function taxi(bp: Canvas, x0: number, y: number, z0: number) {
  const x1 = x0 + 5;
  const z1 = z0 + 2;
  bp.fill({ x: x0, y, z: z0 }, { x: x1, y: y + 1, z: z1 }, (x, yy, z) => {
    if (yy === y + 1 && (z === z0 || z === z1) && x > x0 && x < x1) return (x + yy) % 2 === 0 ? 'black_concrete' : 'white_concrete';
    return 'yellow_concrete';
  });
  for (const x of [x0 + 1, x1 - 1]) {
    bp.set(x, y, z0, 'black_concrete');
    bp.set(x, y, z1, 'black_concrete');
  }
  // Cabin: corner pillars, roof, open windows, back seat.
  for (const x of [x0 + 1, x0 + 4]) for (const z of [z0, z1]) bp.set(x, y + 2, z, 'yellow_concrete');
  bp.fill({ x: x0 + 1, y: y + 3, z: z0 }, { x: x0 + 4, y: y + 3, z: z1 }, 'yellow_concrete');
  bp.fill({ x: x0 + 2, y: y + 1, z: z0 + 1 }, { x: x0 + 3, y: y + 1, z: z0 + 1 }, stairs('spruce', 'west'));
  bp.set(x0 + 2, y + 4, z0 + 1, 'neon_yellow');
  bp.set(x0 + 3, y + 4, z0 + 1, 'neon_yellow');
}

/**
 * A split-window bus standing on y, nose toward -x: two-tone, windows all round, a sliding door
 * open on its +z side (hide in it, or shoot through it).
 */
export function van(bp: Canvas, x0: number, y: number, z0: number, lower: BlockRef = 'orange_concrete', upper: BlockRef = 'white_concrete') {
  const x1 = x0 + 5;
  const z1 = z0 + 2;
  bp.fill({ x: x0, y, z: z0 }, { x: x1, y: y + 3, z: z1 }, (x, yy, z) => {
    const side = z === z0 || z === z1;
    const end = x === x0 || x === x1;
    if (yy === y + 3) return upper;
    if (yy === y) return side && (x === x0 + 1 || x === x1 - 1) ? 'black_concrete' : lower;
    if (!side && !end) return 'air';
    if (yy === y + 1) return x === x0 ? upper : lower;
    // Windows, pillars between them.
    return x === x0 || (x !== x0 + 2 && x !== x1) ? 'glass' : upper;
  });
  // The sliding door, open.
  bp.fill({ x: x0 + 2, y: y + 1, z: z1 }, { x: x0 + 3, y: y + 2, z: z1 }, 'air');
  // A bench seat inside, the spare on the nose.
  bp.set(x1 - 1, y + 1, z0 + 1, stairs('spruce', 'west'));
  bp.set(x0 - 1, y + 1, z0 + 1, 'black_concrete');
}

/** A pickup truck standing on y, nose toward -x: a cab, and an open bed behind it. */
export function pickup(bp: Canvas, x0: number, y: number, z0: number, body: BlockRef = 'light_blue_concrete') {
  const x1 = x0 + 6;
  const z1 = z0 + 2;
  bp.fill({ x: x0, y, z: z0 }, { x: x1, y: y + 1, z: z1 }, (x, yy, z) => {
    if (yy === y) return (z === z0 || z === z1) && (x === x0 + 1 || x === x1 - 1) ? 'black_concrete' : body;
    if (x >= x0 + 3 && x < x1 && z !== z0 && z !== z1) return 'air'; // the bed
    return body;
  });
  // The cab: windscreen, roof.
  bp.fill({ x: x0 + 1, y: y + 2, z: z0 }, { x: x0 + 2, y: y + 2, z: z1 }, (x, _y, z) => (x === x0 + 1 || z === z0 || z === z1 ? 'glass' : body));
  bp.fill({ x: x0 + 1, y: y + 3, z: z0 }, { x: x0 + 2, y: y + 3, z: z1 }, body);
  bp.set(x0 - 1, y, z0 + 1, 'iron_block'); // chrome bumper
  // Something in the bed: a crate of buns.
  bp.set(x0 + 4, y + 1, z0 + 1, 'oak_planks');
}

/** A woody station wagon standing on y, nose toward -x: wood-panelled sides, a cream roof. */
export function wagon(bp: Canvas, x0: number, y: number, z0: number, body: BlockRef = 'white_concrete') {
  const x1 = x0 + 6;
  const z1 = z0 + 2;
  bp.fill({ x: x0, y, z: z0 }, { x: x1, y: y + 1, z: z1 }, (x, yy, z) => {
    const side = z === z0 || z === z1;
    if (yy === y) return side && (x === x0 + 1 || x === x1 - 1) ? 'black_concrete' : body;
    if (x === x0) return body; // hood
    return side ? 'birch_planks' : x === x1 ? body : 'air';
  });
  bp.fill({ x: x0 + 1, y: y + 2, z: z0 }, { x: x1, y: y + 2, z: z1 }, (x, _y, z) => (z === z0 || z === z1 ? (x === x0 + 1 || x === x1 || x === x0 + 4 ? body : 'glass') : x === x0 + 1 ? 'glass' : undefined));
  bp.fill({ x: x0 + 1, y: y + 3, z: z0 }, { x: x1, y: y + 3, z: z1 }, (x) => (x === x0 + 1 ? body : 'white_concrete'));
  bp.set(x0 + 3, y + 1, z0 + 1, stairs('spruce', 'west'));
  bp.set(x1 - 1, y + 1, z0 + 1, stairs('spruce', 'west'));
}
