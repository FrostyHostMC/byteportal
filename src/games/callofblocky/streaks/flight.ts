import { math, type VehicleControls, type VehicleDefinition } from '@platform';

/**
 * How the killstreaks you steer fly (`shared.ts` lists them as the game's `vehicles`): the
 * Hellstorm missile and the attack chopper. Each is stepped on the server for everyone and, ahead
 * of it, on its pilot's own screen, so the controls answer at once however far away the server
 * is: the steps are pure (the state, the controls and the world in, the state changed). What they
 * do to anyone (the blast, the chopper's rounds) is the server's (`streaks/index.ts`), reading
 * the state. A bot flies the same way, the server stepping it with controls of its own.
 *
 * The Hellstorm is steered from where the pilot stands (`drive(..., { remote: true })`): their
 * body stays on the ground, frozen, and can be shot. The chopper's pilot is up in it (`drive`):
 * off the ground until it's over.
 */

const _e = new math.Euler();
const _v = new math.Vector3();

/** Where yaw and pitch point (yaw 0 looks toward -z, like a player's). */
export function forwardOf(yaw: number, pitch: number, out = new math.Vector3()): math.Vector3 {
  const cp = Math.cos(pitch);
  return out.set(-Math.sin(yaw) * cp, Math.sin(pitch), -Math.cos(yaw) * cp);
}

/** The camera's up for a view along yaw and pitch (never along the view, even straight down). */
function upOf(yaw: number, pitch: number, out: math.Vector3): math.Vector3 {
  return forwardOf(yaw, pitch + Math.PI / 2, out);
}

/** The shortest turn from angle `a` to `b` (radians, -PI..PI). */
export function turn(a: number, b: number): number {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return d;
}

// -------------------------------------------------------------------------------------------------
// The Hellstorm: from high over the map it falls toward it on its own; the mouse steers it and a
// click (or Space) fires its booster. It goes off on the first thing it meets.
// -------------------------------------------------------------------------------------------------

export const MISSILE = {
  /** Blocks a second, falling; boosted. */
  speed: 17,
  boost: 58,
  /** Radians a pixel of mouse, and while boosting (stiffer). */
  steer: 0.0021,
  steerBoosted: 0.0008,
  /** How steeply it may point: never climbing, never quite straight down (the camera's up stays sane). */
  minPitch: -1.48,
  maxPitch: -0.32,
  /** Seconds before it goes off in the air, whatever. */
  life: 14,
  /** Field of view, and boosting. */
  fov: 58,
  fovBoost: 76,
} as const;

export interface MissileState {
  x: number;
  y: number;
  z: number;
  yaw: number;
  pitch: number;
  speed: number;
  /** The booster has fired (1). */
  boost: number;
  /** Seconds in the air. */
  t: number;
  /** It hit something, or its time ran out (1): where it is now is where it goes off. */
  hit: number;
  /** It goes off below this height whatever it meets (the map's floor, less a little). */
  floor: number;
}

export const missileVehicle: VehicleDefinition<MissileState> = {
  step(s, c, dt, w) {
    if (s.hit) return;
    s.t += dt;
    if (!s.boost && (c.buttonPressed(0) || c.pressed('Space'))) s.boost = 1;
    const k = s.boost ? MISSILE.steerBoosted : MISSILE.steer;
    s.yaw -= c.mouseX * k;
    s.pitch = math.MathUtils.clamp(s.pitch - c.mouseY * k, MISSILE.minPitch, MISSILE.maxPitch);
    const target = s.boost ? MISSILE.boost : MISSILE.speed;
    s.speed += (target - s.speed) * Math.min(1, dt * (s.boost ? 2.5 : 1.5));
    const dir = forwardOf(s.yaw, s.pitch, _v);
    const dist = s.speed * dt;
    const hit = w.raycast({ x: s.x, y: s.y, z: s.z }, { x: dir.x, y: dir.y, z: dir.z }, dist + 0.4);
    if (hit) {
      s.x = hit.point.x - dir.x * 0.2;
      s.y = hit.point.y - dir.y * 0.2;
      s.z = hit.point.z - dir.z * 0.2;
      s.hit = 1;
      return;
    }
    s.x += dir.x * dist;
    s.y += dir.y * dist;
    s.z += dir.z * dist;
    if (s.y <= s.floor || s.t >= MISSILE.life) s.hit = 1;
  },
  pose(s, position, quaternion) {
    position.set(s.x, s.y, s.z);
    quaternion.setFromEuler(_e.set(s.pitch, s.yaw, 0, 'YXZ'));
  },
  camera(s, cam, dt) {
    // Just ahead of its nose, looking where it's going: the map rushing up.
    const dir = forwardOf(s.yaw, s.pitch, _v);
    cam.position.set(s.x + dir.x * 1.3, s.y + dir.y * 1.3, s.z + dir.z * 1.3);
    cam.target.copy(cam.position).add(dir);
    upOf(s.yaw, s.pitch, cam.up);
    const fov = s.boost ? MISSILE.fovBoost : MISSILE.fov;
    cam.fov = cam.snap ? fov : cam.fov + (fov - cam.fov) * Math.min(1, dt * 4);
  },
};

/** A Hellstorm's first state: at `from`, pointing at `at`. */
export function launchMissile(from: { x: number; y: number; z: number }, at: { x: number; y: number; z: number }, floor: number): MissileState {
  const dx = at.x - from.x;
  const dy = at.y - from.y;
  const dz = at.z - from.z;
  const yaw = Math.atan2(-dx, -dz);
  const pitch = math.MathUtils.clamp(Math.atan2(dy, Math.hypot(dx, dz)), MISSILE.minPitch, MISSILE.maxPitch);
  return { x: from.x, y: from.y, z: from.z, yaw, pitch, speed: MISSILE.speed, boost: 0, t: 0, hit: 0, floor };
}

// -------------------------------------------------------------------------------------------------
// The attack chopper: the pilot flies it over the map (W A S D along where they aim, Space up, C or
// Ctrl down) and aims its chin gun with the mouse; the left button fires, the right zooms in to the
// gun's sight. The camera rides behind and above it, looking where the gun aims.
// -------------------------------------------------------------------------------------------------

export const CHOPPER = {
  /** Blocks a second across, and up or down; how quickly it gets there. */
  speed: 13,
  climb: 7,
  accel: 1.8,
  /** Radians a pixel of mouse; zoomed in. */
  aim: 0.0019,
  aimZoomed: 0.0008,
  /** How far down (and a little up) the gun aims. */
  minPitch: -1.45,
  maxPitch: 0.12,
  /** Rounds a second. */
  rate: 7,
  /** Seconds it's up. */
  life: 40,
  /** The chase camera: blocks behind, and up (in the view's own up), and its field of view; zoomed in. */
  back: 12,
  lift: 3.6,
  fov: 68,
  fovZoomed: 26,
  /** How far its rounds reach. */
  range: 180,
} as const;

export interface ChopperState {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  /** Where its nose points (eases after the aim). */
  heading: number;
  /** Where the gun aims. */
  yaw: number;
  pitch: number;
  /** Looking down the gun's sight (the right button held): 1. */
  zoom: number;
  t: number;
  /** Rounds fired so far (the server fires what it hasn't), and the seconds to the next one. */
  shots: number;
  cd: number;
  /** Where it may fly: a box over the map. */
  x0: number;
  x1: number;
  y0: number;
  y1: number;
  z0: number;
  z1: number;
}

const _f = new math.Vector3();

/** The gun's sight line: the camera's place and the way it looks (the server aims each round along it). */
export function chopperView(s: ChopperState, out: { at: math.Vector3; dir: math.Vector3 }) {
  forwardOf(s.yaw, s.pitch, out.dir);
  if (s.zoom) {
    // Down the gun's sight, under the nose.
    const h = s.heading;
    out.at.set(s.x - Math.sin(h) * 3.2, s.y - 1.6, s.z - Math.cos(h) * 3.2).addScaledVector(out.dir, 0.8);
    return out;
  }
  upOf(s.yaw, s.pitch, _v);
  out.at.set(s.x, s.y, s.z).addScaledVector(out.dir, -CHOPPER.back).addScaledVector(_v, CHOPPER.lift);
  return out;
}

/** Where its gun's muzzle is (under the nose), for the rounds and their flash. */
export function chopperMuzzle(s: ChopperState, out = new math.Vector3()): math.Vector3 {
  const h = s.heading;
  return out.set(s.x - Math.sin(h) * 4.3, s.y - 1.05, s.z - Math.cos(h) * 4.3);
}

const view = { at: new math.Vector3(), dir: new math.Vector3() };

export const chopperVehicle: VehicleDefinition<ChopperState> = {
  step(s, c, dt) {
    s.t += dt;
    s.zoom = c.button(2) ? 1 : 0;
    const k = s.zoom ? CHOPPER.aimZoomed : CHOPPER.aim;
    s.yaw -= c.mouseX * k;
    s.pitch = math.MathUtils.clamp(s.pitch - c.mouseY * k, CHOPPER.minPitch, CHOPPER.maxPitch);
    // Flying along where the gun aims (flat), up and down.
    const fwd = (c.isDown('KeyW') ? 1 : 0) - (c.isDown('KeyS') ? 1 : 0);
    const side = (c.isDown('KeyD') ? 1 : 0) - (c.isDown('KeyA') ? 1 : 0);
    const rise = (c.isDown('Space') ? 1 : 0) - (c.isDown('KeyC') || c.isDown('ControlLeft') || c.isDown('ShiftLeft') ? 1 : 0);
    const n = Math.hypot(fwd, side) || 1;
    const sy = Math.sin(s.yaw);
    const cy = Math.cos(s.yaw);
    const wx = ((-sy * fwd + cy * side) / n) * CHOPPER.speed;
    const wz = ((-cy * fwd - sy * side) / n) * CHOPPER.speed;
    const a = Math.min(1, dt * CHOPPER.accel);
    s.vx += (wx - s.vx) * a;
    s.vz += (wz - s.vz) * a;
    s.vy += (rise * CHOPPER.climb - s.vy) * Math.min(1, dt * 3);
    s.x += s.vx * dt;
    s.y += s.vy * dt;
    s.z += s.vz * dt;
    // Held in its box: it stops at the edge.
    if (s.x < s.x0 || s.x > s.x1) (s.x = math.MathUtils.clamp(s.x, s.x0, s.x1)), (s.vx = 0);
    if (s.y < s.y0 || s.y > s.y1) (s.y = math.MathUtils.clamp(s.y, s.y0, s.y1)), (s.vy = 0);
    if (s.z < s.z0 || s.z > s.z1) (s.z = math.MathUtils.clamp(s.z, s.z0, s.z1)), (s.vz = 0);
    // The nose comes round after the aim.
    s.heading += turn(s.heading, s.yaw) * Math.min(1, dt * 2.2);
    // The gun: a round every so often while the button's held.
    if (c.button(0)) {
      s.cd -= dt;
      while (s.cd <= 0) {
        s.shots++;
        s.cd += 1 / CHOPPER.rate;
      }
    } else s.cd = Math.max(0, s.cd - dt);
  },
  pose(s, position, quaternion) {
    position.set(s.x, s.y, s.z);
    // Nose down into the way it's going, banked into sideways drift.
    const h = s.heading;
    const ahead = -Math.sin(h) * s.vx - Math.cos(h) * s.vz;
    const right = Math.cos(h) * s.vx - Math.sin(h) * s.vz;
    quaternion.setFromEuler(_e.set(-ahead * 0.022, h, -right * 0.03, 'YXZ'));
  },
  camera(s, cam, dt) {
    chopperView(s, view);
    cam.position.copy(view.at);
    cam.target.copy(view.at).add(view.dir);
    upOf(s.yaw, s.pitch, _f);
    cam.up.copy(_f);
    const fov = s.zoom ? CHOPPER.fovZoomed : CHOPPER.fov;
    cam.fov = cam.snap ? fov : cam.fov + (fov - cam.fov) * Math.min(1, dt * 9);
  },
};

/** A chopper's first state: at `at`, facing `yaw`, held in the box. */
export function launchChopper(at: { x: number; y: number; z: number }, yaw: number, box: { x0: number; x1: number; y0: number; y1: number; z0: number; z1: number }): ChopperState {
  return { x: at.x, y: at.y, z: at.z, vx: 0, vy: 0, vz: 0, heading: yaw, yaw, pitch: -0.55, zoom: 0, t: 0, shots: 0, cd: 0, ...box };
}

/** Controls a bot's pilot gives (the server steps a bot's streak with them): what it holds, and how far to turn this tick. */
export class PilotControls implements VehicleControls {
  readonly keys = new Set<string>();
  buttons = 0;
  clicked = 0;
  mouseX = 0;
  mouseY = 0;
  wheel = 0;
  isDown(code: string) {
    return this.keys.has(code);
  }
  pressed() {
    return false;
  }
  button(b: number) {
    return (this.buttons & (1 << b)) !== 0;
  }
  buttonPressed(b: number) {
    return (this.clicked & (1 << b)) !== 0;
  }
}

