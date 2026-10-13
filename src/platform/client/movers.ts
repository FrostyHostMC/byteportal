import * as THREE from 'three';
import type { VoxelWorld } from '@engine/voxel_engine.js';
import type { BlockRef } from '../api/types';
import type { Content } from '../content';
import type { PropFrame } from '../sim/props';
import { addMover, collider, onParent, setMoverPose, type Collider, type WorldPose } from '../sim/movers';
import type { Registry } from '../world/registry';

/** Where a frame's prop is in the world (through what it rides on, and along its flight). */
export function propPose(props: readonly PropFrame[], id: number, clock: number): WorldPose | null {
  const f = props.find((p) => p.id === id);
  if (!f) return null;
  const p = new THREE.Vector3(f.p[0], f.p[1], f.p[2]);
  if (f.v) p.set(f.p[0] + f.v[0] * (clock - (f.t ?? 0)), f.p[1] + f.v[1] * (clock - (f.t ?? 0)), f.p[2] + f.v[2] * (clock - (f.t ?? 0)));
  const q = new THREE.Quaternion(f.q[0], f.q[1], f.q[2], f.q[3]);
  if (f.parent === undefined) return { p, q, scale: f.scale };
  const parent = propPose(props, f.parent, clock);
  return parent && onParent(parent, p, q, f.scale, { p: new THREE.Vector3(), q: new THREE.Quaternion(), scale: 1 });
}

/**
 * A predicting client's copy of the solid props (`Prop.solid`), in its own world: its player's
 * predicted steps bump into them and stand on them as the server's do. They're where the newest
 * frame has them.
 */
export class ClientMovers {
  private ids = new Set<number>();
  private colliders = new Map<number, Collider | null>();
  private clock: number | null = null;

  constructor(
    private world: VoxelWorld,
    private content: Content,
    private registry: Registry,
    private resolve: (b: BlockRef) => number,
  ) {}

  private colliderOf(model: number): Collider | null {
    let c = this.colliders.get(model);
    if (c === undefined) {
      const def = this.content.models.get(model);
      c = def && 'blueprint' in def ? collider(def.blueprint, this.registry, this.resolve, def.opts) : null;
      this.colliders.set(model, c);
    }
    return c;
  }

  /** The newest frame's solid props, before prediction starts again from it. */
  sync(props: readonly PropFrame[], clock: number) {
    const seen = new Set<number>();
    for (const f of props) {
      if (!f.solid || f.model === undefined) continue;
      const fresh = !this.ids.has(f.id);
      if (fresh) {
        const c = this.colliderOf(f.model);
        if (!c) continue;
        addMover(this.world, f.id, c);
        this.ids.add(f.id);
      }
      const pose = propPose(props, f.id, clock);
      if (!pose) continue;
      seen.add(f.id);
      setMoverPose(this.world, f.id, pose, fresh);
    }
    for (const id of this.ids) {
      if (seen.has(id)) continue;
      this.world.mover_remove(id);
      this.ids.delete(id);
    }
    this.world.movers_settle(this.clock === null ? 0 : Math.max(0, clock - this.clock));
    this.clock = clock;
  }

  clear() {
    for (const id of this.ids) this.world.mover_remove(id);
    this.ids.clear();
    this.clock = null;
  }
}
