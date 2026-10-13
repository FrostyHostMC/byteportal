import { readFileSync } from 'node:fs';
import { Blueprint, defineGame, type BlockDefinition, type BlockRef, type GameDefinition } from '../../src/platform';
import { Predictor } from '../../src/platform/client/predict';
import { GameHost, GeneratedWorld } from '../../src/platform/host/game';
import { Headless } from '../../src/platform/host/headless';
import { worldGenConfig } from '../../src/platform/workers/config';
import type { HostBatch, PlayerInput } from '../../src/platform/net/protocol';
import { blockIdOf } from '../../src/platform/world/registry';
import { check } from './_harness';

const wasm = readFileSync('engine/pkg/voxel_engine_bg.wasm');
const FLOOR = 64;

/** A game's blocks of every new shape: a fence, a pane, a beam, a ladder, a sign, a stove, a vine, a table. */
const BLOCKS: Record<string, BlockDefinition> = {
  picket: { texture: 'oak_planks', shape: 'fence' },
  window: { texture: 'glass', shape: 'pane', transparency: 'cutout' },
  beam: { texture: { top: 'oak_log_top', bottom: 'oak_log_top', side: 'oak_log' }, shape: 'post', facing: 'axis' },
  ladder: { texture: 'oak_planks', boxes: [[0, 0, 13, 16, 16, 16]], facing: true, climbable: true, transparency: 'cutout' },
  sign: { texture: { front: 'bookshelf', all: 'oak_planks' }, boxes: [[1, 4, 14, 15, 13, 16]], facing: true, solid: false },
  stove: { texture: { front: 'bookshelf', top: 'stone', all: 'cobblestone' }, facing: 'all' },
  vine: { texture: 'oak_leaves', shape: 'cross', climbable: true },
  table: { texture: 'oak_planks', boxes: [[0, 13, 0, 16, 16, 16], [1, 0, 1, 3, 13, 3], [13, 0, 1, 15, 13, 3], [1, 0, 13, 3, 13, 15], [13, 0, 13, 15, 13, 15]] },
};

/**
 * A floor in the void; a wall (z 5 to 8, six high) with a ladder up its north face at x = 0; a
 * fence from x = 3 to 6 at z = 2 running into a brick; a sign on the wall facing north.
 */
function yard(): Blueprint {
  const bp = new Blueprint({ x: -8, y: FLOOR - 1, z: -8 }, { x: 17, y: 8, z: 17 });
  bp.fill({ x: -8, y: FLOOR - 1, z: -8 }, { x: 8, y: FLOOR - 1, z: 8 }, 'stone');
  bp.fill({ x: -4, y: FLOOR, z: 5 }, { x: 4, y: FLOOR + 5, z: 8 }, 'bricks');
  for (let y = FLOOR; y <= FLOOR + 5; y++) bp.set(0, y, 4, 'ladder[facing=north]');
  for (let x = 3; x <= 6; x++) bp.set(x, FLOOR, 2, 'picket');
  bp.set(7, FLOOR, 2, 'bricks');
  bp.set(2, FLOOR + 1, 4, 'sign[facing=north]');
  return bp;
}

function game(): GameDefinition {
  return defineGame({
    id: 'shapetest',
    title: 'Block shapes',
    world: { terrain: 'void', structures: [yard()], spawn: { x: 0.5, y: FLOOR, z: 1.5 }, destructible: { above: FLOOR - 1, blocks: ['bricks'] } },
    player: { build: true, fly: false, health: false },
    blocks: BLOCKS,
  });
}

/**
 * A game's own block shapes, headless: facing blocks turn (in structures, by name, and placed
 * from the placer's aim and look), fences and panes join, `blockInfo` tells shapes and collision
 * heights (and `collisionHeight` a fence joined and a carved block), bodies can't jump a fence,
 * and a ladder climbs. Then a client predicting its own player climbing the ladder with 100 ms of
 * latency: the server's word should barely move it.
 */
export default function blockshapes() {
  const def = game();
  const h = new Headless(def, { wasm, seed: 3, wire: true });
  h.start();
  h.step(1 / 60);
  const w = h.ctx.world;
  const info = (b: BlockRef) => w.blockInfo(b)!;

  // Variants: four ladders, six stoves, three beams; one of each in the picker.
  const keys = h.host.blocks.keys;
  check(keys.filter((k) => k.startsWith('ladder[')).length === 4 && keys.filter((k) => k.startsWith('stove[')).length === 6 && keys.includes('beam[axis=z]'), `variants: ${keys.join()}`);
  check(h.sim.registry.blocks.filter((b) => b.name === 'stove' && b.placeable).length === 1, 'one stove in the picker');

  // What blockInfo says.
  check(info('picket').shape === 'fence' && info('picket').height === 1.5 && info('picket').solid, `fence: ${JSON.stringify(info('picket'))}`);
  check(info('window').shape === 'pane' && info('window').height === 1, 'pane');
  check(info('ladder').climbable && info('ladder').shape === 'boxes' && JSON.stringify(info('ladder').boxes) === JSON.stringify([[0, 0, 13 / 16, 1, 1, 1]]), `ladder: ${JSON.stringify(info('ladder'))}`);
  check(info('ladder[facing=east]').state.facing === 'east' && JSON.stringify(info('ladder[facing=east]').boxes) === JSON.stringify([[0, 0, 0, 3 / 16, 1, 1]]), 'a ladder facing east hangs on the wall west of it');
  check(info('vine').climbable && info('vine').shape === 'cross' && info('vine').height === 0 && !info('stone').climbable, 'a vine climbs, and has no collision');
  check(info('sign').height === 0 && info('table').height === 1 && info('table').boxes.length === 5, 'a sign is walked through; a table is solid');
  check(info('oak_slab').shape === 'slab' && info('oak_slab').height === 0.5 && info('oak_slab[type=top]').height === 1, 'slabs');
  check(info('oak_stairs').shape === 'stairs' && info('red_bed').height === 9 / 16 && info('torch').shape === 'torch' && info('torch').height === 0, 'stairs, beds and torches');
  check(info('stone').shape === 'cube' && info('stone').height === 1 && info('water').height === 0 && info('air').shape === 'air', 'cubes, liquids and air');

  // At a position: the fence joined, and a brick carved from the top.
  check(w.collisionHeight(4, FLOOR, 2) === 1.5 && w.collisionHeight(4, FLOOR + 1, 2) === 0 && w.collisionHeight(0, FLOOR - 1, 0) === 1, 'collision heights at positions');
  check(w.collisionHeight(0, FLOOR + 10, 0) === 0 && w.collisionHeight(9999, FLOOR, 9999) === 1, 'air, and an unloaded chunk');
  const vw = h.world.world;
  const boxes = (x: number, y: number, z: number) => vw.target_boxes(x, y, z).length / 6;
  check(boxes(3, FLOOR, 2) === 3 && boxes(4, FLOOR, 2) === 5 && boxes(6, FLOOR, 2) === 5, `fences joined: ${[3, 4, 5, 6].map((x) => boxes(x, FLOOR, 2))}`);
  check(w.carve({ x: -3.5, y: FLOOR + 7, z: 6.5 }, { x: 0, y: -1, z: 0 }, { radius: 1.2, depth: 0.3 }) > 0, 'carved the top of the wall');
  const carved = w.collisionHeight(-4, FLOOR + 5, 6);
  check(carved > 0 && carved < 1, `a carved brick is lower: ${carved}`);

  // Placing: out from the wall aimed at; back at the placer from the floor; as asked.
  const wallHit = w.raycast({ x: -2.5, y: FLOOR + 1.5, z: 2 }, { x: 0, y: 0, z: 1 }, 5)!;
  check(wallHit && wallHit.normal.z === -1, 'aiming at the wall');
  check(w.placeBlock(-2, FLOOR + 1, 4, 'ladder', { against: wallHit }) && info(w.getBlock(-2, FLOOR + 1, 4)).variant === 'ladder[facing=north]', `a ladder on the wall faces out of it: ${info(w.getBlock(-2, FLOOR + 1, 4)).variant}`);
  const floorHit = w.raycast({ x: -5.5, y: FLOOR + 1.5, z: -2.5 }, { x: 0, y: -1, z: 0 }, 5)!;
  const placer = h.me.api;
  placer.teleport({ x: -5.5, y: FLOOR, z: -6 });
  h.step(1 / 60, { yaw: Math.PI });
  check(w.placeBlock(-6, FLOOR, -3, 'stove', { against: floorHit, by: placer }) && info(w.getBlock(-6, FLOOR, -3)).variant === 'stove[facing=up]', `a stove placed on the floor faces up: ${info(w.getBlock(-6, FLOOR, -3)).variant}`);
  check(w.placeBlock(-6, FLOOR, -1, 'sign', { against: floorHit, by: placer }) && info(w.getBlock(-6, FLOOR, -1)).variant === 'sign[facing=north]', `a sign on the floor faces back at its placer: ${info(w.getBlock(-6, FLOOR, -1)).variant}`);
  check(w.placeBlock(-7, FLOOR, -1, 'sign', { facing: 'east' }) && info(w.getBlock(-7, FLOOR, -1)).variant === 'sign[facing=east]', 'a sign faces as asked');
  check(w.placeBlock(-5, FLOOR, -1, 'beam', { against: { ...wallHit, normal: { x: 1, y: 0, z: 0 } } }) && info(w.getBlock(-5, FLOOR, -1)).variant === 'beam[axis=x]', 'a beam lies along the axis aimed along');
  check(w.placeBlock(-4, FLOOR + 3, -4, 'vine'), 'a vine hangs in the air');
  check(w.setBlock(-3, FLOOR, -4, 'stove[facing=west]') && info(w.getBlock(-3, FLOOR, -4)).variant === 'stove[facing=west]', 'setBlock by state');
  placer.teleport({ x: 0.5, y: FLOOR, z: 1.5 });

  // Nobody jumps the fence: pushing into it with jump held.
  placer.teleport({ x: 4.5, y: FLOOR, z: 0.5 });
  let highest = 0;
  for (let i = 0; i < 120; i++) {
    h.step(1 / 60, { yaw: Math.PI, down: ['KeyW', 'Space'] });
    highest = Math.max(highest, placer.position.y);
  }
  check(placer.position.z < 2.1 && highest > FLOOR + 1, `the fence held them: z ${placer.position.z.toFixed(2)}, up to ${(highest - FLOOR).toFixed(2)}`);

  // The ladder: pushing into it climbs to the top of the wall.
  placer.teleport({ x: 0.5, y: FLOOR, z: 2.5 });
  for (let i = 0; i < 60 * 4 && !(placer.position.y > FLOOR + 5.9 && placer.position.z > 5.2); i++) h.step(1 / 60, { yaw: Math.PI, down: ['KeyW'] });
  check(Math.abs(placer.position.y - (FLOOR + 6)) < 1e-6 && placer.position.z > 5, `climbed onto the wall: ${JSON.stringify(placer.position)}`);

  const held = climbPredicted(true);
  check(held.worst < 0.01, `prediction drifted while climbing: worst correction ${held.worst}`);
  // Where the client's copy has no ladder, the server's word moves it a long way: the test sees it.
  const control = climbPredicted(false);
  console.log(`  (a client without the ladder: worst correction ${control.worst.toFixed(2)} blocks)`);
  check(control.worst > 0.5, `without the ladder the prediction should have been corrected: ${control.worst}`);
}

/**
 * A client predicting its own player up the ladder (walking into it, holding on, sliding down,
 * jump-climbing and topping out onto the wall) on its own copy of the world, getting the server's
 * frames three steps late and replaying what the server hadn't applied yet. `ladder`: whether the
 * client's copy has the ladder. Returns the worst correction.
 */
function climbPredicted(ladder: boolean): { worst: number } {
  const def = game();
  const host = new GameHost(def, { engine: wasm, seed: 7, remote: true, radius: 2, budget: Infinity });
  const reg = host.sim.registry;
  const mine = new GeneratedWorld(host.seed, worldGenConfig(def, (b: BlockRef) => blockIdOf(reg, b)));
  const ann = host.connect('Ann');
  host.command(ann.id, { t: 'start' });
  const me = host.sim.players[0];
  me.api.teleport({ x: 0.5, y: FLOOR, z: 2.5 });
  const predictor = new Predictor(mine.world);
  const late: HostBatch[] = [];
  let worst = 0;
  let sum = 0;
  let n = 0;
  let top = 0;
  const phases: [number, string[]][] = [
    [72, ['KeyW']], // walk into the ladder and climb
    [60, ['ShiftLeft']], // hold on
    [40, []], // slide down
    [60, ['KeyW', 'Space']], // climb again
    [120, ['KeyW']], // up and over onto the wall
  ];
  let frame = 0;
  for (const [frames, down] of phases) {
    for (let i = 0; i < frames; i++, frame++) {
      mine.update([me.state], 2, Infinity);
      if (!ladder) for (let y = 0; y <= 5; y++) mine.world.set_block(0, FLOOR + y, 4, 0);
      const input: PlayerInput = {
        active: true,
        down,
        pressed: i === 0 ? down : [],
        buttons: 0,
        clicked: 0,
        mouseX: 0,
        mouseY: 0,
        wheel: 0,
        yaw: Math.PI + Math.sin(frame * 0.3) * 0.06,
        pitch: 0,
        viewSeq: me.viewSeq,
      };
      predictor.step(input, 1 / 60, frame + 1);
      host.command(ann.id, { t: 'input', input, seq: frame + 1, dt: 1 / 60 });
      if (frame % 2 === 1) {
        late.push(host.step(1 / 30).get(ann.id)!);
        // Three steps (100 ms) of latency.
        if (late.length > 3) {
          const f = late.shift()!.frame!;
          predictor.reconcile(f.players.find((p) => p.id === ann.id)!);
          if (frame > 30) {
            worst = Math.max(worst, predictor.lastCorrection);
            sum += predictor.lastCorrection;
            n++;
          }
        }
      }
      top = Math.max(top, me.state.y - FLOOR);
    }
  }
  const s = me.state;
  if (ladder) console.log(`  climbing a ladder with 100 ms latency: ${n} server frames, corrections average ${(sum / n).toFixed(5)}, worst ${worst.toFixed(5)} blocks · up to ${top.toFixed(2)}, ended at y ${(s.y - FLOOR).toFixed(2)} z ${s.z.toFixed(2)}`);
  check(top > 5.5 && Math.abs(s.y - (FLOOR + 6)) < 1e-6 && s.z > 5, `the server's player should have climbed onto the wall: ${JSON.stringify(s)}`);
  mine.dispose();
  return { worst };
}
