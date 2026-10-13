import type { FirstPersonArms, GunHold, HeldModelSpec, HoldSpec, HoldStyle } from '@platform';
import type { GunAction } from '@platform/items';
import { Euler, Mat4, Quat, Vec3 } from '@platform/client/math';
import type { GunPoints } from './points';

/**
 * Where the hand and what it holds rest, style by style, built from Minecraft's own transforms:
 * the arm is posed exactly like Minecraft's bare first-person arm (`ItemInHandRenderer.renderPlayerArm`),
 * and the item sits in that hand the way it does on a player model (`ItemInHandLayer` with the
 * item's `thirdperson_righthand` display transform), which is how Bedrock shows it. A drawn bow
 * uses Java's first-person aiming pose, with the fist on the grip. Guns have poses of their own
 * (at the hip, sprinting, sliding, aimed down the sights), and two hands on them.
 */

export const DEG = Math.PI / 180;
export type V3 = [number, number, number];

// ---------------------------------------------------------------------------------------------
// Minecraft's transforms
// ---------------------------------------------------------------------------------------------

export interface StyleDef {
  /** Item orientation: Minecraft's `display.firstperson_righthand` rotation (degrees about X, Y, Z) and scale. */
  rotation: V3;
  scale: number;
  /** Sprite pixel held in the fist. */
  grip: [number, number];
  /** Extra offset in pixels (camera axes). */
  translation: V3;
  use: string;
}

// item/handheld.json and item/generated.json: upright, turned to face in, tilted 25 degrees.
const HANDHELD = { rotation: [0, -90, 25] as V3, scale: 0.68, translation: [0, 0, 0] as V3 };
export const STYLES: Record<HoldStyle, StyleDef> = {
  sword: { ...HANDHELD, grip: [3, 12.5], use: 'swing' },
  axe: { ...HANDHELD, grip: [3, 13], use: 'swing' },
  // Flat items turned a little further toward the camera, which sits nearer the fist than in Java.
  item: { ...HANDHELD, rotation: [0, -60, 20], scale: 0.55, grip: [8, 13], use: 'drink' },
  // The bow uses Java's own first-person placement (see `bowRest`); only the grip matters here.
  bow: { ...HANDHELD, grip: [4.5, 4.5], use: 'release' },
  // block/block.json: a little cube turned 45 degrees, sitting on the fist.
  block: { rotation: [0, 45, 0], scale: 0.4, grip: [8, 16], translation: [0, 0, 0], use: 'swing' },
  // Two hands on the shaft, aimed at the crosshair (see `polearmRest`).
  polearm: { rotation: [0, 0, 0], scale: 0.85, grip: [8, 8], translation: [0, 0, 0], use: 'jab' },
  // Two hands on a gun: at the hip, up to the eye, across the chest (see `gunRest`).
  gun: { rotation: [0, 0, 0], scale: 0.42, grip: [8, 8], translation: [0, 0, 0], use: 'fire' },
  // A throwable up by the shoulder, ready to go (a sprite: raised and turned toward you).
  throw: { rotation: [-15, -60, 20], scale: 0.5, grip: [8, 11], translation: [-1.5, 3, 1.5], use: 'toss' },
};

/**
 * A gun's poses (camera space, right hand): at the hip (the fist low at the right, the barrel
 * converging on the crosshair far ahead, canted a little), compact guns (pistols) nearer the
 * middle, sprinting (swung down and across the chest) and aiming down the sights (the sight on
 * the eye line, `ads` blocks ahead). Forearms run from each fist toward its elbow. A gun's own
 * `hold.gun` goes over these (see `GunHold`).
 */
export interface GunPose {
  fist: V3;
  /** Which way the barrel points at the hip: nearly straight ahead, a touch inward. */
  barrel: V3;
  roll: number;
  sprint: { yaw: number; pitch: number; roll: number; move: V3 };
  slide: { roll: number; move: V3 };
  /** How far ahead of the eye the sight sits when aiming; null: by the sight (`GUN_ADS`). */
  ads: number | null;
  forearm: { hip: V3; ads: V3 };
  forearm2: { hip: V3; ads: V3 };
  /** Blocks of camera-space kick back and degrees of rise per unit of recoil. */
  kick: number;
  rise: number;
  /** Hands on it (one: the support hand out of sight but to reload), and a humanoid's arms on it (over their model's). */
  hands: 1 | 2;
  arm?: FirstPersonArms;
}

export const GUN: GunPose = {
  fist: [0.235, -0.255, -0.62],
  barrel: [-0.1, 0.045, -1],
  roll: -0.22,
  sprint: { yaw: 0.8, pitch: -0.5, roll: -0.45, move: [-0.08, -0.06, 0.08] },
  slide: { roll: 0.35, move: [-0.04, -0.03, 0.02] },
  ads: null,
  forearm: { hip: [0.32, -0.74, 0.6], ads: [0.22, -0.64, 0.74] },
  forearm2: { hip: [-0.52, -0.72, 0.48], ads: [-0.4, -0.72, 0.56] },
  kick: 0.075,
  rise: 7,
  hands: 2,
};
const COMPACT_FIST: V3 = [0.12, -0.19, -0.52];
/** How far ahead of the eye the sight sits when aiming: iron sights, an optic's window (nearer, so it frames more), a scope. */
const GUN_ADS = { iron: 0.42, optic: 0.3, scope: 0.46 };

/** A gun's poses: its own `hold.gun` over the defaults (a compact gun's fist nearer the middle). */
export function gunPose(o: GunHold | undefined, compact: boolean): GunPose {
  const d = GUN;
  return {
    fist: o?.fist ?? (compact ? COMPACT_FIST : d.fist),
    barrel: o?.barrel ?? d.barrel,
    roll: o?.roll ?? d.roll,
    sprint: { yaw: o?.sprint?.yaw ?? d.sprint.yaw, pitch: o?.sprint?.pitch ?? d.sprint.pitch, roll: o?.sprint?.roll ?? d.sprint.roll, move: o?.sprint?.move ?? d.sprint.move },
    slide: { roll: o?.slide?.roll ?? d.slide.roll, move: o?.slide?.move ?? d.slide.move },
    ads: o?.ads ?? null,
    forearm: { hip: o?.forearm?.hip ?? d.forearm.hip, ads: o?.forearm?.ads ?? d.forearm.ads },
    forearm2: { hip: o?.forearm2?.hip ?? d.forearm2.hip, ads: o?.forearm2?.ads ?? d.forearm2.ads },
    kick: o?.kick ?? d.kick,
    rise: o?.rise ?? d.rise,
    hands: o?.hands === 1 ? 1 : 2,
    arm: o?.arm,
  };
}

/** The gun in hand, as its local state has it each frame (`client.me.held.state`). */
export interface GunView {
  /** Aimed down the sights 0..1, sprinting 0..1, sliding 0..1. */
  aim: number;
  sprint: number;
  slide: number;
  /** Reload progress 0..1, or -1; a shotgun's rounds go in one at a time (`shells`, how many are going in). */
  reload: number;
  shells: number;
  /** What aiming looks through: a scope hides the gun once it's up. */
  sight: 'iron' | 'dot' | 'holo' | 'scope';
  /** Worked after each shot. */
  action?: GunAction;
}

/** Working a gun's action: how long after the shot it starts, and how long each built-in one takes (seconds). */
export const CYCLE = { delay: 0.08, pump: 0.42, bolt: 0.42, lever: 0.45, hammer: 0.26 };

/** Java's first-person item point (`applyItemArmTransform`) and bow display. */
const HAND_POINT: V3 = [0.56, -0.52, -0.72];
const BOW_FP = { rotation: [0, -90, 25] as V3, translation: [1.13, 3.2, 1.13] as V3, scale: 0.68 };
/** Forearm (fist toward elbow, right hand) holding the bow at rest and drawn. */
const BOW_FOREARM: V3 = [0.4, -0.55, 0.73];
const DRAW_FOREARM: V3 = [0.3, -0.42, 0.86];
const BOW_ARM_SCALE = 0.7;

/**
 * Two-handed hold: the rear fist, a point the tip aims at, the roll about the shaft (so the head's
 * blades catch the light), each forearm (fist toward elbow, right hand at the rear) and hand size.
 */
export const POLE = {
  rear: [0.48, -0.5, -0.8] as V3,
  aim: [0.2, -0.16, -2.6] as V3,
  roll: 0.6,
  rearArm: [0.55, -0.65, 0.5] as V3,
  frontArm: [-0.6, -0.65, 0.45] as V3,
  hand: 0.75,
  /** Forearms stretched along their length so they still run off screen when the hands thrust. */
  stretch: 1.6,
};

/** A tiny Minecraft `PoseStack`: every call post-multiplies. */
export class Pose {
  readonly m = new Mat4();
  private t = new Mat4();
  reset() {
    this.m.identity();
    return this;
  }
  copy(p: Pose) {
    this.m.copy(p.m);
    return this;
  }
  translate(x: number, y: number, z: number) {
    this.m.multiply(this.t.makeTranslation(x, y, z));
    return this;
  }
  rotX(deg: number) {
    this.m.multiply(this.t.makeRotationX(deg * DEG));
    return this;
  }
  rotY(deg: number) {
    this.m.multiply(this.t.makeRotationY(deg * DEG));
    return this;
  }
  rotZ(deg: number) {
    this.m.multiply(this.t.makeRotationZ(deg * DEG));
    return this;
  }
  scale(s: number) {
    this.m.multiply(this.t.makeScale(s, s, s));
    return this;
  }
  /** `ItemTransform.apply`, mirrored for the left hand. */
  display(d: { rotation: V3; translation: V3; scale: number }, side: number) {
    const [tx, ty, tz] = d.translation;
    const [rx, ry, rz] = d.rotation;
    return this.translate((side * tx) / 16, ty / 16, tz / 16)
      .rotX(rx)
      .rotY(side * ry)
      .rotZ(side * rz)
      .scale(d.scale);
  }
}

const _v = new Vec3();
const _s = new Vec3();
const _m = new Mat4();
const _mi = new Mat4();

/**
 * Minecraft's first-person arm (`renderPlayerArm`) at swing progress `s`, lowered by `drop`,
 * down into the arm part's own space (`ModelPart.translateAndRotate`; model space has y down).
 */
export function armChain(p: Pose, side: number, s: number, drop: number) {
  const f = side;
  const f1 = Math.sqrt(s);
  const f5 = Math.sin(s * s * Math.PI);
  const f6 = Math.sin(f1 * Math.PI);
  return p
    .reset()
    .translate(f * (-0.3 * f6 + 0.64), 0.4 * Math.sin(f1 * Math.PI * 2) - 0.6 - drop, -0.4 * Math.sin(s * Math.PI) - 0.72)
    .rotY(f * 45)
    .rotY(f * f6 * 70)
    .rotZ(f * f5 * -20)
    .translate(f * -1, 3.6, 3.5)
    .rotZ(f * 120)
    .rotX(200)
    .rotY(f * -135)
    .translate(f * 5.6, 0, 0)
    // PlayerModel arm: pivot (-5, 2, 0), idle zRot 0.1 rad.
    .translate((f * -5) / 16, 2 / 16, 0)
    .rotZ((f * 0.1) / DEG);
}

/** A resting hand: where the fist is, and the item and arm relative to it. */
export interface Rest {
  grip: Vec3;
  itemRot: Quat;
  itemScale: number;
  /** The item-space point under the fist. */
  gripLocal: Vec3;
  /** Item offset from the fist (camera axes). */
  itemOffset: Vec3;
  armRot: Quat;
  armOffset: Vec3;
  armScale: number;
  /** Length multiplier for the forearm box. */
  armStretch: number;
  /** Second hand (two-handed styles), relative to the first fist. */
  twoHanded: boolean;
  arm2Rot: Quat;
  arm2Offset: Vec3;
  /** The front fist, relative to the first. */
  grip2: Vec3;
  /** Which way the item points (a jab thrusts along it). */
  axis: Vec3;
}

export const newRest = (): Rest => ({
  twoHanded: false,
  armStretch: 1,
  grip2: new Vec3(),
  arm2Rot: new Quat(),
  arm2Offset: new Vec3(),
  axis: new Vec3(0, 0, -1),
  armScale: 1,
  itemOffset: new Vec3(),
  grip: new Vec3(),
  itemRot: new Quat(),
  itemScale: 1,
  gripLocal: new Vec3(),
  armRot: new Quat(),
  armOffset: new Vec3(),
});

const _arm = new Pose();
export const _item = new Pose();

/** Where the fist holds what's in hand: a sprite's pixel (`grid`: the item's own `pixel`), or a model's point. */
export type Grid = (x: number, y: number, out: Vec3) => Vec3;

/** The item-space point under the fist: a sprite pixel, a model point, or a block's base. */
function gripPoint(d: StyleDef, model: HeldModelSpec | undefined, grid: Grid, out: Vec3) {
  if (model) {
    const g = model.grip ?? [0, 0, 0];
    return out.set(g[0] / 16, g[1] / 16, g[2] / 16);
  }
  return grid(d.grip[0], d.grip[1], out);
}

/** Forearm box orientation for a fist: `fa` toward the elbow, thumb side facing back along `axis`. */
function forearm(fa: V3, side: number, axis: Vec3, out: Quat): Vec3 {
  return forearmDir(new Vec3(side * fa[0], fa[1], fa[2]).normalize(), axis, out);
}

export function forearmDir(f: Vec3, axis: Vec3, out: Quat): Vec3 {
  const thumb = axis.clone().negate();
  thumb.addScaledVector(f, -thumb.dot(f)).normalize();
  _m.makeBasis(new Vec3().crossVectors(f, thumb), f, thumb);
  out.setFromRotationMatrix(_m);
  return f;
}

/**
 * Two-handed: rear fist low at the right, the item pointing just under the crosshair, the front
 * hand further along it (`grip2`), both forearms running down off the screen.
 */
export function polearmRest(d: StyleDef, model: HeldModelSpec | undefined, grid: Grid, side: number, drop: number, out: Rest) {
  out.grip.set(side * POLE.rear[0], POLE.rear[1] - drop, POLE.rear[2]);
  const axis = out.axis.set(side * POLE.aim[0], POLE.aim[1], POLE.aim[2]).sub(out.grip).normalize();
  const up = _s.set(0, 1, 0).addScaledVector(axis, -axis.y).normalize().applyAxisAngle(axis, side * POLE.roll);
  // Item space: +z along its length, +y up.
  _m.makeBasis(_v.crossVectors(up, axis), up, axis);
  out.itemRot.setFromRotationMatrix(_m);
  out.itemScale = d.scale;
  gripPoint(d, model, grid, out.gripLocal);
  out.itemOffset.set(0, 0, 0);
  const f = forearm(POLE.rearArm, side, axis, out.armRot);
  out.armOffset.copy(f).multiplyScalar((4.5 / 16) * POLE.hand * POLE.stretch);
  out.armScale = POLE.hand;
  out.armStretch = POLE.stretch;
  const g1 = out.gripLocal;
  const g2 = model?.grip2 ? _v.set(model.grip2[0] / 16, model.grip2[1] / 16, model.grip2[2] / 16) : _v.copy(g1).add(_s.set(0, 0, 18 / 16));
  const front = g2.sub(g1).multiplyScalar(d.scale).applyQuaternion(out.itemRot).clone();
  const f2 = forearm(POLE.frontArm, side, axis, out.arm2Rot);
  out.grip2.copy(front);
  out.arm2Offset.copy(front).addScaledVector(f2, (4.5 / 16) * POLE.hand * POLE.stretch);
  out.twoHanded = true;
}

const _qa = new Quat();
const _qb = new Quat();
const _qc = new Quat();
const _fa = new Vec3();
const _fb = new Vec3();
const _fc = new Vec3();
export const X = new Vec3(1, 0, 0);
export const Y = new Vec3(0, 1, 0);
export const Z = new Vec3(0, 0, 1);

/** An item turned to point along `axis` (its +z), upright (its +y as near up as it goes), then rolled about the axis. */
function aimBasis(axis: Vec3, roll: number, out: Quat): Quat {
  const up = _s.set(0, 1, 0).addScaledVector(axis, -axis.y).normalize().applyAxisAngle(axis, roll);
  _m.makeBasis(_v.crossVectors(up, axis), up, axis);
  return out.setFromRotationMatrix(_m);
}

/**
 * Two hands on a gun, blending its poses: at the hip, swung across the chest to sprint, leaning
 * into a slide, and up to the eye with the sight on the eye line to aim down the sights.
 */
export function gunRest(pts: GunPoints, pose: GunPose, hold: HoldSpec, side: number, drop: number, gv: GunView, out: Rest) {
  const S = STYLES.gun.scale * (hold.scale ?? 1);
  const f0 = pose.fist;
  // At the hip.
  const fistH = _fa.set(side * f0[0], f0[1], f0[2]);
  const axis = _fb.set(side * pose.barrel[0], pose.barrel[1], pose.barrel[2]).normalize();
  const qH = aimBasis(axis, side * pose.roll, _qa);
  // Sprinting: swung down and across.
  const sp = pose.sprint;
  const qS = _qb.setFromEuler(new Euler(sp.pitch, side * sp.yaw, side * sp.roll, 'YXZ')).multiply(qH);
  // Aiming down the sights: dead ahead, the sight on the eye line.
  const qA = aimBasis(_fc.set(0, 0, -1), 0, _qc);
  const k = gv.sprint * (1 - gv.aim);
  const a = gv.aim * gv.aim * (3 - 2 * gv.aim);
  out.itemRot.copy(qH).slerp(qS, k);
  const sl = gv.slide * (1 - gv.aim);
  if (sl > 0) out.itemRot.premultiply(new Quat().setFromAxisAngle(Z, side * pose.slide.roll * sl));
  out.itemRot.slerp(qA, a);
  const sightCam = new Vec3().subVectors(pts.sight, pts.grip).multiplyScalar(S).applyQuaternion(qA);
  const dist = pose.ads ?? (gv.sight === 'scope' ? GUN_ADS.scope : gv.sight === 'dot' || gv.sight === 'holo' ? GUN_ADS.optic : GUN_ADS.iron);
  const fistA = new Vec3(0, 0, -dist).sub(sightCam);
  out.grip
    .copy(fistH)
    .add(_v.set(side * sp.move[0], sp.move[1], sp.move[2]).multiplyScalar(k))
    .add(_v.set(side * pose.slide.move[0], pose.slide.move[1], pose.slide.move[2]).multiplyScalar(sl))
    .lerp(fistA, a);
  out.grip.y -= drop;
  out.itemScale = S;
  out.gripLocal.copy(pts.grip);
  out.itemOffset.set(0, 0, 0);
  out.axis.set(0, 0, 1).applyQuaternion(out.itemRot);
  // Forearms: the firing hand's from the grip, the other's from the handguard (or the pistol's grip).
  const [fh, fa] = [pose.forearm.hip, pose.forearm.ads];
  const fr = _v.set(side * fh[0], fh[1], fh[2]).lerp(_s.set(side * fa[0], fa[1], fa[2]), a).normalize();
  forearmDir(fr.clone(), out.axis, out.armRot);
  out.armScale = S;
  out.armStretch = 1;
  out.armOffset.copy(fr).multiplyScalar(((4.5 + 1.8) / 16) * S);
  out.twoHanded = true;
  out.grip2.subVectors(pts.grip2, pts.grip).multiplyScalar(S).applyQuaternion(out.itemRot);
  const [f2h, f2a] = [pose.forearm2.hip, pose.forearm2.ads];
  const fl = _v.set(side * f2h[0], f2h[1], f2h[2]).lerp(_s.set(side * f2a[0], f2a[1], f2a[2]), a).normalize();
  forearmDir(fl.clone(), out.axis, out.arm2Rot);
  out.arm2Offset.copy(out.grip2).addScaledVector(fl, ((4.5 + 1.8) / 16) * S);
}

/** Default actions for 3D models (sprites use Minecraft's swing). */
export const MODEL_USE: Partial<Record<HoldStyle, string>> = { sword: 'slash', axe: 'hew', item: 'sip' };

/**
 * One hand around a 3D model, in camera space: where the fist is, which way the item points
 * (its +z) and which way its face turns (its +y), the forearm (fist toward elbow, right hand),
 * the hand's size and the item's scale.
 */
export interface ModelGrip {
  fist: V3;
  axis: V3;
  face: V3;
  forearm: V3;
  hand: number;
  scale: number;
}

export const MODEL_GRIPS: Partial<Record<HoldStyle, ModelGrip>> = {
  // Blade up and into the scene toward the top of the screen, its flat turned to you.
  sword: { fist: [0.36, -0.44, -0.78], axis: [-0.28, 0.8, -0.53], face: [-0.62, 0.05, 0.78], forearm: [0.4, -0.7, 0.6], hand: 0.8, scale: 0.62 },
  // Held low on the haft, head up, the edge facing forward.
  axe: { fist: [0.38, -0.5, -0.78], axis: [-0.2, 0.85, -0.48], face: [-0.94, 0, 0.33], forearm: [0.4, -0.7, 0.6], hand: 0.8, scale: 0.55 },
  // Upright in the fist, leaning back a little, label side to you.
  item: { fist: [0.34, -0.42, -0.7], axis: [-0.1, 0.99, 0.06], face: [-0.4, 0, 0.92], forearm: [0.35, -0.75, 0.55], hand: 0.8, scale: 0.5 },
  // Wound up to throw: the fist up at the right, level with the eyes and a little back, the
  // throwable standing in it, the forearm down toward the elbow below.
  throw: { fist: [0.36, -0.12, -0.52], axis: [-0.15, 0.97, 0.18], face: [-0.5, 0, 0.87], forearm: [0.2, -0.9, 0.4], hand: 0.8, scale: 0.42 },
};

/** Holding a 3D model in one hand (see `MODEL_GRIPS`). */
export function modelRest(g: ModelGrip, hold: HoldSpec, model: HeldModelSpec, side: number, drop: number, out: Rest) {
  out.twoHanded = false;
  out.grip.set(side * g.fist[0], g.fist[1] - drop, g.fist[2]);
  const axis = out.axis.set(side * g.axis[0], g.axis[1], g.axis[2]).normalize();
  const face = _s.set(side * g.face[0], g.face[1], g.face[2]);
  face.addScaledVector(axis, -face.dot(axis)).normalize();
  _m.makeBasis(_v.crossVectors(face, axis), face, axis);
  out.itemRot.setFromRotationMatrix(_m);
  // The item's own tweaks (degrees and pixels, camera axes) on top.
  const [rx, ry, rz] = hold.rotation ?? [0, 0, 0];
  if (rx || ry || rz) out.itemRot.premultiply(new Quat().setFromEuler(new Euler(rx * DEG, side * ry * DEG, side * rz * DEG)));
  out.itemScale = g.scale * (hold.scale ?? 1);
  const gp = model.grip ?? [0, 0, 0];
  out.gripLocal.set(gp[0] / 16, gp[1] / 16, gp[2] / 16);
  const [tx, ty, tz] = hold.translation ?? [0, 0, 0];
  out.itemOffset.set((side * tx) / 16, ty / 16, tz / 16);
  const f = forearm(g.forearm, side, axis, out.armRot);
  out.armOffset.copy(f).multiplyScalar((4.5 / 16) * g.hand);
  out.armScale = g.hand;
  out.armStretch = 1;
}

/** The hand in Minecraft's first-person arm pose, holding style `d` (or nothing) upright in the fist. */
export function attachedRest(d: StyleDef | null, model: HeldModelSpec | undefined, grid: Grid, side: number, drop: number, out: Rest) {
  out.twoHanded = false;
  out.axis.set(0, 0, -1);
  const c = armChain(_arm, side, 0, drop);
  // Fist: the lower 3 px of the arm cube (x -3..1, y -2..10, z -2..2 for the right arm).
  out.grip.set((side * -1) / 16, 8.5 / 16, 0).applyMatrix4(c.m);
  // Our box has the shoulder on +y and the front on +z; Minecraft's cube has them on -y and -z.
  _m.copy(c.m).multiply(_mi.makeTranslation((side * -1) / 16, 4 / 16, 0)).multiply(_mi.makeRotationX(Math.PI));
  _m.decompose(out.armOffset, out.armRot, _s);
  out.armOffset.sub(out.grip);
  out.armScale = 1;
  out.armStretch = 1;
  if (!d) return;
  const [rx, ry, rz] = d.rotation;
  _item.reset().rotX(rx).rotY(side * ry).rotZ(side * rz);
  // A model's length (+z) goes where a sprite's tool diagonal would.
  if (model) _item.rotZ(-45).rotX(-90);
  out.itemRot.setFromRotationMatrix(_item.m);
  out.itemScale = d.scale;
  gripPoint(d, model, grid, out.gripLocal);
  out.itemOffset.set((side * d.translation[0]) / 16, d.translation[1] / 16, d.translation[2] / 16);
}

/**
 * The bow where Java puts it in first person (held at the side, or drawn: `ItemInHandRenderer`
 * case BOW), the fist on the grip and the forearm running back off the screen.
 */
export function bowRest(side: number, drop: number, drawn: boolean, pull: number, grid: Grid, out: Rest) {
  const p = _item.reset().translate(side * HAND_POINT[0], HAND_POINT[1] - drop, HAND_POINT[2]);
  if (drawn) {
    p.translate(side * -0.2785682, 0.18344387, 0.15731531).rotX(-13.935).rotY(side * 35.3).rotZ(side * -9.785);
    p.translate(0, 0, pull * 0.04).rotY(side * -45);
  }
  p.display(BOW_FP, side);
  out.twoHanded = false;
  const [gx, gy] = STYLES.bow.grip;
  grid(gx, gy, out.gripLocal);
  out.itemOffset.set(0, 0, 0);
  out.grip.copy(out.gripLocal).applyMatrix4(p.m);
  p.m.decompose(_v, out.itemRot, _s);
  out.itemScale = _s.x;
  const fa = drawn ? DRAW_FOREARM : BOW_FOREARM;
  const f = _v.set(side * fa[0], fa[1], fa[2]).normalize();
  const thumb = _s.set(0, 1, 0).addScaledVector(f, -f.y).normalize();
  _m.makeBasis(new Vec3().crossVectors(f, thumb), f, thumb);
  out.armRot.setFromRotationMatrix(_m);
  // A slighter hand here, so the fist doesn't hide the bow.
  out.armScale = BOW_ARM_SCALE;
  out.armStretch = 1;
  out.armOffset.copy(f).multiplyScalar((4.5 / 16) * BOW_ARM_SCALE);
}

export function blendRest(a: Rest, b: Rest, k: number) {
  a.grip.lerp(b.grip, k);
  a.itemRot.slerp(b.itemRot, k);
  a.itemScale += (b.itemScale - a.itemScale) * k;
  a.gripLocal.lerp(b.gripLocal, k);
  a.itemOffset.lerp(b.itemOffset, k);
  a.armRot.slerp(b.armRot, k);
  a.armOffset.lerp(b.armOffset, k);
  a.armScale += (b.armScale - a.armScale) * k;
  a.armStretch += (b.armStretch - a.armStretch) * k;
  a.axis.lerp(b.axis, k).normalize();
}
