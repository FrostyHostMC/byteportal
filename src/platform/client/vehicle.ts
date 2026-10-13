import * as THREE from 'three';
import type { VehicleCamera, VehicleDefinition, VehicleWorld } from '../api/types';
import type { PlayerInput } from '../net/protocol';
import type { PlayerFrame } from '../sim/player';
import { copyState, InputControls } from '../sim/vehicle';
import type { PropPose } from './props';

const IDENTITY = new THREE.Quaternion();

/** The camera a vehicle's `camera` works on, kept from frame to frame. */
class Cam implements VehicleCamera {
  readonly position = new THREE.Vector3();
  readonly target = new THREE.Vector3(0, 0, -1);
  readonly up = new THREE.Vector3(0, 1, 0);
  fov = 70;
  snap = true;
}

/**
 * This client's own vehicle (`player.drive`): its state, its model's pose and its camera, every
 * frame. On a game server it's predicted, as walking is: each frame's controls step it at once
 * with the vehicle's own `step` (the one the server will take), and when the server's state comes
 * back, with the last input it applied, the vehicle starts again from that and replays the rest.
 * The same code on the same blocks lands in the same place; a difference (a knock-back, another
 * ship, a block that changed) eases in instead of jumping. In a worker or this page there's no
 * lag to hide, so it follows the frames.
 */
export class VehicleView {
  private pending: { seq: number; input: PlayerInput; dt: number }[] = [];
  private def: VehicleDefinition | null = null;
  private state: object | null = null;
  name: string | null = null;
  /** Its model's prop. */
  prop: number | null = null;
  /** Shown minus predicted, fading: where the model was drawn when a correction came. */
  private offset = new THREE.Vector3();
  private turn = new THREE.Quaternion();
  private cam = new Cam();
  private pos = new THREE.Vector3();
  private quat = new THREE.Quaternion();
  private shownPose: PropPose = { p: new THREE.Vector3(), q: new THREE.Quaternion() };
  /** How far the last server frame moved the prediction (blocks): ~0 while prediction holds. */
  lastCorrection = 0;

  constructor(
    private defs: Record<string, VehicleDefinition>,
    private world: VehicleWorld,
    private predicting: boolean,
  ) {}

  get active(): boolean {
    return this.state !== null;
  }

  /** This frame's controls (numbered for the server): step at once, and let a correction fade. */
  step(input: PlayerInput, dt: number, seq: number) {
    if (!this.predicting) return;
    this.pending.push({ seq, input, dt });
    if (this.pending.length > 240) this.pending.shift();
    if (this.state && this.def) this.def.step(this.state, new InputControls(input), dt, this.world);
    const k = 1 - Math.exp(-dt * 10);
    this.offset.multiplyScalar(1 - k);
    this.turn.slerp(IDENTITY, k);
  }

  /** The newest frame's word on our player: start from the server's state and replay what it hasn't applied. */
  reconcile(me: PlayerFrame) {
    const v = me.vehicle;
    const def = v && this.defs[v.name];
    while (this.pending.length && this.pending[0].seq <= me.ack) this.pending.shift();
    if (!v || !def) {
      this.state = this.def = this.name = null;
      this.prop = null;
      return;
    }
    const was = this.state && this.name === v.name ? this.pose() : null;
    const shownP = was?.p.clone();
    const shownQ = was?.q.clone();
    this.def = def;
    this.name = v.name;
    this.prop = v.prop;
    this.state = copyState(v.state);
    if (this.predicting) for (const m of this.pending) def.step(this.state, new InputControls(m.input), m.dt, this.world);
    this.def.pose(this.state, this.pos, this.quat);
    if (!shownP || !shownQ || !this.predicting) {
      this.offset.set(0, 0, 0);
      this.turn.identity();
      if (!shownP) this.cam.snap = true;
      return;
    }
    this.lastCorrection = shownP.distanceTo(this.pos);
    if (this.lastCorrection > 12) {
      // A jump (a respawn, a teleport): take it at once.
      this.offset.set(0, 0, 0);
      this.turn.identity();
      this.cam.snap = true;
      return;
    }
    this.offset.copy(shownP).sub(this.pos);
    this.turn.copy(shownQ).multiply(this.quat.clone().invert());
  }

  /** Where its model is drawn now: predicted, with any correction still fading. */
  pose(): PropPose {
    const out = this.shownPose;
    if (!this.def || !this.state) return out;
    this.def.pose(this.state, out.p, out.q);
    out.p.add(this.offset);
    out.q.premultiply(this.turn);
    return out;
  }

  /** The vehicle's camera for this frame (null: it hasn't one, or there's no vehicle). */
  camera(dt: number): VehicleCamera | null {
    if (!this.def?.camera || !this.state) return null;
    this.def.camera(this.state, this.cam, dt, this.world);
    this.cam.snap = false;
    return this.cam;
  }
}
