import type * as THREE from 'three';
import type { FirstPersonArms, HeldModelSpec, ItemDefinition, ViewAnimation } from '../types';
import type { Node } from './core';

type Vec3 = THREE.Vector3;
type Quat = THREE.Quaternion;
type Box3 = THREE.Box3;

/**
 * The first-person layer: drawn over the world with its own lens, lit by the light where the
 * player's eyes are. The engine loads what's in hand and builds the player's arms; a kit places
 * them (`firstPerson.standard()` in `@platform/client/kits`, or a game's own).
 *
 * The layer's space is its camera's: x right, y up, z back (ahead is -z), in blocks, the eye at
 * the origin. Nothing is placed for you: until a kit adds the held item's node and the arms under
 * `root`, the layer is empty.
 */
export interface ViewLayer {
  /** Everything in the layer hangs from this (the engine never moves it). */
  readonly root: Node;
  /** The layer's own lens. */
  readonly camera: ViewCamera;
  /**
   * Whether the engine draws the layer this frame: not on the title screen, while dead, in a
   * vehicle or in third person, nor in a game with its own camera (`player.controller: 'none'`).
   * Kits keep running while it's hidden (a hand lowered while dead comes back up).
   */
  readonly visible: boolean;
  /**
   * What's in hand: the item selected (or a throwable being thrown with its key, or a building
   * game's block), loaded and ready to add under `root`; null for an empty hand, or while its
   * model's file is still coming. A new object each time what's in hand changes (the `equip`
   * event says so); the one before stays usable until a kit lets it go.
   */
  readonly held: HeldItem | null;
  /** The player's own arms, as the engine builds them from their skin or model. */
  readonly arms: ViewArms;
  /** The game's first-person animations by name (the server's `viewModel.define`, and inline ones it plays). */
  readonly animations: ReadonlyMap<string, ViewAnimation>;
  /** A new empty group (to move things together). */
  node(): Node;
  /**
   * A flat square (1 block, facing +z) showing an image: `'flash'` (a muzzle flash: a hot core
   * with spikes, white to orange) or an image's address. Hidden until you show it.
   */
  sprite(image: 'flash' | string, opts?: ViewSpriteOptions): Node;
  /**
   * An item's look as a node of the layer's, lit and drawn as what's in hand is (an off-hand
   * shield, a second dagger): its model, or its sprite extruded, in its own space (as `HeldItem`'s).
   * Null while its model's file is still coming (ask again). A kit adds it under `root` and places
   * it; `free` takes it out again.
   */
  item(id: string): Node | null;
  /** Take a node out of the layer and free what the engine made for it (a sprite, an arm, a box). */
  free(node: Node): void;
  /**
   * A point the held item marks (`held.points`), in the world, as drawn this frame (after the
   * kits have placed it): a tracer leaving the muzzle. Null when nothing held is on show, or it
   * has no such point.
   */
  worldPoint(name: string, out?: Vec3): Vec3 | null;
}

/** The first-person layer's lens (its own, not the world's: a kit narrows it to frame sights). */
export interface ViewCamera {
  /** Vertical field of view, degrees (70). */
  fov: number;
  /** Width over height, the world camera's. */
  readonly aspect: number;
}

export interface ViewSpriteOptions {
  /** Added to what's behind it (glows), not drawn over it. Default false. */
  additive?: boolean;
  /** Hidden behind nearer things in the layer (the hand, the item itself). Default true. */
  depthTest?: boolean;
  /** Tint, linear RGB (may go over 1, to glow). Default white. */
  color?: [number, number, number];
}

/**
 * What's in hand, as the engine loaded it. Its `node` is drawn only once a kit adds it under the
 * layer's `root`, and wherever the kit puts it.
 *
 * Its own space: blocks, x across, y up, +z along its length (a model's tip end).
 * - `sprite`: its icon extruded (a pixel thick): one block square, centred on the origin (see `pixel`).
 * - `model`: its box or glTF model (`model`), as the spec builds it.
 * - `block`: a little cube of a block (a slab, stairs, a whole bed shrunk to one), one block, centred.
 * - `cross`: a plant, a torch: a flat square, one block, centred (see `pixel`).
 */
export interface HeldItem {
  /** The item (null: a building game's block, chosen from the block picker). */
  readonly item: string | null;
  readonly def: ItemDefinition | undefined;
  readonly form: 'sprite' | 'model' | 'block' | 'cross';
  /** The spec a `model` is built from (the item's `hold.model`, or its icon's model); null otherwise. */
  readonly model: HeldModelSpec | null;
  /** Its mesh. */
  readonly node: Node;
  /**
   * What it's drawn from: two held items with the same `look` are drawn the same (two items can
   * share a model).
   */
  readonly look: object;
  /**
   * Points it marks, by name, in its own space: a model's spec (`grip`, `grip2`, `muzzle`,
   * `sight`, `mag`, in pixels) over the empty nodes its file names so. A kit may add its own (the
   * first-person kit writes in the gun points it guessed, so effects leave from the same muzzle).
   */
  readonly points: Record<string, Vec3>;
  /** Its geometry's bounds, in its own space. */
  readonly bounds: Box3;
  /** How far its sides are from its middle (x) at a point along it (`z`): 1.2 px where it has none. */
  halfWidthAt(z: number): number;
  /** A pixel of a `sprite` or `cross` (x, y from its top left, 0..16), or of a `block`'s face, in its own space. */
  pixel(x: number, y: number, out?: Vec3): Vec3;
  /** Show its other look, the item's `drawIcon` (a bow drawn), or its own again; at once, in place. */
  alternate(on: boolean): void;
  /** A point of its own space in the world, as drawn this frame. */
  toWorld(p: Vec3, out?: Vec3): Vec3;
}

/**
 * The player's own arms: the engine builds the meshes from their skin (the classic Minecraft
 * layout) or their model; kits place them. `version` counts up when any of it changes: whatever a
 * kit made with `arm` or `box` should then be made again.
 */
export interface ViewArms {
  readonly version: number;
  /** The skin the arms wear (its layout's origin, in `atlas`), or null: no skin arms, the item alone. */
  readonly skin: { readonly uv: [number, number]; readonly atlas: string } | null;
  /** The player's model has an arm of its own (its `hand` part): `arm` makes that instead of the skin's. */
  readonly model: boolean;
  /** A humanoid model's arms (its upper arms, forearms and fists), in place of the others; null for any other player. */
  readonly humanoid: HumanoidViewArms | null;
  /** Wear this skin (the server's `viewModel.setSkin`); null hides the skin arms. */
  setSkin(skin: [number, number] | null, atlas?: string): void;
  /**
   * A new arm: the model's own (standing along y, centred), else the skin's right arm as a box 4
   * by `length` by 4 pixels (12 by default) standing along +y from its middle, the shoulder at +y
   * and its front toward +z (`mirror`: the left arm's look). Null with neither.
   */
  arm(opts?: { length?: number; mirror?: boolean }): Node | null;
  /** A new box the colour of the skin's hand, `size` pixels, centred (a palm, a finger). Null without a skin. */
  box(size: [number, number, number]): Node | null;
}

/**
 * A humanoid model's arms (docs/HUMANOID.md), for its player's first-person view. Each piece
 * hangs in its joint's space as the rig has it, standing straight with the bone along -y. Add the
 * pieces to the layer and place them.
 */
export interface HumanoidViewArms {
  R: ViewArm;
  L: ViewArm;
  /** The model's `firstPerson` fit, as given (null: none). */
  fit: FirstPersonArms | null;
  /** The size things are held at, for these arms: an item drawn at `heldScale` times its size fits their fists at 1. */
  heldScale: number;
}

/** One side of a humanoid's arms. */
export interface ViewArm {
  upper: Node;
  forearm: Node;
  fist: Node;
  /** Where the elbow is below the shoulder, and the wrist below the elbow. */
  elbow: Vec3;
  wrist: Vec3;
  /** Where (and how turned) the fist holds, in the wrist's space. */
  grip: Vec3;
  gripQ: Quat;
}
