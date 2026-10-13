import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { ChunkMesher } from '@engine/voxel_engine.js';
import { Blueprint, defineGame, type BlockDefinition, type GameDefinition } from '../../src/platform';
import { GameHost } from '../../src/platform/host/game';
import { Headless } from '../../src/platform/host/headless';
import { SqliteStore } from '../../src/platform/host/sqlite';
import { MemoryStore } from '../../src/platform/host/store';
import { mottled, pixelArt } from '../../src/platform/render/blocktextures';
import { firstGameBlock, gameBlocks, useGameBlocks } from '../../src/platform/world/blocks';
import { check, launch } from './_harness';

const wasm = readFileSync('engine/pkg/voxel_engine_bg.wasm');

const FLOOR = 64;

/** One texture on several blocks: one layer. */
const MARBLE = { color: '#d8d8d8', noise: 0.3 };

/** A game's own blocks: an image, a colour, pixel art, a painter, a slab, a plant, copies of built-ins. */
const BLOCKS: Record<string, BlockDefinition> = {
  crate: { texture: '/src/games/sandbox/blocks/crate.png', hardness: 0.8, sounds: { break: 'swing', place: 'pickup' } },
  lamp: { texture: { color: '#ffd27a', noise: 0.1 }, light: 15 },
  marble: { label: 'Polished Marble', texture: { top: { color: ['#eeeeee', '#e2e2e2', '#d6d6d6'] }, all: MARBLE } },
  marble_slab: { texture: MARBLE, shape: 'slab', full: 'marble' },
  bars: { texture: { pixels: ['#.#.', '#.#.', '####', '#.#.'], palette: { '#': '#3b3f44' } }, transparency: 'cutout' },
  sprout: { texture: { paint: (x, y) => (Math.abs(x - 8) < 2 && y > 4 ? '#4c9a3a' : null) }, shape: 'cross' },
  vault: { like: 'stone', breakable: false, picker: false },
  my_neon: { like: 'neon_red' },
};

/** A floor in the void with the game's blocks set into it by name (a structure). */
function floor(lamp = true): Blueprint {
  const bp = new Blueprint({ x: -8, y: FLOOR - 1, z: -8 }, { x: 17, y: 3, z: 17 });
  bp.fill({ x: -8, y: FLOOR - 1, z: -8 }, { x: 8, y: FLOOR - 1, z: 8 }, 'vault');
  if (lamp) bp.set(2, FLOOR - 1, 2, 'lamp');
  bp.set(3, FLOOR, 3, 'crate');
  bp.set(-3, FLOOR, 3, 'marble_slab[type=top]');
  return bp;
}

function game(blocks: Record<string, BlockDefinition>, lamp = true): GameDefinition {
  return defineGame({
    id: 'blocktest',
    title: 'Game blocks',
    world: { terrain: 'void', structures: [floor(lamp)], spawn: { x: 0.5, y: FLOOR, z: 0.5 }, persist: true },
    player: { build: true, fly: true, health: false },
    blocks,
  });
}

/**
 * Blocks of a game's own, headless: defined in `defineGame`, they take the ids after the built-in
 * ones, are used by name in structures, `setBlock`, `placeBlock` and `blockInfo`, keep their rules
 * (light, solidity, unbreakable, their sounds), mesh like the block they copy, and a save made
 * with them loads into a game whose definitions are reordered (their ids move; the blocks don't).
 */
export default function gameblocks() {
  const def = game(BLOCKS);
  const h = new Headless(def, { wasm, seed: 3, wire: true });
  h.start();
  h.step(1 / 60);
  const w = h.ctx.world;
  const first = firstGameBlock();
  check(first === 187, `game blocks start after the built-in ones: ${first}`);
  const id = (name: string) => w.blockId(name);
  check(id('crate') === first && id('lamp') === first + 1 && id('marble_slab') === first + 3, `ids in definition order: crate ${id('crate')}, lamp ${id('lamp')}, slab ${id('marble_slab')}`);
  check(h.host.blocks.keys.length === 9 && h.host.blocks.keys[4] === 'marble_slab[type=top]', `keys: ${h.host.blocks.keys.join()}`);

  // What they are.
  const info = (b: string) => w.blockInfo(b)!;
  check(info('lamp').light === 15 && info('lamp').solid && info('lamp').label === 'Lamp', `lamp: ${JSON.stringify(info('lamp'))}`);
  check(info('marble').label === 'Polished Marble', 'labels');
  check(!info('vault').breakable && info('crate').breakable && info('crate').hardness === 0.8, 'breakable and hardness');
  check(info('sprout').plant && !info('sprout').solid && info('sprout').replaceable, `a cross is a plant: ${JSON.stringify(info('sprout'))}`);
  check(info('marble_slab[type=top]').state.type === 'top', 'slab halves are variants');
  check(info('bedrock').breakable === false && info('stone').breakable, 'built-in blocks say whether they break too');

  // Structures reference them by name.
  check(w.blockName(w.getBlock(3, FLOOR, 3)) === 'crate', `the structure's crate: ${w.blockName(w.getBlock(3, FLOOR, 3))}`);
  check(w.blockName(w.getBlock(2, FLOOR - 1, 2)) === 'lamp' && w.blockName(w.getBlock(0, FLOOR - 1, 0)) === 'vault', 'the floor');
  check(w.blockInfo(w.getBlock(-3, FLOOR, 3))!.variant === 'marble_slab[type=top]', 'a variant in a structure');

  // setBlock, placeBlock (a slab on a slab makes its full block), breaking and its sounds.
  check(w.setBlock(5, FLOOR, 5, 'crate') && w.getBlock(5, FLOOR, 5) === id('crate'), 'setBlock by name');
  check(w.placeBlock(6, FLOOR, 6, 'marble_slab') && w.blockInfo(w.getBlock(6, FLOOR, 6))!.variant === 'marble_slab[type=bottom]', 'placing a slab');
  check(w.placeBlock(6, FLOOR, 6, 'marble_slab') && w.blockName(w.getBlock(6, FLOOR, 6)) === 'marble', `a slab on a slab: ${w.blockName(w.getBlock(6, FLOOR, 6))}`);
  check(w.placeBlock(7, FLOOR, 5, 'sprout'), 'a plant on the floor');
  check(w.placeBlock(8, FLOOR, 5, 'crate'), 'placing a crate');
  check(!w.breakBlock(0, FLOOR - 1, 0), 'the vault is unbreakable');
  check(w.breakBlock(5, FLOOR, 5), 'a crate breaks');
  h.step(1 / 60);
  const sounds = h.find('audio', 'play').map((c) => c.args[0]);
  check(sounds.includes('pickup') && sounds.includes('swing'), `its sounds, placed and broken: ${sounds.join()}`);
  w.explode({ x: 0.5, y: FLOOR - 0.5, z: -4.5 }, 3, { effect: false });
  check(w.blockName(w.getBlock(0, FLOOR - 1, -4)) === 'vault', 'explosions leave the vault');

  // The engine knows them: light, solidity, plants you walk through.
  const vw = h.world.world;
  const [, lampLight] = vw.light_probe(2, FLOOR, 2);
  check(lampLight > 0.8, `the lamp lights its surroundings: ${lampLight}`);
  check(!w.lineOfSight({ x: 3.5, y: FLOOR + 0.5, z: 1 }, { x: 3.5, y: FLOOR + 0.5, z: 5 }), 'a crate blocks sight');
  check(w.lineOfSight({ x: 7.5, y: FLOOR + 0.5, z: 3 }, { x: 7.5, y: FLOOR + 0.5, z: 7 }), 'a plant does not');

  // A copy of a built-in block (like: 'neon_red') is that block: its textures, light and mesh.
  const reg = h.sim.registry;
  const neon = reg.byName.get('neon_red')!;
  const mine = reg.byName.get('my_neon')!;
  check(mine.tex.join() === neon.tex.join() && mine.emit === neon.emit && mine.layer === neon.layer && mine.solid === neon.solid, 'my_neon copies neon_red');
  check(!h.host.blocks.textures.some((t) => typeof t.source === 'object' && 'layer' in t.source && neon.tex.includes(t.source.layer)), 'and uses its textures, not copies of them');
  const mesh = (block: string) => {
    w.setBlock(0, FLOOR, -2, block);
    const m = new ChunkMesher();
    const out = m.mesh(vw.extract_region(0, -1));
    m.free();
    return out;
  };
  const a = mesh('neon_red');
  const b = mesh('my_neon');
  check(a.length > 100 && a.length === b.length && a.every((v, i) => v === b[i]), 'my_neon meshes exactly like neon_red');
  w.setBlock(0, FLOOR, -2, 'air');

  // Textures: colours mottle, pixel art scales, the rest are layers after the built-in ones.
  const t = h.host.blocks.textures;
  check(t.length === 6 && t.every((l) => typeof l.source === 'string' || !('layer' in l.source)), `texture layers: ${t.length}`);
  check(t[1].glow === 1 && t[0].glow === 0, 'a lamp glows by default, a crate not');
  const marble = mottled({ color: ['#eeeeee', '#e2e2e2', '#d6d6d6'] }).pixels;
  const shades = new Set(Array.from({ length: 256 }, (_, i) => marble[i * 4]));
  check(shades.size === 3, `three colours picked by noise: ${[...shades]}`);
  const light = mottled({ color: '#f0f0f0', noise: 0.5 }).pixels;
  const reds = Array.from({ length: 256 }, (_, i) => light[i * 4]);
  check(Math.min(...reds) >= 110 && Math.max(...reds) === 255, `a light colour mottles without wrapping round: ${Math.min(...reds)}..${Math.max(...reds)}`);
  const bars = pixelArt({ pixels: ['#.#.', '#.#.', '####', '#.#.'], palette: { '#': '#3b3f44' } });
  check(bars[3] === 255 && bars[4 * 4 + 3] === 0 && bars[(8 * 16 + 5) * 4 + 3] === 255, 'pixel art 4x4 scaled to 16x16');

  // Mistakes are named.
  const wrong = (blocks: Record<string, BlockDefinition>) => {
    try {
      gameBlocks({ id: 'x', blocks });
      return '';
    } catch (e) {
      return String(e);
    }
  };
  check(wrong({ stone: { texture: '#fff' } }).includes('built-in'), 'a built-in name is refused');
  check(wrong({ Bad: { texture: 'stone' } }).includes('lower case'), 'names are checked');
  check(wrong({ x: {} }).includes('texture'), 'a block needs a look');
  check(wrong({ x: { texture: 'no_such_texture' } }).includes('built-in texture'), 'unknown built-in textures are named');
  check(wrong({ x: { texture: 'stone', shape: 'stairs', full: 'stone' } }).includes('only a slab'), 'full is for slabs');
  check(wrong(Object.fromEntries(Array.from({ length: 9 }, (_, i) => [`s${i}`, { texture: 'stone', shape: 'stairs' as const }]))).includes('too many'), 'too many variants');

  // A kept world's round trip (a server's store): edits and the keys of the ids they used...
  w.setBlock(9, FLOOR, 9, 'lamp');
  const save = { edits: vw.export_edits(), blocks: [...h.host.blocks.keys] };
  const keptWorld = new MemoryStore();
  keptWorld.saveWorld({ game: 'blocktest', seed: 3, edits: save.edits, blocks: save.blocks, time: 0.5 });
  // ...loaded by a later version of the game: blocks reordered, the lamp gone, a new one first.
  const { lamp: _gone, ...kept } = BLOCKS;
  const later = game({ glass_tile: { like: 'glass' }, ...Object.fromEntries(Object.entries(kept).reverse()) }, false);
  const h2 = new GameHost(later, { engine: wasm, seed: 3, budget: Infinity, store: keptWorld, remote: true });
  const w2 = h2.sim.ctx.world;
  check(w2.blockId('crate') !== id('crate'), `the crate's id moved: ${id('crate')} to ${w2.blockId('crate')}`);
  check(w2.blockName(w2.getBlock(8, FLOOR, 5)) === 'crate', `a placed crate is still a crate: ${w2.blockName(w2.getBlock(8, FLOOR, 5))}`);
  check(w2.blockName(w2.getBlock(6, FLOOR, 6)) === 'marble' && w2.blockName(w2.getBlock(7, FLOOR, 5)) === 'sprout', 'and the marble, and the sprout');
  check(w2.blockName(w2.getBlock(5, FLOOR, 5)) === 'air', 'the broken crate stays broken');
  check(w2.blockName(w2.getBlock(9, FLOOR, 9)) === 'air', 'a block no longer defined is gone');
  const glassTile = (JSON.parse(h2.blocks.json) as { name: string; layer: number; cull_self: boolean; opacity?: number }[])[0];
  check(glassTile.name === 'glass_tile' && glassTile.layer === 1 && glassTile.cull_self && glassTile.opacity === 0, `like: 'glass' is see-through like glass: ${JSON.stringify(glassTile)}`);

  // A kept world (a server's store): the keys go with the edits, and hotbars keep blocks by name
  // (a signed-in player's: a guest's place isn't kept).
  const store = new MemoryStore();
  const host = new GameHost(def, { engine: wasm, seed: 3, budget: Infinity, store, remote: true });
  const ann = { account: { id: 'ann', name: 'Ann', avatar: null } };
  const c = host.connect('Ann', ann);
  host.command(c.id, { t: 'message', msg: { t: 'creativePick', player: '', block: id('crate') } });
  host.sim.ctx.world.setBlock(4, FLOOR, 4, 'marble');
  host.persist();
  check(store.world()!.blocks!.join() === h.host.blocks.keys.join(), 'the kept world has the keys');
  check(store.player('#ann')!.hotbar!.includes('crate'), `the hotbar keeps the crate by name: ${store.player('#ann')!.hotbar}`);
  host.disconnect(c.id);
  host.dispose();
  const host2 = new GameHost(later, { engine: wasm, seed: 3, budget: Infinity, store, remote: true });
  const c2 = host2.connect('Ann', ann);
  const annAgain = host2.sim.players.find((p) => p.name === 'Ann')!;
  check(annAgain.creative!.hotbar.includes(host2.sim.ctx.world.blockId('crate')), `the crate is back in the hotbar with its new id: ${annAgain.creative!.hotbar}`);
  check(host2.sim.ctx.world.blockName(host2.sim.ctx.world.getBlock(4, FLOOR, 4)) === 'marble', 'the kept world loads by name');
  host2.disconnect(c2.id);
  host2.dispose();

  // A server's database from before game blocks gains the column, and keeps the keys.
  const dir = mkdtempSync(join(tmpdir(), 'voxel-blocks-'));
  try {
    const path = join(dir, 'old.sqlite');
    const old = new DatabaseSync(path);
    old.exec(`CREATE TABLE world (id INTEGER PRIMARY KEY CHECK (id = 1), game TEXT NOT NULL, seed INTEGER NOT NULL, edits BLOB, time REAL NOT NULL DEFAULT 0.3, created TEXT NOT NULL DEFAULT (datetime('now')), saved TEXT);
      INSERT INTO world (id, game, seed, edits, time) VALUES (1, 'blocktest', 3, NULL, 0.5);`);
    old.close();
    const db = SqliteStore.open(path, 'blocktest');
    check(db.world()!.blocks === null && db.world()!.seed === 3, 'an old world has no keys');
    db.saveWorld({ game: 'blocktest', seed: 3, edits: save.edits, blocks: save.blocks, time: 0.5 });
    db.close();
    const again = SqliteStore.open(path, 'blocktest');
    check(again.world()!.blocks!.join() === save.blocks.join(), `the keys are kept: ${again.world()!.blocks}`);
    again.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }

  // Two games hosted on one thread (a test server's rooms) take turns, each with its own blocks.
  const other = launch('sandbox', { seed: 2 });
  other.step(1 / 60);
  h.step(1 / 60);
  check(w.lineOfSight({ x: 7.5, y: FLOOR + 0.5, z: 3 }, { x: 7.5, y: FLOOR + 0.5, z: 7 }), 'back in this game, its plant is a plant again');
  useGameBlocks(gameBlocks({ id: 'none' }));
  console.log(`  ${h.host.blocks.keys.length} variants from ${Object.keys(BLOCKS).length} definitions (ids ${first}..${first + h.host.blocks.keys.length - 1}), ${t.length} texture layers of their own; a save loaded into reordered definitions`);
}
