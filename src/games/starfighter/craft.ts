import { math, type GameContext, type Prop, type PropModel, type Vec3, type VehicleWorld } from '@platform';
import { SHIP_SCALE, type ShipDesign } from './ships';

const UP = new math.Vector3(0, 1, 0);
const _q = new math.Quaternion();
const _qi = new math.Quaternion();
const _e = new math.Euler();
const _f = new math.Vector3();
const _a = new math.Vector3();
const _b = new math.Vector3();

/**
 * What flies: where, heading (about world up), pitch, bank into turns (cosmetic) and a barrel
 * roll's spin, speed along the nose, and a knock-back velocity that decays. The player's ships
 * (vehicles, stepped on the host and on the pilot's screen) and the AI's fly the same way.
 */
export interface Body {
  pos: math.Vector3;
  yaw: number;
  pitch: number;
  bank: number;
  spin: number;
  speed: number;
  knock: math.Vector3;
}

/** World orientation (cosmetic bank included). */
export function orientationOf(b: Body, out: math.Quaternion): math.Quaternion {
  _e.set(b.pitch, b.yaw, b.bank + b.spin, 'YXZ');
  return out.setFromEuler(_e);
}

/** Where the nose points (no bank). */
export function forwardOf(b: { yaw: number; pitch: number }, out: math.Vector3): math.Vector3 {
  const cp = Math.cos(b.pitch);
  return out.set(-Math.sin(b.yaw) * cp, Math.sin(b.pitch), -Math.cos(b.yaw) * cp);
}

/** Turn at these heading / pitch rates (rad/s), easing the bank toward `targetBank`. */
export function steerBody(b: Body, dt: number, yawRate: number, pitchRate: number, targetBank: number) {
  b.yaw += yawRate * dt;
  b.pitch = math.MathUtils.clamp(b.pitch + pitchRate * dt, -1.35, 1.35);
  b.bank += (targetBank - b.bank) * Math.min(1, dt * 5);
}

/**
 * Fly one step and collide with the world: hull points (`probes`) sweep from where they were to
 * where they are going. On contact the ship stops at the surface, bounces and slides off it (the
 * heading is reflected, gently for glancing blows), loses speed, and gets knocked back.
 */
export function moveBody(b: Body, probes: math.Vector3[], dt: number, w: VehicleWorld): Impact | null {
  const q = orientationOf(b, _q);
  const step = forwardOf(b, _f).multiplyScalar(b.speed * dt).addScaledVector(b.knock, dt);
  b.knock.multiplyScalar(Math.exp(-dt * 4));
  let hit: Impact | null = null;
  let best = 1;
  for (const p of probes) {
    const from = _a.copy(p).applyQuaternion(q).add(b.pos);
    const len = step.length();
    if (len > 1e-6) {
      const r = w.raycast(from, step, len + 0.3);
      if (r) {
        // Fraction of the step before touching (voxel entry along the ray).
        const d = Math.hypot(r.x + 0.5 - from.x, r.y + 0.5 - from.y, r.z + 0.5 - from.z) - 0.7;
        const t = math.MathUtils.clamp(d / len, 0, 1);
        if (t < best || !hit) {
          best = t;
          hit = { at: from.clone().addScaledVector(step, t), normal: new math.Vector3(r.normal.x, r.normal.y, r.normal.z), force: 0, water: false };
        }
      }
    }
    // The sea: skimming below its surface counts as hitting it.
    const to = _b.copy(from).add(step);
    if (!hit && to.y < w.seaLevel + 1.4 && w.blockName(w.getBlock(to.x, to.y, to.z)) === 'water') {
      best = 0;
      hit = { at: to.clone(), normal: new math.Vector3(0, 1, 0), force: 0, water: true };
    }
  }
  if (!hit) {
    b.pos.add(step);
    return null;
  }
  const n = hit.normal;
  if (n.lengthSq() < 0.5) n.set(0, 1, 0); // started inside a block: push up
  // Move up to the surface, then out of it a little.
  b.pos.addScaledVector(step, best).addScaledVector(n, 0.25);
  const f = forwardOf(b, _f);
  const into = -f.dot(n); // 1 = head-on
  hit.force = Math.max(0, into);
  if (into > 0) {
    const slide = f.clone().addScaledVector(n, into);
    if (slide.length() > 0.45 || Math.abs(n.y) > 0.7) {
      // Glancing, or the ground / sea: slide along the surface, angled a little away from it.
      if (slide.length() < 1e-3) slide.set(-Math.sin(b.yaw), 0, -Math.cos(b.yaw));
      slide.normalize().addScaledVector(n, 0.25 + 0.25 * into).normalize();
      // Turn with the surface, but never spin round (a near-vertical slide keeps the heading).
      if (Math.hypot(slide.x, slide.z) > 0.3) {
        const yaw = Math.atan2(-slide.x, -slide.z);
        if (Math.abs(angleDiff(b.yaw, yaw)) < 1.75) b.yaw = yaw;
      }
      b.pitch = math.MathUtils.clamp(Math.asin(math.MathUtils.clamp(slide.y, -1, 1)), -1.35, 1.35);
    } else {
      // Nose into a wall: keep the heading and pull up; the knock-back carries you off it.
      b.pitch = Math.max(b.pitch, 0.7);
    }
    b.speed *= 1 - 0.5 * into;
  }
  b.knock.addScaledVector(n, 5 + 14 * hit.force);
  return hit;
}

/** Are any of `a`'s hull points (plus its centre) inside `b`'s box (shrunk a little)? */
function pointsInside(a: Craft, b: Craft): boolean {
  const qa = a.orientation(new math.Quaternion());
  const inv = _qi.copy(b.orientation(_q)).invert();
  const box = b.type.box;
  const shrink = 0.85;
  for (const p of [...a.type.probes, new math.Vector3()]) {
    const local = _a.copy(p).applyQuaternion(qa).add(a.pos).sub(b.pos).applyQuaternion(inv);
    if (
      local.x > box.min.x * shrink && local.x < box.max.x * shrink &&
      local.y > box.min.y * shrink && local.y < box.max.y * shrink &&
      local.z > box.min.z * shrink && local.z < box.max.z * shrink
    )
      return true;
  }
  return false;
}

/** A ship's shape in world units, from its design alone (the pilot's screen needs it too). */
export interface ShipGeometry {
  design: ShipDesign;
  /** Laser muzzles and engine points in ship space (world units). */
  guns: math.Vector3[];
  engines: math.Vector3[];
  radius: number;
  /** The hull's box in ship space (world units), from the blocks actually built. */
  box: math.Box3;
  /** Points on the hull checked against the world: nose, tail, wingtips, top, bottom. */
  probes: math.Vector3[];
}

/** A built ship type: its shape and its meshed model. */
export interface ShipType extends ShipGeometry {
  model: PropModel;
}

export function shipType(game: GameContext, design: ShipDesign): ShipType {
  return { ...shipGeometry(design), model: game.props.model(design.blueprint, { scale: SHIP_SCALE }) };
}

export function shipGeometry(design: ShipDesign): ShipGeometry {
  const s = SHIP_SCALE;
  const box = new math.Box3();
  design.blueprint.forEach((x, y, z) => {
    box.expandByPoint(new math.Vector3(x * s, y * s, z * s));
    box.expandByPoint(new math.Vector3((x + 1) * s, (y + 1) * s, (z + 1) * s));
  });
  const c = box.getCenter(new math.Vector3());
  const { min, max } = box;
  // Slightly inside the extremes, so a probe sits on the hull rather than beside it.
  const k = 0.9;
  const probes = [
    new math.Vector3(c.x, c.y, min.z * k),
    new math.Vector3(c.x, c.y, max.z * k),
    new math.Vector3(min.x * k, c.y, c.z),
    new math.Vector3(max.x * k, c.y, c.z),
    new math.Vector3(c.x, max.y * k, c.z),
    new math.Vector3(c.x, min.y * k, c.z),
  ];
  return {
    design,
    guns: design.guns.map((g) => new math.Vector3(g.x * s, g.y * s, g.z * s)),
    engines: design.engines.map((g) => new math.Vector3(g.x * s, g.y * s, g.z * s)),
    radius: design.radius * s,
    box,
    probes,
  };
}

/** A contact from `Craft.move`: where, which way the surface faces, and how head-on (0..1). */
export interface Impact {
  at: math.Vector3;
  normal: math.Vector3;
  force: number;
  water: boolean;
}

/**
 * A ship in the battle, on the host: arcade flight (see `Body`), its model and engine flames, hit
 * points. The AI's fighters fly themselves with it; a player's is their vehicle's, kept in step
 * with its state.
 */
export class Craft implements Body {
  readonly pos = new math.Vector3();
  yaw = 0;
  pitch = 0;
  bank = 0;
  /** Extra roll from a barrel roll, radians. */
  spin = 0;
  speed = 40;
  hp: number;
  readonly prop: Prop;
  private flames: Prop[] = [];
  /** Seconds of "just hit" (for AI evasion and HUD). */
  hurt = 0;
  alive = true;
  /** Knock-back velocity from collisions (decays). */
  readonly knock = new math.Vector3();

  constructor(
    private game: GameContext,
    readonly type: ShipType,
    hp: number,
    flame: string,
  ) {
    this.hp = hp;
    this.prop = game.props.spawn(type.model);
    // Flames ride on the ship, pointing backward (+z in ship space), wavering on their own.
    for (const e of type.engines) {
      const fl = game.props.bolt({ color: flame, length: 1, width: 0.5, intensity: 3, flicker: 0.22 });
      fl.attach(this.prop);
      fl.position.copy(e);
      fl.quaternion.setFromAxisAngle(UP, Math.PI);
      this.flames.push(fl);
    }
  }

  get radius(): number {
    return this.type.radius;
  }

  /** World orientation (cosmetic bank included). */
  orientation(out: math.Quaternion): math.Quaternion {
    return orientationOf(this, out);
  }

  /** Where the nose points (no bank). */
  forward(out: math.Vector3): math.Vector3 {
    return forwardOf(this, out);
  }

  /** A point in ship space (world units) to world space. */
  toWorld(local: math.Vector3, out: math.Vector3): math.Vector3 {
    return out.copy(local).applyQuaternion(this.orientation(_q)).add(this.pos);
  }

  /** Turn toward the given heading / pitch rates (rad/s) and fly (no collision; see `move`). */
  fly(dt: number, yawRate: number, pitchRate: number, targetBank: number) {
    this.steer(dt, yawRate, pitchRate, targetBank);
    const f = this.forward(new math.Vector3());
    this.pos.addScaledVector(f, this.speed * dt);
  }

  steer(dt: number, yawRate: number, pitchRate: number, targetBank: number) {
    steerBody(this, dt, yawRate, pitchRate, targetBank);
  }

  /** Fly one step, colliding with the world (see `moveBody`). */
  move(dt: number): Impact | null {
    return moveBody(this, this.type.probes, dt, this.game.world);
  }

  /** Oriented-box overlap with another craft (either's hull points inside the other's box). */
  touches(o: Craft): boolean {
    const r = this.radius + o.radius;
    if (this.pos.distanceToSquared(o.pos) > r * r) return false;
    return pointsInside(this, o) || pointsInside(o, this);
  }

  /**
   * The model to the current state (`place`: a player's is placed by their vehicle), and the
   * flames sized by the throttle (in steps, so a steady throttle sends nothing).
   */
  sync(throttle: number, place = true) {
    if (place) {
      this.prop.position.copy(this.pos);
      this.orientation(this.prop.quaternion);
    }
    const scale = Math.round((0.6 + throttle * 1.2) * 10) / 10;
    for (const fl of this.flames) fl.scale = scale;
  }

  remove() {
    this.prop.remove();
    for (const f of this.flames) f.remove();
    this.alive = false;
  }
}

/** Angle between a craft's nose and a point (radians). */
export function aimError(c: Craft, at: Vec3): number {
  const f = c.forward(new math.Vector3());
  const d = new math.Vector3(at.x - c.pos.x, at.y - c.pos.y, at.z - c.pos.z).normalize();
  return Math.acos(math.MathUtils.clamp(f.dot(d), -1, 1));
}

/** Heading and pitch that point from `from` toward `to`. */
export function headingTo(from: Vec3, to: Vec3): { yaw: number; pitch: number } {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const dz = to.z - from.z;
  return { yaw: Math.atan2(-dx, -dz), pitch: Math.atan2(dy, Math.hypot(dx, dz)) };
}

/** Shortest signed angle a -> b. */
export function angleDiff(a: number, b: number): number {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return d;
}
