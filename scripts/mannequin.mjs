#!/usr/bin/env node
/**
 * Plain figures on the humanoid rig (docs/HUMANOID.md), for trying the platform's humanoid
 * animation, written to `src/games/gallery/models/`:
 * - `mannequin.glb`: rigid parts (tapered boxes, a joint per part), fists with their grip points.
 * - `mannequin_skinned.glb`: one skinned mesh (smooth limbs that bend at the joints) on bones
 *   named as the rig's joints, resting straight as the rig does, grips on the fists.
 * - `mannequin_mixamo.glb`: the same skin on a Mixamo-style skeleton: bones named `mixamorig:…`
 *   (with shoulder, mid-spine, finger and toe bones the rig doesn't use), each turned to point
 *   along its own +y, under an armature turned and scaled 0.01 as Blender exports one, resting
 *   in a T-pose; no grips.
 * The skinned ones have two clips, made once in the rig's terms and turned into each skeleton's
 * own: `wave` (the right arm, looped) and `cheer` (the whole body: arms up, hopping).
 * Dependency-free: `node scripts/mannequin.mjs`.
 */
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const DIR = join(dirname(fileURLToPath(import.meta.url)), '../src/games/gallery/models');

/** A box from `lo` to `hi`, narrowed at the top or bottom (`taper`: the top face's scale), flat-shaded. */
function box(lo, hi, taper = 1) {
  const [x0, y0, z0] = lo;
  const [x1, y1, z1] = hi;
  const cx = (x0 + x1) / 2;
  const cz = (z0 + z1) / 2;
  const top = (x, z) => [cx + (x - cx) * taper, z === undefined ? 0 : cz + (z - cz) * taper];
  const v = [
    [x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1],
    [top(x0, z0)[0], y1, top(x0, z0)[1]], [top(x1, z0)[0], y1, top(x1, z0)[1]], [top(x1, z1)[0], y1, top(x1, z1)[1]], [top(x0, z1)[0], y1, top(x0, z1)[1]],
  ];
  const faces = [[0, 1, 2, 3], [7, 6, 5, 4], [0, 4, 5, 1], [1, 5, 6, 2], [2, 6, 7, 3], [3, 7, 4, 0]];
  const pos = [];
  const nor = [];
  for (const f of faces) {
    const [a, b, c, d] = f.map((i) => v[i]);
    const n = normal(a, b, c);
    for (const p of [a, b, c, a, c, d]) {
      pos.push(...p);
      nor.push(...n);
    }
  }
  return { pos, nor };
}

function normal(a, b, c) {
  const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const w = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
  const n = [u[1] * w[2] - u[2] * w[1], u[2] * w[0] - u[0] * w[2], u[0] * w[1] - u[1] * w[0]];
  const l = Math.hypot(...n) || 1;
  // Faces wind counter-clockwise seen from outside: the normal points out.
  return n.map((x) => x / l);
}

const MATERIALS = [
  { name: 'suit', color: [0.05, 0.05, 0.06], metal: 0, rough: 0.8 },
  { name: 'skin', color: [0.75, 0.5, 0.36], metal: 0, rough: 0.6 },
  { name: 'shirt', color: [0.9, 0.88, 0.84], metal: 0, rough: 0.85 },
  { name: 'shoe', color: [0.02, 0.02, 0.02], metal: 0, rough: 0.25 },
];

// joint: [name, parent, translation]; parts: [joint, material, lo, hi, taper]
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

const PARTS = [
  ['hips', 0, [-0.17, -0.1, -0.1], [0.17, 0.1, 0.1], 1],
  ['spine', 1, [-0.15, -0.02, -0.09], [0.15, 0.24, 0.1], 1.08],
  ['chest', 0, [-0.21, -0.02, -0.12], [0.21, 0.26, 0.12], 1.05],
  ['chest', 2, [-0.05, 0.05, 0.1], [0.05, 0.24, 0.13], 1],
  ['neck', 1, [-0.05, -0.02, -0.05], [0.05, 0.1, 0.05], 1],
  ['head', 1, [-0.1, 0, -0.11], [0.1, 0.25, 0.11], 0.9],
  ['head', 0, [-0.105, 0.2, -0.12], [0.105, 0.28, 0.1], 0.9],
  ['upperArmL', 0, [-0.055, -0.3, -0.055], [0.055, 0.04, 0.055], 1.1],
  ['lowerArmL', 0, [-0.048, -0.24, -0.048], [0.048, 0.03, 0.048], 1.1],
  ['lowerArmL', 2, [-0.045, -0.26, -0.045], [0.045, -0.2, 0.045], 1],
  ['handL', 1, [-0.04, -0.13, -0.03], [0.04, 0, 0.06], 1],
  ['upperArmR', 0, [-0.055, -0.3, -0.055], [0.055, 0.04, 0.055], 1.1],
  ['lowerArmR', 0, [-0.048, -0.24, -0.048], [0.048, 0.03, 0.048], 1.1],
  ['lowerArmR', 2, [-0.045, -0.26, -0.045], [0.045, -0.2, 0.045], 1],
  ['handR', 1, [-0.04, -0.13, -0.03], [0.04, 0, 0.06], 1],
  ['upperLegL', 0, [-0.075, -0.45, -0.08], [0.075, 0.05, 0.08], 1.15],
  ['lowerLegL', 0, [-0.06, -0.41, -0.06], [0.06, 0.03, 0.07], 1.1],
  ['footL', 3, [-0.055, -0.07, -0.07], [0.055, 0.04, 0.2], 1],
  ['upperLegR', 0, [-0.075, -0.45, -0.08], [0.075, 0.05, 0.08], 1.15],
  ['lowerLegR', 0, [-0.06, -0.41, -0.06], [0.06, 0.03, 0.07], 1.1],
  ['footR', 3, [-0.055, -0.07, -0.07], [0.055, 0.04, 0.2], 1],
];

// ---------------------------------------------------------------------------------------------
// Writing a GLB
// ---------------------------------------------------------------------------------------------

/** A file being put together: binary data (a buffer view and an accessor per array) and JSON. */
class Gltf {
  bin = [];
  byteLength = 0;
  bufferViews = [];
  accessors = [];

  /** An accessor for `data`: `type` VEC2/VEC3/VEC4/MAT4/SCALAR, floats unless `component` (5121: unsigned bytes). */
  add(data, type, { minmax = false, component = 5126, vertex = true } = {}) {
    const bytes = Buffer.from((component === 5121 ? new Uint8Array(data) : new Float32Array(data)).buffer);
    this.bufferViews.push({ buffer: 0, byteOffset: this.byteLength, byteLength: bytes.length, ...(vertex ? { target: 34962 } : {}) });
    this.bin.push(bytes);
    this.byteLength += bytes.length;
    const n = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 }[type];
    const acc = { bufferView: this.bufferViews.length - 1, componentType: component, count: data.length / n, type };
    if (minmax) {
      const min = new Array(n).fill(Infinity);
      const max = new Array(n).fill(-Infinity);
      for (let i = 0; i < data.length; i += n) for (let k = 0; k < n; k++) {
        min[k] = Math.min(min[k], data[i + k]);
        max[k] = Math.max(max[k], data[i + k]);
      }
      Object.assign(acc, { min, max });
    }
    this.accessors.push(acc);
    return this.accessors.length - 1;
  }

  write(file, json) {
    const full = { ...json, accessors: this.accessors, bufferViews: this.bufferViews, buffers: [{ byteLength: this.byteLength }] };
    const pad = (b, fill) => (b.length % 4 ? Buffer.concat([b, Buffer.alloc(4 - (b.length % 4), fill)]) : b);
    const jsonBuf = pad(Buffer.from(JSON.stringify(full)), 0x20);
    const binBuf = pad(Buffer.concat(this.bin), 0);
    const header = Buffer.alloc(12);
    header.writeUInt32LE(0x46546c67, 0);
    header.writeUInt32LE(2, 4);
    header.writeUInt32LE(12 + 8 + jsonBuf.length + 8 + binBuf.length, 8);
    const chunk = (buf, type) => {
      const h = Buffer.alloc(8);
      h.writeUInt32LE(buf.length, 0);
      h.writeUInt32LE(type, 4);
      return Buffer.concat([h, buf]);
    };
    writeFileSync(file, Buffer.concat([header, chunk(jsonBuf, 0x4e4f534a), chunk(binBuf, 0x004e4942)]));
    console.log(`wrote ${file} (${(12 + 16 + jsonBuf.length + binBuf.length) / 1024 | 0} KB)`);
  }
}

const materials = () => MATERIALS.map((m) => ({ name: m.name, pbrMetallicRoughness: { baseColorFactor: [...m.color, 1], metallicFactor: m.metal, roughnessFactor: m.rough } }));

// ---------------------------------------------------------------------------------------------
// The rigid mannequin
// ---------------------------------------------------------------------------------------------

function rigid() {
  // One mesh per (joint, material): a primitive each.
  const meshes = new Map();
  for (const [joint, mat, lo, hi, taper] of PARTS) {
    const key = `${joint}|${mat}`;
    const m = meshes.get(key) ?? { joint, mat, pos: [], nor: [] };
    const b = box(lo, hi, taper);
    m.pos.push(...b.pos);
    m.nor.push(...b.nor);
    meshes.set(key, m);
  }
  const g = new Gltf();
  const gltfMeshes = [];
  const nodes = [{ name: 'mannequin', children: [] }];
  const index = new Map();
  for (const [name, parent, t] of JOINTS) {
    nodes.push({ name, translation: t, children: [] });
    index.set(name, nodes.length - 1);
    (parent ? nodes[index.get(parent)] : nodes[0]).children.push(nodes.length - 1);
  }
  for (const m of meshes.values()) {
    const p = g.add(m.pos, 'VEC3', { minmax: true });
    const n = g.add(m.nor, 'VEC3');
    gltfMeshes.push({ primitives: [{ attributes: { POSITION: p, NORMAL: n }, material: m.mat }] });
    nodes.push({ name: `${m.joint}_${MATERIALS[m.mat].name}`, mesh: gltfMeshes.length - 1 });
    nodes[index.get(m.joint)].children.push(nodes.length - 1);
  }
  for (const n of nodes) if (n.children && !n.children.length) delete n.children;
  g.write(join(DIR, 'mannequin.glb'), { asset: { version: '2.0', generator: 'blockyard mannequin' }, scene: 0, scenes: [{ nodes: [0] }], nodes, meshes: gltfMeshes, materials: materials() });
}

// ---------------------------------------------------------------------------------------------
// Rotations and transforms (quaternions [x, y, z, w]; a transform is { p, q, s }, uniform scale)
// ---------------------------------------------------------------------------------------------

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
const qinv = (q) => [-q[0], -q[1], -q[2], q[3]];
const qrot = (q, v) => qmul(qmul(q, [v[0], v[1], v[2], 0]), qinv(q)).slice(0, 3);
const X = [1, 0, 0];
const Y = [0, 1, 0];
const Z = [0, 0, 1];
const I = [0, 0, 0, 1];
/** Euler angles as the rig takes them (YXZ: turn, then tip, then roll). */
const euler = (x, y = 0, z = 0) => qmul(qmul(qaxis(Y, y), qaxis(X, x)), qaxis(Z, z));
/** The shortest turn from one direction to another. */
const qfrom = (a, b) => {
  const la = Math.hypot(...a);
  const lb = Math.hypot(...b);
  const u = a.map((v) => v / la);
  const w = b.map((v) => v / lb);
  const d = u[0] * w[0] + u[1] * w[1] + u[2] * w[2];
  const c = [u[1] * w[2] - u[2] * w[1], u[2] * w[0] - u[0] * w[2], u[0] * w[1] - u[1] * w[0]];
  const q = [c[0], c[1], c[2], 1 + d];
  const l = Math.hypot(...q);
  return q.map((v) => v / l);
};
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const scale = (a, k) => a.map((v) => v * k);
/** `t` in `parent`'s space: its local transform. */
const local = (parent, t) => ({ p: scale(qrot(qinv(parent.q), sub(t.p, parent.p)), 1 / parent.s), q: qmul(qinv(parent.q), t.q), s: t.s / parent.s });
/** A point through a transform. */
const apply = (t, v) => add(t.p, qrot(t.q, scale(v, t.s)));
/** A point back into a transform's space. */
const unapply = (t, v) => scale(qrot(qinv(t.q), sub(v, t.p)), 1 / t.s);
/** The column-major matrix of a transform's inverse (an inverse bind matrix). */
function inverseMatrix(t) {
  const q = qinv(t.q);
  const k = 1 / t.s;
  const col = (v) => scale(qrot(q, v), k);
  const [c0, c1, c2] = [col(X), col(Y), col(Z)];
  const p = scale(qrot(q, t.p), -k);
  return [...c0, 0, ...c1, 0, ...c2, 0, ...p, 1];
}
const round = (v) => v.map((x) => Math.round(x * 1e6) / 1e6);

// ---------------------------------------------------------------------------------------------
// The skin: smooth tubes along the body, standing straight as the rig does, each vertex weighted
// to up to four bones (by the rig's names, plus `fingers` and `toe` for the ends of the fists
// and shoes, and `spine1` for the middle of the back: a skeleton without them uses the hand, the
// foot and the spine).
// ---------------------------------------------------------------------------------------------

/**
 * A tube through `rings` (each `{ c: centre, r: [half-width, half-depth], w: { bone: weight } }`)
 * along `axis` (y: up; z: ahead), capped where asked: triangles with smooth normals.
 */
function tube(rings, { axis = 'y', sides = 10, capStart = false, capEnd = false } = {}) {
  const out = [];
  const ring = (g) =>
    Array.from({ length: sides }, (_, k) => {
      const a = (k / sides) * Math.PI * 2;
      const [cx, cy] = [Math.cos(a), Math.sin(a)];
      const off = axis === 'y' ? [g.r[0] * cx, 0, g.r[1] * cy] : [g.r[0] * cx, g.r[1] * cy, 0];
      const n = axis === 'y' ? [cx / g.r[0], 0, cy / g.r[1]] : [cx / g.r[0], cy / g.r[1], 0];
      const l = Math.hypot(...n);
      return { p: add(g.c, off), n: n.map((v) => v / l), w: g.w };
    });
  const rs = rings.map(ring);
  const tri = (a, b, c, flatN) => {
    // Wound to face out (the way the normals point).
    const f = normal(a.p, b.p, c.p);
    const ref = flatN ?? add(add(a.n, b.n), c.n);
    const [x, y, z] = f[0] * ref[0] + f[1] * ref[1] + f[2] * ref[2] < 0 ? [a, c, b] : [a, b, c];
    for (const v of [x, y, z]) out.push(flatN ? { ...v, n: flatN } : v);
  };
  for (let i = 0; i + 1 < rs.length; i++) {
    for (let k = 0; k < sides; k++) {
      const [a, b, c, d] = [rs[i][k], rs[i][(k + 1) % sides], rs[i + 1][(k + 1) % sides], rs[i + 1][k]];
      tri(a, b, c);
      tri(a, c, d);
    }
  }
  const cap = (r, g, dir) => {
    const centre = { p: g.c, w: g.w };
    for (let k = 0; k < sides; k++) tri(centre, r[k], r[(k + 1) % sides], dir);
  };
  const along = axis === 'y' ? Y : Z;
  if (capStart) cap(rs[0], rings[0], scale(along, -1));
  if (capEnd) cap(rs[rs.length - 1], rings[rings.length - 1], along);
  return out;
}

/** The mannequin's skin, a list of triangles' corners per material. */
function skinParts() {
  const parts = MATERIALS.map(() => []);
  const r = (y, rx, rz, w, x = 0, z = 0) => ({ c: [x, y, z], r: [rx, rz], w });
  // The body: pelvis, belly, chest to the shoulders.
  parts[0].push(
    ...tube(
      [
        r(0.84, 0.15, 0.095, { hips: 1 }),
        r(0.95, 0.17, 0.105, { hips: 1 }),
        r(1.02, 0.16, 0.1, { hips: 0.5, spine: 0.5 }),
        r(1.1, 0.15, 0.1, { spine: 1 }),
        r(1.18, 0.155, 0.103, { spine1: 1 }),
        r(1.26, 0.175, 0.11, { spine1: 0.5, chest: 0.5 }),
        r(1.34, 0.2, 0.118, { chest: 1 }),
        r(1.44, 0.21, 0.12, { chest: 1 }),
        r(1.51, 0.18, 0.1, { chest: 1 }),
      ],
      { capStart: true, capEnd: true },
    ),
  );
  // A shirt front.
  parts[2].push(...tube([r(1.3, 0.05, 0.02, { chest: 1 }, 0, 0.11), r(1.47, 0.05, 0.02, { chest: 1 }, 0, 0.105)], { sides: 6, capStart: true, capEnd: true }));
  // Neck and head.
  parts[1].push(...tube([r(1.47, 0.05, 0.05, { chest: 0.5, neck: 0.5 }), r(1.54, 0.052, 0.052, { neck: 1 }), r(1.6, 0.055, 0.055, { neck: 0.5, head: 0.5 })], { sides: 8 }));
  parts[1].push(...tube([r(1.58, 0.07, 0.075, { head: 1 }), r(1.63, 0.1, 0.11, { head: 1 }), r(1.74, 0.105, 0.115, { head: 1 }), r(1.8, 0.098, 0.108, { head: 1 })], { capStart: true }));
  parts[0].push(...tube([r(1.79, 0.108, 0.118, { head: 1 }, 0, -0.005), r(1.87, 0.09, 0.1, { head: 1 }, 0, -0.005)], { capEnd: true }));
  for (const [s, x] of [['L', 0.19], ['R', -0.19]]) {
    const b = (n) => `${n}${s}`;
    // The arm, bending at the elbow; the fist, bending at the wrist.
    parts[0].push(
      ...tube([
        r(1.5, 0.05, 0.05, { chest: 0.5, [b('upperArm')]: 0.5 }, x),
        r(1.44, 0.057, 0.057, { [b('upperArm')]: 1 }, x),
        r(1.3, 0.053, 0.053, { [b('upperArm')]: 1 }, x),
        r(1.22, 0.05, 0.05, { [b('upperArm')]: 0.8, [b('lowerArm')]: 0.2 }, x),
        r(1.18, 0.049, 0.049, { [b('upperArm')]: 0.5, [b('lowerArm')]: 0.5 }, x),
        r(1.14, 0.048, 0.048, { [b('upperArm')]: 0.2, [b('lowerArm')]: 0.8 }, x),
        r(1.04, 0.045, 0.045, { [b('lowerArm')]: 1 }, x),
        r(0.97, 0.041, 0.041, { [b('lowerArm')]: 0.9, [b('hand')]: 0.1 }, x),
      ]),
    );
    parts[2].push(...tube([r(0.97, 0.041, 0.041, { [b('lowerArm')]: 0.9, [b('hand')]: 0.1 }, x), r(0.93, 0.039, 0.042, { [b('lowerArm')]: 0.5, [b('hand')]: 0.5 }, x)]));
    parts[1].push(
      ...tube(
        [
          r(0.93, 0.039, 0.042, { [b('lowerArm')]: 0.5, [b('hand')]: 0.5 }, x),
          r(0.9, 0.042, 0.052, { [b('hand')]: 1 }, x, 0.01),
          r(0.85, 0.044, 0.056, { [b('hand')]: 0.6, [b('fingers')]: 0.4 }, x, 0.015),
          r(0.8, 0.036, 0.045, { [b('fingers')]: 1 }, x, 0.012),
        ],
        { capEnd: true },
      ),
    );
  }
  for (const [s, x] of [['L', 0.1], ['R', -0.1]]) {
    const b = (n) => `${n}${s}`;
    // The leg, bending at the knee; the shoe, at the ankle and the toes.
    parts[0].push(
      ...tube([
        r(0.92, 0.075, 0.08, { hips: 0.5, [b('upperLeg')]: 0.5 }, x),
        r(0.85, 0.078, 0.082, { [b('upperLeg')]: 1 }, x),
        r(0.7, 0.07, 0.074, { [b('upperLeg')]: 1 }, x),
        r(0.54, 0.062, 0.066, { [b('upperLeg')]: 0.8, [b('lowerLeg')]: 0.2 }, x),
        r(0.48, 0.059, 0.063, { [b('upperLeg')]: 0.5, [b('lowerLeg')]: 0.5 }, x),
        r(0.43, 0.057, 0.061, { [b('upperLeg')]: 0.2, [b('lowerLeg')]: 0.8 }, x),
        r(0.3, 0.053, 0.056, { [b('lowerLeg')]: 1 }, x),
        r(0.14, 0.045, 0.048, { [b('lowerLeg')]: 0.8, [b('foot')]: 0.2 }, x),
        r(0.08, 0.043, 0.046, { [b('lowerLeg')]: 0.5, [b('foot')]: 0.5 }, x),
      ]),
    );
    const f = (z, rx, ry, w, y = 0.045) => ({ c: [x, y, z], r: [rx, ry], w });
    parts[3].push(
      ...tube(
        [
          f(-0.075, 0.045, 0.035, { [b('foot')]: 1 }, 0.05),
          f(-0.03, 0.055, 0.05, { [b('foot')]: 1 }),
          f(0.06, 0.056, 0.045, { [b('foot')]: 0.7, [b('toe')]: 0.3 }, 0.04),
          f(0.14, 0.055, 0.035, { [b('toe')]: 1 }, 0.035),
          f(0.2, 0.045, 0.025, { [b('toe')]: 1 }, 0.033),
        ],
        { axis: 'z', capStart: true, capEnd: true },
      ),
    );
  }
  return parts;
}

// ---------------------------------------------------------------------------------------------
// Skeletons
// ---------------------------------------------------------------------------------------------

/** Where each of the rig's joints is standing straight (the model's space). */
const AT = (() => {
  const out = {};
  for (const [name, parent, t] of JOINTS) out[name] = parent ? add(out[parent], t) : [...t];
  return out;
})();
const RIG = JOINTS.map(([n]) => n).filter((n) => !n.startsWith('grip'));
const RIG_PARENT = Object.fromEntries(JOINTS.map(([n, p]) => [n, p]));

/**
 * A skeleton: its bones (name, parent, and each one's transform in the model's space standing
 * straight as the rig does, and as it rests in the file), which of the rig's joints each is,
 * and which of the skin's weights go to it.
 */
function nativeSkeleton() {
  const bones = RIG.map((n) => ({ name: n, parent: RIG_PARENT[n], straight: { p: AT[n], q: I, s: 1 } }));
  for (const b of bones) b.rest = b.straight;
  const joint = Object.fromEntries(RIG.map((n) => [n, n]));
  const weights = (w) => ({ fingersL: 'handL', fingersR: 'handR', toeL: 'footL', toeR: 'footR', spine1: 'spine' })[w] ?? w;
  const extras = [
    { name: 'gripL', parent: 'handL', rest: { p: AT.gripL, q: I, s: 1 } },
    { name: 'gripR', parent: 'handR', rest: { p: AT.gripR, q: I, s: 1 } },
  ];
  return { bones, joint, weights, extras, armature: null };
}

/**
 * Mixamo's: bones named its way, each turned so it points along its +y (with a twist of its
 * own about that), shoulder, mid-spine, finger and toe bones besides; under an armature turned
 * a quarter about x and scaled 0.01 (as Blender exports it), resting in a T-pose.
 */
function mixamoSkeleton() {
  const P = 'mixamorig:';
  const down = qaxis(Z, Math.PI);
  const bones = [];
  const bone = (name, parent, p, q, joint) => bones.push({ name: P + name, parent: parent && P + parent, straight: { p, q, s: 0.01 }, joint });
  bone('Hips', null, AT.hips, I, 'hips');
  bone('Spine', 'Hips', AT.spine, I, 'spine');
  bone('Spine1', 'Spine', [0, 1.16, 0], euler(0.05), null);
  bone('Spine2', 'Spine1', AT.chest, euler(-0.05), 'chest');
  bone('Neck', 'Spine2', AT.neck, euler(0.1), 'neck');
  bone('Head', 'Neck', AT.head, euler(-0.1), 'head');
  for (const [s, side, x] of [['L', 'Left', 1], ['R', 'Right', -1]]) {
    const twist = (a) => qmul(down, qaxis(Y, a * x));
    bone(`${side}Shoulder`, 'Spine2', [0.06 * x, 1.44, 0], qfrom(Y, [0.13 * x, 0.02, 0]), null);
    bone(`${side}Arm`, `${side}Shoulder`, AT[`upperArm${s}`], twist(0.35), `upperArm${s}`);
    bone(`${side}ForeArm`, `${side}Arm`, AT[`lowerArm${s}`], twist(-0.6), `lowerArm${s}`);
    bone(`${side}Hand`, `${side}ForeArm`, AT[`hand${s}`], twist(0.9), `hand${s}`);
    bone(`${side}HandMiddle1`, `${side}Hand`, add(AT[`hand${s}`], [0, -0.09, 0.012]), twist(0.9), null);
    bone(`${side}UpLeg`, 'Hips', AT[`upperLeg${s}`], qmul(down, qaxis(Y, 0.2 * x)), `upperLeg${s}`);
    bone(`${side}Leg`, `${side}UpLeg`, AT[`lowerLeg${s}`], qmul(down, qaxis(Y, -0.15 * x)), `lowerLeg${s}`);
    bone(`${side}Foot`, `${side}Leg`, AT[`foot${s}`], qfrom(Y, [0, -0.05, 0.14]), `foot${s}`);
    bone(`${side}ToeBase`, `${side}Foot`, add(AT[`foot${s}`], [0, -0.05, 0.14]), qfrom(Y, Z), null);
  }
  // The T-pose: each arm straight out to its side, turned up about the shoulder.
  for (const b of bones) {
    const m = b.name.match(/(Left|Right)(Arm|ForeArm|Hand|HandMiddle1)$/);
    if (!m) {
      b.rest = b.straight;
      continue;
    }
    const x = m[1] === 'Left' ? 1 : -1;
    const shoulder = AT[`upperArm${x > 0 ? 'L' : 'R'}`];
    const up = qaxis(Z, (x * Math.PI) / 2);
    b.rest = { p: add(shoulder, qrot(up, sub(b.straight.p, shoulder))), q: qmul(up, b.straight.q), s: b.straight.s };
  }
  const joint = Object.fromEntries(bones.filter((b) => b.joint).map((b) => [b.joint, b.name]));
  const named = { spine1: 'Spine1', fingersL: 'LeftHandMiddle1', fingersR: 'RightHandMiddle1', toeL: 'LeftToeBase', toeR: 'RightToeBase' };
  const weights = (w) => (named[w] ? P + named[w] : joint[w]);
  return { bones, joint, weights, extras: [], armature: { name: 'Armature', q: qaxis(X, Math.PI / 2), s: 0.01 } };
}

// ---------------------------------------------------------------------------------------------
// Clips, in the rig's terms: each key the turns (YXZ Euler, radians) of some of its joints from
// standing straight, and how far the hips rise; the rest stand straight.
// ---------------------------------------------------------------------------------------------

const CLIPS = [
  {
    // The right arm up and out, the forearm waving from the elbow.
    name: 'wave',
    keys: [0, 0.3, 0.6, 0.9, 1.2].map((t, i) => ({ t, turns: { upperArmR: [0.3, 0, -2.5], lowerArmR: [0, 0, i % 2 ? -1.0 : -0.25], head: [0, -0.2, 0.08] } })),
  },
  {
    // Arms up in a V, pumping; a hop from bent knees; the head back.
    name: 'cheer',
    keys: [0, 0.25, 0.5, 0.75, 1].map((t, i) => {
      const up = i % 2 === 1;
      const bend = up ? 0.05 : 0.4;
      return {
        t,
        rise: up ? 0.06 : -0.066,
        turns: {
          spine: [up ? -0.08 : 0.1],
          head: [up ? -0.3 : 0],
          upperArmL: [0, 0, up ? 2.8 : 2.3],
          upperArmR: [0, 0, up ? -2.8 : -2.3],
          lowerArmL: [up ? -0.1 : -0.5],
          lowerArmR: [up ? -0.1 : -0.5],
          upperLegL: [-bend],
          upperLegR: [-bend],
          lowerLegL: [bend * 2],
          lowerLegR: [bend * 2],
          footL: [-bend],
          footR: [-bend],
        },
      };
    }),
  },
];

/**
 * A clip on a skeleton: at each key, the rig's joints turned in the model's space (each by its
 * parents' turns and its own), each bone turned as its joint is times its own turn standing
 * straight (bones the rig doesn't have ride along as they rest), then into each bone's parent's
 * space. A track for each bone that moves, and the hips' place if they rise.
 */
function clipFor(clip, sk, root) {
  const byName = new Map(sk.bones.map((b) => [b.name, b]));
  const rigJoint = new Map(Object.entries(sk.joint).map(([j, n]) => [n, j]));
  /** Every bone's local transform with the rig's joints turned so. */
  const pose = (turns, rise) => {
    const turned = {};
    for (const j of RIG) {
      const own = turns[j] ? euler(...turns[j]) : I;
      turned[j] = RIG_PARENT[j] ? qmul(turned[RIG_PARENT[j]], own) : own;
    }
    const world = new Map();
    const place = (b) => {
      if (world.has(b.name)) return world.get(b.name);
      const parent = b.parent ? place(byName.get(b.parent)) : root;
      // Where it is on its parent (standing straight): the hips rise.
      const on = local(b.parent ? byName.get(b.parent).straight : root, b.straight);
      const j = rigJoint.get(b.name);
      const p = j === 'hips' ? add(b.straight.p, [0, rise, 0]) : apply(parent, on.p);
      // A joint of the rig's turned as the rig's is, times its own turn standing straight; any other bone rides along.
      const t = j ? { p, q: qmul(turned[j], b.straight.q), s: b.straight.s } : { p, q: qmul(parent.q, on.q), s: parent.s * on.s };
      world.set(b.name, t);
      return t;
    };
    for (const b of sk.bones) place(b);
    return new Map(sk.bones.map((b) => [b.name, local(b.parent ? world.get(b.parent) : root, world.get(b.name))]));
  };
  const frames = clip.keys.map((k) => pose(k.turns, k.rise ?? 0));
  const straight = pose({}, 0);
  const tracks = [];
  for (const b of sk.bones) {
    // A track for each bone the clip moves from standing straight.
    const qs = frames.map((f) => f.get(b.name).q);
    const still = straight.get(b.name).q;
    const moves = qs.some((q) => Math.abs(Math.abs(q[0] * still[0] + q[1] * still[1] + q[2] * still[2] + q[3] * still[3]) - 1) > 1e-7);
    if (moves) tracks.push({ bone: b.name, path: 'rotation', values: qs.flatMap((q) => round(q)) });
    if (rigJoint.get(b.name) === 'hips' && clip.keys.some((k) => k.rise)) tracks.push({ bone: b.name, path: 'translation', values: frames.flatMap((f) => round(f.get(b.name).p)) });
  }
  return { name: clip.name, times: clip.keys.map((k) => k.t), tracks };
}

// ---------------------------------------------------------------------------------------------
// A skinned mannequin
// ---------------------------------------------------------------------------------------------

function skinned(file, sk, name) {
  const g = new Gltf();
  const root = sk.armature ? { p: [0, 0, 0], q: sk.armature.q, s: sk.armature.s } : { p: [0, 0, 0], q: I, s: 1 };
  const nodes = [{ name, children: [] }];
  const index = new Map();
  let top = nodes[0];
  if (sk.armature) {
    nodes.push({ name: sk.armature.name, rotation: round(sk.armature.q), scale: [sk.armature.s, sk.armature.s, sk.armature.s], children: [] });
    nodes[0].children.push(1);
    top = nodes[1];
  }
  const byName = new Map(sk.bones.map((b) => [b.name, b]));
  for (const b of [...sk.bones, ...sk.extras]) {
    const parent = b.parent ? byName.get(b.parent).rest : root;
    const l = local(parent, b.rest);
    const node = { name: b.name, translation: round(l.p), children: [] };
    if (Math.abs(l.q[3]) < 1 - 1e-9) node.rotation = round(l.q);
    if (Math.abs(l.s - 1) > 1e-9) node.scale = [l.s, l.s, l.s];
    nodes.push(node);
    index.set(b.name, nodes.length - 1);
    (b.parent ? nodes[index.get(b.parent)] : top).children.push(nodes.length - 1);
  }
  // The skin, standing straight, into the pose the skeleton rests in (a bone moved from
  // standing straight to resting takes its weights' vertices with it).
  const boneIndex = new Map(sk.bones.map((b, i) => [b.name, i]));
  const move = (b, p) => apply(b.rest, unapply(b.straight, p));
  const turn = (b, n) => qrot(qmul(b.rest.q, qinv(b.straight.q)), n);
  const primitives = [];
  skinParts().forEach((corners, mat) => {
    if (!corners.length) return;
    const pos = [];
    const nor = [];
    const joints = [];
    const wts = [];
    for (const c of corners) {
      const w = new Map();
      for (const [bone, v] of Object.entries(c.w)) {
        const n = sk.weights(bone);
        w.set(n, (w.get(n) ?? 0) + v);
      }
      const list = [...w].sort((a, b) => b[1] - a[1]).slice(0, 4);
      let p = [0, 0, 0];
      let n = [0, 0, 0];
      for (const [bn, v] of list) {
        const b = byName.get(bn);
        p = add(p, scale(move(b, c.p), v));
        n = add(n, scale(turn(b, c.n), v));
      }
      const l = Math.hypot(...n) || 1;
      pos.push(...p);
      nor.push(...n.map((v) => v / l));
      for (let i = 0; i < 4; i++) {
        joints.push(list[i] ? boneIndex.get(list[i][0]) : 0);
        wts.push(list[i] ? list[i][1] : 0);
      }
    }
    primitives.push({
      attributes: { POSITION: g.add(pos, 'VEC3', { minmax: true }), NORMAL: g.add(nor, 'VEC3'), JOINTS_0: g.add(joints, 'VEC4', { component: 5121 }), WEIGHTS_0: g.add(wts, 'VEC4') },
      material: mat,
    });
  });
  const skin = {
    joints: sk.bones.map((b) => index.get(b.name)),
    inverseBindMatrices: g.add(sk.bones.flatMap((b) => round(inverseMatrix(b.rest))), 'MAT4', { vertex: false }),
    skeleton: index.get(sk.bones[0].name),
  };
  nodes.push({ name: `${name}_skin`, mesh: 0, skin: 0 });
  nodes[0].children.push(nodes.length - 1);
  const animations = CLIPS.map((c) => clipFor(c, sk, root)).map((c) => {
    const input = g.add(c.times, 'SCALAR', { minmax: true, vertex: false });
    return {
      name: c.name,
      samplers: c.tracks.map((t) => ({ input, output: g.add(t.values, t.path === 'rotation' ? 'VEC4' : 'VEC3', { vertex: false }), interpolation: 'LINEAR' })),
      channels: c.tracks.map((t, i) => ({ sampler: i, target: { node: index.get(t.bone), path: t.path } })),
    };
  });
  for (const n of nodes) if (n.children && !n.children.length) delete n.children;
  g.write(join(DIR, file), { asset: { version: '2.0', generator: 'blockyard mannequin' }, scene: 0, scenes: [{ nodes: [0] }], nodes, meshes: [{ name, primitives }], skins: [skin], animations, materials: materials() });
}

rigid();
skinned('mannequin_skinned.glb', nativeSkeleton(), 'mannequin_skinned');
skinned('mannequin_mixamo.glb', mixamoSkeleton(), 'mannequin_mixamo');
