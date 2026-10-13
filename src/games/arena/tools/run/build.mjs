#!/usr/bin/env node
/**
 * The run's things, as micro-voxel models (`tools/voxel.mjs`, the Arena's monsters' and weapons'
 * style) written as binary glTF to `src/games/arena/models/run/`: the coins monsters spill (one
 * coin, and a heap), the Phoenix Feather, the mystery chest and its lid, the skull the chest
 * sometimes laughs out, and the merchant's stall. Dependency-free (Node 22+):
 * `node src/games/arena/tools/run/build.mjs [ids...]`. Each file is read back and checked.
 *
 * Conventions:
 * - A voxel is `V` blocks (1/16: a pixel of a block); 1 glTF unit is 1 block. Everything is
 *   meshopt-compressed; the props' vertices are whole voxels in bytes (KHR_mesh_quantization, the
 *   mesh's node scaling them), while items keep plain floats (an item's mesh is baked from its
 *   nodes into one, which byte positions wouldn't survive).
 * - Shapes are written standing up (+y up, the front toward +z). Things that are picked up or held
 *   (`held: true`: the coins, the feather, the skull) are written out as the platform holds items:
 *   along +z, so a pickup on the ground (stood up again by the platform) and a held one stand as
 *   they were made. Props (the chest, its lid, the stall) stay as made.
 * - The chest's origin is the middle of its bottom; the lid's is its hinge (the back of its bottom
 *   edge), which sits on the chest's back top edge (`LID_HINGE`, blocks, in the chest's space), so
 *   turning the lid about x (negative: the front up) opens it.
 * - Look: flat voxels, one palette atlas each; gold and iron are metal; what glows (the feather's
 *   tips, the chest's runes and its inside) is coloured deep and given a glow.
 */
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Palette, Voxels, faces, atlas, quadCorners, png, writeGlb, readGlb, DIRS } from '../voxel.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, '../../models/run');
const V = 1 / 16;

class Model {
  constructor(id, name, { held = false, prop = false } = {}) {
    this.id = id;
    this.name = name;
    this.held = held;
    this.prop = prop;
    this.vox = new Voxels();
    this.P = new Palette();
  }
  colours(list) {
    for (const [name, [rgb, rough = 0.8, metal = 0, glow = 0]] of Object.entries(list)) this.P.add(name, rgb, { rough, metal, glow, vary: 0 });
    return this;
  }
  /** One voxel, as made (x right, y up, z front). */
  set(i, j, k, c) {
    if (this.held) this.vox.set('body', i, -k - 1, j, c);
    else this.vox.set('body', i, j, k, c);
  }
  /** Every cell whose centre `fn(x, y, z)` (voxel units, the cell's centre) gives a colour for. */
  shape(lo, hi, fn) {
    const [i0, j0, k0] = lo.map(Math.floor);
    const [i1, j1, k1] = hi.map(Math.ceil);
    for (let k = k0; k < k1; k++)
      for (let j = j0; j < j1; j++)
        for (let i = i0; i < i1; i++) {
          const c = fn(i + 0.5, j + 0.5, k + 0.5, i, j, k);
          if (c) this.set(i, j, k, c);
        }
  }
  box(lo, hi, c) {
    this.shape(lo, hi, () => c);
  }
}

// ---------------------------------------------------------------------------------------------
// The models

const GOLD = { gold: [0xf0a51c, 0.38, 0.4, 0.1], goldDeep: [0xa8640c, 0.45, 0.4, 0.04], goldLight: [0xffd04a, 0.32, 0.35, 0.18] };

/** A coin: a disc on edge, its rim and an emperor's laurel raised on both faces. */
function coin() {
  const m = new Model('coin', 'Gold Coin', { held: true }).colours(GOLD);
  const R = 7;
  m.shape([-R, -R, -2], [R, R, 2], (x, y, z) => {
    const r = Math.hypot(x, y);
    if (r > R) return null;
    const rim = r > R - 1.3;
    if (Math.abs(z) > 1 && !rim) {
      // The faces' relief: a laurel ring and a crown in the middle.
      const ring = r > 3.6 && r < 4.6 && Math.abs(Math.atan2(y, x) + Math.PI / 2) > 0.5;
      const crown = (Math.abs(x) < 2.6 && y > -1.6 && y < 0.4) || (y >= 0.4 && y < 2.2 && (Math.abs(x) < 0.6 || Math.abs(Math.abs(x) - 2) < 0.6));
      return ring ? 'goldDeep' : crown ? 'goldLight' : null;
    }
    return rim ? 'goldLight' : 'gold';
  });
  return m;
}

/** A heap of coins: stacks of different heights on a spill of loose ones. */
function coinPile() {
  const m = new Model('coin_pile', 'Gold', { held: true }).colours(GOLD);
  // The spill on the ground.
  m.shape([-7, 0, -6], [7, 2, 7], (x, y, z) => (Math.hypot(x * 0.9, z) < 6.2 - y * 1.6 ? ((Math.floor(x) + Math.floor(z)) & 1 ? 'gold' : 'goldDeep') : null));
  const stacks = [
    [-2.5, -1, 9],
    [2.5, 1.5, 7],
    [0, 3.5, 5],
    [3.5, -3, 4],
    [-4, 2.5, 3],
  ];
  for (const [cx, cz, h] of stacks)
    m.shape([cx - 3, 1, cz - 3], [cx + 3, 1 + h, cz + 3], (x, y, z) => (Math.hypot(x - cx, z - cz) < 2.6 ? (Math.floor(y) % 2 ? 'goldLight' : 'gold') : null));
  return m;
}

/** The Phoenix Feather: a quill, and a vane burning from crimson to a gold that glows at the tip. */
function feather() {
  const m = new Model('phoenix_feather', 'Phoenix Feather', { held: true }).colours({
    quill: [0xf0e6d0, 0.6],
    crimson: [0x9e0f1c, 0.7, 0, 0.15],
    red: [0xd8261a, 0.7, 0, 0.3],
    orange: [0xff6a1a, 0.6, 0, 0.55],
    gold: [0xffb52e, 0.5, 0, 0.8],
    eye: [0x5a0812, 0.6],
  });
  const L = 22;
  // The quill along y (up, as made: held, it runs along the item's length).
  m.box([0, 0, 0], [1, L + 1, 1], 'quill');
  m.shape([-5, 3, 0], [6, L + 2, 1], (x, y) => {
    const t = (y - 3) / (L - 1);
    if (t < 0 || t > 1.05) return null;
    // Wide in the middle, a rounded tip, a little ragged where the barbs part.
    const w = 4.6 * Math.sin(Math.min(1, t * 1.15) * Math.PI * 0.95) + 0.6;
    const d = Math.abs(x - 0.5);
    if (d > w || d < 0.5) return null;
    if (d > w - 1 && (Math.floor(y) + (x > 0 ? 1 : 0)) % 4 === 0) return null;
    const eye = Math.hypot(d * 0.8, y - (L - 2)) < 1.6;
    if (eye) return 'eye';
    const c = t + (d / 6) * 0.25;
    return c < 0.3 ? 'crimson' : c < 0.55 ? 'red' : c < 0.8 ? 'orange' : 'gold';
  });
  return m;
}

const WOOD = {
  wood: [0x5e3b22, 0.85],
  woodDark: [0x3f2614, 0.9],
  woodLight: [0x77502e, 0.85],
  iron: [0x3a3f45, 0.45, 0.8],
  ...GOLD,
  rune: [0x2a8cff, 0.4, 0, 1],
  glowIn: [0xffb83a, 0.6, 0, 1],
};
/** The chest: 20 x 10 x 12 voxels (its lid on top, `LID_HINGE`). */
const CW = 10, CH = 10, CD = 6;
export const LID_HINGE = [0, CH * V, -CD * V];

/** The mystery chest's body: banded planks, gold corners, a rune-lit lock, a glowing hold. */
function chest() {
  const m = new Model('chest', 'Mystery Chest', { prop: true }).colours(WOOD);
  m.shape([-CW, 0, -CD], [CW, CH, CD], (x, y, z, i, j, k) => {
    const edgeX = i === -CW || i === CW - 1;
    const edgeZ = k === -CD || k === CD - 1;
    const inside = !edgeX && !edgeZ && j > 0;
    // Hollow, with a glowing floor (seen when it opens).
    if (inside) return j === 1 ? 'glowIn' : null;
    // Gold corner posts and bands round the top and bottom; iron bands across.
    if (edgeX && edgeZ) return 'gold';
    if (j === CH - 1 || j === 0) return 'goldDeep';
    if (Math.abs(i + 0.5) > CW - 3 && Math.abs(i + 0.5) < CW - 1.5) return 'iron';
    // Planks with their seams.
    return j % 3 === 0 ? 'woodDark' : (i + 40) % 7 === 0 ? 'woodLight' : 'wood';
  });
  // The lock plate on the front, a question mark glowing in it.
  const MARK = ['.##.', '#..#', '...#', '..#.', '....', '..#.'];
  m.shape([-3, 3, CD], [3, 9, CD + 1], (x, y, z, i, j) => (MARK[8 - j]?.[i + 2] === '#' ? 'rune' : 'gold'));
  // Runes along the sides.
  for (const s of [-1, 1]) m.shape([s < 0 ? -CW - 1 : CW, 4, -2], [s < 0 ? -CW : CW + 1, 7, 2], (x, y, z) => (Math.abs(z) < 1.5 && (y < 5 || Math.abs(z) < 0.6) ? 'rune' : null));
  // Feet.
  for (const x of [-CW, CW - 2]) for (const z of [-CD, CD - 2]) m.box([x, -1, z], [x + 2, 0, z + 2], 'goldDeep');
  return m;
}

/** Its lid, made from the hinge: arched, banded, a gold handle on the front. */
function lid() {
  const m = new Model('chest_lid', 'Mystery Chest Lid', { prop: true }).colours(WOOD);
  const D = 2 * CD;
  m.shape([-CW, 0, 0], [CW, 6, D], (x, y, z, i, j, k) => {
    // The arch across its depth.
    const u = (z - D / 2) / (D / 2);
    const top = 2 + 4 * Math.sqrt(Math.max(0, 1 - u * u));
    if (y > top) return null;
    const edgeX = i === -CW || i === CW - 1;
    if (edgeX) return 'goldDeep';
    if (j === 0 && (k === 0 || k === D - 1)) return 'goldDeep';
    if (Math.abs(i + 0.5) > CW - 3 && Math.abs(i + 0.5) < CW - 1.5) return 'iron';
    return (k + 40) % 4 === 0 ? 'woodDark' : 'wood';
  });
  m.box([-2, 1, D], [2, 3, D + 1], 'gold');
  m.box([-1, 0, D], [1, 1, D + 1], 'rune');
  return m;
}

/** A grinning skull (the chest's bad luck). */
function skull() {
  const m = new Model('chest_skull', 'Skull', { held: true }).colours({ bone: [0xe8e2d0, 0.7], boneDark: [0xb8b09a, 0.8], hole: [0x1a1210, 0.9], eye: [0xd8261a, 0.4, 0, 1] });
  m.shape([-6, 0, -6], [6, 12, 6], (x, y, z) => {
    const cy = 7;
    const cranium = Math.hypot(x / 5.6, (y - cy) / 5, z / 5.6) < 1;
    const jaw = y < 4 && y > 0.5 && Math.abs(x) < 3.6 && z > -2 && z < 4.6;
    if (!cranium && !jaw) return null;
    // Eye sockets, a nose, teeth.
    if (z > 3 && y > 5.5 && y < 8.5 && Math.abs(Math.abs(x) - 2.2) < 1.3) return z > 4.4 ? 'hole' : 'eye';
    if (z > 4 && y > 4 && y < 5.5 && Math.abs(x) < 0.8) return 'hole';
    if (jaw && z > 3.6 && y > 2 && y < 4) return Math.floor(x + 10) % 2 ? 'boneDark' : 'bone';
    return y < 4 ? 'boneDark' : 'bone';
  });
  return m;
}

/**
 * The merchant's stall, set up between waves: a counter of planks with a round shield hung on its
 * front, his wares on top (potions, a sword, a heap of gold), corner posts, a striped awning with a
 * scalloped edge, a big gold coin standing on it for a sign, and a lantern. Its origin is the middle of the counter's
 * front at the ground; the merchant stands behind it (toward -z).
 */
function stall() {
  const m = new Model('stall', "The Merchant's Stall", { prop: true }).colours({
    ...WOOD,
    plank: [0x8a5a32, 0.85],
    cloth: [0xa31d22, 0.9],
    cream: [0xefe2c0, 0.9],
    shield: [0x6b4424, 0.85],
    glass: [0xc0182a, 0.3, 0, 0.35],
    cork: [0x9a7a52, 0.9],
    steel: [0xc8ced6, 0.35, 0.9],
    lamp: [0xffc45a, 0.5, 0, 1],
    sack: [0xb8a27a, 0.95],
  });
  const W = 20, D = 14, TOP = 16;
  // The counter: planks, a darker top board overhanging the front.
  m.shape([-W, 0, -6], [W, TOP, 0], (x, y, z, i, j) => (j === TOP - 1 ? 'woodDark' : i % 6 === 0 ? 'woodDark' : j % 4 === 0 ? 'plank' : 'wood'));
  m.box([-W - 1, TOP - 1, -7], [W + 1, TOP, 1], 'woodDark');
  // A round shield on its front, a gold boss in the middle.
  m.shape([-6, 2, 0], [6, 14, 1], (x, y) => {
    const r = Math.hypot(x, y - 8);
    return r < 1.6 ? 'gold' : r < 5.2 ? (r > 4.3 ? 'goldDeep' : 'shield') : null;
  });
  // Corner posts up to the awning.
  for (const x of [-W, W - 2]) for (const z of [-D, -2]) m.box([x, 0, z], [x + 2, 40, z + 2], 'woodDark');
  // The awning: sloping down to the front, striped, its front edge scalloped.
  m.shape([-W - 2, 34, -D - 2], [W + 2, 44, 5], (x, y, z, i, j, k) => {
    const top = 42 - ((k + D + 2) / (D + 7)) * 6;
    if (j !== Math.floor(top)) return null;
    return Math.floor((i + W + 2) / 4) % 2 ? 'cloth' : 'cream';
  });
  for (let i = -W - 2; i < W + 2; i++) {
    const stripe = Math.floor((i + W + 2) / 4) % 2 ? 'cloth' : 'cream';
    const drop = (i + W + 2) % 4 === 1 || (i + W + 2) % 4 === 2 ? 3 : 2;
    m.box([i, 36 - drop, 4], [i + 1, 36, 5], stripe);
  }
  // The sign: a big gold coin standing on the awning's front edge, over his head.
  m.box([0, 36, 1], [1, 39, 2], 'iron');
  m.shape([-5, 38, 1], [6, 49, 2], (x, y) => {
    const r = Math.hypot(x - 0.5, y - 43.5);
    return r < 1.6 ? 'goldLight' : r < 4.6 ? 'gold' : r < 5.4 ? 'goldDeep' : null;
  });
  // His wares on the counter: two potions, a sword, a heap of gold, a sack beside.
  for (const x of [-16, -12]) {
    m.box([x, TOP, -4], [x + 3, TOP + 4, -1], 'glass');
    m.box([x + 1, TOP + 4, -3], [x + 2, TOP + 6, -2], 'cork');
  }
  m.box([-6, TOP, -3], [8, TOP + 1, -2], 'steel');
  m.box([-9, TOP, -4], [-6, TOP + 1, -1], 'gold');
  m.box([-10, TOP, -3], [-9, TOP + 2, -2], 'woodDark');
  m.shape([10, TOP, -6], [18, TOP + 4, 0], (x, y, z) => (Math.hypot(x - 14, z + 3) < 3.6 - (y - TOP) * 0.8 ? ((Math.floor(x) + Math.floor(z)) & 1 ? 'gold' : 'goldLight') : null));
  m.shape([W, 0, -10], [W + 7, 9, -3], (x, y, z) => (Math.hypot((x - W - 3.5) / 3.5, (y - 4) / 5, (z + 6.5) / 3.5) < 1 ? (y > 7.5 ? 'cork' : 'sack') : null));
  // A lantern hanging at the front corner.
  m.box([-W, 30, 2], [-W + 1, 34, 3], 'iron');
  m.box([-W - 1, 26, 1], [-W + 2, 30, 4], 'lamp');
  m.box([-W - 1, 25, 1], [-W + 2, 26, 4], 'iron');
  m.box([-W - 1, 30, 1], [-W + 2, 31, 4], 'iron');
  return m;
}

const MODELS = { coin, coin_pile: coinPile, phoenix_feather: feather, chest, chest_lid: lid, chest_skull: skull, stall };

// ---------------------------------------------------------------------------------------------
// Writing and checking

function glb(g) {
  const { faces: list, before } = faces(g.vox, g.P, { merge: true });
  const A = atlas(list, g.P, { width: 128 });
  const pos = [], nor = [], uv = [], idx = [];
  list.forEach((f, fi) => {
    const base = pos.length / 3;
    const n = DIRS[f.dir].n;
    quadCorners(f).forEach((c, ci) => {
      pos.push(...(g.prop ? c : c.map((v) => v * V)));
      nor.push(...(g.prop ? n.map((v) => v * 127) : n));
      uv.push(Math.round(A.uvs[fi][ci][0] * 65535), Math.round(A.uvs[fi][ci][1] * 65535));
    });
    idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
  });
  if (g.prop) for (const p of pos) if (p < -128 || p > 127) throw new Error(`${g.id}: a voxel beyond a byte's reach (${p})`);
  const glows = [...g.P.colours.values()].some((c) => c.glow > 0);
  const bytes = writeGlb({
    generator: 'Arena src/games/arena/tools/run/build.mjs',
    // (A prop's vertices are whole voxels, as bytes: the mesh's node scales them to blocks.)
    nodes: [{ name: g.id, children: [1], extras: { title: g.name } }, { name: `${g.id}_body`, ...(g.prop ? { scale: [V, V, V] } : {}) }],
    sceneName: g.id,
    meshName: `${g.id}_body`,
    meshNode: 1,
    attributes: {
      POSITION: { values: pos, componentType: g.prop ? 5120 : 5126, type: 'VEC3', minmax: true },
      NORMAL: { values: nor, componentType: g.prop ? 5120 : 5126, type: 'VEC3', normalized: g.prop },
      TEXCOORD_0: { values: uv, componentType: 5123, type: 'VEC2', normalized: true },
    },
    indices: idx,
    material: { name: `${g.id}_atlas`, albedo: png(A.albedo), mr: png(A.mr), glow: glows ? png(A.glow, { grey: true }) : null },
    compress: true,
    quantized: g.prop,
  });
  return { bytes, voxels: g.vox.count, faces: before, quads: list.length, tris: idx.length / 3 };
}

mkdirSync(OUT, { recursive: true });
const want = process.argv.slice(2).filter((a) => !a.startsWith('--'));
for (const [id, make] of Object.entries(MODELS)) {
  if (want.length && !want.includes(id)) continue;
  const g = make();
  const out = glb(g);
  const file = join(OUT, `${id}.glb`);
  writeFileSync(file, out.bytes);
  // Read it back: a scene with the mesh, and its bounds.
  const back = readGlb(readFileSync(file));
  const pa = back.json.accessors[back.json.meshes[0].primitives[0].attributes.POSITION];
  if (!pa?.min || !pa?.max || !out.tris) throw new Error(`${id}: no mesh written`);
  const size = pa.max.map((v, a) => ((v - pa.min[a]) * (g.prop ? V : 1)).toFixed(2)).join(' x ');
  console.log(`${id.padEnd(16)} ${String(out.voxels).padStart(5)} voxels ${String(out.tris).padStart(6)} triangles  ${(out.bytes.length / 1024).toFixed(1).padStart(6)} KB  ${size} blocks`);
}
