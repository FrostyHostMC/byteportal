#!/usr/bin/env node
/**
 * High Noon: its models and one block texture, written dependency-free (Node 22+):
 * `node src/games/highnoon/tools/build.mjs`.
 *
 * - `models/revolver.glb`, `models/rifle.glb`: the Peacemaker and the lever-action, low-poly
 *   boxes and prisms. Conventions as Call of Blocky's guns (its `tools/guns/build.mjs`): 1 unit =
 *   1 block, authored in pixels (/16); the barrel along +z, +y up, the gun's left (+x) is the side
 *   we see; the origin is the firing fist on the grip. Marker nodes (empties, children of the root):
 *   `grip`, `grip2` (the rifle only: a revolver is held in one hand, so its figure's left hand
 *   stays free), `muzzle`, `sight` (the eye point over the iron sights) and `mag` (the loading gate).
 * - `models/cowboys/*.glb`: six figures on the platform's humanoid rig (docs/HUMANOID.md): rigid
 *   boxes on each joint, hats, bandanas, vests; the fists with `gripR` / `gripL`. Each has three
 *   clips, made in the rig's own terms: `tip_hat` (the right hand to the brim), `victory` (the gun
 *   thrown up to the sky, the left fist on the hip) and `standoff` (the hand hovering over the
 *   holster, fingers ready).
 * - `blocks/wanted_poster.png`: a 16 x 16 block face (a game block's PNG texture).
 *
 * Every model uses one material: a palette texture (a 32 x 32 PNG of 4 x 4 cells, one colour each,
 * sampled NEAREST) and its metallic-roughness twin (G roughness, B metalness), each part's UVs at
 * its colour's cell. (A held model uses only its first material, so everything goes in one.)
 */
import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const MODELS = join(HERE, '../models');
const BLOCKS = join(HERE, '../blocks');

// ---------------------------------------------------------------------------------------------
// PNG
// ---------------------------------------------------------------------------------------------

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
/** An RGBA image (row 0 at the top) as a PNG file. */
function png(w, h, rgba) {
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 4 + 1)] = 0;
    for (let i = 0; i < w * 4; i++) raw[y * (w * 4 + 1) + 1 + i] = rgba[y * w * 4 + i];
  }
  const chunk = (type, data) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(td));
    return Buffer.concat([len, td, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
const hex = (s) => [parseInt(s.slice(1, 3), 16), parseInt(s.slice(3, 5), 16), parseInt(s.slice(5, 7), 16)];

// ---------------------------------------------------------------------------------------------
// The palette: every colour a model uses, a cell each
// ---------------------------------------------------------------------------------------------

class Palette {
  /** @param {Record<string, { c: string, r?: number, m?: number }>} entries */
  constructor(entries) {
    this.names = Object.keys(entries);
    this.entries = entries;
    if (this.names.length > 64) throw new Error('palette: at most 64 colours');
  }
  /** The UV of a colour's cell's middle. */
  uv(name) {
    const i = this.names.indexOf(name);
    if (i < 0) throw new Error(`palette: no colour '${name}'`);
    const cx = i % 8;
    const cy = Math.floor(i / 8);
    return [(cx * 4 + 2) / 32, (cy * 4 + 2) / 32];
  }
  /** The albedo and metallic-roughness textures. */
  images() {
    const a = new Uint8Array(32 * 32 * 4);
    const mr = new Uint8Array(32 * 32 * 4);
    this.names.forEach((n, i) => {
      const e = this.entries[n];
      const [r, g, b] = hex(e.c);
      const cx = (i % 8) * 4;
      const cy = Math.floor(i / 8) * 4;
      for (let y = cy; y < cy + 4; y++)
        for (let x = cx; x < cx + 4; x++) {
          const k = (y * 32 + x) * 4;
          a.set([r, g, b, 255], k);
          mr.set([0, Math.round((e.r ?? 0.85) * 255), Math.round((e.m ?? 0) * 255), 255], k);
        }
    });
    return { albedo: png(32, 32, a), mr: png(32, 32, mr) };
  }
}

// ---------------------------------------------------------------------------------------------
// Meshes: flat-shaded boxes and prisms, each part one palette colour
// ---------------------------------------------------------------------------------------------

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a) => {
  const l = Math.hypot(...a) || 1;
  return a.map((v) => v / l);
};
/** Turn a point about the x axis through a pivot (degrees; positive tips +z up toward +y). */
const rakeX = (p, deg, o = [0, 0, 0]) => {
  const a = (deg * Math.PI) / 180;
  const y = p[1] - o[1];
  const z = p[2] - o[2];
  return [p[0], o[1] + y * Math.cos(a) - z * Math.sin(a), o[2] + y * Math.sin(a) + z * Math.cos(a)];
};

class Mesh {
  constructor(palette, unit = 1) {
    this.pal = palette;
    this.unit = unit;
    this.pos = [];
    this.nor = [];
    this.uv = [];
  }
  /** A quad (corners counter-clockwise seen from outside). */
  quad(a, b, c, d, color) {
    const n = norm(cross(sub(b, a), sub(c, a)));
    const uv = this.pal.uv(color);
    for (const p of [a, b, c, a, c, d]) {
      this.pos.push(...p.map((v) => v * this.unit));
      this.nor.push(...n);
      this.uv.push(...uv);
    }
  }
  tri(a, b, c, color) {
    const n = norm(cross(sub(b, a), sub(c, a)));
    const uv = this.pal.uv(color);
    for (const p of [a, b, c]) {
      this.pos.push(...p.map((v) => v * this.unit));
      this.nor.push(...n);
      this.uv.push(...uv);
    }
  }
  /**
   * A box from `lo` to `hi`, its top face scaled by `taper` about its middle, optionally raked
   * about x through `pivot` (degrees).
   */
  box(lo, hi, color, { taper = 1, rake = 0, pivot = [0, 0, 0] } = {}) {
    const [x0, y0, z0] = lo;
    const [x1, y1, z1] = hi;
    const cx = (x0 + x1) / 2;
    const cz = (z0 + z1) / 2;
    const t = (x, z) => [cx + (x - cx) * taper, cz + (z - cz) * taper];
    let v = [
      [x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1],
      [t(x0, z0)[0], y1, t(x0, z0)[1]], [t(x1, z0)[0], y1, t(x1, z0)[1]], [t(x1, z1)[0], y1, t(x1, z1)[1]], [t(x0, z1)[0], y1, t(x0, z1)[1]],
    ];
    if (rake) v = v.map((p) => rakeX(p, rake, pivot));
    const F = [[0, 1, 2, 3], [7, 6, 5, 4], [0, 4, 5, 1], [1, 5, 6, 2], [2, 6, 7, 3], [3, 7, 4, 0]];
    for (const f of F) this.quad(v[f[0]], v[f[1]], v[f[2]], v[f[3]], color);
    return this;
  }
  /** A prism along z: `sides` round (y, x) about (cx, cy), from z0 to z1, radius r. */
  cyl(cx, cy, r, z0, z1, color, sides = 8, capColor = color) {
    const ring = (z) => Array.from({ length: sides }, (_, k) => {
      const a = ((k + 0.5) / sides) * Math.PI * 2;
      return [cx + Math.cos(a) * r, cy + Math.sin(a) * r, z];
    });
    const A = ring(z0);
    const B = ring(z1);
    for (let k = 0; k < sides; k++) {
      const k2 = (k + 1) % sides;
      this.quad(A[k], A[k2], B[k2], B[k], color);
    }
    for (let k = 1; k + 1 < sides; k++) {
      this.tri(A[0], A[k + 1], A[k], capColor);
      this.tri(B[0], B[k], B[k + 1], capColor);
    }
    return this;
  }
  get empty() {
    return this.pos.length === 0;
  }
}

// ---------------------------------------------------------------------------------------------
// GLB
// ---------------------------------------------------------------------------------------------

class Gltf {
  constructor() {
    this.bin = [];
    this.byteLength = 0;
    this.bufferViews = [];
    this.accessors = [];
    this.images = [];
    this.textures = [];
  }
  view(bytes, target) {
    const pad = (4 - (this.byteLength % 4)) % 4;
    if (pad) {
      this.bin.push(Buffer.alloc(pad));
      this.byteLength += pad;
    }
    this.bufferViews.push({ buffer: 0, byteOffset: this.byteLength, byteLength: bytes.length, ...(target ? { target } : {}) });
    this.bin.push(bytes);
    this.byteLength += bytes.length;
    return this.bufferViews.length - 1;
  }
  add(data, type, { minmax = false, vertex = true } = {}) {
    const bytes = Buffer.from(new Float32Array(data).buffer);
    const bv = this.view(bytes, vertex ? 34962 : undefined);
    const n = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 }[type];
    const acc = { bufferView: bv, componentType: 5126, count: data.length / n, type };
    if (minmax) {
      const min = new Array(n).fill(Infinity);
      const max = new Array(n).fill(-Infinity);
      for (let i = 0; i < data.length; i += n)
        for (let k = 0; k < n; k++) {
          min[k] = Math.min(min[k], Math.fround(data[i + k]));
          max[k] = Math.max(max[k], Math.fround(data[i + k]));
        }
      Object.assign(acc, { min, max });
    }
    this.accessors.push(acc);
    return this.accessors.length - 1;
  }
  image(bytes, name) {
    this.images.push({ name, bufferView: this.view(bytes), mimeType: 'image/png' });
    this.textures.push({ sampler: 0, source: this.images.length - 1 });
    return this.textures.length - 1;
  }
  mesh(m, name) {
    return { name, primitives: [{ attributes: { POSITION: this.add(m.pos, 'VEC3', { minmax: true }), NORMAL: this.add(m.nor, 'VEC3'), TEXCOORD_0: this.add(m.uv, 'VEC2') }, material: 0, mode: 4 }] };
  }
  write(file, json) {
    const full = {
      asset: { version: '2.0', generator: 'High Noon src/games/highnoon/tools/build.mjs' },
      ...json,
      samplers: [{ magFilter: 9728, minFilter: 9728, wrapS: 33071, wrapT: 33071 }],
      images: this.images,
      textures: this.textures,
      accessors: this.accessors,
      bufferViews: this.bufferViews,
      buffers: [{ byteLength: 0 }],
    };
    const tail = (4 - (this.byteLength % 4)) % 4;
    if (tail) this.bin.push(Buffer.alloc(tail));
    const bin = Buffer.concat(this.bin);
    full.buffers[0].byteLength = bin.length;
    let js = Buffer.from(JSON.stringify(full), 'utf8');
    js = Buffer.concat([js, Buffer.alloc((4 - (js.length % 4)) % 4, 0x20)]);
    const header = Buffer.alloc(12);
    header.writeUInt32LE(0x46546c67, 0);
    header.writeUInt32LE(2, 4);
    header.writeUInt32LE(12 + 8 + js.length + 8 + bin.length, 8);
    const ch = (buf, type) => {
      const h = Buffer.alloc(8);
      h.writeUInt32LE(buf.length, 0);
      h.writeUInt32LE(type, 4);
      return Buffer.concat([h, buf]);
    };
    const out = Buffer.concat([header, ch(js, 0x4e4f534a), ch(bin, 0x004e4942)]);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, out);
    console.log(`wrote ${file.slice(file.indexOf('src/'))} (${(out.length / 1024).toFixed(1)} KB)`);
  }
}

/** The one material: the palette and its metallic-roughness twin (factors 1: the textures drive it). */
function material(g, pal, name) {
  const { albedo, mr } = pal.images();
  const a = g.image(albedo, `${name}_palette`);
  const m = g.image(mr, `${name}_metal_rough`);
  return [{ name, pbrMetallicRoughness: { baseColorTexture: { index: a }, baseColorFactor: [1, 1, 1, 1], metallicRoughnessTexture: { index: m }, metallicFactor: 1, roughnessFactor: 1 } }];
}

// ---------------------------------------------------------------------------------------------
// Guns (pixels; 1/16 block)
// ---------------------------------------------------------------------------------------------

const GUN_PALETTE = new Palette({
  blued: { c: '#2c3038', r: 0.32, m: 1 },
  bluedDark: { c: '#1b1d22', r: 0.45, m: 1 },
  caseHard: { c: '#7a6552', r: 0.38, m: 0.9 },
  steel: { c: '#9aa0a8', r: 0.28, m: 1 },
  brass: { c: '#d0a44e', r: 0.3, m: 1 },
  walnut: { c: '#6a3a1e', r: 0.55, m: 0 },
  walnutDark: { c: '#4a2714', r: 0.6, m: 0 },
  ivory: { c: '#eadfc4', r: 0.4, m: 0 },
  bore: { c: '#050505', r: 0.9, m: 0 },
});

function writeGun(id, title, build, markers) {
  const m = new Mesh(GUN_PALETTE, 1 / 16);
  build(m);
  const g = new Gltf();
  const names = Object.keys(markers);
  const nodes = [
    { name: id, children: [1, ...names.map((_, k) => k + 2)], extras: { title } },
    { name: `${id}_body`, mesh: 0 },
    ...names.map((n) => ({ name: n, translation: markers[n].map((v) => +(v / 16).toFixed(5)) })),
  ];
  const meshes = [g.mesh(m, `${id}_body`)];
  g.write(join(MODELS, `${id}.glb`), { scene: 0, scenes: [{ name: id, nodes: [0] }], nodes, meshes, materials: material(g, GUN_PALETTE, `${id}_atlas`) });
}

/** The Peacemaker: a single-action revolver, case-hardened frame, blued barrel, ivory grips, a brass guard. */
function revolver() {
  writeGun(
    'revolver',
    'Peacemaker',
    (m) => {
      const RAKE = 22;
      // The grip: ivory panels on a steel backstrap, raked back, the fist round it at the origin.
      m.box([-1.15, -3.9, -1.3], [1.15, 1.0, 1.0], 'ivory', { rake: RAKE, taper: 1 });
      m.box([-0.6, -4.1, -1.55], [0.6, 1.0, -1.1], 'caseHard', { rake: RAKE });
      m.box([-1.2, -4.25, -1.45], [1.2, -3.8, 1.05], 'caseHard', { rake: RAKE });
      // The frame over the grip, and the hammer cocked back.
      m.box([-1.0, 0.7, -1.9], [1.0, 3.2, 0.4], 'caseHard');
      m.box([-0.45, 2.7, -3.0], [0.45, 3.4, -1.6], 'caseHard', { rake: -25, pivot: [0, 2.8, -1.7] });
      m.box([-0.35, 3.2, -3.4], [0.35, 3.6, -2.7], 'bluedDark');
      // The cylinder: six chambers round the bore line, fluted by eight sides.
      m.cyl(0, 2.1, 1.55, 0.4, 3.1, 'blued', 8, 'bluedDark');
      for (let k = 0; k < 6; k++) {
        const a = (k / 6) * Math.PI * 2 + Math.PI / 6;
        m.cyl(Math.cos(a) * 0.95, 2.1 + Math.sin(a) * 0.95, 0.32, 3.1, 3.12, 'bore', 6);
      }
      // The frame's top strap and the front of the frame round the barrel.
      m.box([-0.7, 3.1, -1.9], [0.7, 3.55, 3.4], 'caseHard');
      m.box([-1.0, 1.0, 3.1], [1.0, 3.4, 3.6], 'caseHard');
      // The barrel (7½ inches) with its bore, the ejector rod housing under it on the right.
      m.cyl(0, 2.85, 0.55, 3.6, 11.6, 'blued', 8, 'bore');
      m.cyl(-0.55, 1.9, 0.35, 3.6, 9.8, 'bluedDark', 6);
      m.box([-0.95, 1.6, 9.4], [-0.3, 2.1, 9.9], 'bluedDark');
      // Sights: a notch in the top strap (the eye looks over the hammer's spur along it), a tall
      // blade at the muzzle, its top on the eye line.
      m.box([-0.12, 3.4, 10.9], [0.12, 4.3, 11.5], 'blued');
      m.box([-0.55, 3.55, -1.9], [-0.2, 3.95, -1.3], 'caseHard');
      m.box([0.2, 3.55, -1.9], [0.55, 3.95, -1.3], 'caseHard');
      // The trigger guard (brass) and the trigger.
      m.box([-0.35, -0.95, 0.2], [0.35, -0.6, 2.5], 'brass');
      m.box([-0.35, -0.95, 2.2], [0.35, 0.8, 2.6], 'brass');
      m.box([-0.35, -0.9, -0.05], [0.35, 0.8, 0.3], 'brass');
      m.box([-0.2, -0.3, 1.1], [0.2, 0.8, 1.45], 'steel');
      // The loading gate on the right, behind the cylinder.
      m.box([-1.25, 1.3, -0.3], [-0.95, 2.6, 0.45], 'caseHard');
    },
    // No grip2: one hand on the gun (a figure's left hand stays free; first person gets its own, see weapons.ts).
    { grip: [0, 0, 0], muzzle: [0, 2.85, 11.6], sight: [0, 4.3, -1.6], mag: [-1.2, 2.0, 0.1] },
  );
}

/** The Yellowboy: a lever-action with a brass receiver, a walnut stock and forend, a tube magazine. */
function rifle() {
  writeGun(
    'rifle',
    'Yellowboy',
    (m) => {
      // Stock: the wrist at the fist, dropping to the butt, a steel crescent plate.
      m.box([-0.95, -1.4, -3.2], [0.95, 1.2, 0.6], 'walnut', { rake: 8 });
      m.box([-1.05, -3.6, -11.5], [1.05, 1.3, -3.0], 'walnut', { taper: 0.9 });
      m.box([-1.1, -3.8, -11.9], [1.1, 1.4, -11.4], 'steel');
      // The brass receiver, its side plate and the loading gate on the right.
      m.box([-1.1, 0.4, 0.2], [1.1, 3.9, 6.4], 'brass');
      m.box([1.1, 1.0, 1.2], [1.2, 3.2, 5.4], 'brass');
      m.box([-1.2, 1.0, 3.8], [-1.1, 2.2, 5.4], 'caseHard');
      // The bolt on top and the hammer.
      m.box([-0.5, 3.9, 0.4], [0.5, 4.3, 5.8], 'blued');
      m.box([-0.35, 3.6, -0.6], [0.35, 4.8, 0.3], 'bluedDark', { rake: -20, pivot: [0, 3.8, 0] });
      // The lever: a loop round the fingers behind the trigger, and its long arm under the wrist.
      m.box([-0.35, -0.4, 1.4], [0.35, 0.5, 3.8], 'blued');
      m.box([-0.35, -2.4, 3.2], [0.35, 0.2, 3.7], 'blued');
      m.box([-0.35, -2.6, 0.2], [0.35, -2.1, 3.7], 'blued');
      m.box([-0.35, -2.6, -2.8], [0.35, -2.1, 0.4], 'blued');
      m.box([-0.35, -2.4, -3.2], [0.35, -0.6, -2.7], 'blued');
      m.box([-0.2, -0.6, 0.9], [0.2, 0.5, 1.3], 'steel');
      // Barrel (octagonal) and the tube magazine under it, a brass band, the forend.
      m.cyl(0, 3.0, 0.62, 6.4, 25.5, 'blued', 8, 'bore');
      m.cyl(0, 1.65, 0.55, 6.4, 24.2, 'bluedDark', 8);
      m.box([-0.95, 0.9, 6.4], [0.95, 2.9, 15.5], 'walnut', { taper: 0.92 });
      m.box([-0.8, 0.95, 15.3], [0.8, 3.7, 16.0], 'brass');
      m.box([-0.8, 1.0, 23.4], [0.8, 3.7, 24.0], 'blued');
      // Sights: a tall buckhorn rear sight on the barrel (its notch over the hammer's reach) and a
      // blade at the muzzle, both tops on the eye line.
      m.box([-0.7, 3.5, 11.6], [-0.3, 5.45, 11.9], 'blued');
      m.box([0.3, 3.5, 11.6], [0.7, 5.45, 11.9], 'blued');
      m.box([-0.3, 3.5, 11.6], [0.3, 4.3, 11.9], 'blued');
      m.box([-0.1, 3.5, 24.6], [0.1, 5.3, 25.2], 'brass');
    },
    { grip: [0, 0, 0], grip2: [0, 0.9, 13.5], muzzle: [0, 3.0, 25.5], sight: [0, 5.3, 11.0], mag: [-1.2, 1.6, 4.6] },
  );
}

// ---------------------------------------------------------------------------------------------
// Cowboys, on the humanoid rig
// ---------------------------------------------------------------------------------------------

const COWBOY_PALETTE = new Palette({
  skinA: { c: '#e0ac86', r: 0.7 },
  skinB: { c: '#b77a52', r: 0.7 },
  skinC: { c: '#7a4b31', r: 0.7 },
  hairBrown: { c: '#4a2e1b' },
  hairBlack: { c: '#161412' },
  hairGrey: { c: '#9a9590' },
  hairRed: { c: '#8a3b1b' },
  eye: { c: '#141010', r: 0.3 },
  hatTan: { c: '#b58a57' },
  hatBrown: { c: '#5a3b24' },
  hatBlack: { c: '#1c1b1d' },
  hatStraw: { c: '#d8bd7a' },
  hatGrey: { c: '#6d6660' },
  hatWhite: { c: '#e6ddcc' },
  band: { c: '#2a1a10' },
  bandSilver: { c: '#c8c8cc', r: 0.3, m: 1 },
  shirtWhite: { c: '#e8e2d4' },
  shirtCream: { c: '#d9c7a3' },
  shirtBlue: { c: '#4d6b8f' },
  shirtRed: { c: '#9b2f2a' },
  shirtGrey: { c: '#7d7a74' },
  shirtCheck: { c: '#a8473a' },
  vestBlack: { c: '#232125' },
  vestBrown: { c: '#6d4323' },
  vestBurgundy: { c: '#5e1c24' },
  vestGreen: { c: '#3f5a36' },
  vestLeather: { c: '#8a5a33' },
  ponchoA: { c: '#8f6a3e' },
  ponchoB: { c: '#c9a36a' },
  pantsDenim: { c: '#34465e' },
  pantsBrown: { c: '#5b4431' },
  pantsBlack: { c: '#1f1f22' },
  pantsGrey: { c: '#55524e' },
  chaps: { c: '#7a4f2c' },
  boot: { c: '#3a2416', r: 0.45 },
  bootBlack: { c: '#141214', r: 0.35 },
  belt: { c: '#3d2515' },
  buckle: { c: '#d0a44e', r: 0.3, m: 1 },
  holster: { c: '#5a361c' },
  spur: { c: '#a9adb3', r: 0.3, m: 1 },
  bandanaRed: { c: '#b3262c' },
  bandanaBlue: { c: '#2d4f8e' },
  bandanaBlack: { c: '#1a1a1a' },
  badge: { c: '#e2b74a', r: 0.25, m: 1 },
  glove: { c: '#6e4a2b' },
  tie: { c: '#101010' },
  cigar: { c: '#3b2518' },
  ember: { c: '#ff6a1f' },
});

/** The rig (docs/HUMANOID.md): name, parent, rest translation. */
const JOINTS = [
  ['hips', null, [0, 0.95, 0]],
  ['spine', 'hips', [0, 0.1, 0]],
  ['chest', 'spine', [0, 0.22, 0]],
  ['neck', 'chest', [0, 0.24, 0]],
  ['head', 'neck', [0, 0.07, 0]],
  ['upperArmL', 'chest', [0.19, 0.19, 0]],
  ['lowerArmL', 'upperArmL', [0, -0.28, 0]],
  ['handL', 'lowerArmL', [0, -0.25, 0]],
  ['gripL', 'handL', [0, -0.085, 0.015]],
  ['upperArmR', 'chest', [-0.19, 0.19, 0]],
  ['lowerArmR', 'upperArmR', [0, -0.28, 0]],
  ['handR', 'lowerArmR', [0, -0.25, 0]],
  ['gripR', 'handR', [0, -0.085, 0.015]],
  ['upperLegL', 'hips', [0.1, -0.04, 0]],
  ['lowerLegL', 'upperLegL', [0, -0.43, 0]],
  ['footL', 'lowerLegL', [0, -0.41, 0]],
  ['upperLegR', 'hips', [-0.1, -0.04, 0]],
  ['lowerLegR', 'upperLegR', [0, -0.43, 0]],
  ['footR', 'lowerLegR', [0, -0.41, 0]],
];

/**
 * The six. `hat`: 'cattleman' (a pinched crown), 'flat' (a gambler's flat top), 'sombrero' (wide,
 * tall), 'bowler'; extras: a poncho, a sheriff's star, chaps, gloves, a string tie, a cigar.
 */
const COWBOYS = [
  { id: 'stranger', name: 'The Stranger', skin: 'skinB', hair: 'hairBrown', hat: 'cattleman', hatC: 'hatGrey', band: 'band', shirt: 'shirtCream', vest: null, pants: 'pantsBrown', boot: 'boot', bandana: null, poncho: true, cigar: true },
  { id: 'sheriff', name: 'The Sheriff', skin: 'skinA', hair: 'hairGrey', hat: 'cattleman', hatC: 'hatTan', band: 'band', shirt: 'shirtWhite', vest: 'vestBlack', pants: 'pantsGrey', boot: 'boot', bandana: null, badge: true, tie: true, moustache: true },
  { id: 'outlaw', name: 'The Outlaw', skin: 'skinA', hair: 'hairBlack', hat: 'cattleman', hatC: 'hatBlack', band: 'bandSilver', shirt: 'shirtGrey', vest: 'vestBlack', pants: 'pantsBlack', boot: 'bootBlack', bandana: 'bandanaRed', gloves: true },
  { id: 'gambler', name: 'The Gambler', skin: 'skinA', hair: 'hairRed', hat: 'flat', hatC: 'hatBlack', band: 'shirtRed', shirt: 'shirtWhite', vest: 'vestBurgundy', pants: 'pantsBlack', boot: 'bootBlack', bandana: null, tie: true, moustache: true },
  { id: 'rancher', name: 'The Rancher', skin: 'skinC', hair: 'hairBlack', hat: 'cattleman', hatC: 'hatStraw', band: 'band', shirt: 'shirtBlue', vest: null, pants: 'pantsDenim', boot: 'boot', bandana: 'bandanaBlue', chaps: true, gloves: true },
  { id: 'bandita', name: 'La Bandita', skin: 'skinB', hair: 'hairBlack', hat: 'sombrero', hatC: 'hatWhite', band: 'shirtRed', shirt: 'shirtCheck', vest: 'vestGreen', pants: 'pantsBrown', boot: 'boot', bandana: 'bandanaBlack', braid: true },
];

/** Parts of one cowboy: [joint, colour, lo, hi, opts] in the joint's own space (metres). */
function cowboyParts(o) {
  const P = [];
  const add = (joint, c, lo, hi, opts = {}) => P.push([joint, c, lo, hi, opts]);
  const top = o.vest ?? o.shirt;
  // Hips: trousers, the gun belt, its buckle and the holster on the right hip (the figure's right is -x).
  add('hips', o.pants, [-0.17, -0.1, -0.1], [0.17, 0.1, 0.1]);
  add('hips', 'belt', [-0.178, -0.02, -0.108], [0.178, 0.05, 0.108]);
  add('hips', 'buckle', [-0.045, -0.015, 0.105], [0.045, 0.045, 0.118]);
  add('hips', 'holster', [-0.225, -0.24, -0.05], [-0.165, 0.03, 0.07]);
  // Cartridges in the belt loops at the back.
  for (let k = 0; k < 5; k++) add('hips', 'buckle', [0.06 + k * 0.022, 0.0, -0.112], [0.074 + k * 0.022, 0.035, -0.105]);
  // Belly and chest: the shirt, a vest over it (open down the front), a bandana, a badge, a tie.
  add('spine', o.shirt, [-0.15, -0.02, -0.09], [0.15, 0.24, 0.1], { taper: 1.08 });
  if (o.vest) {
    add('spine', o.vest, [-0.155, -0.01, -0.095], [-0.03, 0.235, 0.104], { taper: 1.06 });
    add('spine', o.vest, [0.03, -0.01, -0.095], [0.155, 0.235, 0.104], { taper: 1.06 });
    add('spine', o.vest, [-0.03, -0.01, -0.095], [0.03, 0.235, -0.05]);
  }
  add('chest', top, [-0.21, -0.02, -0.12], [0.21, 0.26, 0.12], { taper: 1.05 });
  if (o.vest) add('chest', o.shirt, [-0.045, -0.02, 0.118], [0.045, 0.2, 0.128]);
  if (o.bandana) {
    add('chest', o.bandana, [-0.1, 0.19, -0.1], [0.1, 0.27, 0.132]);
    add('chest', o.bandana, [-0.06, 0.09, 0.118], [0.06, 0.2, 0.14], { taper: 0.3 });
  }
  if (o.tie) add('chest', 'tie', [-0.012, 0.1, 0.126], [0.012, 0.24, 0.134]);
  if (o.badge) {
    add('chest', 'badge', [0.075, 0.1, 0.12], [0.135, 0.16, 0.132]);
    add('chest', 'badge', [0.095, 0.08, 0.12], [0.115, 0.18, 0.132]);
  }
  if (o.poncho) {
    // A serape over the shoulders, striped, its point hanging to the belt.
    add('chest', 'ponchoA', [-0.26, -0.2, -0.15], [0.26, 0.25, 0.15], { taper: 0.62 });
    add('chest', 'ponchoB', [-0.262, -0.1, -0.152], [0.262, -0.06, 0.152], { taper: 0.93 });
    add('chest', 'ponchoB', [-0.262, 0.06, -0.152], [0.262, 0.1, 0.152], { taper: 0.93 });
  }
  add('neck', o.skin, [-0.05, -0.02, -0.05], [0.05, 0.1, 0.05]);
  // Head: the face, hair, eyes, a moustache or a braid, and the hat.
  add('head', o.skin, [-0.1, 0, -0.11], [0.1, 0.24, 0.11], { taper: 0.92 });
  add('head', o.hair, [-0.104, 0.1, -0.115], [0.104, 0.22, -0.03]);
  add('head', 'eye', [0.028, 0.13, 0.104], [0.058, 0.152, 0.113]);
  add('head', 'eye', [-0.058, 0.13, 0.104], [-0.028, 0.152, 0.113]);
  add('head', o.hair, [-0.07, 0.165, 0.104], [-0.02, 0.18, 0.112]);
  add('head', o.hair, [0.02, 0.165, 0.104], [0.07, 0.18, 0.112]);
  if (o.moustache) add('head', o.hair, [-0.055, 0.075, 0.104], [0.055, 0.1, 0.116]);
  if (o.braid) add('head', o.hair, [-0.03, -0.12, -0.13], [0.03, 0.14, -0.08]);
  if (o.cigar) {
    add('head', 'cigar', [-0.07, 0.06, 0.1], [-0.05, 0.08, 0.17]);
    add('head', 'ember', [-0.071, 0.059, 0.17], [-0.049, 0.081, 0.178]);
  }
  const hc = o.hatC;
  if (o.hat === 'cattleman') {
    add('head', hc, [-0.215, 0.2, -0.235], [0.215, 0.222, 0.215]);
    add('head', hc, [-0.215, 0.215, -0.255], [0.215, 0.245, -0.2]);
    add('head', hc, [-0.215, 0.215, 0.18], [0.215, 0.235, 0.24]);
    add('head', hc, [-0.108, 0.21, -0.12], [0.108, 0.35, 0.1], { taper: 0.78 });
    add('head', o.band, [-0.11, 0.222, -0.122], [0.11, 0.252, 0.102]);
  } else if (o.hat === 'flat') {
    add('head', hc, [-0.19, 0.2, -0.2], [0.19, 0.22, 0.19]);
    add('head', hc, [-0.105, 0.21, -0.115], [0.105, 0.32, 0.1]);
    add('head', o.band, [-0.107, 0.22, -0.117], [0.107, 0.25, 0.102]);
  } else if (o.hat === 'sombrero') {
    add('head', hc, [-0.3, 0.2, -0.31], [0.3, 0.22, 0.29]);
    add('head', hc, [-0.3, 0.215, -0.33], [0.3, 0.26, -0.27]);
    add('head', hc, [-0.3, 0.215, 0.25], [0.3, 0.26, 0.31]);
    add('head', hc, [-0.32, 0.215, -0.29], [-0.27, 0.26, 0.27]);
    add('head', hc, [0.27, 0.215, -0.29], [0.32, 0.26, 0.27]);
    add('head', hc, [-0.1, 0.21, -0.11], [0.1, 0.4, 0.09], { taper: 0.55 });
    add('head', o.band, [-0.1, 0.22, -0.112], [0.1, 0.26, 0.092]);
  }
  // Arms: sleeves, cuffs, fists (gloved or bare).
  for (const s of ['L', 'R']) {
    const sleeve = o.poncho ? o.shirt : o.shirt;
    add(`upperArm${s}`, sleeve, [-0.056, -0.3, -0.056], [0.056, 0.04, 0.056], { taper: 1.1 });
    add(`lowerArm${s}`, sleeve, [-0.049, -0.21, -0.049], [0.049, 0.03, 0.049], { taper: 1.08 });
    add(`lowerArm${s}`, o.gloves ? 'glove' : o.shirt, [-0.052, -0.26, -0.052], [0.052, -0.18, 0.052]);
    add(`hand${s}`, o.gloves ? 'glove' : o.skin, [-0.04, -0.13, -0.03], [0.04, 0, 0.06]);
  }
  // Legs: trousers (chaps over them), boots with heels and spurs.
  for (const s of ['L', 'R']) {
    add(`upperLeg${s}`, o.pants, [-0.075, -0.45, -0.08], [0.075, 0.05, 0.08], { taper: 1.15 });
    if (o.chaps) add(`upperLeg${s}`, 'chaps', [-0.082, -0.44, -0.086], [0.082, -0.02, 0.086]);
    add(`lowerLeg${s}`, o.pants, [-0.06, -0.14, -0.062], [0.06, 0.03, 0.07]);
    add(`lowerLeg${s}`, o.boot, [-0.066, -0.41, -0.068], [0.066, -0.12, 0.076]);
    add(`foot${s}`, o.boot, [-0.056, -0.07, -0.07], [0.056, 0.035, 0.21]);
    add(`foot${s}`, o.boot, [-0.05, -0.075, -0.08], [0.05, -0.03, -0.01]);
    add(`foot${s}`, 'spur', [-0.07, -0.055, -0.125], [0.07, -0.035, -0.085]);
  }
  return P;
}

// Rotations (quaternions [x, y, z, w]), as the rig takes Euler turns: YXZ (turn, then tip, then roll).
const qmul = (a, b) => [
  a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
  a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
  a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
  a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2],
];
const qaxis = (axis, angle) => {
  const s = Math.sin(angle / 2);
  return [axis[0] * s, axis[1] * s, axis[2] * s, Math.cos(angle / 2)];
};
const euler = (x = 0, y = 0, z = 0) => qmul(qmul(qaxis([0, 1, 0], y), qaxis([1, 0, 0], x)), qaxis([0, 0, 1], z));
const r6 = (v) => v.map((x) => Math.round(x * 1e6) / 1e6);

/**
 * Clips, in the rig's terms: each key the turns of some joints ([tip, turn, roll], radians) from
 * standing straight, and how far the hips rise. The rig's joints rest unturned, so a joint's turn is
 * its node's rotation.
 */
const CLIPS = [
  {
    // The right hand up to the brim and down again, a nod with it.
    name: 'tip_hat',
    keys: [
      { t: 0, turns: {} },
      { t: 0.35, turns: { upperArmR: [-2.0, 0.55, 0.1], lowerArmR: [-1.75, 0, 0], handR: [0.3, 0, 0], head: [0.28, 0, 0] } },
      { t: 0.7, turns: { upperArmR: [-2.0, 0.55, 0.1], lowerArmR: [-1.75, 0, 0], handR: [0.6, 0, 0], head: [0.3, 0, 0] } },
      { t: 1.1, turns: {} },
    ],
  },
  {
    // The gun thrown up to the sky (twice, as if firing), the left fist on the hip, a little hop.
    name: 'victory',
    keys: [0, 0.3, 0.55, 0.8, 1.05, 1.3].map((t, i) => {
      const up = i % 2 === 1;
      return {
        t,
        rise: i === 0 ? 0 : up ? 0.03 : -0.02,
        turns: {
          spine: [up ? -0.1 : -0.04],
          head: [up ? -0.35 : -0.2],
          upperArmR: [0, 0, up ? -2.95 : -2.75],
          lowerArmR: [up ? 0 : -0.25],
          handR: [up ? 1.5 : 1.2],
          upperArmL: [0, 0, 0.55],
          lowerArmL: [0, 0, -1.25],
          upperLegL: [up ? -0.05 : -0.2],
          upperLegR: [up ? -0.05 : -0.2],
          lowerLegL: [up ? 0.1 : 0.4],
          lowerLegR: [up ? 0.1 : 0.4],
          footL: [up ? -0.05 : -0.2],
          footR: [up ? -0.05 : -0.2],
        },
      };
    }),
  },
  {
    // The standoff: knees soft, the right hand hovering over the holster, fingers twitching.
    name: 'standoff',
    keys: [0, 0.6, 1.2].map((t, i) => ({
      t,
      rise: -0.035,
      turns: {
        spine: [0.08, -0.12],
        head: [-0.05, 0.12],
        upperArmR: [0.12, 0, -0.32 - (i === 1 ? 0.04 : 0)],
        lowerArmR: [-0.35, 0, 0.15],
        handR: [0.2, 0, -0.35 - (i === 1 ? 0.15 : 0)],
        upperArmL: [0.05, 0, 0.28],
        lowerArmL: [-0.3, 0, -0.05],
        upperLegL: [-0.22, 0, 0.08],
        upperLegR: [-0.22, 0, -0.08],
        lowerLegL: [0.4],
        lowerLegR: [0.4],
        footL: [-0.18],
        footR: [-0.18],
      },
    })),
  },
];

function writeCowboy(o) {
  const g = new Gltf();
  const nodes = [{ name: o.id, children: [], extras: { title: o.name } }];
  const index = new Map();
  for (const [name, parent, t] of JOINTS) {
    nodes.push({ name, translation: t, children: [] });
    index.set(name, nodes.length - 1);
    (parent ? nodes[index.get(parent)] : nodes[0]).children.push(nodes.length - 1);
  }
  const byJoint = new Map();
  for (const [joint, c, lo, hi, opts] of cowboyParts(o)) {
    const m = byJoint.get(joint) ?? new Mesh(COWBOY_PALETTE);
    m.box(lo, hi, c, opts);
    byJoint.set(joint, m);
  }
  const meshes = [];
  for (const [joint, m] of byJoint) {
    meshes.push(g.mesh(m, `${joint}_mesh`));
    nodes.push({ name: `${joint}_mesh`, mesh: meshes.length - 1 });
    nodes[index.get(joint)].children.push(nodes.length - 1);
  }
  const animations = CLIPS.map((clip) => {
    const input = g.add(clip.keys.map((k) => k.t), 'SCALAR', { minmax: true, vertex: false });
    const moved = [...new Set(clip.keys.flatMap((k) => Object.keys(k.turns)))];
    const samplers = [];
    const channels = [];
    for (const j of moved) {
      const values = clip.keys.flatMap((k) => r6(k.turns[j] ? euler(...k.turns[j]) : [0, 0, 0, 1]));
      samplers.push({ input, output: g.add(values, 'VEC4', { vertex: false }), interpolation: 'LINEAR' });
      channels.push({ sampler: samplers.length - 1, target: { node: index.get(j), path: 'rotation' } });
    }
    if (clip.keys.some((k) => k.rise)) {
      const values = clip.keys.flatMap((k) => [0, 0.95 + (k.rise ?? 0), 0]);
      samplers.push({ input, output: g.add(values, 'VEC3', { vertex: false }), interpolation: 'LINEAR' });
      channels.push({ sampler: samplers.length - 1, target: { node: index.get('hips'), path: 'translation' } });
    }
    return { name: clip.name, samplers, channels };
  });
  for (const n of nodes) if (n.children && !n.children.length) delete n.children;
  g.write(join(MODELS, 'cowboys', `${o.id}.glb`), { scene: 0, scenes: [{ name: o.id, nodes: [0] }], nodes, meshes, animations, materials: material(g, COWBOY_PALETTE, `${o.id}_palette`) });
}

// ---------------------------------------------------------------------------------------------
// A block face: the wanted poster (16 x 16)
// ---------------------------------------------------------------------------------------------

function wantedPoster() {
  const rows = [
    'wwwwwwwwwwwwwwww',
    'wppppppppppppppw',
    'wpKpKpKKpKpKpKpw',
    'wpKKKpKKpKKpKKpw',
    'wppppppppppppppw',
    'wppppbbbbbbppppw',
    'wpppbhhhhhhbpppw',
    'wppppffffffppppw',
    'wppppfkffkfppppw',
    'wppppffmmffppppw',
    'wpppcccccccccppw',
    'wppppppppppppppw',
    'wpp$p$$p$$p$pppw',
    'wppppppppppppppw',
    'wppKKKKKKKKKKppw',
    'wwwwwwwwwwwwwwww',
  ];
  const colors = { w: '#5a3a1e', p: '#e3cf9f', K: '#2b1d12', b: '#3a2a1c', h: '#241810', f: '#c8a27a', k: '#1a120c', m: '#5a3a26', c: '#6a4a2e', $: '#8a2a1a' };
  const px = new Uint8Array(16 * 16 * 4);
  rows.forEach((row, y) =>
    [...row].forEach((ch, x) => {
      const [r, g, b] = hex(colors[ch]);
      // A little age: darker at the corners and speckled.
      const n = ((x * 7 + y * 13) % 5) - 2;
      const edge = Math.min(x, y, 15 - x, 15 - y) < 2 && ch === 'p' ? -18 : 0;
      px.set([r + n * 3 + edge, g + n * 3 + edge, b + n * 2 + edge, 255].map((v) => Math.max(0, Math.min(255, v))), (y * 16 + x) * 4);
    }),
  );
  mkdirSync(BLOCKS, { recursive: true });
  writeFileSync(join(BLOCKS, 'wanted_poster.png'), png(16, 16, px));
  console.log('wrote src/games/highnoon/blocks/wanted_poster.png');
}

revolver();
rifle();
for (const o of COWBOYS) writeCowboy(o);
wantedPoster();
