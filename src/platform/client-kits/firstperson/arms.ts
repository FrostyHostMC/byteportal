import type { FirstPersonArms } from '@platform';
import type { ViewArm } from '@platform/client';
import { Mat4, Quat, Vec3 } from '@platform/client/math';

/**
 * A humanoid player's own arms in the first-person view (their model's upper arms, forearms and
 * fists, `client.view.arms.humanoid`), placed on what the hands hold: the fist on its grip, and
 * the arm back from it to a shoulder off the screen's edge, straight (the forearm and upper arm in
 * one line) or bent at the elbow (two bones reaching a shoulder that stays put).
 */

type V3 = [number, number, number];

/** `FirstPersonArms` with everything filled in (each arm's reach and bend: [firing, support]). */
export interface ArmFit {
  scale: number;
  hands: number;
  reach: [number, number];
  bend: [number, number];
  support: V3;
}

/**
 * The platform's: a little bigger than life, as shooters draw them (the hands read around the
 * gun); each arm drawn out so the whole of it runs this far from the wrist, off the screen's edge;
 * straight; the support fist on the handguard's near side (its left, the side we see), a little
 * under it, in the model's own blocks.
 */
export const ARM_FIT: ArmFit = { scale: 1.2, hands: 1, reach: [0.55, 0.72], bend: [0, 0], support: [0.01, -0.012, 0] };

/** The platform's fit, with each layer's over it in turn (a model's `firstPerson`, then a gun's `hold.gun.arm`). */
export function fitArms(...layers: (FirstPersonArms | null | undefined)[]): ArmFit {
  const out: ArmFit = { scale: ARM_FIT.scale, hands: ARM_FIT.hands, reach: ARM_FIT.reach, bend: ARM_FIT.bend, support: ARM_FIT.support };
  for (const l of layers) {
    if (!l) continue;
    if (l.scale !== undefined) out.scale = l.scale;
    if (l.hands !== undefined) out.hands = l.hands;
    if (l.reach !== undefined) out.reach = l.reach;
    if (l.bend !== undefined) out.bend = typeof l.bend === 'number' ? [l.bend, l.bend] : l.bend;
    if (l.support !== undefined) out.support = l.support;
  }
  return out;
}

const _q = new Quat();
const _a = new Vec3();
const _b = new Vec3();
const _c = new Vec3();
const _d = new Vec3();
const _m = new Mat4();

/** The fist holding at `grip` turned as `gripQ` (its parent's space), at `scale` to the model; returns where the wrist is. */
function placeFist(h: ViewArm, grip: Vec3, gripQ: Quat, scale: number): Vec3 {
  const fistQ = h.fist.quaternion.copy(gripQ).multiply(_q.copy(h.gripQ).invert());
  h.fist.position.copy(grip).sub(_a.copy(h.grip).multiplyScalar(scale).applyQuaternion(fistQ));
  h.fist.scale.setScalar(scale);
  return h.fist.position;
}

/** Where the wrist is for a fist holding at `grip` turned as `gripQ` (without placing it), the fist `hands` times the arm's `scale`. */
export function wristFor(h: ViewArm, grip: Vec3, gripQ: Quat, scale: number, out: Vec3, hands = 1): Vec3 {
  const fistQ = _q.copy(h.gripQ).invert().premultiply(gripQ);
  return out.copy(grip).sub(_c.copy(h.grip).multiplyScalar(scale * hands).applyQuaternion(fistQ));
}

/** A bone's turn: its +y along `y` (it hangs down its -y), its +z as near `z` as goes. */
function boneBasis(y: Vec3, z: Vec3, out: Quat): Quat {
  const zz = _c.copy(z).addScaledVector(y, -z.dot(y));
  if (zz.lengthSq() < 1e-8) zz.set(0, 0, 1).addScaledVector(y, -y.z);
  zz.normalize();
  _m.makeBasis(_d.crossVectors(y, zz), y, zz);
  return out.setFromRotationMatrix(_m);
}

/**
 * Straight: the fist holding at `grip` turned as `gripQ`, the forearm running back from the wrist
 * toward the elbow (`elbowDir`) and the upper arm on from there in the same line, at `scale` to
 * the model (the fist `hands` times that); the upper arm drawn out so the whole arm is `reach`
 * long (off the screen's edge, like any shooter's arms).
 */
export function placeStraight(h: ViewArm, grip: Vec3, gripQ: Quat, elbowDir: Vec3, scale: number, reach: number, hands = 1) {
  const wrist = placeFist(h, grip, gripQ, scale * hands);
  const y = _b.copy(elbowDir).normalize();
  boneBasis(y, _a.set(0, 0, 1).applyQuaternion(h.fist.quaternion), h.forearm.quaternion);
  h.forearm.position.copy(wrist).addScaledVector(y, h.wrist.length() * scale);
  h.forearm.scale.setScalar(scale);
  const upperLen = h.elbow.length() * scale;
  const stretch = Math.max(1, (reach - h.wrist.length() * scale) / Math.max(1e-3, upperLen));
  h.upper.quaternion.copy(h.forearm.quaternion);
  h.upper.position.copy(h.forearm.position).addScaledVector(y, upperLen * stretch);
  h.upper.scale.set(scale, scale * stretch, scale);
}

/**
 * How long the upper arm is drawn for an arm `reach` from wrist to shoulder, its forearm `fore`
 * long and its own upper arm `upper` long, to bend `bend` radians at the elbow (at least its own length).
 */
export function upperFor(reach: number, fore: number, upper: number, bend: number): number {
  const s = Math.sin(bend);
  return Math.max(upper, -fore * Math.cos(bend) + Math.sqrt(Math.max(0, reach * reach - fore * fore * s * s)));
}

/**
 * Where the elbow goes for an arm from `shoulder` to `wrist`, its upper arm `upper` long and its
 * forearm `fore`: bent toward `pole` (straight, and the upper arm drawn out, if the wrist is further
 * than the two reach).
 */
export function elbowFor(shoulder: Vec3, wrist: Vec3, upper: number, fore: number, pole: Vec3, out: Vec3): Vec3 {
  const u = _a.subVectors(wrist, shoulder);
  const d = u.length();
  u.divideScalar(Math.max(1e-6, d));
  if (d >= upper + fore - 1e-6) return out.copy(wrist).addScaledVector(u, -fore);
  const dd = Math.max(d, Math.abs(upper - fore) + 1e-4);
  const cos = Math.min(1, Math.max(-1, (upper * upper + dd * dd - fore * fore) / (2 * upper * dd)));
  const perp = _b.copy(pole).addScaledVector(u, -pole.dot(u));
  if (perp.lengthSq() < 1e-8) perp.set(0, -1, 0).addScaledVector(u, u.y);
  perp.normalize();
  return out.copy(shoulder).addScaledVector(u, upper * cos).addScaledVector(perp, upper * Math.sqrt(1 - cos * cos));
}

const _e = new Vec3();
const _w = new Vec3();

/**
 * Bent: the fist holding at `grip` turned as `gripQ`, the arm reaching back to `shoulder` (all in
 * the parent's space) with the elbow toward `pole`; the upper arm drawn out to `upper` long.
 */
export function placeBent(h: ViewArm, grip: Vec3, gripQ: Quat, shoulder: Vec3, pole: Vec3, scale: number, upper: number, hands = 1) {
  const wrist = _w.copy(placeFist(h, grip, gripQ, scale * hands));
  const fore = h.wrist.length() * scale;
  const elbow = elbowFor(shoulder, wrist, upper, fore, pole, _e);
  // The forearm from the wrist to the elbow, turned with the fist (the wrist doesn't twist).
  const y = _b.subVectors(elbow, wrist).normalize();
  boneBasis(y, _a.set(0, 0, 1).applyQuaternion(h.fist.quaternion), h.forearm.quaternion);
  h.forearm.position.copy(elbow);
  h.forearm.scale.setScalar(scale);
  // The upper arm from the elbow to the shoulder: the forearm's frame swung to it (the elbow a hinge).
  const yU = _c.subVectors(shoulder, elbow);
  const len = yU.length();
  yU.divideScalar(Math.max(1e-6, len));
  h.upper.quaternion.setFromUnitVectors(y, yU).multiply(h.forearm.quaternion);
  h.upper.position.copy(shoulder);
  const own = h.elbow.length() * scale;
  h.upper.scale.set(scale, (scale * len) / Math.max(1e-3, own), scale);
}
