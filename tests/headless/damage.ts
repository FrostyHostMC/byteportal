import { readFileSync } from 'node:fs';
import { deflateRawSync } from 'node:zlib';
import type { VoxelWorld } from '@engine/voxel_engine.js';
import { WEAPONS } from '../../src/games/callofblocky/weapons';
import { Blueprint, defineGame, type GameDefinition } from '../../src/platform';
import type { GunItem } from '../../src/platform/items';
import { Predictor } from '../../src/platform/client/predict';
import { GameHost, GeneratedWorld } from '../../src/platform/host/game';
import { Headless } from '../../src/platform/host/headless';
import { serveGame } from '../../src/platform/host/server';
import { worldGenConfig } from '../../src/platform/workers/config';
import { decode, encode } from '../../src/platform/net/codec';
import { FrameReader } from '../../src/platform/net/delta';
import type { ClientCommand, HostBatch, HostEvent, PlayerInput, ServerWelcome, TimedBatch, WireBatch } from '../../src/platform/net/protocol';
import type { SimFrame } from '../../src/platform/sim/sim';
import { blockIdOf, loadRegistry } from '../../src/platform/world/registry';
import { guns, melee } from '../../src/platform/kits';
import { check, launch } from './_harness';

const wasm = readFileSync('engine/pkg/voxel_engine_bg.wasm');
const FLOOR = 64;
/** A stone wall a block thick at z = -6 (x = -4..4, four high): its face toward the players is at z = -5. */
const WALL_Z = -6;

function yard(): Blueprint {
  const bp = new Blueprint({ x: -8, y: FLOOR - 1, z: -12 }, { x: 17, y: 5, z: 21 });
  bp.fill({ x: -8, y: FLOOR - 1, z: -12 }, { x: 8, y: FLOOR - 1, z: 8 }, 'stone');
  bp.fill({ x: -4, y: FLOOR, z: WALL_Z }, { x: 4, y: FLOOR + 3, z: WALL_Z }, 'stone');
  return bp;
}

/** A Call of Blocky gun held dead steady (no spread): every shot on the same spot; and not through walls (carving alone). */
const steady = (id: string): GunItem => ({ ...(WEAPONS[id] as GunItem), spread: { hip: 0, aim: 0, move: 0, air: 0, bloom: 0 }, penetration: undefined });

const range = defineGame({
  id: 'carving',
  title: 'Carving range',
  world: { terrain: 'void', structures: [yard()], spawn: { x: 0.5, y: FLOOR, z: 0.5 }, time: 0.5, freezeTime: true, destructible: { above: FLOOR - 1 } },
  player: { health: 100, hurtCooldown: 0, hotbar: 'items', pvp: true },
  items: [guns(), melee()],
  setup(game) {
    // Call of Blocky's guns as they are, one held steady, and one that doesn't carve.
    for (const id of ['rifle', 'smg', 'shotgun', 'sniper', 'pistol']) game.items.define(id, WEAPONS[id]);
    game.items.define('steady', steady('rifle'));
    game.items.define('nerf', { ...steady('rifle'), carve: false });
  },
});

/** A client's copy of the world: generated the same way, taking in every edit and change the host sends. */
function copyOf(def: GameDefinition, seed: number) {
  const reg = loadRegistry();
  const gw = new GeneratedWorld(seed, worldGenConfig(def, (b) => blockIdOf(reg, b)));
  gw.update([{ x: 0, z: 0 }], 2, Infinity);
  return {
    world: gw.world,
    take(events: HostEvent[]) {
      for (const e of events) {
        if (e.t === 'edits') for (const [x, y, z, id] of e.cells) gw.world.mirror_block(x, y, z, id);
        else if (e.t === 'damage') gw.world.apply_damage(e.data);
        else if (e.t === 'revert') gw.world.revert_edits();
      }
    },
    free: () => gw.dispose(),
  };
}

/**
 * Whether two copies of the world agree about the wall: every block, what's left of each, and
 * where rays (a grid of them, 1/32 of a block apart, straight through it) stop.
 */
function same(a: VoxelWorld, b: VoxelWorld): boolean {
  for (let y = FLOOR - 1; y <= FLOOR + 4; y++)
    for (let z = WALL_Z - 1; z <= WALL_Z + 1; z++)
      for (let x = -6; x <= 6; x++) if (a.get_block(x, y, z) !== b.get_block(x, y, z) || a.damage_left(x, y, z) !== b.damage_left(x, y, z)) return false;
  for (let x = -2; x < 3; x += 1 / 32)
    for (let y = FLOOR; y < FLOOR + 3; y += 1 / 32) {
      const [ha, , , , , , , , ta] = a.raycast(x, y, 0, 0, 0, -1, 12);
      const [hb, , , , , , , , tb] = b.raycast(x, y, 0, 0, 0, -1, 12);
      if (ha !== hb || ta !== tb) return false;
    }
  return true;
}

/** Hold still, gun `id` in hand, looking straight at the wall from `x`, down its sights. */
function aimAtWall(h: Headless, id: string, x = 0.5) {
  const me = h.me;
  me.api.inventory.give(id);
  me.api.inventory.select(me.api.inventory.slots.findIndex((s) => s?.item === id));
  me.api.teleport({ x, y: FLOOR, z: 0.5 }, 0, 0);
  h.run(0.6, { pilot: () => ({ buttons: 4 }) });
}

/** Tap one shot down the sights (pulling until the gun's ready), and let its bloom settle. */
function fire(h: Headless) {
  // (Each shot counts up the gun's serial.)
  const serial = () => guns.of(h.ctx)!.held(h.ctx.player)?.state.serial ?? 0;
  const before = serial();
  for (let i = 0; i < 600 && serial() === before; i++) h.step(1 / 60, { buttons: 5, clicked: 1 });
  h.run(0.35, { pilot: () => ({ buttons: 4 }) });
  check(serial() > before, 'the gun fired');
}

/** Whether a ray from the eye straight ahead gets through the wall now. */
function through(h: Headless): boolean {
  const e = h.me.eye;
  const [hit, , , bz] = h.host.world.world.raycast(e.x, e.y, e.z, 0, 0, -1, 20);
  return !hit || bz < WALL_Z;
}

/**
 * Blocks you can shoot holes in (`world.destructible`, `world.carve`, `GunItem.carve`): the host
 * carves where its bullets land (Call of Blocky's guns take about eight rifle shots to hole a
 * wall, two from the sniper), each client's copy of the world takes the same changes (over the
 * wire, over a real socket, and all at once for a late joiner), a restart makes it all whole,
 * and a client predicting its own movement walks through a hole the host shot with no
 * corrections.
 */
export default async function damage() {
  // ---- Guns carve, on the host; a client's copy (through the socket encoding) agrees ----
  const h = new Headless(range, { wasm, wire: true, radius: 3 });
  h.start();
  h.run(0.2);
  const mine = copyOf(range, h.host.seed);
  const step = h.step.bind(h);
  let damageBytes = 0;
  let damageEvents = 0;
  h.step = (dt: number, input?: Partial<PlayerInput> | null): HostBatch => {
    const b = step(dt, input);
    for (const e of b.events) if (e.t === 'damage') ((damageBytes += e.data.length), damageEvents++);
    mine.take(b.events);
    return b;
  };
  const world = h.host.world.world;
  const report: string[] = [];
  for (const id of ['steady', 'rifle', 'smg', 'pistol', 'sniper']) {
    aimAtWall(h, id);
    let shots = 0;
    while (shots < 40 && !through(h)) {
      fire(h);
      shots++;
    }
    report.push(`${id} ${shots}`);
    check(through(h), `${id}: a hole through the wall`);
    check(world.damage_count() > 0 && same(world, mine.world), `${id}: the client's copy has the same hole`);
    // A restart puts the wall back whole, on the host and on the client.
    h.ctx.restart();
    h.step(1 / 60, {});
    check(world.damage_count() === 0 && mine.world.damage_count() === 0 && !through(h), `${id}: whole again after the restart`);
    check(same(world, mine.world), `${id}: the copies agree after the restart`);
  }
  const [held, rifle, smg, pistol, sniper] = report.map((r) => Number(r.split(' ')[1]));
  check(held === 8, `a rifle held dead steady (not wall-banging): eight (${report})`);
  // The rifle and the pistol wall-bang (the pistol once the wall's thin enough): each bullet that
  // goes through holes the far side too, so the two pits meet sooner.
  check(rifle >= 3 && rifle <= 10 && pistol >= 3 && pistol <= 10 && rifle < held, `rifle and pistol: 3 to 10 shots to hole a wall, the rifle sooner through it (${report})`);
  check(smg > rifle && smg <= 16, `the SMG takes a few more (${report})`);
  check(sniper <= 2, `the sniper two (${report})`);

  // The shotgun: small pits, many of them.
  aimAtWall(h, 'shotgun');
  fire(h);
  const pits = world.damage_count();
  let taken = 0;
  for (let y = FLOOR; y < FLOOR + 4; y++) for (let x = -4; x <= 4; x++) taken += 4096 - world.damage_left(x, y, WALL_Z);
  check(pits >= 1 && taken > 0 && taken < 900, `the shotgun peppers the wall: ${taken} little voxels from ${pits} blocks`);
  check(same(world, mine.world), 'the client has the pellet pits');
  // A gun that doesn't carve, and the floor (not above the line): untouched.
  h.ctx.restart();
  aimAtWall(h, 'nerf');
  fire(h);
  check(world.damage_count() === 0, 'carve: false leaves the wall alone');
  aimAtWall(h, 'rifle');
  h.me.api.teleport({ x: 0.5, y: FLOOR, z: 0.5 }, 0, -1.2);
  h.run(0.3);
  fire(h);
  check(world.damage_count() === 0, 'the floor is whole');
  // `world.carve` on purpose: a blast that takes blocks out altogether (edits, events, debris).
  const broken: string[] = [];
  h.ctx.events.on('blockBreak', (e) => broken.push(`${e.block}@${e.x},${e.y},${e.z}`));
  const removed = h.ctx.world.carve({ x: 0.5, y: FLOOR + 1.5, z: WALL_Z + 1.2 }, { x: 0, y: 0, z: -1 }, { radius: 1, depth: 1 });
  h.step(1 / 60, {});
  check(removed > 4096 && world.get_block(0, FLOOR + 1, WALL_Z) === 0 && broken.includes(`stone@0,${FLOOR + 1},${WALL_Z}`), `a blast took the block out: ${removed} voxels, ${broken.length} broken`);
  check(h.ctx.world.carve({ x: 0.5, y: FLOOR + 1.5, z: WALL_Z + 1.2 }, { x: 0, y: 0, z: -1 }, { radius: 1, depth: 1 }) === 0, 'the same blast again takes nothing');
  check(same(world, mine.world), 'the client has the blast');
  h.ctx.restart();
  h.step(1 / 60, {});
  check(world.get_block(0, FLOOR + 1, WALL_Z) === blockIdOf(h.sim.registry, 'stone') && same(world, mine.world), 'the blast undone');
  mine.free();
  console.log(`  shots to hole a block-thick wall, tapping on one spot down the sights: ${report.join(', ')} · shotgun: ${taken} voxels a shot, in ${pits} block(s) · ${damageEvents} damage events, ${(damageBytes / damageEvents).toFixed(0)} bytes each`);

  // ---- Call of Blocky: its walls carve, its street doesn't, a new match is whole ----
  const cob = launch('callofblocky', { seed: 3 });
  cob.run(1);
  const cw = cob.ctx.world;
  const wall = cw.raycast({ x: -18.5, y: FLOOR + 1.5, z: 0.5 }, { x: 0, y: 0, z: 1 }, 30);
  check(wall && cw.blockInfo(wall.block)?.solid, `a house wall across the street: ${wall && cw.blockName(wall.block)}`);
  check(cw.carve(wall!.point, { x: 0, y: 0, z: 1 }, { radius: 0.1, depth: 0.05 }) > 0, 'Call of Blocky: the wall chips');
  check(cw.carve({ x: -18.5, y: FLOOR, z: 3.5 }, { x: 0, y: -1, z: 0 }, { radius: 0.5, depth: 3 }) === 0, 'the street and what is under it: whole');
  check(cob.world.world.damage_count() > 0, 'damaged');
  cob.ctx.restart();
  check(cob.world.world.damage_count() === 0, 'a new match is whole');

  // ---- Over a real socket: the same holes for a player there all along and one who joins late ----
  const srv = await serveGame(range, { port: 0, seed: 5, wasm, tickRate: 30 });
  try {
    const ann = await join(srv.port, 'Ann');
    const host = srv.host(range.id)!;
    const hw = host.world.world;
    const annCopy = copyOf(range, ann.welcome.seed);
    const shots = [-2.5, -0.5, 1.5, 2.5].map((x, i) => ({ x, y: FLOOR + 0.5 + i * 0.7, z: WALL_Z + 1 }));
    for (const p of shots) host.sim.ctx.world.carve(p, { x: 0, y: 0, z: -1 }, { radius: 0.1, depth: 0.05 });
    host.sim.ctx.world.carve({ x: -3.5, y: FLOOR + 2.5, z: WALL_Z + 1.5 }, { x: 0, y: 0, z: -1 }, { radius: 1, depth: 1 });
    await wait(200);
    annCopy.take(ann.events());
    check(hw.damage_count() > 4 && same(hw, annCopy.world), `Ann sees the same holes (${hw.damage_count()} damaged blocks)`);
    const bob = await join(srv.port, 'Bob');
    const bobCopy = copyOf(range, bob.welcome.seed);
    const bobEvents = bob.events();
    bobCopy.take(bobEvents);
    check(bobEvents.some((e) => e.t === 'damage') && same(hw, bobCopy.world), 'Bob, joining late, catches up on the damage');
    // More after he's in: both get it.
    host.sim.ctx.world.carve({ x: 0.5, y: FLOOR + 1.5, z: WALL_Z + 1 }, { x: 0.2, y: 0.1, z: -1 }, { radius: 0.12, depth: 0.3 });
    await wait(200);
    annCopy.take(ann.events());
    bobCopy.take(bob.events());
    check(same(hw, annCopy.world) && same(hw, bobCopy.world), 'Ann and Bob both see the new hole');
    // What one bullet's chip costs on the wire, as JSON and compressed.
    const one = hw.export_damage();
    const lone = copyOf(range, 5);
    const bullet = (() => {
      lone.world.set_destructible(FLOOR - 1, new Uint8Array(256).fill(1));
      const out = lone.world.carve(0.5, FLOOR + 1.5, WALL_Z + 1, 0, 0, -1, WEAPONS.rifle.kind === 'gun' ? 0.09 : 0, 0.04);
      return out.subarray(8);
    })();
    const json = encode({ t: 'damage', data: bullet } satisfies HostEvent);
    console.log(
      `  sockets: Ann and Bob (late) agree with the host on ${hw.damage_count()} damaged blocks (catch-up ${one.length} bytes) · one rifle chip: ${bullet.length} bytes of changes, ${json.length} as JSON, ${deflateRawSync(json).length} deflated`,
    );
    lone.free();
    annCopy.free();
    bobCopy.free();
    ann.close();
    bob.close();
    await wait(100);
  } finally {
    await srv.close();
  }

  // ---- Prediction: walking through a hole the host shot, 100 ms behind, with no corrections ----
  predictThroughHole();
}

function predictThroughHole() {
  const host = new GameHost(range, { engine: wasm, seed: 11, remote: true, radius: 3, budget: Infinity });
  const client = copyOf(range, host.seed);
  const ann = host.connect('Ann');
  host.command(ann.id, { t: 'start' });
  const me = host.sim.players.find((p) => p.id === ann.id)!;
  me.api.teleport({ x: 0.5, y: FLOOR, z: 0.5 }, 0, 0);
  // A doorway shot through the wall straight ahead.
  for (const dy of [0.35, 0.8, 1.25, 1.7]) host.sim.ctx.world.carve({ x: 0.5, y: FLOOR + dy, z: WALL_Z + 1.01 }, { x: 0, y: 0, z: -1 }, { radius: 0.5, depth: 1.2 });
  const predictor = new Predictor(client.world);
  const late: HostBatch[] = [];
  let worst = 0;
  let n = 0;
  let started = false;
  for (let frame = 0; frame < 60 * 3.5; frame++) {
    // Stand still a second (the teleport and the damage arrive), then walk through.
    const walking = frame > 60;
    const input: PlayerInput = { active: true, down: walking ? ['KeyW'] : [], pressed: [], buttons: 0, clicked: 0, mouseX: 0, mouseY: 0, wheel: 0, yaw: 0, pitch: 0, viewSeq: me.viewSeq };
    predictor.step(input, 1 / 60, frame + 1);
    host.command(ann.id, { t: 'input', input, seq: frame + 1, dt: 1 / 60 });
    if (frame % 2 === 1) {
      late.push(host.step(1 / 30).get(ann.id)!);
      // Three steps (100 ms) of latency: the damage, too, arrives late.
      if (late.length > 3) {
        const b = late.shift()!;
        client.take(b.events);
        predictor.reconcile(b.frame!.players.find((p) => p.id === ann.id)!);
        if (walking) {
          started = true;
          worst = Math.max(worst, predictor.lastCorrection);
          n++;
        }
      }
    }
  }
  const s = me.state;
  console.log(`  walked through a shot-out doorway predicting with 100 ms latency: worst correction ${worst.toFixed(5)} blocks over ${n} frames, ended at z ${s.z.toFixed(2)}`);
  check(started && s.z < WALL_Z - 1.5, `walked through the hole: z ${s.z}`);
  check(worst < 0.01, `prediction held through the hole: worst correction ${worst}`);
  client.free();
  host.dispose();
}

/** A client as the browser is one: a socket, the welcome, a batch catching it up, `start` to join. */
async function join(port: number, name: string) {
  const ws = new WebSocket(`ws://localhost:${port}/`);
  const batches: TimedBatch[] = [];
  let taken = 0;
  const frames = new FrameReader<SimFrame>();
  const read = (w: WireBatch): TimedBatch => ({ events: w.events, frame: w.f === undefined ? null : frames.read(w.f), time: w.time });
  const welcome = await new Promise<ServerWelcome>((resolve, reject) => {
    ws.onerror = () => reject(new Error('socket error'));
    ws.onmessage = (e) => {
      const m = decode<ServerWelcome | WireBatch>(String(e.data));
      if ('t' in m && m.t === 'welcome') resolve(m);
      else batches.push(read(m as WireBatch));
    };
  });
  for (let i = 0; i < 50 && !batches.some((b) => b.frame); i++) await wait(10);
  ws.send(encode({ t: 'start', name } satisfies ClientCommand));
  let player = '';
  for (let i = 0; i < 50 && !player; i++) {
    await wait(20);
    for (const b of batches) for (const e of b.events) if (e.t === 'joined') player = e.player;
  }
  return {
    welcome,
    /** The events that came since the last time this was asked. */
    events: (): HostEvent[] => {
      const out = batches.slice(taken).flatMap((b) => b.events);
      taken = batches.length;
      return out;
    },
    close: () => ws.close(),
  };
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
