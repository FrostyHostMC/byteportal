import type { VoxelWorld } from '@engine/voxel_engine.js';
import type { RayHit } from '../api/types';
import type { Registry } from '../world/registry';
import type { PlayerSim } from './player';
import type { Presentation } from './present';
import { rayHit } from './worldquery';

const REACH = 6.5;

/**
 * Creative building (`player.build`): a hotbar of blocks, instant breaking and placing, and
 * middle-click to pick the block you're looking at.
 */
export class CreativeBuild {
  hotbar: number[];
  selected = 0;
  private breakTimer = 0;
  private placeTimer = 0;

  constructor(
    private world: VoxelWorld,
    private registry: Registry,
    private present: Presentation,
    private player: PlayerSim,
    /** Break a block with debris and what hangs on it (the simulation's `world.breakBlock`). */
    private breakBlock: (x: number, y: number, z: number) => boolean,
    /** Place a block against the face aimed at (the simulation's `world.placeBlock`). */
    private placeBlock: (x: number, y: number, z: number, id: number, against: RayHit) => boolean,
  ) {
    const names = ['grass_block', 'stone', 'oak_planks', 'cobblestone', 'glass', 'oak_log', 'torch', 'glowstone', 'bricks'];
    this.hotbar = names.map((n) => registry.byName.get(n)?.id ?? 1);
  }

  get selectedBlock(): number {
    return this.hotbar[this.selected];
  }

  select(i: number) {
    this.selected = ((i % 9) + 9) % 9;
  }

  /** The block picker: put a block in the current slot. */
  pick(id: number) {
    if (this.registry.blocks[id]?.placeable) this.hotbar[this.selected] = id;
  }

  /** The block to pick for one in the world: its family's (a wall torch is a torch). */
  private pickable(id: number): number | null {
    const def = this.registry.blocks[id];
    const d = def && this.registry.byName.get(def.name);
    return d?.placeable ? d.id : null;
  }

  private swing() {
    this.player.swings++;
    this.present.send(this.player.id, 'view', 'use', [1]);
  }

  update(dt: number) {
    this.breakTimer = Math.max(0, this.breakTimer - dt);
    this.placeTimer = Math.max(0, this.placeTimer - dt);
    const eye = this.player.eye;
    const d = this.player.look;
    const t = rayHit(this.world, eye, d, REACH);
    this.present.send(this.player.id, 'hud', 'highlight', [t && { x: t.x, y: t.y, z: t.z }]);
    const input = this.player.input;
    if (!input.active) return;

    if (input.wheel !== 0) this.select(this.selected + input.wheel);
    for (let i = 0; i < 9; i++) if (input.pressed(`Digit${i + 1}`)) this.select(i);

    if (input.buttonPressed(0)) this.swing();
    if (t && (input.buttonPressed(0) || (input.button(0) && this.breakTimer <= 0))) {
      if (!input.buttonPressed(0)) this.swing();
      const def = this.registry.blocks[t.block];
      if (def?.breakable) this.breakBlock(t.x, t.y, t.z);
      this.breakTimer = input.buttonPressed(0) ? 0.3 : 0.22;
    }
    if (t && (input.buttonPressed(2) || (input.button(2) && this.placeTimer <= 0))) {
      this.swing();
      this.place(t);
      this.placeTimer = input.buttonPressed(2) ? 0.3 : 0.2;
    }
    if (t && input.buttonPressed(1)) {
      const id = this.pickable(t.block);
      if (id !== null) {
        const at = this.hotbar.indexOf(id);
        if (at >= 0) this.select(at);
        else this.hotbar[this.selected] = id;
      }
    }
  }

  private place(t: RayHit) {
    // Against the face aimed at, or into a plant's cell.
    const into = this.registry.blocks[t.block]?.replaceable;
    this.placeBlock(into ? t.x : t.x + t.normal.x, into ? t.y : t.y + t.normal.y, into ? t.z : t.z + t.normal.z, this.selectedBlock, t);
  }
}
