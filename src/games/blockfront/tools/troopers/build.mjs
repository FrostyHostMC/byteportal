#!/usr/bin/env node
/**
 * Blockfront II: the troopers and heroes, built as micro-voxel figures and written as binary glTF
 * 2.0 (`.glb`) to `src/games/blockfront/models/troopers/<id>.glb`, plus `index.ts` listing them
 * (`TROOPERS`: each side's trooper, heavy and specialist; `TROOPER_VARIANTS`: every variant of
 * each, the Rebels several people a class; `HERO_MODELS`: the heroes by hero id).
 * Dependency-free (Node 22+): `node src/games/blockfront/tools/troopers/build.mjs [ids...] [--out=dir]`
 * (with ids, only those files are rebuilt and index.ts is left alone). Every file is parsed back
 * and checked after it's written: the rig, the skin, every vertex on one bone, the budgets.
 *
 * Call of Blocky's fighters' conventions and look (`callofblocky/tools/fighters/build.mjs`, which
 * this started from), in the platform characters' lean proportions (`src/platform/character/`):
 * - Voxels: 26 a metre, so a figure is about 48 voxels tall (1.85 m to the crown): a big head (12
 *   across, a quarter of the height), a neck, a slim body on long legs, arms of an even width with
 *   fists no wider than them, trim boots. Each figure is painted in code as one voxel part per joint of the humanoid rig
 *   (docs/HUMANOID.md), in design units of 1/24 m: boxes, rounded boxes and ellipsoids, coloured
 *   by region, and details placed voxel by voxel. Every part is a closed surface; where two meet,
 *   one reaches into the other, a voxel in from its surface, so bends open no gaps.
 * - Rig: nodes named exactly hips > spine > chest > neck > head; chest > upperArmL > lowerArmL >
 *   handL > gripL (and the R mirror); hips > upperLegL > lowerLegL > footL (and R). Each has its rest
 *   translation (parent space) and no rotation or scale; the joints sit where the proportions put
 *   them (the platform reads them from the file). The root node is named after the figure's id
 *   (extras.title is its name).
 * - Rest pose: standing straight, arms hanging along -y. One skinned mesh (a node `body` of the
 *   root's) on a skin whose bones are the rig's joints (the grips are empties, not bones), skinned
 *   rigidly: every vertex wholly on its part's joint.
 * - Hands are fists round a grip. The right fist reaches +z from the wrist round a vertical bar (a
 *   pistol grip); the left hangs below its wrist round a bar along z (a handguard). `gripR` /
 *   `gripL` are empty nodes at the centre of each fist's hold, identity rotation.
 * - Look (../voxel.mjs): clean voxels, flat colours with soft occlusion in the concave corners, the
 *   faces of a colour in a plane merged where nothing shades them; a metallic-roughness atlas
 *   (armour and helmets glossy) and an emissive one, in colour (`glow`: Darth Voxel's chest box,
 *   the Emperor's eyes, the heavy trooper's power cells; their tiles kept apart, see `atlasOf`).
 *   One mesh, one material: one draw call a figure.
 * - Vertices: KHR_mesh_quantization (positions as voxel coordinates in bytes, the voxel size in the
 *   inverse bind matrices; normals as bytes), through EXT_meshopt_compression.
 * - Budgets (checked): <= 25000 triangles and <= 300 KB per file.
 *
 * Here besides:
 * - Builds may be taller (`shin`, `thigh`: rows added to the legs, Darth Voxel's; `torso` to the
 *   chest too, Chewblocca's, the tallest at 2.13 m) or hunched (`hunch`: the neck and head forward
 *   and down, the Emperor's). Hitboxes are the game's, the same for all.
 * - Fur (Chewblocca's) is a coat a voxel thick in streaks of three shades (`furOf`), with strands
 *   hanging from it (`shag`): the heaviest figure, as strands don't merge into bigger faces.
 * - Heads are drawn in a space of their own (the chin's row 0, the face's row k = FACE, x across)
 *   and set on the neck where the build puts it: faces, hair, helmets and hoods.
 * - Armour is plates a voxel proud of the undersuit (`coat`), the black suit showing between them
 *   at the neck, waist, elbows and knees.
 * - Robes, tunics and ponchos hang like Call of Blocky's waitress's skirt: below `Y.split` from the
 *   thighs, each side's half from its own, so a stride swings them with the legs. Darth Voxel's
 *   cape hangs rigidly from his chest to his knees, standing off his back so his legs clear it.
 * - Variants: a figure's `role` is [team, class, variant]. The Rebels are several people a class,
 *   each class's kit and silhouette one (`REBEL_TROOPER`, ...): skins, faces (lashes, lips,
 *   moustaches, beards), hair, headgear (helmet, field cap or bare; the heavy's cap's colour; the
 *   specialist's hood up or down), women's builds (`slimF`, `broadF`, `heavyF`: the same limbs).
 *   The Empire's troopers are one each.
 */
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Palette, Voxels, faces, atlas, quadCorners, png, writeGlb, readGlb, cellKey, cellOf, DIRS } from '../voxel.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const SCALE = 26;
const OUT = argv.find((a) => a.startsWith('--out='))?.slice(6) ?? join(HERE, '../../models/troopers');
const DU = 1 / 26;
const MAX_TRIS = 25000;
const MAX_BYTES = 300 * 1024;
/** Heights allowed (metres, to the top of the head): Chewblocca the tallest. */
const MIN_HEIGHT = 1.7, MAX_HEIGHT = 2.15;

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
const SIDES = [['L', 1], ['R', -1]];

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

/**
 * Armour (or cloth) over a part: the empty cells across a face from its surface whose centres
 * `where` accepts, coloured `colour` (a name, or `(i, j, k, under) => name`, `under` the colour it
 * covers): a plate a voxel proud. `axes` are the ways it grows ('xz': out to the sides, front and
 * back only, so the plate's top and bottom edges stay flush); `to` puts it on another part. Twice
 * over (`times`) for a thicker one.
 */
function coat(vox, part, colour, where = () => true, { axes = 'xyz', to = part, times = 1 } = {}) {
  const f = typeof colour === 'function' ? colour : () => colour;
  for (let n = 0; n < times; n++) {
    const cells = vox.parts.get(part);
    const add = new Map();
    for (const [key, c] of cells) {
      const [i, j, k] = cellOf(key);
      for (const { n: d } of DIRS) {
        if (!axes.includes('xyz'[d[0] ? 0 : d[1] ? 1 : 2])) continue;
        const q = [i + d[0], j + d[1], k + d[2]];
        const qk = cellKey(q[0], q[1], q[2]);
        if (cells.has(qk) || add.has(qk) || !where(q.map(C))) continue;
        const col = f(q[0], q[1], q[2], c);
        if (col) add.set(qk, [q, col]);
      }
    }
    for (const [q, col] of add.values()) vox.set(to, q[0], q[1], q[2], col);
  }
}

/** A part's frontmost (+z) cell at column (i, j), or null; `backOf` its rearmost. */
function frontOf(vox, part, i, j) {
  for (let k = 40; k > -40; k--) if (vox.filled(i, j, k, part)) return k;
  return null;
}
function backOf(vox, part, i, j) {
  for (let k = -40; k < 40; k++) if (vox.filled(i, j, k, part)) return k;
  return null;
}
/** A deterministic hash of a cell, 0..1. */
function hash(i, j, k, salt = 0) {
  let h = Math.imul(i * 73856093 ^ j * 19349663 ^ k * 83492791 ^ salt * 2654435761, 0x9e3779b1);
  h ^= h >>> 15;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  return (h >>> 0) / 4294967296;
}

// ---------------------------------------------------------------------------------------------
// Builds: widths in design units. Arms and legs are even or odd as their widths say; the arms
// hang beside the chest (`sh` its half-width), the legs from under the pelvis a voxel either side
// of the middle. `bust` rounds out the chest; `shin` and `thigh` add rows to the legs (all above
// rises with them), `torso` to the chest (the upper arms longer with it); `hunch` brings the neck
// and head forward (and the head a row down).

const BUILDS = {
  slim: { sh: 6, waist: 5, hip: 5, arm: 4, leg: 4, belly: 0 },
  broad: { sh: 7, waist: 6, hip: 6, arm: 4, leg: 5, belly: 0 },
  heavy: { sh: 7, waist: 7, hip: 6, arm: 5, leg: 5, belly: 2 },
  // Women's: a bust, the waist a voxel in; the same limbs as the men's (the same joints, the same
  // silhouette in the same kit).
  slimF: { sh: 6, waist: 4, hip: 5, arm: 4, leg: 4, belly: 0, bust: 1 },
  broadF: { sh: 7, waist: 5, hip: 6, arm: 4, leg: 5, belly: 0, bust: 1 },
  heavyF: { sh: 7, waist: 6, hip: 6, arm: 5, leg: 5, belly: 1, bust: 1 },
  // Darth Voxel and Chewblocca: a voxel broader all round than the heavy, longer in the leg (and
  // Chewblocca in the body); the Emperor stooped.
  lord: { sh: 8, waist: 6, hip: 6, arm: 5, leg: 5, belly: 0, shin: 1, thigh: 1 },
  wookiee: { sh: 8, waist: 7, hip: 7, arm: 5, leg: 5, belly: 0, shin: 1, thigh: 1, torso: 1 },
  old: { sh: 6, waist: 5, hip: 5, arm: 4, leg: 4, belly: 1, hunch: 2 },
};

/**
 * Heights (design units, from the soles), for the standard build: boots to 4, shins to 10, thighs
 * to 17 (under the pelvis from 14), the pelvis to 19 (its top row the belt), the belly to 23, the
 * chest to 31 (the shoulders' pivots at 29), the head from 32 to 44. Below `split` a skirt or robe
 * hangs from the thighs.
 */
function heights(b) {
  const s = b.shin ?? 0, t = s + (b.thigh ?? 0), u = t + (b.torso ?? 0);
  return { ankle: 3, knee: 11 + s, pelvis: 17 + t, split: 18 + t, hipJoint: 19.5 + t, hips: 20 + t, belt: 21 + t, spine: 22 + t, chest: 26 + t, shoulder: 32 + u, chestTop: 34 + u, neck: 34 + u, head: 36 + u, crown: 48 + u, elbow: 25.5 + t, wrist: 19 + t };
}
/** The torso's front row of cells (k), and the head's face row (in its own space). */
const F = 3;
const FACE = 4;

/** Where a build's limbs are (design units, the figure's left; the right mirrors). */
function limbs(b) {
  const ax = b.sh + b.arm / 2;
  const lx0 = 1, lx1 = 1 + b.leg;
  const lz0 = b.leg % 2 ? -2 : -3, lz1 = lz0 + b.leg;
  return { ax, lx0, lx1, lx: (lx0 + lx1) / 2, lz0, lz1, lz: (lz0 + lz1) / 2 };
}

/** Where the head's own space sits in the figure's: its chin row and middle (the hunch moves it). */
const headAt = (b, Y) => [0, Y.head - (b.hunch ? 1 : 0), b.hunch ?? 0];

/** The joints (design units, the figure's space: +x its left, +z ahead) for a build. */
function joints(b, Y) {
  const L = limbs(b);
  const h = headAt(b, Y);
  const J = {
    hips: [0, Y.hips, 0],
    spine: [0, Y.spine, 0],
    chest: [0, Y.chest, 0],
    neck: [0, Y.neck - (b.hunch ? 1 : 0), -1 + (b.hunch ?? 0) / 2],
    head: [0, h[1], -1 + h[2]],
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
// The body: every part a closed voxel volume on its joint, in its base colour (the costume
// recolours and covers it): 'pants' (pelvis, legs), 'shirt' (belly, chest), 'sleeve' (arms),
// 'skin' (neck), the fists 'skin' or 'glove', the boots 'shoes' on a 'sole'. Where a part reaches
// into its neighbour it's a voxel in from the neighbour's surface all round, so their surfaces
// never meet.

function body(vox, s) {
  const { b, o, Y } = s;
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
  const bust = b.bust ?? 0;
  fill(vox, 'chest', [-sh, Y.chest, -4], [sh, Y.chestTop, 4 + bust], 'shirt', (p) => {
    const w = p[1] < Y.chest + 2 ? Math.max(W, sh - 1) : sh;
    if (box(p, [-w, Y.chest - 4, -4], [w, Y.chestTop, 4], [2, 2.2, 1.4])) return true;
    return !!bust && box(p, [-sh + 1, Y.chest + 1, 0], [sh - 1, Y.chest + 5, 4 + bust], [1.4, 1.4, 1.2]);
  });
  // A stoop: the upper back rounded out behind the shoulders.
  if (b.hunch) fill(vox, 'chest', [-sh + 1, Y.chest + 2, -6], [sh - 1, Y.chestTop, 0], 'shirt', (p) => inEllipsoid(p, [0, Y.chestTop - 2.5, -3], [sh - 1.5, 4.5, 3.2]));
  // Neck: into the chest below and the head above.
  const [, hy, hz] = headAt(b, Y);
  fill(vox, 'neck', [-2, Y.chestTop - 1, -3 + hz], [2, hy + 1, 1 + hz], 'skin');
  head(vox, s);
  // Arms: the upper arm (a rounded cap over the shoulder), the forearm (into the upper arm), the
  // fist (round the wrist).
  for (const [side, m] of SIDES) {
    const X = (a, c) => (m > 0 ? [a, c] : [-c, -a]);
    const [x0, x1] = X(sh, sh + b.arm);
    const a2 = b.arm / 2;
    fill(vox, `upperArm${side}`, [x0, Y.elbow, -a2], [x1, Y.chestTop, a2], 'sleeve', (p) => box(p, [x0, Y.elbow - 4, -a2], [x1, Y.chestTop, a2], [0.8, 1.2, 0.8]));
    const fx0 = m > 0 ? L.ax - 2 : -L.ax - 2, fx1 = fx0 + 4;
    fill(vox, `lowerArm${side}`, [fx0 + 1, Y.elbow, -1], [fx1 - 1, Y.elbow + 2, 1], 'sleeve');
    fill(vox, `lowerArm${side}`, [fx0, Y.wrist, -2], [fx1, Y.elbow, 2], 'sleeve', (p) => box(p, [fx0, Y.wrist - 3, -2], [fx1, Y.elbow + 3, 2], [0.9, 0, 0.9]));
    fist(vox, s, side, [fx0, fx1]);
  }
  // Legs: thigh (inset where it's under the pelvis), shin (into the thigh), boot (into the shin).
  for (const [side, m] of SIDES) {
    const [x0, x1] = m > 0 ? [L.lx0, L.lx1] : [-L.lx1, -L.lx0];
    const { lz0: z0, lz1: z1 } = L;
    fill(vox, `upperLeg${side}`, [x0, Y.knee, z0], [x1, Y.pelvis, z1], 'pants', (p) => box(p, [x0, Y.knee - 3, z0], [x1, Y.pelvis + 3, z1], [0.8, 0, 0.8]));
    fill(vox, `upperLeg${side}`, [x0 + 1, Y.pelvis, z0 + 1], [x1 - 1, Y.hipJoint + 1, z1 - 1], 'pants');
    fill(vox, `lowerLeg${side}`, [x0 + 1, Y.knee, z0 + 1], [x1 - 1, Y.knee + 2, z1 - 1], 'pants');
    fill(vox, `lowerLeg${side}`, [x0, Y.ankle, z0], [x1, Y.knee, z1], 'pants', (p) => box(p, [x0, Y.ankle - 3, z0], [x1, Y.knee + 3, z1], [0.8, 0, 0.8]));
    boot(vox, s, side, [x0, x1], [z0, z1]);
  }
}

/** A fist (the forearm's width, 5 tall): a rounded block round the grip, the fingers' creases across its knuckles. */
function fist(vox, s, side, [x0, x1]) {
  const { Y, o } = s;
  const part = `hand${side}`;
  const hand = o.gloves === true || o.gloves === side ? 'glove' : 'skin';
  const crease = `${hand}Crease`;
  const y0 = Y.wrist - 5, y1 = Y.wrist + 0.5;
  if (side === 'R') {
    // Ahead of the wrist, round a vertical grip: the knuckles to the front (+z).
    const z0 = -2, z1 = 3;
    fill(vox, part, [x0, y0, z0], [x1, y1, z1], hand, (p) => inRound(p, [x0, y0, z0], [x1, y1 + 1, z1], 1.2));
    vox.recolour(part, (i, j, k) => (k === z1 - 1 && j < Y.wrist - 1 && j > y0 && (j - Math.floor(y0)) % 2 === 1 ? crease : undefined));
  } else {
    // Below the wrist, round a bar along z: the knuckles to the outside (+x).
    const z0 = -2, z1 = 2;
    fill(vox, part, [x0, y0, z0], [x1, y1, z1], hand, (p) => inRound(p, [x0, y0, z0], [x1, y1 + 1, z1], 1.2));
    vox.recolour(part, (i, j, k) => (i === x1 - 1 && j < Y.wrist - 1 && j > y0 && k > z0 && k < z1 - 1 && (k - z0) % 2 === 0 ? crease : undefined));
  }
}

/** A boot: chunky, its toe reaching forward, the sole a darker row underneath. */
function boot(vox, s, side, [lx0, lx1], [z0, z1]) {
  const { Y, o } = s;
  const part = `foot${side}`;
  const st = o.shoeStyle;
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
// Heads, in their own space: the skull 12 x 12 x 11, x -6..5, rows 0..11 (the chin's row 0, the
// crown's top at 12), z -6..4 (the face the front row, k = FACE). `head` draws the figure's and
// sets it on the neck.

function head(vox, s) {
  const hv = new Voxels();
  hv.part('head');
  s.d.head(hv, s);
  const [ox, oy, oz] = headAt(s.b, s.Y);
  for (const [key, c] of hv.parts.get('head')) {
    const [i, j, k] = cellOf(key);
    vox.set('head', i + ox, j + oy, k + oz, c);
  }
}

/** The skull: rounded, the jaw narrowing to the chin. */
function skull(hv, colour = 'skin') {
  const lo = [-6, 0, -6], hi = [6, 12, 5];
  fill(hv, 'head', lo, hi, colour, (p) => {
    if (!inRound(p, lo, hi, [2.2, 2.4, 2.2])) return false;
    const x = Math.abs(p[0]);
    if (p[1] < 1 && (x > 4.2 || p[2] < -3)) return false;
    if (p[1] < 2 && x > 5.2) return false;
    return true;
  });
}

/**
 * A face on the skull: ears, a nose, eyes set in under proud brows (a dark pupil inside, a white
 * outside), a mouth; `stubble`, `wrinkles`, `eye` (the pupils' colour), `lashes` (finer brows, a
 * lash at each eye's outer corner), `lips`, `tache` (a moustache), `goatee` (and a moustache).
 */
function face(hv, o = {}) {
  const set = (i, j, k, c) => hv.set('head', i, j, k, c);
  const del = (i, j, k) => hv.del('head', i, j, k);
  const P = FACE + 1;
  if (o.ears !== false) for (const i of [6, -7]) for (const j of [4, 5]) for (const k of [-2, -1]) set(i, j, k, j === 4 && k === -1 ? 'skinShade' : 'skin');
  for (const i of [-1, 0]) {
    set(i, 4, P, 'skin');
    set(i, 3, P, 'skinShade');
  }
  for (const m of [1, -1]) {
    const inner = m > 0 ? 2 : -3, outer = m > 0 ? 3 : -4;
    for (const i of [inner, outer]) for (const j of [5, 6]) del(i, j, FACE);
    for (const j of [5, 6]) {
      set(inner, j, FACE - 1, o.eye ?? 'eye');
      set(outer, j, FACE - 1, o.eyeWhite ?? 'white');
    }
    for (const i of [inner - m, inner, outer, outer + m]) if (i !== inner - m || !o.lashes) set(i, 7, i === inner - m ? FACE : P, 'brow');
    if (o.lashes) set(outer + m, 6, FACE, 'lash');
  }
  for (const i of [-2, -1, 0, 1]) set(i, 1, FACE, o.lips ? 'lips' : 'mouth');
  if (o.lips) for (const i of [-1, 0]) set(i, 2, FACE, 'lips');
  if (o.tache || o.goatee) {
    // Over the mouth, a voxel proud, its ends turned down.
    for (let i = -3; i < 3; i++) set(i, 2, P, 'beard');
    for (const i of [-3, 2]) set(i, 1, P, 'beard');
  }
  if (o.goatee) {
    for (const [i, j] of [[-2, 0], [-1, 0], [0, 0], [1, 0], [-1, -1], [0, -1]]) set(i, j, P, 'beard');
    for (const i of [-1, 0]) set(i, 0, FACE, 'beard');
  }
  if (o.stubble) for (let i = -5; i < 5; i++) for (const j of [0, 1, 2]) if (hv.get('head', i, j, FACE) === 'skin' && (i + j) % 2 === 0) set(i, j, FACE, 'stubble');
  if (o.wrinkles) {
    // Lines across the brow, under the eyes, down from the nose past the mouth.
    for (let i = -4; i < 4; i++) if (i !== -1 && i !== 0) set(i, 9, FACE, 'skinCrease');
    for (let i = -3; i < 3; i++) set(i, 10, FACE, i % 2 ? 'skinCrease' : 'skin');
    for (const i of [-5, -4, 3, 4]) set(i, 4, FACE, 'skinCrease');
    for (const [i, j] of [[-3, 3], [2, 3], [-3, 2], [2, 2], [-4, 1], [3, 1]]) set(i, j, FACE, 'skinCrease');
  }
}

/**
 * Hair: a shell a voxel over the skull where the style says: `cropped` (the back and sides, for
 * under a cap), `short` (and the top, a fringe), `buzz` (close all over), `swept` (Luke
 * Skyblocker's: fuller, a side parting, over the ears), `receding` (thin on top), `bun` (pulled
 * back to a bun), `pony` (the back and sides, a ponytail hanging below a helmet's rim), `bob` (to
 * the jaw at the sides and back, for under a cap).
 */
function hair(hv, style) {
  const set = (i, j, k, c = 'hair') => hv.set('head', i, j, k, c);
  const skullAt = (i, j, k) => hv.filled(i, j, k, 'head');
  const shell = (where, grow = 1) => {
    for (let i = -9; i < 9; i++)
      for (let j = 0; j < 15; j++)
        for (let k = -9; k < 8; k++) {
          const p = [C(i), C(j), C(k)];
          if (skullAt(i, j, k)) continue;
          if (!inRound(p, [-6 - grow, 0, -6 - grow], [6 + grow, 12 + grow, 5 + grow], [2.2 + grow * 0.5, 2.4 + grow * 0.5, 2.2 + grow * 0.5])) continue;
          if (where(p, i, j, k)) set(i, j, k);
        }
  };
  const top = (p) => p[1] > 10.5;
  const back = (p) => p[2] < 1;
  const sides = (p) => p[1] > 7 && p[2] < 3.5;
  if (style === 'cropped') shell((p) => (back(p) && p[1] > 2.5) || (sides(p) && p[1] < 9.5));
  else if (style === 'buzz') shell((p) => top(p) || (back(p) && p[1] > 3.5) || sides(p) || p[1] > 9.5);
  else if (style === 'bun') {
    shell((p) => top(p) || (back(p) && p[1] > 2.5) || sides(p) || p[1] > 9.5);
    // A parting down the middle, the bun at the back of the crown, tied.
    for (let k = -3; k < 6; k++) for (const i of [-1, 0]) if (hv.get('head', i, 12, k) === 'hair') set(i, 12, k, 'hairDark');
    for (let i = -4; i < 4; i++)
      for (let j = 5; j < 14; j++)
        for (let k = -13; k < -6; k++) if (!skullAt(i, j, k) && inEllipsoid([C(i), C(j), C(k)], [0, 9.4, -9.2], [3, 2.8, 2.6])) set(i, j, k, k === -8 ? 'hairTie' : 'hair');
  } else if (style === 'pony') {
    shell((p) => (back(p) && p[1] > 2.5) || (sides(p) && p[1] < 9.5) || top(p));
    // Tied at the nape under a helmet's rim, falling to the shoulders.
    for (let j = -2; j < 4; j++) for (const i of [-1, 0]) for (const k of [-9, -8]) set(i, j, k, j === 3 ? 'hairTie' : 'hair');
    for (const i of [-2, 1]) for (let j = 0; j < 3; j++) set(i, j, -9);
  } else if (style === 'bob') {
    shell((p) => top(p) || back(p) || p[1] > 8.5);
    for (let i = -8; i < 8; i++) for (let j = 1; j < 10; j++) for (let k = -9; k < 2; k++) if (!skullAt(i, j, k) && inRound([C(i), C(j), C(k)], [-7.5, 1, -8], [7.5, 11, 2], [2, 0.8, 2])) set(i, j, k);
  } else if (style === 'short') {
    shell((p) => top(p) || (back(p) && p[1] > 2.5) || sides(p) || p[1] > 9.5);
    for (let i = -5; i < 5; i++) if ((i + 7) % 3 !== 0) set(i, 9, 6);
  } else if (style === 'swept') {
    shell((p) => top(p) || (back(p) && p[1] > 2.5) || (p[1] > 4.5 && p[2] < 2.5) || p[1] > 9.5);
    // The back: darker strands down it, the nape uneven.
    hv.recolour('head', (i, j, k, c) => (c === 'hair' && k < -5 && (i + 20) % 3 === 0 && j > 3 && j < 11 ? 'hairDark' : c === 'hair' && k < -5 && j === 3 && (i + 20) % 2 ? false : undefined));
    // A side parting over the figure's left eye, the fringe swept across to its right.
    for (let i = -6; i < 6; i++) {
      set(i, 12, 4);
      if (i < 3) set(i, 10, 6, i < -3 ? 'hair' : 'hairDark');
      if (i < 2) set(i, 11, 6);
      set(i, 12, 5);
    }
    for (let k = -5; k < 6; k++) set(2, 13, k, 'hairDark');
    for (const i of [-8, -7, 6, 7]) for (let j = 4; j < 9; j++) for (let k = -3; k < 2; k++) if (!skullAt(i, j, k) && Math.abs(C(i)) < 7.5) set(i, j, k);
  } else if (style === 'receding') {
    shell((p) => (back(p) && p[1] > 2.5) || (sides(p) && p[2] < 1.5) || (top(p) && p[2] < 0) || (p[1] > 9.5 && p[2] < -2));
    // Thin on top: a few strands over the crown; darker strands down the back.
    for (let i = -4; i < 4; i += 2) for (let k = -2; k < 3; k++) if ((i + k) % 3 === 0) set(i, 12, k);
    hv.recolour('head', (i, j, k, c) => (c === 'hair' && k < -5 && (i + 20) % 3 === 1 && j > 2 ? 'hairDark' : undefined));
  }
}

/** A full beard and moustache, a voxel proud of the jaw, cheeks and chin; the mouth left open. */
function beard(hv, colour = 'beard') {
  for (let i = -7; i < 7; i++)
    for (let j = -2; j < 5; j++)
      for (let k = -3; k < 7; k++) {
        const p = [C(i), C(j), C(k)];
        if (hv.filled(i, j, k, 'head')) continue;
        // Grown out of the skull's lower half, a voxel all round, deeper at the chin.
        if (!inRound(p, [-7, -2, -3], [7, 5, 6], [2.4, 2.2, 2.2])) continue;
        if (p[2] < -1.5 && p[1] > 1) continue;
        if (Math.abs(p[0]) > 6.4 && p[1] > 3) continue;
        hv.set('head', i, j, k, colour);
      }
  // Mustache over the mouth, the mouth a dark gap in the beard.
  for (let i = -3; i < 3; i++) hv.set('head', i, 2, FACE + 1, 'beardDark');
  for (const i of [-2, -1, 0, 1]) {
    hv.del('head', i, 1, FACE + 1);
    hv.set('head', i, 1, FACE, 'mouth');
  }
}

/** The head's frontmost cell at (i, j) in its own space. */
const faceK = (hv, i, j) => frontOf(hv, 'head', i, j);

// Helmets and hoods, each drawn over (and in place of) the skull.

/**
 * The white trooper's helmet: a rounded dome, black teardrop lenses under a brow, a nose ridge down
 * to the frown and its grille, blue-grey tube stripes on the sides and back, the ears, the back
 * flaring over the neck. `mark`: a stripe down the crown (the heavy's).
 */
function stormHelmet(hv, { mark = null } = {}) {
  const set = (i, j, k, c) => hv.set('head', i, j, k, c);
  fill(hv, 'head', [-8, -2, -9], [8, 13, 7], 'armour', (p) => {
    const [x, y, z] = p;
    const ax = Math.abs(x);
    // The back and sides reach two rows lower, flaring out over the neck.
    if (y < 0) return z < 1 && inRound(p, [-7.4, -2, -8], [7.4, 2, 2], [2.2, 0, 2.6]);
    if (!inRound(p, [-7, -8, -7], [7, 13, 6], [3, 3.6, 3])) return false;
    // The cheeks drawn in toward the chin, below the eyes.
    if (y < 4 && z > 1.5 && ax > 5.5 - (4 - y) * 0.5) return false;
    return true;
  });
  // The frown's box: a snout below the nose, a voxel proud, the grille in it.
  fill(hv, 'head', [-3, 0, 5], [3, 4, 7], 'armour', (p) => inRound(p, [-3, 0, 4], [3, 4, 7], [1, 0.6, 0.6]));
  // The nose ridge between the lenses, down to the snout.
  for (let j = 4; j < 8; j++) for (const i of [-1, 0]) set(i, j, 6, 'armour');
  // The lenses: teardrops sloping down and out, black and glossy, recessed a voxel.
  const lens = [[1, 7], [2, 7], [3, 7], [1, 6], [2, 6], [3, 6], [4, 6], [2, 5], [3, 5], [4, 5], [4, 4], [3, 4]];
  for (const [a, j] of lens)
    for (const i of [a, -a - 1]) {
      const k = faceK(hv, i, j);
      hv.del('head', i, j, k);
      set(i, j, k - 1, 'lens');
    }
  // The brow over them, proud.
  for (let i = -5; i < 5; i++) set(i, 8, faceK(hv, i, 8) + (Math.abs(C(i)) < 4.5 ? 1 : 0), 'armour');
  // The frown: a dark outline round the grille, its ends turned down; the grille's slots.
  for (let i = -3; i < 3; i++) {
    set(i, 3, 6, 'grille');
    set(i, 1, 6, i % 2 ? 'grilleDark' : 'grille');
    set(i, 2, 6, i % 2 ? 'grilleDark' : 'grille');
  }
  for (const i of [-4, 3]) for (const j of [1, 2]) set(i, j, faceK(hv, i, j), 'grille');
  // The tears: blue-grey stripes down from the lenses' outer corners.
  for (const m of [1, -1]) for (const j of [2, 3]) set(m > 0 ? 5 : -6, j, faceK(hv, m > 0 ? 5 : -6, j), 'trim');
  // The ears: a disc on each side, a dark centre; tube stripes back from them and down the back.
  for (const m of [1, -1]) {
    const i = m > 0 ? 7 : -8;
    for (let j = 2; j < 7; j++) for (let k = -3; k < 2; k++) if ((j - 4) ** 2 + (k + 1) ** 2 < 5) set(i, j, k, j === 4 && k === -1 ? 'grilleDark' : 'armourShade');
    for (let k = -7; k < -2; k++) set(m > 0 ? 6 : -7, 7, k, 'trim');
  }
  for (const i of [-6, -4, -2, 1, 3, 5]) for (let j = -1; j < 3; j++) set(i, j, backOf(hv, 'head', i, j), 'trim');
  // The heavy's mark: a dark stripe over the crown, front to back.
  if (mark)
    for (let k = -9; k < 8; k++)
      for (const i of [-1, 0])
        for (let j = 8; j < 14; j++) {
          const open = !hv.filled(i, j + 1, k, 'head') || (j > 8 && (!hv.filled(i, j, k + 1, 'head') || !hv.filled(i, j, k - 1, 'head')));
          if (hv.filled(i, j, k, 'head') && open) set(i, j, k, mark);
        }
}

/**
 * The scout's helmet: a compact rounded dome, a black visor band under a peak, a long snout
 * reaching out and down from under it (vents dark along its sides, its mouth dark underneath),
 * grey plates over the ears, the back flaring a little over the neck.
 */
function scoutHelmet(hv) {
  const set = (i, j, k, c) => hv.set('head', i, j, k, c);
  fill(hv, 'head', [-8, 0, -9], [8, 13, 7], 'armour', (p) => {
    const [, y, z] = p;
    // Below the visor only the back and sides, and the cheeks either side of the snout.
    if (y < 4) return (z < 1.5 && inRound(p, [-7.3, 0, -7.8], [7.3, 6, 2], [2.4, 0, 2.6])) || (y > 1 && inRound(p, [-5.5, 0, -2], [5.5, 6, 5], [1.6, 0, 1.6]));
    return inRound(p, [-7, -8, -7.2], [7, 12.6, 5.8], [3.8, 4.4, 3.8]);
  });
  // The visor: a black band across the eyes, set in a voxel, wrapping to the sides.
  for (let i = -7; i < 7; i++)
    for (const j of [5, 6]) {
      const k = faceK(hv, i, j);
      if (k === null || (Math.abs(C(i)) > 5 && k < 0)) continue;
      hv.del('head', i, j, k);
      set(i, j, k - 1, 'lens');
    }
  // The peak over it: two voxels out in the middle, one toward the sides.
  for (let i = -7; i < 7; i++) {
    const k = faceK(hv, i, 7);
    if (k === null || k < 0) continue;
    set(i, 7, k + 1, 'armour');
    if (Math.abs(C(i)) < 5) set(i, 7, k + 2, 'armour');
  }
  // The snout: out from under the visor and down, four wide, its flat end dark.
  const reach = [11, 11, 10, 9, 7];
  for (let j = 0; j < 5; j++)
    for (let i = -2; i < 2; i++)
      for (let k = 2; k < reach[j]; k++) {
        const end = k === reach[j] - 1 && j < 2;
        set(i, j, k, j === 0 ? 'grilleDark' : end ? 'grille' : 'armour');
      }
  for (const i of [-3, 2]) for (let j = 1; j < 4; j++) for (let k = 3; k < reach[j] - 1; k++) set(i, j, k, k % 2 ? 'grilleDark' : 'armourShade');
  // Grey plates over the ears, a ridge down the back.
  for (const m of [1, -1]) for (let j = 3; j < 7; j++) for (let k = -3; k < 1; k++) set(m > 0 ? 7 : -8, j, k, 'armourShade');
  for (let j = 2; j < 12; j++) for (const i of [-1, 0]) set(i, j, backOf(hv, 'head', i, j) - 1, 'armour');
}

/** The rebel's helmet: a rounded bucket over the top of the head, a brim round it, a chin strap. */
function rebelHelmet(hv) {
  const set = (i, j, k, c) => hv.set('head', i, j, k, c);
  // The bucket: a dome over the skull from the brow up, a voxel off it, lower behind.
  fill(hv, 'head', [-9, 3, -9], [9, 15, 8], 'helmet', (p) => (p[1] > 7 && inRound(p, [-7.4, 0, -7.6], [7.4, 14.2, 6.6], [3.6, 4.6, 3.6])) || (p[2] < -2.5 && inRound(p, [-7.4, 4, -7.6], [7.4, 9, 0], [2.4, 0, 2.4])));
  // The band round its rim, and the brim out from it.
  const rim = (i, j, k) => j < 9 && [[0, 1], [0, -1], [1, 0], [-1, 0]].some(([a, c]) => !hv.filled(i + a, j, k + c, 'head'));
  hv.recolour('head', (i, j, k, c) => (c === 'helmet' && rim(i, j, k) && (j === 8 || (j < 8 && k < -2 && j === 4)) ? 'helmetBand' : undefined));
  for (let i = -10; i < 10; i++)
    for (let k = -11; k < 10; k++) {
      const p = [C(i), 7.5, C(k)];
      if (!inEllipsoid(p, [0, 7.5, -0.6], [8.9, 1, 9.3]) || hv.filled(i, 7, k, 'head')) continue;
      set(i, 7, k, 'helmetDark');
    }
  // The chin strap down each cheek.
  for (const m of [1, -1]) for (let j = 1; j < 7; j++) set(m > 0 ? 6 : -7, j, 1, 'strap');
}

/** A soft field cap: a flat-topped crown over the head, a darker band, a short bill in front. */
function fieldCap(hv) {
  const set = (i, j, k, c) => hv.set('head', i, j, k, c);
  fill(hv, 'head', [-8, 8, -8], [8, 14, 7], (i, j) => (j === 8 ? 'fieldCapDark' : 'fieldCap'), (p) => inRound(p, [-7, 8, -7.3], [7, 13.6, 6], [2.6, 1, 2.6]));
  for (let i = -5; i < 5; i++) for (let k = 6; k < 9; k++) if (!(Math.abs(C(i)) > 4 && k > 7)) set(i, 8, k, 'fieldCapDark');
}

/** A scarf pulled up over the mouth and nose's tip, wrapped round the jaw and the neck. */
function gaiter(hv, colour = 'gaiter') {
  for (let i = -8; i < 8; i++)
    for (let j = -3; j < 4; j++)
      for (let k = -5; k < 8; k++) {
        const c = hv.get('head', i, j, k);
        if (c === 'skin' || c === 'skinShade' || c === 'mouth' || c === 'lips' || c === 'stubble') {
          // The skull's own cells stay (the scarf goes over them) unless they stand proud.
          if (k < FACE + 1) continue;
        }
        if (!inRound([C(i), C(j), C(k)], [-7, -3, -4.4], [7, 3.6, 6.2], [2.2, 1.2, 2.2])) continue;
        hv.set('head', i, j, k, j === 3 ? 'gaiterDark' : colour);
      }
}

/** A knit cap: ribbed, a turned-up cuff round its rim, pulled down to the brow. */
function beanie(hv) {
  const set = (i, j, k, c) => hv.set('head', i, j, k, c);
  for (let i = -8; i < 8; i++)
    for (let j = 7; j < 15; j++)
      for (let k = -8; k < 7; k++) {
        const p = [C(i), C(j), C(k)];
        if (!inRound(p, [-7, 6.5, -7], [7, 14, 6], [2.8, 3.6, 2.8])) continue;
        const cuff = j < 9;
        set(i, j, k, cuff ? 'capCuff' : (i + 20) % 2 ? 'capRib' : 'cap');
      }
  // A little fold at the crown.
  for (let i = -2; i < 2; i++) for (let k = -2; k < 2; k++) set(i, 14, k, 'cap');
}

/**
 * A hood, up: a rounded cowl round the skull (open in front, framing the face from the chin to the
 * brow), reaching out past the face (`deep`: how far), a soft point at the back of the crown
 * (`peak`), its back falling behind the neck, narrowing, to the shoulders. `colour`: a name, or
 * (i, j, k) => name.
 */
function hood(hv, colour, { deep = 1, thick = 1.6, peak = 1, open = 5.6 } = {}) {
  const f = typeof colour === 'function' ? colour : () => colour;
  const out = new Map();
  for (let i = -10; i < 10; i++)
    for (let j = -4; j < 16; j++)
      for (let k = -11; k < 10; k++) {
        const p = [C(i), C(j), C(k)];
        const [x, y, z] = p;
        if (hv.filled(i, j, k, 'head')) continue;
        // The outer shape: the skull grown by `thick`, stretched forward by `deep`, a peak on top
        // toward the back, the back falling to the neck.
        const g = thick;
        const cowl = inRound(p, [-6 - g, -1, -6 - g - 0.4], [6 + g, 12 + g, 5 + deep], [3.8, 4.4, 3.6]);
        const point = peak > 0 && inEllipsoid(p, [0, 11.4 + g, -3.2], [3.2, 1.2 + peak, 3.4]);
        const w = 5.4 + g - Math.max(0, 2 - y) * 0.35;
        const fall = y < 6 && inRound(p, [-w, -3.5, -6.6 - g], [w, 7, -1.5], [2.6, 1.6, 2.2]);
        if (!cowl && !point && !fall) continue;
        // The opening: the face and a margin round it, from the chin to the brow.
        if (z > -1 && Math.abs(x) < open && y > -0.5 && y < 9.6 - Math.max(0, Math.abs(x) - 3.5) * 0.6) continue;
        // Under the chin, open (the neck).
        if (y < 0 && z > -2 && Math.abs(x) < 5) continue;
        out.set(cellKey(i, j, k), f(i, j, k));
      }
  for (const [key, c] of out) {
    const [i, j, k] = cellOf(key);
    hv.set('head', i, j, k, c);
  }
}

/**
 * Darth Voxel's helmet: a glossy dome with a brow ridge, the mask below it (dark angled lenses, a
 * nose ridge down to the silver triangle of the mouth grille, angled cheeks), and the flare: the
 * back and sides sweeping out and down over the neck to the shoulders.
 */
function lordHelmet(hv) {
  const set = (i, j, k, c) => hv.set('head', i, j, k, c);
  // The dome: rounded, from the brow up, a voxel over the skull.
  fill(hv, 'head', [-7, 5, -8], [7, 14, 7], 'dome', (p) => inRound(p, [-7, 4, -7.5], [7, 14, 6.4], [3.2, 4, 3.4]));
  // The flare: a bell round the back and sides, a voxel wider every third row down to row -1.
  for (let i = -11; i < 11; i++)
    for (let j = -1; j < 8; j++)
      for (let k = -12; k < 5; k++) {
        const [x, y, z] = [C(i), C(j), C(k)];
        const t = (8 - y) / 9;
        const g = Math.floor((7 - j) / 3);
        if (!inRound([x, y, z], [-7 - g, -2, -7.5 - g], [7 + g, 9, 4], [3 + g * 0.5, 0, 3 + g * 0.5])) continue;
        // Open in front: the mask sits there.
        if (z > 0.5 - t * 1.5 && Math.abs(x) < 6.4 + t * 1.2) continue;
        set(i, j, k, j < 0 ? 'helmetEdge' : 'dome');
      }
  // The mask: the face plate from the chin to the brow.
  fill(hv, 'head', [-6, -1, -2], [6, 8, 6], 'mask', (p) => {
    const [x, y, z] = p;
    const ax = Math.abs(x);
    if (!inRound(p, [-6, -1, -2], [6, 8, 6], [1.6, 0.6, 1.8])) return false;
    // Angled cheeks: narrower toward the chin; the grille's triangle proud in the middle.
    if (y < 4 && ax > 3.2 + y * 0.7) return false;
    if (z > 4.5 && ax > 5 - Math.max(0, 5 - y) * 0.5) return false;
    return true;
  });
  // The brow ridge over the lenses, proud.
  for (let i = -6; i < 6; i++) set(i, 8, faceK(hv, i, 8) + 1, 'dome');
  for (let i = -5; i < 5; i++) set(i, 7, faceK(hv, i, 7) + (Math.abs(C(i)) > 1 ? 1 : 0), 'mask');
  // The lenses: angled, the inner corners lower, dark and glossy.
  const lens = [[1, 5], [2, 5], [2, 6], [3, 6], [4, 6], [5, 6], [3, 5], [4, 5], [1, 4], [2, 4]];
  for (const [a, j] of lens)
    for (const i of [a, -a - 1]) {
      const k = faceK(hv, i, j);
      if (k === null) continue;
      hv.del('head', i, j, k);
      set(i, j, k - 1, 'lordLens');
    }
  // The nose ridge between them, a point down onto the grille.
  for (let j = 3; j < 7; j++) for (const i of [-1, 0]) set(i, j, faceK(hv, i, j) + 1, 'mask');
  // The mouth grille: a silver triangle, point up, its slots dark.
  for (let j = -1; j < 3; j++) {
    const w = 3 - j;
    for (let i = -w; i < w; i++) set(i, j, faceK(hv, i, Math.max(j, 0)) + (j < 0 ? 0 : 1), (i + 10) % 2 && j < 2 ? 'grilleDark' : 'grille');
  }
  // The chin: a silver edge along the mask's bottom.
  for (let i = -3; i < 3; i++) set(i, -1, faceK(hv, i, 0), 'grille');
}

/**
 * Fur's colour at a cell: mostly the fur, lighter and darker streaks mixed in, each three or four
 * voxels down (staggered column by column), so it reads as hair (`dark`: more of the darker).
 */
const furOf = (dark = 0) => (i, j, k) => {
  const h = hash(i, Math.floor((j + ((i * 5 + k * 3) & 3)) / 4), k, 11);
  return h < 0.22 + dark ? 'furDark' : h > 0.84 - dark * 0.5 ? 'furLight' : 'fur';
};

/**
 * Shaggy fur on a part: strands hanging from its sides where `where` accepts, from one cell in
 * so many (`density`): a voxel out from a side face and `len` down from there, so the fur hangs.
 */
function shag(vox, part, colour, density, where = () => true, len = 2) {
  const cells = vox.parts.get(part);
  const add = [];
  for (const key of cells.keys()) {
    const [i, j, k] = cellOf(key);
    if (hash(i, j, k, 23) > density) continue;
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const q = [i + dx, j, k + dz];
      if (cells.has(cellKey(q[0], q[1], q[2])) || !where(q.map(C))) continue;
      for (let d = 0; d < len; d++) add.push([q[0], q[1] - d, q[2]]);
      break;
    }
  }
  for (const [i, j, k] of add) if (j >= 0 && !cells.has(cellKey(i, j, k))) vox.set(part, i, j, k, colour(i, j, k));
}

/**
 * Chewblocca's head: tall and long, all fur; a lighter muzzle out from the lower face, its dark
 * nose on the tip and the mouth under it; small eyes deep under a heavy brow; the mane round it,
 * falling behind and at the sides to the shoulders, shaggy.
 */
function wookieeHead(hv) {
  const set = (i, j, k, c) => hv.set('head', i, j, k, c);
  fill(hv, 'head', [-6, 0, -6], [6, 14, 5], furOf(0), (p) => inRound(p, [-6, 0, -6], [6, 14, 5], [2.6, 3.2, 2.6]) && !(p[1] < 1 && Math.abs(p[0]) > 4.2));
  fill(hv, 'head', [-4, 0, 2], [4, 7, 8], (i, j, k) => (hash(i, j, k, 5) < 0.2 ? 'fur' : 'furLight'), (p) => inRound(p, [-3.6, -0.4, 2], [3.6, 6.4, 7.8], [1.6, 1.6, 1.6]));
  for (const i of [-2, -1, 0, 1]) for (const j of [4, 5]) set(i, j, faceK(hv, i, j), 'nose');
  for (const i of [-1, 0]) set(i, 5, faceK(hv, i, 5) + 1, 'nose');
  for (let i = -3; i < 3; i++) set(i, 2, faceK(hv, i, 2), 'mouth');
  for (const i of [-2, 1]) set(i, 1, faceK(hv, i, 1), 'mouth');
  // Lighter fur round the eyes, the eyes set in it.
  for (const i of [0, 1, 2, 3, -1, -2, -3, -4]) for (const j of [7, 8]) set(i, j, faceK(hv, i, j), 'furLight');
  for (const i of [1, 2, -2, -3]) {
    const k = faceK(hv, i, 8);
    hv.del('head', i, 8, k);
    set(i, 8, k - 1, i === 1 || i === -2 ? 'eyeBlue' : 'eye');
  }
  for (let i = -5; i < 5; i++) for (const j of [9, 10]) set(i, j, faceK(hv, i, j) + 1, j === 9 ? 'furDark' : furOf(0)(i, j, 9));
  // The mane: a shell round the head but the face, down to the shoulders behind and at the sides.
  for (let i = -9; i < 9; i++)
    for (let j = -5; j < 17; j++)
      for (let k = -10; k < 7; k++) {
        const p = [C(i), C(j), C(k)];
        if (hv.filled(i, j, k, 'head')) continue;
        if (!inRound(p, [-7.6, -5, -7.8], [7.6, 15.6, 4], [3, 3.2, 3])) continue;
        if (j < 0 && p[2] > -1) continue;
        if (p[2] > 1 && j < 11 && Math.abs(p[0]) < 6) continue;
        set(i, j, k, j < 2 ? furOf(0.25)(i, j, k) : furOf(0)(i, j, k));
      }
  shag(hv, 'head', (i, j, k) => furOf(0.1)(i, j, k), 0.14, (p) => !(p[2] > 1 && p[1] < 11 && Math.abs(p[0]) < 6));
}

/**
 * Boba Fetch's helmet: a green-grey dome closed to the chin, dented and scratched, the T of its
 * black visor across the eyes and down to the chin, yellowish cheeks, a disc over each ear, and
 * the rangefinder's stalk up from the right one, its sight at the top, its lens lit red.
 */
function bountyHelmet(hv) {
  const set = (i, j, k, c) => hv.set('head', i, j, k, c);
  fill(hv, 'head', [-8, -1, -8], [8, 14, 7], (i, j, k) => (j < 5 && k > -2 ? 'mandoCheek' : 'mandoHelmet'), (p) => inRound(p, [-7, -1, -7.2], [7, 13.2, 6], [3, 3.8, 3]) && !(p[1] < 2 && p[2] > 2 && Math.abs(p[0]) > 5));
  // The visor.
  const visor = (i, j) => (j >= 6 && j <= 7 && Math.abs(C(i)) < 5.5) || (j >= 1 && j < 6 && Math.abs(C(i)) < 1.2);
  for (let i = -6; i < 6; i++)
    for (let j = 1; j < 8; j++)
      if (visor(i, j)) {
        const k = faceK(hv, i, j);
        hv.del('head', i, j, k);
        set(i, j, k - 1, 'visor');
      }
  // A dark rim over the visor's bar.
  for (let i = -6; i < 6; i++) set(i, 8, faceK(hv, i, 8), 'mandoDark');
  // The dent over the left brow, and a few scratches.
  for (const i of [3, 4])
    for (const k of [2, 3]) {
      let top = null;
      for (let j = 15; j > 0; j--) if (hv.filled(i, j, k, 'head')) { top = j; break; }
      if (top !== null) {
        hv.del('head', i, top, k);
        set(i, top - 1, k, 'dent');
      }
    }
  hv.recolour('head', (i, j, k, c) => (c === 'mandoHelmet' && hash(Math.floor(i / 2), Math.floor(j / 2), Math.floor(k / 2), 31) < 0.06 && hash(i, j, k, 32) < 0.5 ? 'dent' : undefined));
  // The ears, and the rangefinder on the right.
  for (const m of [1, -1]) for (let j = 3; j < 8; j++) for (let k = -3; k < 2; k++) if ((j - 5) ** 2 + (k + 1) ** 2 < 5) set(m > 0 ? 7 : -8, j, k, j === 5 && k === -1 ? 'mandoDark' : 'mandoCheek');
  for (let j = 7; j < 15; j++) set(-9, j, -1, 'mandoDark');
  block(hv, 'head', [-10, 14, -2], [-9, 15, 1], 'mandoDark');
  set(-10, 14, 2, 'rangeGlow');
  set(-9, 14, 2, 'rangeGlow');
}

// ---------------------------------------------------------------------------------------------
// Costume helpers

/** A hood, down: gathered in a roll on the back of the shoulders under the neck, a fold across it. */
function hoodDown(vox, s, colour, fold = null) {
  const { Y } = s;
  const f = typeof colour === 'function' ? colour : () => colour;
  const back = backOf(vox, 'chest', 0, Y.chestTop - 2);
  const w = s.b.sh - 0.6;
  fill(vox, 'chest', [-6, Y.chestTop - 5, back - 3], [6, Y.chestTop + 2, back + 3], (i, j, k) => (fold && j === Y.chestTop - 2 && k < back - 1 ? fold : f(i, j, k)), (p) => inEllipsoid(p, [0, Y.chestTop - 1.5, back + 0.5], [w, 3.4, 3]));
}

/** For side m (1 the figure's left, -1 its right), an x range a..c on the left mirrored. */
const X = (m, a, c) => (m > 0 ? [a, c] : [-c, -a]);

/** A belt round the pelvis's top rows (`rows` of them), a buckle a voxel proud in front. */
function belt(vox, s, colour, { rows = 1, buckle = 'buckle', bw = 2, bh = rows } = {}) {
  const { Y } = s;
  coat(vox, 'hips', colour, (p) => p[1] > Y.belt - rows + 0.5 && p[1] < Y.spine, { axes: 'xz' });
  if (!buckle) return;
  const k = frontOf(vox, 'hips', 0, Y.belt) + 1;
  block(vox, 'hips', [-bw, Y.belt - bh + 1, k], [bw - 1, Y.belt, k], buckle);
}

/** A box on a part (cells lo..hi inclusive), `colour`, its outline `edge` (optional). */
function block(vox, part, [i0, j0, k0], [i1, j1, k1], colour, edge = null) {
  for (let i = i0; i <= i1; i++)
    for (let j = j0; j <= j1; j++)
      for (let k = k0; k <= k1; k++) {
        const onEdge = edge && ((i === i0 || i === i1) + (j === j0 || j === j1) + (k === k0 || k === k1) >= 2);
        vox.set(part, i, j, k, onEdge ? edge : colour);
      }
}

/** A pouch on the front of a part at (i0..i1, j0..j1), a flap over its top row. */
function pouch(vox, part, i0, i1, j0, j1, colour, flap) {
  let k = -99;
  for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) k = Math.max(k, frontOf(vox, part, i, j) ?? -99);
  block(vox, part, [i0, j0, k + 1], [i1, j1, k + 1], colour);
  for (let i = i0; i <= i1; i++) vox.set(part, i, j1, k + 1, flap);
  for (let i = i0; i <= i1; i++) vox.set(part, i, j1, k + 2, flap);
}

/**
 * A strap across the torso, front and back, from over one shoulder (`from`: 1 the left, -1 the
 * right) to the other hip: a voxel proud where it's within `w` of the line between them. Returns
 * a point along it, `at(t)` (t from 0 at the shoulder to 1 at the hip), for what hangs on it, and
 * `at.dist(x, y)`, how far a point is from its line.
 */
function sash(vox, s, colour, { from = 1, w = 1.4 } = {}) {
  const { Y } = s;
  const [x0, y0, x1, y1] = [from * 4, Y.chestTop, -from * 5, Y.belt];
  const dx = x1 - x0, dy = y1 - y0, len = Math.hypot(dx, dy);
  const dist = (x, y) => Math.abs((x - x0) * dy - (y - y0) * dx) / len;
  for (const part of ['chest', 'spine']) coat(vox, part, colour, (p) => dist(p[0], p[1]) < w && (part === 'chest' ? p[1] > Y.chest - 0.5 : p[1] < Y.chest + 0.5));
  const at = (t) => [x0 + dx * t, y0 + dy * t];
  at.dist = dist;
  return at;
}

/**
 * A skirt of cloth from `top` (a row; the belly's bottom by default) down to `bottom`, `w0` and
 * `d0` out from the middle at the top (half its width and depth), flaring out `flare` voxels to
 * the sides and `zFlare` front and back by the bottom (`colour` a name or (i, j, k) => name). Each
 * row goes on the part it hangs from: the chest, the belly, the hips, and below `Y.split` each
 * side's thigh. Below the pelvis it's a shell two voxels thick round the legs. `open` leaves a
 * gap in front that many voxels either side of the middle, `gap(t)` more toward the bottom.
 */
function skirt(vox, s, colour, { top = null, bottom, flare = 2, zFlare = null, open = 0, gap = null, w0 = null, d0 = 4.2 } = {}) {
  const { b, Y } = s;
  const f = typeof colour === 'function' ? colour : () => colour;
  const y0 = top ?? Y.spine;
  const part = (i, j) => (j >= Y.chest ? 'chest' : j >= Y.spine ? 'spine' : j >= Y.split ? 'hips' : C(i) > 0 ? 'upperLegL' : 'upperLegR');
  for (let i = -16; i < 16; i++)
    for (let j = bottom; j < y0; j++)
      for (let k = -16; k < 16; k++) {
        const t = (y0 - j) / (y0 - bottom);
        const hw = (w0 ?? b.hip + 0.6) + t * flare, hd = d0 + t * (zFlare ?? flare * 0.9);
        const x = C(i), z = C(k);
        if (Math.abs(x) > hw || Math.abs(z) > hd) continue;
        if (Math.abs(x) < hw - 2 && Math.abs(z) < hd - 2 && j < Y.pelvis) continue;
        if (open && z > 0 && Math.abs(x) < open + (gap ? gap(t) : 0)) continue;
        const c = f(i, j, k);
        if (c) vox.set(part(i, j), i, j, k, c);
      }
}

/** Camouflage: blotches of the given colours, two to four voxels across, from a hash of the cell. */
const camo = (colours, salt = 1) => (i, j, k) => {
  const g = (v, n) => Math.floor((v + 64) / n);
  const a = hash(g(i, 3), g(j, 3), g(k, 3), salt), b2 = hash(g(i + 1, 2), g(j, 2), g(k + 1, 2), salt + 7);
  const n = Math.floor((a * 0.7 + b2 * 0.3) * colours.length * 0.999);
  return colours[Math.min(colours.length - 1, n)];
};

// ---------------------------------------------------------------------------------------------
// The costumes

/**
 * The white trooper's armour over a black undersuit: the chest and back plate (the shoulders
 * too), the abdomen and kidney plates, a belt with a box buckle, the pelvis's plates, bells on
 * the shoulders, plates on the upper arms, forearms, thighs and shins, white boots, black gloves;
 * black at the neck, waist, elbows and knees. A holster on the right thigh.
 */
function trooperArmour(vox, s, { heavy = false } = {}) {
  // (`heavy`: plates over the knees too.)
  const { b, Y } = s;
  const L = limbs(b);
  const A = 'armour';
  vox.recolour('neck', () => 'suit');
  // Chest and back plate, the shoulders over; a black ring round the neck.
  coat(vox, 'chest', A, (p) => p[1] > Y.chest + 1.5 && !(Math.abs(p[0]) < 3.6 && p[2] > -4.5 && p[2] < 2.5 && p[1] > Y.chestTop - 0.5));
  // A row of little control keys on the chest plate's right.
  for (let i = -6; i < -2; i++) vox.set('chest', i, Y.chest + 5, F + 2, i % 2 ? 'armourShade' : 'trim');
  // Abdomen plate in front, kidney plate behind.
  coat(vox, 'spine', A, (p) => p[2] > 2 + b.belly && p[1] > Y.spine + 0.5 && p[1] < Y.chest + 0.5);
  coat(vox, 'spine', A, (p) => p[2] < -4 && p[1] > Y.spine + 0.5 && p[1] < Y.chest - 0.5);
  vox.recolour('spine', (i, j, k, c) => (c === A && j === Y.spine + 2 && k > 0 ? 'armourShade' : undefined));
  // The belt: two rows round, a box buckle in front, a drop box behind.
  coat(vox, 'hips', A, (p) => p[1] > Y.belt - 1.5 && p[1] < Y.spine, { axes: 'xz' });
  block(vox, 'hips', [-2, Y.belt - 2, 5], [1, Y.belt + 1, 5], A, 'armourShade');
  for (const m of [1, -1])
    for (let t = 0; t < 2; t++) {
      const i = m > 0 ? 3 + t * 2 : -4 - t * 2;
      vox.set('hips', i, Y.belt, frontOf(vox, 'hips', i, Y.belt) + 1, 'grille');
    }
  block(vox, 'hips', [-2, Y.belt - 3, -6], [1, Y.belt, -6], A, 'armourShade');
  // The pelvis: a plate in front and one behind below the belt, black at the sides.
  coat(vox, 'hips', A, (p) => p[1] < Y.belt - 1.5 && ((p[2] > 3 && Math.abs(p[0]) < 4) || p[2] < -4));
  // Arms: a bell over each shoulder, a plate on the upper arm, one round the forearm.
  for (const [side, m] of SIDES) {
    const out = (p) => (m > 0 ? p[0] > b.sh - 0.5 : p[0] < -b.sh + 0.5);
    coat(vox, `upperArm${side}`, A, (p) => out(p) && p[1] > Y.shoulder - 1.5);
    coat(vox, `upperArm${side}`, A, (p) => out(p) && p[1] > Y.elbow + 0.5 && p[1] < Y.shoulder - 2.5 && (m > 0 ? p[0] > L.ax - 1 : p[0] < -L.ax + 1), { axes: 'xz' });
    coat(vox, `lowerArm${side}`, A, (p) => p[1] > Y.wrist + 1.5 && p[1] < Y.elbow - 0.5, { axes: 'xz' });
  }
  // Legs: a plate round each thigh (black inside) and shin, black at the knee.
  for (const [side, m] of SIDES) {
    const inner = (p) => (m > 0 ? p[0] < L.lx0 + 0.5 : p[0] > -L.lx0 - 0.5);
    coat(vox, `upperLeg${side}`, A, (p) => !inner(p) && p[1] > Y.knee + 1.5 && p[1] < Y.pelvis + 0.5, { axes: 'xz' });
    coat(vox, `lowerLeg${side}`, A, (p) => p[1] > Y.ankle + 1.5 && p[1] < Y.knee - 0.5, { axes: 'xz' });
    if (heavy) coat(vox, `lowerLeg${side}`, A, (p) => p[2] > L.lz1 - 0.5 && p[1] > Y.knee - 0.5 && p[1] < Y.knee + 2.5, { axes: 'z' });
  }
  // The holster on the right thigh, its blaster's grip standing out of it.
  block(vox, 'upperLegR', [-L.lx1 - 2, Y.knee, -1], [-L.lx1 - 1, Y.pelvis - 1, 1], 'suit');
  block(vox, 'upperLegR', [-L.lx1 - 2, Y.pelvis, -1], [-L.lx1 - 1, Y.pelvis + 1, 0], 'grille');
}

/** The heavy: the trooper's armour, knee plates, big grey pauldrons, a power pack on the back, grey shock bands. */
function impHeavy(vox, s) {
  const { b, Y } = s;
  trooperArmour(vox, s, { heavy: true });
  // Pauldrons: rounded grey caps over the bells, a white rim.
  for (const [side, m] of SIDES) {
    const [x0, x1] = X(m, b.sh - 1, b.sh + b.arm + 2);
    const lo = [x0, Y.shoulder - 4, -b.arm / 2 - 1.5], hi = [x1, Y.chestTop + 2, b.arm / 2 + 1.5];
    fill(vox, `upperArm${side}`, lo, hi, (i, j) => (j < Y.shoulder - 2 ? 'armour' : 'shock'), (p) => inRound(p, [lo[0], lo[1] - 3, lo[2]], hi, [2.6, 2.6, 2.6]) && (m > 0 ? p[0] > b.sh - 0.5 + (p[1] < Y.chestTop - 0.5 ? 1 : 0) : p[0] < -b.sh + 0.5 - (p[1] < Y.chestTop - 0.5 ? 1 : 0)));
  }
  // Grey shock bands across the chest plate.
  vox.recolour('chest', (i, j, k, c) => (c === 'armour' && k > F && (j === Y.chest + 7 || j === Y.chest + 6) ? 'shock' : undefined));
  // The power pack: a dark box on the back, a white frame, cells glowing down its side.
  const top = Y.chestTop - 1, bot = Y.spine + 1;
  const back = backOf(vox, 'chest', 0, Y.chest + 4);
  block(vox, 'chest', [-5, Y.chest - 1, back - 4], [4, top, back - 1], 'shockDark', 'armour');
  block(vox, 'spine', [-4, bot, back - 3], [3, Y.chest - 1, back - 1], 'shockDark', 'armour');
  for (let j = Y.chest + 1; j < top - 1; j += 2) for (const i of [-3, 2]) vox.set('chest', i, j, back - 5, 'cellGlow');
  for (let i = -3; i < 3; i++) vox.set('chest', i, top - 1, back - 5, 'shock');
}

/** The scout: a black jumpsuit, a white chest plate and back plate, white knee and shin guards, a boot holster. */
function impScout(vox, s) {
  const { b, Y } = s;
  const L = limbs(b);
  const A = 'armour';
  vox.recolour('neck', () => 'suit');
  coat(vox, 'chest', A, (p) => p[2] > 1.5 && p[1] > Y.chest + 1.5 && p[1] < Y.chestTop - 0.5 && Math.abs(p[0]) < b.sh - 0.5 && !(Math.abs(p[0]) < 2.6 && p[1] > Y.chestTop - 2.5));
  coat(vox, 'chest', A, (p) => p[2] < -4 && p[1] > Y.chest + 2.5 && p[1] < Y.chestTop - 1.5 && Math.abs(p[0]) < b.sh - 1.5);
  // The chest box: dark, a few grey keys.
  block(vox, 'chest', [-4, Y.chest + 3, F + 2], [-1, Y.chest + 5, F + 2], 'grille');
  for (const i of [-4, -2]) vox.set('chest', i, Y.chest + 4, F + 3, 'armourShade');
  // The belt, black, pouches round it, a white box buckle.
  coat(vox, 'hips', 'belt', (p) => p[1] > Y.belt - 0.5 && p[1] < Y.spine, { axes: 'xz' });
  block(vox, 'hips', [-1, Y.belt - 1, 5], [0, Y.belt, 5], A);
  for (const [, m] of SIDES) for (const x of [2, 4]) block(vox, 'hips', [m > 0 ? x - 1 : -x, Y.belt - 2, 4], [m > 0 ? x : -x + 1, Y.belt, 5], 'pouch');
  // Knee and shin guards, white in front and round the sides.
  for (const [side] of SIDES) {
    coat(vox, `lowerLeg${side}`, A, (p) => p[2] > L.lz - 0.5 && p[1] > Y.ankle + 1.5 && p[1] < Y.knee + 1.5, { axes: 'xz' });
    coat(vox, `upperLeg${side}`, A, (p) => p[2] > L.lz1 - 0.5 && p[1] < Y.knee + 2.5, { axes: 'z' });
  }
  // The hold-out blaster in its holster on the right boot.
  block(vox, 'footR', [-L.lx1 - 2, 2, -2], [-L.lx1 - 2, Y.ankle + 2, 1], 'belt');
  block(vox, 'footR', [-L.lx1 - 2, Y.ankle + 3, -1], [-L.lx1 - 2, Y.ankle + 3, 0], 'grille');
}

/** The rebel trooper: fatigues, an olive vest with pouches over them, a belt, a holster, a small pack. */
function rebelTrooper(vox, s) {
  const { b, Y } = s;
  const L = limbs(b);
  // The shirt's collar open at the neck.
  for (const i of [-1, 0]) for (let j = Y.chestTop - 2; j < Y.chestTop; j++) vox.set('chest', i, j, F, 'skin');
  // The vest: front and back and round the sides, open in a V at the neck, over the shoulders.
  coat(vox, 'chest', 'vest', (p) => {
    const v = p[2] > 1 && Math.abs(p[0]) < 1 + (p[1] - Y.chest) * 0.42 && p[1] > Y.chest + 2;
    return !v && !(p[1] > Y.chestTop - 0.5 && Math.abs(p[0]) > b.sh - 3.5) && !(Math.abs(p[0]) < 3.5 && p[1] > Y.chestTop - 0.5);
  });
  coat(vox, 'spine', 'vest', (p) => p[1] > Y.spine - 0.5, { axes: 'xz' });
  // The vest's pouches: two rows either side of the front, a radio on the left chest.
  for (const [, m] of SIDES) {
    for (const [a, c] of [[1, 2], [3, 4]]) {
      const [i0, i1] = X(m, a, c);
      pouch(vox, 'spine', i0, i1, Y.spine, Y.spine + 2, 'pouch', 'pouchFlap');
    }
  }
  pouch(vox, 'chest', 3, 5, Y.chest + 2, Y.chest + 4, 'pouch', 'pouchFlap');
  // The belt and its buckle; the holster on the right thigh.
  belt(vox, s, 'belt', { buckle: 'brass' });
  block(vox, 'upperLegR', [-L.lx1 - 2, Y.knee + 1, -1], [-L.lx1 - 1, Y.pelvis - 1, 1], 'belt');
  block(vox, 'upperLegR', [-L.lx1 - 2, Y.pelvis, -1], [-L.lx1 - 1, Y.pelvis + 1, 0], 'grille');
  // A small pack on the back, a rolled blanket over it.
  const back = backOf(vox, 'chest', 0, Y.chest + 3);
  block(vox, 'chest', [-4, Y.chest - 1, back - 3], [3, Y.chest + 5, back - 1], 'pack', 'packDark');
  block(vox, 'spine', [-4, Y.spine + 1, back - 3], [3, Y.chest - 2, back - 1], 'pack', 'packDark');
  for (let i = -5; i < 5; i++) for (const [j, k] of [[Y.chest + 6, back - 2], [Y.chest + 6, back - 3], [Y.chest + 7, back - 2]]) vox.set('chest', i, j, k, 'roll');
  // Cuffs at the wrists.
  for (const [side] of SIDES) vox.recolour(`lowerArm${side}`, (i, j) => (j === Math.floor(Y.wrist) ? 'shirtShade' : undefined));
}

/** The rebel heavy: darker fatigues, sleeves rolled to the elbow, a bandolier, gloves, a heavy pack. */
function rebelHeavy(vox, s) {
  const { b, Y } = s;
  // Rolled sleeves: bare forearms, the rolled cuff over the elbow in a darker shade.
  for (const [side] of SIDES) {
    vox.recolour(`lowerArm${side}`, () => 'skin');
    vox.recolour(`upperArm${side}`, (i, j) => (j < Y.elbow + 2 ? 'shirtShade' : undefined));
  }
  for (const i of [-1, 0]) for (let j = Y.chestTop - 3; j < Y.chestTop; j++) vox.set('chest', i, j, F, 'skin');
  // The bandolier from the left shoulder to the right hip, its cells along it in front.
  const at = sash(vox, s, 'strap', { from: 1, w: 1.5 });
  for (let n = 1; n < 7; n++) {
    const [x, y] = at(n / 7.5).map(Math.floor);
    const part = y < Y.chest ? 'spine' : 'chest';
    const k = frontOf(vox, part, x, y);
    if (k !== null) for (const dy of [0, 1]) vox.set(part, x, y + dy, k + 1, dy ? 'cellCap' : 'cell');
  }
  // The belt, pouches on it; the pack.
  belt(vox, s, 'belt', { buckle: 'brass' });
  for (const [, m] of SIDES) {
    const [i0, i1] = X(m, 4, 6);
    block(vox, 'hips', [i0, Y.belt - 2, 4], [i1 - 1, Y.belt, 5], 'pouch');
  }
  const back = backOf(vox, 'chest', 0, Y.chest + 3);
  block(vox, 'chest', [-6, Y.chest - 1, back - 5], [5, Y.chestTop - 1, back - 1], 'pack', 'packDark');
  block(vox, 'spine', [-5, Y.spine, back - 4], [4, Y.chest - 2, back - 1], 'pack', 'packDark');
  // A power cell across the top of the pack.
  for (let i = -6; i < 6; i++) for (const [j, k] of [[Y.chestTop, back - 3], [Y.chestTop, back - 4], [Y.chestTop + 1, back - 3], [Y.chestTop + 1, back - 4]]) vox.set('chest', i, j, k, Math.abs(C(i)) > 5 ? 'cellCap' : 'grille');
}

/** The scout: an Endor-camouflage poncho over the shoulders to the hips, dark trousers, its hood up (the head's) or down (`o.hood`). */
function rebelScout(vox, s) {
  const { b, Y, o } = s;
  const cam = camo(['camoA', 'camoB', 'camoC', 'camoD'], 3);
  // The poncho: over the chest and shoulders, hanging loose a voxel off the belly and the hips.
  coat(vox, 'chest', cam, (p) => p[1] > Y.chest - 0.5);
  for (const [side, m] of SIDES) coat(vox, `upperArm${side}`, cam, (p) => p[1] > Y.shoulder - 3.5 && (m > 0 ? p[0] > b.sh - 0.5 : p[0] < -b.sh + 0.5));
  skirt(vox, s, cam, { top: Y.chest + 1, bottom: Y.pelvis - 2, flare: 1.5, w0: b.sh + 0.2, d0: 5.2, zFlare: 0.6 });
  // A strap across it from the right shoulder.
  sash(vox, s, 'strap', { from: -1, w: 0.9 });
  // Down, the hood's roll in its darker colours, apart from the poncho under it.
  if (o.hood === 'down') hoodDown(vox, s, camo(['camoC', 'camoB', 'camoC'], 5), 'camoA');
}

/** Luke Skyblocker: the black tunic, wrapped over to the left, a standing collar, a belt, one black glove. */
function luke(vox, s) {
  const { b, Y } = s;
  // The wrap: the tunic's right side over its left, a diagonal edge from the collar to the waist.
  const edge = (y) => -1 + ((Y.chestTop - y) / (Y.chestTop - Y.spine)) * (b.waist + 0.5);
  for (const part of ['chest', 'spine'])
    coat(vox, part, (i, j) => (Math.abs(C(i) - edge(C(j))) < 0.8 ? 'tunicEdge' : 'shirt'), (p) => p[2] > 1 && p[0] < edge(p[1]) && p[1] > Y.spine - 0.5, { axes: 'z' });
  // The collar: standing round the neck, two rows.
  for (const dy of [0, 1]) for (let i = -3; i < 3; i++) for (let k = -4; k < 2; k++) if (!(i >= -2 && i < 2 && k >= -3 && k < 1)) vox.set('chest', i, Y.chestTop + dy, k, 'shirt');
  // The belt, a square buckle; the tunic skirt below it to the thighs.
  skirt(vox, s, 'shirt', { top: Y.belt, bottom: Y.pelvis - 2, flare: 0.6, w0: b.hip + 0.4, d0: 4.4 });
  belt(vox, s, 'belt', { buckle: 'buckle', bw: 2, bh: 2 });
}

/** Ben Kenoblock: a cream tunic, its wraps crossed over, a sash; a brown robe over it, open in front, the hood down. */
function ben(vox, s) {
  const { b, Y } = s;
  // The tunic's crossed wraps: two lapels meeting low in a V, their edges darker.
  for (const part of ['chest', 'spine'])
    vox.recolour(part, (i, j, k, c) => {
      if (k < F) return;
      const x = C(i);
      const v = (C(j) - Y.spine) * 0.55 - 1;
      if (Math.abs(Math.abs(x) - v) < 0.7 && j > Y.spine + 1) return 'tunicShade';
      return undefined;
    });
  for (const i of [-1, 0]) for (let j = Y.chestTop - 3; j < Y.chestTop; j++) vox.set('chest', i, j, F, 'skin');
  // The robe: over the back, sides and shoulders, open in front; its hood down on the back.
  const robeOn = (p) => !(p[2] > 1 && Math.abs(p[0]) < b.sh - 2.5);
  coat(vox, 'chest', 'robe', robeOn);
  coat(vox, 'spine', 'robe', robeOn, { axes: 'xz' });
  // The sash in the opening, wide, a belt over it.
  coat(vox, 'spine', 'obi', (p) => p[1] < Y.spine + 2.5 && !robeOn(p), { axes: 'xz' });
  belt(vox, s, 'belt', { buckle: 'buckle', rows: 1 });
  // The robe's front edges, lighter; folds down its back.
  vox.recolour('chest', (i, j, k, c) => (c === 'robe' && k > 0 && Math.abs(C(i)) < b.sh - 1.4 ? 'robeEdge' : undefined));
  for (const part of ['chest', 'spine']) vox.recolour(part, (i, j, k, c) => (c === 'robe' && k < -4 && (i + 40) % 4 === 1 ? 'robeDark' : undefined));
  hoodDown(vox, s, 'robe', 'robeDark');
  // The robe's skirt: behind and at the sides, down past the knees; the tunic's in front to mid-thigh.
  skirt(vox, s, 'tunic', { top: Y.belt - 1, bottom: Y.pelvis - 3, flare: 0.8, w0: b.hip + 0.3, d0: 4.3 });
  skirt(vox, s, (i, j, k) => ((i + 40) % 4 === 1 && k < -2 ? 'robeDark' : 'robe'), { top: Y.spine + 2, bottom: Y.knee - 2, flare: 2.2, zFlare: 1.4, open: 3, gap: (t) => t * 1.5 });
  // Sleeves: wide, belling out at the wrist.
  for (const [side] of SIDES) {
    vox.recolour(`upperArm${side}`, () => 'robe');
    vox.recolour(`lowerArm${side}`, () => 'robe');
    coat(vox, `lowerArm${side}`, (i, j) => (j <= Math.floor(Y.wrist) + 1 ? 'robeDark' : 'robe'), (p) => p[1] < Y.elbow - 1.5, { axes: 'xz' });
    coat(vox, `lowerArm${side}`, 'robeDark', (p) => p[1] < Y.wrist + 1.5, { axes: 'xz' });
  }
}

/**
 * Darth Voxel: black armour glossy over a black suit: the shoulder armour, the chest box and its
 * lit keys, a belt with its boxes, gloves, tall boots, and the cape, standing off his back.
 */
function vader(vox, s) {
  const { b, Y } = s;
  vox.recolour('neck', () => 'suit');
  // The shoulder armour: a yoke over the shoulders, front and back.
  coat(vox, 'chest', 'plate', (p) => p[1] > Y.chestTop - 3.5);
  for (const [side, m] of SIDES) coat(vox, `upperArm${side}`, 'plate', (p) => p[1] > Y.shoulder - 1.5 && (m > 0 ? p[0] > b.sh - 0.5 : p[0] < -b.sh + 0.5));
  // The chest box: a grey panel, its keys lit in rows; two small boxes under it.
  const k = frontOf(vox, 'chest', 0, Y.chest + 4) + 1;
  block(vox, 'chest', [-3, Y.chest + 2, k], [2, Y.chest + 5, k], 'panel', 'panelDark');
  const keys = [['glowRed', 'glowWhite', 'glowGreen', 'glowRed'], ['glowBlue', 'glowGreen', 'glowRed', 'glowWhite']];
  keys.forEach((row, r) => row.forEach((c, n) => vox.set('chest', -2 + n, Y.chest + 4 - r, k + 1, c)));
  for (const [, m] of SIDES) block(vox, 'spine', [m > 0 ? 2 : -4, Y.chest - 2, frontOf(vox, 'spine', 0, Y.chest - 2) + 1], [m > 0 ? 3 : -3, Y.chest - 1, frontOf(vox, 'spine', 0, Y.chest - 2) + 1], 'silver');
  // The belt: wide, a big buckle of two silver plates, boxes either side.
  coat(vox, 'hips', 'plate', (p) => p[1] > Y.belt - 1.5 && p[1] < Y.spine, { axes: 'xz' });
  const bk = frontOf(vox, 'hips', 0, Y.belt) + 1;
  block(vox, 'hips', [-3, Y.belt - 2, bk], [2, Y.belt + 1, bk], 'silver', 'panelDark');
  for (const [, m] of SIDES) block(vox, 'hips', [m > 0 ? b.hip - 3 : -b.hip, Y.belt - 2, bk - 2], [m > 0 ? b.hip - 1 : -b.hip + 2, Y.belt, bk - 1], 'silver', 'panelDark');
  // Gloves (the fists), the forearms' gauntlet cuffs, tall boots.
  for (const [side] of SIDES) coat(vox, `lowerArm${side}`, 'glove', (p) => p[1] < Y.wrist + 2.5, { axes: 'xz' });
  for (const [side] of SIDES) coat(vox, `lowerLeg${side}`, 'shoes', (p) => p[1] < Y.knee + 0.5 && p[1] > Y.ankle + 1.5, { axes: 'xz' });
  // The cape: two voxels thick, from under the shoulder armour, falling behind and out to the
  // knees (a row further back every few), its edges folded forward.
  const top = Y.chestTop, bot = Y.knee + 1;
  for (let j = bot; j <= top; j++) {
    const t = (top - j) / (top - bot);
    const hw = b.sh + 1 + Math.round(t * 2);
    const zb = -6 - Math.round(t * 3);
    for (let i = -hw; i < hw; i++) {
      const edge = Math.min(C(i) + hw, hw - C(i));
      // Pleats: every fourth column a voxel further back, darker, from the shoulders down.
      const pleat = (i + 40) % 4 === 1 && edge > 2 && j < top - 2;
      const z0 = zb + (edge < 1 ? 2 : edge < 2 ? 1 : 0) - (pleat ? 1 : 0);
      for (const k of [z0, z0 + 1]) vox.set('chest', i, j, k, j === bot ? 'capeHem' : pleat ? 'capeFold' : 'cape');
    }
  }
}

/** Emperor Palpablock: a black robe to the ground, bell sleeves, a mantle and a clasp at the neck; the hood is the head's. */
function emperor(vox, s) {
  const { b, Y } = s;
  vox.recolour('neck', () => 'robe');
  coat(vox, 'chest', 'robe', () => true);
  coat(vox, 'spine', 'robe', () => true, { axes: 'xz' });
  // The robe's folds: darker lines down it.
  for (const part of ['chest', 'spine']) vox.recolour(part, (i, j, k, c) => (c === 'robe' && (i + 40) % 4 === 1 && k < 0 ? 'robeFold' : undefined));
  // A mantle over the shoulders, round the hood's fall.
  fill(vox, 'chest', [-b.sh - 1, Y.chestTop - 4, -7], [b.sh + 1, Y.chestTop + 1, 6], 'robe', (p) => inRound(p, [-b.sh - 1, Y.chestTop - 7, -7], [b.sh + 1, Y.chestTop + 1, 6], [2.4, 2, 2.6]) && !(Math.abs(p[0]) < 3.5 && p[2] > -4 && p[1] > Y.chestTop - 1));
  vox.set('chest', -1, Y.chestTop - 2, 7, 'clasp');
  vox.set('chest', 0, Y.chestTop - 2, 7, 'clasp');
  // The robe's skirt, to the ground, its hem darker.
  skirt(vox, s, (i, j, k) => (j === 2 ? 'robeFold' : (i + 40) % 4 === 1 && k < 0 ? 'robeFold' : 'robe'), { top: Y.spine, bottom: 2, flare: 3.2, zFlare: 2.6 });
  // A cord at the waist.
  coat(vox, 'hips', 'cord', (p) => p[1] > Y.belt - 0.5, { axes: 'xz' });
  // Bell sleeves.
  for (const [side] of SIDES) {
    vox.recolour(`upperArm${side}`, () => 'robe');
    vox.recolour(`lowerArm${side}`, () => 'robe');
    coat(vox, `upperArm${side}`, 'robe', () => true, { axes: 'xz' });
    coat(vox, `lowerArm${side}`, 'robe', (p) => p[1] < Y.elbow + 0.5, { axes: 'xz' });
    coat(vox, `lowerArm${side}`, 'robeFold', (p) => p[1] < Y.wrist + 2.5, { axes: 'xz' });
  }
}

/**
 * Chewblocca: fur all over, a voxel thick and shaggy, darker at the fists and feet; a leather
 * bandolier from the left shoulder to the right hip, its metal boxes along it. The fists keep
 * their size (they hold his bowcaster).
 */
function wookiee(vox, s) {
  const { Y } = s;
  const dark = (part) => (part.startsWith('hand') || part.startsWith('foot') ? 0.45 : part.startsWith('lower') ? 0.12 : 0);
  const furred = BONES.filter((part) => part !== 'head' && !part.startsWith('hand'));
  for (const part of BONES) if (part !== 'head') vox.recolour(part, (i, j, k, c) => (c === 'gloveCrease' ? 'furCrease' : furOf(dark(part))(i, j, k)));
  for (const part of furred) coat(vox, part, furOf(dark(part)), (p) => p[1] > 0);
  const at = sash(vox, s, 'bandolier', { from: 1, w: 1.7 });
  for (let n = 1; n < 8; n++) {
    const [x, y] = at(n / 8.5).map(Math.floor);
    const part = y < Y.chest ? 'spine' : 'chest';
    const k = frontOf(vox, part, x, y);
    if (k !== null) block(vox, part, [x - 1, y - 1, k + 1], [x, y, k + 1], 'bandBox', null), vox.set(part, x - 1, y, k + 1, 'bandBoxDark'), vox.set(part, x, y, k + 1, 'bandBoxDark');
  }
  for (const part of furred) shag(vox, part, furOf(dark(part)), part === 'chest' || part === 'spine' ? 0.1 : 0.08, (p) => !(part === 'chest' || part === 'spine') || at.dist(p[0], p[1]) > 2.4);
}

/**
 * Boba Fetch: a grey flight suit; green-grey armour over it (two plates on the chest, the gap
 * between them showing the suit, a gold collar and a gold box, a plate on the belly), a maroon
 * pauldron on the left shoulder, a ragged cape behind it, gauntlets, knee pads, a belt of
 * pouches, braids hanging at the right hip; and the jetpack: two tanks, their nozzles' rings lit,
 * a body between them, a missile on top.
 */
function bounty(vox, s) {
  const { b, Y } = s;
  const L = limbs(b);
  vox.recolour('neck', () => 'suitDark');
  coat(vox, 'chest', 'mando', (p) => p[2] > 1.5 && p[1] > Y.chest + 1.5 && p[1] < Y.chestTop - 0.5 && Math.abs(p[0]) > 0.9 && Math.abs(p[0]) < b.sh - 0.5);
  coat(vox, 'spine', 'mando', (p) => p[2] > 2 && p[1] > Y.spine + 0.5 && p[1] < Y.chest - 0.5 && Math.abs(p[0]) < 3.5);
  for (let i = -3; i < 3; i++) for (let k = -4; k < 2; k++) if (!(i >= -2 && i < 2 && k >= -3 && k < 1)) vox.set('chest', i, Y.chestTop, k, 'gold');
  const ck = frontOf(vox, 'chest', -4, Y.chest + 5);
  block(vox, 'chest', [-5, Y.chest + 4, ck + 1], [-4, Y.chest + 5, ck + 1], 'gold');
  // The pauldron: a rounded maroon cap on the left shoulder, a darker rim.
  const [x0, x1] = [b.sh - 1, b.sh + b.arm + 1];
  const lo = [x0, Y.shoulder - 3, -b.arm / 2 - 1.5], hi = [x1, Y.chestTop + 1.5, b.arm / 2 + 1.5];
  fill(vox, 'upperArmL', lo, hi, (i, j) => (j < Y.shoulder - 1 ? 'maroonDark' : 'maroon'), (p) => inRound(p, [lo[0], lo[1] - 3, lo[2]], hi, [2.2, 2.2, 2.2]) && p[0] > b.sh - 0.5 + (p[1] < Y.chestTop - 0.5 ? 1 : 0));
  // Gauntlets, two keys lit on the left one; gloves; knee pads.
  for (const [side] of SIDES) coat(vox, `lowerArm${side}`, 'mando', (p) => p[1] > Y.wrist + 0.5 && p[1] < Y.elbow - 0.5, { axes: 'xz' });
  const gx = Math.floor(L.ax) + 3;
  vox.set('lowerArmL', gx, Math.floor(Y.elbow) - 3, 0, 'gold');
  vox.set('lowerArmL', gx, Math.floor(Y.elbow) - 3, -1, 'gauntletRed');
  for (const [side] of SIDES) coat(vox, `lowerLeg${side}`, 'mando', (p) => p[2] > L.lz1 - 0.5 && p[1] > Y.knee - 1.5 && p[1] < Y.knee + 2.5, { axes: 'xz' });
  // The belt, pouches round it; braids hanging at the right hip.
  belt(vox, s, 'belt', { buckle: 'mandoDark', rows: 2, bh: 2 });
  for (const [, m] of SIDES) for (const x of [3, 5]) block(vox, 'hips', [m > 0 ? x - 1 : -x, Y.belt - 2, 4], [m > 0 ? x : -x + 1, Y.belt - 1, 5], 'pouch');
  for (const z of [-2, 0, 2]) for (let j = Y.knee + 1 + (z === 0 ? 0 : 1); j < Y.pelvis + 1; j++) vox.set('upperLegR', -L.lx1 - 1, j, z, (j + z) % 2 ? 'braid' : 'braidDark');
  // The jetpack: straps over the shoulders; a dark core on the back, a big tank either side of it
  // standing off the back, domed on top, a nozzle under each, its ring lit; the missile on top.
  const back = backOf(vox, 'chest', 0, Y.chest + 4);
  for (const [, m] of SIDES) for (let j = Y.chest + 1; j <= Y.chestTop; j++) for (let k = -4; k < 5; k++) {
    const i = m > 0 ? 3 : -4;
    const surf = (kk) => vox.filled(i, j, kk, 'chest') || vox.filled(i + m, j, kk, 'chest');
    if (!surf(k) && (surf(k - 1) || surf(k + 1) || vox.filled(i, j - 1, k, 'chest'))) vox.set('chest', i, j, k, 'jetDark'), vox.set('chest', i + m, j, k, 'jetDark');
  }
  block(vox, 'chest', [-2, Y.spine + 1, back - 4], [1, Y.chestTop - 1, back - 1], 'jetDark', 'nozzle');
  const cz = back - 4;
  for (const cx of [-3.8, 3.8]) {
    fill(vox, 'chest', [cx - 3, Y.spine + 1, cz - 3], [cx + 3, Y.chestTop + 3, cz + 3], (i, j) => (j === Y.chest || j === Y.chestTop - 1 ? 'jetDark' : 'jet'), (p) => (p[0] - cx) ** 2 + (p[2] - cz) ** 2 + Math.max(0, p[1] - (Y.chestTop + 0.5)) ** 2 * 1.4 <= 5.3);
    fill(vox, 'chest', [cx - 2, Y.spine - 2, cz - 2], [cx + 2, Y.spine + 1, cz + 2], (i, j) => (j === Y.spine - 2 ? 'jetGlow' : 'nozzle'), (p) => (p[0] - cx) ** 2 + (p[2] - cz) ** 2 <= (p[1] < Y.spine - 1 ? 3.2 : 2.2));
  }
  for (let j = Y.chestTop; j < Y.chestTop + 6; j++) for (const i of [-1, 0]) for (const k of [cz - 1, cz]) vox.set('chest', i, j, k, j > Y.chestTop + 3 ? 'missileTip' : 'missile');
  // The cape: a ragged strip over the left shoulder, hanging behind it to the waist.
  for (let j = Y.spine + 1; j <= Y.chestTop; j++)
    for (let i = b.sh - 3; i < b.sh + 2; i++) {
      if (j < Y.spine + 3 && hash(i, j, 0, 41) < 0.5) continue;
      vox.set('chest', i, j, back - 1, 'cape');
      if (j === Y.chestTop) for (let k = back; k < 1; k++) vox.set('chest', i, j, k, 'cape');
    }
}

// ---------------------------------------------------------------------------------------------
// The figures

const COMMON = { shoeStyle: 'boot', gloves: false };
const WHITE = 0xeeeeea;
const SUIT = 0x18181b;
/** Each Rebel class's kit, the same for all its people. */
const REBEL_TROOPER = { shirt: 0xb49c70, pants: 0xa38c62, shoes: 0x3b2a1e, vest: 0x5b6135, pouch: 0x4b5130, pouchFlap: 0x3e4327, helmet: 0x6b6f42, helmetDark: 0x5a5d36, helmetBand: 0x4a4c2d, strap: 0x3a2a1c, belt: 0x5a3a22, pack: 0x6a5a3a, packDark: 0x55472d, roll: 0x7c6a4c };
const REBEL_HEAVY = { shirt: 0x535a36, pants: 0x46412f, shoes: 0x1e1a16, glove: 0x4a3222, strap: 0x4a3020, cell: 0x9aa0a6, cellCap: 0xc9a44a, belt: 0x4a3020, pouch: 0x5a5236, pack: 0x6e5a3a, packDark: 0x57472d };
const REBEL_SCOUT = { shirt: 0x3f4a2e, sleeve: 0x3f4a2e, pants: 0x4d4430, shoes: 0x4a3322, strap: 0x3a2a1c };
const FIGURES = [
  // The Rebels: each class several people (skins, faces, hair, headgear), one kit and silhouette
  // a class. Their `role` is [team, class, variant]; variant 0 is the class's own.
  {
    id: 'rebel_trooper', name: 'Rebel Trooper', role: [0, 0, 0], build: 'broad', dress: rebelTrooper,
    head: (hv) => (skull(hv), face(hv, { stubble: true }), hair(hv, 'short'), rebelHelmet(hv)),
    colours: { ...REBEL_TROOPER, skin: 0xc68c63, hair: 0x3a2618 },
  },
  {
    id: 'rebel_trooper_b', name: 'Rebel Trooper', role: [0, 0, 1], build: 'broad', dress: rebelTrooper,
    head: (hv) => (skull(hv), face(hv, { tache: true }), hair(hv, 'cropped'), fieldCap(hv)),
    colours: { ...REBEL_TROOPER, skin: 0x6b4630, hair: 0x1a1512 },
  },
  {
    id: 'rebel_trooper_c', name: 'Rebel Trooper', role: [0, 0, 2], build: 'broadF', dress: rebelTrooper,
    head: (hv) => (skull(hv), face(hv, { lashes: true, lips: true, eye: 'eyeGreen' }), hair(hv, 'bun')),
    colours: { ...REBEL_TROOPER, skin: 0xf0c9a4, hair: 0x8a3a1e },
  },
  {
    id: 'rebel_trooper_d', name: 'Rebel Trooper', role: [0, 0, 3], build: 'broadF', dress: rebelTrooper,
    head: (hv) => (skull(hv), face(hv, { lashes: true, lips: true }), hair(hv, 'pony'), rebelHelmet(hv)),
    colours: { ...REBEL_TROOPER, skin: 0x5e3b27, hair: 0x1a1512 },
  },
  {
    id: 'rebel_heavy', name: 'Rebel Heavy', role: [0, 1, 0], build: 'heavy', dress: rebelHeavy, o: { gloves: true },
    head: (hv) => (skull(hv), face(hv), hair(hv, 'cropped'), beard(hv), beanie(hv)),
    colours: { ...REBEL_HEAVY, skin: 0xd09a74, hair: 0x2c1d14, beard: 0x3a2618, cap: 0x7a3b2a },
  },
  {
    id: 'rebel_heavy_b', name: 'Rebel Heavy', role: [0, 1, 1], build: 'heavy', dress: rebelHeavy, o: { gloves: true },
    head: (hv) => (skull(hv), face(hv, { goatee: true }), hair(hv, 'cropped'), beanie(hv)),
    colours: { ...REBEL_HEAVY, skin: 0x5e3b27, hair: 0x1a1512, cap: 0x46546a },
  },
  {
    id: 'rebel_heavy_c', name: 'Rebel Heavy', role: [0, 1, 2], build: 'heavyF', dress: rebelHeavy, o: { gloves: true },
    head: (hv) => (skull(hv), face(hv, { lashes: true, lips: true }), hair(hv, 'bob'), beanie(hv)),
    colours: { ...REBEL_HEAVY, skin: 0xb07650, hair: 0x2a1a12, cap: 0xb0862c },
  },
  {
    id: 'rebel_heavy_d', name: 'Rebel Heavy', role: [0, 1, 3], build: 'heavy', dress: rebelHeavy, o: { gloves: true },
    head: (hv) => (skull(hv), face(hv, { eye: 'eyeBlue' }), hair(hv, 'cropped'), beard(hv), beanie(hv)),
    colours: { ...REBEL_HEAVY, skin: 0xf0c9a4, hair: 0xa8501f, beard: 0xb5562a, cap: 0x3a3a3f },
  },
  {
    id: 'rebel_specialist', name: 'Rebel Specialist', role: [0, 2, 0], build: 'slim', dress: rebelScout,
    head: (hv) => (skull(hv), face(hv), hood(hv, camo(['camoA', 'camoB', 'camoC', 'camoD'], 5), { deep: 1, thick: 1.4, peak: 1 }), goggles(hv)),
    colours: { ...REBEL_SCOUT, skin: 0xe0b08a, hair: 0x5a3a20 },
  },
  {
    id: 'rebel_specialist_b', name: 'Rebel Specialist', role: [0, 2, 1], build: 'slimF', dress: rebelScout, o: { hood: 'down' },
    head: (hv) => (skull(hv), face(hv, { lashes: true, lips: true }), hair(hv, 'bun'), goggles(hv)),
    colours: { ...REBEL_SCOUT, skin: 0xa8704a, hair: 0x2a1a12 },
  },
  {
    id: 'rebel_specialist_c', name: 'Rebel Specialist', role: [0, 2, 2], build: 'slim', dress: rebelScout,
    head: (hv) => (skull(hv), face(hv), gaiter(hv), hood(hv, camo(['camoA', 'camoB', 'camoC', 'camoD'], 9), { deep: 1, thick: 1.4, peak: 1 })),
    colours: { ...REBEL_SCOUT, skin: 0x6b4630, hair: 0x1a1512 },
  },
  {
    id: 'rebel_specialist_d', name: 'Rebel Specialist', role: [0, 2, 3], build: 'slim', dress: rebelScout, o: { hood: 'down' },
    head: (hv) => (skull(hv), face(hv, { stubble: true, eye: 'eyeBlue' }), hair(hv, 'buzz'), goggles(hv, { worn: true })),
    colours: { ...REBEL_SCOUT, skin: 0xf0c9a4, hair: 0xc9a25c },
  },
  {
    id: 'imp_trooper', name: 'Stormtrooper', role: [1, 0], build: 'broad', dress: trooperArmour, o: { gloves: true },
    head: (hv) => stormHelmet(hv),
    colours: { shirt: SUIT, pants: SUIT, shoes: WHITE, sole: 0x3a3c40 },
  },
  {
    id: 'imp_heavy', name: 'Heavy Stormtrooper', role: [1, 1], build: 'heavy', dress: impHeavy, o: { gloves: true },
    head: (hv) => stormHelmet(hv, { mark: 'shock' }),
    colours: { shirt: SUIT, pants: SUIT, shoes: WHITE, sole: 0x3a3c40 },
  },
  {
    id: 'imp_specialist', name: 'Scout Trooper', role: [1, 2], build: 'slim', dress: impScout, o: { gloves: true },
    head: (hv) => scoutHelmet(hv),
    colours: { shirt: SUIT, pants: SUIT, shoes: 0x17171a, sole: 0x0c0c0e, belt: 0x111113 },
  },
  {
    id: 'luke', name: 'Luke Skyblocker', hero: true, build: 'slim', dress: luke, o: { gloves: 'R' },
    head: (hv) => (skull(hv), face(hv, { eye: 'eyeBlue' }), hair(hv, 'swept')),
    colours: { skin: 0xeab894, hair: 0xb58646, shirt: 0x26262d, sleeve: 0x26262d, pants: 0x1b1b20, shoes: 0x111113, glove: 0x121214, belt: 0x0b0b0d, tunicEdge: 0x3a3a44 },
  },
  {
    id: 'ben', name: 'Ben Kenoblock', hero: true, build: 'slim', dress: ben,
    head: (hv) => (skull(hv), face(hv, { wrinkles: true }), hair(hv, 'receding'), beard(hv)),
    colours: { skin: 0xdcae8e, hair: 0xd9d5cc, beard: 0xe4e0d8, beardDark: 0xbdb7ac, brow: 0xcfc9bd, shirt: 0xd9ccaa, tunic: 0xd9ccaa, tunicShade: 0xb9a985, sleeve: 0xd9ccaa, pants: 0xcdbf9b, shoes: 0x3a2a1c, obi: 0xb49a6c, belt: 0x4a3020, robe: 0x5c3d25, robeDark: 0x46301d, robeEdge: 0x6b4a2e },
  },
  {
    id: 'chewie', name: 'Chewblocca', hero: true, build: 'wookiee', dress: wookiee, o: { gloves: true, shoeStyle: 'boot' },
    head: (hv) => wookieeHead(hv),
    colours: {},
  },
  {
    id: 'vader', name: 'Darth Voxel', hero: true, build: 'lord', dress: vader, o: { gloves: true },
    head: (hv) => lordHelmet(hv),
    colours: { shirt: 0x121214, pants: 0x121214, shoes: 0x0e0e11, glove: 0x0e0e10 },
  },
  {
    id: 'emperor', name: 'Emperor Palpablock', hero: true, build: 'old', dress: emperor,
    head: (hv) => (skull(hv), face(hv, { wrinkles: true, eye: 'eyeGlow', eyeWhite: 'eyeGlowDim', ears: false }), oldFace(hv), hood(hv, 'robe', { deep: 3.4, thick: 1.8, peak: 1.5, open: 4.7 })),
    colours: { skin: 0xcfc0a6, hair: 0x8a8580, shirt: 0x131116, pants: 0x131116, shoes: 0x0e0d10 },
  },
  {
    id: 'boba', name: 'Boba Fetch', hero: true, build: 'broad', dress: bounty, o: { gloves: true },
    head: (hv) => bountyHelmet(hv),
    colours: { shirt: 0x6e6d64, pants: 0x6e6d64, shoes: 0x3a342c, glove: 0x4a3322, belt: 0x2e2a24, pouch: 0x4a4232, cape: 0x5a4b33 },
  },
];

/**
 * The Emperor's face: a long hooked nose, a downturned mouth, the eyes sunk in dark hollows; the
 * upper face in the hood's shadow.
 */
function oldFace(hv) {
  const set = (i, j, k, c) => hv.set('head', i, j, k, c);
  for (const i of [-1, 0]) {
    set(i, 5, FACE + 1, 'skin');
    set(i, 3, FACE + 2, 'skinShade');
    set(i, 4, FACE + 2, 'skin');
    set(i, 2, FACE + 1, 'skinShade');
  }
  for (const i of [-3, 2]) set(i, 0, FACE, 'mouth');
  for (const i of [-3, 2]) set(i, 1, FACE, 'skinCrease');
  for (const [a, j] of [[2, 4], [3, 4], [4, 5], [4, 6], [1, 6], [1, 5]]) for (const i of [a, -a - 1]) set(i, j, FACE, 'skinShadow2');
  const dark = { skin: 'skinShadow', skinShade: 'skinShadow2', skinCrease: 'skinShadow2', brow: 'skinShadow2' };
  hv.recolour('head', (i, j, k, c) => (j > 6 && dark[c] ? dark[c] : undefined));
}

/**
 * Goggles: a strap across, two lenses in brass rims; on the forehead (over a hood or hair), or
 * `worn` over the eyes, the strap round the head.
 */
function goggles(hv, { worn = false } = {}) {
  const r = worn ? 5 : 9;
  if (worn) hv.recolour('head', (i, j, k, c) => (j === r && k < 0 && (c === 'hair' || c === 'skin') ? 'strap' : undefined));
  for (let i = -7; i < 7; i++) {
    const k = faceK(hv, i, r);
    if (k !== null) hv.set('head', i, r, k + 1, 'strap');
  }
  for (const m of [1, -1])
    for (const [a, dj] of [[1, 0], [2, 0], [3, 0], [1, 1], [2, 1], [3, 1], [4, 0], [4, 1], [2, -1], [3, -1], [2, 2], [3, 2]]) {
      const j = r + dj;
      const i = m > 0 ? a : -a - 1;
      const k = faceK(hv, i, j);
      if (k === null) continue;
      const rim = !(a === 2 || a === 3) || dj === -1 || dj === 2;
      hv.set('head', i, j, k + (rim ? 1 : 0) + 1, rim ? 'brass' : 'lens');
    }
}

/** An sRGB colour scaled in brightness. */
const shade = (v, k) => {
  const c = [(v >> 16) & 255, (v >> 8) & 255, v & 255].map((x) => Math.max(0, Math.min(255, Math.round(x * k))));
  return (c[0] << 16) | (c[1] << 8) | c[2];
};

/** Every figure's colours: the defaults, the figure's own over them (the glowing ones last). */
function palette(d) {
  const P = new Palette();
  const c = d.colours;
  const skin = c.skin ?? 0xd8cbb6;
  const hairC = c.hair ?? 0x2c1d14;
  const cloth = { rough: 0.85, vary: 0.05 };
  const glowing = [];
  const add = (name, rgb, opts) => (opts?.glow ? glowing.push([name, c[name] ?? rgb, opts]) : P.add(name, c[name] ?? rgb, opts));
  add('skin', skin, { rough: 0.62, vary: 0.028 });
  add('skinShade', shade(skin, 0.8), { rough: 0.62, vary: 0.02 });
  add('skinCrease', shade(skin, 0.72), { rough: 0.62, vary: 0 });
  add('stubble', shade(skin, 0.78), { rough: 0.7, vary: 0.04 });
  add('hair', hairC, { rough: 0.6, vary: 0.09 });
  add('hairDark', shade(hairC, 0.78), { rough: 0.55, vary: 0.04 });
  add('beard', hairC, { rough: 0.7, vary: 0.07 });
  add('beardDark', shade(c.beard ?? hairC, 0.82), { rough: 0.7, vary: 0.03 });
  add('brow', shade(hairC, hairC > 0x906000 ? 0.7 : 0.9), { rough: 0.7, vary: 0.03 });
  add('eye', 0x1c120e, { rough: 0.15, vary: 0 });
  add('eyeBlue', 0x2c5a8c, { rough: 0.15, vary: 0 });
  add('eyeGreen', 0x3a6440, { rough: 0.15, vary: 0 });
  add('lash', 0x141010, { rough: 0.5, vary: 0 });
  add('lips', shade(skin, 0.72), { rough: 0.35, vary: 0 });
  add('hairTie', 0x2a2a2e, { rough: 0.6, vary: 0 });
  add('eyeGlow', 0xffd21a, { rough: 0.2, glow: 1, vary: 0 });
  add('eyeGlowDim', 0xff9a1a, { rough: 0.2, glow: 0.9, vary: 0 });
  add('white', 0xf2eee6, { rough: 0.3, vary: 0 });
  add('mouth', shade(skin, 0.58), { rough: 0.5, vary: 0 });
  add('shirt', 0x888888, cloth);
  add('shirtShade', shade(c.shirt ?? 0x888888, 0.84), { rough: 0.85, vary: 0.03 });
  P.add('sleeve', c.sleeve ?? c.shirt ?? 0x888888, cloth);
  add('pants', 0x555555, cloth);
  add('shoes', 0x1e1a16, { rough: 0.4, vary: 0.04 });
  add('sole', 0x14100c, { rough: 0.8, vary: 0.03 });
  add('glove', 0x151517, { rough: 0.62, vary: 0.03 });
  add('gloveCrease', shade(c.glove ?? 0x151517, 0.6), { rough: 0.62, vary: 0 });
  add('skinShadow', shade(skin, 0.6), { rough: 0.7, vary: 0.02 });
  add('skinShadow2', shade(skin, 0.45), { rough: 0.7, vary: 0 });
  add('belt', 0x2e1d14, { rough: 0.35, vary: 0.04 });
  add('buckle', 0xc4c8ce, { rough: 0.22, metal: 1, vary: 0 });
  add('brass', 0xc9a44a, { rough: 0.3, metal: 1, vary: 0.04 });
  add('strap', 0x3a2a1c, { rough: 0.55, vary: 0.04 });
  add('lens', 0x0b0d0f, { rough: 0.06, metal: 0.5, vary: 0 });
  add('lordLens', 0x2a2226, { rough: 0.04, metal: 0.85, vary: 0 });
  add('grille', 0x3c3f45, { rough: 0.4, metal: 0.3, vary: 0.03 });
  add('grilleDark', 0x1c1d20, { rough: 0.5, vary: 0 });
  // The Empire's armour: glossy white plastic over a black undersuit, blue-grey trim.
  add('suit', 0x18181b, { rough: 0.7, vary: 0.03 });
  add('armour', WHITE, { rough: 0.32, vary: 0.02 });
  add('armourShade', 0xb9bcc0, { rough: 0.35, vary: 0.02 });
  add('trim', 0x5d6f86, { rough: 0.4, vary: 0.02 });
  add('shock', 0x55585f, { rough: 0.35, vary: 0.03 });
  add('shockDark', 0x2c2e33, { rough: 0.4, vary: 0.03 });
  add('cellGlow', 0x5ec8ff, { rough: 0.2, glow: 0.9, vary: 0 });
  add('pouch', 0x151517, { rough: 0.6, vary: 0.03 });
  // Rebels' kit.
  add('vest', 0x5b6135, cloth);
  add('pouchFlap', 0x3e4327, cloth);
  add('helmet', 0x6b6f42, { rough: 0.55, vary: 0.03 });
  add('helmetDark', 0x5a5d36, { rough: 0.55, vary: 0.03 });
  add('helmetBand', 0x4a4c2d, { rough: 0.6, vary: 0.02 });
  add('pack', 0x6a5a3a, cloth);
  add('packDark', 0x55472d, cloth);
  add('roll', 0x7c6a4c, cloth);
  const cap = c.cap ?? 0x7a3b2a;
  add('cap', cap, { rough: 0.95, vary: 0.05 });
  add('capRib', shade(cap, 0.87), { rough: 0.95, vary: 0.04 });
  add('capCuff', shade(cap, 0.77), { rough: 0.95, vary: 0.04 });
  add('fieldCap', 0x857651, { rough: 0.9, vary: 0.04 });
  add('fieldCapDark', 0x6c603f, { rough: 0.9, vary: 0.03 });
  add('gaiter', 0x5a5e3a, { rough: 0.95, vary: 0.05 });
  add('gaiterDark', 0x4a4d2f, { rough: 0.95, vary: 0.03 });
  add('cell', 0x9aa0a6, { rough: 0.3, metal: 0.8, vary: 0.02 });
  add('cellCap', 0xc9a44a, { rough: 0.3, metal: 1, vary: 0 });
  add('camoA', 0x46552a, { rough: 0.9, vary: 0.04 });
  add('camoB', 0x5c4a2c, { rough: 0.9, vary: 0.04 });
  add('camoC', 0x2c3620, { rough: 0.9, vary: 0.04 });
  add('camoD', 0x66683a, { rough: 0.9, vary: 0.04 });
  // Jedi.
  add('tunic', 0xd9ccaa, cloth);
  add('tunicShade', 0xb9a985, cloth);
  add('tunicEdge', 0x2e2e36, cloth);
  add('obi', 0xb49a6c, cloth);
  add('robe', 0x131116, { rough: 0.8, vary: 0.04 });
  add('robeDark', shade(c.robe ?? 0x131116, 0.75), { rough: 0.8, vary: 0.03 });
  add('robeEdge', shade(c.robe ?? 0x131116, 1.2), { rough: 0.8, vary: 0.03 });
  add('robeFold', 0x0c0b0e, { rough: 0.8, vary: 0.02 });
  add('clasp', 0xb7bcc4, { rough: 0.25, metal: 1, vary: 0 });
  add('cord', 0x0e0d10, { rough: 0.7, vary: 0 });
  // Darth Voxel: glossy black armour and helmet, a silver grille, the chest box's lit keys.
  add('plate', 0x0f0f12, { rough: 0.18, metal: 0.4, vary: 0.02 });
  add('dome', 0x0d0d10, { rough: 0.14, metal: 0.5, vary: 0.02 });
  add('mask', 0x121215, { rough: 0.2, metal: 0.45, vary: 0.02 });
  add('helmetEdge', 0x1a1a1f, { rough: 0.2, metal: 0.5, vary: 0 });
  add('panel', 0x6d7178, { rough: 0.35, metal: 0.7, vary: 0.02 });
  add('panelDark', 0x3a3d42, { rough: 0.4, metal: 0.6, vary: 0 });
  add('silver', 0xb7bcc4, { rough: 0.25, metal: 1, vary: 0.02 });
  add('glowRed', 0xff3a30, { rough: 0.3, glow: 1, vary: 0 });
  add('glowGreen', 0x3aff6a, { rough: 0.3, glow: 1, vary: 0 });
  add('glowBlue', 0x3aa6ff, { rough: 0.3, glow: 1, vary: 0 });
  add('glowWhite', 0xf2f2f2, { rough: 0.3, glow: 0.7, vary: 0 });
  add('cape', 0x0b0b0d, { rough: 0.75, vary: 0.03 });
  add('capeHem', 0x070708, { rough: 0.75, vary: 0 });
  add('capeFold', 0x060607, { rough: 0.8, vary: 0 });
  // Chewblocca: fur in three shades, a darker crease, the nose glossy; the bandolier's leather and metal.
  add('fur', 0x5e3d23, { rough: 0.95, vary: 0.05 });
  add('furLight', 0x7c5733, { rough: 0.95, vary: 0.05 });
  add('furDark', 0x3e2816, { rough: 0.95, vary: 0.04 });
  add('furCrease', 0x2e1e12, { rough: 0.95, vary: 0 });
  add('nose', 0x141010, { rough: 0.25, vary: 0 });
  add('bandolier', 0x4a3020, { rough: 0.5, vary: 0.04 });
  add('bandBox', 0x8e949a, { rough: 0.3, metal: 0.8, vary: 0.02 });
  add('bandBoxDark', 0x5a5e62, { rough: 0.35, metal: 0.7, vary: 0 });
  // Boba Fetch: green-grey armour and helmet, yellowish cheeks, a black visor, the maroon pauldron,
  // the jetpack; the rangefinder's lens and the nozzles' rings lit.
  add('mando', 0x5f6b4a, { rough: 0.45, metal: 0.25, vary: 0.04 });
  add('mandoHelmet', 0x62704c, { rough: 0.4, metal: 0.25, vary: 0.04 });
  add('mandoDark', 0x3c4430, { rough: 0.45, metal: 0.25, vary: 0.02 });
  add('mandoCheek', 0x8e8b5c, { rough: 0.45, metal: 0.2, vary: 0.03 });
  add('dent', 0x353b2c, { rough: 0.6, vary: 0.02 });
  add('visor', 0x0a0b0c, { rough: 0.06, metal: 0.5, vary: 0 });
  add('suitDark', 0x3e3d38, { rough: 0.8, vary: 0.03 });
  add('maroon', 0x6e2622, { rough: 0.5, metal: 0.2, vary: 0.04 });
  add('maroonDark', 0x521a17, { rough: 0.5, metal: 0.2, vary: 0.02 });
  add('gauntletRed', 0xb02a22, { rough: 0.4, vary: 0 });
  add('gold', 0xc9a13a, { rough: 0.3, metal: 0.9, vary: 0.03 });
  add('braid', 0x5a4430, { rough: 0.9, vary: 0.04 });
  add('braidDark', 0x3a2a1c, { rough: 0.9, vary: 0.03 });
  add('jet', 0x6c7a82, { rough: 0.4, metal: 0.35, vary: 0.03 });
  add('jetDark', 0x3e4436, { rough: 0.45, metal: 0.3, vary: 0.02 });
  add('nozzle', 0x2a2a2c, { rough: 0.35, metal: 0.7, vary: 0 });
  add('missile', 0xc8c8c0, { rough: 0.4, metal: 0.3, vary: 0.02 });
  add('missileTip', 0xb52a22, { rough: 0.4, vary: 0 });
  add('jetGlow', 0xff8a2a, { rough: 0.3, glow: 1, vary: 0 });
  add('rangeGlow', 0xff3020, { rough: 0.3, glow: 0.9, vary: 0 });
  for (const [name, rgb, opts] of glowing) P.add(name, rgb, opts);
  return P;
}

function makeFigure(d) {
  const b = BUILDS[d.build];
  const Y = heights(b);
  const o = { ...COMMON, ...d.o };
  const s = { b, o, d, Y, J: joints(b, Y) };
  const vox = new Voxels();
  for (const j of BONES) vox.part(j);
  body(vox, s);
  d.dress(vox, s);
  return { vox, s, P: palette(d) };
}

/**
 * The atlas, its glowing tiles apart. Mip levels blend neighbouring tiles, and a face seen edge-on
 * samples a high one: a glow blended into a dark cape's edges shows as coloured seams. So the
 * faces that glow get an atlas of their own, in the bottom half of a square one, and the rest's
 * is repeated down the whole of its top half (and round the glowing one's in the bottom half), so
 * no level but the last (the whole atlas in a texel) mixes a glow into anything else, and the
 * rest's levels are what they'd be alone. The emissive map is in colour: each texel's own colour
 * times its glow (the toolkit's is a level, which the material's white emissive factor would
 * light white).
 */
function atlasOf(list, P) {
  const glows = (f) => P.get(f.colour).glow > 0;
  const lit = list.filter(glows);
  const A1 = atlas(lit.length ? list.filter((f) => !glows(f)) : list, P);
  const A2 = lit.length ? atlas(lit, P) : null;
  const width = A1.width, height = A2 ? width : A1.height, half = height / 2;
  const rowBytes = width * 4;
  const image = (key) => {
    const px = new Uint8Array(width * height * 4);
    for (let y = 0; y < height; y++) px.set(A1[key].px.subarray((y % A1.height) * rowBytes, (y % A1.height + 1) * rowBytes), y * rowBytes);
    if (A2) px.set(A2[key].px, half * rowBytes);
    return { w: width, h: height, px };
  };
  const albedo = image('albedo'), mr = image('mr');
  const glow = { w: width, h: height, px: new Uint8Array(width * height * 4) };
  for (let o = 0; o < glow.px.length; o += 4) {
    const level = A2 && o >= half * rowBytes && o < (half + A2.height) * rowBytes ? A2.glow.px[o - half * rowBytes] : 0;
    for (let ch = 0; ch < 3; ch++) glow.px[o + ch] = Math.round((albedo.px[o + ch] * level) / 255);
    glow.px[o + 3] = 255;
  }
  let n1 = 0, n2 = 0;
  const uvs = list.map((f) => (A2 && glows(f) ? A2.uvs[n2++].map(([u, v]) => [u, (v * A2.height + half) / height]) : A1.uvs[n1++].map(([u, v]) => [u, (v * A1.height) / height])));
  return { width, height, tiles: A1.tiles + (A2?.tiles ?? 0), albedo, mr, glow, uvs };
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
  const { vox, s, P } = makeFigure(d);
  const { faces: list, hidden, duplicates, before } = faces(vox, P, { vary: argv.includes('--vary'), merge: !argv.includes('--no-merge') });
  const A = atlasOf(list, P);
  // Joints in metres; each node's translation from its parent's, rounded as written.
  const J = Object.fromEntries(Object.entries(s.J).map(([k, v]) => [k, v.map((x) => x * DU)]));
  const nodes = [{ name: d.id, children: [], extras: { title: d.name, wear: wearOf(vox, s.b, s.Y, headAt(s.b, s.Y)[2]) } }];
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
    generator: 'Blockfront II src/games/blockfront/tools/troopers/build.mjs',
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
    material: { name: d.id, albedo: png(A.albedo), mr: png(A.mr), glow: png(A.glow) },
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
  if (json.nodes[root].name !== d.id) fail('root not named after the figure');
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
  if (lo !== 0 || height < MIN_HEIGHT || height > MAX_HEIGHT) fail(`height ${lo / SCALE}..${hi / SCALE}`);
  return { tris, count, height };
}

// ---------------------------------------------------------------------------------------------

const only = argv.filter((a) => !a.startsWith('--'));
mkdirSync(OUT, { recursive: true });
for (const d of FIGURES) {
  if (only.length && !only.includes(d.id)) continue;
  const { bytes, stats, at } = glb(d);
  const file = join(OUT, `${d.id}.glb`);
  writeFileSync(file, bytes);
  const v = validate(readFileSync(file), d, at);
  console.log(`${d.id}.glb  ${d.name} (${d.build}): ${stats.voxels} voxels, ${stats.faces} faces as ${stats.quads} quads, ${v.tris} tris (${stats.hidden} faces hidden at rest${stats.duplicates ? `, ${stats.duplicates} duplicate faces dropped` : ''}), ${stats.tiles} tiles in ${stats.atlas}, ${(bytes.length / 1024).toFixed(1)} KB, ${v.height.toFixed(2)} m tall`);
}
if (!only.length && OUT === join(HERE, '../../models/troopers')) {
  const troopers = (team) => FIGURES.filter((d) => d.role?.[0] === team && !d.role[2]).sort((a, b) => a.role[1] - b.role[1]);
  const variants = (team, cls) => FIGURES.filter((d) => d.role?.[0] === team && d.role[1] === cls).sort((a, b) => (a.role[2] ?? 0) - (b.role[2] ?? 0));
  const heroes = FIGURES.filter((d) => d.hero);
  const lines = [
    ...FIGURES.map((d) => `import ${d.id} from './${d.id}.glb?url';`),
    '',
    '/**',
    ' * The troopers\' and heroes\' models (GLB on the platform\'s humanoid rig, docs/HUMANOID.md), written by',
    ' * `src/games/blockfront/tools/troopers/build.mjs` (see its header).',
    ' */',
    'export interface TrooperModel {',
    '  id: string;',
    '  name: string;',
    '  url: string;',
    '}',
    '',
    '/** For each side, one per class (`ClassInfo.model`: trooper, heavy, specialist): its first variant. */',
    'export const TROOPERS: [TrooperModel[], TrooperModel[]] = [',
    ...[0, 1].flatMap((team) => ['  [', ...troopers(team).map((d) => `    { id: '${d.id}', name: '${d.name}', url: ${d.id} },`), '  ],']),
    '];',
    '',
    '/**',
    ' * Every variant of each side\'s classes (`[team][class]`, the first `TROOPERS`\'): the Rebels are',
    ' * several people a class (faces, skins, hair, headgear; one kit and silhouette a class), the',
    ' * Empire\'s troopers one each.',
    ' */',
    'export const TROOPER_VARIANTS: [TrooperModel[][], TrooperModel[][]] = [',
    ...[0, 1].flatMap((team) => ['  [', ...troopers(team).flatMap((t) => ['    [', ...variants(team, t.role[1]).map((d) => `      { id: '${d.id}', name: '${d.name}', url: ${d.id} },`), '    ],']), '  ],']),
    '];',
    '',
    '/** The heroes\' models, by hero id. */',
    `export const HERO_MODELS: Record<${heroes.map((d) => `'${d.id}'`).join(' | ')}, string> = {`,
    ...heroes.map((d) => `  ${d.id},`),
    '};',
    '',
  ];
  writeFileSync(join(OUT, 'index.ts'), lines.join('\n'));
}
