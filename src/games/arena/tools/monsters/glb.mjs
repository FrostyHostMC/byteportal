/**
 * Writing a monster's voxels as a figure: one rigidly skinned mesh on a skeleton (the humanoid
 * rig's joints, or a beast's own bones), quantized and compressed as Blockfront's troopers are
 * (`blockfront/tools/troopers/build.mjs`, whose `glb` and `atlasOf` this follows), with
 * animation clips for the beasts (the toolkit writes none: they're added to the file after).
 */
import { atlas, cellKey, faces, png, quadCorners, readGlb, writeGlb, DIRS } from '../voxel.mjs';

/**
 * The atlas, its glowing tiles apart (as the troopers'): mip levels blend neighbouring tiles, so
 * the faces that glow get an atlas of their own in the bottom half of a square one, the rest's
 * repeated round it, and the emissive map is each texel's own colour times its glow.
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
 * A figure as a GLB. `skeleton`: its joints in order, each `{ name, parent, at }` (`at` in voxels,
 * the model's space: +x its left, +z ahead, y up from the ground), `bone: false` for an empty (a
 * grip); every voxel part must be a bone's. `scale`: voxels a metre. `clips`: its animations
 * (`clip()`). `extras`: the root's (a humanoid's `wear`). `rigid`: groups of parts that hardly
 * turn on each other (a trunk), whose buried faces between them can go.
 */
export function figureGlb({ id, title, vox, palette, skeleton, scale, clips = [], extras = {}, generator, rigid = [] }) {
  const bones = skeleton.filter((j) => j.bone !== false);
  const boneOf = new Map(bones.map((j, i) => [j.name, i]));
  for (const part of vox.parts.keys()) if (vox.parts.get(part).size && !boneOf.has(part)) throw new Error(`${id}: part ${part} is no bone`);
  const all = faces(vox, palette, { merge: true });
  const { hidden, before } = all;
  // A face toward another part of its rigid group (the trunk: parts that hardly turn on each
  // other), buried three voxels deep in the group, never shows: dropped. Faces between parts that
  // swing apart (a limb against the trunk) are kept: they show when it swings.
  const group = new Map(rigid.flatMap((g, n) => g.map((part) => [part, n])));
  const inGroup = (g, i, j, k) => {
    for (const [part, cells] of vox.parts) if (group.get(part) === g && cells.has(cellKey(i, j, k))) return true;
    return false;
  };
  const deep = (f) => {
    const g = group.get(f.part);
    if (g === undefined || f.ao !== 15 || (f.du ?? 1) > 1 || (f.dv ?? 1) > 1) return false;
    const n = DIRS[f.dir].n;
    for (let d = 1; d <= 3; d++) if (!inGroup(g, f.cell[0] + n[0] * d, f.cell[1] + n[1] * d, f.cell[2] + n[2] * d)) return false;
    return true;
  };
  const list = all.faces.filter((f) => !deep(f));
  const A = atlasOf(list, palette);
  const nodes = [{ name: id, children: [], extras: { title, ...extras } }];
  const nodeOf = new Map();
  const world = new Map();
  for (const j of skeleton) {
    const at = j.at.map((v) => v / scale);
    const p = j.parent ? world.get(j.parent) : [0, 0, 0];
    if (!p) throw new Error(`${id}: ${j.name}'s parent ${j.parent} comes after it`);
    const t = at.map((v, a) => Math.round((v - p[a]) * 1e5) / 1e5);
    world.set(j.name, p.map((v, a) => v + t[a]));
    nodeOf.set(j.name, nodes.length);
    nodes.push({ name: j.name, translation: t, children: [] });
    nodes[j.parent ? nodeOf.get(j.parent) : 0].children.push(nodeOf.get(j.name));
  }
  const bodyNode = nodes.length;
  nodes.push({ name: 'body' });
  nodes[0].children.push(bodyNode);
  for (const n of nodes) if (n.children && !n.children.length) delete n.children;
  const order = list.map((_, i) => i).sort((a, b) => boneOf.get(list[a].part) - boneOf.get(list[b].part) || a - b);
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
      jo.push(boneOf.get(f.part), 0, 0, 0);
      we.push(255, 0, 0, 0);
    }
    idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }
  for (const p of pos) if (p < -128 || p > 127) throw new Error(`${id}: a voxel beyond a byte's reach (${p})`);
  // Each bone's inverse bind matrix: from voxel coordinates into its joint's space at rest.
  const ibm = new Float32Array(bones.length * 16);
  bones.forEach((j, n) => {
    for (let k = 0; k < 3; k++) ibm[n * 16 + k * 5] = 1 / scale;
    ibm[n * 16 + 15] = 1;
    for (let k = 0; k < 3; k++) ibm[n * 16 + 12 + k] = -world.get(j.name)[k];
  });
  const root = skeleton[0].name;
  let bytes = writeGlb({
    generator,
    nodes,
    sceneName: id,
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
    skin: { name: `${id}_skeleton`, joints: bones.map((j) => nodeOf.get(j.name)), skeleton: nodeOf.get(root), inverseBindMatrices: ibm },
    material: { name: id, albedo: png(A.albedo), mr: png(A.mr), glow: png(A.glow) },
    compress: true,
    quantized: true,
  });
  if (clips.length) bytes = withClips(bytes, clips, nodeOf, scale);
  return { bytes, world, stats: { voxels: vox.count, quads: list.length, faces: before, hidden, tris: idx.length / 3, tiles: A.tiles, atlas: `${A.width}x${A.height}` } };
}

// ---------------------------------------------------------------------------------------------
// Clips

/** A turn as a quaternion [x, y, z, w], from angles (radians) about x, then y, then z (applied z, y, x: XYZ). */
export function quat(x = 0, y = 0, z = 0) {
  const [cx, sx, cy, sy, cz, sz] = [Math.cos(x / 2), Math.sin(x / 2), Math.cos(y / 2), Math.sin(y / 2), Math.cos(z / 2), Math.sin(z / 2)];
  return [sx * cy * cz + cx * sy * sz, cx * sy * cz - sx * cy * sz, cx * cy * sz + sx * sy * cz, cx * cy * cz - sx * sy * sz];
}

/**
 * A clip: `name`, `duration` (seconds), and for each animated joint its keys, each `[t (0..1 of
 * the clip), value]`: `turn` keys are [x, y, z] angles (radians, `quat`'s), `move` keys an
 * offset in voxels from where the joint rests, `size` keys a scale ([x, y, z], or one number).
 * A looping clip should end as it begins.
 */
export function clip(name, duration, joints) {
  return { name, duration, joints };
}

/** The file with its clips added: their keys in the binary chunk, each a channel on its joint. */
function withClips(bytes, clips, nodeOf, scale) {
  const { json } = readGlb(bytes);
  const jlen = bytes.readUInt32LE(12);
  const bin = bytes.subarray(20 + jlen + 8);
  const extra = [];
  let offset = bin.length;
  const put = (floats) => {
    const buf = Buffer.from(new Float32Array(floats).buffer);
    extra.push(buf);
    json.bufferViews.push({ buffer: 0, byteOffset: offset, byteLength: buf.length });
    offset += buf.length;
    return json.bufferViews.length - 1;
  };
  const accessor = (floats, type, minmax) => {
    const n = type === 'SCALAR' ? 1 : type === 'VEC3' ? 3 : 4;
    const a = { bufferView: put(floats), componentType: 5126, count: floats.length / n, type };
    if (minmax) Object.assign(a, { min: [Math.min(...floats)], max: [Math.max(...floats)] });
    json.accessors.push(a);
    return json.accessors.length - 1;
  };
  json.animations = clips.map((c) => {
    const samplers = [];
    const channels = [];
    for (const [joint, keys] of Object.entries(c.joints)) {
      const node = nodeOf.get(joint);
      if (node === undefined) throw new Error(`clip ${c.name}: no joint ${joint}`);
      const rest = json.nodes[node].translation ?? [0, 0, 0];
      for (const [path, list] of Object.entries(keys)) {
        const times = list.map(([t]) => Math.round(t * c.duration * 1e4) / 1e4);
        let values;
        let target;
        if (path === 'turn') {
          values = list.flatMap(([, v]) => quat(...v));
          target = 'rotation';
        } else if (path === 'move') {
          // Offsets in voxels: the file's metres are the joint's rest place plus the offset.
          values = list.flatMap(([, v]) => v.map((o, a) => rest[a] + o / scale));
          target = 'translation';
        } else if (path === 'size') {
          values = list.flatMap(([, v]) => (typeof v === 'number' ? [v, v, v] : v));
          target = 'scale';
        } else throw new Error(`clip ${c.name}: ${path}?`);
        samplers.push({ input: accessor(times, 'SCALAR', true), output: accessor(values, target === 'rotation' ? 'VEC4' : 'VEC3'), interpolation: 'LINEAR' });
        channels.push({ sampler: samplers.length - 1, target: { node, path: target } });
      }
    }
    return { name: c.name, samplers, channels };
  });
  const added = Buffer.concat(extra);
  const binOut = Buffer.concat([bin, added]);
  json.buffers[0].byteLength = binOut.length;
  let jsonBuf = Buffer.from(JSON.stringify(json), 'utf8');
  jsonBuf = Buffer.concat([jsonBuf, Buffer.alloc((4 - (jsonBuf.length % 4)) % 4, 0x20)]);
  const header = Buffer.alloc(12);
  header.writeUInt32LE(0x46546c67, 0);
  header.writeUInt32LE(2, 4);
  header.writeUInt32LE(12 + 8 + jsonBuf.length + 8 + binOut.length, 8);
  const jh = Buffer.alloc(8);
  jh.writeUInt32LE(jsonBuf.length, 0);
  jh.writeUInt32LE(0x4e4f534a, 4);
  const bh = Buffer.alloc(8);
  bh.writeUInt32LE(binOut.length, 0);
  bh.writeUInt32LE(0x004e4942, 4);
  return Buffer.concat([header, jh, jsonBuf, bh, binOut]);
}
