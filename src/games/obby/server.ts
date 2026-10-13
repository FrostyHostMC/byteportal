import { defineServer, math, type GameContext, type Player, type Prop, type Vec3 } from '@platform';
import { melee } from '@platform/kits';
import { course, key, type Cell, type Special } from './course';
import { shared } from './shared';

const STAGES = course.stages.length;
const GOLD = '#ffd36b';
/** Sand holds for this long after you land on it, then comes back this long after it fell. */
const CRUMBLE_HOLD = 0.45;
const CRUMBLE_BACK = 3;
/**
 * Blinking platforms: red is solid for the first 2.2 s of every 3.2 (glass for the last 0.4 of
 * that), and blue the same 1.6 s later, so each hands over to the other with 0.6 s to jump.
 */
const BLINK = { period: 3.2, shift: 1.6, on: 1.8, warn: 2.2 };
const BOLT_SPEED = 12;
/** How hard a cannon bolt knocks you sideways (and up). */
const BOLT_KNOCK = { side: 9, up: 6 };
/** The notable stages' achievements, for getting past them (by the stage's name). */
const PASSED: Record<string, string> = { 'Floor is Lava': 'lava_lake', Crumble: 'crumble', Blink: 'blink', 'The Spiral': 'spiral', Crossfire: 'crossfire' };
/** A run this quick (seconds) earns Speedrunner. */
const SPEEDRUN = 120;

/** One player's run: which stage they're on, their clock and falls. */
interface Run {
  /** The stage they're on; its checkpoint is where they come back to. */
  stage: number;
  /** When the clock started (when they left the start island), and their time if they've finished. */
  started: number | null;
  finished: number | null;
  falls: number;
  /** Jumped ahead with `/stage`: the time doesn't count. */
  practice: boolean;
  padCooldown: number;
  best: number | undefined;
}

const runs = new Map<string, Run>();

type Look = 'on' | 'warn' | 'off';
const blink = { A: null as Look | null, B: null as Look | null, pending: new Set<Cell>() };
const crumbles = course.crumble.map((cells) => ({ cells, state: 'solid' as 'solid' | 'shaking' | 'gone', at: 0, pending: [] as Cell[] }));
const bolts: { prop: Prop; dir: Vec3; left: number }[] = [];
const nextShot: number[] = [];

function fmt(s: number) {
  const m = Math.floor(s / 60);
  const sec = s - m * 60;
  return `${m}:${sec.toFixed(1).padStart(4, '0')}`;
}

function runOf(p: Player): Run {
  let r = runs.get(p.id);
  if (!r) runs.set(p.id, (r = freshRun(p)));
  return r;
}

function freshRun(p: Player): Run {
  return { stage: 0, started: null, finished: null, falls: 0, practice: false, padCooldown: 0, best: p.store.get<number>('best') };
}

/**
 * Everyone's best times, fastest first: signed-in players' (`board:<account>`, with the name they
 * had then), and the ones kept by name before accounts (`best:<name>`) until someone claims the name.
 */
function leaderboard(game: GameContext) {
  const board = game.store.keys('board:').map((k) => game.store.get<{ name: string; time: number }>(k) ?? { name: '?', time: Infinity });
  const old = game.store.keys('best:').map((k) => ({ name: k.slice(5), time: game.store.get<number>(k) ?? Infinity }));
  return [...board, ...old].sort((a, b) => a.time - b.time);
}

/** Is anyone standing in this block's space? (Don't put a block back inside a player.) */
function occupied(game: GameContext, c: Cell) {
  return game.players.some((p) => {
    const q = p.position;
    return q.x + 0.3 > c.x && q.x - 0.3 < c.x + 1 && q.z + 0.3 > c.z && q.z - 0.3 < c.z + 1 && q.y + 1.8 > c.y && q.y < c.y + 1;
  });
}

/** The special blocks under a player's feet (any corner of them counts). */
function underfoot(p: Player): Special[] {
  const out: Special[] = [];
  const { x, y, z } = p.position;
  const by = Math.floor(y - 0.05);
  for (const dx of [-0.29, 0.29])
    for (const dz of [-0.29, 0.29]) {
      const s = course.special.get(key(Math.floor(x + dx), by, Math.floor(z + dz)));
      if (s && !out.includes(s)) out.push(s);
    }
  return out;
}

function inLava(game: GameContext, p: Player) {
  const { x, y, z } = p.position;
  const lava = game.world.blockId('lava');
  return game.world.getBlock(Math.floor(x), Math.floor(y + 0.2), Math.floor(z)) === lava || game.world.getBlock(Math.floor(x), Math.floor(y + 0.9), Math.floor(z)) === lava;
}

function onStart(p: Player) {
  const { x, y, z } = p.position;
  const s = course.start;
  return x >= s.x0 && x < s.x1 && z >= s.z0 && z < s.z1 && y > s.y;
}

// ---------------------------------------------------------------------------------------------
// A player's run
// ---------------------------------------------------------------------------------------------

/** Back to the checkpoint (or the finish island, once finished). Falling off the start begins the run afresh. */
function respawn(p: Player, run: Run, why: 'fell' | 'lava' | 'reset') {
  if (why === 'lava' && !run.practice) p.achieve('hot_feet');
  if (run.finished !== null) {
    p.teleport(course.finish, course.finishYaw, 0);
    return;
  }
  const s = course.stages[run.stage];
  p.teleport(s.spawn, s.yaw, 0);
  p.audio.play('respawn');
  if (run.stage === 0 && !run.practice) {
    Object.assign(run, freshRun(p));
    return;
  }
  run.falls++;
  if (why !== 'reset') p.hud.toast(why === 'lava' ? 'Too hot! Back to the checkpoint' : 'Fell! Back to the checkpoint');
}

/** Start again from the start island. */
function restartRun(p: Player) {
  runs.set(p.id, freshRun(p));
  const s = course.stages[0];
  p.teleport(s.spawn, s.yaw, 0);
  p.hud.banner('SKY OBBY', 'The clock starts when you leave the island', { duration: 2.4, color: GOLD });
}

function reach(game: GameContext, p: Player, run: Run, stage: number) {
  // The stages got past, and their achievements (a practice run earns none, as it doesn't count).
  for (let i = run.stage; i < stage && !run.practice; i++) {
    const id = PASSED[course.stages[i].name];
    if (id) p.achieve(id);
  }
  run.stage = stage;
  const s = course.stages[stage];
  p.hud.banner(`Stage ${stage + 1} · ${s.name}`, s.hint, { duration: 3, color: GOLD });
  p.audio.play('checkpoint');
  game.fx.burst({ x: s.spawn.x, y: s.spawn.y + 0.3, z: s.spawn.z }, { color: GOLD, count: 36, speed: 3.5, gravity: -2, glow: 1 });
  if (game.players.length > 1) game.hud.feed(`${p.name} reached stage ${stage + 1}`, { color: GOLD });
}

function launch(game: GameContext, p: Player, run: Run, v: Vec3) {
  // Set the velocity outright, so the pad throws everyone the same way however they arrived.
  const now = p.velocity;
  p.impulse(v.x - now.x, v.y - now.y, v.z - now.z);
  run.padCooldown = 0.4;
  game.audio.play('boing', { at: p.position });
  game.fx.burst(p.position, { color: '#8ff4ff', count: 18, speed: 2.5, glow: 1 });
}

function finish(game: GameContext, p: Player, run: Run, now: number) {
  const time = now - (run.started ?? now);
  run.finished = time;
  const counts = !run.practice;
  const pb = counts && (run.best === undefined || time < run.best);
  if (pb) {
    run.best = time;
    // Theirs for the visit; on the leaderboard for good if they're signed in.
    p.store.set('best', time);
    if (p.account) game.store.set(`board:${p.account.id}`, { name: p.name, time });
  }
  if (counts) {
    p.achieve('finish');
    if (time < SPEEDRUN) p.achieve('speedrun');
    if (run.falls === 0) p.achieve('flawless');
  }
  p.audio.play('victory');
  game.fx.fireworks(course.finish, 6);
  p.hud.banner('FINISHED!', counts ? `${fmt(time)}${pb ? ' · a new personal best' : ''}` : `${fmt(time)} (practice)`, { duration: 3, color: GOLD });
  if (game.players.length > 1) game.hud.feed(`${p.name} finished in ${fmt(time)}${counts ? '' : ' (practice)'}`, { color: GOLD });
  const board = leaderboard(game);
  game.clock.after(2.6, () => {
    if (!game.players.includes(p)) return;
    p.hud.screen({
      title: pb ? 'New personal best!' : 'Course complete!',
      subtitle: counts ? `${STAGES} stages in ${fmt(time)} with ${run.falls} ${run.falls === 1 ? 'fall' : 'falls'}.` : 'A practice run: skipping stages doesn’t count for the leaderboard.',
      tone: 'victory',
      stats: [
        ['Time', fmt(time)],
        ['Falls', String(run.falls)],
        ['Personal best', run.best === undefined ? '—' : fmt(run.best)],
        ...board.slice(0, 5).map((e, i): [string, string] => [`#${i + 1}  ${e.name}${e.name === p.name ? ' (you)' : ''}`, fmt(e.time)]),
      ],
      buttons: [
        { label: 'Run again', primary: true, onClick: () => restartRun(p) },
        { label: 'Look around', onClick: () => {} },
        { label: 'Switch game', onClick: () => game.exit() },
      ],
    });
  });
}

function updatePlayer(game: GameContext, p: Player, dt: number, now: number) {
  const run = runOf(p);
  run.padCooldown -= dt;
  if (p.input.pressed('KeyR')) {
    p.input.consume('KeyR');
    if (run.finished !== null) restartRun(p);
    else respawn(p, run, 'reset');
  }
  if (run.started === null && !onStart(p)) run.started = now;

  if (p.onGround) {
    for (const s of underfoot(p)) {
      if (s.kind === 'checkpoint' && s.stage! > run.stage && run.finished === null) reach(game, p, run, s.stage!);
      else if (s.kind === 'pad' && run.padCooldown <= 0) launch(game, p, run, s.launch!);
      else if (s.kind === 'crumble') crumble(game, s.group!, now);
      else if (s.kind === 'finish' && run.finished === null) finish(game, p, run, now);
    }
  }
  const fallY = run.finished !== null ? course.finish.y - 10 : course.stages[run.stage].fallY;
  if (inLava(game, p)) respawn(p, run, 'lava');
  else if (p.position.y < fallY) respawn(p, run, 'fell');

  const t = run.finished ?? (run.started === null ? 0 : now - run.started);
  const stage = course.stages[run.stage];
  p.hud.objective(run.finished !== null ? `Finished in ${fmt(t)} · R to run again` : `Stage ${run.stage + 1}/${STAGES} · ${stage.name}`);
  p.hud.stat('time', 'Time', fmt(t));
  p.hud.stat('falls', 'Falls', run.falls);
  p.hud.stat('best', 'Best', run.best === undefined ? null : fmt(run.best));
  const last = run.stage + 1 >= STAGES;
  const next = run.finished !== null ? null : last ? course.finish : course.stages[run.stage + 1].spawn;
  p.hud.marker('next', next && { x: next.x, y: next.y + 1.2, z: next.z }, { shape: 'diamond', color: GOLD, label: last ? 'Finish' : `Stage ${run.stage + 2}`, edge: true, size: 16 });
}

// ---------------------------------------------------------------------------------------------
// The moving parts: blinking platforms, crumbling sand, cannons
// ---------------------------------------------------------------------------------------------

function blinkLook(now: number, shift: number): Look {
  const u = (((now - shift) % BLINK.period) + BLINK.period) % BLINK.period;
  return u < BLINK.on ? 'on' : u < BLINK.warn ? 'warn' : 'off';
}

function updateBlink(game: GameContext, now: number) {
  const w = game.world;
  for (const [set, cells, shift] of [
    ['A', course.blinkA, 0],
    ['B', course.blinkB, BLINK.shift],
  ] as const) {
    const look = blinkLook(now, shift);
    if (look === blink[set]) continue;
    blink[set] = look;
    for (const c of cells) {
      if (look === 'on') blink.pending.add(c);
      else {
        blink.pending.delete(c);
        if (look === 'off') w.setBlock(c.x, c.y, c.z, 'air');
        else if (w.getBlock(c.x, c.y, c.z) === w.blockId(c.block)) w.setBlock(c.x, c.y, c.z, 'glass');
      }
    }
    if (look === 'on' && cells.length) game.audio.play('blink', { at: cells[0], volume: 0.5 });
  }
  for (const c of blink.pending) {
    if (occupied(game, c)) continue;
    w.setBlock(c.x, c.y, c.z, c.block);
    blink.pending.delete(c);
  }
}

function crumble(game: GameContext, group: number, now: number) {
  const c = crumbles[group];
  if (c.state !== 'solid') return;
  c.state = 'shaking';
  c.at = now + CRUMBLE_HOLD;
  for (const cell of c.cells) game.world.setBlock(cell.x, cell.y, cell.z, 'gravel');
  game.audio.play('crumble', { at: c.cells[0] });
}

function updateCrumble(game: GameContext, now: number) {
  for (const c of crumbles) {
    if (c.state === 'shaking' && now >= c.at) {
      for (const cell of c.cells) game.world.breakBlock(cell.x, cell.y, cell.z);
      c.state = 'gone';
      c.at = now + CRUMBLE_BACK;
      c.pending = [...c.cells];
    } else if (c.state === 'gone' && now >= c.at) {
      c.pending = c.pending.filter((cell) => occupied(game, cell) || !game.world.setBlock(cell.x, cell.y, cell.z, cell.block));
      if (!c.pending.length) c.state = 'solid';
    }
  }
}

const BOLT_AXIS = new math.Vector3(0, 0, -1);

function updateCannons(game: GameContext, now: number, dt: number) {
  course.cannons.forEach((c, i) => {
    if (now < nextShot[i]) return;
    nextShot[i] += c.period * Math.max(1, Math.ceil((now - nextShot[i]) / c.period));
    // Only when someone's near enough to care.
    if (!game.players.some((p) => Math.hypot(p.position.x - c.from.x, p.position.z - c.from.z) < 40)) return;
    const prop = game.props.bolt({ color: '#ff7a3c', length: 1.3, width: 0.32, intensity: 3 });
    prop.position.set(c.from.x, c.from.y, c.from.z);
    prop.quaternion.setFromUnitVectors(BOLT_AXIS, new math.Vector3(c.dir.x, c.dir.y, c.dir.z));
    bolts.push({ prop, dir: c.dir, left: c.range });
    game.audio.play('cannon', { at: c.from, volume: 0.7 });
  });
  for (const b of [...bolts]) {
    const step = BOLT_SPEED * dt;
    const q = b.prop.position;
    q.set(q.x + b.dir.x * step, q.y + b.dir.y * step, q.z + b.dir.z * step);
    b.left -= step;
    let hit = false;
    for (const p of game.players) {
      const d = p.position;
      if (Math.abs(q.x - d.x) > 0.6 || Math.abs(q.z - d.z) > 0.6 || q.y < d.y - 0.1 || q.y > d.y + 2) continue;
      const v = p.velocity;
      p.impulse(b.dir.x * BOLT_KNOCK.side - v.x, BOLT_KNOCK.up - v.y, b.dir.z * BOLT_KNOCK.side - v.z);
      p.audio.play('hit');
      p.viewModel.kick(1.2);
      game.fx.burst({ x: q.x, y: q.y, z: q.z }, { color: '#ff9a4c', count: 20, speed: 4, glow: 1 });
      hit = true;
      break;
    }
    if (hit || b.left <= 0) {
      b.prop.remove();
      bolts.splice(bolts.indexOf(b), 1);
    }
  }
}

function resetCourse(game: GameContext) {
  blink.A = blink.B = null;
  blink.pending.clear();
  for (const c of crumbles) Object.assign(c, { state: 'solid', at: 0, pending: [] });
  bolts.length = 0;
  course.cannons.forEach((c, i) => (nextShot[i] = game.clock.now + c.offset));
}

// ---------------------------------------------------------------------------------------------
// The game
// ---------------------------------------------------------------------------------------------

/**
 * Sky Obby: a parkour course of ten stages floating in the sky, from stepping stones to lava,
 * crumbling sand, launch pads, blinking platforms, a spiral tower and a cannon-swept walkway. Each
 * player runs it on their own clock (it starts when they leave the start island); falling puts
 * you back at your last checkpoint, and best times go on a leaderboard.
 */
export default defineServer(shared, {
  // Nothing to use but the bare fist.
  items: [melee()],
  setup(game) {
    // (Its voices are each screen's, `client/sounds.ts`: played here by name.)
    game.events.on('playerJoin', ({ player }) => {
      // Signed in for the first time since claiming their name: the best time kept by it is theirs.
      if (player.adopted && player.account) {
        const old = game.store.get<number>(`best:${player.adopted}`);
        if (old !== undefined) {
          player.store.set('best', old);
          game.store.set(`board:${player.account.id}`, { name: player.name, time: old });
        }
        game.store.delete(`best:${player.adopted}`);
      }
      runs.set(player.id, freshRun(player));
      player.hud.banner('SKY OBBY', 'The clock starts when you leave the island', { duration: 3, color: GOLD });
      game.hud.feed(`${player.name} joined the course`, { color: GOLD });
    });
    game.events.on('playerLeave', ({ player }) => runs.delete(player.id));

    game.commands.register('reset', {
      help: 'Start your run again from the beginning',
      run: (_args, _game, player) => {
        restartRun(player);
        return 'Back to the start';
      },
    });
    game.commands.register('stage', {
      usage: '<1-10>',
      help: 'Practise a stage (the run won’t count)',
      cheat: true,
      complete: () => course.stages.map((_, i) => String(i + 1)),
      run: ([n], g, player) => {
        const i = Number(n) - 1;
        if (!(i >= 0 && i < STAGES)) throw new Error(`Pick a stage from 1 to ${STAGES}`);
        const run = runOf(player);
        Object.assign(run, { stage: i, practice: true, finished: null, started: run.started ?? g.clock.now });
        player.teleport(course.stages[i].spawn, course.stages[i].yaw, 0);
        return `Stage ${i + 1}: ${course.stages[i].name}`;
      },
    });
    game.commands.register('top', {
      help: 'The fastest runs',
      run: (_args, g) => {
        const board = leaderboard(g).slice(0, 5);
        return board.length ? board.map((e, i) => `#${i + 1} ${e.name} ${fmt(e.time)}`).join(' · ') : 'Nobody has finished yet';
      },
    });
  },

  start(game) {
    runs.clear();
    resetCourse(game);
    for (const p of game.players) {
      runs.set(p.id, freshRun(p));
      p.hud.banner('SKY OBBY', 'The clock starts when you leave the island', { duration: 3, color: GOLD });
    }
  },

  update(game, dt) {
    const now = game.clock.now;
    updateBlink(game, now);
    updateCrumble(game, now);
    updateCannons(game, now, dt);
    for (const p of game.players) updatePlayer(game, p, dt, now);
  },
});
