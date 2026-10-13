import { defineServer, Models, type Bot, type GameContext as Game, type Player } from '@platform';
import { bots } from './bots';
import { goalieStep, meets, saveChance, saveKind } from './goalies';
import { defineHud, showHud } from './hud';
import { LEVELS, type LevelId } from './levels';
import { allSkaters, blade, everyone, facing, levelOf, otherTeam, puckPos, skOf, type Match, type Shot, type Skater, type Team } from './match';
import { definePick, PICK, pickData } from './pick';
import { MSG, type CallMsg, type FlightKind, type GoalHow, type MomentMsg, type PuckMsg, type SkatersMsg, type TeamsMsg } from './protocol';
import { advance, aim, launch, REST, slideTime, type PuckEvent } from './puck';
import { boards, fromGoal, goal, GOAL_HALF_WIDTH, GOAL_HEIGHT, GOAL_X, ICE, PUCK_RADIUS, type Side } from './rink';
import { shared } from './shared';
import { botLook, TEAMS, uniformOf, type TeamDef } from './teams';

/**
 * Block Ice's rules: two on two and a goalie each, people and bots (bots fill the empty places and
 * give way when a person joins: each picks their team on the team screen, `pick.ts`, and the first
 * person in starts a new game; the goalies are always bots), three periods of two minutes, sudden
 * death if it's tied, no offsides, no icing, no penalties. The puck is the server's: who has it on
 * their stick, its flights (shots, passes, rebounds: `puck.ts`, played out the same on every
 * screen), faceoffs, saves, pokes, checks, goals. Three in a row and a skater catches fire.
 */

/** A period's length (seconds of play), how many, the skaters a side. */
const PERIOD = 120;
const PERIODS = 3;
const PER_TEAM = 2;
/** How long a goal's celebrated before the faceoff, and a goalie holds a puck before moving it. */
const GOAL_PAUSE = 3.4;
const COVER = 0.8;

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
/** Who can't take the puck back yet (just shot or passed it), till when. */
const noTake = new Map<Skater, number>();

export default defineServer(shared, {
  // The bots play while people watch from the home page; Play puts them on the ice.
  autoStart: true,
  setup(game) {
    defineHud(game);
    // The arena's pieces, as items each screen draws (their looks are its: `client/looks.ts`).
    for (const [id, name] of [
      ['ice_puck', 'Puck'],
      ['ice_rink', 'Rink'],
      ['ice_boards', 'Boards'],
      ['ice_goal', 'Goal'],
      ['ice_net', 'Net'],
      ['ice_stick', 'Stick'],
      ['ice_blade', 'Skate'],
      ['ice_mask', 'Goalie Mask'],
      ['ice_pad', 'Goalie Pad'],
      ['ice_glove', 'Glove'],
      ['ice_blocker', 'Blocker'],
      ['ice_light', 'Goal Light'],
      ...TEAMS.map((t) => [`ice_helmet_${t.id}`, `${t.name} Helmet`]),
    ]) game.items.define(id, { kind: 'misc', name, icon: { block: 'white_concrete' } });
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
    // The last game's bots go (a restart keeps players, bots and all); the new game makes its own.
    (m as Match | undefined) = undefined;
    for (const b of [...game.bots.all]) game.bots.remove(b);
    bots.clear();
    noTake.clear();
    tick = 0;
    picking.clear();
    const people = game.players.filter((p) => !p.bot);
    const [home, away] = matchup(people);
    m = {
      teams: [makeTeam(0, home, 1), makeTeam(1, away, -1)],
      puck: { mode: 'dead', holder: null, flight: null, launchedAt: 0, kind: 'drop', by: null, to: null, shot: null, heldAt: 0 },
      phase: 'faceoff',
      period: 1,
      clock: PERIOD,
      phaseUntil: 0,
      draw: null,
      level,
    };
    game.hud.crosshair(false);
    // Whoever's here already takes the ice, for the team they last played for; bots fill the rest.
    // (Anyone still picking, or watching, watches; a restart took the team screen down.)
    for (const p of people) {
      if (choosing.has(p) || watching.has(p)) p.spectate(true);
      else join(game, p, m.teams.find((t) => t.def.id === prefs.get(p)));
    }
    fill(game);
    faceoff(game, `${home.city} ${home.name} vs ${away.city} ${away.name}`);
    for (const p of choosing) showPick(game, p);
    // In development, tests reach in (`__game.dev('__ice.give(me)')`).
    if (import.meta.env.DEV)
      (globalThis as unknown as { __ice: unknown }).__ice = {
        get match() {
          return m;
        },
        give: (p: Player) => {
          const s = skaterOf(p);
          if (!s) return;
          m.phase = 'live';
          m.draw = null;
          for (const x of everyone(m)) x.player.freeze(false);
          givePuck(game, s);
        },
        /** A shot from the slot by a team's first skater, into the corner past their goalie (who's sent to the other post). */
        snipe: (team: 0 | 1) => {
          const t = m.teams[team];
          const s = t.skaters[0];
          const g = otherTeam(m, t).goalie;
          m.phase = 'live';
          m.draw = null;
          for (const x of everyone(m)) x.player.freeze(false);
          s.player.teleport({ x: t.side * (GOAL_X - 5), y: ICE, z: 1 }, t.side > 0 ? -Math.PI / 2 : Math.PI / 2);
          g?.player.teleport({ x: t.side * (GOAL_X - 0.5), y: ICE, z: 1.6 }, 0);
          givePuck(game, s);
          const from = { x: t.side * (GOAL_X - 5) + t.side * 0.9, y: REST + 0.02, z: 1 };
          const to = { x: t.side * (GOAL_X + 0.35), y: ICE + 0.6, z: -0.8 };
          const v = aim(from, to, Math.hypot(to.x - from.x, to.z - from.z) / 26);
          throwPuck(game, 'shot', from, { x: v.vx, y: v.vy, z: v.vz }, s, { shot: { by: s, speed: 26, slap: true, oneTimer: false, dist: 5, met: true, blocked: new Set(), onNet: true, save: 0 } });
        },
      };
  },

  update(game, dt) {
    if (!m) return;
    tick++;
    const now = game.clock.now;
    // Each skater's state as the game sees it: which way they attack, the puck, fire, their pace, a goalie's.
    for (const s of everyone(m)) {
      const st = skOf(s.player);
      if (!st) continue;
      st.side = s.team.side;
      st.puck = m.puck.mode === 'held' && m.puck.holder === s ? 1 : 0;
      st.fire = s.fireMakes > 0 || s.streak >= 3 ? 1 : 0;
      st.pace = s.player.bot ? levelOf(m, s).pace : 1;
      st.goalie = s.goalie ? 1 : 0;
    }
    // The team screen: on M, and kept current while it's up.
    for (const p of game.players) if (!p.bot && p.input.pressed('KeyM')) showPick(game, p);
    if (tick % 10 === 0) for (const p of picking) showPick(game, p);
    phaseStep(game, dt, now);
    if (m.phase === 'live' || m.phase === 'goal') puckStep(game, now);
    if (m.phase === 'live') inputs(game, now);
    for (const t of m.teams) goalieStep(m, t);
    bots.update(game, m);
    if (tick % 3 === 0) game.clients.send('all', MSG.skaters, skaters(now));
    if (tick % 15 === 1) game.clients.send('all', MSG.teams, [m.teams[0].def.id, m.teams[1].def.id] satisfies TeamsMsg);
    // Who has the puck, again now and then: for screens that came in since it changed hands.
    if (tick % 30 === 2 && m.puck.mode === 'held' && m.puck.holder) sendPuck(game, { h: m.puck.holder.player.id });
    showHud(game, m);
  },
});

// -------------------------------------------------------------------------------------------------
// The roster: people, and bots in the empty places
// -------------------------------------------------------------------------------------------------

function makeTeam(index: 0 | 1, def: TeamDef, side: Side): Team {
  return { index, def, side, skaters: [], goalie: null, score: 0, shots: 0 };
}

function newSkater(player: Player, team: Team, goalie = false): Skater {
  return { player, team, goalie, g: 0, a: 0, sog: 0, hits: 0, stl: 0, saves: 0, streak: 0, fireMakes: 0, pokeAt: 0, checkAt: 0, passedAt: -9, passedTo: null, save: 0, saveAt: -9 };
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

function skaterOf(p: Player): Skater | undefined {
  return allSkaters(m).find((s) => s.player === p);
}

/** People on the ice (on either team), besides `but`. */
const playing = (but?: Player) => allSkaters(m).filter((s) => !s.player.bot && s.player !== but);

/**
 * A person takes the ice: for the team they picked (`id`), or wherever there's room. The first
 * person in starts a new game (the bots' game on show makes way). A team that isn't in this game
 * takes over a side nobody else plays on (theirs first), in its colours, with its own bench.
 */
function take(game: Game, player: Player, id?: string) {
  if (!m) return;
  const def = id ? TEAMS.find((t) => t.id === id) : undefined;
  if (id && !def) return;
  const mine = skaterOf(player);
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
    const free = (t: Team) => !t.skaters.some((s) => !s.player.bot && s.player !== player);
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
 * Onto the ice for `want` (or the side with fewer people), a bot giving way; both full of people,
 * they wait, watching. True if they're on the ice now.
 */
function join(game: Game, player: Player, want?: Team): boolean {
  if (!m) return false;
  const current = skaterOf(player);
  const people = (t: Team) => t.skaters.filter((s) => !s.player.bot && s.player !== player).length;
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
  if (current) removeSkater(game, current, false);
  // A bot on that side makes room (where it stood is where they come on).
  const bot = team.skaters.find((x) => x.player.bot);
  let at = { x: -team.side * 4, y: ICE, z: 3 };
  if (bot) {
    at = { ...bot.player.position };
    removeSkater(game, bot);
  }
  const s = newSkater(player, team);
  team.skaters.push(s);
  dress(player, team);
  player.teleport(at, team.side > 0 ? -Math.PI / 2 : Math.PI / 2);
  if (m.phase === 'faceoff' || m.phase === 'over') player.freeze(true);
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

/** A side changes teams (the score stays the side's): its people in the new colours, its bots (the goalie too) off for the new bench. */
function rebrand(game: Game, team: Team, def: TeamDef) {
  team.def = def;
  for (const s of [...team.skaters]) {
    if (s.player.bot) removeSkater(game, s);
    else dress(s.player, team);
  }
  if (team.goalie) removeSkater(game, team.goalie);
  fill(game);
  call(game, { text: `${def.city} ${def.name}`.toUpperCase(), sub: 'Take the ice', color: def.color, roar: 0.4 });
}

/** Off the ice to watch (a bot takes their place, or someone waiting). */
function watch(game: Game, player: Player) {
  const mine = skaterOf(player);
  choosing.delete(player);
  waiting.delete(player);
  watching.add(player);
  closePick(player);
  player.spectate(true);
  if (!mine) return;
  removeSkater(game, mine, false);
  const next = [...waiting][0];
  if (next) join(game, next);
  fill(game);
}

function setLevel(game: Game, player: Player, id: string) {
  if (!(id in LEVELS) || id === level) return;
  level = id as LevelId;
  if (m) m.level = level;
  game.hud.feed(`${player.name} set the bots to ${LEVELS[level].name}`, { color: '#7fd0ff' });
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
  const s = skaterOf(player);
  if (!s) return;
  removeSkater(game, s, false);
  // Someone waiting takes their place, or a bot.
  const next = [...waiting][0];
  if (next) join(game, next);
  fill(game);
}

function removeSkater(game: Game, s: Skater, removeBot = true) {
  const t = s.team;
  if (s.goalie) t.goalie = null;
  else t.skaters = t.skaters.filter((x) => x !== s);
  // The puck doesn't leave with them.
  if (m.puck.holder === s && m.puck.mode === 'held') {
    const b = blade(s.player);
    loose(game, b, { x: 0, y: 0, z: 0 });
  }
  if (m.puck.to === s) m.puck.to = null;
  // A shot or a pass of theirs on its way goes on without them (no scorer, no assist).
  if (m.puck.by === s) m.puck = { ...m.puck, by: null, shot: null };
  if (m.draw?.centers.includes(s)) m.draw = null;
  if (removeBot && s.player.bot) game.bots.remove(s.player as Bot);
  bots.forget(s);
  noTake.delete(s);
}

/** Bots in every empty place, and a goalie in each net. */
function fill(game: Game) {
  const used = () => new Set(everyone(m).map((s) => s.player.name));
  for (const t of m.teams) {
    while (t.skaters.length < PER_TEAM) {
      const pick = t.def.bench.find((x) => !used().has(x.name)) ?? { name: `${t.def.name} ${t.skaters.length + 1}`, look: {} };
      const bot = game.bots.add(pick.name);
      bot.setModel(Models.character(botLook(t.def, pick.look)));
      bot.color = t.def.color;
      const s = newSkater(bot, t);
      t.skaters.push(s);
      bot.teleport({ x: -t.side * (3 + t.skaters.length * 2), y: ICE, z: t.skaters.length === 1 ? -2 : 3 }, t.side > 0 ? -Math.PI / 2 : Math.PI / 2);
      if (m.phase === 'faceoff' || m.phase === 'over') bot.freeze(true);
      bots.add(m, s);
    }
    if (!t.goalie) {
      const bot = game.bots.add(t.def.goalie.name);
      bot.setModel(Models.character(botLook(t.def, t.def.goalie.look)));
      bot.color = t.def.color;
      t.goalie = newSkater(bot, t, true);
      const gx = -t.side * (GOAL_X - 0.6);
      bot.teleport({ x: gx, y: ICE, z: 0 }, t.side > 0 ? -Math.PI / 2 : Math.PI / 2);
      skOf(bot).goalie = 1;
    }
  }
}

// -------------------------------------------------------------------------------------------------
// The phases: faceoffs, play, goals, the breaks between periods, the final horn
// -------------------------------------------------------------------------------------------------

/** Everyone to their places at centre ice, then the puck drops. */
function faceoff(game: Game, sub?: string) {
  m.phase = 'faceoff';
  m.phaseUntil = game.clock.now + 2.4;
  m.draw = null;
  m.puck = { ...m.puck, mode: 'dead', holder: null, flight: null, to: null, shot: null };
  sendPuck(game, { f: [0, -50, 0, 0, 0, 0], k: 'drop' });
  for (const t of m.teams) {
    const face = t.side > 0 ? -Math.PI / 2 : Math.PI / 2;
    t.skaters.forEach((s, i) => {
      const at = i === 0 ? { x: -t.side * 0.95, y: ICE, z: 0 } : { x: -t.side * 5.5, y: ICE, z: t.side * 3.6 };
      s.player.teleport(at, face);
      s.player.freeze(true);
      const st = skOf(s.player);
      if (st) st.stun = 0;
    });
    if (t.goalie) {
      t.goalie.player.teleport({ x: -t.side * (GOAL_X - 0.6), y: ICE, z: 0 }, face);
      t.goalie.player.freeze(true);
    }
  }
  call(game, { text: 'FACEOFF', sub, color: '#7fd0ff', roar: 0.3 });
}

function phaseStep(game: Game, dt: number, now: number) {
  switch (m.phase) {
    case 'faceoff': {
      if (!m.draw && now >= m.phaseUntil) {
        // The drop: from the linesman's hand to the dot.
        const centers = m.teams.map((t) => t.skaters[0]).filter(Boolean) as Skater[];
        if (centers.length < 2) break;
        m.draw = { centers: [centers[0], centers[1]], at: now + 0.32, won: null };
        throwPuck(game, 'drop', { x: 0, y: ICE + 1.5, z: 0 }, { x: 0, y: -2, z: 0 }, null);
        moment(game, { k: 'drop' });
      }
      const d = m.draw;
      if (!d) break;
      if (m.puck.flight) advance(m.puck.flight, now - m.puck.launchedAt);
      // The draw: whoever swipes first once it's down (a swipe before it counts for nothing).
      if (!d.won && now >= d.at - 0.05) {
        for (const c of d.centers) {
          const pl = c.player;
          if (pl.input.pressed('KeyE') || pl.input.pressed('Space') || pl.input.buttonPressed(0) || pl.input.buttonPressed(2)) {
            d.won = c;
            break;
          }
        }
        if (!d.won && now >= d.at + 0.7) d.won = d.centers[game.rng.range(0, 1) < 0.5 ? 0 : 1];
      }
      if (d.won) {
        for (const x of everyone(m)) x.player.freeze(false);
        m.phase = 'live';
        m.draw = null;
        // Drawn back to the winner's winger (the loser's stick beaten to it).
        const mate = d.won.team.skaters.find((x) => x !== d.won) ?? d.won;
        for (const c of d.centers) if (c !== d.won) noTake.set(c, now + 0.5);
        pass(game, d.won, mate, { x: 0, y: REST, z: 0 });
      }
      break;
    }
    case 'live': {
      if (m.period <= PERIODS) m.clock = Math.max(0, m.clock - dt);
      // The period's over once the clock's out and any shot already on its way has got there.
      const shotOn = m.puck.mode === 'loose' && m.puck.kind === 'shot' && !!m.puck.shot && !m.puck.shot.met && now - m.puck.launchedAt < 1.2;
      if (m.period <= PERIODS && m.clock <= 0 && !shotOn) endPeriod(game);
      break;
    }
    case 'goal':
      if (now >= m.phaseUntil) faceoff(game);
      break;
    case 'break':
      if (now >= m.phaseUntil) startPeriod(game);
      break;
    case 'over':
      if (now >= m.phaseUntil) game.restart();
      break;
  }
}

function periodName(p: number): string {
  return p <= PERIODS ? ['', '1ST PERIOD', '2ND PERIOD', '3RD PERIOD'][p] : p === PERIODS + 1 ? 'OVERTIME' : `OVERTIME ${p - PERIODS}`;
}

function endPeriod(game: Game) {
  const [a, b] = m.teams;
  const over = m.period >= PERIODS && a.score !== b.score;
  moment(game, { k: 'horn', what: over ? 'game' : 'period' });
  m.puck = { ...m.puck, mode: 'dead', holder: null, to: null, shot: null };
  sendPuck(game, { f: [0, -50, 0, 0, 0, 0], k: 'drop' });
  if (over) return gameOver(game);
  m.phase = 'break';
  m.phaseUntil = game.clock.now + 4.5;
  call(game, { text: m.period >= PERIODS ? 'TIED UP!' : `END OF THE ${['', '1ST', '2ND'][m.period]}`, sub: `${a.def.abbr} ${a.score} · ${b.def.abbr} ${b.score}${m.period >= PERIODS ? ' · next goal wins' : ''}`, color: '#7fd0ff', roar: 0.5 });
}

function startPeriod(game: Game) {
  m.period++;
  m.clock = m.period <= PERIODS ? PERIOD : Infinity;
  // Ends switch? (No: arcade. Everyone keeps attacking the same way.)
  faceoff(game, periodName(m.period));
}

function gameOver(game: Game) {
  m.phase = 'over';
  m.phaseUntil = game.clock.now + 14;
  const [a, b] = m.teams;
  const winner = a.score > b.score ? a : b;
  const loser = otherTeam(m, winner);
  for (const x of everyone(m)) x.player.freeze(true);
  for (const x of winner.skaters) {
    if (x.player.bot) continue;
    x.player.achieve('final_horn');
    if (loser.score === 0) x.player.achieve('shutout');
  }
  const star = allSkaters(m).sort((x, y) => y.g * 2 + y.a + y.hits * 0.3 + y.stl * 0.5 - (x.g * 2 + x.a + x.hits * 0.3 + x.stl * 0.5))[0];
  call(game, {
    text: `${winner.def.name.toUpperCase()} WIN!`,
    sub: `${a.def.abbr} ${a.score} · ${b.def.abbr} ${b.score}${star ? ` · first star ${star.player.name} (${star.g}G ${star.a}A)` : ''}`,
    color: winner.def.color,
    roar: 1,
  });
}

// -------------------------------------------------------------------------------------------------
// The puck
// -------------------------------------------------------------------------------------------------

function sendPuck(game: Game, msg: PuckMsg) {
  game.clients.send('all', MSG.puck, msg);
}

function moment(game: Game, msg: MomentMsg) {
  game.clients.send('all', MSG.moment, msg);
}

function call(game: Game, msg: CallMsg) {
  game.clients.send('all', MSG.call, msg);
}

const isFire = (s: Skater) => s.fireMakes > 0 || s.streak >= 3;

/** Onto someone's stick (or into a goalie's glove). */
function givePuck(game: Game, s: Skater) {
  m.puck = { ...m.puck, mode: 'held', holder: s, flight: null, to: null, shot: null, heldAt: game.clock.now };
  sendPuck(game, { h: s.player.id });
}

/** Loose: sent on its way. */
function throwPuck(game: Game, kind: FlightKind, from: { x: number; y: number; z: number }, v: { x: number; y: number; z: number }, by: Skater | null, extra: Partial<Match['puck']> = {}) {
  m.puck = { ...m.puck, mode: 'loose', holder: null, flight: launch(from.x, from.y, from.z, v.x, v.y, v.z), launchedAt: game.clock.now, kind, by, to: null, shot: null, ...extra };
  sendPuck(game, { f: [from.x, from.y, from.z, v.x, v.y, v.z], k: kind, by: by?.player.id, fire: by ? isFire(by) : false });
}

function loose(game: Game, from: { x: number; y: number; z: number }, v: { x: number; y: number; z: number }, by: Skater | null = null) {
  throwPuck(game, 'loose', from, v, by);
}

function puckStep(game: Game, now: number) {
  const pk = m.puck;
  if (pk.mode === 'held' && pk.holder) {
    const h = pk.holder;
    // A goalie moves it on after a moment: to the nearer of their skaters.
    if (h.goalie && now - pk.heldAt > COVER && m.phase === 'live') {
      const to = [...h.team.skaters].sort((a, b) => fromGoal(-h.team.side as Side, a.player.position.x, a.player.position.z) - fromGoal(-h.team.side as Side, b.player.position.x, b.player.position.z))[0];
      if (to) pass(game, h, to, { x: h.player.position.x + h.team.side * 0.8, y: REST, z: h.player.position.z });
    }
    return;
  }
  if (pk.mode !== 'loose' || !pk.flight) return;
  const events: PuckEvent[] = [];
  const f = pk.flight;
  const was = { x: f.x, y: f.y, z: f.z };
  advance(f, now - pk.launchedAt, events);
  /** How near this tick's path came to a point on the ice, and how high it was then. */
  const path = (q: { x: number; z: number }) => {
    const dx = f.x - was.x;
    const dz = f.z - was.z;
    const l2 = dx * dx + dz * dz;
    const k = l2 > 1e-9 ? Math.max(0, Math.min(1, ((q.x - was.x) * dx + (q.z - was.z) * dz) / l2)) : 1;
    const x = was.x + dx * k;
    const z = was.z + dz * k;
    return { d: Math.hypot(q.x - x, q.z - z), x, y: was.y + (f.y - was.y) * k, z };
  };
  const live = m.phase === 'live';

  // A shot: blocked by a skater in its way, or met by the goalie (a save, or past them), before
  // whatever else it did this tick.
  const shot = pk.shot;
  if (live && pk.kind === 'shot' && shot && !shot.met) {
    for (const x of otherTeam(m, shot.by.team).skaters) {
      if (shot.blocked.has(x)) continue;
      const c = path(x.player.position);
      if (c.d > 0.55 || c.y > ICE + 1.1) continue;
      shot.blocked.add(x);
      if (game.rng.range(0, 1) < 0.35) {
        const sp = Math.hypot(f.vx, f.vz) * 0.35;
        const back = Math.atan2(-f.vz, -f.vx) + game.rng.range(-1.2, 1.2);
        throwPuck(game, 'block', { x: c.x, y: c.y, z: c.z }, { x: Math.cos(back) * sp, y: 1.5, z: Math.sin(back) * sp }, x);
        moment(game, { k: 'block', by: x.player.id, at: [c.x, c.y, c.z] });
        if (game.rng.range(0, 1) < 0.5) call(game, { text: 'BLOCKED!', sub: x.player.name, color: x.team.def.color, roar: 0.4 });
        return;
      }
    }
    const met = meets(m, shot, was, f);
    if (met) {
      shot.met = true;
      if ((shot.onNet || Math.abs(met.at.z) < GOAL_HALF_WIDTH + 0.2) && game.rng.range(0, 1) < shot.save) return save(game, met.g, shot, met.at);
    }
  }
  for (const e of events) {
    if (e.kind === 'goal' && e.side && live) {
      goalFor(game, m.teams.find((t) => t.side === e.side)!);
      return;
    }
  }
  if (!live || f.net) return;

  // A goalie on a slow puck in the crease covers it.
  const speed = Math.hypot(f.vx, f.vz);
  for (const t of m.teams) {
    const g = t.goalie;
    if (!g) continue;
    const q = g.player.position;
    if (Math.hypot(f.x - q.x, f.z - q.z) < 0.85 && f.y < ICE + 0.8 && speed < 4) {
      givePuck(game, g);
      return;
    }
  }

  // Onto a stick: a pass's receiver (or a thief in its way), a loose puck, a rebound.
  let best: Skater | null = null;
  let bestD = Infinity;
  for (const x of allSkaters(m)) {
    const st = skOf(x.player);
    if (!st || st.stun > 0) continue;
    if ((noTake.get(x) ?? 0) > now) continue;
    // A hard shot goes past a stick (the blocks above are a body's).
    if (pk.kind === 'shot' && speed > 14 && x !== pk.by) continue;
    const intended = pk.kind === 'pass' && x === pk.to;
    const foe = pk.kind === 'pass' && pk.by && x.team !== pk.by.team;
    const reach = intended ? 1.05 : foe ? 0.6 : 0.8;
    const c = path(blade(x.player));
    if (c.d > reach || c.y > ICE + 1.1 || c.d >= bestD) continue;
    best = x;
    bestD = c.d;
  }
  if (!best) return;
  const kind = pk.kind;
  const passer = pk.by;
  if (kind === 'pass' && passer && passer.team !== best.team) {
    best.stl++;
    if (!best.player.bot) best.player.achieve('poke_check');
    moment(game, { k: 'poke', by: best.player.id, from: passer.player.id });
    call(game, { text: 'PICKED OFF!', color: best.team.def.color });
  }
  // A one-timer: shoot held as the pass arrives, a teammate's pass, a look at the net.
  if (kind === 'pass' && passer && passer.team === best.team && shootHeld(best) && oneTimerLook(best)) {
    givePuck(game, best);
    shoot(game, best, 0.75, true);
    return;
  }
  givePuck(game, best);
}

/** Shoot's held: a person's key or button, a bot's control. */
function shootHeld(s: Skater): boolean {
  return s.player.input.isDown('Space') || s.player.input.button(0);
}

const oneTimerLook = (s: Skater) => {
  const p = s.player.position;
  const side = s.team.side;
  return side * (side * GOAL_X - p.x) > 0.8 && fromGoal(side, p.x, p.z) < 12;
};

/** A save: off the pads to the side, caught in the glove, turned aside by the blocker, a sprawl. */
function save(game: Game, g: Skater, shot: Shot, at: { x: number; y: number; z: number }) {
  const kind = saveKind(g, at);
  g.save = kind;
  g.saveAt = game.clock.now;
  g.saves++;
  const side = shot.by.team.side;
  moment(game, { k: 'save', by: g.player.id, kind, at: [at.x, at.y, at.z] });
  const lines = ['WHAT A SAVE!', 'DENIED!', 'ROBBED!', 'STONEWALLED!', 'NOT IN MY HOUSE!'];
  if (shot.speed > 26 || shot.oneTimer || game.rng.range(0, 1) < 0.3) call(game, { text: lines[Math.floor(game.rng.range(0, lines.length)) % lines.length], sub: g.player.name, color: g.team.def.color, roar: 0.6 });
  if (kind === 2) {
    // In the glove: held a moment, then moved on.
    givePuck(game, g);
    return;
  }
  // A rebound: out in front (the pads), to the corner (the blocker), or wherever a sprawl sends it.
  const away = -side;
  let vx: number;
  let vz: number;
  if (kind === 3) {
    const out = Math.sign(at.z - g.player.position.z) || 1;
    vx = away * game.rng.range(2, 5);
    vz = out * game.rng.range(8, 12);
  } else {
    vx = away * game.rng.range(4, 8);
    vz = game.rng.range(-5, 5);
  }
  throwPuck(game, 'save', { x: g.player.position.x + away * 0.5, y: Math.max(REST, Math.min(at.y, ICE + 0.6)), z: at.z }, { x: vx, y: kind === 3 ? 2 : 0.5, z: vz }, g);
  noTake.set(g, game.clock.now + 0.4);
}

/** A goal: on the board, the horn, fire, and a celebration before the faceoff. */
function goalFor(game: Game, team: Team) {
  const pk = m.puck;
  const by = pk.by && !pk.by.goalie ? pk.by : null;
  const own = !!by && by.team !== team;
  const scorer = own ? null : by;
  team.score++;
  const other = otherTeam(m, team);
  // The other side's fire goes out, their streaks too.
  for (const x of other.skaters) {
    if (isFire(x)) moment(game, { k: 'fire', who: x.player.id, on: false });
    x.streak = 0;
    x.fireMakes = 0;
  }
  let fire = false;
  let how: GoalHow = own ? 'own' : 'wrist';
  let assist: Skater | null = null;
  if (scorer) {
    const shot = pk.kind === 'shot' ? pk.shot : null;
    how = shot?.oneTimer ? 'onetimer' : shot?.slap ? 'slap' : 'wrist';
    scorer.g++;
    const wasFire = isFire(scorer);
    scorer.streak++;
    if (wasFire) scorer.fireMakes++;
    fire = wasFire;
    assist = team.skaters.find((x) => x !== scorer && x.passedTo === scorer && game.clock.now - x.passedAt < 6) ?? null;
    if (assist) assist.a++;
    if (!scorer.player.bot) {
      scorer.player.achieve('first_goal');
      if (how === 'slap' && (shot?.speed ?? 0) >= 33) scorer.player.achieve('clapper');
      if (how === 'onetimer') scorer.player.achieve('one_timer');
      if (scorer.g === 3) scorer.player.achieve('hat_trick');
    }
    if (!wasFire && scorer.streak === 3) {
      moment(game, { k: 'fire', who: scorer.player.id, on: true });
      if (!scorer.player.bot) scorer.player.achieve('on_fire');
    } else if (wasFire && scorer.fireMakes >= 3) {
      scorer.streak = 0;
      scorer.fireMakes = 0;
      moment(game, { k: 'fire', who: scorer.player.id, on: false });
    }
  }
  moment(game, { k: 'goal', team: team.index, by: scorer?.player.id ?? '', how, fire, side: team.side, assist: assist?.player.id ?? '' });
  const hat = scorer?.g === 3;
  const onFire = scorer && !fire && isFire(scorer);
  const text = hat ? 'HAT TRICK!' : onFire ? "HE'S ON FIRE!" : how === 'onetimer' ? 'ONE-TIMER!' : how === 'slap' ? 'SLAP SHOT!' : own ? 'OWN GOAL!' : 'GOAL!';
  call(game, { text, sub: scorer ? `${scorer.player.name}${assist ? ` from ${assist.player.name}` : ''}` : `${team.def.city} ${team.def.name}`, color: onFire ? '#ff7a1a' : team.def.color, roar: 1 });
  // Sudden death: that's the game.
  if (m.period > PERIODS) {
    moment(game, { k: 'horn', what: 'game' });
    m.puck = { ...m.puck, shot: null };
    return gameOver(game);
  }
  m.phase = 'goal';
  m.phaseUntil = game.clock.now + GOAL_PAUSE;
  m.puck.shot = null;
}

// -------------------------------------------------------------------------------------------------
// What the skaters do: shots, passes, pokes, checks
// -------------------------------------------------------------------------------------------------

function onAbility(game: Game, player: Player, name: string) {
  const s = skaterOf(player);
  if (!s || m.phase !== 'live') return;
  const st = skOf(player);
  switch (name) {
    case 'shoot':
      if (m.puck.mode === 'held' && m.puck.holder === s) shoot(game, s, st.charge, false);
      break;
    case 'check':
      check(game, s);
      break;
  }
}

/**
 * A shot: how hard (the wind-up), whether it's on net (by how far out, how hard, the angle, the
 * shooter), where it's aimed (a corner away from the goalie, or wide, high, off the iron), and the
 * goalie's chance of stopping it if it reaches them.
 */
function shoot(game: Game, s: Skater, charge: number, oneTimer: boolean) {
  const from = blade(s.player);
  from.y = REST + 0.02;
  const side = s.team.side;
  const g = goal(side);
  const d = fromGoal(side, from.x, from.z);
  const fire = isFire(s);
  const slap = charge >= 0.55;
  const speed = (slap ? 25 + ((charge - 0.55) / 0.45) * 9 : 17 + charge * 12) + (fire ? 4 : 0) + (oneTimer ? 3 : 0);
  const outFront = side * (g.x - from.x);
  const angle = Math.abs(from.z) / Math.max(0.4, outFront);
  // On target?
  let on = 0.88 - (slap ? 0.06 + charge * 0.06 : 0) - Math.max(0, d - 8) * 0.025 - (angle > 1.6 ? 0.2 : angle > 1 ? 0.08 : 0) - (outFront < 0.5 ? 0.5 : 0);
  const foes = otherTeam(m, s.team);
  if (s.player.bot) {
    const lv = levelOf(m, s);
    on += lv.aim + (lv.skill[0] + lv.skill[1] - 1) * 0.08;
  } else if (foes.skaters.some((x) => x.player.bot)) on += LEVELS[m.level].help;
  if (fire) on = 0.97;
  on = Math.max(0.25, Math.min(0.97, on));
  const onNet = game.rng.range(0, 1) < on;
  const gp = foes.goalie?.player.position ?? { x: g.x, z: 0 };
  // A corner away from the goalie (mostly), or a miss: wide, high, off the post.
  const away = game.rng.range(0, 1) < 0.72 ? (gp.z > 0 ? -1 : 1) : game.rng.range(0, 1) < 0.5 ? -1 : 1;
  let tz: number;
  let ty: number;
  if (onNet) {
    tz = away * game.rng.range(0.25, GOAL_HALF_WIDTH - PUCK_RADIUS - 0.05);
    ty = slap ? game.rng.range(0.1, 0.95) : game.rng.range(0.06, 0.85);
  } else {
    const r = game.rng.range(0, 1);
    if (r < 0.2) {
      tz = away * GOAL_HALF_WIDTH;
      ty = game.rng.range(0.1, 0.7);
    } else if (r < 0.55) {
      tz = away * (GOAL_HALF_WIDTH + game.rng.range(0.25, 1.2));
      ty = game.rng.range(0.05, 0.6);
    } else {
      tz = away * game.rng.range(0, GOAL_HALF_WIDTH);
      ty = GOAL_HEIGHT + game.rng.range(0.25, 1.1);
    }
  }
  const to = { x: g.x + side * 0.35, y: ICE + ty, z: tz };
  const dist = Math.hypot(to.x - from.x, to.z - from.z);
  const v = aim(from, to, dist / speed);
  // Where it crosses the goalie's plane, for how far they've to go to get there.
  const crossT = Math.abs(gp.x - from.x) / Math.max(1, Math.abs(v.vx));
  const crossZ = from.z + v.vz * crossT;
  const info = { by: s, speed, slap, oneTimer, dist: d };
  const shot: Shot = { ...info, met: false, blocked: new Set(), onNet, save: saveChance(m, info, crossZ, fire) };
  throwPuck(game, 'shot', from, { x: v.vx, y: v.vy, z: v.vz }, s, { shot });
  noTake.set(s, game.clock.now + 0.35);
  if (onNet) {
    s.sog++;
    s.team.shots++;
  }
  moment(game, { k: 'shot', by: s.player.id, slap });
}

/** To the teammate (or `to`), leading them where they're going, along the ice. */
function pass(game: Game, s: Skater, to?: Skater, from?: { x: number; y: number; z: number }) {
  const mate = to ?? s.team.skaters.find((x) => x !== s);
  if (!mate) return;
  const a = from ?? blade(s.player);
  a.y = REST;
  const b = blade(mate.player);
  const d = Math.hypot(b.x - a.x, b.z - a.z);
  const speed = Math.max(13, Math.min(24, 11 + d * 0.75));
  const time = slideTime(speed, d);
  const v = mate.player.velocity;
  const lead = { x: b.x + v.x * time * 0.9, y: REST, z: b.z + v.z * time * 0.9 };
  const dx = lead.x - a.x;
  const dz = lead.z - a.z;
  const l = Math.hypot(dx, dz) || 1;
  s.passedAt = game.clock.now;
  s.passedTo = mate;
  throwPuck(game, 'pass', a, { x: (dx / l) * speed, y: 0, z: (dz / l) * speed }, s, { to: mate });
  noTake.set(s, game.clock.now + 0.4);
}

/** Pass and poke (E, the right button). With turbo it's a check: the skating's lunge (`check`) does that. */
function inputs(game: Game, now: number) {
  for (const s of allSkaters(m)) {
    const pl = s.player;
    const st = skOf(pl);
    if (!st || st.stun > 0) continue;
    if (!(pl.input.pressed('KeyE') || pl.input.buttonPressed(2))) continue;
    const turbo = pl.input.isDown('ShiftLeft') || pl.input.isDown('ShiftRight');
    const h = m.puck.mode === 'held' ? m.puck.holder : null;
    if (h === s) pass(game, s);
    else if (h && h.team === s.team && !h.goalie) {
      // Calling for it: a bot teammate passes it over (a person decides for themselves).
      if (h.player.bot && skOf(h.player).wind === 0) pass(game, h, s);
    } else if (!turbo) poke(game, s, now);
  }
}

/** A poke check: the stick at the carrier's puck, from in front of them or (better) behind. */
function poke(game: Game, s: Skater, now: number) {
  const h = m.puck.mode === 'held' ? m.puck.holder : null;
  if (!h || h.team === s.team || h.goalie || now < s.pokeAt) return;
  const b = blade(s.player);
  const pb = blade(h.player);
  if (Math.hypot(b.x - pb.x, b.z - pb.z) > 1.4) return;
  s.pokeAt = now + 0.6;
  let chance = 0.24;
  // From behind or the side: the carrier faces away.
  const hf = facing(h.player.yaw);
  const tx = s.player.position.x - h.player.position.x;
  const tz = s.player.position.z - h.player.position.z;
  if ((hf.fx * tx + hf.fz * tz) / (Math.hypot(tx, tz) || 1) < 0.2) chance += 0.12;
  if (isFire(h)) chance -= 0.18;
  if (skOf(h.player).wind > 0) chance += 0.1;
  if (s.player.bot && !h.player.bot) chance *= levelOf(m, s).pick;
  if (game.rng.range(0, 1) >= chance) return;
  s.stl++;
  if (!s.player.bot) s.player.achieve('poke_check');
  moment(game, { k: 'poke', by: s.player.id, from: h.player.id });
  if (game.rng.range(0, 1) < 0.35) call(game, { text: 'POKED AWAY!', sub: s.player.name, color: s.team.def.color, roar: 0.4 });
  // It squirts loose, toward the poker.
  const dx = b.x - pb.x;
  const dz = b.z - pb.z;
  const l = Math.hypot(dx, dz) || 1;
  noTake.set(h, now + 0.45);
  loose(game, pb, { x: (dx / l) * 4 + game.rng.range(-1, 1), y: 0, z: (dz / l) * 4 + game.rng.range(-1, 1) }, s);
}

/** A check: the lunge reaching someone in front (the carrier first); into the boards it's a big one. */
function check(game: Game, s: Skater) {
  const now = game.clock.now;
  if (now < s.checkAt) return;
  s.checkAt = now + 0.8;
  const p = s.player.position;
  const v = s.player.velocity;
  const sp = Math.hypot(v.x, v.z);
  const f = sp > 1 ? { x: v.x / sp, z: v.z / sp } : (() => { const q = facing(s.player.yaw); return { x: q.fx, z: q.fz }; })();
  let target: Skater | null = null;
  let best = 2.2;
  for (const x of otherTeam(m, s.team).skaters) {
    const xs = skOf(x.player);
    if (!xs || xs.stun > 0) continue;
    const q = x.player.position;
    const dx = q.x - p.x;
    const dz = q.z - p.z;
    const d = Math.hypot(dx, dz);
    if (d > 2.2 || (dx * f.x + dz * f.z) / (d || 1) < 0.25) continue;
    const score = d - (m.puck.holder === x ? 0.5 : 0);
    if (score < best) [best, target] = [score, x];
  }
  if (!target) return;
  let chance = 0.9;
  if (s.player.bot && !target.player.bot) chance *= levelOf(m, s).hit;
  if (isFire(target)) chance *= 0.6;
  if (game.rng.range(0, 1) >= chance) return;
  s.hits++;
  const q = target.player.position;
  const dx = q.x - p.x;
  const dz = q.z - p.z;
  const d = Math.hypot(dx, dz) || 1;
  const wall = boards(q.x, q.z).d < 1.7;
  const ts = skOf(target.player);
  const push = Math.max(7, sp * 0.9);
  ts.stun = wall ? 1.7 : 1.25;
  ts.kx = (dx / d) * push;
  ts.kz = (dz / d) * push;
  ts.kick = 1;
  ts.wind = 0;
  moment(game, { k: 'hit', by: s.player.id, who: target.player.id, boards: wall, at: [q.x, q.y + 1, q.z] });
  if (wall) {
    if (!s.player.bot) s.player.achieve('lights_out');
    const lines = ['INTO THE GLASS!', 'LIGHTS OUT!', 'RATTLED THE BOARDS!', 'HE GOT CRUNCHED!', 'SMASH!'];
    call(game, { text: lines[Math.floor(game.rng.range(0, lines.length)) % lines.length], sub: `${s.player.name} on ${target.player.name}`, color: s.team.def.color, roar: 0.9 });
  } else if (game.rng.range(0, 1) < 0.35) call(game, { text: 'BIG HIT!', sub: s.player.name, color: s.team.def.color, roar: 0.6 });
  if (m.puck.mode === 'held' && m.puck.holder === target) {
    const b = blade(target.player);
    noTake.set(target, now + 1);
    loose(game, b, { x: (dx / d) * 3.5 + game.rng.range(-1.5, 1.5), y: 0.6, z: (dz / d) * 3.5 + game.rng.range(-1.5, 1.5) });
  }
}

/** What each skater is doing, for the screens. */
function skaters(now: number): SkatersMsg {
  const r = (x: number) => Math.round(x * 100) / 100;
  return everyone(m).map((s) => {
    const st = skOf(s.player);
    const saveT = s.save ? now - s.saveAt : 9;
    if (saveT > 1.2) s.save = 0;
    return [s.player.id, r(st?.wind ?? 0), r(st?.shot ?? 0), r(st?.stun ?? 0), isFire(s) ? 1 : 0, s.team.index, (st?.stop ?? 0) > 0 ? 1 : 0, s.save, r(Math.min(9, saveT)), s.goalie ? 1 : 0];
  });
}

/** For the HUD and the tests. */
export function matchNow(): Match {
  return m;
}

export { puckPos };
