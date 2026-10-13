import * as THREE from 'three';
import type { Input } from '../player/input';
import type { PlayerFrame } from '../sim/player';

const EYE = 1.62;
const SNEAK_EYE = 1.27;
const SLIDE_EYE = 0.95;

/**
 * Stepping up onto a stair or a slab lifts the body in one step (the engine's step-up, up to 0.6);
 * a rise on the ground between these is one. The eyes start where they were and spring up after
 * it (critically damped), so a flight of stairs is a smooth climb, not a jolt a step. The spring
 * stiffens with speed (`STEP_SPRING` standing, `STEP_PER_SPEED` times the walking speed), so the
 * eyes trail a climb by about the same (half a block or so) walking or sprinting, and never more
 * than `STEP_LAG`: soft enough that a climb goes up evenly, not in a surge a step.
 */
const STEP_MIN = 0.15;
const STEP_MAX = 0.65;
const STEP_SPRING = 16;
const STEP_PER_SPEED = 5;
const STEP_LAG = 1;

const smoothstep = (t: number) => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));
const clampPitch = (p: number) => Math.max(-Math.PI / 2 + 0.001, Math.min(Math.PI / 2 - 0.001, p));
/**
 * Over the shoulder, the aim converges on the first thing under the crosshair within `AIM_FAR`:
 * someone from their eyes on, and a block only from `AIM_BLOCKS` past their eyes (cover, a wall or
 * the ground right in front of them is what their own shot meets anyway: aiming at it from the
 * camera's side would swing the shot wide).
 */
const AIM_FAR = 200;
const AIM_BLOCKS = 2.5;
/**
 * A third-person camera's arm: how quickly it pulls in when something comes between it and the
 * player (fast: it mustn't show the inside of a wall for long) and lets out again once it's clear
 * (slower, so a doorway or a corner doesn't jerk it), per second; and how far apart its probes run
 * (blocks: something thinner, a post or a pole, doesn't pull it in).
 */
const ARM_IN = 9;
const ARM_OUT = 2.5;
const ARM_SPREAD = 0.28;

/**
 * The first-person camera: mouse look (the client owns it, so it feels immediate; the view goes
 * to the simulation with the controls), then following the simulation's player with smooth eye
 * height, view bobbing and the sprint / flight FOV kick. With the game's `camera.orbit`, the
 * wheel pulls it back to circle a target (third person), turned by the same mouse look.
 */
export class PlayerCamera {
  sensitivity = 1;
  baseFov = 75;
  viewBobbing = true;
  /** Aiming down the sights: the field of view is divided by this (the runtime eases it). */
  aimZoom = 1;
  private eye = EYE;
  /** How far the eyes are below where they'd be, after stepping up (<= 0), and how fast they're catching up. */
  private stepLag = 0;
  private stepSpeed = 0;
  /** Where the feet were last frame, and if on the ground (null: no frame yet). */
  private feet: { y: number; ground: boolean } | null = null;
  private fov = 75;
  /** The last view the simulation set that we've taken on. */
  viewSeq = -1;
  private euler = new THREE.Euler(0, 0, 0, 'YXZ');
  /** Third person: how far the camera is from the point it circles (0: first person), and where the wheel is taking it. */
  distance = 0;
  private zoomTo = 0;
  /** The game's orbit (`camera.orbit`): how close and far the wheel goes; null for first person only. */
  private range: { min: number; max: number } | null = null;
  private orbitSeq = -1;
  /** The point circled last (kept while zooming back in after the orbit ends). */
  private circled = new THREE.Vector3();
  /** How far the camera can go from a point along a direction before a block stops it. */
  clearance: (from: THREE.Vector3, dir: THREE.Vector3, max: number) => number = (_from, _dir, max) => max;
  /**
   * What a movement ability asks of the camera now ([roll, pitch, dip], `AbilityBody.camera`), in
   * first person: eased toward, so a tumble that stops doesn't snap the view straight.
   */
  tilt: readonly [number, number, number] | null = null;
  private tiltNow: [number, number, number] = [0, 0, 0];
  /** How far the eyes lean out sideways now (`PlayerFrame.lean`, eased between frames). */
  private leanNow = 0;
  /**
   * Where the player looks (radians; yaw 0 looks toward -z), as the mouse turns it: the camera's
   * turn, and what goes to the simulation (where they walk and face). What they shoot along is
   * `aim()`: the same, except over the shoulder.
   */
  yaw = 0;
  pitch = 0;
  /** The orbit's camera beside the point it circles, across and up the view (blocks), and whether the wheel zooms it. */
  private shoulder: [number, number] | null = null;
  private wheel = true;
  /** How far out the arm is (0..1 of the way), pulled in by what's in the way. */
  private arm = 1;
  /** Last frame's third-person rig: the eyes, the point circled and the camera's place from it in the view's own space. */
  private rig: { eye: THREE.Vector3; pivot: THREE.Vector3; local: THREE.Vector3 } | null = null;
  private aimed: { yaw: number; pitch: number; at: number; out: { yaw: number; pitch: number } } | null = null;
  private frames = 0;
  /**
   * How far along a ray the first thing is that the aim should meet (someone else's body as it's
   * drawn, or a block `blocksFrom` or more along), or null for nothing within `max`: over the
   * shoulder, the aim converges on it.
   */
  aimAt: (from: THREE.Vector3, dir: THREE.Vector3, max: number, blocksFrom: number) => number | null = () => null;

  constructor(readonly camera: THREE.PerspectiveCamera) {}

  /**
   * How much slower the view turns aiming down the sights: by as much as it magnifies (the ratio
   * of the half-angles' tangents), so a mouse movement moves the world across the screen about as
   * far zoomed in as out. A 4x scope, without it, turns the view as far as ever, across a screen
   * that shows a quarter as much.
   */
  get lookScale(): number {
    if (this.aimZoom <= 1.01) return 1;
    const half = (this.baseFov * Math.PI) / 360;
    return Math.tan(half / this.aimZoom) / Math.tan(half);
  }

  look(input: Input, active: boolean) {
    if (!active) return;
    const k = 0.0022 * this.sensitivity * this.lookScale;
    this.yaw -= input.mouseDX * k;
    this.pitch = clampPitch(this.pitch - input.mouseDY * k);
  }

  /**
   * Where a shot or a throw goes now (radians): where they look, except over the shoulder (an
   * orbit's `shoulder`), where the middle of the screen isn't along their eyes' line: then from
   * their eyes to what the middle of the screen shows (the first block or body along the camera's
   * line, at least a couple of blocks past their eyes), so what they hit is what the crosshair is
   * on. Worked out when it's asked, from the look as it is then.
   */
  aim(): { yaw: number; pitch: number } {
    const r = this.rig;
    if (!r || !this.shoulder || this.distance <= 0.5) return { yaw: this.yaw, pitch: this.pitch };
    const c = this.aimed;
    if (c && c.yaw === this.yaw && c.pitch === this.pitch && c.at === this.frames) return c.out;
    const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(this.pitch, this.yaw, 0, 'YXZ'));
    const from = r.local.clone().applyQuaternion(q).add(r.pivot);
    const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(q);
    // Along the camera's line from level with their eyes: what's between the camera and them doesn't count.
    const ahead = Math.max(0, new THREE.Vector3().subVectors(r.eye, from).dot(fwd));
    from.addScaledVector(fwd, ahead);
    const hit = this.aimAt(from, fwd, AIM_FAR, AIM_BLOCKS) ?? AIM_FAR;
    const dir = from.addScaledVector(fwd, Math.max(hit, 0.5)).sub(r.eye).normalize();
    const out = { yaw: Math.atan2(-dir.x, -dir.z), pitch: clampPitch(Math.asin(Math.max(-1, Math.min(1, dir.y)))) };
    this.aimed = { yaw: this.yaw, pitch: this.pitch, at: this.frames, out };
    return out;
  }

  /** The game's orbit, as the newest frame has it: a new one starts from its distance. */
  setOrbit(o: PlayerFrame['orbit']) {
    if (!o) {
      this.range = null;
      this.shoulder = null;
      this.wheel = true;
      this.zoomTo = 0;
      return;
    }
    this.range = { min: o.min, max: o.max };
    this.shoulder = o.shoulder ?? null;
    this.wheel = o.wheel !== false;
    if (o.seq !== this.orbitSeq) {
      this.orbitSeq = o.seq;
      this.zoomTo = o.distance;
    }
    this.zoomTo = Math.max(o.min, Math.min(o.max, this.zoomTo));
  }

  /** The wheel zooms (the game has an orbit on that the wheel moves). */
  get zooms(): boolean {
    return this.range !== null && this.wheel;
  }

  /** Out of the player's eyes: their figure shows, their first-person hand doesn't. */
  get thirdPerson(): boolean {
    return this.distance > 1.2;
  }

  /** The wheel: notches out (positive) or in, each a bigger step further out; all the way in is first person. */
  zoom(notches: number) {
    const r = this.range;
    if (!r || !notches) return;
    let d = this.zoomTo;
    for (let i = 0; i < Math.abs(notches); i++) d = notches > 0 ? Math.max(2, d * 1.3) : d < 2.6 ? 0 : d / 1.3;
    this.zoomTo = Math.max(r.min, Math.min(r.max, d));
  }

  /**
   * Where the simulation put the player; it turns us when it says so (teleports, spawning).
   * `circle` is the point an orbit goes round (the ship), if the game set one.
   */
  follow(dt: number, f: PlayerFrame, circle: THREE.Vector3 | null = null) {
    // Newer only: frames can come out of order (a server's, played back smoothly).
    if (f.view.seq > this.viewSeq) {
      this.viewSeq = f.view.seq;
      this.yaw = f.view.yaw;
      this.pitch = f.view.pitch;
    }
    this.frames++;
    const targetEye = f.sliding ? SLIDE_EYE : f.sneaking && !f.flying ? SNEAK_EYE : EYE;
    this.eye += (targetEye - this.eye) * (1 - Math.exp(-dt * (f.sliding ? 18 : 14)));
    this.stepUp(dt, f);
    // Leaning out (a peek): the eyes go sideways with the head, across the view. It's where their
    // shots start too, on this screen (from the camera) and on the host (from `eye`).
    this.leanNow += ((f.lean ?? 0) - this.leanNow) * (1 - Math.exp(-dt * 30));
    const leanX = Math.cos(this.yaw) * this.leanNow;
    const leanZ = -Math.sin(this.yaw) * this.leanNow;

    const speed = Math.hypot(f.vx, f.vz);
    const bobAmt = this.viewBobbing && f.onGround && !f.flying ? Math.min(1, speed / 4.3) : 0;
    const phase = f.bob * Math.PI * 0.9;
    const bobY = Math.abs(Math.sin(phase)) * 0.055 * bobAmt;
    const bobX = Math.cos(phase) * 0.03 * bobAmt;

    // An ability's tilt, dip and pitch kick (first person only): the view, not the aim.
    const want = this.distance > 0 ? null : this.tilt;
    const ease = 1 - Math.exp(-dt * 30);
    const t = this.tiltNow;
    for (let i = 0; i < 3; i++) t[i] += ((want?.[i] ?? 0) - t[i]) * ease;
    const kicked = clampPitch(this.pitch + t[1]);
    this.camera.position.set(f.x + leanX + Math.cos(this.yaw) * bobX, f.y + this.eye + this.stepLag + bobY - t[2], f.z + leanZ - Math.sin(this.yaw) * bobX);
    this.euler.set(kicked, this.yaw, Math.cos(phase) * 0.004 * bobAmt - t[0]);
    this.camera.quaternion.setFromEuler(this.euler);

    // Third person: back from the eyes, round the point the game's orbit circles (reached over the
    // first few blocks of zoom, so scrolling out glides from the eyes to the ship).
    this.distance += (this.zoomTo - this.distance) * (1 - Math.exp(-dt * 8));
    if (Math.abs(this.zoomTo - this.distance) < 0.01) this.distance = this.zoomTo;
    if (circle) this.circled.copy(circle);
    this.rig = null;
    if (this.distance > 0) {
      const eye = new THREE.Vector3(f.x + leanX, f.y + this.eye + this.stepLag, f.z + leanZ);
      const pivot = eye.clone().lerp(this.circled, smoothstep(this.distance / 6));
      const q = this.camera.quaternion;
      // The arm: back from the point circled, and over the shoulder (eased in over the first
      // blocks of zoom), in the view's own space.
      const k = this.shoulder ? smoothstep(this.distance / 3) : 0;
      const local = new THREE.Vector3(this.shoulder ? this.shoulder[0] * k : 0, this.shoulder ? this.shoulder[1] * k : 0, this.distance);
      const len = local.length();
      const dir = local.clone().applyQuaternion(q).divideScalar(len);
      // What's in the way, probed by five rays a little apart (the middle answer: a wall stops them
      // all, a post or a pole only one or two), and the arm pulled in fast, let out slowly.
      const right = new THREE.Vector3(1, 0, 0).applyQuaternion(q).multiplyScalar(ARM_SPREAD);
      const up = new THREE.Vector3(0, 1, 0).applyQuaternion(q).multiplyScalar(ARM_SPREAD);
      const probes = [new THREE.Vector3(), right, right.clone().negate(), up, up.clone().negate()].map((o) => this.clearance(o.add(pivot), dir, len));
      probes.sort((a, b) => a - b);
      const free = Math.max(0, Math.min(1, probes[2] / len));
      this.arm += (free - this.arm) * (1 - Math.exp(-dt * (free < this.arm ? ARM_IN : ARM_OUT)));
      this.camera.position.copy(pivot).addScaledVector(dir, len * this.arm);
      this.rig = { eye, pivot, local: local.multiplyScalar(this.arm) };
    } else this.arm = 1;

    const aiming = this.aimZoom > 1.01;
    const targetFov = (this.baseFov + (f.sprinting && !aiming ? 9 : 0) + (f.sliding ? 6 : 0) + (f.flying && speed > 12 ? 6 : 0)) / this.aimZoom;
    // Aiming snaps in quicker than the sprint kick eases.
    this.fov += (targetFov - this.fov) * (1 - Math.exp(-dt * (aiming ? 22 : 8)));
    if (Math.abs(this.camera.fov - this.fov) > 0.01) {
      this.camera.fov = this.fov;
      this.camera.updateProjectionMatrix();
    }
    this.camera.updateMatrixWorld();
  }

  /** Start from where another camera on the same view has settled (its eye height and field of view): a replay's eyes take over without a jump. */
  settleFrom(other: PlayerCamera) {
    this.eye = other.eye;
    this.stepLag = other.stepLag;
    this.stepSpeed = other.stepSpeed;
    this.fov = other.fov;
  }

  /** A step up since last frame leaves the eyes behind; they spring up after it. */
  private stepUp(dt: number, f: PlayerFrame) {
    const last = this.feet;
    this.feet = { y: f.y, ground: f.onGround && !f.flying };
    const rise = last ? f.y - last.y : 0;
    if (last?.ground && this.feet.ground && rise > STEP_MIN && rise < STEP_MAX) this.stepLag = Math.max(-STEP_LAG, this.stepLag - rise);
    if (this.stepLag === 0 && this.stepSpeed === 0) return;
    // The spring's exact motion over dt (any frame rate): x(t) = (x0 + (v0 + w x0) t) e^(-w t).
    const w = Math.max(STEP_SPRING, STEP_PER_SPEED * Math.hypot(f.vx, f.vz));
    const x0 = this.stepLag;
    const v0 = this.stepSpeed;
    const e = Math.exp(-w * dt);
    const c = v0 + w * x0;
    this.stepLag = Math.min(0, (x0 + c * dt) * e);
    this.stepSpeed = (v0 - w * c * dt) * e;
    if (Math.abs(this.stepLag) < 1e-4 && Math.abs(this.stepSpeed) < 1e-3) this.stepLag = this.stepSpeed = 0;
  }

  viewDirection(out: THREE.Vector3): THREE.Vector3 {
    return this.camera.getWorldDirection(out);
  }
}

/**
 * The world camera taken by the game's client code for a while (`client.camera.take`: a fly-over,
 * a cutscene): drawn from the pose it last gave, placed over the player's own camera each frame
 * (which goes on underneath, following them as ever). Given back (`release`), the view eases from
 * the last pose into the player's own camera over the seconds asked, wherever that has got to.
 */
export class CameraTake {
  private pose: { position: THREE.Vector3; quaternion: THREE.Quaternion; fov: number | null } | null = null;
  /** Taken now (not easing back). */
  private held = false;
  private easeTime = 0;
  private eased = 0;
  private m = new THREE.Matrix4();

  /** Taken, or easing back to the player's own camera. */
  get active(): boolean {
    return this.pose !== null;
  }

  take(position: { x: number; y: number; z: number }, target: { x: number; y: number; z: number }, fov?: number) {
    const p = new THREE.Vector3(position.x, position.y, position.z);
    const t = new THREE.Vector3(target.x, target.y, target.z);
    // (Looking straight down or up: any turn about the vertical will do.)
    if (p.distanceToSquared(t) < 1e-8) t.z -= 1;
    const q = new THREE.Quaternion().setFromRotationMatrix(this.m.lookAt(p, t, new THREE.Vector3(0, 1, 0)));
    this.pose = { position: p, quaternion: q, fov: fov ?? null };
    this.held = true;
  }

  release(ease = 1) {
    if (!this.held) return;
    this.held = false;
    this.easeTime = Math.max(0, ease);
    this.eased = 0;
    if (this.easeTime === 0) this.pose = null;
  }

  /** Over the player's own camera, placed this frame: the pose taken, or the ease back from it. */
  apply(camera: THREE.PerspectiveCamera, dt: number) {
    const pose = this.pose;
    if (!pose) return;
    const fov0 = camera.fov;
    if (this.held) {
      camera.position.copy(pose.position);
      camera.quaternion.copy(pose.quaternion);
      if (pose.fov !== null) camera.fov = pose.fov;
    } else {
      this.eased += dt;
      const k = smoothstep(this.eased / this.easeTime);
      if (k >= 1) {
        this.pose = null;
        return;
      }
      camera.position.lerpVectors(pose.position, camera.position, k);
      camera.quaternion.copy(pose.quaternion).slerp(camera.quaternion.clone(), k);
      if (pose.fov !== null) camera.fov = pose.fov + (fov0 - pose.fov) * k;
    }
    if (camera.fov !== fov0) camera.updateProjectionMatrix();
    camera.updateMatrixWorld();
  }
}
