import type { MovementAbility, Vec3, VehicleWorld } from '@platform';

/**
 * Peeking round corners, Q to the left and E to the right, either way you like: hold the key and
 * it leans till you let go; tap it and it stays leaned, till a tap of the same key stands you up
 * (the other key leans the other way, held or tapped). The head and shoulders go out sideways
 * (`body.lean`), so the eyes, where shots start, the head's hitbox and the figure everyone sees
 * all go with them, and the view tilts the way it leans. It eases out and back, stops short of a
 * wall on that side, and sprinting or sliding stands you up (a tap's lean is over; a key still
 * held leans again after). A pure step: it runs on the host and, ahead of it, on the player's own
 * screen, so the lean answers the moment the key goes down, online too.
 */
/**
 * Its keys, how far out (blocks), how quickly it eases (per second), the view's tilt at full lean
 * (radians), the gap it keeps from walls, and the longest press that's a tap (seconds).
 */
export const PEEK = { left: 'KeyQ', right: 'KeyE', reach: 0.4, rate: 16, roll: 0.22, gap: 0.25, tap: 0.25 };

export interface PeekState {
  /** Which way it's leaning: -1 left, 1 right, 0 upright. */
  side: number;
  /** The key holding it there (-1 left, 1 right; 0: none, it's a tap's or upright), and how long it's been down. */
  key: number;
  held: number;
  /** How far out it leans now (blocks, positive right). */
  lean: number;
}

const code = (side: number) => (side < 0 ? PEEK.left : PEEK.right);

export const peek: MovementAbility<PeekState> = {
  state: { side: 0, key: 0, held: 0, lean: 0 },
  step(s, c, body, dt, world) {
    for (const side of [-1, 1]) {
      if (!c.pressed(code(side))) continue;
      // A tap's lean that way, tapped again: upright (and letting go of this press does nothing).
      if (s.side === side && s.key === 0) s.side = 0;
      else {
        s.side = side;
        s.key = side;
        s.held = 0;
      }
    }
    if (s.key !== 0) {
      if (c.isDown(code(s.key))) s.held += dt;
      else {
        // Let go: a tap stays leaned; a hold stands up, or leans the other way if that key's still down.
        const other = -s.key;
        if (s.held > PEEK.tap) {
          const still = c.isDown(code(other));
          s.side = still ? other : 0;
          s.key = still ? other : 0;
          // (Held all along: letting go of it stands up too.)
          s.held = PEEK.tap + 1;
        } else s.key = 0;
      }
    }
    const busy = body.sprinting || body.sliding || body.flying;
    // Sprinting ends a tap's lean; a held key's waits it out.
    if (busy && s.key === 0) s.side = 0;
    const want = busy ? 0 : s.side * PEEK.reach;
    s.lean += (want - s.lean) * (1 - Math.exp(-dt * PEEK.rate));
    if (Math.abs(want - s.lean) < 0.005) s.lean = want;
    if (s.lean !== 0) {
      // Never into a wall: out only as far as there's room, at the eyes and the top of the head.
      const room = clearance(world, body.position, body.crouching ? 1.27 : 1.62, body.yaw, Math.sign(s.lean));
      s.lean = Math.sign(s.lean) * Math.min(Math.abs(s.lean), room);
    }
    body.lean = s.lean;
    body.camera.roll = (s.lean / PEEK.reach) * PEEK.roll;
  },
};

/** How far out the head can go to one side (+1 right, -1 left) before it's within `gap` of a block. */
function clearance(world: VehicleWorld, feet: Vec3, eye: number, yaw: number, dir: number): number {
  const d = { x: Math.cos(yaw) * dir, y: 0, z: -Math.sin(yaw) * dir };
  let room = PEEK.reach;
  for (const up of [eye, eye + 0.3]) {
    const o = { x: feet.x, y: feet.y + up, z: feet.z };
    const hit = world.raycast(o, d, PEEK.reach + PEEK.gap);
    if (hit) room = Math.min(room, Math.max(0, Math.hypot(hit.point.x - o.x, hit.point.z - o.z) - PEEK.gap));
  }
  return room;
}
