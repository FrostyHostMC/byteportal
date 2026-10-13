/**
 * The bosses' model kit, on the Arena's voxel toolkit (`../voxel.mjs`): a figure is voxels painted
 * in code with shapes (balls, rods, boxes) onto its bones, written as one rigidly skinned mesh (a
 * vertex wholly on its bone, Call of Blocky's and Blockfront's way) with keyframed clips.
 *
 * - Space: voxel units, x the figure's left, y up, z ahead (glTF's +z), its feet at y 0. Cell
 *   (i, j, k) spans [i, i + 1] and so on; a shape takes the cells whose middles are inside it.
 * - Size: `voxel` is a voxel's size in the world (metres = blocks); the file is written `scale`
 *   times smaller and the game draws it `scale` times bigger (`Models.gltf(url, { scale })`), which
 *   also stretches its walk to its stride: the platform plays one walk cycle a block and a half of
 *   ground times the model's scale.
 * - Bones rest unturned at their pivots (`bone(name, parent, at)`), so a clip's turn of a bone is
 *   [x, y, z] radians about the figure's own axes (applied z, then y, then x: three.js's 'XYZ'):
 *   +x tips what's ahead of it down (an arm hanging down swings back), +y turns it to its left,
 *   +z swings what hangs down out to its left.
 * - Clips: keys at times (seconds) with turns and moves (voxels) for some bones; a bone a clip
 *   moves at all is keyed at every key (at rest where a key leaves it out), linearly between.
 * - Look: the toolkit's clean voxels (flat colours, soft occlusion in the corners), glowing tiles
 *   kept apart in the atlas so mip levels never bleed a glow into the rest (Blockfront's `atlasOf`).
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { Palette, Voxels, faces, atlas, quadCorners, png, writeGlb, readGlb, cellKey, cellOf, DIRS } from '../voxel.mjs';

export { Palette };

/** A deterministic hash of a cell (0..1), for painting variation. */
export function hash(i, j, k, salt = 0) {
  let h = Math.imul(i + 7919 * salt + 1013, 0x27d4eb2d) ^ Math.imul(j + 104729, 0x165667b1) ^ Math.imul(k + 15485863, 0x9e3779b1);
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d);
  h ^= h >>> 13;
  return (h >>> 0) / 4294967296;
}

const lerp = (a, b, t) => a + (b - a) * t;
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

export class Figure {
  /**
   * @param {string} id
   * @param {{ voxel: number, scale?: number }} o a voxel's size in the world (blocks), and how
   *   much bigger the game draws the file than it's written.
   */
  constructor(id, { voxel, scale = 1 }) {
    this.id = id;
    this.voxel = voxel;
    this.scale = scale;
    this.vox = new Voxels();
    this.pal = new Palette();
    this.bones = [];
    this.byName = new Map();
    this.clips = [];
  }

  /** A bone hanging from `parent` (null: the root), its pivot at `at` (voxels). */
  bone(name, parent, at) {
    if (this.byName.has(name)) throw new Error(`${this.id}: bone ${name} twice`);
    if (parent && !this.byName.has(parent)) throw new Error(`${this.id}: ${name}'s parent ${parent} not yet made`);
    const b = { name, parent, at };
    this.bones.push(b);
    this.byName.set(name, b);
    this.vox.part(name);
    return b;
  }

  colour(name, hex, o) {
    return this.pal.add(name, hex, o);
  }

  /** Every cell in a box of voxels (lo inclusive, hi exclusive), painted by `fn(i, j, k)`: a colour, false to clear it, or nothing. */
  each(part, lo, hi, fn) {
    this.vox.paint(part, lo.map(Math.floor), hi.map(Math.ceil), fn);
  }

  /** A solid box (voxel bounds, as `each`). */
  box(part, lo, hi, colour) {
    this.each(part, lo, hi, typeof colour === 'function' ? colour : () => colour);
  }

  /** An ellipsoid round `c` with radii `r` (a number or [rx, ry, rz]); `colour` a name or `fn(i, j, k, u)` (u: 0 at the middle, 1 at the skin). */
  ball(part, c, r, colour, keep = () => true) {
    const [rx, ry, rz] = typeof r === 'number' ? [r, r, r] : r;
    this.each(part, [c[0] - rx - 1, c[1] - ry - 1, c[2] - rz - 1], [c[0] + rx + 1, c[1] + ry + 1, c[2] + rz + 1], (i, j, k) => {
      const x = (i + 0.5 - c[0]) / rx, y = (j + 0.5 - c[1]) / ry, z = (k + 0.5 - c[2]) / rz;
      const u = Math.hypot(x, y, z);
      if (u > 1 || !keep(i, j, k)) return undefined;
      return typeof colour === 'function' ? colour(i, j, k, u) : colour;
    });
  }

  /** A rod from `a` to `b`, `r0` thick at `a` and `r1` at `b` (rounded ends); `colour` a name or `fn(i, j, k, t)` (t: 0 at `a`, 1 at `b`). */
  rod(part, a, b, r0, r1 = r0, colour = 'bone') {
    const ab = sub(b, a);
    const len2 = dot(ab, ab) || 1;
    const R = Math.max(r0, r1) + 1;
    const lo = [Math.min(a[0], b[0]) - R, Math.min(a[1], b[1]) - R, Math.min(a[2], b[2]) - R];
    const hi = [Math.max(a[0], b[0]) + R, Math.max(a[1], b[1]) + R, Math.max(a[2], b[2]) + R];
    this.each(part, lo, hi, (i, j, k) => {
      const p = [i + 0.5, j + 0.5, k + 0.5];
      const t = Math.max(0, Math.min(1, dot(sub(p, a), ab) / len2));
      const q = [a[0] + ab[0] * t, a[1] + ab[1] * t, a[2] + ab[2] * t];
      const d = Math.hypot(...sub(p, q));
      if (d > lerp(r0, r1, t)) return undefined;
      return typeof colour === 'function' ? colour(i, j, k, t) : colour;
    });
  }

  /** Rods through a list of points (a curve), the thickness going from `r0` to `r1` along it. */
  path(part, pts, r0, r1 = r0, colour = 'bone') {
    for (let n = 0; n < pts.length - 1; n++) this.rod(part, pts[n], pts[n + 1], lerp(r0, r1, n / (pts.length - 1)), lerp(r0, r1, (n + 1) / (pts.length - 1)), colour);
  }

  /** Clear cells of a part: those `fn(i, j, k)` says, within a box. */
  carve(part, lo, hi, fn = () => true) {
    this.each(part, lo, hi, (i, j, k) => (fn(i, j, k) ? false : undefined));
  }

  /** Recolour a part's voxels: `fn(i, j, k, colour)` gives the new colour (nothing keeps it, false clears). */
  recolour(part, fn) {
    this.vox.recolour(part, fn);
  }

  has(part, i, j, k) {
    return this.vox.filled(i, j, k, part);
  }

  /** Copy a part's voxels to another, mirrored across x = 0 (a left limb made into the right). */
  mirror(from, to) {
    for (const [key, c] of this.vox.parts.get(from)) {
      const [i, j, k] = cellOf(key);
      this.vox.set(to, -1 - i, j, k, c);
    }
  }

  /**
   * A clip: `keys` [{ t, turn: { bone: [x, y, z] }, move: { bone: [x, y, z] } }], moves in voxels.
   * `scale` keys ({ bone: [x, y, z] }) grow or shrink a bone. `hold`: seconds its last pose is held
   * after its last key (a clip played once fades out as it ends: a death holds until the blow).
   */
  clip(name, keys, { hold = 0 } = {}) {
    const last = keys[keys.length - 1];
    this.clips.push({ name, keys: hold ? [...keys, { ...last, t: last.t + hold }] : keys });
  }

  /** Write the GLB and check it: the budgets, every vertex on one bone. Returns a line about it. */
  write(file, { maxTris = 30000, maxBytes = 400 * 1024 } = {}) {
    const P = this.pal;
    const { faces: list, hidden, before } = faces(this.vox, P, { merge: true });
    const A = atlasOf(list, P);
    const unit = this.voxel / this.scale;
    // Bones' places in metres (the file's), and each node's translation from its parent's.
    const world = new Map(this.bones.map((b) => [b.name, b.at.map((v) => v * unit)]));
    const nodes = [{ name: this.id, children: [] }];
    const nodeOf = new Map();
    for (const b of this.bones) {
      const w = world.get(b.name);
      const pw = b.parent ? world.get(b.parent) : [0, 0, 0];
      nodeOf.set(b.name, nodes.length);
      nodes.push({ name: b.name, translation: w.map((v, a) => round5(v - pw[a])), children: [] });
      nodes[b.parent ? nodeOf.get(b.parent) : 0].children.push(nodes.length - 1);
    }
    const meshNode = nodes.length;
    nodes.push({ name: `${this.id}_mesh` });
    nodes[0].children.push(meshNode);
    for (const n of nodes) if (n.children && !n.children.length) delete n.children;
    const boneIndex = new Map(this.bones.map((b, i) => [b.name, i]));
    const order = list.map((_, i) => i).sort((a, b) => boneIndex.get(list[a].part) - boneIndex.get(list[b].part) || a - b);
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
        jo.push(boneIndex.get(f.part), 0, 0, 0);
        we.push(255, 0, 0, 0);
      }
      idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
    }
    for (const p of pos) if (p < -128 || p > 127) throw new Error(`${this.id}: a voxel beyond a byte's reach (${p})`);
    const ibm = new Float32Array(this.bones.length * 16);
    this.bones.forEach((b, n) => {
      const w = world.get(b.name);
      for (let k = 0; k < 3; k++) ibm[n * 16 + k * 5] = unit;
      ibm[n * 16 + 15] = 1;
      for (let k = 0; k < 3; k++) ibm[n * 16 + 12 + k] = -w[k];
    });
    let bytes = writeGlb({
      generator: 'Arena src/games/arena/tools/bosses/build.mjs',
      nodes,
      sceneName: this.id,
      meshName: this.id,
      meshNode,
      attributes: {
        POSITION: { values: pos, componentType: 5120, type: 'VEC3', minmax: true },
        NORMAL: { values: nor, componentType: 5120, type: 'VEC3', normalized: true },
        TEXCOORD_0: { values: uv, componentType: 5123, type: 'VEC2', normalized: true },
        JOINTS_0: { values: jo, componentType: 5121, type: 'VEC4' },
        WEIGHTS_0: { values: we, componentType: 5121, type: 'VEC4', normalized: true },
      },
      indices: idx,
      skin: { name: `${this.id}_skeleton`, joints: this.bones.map((b) => nodeOf.get(b.name)), skeleton: nodeOf.get(this.bones[0].name), inverseBindMatrices: ibm },
      material: { name: this.id, albedo: png(A.albedo), mr: png(A.mr), glow: png(A.glow) },
      compress: true,
      quantized: true,
    });
    if (this.clips.length) bytes = withClips(bytes, this.clips.map((c) => this.channels(c, nodeOf, unit)));
    writeFileSync(file, bytes);
    const tris = idx.length / 3;
    check(readFileSync(file), this, tris);
    if (tris > maxTris) throw new Error(`${this.id}: ${tris} triangles (budget ${maxTris})`);
    if (bytes.length > maxBytes) throw new Error(`${this.id}: ${bytes.length} bytes (budget ${maxBytes})`);
    let top = 0;
    for (const key of [...this.vox.parts.values()].flatMap((p) => [...p.keys()])) top = Math.max(top, Math.floor(key / 1024) % 1024 - 512 + 1);
    return `${this.id}.glb: ${this.vox.count} voxels, ${before} faces as ${list.length} quads, ${tris} tris (${hidden} hidden), ${A.tiles} tiles, ${this.bones.length} bones, ${this.clips.length} clips, ${(bytes.length / 1024).toFixed(1)} KB, ${(top * this.voxel).toFixed(2)} m tall`;
  }

  /** A clip's channels: each moved bone's rotations (and translations, scales) at every key. */
  channels(clip, nodeOf, unit) {
    const keys = clip.keys;
    const times = keys.map((k) => k.t);
    const out = [];
    const bones = (field) => [...new Set(keys.flatMap((k) => Object.keys(k[field] ?? {})))];
    for (const b of bones('turn')) {
      if (!this.byName.has(b)) throw new Error(`${this.id} ${clip.name}: no bone ${b}`);
      out.push({ node: nodeOf.get(b), path: 'rotation', times, values: keys.flatMap((k) => quat(...(k.turn?.[b] ?? [0, 0, 0]))) });
    }
    for (const b of bones('move')) {
      const bone = this.byName.get(b);
      if (!bone) throw new Error(`${this.id} ${clip.name}: no bone ${b}`);
      const parent = bone.parent ? this.byName.get(bone.parent).at : [0, 0, 0];
      out.push({ node: nodeOf.get(b), path: 'translation', times, values: keys.flatMap((k) => bone.at.map((v, a) => round5((v - parent[a] + (k.move?.[b]?.[a] ?? 0)) * unit))) });
    }
    for (const b of bones('scale')) {
      if (!this.byName.has(b)) throw new Error(`${this.id} ${clip.name}: no bone ${b}`);
      out.push({ node: nodeOf.get(b), path: 'scale', times, values: keys.flatMap((k) => k.scale?.[b] ?? [1, 1, 1]) });
    }
    return { name: clip.name, channels: out };
  }
}

const round5 = (v) => Math.round(v * 1e5) / 1e5;

/** A rotation [x, y, z] (radians, three.js's 'XYZ' order) as a quaternion [x, y, z, w]. */
export function quat(x, y, z) {
  const c1 = Math.cos(x / 2), c2 = Math.cos(y / 2), c3 = Math.cos(z / 2);
  const s1 = Math.sin(x / 2), s2 = Math.sin(y / 2), s3 = Math.sin(z / 2);
  return [s1 * c2 * c3 + c1 * s2 * s3, c1 * s2 * c3 - s1 * c2 * s3, c1 * c2 * s3 + s1 * s2 * c3, c1 * c2 * c3 - s1 * s2 * s3].map((v) => Math.round(v * 1e6) / 1e6);
}

/**
 * The atlas with its glowing tiles apart: the rest's atlas repeated down the top half of a
 * square one, the glowing faces' in the bottom half, and the emissive map in colour (each
 * texel's colour times its glow), as Blockfront's troopers' (`atlasOf` there).
 */
function atlasOf(list, P) {
  const glows = (f) => P.get(f.colour).glow > 0;
  const lit = list.filter(glows);
  const A1 = atlas(lit.length ? list.filter((f) => !glows(f)) : list, P);
  const A2 = lit.length ? atlas(lit, P) : null;
  const width = A1.width, height = A2 ? Math.max(width, 2 * Math.max(A1.height, A2.height)) : A1.height, half = height / 2;
  const rowBytes = width * 4;
  const image = (key) => {
    const px = new Uint8Array(width * height * 4);
    for (let y = 0; y < (A2 ? half : height); y++) px.set(A1[key].px.subarray((y % A1.height) * rowBytes, ((y % A1.height) + 1) * rowBytes), y * rowBytes);
    if (A2) for (let y = 0; y < half; y++) px.set(A2[key].px.subarray((y % A2.height) * rowBytes, ((y % A2.height) + 1) * rowBytes), (half + y) * rowBytes);
    return { w: width, h: height, px };
  };
  const albedo = image('albedo'), mr = image('mr');
  const glow = { w: width, h: height, px: new Uint8Array(width * height * 4) };
  for (let o = 0; o < glow.px.length; o += 4) {
    const y = Math.floor(o / rowBytes);
    const level = A2 && y >= half ? A2.glow.px[((y - half) % A2.height) * rowBytes + (o % rowBytes)] : 0;
    for (let ch = 0; ch < 3; ch++) glow.px[o + ch] = Math.round((albedo.px[o + ch] * level) / 255);
    glow.px[o + 3] = 255;
  }
  let n1 = 0, n2 = 0;
  const uvs = list.map((f) => (A2 && glows(f) ? A2.uvs[n2++].map(([u, v]) => [u, (v * A2.height + half) / height]) : A1.uvs[n1++].map(([u, v]) => [u, (v * A1.height) / height])));
  return { width, height, tiles: A1.tiles + (A2?.tiles ?? 0), albedo, mr, glow, uvs };
}

/**
 * Clips written into a GLB (`writeGlb` has none): their keyframes appended to the binary chunk
 * (uncompressed, after whatever's there), with their accessors, views and animations.
 */
function withClips(buf, clips) {
  const jlen = buf.readUInt32LE(12);
  const json = JSON.parse(buf.subarray(20, 20 + jlen).toString('utf8'));
  const blen = buf.readUInt32LE(20 + jlen);
  const parts = [buf.subarray(28 + jlen, 28 + jlen + blen)];
  let offset = blen;
  const put = (floats) => {
    const b = Buffer.from(new Float32Array(floats).buffer);
    json.bufferViews.push({ buffer: 0, byteOffset: offset, byteLength: b.length });
    parts.push(b);
    offset += b.length;
    return json.bufferViews.length - 1;
  };
  const accessor = (floats, type, minmax = false) => {
    const n = { SCALAR: 1, VEC3: 3, VEC4: 4 }[type];
    const acc = { bufferView: put(floats), componentType: 5126, count: floats.length / n, type };
    if (minmax) Object.assign(acc, { min: [Math.min(...floats)], max: [Math.max(...floats)] });
    json.accessors.push(acc);
    return json.accessors.length - 1;
  };
  json.animations = clips.map((clip) => {
    const samplers = [];
    const channels = [];
    const inputs = new Map();
    for (const ch of clip.channels) {
      const key = ch.times.join();
      if (!inputs.has(key)) inputs.set(key, accessor(ch.times, 'SCALAR', true));
      samplers.push({ input: inputs.get(key), output: accessor(ch.values, ch.path === 'rotation' ? 'VEC4' : 'VEC3'), interpolation: 'LINEAR' });
      channels.push({ sampler: samplers.length - 1, target: { node: ch.node, path: ch.path } });
    }
    return { name: clip.name, samplers, channels };
  });
  const bin = Buffer.concat(parts);
  json.buffers[0].byteLength = bin.length;
  let jsonBuf = Buffer.from(JSON.stringify(json), 'utf8');
  jsonBuf = Buffer.concat([jsonBuf, Buffer.alloc((4 - (jsonBuf.length % 4)) % 4, 0x20)]);
  const header = Buffer.alloc(12);
  header.writeUInt32LE(0x46546c67, 0);
  header.writeUInt32LE(2, 4);
  header.writeUInt32LE(12 + 8 + jsonBuf.length + 8 + bin.length, 8);
  const jh = Buffer.alloc(8);
  jh.writeUInt32LE(jsonBuf.length, 0);
  jh.writeUInt32LE(0x4e4f534a, 4);
  const bh = Buffer.alloc(8);
  bh.writeUInt32LE(bin.length, 0);
  bh.writeUInt32LE(0x004e4942, 4);
  return Buffer.concat([header, jh, jsonBuf, bh, bin]);
}

/** Read a GLB back and check it: one mesh, every vertex wholly on one bone, every triangle facing out, the clips' channels well formed. */
function check(buf, fig, tris) {
  const fail = (m) => {
    throw new Error(`${fig.id}.glb: ${m}`);
  };
  const { json, read } = readGlb(buf);
  if (json.meshes.length !== 1 || json.materials.length !== 1) fail('not one mesh, one material');
  const prim = json.meshes[0].primitives[0];
  const P = read(json.accessors[prim.attributes.POSITION]), N = read(json.accessors[prim.attributes.NORMAL]);
  const JO = read(json.accessors[prim.attributes.JOINTS_0]), WE = read(json.accessors[prim.attributes.WEIGHTS_0]), I = read(json.accessors[prim.indices]);
  const count = json.accessors[prim.attributes.POSITION].count;
  for (let i = 0; i < count; i++) if (JO[i * 4] >= fig.bones.length || WE[i * 4] !== 255 || WE[i * 4 + 1]) fail('a vertex not wholly on one bone');
  if (I.length / 3 !== tris) fail('triangle count');
  for (let t = 0; t < I.length; t += 3) {
    const [a, b, c] = [I[t], I[t + 1], I[t + 2]];
    const e1 = [0, 1, 2].map((k) => P[b * 3 + k] - P[a * 3 + k]), e2 = [0, 1, 2].map((k) => P[c * 3 + k] - P[a * 3 + k]);
    const cr = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
    if (cr[0] * N[a * 3] + cr[1] * N[a * 3 + 1] + cr[2] * N[a * 3 + 2] <= 0) fail('triangle winding');
  }
  for (const anim of json.animations ?? []) {
    for (const s of anim.samplers) {
      const input = json.accessors[s.input], output = json.accessors[s.output];
      if (input.count !== output.count) fail(`${anim.name}: keys and values differ`);
      const t = read(input);
      for (let i = 1; i < t.length; i++) if (!(t[i] > t[i - 1])) fail(`${anim.name}: times not increasing`);
    }
  }
}

export { cellKey, cellOf };
