#!/usr/bin/env node
/**
 * Call of Blocky: the killstreaks' models (the Hellstorm missile, the attack chopper and its main
 * rotor), built as micro-voxel models like the weapons (`../voxel.mjs`) and written as binary glTF
 * 2.0 (`.glb`) to `src/games/callofblocky/models/`. Dependency-free (Node 22+):
 * `node src/games/callofblocky/tools/streaks/build.mjs [ids...]`.
 *
 * Conventions (the game's code relies on these; `streaks/flight.ts` poses them):
 *
 * - Units: 1 glTF unit = 1 block. Each model has its own voxel size (`V`, blocks).
 * - Orientation: the nose points along -z (as a vehicle's `pose` turns it: yaw about +y, pitch
 *   about +x), +y is up, the right side is +x.
 * - Cells are authored by their centres, in voxels, on a grid centred on the origin: cell (i, j, k)
 *   spans (i, j, k) +- 0.5 voxel, so a shape symmetric about x = 0 has a centre column.
 * - The missile (V 1/20): about 1.8 blocks long, its origin the middle of the body; `exhaust`
 *   marks the nozzle.
 * - The chopper (V 1/8): about 9 blocks from the nose to the tail fin, its origin the middle of
 *   the cabin; `rotor` marks the top of the mast (where the rotor's hub goes), `gun` the chin
 *   gun's muzzle, `tail` the tail rotor's hub.
 * - The rotor (V 1/8): four blades 5.5 blocks long round the hub at the origin, in the xz plane
 *   (the game spins it about +y).
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Palette, Voxels, faces, atlas, quadCorners, png, writeGlb, DIRS } from '../voxel.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, '../../models');
const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

class Model {
  constructor(id, name, V) {
    this.id = id;
    this.name = name;
    this.V = V;
    this.vox = new Voxels();
    this.P = new Palette();
    this.markers = {};
  }
  /** Colours: name -> [hex, rough, metal, glow]. */
  colours(list) {
    for (const [name, [rgb, rough = 0.8, metal = 0, glow = 0]] of Object.entries(list)) this.P.add(name, rgb, { rough, metal, glow, vary: 0 });
    return this;
  }
  /** Every cell in [lo, hi] (inclusive, by centre) whose centre `inside(i, j, k)` holds: `c` or `c(i, j, k)` (false clears). */
  shape(lo, hi, inside, c) {
    const f = typeof c === 'function' ? c : () => c;
    for (let k = lo[2]; k <= hi[2]; k++)
      for (let j = lo[1]; j <= hi[1]; j++)
        for (let i = lo[0]; i <= hi[0]; i++) {
          if (!inside(i, j, k)) continue;
          const col = f(i, j, k);
          if (col === false) this.vox.del('body', i, j, k);
          else if (col) this.vox.set('body', i, j, k, col);
        }
    return this;
  }
  /** A box of cells, [lo, hi] inclusive. */
  box(lo, hi, c) {
    return this.shape(lo, hi, () => true, c);
  }
  /** Recolour filled cells that `pick(i, j, k, c)` names a colour for. */
  paint(pick) {
    this.vox.recolour('body', pick);
    return this;
  }
  has(i, j, k) {
    return this.vox.filled(i, j, k);
  }
  /** A marker at a point in voxels (from the origin). */
  mark(name, p) {
    this.markers[name] = p.map((v) => Math.round(v * this.V * 1e5) / 1e5);
    return this;
  }
}

// ---------------------------------------------------------------------------------------------
// The Hellstorm: a guided missile, cream with red bands, a dark seeker in its nose, fins at the
// tail and canards up front, and a nozzle that glows.

function hellstorm() {
  const m = new Model('hellstorm', 'Hellstorm Missile', 1 / 20).colours({
    cream: [0xe9e2cf, 0.45, 0.1],
    red: [0xe63946, 0.45],
    seeker: [0x16181c, 0.08, 0.6],
    steel: [0x7d838b, 0.35, 0.9],
    ink: [0x1c1d21, 0.5, 0.2],
    burn: [0xffa040, 0.9, 0, 1],
  });
  // The body's radius along it (voxels): an ogive nose, a straight body, the tail narrowing a little.
  const r = (k) => (k < -10 ? 3.05 * Math.sqrt(clamp((k + 18.6) / 8.6, 0, 1)) : k > 13 ? 3.05 - (k - 13) * 0.25 : 3.05);
  m.shape([-4, -4, -18], [4, 4, 17], (i, j, k) => Math.hypot(i, j) <= r(k) + 0.1, (i, j, k) => (k <= -15 ? 'seeker' : k === -9 || k === -8 || k === 6 ? 'red' : k >= 16 ? 'ink' : 'cream'));
  // The nozzle: a steel ring round a glowing core.
  m.shape([-2, -2, 18], [2, 2, 18], (i, j) => Math.hypot(i, j) <= 2.1, (i, j) => (Math.hypot(i, j) <= 1.1 ? 'burn' : 'steel'));
  // Tail fins in a cross, swept back; small canards ahead.
  for (let k = 8; k <= 16; k++) {
    const reach = 3 + Math.min(4, (k - 8) * 0.8);
    for (let d = 3; d <= reach; d++) {
      for (const [i, j] of [[0, d], [0, -d], [d, 0], [-d, 0]]) m.box([i, j, k], [i, j, k], d > reach - 1 ? 'red' : 'steel');
    }
  }
  for (let k = -6; k <= -3; k++) {
    const reach = 3 + (k + 6) * 0.6;
    for (let d = 3; d <= reach; d++) for (const [i, j] of [[0, d], [0, -d], [d, 0], [-d, 0]]) m.box([i, j, k], [i, j, k], 'steel');
  }
  return m.mark('exhaust', [0, 0, 18.6]);
}

// ---------------------------------------------------------------------------------------------
// The attack chopper: a tandem gunship in black with a gold stripe down its side, a shark's mouth
// on its nose, a teal canopy, stub wings with rocket pods, a chin gun and skids; nav lights red
// on the left, green on the right, a white strobe on the tail.

function chopper() {
  const m = new Model('chopper', 'Attack Chopper', 1 / 8).colours({
    ink: [0x1b1c20, 0.5, 0.25],
    hull: [0x2a2d33, 0.55, 0.25],
    belly: [0x3a3e45, 0.6, 0.2],
    gold: [0xffcc00, 0.4, 0.3],
    red: [0xe63946, 0.5],
    teeth: [0xf4f0e4, 0.5],
    glass: [0x1d6a73, 0.06, 0.5],
    frame: [0x111214, 0.4, 0.5],
    steel: [0x80868e, 0.35, 0.9],
    navRed: [0xff3040, 0.4, 0, 1],
    navGreen: [0x40ff80, 0.4, 0, 1],
    strobe: [0xffffff, 0.3, 0, 1],
    intake: [0x0c0d0f, 0.8],
  });
  // The fuselage, section by section along z: half-width, half-height and the centre's height.
  const section = (k) => {
    if (k < -34 || k > 10) return null;
    if (k < -26) {
      const t = (k + 34.5) / 8.5;
      return { w: 1.6 + 3.4 * Math.sqrt(t), h: 2.4 + 4.1 * Math.sqrt(t), y: -1.2 + 1.2 * t };
    }
    if (k <= 3) return { w: 5, h: 6.5, y: 0 };
    const t = (k - 3) / 7;
    return { w: 5 - 3 * t, h: 6.5 - 4 * t, y: 2.5 * t };
  };
  m.shape([-6, -8, -34], [6, 8, 10], (i, j, k) => {
    const s = section(k);
    if (!s) return false;
    // A rounded box: an superellipse across.
    const u = Math.abs(i) / (s.w + 0.35);
    const v = Math.abs(j - s.y) / (s.h + 0.35);
    return u ** 3 + v ** 3 <= 1;
  }, (i, j, k) => (j < section(k).y - 3.5 ? 'belly' : 'hull'));
  // The tail boom, rising a little toward the fin.
  const boomY = (k) => 2.6 + (k - 10) * 0.035;
  m.shape([-3, 0, 10], [3, 6, 36], (i, j, k) => Math.abs(i) / 2.2 + 0 <= 1 && Math.abs(j - boomY(k)) <= 1.8 - (k - 10) * 0.02, 'hull');
  // The fin, swept back, with the strobe on top; the stabilisers across the boom.
  m.shape([0, 3, 30], [0, 13, 38], (i, j, k) => k >= 31 + (j - 4) * 0.55 && k <= 36 + (j - 4) * 0.25 && j >= 4, (i, j) => (j >= 12 ? 'strobe' : 'ink'));
  m.box([-6, 3, 29], [6, 3, 31], 'ink');
  m.box([-6, 3, 29], [-6, 3, 31], 'gold');
  m.box([6, 3, 29], [6, 3, 31], 'gold');
  // The tail rotor on the right of the fin: a cross of blades round its hub.
  const tail = [2, 8, 34];
  m.box([1, 7, 33], [1, 9, 35], 'steel');
  for (let d = -4; d <= 4; d++) {
    m.box([2, tail[1] + d, tail[2]], [2, tail[1] + d, tail[2]], Math.abs(d) >= 4 ? 'gold' : 'ink');
    m.box([2, tail[1], tail[2] + d], [2, tail[1], tail[2] + d], Math.abs(d) >= 4 ? 'gold' : 'ink');
  }
  // The canopy: two bubbles in tandem (gunner ahead and low, pilot behind and high), framed.
  const bubble = (cz, cy, rz, ry, rx) => (i, j, k) => (i / rx) ** 2 + ((j - cy) / ry) ** 2 + ((k - cz) / rz) ** 2 <= 1;
  const front = bubble(-21, 4.2, 6.5, 3.6, 4.3);
  const back = bubble(-11, 6.2, 6.5, 3.8, 4.3);
  m.shape([-5, 3, -28], [5, 11, -4], (i, j, k) => j >= 4 && (front(i, j, k) || back(i, j, k)), (i, j, k) => (k === -16 || k === -15 || Math.abs(i) === 4 && j <= 5 ? 'frame' : 'glass'));
  // The engines behind the canopy, their intakes on each side; the mast on top.
  m.shape([-4, 4, -6], [4, 8, 6], (i, j, k) => Math.abs(i) <= 4 && j <= 7 + (k < 4 ? 0 : -1), 'hull');
  for (const s of [-1, 1]) m.shape([s * 5, 5, -5], [s * 5, 7, -3], () => true, 'intake');
  m.box([-1, 8, -3], [1, 10, -1], 'steel');
  m.box([0, 11, -2], [0, 11, -2], 'steel');
  // The gold stripe down each side, from the nose to the fin.
  m.paint((i, j, k, c) => {
    if (c !== 'hull') return undefined;
    const s = k <= 10 ? section(k) : null;
    const mid = s ? s.y - 1 : boomY(k);
    return Math.abs(i) >= (s ? s.w - 1 : 1.5) && Math.abs(j - mid) < 0.6 ? 'gold' : undefined;
  });
  // The shark's mouth on the nose: a red grin with a row of teeth on each side.
  m.paint((i, j, k, c) => {
    if (k > -26 || k < -33 || Math.abs(i) < 2 || (c !== 'hull' && c !== 'belly' && c !== 'gold')) return undefined;
    const grin = -3.2 + (k + 33) * 0.12;
    if (j < grin - 1.5 || j > grin + 1.2) return undefined;
    if (j > grin + 0.2) return (k & 1) === 0 ? 'teeth' : 'red';
    return j > grin - 0.8 ? 'red' : (k & 1) === 1 ? 'teeth' : 'red';
  });
  // The stub wings, rocket pods under their ends, the nav lights at their tips.
  for (const s of [-1, 1]) {
    m.shape([s > 0 ? 5 : -13, -1, -6], [s > 0 ? 13 : -5, 0, 0], (i, j, k) => k >= -6 + (Math.abs(i) - 5) * 0.25, 'ink');
    m.box([s * 13, -1, -3], [s * 13, 0, -1], s < 0 ? 'navRed' : 'navGreen');
    const px = s * 10;
    m.shape([px - 2, -5, -10], [px + 2, -1, 2], (i, j, k) => Math.hypot(i - px, j + 3) <= 1.9, (i, j, k) => (k === -10 ? ((i + j) & 1 ? 'red' : 'ink') : k === -9 ? 'gold' : 'hull'));
    m.box([px, -1, -5], [px, -1, -3], 'steel');
  }
  // The chin turret and its gun.
  m.shape([-2, -9, -27], [2, -5, -22], (i, j, k) => Math.hypot(i, j + 7, (k + 24.5) * 0.8) <= 2.3, 'ink');
  m.box([0, -8, -33], [0, -8, -27], 'steel');
  m.box([-1, -8, -29], [1, -8, -28], 'steel');
  // The skids, on struts.
  for (const s of [-1, 1]) {
    m.box([s * 5, -11, -22], [s * 5, -11, 5], 'ink');
    m.box([s * 5, -10, -23], [s * 5, -10, -23], 'ink');
    for (const k of [-15, -1]) m.box([s * 5, -10, k], [s * 5, -7, k], 'steel');
  }
  return m.mark('rotor', [0, 11.5, -2]).mark('gun', [0, -8, -33.6]).mark('tail', [2.6, 8, 34]);
}

/** The main rotor: four long black blades with gold tips round a hub, flat in the xz plane. */
function rotor() {
  const m = new Model('rotor', 'Rotor', 1 / 8).colours({
    ink: [0x1b1c20, 0.45, 0.3],
    gold: [0xffcc00, 0.4, 0.3],
    steel: [0x80868e, 0.35, 0.9],
  });
  for (let d = 2; d <= 44; d++) {
    const c = d >= 41 ? 'gold' : 'ink';
    m.box([d, 0, -1], [d, 0, 1], c);
    m.box([-d, 0, -1], [-d, 0, 1], c);
    m.box([-1, 0, d], [1, 0, d], c);
    m.box([-1, 0, -d], [1, 0, -d], c);
  }
  m.shape([-2, 0, -2], [2, 1, 2], (i, j, k) => Math.hypot(i, k) <= 2.2 - j * 0.8, 'steel');
  return m;
}

// ---------------------------------------------------------------------------------------------
// Writing

function glb(m) {
  const { faces: list, before } = faces(m.vox, m.P, { merge: true });
  const A = atlas(list, m.P);
  const pos = [], nor = [], uv = [], idx = [];
  list.forEach((f, fi) => {
    const base = pos.length / 3;
    const n = DIRS[f.dir].n;
    quadCorners(f).forEach((c, ci) => {
      pos.push(...c.map((v) => (v - 0.5) * m.V));
      nor.push(...n);
      uv.push(Math.round(A.uvs[fi][ci][0] * 65535), Math.round(A.uvs[fi][ci][1] * 65535));
    });
    idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
  });
  const markerNames = Object.keys(m.markers);
  const nodes = [
    { name: m.id, children: [1, ...markerNames.map((_, k) => k + 2)], extras: { title: m.name } },
    { name: `${m.id}_body` },
    ...markerNames.map((k) => ({ name: k, translation: m.markers[k] })),
  ];
  const glows = [...m.P.colours.values()].some((c) => c.glow > 0);
  const bytes = writeGlb({
    generator: 'Call of Blocky src/games/callofblocky/tools/streaks/build.mjs',
    nodes,
    sceneName: m.id,
    meshName: `${m.id}_body`,
    meshNode: 1,
    attributes: {
      POSITION: { values: pos, componentType: 5126, type: 'VEC3', minmax: true },
      NORMAL: { values: nor, componentType: 5126, type: 'VEC3' },
      TEXCOORD_0: { values: uv, componentType: 5123, type: 'VEC2', normalized: true },
    },
    indices: idx,
    material: { name: `${m.id}_atlas`, albedo: png(A.albedo), mr: png(A.mr), glow: glows ? png(A.glow, { grey: true }) : null },
    // Props, drawn as they are (the platform's loader decodes EXT_meshopt_compression).
    compress: true,
  });
  return { bytes, stats: { voxels: m.vox.count, faces: before, quads: list.length, tiles: A.tiles, atlas: `${A.width}x${A.height}` }, pos };
}

const MODELS = { hellstorm, chopper, rotor };
const only = process.argv.slice(2).filter((a) => !a.startsWith('--'));
mkdirSync(OUT, { recursive: true });
for (const [id, make] of Object.entries(MODELS)) {
  if (only.length && !only.includes(id)) continue;
  const m = make();
  const { bytes, stats, pos } = glb(m);
  writeFileSync(join(OUT, `${m.id}.glb`), bytes);
  const lo = [0, 1, 2].map((k) => Math.min(...pos.filter((_, n) => n % 3 === k)));
  const hi = [0, 1, 2].map((k) => Math.max(...pos.filter((_, n) => n % 3 === k)));
  const size = hi.map((x, k) => +(x - lo[k]).toFixed(2));
  console.log(`${m.id}.glb  ${m.name}: ${stats.voxels} voxels, ${stats.faces} faces as ${stats.quads} quads, ${stats.tiles} tiles in ${stats.atlas}, ${(bytes.length / 1024).toFixed(1)} KB`);
  console.log(`  size (blocks) x ${size[0]}  y ${size[1]}  z ${size[2]}   markers ${Object.entries(m.markers).map(([k, p]) => `${k} (${p.join(', ')})`).join('  ')}`);
}
