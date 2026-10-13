import { Surf, type Tree } from './course/types';
import { BALL_SIZE, CUP_DEPTH, CUP_R, G, PIN_HEIGHT, S, mulberry } from './scale';

/**
 * A golf ball's flight, bounce and roll, worked in metres and seconds as the real thing is (a
 * 45.9 g ball, 42.7 mm across, in air of 1.225 kg/m³) and placed in the world at `S` blocks a
 * metre. Pure: the same launch over the same course comes out the same on the server (which plays
 * every shot out when it's struck, `simulate`) and on a screen (which previews where one lands).
 *
 * - **In the air**: gravity, drag, and the Magnus lift of its spin (backspin holds it up; a tilted
 *   spin axis curves it: a slice, a draw), in the wind. Spin decays as it flies. Trees stop it
 *   (their leaves swallow it and drop it; a trunk knocks it back) and so does the flagstick.
 * - **Landing**: it bounces off the ground's slope, less on soft turf and hardly at all in sand.
 *   Friction at the contact point works on its spin: a wedge's backspin checks it on a green, or
 *   spins it back; a low runner skips on.
 * - **On the ground**: it slides until its spin matches its speed, then rolls. Gravity pulls it
 *   down the slope (5/7 of it, for a rolling sphere), and the grass slows it: little on a green
 *   (about 10 on the stimpmeter), more on the fairway, a lot in the rough. It stops only where the
 *   slope can't move it.
 * - **The cup** is a real hole: over it the ball loses the ground and falls, a sphere round the
 *   rim's edge. Slow enough and it drops far enough to meet the far wall below the lip, and it's
 *   in; firmer, it catches the rim and hops out (turned away if it caught the side: a lip-out),
 *   or rattles off the flagstick; dying at the edge, it can hang there.
 */

export interface GroundAt {
  y: number;
  surf: Surf;
}

/** What the ball needs of a course. */
export interface Terrain {
  ground(x: number, z: number): GroundAt;
  slope(x: number, z: number, out?: { x: number; z: number }): { x: number; z: number };
  blockTop(x: number, z: number): number;
  treesNear(x: number, z: number): Tree[];
  inBounds(x: number, z: number): boolean;
}

/** How a ball leaves the club. */
export interface Launch {
  /** Where it's struck from (world: on the ground). */
  x: number;
  y: number;
  z: number;
  /** Ball speed (m/s), direction (yaw, 0 toward -z), launch angle up (radians). */
  speed: number;
  yaw: number;
  angle: number;
  /** Backspin (rpm), and the spin axis's tilt (radians: positive curves it right). */
  spin: number;
  tilt: number;
  /** Rolling spin as it leaves the face (0..1 of its speed): a putt's forward roll. */
  roll?: number;
  /** Wind (m/s, world axes). */
  wind: { x: number; z: number };
  /** The cup it's played to. */
  pin: { x: number; y: number; z: number };
  /** Whether the flagstick is in the cup (it is unless they've taken it out: putting). */
  flagstick?: boolean;
  /** Its luck (the trees' deflections, lip-outs). */
  seed: number;
}

export type ShotEvent = { t: number; kind: 'land' | 'bounce' | 'tree' | 'trunk' | 'pin' | 'splash' | 'cup' | 'lip' | 'sand'; x: number; y: number; z: number; speed: number };

export interface ShotResult {
  /** Where it was, `HZ` times a second: x, y, z each (y: its bottom, on the ground once it's down). */
  path: number[];
  events: ShotEvent[];
  /** How it ended, and where. */
  outcome: 'rest' | 'holed' | 'water' | 'ob';
  end: { x: number; y: number; z: number };
  surf: Surf;
  /** Where to drop after a splash: the last dry ground it crossed. */
  drop: { x: number; y: number; z: number } | null;
  /** Seconds from strike to stop. */
  time: number;
  /** Blocks carried in the air (to the first landing), and in all; the highest it rose (blocks over the start). */
  carry: number;
  total: number;
  apex: number;
}

export const HZ = 30;

/** The ball's radius as drawn and as the cup meets it (blocks), and the flagstick's. */
const BR = BALL_SIZE / 2;
const POLE_R = 0.03;
/**
 * Gravity over the cup, times the world's: the cup and ball are drawn about six times life size,
 * so at the world's gravity a ball would drop from far too fast a roll. Less of it takes the balls
 * a real cup takes: dead centre up to a pace that would carry it about ten feet past.
 */
const CUP_GRAVITY = 0.5;
/** How lively the flagstick is: a firm putt that hits it square can still bounce out. */
const POLE_BOUNCE = 0.75;

// The ball, in metres and kilograms.
const R = 0.02135;
const MASS = 0.04593;
const AREA = Math.PI * R * R;
const RHO = 1.225;
/** ρA / 2m: drag and lift per unit of coefficient and speed squared. */
const K = (RHO * AREA) / (2 * MASS);
const SPIN_DECAY = 1 / 24;

/** How each kind of ground takes the ball: bounce, friction sliding and rolling, how soft. */
export interface Turf {
  /** Restitution at low speed (it falls with impact speed). */
  e: number;
  /** Sliding friction (at impact and while it skids). */
  mu: number;
  /** Rolling resistance: the fraction of g that slows a rolling ball. */
  roll: number;
  /** How soft it is to land on (how deep a landing ball digs in). */
  soft: number;
}

export const TURF: Record<Surf, Turf> = {
  [Surf.Out]: { e: 0.3, mu: 0.6, roll: 0.75, soft: 1.35 },
  [Surf.Rough]: { e: 0.36, mu: 0.52, roll: 0.5, soft: 1.25 },
  [Surf.Deep]: { e: 0.3, mu: 0.6, roll: 0.75, soft: 1.35 },
  [Surf.Fairway]: { e: 0.52, mu: 0.42, roll: 0.2, soft: 0.95 },
  [Surf.Fringe]: { e: 0.48, mu: 0.38, roll: 0.12, soft: 1 },
  [Surf.Green]: { e: 0.45, mu: 0.3, roll: 0.056, soft: 1 },
  [Surf.Tee]: { e: 0.5, mu: 0.42, roll: 0.2, soft: 0.9 },
  [Surf.Sand]: { e: 0.08, mu: 0.9, roll: 2.2, soft: 1.8 },
  [Surf.Water]: { e: 0, mu: 1, roll: 5, soft: 1 },
  [Surf.Path]: { e: 0.72, mu: 0.35, roll: 0.045, soft: 0.15 },
};

/**
 * A putt's speed for it to roll `metres` on a flat green, starting with `roll0` of its speed as
 * forward roll (it skids until the rest catches up, then rolls), so the putting meter reads in
 * distance: full power is the scale's length.
 */
export function puttSpeed(metres: number, roll0 = 0): number {
  const t = TURF[Surf.Green];
  const k = (1 - roll0) / 3.5;
  const perV2 = (k * (1 - k / 2)) / (t.mu * G) + (1 - k) ** 2 / (2 * t.roll * G);
  return Math.sqrt(Math.max(0, metres) / perV2);
}

/**
 * Play a shot out: from the strike to where it stops (or drops in, or splashes). Positions are
 * world blocks; the ball's `y` is its bottom.
 */
export function simulate(t: Terrain, l: Launch, opts: { maxTime?: number; flightOnly?: boolean } = {}): ShotResult {
  const rnd = mulberry(l.seed);
  const maxTime = opts.maxTime ?? 40;
  const flagstick = l.flagstick ?? true;
  const path: number[] = [];
  const events: ShotEvent[] = [];
  const ev = (kind: ShotEvent['kind'], x: number, y: number, z: number, v: number) => events.push({ t: time, kind, x: round(x), y: round(y), z: round(z), speed: round(v) });

  // State: position (blocks), velocity (m/s), spin (rad/s backspin, and its axis's tilt).
  let x = l.x;
  let y = l.y;
  let z = l.z;
  const fx = -Math.sin(l.yaw);
  const fz = -Math.cos(l.yaw);
  let vx = fx * l.speed * Math.cos(l.angle);
  let vy = l.speed * Math.sin(l.angle);
  let vz = fz * l.speed * Math.cos(l.angle);
  let omega = (l.spin * 2 * Math.PI) / 60;
  const tilt = l.tilt;
  // On the ground: its spin as a velocity (what it'd roll at), horizontal.
  let wx = fx * l.speed * (l.roll ?? 0);
  let wz = fz * l.speed * (l.roll ?? 0);

  let time = 0;
  let airborne = l.angle > 0.001;
  let landed = !airborne;
  let carry = 0;
  let apex = 0;
  let outcome: ShotResult['outcome'] = 'rest';
  let drop: ShotResult['drop'] = null;
  let dry = { x, y, z };
  let nextSample = 0;
  let trees = t.treesNear(x, z);
  let treesAt = { x, z };
  let inLeaves = false;
  let hitPin = false;
  const slope = { x: 0, z: 0 };
  // Over the cup: the ball's middle and velocity in blocks (and blocks a second), how long it's been slow there.
  let inCup = false;
  const cc = { x: 0, y: 0, z: 0 };
  const cv = { x: 0, y: 0, z: 0 };
  let cupSlow = 0;
  let cupTime = 0;
  let lipped = false;

  const sample = (onGround: boolean) => {
    const sy = inCup ? cc.y - BR : onGround ? t.ground(x, z).y : y;
    path.push(round(inCup ? cc.x : x), round(sy), round(inCup ? cc.z : z));
  };
  sample(!airborne);
  const enterCup = (wx: number, wy: number, wz: number, bottom: number) => {
    inCup = true;
    Object.assign(cc, { x, y: bottom + BR, z });
    Object.assign(cv, { x: wx, y: wy, z: wz });
    cupSlow = 0;
    cupTime = 0;
  };

  while (time < maxTime) {
    if (time >= nextSample) {
      nextSample += 1 / HZ;
      if (time > 0) sample(!airborne);
    }
    if (Math.hypot(x - treesAt.x, z - treesAt.z) > 6) {
      trees = t.treesNear(x, z);
      treesAt = { x, z };
    }

    if (inCup) {
      const r = cupStep(1 / 600);
      time += 1 / 600;
      if (r === 'in') continue;
      inCup = false;
      x = cc.x;
      z = cc.z;
      if (r === 'holed') {
        outcome = 'holed';
        ev('cup', l.pin.x, l.pin.y, l.pin.z, Math.hypot(cv.x, cv.y, cv.z) / S);
        y = l.pin.y - 0.3;
        break;
      }
      if (r === 'rest') {
        y = cc.y - BR;
        break;
      }
      vx = cv.x / S;
      vz = cv.z / S;
      if (r === 'air') {
        airborne = true;
        vy = cv.y / S;
        y = cc.y - BR;
        omega = 0;
      } else {
        y = t.ground(x, z).y;
      }
      wx = vx;
      wz = vz;
      continue;
    }

    if (airborne) {
      const dt = 1 / 240;
      // Air: drag against the ball's way through the air, lift across it from the spin.
      const ax0 = vx - l.wind.x;
      const az0 = vz - l.wind.z;
      const sp = Math.hypot(ax0, vy, az0);
      let axx = 0;
      let ayy = -G;
      let azz = 0;
      if (sp > 0.01) {
        const sr = (R * omega) / sp;
        const cd = 0.215 + 0.26 * Math.min(sr, 0.35);
        const cl = Math.max(0, 1.99 * Math.min(sr, 0.3) - 3.25 * Math.min(sr, 0.3) ** 2);
        // Drag.
        axx -= K * cd * sp * ax0;
        ayy -= K * cd * sp * vy;
        azz -= K * cd * sp * az0;
        // The spin axis: level and to the left of the way it's going (backspin), tilted by `tilt`
        // (a slice leans it so the lift pushes right).
        const hl = Math.hypot(ax0, az0) || 1;
        // Backspin's axis: level, across the way it's going (v̂ × ŷ: to its left... as the right
        // hand grips it, so the lift ω̂ × v̂ is up).
        const bx = -az0 / hl;
        const bz = ax0 / hl;
        const ox = bx * Math.cos(tilt);
        const oy = -Math.sin(tilt);
        const oz = bz * Math.cos(tilt);
        // Lift along ω̂ × v̂.
        let lx = oy * az0 - oz * vy;
        let ly = oz * ax0 - ox * az0;
        let lz = ox * vy - oy * ax0;
        const ll = Math.hypot(lx, ly, lz) || 1;
        lx /= ll;
        ly /= ll;
        lz /= ll;
        const lift = K * cl * sp * sp;
        axx += lift * lx;
        ayy += lift * ly;
        azz += lift * lz;
      }
      vx += axx * dt;
      vy += ayy * dt;
      vz += azz * dt;
      omega *= Math.exp(-SPIN_DECAY * dt);
      x += vx * dt * S;
      y += vy * dt * S;
      z += vz * dt * S;
      time += dt;
      apex = Math.max(apex, y - l.y);

      // Trees: a trunk turns it back, the leaves swallow it.
      let leaves = false;
      for (const tr of trees) {
        const dx = x - tr.x;
        const dz = z - tr.z;
        const d2 = dx * dx + dz * dz;
        if (d2 < 0.3 && y >= tr.base && y < tr.base + tr.trunk) {
          const d = Math.sqrt(d2) || 1;
          const nx = dx / d;
          const nz = dz / d;
          const vn = vx * nx + vz * nz;
          if (vn < 0) {
            vx -= 1.5 * vn * nx;
            vz -= 1.5 * vn * nz;
            vx *= 0.6;
            vz *= 0.6;
            omega *= 0.3;
            ev('trunk', x, y, z, Math.hypot(vx, vy, vz));
          }
        }
        const cy = tr.base + tr.cy;
        if (d2 / (tr.r * tr.r) + ((y - cy) * (y - cy)) / (tr.h * tr.h) < 1) leaves = true;
      }
      if (leaves) {
        if (!inLeaves) ev('tree', x, y, z, Math.hypot(vx, vy, vz));
        // Slowed hard, knocked about, spin gone.
        const damp = Math.exp(-7 * dt);
        vx *= damp;
        vy *= damp;
        vz *= damp;
        omega *= Math.exp(-6 * dt);
        if (rnd() < dt * 20) {
          const s = Math.hypot(vx, vy, vz) * 0.6;
          vx += (rnd() - 0.5) * s;
          vy += (rnd() - 0.5) * s;
          vz += (rnd() - 0.5) * s;
        }
      }
      inLeaves = leaves;

      // The flagstick (if it's in).
      const pdx = x - l.pin.x;
      const pdz = z - l.pin.z;
      if (flagstick && !hitPin && pdx * pdx + pdz * pdz < 0.12 * 0.12 && y < l.pin.y + 3 && y > l.pin.y - 0.2) {
        hitPin = true;
        vx *= -0.2;
        vz *= -0.2;
        vy = Math.min(vy, 0) * 0.5;
        ev('pin', x, y, z, Math.hypot(vx, vy, vz));
      }

      // Coming down over the cup: the cup has it (in, off the rim, off the stick).
      if (vy < 0 && Math.hypot(x - l.pin.x, z - l.pin.z) < CUP_R + BR && y < l.pin.y + 0.35) {
        if (!landed) {
          landed = true;
          carry = Math.hypot(x - l.x, z - l.z);
          if (opts.flightOnly) break;
        }
        enterCup(vx * S, vy * S, vz * S, Math.max(y, l.pin.y));
        continue;
      }

      // Down: into the water, or a bounce.
      const g = t.ground(x, z);
      if (y <= g.y && vy < 0) {
        y = g.y;
        if (!landed) {
          landed = true;
          carry = Math.hypot(x - l.x, z - l.z);
          if (opts.flightOnly) break;
        }
        const hs = Math.hypot(vx, vz);
        if (g.surf === Surf.Water) {
          outcome = 'water';
          ev('splash', x, y, z, Math.hypot(hs, vy));
          drop = dropFrom(t, dry, l);
          break;
        }
        const s = bounce(t, g.surf, x, z, slope);
        ev(g.surf === Surf.Sand ? 'sand' : events.some((e) => e.kind === 'land') ? 'bounce' : 'land', x, y, z, Math.hypot(hs, vy));
        if (!s) {
          // Settled onto the ground: rolling (or skidding) from here.
          airborne = false;
          y = g.y;
        }
      } else if (g.surf !== Surf.Water) {
        dry = { x, y: g.y, z };
      }
      if (y < 0 || !Number.isFinite(y)) {
        outcome = 'ob';
        break;
      }
      continue;
    }

    // ---------------------------------------------------------------------------------------
    // On the ground: skidding until its spin catches up, then rolling; down the slopes.
    // ---------------------------------------------------------------------------------------
    const dt = 1 / 120;
    const g = t.ground(x, z);
    const gsurf = g.surf;
    const turf = TURF[gsurf];
    t.slope(x, z, slope);
    const ux = vx - wx;
    const uz = vz - wz;
    const slip = Math.hypot(ux, uz);
    const speed = Math.hypot(vx, vz);
    if (slip > 0.02) {
      // Skidding: friction against the slip, spinning it up toward rolling.
      const f = turf.mu * G;
      const step = Math.min(f * dt, slip / 3.5);
      vx += -G * slope.x * dt - (ux / slip) * step;
      vz += -G * slope.z * dt - (uz / slip) * step;
      wx += (ux / slip) * step * 2.5;
      wz += (uz / slip) * step * 2.5;
    } else {
      // Rolling: 5/7 of gravity down the slope, the grass holding it back.
      const pull = (5 / 7) * G * Math.hypot(slope.x, slope.z);
      const hold = turf.roll * G;
      if (speed < 0.05 && pull < hold * 1.15) {
        vx = vz = wx = wz = 0;
        break;
      }
      vx += -(5 / 7) * G * slope.x * dt;
      vz += -(5 / 7) * G * slope.z * dt;
      const sp = Math.hypot(vx, vz);
      if (sp > 1e-6) {
        const k = Math.max(0, sp - hold * dt) / sp;
        vx *= k;
        vz *= k;
      }
      wx = vx;
      wz = vz;
    }
    const px = x;
    const pz = z;
    x += vx * dt * S;
    z += vz * dt * S;
    time += dt;
    const ng = t.ground(x, z);
    y = ng.y;

    // Reaching the cup's edge: the cup has it now.
    if (Math.hypot(x - l.pin.x, z - l.pin.z) < CUP_R + BR) {
      enterCup(vx * S, 0, vz * S, y);
      continue;
    }

    if (ng.surf === Surf.Water) {
      outcome = 'water';
      ev('splash', x, y, z, Math.hypot(vx, vz));
      drop = dropFrom(t, { x: px, y: t.ground(px, pz).y, z: pz }, l);
      break;
    }
    if (gsurf !== Surf.Sand && ng.surf === Surf.Sand && speed > 0.5) ev('sand', x, y, z, speed);
  }

  sample(!airborne || outcome !== 'rest');
  const end = { x, y: outcome === 'holed' ? y : t.ground(x, z).y, z };
  if (outcome === 'rest' && !t.inBounds(x, z)) outcome = 'ob';
  if (!landed) carry = Math.hypot(x - l.x, z - l.z);
  return {
    path,
    // Going in over the rim isn't a lip-out.
    events: outcome === 'holed' ? events.filter((e) => e.kind !== 'lip') : events,
    outcome,
    end,
    surf: t.ground(x, z).surf,
    drop,
    time: round(time),
    carry: Math.round(carry * 100) / 100,
    total: Math.round(Math.hypot(x - l.x, z - l.z) * 100) / 100,
    apex: Math.round(apex * 100) / 100,
  };

  /**
   * One step over the cup, in blocks and seconds: gravity; the green round the hole holding it up;
   * the rim's edge (a ring the ball rolls over, or hits); the cup's wall below it; the flagstick.
   * In once its top is below the lip; out when it's clear of the hole again, rolling or in the air.
   */
  function cupStep(dt: number): 'in' | 'holed' | 'ground' | 'air' | 'rest' {
    const pin = l.pin;
    const lip = pin.y;
    const gw = G * S * CUP_GRAVITY;
    cupTime += dt;
    cv.y -= gw * dt;
    cc.x += cv.x * dt;
    cc.y += cv.y * dt;
    cc.z += cv.z * dt;
    let hx = cc.x - pin.x;
    let hz = cc.z - pin.z;
    let rho = Math.hypot(hx, hz) || 1e-6;
    let nx = hx / rho;
    let nz = hz / rho;
    // The green round the hole.
    if (rho >= CUP_R) {
      const gy = t.ground(cc.x, cc.z).y;
      if (cc.y - BR < gy) {
        cc.y = gy + BR;
        if (cv.y < 0) cv.y = cv.y < -0.25 ? -cv.y * 0.2 : 0;
        const h = Math.hypot(cv.x, cv.z);
        if (h > 1e-6) {
          const k = Math.max(0, h - TURF[Surf.Green].roll * G * S * dt) / h;
          cv.x *= k;
          cv.z *= k;
        }
      }
    }
    // The flagstick (if it's in), from the bottom of the cup up.
    if (flagstick && rho < POLE_R + BR && cc.y < lip + PIN_HEIGHT && cc.y > lip - CUP_DEPTH) {
      rho = POLE_R + BR;
      cc.x = pin.x + nx * rho;
      cc.z = pin.z + nz * rho;
      const vr = cv.x * nx + cv.z * nz;
      if (vr < 0) {
        cv.x -= (1 + POLE_BOUNCE) * vr * nx;
        cv.z -= (1 + POLE_BOUNCE) * vr * nz;
        if (-vr > 0.25) ev('pin', cc.x, cc.y - BR, cc.z, -vr / S);
      }
    }
    // The rim: the edge of the hole, a ring the ball's surface meets.
    const px = pin.x + nx * CUP_R;
    const pz = pin.z + nz * CUP_R;
    const dx = cc.x - px;
    const dy = cc.y - lip;
    const dz = cc.z - pz;
    const d = Math.hypot(dx, dy, dz);
    if (d < BR && d > 1e-6) {
      const Nx = dx / d;
      const Ny = dy / d;
      const Nz = dz / d;
      cc.x = px + Nx * BR;
      cc.y = lip + Ny * BR;
      cc.z = pz + Nz * BR;
      const vn = cv.x * Nx + cv.y * Ny + cv.z * Nz;
      if (vn < 0) {
        cv.x -= 1.3 * vn * Nx;
        cv.y -= 1.3 * vn * Ny;
        cv.z -= 1.3 * vn * Nz;
        if (!lipped && -vn > 0.12) {
          lipped = true;
          ev('lip', px, lip, pz, -vn / S);
        }
      }
    }
    // The wall below the rim: it keeps the ball in.
    hx = cc.x - pin.x;
    hz = cc.z - pin.z;
    rho = Math.hypot(hx, hz) || 1e-6;
    if (cc.y < lip && rho > CUP_R - BR) {
      nx = hx / rho;
      nz = hz / rho;
      cc.x = pin.x + nx * (CUP_R - BR);
      cc.z = pin.z + nz * (CUP_R - BR);
      const vr = cv.x * nx + cv.z * nz;
      if (vr > 0) {
        cv.x -= 1.25 * vr * nx;
        cv.z -= 1.25 * vr * nz;
        cv.y *= 0.85;
      }
    }
    // In: its top below the lip, inside the hole.
    if (cc.y < lip - BR * 1.1 && rho < CUP_R) return 'holed';
    // Out: clear of the hole, on the green again or in the air.
    if (rho > CUP_R + BR + 0.01) {
      const gy = t.ground(cc.x, cc.z).y;
      return cc.y - BR <= gy + 0.01 && cv.y <= 0.3 ? 'ground' : 'air';
    }
    // Hanging on the edge, or stuck: it stays (or, well down, it's in).
    const speed = Math.hypot(cv.x, cv.y, cv.z);
    cupSlow = speed < 0.02 ? cupSlow + dt : 0;
    if (cupSlow > 0.6) return cc.y < lip - BR * 0.3 ? 'holed' : 'rest';
    if (cupTime > 4) return rho < CUP_R ? 'holed' : 'rest';
    return 'in';
  }

  /** Off the ground at this point: true if it's still in the air after. */
  function bounce(t: Terrain, surf: Surf, bx: number, bz: number, s: { x: number; z: number }): boolean {
    const turf = TURF[surf];
    t.slope(bx, bz, s);
    // The ground's normal.
    const nl = Math.hypot(s.x, 1, s.z);
    let nx = -s.x / nl;
    let ny = 1 / nl;
    let nz = -s.z / nl;
    let vn = vx * nx + vy * ny + vz * nz;
    if (vn >= 0) return true;
    // It digs a little crater as it lands (Penner): the harder and steeper, the more the ground it
    // meets leans back toward it, which is what takes a landing ball's pace off.
    const speed = Math.hypot(vx, vy, vz);
    let tx = vx - vn * nx;
    let ty = vy - vn * ny;
    let tz = vz - vn * nz;
    const tl = Math.hypot(tx, ty, tz);
    if (tl > 1e-6) {
      const steep = Math.atan2(-vn, tl);
      const crater = Math.min(0.55, 0.269 * (speed / 18.6) * (steep / 0.775) * turf.soft);
      const c = Math.cos(crater);
      const sn = Math.sin(crater);
      nx = nx * c - (tx / tl) * sn;
      ny = ny * c - (ty / tl) * sn;
      nz = nz * c - (tz / tl) * sn;
      vn = vx * nx + vy * ny + vz * nz;
      tx = vx - vn * nx;
      ty = vy - vn * ny;
      tz = vz - vn * nz;
    }
    // The spin as a velocity along the ground (backspin points back the way it came).
    const th = Math.hypot(tx, tz) || 1;
    if (omega > 0) {
      wx = (-tx / th) * R * omega;
      wz = (-tz / th) * R * omega;
      omega = 0;
    }
    const e = turf.e / (1 + 0.075 * -vn);
    const ux = tx - wx;
    const uz = tz - wz;
    const u = Math.hypot(ux, uz);
    const J = turf.mu * (1 + e) * -vn;
    if (J >= (2 / 7) * u) {
      // It grips: rolling (or backing up) at once.
      tx -= (2 / 7) * ux;
      tz -= (2 / 7) * uz;
      wx = tx;
      wz = tz;
    } else if (u > 0) {
      tx -= (J * ux) / u;
      tz -= (J * uz) / u;
      wx += (2.5 * J * ux) / u;
      wz += (2.5 * J * uz) / u;
    }
    const up = -vn * e;
    vx = tx + nx * up;
    vy = ty + ny * up;
    vz = tz + nz * up;
    // Small hops end it: it's on the ground.
    if (vy < 0.9 || surf === Surf.Sand) {
      vy = 0;
      return false;
    }
    y += 0.001;
    return true;
  }
}

/** A drop after a splash: back from where it crossed into the water, on dry ground, toward where it was struck. */
function dropFrom(t: Terrain, at: { x: number; y: number; z: number }, l: Launch) {
  const dx = l.x - at.x;
  const dz = l.z - at.z;
  const d = Math.hypot(dx, dz) || 1;
  for (const back of [2.5, 4, 6, 9, 13, 18]) {
    const x = at.x + (dx / d) * Math.min(back, d);
    const z = at.z + (dz / d) * Math.min(back, d);
    const g = t.ground(x, z);
    if (g.surf !== Surf.Water && g.surf !== Surf.Sand) return { x, y: g.y, z };
  }
  return { x: l.x, y: l.y, z: l.z };
}

function round(v: number): number {
  return Math.round(v * 100) / 100;
}
