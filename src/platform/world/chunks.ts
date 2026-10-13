import * as THREE from 'three';
import { Culler, VoxelWorld } from '@engine/voxel_engine.js';
import { wasmMemory } from '../engine/wasm';
import type { WorkerPool } from '../workers/pool';
import type { WorkerResponse } from '../workers/protocol';
import { LAYER_CHUNKS, type Renderer } from '../render/pipeline';
import type { BiomeMap } from '../render/textures';

const MESH_HEADER = 80;
const TINT_OFFSET = 4;
const STATE_QUEUED = 0;
const STATE_GENERATING = 1;
const STATE_READY = 2;

interface Column {
  cx: number;
  cz: number;
  key: number;
  state: number;
  /** Bumps whenever blocks that can influence this column's mesh change. */
  version: number;
  /** Version of the mesh currently on screen (-1 = none). */
  shownVersion: number;
  /** Highest version sent to a worker. */
  requestedVersion: number;
  inflight: number;
  meshes: (THREE.Mesh | null)[];
  slot: number;
  dist2: number;
  failures: number;
}

interface Batch {
  need: Map<number, number>;
  ready: Map<number, { version: number; data: Uint32Array }>;
  created: number;
}

interface PendingMesh {
  key: number;
  version: number;
  data: Uint32Array;
}

const keyOf = (cx: number, cz: number) => (cx + 32768) * 65536 + (cz + 32768);

export interface ChunkStats {
  loaded: number;
  meshed: number;
  generating: number;
  meshing: number;
  pending: number;
  visibleSections: number;
  genMs: number;
  meshMs: number;
}

export class ChunkManager {
  readonly world: VoxelWorld;
  readonly culler: Culler;
  renderDistance: number;
  occlusion = true;
  private cols = new Map<number, Column>();
  private meshed: Column[] = [];
  private bySlot: (Column | null)[] = [];
  private pending: PendingMesh[] = [];
  private batches: Batch[] = [];
  private centerX = Number.NaN;
  private centerZ = Number.NaN;
  private index: THREE.BufferAttribute;
  private indexQuads = 0;
  private vpArray = new Float64Array(16);
  private candidates: { col: Column; score: number; mesh: boolean }[] = [];
  private viewX = 0;
  private viewZ = -1;
  /** Columns blocks were shot into since the last remesh (see `applyDamage`): whether light changed too. */
  private damaged = new Map<number, [number, number, boolean]>();

  constructor(
    private pool: WorkerPool,
    private renderer: Renderer,
    private biome: BiomeMap,
    renderDistance: number,
  ) {
    this.world = new VoxelWorld();
    this.culler = new Culler();
    this.renderDistance = renderDistance;
    this.index = this.makeIndex(1 << 16);
  }

  private makeIndex(quads: number): THREE.BufferAttribute {
    const idx = new Uint32Array(quads * 6);
    for (let q = 0, i = 0; q < quads; q++, i += 6) {
      const v = q * 4;
      idx[i] = v;
      idx[i + 1] = v + 1;
      idx[i + 2] = v + 2;
      idx[i + 3] = v;
      idx[i + 4] = v + 2;
      idx[i + 5] = v + 3;
    }
    this.indexQuads = quads;
    return new THREE.BufferAttribute(idx, 1);
  }

  private indexFor(quads: number): THREE.BufferAttribute {
    if (quads > this.indexQuads) this.index = this.makeIndex(Math.max(quads, this.indexQuads * 2));
    return this.index;
  }

  get(cx: number, cz: number): Column | undefined {
    return this.cols.get(keyOf(cx, cz));
  }

  setRenderDistance(r: number) {
    this.renderDistance = r;
    this.centerX = Number.NaN;
  }

  /** Per-frame: stream columns around the player, dispatch jobs, apply finished meshes. */
  update(px: number, pz: number, viewX: number, viewZ: number) {
    const ccx = Math.floor(px / 16);
    const ccz = Math.floor(pz / 16);
    const vl = Math.hypot(viewX, viewZ) || 1;
    this.viewX = viewX / vl;
    this.viewZ = viewZ / vl;
    if (ccx !== this.centerX || ccz !== this.centerZ) {
      this.centerX = ccx;
      this.centerZ = ccz;
      this.refreshWanted();
    }
    this.flushDamage();
    this.dispatch(px, pz);
    this.flushBatches(false);
    this.applyPending();
  }

  private refreshWanted() {
    const R = this.renderDistance + 1;
    const r2 = (R + 0.5) * (R + 0.5);
    for (let dz = -R; dz <= R; dz++) {
      for (let dx = -R; dx <= R; dx++) {
        if (dx * dx + dz * dz > r2) continue;
        const cx = this.centerX + dx;
        const cz = this.centerZ + dz;
        const k = keyOf(cx, cz);
        if (!this.cols.has(k)) {
          this.cols.set(k, {
            cx,
            cz,
            key: k,
            state: STATE_QUEUED,
            version: 0,
            shownVersion: -1,
            requestedVersion: -1,
            inflight: 0,
            meshes: [null, null, null],
            slot: -1,
            dist2: 0,
            failures: 0,
          });
        }
      }
    }
    const drop = (R + 2.5) * (R + 2.5);
    for (const col of this.cols.values()) {
      const dx = col.cx - this.centerX;
      const dz = col.cz - this.centerZ;
      col.dist2 = dx * dx + dz * dz;
      if (col.dist2 > drop) this.unload(col);
    }
  }

  private unload(col: Column) {
    this.disposeMeshes(col);
    if (col.slot >= 0) {
      this.culler.remove_column(col.cx, col.cz);
      this.bySlot[col.slot] = null;
      col.slot = -1;
      const i = this.meshed.indexOf(col);
      if (i >= 0) this.meshed.splice(i, 1);
    }
    if (col.state === STATE_READY) this.world.remove_column(col.cx, col.cz);
    this.cols.delete(col.key);
  }

  private disposeMeshes(col: Column) {
    for (let l = 0; l < 3; l++) {
      const m = col.meshes[l];
      if (!m) continue;
      m.removeFromParent();
      // Detach the live shared index so disposing one mesh doesn't free it for everyone.
      // Retired (outgrown) index buffers stay attached and are freed with their last user.
      if (m.geometry.index === this.index) m.geometry.setIndex(null);
      m.geometry.dispose();
      col.meshes[l] = null;
    }
  }

  private neighborsReady(col: Column): boolean {
    for (let dz = -1; dz <= 1; dz++) {
      for (let dx = -1; dx <= 1; dx++) {
        const n = this.cols.get(keyOf(col.cx + dx, col.cz + dz));
        if (!n || n.state !== STATE_READY) return false;
      }
    }
    return true;
  }

  private meshable(col: Column): boolean {
    const R = this.renderDistance;
    return (
      col.state === STATE_READY &&
      col.requestedVersion < col.version &&
      col.dist2 <= (R + 0.5) * (R + 0.5) &&
      this.neighborsReady(col)
    );
  }

  private dispatch(px: number, pz: number) {
    let capacity = this.pool.capacity(2);
    if (capacity <= 0) return;
    const cands = this.candidates;
    cands.length = 0;
    for (const col of this.cols.values()) {
      if (col.state === STATE_QUEUED) {
        cands.push({ col, score: this.score(col, px, pz), mesh: false });
      } else if (col.state === STATE_READY && col.inflight === 0 && this.meshable(col)) {
        cands.push({ col, score: this.score(col, px, pz) * 0.45, mesh: true });
      }
    }
    if (cands.length === 0) return;
    cands.sort((a, b) => a.score - b.score);
    let meshBudget = 8;
    for (const c of cands) {
      if (capacity <= 0) break;
      if (c.mesh) {
        if (meshBudget-- <= 0) continue;
        this.requestMesh(c.col);
      } else {
        this.requestGen(c.col);
      }
      capacity--;
    }
  }

  private score(col: Column, px: number, pz: number): number {
    const dx = col.cx * 16 + 8 - px;
    const dz = col.cz * 16 + 8 - pz;
    const d = Math.hypot(dx, dz) + 1;
    const facing = (dx * this.viewX + dz * this.viewZ) / d;
    return d * d * (1.35 - 0.5 * facing);
  }

  private requestGen(col: Column) {
    col.state = STATE_GENERATING;
    this.pool.gen(col.cx, col.cz, (res) => this.onGen(res, col.cx, col.cz));
  }

  private onGen(res: WorkerResponse, cx: number, cz: number) {
    if (res.type === 'error') {
      // Retry a few times, then leave the column empty rather than looping forever.
      const col = this.cols.get(keyOf(cx, cz));
      if (col && col.state === STATE_GENERATING && ++col.failures < 3) col.state = STATE_QUEUED;
      return;
    }
    if (res.type !== 'gen') return;
    const col = this.cols.get(keyOf(res.cx, res.cz));
    if (!col || col.state !== STATE_GENERATING) return;
    this.world.insert_column(res.cx, res.cz, res.data);
    this.biome.upload(res.cx, res.cz, res.data.subarray(TINT_OFFSET, TINT_OFFSET + 768));
    col.state = STATE_READY;
  }

  private requestMesh(col: Column) {
    const region = this.world.extract_region(col.cx, col.cz);
    const version = col.version;
    col.requestedVersion = version;
    col.inflight++;
    this.pool.mesh(col.cx, col.cz, region, (res) => {
      col.inflight--;
      if (res.type === 'error' && col.requestedVersion === version && ++col.failures < 3) col.requestedVersion = version - 1;
      if (res.type !== 'mesh') return;
      if (!this.cols.has(col.key) || this.cols.get(col.key) !== col) return;
      this.onMesh(col, version, res.data);
    });
  }

  private onMesh(col: Column, version: number, data: Uint32Array) {
    // A result can complete several overlapping edit batches at once.
    let batched = false;
    for (const b of this.batches) {
      const need = b.need.get(col.key);
      if (need !== undefined && version >= need) {
        b.ready.set(col.key, { version, data });
        batched = true;
      }
    }
    if (batched) this.flushBatches(false);
    else this.pending.push({ key: col.key, version, data });
  }

  private flushBatches(force: boolean) {
    const now = performance.now();
    for (let i = 0; i < this.batches.length; i++) {
      const b = this.batches[i];
      const complete = b.ready.size >= b.need.size;
      if (complete || force || now - b.created > 350) {
        for (const [key, r] of b.ready) {
          const col = this.cols.get(key);
          if (col) this.applyMesh(col, r.version, r.data);
        }
        this.batches.splice(i, 1);
        i--;
      }
    }
  }

  private applyPending() {
    const t0 = performance.now();
    let n = 0;
    while (this.pending.length > 0) {
      if (n > 0 && performance.now() - t0 > 3) break;
      // Closest first.
      let best = 0;
      let bestD = Infinity;
      for (let i = 0; i < this.pending.length; i++) {
        const c = this.cols.get(this.pending[i].key);
        const d = c ? c.dist2 : -1;
        if (d < bestD) {
          bestD = d;
          best = i;
        }
      }
      const p = this.pending[best];
      this.pending[best] = this.pending[this.pending.length - 1];
      this.pending.pop();
      const col = this.cols.get(p.key);
      if (col) this.applyMesh(col, p.version, p.data);
      n++;
    }
  }

  private applyMesh(col: Column, version: number, data: Uint32Array) {
    if (version <= col.shownVersion) return;
    col.shownVersion = version;
    this.disposeMeshes(col);
    const header = data.subarray(0, MESH_HEADER);
    let off = data[0];
    const mats = [this.renderer.materials.opaque, this.renderer.materials.cutout, this.renderer.materials.water];
    for (let l = 0; l < 3; l++) {
      const quads = data[1 + l];
      if (quads === 0) continue;
      const verts = data.subarray(off, off + quads * 8);
      off += quads * 8;
      const geo = new THREE.BufferGeometry();
      const attr = new THREE.BufferAttribute(verts, 2);
      attr.onUpload(releaseArray);
      geo.setAttribute('aData', attr);
      geo.setIndex(this.indexFor(quads));
      geo.setDrawRange(0, quads * 6);
      geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(8, 128, 8), 130);
      geo.boundingBox = new THREE.Box3(new THREE.Vector3(0, 0, 0), new THREE.Vector3(16, 256, 16));
      const mesh = new THREE.Mesh(geo, mats[l]);
      mesh.position.set(col.cx * 16, 0, col.cz * 16);
      mesh.matrixAutoUpdate = false;
      mesh.updateMatrix();
      mesh.matrixWorld.copy(mesh.matrix);
      mesh.matrixWorldAutoUpdate = false;
      mesh.frustumCulled = false;
      mesh.layers.set(LAYER_CHUNKS);
      col.meshes[l] = mesh;
      (l === 2 ? this.renderer.waterScene : this.renderer.opaqueScene).add(mesh);
    }
    const slot = this.culler.set_column(col.cx, col.cz, header);
    if (col.slot !== slot) {
      if (col.slot >= 0 && this.bySlot[col.slot] === col) this.bySlot[col.slot] = null;
      // Another column may have been evicted from this slot.
      const prev = this.bySlot[slot];
      if (prev && prev !== col) {
        prev.slot = -1;
        const i = this.meshed.indexOf(prev);
        if (i >= 0) this.meshed.splice(i, 1);
      }
      col.slot = slot;
      this.bySlot[slot] = col;
      if (!this.meshed.includes(col)) this.meshed.push(col);
    }
  }

  /**
   * Edits made in the simulation's copy of the world (a worker, a server): applied and remeshed
   * where this client has the column, kept for when it loads where it doesn't.
   */
  mirrorEdits(cells: [number, number, number, number][]) {
    if (cells.length === 1) {
      const [x, y, z, id] = cells[0];
      if (this.world.mirror_block(x, y, z, id)) this.remeshNear(x, z);
      return;
    }
    const touched = new Map<number, [number, number]>();
    for (const [x, y, z, id] of cells) {
      if (!this.world.mirror_block(x, y, z, id)) continue;
      const cx = Math.floor(x / 16);
      const cz = Math.floor(z / 16);
      touched.set(keyOf(cx, cz), [cx, cz]);
    }
    if (touched.size) this.remeshAround(touched.values());
  }

  /** After one block changed: remesh every column whose lighting could change, atomically. */
  private remeshNear(x: number, z: number) {
    const cx = Math.floor(x / 16);
    const cz = Math.floor(z / 16);
    const batch: Batch = { need: new Map(), ready: new Map(), created: performance.now() };
    for (let dz = -1; dz <= 1; dz++) {
      for (let dx = -1; dx <= 1; dx++) {
        const col = this.cols.get(keyOf(cx + dx, cz + dz));
        if (!col || col.state !== STATE_READY) continue;
        // Light changes spread at most 15 blocks (Manhattan); the mesh also samples a 1-block border.
        const x0 = (cx + dx) * 16 - 1;
        const x1 = (cx + dx) * 16 + 16;
        const z0 = (cz + dz) * 16 - 1;
        const z1 = (cz + dz) * 16 + 16;
        const ddx = Math.max(x0 - x, 0, x - x1);
        const ddz = Math.max(z0 - z, 0, z - z1);
        if (ddx + ddz > 15) continue;
        col.version++;
        if (col.shownVersion >= 0 && this.meshable(col)) {
          batch.need.set(col.key, col.version);
          this.requestMesh(col);
        }
      }
    }
    if (batch.need.size > 0) this.batches.push(batch);
  }

  /**
   * Blocks shot into in the simulation's copy of the world (`damage` events): taken from this
   * copy too (whether or not their columns are here yet), and the columns whose meshes changed
   * remeshed at the next `flushDamage`, all of a batch's shots together.
   */
  applyDamage(data: Uint8Array) {
    const t = this.world.apply_damage(data);
    for (let i = 0; i < t.length; i += 3) {
      const k = keyOf(t[i], t[i + 1]);
      this.damaged.set(k, [t[i], t[i + 1], (this.damaged.get(k)?.[2] ?? false) || t[i + 2] === 1]);
    }
  }

  /**
   * Remesh the columns damage changed since the last time, in one batch: just the column for a
   * block chipped (its light is the same), and the ones around it for a block that went.
   */
  flushDamage() {
    if (!this.damaged.size) return;
    const around: [number, number][] = [];
    const own: [number, number][] = [];
    for (const [cx, cz, relight] of this.damaged.values()) (relight ? around : own).push([cx, cz]);
    this.damaged.clear();
    this.remeshAround(around, own);
  }

  /** Undo every block edit made this session (restart) and remesh what changed together. */
  revertEdits(): number {
    const flat = this.world.revert_edits();
    const cols: [number, number][] = [];
    for (let i = 0; i < flat.length; i += 2) cols.push([flat[i], flat[i + 1]]);
    if (cols.length) this.remeshAround(cols);
    return cols.length;
  }

  /**
   * Remesh the given columns and their neighbours (light spreads across borders), and the `only`
   * columns alone, in one batch.
   */
  private remeshAround(columns: Iterable<[number, number]>, only: Iterable<[number, number]> = []) {
    const batch: Batch = { need: new Map(), ready: new Map(), created: performance.now() };
    const seen = new Set<number>();
    const remesh = (cx: number, cz: number) => {
      const col = this.cols.get(keyOf(cx, cz));
      if (!col || col.state !== STATE_READY || seen.has(col.key)) return;
      seen.add(col.key);
      col.version++;
      if (col.shownVersion >= 0 && this.meshable(col)) {
        batch.need.set(col.key, col.version);
        this.requestMesh(col);
      }
    };
    for (const [cx, cz] of columns) for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) remesh(cx + dx, cz + dz);
    for (const [cx, cz] of only) remesh(cx, cz);
    if (batch.need.size > 0) this.batches.push(batch);
  }

  getBlock(x: number, y: number, z: number): number {
    return this.world.get_block(x, y, z);
  }

  /**
   * Main-camera visibility: frustum + cave culling in WebAssembly, applied as draw ranges. Returns
   * whether any water is on screen.
   */
  applyMainVisibility(camera: THREE.PerspectiveCamera): boolean {
    const vp = new THREE.Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    this.vpArray.set(vp.elements);
    const p = camera.position;
    this.culler.cull(this.vpArray, p.x, p.y, p.z, this.renderDistance + 1, this.occlusion);
    const out = new Uint32Array(wasmMemory().buffer, this.culler.out_ptr(), this.culler.capacity() * 6);
    let water = false;
    for (const col of this.meshed) {
      const o = col.slot * 6;
      for (let l = 0; l < 3; l++) {
        const m = col.meshes[l];
        if (!m) continue;
        const count = out[o + l * 2 + 1];
        m.visible = count > 0;
        m.geometry.drawRange.start = out[o + l * 2];
        m.geometry.drawRange.count = count;
        if (l === 2 && count > 0) water = true;
      }
    }
    return water;
  }

  applyShadowVisibility(vp: THREE.Matrix4, center: THREE.Vector3, radiusBlocks: number) {
    this.vpArray.set(vp.elements);
    this.culler.cull_shadow(this.vpArray, center.x, center.y, center.z, Math.ceil(radiusBlocks / 16) + 2);
    const out = new Uint32Array(wasmMemory().buffer, this.culler.out_shadow_ptr(), this.culler.capacity() * 4);
    for (const col of this.meshed) {
      const o = col.slot * 4;
      for (let l = 0; l < 2; l++) {
        const m = col.meshes[l];
        if (!m) continue;
        const count = out[o + l * 2 + 1];
        m.visible = count > 0;
        m.geometry.drawRange.start = out[o + l * 2];
        m.geometry.drawRange.count = count;
      }
    }
  }

  /** Fraction of columns within `radius` chunks of (px, pz) that have a mesh on screen. */
  readiness(px: number, pz: number, radius: number): number {
    const ccx = Math.floor(px / 16);
    const ccz = Math.floor(pz / 16);
    let total = 0;
    let done = 0;
    for (let dz = -radius; dz <= radius; dz++) {
      for (let dx = -radius; dx <= radius; dx++) {
        if (dx * dx + dz * dz > radius * radius) continue;
        total++;
        const c = this.cols.get(keyOf(ccx + dx, ccz + dz));
        if (c && c.shownVersion >= 0) done++;
      }
    }
    return total ? done / total : 1;
  }

  stats(): ChunkStats {
    let generating = 0;
    let meshing = 0;
    for (const c of this.cols.values()) {
      if (c.state === STATE_GENERATING) generating++;
      meshing += c.inflight;
    }
    return {
      loaded: this.world.column_count(),
      meshed: this.meshed.length,
      generating,
      meshing,
      pending: this.pending.length,
      visibleSections: this.culler.visible_sections(),
      genMs: this.pool.genCount ? this.pool.genMs / this.pool.genCount : 0,
      meshMs: this.pool.meshCount ? this.pool.meshMs / this.pool.meshCount : 0,
    };
  }

  dispose() {
    for (const col of [...this.cols.values()]) this.unload(col);
    this.world.free();
    this.culler.free();
  }
}

function releaseArray(this: THREE.BufferAttribute) {
  (this as unknown as { array: unknown }).array = null;
}
