import * as THREE from 'three';
import type { VoxelWorld } from '@engine/voxel_engine.js';
import type { BlockRef, Vec3 } from '../api/types';
import type { Blueprint } from '../api/blueprint';
import type { Registry } from '../world/registry';

/**
 * A block build as a mover sees it (the engine's moving colliders, `engine/src/movers.rs`): its
 * solid cells, where its origin is in the grid, and how big a cell is.
 */
export interface Collider {
  size: Vec3;
  /** 1 for each solid cell, index `(y * size.z + z) * size.x + x`. */
  cells: Uint8Array;
  /** The model's origin (`pivot`), in grid cells from the blueprint's corner. */
  pivot: Vec3;
  /** Model units per cell (the model's `scale`). */
  unit: number;
}

/** The collider of a block model (`props.model`): its solid blocks. */
export function collider(bp: Blueprint, registry: Registry, resolve: (b: BlockRef) => number, opts: { scale?: number; pivot?: Vec3 }): Collider {
  const { origin: o, size } = bp;
  const cells = new Uint8Array(size.x * size.y * size.z);
  bp.forEach((x, y, z, block) => {
    if (registry.blocks[resolve(block)]?.solid) cells[((y - o.y) * size.z + (z - o.z)) * size.x + (x - o.x)] = 1;
  });
  const pv = opts.pivot ?? { x: 0, y: 0, z: 0 };
  return { size, cells, pivot: { x: pv.x - o.x, y: pv.y - o.y, z: pv.z - o.z }, unit: opts.scale ?? 1 };
}

export function addMover(world: VoxelWorld, id: number, c: Collider) {
  world.mover_add(id, c.size.x, c.size.y, c.size.z, c.cells, c.pivot.x, c.pivot.y, c.pivot.z, c.unit);
}

/** Where something is in the world: `world = p + q * (local * scale)`. */
export interface WorldPose {
  p: THREE.Vector3;
  q: THREE.Quaternion;
  scale: number;
}

export function setMoverPose(world: VoxelWorld, id: number, w: WorldPose, snap: boolean) {
  world.mover_pose(id, w.p.x, w.p.y, w.p.z, w.q.x, w.q.y, w.q.z, w.q.w, w.scale, snap);
}

/** A pose on its parent's (a prop's `attach`), in the world. */
export function onParent(parent: WorldPose, p: THREE.Vector3, q: THREE.Quaternion, scale: number, out: WorldPose): WorldPose {
  out.p.copy(p).multiplyScalar(parent.scale).applyQuaternion(parent.q).add(parent.p);
  out.q.copy(parent.q).multiply(q);
  out.scale = parent.scale * scale;
  return out;
}

/** A point `local` on something at `pose`, in the world. */
export function toWorld(pose: WorldPose, local: Vec3, out = new THREE.Vector3()): THREE.Vector3 {
  return out.set(local.x, local.y, local.z).multiplyScalar(pose.scale).applyQuaternion(pose.q).add(pose.p);
}

/** A world point in something's own space at `pose` (the inverse of `toWorld`). */
export function toLocal(pose: WorldPose, at: Vec3): Vec3 {
  const v = new THREE.Vector3(at.x, at.y, at.z).sub(pose.p).applyQuaternion(pose.q.clone().invert());
  v.divideScalar(pose.scale || 1);
  return { x: v.x, y: v.y, z: v.z };
}

const FWD = new THREE.Vector3();

/** Which way its -z points, as a heading (0 toward -z, like `player.yaw`). */
export function heading(q: THREE.Quaternion): number {
  FWD.set(0, 0, -1).applyQuaternion(q);
  return Math.atan2(-FWD.x, -FWD.z);
}
