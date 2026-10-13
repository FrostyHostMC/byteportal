import { defineServer, Models, type Bot, type GameContext as Game, type Player } from '@platform';
import { advance, arc, launch, shotTime, type BallEvent } from './ball';
import { bots } from './bots';
import { BALL_RADIUS, FLOOR, fromRim, isThree, rim, RIM_HEIGHT, type Side } from './court';
import { defineHud, resetHud, showHud } from './hud';
import { LEVELS, type LevelId } from './levels';
import { allBallers, ballPos, inboundSpot, jamOf, levelOf, otherTeam, type Baller, type Match, type Team } from './match';
import { DUNK_STYLES, releaseError } from './moves';
import { definePick, PICK, pickData } from './pick';
import { MSG, type BallMsg, type BallersMsg, type CallMsg, type FlightKind, type MomentMsg } from './protocol';
import { shared } from './shared';
import { botLook, TEAMS, uniformOf, type TeamDef } from './teams';

/**
 * Block Jam's rules: two on two, people and bots (bots fill the empty places, and give way when a
 * person joins: each picks their team on the team screen, `pick.ts`, and the first person in
 * starts a new game), four quarters of two minutes, a 24-second shot clock, no fouls. The ball is the
 * server's: who holds it, its flights (shots, passes, swats, loose balls: `ball.ts`, played out the
 * same on every screen), rebounds, steals, shoves, blocks, baskets. Three in a row and a baller
 * catches fire.
 */

/** A quarter's length (seconds of play), overtime's, the shot clock's. */
const QUARTER = 120;
const OVERTIME = 60;
const SHOT_CLOCK = 24;
/** How long the ball's dead after a basket, before the other side inbounds it. */
const DEAD_AFTER_SCORE = 1.5;
/** Ballers a side. */
const PER_TEAM = 2;

let m: Match;
/** (Only while a new game's setting up is there no match.) */
/** People waiting for a place (both teams full of people). */
const waiting = new Set<Player>();
/** People who haven't picked a team yet (the team screen's up), and people who'd rather watch. */
const choosing = new Set<Player>();
const watching = new Set<Player>();
/** Who has the team screen up (it's kept current for them). */
const picking = new Set<Player>();
/** The team each person last played for (the next game puts them there again). */
const prefs = new Map<Player, string>();
/** How hard the bots play against people (the room's: kept from game to game). */
let level: LevelId = 'pro';
/** Which visitors come to town next. */
let visitors = 1;
let tick = 0;

export default defineServer(shared, {
  // The bots play while people watch from the home page; Play puts them on the floor.
  autoStart: true,
  setup(game) {
    defineHud(game);
    // The arena's pieces, as items each screen draws (their looks are its: `client/looks.ts`).
    for (const [id, name] of [
      ['jam_ball', 'Ball'],
      ['jam_hoop', 'Basket'],
      ['jam_net', 'Net'],
      ['jam_court', 'Court'],
      ['jam_shadow', 'Shadow'],
    ]) game.items.define(id, { kind: 'misc', name, icon: { block: 'orange_concrete' } });
    definePick(game, {
      team: (p, id) => take(game, p, id),
      level: (p, id) => setLevel(game, p, id),
      watch: (p) => watch(game, p),
      close: (p) => {
        picking.delete(p);
        // Closed without picking: wherever there's room.
        if (choosing.has(p)) take(game, p);
      },
    });
    game.events.on('playerJoin', ({ player }) => {
      if (player.bot) return;
      // Watching till they pick a team.
      choosing.add(player);
      player.spectate(true);
    });
    game.events.on('playerLeave', ({ player }) => leave(game, player));
    game.events.on('playerReady', ({ player }) => {
      // Their camera off their eyes (so their own figure's drawn); the screen's broadcast camera takes it from there.
      player.camera.orbit(player, { distance: 4, min: 4, max: 4, wheel: false });
      if (choosing.has(player)) showPick(game, player);
    });
    game.events.on('ability', ({ player, name }) => {
      if (m) onAbility(game, player, name);
    });
  },

  start(game) {
    waiting.clear();
    resetHud();
    // The last game's bots go (a restart keeps players, bots and all); the new game makes its own.
    // (No match meanwhile, so their leaving doesn't refill the old one.)
    (m as Match | undefined) = undefined;
    for (const b of [...game.bots.all]) game.bots.remove(b);
    bots.clear();
    tick = 0;
    picking.clear();
    const people = game.players.filter((p) => !p.bot);
    const [home, away] = matchup(people);
    m = {
      teams: [makeTeam(0, home, 1), makeTeam(1, away, -1)],
      ball: { mode: 'dead', holder: null, flight: null, launchedAt: 0, kind: 'tip', by: null, points: 0, to: null, touched: false, deadUntil: 0, inbound: null, dunker: null, tried: new Set() },
      phase: 'tip',
      quarter: 1,
      clock: QUARTER,
      shotClock: SHOT_CLOCK,
      phaseUntil: game.clock.now + 2.5,
      nextPossession: 1,
      level,
    };
    game.hud.crosshair(false);
    // Whoever's here already takes the floor, for the team they last played for; bots fill the rest.
    // (Anyone still picking, or watching, watches; a restart took the team screen down.)
    for (const p of people) {
      if (choosing.has(p) || watching.has(p)) p.spectate(true);
      else join(game, p, m.teams.find((t) => t.def.id === prefs.get(p)));
    }
    fill(game);
    tipOff(game);
    for (const p of choosing) showPick(game, p);
    // In development, tests reach in (`__game.dev('__jam.give(me)')`).
    if (import.meta.env.DEV) (globalThis as unknown as { __jam: unknown }).__jam = { get match() { return m; }, give: (p: Player) => { const b = ballerOf(p); if (b) { m.phase = 'live'; for (const x of allBallers(m)) x.player.freeze(false); giveBall(game, b); } }, pass: (p: Player) => { const b = ballerOf(p); if (b) pass(game, b); } };
  },

  update(game, dt) {
    if (!m) return;
    tick++;
    const now = game.clock.now;
    // Each baller's state as the game sees it: which way they attack, the ball, fire.
    for (const b of allBallers(m)) {
      const s = jamOf(b.player);
      if (!s) continue;
      s.side = b.team.side;
      s.ball = m.ball.mode === 'held' && m.ball.holder === b ? 1 : 0;
      s.fire = b.fireMakes > 0 || b.streak >= 3 ? 1 : 0;
      s.pace = b.player.bot ? levelOf(m, b).pace : 1;
    }
    // The team screen: on M, and kept current while it's up.
    for (const p of game.players) if (!p.bot && p.input.pressed('KeyM')) showPick(game, p);
    if (tick % 10 === 0) for (const p of picking) showPick(game, p);
    phaseStep(game, dt, now);
    if (m.phase === 'live' || m.phase === 'tip') {
      ballStep(game, now);
      inputs(game, now);
    }
    bots.update(game, m, dt);
    if (tick % 3 === 0) game.clients.send('all', MSG.ballers, ballers());
    // Who has the ball, again now and then: for screens that came in since it changed hands.
    if (tick % 30 === 2 && m.ball.mode === 'held' && m.ball.holder) sendBall(game, { h: m.ball.holder.player.id, ...(m.ball.dunker === m.ball.holder ? { dunk: true } : {}) });
    showHud(game, m);
  },
});

// -------------------------------------------------------------------------------------------------
// The roster: people, and bots in the empty places
// -------------------------------------------------------------------------------------------------

function makeTeam(index: 0 | 1, def: TeamDef, side: Side): Team {
  return { index, def, side, ballers: [], score: 0 };
}

function newBaller(player: Player, team: Team): Baller {
  return { player, team, pts: 0, reb: 0, ast: 0, stl: 0, blk: 0, dunks: 0, threes: 0, streak: 0, fireMakes: 0, stealAt: 0, shoveAt: 0, passedAt: -9, passedTo: null };
}

/** The two teams for a new game: the ones people last played for, else the home side and the next visitors. */
function matchup(people: Player[]): [TeamDef, TeamDef] {
  const wanted: TeamDef[] = [];
  for (const p of people) {
    if (choosing.has(p) || watching.has(p)) continue;
    const d = TEAMS.find((t) => t.id === prefs.get(p));
    if (d && !wanted.includes(d)) wanted.push(d);
  }
  const home = wanted[0] ?? TEAMS[0];
  let away = wanted[1];
  while (!away || away === home) away = TEAMS[visitors++ % TEAMS.length];
  return [home, away];
}

/** People on the floor (on either team), besides `but`. */
const playing = (but?: Player) => allBallers(m).filter((b) => !b.player.bot && b.player !== but);

/**
 * A person takes the floor: for the team they picked (`id`), or wherever there's room. The first
 * person in starts a new game (the bots' game on show makes way). A team that isn't in this game
 * takes over a side nobody else plays on (theirs first), in its colours, with its own bench.
 */
function take(game: Game, player: Player, id?: string) {
  if (!m) return;
  const def = id ? TEAMS.find((t) => t.id === id) : undefined;
  if (id && !def) return;
  const mine = ballerOf(player);
  if (!mine && !playing().length) {
    choosing.delete(player);
    watching.delete(player);
    if (def) prefs.set(player, def.id);
    else prefs.delete(player);
    closePick(player);
    game.restart();
    return;
  }
  let team = def ? m.teams.find((t) => t.def === def) : undefined;
  if (def && !team) {
    const free = (t: Team) => !t.ballers.some((b) => !b.player.bot && b.player !== player);
    team = mine && free(mine.team) ? mine.team : m.teams.find(free);
    if (!team) {
      player.hud.toast('Both teams have people on them: join one');
      return;
    }
    rebrand(game, team, def);
  }
  if (join(game, player, team)) closePick(player);
}

/**
 * Onto the floor for `want` (or the side with fewer people), a bot giving way; both full of people,
 * they wait, watching. True if they're on the floor now.
 */
function join(game: Game, player: Player, want?: Team): boolean {
  if (!m) return false;
  const current = ballerOf(player);
  const people = (t: Team) => t.ballers.filter((b) => !b.player.bot && b.player !== player).length;
  const [a, b] = m.teams;
  let team = want ?? (people(a) <= people(b) ? a : b);
  if (people(team) >= PER_TEAM) {
    if (want) {
      player.hud.toast(`The ${team.def.name} are full`);
      return !!current;
    }
    team = otherTeam(m, team);
    if (people(team) >= PER_TEAM) {
      if (current) return true;
      waiting.add(player);
      choosing.delete(player);
      player.spectate(true);
      return false;
    }
  }
  choosing.delete(player);
  watching.delete(player);
  waiting.delete(player);
  prefs.set(player, team.def.id);
  if (current?.team === team) return true;
  player.spectate(false);
  if (current) removeBaller(game, current, false);
  // A bot on that side makes room (where it stood is where they come on).
  const bot = team.ballers.find((x) => x.player.bot);
  let at = { x: -team.side * 4, y: FLOOR, z: 3 };
  if (bot) {
    at = { ...bot.player.position };
    removeBaller(game, bot);
  }
  const baller = newBaller(player, team);
  team.ballers.push(baller);
  dress(player, team);
  player.teleport(at, team.side > 0 ? -Math.PI / 2 : Math.PI / 2);
  if (m.phase === 'tip' || m.phase === 'over') player.freeze(true);
  fill(game);
  return true;
}

function dress(player: Player, team: Team) {
  player.setUniform(uniformOf(team.def));
  player.color = team.def.color;
  // Their camera off their eyes (so their own figure's drawn; a restart puts it back on them): the
  // screen's broadcast camera takes it from there.
  player.camera.orbit(player, { distance: 4, min: 4, max: 4, wheel: false });
}

/** A side changes teams (the score stays the side's): its people in the new colours, its bots off for the new bench. */
function rebrand(game: Game, team: Team, def: TeamDef) {
  team.def = def;
  for (const b of [...team.ballers]) {
    if (b.player.bot) removeBaller(game, b);
    else dress(b.player, team);
  }
  fill(game);
  call(game, { text: `${def.city} ${def.name}`.toUpperCase(), sub: 'Take the floor', color: def.color, roar: 0.4 });
}

/** Off the floor to watch (a bot takes their place, or someone waiting). */
function watch(game: Game, player: Player) {
  const mine = ballerOf(player);
  choosing.delete(player);
  waiting.delete(player);
  watching.add(player);
  closePick(player);
  player.spectate(true);
  if (!mine) return;
  removeBaller(game, mine, false);
  const next = [...waiting][0];
  if (next) join(game, next);
  fill(game);
}

function setLevel(game: Game, player: Player, id: string) {
  if (!(id in LEVELS) || id === level) return;
  level = id as LevelId;
  if (m) m.level = level;
  game.hud.feed(`${player.name} set the bots to ${LEVELS[level].name}`, { color: '#ffd23f' });
  for (const p of picking) showPick(game, p);
}

/** The team screen, up (or kept current) on a person's screen. */
function showPick(game: Game, player: Player) {
  if (!m || player.bot || !game.players.includes(player)) return;
  picking.add(player);
  player.hud.widget(PICK, pickData(m, player, { watching: watching.has(player), perTeam: PER_TEAM }));
}

function closePick(player: Player) {
  if (!picking.delete(player)) return;
  player.hud.widget(PICK).remove();
}

function leave(game: Game, player: Player) {
  waiting.delete(player);
  choosing.delete(player);
  watching.delete(player);
  picking.delete(player);
  prefs.delete(player);
  if (!m) return;
  const b = allBallers(m).find((x) => x.player === player);
  if (!b) return;
  removeBaller(game, b, false);
  // Someone waiting takes their place, or a bot.
  const next = [...waiting][0];
  if (next) join(game, next);
  fill(game);
}

function removeBaller(game: Game, b: Baller, removeBot = true) {
  const t = b.team;
  t.ballers = t.ballers.filter((x) => x !== b);
  // The ball doesn't leave with them.
  if (m.ball.holder === b) {
    const p = b.player.position;
    loose(game, { x: p.x, y: p.y + 1.2, z: p.z }, { x: 0, y: 2, z: 0 });
  }
  if (m.ball.dunker === b) m.ball.dunker = null;
  if (m.ball.to === b) m.ball.to = null;
  if (removeBot && b.player.bot) game.bots.remove(b.player as Bot);
  bots.forget(b);
}

/** Bots in every empty place. */
function fill(game: Game) {
  for (const t of m.teams) {
    while (t.ballers.length < PER_TEAM) {
      const used = new Set(allBallers(m).map((b) => b.player.name));
      const pick = t.def.bench.find((x) => !used.has(x.name)) ?? { name: `${t.def.name} ${t.ballers.length + 1}`, look: {} };
      const bot = game.bots.add(pick.name);
      bot.setModel(Models.character(botLook(t.def, pick.look)));
      bot.color = t.def.color;
      const baller = newBaller(bot, t);
      t.ballers.push(baller);
      bot.teleport({ x: -t.side * (3 + t.ballers.length * 2), y: FLOOR, z: t.ballers.length === 1 ? -2 : 3 }, t.side > 0 ? -Math.PI / 2 : Math.PI / 2);
      if (m.phase === 'tip' || m.phase === 'over') bot.freeze(true);
      bots.add(m, baller);
    }
  }
}

// -------------------------------------------------------------------------------------------------
// The phases: tip-off, play, the breaks between quarters, the final buzzer
// -------------------------------------------------------------------------------------------------

/** Everyone to their places at centre court, then the ball goes up. */
function tipOff(game: Game) {
  m.phase = 'tip';
  m.phaseUntil = game.clock.now + 2.6;
  m.ball = { ...m.ball, mode: 'dead', holder: null, flight: null, dunker: null, inbound: null, deadUntil: Infinity };
  for (const t of m.teams) {
    t.ballers.forEach((b, i) => {
      const at = i === 0 ? { x: -t.side * 1.1, y: FLOOR, z: 0 } : { x: -t.side * 5, y: FLOOR, z: t.side * 3.5 };
      b.player.teleport(at, t.side > 0 ? -Math.PI / 2 : Math.PI / 2);
      b.player.freeze(true);
    });
  }
  call(game, { text: m.quarter === 1 ? 'TIP-OFF' : quarterName(m.quarter), sub: `${m.teams[0].def.city} ${m.teams[0].def.name} vs ${m.teams[1].def.city} ${m.teams[1].def.name}`, color: '#ffd23f', roar: 0.4 });
}

function phaseStep(game: Game, dt: number, now: number) {
  switch (m.phase) {
    case 'tip':
      if (now >= m.phaseUntil && m.ball.mode === 'dead') {
        for (const b of allBallers(m)) b.player.freeze(false);
        m.phase = 'live';
        // Up it goes, between the two at centre court.
        throwBall(game, 'tip', { x: 0, y: FLOOR + 2.2, z: 0 }, { x: 0, y: 9.5, z: 0 }, null);
        moment(game, { k: 'tip' });
      }
      break;
    case 'live': {
      m.clock = Math.max(0, m.clock - dt);
      const b = m.ball;
      const shotInAir = b.mode === 'flight' && b.kind === 'shot' && !b.touched;
      if (!shotInAir && b.mode !== 'dead') m.shotClock = Math.max(0, m.shotClock - dt);
      if (m.shotClock <= 0 && b.mode !== 'dead' && m.clock > 0) {
        const off = b.holder?.team ?? b.by?.team ?? null;
        moment(game, { k: 'buzzer', what: 'shotclock' });
        call(game, { text: 'SHOT CLOCK', sub: 'Turnover', color: '#ff3b30' });
        dead(game, off ? otherTeam(m, off) : m.teams[0], 1.2);
      }
      // The quarter's over once the clock's out and any shot already up has come down.
      if (m.clock <= 0 && !shotInAir) endQuarter(game);
      break;
    }
    case 'break':
      if (now >= m.phaseUntil) startQuarter(game);
      break;
    case 'over':
      if (now >= m.phaseUntil) game.restart();
      break;
  }
  // A dead ball comes back to life: inbounded to its side.
  if (m.ball.mode === 'dead' && m.ball.inbound && now >= m.ball.deadUntil) inbound(game, m.ball.inbound);
}

function quarterName(q: number): string {
  return q <= 4 ? ['', '1ST QUARTER', '2ND QUARTER', '3RD QUARTER', '4TH QUARTER'][q] : q === 5 ? 'OVERTIME' : `OVERTIME ${q - 4}`;
}

function endQuarter(game: Game) {
  const [a, b] = m.teams;
  moment(game, { k: 'buzzer', what: m.quarter >= 4 && a.score !== b.score ? 'game' : 'quarter' });
  m.ball = { ...m.ball, mode: 'dead', holder: null, dunker: null, inbound: null, deadUntil: Infinity };
  sendBall(game, { f: [0, -50, 0, 0, 0, 0], k: 'loose' });
  if (m.quarter >= 4 && a.score !== b.score) return gameOver(game);
  m.phase = 'break';
  m.phaseUntil = game.clock.now + (m.quarter === 2 ? 6 : 4);
  call(game, { text: m.quarter === 2 ? 'HALFTIME' : m.quarter >= 4 ? 'TIED UP!' : `END OF THE ${['', '1ST', '2ND', '3RD'][m.quarter]}`, sub: `${a.def.abbr} ${a.score} · ${b.def.abbr} ${b.score}`, color: '#ffd23f', roar: 0.5 });
}

function startQuarter(game: Game) {
  m.quarter++;
  m.clock = m.quarter <= 4 ? QUARTER : OVERTIME;
  m.shotClock = SHOT_CLOCK;
  m.phase = 'live';
  const t = m.teams[m.nextPossession];
  m.nextPossession = m.nextPossession === 0 ? 1 : 0;
  // Back to their own halves; the side whose turn it is brings it up.
  for (const team of m.teams) {
    team.ballers.forEach((b, i) => b.player.teleport({ x: -team.side * (4 + i * 3), y: FLOOR, z: i === 0 ? -2 : 3 }, team.side > 0 ? -Math.PI / 2 : Math.PI / 2));
  }
  call(game, { text: quarterName(m.quarter), color: '#ffd23f', roar: 0.4 });
  giveBall(game, t.ballers[0]);
}

function gameOver(game: Game) {
  m.phase = 'over';
  m.phaseUntil = game.clock.now + 14;
  const [a, b] = m.teams;
  const winner = a.score > b.score ? a : b;
  const loser = otherTeam(m, winner);
  for (const x of allBallers(m)) x.player.freeze(true);
  for (const x of winner.ballers) {
    if (x.player.bot) continue;
    x.player.achieve('winner');
    if (winner.score - loser.score >= 15) x.player.achieve('blowout');
  }
  const mvp = allBallers(m).sort((x, y) => y.pts + y.reb * 0.5 + y.ast * 0.7 + y.stl + y.blk - (x.pts + x.reb * 0.5 + x.ast * 0.7 + x.stl + x.blk))[0];
  call(game, { text: `${winner.def.name.toUpperCase()} WIN!`, sub: `${a.def.abbr} ${a.score} · ${b.def.abbr} ${b.score}${mvp ? ` · MVP ${mvp.player.name} (${mvp.pts} pts)` : ''}`, color: winner.def.color, roar: 1 });
}

// -------------------------------------------------------------------------------------------------
// The ball
// -------------------------------------------------------------------------------------------------

function sendBall(game: Game, msg: BallMsg) {
  game.clients.send('all', MSG.ball, msg);
}

function moment(game: Game, msg: MomentMsg) {
  game.clients.send('all', MSG.moment, msg);
}

function call(game: Game, msg: CallMsg) {
  game.clients.send('all', MSG.call, msg);
}

/** Into someone's hands. The shot clock starts over when it changes sides. */
function giveBall(game: Game, b: Baller | undefined) {
  if (!b) return;
  const before = m.ball.holder?.team ?? m.ball.by?.team ?? null;
  m.ball = { ...m.ball, mode: 'held', holder: b, flight: null, to: null, dunker: null, inbound: null, deadUntil: 0, touched: false, tried: new Set() };
  if (before !== b.team) m.shotClock = SHOT_CLOCK;
  sendBall(game, { h: b.player.id });
}

/** Into the air. */
function throwBall(game: Game, kind: FlightKind, from: { x: number; y: number; z: number }, v: { x: number; y: number; z: number }, by: Baller | null, extra: Partial<Match['ball']> = {}) {
  m.ball = {
    ...m.ball,
    mode: 'flight',
    holder: null,
    flight: launch(from.x, from.y, from.z, v.x, v.y, v.z),
    launchedAt: game.clock.now,
    kind,
    by,
    points: 0,
    to: null,
    touched: kind !== 'shot',
    dunker: null,
    inbound: null,
    tried: new Set(),
    ...extra,
  };
  sendBall(game, { f: [from.x, from.y, from.z, v.x, v.y, v.z], k: kind, by: by?.player.id, fire: by ? jamOf(by.player)?.fire === 1 : false });
}

function loose(game: Game, from: { x: number; y: number; z: number }, v: { x: number; y: number; z: number }) {
  throwBall(game, 'loose', from, v, null);
}

/** The ball's dead (after a basket, a violation); `team` inbounds it after `after` seconds. */
function dead(game: Game, team: Team, after: number) {
  m.ball = { ...m.ball, mode: 'dead', holder: null, dunker: null, inbound: team, deadUntil: game.clock.now + after };
}

/**
 * The side inbounds from its own baseline: the one of them nearest the spot takes it there (put
 * back on it if they've wandered off up the floor: the ball starts at their end, not at the other).
 */
function inbound(game: Game, team: Team) {
  const spot = inboundSpot(team);
  const b = [...team.ballers].sort((x, y) => dist2(x.player.position, spot) - dist2(y.player.position, spot))[0];
  if (!b) return;
  if (flat(b.player.position, spot) > 2.5) b.player.teleport({ x: spot.x, y: FLOOR, z: spot.z }, team.side > 0 ? -Math.PI / 2 : Math.PI / 2);
  giveBall(game, b);
}

const dist2 = (a: { x: number; z: number }, b: { x: number; z: number }) => (a.x - b.x) ** 2 + (a.z - b.z) ** 2;
const flat = (a: { x: number; z: number }, b: { x: number; z: number }) => Math.sqrt(dist2(a, b));

function ballStep(game: Game, now: number) {
  const b = m.ball;
  if (b.mode === 'held' && b.holder) {
    const d = b.dunker;
    if (d) dunkStep(game, d);
    return;
  }
  if (b.mode !== 'flight' || !b.flight) return;
  const events: BallEvent[] = [];
  advance(b.flight, now - b.launchedAt, events);
  const f = b.flight;
  for (const e of events) if (e.kind === 'rim' || e.kind === 'board' || e.kind === 'floor') b.touched = true;
  // Coming down past the rim's height after its top: a rebound, anyone's.
  if (!b.touched && f.vy < 0 && f.y < FLOOR + RIM_HEIGHT - 0.4) b.touched = true;

  // A shot swatted in the air: someone leaping, their hands in its way, early in its flight.
  if (b.kind === 'shot' && !b.touched && now - b.launchedAt < 0.45 && b.by) {
    for (const x of otherTeam(m, b.by.team).ballers) {
      const s = jamOf(x.player);
      if (s?.air !== 2) continue;
      const p = x.player.position;
      const hand = { x: p.x, y: p.y + 2.45, z: p.z };
      if (Math.hypot(f.x - hand.x, f.y - hand.y, f.z - hand.z) < 0.72 && !b.tried.has(x)) {
        // One try each: the hand gets there, or just misses (a bot's level says how often, on a person's shot).
        b.tried.add(x);
        if (game.rng.range(0, 1) < swatChance(x, b.by)) {
          swat(game, x, b.by, { x: f.x, y: f.y, z: f.z });
          return;
        }
      }
    }
  }

  // Through the hoop.
  if (f.through && b.kind !== 'slam') {
    const team = m.teams.find((t) => t.side === f.through)!;
    const shot = b.kind === 'shot' && b.by?.team === team;
    const pts = shot ? b.points : 2;
    const how = shot ? (pts === 3 ? 'three' : 'shot') : 'tip';
    score(game, team, pts, shot ? b.by : null, how);
    return;
  }

  // Into someone's hands: a pass's receiver (or a thief in its way), a rebound, a loose ball.
  const grabbable = b.touched || b.kind === 'pass' || b.kind === 'loose' || b.kind === 'swat' || (b.kind === 'tip' && now - b.launchedAt > 0.35);
  if (!grabbable) return;
  let best: Baller | null = null;
  let bestD = Infinity;
  for (const x of allBallers(m)) {
    const s = jamOf(x.player);
    if (!s || s.stun > 0 || s.air >= 3) continue;
    // The passer can't catch their own pass (for a moment).
    if (b.kind === 'pass' && x === b.by && now - b.launchedAt < 0.5) continue;
    if (b.kind === 'shot' && x === b.by && now - b.launchedAt < 0.3) continue;
    const p = x.player.position;
    const reach = b.kind === 'pass' && x === b.to ? 1.3 : b.kind === 'pass' && x.team !== b.by?.team ? 0.7 : 0.95;
    const d = Math.hypot(f.x - p.x, f.z - p.z);
    if (d > reach) continue;
    if (f.y < p.y - 0.1 || f.y > p.y + 2.65) continue;
    if (d < bestD) {
      best = x;
      bestD = d;
    }
  }
  if (!best) return;
  const kind = b.kind;
  const passer = b.by;
  // An alley-oop: caught in the air near the rim off a teammate's pass.
  const s = jamOf(best.player);
  const p = best.player.position;
  if (kind === 'pass' && passer && passer.team === best.team && s.air === 2 && p.y > FLOOR + 0.7 && fromRim(best.team.side, p.x, p.z) < 3.4) {
    alleyOop(game, best, passer);
    return;
  }
  if (kind === 'shot' || (kind === 'loose' && f.y > FLOOR + 1.6)) best.reb++;
  if (kind === 'pass' && passer && passer.team !== best.team) {
    best.stl++;
    if (!best.player.bot) best.player.achieve('pickpocket');
    moment(game, { k: 'steal', by: best.player.id, from: passer.player.id });
    call(game, { text: 'PICKED OFF!', color: best.team.def.color });
  }
  giveBall(game, best);
}

/** How likely a leap that gets a hand to a shot swats it: a bot's level says, on a person's shot. */
function swatChance(blocker: Baller, shooter: Baller): number {
  return blocker.player.bot && !shooter.player.bot ? levelOf(m, blocker).swat : 0.55;
}

/** A swatted shot: away it goes, and the blocker's on the highlight reel. */
function swat(game: Game, blocker: Baller, shooter: Baller, at: { x: number; y: number; z: number }) {
  blocker.blk++;
  if (!blocker.player.bot) blocker.player.achieve('rejected');
  const sp = shooter.player.position;
  const dx = at.x - sp.x;
  const dz = at.z - sp.z;
  const d = Math.hypot(dx, dz) || 1;
  const side = (Math.round(game.rng.range(0, 1)) * 2 - 1) * 2.5;
  throwBall(game, 'swat', at, { x: (dx / d) * 7 + (-dz / d) * side, y: -2, z: (dz / d) * 7 + (dx / d) * side }, blocker);
  moment(game, { k: 'block', by: blocker.player.id, at: [at.x, at.y, at.z] });
  call(game, { text: game.rng.range(0, 1) < 0.5 ? 'REJECTED!' : 'GET THAT OUTTA HERE!', sub: blocker.player.name, color: blocker.team.def.color, roar: 0.8 });
}

/** Points on the board, and what follows: fire, the inbound. */
function score(game: Game, team: Team, pts: number, by: Baller | null, how: 'shot' | 'three' | 'dunk' | 'oop' | 'tip') {
  team.score += pts;
  const other = otherTeam(m, team);
  // The other side's fire goes out, their streaks too.
  for (const x of other.ballers) {
    if (x.fireMakes > 0 || x.streak >= 3) moment(game, { k: 'fire', who: x.player.id, on: false });
    x.streak = 0;
    x.fireMakes = 0;
  }
  let fire = false;
  if (by) {
    by.pts += pts;
    if (how === 'three') by.threes++;
    if (how === 'dunk' || how === 'oop') by.dunks++;
    const wasFire = by.fireMakes > 0 || by.streak >= 3;
    by.streak++;
    if (wasFire) by.fireMakes++;
    fire = wasFire;
    // An assist: their teammate passed it to them just before.
    const mate = team.ballers.find((x) => x !== by && x.passedTo === by && game.clock.now - x.passedAt < 4);
    if (mate) mate.ast++;
    if (!by.player.bot) {
      by.player.achieve('first_bucket');
      if (how === 'three') by.player.achieve('downtown');
      if (how === 'dunk') by.player.achieve('jam_session');
      if (how === 'oop') by.player.achieve('alley_oop');
    }
    if (!wasFire && by.streak === 3) {
      moment(game, { k: 'fire', who: by.player.id, on: true });
      call(game, { text: "HE'S ON FIRE!", sub: by.player.name, color: '#ff6b1a', roar: 1 });
      if (!by.player.bot) by.player.achieve('on_fire');
    } else if (wasFire && by.fireMakes >= 4) {
      // Four more baskets and the fire burns out on its own.
      by.streak = 0;
      by.fireMakes = 0;
      moment(game, { k: 'fire', who: by.player.id, on: false });
    } else if (!wasFire && by.streak === 2) {
      call(game, { text: 'HEATING UP...', sub: by.player.name, color: '#ffb02e', roar: 0.5 });
    }
  }
  moment(game, { k: 'score', team: team.index, pts, by: by?.player.id ?? '', how, fire, side: team.side });
  if (how === 'three') call(game, { text: 'FROM DOWNTOWN!', sub: by?.player.name, color: '#ffd23f', roar: 0.9 });
  else if (how === 'shot' && (by?.streak ?? 0) < 2 && game.rng.range(0, 1) < 0.35) call(game, { text: game.rng.range(0, 1) < 0.5 ? 'NOTHING BUT NET!' : 'COUNT IT!', color: '#ffffff', roar: 0.5 });
  dead(game, other, DEAD_AFTER_SCORE);
  m.shotClock = SHOT_CLOCK;
}

// -------------------------------------------------------------------------------------------------
// What the ballers do: shots, dunks, passes, steals, shoves
// -------------------------------------------------------------------------------------------------

function ballerOf(p: Player): Baller | undefined {
  return allBallers(m).find((b) => b.player === p);
}

function onAbility(game: Game, player: Player, name: string) {
  const b = ballerOf(player);
  if (!b || m.phase !== 'live') return;
  const s = jamOf(player);
  switch (name) {
    case 'release':
      if (m.ball.mode === 'held' && m.ball.holder === b) shoot(game, b, releaseError(s));
      break;
    case 'dunk':
      if (m.ball.mode === 'held' && m.ball.holder === b) {
        m.ball.dunker = b;
        sendBall(game, { h: player.id, dunk: true });
      }
      break;
    case 'slam':
      if (m.ball.mode === 'held' && m.ball.holder === b && m.ball.dunker === b) slam(game, b, s.style);
      break;
  }
}

/** A jump shot let go: how likely it goes in, and the arc that makes it (or doesn't). */
function shoot(game: Game, b: Baller, timing: number) {
  const p = b.player.position;
  const side = b.team.side;
  const r = rim(side);
  const d = fromRim(side, p.x, p.z);
  const three = isThree(side, p.x, p.z);
  const s = jamOf(b.player);
  // Its chance: by how far, how well timed, how closely guarded, how hot.
  let chance = d < 2 ? 0.72 : d < 4.5 ? 0.6 : d < 6.6 ? 0.5 : d < 8.5 ? 0.4 : d < 11 ? 0.22 : 0.06;
  const t = Math.abs(timing);
  chance += t < 0.05 ? 0.14 : t < 0.12 ? 0.05 : t < 0.22 ? -0.08 : -0.22;
  let guard = Infinity;
  let guardBy: Baller | null = null;
  for (const x of otherTeam(m, b.team).ballers) {
    const g = flat(x.player.position, p);
    if (g < guard) [guard, guardBy] = [g, x];
  }
  // A bot shoots as well as its level; a person over bots gets the level's help (a looser contest).
  const lv = b.player.bot ? levelOf(m, b) : null;
  const vs = !b.player.bot && otherTeam(m, b.team).ballers.some((x) => x.player.bot) ? LEVELS[m.level] : null;
  const contest = guardBy?.player.bot && vs ? vs.contest : 1;
  chance -= (guard < 1.1 ? 0.2 : guard < 2 ? 0.09 : 0) * contest;
  chance += (lv?.aim ?? 0) + (vs?.help ?? 0);
  if (s.fire) chance = Math.max(chance, 0.6) + 0.3;
  else if (b.streak === 2) chance += 0.06;
  chance = Math.max(0.02, Math.min(0.96, chance));
  const make = game.rng.range(0, 1) < chance;

  // The release: over their head, a little toward the rim.
  const ux = (r.x - p.x) / (d || 1);
  const uz = (r.z - p.z) / (d || 1);
  const from = { x: p.x + ux * 0.3, y: p.y + 2.3, z: p.z + uz * 0.3 };
  // Where it's aimed: through the middle (a make), or off the iron (a miss).
  let along: number;
  let across: number;
  const rnd = (a: number, z: number) => a + game.rng.range(0, 1) * (z - a);
  if (make) {
    along = rnd(-0.03, 0.09);
    across = rnd(-0.06, 0.06);
  } else {
    const how = game.rng.range(0, 1);
    if (chance < 0.12 && how < 0.25) {
      along = rnd(-1.3, -0.8);
      across = rnd(-0.6, 0.6);
    } else if (how < 0.4) {
      along = rnd(-0.48, -0.36);
      across = rnd(-0.12, 0.12);
    } else if (how < 0.75) {
      along = rnd(0.38, 0.56);
      across = rnd(-0.15, 0.15);
    } else {
      along = rnd(-0.1, 0.25);
      across = (game.rng.range(0, 1) < 0.5 ? -1 : 1) * rnd(0.36, 0.5);
    }
  }
  const to = { x: r.x + ux * (0.04 + along) - uz * across, y: r.y, z: r.z + uz * (0.04 + along) + ux * across };
  const v = arc(from, to, shotTime(Math.hypot(r.x - from.x, r.z - from.z)));
  throwBall(game, 'shot', from, { x: v.vx, y: v.vy, z: v.vz }, b, { points: three ? 3 : 2, touched: false });
  if (t < 0.05 && !b.player.bot) b.player.hud.pop('PERFECT RELEASE', { color: '#ffd23f' });
}

/** A dunk in flight: anyone leaping in its way swats it (and sends them down). */
function dunkStep(game: Game, d: Baller) {
  const s = jamOf(d.player);
  if (s.air !== 3) {
    if (s.air === 0) m.ball.dunker = null;
    return;
  }
  if (s.t / Math.max(0.1, s.dur) < 0.35 || s.fire) return;
  const p = d.player.position;
  for (const x of otherTeam(m, d.team).ballers) {
    const xs = jamOf(x.player);
    if (xs?.air !== 2 || xs.t > 0.7 || m.ball.tried.has(x)) continue;
    const q = x.player.position;
    if (flat(p, q) < 1.25 && Math.abs(p.y - q.y) < 1.4 && q.y > FLOOR + 0.3) {
      m.ball.tried.add(x);
      if (game.rng.range(0, 1) > 0.4 * (swatChance(x, d) / 0.55)) continue;
      // Stuffed: they drop out of the air, the ball flies.
      s.air = 5;
      s.t = 0;
      d.player.impulse(-d.team.side * 3, -2, 0);
      m.ball.dunker = null;
      swat(game, x, d, { x: p.x, y: p.y + 2.4, z: p.z });
      return;
    }
  }
}

/** The slam: two points, the rim shaking, the ball down through the net. */
function slam(game: Game, b: Baller, style: number) {
  const r = rim(b.team.side);
  m.ball.dunker = null;
  throwBall(game, 'slam', { x: r.x, y: r.y - 0.05, z: r.z }, { x: 0, y: -6, z: 0 }, b);
  moment(game, { k: 'slam', by: b.player.id, side: b.team.side, style });
  const lines = ['BOOM! SHAKE THE RIM!', 'JAM IT IN!', 'WHAT A SLAM!', 'HE CRUSHED IT!', 'RAZZLE DAZZLE!', 'MONSTER JAM!', 'IS HE HUMAN?!'];
  call(game, { text: lines[style % lines.length], sub: b.player.name, color: b.team.def.color, roar: 1 });
  score(game, b.team, 2, b, 'dunk');
}

/** An alley-oop: caught in mid-air and thrown straight down. */
function alleyOop(game: Game, b: Baller, passer: Baller) {
  const r = rim(b.team.side);
  passer.passedTo = b;
  passer.passedAt = game.clock.now;
  throwBall(game, 'slam', { x: r.x, y: r.y - 0.05, z: r.z }, { x: 0, y: -6, z: 0 }, b);
  moment(game, { k: 'slam', by: b.player.id, side: b.team.side, style: DUNK_STYLES });
  call(game, { text: 'ALLEY-OOP!', sub: `${passer.player.name} to ${b.player.name}`, color: b.team.def.color, roar: 1 });
  score(game, b.team, 2, b, 'oop');
}

/** Pass and steal (E, the right button); with turbo held, a shove. */
function inputs(game: Game, now: number) {
  if (m.phase !== 'live') return;
  for (const b of allBallers(m)) {
    const pl = b.player;
    const s = jamOf(pl);
    if (!s || s.stun > 0) continue;
    if (!(pl.input.pressed('KeyE') || pl.input.buttonPressed(2))) continue;
    const turbo = pl.input.isDown('ShiftLeft') || pl.input.isDown('ShiftRight');
    const h = m.ball.mode === 'held' ? m.ball.holder : null;
    if (h === b) {
      if (s.air >= 3) continue;
      pass(game, b);
    } else if (h && h.team === b.team) {
      // Calling for it: a bot teammate passes it over (a person decides for themselves).
      if (h.player.bot && jamOf(h.player).air < 3) pass(game, h, b);
    } else if (turbo) shove(game, b, now);
    else steal(game, b, now);
  }
}

/** To the teammate, leading them where they're going. */
export function pass(game: Game, b: Baller, to?: Baller) {
  const mate = to ?? b.team.ballers.find((x) => x !== b);
  if (!mate) return;
  const p = b.player.position;
  const q = mate.player.position;
  const v = mate.player.velocity;
  const d = flat(p, q);
  const time = 0.12 + d / 17;
  const from = { x: p.x, y: p.y + 1.35, z: p.z };
  // Leading them, and a little higher if they're up in the air (an alley-oop's lob).
  const ms = jamOf(mate.player);
  const lob = ms?.air === 2 ? 1.1 : 0;
  const target = { x: q.x + v.x * time, y: q.y + 1.3 + lob + Math.max(0, v.y) * time * 0.5, z: q.z + v.z * time };
  const lobTime = lob ? time + 0.25 : time;
  const vel = arc(from, target, lobTime);
  b.passedAt = game.clock.now;
  b.passedTo = mate;
  throwBall(game, 'pass', from, { x: vel.vx, y: vel.vy, z: vel.vz }, b, { to: mate });
}

function steal(game: Game, b: Baller, now: number) {
  const h = m.ball.mode === 'held' ? m.ball.holder : null;
  if (!h || h.team === b.team || now < b.stealAt) return;
  const hs = jamOf(h.player);
  if (hs.air >= 3) return;
  const p = b.player.position;
  const q = h.player.position;
  if (flat(p, q) > 1.6) return;
  b.stealAt = now + 0.65;
  let chance = 0.24;
  // From behind or the side is easier: the holder faces away from them.
  const facing = { x: -Math.sin(h.player.yaw), z: -Math.cos(h.player.yaw) };
  const toThief = { x: p.x - q.x, z: p.z - q.z };
  const dot = (facing.x * toThief.x + facing.z * toThief.z) / (Math.hypot(toThief.x, toThief.z) || 1);
  if (dot < 0.2) chance += 0.14;
  if (hs.air === 1) chance -= 0.12;
  if (hs.fire) chance -= 0.18;
  // A bot's hands are as quick as its level, reaching for a person's ball.
  if (b.player.bot && !h.player.bot) chance *= levelOf(m, b).pick;
  if (game.rng.range(0, 1) >= chance) return;
  b.stl++;
  if (!b.player.bot) b.player.achieve('pickpocket');
  moment(game, { k: 'steal', by: b.player.id, from: h.player.id });
  if (game.rng.range(0, 1) < 0.4) call(game, { text: 'STOLEN!', sub: b.player.name, color: b.team.def.color, roar: 0.6 });
  giveBall(game, b);
}

function shove(game: Game, b: Baller, now: number) {
  if (now < b.shoveAt) return;
  const p = b.player.position;
  let target: Baller | null = null;
  let best = 1.9;
  for (const x of otherTeam(m, b.team).ballers) {
    const xs = jamOf(x.player);
    if (!xs || xs.stun > 0 || xs.air >= 3) continue;
    // The ball's holder first, if they're close.
    const d = flat(p, x.player.position) - (m.ball.holder === x ? 0.4 : 0);
    if (d < best) {
      best = d;
      target = x;
    }
  }
  if (!target) return;
  b.shoveAt = now + 1.1;
  const s = jamOf(b.player);
  if (!s.fire) s.turbo = Math.max(0, s.turbo - 0.22);
  const q = target.player.position;
  const dx = q.x - p.x;
  const dz = q.z - p.z;
  const d = Math.hypot(dx, dz) || 1;
  const ts = jamOf(target.player);
  ts.stun = 1.25;
  ts.kx = (dx / d) * 7;
  ts.kz = (dz / d) * 7;
  ts.kick = 1;
  ts.air = 0;
  moment(game, { k: 'shove', by: b.player.id, who: target.player.id });
  if (m.ball.mode === 'held' && m.ball.holder === target) {
    m.ball.dunker = null;
    loose(game, { x: q.x, y: q.y + 1.3, z: q.z }, { x: (dx / d) * 3.5 + game.rng.range(-1, 1), y: 4, z: (dz / d) * 3.5 + game.rng.range(-1, 1) });
  }
}

/** What each baller is doing, for the screens. */
function ballers(): BallersMsg {
  return allBallers(m).map((b) => {
    const s = jamOf(b.player);
    return [b.player.id, s?.air ?? 0, Math.round((s?.t ?? 0) * 100) / 100, s?.style ?? 0, Math.round((s?.stun ?? 0) * 100) / 100, s?.fire ?? 0, b.team.index, Math.round((s?.dur ?? 0) * 100) / 100];
  });
}

/** For the HUD (`hud.ts`) and the tests. */
export function matchNow(): Match {
  return m;
}

/** The ball's radius, here so the bots' module needn't reach into the court for it. */
export const BALL = BALL_RADIUS;
export { ballPos };
