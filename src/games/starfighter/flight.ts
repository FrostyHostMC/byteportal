import { math, type VehicleDefinition } from '@platform';
import { angleDiff, forwardOf, headingTo, moveBody, orientationOf, shipGeometry, steerBody, type Body } from './craft';
import { ARENA } from './layout';
import { voxwing } from './ships';

export const CRUISE = 44;
export const BOOST = 82;
export const BRAKE = 22;

/** The Vox-wing's shape (its hull points, for collisions), from its design: the same on every screen. */
export const VOXWING = shipGeometry(voxwing());

/**
 * A player's Vox-wing as data: what its step reads and writes. It crosses to the pilot's screen as
 * is, so it's plain numbers.
 */
export interface ShipState {
  x: number;
  y: number;
  z: number;
  yaw: number;
  pitch: number;
  bank: number;
  spin: number;
  speed: number;
  /** Knock-back velocity. */
  kx: number;
  ky: number;
  kz: number;
  /** The virtual stick: the mouse pushes it, it springs back to centre. */
  sx: number;
  sy: number;
  /** Boost fuel, 0..1. */
  boost: number;
  /** -1 braking, 0 cruising, 1 boosting. */
  throttle: number;
  /** A barrel roll: which way (0: none) and how far round (radians). */
  rollDir: number;
  roll: number;
  /** The hardest thing it hit since the game last looked (0: nothing), where, and whether it was the sea. */
  hit: number;
  hx: number;
  hy: number;
  hz: number;
  water: boolean;
}

export function freshShip(at: { x: number; y: number; z: number }, yaw: number): ShipState {
  return { x: at.x, y: at.y, z: at.z, yaw, pitch: 0.06, bank: 0, spin: 0, speed: CRUISE, kx: 0, ky: 0, kz: 0, sx: 0, sy: 0, boost: 1, throttle: 0, rollDir: 0, roll: 0, hit: 0, hx: 0, hy: 0, hz: 0, water: false };
}

/** A state as a `Body` to fly (and back). */
const body: Body = { pos: new math.Vector3(), yaw: 0, pitch: 0, bank: 0, spin: 0, speed: 0, knock: new math.Vector3() };

export function toBody(s: ShipState, b: Body = body): Body {
  b.pos.set(s.x, s.y, s.z);
  b.yaw = s.yaw;
  b.pitch = s.pitch;
  b.bank = s.bank;
  b.spin = s.spin;
  b.speed = s.speed;
  b.knock.set(s.kx, s.ky, s.kz);
  return b;
}

export function fromBody(b: Body, s: ShipState) {
  s.x = b.pos.x;
  s.y = b.pos.y;
  s.z = b.pos.z;
  s.yaw = b.yaw;
  s.pitch = b.pitch;
  s.bank = b.bank;
  s.spin = b.spin;
  s.speed = b.speed;
  s.kx = b.knock.x;
  s.ky = b.knock.y;
  s.kz = b.knock.z;
}

const _v = new math.Vector3();
const _w = new math.Vector3();
const _q = new math.Quaternion();

/**
 * The Vox-wing: mouse steers (a virtual stick that re-centres), A/D bank, W / Shift boost, S brake,
 * Q / E barrel roll. It flies the same on the host and on the pilot's screen; the guns, damage
 * and sounds are the game's (`Pilot`), reading the state.
 */
export const voxwingVehicle: VehicleDefinition<ShipState> = {
  step(s, c, dt, world) {
    // Virtual stick.
    s.sx = math.MathUtils.clamp(s.sx + c.mouseX * 0.0045, -1, 1);
    s.sy = math.MathUtils.clamp(s.sy + c.mouseY * 0.0045, -1, 1);
    const spring = Math.exp(-dt * 3.2);
    s.sx *= spring;
    s.sy *= spring;

    // Throttle.
    const boosting = (c.isDown('KeyW') || c.isDown('ShiftLeft')) && s.boost > 0.02;
    const braking = !boosting && (c.isDown('KeyS') || c.isDown('ControlLeft'));
    s.throttle = boosting ? 1 : braking ? -1 : 0;
    const target = boosting ? BOOST : braking ? BRAKE : CRUISE;
    s.speed += (target - s.speed) * Math.min(1, dt * (boosting ? 2.2 : 1.6));
    s.boost = math.MathUtils.clamp(s.boost + (boosting ? -0.32 : 0.14) * dt, 0, 1);

    // Barrel roll on Q / E: a sidestep, and lasers glance off (the game checks `rollDir`).
    if (s.rollDir === 0 && (c.pressed('KeyQ') || c.pressed('KeyE'))) {
      s.rollDir = c.pressed('KeyQ') ? 1 : -1;
      s.roll = 0;
    }
    let strafe = 0;
    if (s.rollDir !== 0) {
      s.roll += dt * Math.PI * 2 * 1.9;
      s.spin = s.rollDir * s.roll;
      strafe = -s.rollDir * 14 * Math.sin(Math.min(s.roll, Math.PI * 2) / 2);
      if (s.roll >= Math.PI * 2) {
        s.rollDir = 0;
        s.spin = 0;
      }
    }

    const b = toBody(s);
    const bankKeys = (c.isDown('KeyA') ? 1 : 0) - (c.isDown('KeyD') ? 1 : 0);
    const yawRate = -s.sx * 1.5 + bankKeys * 0.55;
    const pitchRate = -s.sy * 1.6;
    steerBody(b, dt, yawRate, pitchRate, yawRate * 0.55 + bankKeys * 0.35);
    if (strafe) b.knock.addScaledVector(_v.set(Math.cos(b.yaw), 0, -Math.sin(b.yaw)), strafe * dt * 4);
    const hit = moveBody(b, VOXWING.probes, dt, world);
    if (hit && hit.force >= s.hit) {
      s.hit = Math.max(hit.force, 0.001);
      s.hx = hit.at.x;
      s.hy = hit.at.y;
      s.hz = hit.at.z;
      s.water = hit.water;
    }

    // The edge of the battle: turned back toward it; and a soft ceiling.
    const out = Math.hypot(b.pos.x - ARENA.center.x, b.pos.z - ARENA.center.z) - ARENA.radius;
    if (out > 0) {
      const want = headingTo(b.pos, ARENA.center).yaw;
      b.yaw += angleDiff(b.yaw, want) * Math.min(1, dt * (0.6 + out * 0.02));
    }
    if (b.pos.y > ARENA.ceiling) b.pitch = Math.min(b.pitch, b.pitch - (b.pos.y - ARENA.ceiling) * 0.02 * dt * 10);
    fromBody(b, s);
  },

  pose(s, position, quaternion) {
    position.set(s.x, s.y, s.z);
    orientationOf(toBody(s), quaternion);
  },

  /** Chase camera: behind and above, lagging a little, looking past the nose; wider when boosting. */
  camera(s, cam, dt, world) {
    const b = toBody(s);
    const f = forwardOf(b, _w);
    const want = _v.copy(b.pos).addScaledVector(f, -14);
    want.y += 5.4;
    // Stay above the ground.
    const ground = world.surfaceY(want.x, want.z);
    if (ground >= 0) want.y = Math.max(want.y, ground + 2);
    cam.position.lerp(want, cam.snap ? 1 : 1 - Math.exp(-dt * 9));
    const look = _v.copy(b.pos).addScaledVector(forwardOf(b, _w), 40);
    look.y += 0.5;
    cam.target.lerp(look, cam.snap ? 1 : 1 - Math.exp(-dt * 14));
    // Lean the horizon a little with the bank.
    cam.up.set(Math.sin(b.bank) * -0.25 * Math.cos(b.yaw), 1, Math.sin(b.bank) * 0.25 * Math.sin(b.yaw)).normalize();
    const fov = s.throttle > 0 ? 90 : s.throttle < 0 ? 70 : 76;
    cam.fov = cam.snap ? fov : cam.fov + (fov - cam.fov) * Math.min(1, dt * 3);
  },
};

/** Where a pilot's reticles sit, in the ship's own space (the nose points to -z). */
export const RETICLE_NEAR = { x: 0, y: 0, z: -30 };
export const RETICLE_FAR = { x: 0, y: 0, z: -80 };

/** A point in ship space to the world, for a ship in this state. */
export function shipToWorld(s: ShipState, local: math.Vector3, out: math.Vector3): math.Vector3 {
  return out.copy(local).applyQuaternion(orientationOf(toBody(s), _q)).add(_v.set(s.x, s.y, s.z));
}
