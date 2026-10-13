import type { Entity, GameContext, ItemStack, Player, RayHit, Vec3 } from '@platform';

/** Who's building: a player, or a mob building through `Building.breakBlock` / `placeBlock`. */
export type Builder = Entity | Player;

export interface BuildingOptions {
  /** May this block be broken? Default: anything `blockInfo` says is breakable (not bedrock). */
  canBreak?(at: Vec3, block: string, by: Builder): boolean;
  /** May this block be placed here? Default: yes. */
  canPlace?(at: Vec3, block: string, by: Builder): boolean;
  /**
   * Seconds for a player to mine a block with what's in their hand (0 = instant, Infinity =
   * can't). Default: the block's `hardness` if the game gave it one, else `defaultBreakTime`, so
   * tools are yours to add here.
   */
  breakTime?(block: string, held: ItemStack | null, player: Player): number;
  /** The block an item places, if any. Default: items whose icon is a block place that block. */
  blockOf?(item: string): string | null;
  /** How far players reach, in blocks. Default 4.6. */
  reach?: number;
  /** Show mining progress as a ring round the crosshair too (besides the cracks). Default true. */
  ring?: boolean;
}

export interface Building {
  /** Call every frame from your game's `update`, before anything else reads the mouse. Handles every player. */
  update(dt: number): void;
  /** Break a block as `by`, if your rules allow it (for bots and scripted builders). */
  breakBlock(x: number, y: number, z: number, by: Builder): boolean;
  /** Place a block as `by`, if your rules allow it. */
  placeBlock(x: number, y: number, z: number, block: string, by: Builder): boolean;
  /** Whether `by` may break this block, by your rules. */
  canBreak(at: Vec3, block: string, by: Builder): boolean;
}

/**
 * Survival building, Minecraft style: hold left-click on a block to mine it (cracks grow over it,
 * the arm swings), right-click with a block item to place it against the face you're aiming at.
 * Aiming at a mob leaves the click to your weapons. Your rules decide what may be broken or
 * placed and how long mining takes.
 *
 * Built only on the public API (`world.raycast` / `breakBlock` / `placeBlock`, `hud.highlight`,
 * `entities.raycast`, `input.consume`), so copy it into your game and change anything.
 */
export function building(game: GameContext, opts: BuildingOptions = {}): Building {
  const reach = opts.reach ?? 4.6;
  const ring = opts.ring ?? true;
  const { world } = game;

  const canBreak = (at: Vec3, block: string, by: Builder) => {
    const info = world.blockInfo(block);
    if (!info || !info.breakable || info.liquid || block === 'air') return false;
    return opts.canBreak?.(at, block, by) ?? true;
  };
  const canPlace = (at: Vec3, block: string, by: Builder) => opts.canPlace?.(at, block, by) ?? true;
  const blockOf =
    opts.blockOf ??
    ((item: string) => {
      const icon = game.items.get(item)?.icon;
      return typeof icon === 'object' && 'block' in icon ? icon.block : null;
    });

  const breakBlock = (x: number, y: number, z: number, by: Builder) =>
    canBreak({ x, y, z }, world.blockName(world.getBlock(x, y, z)), by) && world.breakBlock(x, y, z, { by });
  const placeBlock = (x: number, y: number, z: number, block: string, by: Builder) =>
    canPlace({ x, y, z }, block, by) && world.placeBlock(x, y, z, block, { by });

  // Each player's mining: the block being mined and how far along (0..1), plus repeat timers.
  interface Hands {
    key: string;
    progress: number;
    swingT: number;
    placeT: number;
    ringShown: boolean;
  }
  const hands = new Map<string, Hands>();

  const swing = (player: Player) => player.viewModel.play(player.inventory.held ? 'swing' : 'punch');

  function updatePlayer(player: Player, dt: number) {
    let h = hands.get(player.id);
    if (!h) hands.set(player.id, (h = { key: '', progress: 0, swingT: 0, placeT: 0, ringShown: false }));
    const input = player.input;
    h.swingT -= dt;
    h.placeT = Math.max(0, h.placeT - dt);
    let hit: RayHit | null = null;
    if (player.alive && !player.spectating) {
      // A mob in the crosshair (the ray stops at blocks, so it's in front) is for weapons.
      if (!game.entities.raycast(player.eye, player.look, reach)) hit = world.raycast(player.eye, player.look, reach);
    }
    const held = player.inventory.held;
    const places = held ? blockOf(held.item) : null;
    const canMine = !!hit && game.items.get(held?.item ?? '')?.kind !== 'bow';

    // Mining: progress builds while left-click is held on the same block.
    let mining = false;
    if (hit && canMine && input.button(0)) {
      const name = world.blockName(hit.block);
      const time = canBreak(hit, name, player) ? (opts.breakTime?.(name, held, player) ?? world.blockInfo(name)?.hardness ?? defaultBreakTime(name, world.blockInfo(name)?.plant ?? false)) : Infinity;
      // Unbreakable: leave the click alone (the weapon just swings at it).
      if (Number.isFinite(time)) {
        input.consume(0);
        mining = true;
        const k = `${hit.x},${hit.y},${hit.z}`;
        if (k !== h.key) {
          h.key = k;
          h.progress = 0;
        }
        h.progress += time <= 0 ? 1 : dt / time;
        if (h.swingT <= 0) {
          h.swingT = 0.25;
          swing(player);
        }
        if (h.progress >= 1) {
          breakBlock(hit.x, hit.y, hit.z, player);
          mining = false;
          // A short pause before the next block, like Minecraft.
          h.swingT = 0.15;
        }
      }
    }
    if (!mining) {
      h.key = '';
      h.progress = 0;
    }

    // Placing against the face we're aiming at (or into a plant's cell), repeating while held.
    const first = input.buttonPressed(2);
    if (hit && places && held && (first || (input.button(2) && h.placeT <= 0))) {
      input.consume(2);
      h.placeT = first ? 0.25 : 0.18;
      const into = world.blockInfo(hit.block)?.replaceable;
      const x = into ? hit.x : hit.x + hit.normal.x;
      const y = into ? hit.y : hit.y + hit.normal.y;
      const z = into ? hit.z : hit.z + hit.normal.z;
      if (canPlace({ x, y, z }, places, player) && world.placeBlock(x, y, z, places, { by: player, against: hit })) {
        player.inventory.take(held.item, 1);
        swing(player);
      }
    }

    player.hud.highlight(hit && (canMine || places) ? hit : null, { progress: mining ? h.progress : 0 });
    if (ring && (mining || h.ringShown)) {
      player.hud.progress(mining ? h.progress : null);
      h.ringShown = mining;
    }
  }

  return {
    breakBlock,
    placeBlock,
    canBreak,
    update(dt: number) {
      for (const player of game.players) updatePlayer(player, dt);
    },
  };
}

/** A Minecraft-like time (seconds, bare-handed-ish) to mine a block, by material. */
export function defaultBreakTime(block: string, plant = false): number {
  if (block === 'bedrock') return Infinity;
  if (plant) return 0;
  if (block.endsWith('_bed')) return 0.35;
  if (block.endsWith('_wool') || block.endsWith('_leaves') || block === 'glass' || block === 'glowstone' || block === 'sea_lantern') return 0.4;
  if (/^(dirt|sand|gravel|grass_block|snowy_grass|podzol|clay|snow_block)$/.test(block)) return 0.7;
  if (/(planks|_log|bookshelf)$/.test(block)) return 1.5;
  if (block === 'obsidian') return 12;
  if (block === 'end_stone') return 3;
  return 2.2;
}
