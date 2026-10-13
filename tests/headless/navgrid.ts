import { readFileSync } from 'node:fs';
import { LETHALS, WEAPONS } from '../../src/games/callofblocky/weapons';
import { Blueprint, defineGame, type Bot, type Vec3 } from '../../src/platform';
import { guns, melee, navGrid, shooterBots, throwables, type NavCell, type NavGrid, type ShooterBots } from '../../src/platform/kits';
import { Headless } from '../../src/platform/host/headless';
import { check } from './_harness';

const wasm = readFileSync('engine/pkg/voxel_engine_bg.wasm');
const FLOOR = 64;

/**
 * A yard split by a stone wall three high along z = 0, from x = -12 to 8: the only way from one
 * side to the other is round its end (x = 9..12). Its blocks can be shot into.
 */
function yard(): Blueprint {
  const bp = new Blueprint({ x: -12, y: FLOOR - 1, z: -10 }, { x: 25, y: 5, z: 21 });
  bp.fill({ x: -12, y: FLOOR - 1, z: -10 }, { x: 12, y: FLOOR - 1, z: 10 }, 'stone');
  bp.fill({ x: -12, y: FLOOR, z: 0 }, { x: 8, y: FLOOR + 2, z: 0 }, 'stone');
  return bp;
}

/** What the test drives each tick. */
let tick: ((dt: number) => void) | null = null;

const walled = defineGame({
  id: 'walled',
  title: 'Walled yard',
  world: { terrain: 'void', structures: [yard()], spawn: { x: 0.5, y: FLOOR, z: 8.5 }, time: 0.5, freezeTime: true, destructible: { above: FLOOR - 1 } },
  player: { health: 100, hurtCooldown: 0, hotbar: 'items', pvp: true },
  items: [throwables(), guns(), melee()],
  setup(game) {
    game.items.define('pistol', WEAPONS.pistol);
    game.items.define('frag', LETHALS.frag);
  },
  update(_game, dt) {
    tick?.(dt);
  },
});

const A: Vec3 = { x: 0.5, y: FLOOR, z: -5.5 };
const B: Vec3 = { x: 0.5, y: FLOOR, z: 5.5 };
const through = (path: NavCell[] | null, x: number) => !!path?.some((c) => c.z === 0 && c.x === x);

/** Carve a hole through the wall at column x: `w` wide (blocks, centred), from the floor to `top`, leaving the rest of the blocks standing. */
function hole(h: Headless, x: number, w: number, bottom: number, top: number) {
  const r = 0.2;
  for (let cx = x + 0.5 - w / 2 + r; cx <= x + 0.5 + w / 2 - r + 1e-6; cx += 0.1)
    for (let y = FLOOR + bottom + 0.1; y <= FLOOR + top - 0.1 + 1e-6; y += 0.1) h.ctx.world.carve({ x: cx, y, z: -0.5 }, { x: 0, y: 0, z: 1 }, { radius: r, depth: 2 });
}

/**
 * The `navGrid` kit keeps up with the world: a hole carved through a wall (the blocks still
 * standing round it) becomes a way through, a block put in it closes it, a block broken out of
 * the wall opens another, and a restart puts the wall back. A `shooterBots` bot walks through the
 * hole, and sees and shoots someone through a hole too small to walk through (holding still so it
 * doesn't lose the line). And it keeps out of a live grenade: it runs from one dropped beside it,
 * and waits short of one lying where it was going.
 */
export default function navgrid() {
  // Bots draw on Math.random: seeded, so a run plays out the same whatever ran before it.
  Math.random = mulberry32(7);
  const h = new Headless(walled, { wasm, wire: true, radius: 3 });
  h.start();
  h.run(0.2);
  const g = h.ctx;
  let changes = 0;
  g.events.on('blockChange', () => changes++);
  const nav: NavGrid = navGrid(g, { bounds: { min: { x: -12, y: FLOOR - 1, z: -10 }, max: { x: 12, y: FLOOR + 4, z: 10 } } });
  check(nav.ready, 'the grid should build once the yard has loaded');

  // ---- Round the end of the wall ----
  const around = nav.path(A, B);
  check(around && around.some((c) => c.x >= 9 && c.z === 0), 'with the wall whole, the way is round its end');
  check(!through(around, 0), 'no way through a whole wall');
  console.log(`  ${nav.size} cells; round the wall: ${around!.length} steps`);

  // ---- A hole through it: the blocks still stand round it, and the way goes through ----
  const opened = nav.opened;
  hole(h, 0, 0.72, 0, 1.9);
  const left = g.world.carved(0, FLOOR, 0);
  check(left > 0.2 && left < 0.9, `the wall's blocks should be holed, not gone (${(left * 100).toFixed(0)}% carved)`);
  check(g.world.getBlock(0, FLOOR, 0) === g.world.blockId('stone'), 'the holed block is still there');
  check(changes > 0, 'carving fires blockChange');
  check(g.world.fits({ x: 0.5, y: FLOOR, z: 0.5 }), 'a body fits in the hole');
  check(!g.world.fits({ x: 0.1, y: FLOOR, z: 0.5 }), "but not in what's left of the wall beside it");
  const short = nav.path(A, B);
  check(nav.opened > opened, 'a hole a body fits through opens a new way');
  check(through(short, 0), `the way should go through the hole now (${short?.map((c) => `${c.x},${c.z}`).join(' ')})`);
  const cell = short!.find((c) => c.z === 0)!;
  check(cell.hole && Math.abs(cell.at.x - 0.5) < 0.25, 'the hole is a hole cell, walked through near its middle');
  check(short!.length < around!.length - 6, `through the hole is shorter (${short!.length} steps)`);
  // A hole too small for a body is no way through (but it lets a shot through).
  hole(h, -6, 0.4, 1.1, 1.6);
  check(!through(nav.path({ x: -5.5, y: FLOOR, z: -3.5 }, { x: -5.5, y: FLOOR, z: 3.5 }), -6), 'no way through a hole too small for a body');
  console.log(`  through the hole: ${short!.length} steps (${changes} block changes carving it, ${(left * 100).toFixed(0)}% of the block carved)`);

  // ---- A bot walks through it ----
  const bot = g.bots.add('Walker') as Bot;
  bot.teleport(A, 0, 0);
  let goal: Vec3 | null = B;
  let hostile = false;
  const bots: ShooterBots = shooterBots(g, { nav, hostile: () => hostile, goal: () => goal });
  bots.add(bot, 0.6);
  tick = (dt) => bots.update(dt);
  let crossedAt = null as number | null;
  h.run(12, {
    pilot: () => null,
    until: () => {
      const p = bot.position;
      if (crossedAt === null && p.z > 0.5) crossedAt = p.x;
      return p.z > 4.5;
    },
  });
  check(bot.position.z > 4.5, `the bot should get through (it's at ${bot.position.x.toFixed(2)}, ${bot.position.z.toFixed(2)})`);
  check(crossedAt !== null && crossedAt > 0 && crossedAt < 1, `the bot should cross the wall through the hole, not round the end (at x = ${crossedAt})`);
  console.log(`  the bot walked through the hole at x = ${crossedAt!.toFixed(2)}`);

  // ---- It sees someone through a hole too small to walk through, and shoots through it ----
  goal = null;
  hostile = true;
  const me = g.player;
  me.teleport({ x: -5.5, y: FLOOR, z: 3.5 }, 0, 0);
  bot.teleport({ x: -5.5, y: FLOOR, z: -3.5 }, Math.PI, 0);
  bot.inventory.clear();
  bot.inventory.give('pistol');
  bots.reset(bot);
  check(g.world.lineOfSight({ x: -5.5, y: FLOOR + 1.62, z: -3.5 }, { x: -5.5, y: FLOOR + 1.1, z: 3.5 }), 'the small hole lets a line of sight through');
  let shots = 0;
  g.events.on('shot', ({ player }) => player === bot && shots++);
  // (Tough enough to take every hit, so they stay a target.)
  me.maxHealth = 5000;
  me.health = 5000;
  let saw = 0;
  let moved = 0;
  h.run(4, {
    pilot: () => null,
    until: () => {
      if (bots.mind(bot)?.target === me) saw++;
      moved = Math.max(moved, Math.hypot(bot.position.x + 5.5, bot.position.z + 3.5));
      return false;
    },
  });
  check(saw > 120, `the bot should see them through the hole (in sight ${(saw / 60).toFixed(1)} s of 4)`);
  check(shots >= 3, `the bot should shoot through the hole (${shots} shots)`);
  check(me.health < 5000, 'and hit them');
  check(moved < 0.6, `the bot should hold still at a peephole (it moved ${moved.toFixed(2)})`);
  console.log(`  through a peephole: ${shots} shots, ${(5000 - me.health).toFixed(0)} damage, the bot moved ${moved.toFixed(2)}`);
  hostile = false;

  // ---- A grenade beside it: it gets out of reach before it goes off ----
  /** Drop a frag at `at` (thrown straight down from there); the time it went off, and where. */
  const drop = (at: Vec3) => {
    me.teleport(at, 0, 0);
    me.inventory.give('frag');
    check(throwables.of(g)!.throw(me, 'frag', { pitch: -Math.PI / 2 }), 'the frag should be thrown');
    me.teleport({ x: 11.5, y: FLOOR, z: 8.5 }, 0, 0);
  };
  const frag = LETHALS.frag.blast!.radius;
  // (Told to stay where it is.)
  goal = A;
  bot.teleport(A, 0, 0);
  bots.reset(bot);
  bot.health = bot.maxHealth;
  h.run(0.5);
  drop({ x: A.x + 1.5, y: FLOOR, z: A.z });
  let far = 0;
  h.run(4, {
    pilot: () => null,
    until: () => {
      const t = throwables.of(g)!.thrown()[0];
      if (t) far = Math.hypot(bot.position.x - t.position.x, bot.position.z - t.position.z);
      return false;
    },
  });
  check(far > frag && bot.health === bot.maxHealth, `the bot should run clear of a grenade beside it (${far.toFixed(1)} blocks off as it went, health ${bot.health})`);
  // ---- One lying where it was going: it waits short of it, and goes on once it's gone off ----
  const start = { x: -8.5, y: FLOOR, z: 5.5 };
  goal = start;
  if (!bot.alive) bot.revive();
  bot.health = bot.maxHealth;
  bot.teleport(start, 0, 0);
  bots.reset(bot);
  h.run(0.3);
  drop(B);
  goal = B;
  let closest = Infinity;
  let live = true;
  h.run(8, {
    pilot: () => null,
    until: () => {
      live = throwables.of(g)!.thrown().length > 0;
      if (live) closest = Math.min(closest, Math.hypot(bot.position.x - B.x, bot.position.z - B.z));
      return !live && Math.hypot(bot.position.x - B.x, bot.position.z - B.z) < 1;
    },
  });
  check(closest > frag && bot.health === bot.maxHealth, `the bot should wait out of reach of a grenade where it's going (came within ${closest.toFixed(1)})`);
  check(Math.hypot(bot.position.x - B.x, bot.position.z - B.z) < 1, 'and get there once it has gone off');
  console.log(`  grenades: ran ${far.toFixed(1)} blocks clear of one beside it; waited ${closest.toFixed(1)} short of one on its way, then went on`);
  tick = null;
  goal = null;
  me.teleport({ x: 0.5, y: FLOOR, z: 8.5 }, 0, 0);

  // ---- A block put in the hole closes it; one broken out of the wall opens another ----
  const holeCell = cell;
  g.world.setBlock(0, FLOOR, 0, 'stone');
  g.world.setBlock(0, FLOOR + 1, 0, 'stone');
  check(!nav.has(holeCell), 'the hole cell goes when the hole is filled');
  check(!through(nav.path(A, B), 0), 'a filled hole is no way through');
  g.world.breakBlock(-4, FLOOR, 0);
  g.world.breakBlock(-4, FLOOR + 1, 0);
  const broken = nav.path(A, B);
  check(through(broken, -4), 'a gap broken out of the wall is a way through');
  check(!broken!.find((c) => c.z === 0)!.hole, 'a gap where the blocks have gone is just open');

  // ---- A restart puts the wall back ----
  g.restart();
  const again = nav.path(A, B);
  check(!through(again, -4) && !through(again, 0) && again!.some((c) => c.x >= 9), 'after a restart the way is round the wall again');
  bots.dispose();
  nav.dispose();
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
