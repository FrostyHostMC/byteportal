#!/usr/bin/env node
/**
 * Call of Blocky: the fighters, built as micro-voxel figures and written as binary glTF 2.0 (`.glb`)
 * to `src/games/callofblocky/models/fighters/<id>.glb`, plus `index.ts` listing them. Dependency-free
 * (Node 22+): `node src/games/callofblocky/tools/fighters/build.mjs [ids...] [--scale=16] [--out=dir]`
 * (with ids, only those files are rebuilt and index.ts is left alone; `--scale=16` resamples the
 * figures to 16 voxels a metre, for comparison). Every file is parsed back and checked after it's
 * written: the rig, the skin, every vertex on one bone, the budgets.
 *
 * - Voxels: 26 a metre (a voxel 1/26 block, about 4 cm), so a figure is about 48 voxels tall, with
 *   lean, stylized proportions (the platform's characters', `src/platform/character/build.ts`): a
 *   big head (a quarter of the height), a neck, long legs, arms of an even width with fists their
 *   width, trim shoes. Each fighter is painted in code as one voxel part per joint of the humanoid
 *   rig (docs/HUMANOID.md), in design units of 1/26 m: boxes, rounded boxes and ellipsoids, coloured
 *   by region (collars, lapels, belts, stripes, prints), and details placed voxel by voxel (faces,
 *   ties, buttons, shades, hat bands). Every part is a closed surface; where two meet, one reaches
 *   into the other, a voxel in from its surface, so bends open no gaps.
 * - Rig: nodes named exactly hips > spine > chest > neck > head; chest > upperArmL > lowerArmL >
 *   handL > gripL (and the R mirror); hips > upperLegL > lowerLegL > footL (and R). Each has its rest
 *   translation (parent space) and no rotation or scale; the joints sit where the proportions put
 *   them (the platform reads them from the file). The root node is named after the fighter's id
 *   (extras.title is its name).
 * - Rest pose: standing straight, arms hanging along -y. One skinned mesh (a node `body` of the
 *   root's) on a skin whose bones are the rig's joints (the grips are empties, not bones), skinned
 *   rigidly: every vertex wholly on its part's joint.
 * - Hands are fists round a grip. The right fist reaches +z from the wrist round a vertical bar (a
 *   pistol grip); the left hangs below its wrist round a bar along z (a handguard). `gripR` /
 *   `gripL` are empty nodes at the centre of each fist's hold, identity rotation; the bar itself
 *   isn't modelled (a gun's grip passes through).
 * - Look (tools/voxel.mjs): clean voxels, flat colours with soft occlusion in the concave corners
 *   (tile variants of the fighter's palette atlas), the faces of a colour in a plane merged where
 *   nothing shades them; a metallic-roughness atlas (gold, buckles, shades glossy) and an emissive
 *   one. One mesh, one material: one draw call a fighter (one more for its shadow).
 * - Scale: `--scale=16` resamples a figure to the world's destructible micro-voxel (1/16 block),
 *   for comparison; the details (mouths, ties, lapels) are drawn for 1/26 and some get lost.
 * - Vertices: KHR_mesh_quantization (positions as voxel coordinates in bytes, the voxel size in the
 *   inverse bind matrices; normals as bytes), through EXT_meshopt_compression.
 * - Budgets (checked): <= 25000 triangles and <= 300 KB per file.
 */
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Palette, Voxels, faces, atlas, quadCorners, png, writeGlb, readGlb, cellKey, cellOf, DIRS } from '../voxel.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
/** Voxels a metre: the design's 24, or resampled (`--scale=16`). */
const SCALE = Number(argv.find((a) => a.startsWith('--scale='))?.slice(8) ?? 26);
const OUT = argv.find((a) => a.startsWith('--out='))?.slice(6) ?? join(HERE, '../../models/fighters');
const DU = 1 / 26;
const MAX_TRIS = 25000;
const MAX_BYTES = 300 * 1024;

// ---------------------------------------------------------------------------------------------
// The rig

const JOINT_PARENT = {
  hips: null,
  spine: 'hips',
  chest: 'spine',
  neck: 'chest',
  head: 'neck',
  upperArmL: 'chest',
  lowerArmL: 'upperArmL',
  handL: 'lowerArmL',
  gripL: 'handL',
  upperArmR: 'chest',
  lowerArmR: 'upperArmR',
  handR: 'lowerArmR',
  gripR: 'handR',
  upperLegL: 'hips',
  lowerLegL: 'upperLegL',
  footL: 'lowerLegL',
  upperLegR: 'hips',
  lowerLegR: 'upperLegR',
  footR: 'lowerLegR',
};
const JOINT_ORDER = Object.keys(JOINT_PARENT);
const EMPTY = new Set(['gripL', 'gripR']);
const BONES = JOINT_ORDER.filter((j) => !EMPTY.has(j));

// ---------------------------------------------------------------------------------------------
// Shapes (design units; a cell's centre is (i + 0.5, j + 0.5, k + 0.5))

const C = (i) => i + 0.5;
/** Inside a box (faces lo..hi) rounded by r (a number or one per axis) on its edges. */
function inRound(p, lo, hi, r) {
  let d2 = 0;
  for (let a = 0; a < 3; a++) {
    const ra = Array.isArray(r) ? r[a] : r;
    if (p[a] < lo[a] || p[a] > hi[a]) return false;
    if (ra <= 0) continue;
    const q = Math.max(lo[a] + ra - p[a], 0, p[a] - (hi[a] - ra));
    d2 += (q / ra) ** 2;
  }
  return d2 <= 1.0001;
}
const inEllipsoid = (p, c, r) => ((p[0] - c[0]) / r[0]) ** 2 + ((p[1] - c[1]) / r[1]) ** 2 + ((p[2] - c[2]) / r[2]) ** 2 <= 1;

/**
 * Fill a part: the cells whose centres lie in the box lo..hi (design units) and that `inside`
 * accepts (default: all), coloured `colour` (a name, or `(i, j, k) => name`).
 */
function fill(vox, part, lo, hi, colour, inside = null) {
  const f = typeof colour === 'function' ? colour : () => colour;
  vox.paint(part, lo.map((v) => Math.floor(v)), hi.map((v) => Math.ceil(v)), (i, j, k) => {
    const p = [C(i), C(j), C(k)];
    if (p[0] < lo[0] || p[0] > hi[0] || p[1] < lo[1] || p[1] > hi[1] || p[2] < lo[2] || p[2] > hi[2]) return;
    if (inside && !inside(p)) return;
    return f(i, j, k);
  });
}

// ---------------------------------------------------------------------------------------------
// Builds: widths in design units (the heights are everyone's). Arms and legs are even or odd as
// their widths say; the arms hang beside the chest (`sh` its half-width), the legs from under the
// pelvis a voxel either side of the middle.

const BUILDS = {
  slim: { sh: 6, waist: 5, hip: 5, arm: 4, leg: 4, belly: 0, bust: 0 },
  broad: { sh: 7, waist: 6, hip: 6, arm: 4, leg: 5, belly: 0, bust: 0 },
  heavy: { sh: 7, waist: 7, hip: 6, arm: 5, leg: 5, belly: 2, bust: 0 },
  female: { sh: 6, waist: 4, hip: 5, arm: 4, leg: 4, belly: 0, bust: 1 },
  athlete: { sh: 6, waist: 5, hip: 5, arm: 4, leg: 4, belly: 0, bust: 1 },
};

/**
 * Heights (design units, from the soles): boots to 4, shins to 10, thighs to 17 (under the pelvis
 * from 14), the pelvis to 19 (its top row the belt), the belly to 23, the chest to 31 (the
 * shoulders' pivots at 29), the head from 32 to 44.
 */
const Y = { ankle: 3, knee: 11, pelvis: 17, split: 18, hipJoint: 19.5, hips: 20, belt: 21, spine: 22, chest: 26, shoulder: 32, chestTop: 34, neck: 34, head: 36, crown: 48, elbow: 25.5, wrist: 19 };
/** The frame the heads are drawn in (their chins at 32), set on the neck at `Y.head`. */
const HY = { head: 32, crown: 44 };
/** The torso's front row of cells (k), and the head's face row. */
const F = 3;
const FACE = 4;

/** Where a build's limbs are (design units, the figure's left; the right mirrors). */
function limbs(b) {
  const ax = b.sh + b.arm / 2;
  const lx0 = 1, lx1 = 1 + b.leg;
  const lz0 = b.leg % 2 ? -2 : -3, lz1 = lz0 + b.leg;
  return { ax, lx0, lx1, lx: (lx0 + lx1) / 2, lz0, lz1, lz: (lz0 + lz1) / 2 };
}

/** The joints (design units, the figure's space: +x its left, +z ahead) for a build. */
function joints(b) {
  const L = limbs(b);
  const J = {
    hips: [0, Y.hips, 0],
    spine: [0, Y.spine, 0],
    chest: [0, Y.chest, 0],
    neck: [0, Y.neck, -1],
    head: [0, Y.head, -1],
    upperArmL: [L.ax, Y.shoulder, 0],
    lowerArmL: [L.ax, Y.elbow, 0],
    handL: [L.ax, Y.wrist, 0],
    upperLegL: [L.lx, Y.hipJoint, L.lz],
    lowerLegL: [L.lx, Y.knee, L.lz],
    footL: [L.lx, Y.ankle, L.lz],
  };
  for (const k of Object.keys(J)) if (k.endsWith('L')) J[k.slice(0, -1) + 'R'] = [-J[k][0], J[k][1], J[k][2]];
  // The fists' holds: the right's round a vertical bar ahead of its wrist, the left's round a bar
  // along z below its wrist.
  J.gripR = [-L.ax, Y.wrist - 2.5, 0.5];
  J.gripL = [L.ax, Y.wrist - 2.5, 0];
  return J;
}

// ---------------------------------------------------------------------------------------------
// The body: every part a closed voxel volume on its joint, in its base colour (dress() recolours).
// Where a part reaches into its neighbour it's a voxel in from the neighbour's surface all round,
// so their surfaces never meet.

function body(vox, s) {
  const { b, o } = s;
  const L = limbs(b);
  const sh = b.sh, W = b.waist, H = b.hip;
  const box = (p, lo, hi, r) => inRound(p, lo, hi, r);
  // Pelvis (hips): the seat, its top row the belt.
  fill(vox, 'hips', [-H, Y.pelvis, -4], [H, Y.spine, 4], 'pants', (p) => box(p, [-H, Y.pelvis - 2, -4], [H, Y.spine, 4], [1.3, 0, 1.3]));
  // Belly (spine): the waist; into the pelvis and the chest.
  const bz = 4 + b.belly;
  fill(vox, 'spine', [-W, Y.spine, -4], [W, Y.chest, bz], 'shirt', (p) => box(p, [-W, Y.spine - 2, -4], [W, Y.chest + 2, bz], [1.4, 0, 1.3 + b.belly * 0.8]));
  fill(vox, 'spine', [-W + 1, Y.spine - 2, -3], [W - 1, Y.spine, 3], 'shirt');
  fill(vox, 'spine', [-W + 1, Y.chest, -3], [W - 1, Y.chest + 2, 3], 'shirt');
  // Chest: squared shoulders rounded over the top, a bust on the women.
  fill(vox, 'chest', [-sh, Y.chest, -4], [sh, Y.chestTop, 4 + b.bust], 'shirt', (p) => {
    const w = p[1] < Y.chest + 2 ? Math.max(W, sh - 1) : sh;
    if (box(p, [-w, Y.chest - 4, -4], [w, Y.chestTop, 4], [2, 2.2, 1.4])) return true;
    return !!b.bust && box(p, [-sh + 1, Y.chest + 1, 0], [sh - 1, Y.chest + 5, 4 + b.bust], [1.4, 1.4, 1.2]);
  });
  // Neck: into the chest below and the head above.
  fill(vox, 'neck', [-2, Y.chestTop - 1, -3], [2, Y.head + 1, 1], 'skin');
  head(vox, s);
  // Arms, of an even width: the upper arm (rounded over the shoulder, a jacket's squared a voxel
  // higher), the forearm (into the upper arm), the fist (round the wrist, as wide as the arm).
  for (const side of ['L', 'R']) {
    const m = side === 'L' ? 1 : -1;
    const X = (a, c) => (m > 0 ? [a, c] : [-c, -a]);
    const [x0, x1] = X(sh, sh + b.arm);
    const a2 = b.arm / 2;
    fill(vox, `upperArm${side}`, [x0, Y.elbow, -a2], [x1, Y.chestTop, a2], 'sleeve', (p) => box(p, [x0, Y.elbow - 4, -a2], [x1, Y.chestTop, a2], [0.8, 1.2, 0.8]));
    if (o.jacket) fill(vox, `upperArm${side}`, [x0, Y.shoulder, -a2], [x1, Y.chestTop + 1, a2], 'sleeve', (p) => box(p, [x0, Y.shoulder - 2, -a2], [x1, Y.chestTop + 1, a2], [0.6, 0.9, 0.6]));
    const [f0, f1] = X(L.ax - 2 * m * m, L.ax + 2);
    const fx0 = m > 0 ? L.ax - 2 : -L.ax - 2, fx1 = fx0 + 4;
    fill(vox, `lowerArm${side}`, [fx0 + 1, Y.elbow, -1], [fx1 - 1, Y.elbow + 2, 1], 'sleeve');
    fill(vox, `lowerArm${side}`, [fx0, Y.wrist, -2], [fx1, Y.elbow, 2], 'sleeve', (p) => box(p, [fx0, Y.wrist - 3, -2], [fx1, Y.elbow + 3, 2], [0.9, 0, 0.9]));
    void f0, void f1;
    fist(vox, s, side, [fx0, fx1]);
  }
  // Legs: thigh (inset where it's under the pelvis), shin (into the thigh), boot (into the shin).
  for (const side of ['L', 'R']) {
    const m = side === 'L' ? 1 : -1;
    const [x0, x1] = m > 0 ? [L.lx0, L.lx1] : [-L.lx1, -L.lx0];
    const { lz0: z0, lz1: z1 } = L;
    fill(vox, `upperLeg${side}`, [x0, Y.knee, z0], [x1, Y.pelvis, z1], 'pants', (p) => box(p, [x0, Y.knee - 3, z0], [x1, Y.pelvis + 3, z1], [0.8, 0, 0.8]));
    fill(vox, `upperLeg${side}`, [x0 + 1, Y.pelvis, z0 + 1], [x1 - 1, Y.hipJoint + 1, z1 - 1], 'pants');
    fill(vox, `lowerLeg${side}`, [x0 + 1, Y.knee, z0 + 1], [x1 - 1, Y.knee + 2, z1 - 1], 'pants');
    fill(vox, `lowerLeg${side}`, [x0, Y.ankle, z0], [x1, Y.knee, z1], 'pants', (p) => box(p, [x0, Y.ankle - 3, z0], [x1, Y.knee + 3, z1], [0.8, 0, 0.8]));
    boot(vox, s, side, [x0, x1], [z0, z1]);
  }
}

/** A fist (as wide as the arm): a rounded block round the grip, the fingers' creases across its knuckles. */
function fist(vox, s, side, [x0, x1]) {
  const part = `hand${side}`;
  const hand = s.o.handWraps ? 'wrap' : 'skin';
  const crease = `${hand}Crease`;
  const y0 = Y.wrist - 5, y1 = Y.wrist + 0.5;
  if (side === 'R') {
    // Ahead of the wrist, round a vertical grip: the knuckles to the front (+z).
    const z0 = -2, z1 = 3;
    fill(vox, part, [x0, y0, z0], [x1, y1, z1], hand, (p) => inRound(p, [x0, y0, z0], [x1, y1 + 1, z1], 1.2));
    vox.recolour(part, (i, j, k) => (k === z1 - 1 && j < Y.wrist - 1 && j > y0 && (j - y0) % 2 === 0 ? crease : undefined));
  } else {
    // Below the wrist, round a bar along z: the knuckles to the outside (+x).
    const z0 = -2, z1 = 2;
    fill(vox, part, [x0, y0, z0], [x1, y1, z1], hand, (p) => inRound(p, [x0, y0, z0], [x1, y1 + 1, z1], 1.2));
    vox.recolour(part, (i, j, k) => (i === x1 - 1 && j < Y.wrist - 1 && j > y0 && k > z0 && k < z1 - 1 && (k - z0) % 2 === 0 ? crease : undefined));
  }
}

/** A shoe: trim, its toe reaching forward, the sole a darker row underneath (a boot higher). */
function boot(vox, s, side, [lx0, lx1], [z0, z1]) {
  const part = `foot${side}`;
  const st = s.o.shoeStyle;
  // A voxel wider than the leg, on the outside.
  const [x0, x1] = side === 'L' ? [lx0, lx1 + 1] : [lx0 - 1, lx1];
  const top = st === 'boot' ? Y.ankle + 2 : Y.ankle;
  const toe = z1 + (st === 'flat' ? 1 : 2);
  const toeTop = 2;
  fill(vox, part, [x0, 0, z0 - 1], [x1, top, z1], 'shoes', (p) => inRound(p, [x0, -2, z0 - 1], [x1, top, z1 + 1], [0.9, 0, 0.9]));
  fill(vox, part, [x0, 0, z0], [x1, toeTop, toe], 'shoes', (p) => inRound(p, [x0, -2, z0 - 1], [x1, toeTop, toe], [1.2, 1.3, 1.8]));
  fill(vox, part, [lx0 + 1, top, z0 + 1], [lx1 - 1, top + 2, z1 - 1], 'shoes');
  vox.recolour(part, (i, j) => (j === 0 ? 'sole' : undefined));
}

// ---------------------------------------------------------------------------------------------
// The head: skull, face, hair, hats, drawn in their own frame (`HY`: the chin at 32). The skull is
// 12 x 12 x 11: x -6..5, y 32..43, z -6..4 (the face the front row, k = 4).

/** The head, drawn in its own frame (`HY`) and set on the neck. */
function head(vox, s) {
  const hv = new Voxels();
  hv.part('head');
  drawHead(hv, s);
  for (const [key, c] of hv.parts.get('head')) {
    const [i, j, k] = cellOf(key);
    vox.set('head', i, j + Y.head - HY.head, k, c);
  }
}

function drawHead(vox, s) {
  const { o } = s;
  const lo = [-6, HY.head, -6], hi = [6, HY.crown, 5];
  fill(vox, 'head', lo, hi, 'skin', (p) => {
    if (!inRound(p, lo, hi, [2.2, 2.4, 2.2])) return false;
    // The jaw narrows to the chin.
    const x = Math.abs(p[0]);
    if (p[1] < HY.head + 1 && (x > 4.2 || p[2] < -3)) return false;
    if (p[1] < HY.head + 2 && x > 5.2) return false;
    return true;
  });
  const set = (i, j, k, c) => vox.set('head', i, j, k, c);
  const del = (i, j, k) => vox.del('head', i, j, k);
  const P = FACE + 1;
  // Ears.
  for (const i of [6, -7]) for (const j of [36, 37]) for (const k of [-2, -1]) set(i, j, k, j === 36 && k === -1 ? 'skinShade' : 'skin');
  // Nose: two wide, two tall, a voxel proud; the nostrils darker.
  for (const i of [-1, 0]) {
    set(i, 36, P, 'skin');
    set(i, 35, P, 'skinShade');
  }
  // Eyes, set a voxel in under proud brows: a white outside, a dark pupil inside.
  const brow = o.lashes ? 'lash' : 'brow';
  for (const m of [1, -1]) {
    const inner = m > 0 ? 2 : -3, outer = m > 0 ? 3 : -4;
    for (const i of [inner, outer]) for (const j of [37, 38]) del(i, j, FACE);
    if (!o.shades) {
      for (const j of [37, 38]) {
        set(inner, j, FACE - 1, 'eye');
        set(outer, j, FACE - 1, j === 38 ? 'white' : 'white');
      }
      set(inner, 38, FACE - 1, 'eye');
    }
    for (const i of [inner - m, inner, outer, outer + m]) if (i !== inner - m || !o.lashes) set(i, 39, i === inner - m ? FACE : P, brow);
    if (o.lashes) set(outer + m, 38, FACE, 'lash');
  }
  // Cheeks.
  if (o.blush) for (const i of [-5, -4, 3, 4]) set(i, 35, FACE, 'blush');
  // Mouth.
  for (const i of [-2, -1, 0, 1]) set(i, 33, FACE, o.lips ? 'lips' : 'mouth');
  if (o.lips) for (const i of [-1, 0]) set(i, 34, FACE, 'lips');
  // Shades: a band across the eyes a voxel proud, a bridge, arms back over the ears.
  if (o.shades) {
    for (let i = -6; i < 6; i++) for (const j of [37, 38]) if (!(j === 37 && (i === -1 || i === 0))) set(i, j, P, i === -1 || i === 0 || i === -6 || i === 5 ? 'frame' : 'glass');
    for (const i of [6, -7]) for (let k = -2; k < P; k++) set(i, 38, k, 'frame');
  }
  // Facial hair.
  if (o.beard === 'goatee') {
    for (const [i, j] of [[-2, 34], [-1, 34], [0, 34], [1, 34], [-2, 33], [1, 33], [-2, 32], [-1, 32], [0, 32], [1, 32], [-1, 31.5], [0, 31.5]]) if (j === Math.floor(j)) set(i, j, P, 'beard');
    for (const i of [-1, 0]) set(i, 32, FACE, 'beard');
  }
  if (o.beard === 'pencil') for (const i of [-2, -1, 0, 1]) set(i, 34, FACE, 'beard');
  if (o.beard === 'stubble') for (let i = -5; i < 5; i++) for (const j of [32, 33, 34]) if (vox.get('head', i, j, FACE) === 'skin' && (i + j) % 2 === 0) set(i, j, FACE, 'stubble');
  hair(vox, s);
  if (o.hat) hat(vox, s);
}

/** Hair: a shell a voxel over the skull where the style says, and its own shapes. */
function hair(vox, s) {
  const st = s.o.hairStyle;
  const set = (i, j, k, c = 'hair') => vox.set('head', i, j, k, c);
  const skull = (i, j, k) => vox.filled(i, j, k, 'head');
  const shell = (where, grow = 1) => {
    for (let i = -9; i < 9; i++)
      for (let j = HY.head; j < HY.crown + 3; j++)
        for (let k = -9; k < 8; k++) {
          const p = [C(i), C(j), C(k)];
          if (skull(i, j, k)) continue;
          if (!inRound(p, [-6 - grow, HY.head, -6 - grow], [6 + grow, HY.crown + grow, 5 + grow], [2.2 + grow * 0.5, 2.4 + grow * 0.5, 2.2 + grow * 0.5])) continue;
          if (where(p, i, j, k)) set(i, j, k, typeof where === 'function' && where.colour ? where.colour(p) : 'hair');
        }
  };
  const top = (p) => p[1] > HY.crown - 1.5;
  const back = (p) => p[2] < 1;
  const sides = (p) => p[1] > 39 && p[2] < 3.5;
  if (st === 'buzz') shell((p) => top(p) || (back(p) && p[1] > 35) || sides(p));
  else if (st === 'crew') {
    shell((p) => top(p) || (back(p) && p[1] > 35) || sides(p));
    for (let i = -5; i < 5; i++) for (let k = -4; k < 4; k++) set(i, HY.crown + 1, k);
    for (let i = -4; i < 4; i++) set(i, HY.crown, 5);
  } else if (st === 'short') {
    shell((p) => top(p) || (back(p) && p[1] > 34.5) || sides(p) || p[1] > 41.5);
    for (let i = -5; i < 5; i++) if ((i + 7) % 3 !== 0) set(i, 41, 6);
  } else if (st === 'slick' || st === 'long') {
    shell((p) => top(p) || (back(p) && p[1] > (st === 'long' ? 33 : 35)) || sides(p) || p[1] > 41.5);
    // Swept back from a ridge over the forehead.
    for (let i = -6; i < 6; i++) set(i, HY.crown, 5);
    for (let i = -5; i < 5; i++) set(i, HY.crown - 1, 6);
    if (st === 'long') {
      // Down to the collar behind and over the ears at the sides, parted in the middle.
      for (let i = -7; i < 7; i++) for (let j = 31; j < 38; j++) for (let k = -8; k < 0; k++) if (!skull(i, j, k) && inRound([C(i), C(j), C(k)], [-7, 31, -8], [7, 40, 0], [1.6, 1, 1.6])) set(i, j, k);
      for (const i of [-8, -7, 6, 7]) for (let j = 33; j < 41; j++) for (let k = -2; k < 2; k++) if (!skull(i, j, k) && (Math.abs(C(i)) < 7.5 || (j > 34 && k < 1))) set(i, j, k);
      for (let k = -2; k < 7; k++) for (const i of [-1, 0]) if (vox.get('head', i, HY.crown, k) === 'hair') set(i, HY.crown, k, 'hairDark');
    }
  } else if (st === 'pomp') {
    shell((p) => top(p) || (back(p) && p[1] > 35) || sides(p) || p[1] > 41.5);
    for (let i = -6; i < 6; i++) for (let j = HY.crown - 3; j < HY.crown + 4; j++) for (let k = 0; k < 8; k++) if (inEllipsoid([C(i), C(j), C(k)], [0, HY.crown + 0.2, 3.6], [5.6, 2.8, 3.6])) set(i, j, k);
    for (const i of [6, -7]) for (let j = 34; j < 38; j++) set(i, j, 1, 'hair');
  } else if (st === 'bob') {
    shell((p) => top(p) || back(p) || p[1] > 39.5);
    for (let i = -8; i < 8; i++) for (let j = 33; j < 41; j++) for (let k = -8; k < 3; k++) if (!skull(i, j, k) && inRound([C(i), C(j), C(k)], [-7.5, 33, -8], [7.5, 43, 3], [2, 0.8, 2])) set(i, j, k);
    // Blunt bangs across the brow.
    for (let i = -6; i < 6; i++) for (const j of [40, 41, 42]) set(i, j, FACE + 1);
  } else if (st === 'pony' || st === 'ponycap') {
    shell((p) => top(p) || (back(p) && p[1] > 35) || sides(p) || p[1] > 41.5);
    for (let i = -5; i < 5; i++) if (i < -1 || i > 0) set(i, 41, FACE + 2);
    // A high ponytail behind, tied, falling to the shoulders.
    const tieY = 40;
    for (let j = 29; j < tieY + 2; j++)
      for (let i = -3; i < 3; i++)
        for (let k = -12; k < -6; k++) {
          const w = j > tieY ? 1.9 : 1.4 + (tieY - j) * 0.04;
          if (inEllipsoid([C(i), C(j), C(k)], [0, j + 0.5, -8.2 - (tieY - j) * 0.14], [w, 1, 1.6])) set(i, j, k);
        }
    for (let i = -2; i < 2; i++) for (const k of [-9, -8, -7]) set(i, tieY, k, 'hairTie');
  }
}

/** Hats: the Boss's fedora, the waitress's paper cap. */
function hat(vox, s) {
  const set = (i, j, k, c) => vox.set('head', i, j, k, c);
  const del = (i, j, k) => vox.del('head', i, j, k);
  if (s.o.hat === 'fedora') {
    // A wide brim (turned down a little in front), a pinched crown with a band; it covers the top.
    const y0 = 42;
    for (let i = -10; i < 10; i++) for (let j = y0; j < HY.crown + 4; j++) for (let k = -10; k < 10; k++) if (vox.get('head', i, j, k) === 'hair') del(i, j, k);
    for (let i = -10; i < 10; i++)
      for (let k = -11; k < 10; k++) {
        if (!inEllipsoid([C(i), 0, C(k)], [0, 0, -0.5], [9.6, 1, 9.8])) continue;
        const front = C(k) > 6.5;
        set(i, y0 + (front ? -1 : 0), k, 'hat');
      }
    for (let i = -7; i < 7; i++)
      for (let j = y0; j < y0 + 6; j++)
        for (let k = -8; k < 7; k++) {
          const p = [C(i), C(j), C(k)];
          if (!inRound(p, [-6.5, y0, -7.5], [6.5, y0 + 6, 5.5], [2.4, 1.6, 2.4])) continue;
          if (j === y0 + 5 && Math.abs(p[0]) < 1.6) continue;
          set(i, j, k, j <= y0 + 1 ? 'hatBand' : 'hat');
        }
  } else if (s.o.hat === 'cap') {
    for (let i = -5; i < 5; i++) for (let j = HY.crown; j < HY.crown + 3; j++) for (let k = -4; k < 3; k++) if (inRound([C(i), C(j), C(k)], [-5, HY.crown, -4], [5, HY.crown + 3, 3], [1.2, 0.8, 1.2])) set(i, j, k, j === HY.crown ? 'capBand' : 'cap');
  }
}

// ---------------------------------------------------------------------------------------------
// Outfits: the ten from art.ts, as pulp-crime characters.

const COMMON = { jacket: false, tie: null, collar: 'shirt', sleeves: 'long', legs: 'trousers', belt: true, shoeStyle: 'oxford' };
const OUTFITS = [
  { id: 'hitman', name: 'The Hitman', build: 'slim', skin: 0xe2b38e, hair: 0x241c17, jacket: 0x26262c, shirt: 0xf4f1ea, tie: 0x141416, pants: 0x26262c, shoes: 0x141414, o: { hairStyle: 'long', jacket: true, tie: 'thin', beard: 'stubble' } },
  { id: 'partner', name: 'The Partner', build: 'broad', skin: 0x6b4630, hair: 0x1a1616, jacket: 0x26262c, shirt: 0xf4f1ea, tie: 0xb3202a, pants: 0x26262c, shoes: 0x141414, o: { hairStyle: 'buzz', beard: 'goatee', jacket: true, tie: 'long' } },
  { id: 'bride', name: 'The Bride', build: 'athlete', skin: 0xf0c9a4, hair: 0xe8c65a, shirt: 0xf2c418, pants: 0xf2c418, shoes: 0xf2c418, accent: 0x161616, lips: 0xd6606a, o: { hairStyle: 'pony', collar: 'track', stripes: true, shoeStyle: 'sneaker', belt: false, lashes: true, zip: true } },
  { id: 'wife', name: 'The Wife', build: 'female', skin: 0xf3d5bd, hair: 0x141111, shirt: 0xf7f5f0, pants: 0x1c1c20, shoes: 0x1c1c20, lips: 0xc2182b, o: { hairStyle: 'bob', collar: 'open', shoeStyle: 'flat', lashes: true, blush: true, cuffs: true } },
  { id: 'bowler', name: 'The Bowler', build: 'heavy', skin: 0xd7a179, hair: 0x5a3a1e, shirt: 0xd63a2f, pants: 0x2d4e86, shoes: 0x2a1a10, accent: 0xf4efe2, o: { hairStyle: 'pomp', sleeves: 'short', collar: 'camp', panels: true, belt: false } },
  { id: 'crooner', name: 'The Crooner', build: 'slim', skin: 0xc48a62, hair: 0x2a1c12, jacket: 0x8fc2ea, shirt: 0xffffff, tie: 0x161616, pants: 0x8fc2ea, shoes: 0x1a1a1a, o: { hairStyle: 'slick', beard: 'pencil', jacket: true, tie: 'bow', ruffles: true, lapels: 'satin' } },
  { id: 'boxer', name: 'The Boxer', build: 'broad', skin: 0xe8b894, hair: 0xd9b25a, jacket: 0x6b3a1f, shirt: 0xf1eee6, pants: 0x3a5a8c, shoes: 0x2a1a10, o: { hairStyle: 'crew', jacket: true, open: true, collar: 'crew', handWraps: true, shoeStyle: 'boot', leather: true } },
  { id: 'kahuna', name: 'The Kahuna', build: 'heavy', skin: 0xb8784e, hair: 0x2a1c12, shirt: 0x1fa3a0, pants: 0xcbb68a, shoes: 0x7a4a26, accent: 0xff5c8a, o: { hairStyle: 'short', sleeves: 'short', legs: 'shorts', collar: 'camp', shades: true, flowers: true, belt: false, chain: true, shoeStyle: 'loafer' } },
  { id: 'waitress', name: 'The Waitress', build: 'female', skin: 0xf0c8a8, hair: 0xb8421e, shirt: 0xf49ac1, pants: 0xf0c8a8, shoes: 0xf7f5f0, accent: 0xffffff, lips: 0xd01c3a, o: { hairStyle: 'ponycap', hat: 'cap', legs: 'skirt', apron: true, sleeves: 'short', collar: 'peter', socks: true, shoeStyle: 'sneaker', belt: false, lashes: true, blush: true } },
  { id: 'boss', name: 'The Boss', build: 'heavy', skin: 0x8a5a3c, hair: 0x2b2b30, jacket: 0x44444f, shirt: 0x1c1c22, tie: 0xd9b030, pants: 0x44444f, shoes: 0x161616, accent: 0x8a8a96, o: { hairStyle: 'buzz', hat: 'fedora', shades: true, jacket: true, tie: 'long', pinstripe: true, pocketSquare: true, ring: true, watch: true } },
];

/** An sRGB colour scaled in brightness. */
const shade = (v, k) => {
  const c = [(v >> 16) & 255, (v >> 8) & 255, v & 255].map((x) => Math.max(0, Math.min(255, Math.round(x * k))));
  return (c[0] << 16) | (c[1] << 8) | c[2];
};
/** Two sRGB colours mixed. */
const mix = (a, b, t) => {
  const c = [16, 8, 0].map((sh) => Math.round(((a >> sh) & 255) * (1 - t) + ((b >> sh) & 255) * t));
  return (c[0] << 16) | (c[1] << 8) | c[2];
};

function palette(d, o) {
  const P = new Palette();
  const jacket = d.jacket ?? d.shirt;
  const cloth = o.leather ? { rough: 0.42, vary: 0.07 } : { rough: 0.85, vary: 0.05 };
  P.add('skin', d.skin, { rough: 0.62, vary: 0.028 });
  P.add('skinShade', shade(d.skin, 0.8), { rough: 0.62, vary: 0.02 });
  P.add('skinCrease', shade(d.skin, 0.8), { rough: 0.62, vary: 0 });
  P.add('blush', mix(d.skin, 0xe0607a, 0.3), { rough: 0.62, vary: 0 });
  P.add('wrap', 0xf4f1ea, { rough: 0.9, vary: 0.04 });
  P.add('wrapCrease', 0xc8c0ae, { rough: 0.9, vary: 0 });
  P.add('stubble', mix(d.skin, d.hair, 0.28), { rough: 0.7, vary: 0.04 });
  P.add('hair', d.hair, { rough: ['slick', 'long', 'pomp'].includes(o.hairStyle) ? 0.32 : 0.7, vary: 0.09 });
  P.add('hairDark', shade(d.hair, 0.7), { rough: 0.5, vary: 0.04 });
  P.add('beard', shade(d.hair, 1.1), { rough: 0.7, vary: 0.07 });
  P.add('brow', shade(d.hair, d.hair > 0x906000 ? 0.62 : 0.9), { rough: 0.7, vary: 0.03 });
  P.add('lash', 0x141010, { rough: 0.5, vary: 0 });
  P.add('eye', 0x1c120e, { rough: 0.15, vary: 0 });
  P.add('white', 0xf2eee6, { rough: 0.3, vary: 0 });
  P.add('mouth', shade(d.skin, 0.6), { rough: 0.5, vary: 0 });
  P.add('lips', d.lips ?? shade(d.skin, 0.7), { rough: 0.3, vary: 0 });
  P.add('glass', 0x101014, { rough: 0.06, metal: 0.4, vary: 0 });
  P.add('frame', 0x2a2a30, { rough: 0.3, metal: 0.7, vary: 0 });
  P.add('gold', 0xe0b83a, { rough: 0.22, metal: 1, vary: 0.06 });
  P.add('button', 0x121214, { rough: 0.3, vary: 0 });
  P.add('jacket', jacket, cloth);
  P.add('sleeve', jacket, cloth);
  P.add('jacketDark', shade(jacket, 0.72), { ...cloth, vary: 0.03 });
  P.add('lapel', o.lapels === 'satin' ? 0x161618 : shade(jacket, 0.84), { rough: o.lapels === 'satin' ? 0.22 : 0.6, vary: 0.03 });
  P.add('stripe', o.pinstripe ? shade(jacket, 1.45) : d.accent ?? 0x8a8a96, { rough: 0.8, vary: 0.03 });
  P.add('shirt', d.shirt, { rough: 0.8, vary: o.flowers ? 0.05 : 0.035 });
  P.add('shirtShade', shade(d.shirt, 0.84), { rough: 0.8, vary: 0.02 });
  P.add('tie', d.tie ?? 0x111111, { rough: 0.35, vary: 0.03 });
  P.add('tieKnot', shade(d.tie ?? 0x111111, 0.8), { rough: 0.35, vary: 0 });
  P.add('pants', d.pants, { rough: 0.85, vary: 0.05 });
  P.add('pantsShade', shade(d.pants, 0.8), { rough: 0.85, vary: 0.03 });
  P.add('shoes', d.shoes, { rough: o.shoeStyle === 'sneaker' ? 0.7 : 0.28, vary: 0.04 });
  P.add('sole', o.shoeStyle === 'sneaker' ? 0xf4f1ea : 0x1a130f, { rough: 0.8, vary: 0.03 });
  P.add('lace', o.shoeStyle === 'sneaker' ? 0x161616 : 0xf4f1ea, { rough: 0.8, vary: 0 });
  P.add('belt', 0x2e1d14, { rough: 0.4, vary: 0.04 });
  P.add('buckle', 0xd0d0d6, { rough: 0.2, metal: 1, vary: 0 });
  P.add('accent', d.accent ?? 0xf4efe2, { rough: 0.8, vary: 0.035 });
  P.add('zip', shade(d.shirt, 0.72), { rough: 0.4, metal: 0.3, vary: 0 });
  P.add('flower', 0xff5c8a, { rough: 0.75, vary: 0.05 });
  P.add('flowerMid', 0xffe066, { rough: 0.75, vary: 0 });
  P.add('leaf', shade(d.shirt, 0.55), { rough: 0.75, vary: 0.05 });
  P.add('apron', 0xffffff, { rough: 0.85, vary: 0.03 });
  P.add('socks', 0xffffff, { rough: 0.9, vary: 0.03 });
  P.add('cap', 0xffffff, { rough: 0.8, vary: 0.02 });
  P.add('capBand', d.shirt, { rough: 0.8, vary: 0 });
  P.add('hairTie', o.hairStyle === 'ponycap' ? 0xffffff : 0x161616, { rough: 0.6, vary: 0 });
  P.add('hat', d.hair, { rough: 0.85, vary: 0.05 });
  P.add('hatBand', 0x141417, { rough: 0.5, vary: 0 });
  P.add('square', 0xe0b83a, { rough: 0.45, vary: 0 });
  return P;
}

/** A skirt's rows: from above the knee (`bottom`) to the belly, flaring out (`t`: 0 at the top, 1 at the hem). */
const SKIRT = { bottom: Y.knee + 1, t: (j) => (Y.spine - j) / (Y.spine - Y.knee - 1) };

/** The outfit: recolour the body's parts by region, and add what's worn over it. */
function dress(vox, s) {
  const { b, o, J } = s;
  const L = limbs(b);
  const suit = o.jacket;
  const top = suit ? 'jacket' : 'shirt';
  const bz = F + b.belly;
  // Arms: sleeves (the jacket's, a shirt cuff at the wrist), or short sleeves (a hem, flush) and bare arms.
  const hem = Math.floor(Y.elbow) + 2;
  for (const side of ['L', 'R']) {
    vox.recolour(`upperArm${side}`, (i, j) => (o.sleeves === 'short' && j < hem ? 'skin' : o.sleeves === 'short' && j === hem ? (o.panels ? 'accent' : 'shirtShade') : top));
    vox.recolour(`lowerArm${side}`, (i, j) => (o.sleeves === 'short' ? 'skin' : (suit || o.cuffs) && j === Math.floor(Y.wrist) ? 'shirt' : top));
  }
  // Chest and belly: the jacket (or shirt). A suit's open in a V from the collar to its button,
  // the shirt and tie inside, lapels a voxel proud beside it.
  const button = suit ? (o.open ? Y.pelvis : Y.spine + 1) : 0;
  const vHalf = (j) => (o.open ? 2 + ((j - button) / (Y.chestTop - button)) * 1.5 : 0.3 + ((j - button) / (Y.chestTop - button)) * 2.8);
  if (suit) {
    for (const part of ['chest', 'spine'])
      vox.recolour(part, (i, j, k) => {
        const front = k >= (part === 'spine' ? bz : F);
        if (!front || j < button) return top;
        const x = Math.abs(C(i));
        const v = vHalf(j);
        if (x < v) return 'shirt';
        if (o.open && x < v + 1) return 'jacketDark';
        return top;
      });
    if (!o.open)
      for (let j = button + 1; j < Y.chestTop; j++) {
        const v = vHalf(j);
        for (const m of [1, -1]) for (let x = Math.ceil(v - 0.5); x < v + 1.5; x++) vox.set(j < Y.chest ? 'spine' : 'chest', m > 0 ? x : -x - 1, j, (j < Y.chest ? bz : F) + 1, 'lapel');
      }
  } else vox.recolour('chest', () => 'shirt');
  // Ties: a long one down the middle, a knot under the collar; or a bow tie.
  if (o.tie === 'long' || o.tie === 'thin') {
    for (let j = Y.spine; j < Y.chestTop - 1; j++) {
      const part = j < Y.chest ? 'spine' : 'chest';
      const k = (part === 'spine' ? bz : F) + 1;
      const cols = o.tie === 'thin' || j === Y.spine ? [j === Y.spine ? -1 : -1, 0].slice(o.tie === 'thin' || j === Y.spine ? 1 : 0) : [-1, 0];
      for (const i of cols) vox.set(part, i, j, k, 'tie');
    }
    for (const i of [-1, 0]) vox.set('chest', i, Y.chestTop - 1, F + 1, 'tieKnot');
  } else if (o.tie === 'bow') {
    for (const [i, d] of [[-3, 2], [-2, 2], [-1, 2], [0, 2], [1, 2], [2, 2], [-3, 1], [2, 1], [-3, 3], [2, 3]]) vox.set('chest', i, Y.chestTop - d, F + 1, i === -1 || i === 0 ? 'tieKnot' : 'tie');
  }
  // Ruffles down the shirt front.
  if (o.ruffles) for (let j = Y.chest; j < Y.chestTop - 3; j++) vox.set('chest', j % 2 ? -1 : 0, j, F + 1, 'shirt');
  // Buttons.
  if (suit && !o.open) for (const i of [-1, 0]) vox.set('spine', i, Y.spine, bz + 1, 'button');
  if (!suit && (o.collar === 'camp' || o.collar === 'open')) for (let j = Y.spine + 1; j < Y.chestTop - 3; j += 2) vox.set(j < Y.chest ? 'spine' : 'chest', -1, j, (j < Y.chest ? bz : F) + 1, o.panels ? 'button' : 'shirtShade');
  // Collars: a band round the neck (on the chest, round the neck's cells), points down the front.
  const collar = o.collar === 'peter' ? 'apron' : o.collar === 'camp' && o.panels ? 'accent' : 'shirt';
  const ring = (c) => {
    for (let i = -3; i < 3; i++) for (let k = -4; k < 2; k++) if (!(i >= -2 && i < 2 && k >= -3 && k < 1)) vox.set('chest', i, Y.chestTop, k, c);
  };
  if (['shirt', 'camp', 'open', 'peter'].includes(o.collar)) {
    ring(collar);
    for (const m of [1, -1]) {
      const a = m > 0 ? 0 : -1;
      vox.set('chest', a + m, Y.chestTop - 1, F + 2, collar);
      vox.set('chest', a + 2 * m, Y.chestTop - 1, F + 2, collar);
      vox.set('chest', a + 2 * m, Y.chestTop - 2, F + 2, collar);
      if (o.collar !== 'shirt') vox.set('chest', a + 3 * m, Y.chestTop - 1, F + 2, collar);
    }
    if (o.collar === 'open' || o.collar === 'camp') for (const i of [-1, 0]) for (let j = Y.chestTop - 3; j < Y.chestTop; j++) vox.set('chest', i, j, F, 'skin');
  } else if (o.collar === 'crew' || o.collar === 'track') ring(o.collar === 'track' ? 'shirt' : 'shirt');
  if (o.collar === 'track') for (let i = -3; i < 3; i++) for (let k = -4; k < 2; k++) if (!(i >= -2 && i < 2 && k >= -3 && k < 1)) vox.set('chest', i, Y.chestTop + 1, k, 'shirt');
  // The Bride's track suit: a zip down the front, black stripes down the sleeves, the sides and the legs.
  if (o.zip) for (let j = Y.spine; j < Y.chestTop; j++) vox.set(j < Y.chest ? 'spine' : 'chest', -1, j, j < Y.chest ? bz : F, 'zip');
  if (o.stripes) {
    for (const side of ['L', 'R']) {
      const m = side === 'L' ? 1 : -1;
      const armOut = m > 0 ? b.sh + b.arm - 1 : -b.sh - b.arm;
      const foreOut = m > 0 ? Math.floor(L.ax) + 1 : -Math.floor(L.ax) - 2;
      vox.recolour(`upperArm${side}`, (i, j, k, c) => (i === armOut && c !== 'skin' ? 'stripe' : undefined));
      vox.recolour(`lowerArm${side}`, (i, j, k, c) => (i === foreOut && c !== 'skin' ? 'stripe' : undefined));
      const legOut = m > 0 ? L.lx1 - 1 : -L.lx1;
      for (const part of [`upperLeg${side}`, `lowerLeg${side}`]) vox.recolour(part, (i) => (i === legOut ? 'stripe' : undefined));
      vox.recolour(`foot${side}`, (i, j, k) => (j > 0 && j < 3 && k > L.lz0 && k < L.lz1 + 1 && (i === legOut || (k + j) % 3 === 0 && i === legOut) ? 'stripe' : undefined));
    }
    for (const part of ['chest', 'spine']) {
      const w = part === 'chest' ? b.sh : b.waist;
      vox.recolour(part, (i, j, k) => (C(k) > -1 && C(k) < 1 && (i === w - 1 || i === -w) ? 'stripe' : undefined));
    }
  }
  // The bowling shirt's cream panels down the front.
  if (o.panels) for (const part of ['chest', 'spine']) vox.recolour(part, (i, j, k, c) => (c === 'shirt' && k >= (part === 'spine' ? bz : F) && Math.abs(C(i)) > 2 && Math.abs(C(i)) < 5 ? 'accent' : undefined));
  // The Hawaiian print: flowers (a yellow heart, pink petals) and leaves scattered over the shirt.
  if (o.flowers) {
    const hash = (i, j, k) => {
      let h = Math.imul(i * 73856093 ^ j * 19349663 ^ k * 83492791, 0x9e3779b1);
      h ^= h >>> 15;
      return ((h >>> 0) % 1000) / 1000;
    };
    for (const part of ['chest', 'spine', 'upperArmL', 'upperArmR', 'hips'])
      vox.recolour(part, (i, j, k, c) => {
        if (c !== 'shirt') return;
        const gi = Math.floor((i + 40) / 4), gj = Math.floor(j / 4), gk = Math.floor((k + 40) / 4);
        const seed = hash(gi, gj, gk);
        const ci = gi * 4 - 40 + 1 + Math.floor(seed * 2), cj = gj * 4 + 1 + Math.floor(hash(gj, gi, gk) * 2), ck = gk * 4 - 40 + 1 + Math.floor(hash(gk, gj, gi) * 2);
        const dd = Math.abs(i - ci) + Math.abs(j - cj) + Math.abs(k - ck);
        if (seed < 0.7) return dd === 0 ? 'flowerMid' : dd === 1 ? 'flower' : undefined;
        if (dd <= 1 && hash(i, j, k) < 0.8) return 'leaf';
      });
  }
  // Pinstripes: every third column a little lighter on the Boss's suit (not on a part's sides).
  if (o.pinstripe)
    for (const part of ['chest', 'spine', 'hips', 'upperArmL', 'upperArmR', 'lowerArmL', 'lowerArmR', 'upperLegL', 'upperLegR', 'lowerLegL', 'lowerLegR']) {
      const cells = vox.parts.get(part);
      vox.recolour(part, (i, j, k, c) => ((c === 'jacket' || c === 'pants' || c === 'sleeve') && ((i % 3) + 3) % 3 === 1 && cells.has(cellKey(i - 1, j, k)) && cells.has(cellKey(i + 1, j, k)) ? 'stripe' : undefined));
    }
  // The waist: a belt with a buckle, or a suit jacket's skirt over the seat (split in front).
  if (suit && !o.open) {
    vox.recolour('hips', (i, j, k) => (j >= Y.pelvis + 2 && !(k >= 3 && Math.abs(C(i)) < 1 + (Y.belt - j) * 0.6) ? 'jacket' : undefined));
  } else if (o.belt || o.open) {
    vox.recolour('hips', (i, j) => (j === Y.belt ? 'belt' : undefined));
    for (const i of [-1, 0]) vox.set('hips', i, Y.belt, 4, 'buckle');
  }
  if (!suit && !o.belt && o.legs !== 'skirt') vox.recolour('hips', (i, j) => (j === Y.belt ? top : undefined));
  // Legs: trousers (a crease down the front), shorts to the knee, or bare under a skirt.
  for (const side of ['L', 'R']) {
    if (o.legs === 'shorts') vox.recolour(`lowerLeg${side}`, (i, j) => (j >= Y.knee - 1 ? 'pants' : 'skin'));
    if (o.legs === 'skirt') {
      vox.recolour(`upperLeg${side}`, () => 'skin');
      vox.recolour(`lowerLeg${side}`, (i, j) => (o.socks && j < Y.ankle + 2 ? 'socks' : 'skin'));
    }
    if (o.legs === 'trousers' && !o.stripes && !o.pinstripe) {
      const mid = side === 'L' ? Math.floor(L.lx) : -Math.floor(L.lx) - 1;
      for (const part of [`upperLeg${side}`, `lowerLeg${side}`]) vox.recolour(part, (i, j, k, c) => (i === mid && k === L.lz1 - 1 && c === 'pants' ? 'pantsShade' : undefined));
    }
  }
  // A skirt's lower part hangs from the thighs, each side's half from its own, so a stride or a
  // crouch swings it with the leg instead of the leg poking through it.
  const skirtPart = (i, j) => (j < Y.split ? (C(i) > 0 ? 'upperLegL' : 'upperLegR') : 'hips');
  if (o.legs === 'skirt') {
    // A flared skirt from the waist to above the knee, its hem a shade darker.
    for (let i = -11; i < 11; i++)
      for (let j = SKIRT.bottom; j < Y.spine; j++)
        for (let k = -8; k < 9; k++) {
          const t = SKIRT.t(j);
          if (Math.abs(C(i)) < b.hip + 0.6 + t * 1.6 && Math.abs(C(k)) < 4.2 + t * 1.4) vox.set(skirtPart(i, j), i, j, k, j === SKIRT.bottom ? 'shirtShade' : 'shirt');
        }
  }
  if (o.apron) {
    // A white apron on the skirt, a bib on the chest, a frill along its hem.
    for (let j = SKIRT.bottom; j < Y.spine; j++) {
      const t = SKIRT.t(j);
      const k = Math.floor(4.2 + t * 1.4);
      for (let i = -4; i < 4; i++) vox.set(skirtPart(i, j), i, j, k, 'apron');
    }
    for (let i = -3; i < 3; i++) for (let j = Y.chest; j < Y.chest + 5; j++) vox.set('chest', i, j, F + b.bust + 1, 'apron');
    for (const i of [-4, 3]) for (let j = Y.chest + 4; j < Y.chestTop; j++) vox.set('chest', i, j, F + 1, 'apron');
  }
  // Jewellery, pocket squares.
  if (o.chain) for (let i = -3; i < 3; i++) vox.set('chest', i, Y.chestTop - 2 - (Math.abs(C(i)) < 1.5 ? 1 : 0), F + 1, 'gold');
  if (o.pocketSquare) for (const i of [3, 4]) vox.set('chest', i, Y.chest + 5, F + 1, 'square');
  if (o.ring) vox.set('handR', -Math.floor(L.ax) - 2, Math.floor(Y.wrist) - 3, 1, 'gold');
  if (o.watch) vox.recolour('lowerArmL', (i, j) => (j === Math.floor(Y.wrist) + 1 ? 'gold' : undefined));
  // Sneakers: laces up the front.
  if (o.shoeStyle === 'sneaker') for (const side of ['L', 'R']) vox.recolour(`foot${side}`, (i, j, k) => (((j === 2 && k === L.lz1 - 1) || (j === 1 && k === L.lz1)) && i === (side === 'L' ? Math.floor(L.lx) : -Math.floor(L.lx) - 1) ? 'lace' : undefined));
  void J;
}

// ---------------------------------------------------------------------------------------------
// The figure

function makeFighter(d) {
  const b = BUILDS[d.build];
  const o = { ...COMMON, ...d.o };
  const s = { b, o, d, J: joints(b) };
  const vox = new Voxels();
  for (const j of BONES) vox.part(j);
  body(vox, s);
  dress(vox, s);
  return { vox, s, P: palette(d, o) };
}

/** A figure's voxels at another scale: each coarse cell takes the design cell under its centre. */
function resample(vox, scale) {
  if (scale === 26) return vox;
  const k = 26 / scale;
  const out = new Voxels();
  for (const [part, cells] of vox.parts) {
    const p = out.part(part);
    const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
    for (const key of cells.keys()) {
      const c = cellOf(key);
      for (let a = 0; a < 3; a++) (lo[a] = Math.min(lo[a], c[a])), (hi[a] = Math.max(hi[a], c[a]));
    }
    for (let x = Math.floor(lo[0] / k) - 1; x <= Math.ceil(hi[0] / k) + 1; x++)
      for (let y = Math.floor(lo[1] / k) - 1; y <= Math.ceil(hi[1] / k) + 1; y++)
        for (let z = Math.floor(lo[2] / k) - 1; z <= Math.ceil(hi[2] / k) + 1; z++) {
          const c = cells.get(cellKey(Math.floor((x + 0.5) * k), Math.floor((y + 0.5) * k), Math.floor((z + 0.5) * k)));
          if (c) p.set(cellKey(x, y, z), c);
        }
  }
  return out;
}

/**
 * Where the fighter wears things (the platform's cosmetics: `HumanoidRig.wearFrame` reads it from
 * the root's `extras.wear`), in metres: the top of the head (its hair, or its hat) and its width with
 * its hair, not its ears; the middle of the back between the shoulders (behind whatever's on it:
 * the lower chest's rearmost voxel), and the width a back item is scaled to (the torso's, or less
 * where the torso is short for the box figure's back cosmetics are drawn for, 8 wide by 12 tall).
 */
function wearOf(vox, b, Y, hz = 0) {
  let crown = Y.head + 12;
  for (const key of vox.parts.get('head').keys()) crown = Math.max(crown, cellOf(key)[1] + 1);
  let back = -4;
  for (const key of vox.parts.get('chest').keys()) {
    const [i, j, k] = cellOf(key);
    if (i === 0 && j === Y.chest + 1) back = Math.min(back, k);
  }
  const width = 2 * b.sh * DU, height = (Y.chestTop - Y.spine) * DU;
  const r = (v) => Math.round(v * 1e4) / 1e4;
  return { top: [0, r(crown * DU), r((hz - 0.5) * DU)], headWidth: r(14 * DU), back: [0, r((Y.chestTop - 1) * DU), r(back * DU)], bodyWidth: r(0.5 * Math.min(width / 0.5, height / 0.75)) };
}

function glb(d) {
  const { vox: design, s, P } = makeFighter(d);
  const vox = resample(design, SCALE);
  const flat = (process.env.VOXEL_BEVEL ?? 'flat') === 'flat';
  const { faces: list, hidden, duplicates, before } = faces(vox, P, { vary: argv.includes('--vary'), merge: flat && !argv.includes('--no-merge') });
  const A = atlas(list, P);
  // Joints in metres; each node's translation from its parent's, rounded as written.
  const J = Object.fromEntries(Object.entries(s.J).map(([k, v]) => [k, v.map((x) => x * DU)]));
  const nodes = [{ name: d.id, children: [], extras: { title: d.name, wear: wearOf(design, s.b, Y) } }];
  const nodeOf = {}, at = {};
  for (const j of JOINT_ORDER) {
    const parent = JOINT_PARENT[j];
    const t = (parent ? J[j].map((v, a) => v - J[parent][a]) : J[j]).map((v) => Math.round(v * 1e5) / 1e5);
    at[j] = parent ? at[parent].map((v, a) => v + t[a]) : t;
    nodeOf[j] = nodes.length;
    nodes.push({ name: j, translation: t, children: [] });
    nodes[parent ? nodeOf[parent] : 0].children.push(nodeOf[j]);
  }
  const bodyNode = nodes.length;
  nodes.push({ name: 'body' });
  nodes[0].children.push(bodyNode);
  for (const n of nodes) if (n.children && !n.children.length) delete n.children;
  // The mesh, bone by bone: each quad's corners (voxel coordinates), normal, UVs, bone.
  const boneOf = Object.fromEntries(BONES.map((j, i) => [j, i]));
  const order = list.map((_, i) => i).sort((a, b) => boneOf[list[a].part] - boneOf[list[b].part] || a - b);
  const pos = [], nor = [], uv = [], jo = [], we = [], idx = [];
  for (const fi of order) {
    const f = list[fi];
    const base = pos.length / 3;
    const corners = quadCorners(f);
    const n = DIRS[f.dir].n;
    for (let c = 0; c < 4; c++) {
      pos.push(...corners[c]);
      nor.push(n[0] * 127, n[1] * 127, n[2] * 127);
      uv.push(Math.round(A.uvs[fi][c][0] * 65535), Math.round(A.uvs[fi][c][1] * 65535));
      jo.push(boneOf[f.part], 0, 0, 0);
      we.push(255, 0, 0, 0);
    }
    idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }
  for (const p of pos) if (p < -128 || p > 127) throw new Error(`${d.id}: a voxel beyond a byte's reach (${p})`);
  // Each bone's inverse bind matrix: from voxel coordinates into its joint's space at rest.
  const ibm = new Float32Array(BONES.length * 16);
  BONES.forEach((j, n) => {
    for (let k = 0; k < 3; k++) ibm[n * 16 + k * 5] = 1 / SCALE;
    ibm[n * 16 + 15] = 1;
    for (let k = 0; k < 3; k++) ibm[n * 16 + 12 + k] = -at[j][k];
  });
  const bytes = writeGlb({
    generator: 'Call of Blocky src/games/callofblocky/tools/fighters/build.mjs',
    nodes,
    sceneName: d.id,
    meshName: 'body',
    meshNode: bodyNode,
    attributes: {
      POSITION: { values: pos, componentType: 5120, type: 'VEC3', minmax: true },
      NORMAL: { values: nor, componentType: 5120, type: 'VEC3', normalized: true },
      TEXCOORD_0: { values: uv, componentType: 5123, type: 'VEC2', normalized: true },
      JOINTS_0: { values: jo, componentType: 5121, type: 'VEC4' },
      WEIGHTS_0: { values: we, componentType: 5121, type: 'VEC4', normalized: true },
    },
    indices: idx,
    skin: { name: `${d.id}_skeleton`, joints: BONES.map((j) => nodeOf[j]), skeleton: nodeOf.hips, inverseBindMatrices: ibm },
    material: { name: d.id, albedo: png(A.albedo), mr: png(A.mr), glow: png(A.glow, { grey: true }) },
    compress: true,
    quantized: true,
  });
  return { bytes, stats: { voxels: vox.count, quads: list.length, faces: before, hidden, duplicates, tiles: A.tiles, atlas: `${A.width}x${A.height}` }, at };
}

// ---------------------------------------------------------------------------------------------
// Validation: parse the GLB back and check the file, the rig, the skin and the budgets.

function validate(buf, d, at) {
  const fail = (m) => {
    throw new Error(`${d.id}.glb: ${m}`);
  };
  const { json, read } = readGlb(buf);
  const byName = new Map(json.nodes.map((n, i) => [n.name, i]));
  const parentOf = new Map();
  json.nodes.forEach((n, i) => (n.children ?? []).forEach((c) => parentOf.set(c, i)));
  const root = json.scenes[0].nodes[0];
  if (json.nodes[root].name !== d.id) fail('root not named after the fighter');
  const world = (i) => {
    let p = [0, 0, 0];
    for (let k = i; k !== undefined; k = parentOf.get(k)) p = p.map((v, a) => v + (json.nodes[k].translation ?? [0, 0, 0])[a]);
    return p;
  };
  for (const j of JOINT_ORDER) {
    const i = byName.get(j);
    if (i === undefined) fail(`joint ${j} missing`);
    const n = json.nodes[i];
    if (n.rotation || n.scale || n.matrix) fail(`${j} has a rotation/scale`);
    const want = JOINT_PARENT[j] ?? d.id;
    if (json.nodes[parentOf.get(i)].name !== want) fail(`${j}'s parent is ${json.nodes[parentOf.get(i)].name}, not ${want}`);
    if (world(i).some((v, a) => Math.abs(v - at[j][a]) > 1e-4)) fail(`${j} at ${world(i)}`);
    if (EMPTY.has(j) && (n.mesh !== undefined || n.children)) fail(`${j} should be empty`);
  }
  if (json.meshes.length !== 1 || json.meshes[0].primitives.length !== 1 || json.materials.length !== 1) fail('not one mesh, one primitive, one material');
  const bodyNode = json.nodes.findIndex((n) => n.mesh !== undefined);
  if (parentOf.get(bodyNode) !== root || json.nodes[bodyNode].skin !== 0) fail('the mesh node');
  const skin = json.skins[0];
  if (skin.joints.join() !== BONES.map((j) => byName.get(j)).join() || skin.skeleton !== byName.get('hips')) fail('the skin\'s joints');
  const ibm = read(json.accessors[skin.inverseBindMatrices]);
  BONES.forEach((j, b) => {
    const w = world(byName.get(j));
    for (let k = 0; k < 16; k++) {
      const want = k >= 12 && k < 15 ? -w[k - 12] : k === 15 ? 1 : k % 5 === 0 ? 1 / SCALE : 0;
      if (Math.abs(ibm[b * 16 + k] - want) > 1e-6) fail(`${j}'s inverse bind matrix`);
    }
  });
  const prim = json.meshes[0].primitives[0];
  const P = read(json.accessors[prim.attributes.POSITION]), N = read(json.accessors[prim.attributes.NORMAL]);
  const JO = read(json.accessors[prim.attributes.JOINTS_0]), WE = read(json.accessors[prim.attributes.WEIGHTS_0]), I = read(json.accessors[prim.indices]);
  const count = json.accessors[prim.attributes.POSITION].count;
  for (let i = 0; i < count; i++) if (JO[i * 4] >= BONES.length || JO[i * 4 + 1] || JO[i * 4 + 2] || JO[i * 4 + 3] || WE[i * 4] !== 255 || WE[i * 4 + 1] || WE[i * 4 + 2] || WE[i * 4 + 3]) fail('a vertex not wholly on one bone');
  let lo = Infinity, hi = -Infinity;
  for (let i = 1; i < P.length; i += 3) (lo = Math.min(lo, P[i])), (hi = Math.max(hi, P[i]));
  for (let t = 0; t < I.length; t += 3) {
    const [a, b2, c] = [I[t], I[t + 1], I[t + 2]];
    if (a >= count || b2 >= count || c >= count) fail('index out of range');
    if (JO[a * 4] !== JO[b2 * 4] || JO[a * 4] !== JO[c * 4]) fail('a triangle across two bones');
    const e1 = [0, 1, 2].map((k) => P[b2 * 3 + k] - P[a * 3 + k]), e2 = [0, 1, 2].map((k) => P[c * 3 + k] - P[a * 3 + k]);
    const cr = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
    if (cr[0] * N[a * 3] + cr[1] * N[a * 3 + 1] + cr[2] * N[a * 3 + 2] <= 0) fail('triangle winding');
  }
  const tris = I.length / 3;
  if (tris > MAX_TRIS) fail(`${tris} triangles (budget ${MAX_TRIS})`);
  if (buf.length > MAX_BYTES) fail(`${buf.length} bytes (budget ${MAX_BYTES})`);
  const height = (hi - lo) / SCALE;
  if (lo !== 0 || height < 1.7 || height > 2.15) fail(`height ${lo / SCALE}..${hi / SCALE}`);
  return { tris, count, height };
}

// ---------------------------------------------------------------------------------------------

const only = argv.filter((a) => !a.startsWith('--'));
mkdirSync(OUT, { recursive: true });
for (const d of OUTFITS) {
  if (only.length && !only.includes(d.id)) continue;
  const { bytes, stats, at } = glb(d);
  const file = join(OUT, `${d.id}.glb`);
  writeFileSync(file, bytes);
  const v = validate(readFileSync(file), d, at);
  console.log(`${d.id}.glb  ${d.name} (${d.build}): ${stats.voxels} voxels, ${stats.faces} faces as ${stats.quads} quads, ${v.tris} tris (${stats.hidden} faces hidden at rest${stats.duplicates ? `, ${stats.duplicates} duplicate faces dropped` : ''}), ${stats.tiles} tiles in ${stats.atlas}, ${(bytes.length / 1024).toFixed(1)} KB, ${v.height.toFixed(2)} m tall`);
}
if (!only.length && OUT === join(HERE, '../../models/fighters')) {
  const lines = [
    ...OUTFITS.map((d) => `import ${d.id} from './${d.id}.glb?url';`),
    '',
    '/**',
    ' * The fighters (GLB, written by `src/games/callofblocky/tools/fighters/build.mjs`; see its header and docs/HUMANOID.md',
    ' * for the rig: hips > spine > chest > neck > head, the arms and legs, `gripR` / `gripL`).',
    ' */',
    'export interface FighterModel {',
    '  id: string;',
    '  name: string;',
    '  url: string;',
    '}',
    '',
    'export const FIGHTERS: FighterModel[] = [',
    ...OUTFITS.map((d) => `  { id: '${d.id}', name: '${d.name}', url: ${d.id} },`),
    '];',
    '',
  ];
  writeFileSync(join(OUT, 'index.ts'), lines.join('\n'));
}
