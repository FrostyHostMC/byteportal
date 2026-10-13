import type { HoldSpec, HoldStyle, ViewAnimation } from '@platform';
import type { Client, ClientEvent, ClientKit, HeldItem, HumanoidViewArms, Node, ViewArm } from '@platform/client';
import { Euler, MathUtils, Quat, Vec3 } from '@platform/client/math';
import type { BowOwn, ConsumableOwn, MeleeOwn } from '@platform/items';
import { BUILTIN, compile, eatPose, pyr, type Anim, type Motion } from './anims';
import { ARM_FIT, fitArms, placeBent, placeStraight, upperFor, wristFor, type ArmFit } from './arms';
import { gunPoints, isCompact, sameSpec, type GunPoints } from './points';
import {
  attachedRest,
  blendRest,
  bowRest,
  CYCLE,
  DEG,
  forearmDir,
  GUN,
  gunPose,
  gunRest,
  MODEL_GRIPS,
  MODEL_USE,
  modelRest,
  newRest,
  polearmRest,
  STYLES,
  X,
  type Grid,
  type GunPose,
  type GunView,
  type Rest,
  type StyleDef,
  type V3,
} from './poses';

/**
 * The first-person view: what's in hand and the player's own arms, placed in the view layer
 * (`client.view`) each frame. The rig (the layer's space: x right, y up, z back):
 *
 *   root    walk bob, look sway, breathing, landing dip, kick
 *     hand  at the fist; animations move it and turn it (about a pivot)
 *       item  placed relative to the fist, turned by the animation's `wrist` (a gun's hands and flash on it)
 *       arm   the skin's 4x12x4 arm (arm2: the other, for two-handed holds), or a humanoid's pieces
 *
 * How it holds each thing is its style (`HoldStyle`: the item's `hold.style`, else by its kind):
 * Minecraft's transforms for swords, items, blocks and bows, two hands on a polearm, and guns'
 * own poses (at the hip, sprinting, sliding, aimed down the sights, reloading, working the
 * action). It lowers the hand to swap what's held and after each hit, and plays the item's use,
 * the server's animations and its own.
 */

/** What the hand holds, as it's shown. */
type Shown =
  | { kind: 'sprite'; item: HeldItem; hold: HoldSpec; style: HoldStyle }
  | { kind: 'block'; item: HeldItem; cross: boolean }
  | { kind: 'empty' };

/** How far past the muzzle the flash sits, in the model's blocks (a pixel). */
const FLASH_AHEAD = 1 / 16;

/** The style an item of each kind is held in when its hold doesn't say (a kind not here: `item`). */
export const KIND_STYLES: Readonly<Record<string, HoldStyle>> = { melee: 'sword', bow: 'bow', gun: 'gun', throwable: 'throw' };

/** The first-person kit's options. */
export interface FirstPersonOptions {
  /** The style items of a kind are held in when their hold doesn't say, over `KIND_STYLES`: a game's own kinds (`{ grapple: 'gun' }`). */
  styles?: Record<string, HoldStyle>;
}

const _v = new Vec3();
const _s = new Vec3();
const _qa = new Quat();
const _qb = new Quat();
const _fa = new Vec3();
const _fb = new Vec3();
const _fc = new Vec3();

export class FirstPersonKit implements ClientKit {
  readonly name = 'firstPerson';
  /** The style each kind of item is held in when its hold doesn't say (`KIND_STYLES`, and a game's own kinds). */
  readonly styles: Readonly<Record<string, HoldStyle>>;

  constructor(opts: FirstPersonOptions = {}) {
    this.styles = { ...KIND_STYLES, ...opts.styles };
  }

  /** Debug: slow motion (0 freezes it). */
  timeScale = 1;
  /** Bow draw 0..1 (the bow kit's `me.items.bow`). */
  draw = 0;

  private client!: Client;
  private root!: Node;
  private hand!: Node;
  private arm: Node | null = null;
  /** The other hand, for two-handed holds. */
  private arm2: Node | null = null;
  private armsVersion = -1;
  /** The skin the arms wear, and whether they're the player model's own arm. */
  private skin: ViewArmsSkin = null;
  private armLook = false;
  /** What the layer has in hand, last seen. */
  private seen: HeldItem | null | undefined = undefined;

  private held: Shown = { kind: 'empty' };
  private pending: Shown | null = null;
  /** An animation to play once the item coming up is in hand (a throw made as it rose). */
  private queued: string | null = null;
  private style: StyleDef | null = null;
  private styleName: HoldStyle | null = null;
  private hold: HoldSpec = {};
  private side: 1 | -1 = 1;
  private armSide: 1 | -1 = 1;
  private apiVisible = true;

  /** Animations of the game's client code's own (`define`). */
  private anims = new Map<string, Anim>();
  private compiled = new WeakMap<ViewAnimation, Anim>();
  private playing: { anim: Anim; t: number; power: number; speed: number } | null = null;
  private motion: Motion = { pivot: new Vec3(), rot: new Quat(), offset: new Vec3(), wrist: new Quat() };
  private fadeFrom = { pos: new Vec3(), rot: new Quat(), wrist: new Quat() };
  private fadeT = 1;
  /** A pose held (`pose`: a guard up), how far it's eased in (0..1), whether it's wanted, and how fast it eases. */
  private stance: Anim | null = null;
  private stanceW = 0;
  private stanceOn = false;
  private stanceRate = 8;
  /** Eating (the consumable kit's word): how far the hand's up at the mouth (0..1), whether it's wanted, and for how long. */
  private eatW = 0;
  private eatOn = false;
  private eatT = 0;

  /** Minecraft's `mainHandHeight`: 1 = raised, 0 = fully dipped. */
  private height = 0;
  private drawBlend = 0;
  private time = 0;
  private lastYaw = NaN;
  private lastPitch = 0;
  private sway = { x: 0, y: 0 };
  private dip = 0;
  private dipVel = 0;
  private kickA = 0;
  private kickVel = 0;
  private downT = 0;

  private rest = newRest();
  private restDrawn = newRest();
  private drop = 0;
  private tmpQ = new Quat();

  // --- guns ---
  /** The held gun's points (its own space, blocks). */
  private gunPts: GunPoints | null = null;
  /** The held gun's poses (its `hold.gun` over the defaults). */
  private gunPose: GunPose = GUN;
  /**
   * A humanoid player's own arms: how big, how far they reach, how the elbows bend, where the
   * support fist sits (their model's `firstPerson`, and the held gun's `hold.gun.arm` over it).
   */
  private modelFit: HumanoidViewArms['fit'] = null;
  private fit: ArmFit = ARM_FIT;
  /** A humanoid player's own arms (their model's), in place of the skin's. */
  private humanoid: HumanoidViewArms | null = null;
  /** Bent arms: where each shoulder is (the view's space) and how long each upper arm is drawn, from the gun's pose at rest. */
  private shoulders = [new Vec3(), new Vec3()];
  private uppers = [0, 0];
  /** The support hand on show (a one-handed gun's only to reload), and where it waits out of sight then (the gun's space). */
  private supportShown = 1;
  private away = new Vec3();
  /** The hands on a gun (palms and fingers, in the gun's own space, so they move with it). */
  private gunHands!: Node;
  private gunHand2!: Node;
  /** Springs: the kick back and the muzzle rise after a shot. */
  private recoil = { z: 0, vz: 0, r: 0, vr: 0, roll: 0, vroll: 0 };
  /** Working a pump or bolt after a shot: seconds in, or -1. */
  private cycleT = -1;
  private flash!: Node;
  private flashT = 0;
  private lastGun: GunView | null = null;
  /** The world camera's zoom is ours (a gun's been held). */
  private zoomed = false;

  // --- the kit -----------------------------------------------------------------------------------

  setup(client: Client) {
    this.client = client;
    const v = client.view;
    this.root = v.node();
    this.hand = v.node();
    v.root.add(this.root);
    this.root.add(this.hand);
    this.gunHands = v.node();
    this.gunHand2 = v.node();
    this.gunHands.visible = false;
    this.gunHands.add(this.gunHand2);
    // The flash is depth tested: what's nearer the eye than the muzzle (the support hand, the gun
    // itself, seen end-on as it points in at the crosshair) stays in front of it.
    this.flash = v.sprite('flash', { additive: true, depthTest: true, color: [7, 5, 2.4] });
    this.flash.renderOrder = 10;
  }

  frame(client: Client, dt: number) {
    const me = client.me;
    for (const e of client.events) this.event(e);
    if (client.view.arms.version !== this.armsVersion) this.armsChanged();
    const now = client.view.held;
    if (now !== this.seen) {
      this.seen = now;
      this.take(now);
    }
    // A bow drawn far enough shows its drawn look.
    // (The bow kit's word on the draw: `me.items.bow`.)
    const bow = me.items.bow as BowOwn | undefined;
    if (now?.def?.kind === 'bow') now.alternate(!!bow?.drawing && bow.charge > 0.25);
    const gun = me.held ? (me.held.state as unknown as GunView) : undefined;
    this.draw = bow?.drawing ? bow.charge : 0;
    // Eating: the hand at the mouth till it's eaten or they stop. (`me.items.consumable`.)
    const food = me.items.consumable as ConsumableOwn | undefined;
    this.eatOn = !!food?.eating && this.held.kind !== 'empty' && !me.dead;
    this.update(dt, gun);
    // Aiming down the sights zooms the world's view.
    const zoom = me.held?.state.zoom;
    if (typeof zoom === 'number') {
      const a = gun?.aim ?? 0;
      client.camera.zoom = 1 + (zoom - 1) * a * a * (3 - 2 * a);
      this.zoomed = true;
    } else if (this.zoomed) {
      client.camera.zoom = 1;
      this.zoomed = false;
    }
  }

  dispose() {
    for (const n of [this.arm, this.arm2, this.flash]) if (n) this.client.view.free(n);
    this.clearGunHands();
    this.root.parent?.remove(this.root);
  }

  /** What happened: the server's calls to the view, shots, throws, landings. */
  private event(e: ClientEvent) {
    switch (e.t) {
      case 'shot':
        return this.fire(e.power);
      case 'use':
        return this.use(e.power);
      case 'swing':
        return this.swing(e.power);
      case 'kick':
        return this.kick(e.strength);
      case 'toss':
        return this.toss();
      case 'land':
        // Landing hard dips the view.
        if (e.vy < -4) this.dipVel -= Math.min(1.6, -e.vy * 0.09);
        return;
      case 'view.play':
        return this.play(e.anim, { power: e.power, speed: e.speed });
      case 'view.visible':
        this.visible = e.visible;
        return;
      case 'view.setSkin':
        return this.client.view.arms.setSkin(e.skin, e.atlas);
    }
  }

  // --- what a game's client code can call --------------------------------------------------------

  get visible(): boolean {
    return this.apiVisible;
  }

  /** Show the arm and what's in hand (the server's `viewModel.visible`). */
  set visible(v: boolean) {
    this.apiVisible = v;
    this.root.visible = v;
  }

  /** Register a named animation for `play` and `HoldSpec.use` (over the game's and the built-in ones). */
  define(name: string, anim: ViewAnimation) {
    this.anims.set(name, compile(anim));
  }

  /** Play an animation: one `define`d, the game's (`viewModel.define` on the server), a built-in one, or keyframes. */
  play(anim: string | ViewAnimation, opts: { power?: number; speed?: number } = {}) {
    const a = typeof anim === 'string' ? this.animation(anim) : this.compileOnce(anim);
    if (!a) {
      console.warn(`viewModel.play: unknown animation "${anim as string}"`);
      return;
    }
    this.start(a, opts.power ?? 1, opts.speed ?? 1);
  }

  /**
   * Hold the hand in a pose till told otherwise (null lets it go): a guard up, a brace. The pose is
   * an animation's last frame (a single key will do); it eases in and out over `ease` seconds,
   * and anything played meanwhile plays over it, cross-faded.
   */
  pose(anim: string | ViewAnimation | null, opts: { ease?: number } = {}) {
    this.stanceRate = 1 / Math.max(0.01, opts.ease ?? 0.12);
    if (!anim) {
      this.stanceOn = false;
      return;
    }
    const a = typeof anim === 'string' ? this.animation(anim) : this.compileOnce(anim);
    if (!a) {
      console.warn(`viewModel.pose: unknown animation "${anim as string}"`);
      return;
    }
    this.stance = a;
    this.stanceOn = true;
  }

  /** Jolt the arm (recoil, being hit). */
  kick(strength = 1) {
    this.kickVel += strength * 7;
  }

  /** The held item's own action: swing, drink, loose a bow, place a block, punch, fire. */
  use(power = 1) {
    if (this.holdingGun) return this.fire(power);
    let anim: string | ViewAnimation;
    if (this.held.kind === 'sprite') anim = this.hold.use ?? ((this.hold.model && MODEL_USE[this.held.style]) || STYLES[this.held.style].use);
    else if (this.held.kind === 'block') anim = 'swing';
    else anim = 'punch';
    this.play(anim, { power });
  }

  /** Throw what's in hand (the `toss`), as soon as it's in hand if it's still coming up. */
  toss() {
    if (this.pending) this.queued = 'toss';
    else this.play('toss');
  }

  /** A plain swing (attacking with something that isn't a weapon). */
  swing(power = 1) {
    this.play(this.held.kind === 'empty' ? 'punch' : 'swing', { power });
  }

  /** A gun went off: the kick, the rise, the flash (and then its pump or bolt, if it has one). */
  fire(power = 1) {
    if (this.styleName !== 'gun') return;
    const aim = this.lastGun?.aim ?? 0;
    const k = power * (1 - 0.55 * aim);
    this.recoil.vz += 7 * k;
    this.recoil.vr += 9 * k;
    this.recoil.vroll += (Math.random() - 0.5) * 6 * k;
    this.flashT = 0.055;
    this.flash.rotation.z = Math.random() * Math.PI * 2;
    if (this.lastGun?.action) this.cycleT = 0;
  }

  /** A gun is in hand (posed as one). */
  get holdingGun(): boolean {
    return this.styleName === 'gun' && this.held.kind === 'sprite';
  }

  // --- internals -----------------------------------------------------------------------------------

  private animation(name: string): Anim | undefined {
    const own = this.anims.get(name);
    if (own) return own;
    const game = this.client.view.animations.get(name);
    return game ? this.compileOnce(game) : BUILTIN[name];
  }

  private compileOnce(anim: ViewAnimation): Anim {
    let a = this.compiled.get(anim);
    if (!a) this.compiled.set(anim, (a = compile(anim)));
    return a;
  }

  /** Start an animation, cross-faded from wherever the hand is now. */
  private start(anim: Anim, power: number, speed: number) {
    this.fadeFrom.pos.copy(this.hand.position);
    this.fadeFrom.rot.copy(this.hand.quaternion);
    this.fadeFrom.wrist.copy(this.motion.wrist);
    this.fadeT = this.playing ? 0 : 1;
    this.playing = { anim, t: 0, power, speed };
  }

  /** What's in hand changed: it comes up once the hand's down (or at once, if it looks the same). */
  private take(h: HeldItem | null) {
    const target = this.pending ?? this.held;
    if (!h) {
      if (target.kind !== 'empty') this.pending = { kind: 'empty' };
      return;
    }
    if (h.form === 'block' || h.form === 'cross') {
      if (target.kind === 'block' && target.item === h) return;
      this.pending = { kind: 'block', item: h, cross: h.form === 'cross' };
      return;
    }
    const fallback = h.def && Object.hasOwn(this.styles, h.def.kind) ? this.styles[h.def.kind] : 'item';
    // Held as a model (boxes or glTF), posed by its grip; else as its sprite.
    const hold: HoldSpec = h.model ? { ...h.def?.hold, model: h.model } : (h.def?.hold ?? {});
    const style = hold.style ?? fallback;
    // Already held so: nothing to do. (Two items can share a model and hold it their own ways.)
    if (target.kind === 'sprite' && target.item.look === h.look && target.style === style && sameSpec(target.hold, hold)) return;
    this.pending = { kind: 'sprite', item: h, hold, style };
  }

  /** The player's arms changed (their skin, their model's arm, a humanoid's arms). */
  private armsChanged() {
    const a = this.client.view.arms;
    this.armsVersion = a.version;
    this.skin = a.skin;
    this.armLook = a.model;
    if (a.humanoid !== this.humanoid) {
      // (The layer took the old pieces away.)
      this.humanoid = a.humanoid;
      this.modelFit = a.humanoid?.fit ?? null;
      this.refit();
      if (this.humanoid) for (const s of [this.humanoid.R, this.humanoid.L]) for (const n of [s.upper, s.forearm, s.fist]) this.hand.add(n);
    }
    this.buildArm();
  }

  /** The humanoid arms' fit for what's held: the model's, and a gun's own over it. */
  private refit() {
    this.fit = fitArms(this.modelFit, this.styleName === 'gun' ? this.gunPose.arm : undefined);
  }

  /** The size things are held at, less the item's own `hold.scale`: a humanoid's arms don't grow with the gun. */
  private heldBase(r: Rest): number {
    if (this.held.kind !== 'sprite') return STYLES.gun.scale;
    return this.styleName === 'bow' ? r.itemScale : r.itemScale / (this.hold.scale || 1);
  }

  /** The shown item's sprite grid (where a style's grip pixel is). */
  private grid: Grid = (x, y, out) => (this.held.kind !== 'empty' ? this.held.item.pixel(x, y, out) : out.set(x / 16 - 0.5, 0.5 - y / 16, 0));

  /** Where the support fist holds, from the firing fist (hand space): round the handguard's near side (its left, the side we see), a little under it (a one-handed gun's: where its hand is). */
  private supportGrip(r: Rest, itemQ: Quat, k: number, out: Vec3): Vec3 {
    const fit = this.fit;
    const side = this.gunPts && this.gunPose.hands === 2 && this.held.kind === 'sprite' ? this.held.item.halfWidthAt(this.gunPts.grip2.z) * r.itemScale : 0;
    return out.set(side + fit.support[0] * k, fit.support[1] * k, fit.support[2] * k).applyQuaternion(itemQ).add(r.grip2);
  }

  /**
   * Bent arms on a gun: each shoulder (the view's space) where the arm at rest ends, `reach` from
   * its wrist along the pose's forearm line, and each upper arm drawn out so the elbow bends
   * `bend` at rest. From the pose before a reload or an action moves the hands, so they stay put.
   */
  private restShoulders(r: Rest) {
    const fit = this.fit;
    const hum = this.humanoid!;
    if (!(fit.bend[0] > 0 || fit.bend[1] > 0)) return;
    const k = (this.heldBase(r) / hum.heldScale) * fit.scale;
    const dir = _fb.copy(r.armOffset).normalize().add(_fc.set(0.25 * this.side, 0.05, 0)).normalize();
    this.shoulders[0].copy(wristFor(hum.R, r.grip, r.itemRot, k, _v, fit.hands)).addScaledVector(dir, fit.reach[0]);
    this.uppers[0] = upperFor(fit.reach[0], hum.R.wrist.length() * k, hum.R.elbow.length() * k, fit.bend[0]);
    const at = this.supportGrip(r, r.itemRot, k, _fa).add(r.grip);
    this.shoulders[1].copy(wristFor(hum.L, at, r.itemRot, k, _v, fit.hands)).addScaledVector(_fb.subVectors(r.arm2Offset, r.grip2).normalize(), fit.reach[1]);
    this.uppers[1] = upperFor(fit.reach[1], hum.L.wrist.length() * k, hum.L.elbow.length() * k, fit.bend[1]);
  }

  /** A point of the view's space in the hand's (where the arms are). */
  private inHand(p: Vec3, out: Vec3): Vec3 {
    return out.copy(p).sub(this.hand.position).applyQuaternion(_qa.copy(this.hand.quaternion).invert());
  }

  /** Which way a bent elbow goes, in the hand's space: down, and out to its own side (`sign` 1 the firing arm's, -1 the support arm's). */
  private elbowPole(sign: number, out: Vec3): Vec3 {
    return out.set(0.45 * this.side * sign, -1, 0.1).normalize().applyQuaternion(_qa.copy(this.hand.quaternion).invert());
  }

  /**
   * A humanoid player's own arms on what's held: their fists on the grips (the item's turn), each
   * arm back from its wrist to a shoulder off the screen, straight or (on a gun, with `bend`) bent
   * at the elbow to reach a shoulder that stays put as the hand kicks and moves.
   */
  private placeHumanoid(r: Rest, m: Motion) {
    const hum = this.humanoid!;
    const itemQ = this.held.kind !== 'empty' ? this.tmpQ.copy(m.wrist).multiply(r.itemRot) : this.tmpQ.copy(r.armRot);
    const fit = this.fit;
    // A little bigger than life, as shooters draw them (the hands read around the gun), whatever the gun's size.
    const k = (this.heldBase(r) / hum.heldScale) * fit.scale;
    const gun = this.styleName === 'gun' && !!this.gunPts;
    if (gun && fit.bend[0] > 0) placeBent(hum.R, _fa.set(0, 0, 0), itemQ, this.inHand(this.shoulders[0], _fb), this.elbowPole(1, _fc), k, this.uppers[0], fit.hands);
    else {
      // The firing arm out to the right of the stock, not behind it.
      const out = _fb.copy(r.armOffset).normalize().add(_fc.set(0.25, 0.05, 0)).normalize().clone();
      placeStraight(hum.R, _fa.set(0, 0, 0).clone(), itemQ, out, k, fit.reach[0], fit.hands);
    }
    const two = r.twoHanded && this.supportShown > 0;
    const L: ViewArm = hum.L;
    L.fist.visible = L.forearm.visible = L.upper.visible = two;
    if (!two) return;
    const at = this.supportGrip(r, itemQ, k, _fc).clone();
    if (gun && fit.bend[1] > 0) placeBent(hum.L, at, itemQ, this.inHand(this.shoulders[1], _fb), this.elbowPole(-1, _fa), k, this.uppers[1], fit.hands);
    else placeStraight(hum.L, at, itemQ, _fb.subVectors(r.arm2Offset, r.grip2).clone(), k, fit.reach[1], fit.hands);
  }

  /** Main arm (right, or mirrored for the left hand; the classic skin layout) and the other one. */
  private buildArm() {
    const view = this.client.view;
    if (this.humanoid) {
      if (this.arm) this.arm.visible = false;
      if (this.arm2) this.arm2.visible = false;
      this.gunHands.visible = false;
      return;
    }
    const remake = (length?: number, mirror?: boolean) => {
      const n = view.arms.arm({ length, mirror });
      if (n) this.hand.add(n);
      return n;
    };
    if (this.armLook) {
      // The model's own arm.
      for (const n of [this.arm, this.arm2]) if (n) view.free(n);
      this.arm = remake();
      this.arm2 = remake();
      if (this.arm) this.arm.visible = true;
      return;
    }
    if (this.arm) this.arm.visible = !!this.skin;
    if (!this.skin) return;
    // Holding a gun: just the sleeve (the hands are on the gun, see `buildGunHands`).
    const length = this.styleName === 'gun' ? 9 : 12;
    for (const n of [this.arm, this.arm2]) if (n) view.free(n);
    this.arm = remake(length, this.armSide < 0);
    this.arm2 = remake(length, this.armSide > 0);
    this.buildGunHands();
  }

  private clearGunHands() {
    for (const c of [...this.gunHands.children, ...this.gunHand2.children]) {
      if (c === this.gunHand2) continue;
      this.client.view.free(c as unknown as Node);
    }
  }

  /**
   * The hands around a gun, in its own space (so they go wherever it goes): a palm on the grip
   * with a finger on the trigger and a thumb along the side, and the other palm under the
   * handguard with its fingers wrapped round (a pistol's cups the grip). Made of the skin's hand.
   */
  private buildGunHands() {
    this.clearGunHands();
    const pts = this.gunPts;
    this.gunHands.visible = !!pts && this.styleName === 'gun' && !!this.skin && !this.armLook;
    if (!pts || !this.skin || this.armLook || this.held.kind !== 'sprite') return;
    const px = 1 / 16;
    const box = (parent: Node, size: V3, at: Vec3, rx = 0, ry = 0) => {
      const m = this.client.view.arms.box(size);
      if (!m) return;
      m.position.copy(at);
      m.rotation.set(rx, ry, 0);
      parent.add(m);
    };
    const g = pts.grip;
    const P = (x: number, y: number, z: number) => new Vec3(g.x + x * px, g.y + y * px, g.z + z * px);
    // Firing hand: palm round the raked grip, trigger finger, thumb up the near side.
    box(this.gunHands, [3.4, 4.4, 3.6], P(0, -0.4, -0.3), 0.26);
    box(this.gunHands, [1.1, 1.1, 2.4], P(0.2, 1.5, 2.1));
    box(this.gunHands, [1.1, 3.4, 1.4], P(0, -0.6, 2.0), 0.26);
    box(this.gunHands, [1.1, 1.1, 2.8], P(1.9, 1.6, 0.7));
    // Support hand, placed at grip2 (moved there each frame: a reload takes it away).
    const hw = this.held.item.halfWidthAt(pts.grip2.z);
    if (isCompact(pts)) {
      box(this.gunHand2, [3.6, 3.6, 3.6], new Vec3(0, -0.2 * px, 0));
      box(this.gunHand2, [1.1, 1.1, 3.0], new Vec3(2.0 * px, 1.3 * px, 0.6 * px));
    } else {
      box(this.gunHand2, [3.6, 2.4, 4.2], new Vec3(0, -1.0 * px, 0));
      box(this.gunHand2, [1.1, 2.6, 4.0], new Vec3(hw + 0.6 * px, 0.6 * px, 0));
      box(this.gunHand2, [1.1, 1.2, 3.0], new Vec3(-hw - 0.6 * px, 0.8 * px, 0.3 * px));
    }
  }

  /** What's in hand now comes up: its node in the hand, its style and hold, a gun's points and pose. */
  private apply(h: Shown) {
    if (this.held.kind !== 'empty') this.held.item.node.parent?.remove(this.held.item.node);
    this.held = h;
    this.style = null;
    this.styleName = null;
    this.hold = {};
    if (h.kind === 'sprite') {
      this.hold = h.hold;
      this.styleName = h.style;
      this.hand.add(h.item.node);
      h.item.node.add(this.gunHands);
      h.item.node.add(this.flash);
    } else if (h.kind === 'block') {
      // Plants and torches are flat items; everything else is a little cube.
      this.styleName = h.cross ? 'item' : 'block';
      this.hand.add(h.item.node);
    }
    if (this.styleName) {
      const base = STYLES[this.styleName];
      const hd = this.hold;
      this.style = {
        ...base,
        rotation: hd.rotation ?? base.rotation,
        translation: hd.translation ?? base.translation,
        scale: base.scale * (hd.scale ?? 1),
        grip: hd.grip ?? (this.held.kind === 'block' && this.styleName === 'item' ? [8, 15.5] : base.grip),
      };
    }
    this.side = (this.hold.hand ?? 'right') === 'left' ? -1 : 1;
    // A gun's points: marked on its model, else from its spec (pixels), else guessed from its size.
    const wasGun = this.gunPts !== null;
    this.gunPts = null;
    if (this.styleName === 'gun' && h.kind === 'sprite') {
      const pts = (this.gunPts = gunPoints(h.item.points, h.item.bounds));
      // Marked on the item, for whatever else leaves from them (a tracer from the muzzle).
      Object.assign(h.item.points, pts);
      // Just past the muzzle, clear of the barrel's tip.
      this.flash.position.copy(pts.muzzle).z += FLASH_AHEAD;
      this.gunPose = gunPose(h.hold.gun, isCompact(pts));
    }
    this.refit();
    this.flash.visible = false;
    this.cycleT = -1;
    if (this.side !== this.armSide || wasGun !== (this.gunPts !== null) || this.gunPts) {
      this.armSide = this.side;
      this.buildArm();
    }
    this.playing = null;
  }

  /**
   * Two hands: as an animation moves the fists, turn each forearm toward where its elbow was at
   * rest, so the arms reach rather than slide.
   */
  private reach(r: Rest) {
    const inv = this.tmpQ.copy(this.hand.quaternion).invert();
    const len = (4.5 / 16) * r.armScale * r.armStretch;
    const fit = (fist: Vec3, restOffset: Vec3, rot: Quat, pos: Vec3, restFist: Vec3) => {
      // Elbow at rest (root space), fist now (root space).
      const elbow = _v.copy(restOffset).normalize().multiplyScalar(0.55).add(restFist);
      const now = _s.copy(fist).applyQuaternion(this.hand.quaternion).add(this.hand.position);
      const dir = elbow.sub(now).normalize().applyQuaternion(inv);
      const axis = r.axis.clone().applyQuaternion(inv);
      forearmDir(dir.clone(), axis, rot);
      pos.copy(fist).addScaledVector(dir, len);
    };
    if (this.arm) fit(new Vec3(), r.armOffset, this.arm.quaternion, this.arm.position, r.grip);
    if (!r.twoHanded || !this.arm2) return;
    const off2 = r.arm2Offset.clone().sub(r.grip2);
    fit(r.grip2.clone(), off2, this.arm2.quaternion, this.arm2.position, r.grip.clone().add(r.grip2));
  }

  /**
   * A gun's own motion on top of its pose: the support hand leaving for the magazine on a reload
   * (or feeding shells one by one), working the action, the gun tipped to show its magazine side.
   * A one-handed gun's support hand waits out of sight below it, and comes up only to reload.
   */
  private gunMotion(dt: number, gv: GunView, r: Rest) {
    const pts = this.gunPts!;
    const S = r.itemScale;
    const smooth = (x: number) => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x));
    const one = this.gunPose.hands === 1;
    // Where the support hand rests, in the gun's space: on the handguard, or (one-handed) low and
    // to the left of the firing fist, off the bottom of the screen.
    const rest = one ? this.away.set(-0.1 * this.side, -0.42, 0.1).applyQuaternion(_qa.copy(r.itemRot).invert()).divideScalar(S).add(pts.grip) : pts.grip2;
    this.supportShown = !one || (gv.reload > 0 && gv.reload < 1) ? 1 : 0;
    // Where the support hand is, in the gun's space.
    const hand = _fa.copy(rest);
    let tip = 0;
    let jolt = 0;
    if (gv.reload >= 0) {
      const p = gv.reload;
      tip = smooth(p / 0.14) * smooth((1 - p) / 0.16);
      const mag = pts.mag;
      const below = _fb.copy(mag).add(_fc.set(0.02, -0.7, -0.15));
      if (gv.shells > 0) {
        // Round by round: to the loading port, push, back. A port underneath (a shotgun's tube) is
        // fed from below it; one in the side (a revolver's gate), from that side.
        const n = Math.max(1, gv.shells);
        const q = Math.min(0.999, Math.max(0, (p - 0.1) / 0.8)) * n;
        const f = q - Math.floor(q);
        const push = f < 0.5 ? smooth(f / 0.5) : 1 - smooth((f - 0.5) / 0.5);
        const out = mag.x - pts.grip.x;
        const at = Math.abs(out) > 1 / 32 ? _v.copy(mag).add(_s.set(Math.sign(out) * (0.26 - push * 0.2), -0.1, -0.05)) : _v.copy(mag).add(_s.set(0, -0.28 + push * 0.22, -0.05));
        hand.lerp(at, smooth(p / 0.1) * smooth((1 - p) / 0.1));
        jolt = f > 0.45 && f < 0.6 ? 1 : 0;
      } else {
        const keys: [number, Vec3][] = [
          [0, rest],
          [0.15, mag],
          [0.3, below],
          [0.48, below],
          [0.64, mag],
          [0.8, rest],
          [1, rest],
        ];
        let i = 1;
        while (i < keys.length - 1 && keys[i][0] < p) i++;
        const [t0, a] = keys[i - 1];
        const [t1, b] = keys[i];
        hand.copy(a).lerp(b, smooth((p - t0) / Math.max(1e-3, t1 - t0)));
        jolt = p > 0.62 && p < 0.7 ? 1 : 0;
      }
    }
    // The action worked after a shot: back and forward along the gun, the gun rolled over, rocked
    // on the support hand, canted in under the thumb; or the game's own, played.
    let roll = 0;
    let rock = 0;
    let cant = 0;
    if (this.cycleT >= 0) {
      this.cycleT += dt;
      const a = gv.action;
      if (a && typeof a === 'object') {
        if (this.cycleT >= CYCLE.delay) {
          this.cycleT = -1;
          this.start(this.compileOnce(a), 1, 1);
        }
      } else {
        const t = (this.cycleT - CYCLE.delay) / (a ? CYCLE[a] : CYCLE.bolt);
        if (t >= 1) this.cycleT = -1;
        else if (t > 0) {
          const k = Math.sin(t * Math.PI);
          if (a === 'pump') hand.z -= (3 / 16) * k;
          else if (a === 'lever') rock = k;
          else if (a === 'hammer') cant = k;
          else roll = 0.5 * k;
        }
      }
    }
    this.gunHand2.position.copy(hand);
    // The support forearm follows its hand.
    const moved = _fb.subVectors(hand, pts.grip2).multiplyScalar(S).applyQuaternion(r.itemRot);
    r.grip2.add(moved);
    r.arm2Offset.add(moved);
    // Tipped to the side to show the magazine going in (less when aiming).
    const k = tip * (1 - 0.5 * gv.aim);
    if (k > 0 || roll > 0) {
      const q = new Quat().setFromAxisAngle(r.axis, (0.55 * k + roll) * this.side);
      q.multiply(new Quat().setFromAxisAngle(X, 0.28 * k + jolt * 0.05));
      r.itemRot.premultiply(q);
      r.grip2.applyQuaternion(q);
      r.arm2Offset.applyQuaternion(q);
      r.grip.add(_fc.set(-0.02 * this.side, -0.05, 0.03).multiplyScalar(k));
    }
    if (rock > 0) {
      // Swung down and back: the gun rocks muzzle up (about its own right, its -x) on the support
      // hand, which stays put, the grip and the firing hand round it dropping.
      const q = _qa.setFromAxisAngle(_v.set(-1, 0, 0).applyQuaternion(r.itemRot), 0.2 * rock);
      const shift = _fc.copy(r.grip2).sub(_s.copy(r.grip2).applyQuaternion(q));
      r.grip.add(shift);
      r.grip2.sub(shift);
      r.arm2Offset.sub(shift);
      r.itemRot.premultiply(q);
      r.axis.applyQuaternion(q);
    }
    if (cant > 0) {
      // The thumb back: the gun canted in (its top toward the middle) and tipped up a little.
      const q = _qa.setFromAxisAngle(r.axis, -0.32 * cant * this.side).multiply(_qb.setFromAxisAngle(X, 0.1 * cant));
      r.itemRot.premultiply(q);
      r.grip2.applyQuaternion(q);
      r.arm2Offset.applyQuaternion(q);
      r.axis.applyQuaternion(q);
    }
  }

  /** After the hand is placed: recoil springs, the muzzle flash, hiding it all behind a scope. */
  private gunAfter(dt: number, gv: GunView | undefined) {
    const rc = this.recoil;
    rc.vz += (-rc.z * 420 - rc.vz * 26) * dt;
    rc.z += rc.vz * dt;
    rc.vr += (-rc.r * 300 - rc.vr * 22) * dt;
    rc.r += rc.vr * dt;
    rc.vroll += (-rc.roll * 300 - rc.vroll * 22) * dt;
    rc.roll += rc.vroll * dt;
    this.hand.position.z += rc.z * this.gunPose.kick;
    this.hand.position.y += rc.r * 0.01;
    this.hand.quaternion.premultiply(_qa.setFromEuler(new Euler(rc.r * this.gunPose.rise * DEG, 0, rc.roll * DEG * 4)));
    this.flashT = Math.max(0, this.flashT - dt);
    this.flash.visible = this.flashT > 0;
    if (this.flash.visible) this.flash.scale.setScalar((0.34 + Math.random() * 0.12) / Math.max(0.1, this.rest.itemScale));
    // Through a telescopic sight, the gun is out of the way.
    this.root.visible = this.apiVisible && !(gv?.sight === 'scope' && gv.aim > 0.9);
    this.gunHands.visible = !!this.skin && !this.armLook;
    this.gunHand2.visible = this.supportShown > 0;
    // The view's own lens narrows a little when aiming, so the sights fill more of it.
    const fov = 70 - 4 * (gv?.aim ?? 0);
    const cam = this.client.view.camera;
    if (Math.abs(cam.fov - fov) > 0.01) cam.fov = fov;
  }

  private update(rawDt: number, gun: GunView | undefined) {
    const me = this.client.me;
    const cam = this.client.view.camera;
    const dt = rawDt * this.timeScale;
    this.time += dt;
    if (this.styleName !== 'gun') {
      this.root.visible = this.apiVisible;
      if (cam.fov !== 70) cam.fov = 70;
    }
    const l = this.side;

    // Minecraft's hand height: dips to swap items, and after each hit as the attack recharges.
    // (The melee kit's word on the swing's readiness: `me.items.melee`; full without one.)
    const strength = (me.items.melee as MeleeOwn | undefined)?.strength ?? 1;
    const target = this.pending ? 0 : Math.max(0, Math.min(1, strength)) ** 3;
    this.height += MathUtils.clamp(target - this.height, -8 * dt, 8 * dt);
    if (this.pending && this.height < 0.1) {
      this.apply(this.pending);
      this.pending = null;
      if (this.queued) this.play(this.queued);
      this.queued = null;
    }
    this.downT = MathUtils.clamp(this.downT + (me.dead ? dt : -dt) / 0.4, 0, 1);
    const down = this.downT * this.downT * (3 - 2 * this.downT);
    this.drop = (1 - this.height) * 0.6 + down * 0.8;

    // Rest pose: Minecraft's arm holding the item; a bow swings into Java's aiming pose as it's drawn.
    const r = this.rest;
    this.supportShown = 1;
    const bow = this.styleName === 'bow';
    this.drawBlend = MathUtils.clamp(this.drawBlend + (this.draw > 0 && bow ? dt : -dt) / 0.12, 0, 1);
    if (bow) {
      bowRest(l, this.drop, false, 0, this.grid, r);
      if (this.drawBlend > 0) {
        bowRest(l, this.drop, true, Math.min(1, this.draw), this.grid, this.restDrawn);
        blendRest(r, this.restDrawn, this.drawBlend * this.drawBlend * (3 - 2 * this.drawBlend));
      }
    } else if (this.styleName === 'gun' && this.gunPts && gun) {
      this.lastGun = gun;
      gunRest(this.gunPts, this.gunPose, this.hold, l, this.drop, gun, r);
      if (this.humanoid) this.restShoulders(r);
      this.gunMotion(dt, gun, r);
    } else if (this.styleName === 'polearm' && this.style) {
      polearmRest(this.style, this.hold.model, this.grid, l, this.drop, r);
    } else if (this.hold.model && this.style && this.styleName && MODEL_GRIPS[this.styleName]) {
      modelRest(MODEL_GRIPS[this.styleName]!, this.hold, this.hold.model, l, this.drop, r);
    } else {
      attachedRest(this.style, this.hold.model, this.grid, l, this.drop, r);
    }

    // Animation (turn about a pivot, shift, turn the item), cross-faded from the previous one.
    const m = this.motion;
    m.rot.identity();
    m.wrist.identity();
    m.offset.set(0, 0, 0);
    m.pivot.copy(r.grip);
    // A pose held (`pose`), eased in and out; an animation playing takes over from it.
    this.stanceW = MathUtils.clamp(this.stanceW + (this.stanceOn ? dt : -dt) * this.stanceRate, 0, 1);
    if (this.stance && this.stanceW > 0) {
      const w = this.stanceW * this.stanceW * (3 - 2 * this.stanceW);
      this.stance.sample(1, m, { side: l, power: 1, grip: r.grip, drop: this.drop, axis: r.axis });
      m.rot.copy(_qa.identity().slerp(m.rot, w));
      m.wrist.copy(_qb.identity().slerp(m.wrist, w));
      m.offset.multiplyScalar(w);
    }
    this.eatW = MathUtils.clamp(this.eatW + (this.eatOn ? dt / 0.12 : -dt / 0.15), 0, 1);
    this.eatT = this.eatOn ? this.eatT + dt : 0;
    if (this.eatW > 0) {
      const w = this.eatW * this.eatW * (3 - 2 * this.eatW);
      eatPose(this.eatT, m, { side: l, power: 1, grip: r.grip, drop: this.drop, axis: r.axis });
      m.rot.copy(_qa.identity().slerp(m.rot, w));
      m.offset.multiplyScalar(w);
      m.pivot.lerp(r.grip, 1 - w);
      // (Anything played meanwhile, a swing, plays over it.)
    }
    if (this.playing) {
      const p = this.playing;
      p.t += (dt * p.speed) / p.anim.duration;
      if (p.t >= 1) this.playing = null;
      else p.anim.sample(p.t, m, { side: l, power: p.power, grip: r.grip, drop: this.drop, axis: r.axis });
    }
    const hp = this.hand.position.copy(r.grip).sub(m.pivot).applyQuaternion(m.rot).add(m.pivot).add(m.offset);
    this.hand.quaternion.copy(m.rot);
    if (this.fadeT < 1) {
      this.fadeT = Math.min(1, this.fadeT + dt / 0.06);
      const k = 1 - this.fadeT;
      hp.lerp(this.fadeFrom.pos, k);
      this.hand.quaternion.slerp(this.fadeFrom.rot, k);
      m.wrist.slerp(this.fadeFrom.wrist, k);
    }

    // Item: its fist point on the hand, turned by the wrist.
    if (this.held.kind !== 'empty') {
      const node = this.held.item.node;
      const q = this.tmpQ.copy(m.wrist).multiply(r.itemRot);
      node.quaternion.copy(q);
      node.scale.setScalar(r.itemScale);
      node.position.copy(r.gripLocal).multiplyScalar(-r.itemScale).applyQuaternion(q).add(r.itemOffset);
    }
    if (this.arm) {
      this.arm.quaternion.copy(r.armRot);
      this.arm.position.copy(r.armOffset);
      this.arm.scale.set(r.armScale, r.armScale * r.armStretch, r.armScale);
    }
    if (this.arm2) {
      this.arm2.visible = r.twoHanded && !!this.skin && !this.humanoid && this.supportShown > 0;
      if (r.twoHanded) {
        this.arm2.quaternion.copy(r.arm2Rot);
        this.arm2.position.copy(r.arm2Offset);
        this.arm2.scale.set(r.armScale, r.armScale * r.armStretch, r.armScale);
      }
    }
    // During an animation, forearms turn toward where their elbows were at rest (3D models).
    if (this.hold.model && (this.playing || this.fadeT < 1 || this.stanceW > 0) && this.held.kind !== 'empty' && this.styleName !== 'gun') this.reach(r);
    if (this.styleName === 'gun' && this.gunPts) this.gunAfter(dt, gun);
    // A humanoid's own arms, last: a bent arm reaches from where the hand now is to its shoulder.
    if (this.humanoid) this.placeHumanoid(r, m);

    // Procedural motion: breathing, walk bob, look sway, landing dip, recoil.
    const steady = this.styleName === 'gun' ? 1 - 0.85 * (gun?.aim ?? 0) : 1;
    const breathe = Math.sin(this.time * 1.7) * steady;
    const bob = me.bob.amount * steady * (this.styleName === 'gun' ? 1.25 : 1);
    const phase = me.bob.phase;
    if (Number.isNaN(this.lastYaw)) {
      this.lastYaw = me.look.yaw;
      this.lastPitch = me.look.pitch;
    }
    let dyaw = me.look.yaw - this.lastYaw;
    dyaw = Math.atan2(Math.sin(dyaw), Math.cos(dyaw));
    const dpitch = me.look.pitch - this.lastPitch;
    this.lastYaw = me.look.yaw;
    this.lastPitch = me.look.pitch;
    if (rawDt > 0) {
      const tx = MathUtils.clamp((-dyaw / rawDt) * 0.015 * steady, -0.07, 0.07);
      const ty = MathUtils.clamp((-dpitch / rawDt) * 0.015 * steady, -0.06, 0.06);
      const k = Math.min(1, rawDt * 12);
      this.sway.x += (tx - this.sway.x) * k;
      this.sway.y += (ty - this.sway.y) * k;
    }
    this.dipVel += (-this.dip * 160 - this.dipVel * 16) * dt;
    this.dip += this.dipVel * dt;
    this.kickVel += (-this.kickA * 200 - this.kickVel * 18) * dt;
    this.kickA += this.kickVel * dt;
    const shake = this.styleName === 'bow' && this.draw >= 1 ? Math.sin(this.time * 55) * 0.003 : 0;
    this.root.position.set(
      Math.cos(phase) * 0.024 * bob + shake,
      -Math.abs(Math.sin(phase)) * 0.03 * bob + breathe * 0.004 + this.dip * 0.1 + this.kickA * 0.02,
      this.kickA * 0.05,
    );
    pyr(this.sway.y + this.dip * 0.2 + this.kickA * 0.15, this.sway.x, this.sway.x * 0.5 + Math.sin(phase) * 0.02 * bob, this.root.quaternion);
  }
}

type ViewArmsSkin = Client['view']['arms']['skin'];
