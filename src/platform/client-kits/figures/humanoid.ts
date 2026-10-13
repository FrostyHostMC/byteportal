import type { HumanoidPoses } from '@platform';
import type { Client, ClientKit, Figure, FigureHeld, FigureNode, FigureRig, FigureState } from '@platform/client';
import { Euler, Mat4, Quat, Vec3 } from '@platform/client/math';
import { heldInfo, inFist, type HeldInfo } from './held';
import { DEFAULT_POSES, resolvePoses, type Poses } from './poses';

export interface HumanoidOptions {
  /** Poses for every humanoid (under each model's own `poses`, and each item's `hold.poses`). */
  poses?: HumanoidPoses;
}

/**
 * Humanoid figures (docs/HUMANOID.md), animated in code from what they're doing: a gait worked
 * out from their speed and which way they go (feet planted and stepping, the legs bent to reach
 * them), crouching, sliding and jumping; the head and chest turned to look; a gun in both hands
 * aimed where they look (hands put on its grips), carried low across the chest to sprint, tipped
 * to reload, kicking as it fires, its lever or hammer worked; one hand free on a one-handed gun; a
 * sword swung two-handed; a throwable thrown overarm; and a fall when they die. How they hold
 * things and move is `HumanoidPoses`: the kit's options, each model's `poses`, each item's
 * `hold.poses`, each over the last.
 *
 * Figures that aren't on the rig animate themselves; the kit only puts what they hold in their
 * fist.
 */
export function humanoid(opts: HumanoidOptions = {}): ClientKit {
  const base = opts.poses ? resolvePoses(opts.poses) : DEFAULT_POSES;
  const posers = new WeakMap<Figure, Poser>();
  const fisted = new WeakMap<Figure, FigureHeld | null>();
  return {
    name: 'figures.humanoid',
    frame(client: Client) {
      for (const fig of client.figures.all) {
        if (!fig.rig) {
          // Not on the rig: what it holds, in its fist (once, when it changes).
          if (fig.held && fisted.get(fig) !== fig.held) inFist(fig.held);
          fisted.set(fig, fig.held);
          continue;
        }
        let p = posers.get(fig);
        if (!p) posers.set(fig, (p = new Poser(fig, fig.rig, resolvePoses(fig.spec.gltf?.poses, base))));
        p.frame();
        fig.posed = true;
      }
    },
  };
}

type Side = 'L' | 'R';

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);
const smooth = (t: number) => t * t * (3 - 2 * t);
/** From a pair `[walking, running]`, `run` of the way. */
const pace = (p: [number, number], run: number) => p[0] + (p[1] - p[0]) * run;
const X = new Vec3(1, 0, 0);
const Y = new Vec3(0, 1, 0);
const Z = new Vec3(0, 0, 1);

// Scratch.
const v1 = new Vec3();
const v2 = new Vec3();
const v3 = new Vec3();
const v4 = new Vec3();
const v5 = new Vec3();
const q1 = new Quat();
const q2 = new Quat();
const q3 = new Quat();
const m1 = new Mat4();
// Scratch for the free hand (apart from what `limb` works with).
const h1 = new Vec3();
const h2 = new Vec3();
const h3 = new Vec3();
const hq = new Quat();
const e1 = new Euler(0, 0, 0, 'YXZ');

/** A rotation from Euler angles (YXZ: turn, then tip, then roll). */
const rot = (out: Quat, x: number, y = 0, z = 0) => out.setFromEuler(e1.set(x, y, z, 'YXZ'));
const turnOf = (out: Quat, t: [number, number, number]) => rot(out, t[0], t[1], t[2]);

/**
 * One figure on the rig, posed each frame on the rig's own skeleton (its joints where the model's
 * are standing straight, unturned, each bone along its -y); the engine turns the model's joints
 * to match.
 */
class Poser {
  private j: FigureRig['joints'];
  /** The model's own space (the rig's skeleton is in it): feet and the ground are placed in it. */
  private body: FigureNode;
  /** The middle of the shoulders (the chest's space), which the aim turns about; the ankles' height. */
  private pivot: Vec3;
  private ankle: number;
  /** What's held (a model in its hand), on the chest: placed where the pose wants it each frame. */
  private held: { mount: FigureNode; node: FigureNode; info: HeldInfo; stance: 'rifle' | 'pistol' } | null = null;
  /** What the figure held when `held` was worked out. */
  private heldFrom: FigureHeld | null = null;
  /** The poses for what's held: its own (`hold.poses`) over the figure's. */
  private heldPoses: Poses;
  private last = -1;
  private phase = 0;
  private sprint = 0;
  private reload = 0;
  private reloadT = 0;
  private deathAt = -1;
  private deathDir = 1;
  /** From the spine up to the eyes (world units, measured once), for leaning the head out as far as `lean`. */
  private leanLever = 0;
  /** The body's turn in the world, and where it looks (this frame). */
  private bodyQ = new Quat();
  private aimQ = new Quat();

  constructor(
    private fig: Figure,
    private rig: FigureRig,
    readonly poses: Poses,
  ) {
    this.j = rig.joints;
    this.body = rig.body;
    this.heldPoses = poses;
    // The pivot: a centimetre above the middle of the shoulder joints.
    const s = rig.straight;
    this.pivot = new Vec3().addVectors(s.upperArmL, s.upperArmR).multiplyScalar(0.5).sub(s.chest);
    this.pivot.y += 0.01;
    this.ankle = s.footL.y;
  }

  /** This frame's pose, from what the figure is doing. */
  frame() {
    const s = this.fig.state;
    const dt = this.last < 0 ? 0 : clamp(s.time - this.last, 0, 0.1);
    this.last = s.time;
    if (this.fig.held !== this.heldFrom) this.hold(this.fig.held);
    this.pose(s, dt);
  }

  /** Something in hand (null: empty-handed): a model on the chest, placed by the pose; a sprite in the fist. */
  private hold(h: FigureHeld | null) {
    this.heldFrom = h;
    this.held = null;
    const info = h ? heldInfo(h) : null;
    this.heldPoses = info?.poses ? resolvePoses(info.poses, this.poses) : this.poses;
    if (!h) return;
    const mount = h.mount;
    if (!info) {
      // A sprite: in the fist at the end of the hand, as a figure off the rig holds it.
      const hand = this.fig.hand;
      if (hand && mount.parent !== hand) {
        hand.add(mount);
        mount.position.set(0, 0, 0);
        mount.quaternion.identity();
      }
      mount.visible = true;
      inFist(h);
      return;
    }
    if (mount.parent !== this.j.chest) this.j.chest.add(mount);
    const node = h.node;
    const scale = info.scale ?? (info.kind === 'other' ? 0.5 : this.poses.heldScale);
    const stance = info.stance ?? (info.length * scale < this.poses.pistolUnder ? 'pistol' : 'rifle');
    this.held = { mount, node, info, stance };
    node.scale.setScalar(scale / this.worldScale());
    node.quaternion.identity();
    node.position.copy(info.grip).multiplyScalar(-node.scale.x);
    // In the fist, tipped up a little.
    if (info.kind === 'other') {
      node.quaternion.setFromAxisAngle(X, -0.3);
      node.position.applyQuaternion(node.quaternion);
    }
  }

  private worldScale(): number {
    this.body.updateWorldMatrix(true, false);
    return v5.setFromMatrixScale(this.body.matrixWorld).x || 1;
  }

  /** Back to the rest pose, then posed. */
  private pose(s: Readonly<FigureState>, dt: number) {
    const rest = this.rig.rest;
    for (const name of Object.keys(rest) as (keyof typeof rest)[]) {
      this.j[name].position.copy(rest[name].position);
      this.j[name].quaternion.copy(rest[name].quaternion);
    }
    const P = this.poses;
    const G = P.gait;
    const j = this.j;
    const hips = j.hips;
    const hipRest = rest.hips.position;
    const crouch = clamp01(s.posture);
    const slide = clamp01(s.posture - 1);
    const speed = s.speed ?? 0;
    const moving = s.walkAmount;
    const run = clamp01((speed - G.run[0]) / (G.run[1] - G.run[0]));
    const air = s.air ? 1 : 0;
    const look = clamp(-s.headPitch, -1.25, 1.25);
    const held = this.held?.info.kind ?? null;
    const twoHanded = held === 'gun' || held === 'melee';
    const stance = this.held?.stance === 'pistol' ? this.heldPoses.pistol : this.heldPoses.rifle;
    this.sprint += ((s.sprint && held === 'gun' ? 1 : 0) - this.sprint) * clamp01(dt * 10);
    this.reload += ((s.reloading && held === 'gun' ? 1 : 0) - this.reload) * clamp01(dt * 12);
    this.reloadT = s.reloading ? this.reloadT + dt : 0;
    // Strides get longer as it speeds up; the phase runs with the ground covered.
    const stride = pace(G.stride, run);
    this.phase = (this.phase + (speed * dt) / stride) % 1;
    const ph = this.phase * Math.PI * 2;
    if (this.held) this.held.mount.visible = true;

    // Dying: a fall, backward or forward.
    if (s.dying > 0) {
      if (this.deathAt < 0) {
        this.deathAt = s.time;
        this.deathDir = Math.random() < P.death.backward ? -1 : 1;
      }
      this.fall(smooth(clamp01((s.time - this.deathAt) / P.death.time)));
      if (held === 'other') this.inFist();
      return;
    }
    this.deathAt = -1;

    // The hips: down to crouch and further to slide, a bob and a sway as it steps, leaning back to slide.
    const bob = moving * pace(G.bob, run) * (1 - Math.cos(ph * 2)) * 0.5;
    hips.position.set(hipRest.x + Math.sin(ph) * G.sway * moving * (1 - run), hipRest.y - crouch * G.crouch - slide * 0.12 - bob, hipRest.z - slide * 0.05);
    rot(q1, -0.55 * slide, 0, 0);
    hips.quaternion.multiply(q1);
    // The back: leaning into a run, a crouch; a twist to shoulder a gun; breathing.
    const lean = moving * pace(G.lean, run) + crouch * 0.16 * (1 - slide) + 0.3 * slide;
    const breathe = Math.sin(s.time * 1.9) * 0.012;
    const twist = held === 'gun' ? stance.twist * (1 - this.sprint) : 0;
    // Leaning out to peek: tipped over sideways at the spine (positive to its right), just far
    // enough that its eyes go out `lean`, as far as its head's hitbox does.
    const tip = s.lean ? Math.asin(clamp(s.lean / this.lever(), -0.95, 0.95)) : 0;
    rot(q1, lean * 0.45, twist * 0.4, tip);
    j.spine.quaternion.multiply(q1);
    // Aiming, the chest takes part of the look (the gun takes the rest, about the shoulders).
    const chestLook = twoHanded ? look * 0.35 * (1 - this.sprint) : look * 0.2;
    rot(q1, lean * 0.55 + breathe - chestLook, twist * 0.6, 0);
    j.chest.quaternion.multiply(q1);
    this.body.updateWorldMatrix(true, false);
    this.rig.root.updateMatrixWorld(true);

    // The body's frame in the world (it faces +z), and where it looks.
    const bodyQ = this.body.getWorldQuaternion(this.bodyQ);
    const scale = v5.setFromMatrixScale(this.body.matrixWorld).x || 1;
    const aimQ = rot(this.aimQ, -look, s.headYaw * 0.5, 0).premultiply(bodyQ);

    if (twoHanded) this.poseHeld(s, aimQ, bodyQ, scale);
    else this.swingArms(s, ph, moving, run, air);

    this.legs(s, ph, moving, run, crouch, slide, air, bodyQ);

    // The head looks where it looks, whatever the body's doing (tilted part-way with a lean).
    const head = j.head;
    rot(q1, -look, s.headYaw, (held === 'gun' ? stance.cheek * (s.sights ?? 0) : 0) + tip * 0.6).premultiply(bodyQ);
    j.neck.getWorldQuaternion(q2);
    head.quaternion.copy(q2.invert().multiply(q1));
    if (held === 'other') this.inFist();
  }

  /** From the spine up to the eyes, in the world (the figure's size), measured at rest the first time it's asked. */
  private lever(): number {
    if (!this.leanLever) {
      this.body.updateWorldMatrix(true, false);
      this.rig.root.updateMatrixWorld(true);
      const scale = v5.setFromMatrixScale(this.body.matrixWorld).x || 1;
      const spine = this.j.spine.getWorldPosition(v1).y;
      // The eyes are a little above the head's joint (the neck).
      this.leanLever = Math.max(0.2, this.j.head.getWorldPosition(v2).y - spine + 0.1 * scale);
    }
    return this.leanLever;
  }

  /** Something held in the right fist: the holder on its grip. */
  private inFist() {
    const grip = this.j.gripR;
    const mount = this.held!.mount;
    grip.updateWorldMatrix(true, false);
    this.j.chest.updateWorldMatrix(true, false);
    m1.copy(this.j.chest.matrixWorld).invert().multiply(grip.matrixWorld).decompose(mount.position, mount.quaternion, v5);
    mount.updateMatrixWorld(true);
  }

  /**
   * Both hands on a gun or a sword: where it's held (aimed, carried low, reloaded, swung, its
   * action worked), then the arms to it. A gun held in one hand: the free hand in its own pose.
   */
  private poseHeld(s: Readonly<FigureState>, aimQ: Quat, bodyQ: Quat, scale: number) {
    const { info, mount, node } = this.held!;
    const P = this.heldPoses;
    const j = this.j;
    const chest = j.chest;
    // The shoulders' middle, the pivot the aim turns about.
    const pivot = chest.localToWorld(v1.copy(this.pivot));
    const offset = v2;
    const gunQ = q1.copy(aimQ);
    if (info.kind === 'gun') {
      const stance = this.held!.stance === 'pistol' ? P.pistol : P.rifle;
      const ads = s.sights ?? 0;
      offset.fromArray(stance.hip).lerp(v3.fromArray(stance.ads), ads);
      // Kick: back and up, for a moment after each shot.
      const k = P.kick;
      const kick = s.shotT !== undefined && s.shotT < 5.5 / k.decay ? Math.exp(-s.shotT * k.decay) : 0;
      offset.z -= k.back * kick;
      gunQ.multiply(rot(q2, -k.tip * kick, 0, 0));
      // Working the action, a beat after the shot: a lever rocked, a hammer cocked.
      const act = info.action === 'lever' ? P.lever : info.action === 'hammer' ? P.hammer : null;
      const t = act && s.shotT !== undefined ? (s.shotT - 0.08) / act.time : -1;
      if (act && t > 0 && t < 1) {
        const w = Math.sin(t * Math.PI);
        offset.addScaledVector(v3.fromArray(act.offset), w);
        gunQ.multiply(rot(q2, act.turn[0] * w, act.turn[1] * w, act.turn[2] * w));
      }
      // Sprinting: low across the chest, muzzle down and to the left.
      if (this.sprint > 0.001) {
        offset.lerp(v3.fromArray(P.sprint.offset), this.sprint);
        gunQ.slerp(q2.copy(bodyQ).multiply(turnOf(q3, P.sprint.turn)), this.sprint);
      }
      // Reloading: tipped over to show the magazine.
      if (this.reload > 0.001) {
        offset.lerp(v3.fromArray(P.reload.offset), this.reload);
        gunQ.slerp(q2.copy(bodyQ).multiply(turnOf(q3, P.reload.turn)), this.reload);
      }
    } else {
      // A sword: two hands low on the handle, the blade up and forward; a chop when it attacks.
      const sw = P.sword;
      offset.fromArray(sw.offset);
      gunQ.copy(bodyQ).multiply(turnOf(q2, sw.turn));
      const { time, windup, raise, chop } = sw.swing;
      if (s.attackT < time) {
        const a = s.attackT / time;
        const up = a < windup ? smooth(a / windup) : 1 - smooth((a - windup) / (1 - windup));
        const down = a < windup ? 0 : smooth((a - windup) / (1 - windup));
        offset.add(v3.fromArray(raise.offset).multiplyScalar(up).addScaledVector(v4.fromArray(chop.offset), down));
        const r = raise.turn;
        const c = chop.turn;
        gunQ.multiply(rot(q2, r[0] * up + c[0] * down, r[1] * up + c[1] * down, r[2] * up + c[2] * down));
      }
    }
    // The holder is the chest's: from the world into it.
    const at = v3.copy(offset).multiplyScalar(scale).applyQuaternion(aimQ).add(pivot);
    mount.position.copy(chest.worldToLocal(at));
    mount.quaternion.copy(chest.getWorldQuaternion(q2).invert().multiply(gunQ));
    mount.updateMatrixWorld(true);

    // Hands on it: the right on the grip, the left on the handguard (or the magazine, reloading).
    const handQ = mount.getWorldQuaternion(new Quat());
    const grip = mount.getWorldPosition(v4);
    this.limb('R', grip, handQ, v1.set(-0.8, -0.55, -0.35).applyQuaternion(bodyQ), false);
    if (info.kind === 'gun' && info.hands === 1) return this.offHand(info, node, handQ, bodyQ, P);
    const support = info.grip2 ? node.localToWorld(v2.copy(info.grip2)) : null;
    if (support) {
      if (info.kind === 'gun' && this.reload > 0.001 && info.mag) support.lerp(this.reloading(node, info.mag, P, v3), this.reload);
      this.limb('L', support, handQ, v1.set(0.45, -0.9, 0.05).applyQuaternion(bodyQ), false);
    }
  }

  /** Where a reloading hand is (the world's space): to the magazine and away (a fresh one from the belt), and back, each `cycle`. */
  private reloading(node: FigureNode, mag: Vec3, P: Poses, out: Vec3): Vec3 {
    const t = (this.reloadT % P.reload.cycle) / P.reload.cycle;
    const away = t < 0.25 ? 0 : t < 0.6 ? smooth((t - 0.25) / 0.35) : 1 - smooth((t - 0.6) / 0.4);
    return node.localToWorld(out.copy(mag)).lerp(this.j.hips.localToWorld(v4.fromArray(P.reload.belt)), away);
  }

  /**
   * The free hand of a gun held in one hand: in the stance's `offHand` pose (from the middle of
   * the shoulders, in the chest's frame), and to the gun's magazine and the belt to reload.
   */
  private offHand(info: HeldInfo, node: FigureNode, gunQ: Quat, bodyQ: Quat, P: Poses) {
    const chest = this.j.chest;
    const pose = (this.held!.stance === 'pistol' ? P.pistol : P.rifle).offHand;
    const at = chest.localToWorld(h1.copy(this.pivot).add(h2.fromArray(pose.offset)));
    const handQ = chest.getWorldQuaternion(hq).multiply(turnOf(q2, pose.turn));
    // Loose: the elbow back and out. To the gun: out and down, like a support hand's.
    const pole = h3.set(0.4, -0.2, -1).normalize();
    if (this.reload > 0.001 && info.mag) {
      at.lerp(this.reloading(node, info.mag, P, h2), this.reload);
      handQ.slerp(gunQ, this.reload);
      pole.lerp(v4.set(0.45, -0.9, 0.05), this.reload).normalize();
    }
    this.limb('L', at, handQ, pole.applyQuaternion(bodyQ), false);
  }

  /** Empty-handed (or one thing in the fist): the arms swing as it walks. */
  private swingArms(s: Readonly<FigureState>, ph: number, moving: number, run: number, air: number) {
    const j = this.j;
    const swing = Math.sin(ph) * moving * pace(this.poses.gait.armSwing, run);
    const throws = this.held?.info.throws === true;
    const attack = !throws && s.attackT < 0.35 ? Math.sin((s.attackT / 0.35) * Math.PI) : 0;
    // A throw (in half a second): the arm cocked back over the shoulder, the other out ahead,
    // then whipped over and down across the body, and back.
    const t = throws ? s.attackT / 0.5 : 1;
    const cock = t < 0.24 ? smooth(t / 0.24) : t < 0.6 ? 1 - smooth((t - 0.24) / 0.36) : 0;
    const whip = t < 0.24 || t >= 1 ? 0 : t < 0.6 ? smooth((t - 0.24) / 0.36) : 1 - smooth((t - 0.6) / 0.4);
    const raised = s.raised ? 1 : s.casting ? 0.6 : 0;
    const bend = 0.25 + 0.9 * run;
    rot(q1, -swing - 1.6 * attack - 2.4 * raised - 0.5 * air - 2.6 * cock - 1.2 * whip, 0.3 * whip, -0.08 - 0.3 * air - 0.25 * cock);
    j.upperArmR.quaternion.multiply(q1);
    rot(q1, -bend - 0.6 * attack - 1.5 * cock, 0, 0);
    j.lowerArmR.quaternion.multiply(q1);
    rot(q1, swing - 2.4 * raised - 0.5 * air - 1.1 * cock + 0.3 * whip, 0, 0.08 + 0.3 * air);
    j.upperArmL.quaternion.multiply(q1);
    rot(q1, -bend, 0, 0);
    j.lowerArmL.quaternion.multiply(q1);
  }

  /** The feet: planted and stepping along the way it goes, tucked in the air, out ahead in a slide; the legs bend to them. */
  private legs(s: Readonly<FigureState>, ph: number, moving: number, run: number, crouch: number, slide: number, air: number, bodyQ: Quat) {
    const G = this.poses.gait;
    // Which way it's going, in its own space (+z ahead).
    let dx = s.moveX ?? 0;
    let dz = s.moveZ ?? 1;
    const dl = Math.hypot(dx, dz);
    if (dl < 1e-3) {
      dx = 0;
      dz = 1;
    } else {
      dx /= dl;
      dz /= dl;
    }
    const step = moving * pace(G.step, run) * (1 - crouch * 0.4);
    const lift = moving * pace(G.lift, run) * (1 - slide);
    const ankle = this.ankle;
    for (const side of ['L', 'R'] as const) {
      const sign = side === 'L' ? 1 : -1;
      // Stance for half the cycle (the foot slides back under the body), then a swing forward, lifted.
      const t = ((ph / (Math.PI * 2) + (side === 'L' ? 0 : 0.5)) % 1 + 1) % 1;
      let along: number;
      let up = 0;
      if (t < 0.5) along = step * (0.5 - t * 2);
      else {
        const u = (t - 0.5) * 2;
        along = step * (smooth(u) - 0.5);
        up = Math.sin(u * Math.PI) * lift;
      }
      const x = sign * (G.width + 0.05 * crouch) + dx * along;
      let z = dz * along;
      let y = ankle + up;
      // A crouch: one foot a little ahead of the other. A slide: the left leg out ahead, the right
      // tucked under. In the air: tucked up.
      z += crouch * (1 - slide) * (side === 'L' ? 0.12 : -0.08);
      if (slide > 0) {
        z = z * (1 - slide) + slide * (side === 'L' ? 0.72 : 0.05);
        y = y * (1 - slide) + slide * (side === 'L' ? ankle : ankle + 0.12);
      }
      if (air > 0) {
        y += 0.2 * air;
        z += (side === 'L' ? 0.12 : -0.1) * air;
      }
      const target = this.body.localToWorld(v1.set(x, y, z));
      // Level feet, toes up a little as they swing through.
      const footQ = q1.copy(bodyQ).multiply(rot(q2, -up * 1.2, 0, 0));
      this.limb(side, target, footQ, v2.set(sign * 0.12, 0, 1).applyQuaternion(bodyQ), true);
    }
  }

  /**
   * Two-bone IK: bend `side`'s arm (or leg) so its end joint puts its grip (or itself) at `target`,
   * turned to `endQ`, the elbow (knee) toward `pole`. Arms bend forward at the elbow, legs back.
   */
  private limb(side: Side, target: Vec3, endQ: Quat, pole: Vec3, leg: boolean) {
    const j = this.j;
    const rest = this.rig.rest;
    const upperName = leg ? (`upperLeg${side}` as const) : (`upperArm${side}` as const);
    const lowerName = leg ? (`lowerLeg${side}` as const) : (`lowerArm${side}` as const);
    const endName = leg ? (`foot${side}` as const) : (`hand${side}` as const);
    const upper = j[upperName];
    const lower = j[lowerName];
    const end = j[endName];
    const grip = leg ? undefined : rest[`grip${side}`];
    // The upper bone's parent: the hips (a leg) or the chest (an arm).
    const parent = leg ? j.hips : j.chest;
    parent.updateWorldMatrix(true, false);
    const scale = v5.setFromMatrixScale(parent.matrixWorld).x || 1;
    const a = rest[lowerName].position.length() * scale;
    const b = rest[endName].position.length() * scale;
    // Where the wrist goes for the grip to be at the target.
    const endWorldQ = q2.copy(endQ);
    if (grip) endWorldQ.multiply(q3.copy(grip.quaternion).invert());
    const wrist = v3.copy(target);
    if (grip) wrist.sub(v4.copy(grip.position).multiplyScalar(scale).applyQuaternion(endWorldQ));
    const S = upper.getWorldPosition(v4);
    const toW = wrist.sub(S);
    const d = clamp(toW.length(), Math.abs(a - b) + 1e-3, a + b - 1e-4);
    const dir = toW.normalize();
    const cosA = clamp((a * a + d * d - b * b) / (2 * a * d), -1, 1);
    const sinA = Math.sqrt(1 - cosA * cosA);
    const perp = v5.copy(pole).addScaledVector(dir, -pole.dot(dir));
    if (perp.lengthSq() < 1e-8) perp.copy(Math.abs(dir.y) < 0.9 ? Y : Z).addScaledVector(dir, -(Math.abs(dir.y) < 0.9 ? dir.y : dir.z));
    perp.normalize();
    // The elbow, and the wrist it can reach.
    const E = new Vec3().copy(S).addScaledVector(dir, a * cosA).addScaledVector(perp, a * sinA);
    const W = new Vec3().copy(S).addScaledVector(dir, d);
    // Each bone points down its own -y; they share a hinge axis.
    const yU = new Vec3().subVectors(S, E).normalize();
    const u = new Vec3().subVectors(W, E).normalize();
    const hinge = new Vec3().crossVectors(yU.clone().negate(), u);
    if (hinge.lengthSq() < 1e-6) hinge.crossVectors(perp, dir);
    hinge.normalize();
    if (!leg) hinge.negate();
    const upperQ = basisQ(hinge, yU, new Quat());
    const yL = new Vec3().subVectors(E, W).normalize();
    const lowerQ = basisQ(hinge, yL, new Quat());
    const parentQ = parent.getWorldQuaternion(new Quat());
    upper.quaternion.copy(parentQ.invert().multiply(upperQ));
    lower.quaternion.copy(upperQ.clone().invert().multiply(lowerQ));
    end.quaternion.copy(lowerQ.invert().multiply(endWorldQ));
  }

  /** Dead: the knees go, it falls (back, mostly), the arms fly out. `t` 0..1. */
  private fall(t: number) {
    const j = this.j;
    const hips = j.hips;
    const r = this.rig.rest.hips.position;
    const dir = this.deathDir;
    const drop = smooth(clamp01(t * 1.3));
    hips.position.set(r.x, r.y - (r.y - 0.18) * drop, r.z + dir * 0.55 * t);
    rot(q1, dir * 1.45 * t, 0, 0.15 * t);
    hips.quaternion.multiply(q1);
    const knees = Math.sin(clamp01(t * 1.6) * Math.PI) * 1.1;
    for (const side of ['L', 'R'] as const) {
      const sign = side === 'L' ? 1 : -1;
      rot(q1, -knees * 0.6 - (dir > 0 ? 0.2 : -0.1) * t, 0, sign * 0.12 * t);
      j[`upperLeg${side}`].quaternion.multiply(q1);
      rot(q1, knees, 0, 0);
      j[`lowerLeg${side}`].quaternion.multiply(q1);
      rot(q1, -1.3 * t, 0, sign * 1.1 * t);
      j[`upperArm${side}`].quaternion.multiply(q1);
      rot(q1, -0.5 * t, 0, 0);
      j[`lowerArm${side}`].quaternion.multiply(q1);
    }
    rot(q1, -dir * 0.35 * t, 0.4 * t, 0);
    j.head.quaternion.multiply(q1);
    // A gun or a sword drops from the hands (a thing in the fist stays in it).
    if (this.held) this.held.mount.visible = t < 0.3 || this.held.info.kind === 'other';
  }
}

/** The rotation whose x and y axes are these (z completes them). */
function basisQ(x: Vec3, y: Vec3, out: Quat): Quat {
  const xx = v1.copy(x).addScaledVector(y, -x.dot(y)).normalize();
  const zz = v2.crossVectors(xx, y);
  m1.makeBasis(xx, y, zz);
  return out.setFromRotationMatrix(m1);
}
