import type * as THREE from 'three';
import type { HumanoidJoint, ItemDefinition, ModelSpec } from '../types';
import type { Node } from './core';

/**
 * Players' and creatures' figures as drawn, for kits that pose them (see `figures.humanoid()`).
 *
 * The engine draws each figure where it is, turned the way it faces, and keeps what it's doing
 * (`state`). A figure on the humanoid rig (docs/HUMANOID.md) stands straight until a kit poses
 * its joints each frame; the engine then turns the model's own skeleton to match and plays the
 * model's clips over it. Other figures (box models, glTF figures with clips) animate themselves
 * unless a kit poses them (`posed`).
 */
export interface ClientFigures {
  /** Every figure drawn this frame, entities' and other players' (and our own in third person). */
  readonly all: readonly Figure[];
}

/** A figure's joint or part: a node, and what posing needs to ask of it (where it is in the world). */
export type FigureNode = Node & Pick<THREE.Object3D, 'localToWorld' | 'worldToLocal' | 'getWorldPosition' | 'getWorldQuaternion' | 'updateWorldMatrix'>;

/** The humanoid rig's bones: its joints but the fists' grips. */
export type FigureBone = Exclude<HumanoidJoint, 'gripL' | 'gripR'>;

/** One drawn figure. */
export interface Figure {
  /** Its entity's id while it's drawn (another player's figure has a negative one of its own). */
  readonly id: number;
  /** The player it shows, or null for a creature. */
  readonly player: string | null;
  /** Its entity type. */
  readonly type: string;
  /** Its model as the game describes it (`Models.gltf(url, { rig: 'humanoid', poses })`, a box model). */
  readonly spec: ModelSpec;
  /** Where it stands and faces (the engine places it). */
  readonly root: FigureNode;
  /** What an item in its hand hangs from: the model's right hand (a box model's `armR`, a glTF model's `hand`). Null: it holds nothing. */
  readonly hand: FigureNode | null;
  /** Its humanoid rig, if its model is built on one. */
  readonly rig: FigureRig | null;
  /** What it's doing, as the engine keeps it. */
  readonly state: Readonly<FigureState>;
  /** What's in its hand, once its model is here. */
  readonly held: FigureHeld | null;
  /**
   * A kit posed it this frame: the engine leaves its own animation out (a figure on the rig has
   * none: it stands straight unless a kit poses it). Cleared after each frame.
   */
  posed: boolean;
  /** Its held item was just used (a shot fired): `state.shotT` starts again. */
  used(): void;
  /** Where a point its held item's model marks (`muzzle`) is now in the world; null if it holds nothing or its model marks none. */
  point(name: HeldPoint): THREE.Vector3 | null;
}

/**
 * The humanoid rig's own skeleton, which a kit poses: its joints where the model's are standing
 * straight (each arm and leg hanging straight down), unturned, each bone along its -y; the fists'
 * grips on the hands. Whatever skeleton the model has, and however it rests, its joints follow
 * these (each takes its rig joint's turn), once the kits have run.
 */
export interface FigureRig {
  /** The model's own space (the skeleton is in it): +y up, facing +z, the ground at y 0. */
  readonly body: FigureNode;
  /** The skeleton's root, in the body (the hips hang from it). */
  readonly root: FigureNode;
  /** Each joint (a kit sets their places and turns: start from `rest` each frame). */
  readonly joints: Readonly<Record<HumanoidJoint, FigureNode>>;
  /** Each joint at rest, in its parent's space (the bones unturned; a grip's turn is its fist's hold). */
  readonly rest: Readonly<Record<HumanoidJoint, { readonly position: THREE.Vector3; readonly quaternion: THREE.Quaternion }>>;
  /** Each bone standing straight, in the body's space: its heights (the ankles' above the ground, the shoulders'). */
  readonly straight: Readonly<Record<FigureBone, THREE.Vector3>>;
}

/** Points an item's model marks (`grip`, `grip2`, `muzzle`, `sight`, `mag`). */
export type HeldPoint = 'grip' | 'grip2' | 'muzzle' | 'sight' | 'mag';

/** An item in a figure's hand, as drawn. */
export interface FigureHeld {
  readonly item: string;
  readonly def: ItemDefinition | undefined;
  /** The item's model (or its icon, extruded), its own origin at the mount's until a kit places it. */
  readonly node: FigureNode;
  /** What the model hangs from: on the figure's hand until a kit puts it elsewhere (the rig's chest, to aim it). */
  readonly mount: FigureNode;
  /** A held model (boxes or glTF: `hold.model`, or a model as its icon), or a sprite (the icon, extruded). */
  readonly form: 'model' | 'sprite';
  /** Its marked points, in its own space: its spec's (`HeldModels.gltf(url, { grip2 })`) over what its file marks. */
  readonly points: Readonly<Partial<Record<HeldPoint, THREE.Vector3>>>;
  /** Its bounds in its own space, and its length along z (a pistol is short). */
  readonly bounds: THREE.Box3;
  readonly length: number;
}

/** What a figure is doing, as the engine keeps it from the frames (players' figures: from their players'). */
export interface FigureState {
  /** Seconds on its clock (it stops while the game does). */
  time: number;
  /** A walk cycle's phase (radians) and how much it shows (0..1). */
  walkPhase: number;
  walkAmount: number;
  /** Speed over its usual walking speed (above ~1.3 it's running). */
  pace: number;
  /** Ground speed (blocks a second), and which way it's going in its own space (+z ahead, +x its left). */
  speed?: number;
  moveX?: number;
  moveZ?: number;
  /** Off the ground. */
  air?: boolean;
  /** How low it is: standing 0, crouching 1, sliding 2 (blended). */
  posture: number;
  /** How far it leans out sideways to peek (blocks, positive to its right; blended). */
  lean?: number;
  /** Where its head looks, from its body (radians). */
  headYaw: number;
  headPitch: number;
  /** Seconds since it last attacked (large: not lately). */
  attackT: number;
  /** Arms raised for a wind-up; casting. */
  raised: boolean;
  casting: boolean;
  /**
   * Its held item's mechanics aim it where it looks (a player's gun), 0..1 blended; and how far it
   * looks down the item's sights, 0..1 blended (the item's mechanics say).
   */
  aim: number;
  sights?: number;
  /** Sprinting; its held item's mechanics are reloading it. */
  sprint?: boolean;
  reloading?: boolean;
  /** Seconds since its held item last fired (large: not lately). */
  shotT?: number;
  /** Its fall on death, 0..1 (0 alive). */
  dying: number;
}
