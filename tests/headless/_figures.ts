import * as THREE from 'three';
import type { GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';
import type { Client } from '../../src/platform/api/client';
import type { HumanoidJoint, HumanoidPoses, ItemDefinition, ItemPoses } from '../../src/platform/api/types';
import { humanoid, type HumanoidOptions } from '../../src/platform/client-kits/figures';
import { ShownFigure } from '../../src/platform/client/figures';
import { HumanoidRig } from '../../src/platform/client/humanoid';
import type { AnimState } from '../../src/platform/render/entities';

/**
 * Figures on the humanoid rig outside the game, as the game has them: the engine's rig on a
 * model, the figures kit (`figures.humanoid()`) posing it each step from its state, the rig then
 * putting the pose onto the model (its clips over that).
 */

export const still = (): AnimState => ({ walkPhase: 0, walkAmount: 0, pace: 0, attackT: 9, raised: false, casting: false, headYaw: 0, headPitch: 0, dying: 0, time: 0, aim: 0, posture: 0, speed: 0, moveX: 0, moveZ: 1, sights: 0, shotT: 9 });

/** An item for a figure's hand: its kind and hold (the kit works out how it's held from them) and its model's points. */
export interface TestItem {
  kind: 'gun' | 'melee' | 'throwable' | 'misc';
  grip?: THREE.Vector3;
  grip2?: THREE.Vector3;
  mag?: THREE.Vector3;
  /** Its length along z (its bounds run from 0 to this). */
  length: number;
  stance?: 'rifle' | 'pistol';
  hands?: 1 | 2;
  poses?: ItemPoses;
  action?: string;
  /** Its model (default an empty node). */
  node?: THREE.Object3D;
}

/** A client with only these figures (all a figures kit sees). */
export const clientOf = (figures: readonly ShownFigure[]) => ({ figures: { all: figures } }) as unknown as Client;

/** The item's definition, as a game would give it. */
function defOf(item: TestItem): ItemDefinition {
  if (item.kind === 'gun') return { kind: 'gun', name: 'Gun', hold: { stance: item.stance, gun: { hands: item.hands }, poses: item.poses }, action: item.action } as ItemDefinition;
  return { kind: item.kind, name: item.kind } as ItemDefinition;
}

/** Put an item in a figure's hand as the engine does (its model on a mount on the hand), or empty it. */
export function give(fig: ShownFigure, item: TestItem | null): THREE.Object3D | null {
  (fig.held?.node as THREE.Object3D | undefined)?.removeFromParent();
  fig.held = null;
  if (!item) return null;
  const node = item.node ?? new THREE.Object3D();
  const mount = new THREE.Object3D();
  (fig.hand as THREE.Object3D).add(mount);
  mount.add(node);
  const points = Object.fromEntries((['grip', 'grip2', 'mag'] as const).flatMap((n) => (item[n] ? [[n, item[n]!.clone()]] : [])));
  const bounds = new THREE.Box3(new THREE.Vector3(-0.05, -0.1, 0), new THREE.Vector3(0.05, 0.1, item.length));
  fig.held = { item: item.kind, def: defOf(item), node, mount, form: 'model', points, bounds, length: item.length };
  return node;
}

export interface Posed {
  rig: HumanoidRig;
  fig: ShownFigure;
  /** A joint of the model's own skeleton, in the world. */
  at(name: Exclude<HumanoidJoint, 'gripL' | 'gripR'>): THREE.Vector3;
  /** What's held (its model), if anything. */
  node: THREE.Object3D | null;
}

/** A figure on the rig, and a step: its state, the kit's pose, the pose onto the model. */
export function figureOn(gltf: GLTF, o: { joints?: Partial<Record<HumanoidJoint, string>>; poses?: HumanoidPoses; kit?: HumanoidOptions } = {}) {
  const root = new THREE.Group();
  const model = cloneSkinned(gltf.scene);
  root.add(model);
  const rig = new HumanoidRig(model, { joints: o.joints, clips: gltf.animations });
  const state = still();
  const fig = new ShownFigure(1, null, 'test', { rig: 'gltf', parts: [], atlas: 'builtin', scale: 1, gltf: { url: '/test.glb', rig: 'humanoid', joints: o.joints, poses: o.poses } }, { root, hand: rig.joint('handR'), rig }, state);
  const kit = humanoid(o.kit);
  const client = clientOf([fig]);
  const step = (s: Partial<AnimState>) => {
    Object.assign(state, s);
    kit.frame!(client, 1 / 60);
    rig.apply(state.time, fig.held?.mount as THREE.Object3D | undefined);
    fig.posed = false;
  };
  return { root, rig, fig, state, step };
}

/** A figure on the rig holding `item`, stepped through `seconds` of `state` (60 steps a second). */
export function posed(gltf: GLTF, o: { joints?: Partial<Record<HumanoidJoint, string>>; poses?: HumanoidPoses; kit?: HumanoidOptions }, seconds: number, state: Partial<AnimState>, setup: { item?: TestItem; before?: (f: ReturnType<typeof figureOn>) => void } = {}): Posed {
  const f = figureOn(gltf, o);
  const node = setup.item ? give(f.fig, setup.item) : null;
  setup.before?.(f);
  const s = still();
  for (let i = 1; i <= Math.round(seconds * 60); i++) f.step(Object.assign(s, state, { time: i / 60 }));
  f.root.updateMatrixWorld(true);
  const at = (name: Exclude<HumanoidJoint, 'gripL' | 'gripR'>) => f.rig.joint(name).getWorldPosition(new THREE.Vector3());
  return { rig: f.rig, fig: f.fig, at, node };
}
