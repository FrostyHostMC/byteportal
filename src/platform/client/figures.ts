import * as THREE from 'three';
import type { Figure as ClientFigure, FigureHeld, FigureNode, FigureRig, HeldPoint } from '../api/client/figures';
import type { HeldModelSpec, ItemDefinition, ModelSpec } from '../api/types';
import type { AnimState, Figure } from '../render/entities';
import type { ItemPoint } from './gltf';
import { heldPoint } from './held';
import type { HumanoidRig } from './humanoid';

/**
 * Figures as client code sees them (`client.figures`): each drawn figure's nodes, rig, state and
 * what it holds. The engine places each figure and keeps its state; client code (the figures kit)
 * poses it; the engine then draws it (see `EntityView`).
 */

const POINTS: HeldPoint[] = ['grip', 'grip2', 'muzzle', 'sight', 'mag'];

/** A drawn figure's parts, as client code gets them. */
export interface FigureParts {
  root: THREE.Object3D;
  /** What a held item hangs from. */
  hand: THREE.Object3D | null;
  rig: HumanoidRig | null;
}

/** The parts of an engine's figure (a box model or a glTF figure). */
export const partsOf = (model: Figure): FigureParts => ({ root: model.root, hand: model.pivots.get('armR') ?? null, rig: model.rig ?? null });

/** One drawn figure, for client code. */
export class ShownFigure implements ClientFigure {
  posed = false;
  held: FigureHeld | null = null;
  readonly root: FigureNode;
  readonly hand: FigureNode | null;
  readonly rig: FigureRig | null;

  constructor(
    readonly id: number,
    readonly player: string | null,
    readonly type: string,
    readonly spec: ModelSpec,
    parts: FigureParts,
    readonly state: AnimState,
    /** Where its held item's marked point is drawn now (the engine's view of it). */
    private pointOf: (name: HeldPoint) => THREE.Vector3 | null = () => null,
  ) {
    this.root = parts.root;
    this.hand = parts.hand;
    const rig = parts.rig;
    this.rig = rig ? { body: rig.body, root: rig.root, joints: rig.joints, rest: rig.rest, straight: rig.straight } : null;
  }

  used() {
    this.state.shotT = 0;
  }

  point(name: HeldPoint): THREE.Vector3 | null {
    return this.pointOf(name);
  }
}

/**
 * An item in a figure's hand, for client code: its model (`node`) hanging from `mount`, its points
 * (the spec's over the file's), its bounds and length.
 */
export function heldView(item: string, def: ItemDefinition | undefined, node: THREE.Object3D, mount: THREE.Object3D, look: { geometry: THREE.BufferGeometry; model?: HeldModelSpec; points?: Partial<Record<ItemPoint, THREE.Vector3>> }): FigureHeld {
  const points: Partial<Record<HeldPoint, THREE.Vector3>> = {};
  if (look.model) {
    for (const name of POINTS) {
      const p = heldPoint(look.model, look.points, name);
      if (p) points[name] = p;
    }
  }
  const geometry = look.geometry;
  geometry.computeBoundingBox();
  const bounds = geometry.boundingBox!.clone();
  return { item, def, node, mount, form: look.model ? 'model' : 'sprite', points, bounds, length: bounds.max.z - bounds.min.z };
}
