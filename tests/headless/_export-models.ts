import { readFileSync, writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
import * as THREE from 'three';
import * as engine from '@engine/voxel_engine.js';
import { HeldModels, Models, Skins } from '../../src/platform/api/models';
import type { HeldModelSpec, ModelSpec } from '../../src/platform/api/types';
import { boxGeometry, ModelInstance, type AnimState } from '../../src/platform/render/entities';

/**
 * Not a test: writes Blockyard's own box models as glTF files (Blockbench-style: a node per part,
 * the skin as an embedded PNG, animations sampled from the platform's own walk and swing), for
 * the gallery and the glTF tests. Everything in them is Blockyard's art.
 * `node scripts/headless.mjs tests/headless/_export-models.ts`
 */
export default function exportModels() {
  engine.initSync({ module: readFileSync('engine/pkg/voxel_engine_bg.wasm') });
  const all = (engine as unknown as { entity_textures(): Uint8Array }).entity_textures();
  const size = 256;
  const atlas = { width: size, height: size, pixels: all.slice(0, size * size * 4) };
  const out = 'src/games/gallery/models';
  writeFileSync(`${out}/blocky.gltf`, JSON.stringify(figure(Models.humanoid({ skin: Skins.player }), atlas)));
  writeFileSync(`${out}/blocky_sword.gltf`, JSON.stringify(held(HeldModels.ironSword, atlas)));
  console.log(`  wrote ${out}/blocky.gltf (the default player, with idle, walk, run, attack) and blocky_sword.gltf`);
}

interface Pixels {
  width: number;
  height: number;
  pixels: Uint8Array;
}

/** A glTF document under construction: one buffer, accessors onto it, nodes, meshes. */
class Doc {
  private bytes: number[] = [];
  readonly json = {
    asset: { version: '2.0', generator: 'Blockyard' },
    scene: 0,
    scenes: [{ nodes: [] as number[] }],
    nodes: [] as Record<string, unknown>[],
    meshes: [] as Record<string, unknown>[],
    materials: [{ pbrMetallicRoughness: { baseColorTexture: { index: 0 }, metallicFactor: 0, roughnessFactor: 1 }, alphaMode: 'MASK', alphaCutoff: 0.5 }],
    textures: [{ sampler: 0, source: 0 }],
    samplers: [{ magFilter: 9728, minFilter: 9728, wrapS: 33071, wrapT: 33071 }],
    images: [] as { uri: string }[],
    accessors: [] as Record<string, unknown>[],
    bufferViews: [] as Record<string, unknown>[],
    buffers: [] as Record<string, unknown>[],
    animations: [] as Record<string, unknown>[],
  };

  constructor(tex: Pixels) {
    this.json.images.push({ uri: `data:image/png;base64,${png(tex).toString('base64')}` });
  }

  accessor(data: Float32Array | Uint16Array, type: string, extra: Record<string, unknown> = {}): number {
    while (this.bytes.length % 4) this.bytes.push(0);
    const offset = this.bytes.length;
    this.bytes.push(...new Uint8Array(data.buffer, data.byteOffset, data.byteLength));
    this.json.bufferViews.push({ buffer: 0, byteOffset: offset, byteLength: data.byteLength });
    const n = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 }[type]!;
    this.json.accessors.push({ bufferView: this.json.bufferViews.length - 1, componentType: data instanceof Float32Array ? 5126 : 5123, count: data.length / n, type, ...extra });
    return this.json.accessors.length - 1;
  }

  mesh(g: THREE.BufferGeometry): number {
    const pos = g.getAttribute('position').array as Float32Array;
    const box = new THREE.Box3().setFromBufferAttribute(g.getAttribute('position') as THREE.BufferAttribute);
    const attributes = {
      POSITION: this.accessor(new Float32Array(pos), 'VEC3', { min: box.min.toArray(), max: box.max.toArray() }),
      NORMAL: this.accessor(new Float32Array(g.getAttribute('normal').array), 'VEC3'),
      TEXCOORD_0: this.accessor(new Float32Array(g.getAttribute('uv').array), 'VEC2'),
    };
    const index = g.getIndex();
    this.json.meshes.push({ primitives: [{ attributes, ...(index ? { indices: this.accessor(new Uint16Array(index.array), 'SCALAR') } : {}), material: 0 }] });
    return this.json.meshes.length - 1;
  }

  node(n: Record<string, unknown>, parent: number | null): number {
    this.json.nodes.push(n);
    const i = this.json.nodes.length - 1;
    if (parent === null) this.json.scenes[0].nodes.push(i);
    else ((this.json.nodes[parent].children ??= []) as number[]).push(i);
    return i;
  }

  done() {
    this.json.buffers.push({ byteLength: this.bytes.length, uri: `data:application/octet-stream;base64,${Buffer.from(this.bytes).toString('base64')}` });
    if (!this.json.animations.length) delete (this.json as { animations?: unknown }).animations;
    return this.json;
  }
}

/** A humanoid (or any box model) as a node per part, with its idle, walk, run and attack. */
function figure(spec: ModelSpec, tex: Pixels) {
  const doc = new Doc(tex);
  // The same tree the client builds (`EntityGraphics.buildModel`), for sampling the animations.
  const root = new THREE.Group();
  const inner = new THREE.Group();
  inner.scale.setScalar(spec.scale);
  root.add(inner);
  const pivots = new Map<string, THREE.Object3D>();
  const rest = new Map<string, THREE.Euler>();
  const index = new Map<string, number>();
  const top = doc.node({ name: 'blocky', scale: [spec.scale, spec.scale, spec.scale] }, null);
  for (const p of [...spec.parts].sort((a, b) => (a.parent ? 1 : 0) - (b.parent ? 1 : 0))) {
    const pivot = new THREE.Object3D();
    pivot.position.set(p.pivot[0] / 16, p.pivot[1] / 16, p.pivot[2] / 16);
    const r = p.rotation ?? [0, 0, 0];
    pivot.rotation.set(r[0], r[1], r[2]);
    rest.set(p.name, pivot.rotation.clone());
    (p.parent ? pivots.get(p.parent)! : inner).add(pivot);
    pivots.set(p.name, pivot);
    const i = doc.node({ name: p.name, translation: pivot.position.toArray(), rotation: pivot.quaternion.toArray() }, p.parent ? index.get(p.parent)! : top);
    index.set(p.name, i);
    const geo = boxGeometry(p, tex.width, tex.height);
    doc.node({ name: `${p.name}_cube`, translation: [(p.offset[0] + p.size[0] / 2) / 16, (p.offset[1] + p.size[1] / 2) / 16, (p.offset[2] + p.size[2] / 2) / 16], mesh: doc.mesh(geo) }, i);
  }
  const model = new ModelInstance(root, pivots, rest, null as unknown as THREE.RawShaderMaterial, spec);
  const still: AnimState = { walkPhase: 0, walkAmount: 0, pace: 0, attackT: 9, raised: false, casting: false, headYaw: 0, headPitch: 0, dying: 0, time: 0, aim: 0, posture: 0 };
  const clip = (name: string, duration: number, at: (t: number) => Partial<AnimState>) => {
    const fps = 24;
    const times: number[] = [];
    const keys = new Map<string, number[]>();
    for (let f = 0; f <= Math.round(duration * fps); f++) {
      const t = Math.min(duration, f / fps);
      times.push(t);
      model.animate({ ...still, ...at(t) });
      for (const [n, pv] of pivots) (keys.get(n) ?? keys.set(n, []).get(n)!).push(...pv.quaternion.toArray());
    }
    const input = doc.accessor(new Float32Array(times), 'SCALAR', { min: [0], max: [duration] });
    const channels: Record<string, unknown>[] = [];
    const samplers: Record<string, unknown>[] = [];
    for (const [n, values] of keys) {
      if (values.every((v, i) => Math.abs(v - values[i % 4]) < 1e-6)) continue;
      samplers.push({ input, output: doc.accessor(new Float32Array(values), 'VEC4'), interpolation: 'LINEAR' });
      channels.push({ sampler: samplers.length - 1, target: { node: index.get(n), path: 'rotation' } });
    }
    doc.json.animations.push({ name, channels, samplers });
  };
  // The idle sway's own period, so it loops seamlessly.
  clip('idle', (Math.PI * 2) / 1.7, (t) => ({ time: t }));
  clip('walk', 1, (t) => ({ walkPhase: t * Math.PI * 2, walkAmount: 1 }));
  clip('run', 1, (t) => ({ walkPhase: t * Math.PI * 2, walkAmount: 1.5 }));
  clip('attack', 0.35, (t) => ({ attackT: t }));
  return doc.done();
}

/** A held model (boxes in item space: +z to the tip, pixels / 16) as one mesh. */
function held(spec: HeldModelSpec, tex: Pixels) {
  const doc = new Doc(tex);
  const pos: number[] = [];
  const nrm: number[] = [];
  const uvs: number[] = [];
  const m = new THREE.Matrix4();
  const r = new THREE.Matrix4();
  for (const part of spec.parts) {
    const box = boxGeometry({ name: '', size: part.size, uv: part.uv, pivot: [0, 0, 0], offset: [0, 0, 0] }, tex.width, tex.height).toNonIndexed();
    const [ox, oy, oz] = part.offset;
    const [sx, sy, sz] = part.size;
    m.makeTranslation((ox + sx / 2) / 16, (oy + sy / 2) / 16, (oz + sz / 2) / 16);
    if (part.rotation) m.multiply(r.makeRotationFromEuler(new THREE.Euler(...(part.rotation.map((d) => (d * Math.PI) / 180) as [number, number, number]))));
    box.applyMatrix4(m);
    pos.push(...box.attributes.position.array);
    nrm.push(...box.attributes.normal.array);
    uvs.push(...box.attributes.uv.array);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  doc.node({ name: 'sword', mesh: doc.mesh(g) }, null);
  return doc.done();
}

/** RGBA pixels as a PNG. */
function png(tex: Pixels): Buffer {
  const { width, height, pixels } = tex;
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (width * 4 + 1)] = 0;
    Buffer.from(pixels.buffer, pixels.byteOffset + y * width * 4, width * 4).copy(raw, y * (width * 4 + 1) + 1);
  }
  const table = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc = (b: Buffer) => {
    let c = 0xffffffff;
    for (const x of b) c = table[(c ^ x) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const sum = Buffer.alloc(4);
    sum.writeUInt32BE(crc(body));
    return Buffer.concat([len, body, sum]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
