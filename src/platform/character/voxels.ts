/**
 * Micro-voxel models in code (the platform's characters: `build.ts`): shapes painted into voxel
 * volumes, meshed as the visible voxel faces, each on a tile of a small palette atlas: an albedo,
 * a metallic-roughness (G roughness, B metalness) and an emissive image of one UV layout. The look
 * is Call of Blocky's and Blockfront's (their build tools' `voxel.mjs`, which this follows): clean
 * voxels, flat colours, the grid read from the steps, the colours and the soft occlusion in the
 * concave corners.
 *
 * - Voxels: integer cells (i, j, k); cell (i, j, k) spans [i, i+1] x [j, j+1] x [k, k+1]. A model
 *   is parts (a character's: a part per joint), each a map of cells to colour names. Parts may
 *   share cells (a part reaching into its neighbour); a face shows where its own part has no
 *   voxel, so a part's surface is whole whatever the others do.
 * - Faces: each face of a voxel toward a cell its part leaves empty is a quad. Its occlusion: the
 *   cells round the one it faces (any part's): an occupied edge neighbour darkens that edge of the
 *   tile, an occupied corner neighbour (both its edges open) that corner. The state is reduced to a
 *   canonical one under the square's eight symmetries, the quad's UVs turned to match, so a few
 *   tiles serve. Faces one part shows toward another's voxel are kept (they show when the parts
 *   move apart). Faces of one part, plane and colour that nothing shades merge into rectangles.
 * - Tiles: one per (colour, occlusion) in use, 8 x 8 texels; a quad's UVs half a texel in from its
 *   tile's edges.
 */

/** A colour of a model: sRGB hex, how rough and metallic it is, how much it glows (0..1). */
export interface Paint {
  name: string;
  rgb: number;
  rough: number;
  metal: number;
  glow: number;
  /** How much its voxels' shades vary (0: all alike). */
  vary: number;
}

/** A model's colours by name. */
export class Palette {
  readonly colours = new Map<string, Paint>();
  add(name: string, rgb: number, o: { rough?: number; metal?: number; glow?: number; vary?: number } = {}): string {
    this.colours.set(name, { name, rgb, rough: o.rough ?? 0.8, metal: o.metal ?? 0, glow: o.glow ?? 0, vary: o.vary ?? 0.045 });
    return name;
  }
  get(name: string): Paint {
    const c = this.colours.get(name);
    if (!c) throw new Error(`no colour ${name}`);
    return c;
  }
}

const B = 512;
/** A cell as one number (each coordinate -512..511). */
export const cellKey = (i: number, j: number, k: number) => i + B + (j + B) * 1024 + (k + B) * 1048576;
export const cellOf = (key: number): [number, number, number] => [(key % 1024) - B, (Math.floor(key / 1024) % 1024) - B, Math.floor(key / 1048576) - B];

/** What a painter gives a cell: a colour to set, `false` to clear it, nothing to leave it. */
export type Colouring = string | false | undefined | null | void;

/** A voxel model: parts, each a map of cells to colour names. */
export class Voxels {
  readonly parts = new Map<string, Map<number, string>>();
  part(name: string): Map<number, string> {
    let p = this.parts.get(name);
    if (!p) this.parts.set(name, (p = new Map()));
    return p;
  }
  set(part: string, i: number, j: number, k: number, colour: string) {
    if (!Number.isInteger(i) || !Number.isInteger(j) || !Number.isInteger(k)) throw new Error(`voxel ${part} at ${i}, ${j}, ${k}: not a cell`);
    this.part(part).set(cellKey(i, j, k), colour);
  }
  get(part: string, i: number, j: number, k: number): string | undefined {
    return this.parts.get(part)?.get(cellKey(i, j, k));
  }
  del(part: string, i: number, j: number, k: number) {
    this.parts.get(part)?.delete(cellKey(i, j, k));
  }
  /** Paint the cells of a box (lo inclusive, hi exclusive): `fn(i, j, k)` colours each. */
  paint(part: string, lo: number[], hi: number[], fn: (i: number, j: number, k: number) => Colouring) {
    const p = this.part(part);
    for (let k = lo[2]; k < hi[2]; k++)
      for (let j = lo[1]; j < hi[1]; j++)
        for (let i = lo[0]; i < hi[0]; i++) {
          const c = fn(i, j, k);
          if (c === false) p.delete(cellKey(i, j, k));
          else if (c) p.set(cellKey(i, j, k), c);
        }
  }
  /** Recolour a part's voxels: `fn(i, j, k, colour)` gives the new colour (nothing keeps it, `false` clears it). */
  recolour(part: string, fn: (i: number, j: number, k: number, colour: string) => Colouring) {
    const p = this.parts.get(part);
    if (!p) return;
    for (const [key, c] of [...p]) {
      const [i, j, k] = cellOf(key);
      const n = fn(i, j, k, c);
      if (n === false) p.delete(key);
      else if (n) p.set(key, n);
    }
  }
  /** Is a cell filled by this part (or, without one, by any)? */
  filled(i: number, j: number, k: number, part?: string): boolean {
    const key = cellKey(i, j, k);
    if (part) return this.parts.get(part)?.has(key) ?? false;
    for (const p of this.parts.values()) if (p.has(key)) return true;
    return false;
  }
  get count(): number {
    let n = 0;
    for (const p of this.parts.values()) n += p.size;
    return n;
  }
}

/** The six directions: normal, and the face's own axes u and v (u x v = the normal). */
export const DIRS = [
  { n: [1, 0, 0], u: [0, 1, 0], v: [0, 0, 1] },
  { n: [-1, 0, 0], u: [0, 0, 1], v: [0, 1, 0] },
  { n: [0, 1, 0], u: [0, 0, 1], v: [1, 0, 0] },
  { n: [0, -1, 0], u: [1, 0, 0], v: [0, 0, 1] },
  { n: [0, 0, 1], u: [1, 0, 0], v: [0, 1, 0] },
  { n: [0, 0, -1], u: [0, 1, 0], v: [1, 0, 0] },
] as const;

// Occlusion states: bits 0-3 the edges at s=0, s=1, t=0, t=1 (s along u, t along v); bits 4-7 the
// corners (0,0), (1,0), (1,1), (0,1). The square's eight symmetries act on (s, t).
type Sym = (s: number, t: number) => [number, number];
const SYM: Sym[] = [(s, t) => [s, t], (s, t) => [1 - t, s], (s, t) => [1 - s, 1 - t], (s, t) => [t, 1 - s], (s, t) => [1 - s, t], (s, t) => [s, 1 - t], (s, t) => [t, s], (s, t) => [1 - t, 1 - s]];
const FEATURES = [[0, 0.5], [1, 0.5], [0.5, 0], [0.5, 1], [0, 0], [1, 0], [1, 1], [0, 1]];
const featureAt = (p: number[]) => FEATURES.findIndex((f) => f[0] === p[0] && f[1] === p[1]);
const SYM_MAP = SYM.map((g) => FEATURES.map((f) => featureAt(g(f[0], f[1]))));
const applySym = (g: number, mask: number) => {
  let out = 0;
  for (let b = 0; b < 8; b++) if (mask & (1 << b)) out |= 1 << SYM_MAP[g][b];
  return out;
};
/** For each state: its canonical state, and the symmetry that takes the canonical one to it. */
const CANON = Array.from({ length: 256 }, (_, mask) => {
  let canon = mask;
  for (let g = 0; g < 8; g++) canon = Math.min(canon, applySym(g, mask));
  const g = SYM.findIndex((_, g2) => applySym(g2, canon) === mask);
  return { canon, g };
});
const SYM_INV = SYM.map((g) =>
  SYM.findIndex((h) =>
    [[0, 0], [1, 0], [0, 1]].every(([s, t]) => {
      const [a, b] = g(s, t);
      const [c, d] = h(a, b);
      return c === s && d === t;
    }),
  ),
);

/** A visible face: its part, cell and direction, its colour and occlusion state, and (merged) its size in cells along u and v. */
export interface Face {
  part: string;
  cell: [number, number, number];
  dir: number;
  colour: string;
  /** Its voxel's shade: 0 darker, 1, 2 lighter (all 1 unless shades vary). */
  shade: number;
  ao: number;
  du: number;
  dv: number;
}

/**
 * The visible faces of every part (merged where nothing shades them). A face toward another part's
 * voxel is kept, fully occluded; a face two parts both show (their voxels in one cell) is kept once.
 */
export function faces(vox: Voxels, palette: Palette | null = null): Face[] {
  const out: Face[] = [];
  const all = new Set<number>();
  for (const cells of vox.parts.values()) for (const key of cells.keys()) all.add(key);
  const seen = new Set<string>();
  const filled = (i: number, j: number, k: number) => all.has(cellKey(i, j, k));
  for (const [part, cells] of vox.parts) {
    for (const [key, colour] of cells) {
      const [i, j, k] = cellOf(key);
      const shade = palette && palette.get(colour).vary ? shadeOf(i, j, k) : 1;
      for (let d = 0; d < 6; d++) {
        const { n, u, v } = DIRS[d];
        const a = [i + n[0], j + n[1], k + n[2]];
        if (cells.has(cellKey(a[0], a[1], a[2]))) continue;
        const fk = `${key},${d}`;
        if (seen.has(fk)) continue;
        seen.add(fk);
        let ao = 0;
        if (filled(a[0], a[1], a[2])) ao = 15;
        else {
          const at = (du: number, dv: number) => filled(a[0] + u[0] * du + v[0] * dv, a[1] + u[1] * du + v[1] * dv, a[2] + u[2] * du + v[2] * dv);
          const e = [at(-1, 0), at(1, 0), at(0, -1), at(0, 1)];
          for (let b = 0; b < 4; b++) if (e[b]) ao |= 1 << b;
          const corners = [[-1, -1, 0, 2], [1, -1, 1, 2], [1, 1, 1, 3], [-1, 1, 0, 3]];
          corners.forEach(([du, dv, e1, e2], b) => {
            if (!e[e1] && !e[e2] && at(du, dv)) ao |= 1 << (4 + b);
          });
        }
        out.push({ part, cell: [i, j, k], dir: d, colour, shade, ao, du: 1, dv: 1 });
      }
    }
  }
  return merge(out);
}

/** Faces of one part, direction, plane and colour with no occlusion, merged into rectangles (greedy: along u, then v). */
function merge(list: Face[]): Face[] {
  const out: Face[] = [];
  const groups = new Map<string, Face[]>();
  for (const f of list) {
    if (f.ao) {
      out.push(f);
      continue;
    }
    const { n } = DIRS[f.dir];
    const a = n[0] ? 0 : n[1] ? 1 : 2;
    const key = `${f.part}|${f.dir}|${f.cell[a]}|${f.colour}|${f.shade}`;
    let g = groups.get(key);
    if (!g) groups.set(key, (g = []));
    g.push(f);
  }
  for (const fs of groups.values()) {
    const { u, v } = DIRS[fs[0].dir];
    const ua = u.indexOf(1);
    const va = v.indexOf(1);
    const at = new Set(fs.map((f) => `${f.cell[ua]},${f.cell[va]}`));
    const used = new Set<string>();
    const free = (x: number, y: number) => at.has(`${x},${y}`) && !used.has(`${x},${y}`);
    fs.sort((p, q) => p.cell[va] - q.cell[va] || p.cell[ua] - q.cell[ua]);
    for (const f of fs) {
      const u0 = f.cell[ua];
      const v0 = f.cell[va];
      if (used.has(`${u0},${v0}`)) continue;
      let w = 1;
      while (free(u0 + w, v0)) w++;
      let h = 1;
      grow: for (;;) {
        for (let x = 0; x < w; x++) if (!free(u0 + x, v0 + h)) break grow;
        h++;
      }
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) used.add(`${u0 + x},${v0 + y}`);
      out.push({ ...f, du: w, dv: h });
    }
  }
  return out;
}

/** A voxel's shade (0 darker, 1, 2 lighter) from its cell. */
function shadeOf(i: number, j: number, k: number): number {
  let h = Math.imul(i + 7919, 0x27d4eb2d) ^ Math.imul(j + 104729, 0x165667b1) ^ Math.imul(k + 15485863, 0x9e3779b1);
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d);
  h ^= h >>> 13;
  const r = (h >>> 0) / 4294967296;
  return r < 0.3 ? 0 : r < 0.72 ? 1 : 2;
}

/** A tile's texels on a side. */
export const TILE = 8;

const toLinear = (c8: number) => {
  const c = c8 / 255;
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
};
const toSrgb8 = (l: number) => {
  const v = l <= 0.0031308 ? l * 12.92 : 1.055 * Math.pow(Math.max(0, l), 1 / 2.4) - 0.055;
  return Math.max(0, Math.min(255, Math.round(v * 255)));
};

/** A tile's texels as brightness factors: flat, darkened in from its occluded edges and corners. */
function tileFactors(ao: number): Float32Array {
  const f = new Float32Array(TILE * TILE);
  const ramp = (d: number) => (d < 0.75 ? 1 - 0.5 * (1 - d / 0.75) ** 2 : 1);
  for (let t = 0; t < TILE; t++)
    for (let s = 0; s < TILE; s++) {
      const x = (s + 0.5) / TILE;
      const y = (t + 0.5) / TILE;
      let k = 1;
      if (ao & 1) k *= ramp(x);
      if (ao & 2) k *= ramp(1 - x);
      if (ao & 4) k *= ramp(y);
      if (ao & 8) k *= ramp(1 - y);
      if (ao & 16) k *= ramp(Math.hypot(x, y) * 1.1);
      if (ao & 32) k *= ramp(Math.hypot(1 - x, y) * 1.1);
      if (ao & 64) k *= ramp(Math.hypot(1 - x, 1 - y) * 1.1);
      if (ao & 128) k *= ramp(Math.hypot(x, 1 - y) * 1.1);
      f[t * TILE + s] = k;
    }
  return f;
}

/** An atlas: its images (RGBA, rows from the top) and each face's four corners' UVs. */
export interface Atlas {
  width: number;
  height: number;
  albedo: Uint8Array;
  /** G roughness, B metalness. */
  mr: Uint8Array;
  /** Each texel's colour times its glow. */
  glow: Uint8Array;
  /** Per face: corners (0,0), (1,0), (1,1), (0,1) of its (s, t), as UVs (v down from the top). */
  uvs: [number, number][][];
}

/**
 * The atlas for a list of faces: a tile per (colour, canonical occlusion) used, colour by colour
 * (so distant mip levels blend a colour with its own), a row of 32 to the image.
 */
export function atlas(list: Face[], palette: Palette, width = 256): Atlas {
  const order = [...palette.colours.keys()];
  const tiles = new Map<string, { colour: string; shade: number; ao: number; x: number; y: number }>();
  for (const f of list) {
    const key = `${f.colour}|${f.shade}|${CANON[f.ao].canon}`;
    if (!tiles.has(key)) tiles.set(key, { colour: f.colour, shade: f.shade, ao: CANON[f.ao].canon, x: 0, y: 0 });
  }
  const sorted = [...tiles.values()].sort((a, b) => order.indexOf(a.colour) - order.indexOf(b.colour) || a.shade - b.shade || a.ao - b.ao);
  const perRow = width / TILE;
  const height = 2 ** Math.ceil(Math.log2(Math.max(TILE, Math.ceil(sorted.length / perRow) * TILE)));
  const albedo = new Uint8Array(width * height * 4);
  const mr = new Uint8Array(width * height * 4);
  const glow = new Uint8Array(width * height * 4);
  const cache = new Map<number, Float32Array>();
  sorted.forEach((tile, n) => {
    tile.x = (n % perRow) * TILE;
    tile.y = Math.floor(n / perRow) * TILE;
    const c = palette.get(tile.colour);
    const lin = [(c.rgb >> 16) & 255, (c.rgb >> 8) & 255, c.rgb & 255].map(toLinear);
    let f = cache.get(tile.ao);
    if (!f) cache.set(tile.ao, (f = tileFactors(tile.ao)));
    const shade = 1 + (tile.shade - 1) * c.vary * 2.2;
    for (let t = 0; t < TILE; t++)
      for (let s = 0; s < TILE; s++) {
        const o = ((tile.y + t) * width + tile.x + s) * 4;
        for (let ch = 0; ch < 3; ch++) {
          albedo[o + ch] = toSrgb8(lin[ch] * shade * f[t * TILE + s]);
          glow[o + ch] = Math.round(albedo[o + ch] * c.glow);
        }
        mr[o + 1] = Math.round(c.rough * 255);
        mr[o + 2] = Math.round(c.metal * 255);
        albedo[o + 3] = mr[o + 3] = glow[o + 3] = 255;
      }
  });
  // Each face's corners: its tile's, turned by the symmetry that takes the canonical state to its own.
  const uvs = list.map((f) => {
    const tile = tiles.get(`${f.colour}|${f.shade}|${CANON[f.ao].canon}`)!;
    const inv = SYM[SYM_INV[CANON[f.ao].g]];
    return [[0, 0], [1, 0], [1, 1], [0, 1]].map(([s, t]) => {
      const [a, b] = inv(s, t);
      return [(tile.x + 0.5 + a * (TILE - 1)) / width, (tile.y + 0.5 + b * (TILE - 1)) / height] as [number, number];
    });
  });
  return { width, height, albedo, mr, glow, uvs };
}

/** A face's quad's corners (voxel units), counter-clockwise from outside. */
export function quadCorners(f: Face): number[][] {
  const { n, u, v } = DIRS[f.dir];
  const o = f.cell.map((c, a) => c + (n[a] > 0 ? 1 : 0));
  return [o, o.map((x, a) => x + u[a] * f.du), o.map((x, a) => x + u[a] * f.du + v[a] * f.dv), o.map((x, a) => x + v[a] * f.dv)];
}
