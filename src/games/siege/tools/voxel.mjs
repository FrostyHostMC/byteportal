/**
 * Micro-voxel models, dependency-free (Node 22+): shapes painted into voxel volumes in code, meshed
 * as the visible voxel faces, each on a tile of a small palette atlas, and written as one-material
 * glTF: a baseColorTexture, a metallicRoughnessTexture (G roughness, B metalness) and an
 * emissiveTexture of one UV layout. The look is clean voxels: flat colours, no outlines, the grid
 * read from the steps, the colours and the soft occlusion in the concave corners. Used by the
 * fighters (`fighters/build.mjs`, skinned) and the weapons (`guns/build.mjs`).
 *
 * - Voxels: integer cells (i, j, k); cell (i, j, k) spans [i, i+1] x [j, j+1] x [k, k+1] in voxel
 *   units. A model is parts (the fighters': a part per joint), each a map of cells to colour names.
 *   Parts may share cells (a part reaching into its neighbour); a face shows where its own part has
 *   no voxel, so a part's surface is whole whatever the others do.
 * - Faces: each face of a voxel toward a cell its part leaves empty is a quad, two triangles,
 *   counter-clockwise from outside. Its occlusion: the cells round the one it faces (any part's):
 *   an occupied edge neighbour darkens that edge of the tile, an occupied corner neighbour (with
 *   both its edges open) that corner. The 8-bit state is reduced to a canonical one under the
 *   square's eight symmetries and the quad's UVs turned to match, so a few tiles serve. Faces a
 *   part shows toward another part's voxel are kept (they show when the parts move apart). Faces
 *   of one part, plane and colour that nothing shades merge into rectangles (`merge`).
 * - Tiles: one per (colour, shade, occlusion) in use, 8 x 8 texels, flat (`VOXEL_BEVEL=pillow` or
 *   `ridge` paints each as a bevelled cube face instead, unmerged, for comparison); the quad's UVs
 *   half a texel in from its edges (bilinear filtering stays in the tile); a colour's tiles sit
 *   together, so distant mip levels blend a colour with its own variants. `vary` picks a shade per
 *   voxel from its cell (off by default).
 */
import { deflateSync } from 'node:zlib';
import { encodeIndexSequence, encodeVertexBuffer, decodeIndexSequence, decodeVertexBuffer } from './meshopt.mjs';

// ---------------------------------------------------------------------------------------------
// Colours

const toLinear = (c8) => {
  const c = c8 / 255;
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
};
const toSrgb8 = (l) => {
  const v = l <= 0.0031308 ? l * 12.92 : 1.055 * Math.pow(Math.max(0, l), 1 / 2.4) - 0.055;
  return Math.max(0, Math.min(255, Math.round(v * 255)));
};
export const hexRGB = (v) => [(v >> 16) & 255, (v >> 8) & 255, v & 255];

/**
 * A model's colours by name: an sRGB hex colour, how rough and metallic it is, how much it glows
 * (0..1, the emissive map's level), and how much its voxels' shades vary (0: all alike).
 */
export class Palette {
  constructor() {
    this.colours = new Map();
  }
  add(name, rgb, { rough = 0.8, metal = 0, glow = 0, vary = 0.045 } = {}) {
    this.colours.set(name, { name, rgb, rough, metal, glow, vary });
    return name;
  }
  get(name) {
    const c = this.colours.get(name);
    if (!c) throw new Error(`no colour ${name}`);
    return c;
  }
}

// ---------------------------------------------------------------------------------------------
// Voxels

const B = 512;
export const cellKey = (i, j, k) => i + B + (j + B) * 1024 + (k + B) * 1048576;
export const cellOf = (key) => [(key % 1024) - B, (Math.floor(key / 1024) % 1024) - B, Math.floor(key / 1048576) - B];

/** A voxel model: parts, each a map of cells to colour names. */
export class Voxels {
  constructor() {
    this.parts = new Map();
  }
  part(name) {
    let p = this.parts.get(name);
    if (!p) this.parts.set(name, (p = new Map()));
    return p;
  }
  set(part, i, j, k, colour) {
    if (!Number.isInteger(i) || !Number.isInteger(j) || !Number.isInteger(k)) throw new Error(`voxel ${part} at ${i}, ${j}, ${k}: not a cell`);
    this.part(part).set(cellKey(i, j, k), colour);
  }
  get(part, i, j, k) {
    return this.parts.get(part)?.get(cellKey(i, j, k));
  }
  del(part, i, j, k) {
    this.parts.get(part)?.delete(cellKey(i, j, k));
  }
  /**
   * Paint the cells of a box (voxel indices, lo inclusive, hi exclusive): `fn(i, j, k)` gives a
   * colour to set, `false` to clear the cell, or nothing to leave it.
   */
  paint(part, lo, hi, fn) {
    const p = this.part(part);
    for (let k = lo[2]; k < hi[2]; k++)
      for (let j = lo[1]; j < hi[1]; j++)
        for (let i = lo[0]; i < hi[0]; i++) {
          const c = fn(i, j, k);
          if (c === false) p.delete(cellKey(i, j, k));
          else if (c) p.set(cellKey(i, j, k), c);
        }
  }
  /** Recolour a part's voxels: `fn(i, j, k, colour)` gives the new colour (or nothing to keep it, `false` to clear). */
  recolour(part, fn) {
    const p = this.parts.get(part);
    if (!p) return;
    for (const [key, c] of [...p]) {
      const [i, j, k] = cellOf(key);
      const n = fn(i, j, k, c);
      if (n === false) p.delete(key);
      else if (n) p.set(key, n);
    }
  }
  /** Is a cell filled by any part (or by this one)? */
  filled(i, j, k, part) {
    const key = cellKey(i, j, k);
    if (part) return this.parts.get(part)?.has(key) ?? false;
    for (const p of this.parts.values()) if (p.has(key)) return true;
    return false;
  }
  get count() {
    let n = 0;
    for (const p of this.parts.values()) n += p.size;
    return n;
  }
}

// ---------------------------------------------------------------------------------------------
// Faces and occlusion

/** The six directions: normal, and the face's own axes u and v (u x v = the normal). */
export const DIRS = [
  { n: [1, 0, 0], u: [0, 1, 0], v: [0, 0, 1] },
  { n: [-1, 0, 0], u: [0, 0, 1], v: [0, 1, 0] },
  { n: [0, 1, 0], u: [0, 0, 1], v: [1, 0, 0] },
  { n: [0, -1, 0], u: [1, 0, 0], v: [0, 0, 1] },
  { n: [0, 0, 1], u: [1, 0, 0], v: [0, 1, 0] },
  { n: [0, 0, -1], u: [0, 1, 0], v: [1, 0, 0] },
];

// Occlusion states: bits 0-3 the edges at s=0, s=1, t=0, t=1 (s along u, t along v); bits 4-7 the
// corners (0,0), (1,0), (1,1), (0,1). The square's eight symmetries act on (s, t).
const SYM = [
  (s, t) => [s, t],
  (s, t) => [1 - t, s],
  (s, t) => [1 - s, 1 - t],
  (s, t) => [t, 1 - s],
  (s, t) => [1 - s, t],
  (s, t) => [s, 1 - t],
  (s, t) => [t, s],
  (s, t) => [1 - t, 1 - s],
];
const FEATURES = [[0, 0.5], [1, 0.5], [0.5, 0], [0.5, 1], [0, 0], [1, 0], [1, 1], [0, 1]];
const featureAt = (p) => FEATURES.findIndex((f) => f[0] === p[0] && f[1] === p[1]);
/** Where each symmetry takes each feature. */
const SYM_MAP = SYM.map((g) => FEATURES.map((f) => featureAt(g(f[0], f[1]))));
const applySym = (g, mask) => {
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
/** The inverse of each symmetry. */
const SYM_INV = SYM.map((g) => SYM.findIndex((h) => [[0, 0], [1, 0], [0, 1]].every(([s, t]) => {
  const [a, b] = g(s, t);
  const [c, d] = h(a, b);
  return c === s && d === t;
})));

/** A voxel's shade (0 darker, 1, 2 lighter) from its cell. */
function shadeOf(i, j, k, salt) {
  let h = Math.imul(i + 7919 * salt, 0x27d4eb2d) ^ Math.imul(j + 104729, 0x165667b1) ^ Math.imul(k + 15485863, 0x9e3779b1);
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d);
  h ^= h >>> 13;
  const r = (h >>> 0) / 4294967296;
  return r < 0.3 ? 0 : r < 0.72 ? 1 : 2;
}

/**
 * The visible faces of every part: [{ part, cell, dir, colour, shade, ao }] (`ao` the occlusion
 * state). Faces toward another part's voxel are kept (they show when the parts move apart) and
 * count as fully occluded; `hidden` counts them. A face two parts both show (their voxels in one
 * cell, the next cell empty in both) is a duplicate: the later part's is dropped and counted.
 */
export function faces(vox, palette, { occluders = null, vary = false, merge = false } = {}) {
  const out = [];
  const seen = new Map();
  let hidden = 0, duplicates = 0;
  const filled = (i, j, k) => vox.filled(i, j, k) || (occluders ? occluders(i, j, k) : false);
  for (const [part, cells] of vox.parts) {
    for (const [key, colour] of cells) {
      const [i, j, k] = cellOf(key);
      const c = palette.get(colour);
      const shade = vary && c.vary ? shadeOf(i, j, k, 1) : 1;
      for (let d = 0; d < 6; d++) {
        const { n, u, v } = DIRS[d];
        const a = [i + n[0], j + n[1], k + n[2]];
        if (cells.has(cellKey(a[0], a[1], a[2]))) continue;
        const fk = `${key},${d}`;
        if (seen.has(fk)) {
          duplicates++;
          continue;
        }
        seen.set(fk, part);
        let ao = 0;
        if (filled(a[0], a[1], a[2])) {
          ao = 15;
          hidden++;
        } else {
          const at = (du, dv) => filled(a[0] + u[0] * du + v[0] * dv, a[1] + u[1] * du + v[1] * dv, a[2] + u[2] * du + v[2] * dv);
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
  const before = out.length;
  return { faces: merge ? mergeFaces(out) : out, hidden, duplicates, before };
}

/**
 * Faces of one part, direction, plane, colour and shade with no occlusion, merged into rectangles
 * (greedy: along u, then v). Only for flat tiles: a merged quad stretches its tile.
 */
function mergeFaces(list) {
  const out = [];
  const groups = new Map();
  for (const f of list) {
    if (f.ao) {
      out.push(f);
      continue;
    }
    const { n } = DIRS[f.dir];
    const a = n[0] ? 0 : n[1] ? 1 : 2;
    const key = `${f.part}|${f.dir}|${f.cell[a]}|${f.colour}|${f.shade}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(f);
  }
  for (const fs of groups.values()) {
    const { u, v } = DIRS[fs[0].dir];
    const ua = u.indexOf(1), va = v.indexOf(1);
    const at = new Map(fs.map((f) => [`${f.cell[ua]},${f.cell[va]}`, f]));
    const used = new Set();
    const sorted = [...fs].sort((p, q) => p.cell[va] - q.cell[va] || p.cell[ua] - q.cell[ua]);
    for (const f of sorted) {
      const u0 = f.cell[ua], v0 = f.cell[va];
      if (used.has(`${u0},${v0}`)) continue;
      let w = 1;
      while (at.has(`${u0 + w},${v0}`) && !used.has(`${u0 + w},${v0}`)) w++;
      let h = 1;
      grow: for (;;) {
        for (let x = 0; x < w; x++) if (!at.has(`${u0 + x},${v0 + h}`) || used.has(`${u0 + x},${v0 + h}`)) break grow;
        h++;
      }
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) used.add(`${u0 + x},${v0 + y}`);
      out.push({ ...f, du: w, dv: h });
    }
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// The atlas: bevelled tiles

export const TILE = 8;

/** A tile's texels (TILE x TILE, row t, column s) as brightness factors: the bevel, times the occlusion. */
function tileFactors(ao, { style = process.env.VOXEL_BEVEL ?? 'flat', dark = 0.5 } = {}) {
  const f = new Float32Array(TILE * TILE);
  for (let t = 0; t < TILE; t++)
    for (let s = 0; s < TILE; s++) {
      const x = (s + 0.5) / TILE, y = (t + 0.5) / TILE;
      let k;
      if (style === 'flat') k = 1;
      else if (style === 'ridge') {
        const e = Math.min(s, t, TILE - 1 - s, TILE - 1 - t);
        const edgeS = s === 0 || s === TILE - 1, edgeT = t === 0 || t === TILE - 1;
        k = edgeS && edgeT ? 0.46 : e === 0 ? 0.56 : e === 1 ? 1.17 : e === 2 ? 1.05 : 1;
      } else {
        // A cushion: bright in the middle, rounding off darker to the edges and more so the corners.
        const ex = Math.min(x, 1 - x), ey = Math.min(y, 1 - y);
        const edge = (e) => 0.62 + 0.46 * Math.min(1, (e / 0.3) ** 0.8);
        k = edge(ex) * edge(ey) / 1.08;
      }
      // Occlusion: a soft ramp in from each occluded edge and corner.
      const ramp = (d) => (d < 0.75 ? 1 - dark * (1 - d / 0.75) ** 2 : 1);
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

/**
 * The atlas for a list of faces: a tile per (colour, shade, canonical occlusion) used, colour by
 * colour. Returns the three images and, for each face, its four corners' UVs (s along the face's
 * u, t along v: corners (0,0), (1,0), (1,1), (0,1)).
 */
export function atlas(faceList, palette, { width = 256, bevel } = {}) {
  const tiles = new Map();
  const order = [...palette.colours.keys()];
  for (const f of faceList) {
    const key = `${f.colour}|${f.shade}|${CANON[f.ao].canon}`;
    if (!tiles.has(key)) tiles.set(key, { colour: f.colour, shade: f.shade, ao: CANON[f.ao].canon });
  }
  const list = [...tiles.values()].sort((a, b) => order.indexOf(a.colour) - order.indexOf(b.colour) || a.shade - b.shade || a.ao - b.ao);
  const perRow = width / TILE;
  const height = 2 ** Math.ceil(Math.log2(Math.max(TILE, Math.ceil(list.length / perRow) * TILE)));
  const albedo = new Uint8Array(width * height * 4), mr = new Uint8Array(width * height * 4), glow = new Uint8Array(width * height * 4);
  const cache = new Map();
  list.forEach((tile, n) => {
    tile.x = (n % perRow) * TILE;
    tile.y = Math.floor(n / perRow) * TILE;
    const c = palette.get(tile.colour);
    const lin = hexRGB(c.rgb).map(toLinear);
    const f = cache.get(tile.ao) ?? tileFactors(tile.ao, bevel);
    cache.set(tile.ao, f);
    const shade = 1 + (tile.shade - 1) * c.vary * 2.2;
    for (let t = 0; t < TILE; t++)
      for (let s = 0; s < TILE; s++) {
        const o = ((tile.y + t) * width + tile.x + s) * 4;
        for (let ch = 0; ch < 3; ch++) albedo[o + ch] = toSrgb8(lin[ch] * shade * f[t * TILE + s]);
        mr[o + 1] = Math.round(c.rough * 255);
        mr[o + 2] = Math.round(c.metal * 255);
        glow[o] = glow[o + 1] = glow[o + 2] = Math.round(c.glow * 255);
        albedo[o + 3] = mr[o + 3] = glow[o + 3] = 255;
      }
  });
  // Each face's corners: the tile's, turned by the symmetry that takes its canonical state to its own.
  const uvs = faceList.map((f) => {
    const tile = tiles.get(`${f.colour}|${f.shade}|${CANON[f.ao].canon}`);
    const inv = SYM[SYM_INV[CANON[f.ao].g]];
    return [[0, 0], [1, 0], [1, 1], [0, 1]].map(([s, t]) => {
      const [a, b] = inv(s, t);
      return [(tile.x + 0.5 + a * (TILE - 1)) / width, (tile.y + 0.5 + b * (TILE - 1)) / height];
    });
  });
  return { width, height, tiles: list.length, albedo: { w: width, h: height, px: albedo }, mr: { w: width, h: height, px: mr }, glow: { w: width, h: height, px: glow }, uvs };
}

/** The quads' corners (voxel units) for a list of faces, in order, counter-clockwise from outside. */
export function quadCorners(f) {
  const { n, u, v } = DIRS[f.dir];
  const du = f.du ?? 1, dv = f.dv ?? 1;
  const o = f.cell.map((c, a) => c + (n[a] > 0 ? 1 : 0));
  return [o, o.map((x, a) => x + u[a] * du), o.map((x, a) => x + u[a] * du + v[a] * dv), o.map((x, a) => x + v[a] * dv)];
}

// ---------------------------------------------------------------------------------------------
// PNG

const CRC = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
export function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = CRC[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function pngChunk(type, data) {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, 'ascii');
  data.copy(out, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
  return out;
}
export const PNG_SIG = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
/** An RGBA image ({ w, h, px }) as an RGB PNG (or grey, `grey`), each row filtered as suits it best. */
export function png({ w, h, px }, { grey = false } = {}) {
  const bpp = grey ? 1 : 3;
  const stride = w * bpp;
  const rows = [];
  let prev = Buffer.alloc(stride);
  for (let y = 0; y < h; y++) {
    const line = Buffer.alloc(stride);
    for (let x = 0; x < w; x++) for (let c = 0; c < bpp; c++) line[x * bpp + c] = px[(y * w + x) * 4 + c];
    let best = null, bestSum = Infinity;
    for (let f = 0; f < 5; f++) {
      const out = Buffer.alloc(stride + 1);
      out[0] = f;
      let sum = 0;
      for (let i = 0; i < stride; i++) {
        const a = i >= bpp ? line[i - bpp] : 0, b = prev[i], c = i >= bpp ? prev[i - bpp] : 0;
        const p = a + b - c;
        const pr = Math.abs(p - a) <= Math.abs(p - b) && Math.abs(p - a) <= Math.abs(p - c) ? a : Math.abs(p - b) <= Math.abs(p - c) ? b : c;
        const v = (line[i] - [0, a, b, (a + b) >> 1, pr][f]) & 255;
        out[i + 1] = v;
        sum += v < 128 ? v : 256 - v;
      }
      if (sum < bestSum) (best = out), (bestSum = sum);
    }
    rows.push(best);
    prev = line;
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = grey ? 0 : 2;
  return Buffer.concat([PNG_SIG, pngChunk('IHDR', ihdr), pngChunk('IDAT', deflateSync(Buffer.concat(rows), { level: 9 })), pngChunk('IEND', Buffer.alloc(0))]);
}

// ---------------------------------------------------------------------------------------------
// GLB

const COMPONENT = { 5120: 1, 5121: 1, 5122: 2, 5123: 2, 5125: 4, 5126: 4 };
const TYPE_SIZE = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 };
const ARRAY = { 5120: Int8Array, 5121: Uint8Array, 5122: Int16Array, 5123: Uint16Array, 5125: Uint32Array, 5126: Float32Array };

/**
 * A binary glTF: `nodes` (node 0 the root), one mesh of one primitive (`attributes`: { NAME: {
 * values (flat numbers), componentType, type, normalized, minmax } }, `indices`), on node
 * `meshNode`, optionally skinned (`skin`: { joints, skeleton, inverseBindMatrices: Float32Array }),
 * one material of the three images. `compress`: vertex attributes and indices through
 * EXT_meshopt_compression. `quantized`: KHR_mesh_quantization (integer positions, normals).
 */
export function writeGlb({ generator, nodes, sceneName, meshName, meshNode, attributes, indices, skin, material, compress = false, quantized = false, extras }) {
  const bin = [];
  let offset = 0;
  const views = [];
  const put = (buf) => {
    const pad = (4 - (offset % 4)) % 4;
    if (pad) bin.push(Buffer.alloc(pad)), (offset += pad);
    bin.push(buf);
    offset += buf.length;
    return offset - buf.length;
  };
  let fallback = 0;
  const accessors = [];
  const count = Object.values(attributes)[0].values.length / TYPE_SIZE[Object.values(attributes)[0].type];
  const attrOut = {};
  for (const [name, a] of Object.entries(attributes)) {
    const n = TYPE_SIZE[a.type];
    const cs = COMPONENT[a.componentType];
    const stride = Math.ceil((n * cs) / 4) * 4;
    const raw = Buffer.alloc(count * stride);
    const Arr = ARRAY[a.componentType];
    for (let i = 0; i < count; i++) {
      const el = new Arr(raw.buffer, raw.byteOffset + i * stride, n);
      for (let c = 0; c < n; c++) el[c] = a.values[i * n + c];
    }
    const view = { buffer: 0, byteLength: raw.length, target: 34962, ...(stride !== n * cs || compress ? { byteStride: stride } : {}) };
    if (compress) {
      const enc = encodeVertexBuffer(raw, count, stride);
      const at = put(Buffer.from(enc));
      Object.assign(view, { buffer: 1, byteOffset: fallback, extensions: { EXT_meshopt_compression: { buffer: 0, byteOffset: at, byteLength: enc.length, byteStride: stride, mode: 'ATTRIBUTES', count } } });
      fallback += Math.ceil(raw.length / 4) * 4;
    } else view.byteOffset = put(raw);
    views.push(view);
    const acc = { bufferView: views.length - 1, componentType: a.componentType, count, type: a.type, ...(a.normalized ? { normalized: true } : {}) };
    if (a.minmax) {
      acc.min = [], acc.max = [];
      for (let c = 0; c < n; c++) {
        let lo = Infinity, hi = -Infinity;
        for (let i = c; i < a.values.length; i += n) (lo = Math.min(lo, a.values[i])), (hi = Math.max(hi, a.values[i]));
        acc.min.push(a.componentType === 5126 ? Math.fround(lo) : lo);
        acc.max.push(a.componentType === 5126 ? Math.fround(hi) : hi);
      }
    }
    accessors.push(acc);
    attrOut[name] = accessors.length - 1;
  }
  const big = count > 65535;
  const idx = big ? new Uint32Array(indices) : new Uint16Array(indices);
  const idxRaw = Buffer.from(idx.buffer);
  const iview = { buffer: 0, byteLength: idxRaw.length, target: 34963 };
  if (compress) {
    const enc = encodeIndexSequence(idx);
    const at = put(Buffer.from(enc));
    Object.assign(iview, { buffer: 1, byteOffset: fallback, extensions: { EXT_meshopt_compression: { buffer: 0, byteOffset: at, byteLength: enc.length, byteStride: big ? 4 : 2, mode: 'INDICES', count: idx.length } } });
    fallback += Math.ceil(idxRaw.length / 4) * 4;
  } else iview.byteOffset = put(idxRaw);
  views.push(iview);
  accessors.push({ bufferView: views.length - 1, componentType: big ? 5125 : 5123, count: idx.length, type: 'SCALAR' });
  const indicesAcc = accessors.length - 1;
  let skins;
  if (skin) {
    views.push({ buffer: 0, byteOffset: put(Buffer.from(skin.inverseBindMatrices.buffer)), byteLength: skin.inverseBindMatrices.byteLength });
    accessors.push({ bufferView: views.length - 1, componentType: 5126, count: skin.joints.length, type: 'MAT4' });
    skins = [{ name: skin.name, inverseBindMatrices: accessors.length - 1, joints: skin.joints, skeleton: skin.skeleton }];
  }
  const images = [];
  const addImage = (name, pngBuf) => {
    views.push({ buffer: 0, byteOffset: put(pngBuf), byteLength: pngBuf.length });
    images.push({ name, bufferView: views.length - 1, mimeType: 'image/png' });
    return images.length - 1;
  };
  const base = addImage(`${material.name}_albedo`, material.albedo);
  const mr = addImage(`${material.name}_metal_rough`, material.mr);
  const glow = material.glow ? addImage(`${material.name}_glow`, material.glow) : -1;
  const exts = [...(compress ? ['EXT_meshopt_compression'] : []), ...(quantized ? ['KHR_mesh_quantization'] : [])];
  const json = {
    asset: { version: '2.0', generator },
    ...(exts.length ? { extensionsUsed: exts, extensionsRequired: exts } : {}),
    scene: 0,
    scenes: [{ name: sceneName, nodes: [0] }],
    nodes,
    meshes: [{ name: meshName, primitives: [{ attributes: attrOut, indices: indicesAcc, material: 0 }] }],
    ...(skins ? { skins } : {}),
    materials: [
      {
        name: material.name,
        pbrMetallicRoughness: { baseColorTexture: { index: 0 }, metallicFactor: 1, roughnessFactor: 1, metallicRoughnessTexture: { index: 1 } },
        ...(glow >= 0 ? { emissiveTexture: { index: 2 }, emissiveFactor: [1, 1, 1] } : {}),
      },
    ],
    textures: images.map((_, i) => ({ sampler: 0, source: i })),
    samplers: [{ magFilter: 9729, minFilter: 9987, wrapS: 33071, wrapT: 33071 }],
    images,
    accessors,
    bufferViews: views,
    buffers: [{ byteLength: 0 }, ...(compress ? [{ byteLength: fallback, extensions: { EXT_meshopt_compression: { fallback: true } } }] : [])],
    ...(extras ? { extras } : {}),
  };
  nodes[meshNode].mesh = 0;
  if (skin) nodes[meshNode].skin = 0;
  const tail = (4 - (offset % 4)) % 4;
  if (tail) bin.push(Buffer.alloc(tail));
  const binBuf = Buffer.concat(bin);
  json.buffers[0].byteLength = binBuf.length;
  let jsonBuf = Buffer.from(JSON.stringify(json), 'utf8');
  jsonBuf = Buffer.concat([jsonBuf, Buffer.alloc((4 - (jsonBuf.length % 4)) % 4, 0x20)]);
  const header = Buffer.alloc(12);
  header.writeUInt32LE(0x46546c67, 0);
  header.writeUInt32LE(2, 4);
  header.writeUInt32LE(12 + 8 + jsonBuf.length + 8 + binBuf.length, 8);
  const jh = Buffer.alloc(8);
  jh.writeUInt32LE(jsonBuf.length, 0);
  jh.writeUInt32LE(0x4e4f534a, 4);
  const bh = Buffer.alloc(8);
  bh.writeUInt32LE(binBuf.length, 0);
  bh.writeUInt32LE(0x004e4942, 4);
  return Buffer.concat([header, jh, jsonBuf, bh, binBuf]);
}

/**
 * A GLB read back: its JSON, and `read(accessor)` giving an accessor's values (numbers, normalized
 * ones as stored), meshopt views decoded. Throws on a malformed file.
 */
export function readGlb(buf) {
  const fail = (m) => {
    throw new Error(m);
  };
  if (buf.readUInt32LE(0) !== 0x46546c67 || buf.readUInt32LE(4) !== 2 || buf.readUInt32LE(8) !== buf.length) fail('bad header');
  const jlen = buf.readUInt32LE(12);
  if (buf.readUInt32LE(16) !== 0x4e4f534a || jlen % 4) fail('bad JSON chunk');
  const json = JSON.parse(buf.subarray(20, 20 + jlen).toString('utf8'));
  const bo = 20 + jlen;
  const blen = buf.readUInt32LE(bo);
  if (buf.readUInt32LE(bo + 4) !== 0x004e4942 || blen % 4 || bo + 8 + blen !== buf.length) fail('bad BIN chunk');
  const bin = buf.subarray(bo + 8);
  if (json.buffers[0].byteLength !== blen) fail('buffer length');
  const decoded = new Map();
  const viewData = (i) => {
    if (decoded.has(i)) return decoded.get(i);
    const v = json.bufferViews[i];
    const m = v.extensions?.EXT_meshopt_compression;
    let data;
    if (m) {
      const src = bin.subarray(m.byteOffset ?? 0, (m.byteOffset ?? 0) + m.byteLength);
      if (m.mode === 'ATTRIBUTES') data = Buffer.from(decodeVertexBuffer(src, m.count, m.byteStride));
      else {
        const ix = decodeIndexSequence(src, m.count);
        data = Buffer.from((m.byteStride === 2 ? Uint16Array.from(ix) : ix).buffer);
      }
      if (data.length !== v.byteLength) fail('meshopt view length');
    } else {
      if (v.buffer !== 0 || v.byteOffset + v.byteLength > blen || v.byteOffset % 4) fail('bufferView out of range');
      data = bin.subarray(v.byteOffset, v.byteOffset + v.byteLength);
    }
    decoded.set(i, data);
    return data;
  };
  const readers = { 5120: 'readInt8', 5121: 'readUInt8', 5122: 'readInt16LE', 5123: 'readUInt16LE', 5125: 'readUInt32LE', 5126: 'readFloatLE' };
  const read = (a) => {
    const v = json.bufferViews[a.bufferView];
    const data = viewData(a.bufferView);
    const n = TYPE_SIZE[a.type], cs = COMPONENT[a.componentType];
    const stride = v.byteStride ?? n * cs;
    if ((v.byteStride ?? 4) % 4) fail('misaligned stride');
    if ((a.byteOffset ?? 0) + stride * (a.count - 1) + n * cs > data.length) fail('accessor out of range');
    const out = new Float64Array(a.count * n);
    for (let i = 0; i < a.count; i++) for (let c = 0; c < n; c++) out[i * n + c] = data[readers[a.componentType]]((a.byteOffset ?? 0) + i * stride + c * cs);
    return out;
  };
  const image = (i) => {
    const v = json.bufferViews[json.images[i].bufferView];
    return bin.subarray(v.byteOffset, v.byteOffset + v.byteLength);
  };
  return { json, read, image };
}
