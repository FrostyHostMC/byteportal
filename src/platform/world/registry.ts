import { engine } from '../engine/wasm';
import type { BlockRef, BlockShape, DestructibleOptions, SoundName } from '../api/types';
import { firstGameBlock, type GameBlocks } from './blocks';

export type BlockModel = '' | 'torch' | 'wall_torch' | 'slab' | 'stairs' | 'bed' | 'fence' | 'pane' | 'post' | 'boxes';

export interface BlockDef {
  id: number;
  /** The family name, shared by its variants (`red_bed`). */
  name: string;
  label: string;
  /** Which variant of its family: `{ facing: 'east', part: 'head' }`; `{}` for most blocks. */
  state: Record<string, string>;
  /** Exactly this variant, as a block reference: `red_bed[facing=east,part=head]`, or the name. */
  key: string;
  shape: 'air' | 'cube' | 'cross' | 'liquid' | 'model';
  model: BlockModel;
  layer: number;
  /** Texture layer per face: +X -X +Y -Y +Z -Z. */
  tex: number[];
  /** Texture transform per face (1 swap u/v, 2 flip u, 4 flip v). */
  uvt: number[];
  tint: boolean;
  emit: number;
  solid: boolean;
  replaceable: boolean;
  /** In the block picker: one variant per family. */
  placeable: boolean;
  /** Players and explosions can break it (not bedrock, not liquids). */
  breakable: boolean;
  /** A game's own block: seconds to mine it by hand (`BlockDefinition.hardness`). */
  hardness?: number;
  /** A game's own block: the sounds it makes broken and placed. */
  sounds?: { break?: SoundName; place?: SoundName };
  /** Plants and torches: break at a touch, and show as flat items. */
  small: boolean;
  /** A slab: the block its two halves make together (else 0). */
  double: number;
  /** Sides solid enough to hang a torch on or stand one on: a bit per face (+X -X +Y -Y +Z -Z). */
  sturdy: number;
  /**
   * Models: the boxes you aim at and (if solid) collide with, [x0, y0, z0, x1, y1, z1] in 1/16. A
   * fence or pane's are its post alone (the engine's `target_boxes` has them as it stands).
   */
  boxes?: number[][];
  /** Models that collide with more than you aim at (a fence, 24/16 high): what bodies collide with. */
  collide?: number[][];
  /** Models: the boxes drawn: 6 corners, a texture per face (-1: not drawn), a transform per face. A fence or pane is drawn joined east and west. */
  parts?: number[][];
  /** A fence or pane: joined to what's beside it where it stands. */
  joins?: boolean;
  /** Bodies climb it (a game's ladders and vines). */
  climbable?: boolean;
}

export interface Registry {
  blocks: BlockDef[];
  textures: string[];
  /** Family name to its default variant (the one in the picker). */
  byName: Map<string, BlockDef>;
  /** Every variant of each family. */
  families: Map<string, BlockDef[]>;
}

/**
 * The blocks in use in this thread's engine: the built-in ones and, after `useGameBlocks(game)`,
 * the game's own (pass it for what only the definitions say: hardness, sounds, texture names).
 */
export function loadRegistry(game?: GameBlocks): Registry {
  const json = JSON.parse(engine.block_registry_json()) as {
    blocks: (Omit<BlockDef, 'state' | 'key'> & { state: string })[];
    textures: string[];
  };
  const first = firstGameBlock();
  const blocks: BlockDef[] = json.blocks.map((b) => {
    const d: BlockDef = { ...b, state: parseState(b.state), key: b.state ? `${b.name}[${b.state}]` : b.name };
    const own = b.id >= first ? game?.defs.get(b.name) : undefined;
    if (own?.hardness !== undefined) d.hardness = own.hardness;
    if (own?.sounds) d.sounds = { ...own.sounds };
    return d;
  });
  const byName = new Map<string, BlockDef>();
  const families = new Map<string, BlockDef[]>();
  for (const b of blocks) {
    const f = families.get(b.name);
    if (f) f.push(b);
    else families.set(b.name, [b]);
    if (!byName.has(b.name) || (b.placeable && !byName.get(b.name)!.placeable)) byName.set(b.name, b);
  }
  return { blocks, textures: [...json.textures, ...(game?.textureNames ?? [])], byName, families };
}

function parseState(s: string): Record<string, string> {
  const out: Record<string, string> = {};
  if (!s) return out;
  for (const kv of s.split(',')) {
    const [k, v] = kv.split('=');
    if (k && v !== undefined) out[k.trim()] = v.trim();
  }
  return out;
}

/**
 * A block reference as an id: an id, a family name (its default variant), or a name with a
 * state, Minecraft style: `oak_stairs[facing=east,half=top]` (states left out keep the default's).
 */
export function blockIdOf(reg: Registry, ref: BlockRef): number {
  if (typeof ref === 'number') return ref;
  const open = ref.indexOf('[');
  if (open < 0) {
    const d = reg.byName.get(ref);
    if (!d) throw new Error(`unknown block "${ref}"`);
    return d.id;
  }
  const name = ref.slice(0, open);
  const family = reg.families.get(name);
  if (!family) throw new Error(`unknown block "${ref}"`);
  const want = { ...reg.byName.get(name)!.state, ...parseState(ref.slice(open + 1, ref.lastIndexOf(']'))) };
  const keys = new Set([...Object.keys(want), ...family.flatMap((b) => Object.keys(b.state))]);
  const match = family.find((b) => [...keys].every((k) => (b.state[k] ?? '') === (want[k] ?? '')));
  if (!match) throw new Error(`block "${name}" has no state [${ref.slice(open + 1, -1)}]`);
  return match.id;
}

/** The variant of a family with these states (the rest as `base` has them). */
export function variant(reg: Registry, base: BlockDef, state: Record<string, string | undefined>): BlockDef | null {
  const want: Record<string, string> = { ...base.state };
  for (const [k, v] of Object.entries(state)) {
    if (v === undefined) delete want[k];
    else want[k] = v;
  }
  const family = reg.families.get(base.name) ?? [base];
  const keys = new Set([...Object.keys(want), ...family.flatMap((b) => Object.keys(b.state))]);
  return family.find((b) => [...keys].every((k) => (b.state[k] ?? '') === (want[k] ?? ''))) ?? null;
}

/**
 * Which block ids carve (`world.destructible`), as the engine's table (`set_destructible`): 1 for
 * each variant of the named families (every breakable block for `'all'`), less `except`, and only
 * solid, full, opaque blocks (what the engine carves: not glass, leaves, slabs or plants).
 */
export function destructibleIds(registry: Registry, o: DestructibleOptions): Uint8Array {
  const ids = new Uint8Array(256);
  const family = (name: string) => {
    const f = registry.families.get(name);
    if (!f) throw new Error(`world.destructible: unknown block "${name}"`);
    return f;
  };
  const carves = (b: BlockDef) => b.solid && b.shape === 'cube' && b.layer === 0;
  if (o.blocks === undefined || o.blocks === 'all') {
    for (const b of registry.blocks) if (b.breakable && carves(b)) ids[b.id] = 1;
  } else for (const name of o.blocks) for (const b of family(name)) if (carves(b)) ids[b.id] = 1;
  for (const name of o.except ?? []) for (const b of family(name)) ids[b.id] = 0;
  return ids;
}

/** A block's shape as `blockInfo` says it (a torch on a wall is a torch). */
export function blockShape(d: BlockDef): BlockShape {
  if (d.shape !== 'model') return d.shape;
  if (d.model === 'wall_torch') return 'torch';
  return d.model || 'boxes';
}

/**
 * The boxes bodies collide with in a block, in blocks within its cell (`[x0, y0, z0, x1, y1,
 * z1]`); none if it isn't solid. A fence or pane is its post alone (its arms depend on what's
 * beside it).
 */
export function collisionBoxes(d: BlockDef): number[][] {
  if (!d.solid) return [];
  const boxes = d.collide ?? d.boxes ?? [[0, 0, 0, 16, 16, 16]];
  return boxes.map((b) => b.map((v) => v / 16));
}

/** Default biome tint used for icons and particles (sRGB 0..1). */
export const DEFAULT_TINT: [number, number, number] = [0.52, 0.76, 0.33];
