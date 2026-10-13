import { readFileSync } from 'node:fs';
import { defineGame, type Player } from '../../src/platform';
import { GameHost } from '../../src/platform/host/game';
import type { PlayerInput } from '../../src/platform/net/protocol';
import { guns as gunKit, melee } from '../../src/platform/kits';
import { sanitizeCommand } from '../../src/platform/net/validate';
import { check } from './_harness';

const wasm = readFileSync('engine/pkg/voxel_engine_bg.wasm');

/** A flat field, a gun with no spread, player against player, and a bot. */
const range = defineGame({
  id: 'range',
  title: 'Range',
  world: { terrain: 'flat', flatHeight: 64, spawn: { x: 0.5, y: 65, z: 0.5 }, time: 0.5, freezeTime: true },
  player: { health: 100, hurtCooldown: 0, pvp: true, hotbar: 'items', movement: { walk: 5, slide: true, mantle: true } },
  items: [gunKit(), melee()],
  setup(game) {
    game.items.define('rifle', {
      kind: 'gun',
      name: 'Rifle',
      icon: 'iron_sword',
      rpm: 600,
      auto: true,
      damage: 10,
      headshot: 2,
      magazine: 30,
      reload: 1,
      spread: { hip: 0, aim: 0, move: 0, air: 0, bloom: 0 },
      recoil: { up: 0, side: 0 },
    });
  },
});

const idle = (viewSeq: number): PlayerInput => ({ active: true, down: [], pressed: [], buttons: 0, clicked: 0, mouseX: 0, mouseY: 0, wheel: 0, yaw: 0, pitch: 0, viewSeq, acts: { gun: [] } });

/**
 * Guns online: a shot is checked where its target was on the shooter's screen (the host rewinds
 * to the time the shooter says it was showing), no further back than the cap; the host won't take
 * shots faster than the gun fires; bots walk and shoot through their controls.
 */
export default function guns() {
  const host = new GameHost(range, { engine: wasm, seed: 1, remote: true, radius: 3, budget: Infinity, player: { id: 'p1', name: 'Ann' } });
  const ann = host.connect('Ann');
  const bob = host.connect('Bob');
  host.command(ann.id, { t: 'start' });
  host.command(bob.id, { t: 'start' });
  const sim = host.sim;
  const A = sim.players.find((p) => p.id === ann.id)!;
  const B = sim.players.find((p) => p.id === bob.id)!;
  const step = (n = 1) => {
    for (let i = 0; i < n; i++) host.step(1 / 30);
  };
  step(3);
  A.api.teleport({ x: 0.5, y: 65, z: 20.5 }, 0, 0);
  B.api.teleport({ x: -6.5, y: 65, z: 0.5 }, -Math.PI / 2, 0);
  A.api.inventory.give('rifle');
  step(20);
  const damage: { amount: number; head: boolean }[] = [];
  const hits = (): number => damage.length;
  sim.ctx.events.on('playerDamage', (e) => {
    if (e.player === B.api) damage.push({ amount: e.amount, head: !!e.headshot });
  });

  // Bob runs across Ann's view, along +x.
  const bobWalks = () => host.command(bob.id, { t: 'input', input: { ...idle(B.viewSeq), yaw: -Math.PI / 2, down: ['KeyW'] } });
  bobWalks();
  const trail: { t: number; x: number; y: number; z: number }[] = [];
  for (let i = 0; i < 40; i++) {
    step();
    trail.push({ t: sim.time, ...B.position });
  }
  const moved = trail.at(-1)!.x - trail[0].x;
  check(moved > 4, `Bob strafed: ${moved.toFixed(2)} blocks`);

  // Aim at Bob's chest where he was 0.2 s ago.
  const past = trail[trail.length - 1 - 6];
  const aimAt = (p: { x: number; y: number; z: number }, dy: number) => {
    const e = A.eye;
    const dx = p.x - e.x;
    const dz = p.z - e.z;
    const h = p.y + dy - e.y;
    return { yaw: Math.atan2(-dx, -dz), pitch: Math.atan2(h, Math.hypot(dx, dz)) };
  };
  let serial = 1;
  const fire = (aim: { yaw: number; pitch: number }, seen: number) => {
    host.command(ann.id, { t: 'input', input: { ...idle(A.viewSeq), yaw: aim.yaw, pitch: aim.pitch, acts: { gun: [[serial++, aim.yaw, aim.pitch, 0]] }, seen } });
    bobWalks();
    step();
  };
  // Seen then: a hit.
  fire(aimAt(past, 1.0), past.t);
  check(hits() === 1 && Math.abs(damage[0].amount - 10) < 1e-6 && !damage[0].head, `a body hit where Bob was on Ann's screen: ${JSON.stringify(damage)}`);
  // The same aim, but Ann's screen was showing now: Bob has moved on, a miss.
  const stale = trail[trail.length - 1 - 3];
  fire(aimAt(stale, 1.0), sim.time);
  check(hits() === 1, `a shot at where Bob no longer is misses (${damage.length} hits)`);
  // His head, then.
  const back = { t: sim.time - 1 / 30, ...B.position };
  fire(aimAt(back, 1.78), back.t);
  check(hits() === 2 && damage[1].head && Math.abs(damage[1].amount - 20) < 1e-6, `a head hit counts double: ${JSON.stringify(damage[1])}`);
  // Not more than the cap back (a lagging screen can't hit where someone was a second ago).
  const old = trail[0];
  fire(aimAt(old, 1.0), old.t);
  check(hits() === 2, 'a shot a second in the past is held to the rewind cap and misses');

  // Firing faster than the gun: the host takes what the gun could have fired.
  let shots = 0;
  sim.ctx.events.on('shot', (e) => {
    if (e.player === A.api) shots++;
  });
  step(30);
  const burst = Array.from({ length: 8 }, () => [serial++, 0, 0, 0] as [number, number, number, number]);
  host.command(ann.id, { t: 'input', input: { ...idle(A.viewSeq), acts: { gun: burst }, seen: sim.time } });
  step();
  check(shots >= 2 && shots <= 4, `8 shots in one tick from a 600 rpm gun: the host took ${shots}`);
  const ammo = gunKit.of(sim.ctx)!.ammo(A.api, 'rifle');
  check(ammo !== null && ammo.magazine === 30 - 4 - shots, `rounds spent: ${JSON.stringify(ammo)}`);

  // A bot: walks forward on its own controls, and fires from its trigger.
  const bot = sim.ctx.bots.add('Dummy');
  check(sim.ctx.players.includes(bot as Player) && bot.bot, 'the bot is one of the players');
  bot.teleport({ x: 10.5, y: 65, z: 10.5 }, 0, 0);
  bot.inventory.give('rifle');
  step(12);
  const b0 = bot.position;
  bot.controls.hold('KeyW');
  bot.controls.look(Math.PI, 0);
  let botShots = 0;
  sim.ctx.events.on('shot', (e) => {
    if (e.player === bot) botShots++;
  });
  bot.controls.button(0);
  step(30);
  bot.controls.release();
  const b1 = bot.position;
  check(b1.z - b0.z > 2, `the bot walked (+z, facing yaw pi): ${(b1.z - b0.z).toFixed(2)}`);
  check(botShots >= 7 && botShots <= 12, `the bot fired at the gun's rate for a second: ${botShots} shots`);
  check(host.step(1 / 30).get(ann.id)!.frame!.players.some((p) => p.bot && p.name === 'Dummy'), 'others see the bot in their frames');
  sim.ctx.bots.remove(bot);
  check(!sim.ctx.players.includes(bot as Player), 'removed');
  console.log(`  rewound hits: body ${damage[0].amount}, head ${damage[1].amount}; stale and over-the-cap shots missed; burst of 8 → ${shots}; bot walked ${(b1.z - b0.z).toFixed(1)} and fired ${botShots}`);

  // What a screen sends of its kits' actions, as the server takes it: plain values kept; a kind
  // every object has (`constructor`), a thing that isn't plain data, or too many turned away.
  const acts = (a: unknown) => (sanitizeCommand({ t: 'input', input: { ...idle(0), acts: a } }) as { input?: PlayerInput } | null)?.input?.acts;
  check(JSON.stringify(acts({ gun: [[1, 0.5, -0.2, 1.5]], throwable: [] })) === '{"gun":[[1,0.5,-0.2,1.5]],"throwable":[]}', 'plain actions are kept');
  check(acts({ constructor: [[1]] }) === undefined && acts({ gun: [[{ x: 1 }]] }) === undefined && acts({ gun: [[Infinity]] }) === undefined, 'a kind every object has, or values that aren\'t plain, are turned away');
  check(acts({ gun: Array.from({ length: 9 }, () => [1]) }) === undefined && acts({ gun: [Array.from({ length: 17 }, () => 1)] }) === undefined, 'too many actions, or too long a one, are turned away');
}
