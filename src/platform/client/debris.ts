import type * as THREE from 'three';
import type { VoxelWorld } from '@engine/voxel_engine.js';
import type { Vec3 } from '../api/types';
import type { Particles } from '../render/particles';
import { Rubble, damageTaken } from '../render/rubble';
import type { TextureSet } from '../render/textures';
import { DEFAULT_TINT, type Registry } from '../world/registry';

/** What rubble and dust need of the runtime. */
export interface DebrisParts {
  /** The world's blocks: what was hit, and what rubble lands on. */
  world: VoxelWorld;
  registry: Registry;
  /** The block textures: rubble and dust are coloured from a block's own. */
  textures: TextureSet;
  particles: Particles;
  /** Where rubble is drawn, and the sun's direction that lights it. */
  scene: THREE.Scene;
  sunDir: { value: THREE.Vector3 };
}

/**
 * What breaking blocks throws on this screen: rubble (chips and chunks knocked out of blocks,
 * settling as little cubes) flung away from an explosion just shown, dust, and a broken block's
 * particles. Each screen works it out from the same damage.
 */
export class Debris {
  /** Chips and chunks knocked out of blocks, settling as little cubes. */
  private rubble: Rubble;
  /** Damage this batch brought (rubble is thrown once the batch's explosions are known), and those explosions. */
  private damageSeen: Uint8Array[] = [];
  private blasts: { at: Vec3; size: number; age: number }[] = [];
  /** Average colours of blocks' textures (bullet chips), by block id. */
  private blockColors = new Map<number, [number, number, number]>();

  constructor(private p: DebrisParts) {
    const world = p.world;
    this.rubble = new Rubble((x, y, z) => world.point_solid(x, y, z), p.sunDir);
    p.scene.add(this.rubble.mesh);
  }

  /** An explosion shown here (`fx`): rubble near it for a moment after is flung away from it. */
  blast(at: Vec3, size: number) {
    this.blasts.push({ at: { x: at.x, y: at.y, z: at.z }, size, age: 0 });
  }

  /** Damage a batch brought: its rubble flies once the batch is in (`flush`). */
  seen(data: Uint8Array) {
    this.damageSeen.push(data);
  }

  /** The batch is in: the rubble its damage knocked out flies. */
  flush() {
    for (const d of this.damageSeen) this.fromDamage(d);
    this.damageSeen = [];
  }

  /** A block broken whole (`$debris`): its particles, and chunks of it. */
  broken(x: number, y: number, z: number, id: number) {
    const def = this.p.registry.blocks[id];
    if (!def) return;
    const face = def.tex[0];
    this.p.particles.burst(x, y, z, this.p.textures.albedoData.subarray(face * 1024, face * 1024 + 1024), def.tint ? DEFAULT_TINT : null);
    this.fromBlock(x, y, z, id);
  }

  /** The rubble moves on by the frame's time, lit by the light at the eyes; explosions age. */
  update(dt: number, light: THREE.Vector3) {
    this.rubble.setLight(light);
    this.rubble.update(dt);
    for (let i = this.blasts.length - 1; i >= 0; i--) if ((this.blasts[i].age += dt) > 0.3) this.blasts.splice(i, 1);
  }

  /** A restart: the rubble goes. */
  clear() {
    this.rubble.clear();
  }

  /** A block's average colour (linear), for the chips a bullet knocks off it. */
  blockColor(id: number): [number, number, number] {
    let c = this.blockColors.get(id);
    if (c) return c;
    const def = this.p.registry.blocks[id];
    const layer = def?.tex[0] ?? 0;
    const px = this.p.textures.albedoData.subarray(layer * 1024, layer * 1024 + 1024);
    let r = 0;
    let g = 0;
    let b = 0;
    for (let i = 0; i < 1024; i += 4) {
      r += (px[i] / 255) ** 2.2;
      g += (px[i + 1] / 255) ** 2.2;
      b += (px[i + 2] / 255) ** 2.2;
    }
    const tint = def?.tint ? DEFAULT_TINT : [1, 1, 1];
    c = [(r / 256) * tint[0], (g / 256) * tint[1], (b / 256) * tint[2]];
    this.blockColors.set(id, c);
    return c;
  }

  /**
   * Rubble from damage (a batch's carves: bullets' pits, a blast's crater): a few chips out of
   * each block, more the more went, flung away from an explosion just shown, with a puff of dust.
   */
  fromDamage(data: Uint8Array) {
    const cells = damageTaken(data, 5);
    // A big change at once (a player joining late catching up) throws nothing.
    if (cells.length > 400) return;
    for (const c of cells) {
      const id = this.p.world.get_block(c.x, c.y, c.z);
      const def = this.p.registry.blocks[id];
      if (!def) continue;
      const px = this.p.textures.albedoData.subarray(def.tex[0] * 1024, def.tex[0] * 1024 + 1024);
      const tint = def.tint ? DEFAULT_TINT : null;
      const n = Math.min(c.at.length, 1 + Math.floor(c.taken / 260));
      const blast = this.blasts.find((b) => Math.hypot(b.at.x - c.x - 0.5, b.at.y - c.y - 0.5, b.at.z - c.z - 0.5) < 3 + b.size * 2);
      for (let i = 0; i < n; i++) {
        const [x, y, z] = c.at[i];
        let v: Vec3;
        if (blast) {
          // Away from the blast, and up.
          const dx = x - blast.at.x;
          const dy = y - blast.at.y;
          const dz = z - blast.at.z;
          const l = Math.hypot(dx, dy, dz) || 1;
          const k = (4 + Math.random() * 5) * Math.min(1.6, blast.size);
          v = { x: (dx / l) * k, y: (dy / l) * k * 0.6 + 2 + Math.random() * 3, z: (dz / l) * k };
        } else v = { x: (Math.random() - 0.5) * 2.4, y: Math.random() * 1.5, z: (Math.random() - 0.5) * 2.4 };
        const size = c.taken > 600 ? 0.06 + Math.random() * 0.12 : 0.035 + Math.random() * 0.05;
        this.rubble.add(x, y, z, size, v, px, tint);
      }
      // Dust.
      const [x, y, z] = c.at[0] ?? [c.x + 0.5, c.y + 0.5, c.z + 0.5];
      const col = this.blockColor(id);
      const dust: [number, number, number] = [col[0] * 0.6 + 0.2, col[1] * 0.6 + 0.19, col[2] * 0.6 + 0.18];
      this.p.particles.burstColor(x, y, z, dust, { count: blast ? 3 : 1, speed: blast ? 1.6 : 0.5, size: blast ? 0.3 : 0.14, gravity: -0.4, life: blast ? 1.8 : 0.9, drag: 2.2, spread: 0.3, up: 0.3, collide: false });
    }
  }

  /** Rubble from a block broken whole: a handful of chunks tumbling out of where it was. */
  private fromBlock(x: number, y: number, z: number, id: number) {
    const def = this.p.registry.blocks[id];
    if (!def || def.small) return;
    const px = this.p.textures.albedoData.subarray(def.tex[0] * 1024, def.tex[0] * 1024 + 1024);
    const blast = this.blasts.find((b) => Math.hypot(b.at.x - x - 0.5, b.at.y - y - 0.5, b.at.z - z - 0.5) < 3 + b.size * 2);
    for (let i = 0; i < 6; i++) {
      const at = { x: x + 0.2 + Math.random() * 0.6, y: y + 0.2 + Math.random() * 0.6, z: z + 0.2 + Math.random() * 0.6 };
      const dx = blast ? at.x - blast.at.x : Math.random() - 0.5;
      const dz = blast ? at.z - blast.at.z : Math.random() - 0.5;
      const l = Math.hypot(dx, dz) || 1;
      const k = blast ? 3 + Math.random() * 4 : 1 + Math.random() * 1.5;
      this.rubble.add(at.x, at.y, at.z, 0.08 + Math.random() * 0.14, { x: (dx / l) * k, y: 1.5 + Math.random() * 3, z: (dz / l) * k }, px, def.tint ? DEFAULT_TINT : null);
    }
  }
}
