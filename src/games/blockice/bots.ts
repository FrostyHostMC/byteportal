import type { Bot, GameContext as Game } from '@platform';
import type { Level } from './levels';
import { allSkaters, blade, levelOf, otherTeam, puckPos, skOf, type Match, type Skater } from './match';
import { fromGoal, goal, GOAL_X, HALF_WIDTH, keepIn, type Side } from './rink';

/**
 * The bots who skate out: driven by code through the same controls a person has (the skate ability
 * moves them, the server's rules judge them). With the puck they carry it up the ice, round the man
 * in the way, and shoot when there's a look (a quick wrister in close, a slapper from out if
 * they've time), or pass when they're hounded or their winger's open in the slot (who holds shoot
 * for the one-timer). Without it they find open ice: the slot, the far post, the point. On defence
 * the nearer of the two takes the puck carrier (a poke now and then, a hit if there's turbo), the
 * other the man in front of the net. A loose puck: the nearer of each side goes for it.
 *
 * How well they do all that is their level's (`levels.ts`): the room's against people, an
 * All-Star's against bots.
 */

interface Mind {
  /** Where they stand in their level's range of skill (0..1, theirs for the game). */
  talent: number;
  skill: number;
  level: Level;
  /** Whether they'll use turbo for now, and till when. */
  boost: boolean;
  boostAt: number;
  /** A shot winding up: shoot held, let go at `releaseAt` (match clock). */
  winding: boolean;
  releaseAt: number;
  /** When they next think about a shot or a pass (match clock). */
  thinkAt: number;
  /** Where they're heading without the puck, and till when. */
  spot: { x: number; z: number } | null;
  spotUntil: number;
  /** Holding shoot for a one-timer as a pass comes. */
  oneTimer: boolean;
  /** Had the puck last tick (a new possession starts a new plan), and the plan: a lane to carry it up. */
  had: boolean;
  lane: number;
}

const minds = new Map<Skater, Mind>();

export const bots = {
  add(m: Match, s: Skater) {
    minds.set(s, { talent: Math.random(), skill: 0.5, level: levelOf(m, s), boost: true, boostAt: 0, winding: false, releaseAt: 0, thinkAt: 0, spot: null, spotUntil: 0, oneTimer: false, had: false, lane: 0 });
  },
  forget(s: Skater) {
    minds.delete(s);
  },
  clear() {
    minds.clear();
  },
  update(game: Game, m: Match) {
    const now = game.clock.now;
    for (const s of allSkaters(m)) {
      if (!s.player.bot) continue;
      const mind = minds.get(s);
      if (mind) think(m, s, s.player as Bot, mind, now);
    }
  },
};

const KEYS = ['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ShiftLeft'];

/**
 * Skate to a point: the keys that turn their velocity toward the one that gets them there (on ice
 * that's pushing against the glide to slow up as they arrive), turbo if asked and they're using it.
 */
function skateTo(bot: Bot, mind: Mind, at: { x: number; z: number }, turbo: boolean, near = 0.5) {
  const p = bot.position;
  const v = bot.velocity;
  const k = keepIn(at.x, at.z, 0.6);
  const dx = k.x - p.x;
  const dz = k.z - p.z;
  const d = Math.hypot(dx, dz);
  const top = turbo && mind.boost ? 12 : 8;
  const want = d > near ? Math.min(top, d * 2.4) : 0;
  const wx = d > 1e-3 ? (dx / d) * want : 0;
  const wz = d > 1e-3 ? (dz / d) * want : 0;
  const ex = wx - v.x;
  const ez = wz - v.z;
  const e = Math.hypot(ex, ez);
  const go = e > 0.9;
  bot.controls.hold('KeyD', go && ex / e > 0.38);
  bot.controls.hold('KeyA', go && ex / e < -0.38);
  bot.controls.hold('KeyS', go && ez / e > 0.38);
  bot.controls.hold('KeyW', go && ez / e < -0.38);
  bot.controls.hold('ShiftLeft', go && turbo && mind.boost && d > 3);
}

function stop(bot: Bot) {
  for (const k of KEYS) bot.controls.hold(k, false);
}

/** Turn to face along a direction on the ice (yaw 0 looks toward -z). */
function face(bot: Bot, dx: number, dz: number) {
  if (Math.abs(dx) + Math.abs(dz) < 1e-4) return;
  bot.controls.look(Math.atan2(-dx, -dz), 0);
}

/** Face the way they're going (or else toward a point). */
function faceMotion(bot: Bot, toward: { x: number; z: number }) {
  const v = bot.velocity;
  if (Math.hypot(v.x, v.z) > 1.2) face(bot, v.x, v.z);
  else face(bot, toward.x - bot.position.x, toward.z - bot.position.z);
}

function think(m: Match, s: Skater, bot: Bot, mind: Mind, now: number) {
  const st = skOf(bot);
  const level = levelOf(m, s);
  mind.level = level;
  mind.skill = level.skill[0] + mind.talent * (level.skill[1] - level.skill[0]);
  if (now >= mind.boostAt) {
    mind.boostAt = now + 0.8 + Math.random();
    mind.boost = Math.random() < level.turbo;
  }
  // The faceoff: frozen at the dot, they take the draw as soon as they see the drop.
  if (m.phase === 'faceoff') {
    stop(bot);
    const d = m.draw;
    if (d && d.centers.includes(s) && !d.won && now >= d.at + 0.08 + (1 - mind.skill) * 0.3 + level.slow * 0.6) bot.controls.press('KeyE');
    return;
  }
  if (m.phase !== 'live' || st.stun > 0 || bot.frozen) {
    stop(bot);
    letGo(bot, mind);
    return;
  }
  const pk = m.puck;
  const holder = pk.mode === 'held' ? pk.holder : null;
  if (holder === s && !mind.had) {
    mind.lane = Math.random() < 0.5 ? -1 : 1;
    mind.thinkAt = now + 0.25 + level.slow;
  }
  mind.had = holder === s;
  if (holder === s) return carry(m, s, bot, mind, now);
  letGo(bot, mind);
  if (pk.mode === 'loose') {
    // A pass on its way to them: hold shoot for the one-timer if they've a look (and they're quick enough).
    if (pk.kind === 'pass' && pk.to === s) {
      const side = s.team.side;
      const p = bot.position;
      const d = fromGoal(side, p.x, p.z);
      if (!mind.oneTimer && d < 9 && side * (GOAL_X * side - p.x) > 1.2 && Math.random() < 0.15 + mind.skill * 0.35) mind.oneTimer = true;
      if (mind.oneTimer) {
        bot.controls.hold('Space', true);
        face(bot, goal(side).x - p.x, -p.z);
      }
      const at = puckPos(m);
      skateTo(bot, mind, { x: (p.x + at.x) / 2, z: (p.z + at.z) / 2 }, false, 0.3);
      return;
    }
    return chase(m, s, bot, mind);
  }
  if (holder && holder.team === s.team) return support(m, s, bot, mind, now, holder);
  if (holder) return defend(m, s, bot, mind, holder);
  // A dead puck: back toward their own half.
  skateTo(bot, mind, { x: -s.team.side * 5, z: s === s.team.skaters[0] ? -2 : 3 }, false, 1);
}

/** Done holding shoot (a one-timer that didn't come, a shot let go). */
function letGo(bot: Bot, mind: Mind) {
  if (mind.oneTimer || mind.winding) bot.controls.hold('Space', false);
  mind.oneTimer = false;
  mind.winding = false;
}

/** With the puck: up the ice in their lane, round whoever's in the way; a shot when there's a look, a pass when they're hounded. */
function carry(m: Match, s: Skater, bot: Bot, mind: Mind, now: number) {
  const side = s.team.side;
  const g = goal(side);
  const p = bot.position;
  const d = fromGoal(side, p.x, p.z);
  const foes = otherTeam(m, s.team).skaters;
  let near = Infinity;
  let nearAt = { x: 0, z: 0 };
  for (const f of foes) {
    const q = f.player.position;
    const fd = Math.hypot(q.x - p.x, q.z - p.z);
    if (fd < near) [near, nearAt] = [fd, q];
  }
  // A shot winding up: let it go when it's time, still facing the net.
  if (mind.winding) {
    face(bot, g.x - p.x, g.z - p.z);
    if (now >= mind.releaseAt) {
      bot.controls.hold('Space', false);
      mind.winding = false;
    }
    stop(bot);
    return;
  }
  const mate = s.team.skaters.find((x) => x !== s);
  // In front of the goal line, at an angle that's a look at the net.
  const outFront = side * (g.x - p.x);
  const angle = Math.abs(p.z) / Math.max(0.6, outFront);
  const look = outFront > 0.8 && angle < 2.4;
  if (now >= mind.thinkAt) {
    mind.thinkAt = now + 0.18 + (1 - mind.skill) * 0.25 + mind.level.slow;
    const fire = skOf(bot).fire === 1;
    // A shot: a quick wrister in close, a slapper from out with time, anything when they're on fire.
    if (look) {
      let wind = -1;
      if (d < 5.5 && (near > 1.1 || Math.random() < 0.45)) wind = 0.06 + Math.random() * 0.15;
      else if (d < 11 && near > 2.8 && Math.random() < 0.35) wind = 0.55 + Math.random() * 0.3;
      else if (d < 8.5 && Math.random() < 0.12 + mind.skill * 0.12) wind = 0.1 + Math.random() * 0.2;
      else if (fire && d < 13 && Math.random() < 0.4) wind = 0.3;
      if (wind > 0) {
        mind.winding = true;
        mind.releaseAt = now + wind * 0.85;
        bot.controls.hold('Space', true);
        face(bot, g.x - p.x, g.z - p.z);
        stop(bot);
        return;
      }
    }
    // A pass: hounded and the winger's open, or the winger's alone in the slot.
    if (mate) {
      const mp = mate.player.position;
      let open = Infinity;
      for (const f of foes) open = Math.min(open, Math.hypot(f.player.position.x - mp.x, f.player.position.z - mp.z));
      const slot = fromGoal(side, mp.x, mp.z) < 6 && side * (g.x - mp.x) > 1;
      const lanes = clearLane(m, s, blade(bot), blade(mate.player));
      if (lanes && ((near < 1.4 && open > 1.8 && Math.random() < 0.5) || (slot && open > 2.2 && d > 5 && Math.random() < 0.4))) {
        bot.controls.press('KeyE');
        return;
      }
    }
  }
  // Up the ice: their lane, then cut in to the slot; round the man in the way.
  let tx = g.x - side * 4.5;
  let tz = mind.lane * 1.5;
  if (outFront > 9) tz = mind.lane * 5;
  if (near < 3) {
    const away = Math.sign(p.z - nearAt.z) || mind.lane;
    tz = Math.max(-HALF_WIDTH + 2, Math.min(HALF_WIDTH - 2, p.z + away * 3));
    tx = p.x + side * 4;
  }
  skateTo(bot, mind, { x: tx, z: tz }, near > 1.5 || outFront > 12, 0.8);
  faceMotion(bot, g);
}

/** No one in the way of a pass (a foe's blade near the line between the two blades). */
function clearLane(m: Match, s: Skater, a: { x: number; z: number }, b: { x: number; z: number }): boolean {
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  const l2 = dx * dx + dz * dz || 1;
  for (const f of otherTeam(m, s.team).skaters) {
    const q = blade(f.player);
    const t = Math.max(0, Math.min(1, ((q.x - a.x) * dx + (q.z - a.z) * dz) / l2));
    if (Math.hypot(a.x + dx * t - q.x, a.z + dz * t - q.z) < 0.9) return false;
  }
  return true;
}

/** Their side has it: open ice (the slot, the far post, the point, a wing), away from the carrier. */
function support(m: Match, s: Skater, bot: Bot, mind: Mind, now: number, holder: Skater) {
  const side = s.team.side;
  const g = goal(side);
  if (!mind.spot || now >= mind.spotUntil) {
    const hp = holder.player.position;
    const spots = [
      { x: g.x - side * 4, z: -1.6 },
      { x: g.x - side * 4, z: 1.6 },
      { x: g.x - side * 2.2, z: -Math.sign(hp.z || 1) * 1.6 },
      { x: g.x - side * 9.5, z: -4 },
      { x: g.x - side * 9.5, z: 4 },
      { x: g.x - side * 7, z: -Math.sign(hp.z || 1) * 6 },
    ];
    // Ahead of the carrier, apart from them, away from the foes.
    const foes = otherTeam(m, s.team).skaters.map((f) => f.player.position);
    const score = (q: { x: number; z: number }) =>
      Math.min(6, Math.hypot(q.x - hp.x, q.z - hp.z)) + Math.min(...foes.map((f) => Math.hypot(f.x - q.x, f.z - q.z))) * 0.8 + Math.random() * 2.5 - (side * (hp.x - q.x) > 2 ? 4 : 0);
    mind.spot = spots.reduce((a, b) => (score(b) > score(a) ? b : a));
    mind.spotUntil = now + 1.8 + Math.random() * 2;
  }
  const p = bot.position;
  skateTo(bot, mind, mind.spot, Math.hypot(mind.spot.x - p.x, mind.spot.z - p.z) > 8, 0.7);
  // Ready for the pass: their stick to the carrier.
  const hp = holder.player.position;
  if (Math.hypot(bot.velocity.x, bot.velocity.z) < 3) face(bot, hp.x - p.x, hp.z - p.z);
  else faceMotion(bot, hp);
}

/** Defence: the nearer takes the carrier (between them and the net; a poke, a hit), the other the man in front. */
function defend(m: Match, s: Skater, bot: Bot, mind: Mind, holder: Skater) {
  const L = mind.level;
  const p = bot.position;
  const st = skOf(bot);
  const mates = s.team.skaters;
  const hp = holder.player.position;
  const dist = (x: Skater) => Math.hypot(x.player.position.x - hp.x, x.player.position.z - hp.z);
  const onPuck = holder.goalie ? false : [...mates].sort((a, b) => dist(a) - dist(b))[0] === s;
  const own = goal(-s.team.side as Side);
  if (onPuck) {
    // Between the carrier and our net, at the level's gap, leading where they're going.
    const hv = holder.player.velocity;
    const lead = { x: hp.x + hv.x * 0.25, z: hp.z + hv.z * 0.25 };
    const dx = own.x - lead.x;
    const dz = own.z - lead.z;
    const dd = Math.hypot(dx, dz) || 1;
    const close = Math.hypot(hp.x - p.x, hp.z - p.z);
    const gap = close < 2.5 ? Math.max(0.6, L.gap - 0.6) : L.gap;
    skateTo(bot, mind, { x: lead.x + (dx / dd) * gap, z: lead.z + (dz / dd) * gap }, close > 3.5, 0.2);
    face(bot, hp.x - p.x, hp.z - p.z);
    if (close < 1.9 && Math.random() < (0.012 + mind.skill * 0.02) * L.poke) bot.controls.press('KeyE');
    else if (close < 2.2 && st.lungeCool <= 0 && (st.turbo > 0.25 || st.fire) && Math.random() < (0.006 + mind.skill * 0.008) * L.check) {
      bot.controls.hold('ShiftLeft', true);
      bot.controls.press('KeyE');
    }
    return;
  }
  // The other: the man without the puck, between him and the net (or the slot if he's deep).
  const man = otherTeam(m, s.team).skaters.find((x) => x !== holder) ?? holder;
  const mp = man.player.position;
  const dx = own.x - mp.x;
  const dz = own.z - mp.z;
  const dd = Math.hypot(dx, dz) || 1;
  const gap = 1.6 + (L.gap - 1.2) * 0.5;
  skateTo(bot, mind, { x: mp.x + (dx / dd) * gap, z: mp.z + (dz / dd) * gap }, dd > 10, 0.4);
  face(bot, hp.x - p.x, hp.z - p.z);
}

/** A loose puck: the nearer of each side goes for it (where it's going); the other covers. */
function chase(m: Match, s: Skater, bot: Bot, mind: Mind) {
  const at = puckPos(m);
  const f = m.puck.flight;
  const lead = f ? { x: at.x + f.vx * 0.3, z: at.z + f.vz * 0.3 } : at;
  const mates = s.team.skaters;
  const d = (x: Skater) => {
    const b = blade(x.player);
    return Math.hypot(b.x - lead.x, b.z - lead.z);
  };
  const nearest = [...mates].sort((a, b) => d(a) - d(b))[0] === s;
  const p = bot.position;
  if (nearest) {
    // Aim the blade at it: the body a little short of it, coming at it.
    const dx = lead.x - p.x;
    const dz = lead.z - p.z;
    const l = Math.hypot(dx, dz) || 1;
    skateTo(bot, mind, { x: lead.x - (dx / l) * 0.7, z: lead.z - (dz / l) * 0.7 }, l > 3, 0.1);
    face(bot, dx, dz);
    return;
  }
  // The other: back between the puck and our net.
  const own = goal(-s.team.side as Side);
  skateTo(bot, mind, { x: (own.x * 2 + at.x) / 3, z: at.z * 0.4 }, false, 0.8);
  face(bot, at.x - p.x, at.z - p.z);
}

