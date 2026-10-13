import type { Bot } from '@platform';
import { facing, levelOf, otherTeam, puckPos, skOf, type Match, type Shot, type Skater, type Team } from './match';
import { GOAL_HALF_WIDTH, GOAL_X, ICE, type Side } from './rink';

/**
 * The goalies: bots the game moves itself (their skating glides them to the spot it gives), always
 * squared up to the puck. On the line from the middle of the goal to the puck, out from the crease
 * a little (more the further the puck is); hugging the near post when it's behind the net; sliding
 * across with a shot, as fast as their reflexes allow. Whether they stop it is the shot's `save`
 * chance (the server's `shoot` works it out), rolled once as it reaches them (`meets`).
 */

/** How far a goalie reaches from the middle of their body (across the mouth), and how high. */
export const REACH = 1.0;
export const REACH_HIGH = 1.75;

/** Where a team's goalie should be now, given the puck. */
export function goalieStep(m: Match, t: Team) {
  const g = t.goalie;
  if (!g) return;
  const s = skOf(g.player);
  if (!s) return;
  s.goalie = 1;
  const side = -t.side as Side;
  const gx = side * GOAL_X;
  const at = puckPos(m);
  const pk = m.puck;
  let x: number;
  let z: number;
  if (pk.mode === 'held' && pk.holder === g) {
    x = gx - side * 0.55;
    z = 0;
  } else if (side * (at.x - gx) > -0.3) {
    // Behind the goal line: hugging the post on its side.
    x = gx - side * 0.3;
    z = Math.sign(at.z || 1) * (GOAL_HALF_WIDTH - 0.3);
  } else {
    const dx = at.x - gx;
    const dz = at.z;
    const d = Math.hypot(dx, dz) || 1;
    const out = Math.min(1.05, 0.45 + d * 0.04);
    x = gx + (dx / d) * out;
    z = (dz / d) * out;
    // A shot on its way at them: across to where it'll cross, as their reflexes allow.
    const f = pk.flight;
    if (pk.mode === 'loose' && pk.kind === 'shot' && f && pk.shot && !pk.shot.met && side * f.vx > 0) {
      const tt = (x - f.x) / f.vx;
      if (tt > 0) {
        const zc = f.z + f.vz * tt;
        const quick = 0.55 + levelOf(m, g).skill[1] * 0.4;
        z += (zc - z) * quick;
      }
    }
    z = Math.max(-GOAL_HALF_WIDTH - 0.25, Math.min(GOAL_HALF_WIDTH + 0.25, z));
  }
  s.gx = x;
  s.gz = z;
  // Squared up to the puck.
  const p = g.player.position;
  const fx = at.x - p.x;
  const fz = at.z - p.z;
  if (Math.abs(fx) + Math.abs(fz) > 1e-3) (g.player as Bot).controls.look(Math.atan2(-fx, -fz), 0);
}

/**
 * A shot reaching the goalie of the team it's at, this tick (from `a` to `b`): where it came
 * nearest their body, if that's in their reach (their pads, their glove, their blocker). Null if
 * it didn't come that near (or never will: it's past them).
 */
export function meets(m: Match, shot: Shot, a: { x: number; y: number; z: number }, b: { x: number; y: number; z: number }): { g: Skater; at: { x: number; y: number; z: number } } | null {
  const t = otherTeam(m, shot.by.team);
  const g = t.goalie;
  if (!g || shot.met) return null;
  const p = g.player.position;
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  const l2 = dx * dx + dz * dz;
  const k = l2 > 1e-9 ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.z - a.z) * dz) / l2)) : 1;
  // Still coming at them (its nearest is further on): next tick.
  if (k >= 1 && (p.x - b.x) * dx + (p.z - b.z) * dz > 0) return null;
  const at = { x: a.x + dx * k, y: a.y + (b.y - a.y) * k, z: a.z + dz * k };
  if (Math.hypot(at.x - p.x, at.z - p.z) > REACH || at.y > ICE + REACH_HIGH) return null;
  return { g, at };
}

/**
 * The goalie's chance of stopping a shot: by how hard, from how close, whether they've had time to
 * set (a one-timer), how far they have to go to get across, whether the shooter's on fire, and the
 * level (a bot goalie a person shoots at is softer, the people's own goalie a little better).
 */
export function saveChance(m: Match, shot: Omit<Shot, 'save' | 'met' | 'blocked' | 'onNet'>, crossZ: number, fire: boolean): number {
  const t = otherTeam(m, shot.by.team);
  const g = t.goalie;
  if (!g) return 0;
  if (fire) return 0.08;
  let c = 0.89;
  c -= (shot.speed - 20) * 0.008;
  c -= shot.dist < 2.5 ? 0.1 : shot.dist < 4 ? 0.04 : shot.dist > 10 ? -0.06 : 0;
  if (shot.oneTimer) c -= 0.12;
  c -= Math.min(0.2, Math.abs(crossZ - g.player.position.z) * 0.12);
  // Someone in front of them (a screen): either side's skaters near the line, by the crease.
  const p = g.player.position;
  for (const x of m.teams.flatMap((tm) => tm.skaters)) {
    if (x === shot.by) continue;
    const q = x.player.position;
    if (Math.abs(q.x - p.x) < 2.6 && Math.abs(q.x - p.x) > 0.5 && Math.abs(q.z - crossZ) < 0.8) {
      c -= 0.06;
      break;
    }
  }
  const lv = levelOf(m, g);
  if (!shot.by.player.bot) c += lv.goalie;
  else if (t.skaters.some((x) => !x.player.bot)) c += levelOf(m, shot.by).keeper;
  return Math.max(0.12, Math.min(0.94, c));
}

/** Which save a goalie makes: the pads (low), the glove (high, its side: a catch), the blocker (high, the other), a sprawl (a reach). */
export function saveKind(g: Skater, at: { x: number; y: number; z: number }): number {
  const p = g.player.position;
  const f = facing(g.player.yaw);
  const across = (at.x - p.x) * f.rx + (at.z - p.z) * f.rz;
  if (Math.abs(across) > REACH * 0.75) return 4;
  if (at.y < ICE + 0.55) return 1;
  // The glove's on their left.
  return across < 0 ? 2 : 3;
}

