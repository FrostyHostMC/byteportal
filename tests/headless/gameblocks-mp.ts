import { readFileSync } from 'node:fs';
import { TerrainGen, VoxelWorld } from '@engine/voxel_engine.js';
import { Blueprint, defineGame, type BlockDefinition } from '../../src/platform';
import { serveGame } from '../../src/platform/host/server';
import { worldGenConfig } from '../../src/platform/workers/config';
import { decode, encode } from '../../src/platform/net/codec';
import { FrameReader } from '../../src/platform/net/delta';
import type { ClientCommand, ServerWelcome, TimedBatch, WireBatch } from '../../src/platform/net/protocol';
import type { SimFrame } from '../../src/platform/sim/sim';
import { applyWorldConfig } from '../../src/platform/workers/config';
import { gameBlocks, useGameBlocks } from '../../src/platform/world/blocks';
import { blockIdOf, loadRegistry } from '../../src/platform/world/registry';
import { check } from './_harness';

const FLOOR = 64;
const BLOCKS: Record<string, BlockDefinition> = {
  crate: { texture: '/src/games/sandbox/blocks/crate.png' },
  lamp: { texture: { color: '#ffd27a' }, light: 15 },
  sprout: { texture: { paint: (x) => (x === 8 ? '#4c9a3a' : null) }, shape: 'cross' },
};

function structure(): Blueprint {
  const bp = new Blueprint({ x: -4, y: FLOOR - 1, z: -4 }, { x: 9, y: 2, z: 9 });
  bp.fill({ x: -4, y: FLOOR - 1, z: -4 }, { x: 4, y: FLOOR - 1, z: 4 }, 'stone');
  bp.set(2, FLOOR, -2, 'lamp');
  return bp;
}

const def = defineGame({
  id: 'blocknet',
  title: 'Game blocks online',
  world: { terrain: 'void', structures: [structure()], spawn: { x: 0.5, y: FLOOR, z: 0.5 } },
  player: { build: true, fly: true, health: false },
  blocks: BLOCKS,
});

/** A client as the browser is one: a socket, the welcome, a batch catching it up, `start` to join. */
async function join(port: number, name: string) {
  const ws = new WebSocket(`ws://localhost:${port}/`);
  const batches: TimedBatch[] = [];
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
  const edits = () => batches.flatMap((b) => b.events.flatMap((e) => (e.t === 'edits' ? e.cells : [])));
  return {
    welcome,
    batches,
    edits,
    send: (c: ClientCommand) => ws.send(encode(c)),
    me: () => batches.at(-1)?.frame?.players.find((p) => p.id === player),
    close: () => ws.close(),
  };
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * A game with blocks of its own on the game server: the welcome says which ids the server gave
 * them, the client's copy of the game gives its blocks the same ids (even a copy with them in
 * another order, or without one), and edits, structures and the block hotbar (in the delta-coded
 * frames) all agree, for a player there from the start and one who joins later.
 */
export default async function gameblocksMp() {
  const srv = await serveGame(def, { port: 0, seed: 5, wasm: readFileSync('engine/pkg/voxel_engine_bg.wasm'), tickRate: 30 });
  try {
    const ann = await join(srv.port, 'Ann');
    // (The room started with its first client.)
    const host = srv.host(def.id)!;
    check(ann.welcome.blocks?.join() === host.blocks.keys.join() && ann.welcome.blocks.length === 3, `the welcome has the server's keys: ${ann.welcome.blocks}`);

    // Ann's screen: her copy of the game, with the server's ids.
    const mine = gameBlocks(def, ann.welcome.blocks);
    check(mine.keys.join() === host.blocks.keys.join() && mine.json === host.blocks.json, 'the same definitions give the same blocks');
    useGameBlocks(mine);
    const reg = loadRegistry(mine);
    const crate = blockIdOf(reg, 'crate');

    // The game builds with its block; Ann's batches carry the edit, and her registry names it.
    host.sim.ctx.world.setBlock(1, FLOOR, 1, 'crate');
    await wait(150);
    const cell = ann.edits().find(([x, y, z]) => x === 1 && y === FLOOR && z === 1);
    check(cell && reg.blocks[cell[3]]?.name === 'crate', `Ann got the crate: ${cell}`);

    // She picks it in the block picker: her hotbar (in the delta-coded frames) holds it.
    ann.send({ t: 'message', msg: { t: 'creativePick', player: '', block: crate } });
    await wait(150);
    const hotbar = ann.me()?.creative?.hotbar ?? [];
    check(hotbar.includes(crate), `Ann's hotbar has the crate: ${hotbar}`);

    // Her terrain, generated on her screen from the game's structures, has the lamp where the server's has.
    useGameBlocks(mine);
    const gen = new TerrainGen(ann.welcome.seed);
    applyWorldConfig(gen, worldGenConfig(def, (b) => blockIdOf(reg, b)));
    const world = new VoxelWorld();
    world.insert_column(0, -1, gen.generate(0, -1));
    const lampHere = reg.blocks[world.get_block(2, FLOOR, -2)]?.name;
    check(lampHere === 'lamp' && host.sim.ctx.world.blockName(host.sim.ctx.world.getBlock(2, FLOOR, -2)) === 'lamp', `the structure's lamp on both: ${lampHere}`);
    world.free();
    gen.free();

    // Bob joins later: his welcome has the keys, his catch-up the crate.
    const bob = await join(srv.port, 'Bob');
    const caught = bob.edits().find(([x, y, z]) => x === 1 && y === FLOOR && z === 1);
    check(bob.welcome.blocks?.join() === host.blocks.keys.join() && caught?.[3] === crate, `Bob caught up: ${caught}`);

    // A client with another version of the game (blocks reordered, the lamp not there yet) takes
    // the server's ids for the ones it has; the lamp's id is kept for a "missing" block.
    const older = gameBlocks({ id: def.id, blocks: { sprout: BLOCKS.sprout, crate: BLOCKS.crate } }, bob.welcome.blocks);
    check(older.keys.join() === host.blocks.keys.join(), `ids agree with the server: ${older.keys}`);
    const variants = JSON.parse(older.json) as { name: string; tex: number[]; placeable: boolean }[];
    const lamp = variants[host.blocks.keys.indexOf('lamp')];
    check(lamp.name === 'lamp' && !lamp.placeable && older.textureNames.includes('missing'), 'the missing lamp keeps its id');

    console.log(`  ${host.blocks.keys.length} game blocks over sockets: welcome keys, edits, structures and hotbar agree for Ann, Bob (late) and an older client`);
    ann.close();
    bob.close();
    await wait(100);
  } finally {
    useGameBlocks(gameBlocks({ id: 'none' }));
    await srv.close();
  }
}
