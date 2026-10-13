import type { ClientKit, Figure, FigureNode, Node } from '@platform/client';
import { Mat4, Quat, Vec3 } from '@platform/client/math';
import type { CrossbowItem } from '../items/crossbow';
import type { ArmsMelee } from '../items/melee';
import { rarityOf, shieldOf } from '../items/rarity';

/**
 * What fighters' figures hold beyond what the platform's figures kit puts in their hands (it runs
 * first; this poses over it, on the public figure API): the gladius's shield on the left hand,
 * brought up across the chest while its holder guards (the guard rides the figure's `sights`
 * signal: a melee weapon has no sights, and the arsenal's melee screen half gives it, from the
 * host's `shown`); the daggers' twin in the left fist; and a crossbow's bolt in its groove while
 * it's spanned (not while it's being reloaded).
 */

/** The shield's size on a figure (world units across), and the twin dagger's (times the model). */
const SHIELD_SIZE = 0.55;
const TWIN_SCALE = 0.5;
/** The left hand from the middle of the shoulders (the chest's space, +x its left, +z ahead): resting at the side, and guarding. */
const SHIELD_REST = new Vec3(0.34, -0.58, 0.16);
const SHIELD_GUARD = new Vec3(0.1, -0.16, 0.4);
/** Where a crossbow's bolts sit in its groove (its model's space, blocks), their tips at the muzzle: one, or the Hailstorm's three. */
export function boltSpots(def: { bolts?: number }): Vec3[] {
  const at = (x: number, y: number) => new Vec3(x / 16, y / 16, 13.1 / 16);
  return def.bolts && def.bolts > 1 ? [at(-1.25, 2.85), at(0, 2.2), at(1.25, 2.85)] : [at(0, 2.2)];
}

interface Extra {
  item: string;
  /** The shield or the twin on the left hand, and the bolts in the groove. */
  left: Node | null;
  bolts: Node[];
}

const v1 = new Vec3();
const v2 = new Vec3();
const v3 = new Vec3();
const q1 = new Quat();
const q2 = new Quat();
const q3 = new Quat();
const m1 = new Mat4();
const Y = new Vec3(0, 1, 0);

export function heldExtras(): ClientKit {
  const extras = new Map<number, Extra>();
  /** The shield faces ahead when guarding; at rest it hangs turned out to the side. */
  const faceGuard = new Quat();
  const faceRest = new Quat().setFromAxisAngle(Y, 1.1).multiply(new Quat().setFromAxisAngle(new Vec3(1, 0, 0), 0.25));

  const drop = (x: Extra) => {
    for (const n of [x.left, ...x.bolts]) n?.parent?.remove(n);
  };

  return {
    name: 'arena.held',
    frame(client) {
      const seen = new Set<number>();
      for (const fig of client.figures.all) {
        const held = fig.held;
        const def = held?.def as (Omit<ArmsMelee, 'kind'> & Omit<Partial<CrossbowItem>, 'kind' | 'damage' | 'reload'> & { kind: string }) | undefined;
        if (!held || !def || !fig.rig) continue;
        const shield = def.kind === 'melee' && !!def.guard;
        const twin = def.kind === 'melee' && !!def.backstab;
        const crossbow = def.kind === 'gun' && !!def.ammo;
        if (!shield && !twin && !crossbow) continue;
        seen.add(fig.id);
        let x = extras.get(fig.id);
        if (x && x.item !== held.item) {
          drop(x);
          x = undefined;
        }
        if (!x) {
          x = { item: held.item, left: null, bolts: [] };
          extras.set(fig.id, x);
        }
        if (crossbow) {
          if (!x.bolts.length) {
            for (const p of boltSpots(def)) {
              const made = client.scene.item('crossbow_bolt');
              if (!made) break;
              made.node.position.copy(p);
              held.node.add(made.node);
              x.bolts.push(made.node);
            }
          }
          for (const b of x.bolts) b.visible = !fig.state.reloading;
          continue;
        }
        const grip = fig.rig.joints.gripL;
        if (!x.left) {
          const made = client.scene.item(shield ? shieldOf(rarityOf(held.item)) : held.item);
          if (!made) continue;
          x.left = made.node;
          grip.add(made.node);
        }
        const k = 1 / worldScale(grip);
        if (twin) {
          // In the fist, tipped up a little, as the right one is.
          x.left.scale.setScalar(TWIN_SCALE * k);
          x.left.quaternion.setFromAxisAngle(v1.set(1, 0, 0), -0.3);
          x.left.position.set(0, 0, 0);
          continue;
        }
        // The shield: its handle in the fist, the left arm bringing it up across the chest to guard.
        const s = (SHIELD_SIZE / (15.6 / 16)) * k;
        x.left.scale.setScalar(s);
        x.left.quaternion.identity();
        x.left.position.set(0, 0, (1.5 / 16) * s);
        const guard = Math.min(1, Math.max(0, fig.state.sights ?? 0));
        shieldArm(fig, guard, q3.copy(faceRest).slerp(faceGuard, guard));
      }
      for (const [id, x] of extras) {
        if (seen.has(id)) continue;
        drop(x);
        extras.delete(id);
      }
    },
    dispose() {
      for (const x of extras.values()) drop(x);
      extras.clear();
    },
  };
}

/** A node's scale in the world (the figure's size). */
function worldScale(n: FigureNode): number {
  n.updateWorldMatrix(true, false);
  return v1.setFromMatrixScale(n.matrixWorld).x || 1;
}

/**
 * The left arm to hold the shield: the fist `guard` of the way from resting at the side to up
 * across the chest, turned (the body's frame, then `face`) so the shield faces out. Two bones: the
 * elbow bent out and down (the figures kit's arms, the same way).
 */
function shieldArm(fig: Figure, guard: number, face: Quat) {
  const rig = fig.rig!;
  const j = rig.joints;
  const s = rig.straight;
  const chest = j.chest;
  chest.updateWorldMatrix(true, false);
  const bodyQ = rig.body.getWorldQuaternion(q1);
  // The middle of the shoulders, then the fist's place from it (the chest's space).
  const pivot = v1.addVectors(s.upperArmL, s.upperArmR).multiplyScalar(0.5).sub(s.chest);
  const target = chest.localToWorld(v2.copy(SHIELD_REST).lerp(SHIELD_GUARD, guard).add(pivot));
  const endQ = q2.copy(bodyQ).multiply(face);
  const pole = v3.set(0.7, -0.7, -0.2 + 0.4 * guard).applyQuaternion(bodyQ);
  twoBone(rig, target, endQ, pole);
}

/** Two-bone IK for the left arm: its grip at `target` (world) turned to `endQ`, the elbow toward `pole`. */
function twoBone(rig: NonNullable<Figure['rig']>, target: Vec3, endQ: Quat, pole: Vec3) {
  const j = rig.joints;
  const rest = rig.rest;
  const upper = j.upperArmL;
  const lower = j.lowerArmL;
  const hand = j.handL;
  const grip = rest.gripL;
  const scale = worldScale(j.chest);
  const a = rest.lowerArmL.position.length() * scale;
  const b = rest.handL.position.length() * scale;
  const endWorldQ = new Quat().copy(endQ).multiply(new Quat().copy(grip.quaternion).invert());
  const wrist = new Vec3().copy(target).sub(new Vec3().copy(grip.position).multiplyScalar(scale).applyQuaternion(endWorldQ));
  const S = upper.getWorldPosition(new Vec3());
  const toW = wrist.sub(S);
  const d = Math.min(a + b - 1e-4, Math.max(Math.abs(a - b) + 1e-3, toW.length()));
  const dir = toW.normalize();
  const cosA = Math.min(1, Math.max(-1, (a * a + d * d - b * b) / (2 * a * d)));
  const sinA = Math.sqrt(1 - cosA * cosA);
  const perp = new Vec3().copy(pole).addScaledVector(dir, -pole.dot(dir));
  if (perp.lengthSq() < 1e-8) perp.set(0, -1, 0).addScaledVector(dir, dir.y);
  perp.normalize();
  const E = new Vec3().copy(S).addScaledVector(dir, a * cosA).addScaledVector(perp, a * sinA);
  const W = new Vec3().copy(S).addScaledVector(dir, d);
  // Each bone points down its own -y; the two share the elbow's hinge.
  const yU = new Vec3().subVectors(S, E).normalize();
  const u = new Vec3().subVectors(W, E).normalize();
  const hinge = new Vec3().crossVectors(yU.clone().negate(), u);
  if (hinge.lengthSq() < 1e-6) hinge.crossVectors(perp, dir);
  hinge.normalize().negate();
  const upperQ = basis(hinge, yU, new Quat());
  const lowerQ = basis(hinge, new Vec3().subVectors(E, W).normalize(), new Quat());
  const parentQ = j.chest.getWorldQuaternion(new Quat());
  upper.quaternion.copy(parentQ.invert().multiply(upperQ));
  lower.quaternion.copy(upperQ.clone().invert().multiply(lowerQ));
  hand.quaternion.copy(lowerQ.invert().multiply(endWorldQ));
}

/** The rotation whose x and y axes are these (z completes them). */
function basis(x: Vec3, y: Vec3, out: Quat): Quat {
  const xx = new Vec3().copy(x).addScaledVector(y, -x.dot(y)).normalize();
  const zz = new Vec3().crossVectors(xx, y);
  m1.makeBasis(xx, y, zz);
  return out.setFromRotationMatrix(m1);
}
