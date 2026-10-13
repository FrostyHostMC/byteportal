import type { HumanoidPoses } from '@platform';
import type { Client, ClientKit, Figure, FigureHeld, FigureNode, FigureRig, FigureState } from '@platform/client';
import { Euler, Mat4, Quat, Vec3 } from '@platform/client/math';
import type { HeroId } from '../../defs';
import { JUMP } from '../../tuning';
import { HeroScene, type Victim } from '../state';
import { heldInfo, inFist, type HeldInfo } from './held';
import { DEFAULT_POSES, resolvePoses, type Poses } from './poses';
import { gunHeroPose, type GunHeroPose } from './gunhero';
import { saberPose, stanceOf, type Gesture, type SaberKey, type SaberPose } from './saber';

export interface HumanoidOptions {
  /** Poses for every humanoid (under each model's own `poses`, and each item's `hold.poses`). */
  poses?: HumanoidPoses;
  /** What the heroes are doing (their sabers, their powers, who they hold): `../state.ts`. */
  scene: HeroScene;
}

/**
 * Blockfront's copy of the platform's figures kit (`src/platform/client-kits/figures/`), with the
 * heroes in it: a hero's saber held in their stance (each hero's own), swung through the combo's
 * three slashes, raised to guard (twitching to each bolt it turns), knocked back when parried; the
 * Force powers' gestures (a hand thrust out to push, pull or choke, both for lightning, the arm
 * that threw the saber waiting for it); and whoever a power has hold of: clutching at their throat
 * with their feet kicking, reaching as they're dragged in, flung back. Each hero's blade and hands
 * as drawn go into the scene for the effects (`../fx.ts`). Everything else is the platform's kit
 * as it was.
 *
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
export function humanoid(opts: HumanoidOptions): ClientKit {
  const base = opts.poses ? resolvePoses(opts.poses) : DEFAULT_POSES;
  const posers = new WeakMap<Figure, Poser>();
  const fisted = new WeakMap<Figure, FigureHeld | null>();
  return {
    name: 'blockfront.heroes.figures',
    frame(client: Client) {
      for (const fig of client.figures.all) {
        if (!fig.rig) {
          // Not on the rig: what it holds, in its fist (once, when it changes).
          if (fig.held && fisted.get(fig) !== fig.held) inFist(fig.held);
          fisted.set(fig, fig.held);
          continue;
        }
        let p = posers.get(fig);
        if (!p) posers.set(fig, (p = new Poser(fig, fig.rig, resolvePoses(fig.spec.gltf?.poses, base), opts.scene)));
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
// Scratch for the heroes' poses.
const s1 = new Vec3();
const s2 = new Vec3();
const s3 = new Vec3();
const s4 = new Vec3();
const s5 = new Vec3();
const sq1 = new Quat();
const sq2 = new Quat();
const sq3 = new Quat();
const UP = new Vec3(0, 1, 0);
/** Where a saber's blade starts, as a part of the way from the grip to its tip. */
const BLADE_FROM = 3.75 / 25.625;

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
  /** The body's turn in the world, and where it looks (this frame). */
  private bodyQ = new Quat();
  private aimQ = new Quat();
  /** The hero whose saber it holds (a model), and their stance as it eases from one to the next. */
  private hero: HeroId | null = null;
  private stance: SaberKey | null = null;
  /** The hero whose blaster it holds (Chewblocca's bowcaster, Boba Fetch's EE-3). */
  private gunHero: HeroId | null = null;
  /** A hero floating in a jump, legs hanging (0..1), and bent a little more through a flip (0..1). */
  private float = 0;
  private bend = 0;
  /** The body's place at rest, while a hero's second jump turns it over (a flip, a spin). */
  private flipRest: { p: Vec3; q: Quat } | null = null;

  constructor(
    private fig: Figure,
    private rig: FigureRig,
    readonly poses: Poses,
    private scene: HeroScene,
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
    this.flip(s);
    this.pose(s, dt);
  }

  /**
   * A hero's second jump in the air: the whole body turned over about the hips (Luke's and Ben's
   * a forward flip, the Emperor's a spin, `JUMP`'s `flip`), everything posed in the turned body.
   */
  private flip(s: Readonly<FigureState>) {
    const body = this.body;
    const id = this.hero ?? this.gunHero;
    const kind = id ? JUMP[id].flip : null;
    const at = this.fig.player ? this.scene.flips.get(this.fig.player) : undefined;
    const len = kind === 'spin' ? 0.55 : 0.5;
    const t = at === undefined ? 99 : this.scene.now - at;
    const on = (kind === 'flip' || kind === 'spin') && t >= 0 && t < len && s.air && s.dying <= 0;
    if (!on) {
      if (this.flipRest) {
        body.position.copy(this.flipRest.p);
        body.quaternion.copy(this.flipRest.q);
        this.flipRest = null;
      }
      return;
    }
    if (!this.flipRest) this.flipRest = { p: body.position.clone(), q: body.quaternion.clone() };
    const u = smooth(t / len);
    const turn = kind === 'flip' ? q1.setFromAxisAngle(X, u * Math.PI * 2) : q1.setFromAxisAngle(Y, u * Math.PI * 2);
    // About the hips: the rest place moved so the hips stay where they were.
    const pivot = v2.set(0, this.rig.straight.hips.y, 0);
    const off = v3.copy(pivot).sub(v4.copy(pivot).applyQuaternion(turn)).multiplyScalar(body.scale.x).applyQuaternion(this.flipRest.q);
    body.position.copy(this.flipRest.p).add(off);
    body.quaternion.copy(this.flipRest.q).multiply(turn);
  }

  /** Something in hand (null: empty-handed): a model on the chest, placed by the pose; a sprite in the fist. */
  private hold(h: FigureHeld | null) {
    this.heldFrom = h;
    this.held = null;
    const info = h ? heldInfo(h) : null;
    this.hero = info ? HeroScene.heroOf(h?.item) : null;
    this.gunHero = info?.kind === 'gun' ? HeroScene.heroByWeapon(h?.item) : null;
    this.stance = this.hero ? stanceOf(this.hero) : null;
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
    const pid = this.fig.player;
    // A hero with their saber: its pose (the stance, a swing, a power's gesture) this frame.
    const sab = this.hero && this.stance && pid && s.dying <= 0 ? saberPose(this.scene, pid, this.hero, { run: clamp01(((s.speed ?? 0) - G.run[0]) / (G.run[1] - G.run[0])) * clamp01(s.walkAmount * 1.5), air: !!s.air, dt, smoothed: this.stance }) : null;
    const victim = pid && s.dying <= 0 ? this.scene.victim(pid) : null;
    // A hero with a blaster: their powers' leans and gestures over the gun's pose.
    const gact = this.gunHero && pid && s.dying <= 0 ? gunHeroPose(this.scene, pid, this.gunHero) : null;
    const stance = this.held?.stance === 'pistol' ? this.heldPoses.pistol : this.heldPoses.rifle;
    this.sprint += (((s.sprint || (gact?.carry ?? 0) > 0.5) && held === 'gun' ? 1 : 0) - this.sprint) * clamp01(dt * 10);
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
    // Knocked flat (a Wookiee's charge): down on their back a moment, then up again.
    if (victim?.kind === 'down') {
      const t = this.scene.now - victim.at;
      const len = victim.until - victim.at;
      const k = t < 0.25 ? smooth(clamp01(t / 0.25)) : t > len - 0.35 ? smooth(clamp01((len - t) / 0.35)) : 1;
      this.deathDir = -1;
      this.fall(0.82 * k);
      if (held === 'other') this.inFist();
      return;
    }

    // The hips: down to crouch and further to slide, a bob and a sway as it steps, leaning back to slide.
    const bob = moving * pace(G.bob, run) * (1 - Math.cos(ph * 2)) * 0.5;
    hips.position.set(hipRest.x + Math.sin(ph) * G.sway * moving * (1 - run), hipRest.y - crouch * G.crouch - slide * 0.12 - bob - (sab?.drop ?? 0), hipRest.z - slide * 0.05);
    rot(q1, -0.55 * slide, 0, 0);
    hips.quaternion.multiply(q1);
    // The back: leaning into a run, a crouch; a twist to shoulder a gun; breathing.
    const lean = moving * pace(G.lean, run) + crouch * 0.16 * (1 - slide) + 0.3 * slide + (sab?.key.lean ?? 0) + (gact?.lean ?? 0) + (victim ? this.victimLean(victim) : 0);
    const breathe = Math.sin(s.time * 1.9) * 0.012;
    const twist = held === 'gun' ? stance.twist * (1 - this.sprint) : (sab?.key.twist ?? 0);
    rot(q1, lean * 0.45, twist * 0.4, 0);
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

    if (sab) this.poseSaber(sab, look, aimQ, bodyQ, scale);
    else if (twoHanded) this.poseHeld(s, aimQ, bodyQ, scale);
    else this.swingArms(s, ph, moving, run, air);
    if (gact && held === 'gun') this.gunGesture(gact, aimQ, bodyQ, scale);

    // A hero in a jump floats: legs hanging loose under them (not tucked up), bent a little more
    // through a flip.
    const floatTo = (this.hero || this.gunHero) && s.air ? 1 : 0;
    this.float += (floatTo - this.float) * clamp01(dt * 10);
    this.bend += ((this.flipRest !== null ? 1 : 0) - this.bend) * clamp01(dt * 10);
    this.legs(s, ph, moving, run, crouch, slide, air, bodyQ, this.float, this.bend);
    if (victim) this.victimPose(victim, s, bodyQ, scale);

    // The head looks where it looks, whatever the body's doing.
    const head = j.head;
    rot(q1, -look, s.headYaw, held === 'gun' ? stance.cheek * (s.sights ?? 0) : 0).premultiply(bodyQ);
    j.neck.getWorldQuaternion(q2);
    head.quaternion.copy(q2.invert().multiply(q1));
    // Choked: the head thrown back. Roaring: too.
    if (victim?.kind === 'choke') head.quaternion.multiply(rot(q1, -0.55 + Math.sin(s.time * 13) * 0.08, Math.sin(s.time * 7) * 0.2, 0));
    if (gact?.headBack) head.quaternion.multiply(rot(q1, -gact.headBack, 0, 0));
    if (held === 'other' && !victim) this.inFist();
  }

  // -----------------------------------------------------------------------------------------------
  // Heroes

  /** The frame a hero's saber pose is in: the body's, turned up or down with half the look. */
  private saberFrame(bodyQ: Quat, look: number, out: Quat): Quat {
    return out.copy(bodyQ).multiply(rot(sq3, -look * 0.5, 0, 0));
  }

  /**
   * A fist's turn in the world holding something pointing along `dir` at `at`, the forearm back
   * toward the shoulder (so the wrist stays natural whichever way the blade points).
   */
  private fistQ(dir: Vec3, at: Vec3, shoulder: Vec3, out: Quat): Quat {
    const y = s4.subVectors(shoulder, at);
    y.addScaledVector(dir, -y.dot(dir));
    if (y.lengthSq() < 1e-6) y.copy(UP).addScaledVector(dir, -dir.y);
    y.normalize();
    const x = s5.crossVectors(y, dir).normalize();
    return basisQ(x, y, out);
  }

  /** A hero's saber in hand (or thrown, or put away) and their hands: the pose `sab`. */
  private poseSaber(sab: SaberPose, look: number, aimQ: Quat, bodyQ: Quat, scale: number) {
    const { info, mount, node } = this.held!;
    const j = this.j;
    const chest = j.chest;
    const k = sab.key;
    const pivot = chest.localToWorld(s1.copy(this.pivot));
    const frameQ = this.saberFrame(bodyQ, look, sq1);
    const t = this.fig.state.time;
    // The fist on the hilt, and the blade out of it.
    const grip = s2.fromArray(k.p).multiplyScalar(scale).applyQuaternion(frameQ).add(pivot);
    if (sab.shake) grip.add(s3.set(Math.sin(t * 61) * sab.shake, Math.sin(t * 73 + 1) * sab.shake, Math.sin(t * 57 + 2) * sab.shake));
    const dir = s3.set(0, 0, 1).applyQuaternion(rot(sq2, k.tip, k.turn, 0)).applyQuaternion(frameQ).normalize();
    const shoulderR = j.upperArmR.getWorldPosition(new Vec3());
    const fistR = this.fistQ(dir, grip, shoulderR, new Quat());
    mount.position.copy(chest.worldToLocal(grip.clone()));
    mount.quaternion.copy(chest.getWorldQuaternion(sq2).invert().multiply(fistR));
    mount.updateMatrixWorld(true);
    mount.visible = !sab.hide;
    const pid = this.fig.player!;
    const now = this.scene.now;
    // The blade as drawn, for the effects: from the hilt's end to the tip.
    if (!sab.hide) {
      // Its tip: the model's `muzzle` if it marks one, else its far end; its blade from the emitter
      // (the sabers' blades start at 3.75 px of their 25.6 to the tip: `tools/weapons/build.mjs`).
      const g = info.grip;
      const end = this.heldFrom?.points.muzzle?.z ?? this.heldFrom?.bounds.max.z ?? g.z + 1.8;
      const len = end - g.z;
      const base = node.localToWorld(new Vec3(g.x, g.y, g.z + len * BLADE_FROM));
      const tip = node.localToWorld(new Vec3(g.x, g.y, end));
      const at = this.fig.root.getWorldPosition(s4);
      this.scene.blades.set(pid, { base: { x: base.x, y: base.y, z: base.z }, tip: { x: tip.x, y: tip.y, z: tip.z }, at: { x: at.x, y: at.y, z: at.z }, t: now, hero: this.hero! });
    } else this.scene.blades.delete(pid);
    // The right hand: on the hilt, or (the saber gone) its gesture.
    const high = Math.max(0, k.p[1] + 0.1);
    const poleR = v1.set(-0.85, -0.55 + 1.3 * high, -0.3).applyQuaternion(bodyQ);
    if (sab.hide && sab.right) this.gesture('R', sab.right, null, aimQ, bodyQ, scale);
    else this.limb('R', grip.clone(), fistR, poleR, false);
    // The left: on the hilt too (below the right), free (at rest, or its gesture), or between.
    const two = sab.hide ? 0 : k.two;
    let onHilt: Vec3 | null = null;
    let hiltQ: Quat | null = null;
    if (two > 0.001) {
      const g2 = info.grip2 ?? new Vec3(info.grip.x, info.grip.y, info.grip.z + 3);
      onHilt = node.localToWorld(new Vec3(g2.x, g2.y, g2.z));
      hiltQ = this.fistQ(dir, onHilt, j.upperArmL.getWorldPosition(new Vec3()), new Quat());
    }
    if (two >= 0.999 && onHilt && hiltQ) this.limb('L', onHilt, hiltQ, v1.set(0.45, -0.9, 0.05).applyQuaternion(bodyQ), false);
    else this.gesture('L', sab.left ?? { at: [0.24, -0.5, 0.06], w: 0, open: false }, onHilt && hiltQ ? { at: onHilt, q: hiltQ, w: two } : null, aimQ, bodyQ, scale);
    // Where its hands are, for the effects (lightning from them, a push's wave).
    j.handL.updateWorldMatrix(true, false);
    j.handR.updateWorldMatrix(true, false);
    const l = j.handL.getWorldPosition(new Vec3());
    const r = j.handR.getWorldPosition(new Vec3());
    this.scene.hands.set(pid, { l: { x: l.x, y: l.y, z: l.z }, r: { x: r.x, y: r.y, z: r.z }, t: now });
  }

  /**
   * A free hand: from where it rests (the chest's frame: `g.at` when `g.w` is 0) to its gesture
   * (the look's frame, `g.w` of the way), or on toward the hilt (`hilt`, `hilt.w` of the way).
   */
  private gesture(side: 'L' | 'R', g: Gesture, hilt: { at: Vec3; q: Quat; w: number } | null, aimQ: Quat, bodyQ: Quat, scale: number) {
    const j = this.j;
    const chest = j.chest;
    const sign = side === 'L' ? 1 : -1;
    // At rest (no gesture: `g.at` is where it rests) it hangs by the side, in the chest's frame.
    const rest = g.w === 0 ? g.at : [0.24 * sign, -0.5, 0.06];
    const at = chest.localToWorld(new Vec3().copy(this.pivot).add(new Vec3(rest[0], rest[1], rest[2])));
    if (g.w > 0) at.lerp(new Vec3().fromArray(g.at).multiplyScalar(scale).applyQuaternion(aimQ).add(chest.localToWorld(new Vec3().copy(this.pivot))), g.w);
    const shoulder = j[`upperArm${side}`].getWorldPosition(new Vec3());
    // Open hands point their fingers up (palm out); fists forward.
    const aimFwd = new Vec3(0, 0, 1).applyQuaternion(aimQ);
    const pointing = g.open ? new Vec3(0, 1, 0).lerp(aimFwd, 0.2).normalize() : aimFwd.clone().lerp(UP, 0.5).normalize();
    const restDir = new Vec3(0, 0, 1).applyQuaternion(bodyQ);
    const q = this.fistQ(restDir.lerp(pointing, g.w).normalize(), at, shoulder, new Quat());
    if (hilt && hilt.w > 0) {
      at.lerp(hilt.at, hilt.w);
      q.slerp(hilt.q, hilt.w);
    }
    const pole = v1.set(0.5 * sign, -0.85, -0.1 + 0.2 * g.w).applyQuaternion(bodyQ);
    this.limb(side, at, q, pole, false);
  }

  /**
   * A hero with a blaster: the free hand off the gun to a gesture (`g.w` of the way from where it
   * holds the gun), and their hands as drawn, for the effects (the flamethrower from the wrist).
   */
  private gunGesture(pose: GunHeroPose, aimQ: Quat, bodyQ: Quat, scale: number) {
    const j = this.j;
    const g = pose.left;
    if (g && g.w > 0.02) {
      const chest = j.chest;
      j.gripL.updateWorldMatrix(true, false);
      const from = j.gripL.getWorldPosition(new Vec3());
      const to = new Vec3().fromArray(g.at).multiplyScalar(scale).applyQuaternion(aimQ).add(chest.localToWorld(new Vec3().copy(this.pivot)));
      const at = from.lerp(to, g.w);
      const shoulder = j.upperArmL.getWorldPosition(new Vec3());
      const aimFwd = new Vec3(0, 0, 1).applyQuaternion(aimQ);
      const pointing = g.open ? new Vec3(0, 1, 0).lerp(aimFwd, 0.2).normalize() : aimFwd.clone().lerp(UP, 0.5).normalize();
      const q = this.fistQ(pointing, at, shoulder, new Quat());
      this.limb('L', at, q, v1.set(0.5, -0.85, -0.1 + 0.2 * g.w).applyQuaternion(bodyQ), false);
    }
    const pid = this.fig.player;
    if (!pid) return;
    j.handL.updateWorldMatrix(true, false);
    j.handR.updateWorldMatrix(true, false);
    const l = j.handL.getWorldPosition(new Vec3());
    const r = j.handR.getWorldPosition(new Vec3());
    this.scene.hands.set(pid, { l: { x: l.x, y: l.y, z: l.z }, r: { x: r.x, y: r.y, z: r.z }, t: this.scene.now });
  }

  /** Leaning with what a power does to them: back choked, forward stunned. */
  private victimLean(v: Victim): number {
    const t = this.scene.now - v.at;
    if (v.kind === 'choke') return -0.2;
    if (v.kind === 'pull') return t < 0.4 ? -0.25 : 0.35;
    return -0.3 * Math.max(0, 1 - t / 0.8);
  }

  /**
   * Someone a power has hold of: choked (hands at the throat, feet kicking, what they hold gone
   * from their hands), dragged in (reaching), stunned (arms hanging), flung back (an arm thrown up).
   */
  private victimPose(v: Victim, s: Readonly<FigureState>, bodyQ: Quat, scale: number) {
    const j = this.j;
    const t = this.scene.now - v.at;
    const body = this.body;
    const hand = (side: 'L' | 'R', local: Vec3, fwd: Vec3, pole: Vec3) => {
      const at = body.localToWorld(local);
      const shoulder = j[`upperArm${side}`].getWorldPosition(new Vec3());
      this.limb(side, at, this.fistQ(fwd.applyQuaternion(bodyQ).normalize(), at, shoulder, new Quat()), pole.applyQuaternion(bodyQ), false);
    };
    const neckY = this.rig.straight.neck.y;
    if (v.kind === 'choke' || v.kind === 'pull') {
      if (this.held) this.held.mount.visible = false;
      if (this.hero) this.scene.blades.delete(this.fig.player!);
    }
    if (v.kind === 'choke') {
      const w = Math.sin(s.time * 11) * 0.02;
      hand('L', new Vec3(0.07, neckY + 0.02 + w, 0.1), new Vec3(-0.6, 0.6, 0.2), new Vec3(0.8, -0.3, 0));
      hand('R', new Vec3(-0.07, neckY + 0.02 - w, 0.1), new Vec3(0.6, 0.6, 0.2), new Vec3(-0.8, -0.3, 0));
      // Feet dangling, kicking.
      for (const side of ['L', 'R'] as const) {
        const sign = side === 'L' ? 1 : -1;
        const kick = Math.sin(s.time * 9 + (side === 'L' ? 0 : 2.1));
        const foot = body.localToWorld(new Vec3(sign * 0.09, this.ankle - 0.02 + Math.max(0, kick) * 0.12, 0.04 + kick * 0.12));
        this.limb(side, foot, sq1.copy(bodyQ).multiply(rot(sq2, 0.6 + kick * 0.3, 0, 0)), v1.set(sign * 0.12, 0, 1).applyQuaternion(bodyQ), true);
      }
    } else if (v.kind === 'pull') {
      if (t < 0.45) {
        hand('L', new Vec3(0.22, 1.45, 0.42), new Vec3(0, 0.3, 1), new Vec3(0.6, -0.6, 0));
        hand('R', new Vec3(-0.22, 1.4, 0.44), new Vec3(0, 0.3, 1), new Vec3(-0.6, -0.6, 0));
      } else {
        const sway = Math.sin(s.time * 5) * 0.04;
        hand('L', new Vec3(0.2, 0.95 + sway, 0.22), new Vec3(0, -0.6, 1), new Vec3(0.7, 0.2, -0.3));
        hand('R', new Vec3(-0.2, 0.95 - sway, 0.22), new Vec3(0, -0.6, 1), new Vec3(-0.7, 0.2, -0.3));
      }
    } else {
      // Flung back: the free arm thrown up and out.
      const w = Math.max(0, 1 - t / 0.8);
      if (w > 0.05) hand('L', new Vec3(0.32 + 0.1 * w, 1.35 + 0.5 * w, 0.05 - 0.2 * w), new Vec3(0, 1, 0.3), new Vec3(0.8, 0.2, -0.4));
    }
    void scale;
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

  /** The feet: planted and stepping along the way it goes, drawn up in the air (a hero's hanging), out ahead in a slide; the legs bend to them. */
  private legs(s: Readonly<FigureState>, ph: number, moving: number, run: number, crouch: number, slide: number, air: number, bodyQ: Quat, float = 0, bend = 0) {
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
      // tucked under. In the air: drawn up a little, one ahead; a hero's hang loose and drift, toes
      // down, as if they were floating.
      z += crouch * (1 - slide) * (side === 'L' ? 0.12 : -0.08);
      if (slide > 0) {
        z = z * (1 - slide) + slide * (side === 'L' ? 0.72 : 0.05);
        y = y * (1 - slide) + slide * (side === 'L' ? ankle : ankle + 0.12);
      }
      if (air > 0) {
        const lead = side === 'L';
        const drift = Math.sin(s.time * 1.6 + (lead ? 0 : 2.1)) * 0.03;
        const hangY = (lead ? 0.08 : 0.02) + 0.14 * bend;
        const hangZ = (lead ? 0.1 : -0.06) + drift + (lead ? 0.1 : 0.06) * bend;
        y += air * (0.2 * (1 - float) + hangY * float);
        z += air * ((lead ? 0.12 : -0.1) * (1 - float) + hangZ * float);
      }
      const target = this.body.localToWorld(v1.set(x, y, z));
      // Level feet, toes up a little as they swing through (pointed down, a hero hanging in the air).
      const footQ = q1.copy(bodyQ).multiply(rot(q2, -up * 1.2 + 0.5 * air * float, 0, 0));
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
