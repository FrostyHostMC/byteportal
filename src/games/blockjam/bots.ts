import type { Bot, GameContext as Game } from '@platform';
import { fromRim, HALF_LENGTH, HALF_WIDTH, rim, type Side } from './court';
import type { Level } from './levels';
import { allBallers, ballPos, inboundSpot, jamOf, levelOf, otherTeam, type Baller, type Match } from './match';
import { DUNK_RANGE, SHOT_APEX } from './moves';

/**
 * The bots: ballers driven by code through the same controls a person has (the jam ability moves
 * them, the server's rules judge them). On offense the one with the ball drives, pulls up for a
 * jumper when there's room (let go near the top of the jump, give or take their skill), dunks when
 * the lane's open, passes when they're hounded, and lobs to a teammate leaping at the rim; the other
 * finds an open spot or cuts. On defense each guards a man, between him and the basket: a swipe
 * for the ball now and then, a shove, a leap at a shot. Everyone crashes the boards.
 *
 * How well they do all that is their level's (`levels.ts`): the room's against people, an
 * All-Star's against bots.
 */

interface Mind {
  /** Where they stand in their level's range of skill (0..1, theirs for the game). */
  talent: number;
  /** How good they are (0..1): their timing, their reads, how often they try things. Their level's. */
  skill: number;
  level: Level;
  /** Whether they'll use turbo for now (a level that leans on it less often doesn't), and till when. */
  boost: boolean;
  boostAt: number;
  /** Shoot is held (a jump shot), and when to let go (match clock). */
  shooting: boolean;
  releaseAt: number;
  /** A tap of shoot this tick (a dunk, a leap): down this tick, up the next. */
  tap: number;
  /** When they next think about a shot, a pass, a cut (match clock). */
  thinkAt: number;
  /** Where they're heading on offense without the ball. */
  spot: { x: number; z: number } | null;
  spotUntil: number;
  /** When they last leapt. */
  leaptAt: number;
  /** This possession's idea (worked out as they get the ball): drive at the rim, pull up, or a three. */
  plan: 'drive' | 'jumper' | 'three';
  planSpot: { x: number; z: number } | null;
  /** They had the ball last tick (a new possession starts a new plan). */
  had: boolean;
}

const minds = new Map<Baller, Mind>();

export const bots = {
  add(m: Match, b: Baller) {
    const level = levelOf(m, b);
    minds.set(b, { talent: Math.random(), skill: 0.5, level, boost: true, boostAt: 0, shooting: false, releaseAt: 0, tap: 0, thinkAt: 0, spot: null, spotUntil: 0, leaptAt: -9, plan: 'drive', planSpot: null, had: false });
  },
  forget(b: Baller) {
    minds.delete(b);
  },
  clear() {
    minds.clear();
  },
  update(game: Game, m: Match, _dt: number) {
    const now = game.clock.now;
    for (const b of allBallers(m)) {
      if (!b.player.bot) continue;
      const mind = minds.get(b);
      if (!mind) continue;
      think(game, m, b, b.player as Bot, mind, now);
    }
  },
};

const KEYS = ['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ShiftLeft'];

/** Run toward a point on the floor (8 ways, as the keys go), turbo if asked (and they're using it). */
function runTo(bot: Bot, mind: Mind, at: { x: number; z: number }, turbo: boolean, near = 0.35) {
  const p = bot.position;
  const dx = at.x - p.x;
  const dz = at.z - p.z;
  const d = Math.hypot(dx, dz);
  const go = d > near;
  const ux = go ? dx / d : 0;
  const uz = go ? dz / d : 0;
  bot.controls.hold('KeyD', ux > 0.38);
  bot.controls.hold('KeyA', ux < -0.38);
  bot.controls.hold('KeyS', uz > 0.38);
  bot.controls.hold('KeyW', uz < -0.38);
  bot.controls.hold('ShiftLeft', go && turbo && mind.boost);
  if (go) face(bot, dx, dz);
}

function stop(bot: Bot) {
  for (const k of KEYS) bot.controls.hold(k, false);
}

/** Turn to face along a direction on the floor (yaw 0 looks toward -z). */
function face(bot: Bot, dx: number, dz: number) {
  if (Math.abs(dx) + Math.abs(dz) < 1e-4) return;
  bot.controls.look(Math.atan2(-dx, -dz), 0);
}

function think(game: Game, m: Match, b: Baller, bot: Bot, mind: Mind, now: number) {
  const s = jamOf(bot);
  // Their level now (people come and go, the score moves, the room changes it).
  const level = levelOf(m, b);
  mind.level = level;
  mind.skill = level.skill[0] + mind.talent * (level.skill[1] - level.skill[0]);
  if (now >= mind.boostAt) {
    mind.boostAt = now + 0.8 + Math.random();
    mind.boost = Math.random() < level.turbo;
  }
  // A tap of shoot lasts one tick.
  if (mind.tap > 0) {
    mind.tap--;
    if (mind.tap === 0 && !mind.shooting) bot.controls.hold('Space', false);
  }
  if (bot.controls && (m.phase === 'break' || m.phase === 'over' || s.stun > 0 || bot.frozen)) {
    stop(bot);
    if (mind.shooting) {
      mind.shooting = false;
      bot.controls.hold('Space', false);
    }
    return;
  }
  // A jump shot under way: let go at the moment chosen.
  if (mind.shooting) {
    const r = rim(b.team.side);
    face(bot, r.x - bot.position.x, r.z - bot.position.z);
    if (now >= mind.releaseAt || s.air !== 1) {
      mind.shooting = false;
      bot.controls.hold('Space', false);
    }
    return;
  }
  const ball = m.ball;
  const holder = ball.mode === 'held' ? ball.holder : null;
  if (holder === b && !mind.had) newPlan(b, mind);
  mind.had = holder === b;
  if (holder === b) return offenseWithBall(game, m, b, bot, mind, now);
  if (ball.mode === 'flight' || (ball.mode === 'dead' && !ball.inbound && m.phase === 'tip')) return chase(game, m, b, bot, mind, now);
  if (ball.mode === 'dead') {
    const side = b.team.side;
    const t = ball.inbound;
    if (t === b.team) {
      // Ours to take out: the nearer to our baseline goes for it, the other comes back to get it.
      const spot = inboundSpot(t);
      const d = (x: Baller) => Math.hypot(x.player.position.x - spot.x, x.player.position.z - spot.z);
      const takes = [...t.ballers].sort((x, y) => d(x) - d(y))[0] === b;
      const to = takes ? spot : { x: -side * (HALF_LENGTH - 6), z: -2.5 };
      runTo(bot, mind, to, Math.hypot(to.x - bot.position.x, to.z - bot.position.z) > 4, 0.4);
    } else {
      // Theirs: back on defense, in our half.
      const to = { x: -side * 7.5, z: b === b.team.ballers[0] ? -2 : 2.5 };
      runTo(bot, mind, to, Math.hypot(to.x - bot.position.x, to.z - bot.position.z) > 4, 0.8);
    }
    return;
  }
  if (holder && holder.team === b.team) return offenseOffBall(game, m, b, bot, mind, now, holder);
  if (holder) return defend(game, m, b, bot, mind, now, holder);
  stop(bot);
}

/** Tap shoot this tick (a leap, a dunk). */
function tap(bot: Bot, mind: Mind) {
  bot.controls.hold('Space', true);
  mind.tap = 2;
}

/** A possession's idea: mostly at the rim, often a pull-up, now and then from downtown. */
function newPlan(b: Baller, mind: Mind) {
  const r = Math.random();
  const side = b.team.side;
  const c = rim(side);
  mind.plan = r < 0.45 ? 'drive' : r < 0.78 ? 'jumper' : 'three';
  if (mind.plan === 'drive') mind.planSpot = null;
  else {
    const ang = (Math.random() - 0.5) * Math.PI * 0.85;
    const dist = mind.plan === 'three' ? 7.2 : 4.2 + Math.random() * 1.8;
    mind.planSpot = { x: c.x - side * Math.cos(ang) * dist, z: Math.max(-HALF_WIDTH + 0.8, Math.min(HALF_WIDTH - 0.8, Math.sin(ang) * dist)) };
  }
}

function offenseWithBall(_game: Game, m: Match, b: Baller, bot: Bot, mind: Mind, now: number) {
  const s = jamOf(bot);
  if (s.air !== 0) return stop(bot);
  const side = b.team.side;
  const r = rim(side);
  const p = bot.position;
  const d = fromRim(side, p.x, p.z);
  const foes = otherTeam(m, b.team).ballers;
  let guard = Infinity;
  let guardAt = { x: 0, z: 0 };
  for (const f of foes) {
    const q = f.player.position;
    const gd = Math.hypot(q.x - p.x, q.z - p.z);
    if (gd < guard) {
      guard = gd;
      guardAt = q;
    }
  }
  const mate = b.team.ballers.find((x) => x !== b);
  if (now >= mind.thinkAt) {
    mind.thinkAt = now + 0.18 + (1 - mind.skill) * 0.25 + mind.level.slow;
    // A teammate leaping at the rim: lob it up.
    if (mate) {
      const ms = jamOf(mate.player);
      const mp = mate.player.position;
      if (ms?.air === 2 && fromRim(side, mp.x, mp.z) < 3.2) {
        bot.controls.press('KeyE');
        return;
      }
    }
    // The shot clock's running out: whatever's there.
    const hurry = m.shotClock < 3.5 || (m.clock < 3 && m.phase === 'live');
    // The lane's open (or they're on fire): to the rim for a dunk.
    const fire = s.fire === 1;
    const laneOpen = guard > 1.6 || fire || Math.random() < 0.08;
    if (mind.plan === 'drive' && d < DUNK_RANGE * 0.92 && laneOpen && (s.turbo > 0.15 || fire) && (fire || Math.random() < 0.3 + 0.7 * mind.level.turbo)) {
      bot.controls.hold('ShiftLeft', true);
      tap(bot, mind);
      return;
    }
    // Room for a jumper: at their spot (a pull-up, a three), or anywhere in range when it's open.
    const range = fire ? 9 : guard > 2.4 && Math.random() < 0.45 ? 8.6 : 7.2;
    const atSpot = mind.planSpot ? Math.hypot(p.x - mind.planSpot.x, p.z - mind.planSpot.z) < 0.9 : false;
    const wide = mind.plan !== 'drive' && (atSpot ? guard > 1.1 || Math.random() < 0.3 : false);
    if (wide || (mind.plan === 'drive' && d < range && guard > 2.2 && Math.random() < 0.18 + mind.skill * 0.2) || hurry) {
      mind.shooting = true;
      // Let go near the top, as well as their skill allows.
      const miss = (Math.random() - 0.5) * 0.3 * (1.2 - mind.skill);
      mind.releaseAt = now + SHOT_APEX + miss;
      bot.controls.hold('ShiftLeft', false);
      bot.controls.hold('Space', true);
      stop(bot);
      face(bot, r.x - p.x, r.z - p.z);
      return;
    }
    // Hounded, and the teammate's open: pass.
    if (mate && guard < 1.2 && Math.random() < 0.4) {
      const mp = mate.player.position;
      let open = Infinity;
      for (const f of foes) open = Math.min(open, Math.hypot(f.player.position.x - mp.x, f.player.position.z - mp.z));
      if (open > 1.8) {
        bot.controls.press('KeyE');
        return;
      }
    }
  }
  // To their spot for a jumper or a three; else drive at the rim, swerving round the man in the way.
  if (mind.planSpot) {
    runTo(bot, mind, mind.planSpot, s.turbo > 0.4 && guard < 2, 0.4);
    // Taking too long: drive instead.
    if (m.shotClock < 9) mind.planSpot = null;
    return;
  }
  let tx = r.x - side * 0.8;
  let tz = r.z;
  if (guard < 2.5) {
    const away = Math.sign(p.z - guardAt.z) || (Math.random() < 0.5 ? 1 : -1);
    tz += away * 2.2;
  }
  tz = Math.max(-HALF_WIDTH + 1, Math.min(HALF_WIDTH - 1, tz));
  runTo(bot, mind, { x: tx, z: tz }, s.turbo > 0.35 && (guard > 1.5 || d > 9), 0.5);
}

function offenseOffBall(_game: Game, _m: Match, b: Baller, bot: Bot, mind: Mind, now: number, holder: Baller) {
  const side = b.team.side;
  const r = rim(side);
  const p = bot.position;
  const s = jamOf(bot);
  // A cut to the rim, and a leap for the lob when the holder's driving or stuck.
  const near = fromRim(side, p.x, p.z);
  if (near < 3 && s.air === 0 && now - mind.leaptAt > 2.5 && Math.random() < 0.02 + mind.skill * 0.02) {
    mind.leaptAt = now;
    bot.controls.hold('ShiftLeft', true);
    tap(bot, mind);
    return;
  }
  if (!mind.spot || now >= mind.spotUntil) {
    // An open spot: a wing, a corner, the top, or a cut, away from the holder.
    const spots = [
      { x: r.x - side * 5, z: 4.5 },
      { x: r.x - side * 5, z: -4.5 },
      { x: r.x - side * 1.4, z: 6.2 },
      { x: r.x - side * 1.4, z: -6.2 },
      { x: r.x - side * 7.2, z: 0 },
      { x: r.x - side * 1.6, z: 0.8 },
    ];
    const hp = holder.player.position;
    const scored = spots.map((q) => Math.hypot(q.x - hp.x, q.z - hp.z) + Math.random() * 3);
    mind.spot = spots[scored.indexOf(Math.max(...scored))];
    mind.spotUntil = now + 2 + Math.random() * 2.5;
  }
  runTo(bot, mind, mind.spot, false, 0.6);
}

function defend(_game: Game, m: Match, b: Baller, bot: Bot, mind: Mind, now: number, holder: Baller) {
  const p = bot.position;
  const s = jamOf(bot);
  const mates = b.team.ballers;
  const foes = otherTeam(m, b.team).ballers;
  // Who's whose: the nearer of the two to the ball guards it, the other his man.
  const hp = holder.player.position;
  const dist = (x: Baller) => Math.hypot(x.player.position.x - hp.x, x.player.position.z - hp.z);
  const onBall = [...mates].sort((x, y) => dist(x) - dist(y))[0] === b;
  const man = onBall ? holder : (foes.find((f) => f !== holder) ?? holder);
  const mp = man.player.position;
  const home = rim(-b.team.side as Side);
  // Between the man and the basket we defend.
  const dx = home.x - mp.x;
  const dz = home.z - mp.z;
  const dd = Math.hypot(dx, dz) || 1;
  const L = mind.level;
  const gap = onBall ? L.gap : 2.2 + (L.gap - 1.1) * 0.5;
  const at = { x: mp.x + (dx / dd) * gap, z: mp.z + (dz / dd) * gap };
  const far = Math.hypot(at.x - p.x, at.z - p.z);
  runTo(bot, mind, at, far > 3 && s.turbo > 0.3, 0.3);
  face(bot, mp.x - p.x, mp.z - p.z);
  if (!onBall) return;
  const hs = jamOf(holder.player);
  const close = Math.hypot(hp.x - p.x, hp.z - p.z);
  // A leap at a shot going up, or a dunk coming in.
  if (s.air === 0 && now - mind.leaptAt > 0.8) {
    if ((hs.air === 1 && hs.t < 0.22 && close < 1.6 && Math.random() < (0.08 + mind.skill * 0.08) * L.leap) || (hs.air === 3 && close < 2.6 && Math.random() < (0.03 + mind.skill * 0.04) * L.leap)) {
      mind.leaptAt = now;
      tap(bot, mind);
      return;
    }
  }
  // A swipe, now and then; a shove, more rarely.
  if (close < 1.5 && hs.air === 0 && Math.random() < (0.006 + mind.skill * 0.01) * L.steal) bot.controls.press('KeyE');
  else if (close < 1.8 && Math.random() < (0.004 + mind.skill * 0.004) * L.shove && s.turbo > 0.3) {
    bot.controls.hold('ShiftLeft', true);
    bot.controls.press('KeyE');
  }
}

/** A loose ball, a rebound, a tip: the nearer of each side goes for it, leaping if it's high. */
function chase(_game: Game, m: Match, b: Baller, bot: Bot, mind: Mind, now: number) {
  const ball = m.ball;
  const at = ballPos(m);
  const p = bot.position;
  const s = jamOf(bot);
  const mates = b.team.ballers;
  const d = (x: Baller) => Math.hypot(x.player.position.x - at.x, x.player.position.z - at.z);
  const nearest = [...mates].sort((x, y) => d(x) - d(y))[0] === b;
  // A shot still going up: the rebound's where it'll come down, near the rim.
  if (ball.kind === 'shot' && !ball.touched && ball.by) {
    const side = ball.by.team.side;
    const r = rim(side);
    const off = ball.by.team === b.team;
    const spot = { x: r.x - side * (off ? 1.6 : 1.1), z: (b === mates[0] ? -1 : 1) * 1.4 };
    runTo(bot, mind, spot, false, 0.4);
    face(bot, r.x - p.x, r.z - p.z);
    return;
  }
  if (!nearest && ball.kind !== 'tip') {
    // The other drops back a little toward the basket we defend.
    runTo(bot, mind, { x: -b.team.side * 5, z: 0 }, false, 1);
    return;
  }
  runTo(bot, mind, at, Math.hypot(at.x - p.x, at.z - p.z) > 3 && s.turbo > 0.2, 0.2);
  // Leap for it if it's above their reach and right there.
  const high = at.y - p.y;
  if (s.air === 0 && high > 2.3 && high < 4.2 && Math.hypot(at.x - p.x, at.z - p.z) < 1.4 && now - mind.leaptAt > 0.7) {
    mind.leaptAt = now;
    tap(bot, mind);
  }
}
