import * as THREE from 'three';
import type { HumanoidJoint } from '../api/types';
import { ClipLayer, type ClipPlay } from './clips';

/** The joints a figure needs for the platform to animate it as a humanoid (docs/HUMANOID.md), each after the one it hangs from. */
const REQUIRED = ['hips', 'spine', 'chest', 'neck', 'head', 'upperArmL', 'lowerArmL', 'handL', 'upperArmR', 'lowerArmR', 'handR', 'upperLegL', 'lowerLegL', 'footL', 'upperLegR', 'lowerLegR', 'footR'] as const;
type Bone = (typeof REQUIRED)[number];
type Joint = Bone | 'gripL' | 'gripR';

/** Which joint each hangs from on the rig. */
const PARENT: Record<Bone, Bone | null> = {
  hips: null,
  spine: 'hips',
  chest: 'spine',
  neck: 'chest',
  head: 'neck',
  upperArmL: 'chest',
  lowerArmL: 'upperArmL',
  handL: 'lowerArmL',
  upperArmR: 'chest',
  lowerArmR: 'upperArmR',
  handR: 'lowerArmR',
  upperLegL: 'hips',
  lowerLegL: 'upperLegL',
  footL: 'lowerLegL',
  upperLegR: 'hips',
  lowerLegR: 'upperLegR',
  footR: 'lowerLegR',
};
const PARENT_INDEX = REQUIRED.map((b) => (PARENT[b] ? REQUIRED.indexOf(PARENT[b]!) : -1));

/** The size first person draws held models at (world units per model unit), which a humanoid model's arms are fitted to (`GltfLibrary.humanoidArms`). */
export const HELD_SCALE = 0.52;

/**
 * A model's skeleton as the rig sees it: its node for each joint (bones or not), and where the
 * joints are standing straight (arms and legs hanging down, whatever pose the model rests in).
 */
export interface RigFrames {
  nodes: Record<Bone, THREE.Object3D>;
  /** Its fists' grip empties, if it has them. */
  grips: Record<'L' | 'R', THREE.Object3D | null>;
  /** Each joint at rest, in the model's space: where it is and how it's turned. */
  at: Record<Bone, THREE.Vector3>;
  turn: Record<Bone, THREE.Quaternion>;
  /** The swing that hangs each limb bone straight down (the body's joints: none). */
  swing: Record<Bone, THREE.Quaternion>;
  /** Standing straight: where each joint is, and how the model's own node is turned. */
  straight: Record<Bone, THREE.Vector3>;
  offset: Record<Bone, THREE.Quaternion>;
  /** Each fist's hold in its hand's space, standing straight (the hand unturned). */
  grip: Record<'L' | 'R', { p: THREE.Vector3; q: THREE.Quaternion }>;
}

/** A model's nodes by name: the first of each, as the file has them (and as three.js renames them: `mixamorig:Hips` is `mixamorigHips`). */
function named(root: THREE.Object3D): (name: string) => THREE.Object3D | undefined {
  const byName = new Map<string, THREE.Object3D>();
  root.traverse((o) => {
    if (o.name && !byName.has(o.name)) byName.set(o.name, o);
  });
  return (name) => byName.get(name) ?? byName.get(THREE.PropertyBinding.sanitizeNodeName(name));
}

/** The node for each of the rig's joints (`joints` maps the ones named otherwise); null if any is missing. */
export function findJoints(root: THREE.Object3D, joints?: Partial<Record<HumanoidJoint, string>>): (Record<Bone, THREE.Object3D> & Partial<Record<'gripL' | 'gripR', THREE.Object3D>>) | null {
  const find = named(root);
  const out: Partial<Record<Joint, THREE.Object3D>> = {};
  for (const j of [...REQUIRED, 'gripL', 'gripR'] as Joint[]) {
    const o = find(joints?.[j] ?? j);
    if (o) out[j] = o;
    else if (j !== 'gripL' && j !== 'gripR') return null;
  }
  return out as Record<Bone, THREE.Object3D>;
}

const DOWN = new THREE.Vector3(0, -1, 0);

/** A humanoid model's skeleton as the rig sees it (null if it isn't one). */
export function rigFrames(root: THREE.Object3D, joints?: Partial<Record<HumanoidJoint, string>>): RigFrames | null {
  const found = findJoints(root, joints);
  if (!found) return null;
  root.updateMatrixWorld(true);
  const toRoot = new THREE.Matrix4().copy(root.matrixWorld).invert();
  const m = new THREE.Matrix4();
  const place = (o: THREE.Object3D) => {
    const p = new THREE.Vector3();
    const q = new THREE.Quaternion();
    m.multiplyMatrices(toRoot, o.matrixWorld).decompose(p, q, new THREE.Vector3());
    return { p, q };
  };
  const nodes = {} as Record<Bone, THREE.Object3D>;
  const at = {} as Record<Bone, THREE.Vector3>;
  const turn = {} as Record<Bone, THREE.Quaternion>;
  for (const b of REQUIRED) {
    nodes[b] = found[b];
    const r = place(found[b]);
    at[b] = r.p;
    turn[b] = r.q;
  }
  // Arms and legs hang straight down standing straight: each bone swung there from however it
  // rests (a T-pose's arms out to the sides), the hands and feet with the bones they end.
  const swing = {} as Record<Bone, THREE.Quaternion>;
  const hang = (from: Bone, to: Bone) => new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3().subVectors(at[to], at[from]).normalize(), DOWN);
  for (const b of REQUIRED) swing[b] = new THREE.Quaternion();
  for (const s of ['L', 'R'] as const) {
    swing[`upperArm${s}`] = hang(`upperArm${s}`, `lowerArm${s}`);
    swing[`lowerArm${s}`] = hang(`lowerArm${s}`, `hand${s}`);
    swing[`hand${s}`] = swing[`lowerArm${s}`].clone();
    swing[`upperLeg${s}`] = hang(`upperLeg${s}`, `lowerLeg${s}`);
    swing[`lowerLeg${s}`] = hang(`lowerLeg${s}`, `foot${s}`);
    swing[`foot${s}`] = swing[`lowerLeg${s}`].clone();
  }
  const straight = {} as Record<Bone, THREE.Vector3>;
  const offset = {} as Record<Bone, THREE.Quaternion>;
  for (const b of REQUIRED) {
    const p = PARENT[b];
    straight[b] = p ? new THREE.Vector3().subVectors(at[b], at[p]).applyQuaternion(swing[p]).add(straight[p]) : at[b].clone();
    offset[b] = swing[b].clone().multiply(turn[b]);
  }
  // The fists' holds: the model's grip empties, or a point in the fist a third of a forearm on from the wrist.
  const grip = {} as RigFrames['grip'];
  for (const s of ['L', 'R'] as const) {
    const g = found[`grip${s}`];
    const hand = `hand${s}` as const;
    if (g) {
      const r = place(g);
      grip[s] = { p: r.p.sub(at[hand]).applyQuaternion(swing[hand]), q: swing[hand].clone().multiply(r.q) };
    } else {
      const f = straight[hand].distanceTo(straight[`lowerArm${s}`]);
      grip[s] = { p: new THREE.Vector3(0, -0.34 * f, 0.06 * f), q: new THREE.Quaternion() };
    }
  }
  return { nodes, grips: { L: found.gripL ?? null, R: found.gripR ?? null }, at, turn, swing, straight, offset, grip };
}

// Scratch.
const v1 = new THREE.Vector3();
const v2 = new THREE.Vector3();
const v5 = new THREE.Vector3();
const q1 = new THREE.Quaternion();
const m1 = new THREE.Matrix4();
const m2 = new THREE.Matrix4();

export interface RigOptions {
  /** The model's names for the rig's joints (`GltfSpec.joints`). */
  joints?: Partial<Record<HumanoidJoint, string>>;
  /** The model's animation clips, for `play`. */
  clips?: THREE.AnimationClip[];
}

/**
 * A figure on the humanoid rig: the rig's own skeleton, which client code poses (the figures kit:
 * `figures.humanoid()`), the model's joints following it, and the model's own clips played over
 * that (`play`).
 *
 * The rig's skeleton has its joints where the model's are standing straight, unturned, each bone
 * along its -y. The model's joints (rigid parts' nodes, or a skin's bones) follow them (`apply`),
 * each keeping its own turn from standing straight, so a skeleton resting in a T-pose with its
 * bones turned every which way moves as the rig's does.
 */
export class HumanoidRig {
  /** The rig's own skeleton (client code poses it), under the model's root. */
  readonly joints: Record<Joint, THREE.Object3D>;
  /** Each of its joints at rest (in its parent's space). */
  readonly rest: Record<Joint, { position: THREE.Vector3; quaternion: THREE.Quaternion }>;
  /** Each bone standing straight, in the model's space. */
  readonly straight: Record<Bone, THREE.Vector3>;
  /** The skeleton's root, in the model's. */
  readonly root = new THREE.Group();
  /** The model's own space (the rig's skeleton is in it). */
  readonly body: THREE.Object3D;
  private frames: RigFrames;
  /** The rig's own joints (what's held follows the hand through a clip when it hangs from one). */
  private own = new Set<THREE.Object3D>();
  /**
   * How each of the model's joints follows the rig's: the nearest of its joints it hangs from
   * (-1: none, the model's root), and how its parent is turned from that one's at rest.
   */
  private follow: { node: THREE.Object3D; from: number; rel: THREE.Quaternion; scale: THREE.Vector3 }[] = [];
  /** From the model's space into its hips' parent's (where the hips are placed). */
  private hipsFrom = new THREE.Matrix4();
  /** Each joint's turn this frame in the model's space: the rig's, and the model's own. */
  private turned = REQUIRED.map(() => new THREE.Quaternion());
  private placed = REQUIRED.map(() => new THREE.Quaternion());
  private clips: ClipLayer | null = null;
  private last = -1;

  /** Does this model have the rig's joints (named as `joints` says)? */
  static fits(root: THREE.Object3D, joints?: Partial<Record<HumanoidJoint, string>>): boolean {
    return findJoints(root, joints) !== null;
  }

  /** The rig on a model (its root: the model's own space, +y up, facing +z). */
  constructor(root: THREE.Object3D, opts: RigOptions = {}) {
    const f = rigFrames(root, opts.joints);
    if (!f) throw new Error('not a humanoid: the model is missing some of the rig\'s joints');
    this.frames = f;
    this.body = root;
    this.straight = f.straight;
    // The rig's skeleton: each joint where the model's is standing straight, unturned.
    const j = {} as Record<Joint, THREE.Object3D>;
    for (const b of REQUIRED) {
      const o = (j[b] = new THREE.Object3D());
      const p = PARENT[b];
      o.position.copy(f.straight[b]);
      if (p) o.position.sub(f.straight[p]);
      (p ? j[p] : this.root).add(o);
    }
    for (const s of ['L', 'R'] as const) {
      const g = (j[`grip${s}`] = new THREE.Object3D());
      g.position.copy(f.grip[s].p);
      g.quaternion.copy(f.grip[s].q);
      j[`hand${s}`].add(g);
    }
    this.joints = j;
    const rest = {} as Record<Joint, { position: THREE.Vector3; quaternion: THREE.Quaternion }>;
    for (const [name, o] of Object.entries(j) as [Joint, THREE.Object3D][]) {
      rest[name] = { position: o.position.clone(), quaternion: o.quaternion.clone() };
      this.own.add(o);
    }
    this.rest = rest;
    root.add(this.root);
    this.root.updateMatrixWorld(true);
    // How the model's joints follow.
    const toRoot = new THREE.Matrix4().copy(root.matrixWorld).invert();
    const restTurn = (o: THREE.Object3D) => {
      const q = new THREE.Quaternion();
      m1.multiplyMatrices(toRoot, o.matrixWorld).decompose(v1, q, v2);
      return q;
    };
    const index = new Map<THREE.Object3D, number>();
    REQUIRED.forEach((b, i) => index.set(f.nodes[b], i));
    for (const b of REQUIRED) {
      const node = f.nodes[b];
      let a = node.parent;
      while (a && a !== root && !index.has(a)) a = a.parent;
      const from = a && a !== root ? index.get(a)! : -1;
      const ancestor = from < 0 ? new THREE.Quaternion() : f.turn[REQUIRED[from]];
      this.follow.push({ node, from, rel: ancestor.clone().invert().multiply(node.parent ? restTurn(node.parent) : new THREE.Quaternion()), scale: node.scale.clone() });
    }
    const hipsParent = f.nodes.hips.parent;
    if (hipsParent && hipsParent !== root) this.hipsFrom.multiplyMatrices(toRoot, hipsParent.matrixWorld).invert();
    if (opts.clips?.length) {
      const find = named(root);
      this.clips = new ClipLayer(root, opts.clips, (n) => (f.nodes as Record<string, THREE.Object3D>)[n] ?? (n === 'gripL' || n === 'gripR' ? f.grips[n === 'gripL' ? 'L' : 'R'] : null) ?? find(n) ?? null);
    }
  }

  /** The model's own node for a joint. */
  joint(name: Bone): THREE.Object3D {
    return this.frames.nodes[name];
  }

  /**
   * A body's head and back as it rests (the model's space), for what it wears: the top of the head
   * and its width; the middle of the back between the shoulders and the body's width. Measured from
   * the model's rigid parts on those joints; a skinned model's are guessed from its build.
   */
  wearFrame(): { top: THREE.Vector3; headWidth: number; back: THREE.Vector3; bodyWidth: number } {
    // As its builder declared it (the platform's characters, the voxel fighters: `userData.wear`,
    // a glTF node's `extras.wear`, on the model's root or its first node), else measured.
    let declared: { top: number[]; headWidth: number; back: number[]; bodyWidth: number } | null = null;
    for (const o of [this.body, ...this.body.children]) {
      const w = o.userData?.wear;
      if (w && Array.isArray(w.top) && Array.isArray(w.back)) {
        declared = w;
        break;
      }
    }
    if (declared) return { top: new THREE.Vector3(...declared.top), headWidth: declared.headWidth, back: new THREE.Vector3(...declared.back), bodyWidth: declared.bodyWidth };
    const f = this.frames;
    const joints = new Set<THREE.Object3D>(Object.values(f.nodes));
    // The rigid meshes on a joint (not those on the joints below it), as they rest, in the model's space.
    const bounds = (bone: Bone) => {
      const box = new THREE.Box3();
      const node = f.nodes[bone];
      const unit = new THREE.Vector3();
      new THREE.Matrix4().copy(this.body.matrixWorld).invert().multiply(node.matrixWorld).decompose(new THREE.Vector3(), new THREE.Quaternion(), unit);
      const walk = (o: THREE.Object3D, m: THREE.Matrix4) => {
        for (const c of o.children) {
          if (joints.has(c) || this.own.has(c)) continue;
          const cm = new THREE.Matrix4().multiplyMatrices(m, c.matrix);
          const mesh = c as THREE.Mesh;
          if (mesh.isMesh && !(mesh as THREE.SkinnedMesh).isSkinnedMesh) {
            mesh.geometry.computeBoundingBox();
            const b = mesh.geometry.boundingBox!.clone().applyMatrix4(cm);
            // From the node's space to the model's, as the joint rests.
            const rest = new THREE.Matrix4().compose(f.at[bone], f.turn[bone], unit);
            box.union(b.applyMatrix4(rest));
          }
          walk(c, cm);
        }
      };
      walk(node, new THREE.Matrix4());
      return box.isEmpty() ? skinned(bone) : box;
    };
    // A skinned model's: the vertices that mostly follow the joint (or the bones under it that
    // aren't the rig's: hair, a hat's). Each where the skin has it now, in the joint's own space (so
    // however it's posed, and however the file packs its vertices), then as the joint rests.
    const skinned = (bone: Bone) => {
      const node = f.nodes[bone];
      const own = new Set<THREE.Object3D>();
      const collect = (o: THREE.Object3D) => {
        own.add(o);
        for (const c of o.children) if (!joints.has(c)) collect(c);
      };
      collect(node);
      this.body.updateMatrixWorld(true);
      const unit = new THREE.Vector3();
      new THREE.Matrix4().copy(this.body.matrixWorld).invert().multiply(node.matrixWorld).decompose(new THREE.Vector3(), new THREE.Quaternion(), unit);
      const toNode = new THREE.Matrix4().copy(node.matrixWorld).invert();
      const rest = new THREE.Matrix4().compose(f.at[bone], f.turn[bone], unit);
      const box = new THREE.Box3();
      const v = new THREE.Vector3();
      this.body.traverse((o) => {
        const sm = o as THREE.SkinnedMesh;
        if (!sm.isSkinnedMesh) return;
        const mine = new Set<number>();
        sm.skeleton.bones.forEach((b, i) => own.has(b) && mine.add(i));
        if (!mine.size) return;
        const index = sm.geometry.getAttribute('skinIndex');
        const weight = sm.geometry.getAttribute('skinWeight');
        const toJoint = new THREE.Matrix4().multiplyMatrices(toNode, sm.matrixWorld);
        for (let i = 0; i < index.count; i++) {
          let best = -1;
          let most = 0;
          for (let k = 0; k < 4; k++) {
            const w = weight.getComponent(i, k);
            if (w > most) {
              most = w;
              best = index.getComponent(i, k);
            }
          }
          if (!mine.has(best)) continue;
          sm.getVertexPosition(i, v);
          box.expandByPoint(v.applyMatrix4(toJoint).applyMatrix4(rest));
        }
      });
      return box.isEmpty() ? null : box;
    };
    const k = Math.max(0.3, f.at.hips.y / 0.95);
    const head = bounds('head');
    const chest = bounds('chest') ?? bounds('spine');
    const h = f.at.head;
    const top = head ? new THREE.Vector3((head.min.x + head.max.x) / 2, head.max.y, (head.min.z + head.max.z) / 2) : new THREE.Vector3(h.x, h.y + 0.26 * k, h.z + 0.02 * k);
    const c = f.at.chest;
    const back = chest ? new THREE.Vector3((chest.min.x + chest.max.x) / 2, c.y + 0.1 * k, chest.min.z) : new THREE.Vector3(c.x, c.y + 0.1 * k, c.z - 0.12 * k);
    return { top, headWidth: head ? head.max.x - head.min.x : 0.3 * k, back, bodyWidth: chest ? chest.max.x - chest.min.x : 0.36 * k };
  }

  /** Where the model's node for a joint rests, and how it's turned, in the model's space. */
  restOf(name: Bone): { at: THREE.Vector3; turn: THREE.Quaternion } {
    return { at: this.frames.at[name], turn: this.frames.turn[name] };
  }

  /** Play one of the model's clips over the rig's pose (null: fade out what's playing). */
  play(clip: ClipPlay | null) {
    this.clips?.play(clip);
  }

  /**
   * The frame's pose (the rig's skeleton as client code left it) onto the model: its joints
   * follow the rig's, then its clips play over them. `held`, what's held, goes with the right
   * hand wherever a clip takes it, when it hangs from one of the rig's own joints (it's placed
   * there, not on the model). `time`: the figure's clock (seconds), which clips run by.
   */
  apply(time: number, held: THREE.Object3D | null = null) {
    const dt = this.last < 0 ? 0 : clamp(time - this.last, 0, 0.1);
    this.last = time;
    this.clips?.reset();
    this.retarget();
    if (this.clips?.active) {
      const mount = held?.parent && this.own.has(held.parent) ? held : null;
      const hand = this.frames.nodes.handR;
      hand.updateWorldMatrix(true, false);
      const inHand = mount && m1.copy(hand.matrixWorld).invert().multiply(mount.matrixWorld);
      this.clips.apply(dt);
      if (mount && inHand) {
        hand.updateWorldMatrix(true, false);
        mount.parent!.updateWorldMatrix(true, false);
        m2.copy(mount.parent!.matrixWorld).invert().multiply(hand.matrixWorld).multiply(inHand).decompose(mount.position, mount.quaternion, v5);
      }
    }
  }

  /**
   * The model's joints to where the rig's are: each turned as the rig's is (in the model's
   * space), times its own turn standing straight, and scaled as the rig's is; the hips placed
   * where the rig's are.
   */
  private retarget() {
    const f = this.frames;
    for (let i = 0; i < REQUIRED.length; i++) {
      const b = REQUIRED[i];
      const p = PARENT_INDEX[i];
      const turned = this.turned[i];
      if (p < 0) turned.copy(this.joints[b].quaternion);
      else turned.multiplyQuaternions(this.turned[p], this.joints[b].quaternion);
      const placed = this.placed[i].multiplyQuaternions(turned, f.offset[b]);
      const w = this.follow[i];
      const parent = w.from < 0 ? q1.copy(w.rel) : q1.multiplyQuaternions(this.placed[w.from], w.rel);
      w.node.quaternion.copy(parent.invert().multiply(placed));
      // A joint scaled on the rig scales the model's (a cartoon's big head), over its own scale.
      w.node.scale.copy(w.scale).multiply(this.joints[b].scale);
    }
    f.nodes.hips.position.copy(this.joints.hips.position).applyMatrix4(this.hipsFrom);
  }
}

const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);

/**
 * The attach point on a body (`Figure.attach`): on the model's node for a joint of the rig, at
 * `point` (the model's space, as it rests), unturned from the model's frame, scaled so a texel of
 * the box head (8 across) is `width / 8` of the model's units; a back item's turned to face out
 * behind. Worked out from the joint at rest, so it follows the joint however it's posed.
 */
export function wearAnchor(rig: HumanoidRig, bone: 'head' | 'chest', point: THREE.Vector3, width: number, behind: boolean, modelRoot: THREE.Object3D): THREE.Object3D {
  const node = rig.joint(bone);
  const { at, turn } = rig.restOf(bone);
  // The node's own units (an armature can be scaled: Blender's bones in centimetres).
  modelRoot.updateMatrixWorld(true);
  const s = new THREE.Vector3();
  new THREE.Matrix4().copy(modelRoot.matrixWorld).invert().multiply(node.matrixWorld).decompose(new THREE.Vector3(), new THREE.Quaternion(), s);
  const unit = s.x || 1;
  const inv = turn.clone().invert();
  const anchor = new THREE.Object3D();
  anchor.position.copy(point).sub(at).applyQuaternion(inv).divideScalar(unit);
  anchor.quaternion.copy(inv);
  if (behind) anchor.quaternion.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI));
  anchor.scale.setScalar(width / 0.5 / unit);
  node.add(anchor);
  return anchor;
}
