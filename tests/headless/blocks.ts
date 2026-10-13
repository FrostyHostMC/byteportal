import type { RayHit } from '@platform';
import { check, launch } from './_harness';

/**
 * Blocks with shapes and states, placed the way a player places them: a torch hangs on the side
 * it's put against, slabs take the half aimed at and join into a full block, stairs and beds face
 * the way asked, a bed takes two cells; and what hangs on a block or stands on it goes with it.
 */
export default function blocks() {
  const h = launch('sandbox', { seed: 3 });
  h.step(1 / 60);
  const w = h.ctx.world;
  const me = h.me.state;
  // A stone platform and wall high in the air, clear of the terrain.
  const X = Math.floor(me.x) + 2;
  const Z = Math.floor(me.z) + 2;
  const Y = 200;
  for (let x = X; x < X + 8; x++) for (let z = Z; z < Z + 8; z++) w.setBlock(x, Y - 1, z, 'stone');
  for (let x = X; x < X + 8; x++) for (let y = Y; y < Y + 3; y++) w.setBlock(x, y, Z, 'stone');
  const variant = (x: number, y: number, z: number) => w.blockInfo(w.getBlock(x, y, z))?.variant ?? 'unloaded';
  const hit = (x: number, y: number, z: number, n: [number, number, number], py = 0.5): RayHit => ({
    x,
    y,
    z,
    normal: { x: n[0], y: n[1], z: n[2] },
    block: w.getBlock(x, y, z),
    point: { x: x + 0.5 + n[0] * 0.5, y: y + py, z: z + 0.5 + n[2] * 0.5 },
  });
  const breaks: string[] = [];
  h.ctx.events.on('blockBreak', (e) => breaks.push(`${e.block}@${e.x},${e.y},${e.z}`));

  // Torches: on the wall's south side, on the floor, and not under the wall's overhang.
  check(w.placeBlock(X + 1, Y + 1, Z + 1, 'torch', { against: hit(X + 1, Y + 1, Z, [0, 0, 1]) }), 'wall torch refused');
  check(variant(X + 1, Y + 1, Z + 1) === 'torch[facing=south]', `wall torch: ${variant(X + 1, Y + 1, Z + 1)}`);
  check(w.placeBlock(X + 3, Y, Z + 3, 'torch', { against: hit(X + 3, Y - 1, Z + 3, [0, 1, 0]) }), 'floor torch refused');
  check(variant(X + 3, Y, Z + 3) === 'torch', `floor torch: ${variant(X + 3, Y, Z + 3)}`);
  check(!w.placeBlock(X + 5, Y - 2, Z + 5, 'torch', { against: hit(X + 5, Y - 1, Z + 5, [0, -1, 0]) }), 'a torch hung under a ceiling');
  check(w.blockInfo('torch[facing=west]')?.state.facing === 'west', 'torch[facing=west] not known');

  // Slabs: low on a side is the bottom half, high the top, and a second one on top makes a block.
  check(w.placeBlock(X + 2, Y, Z + 1, 'oak_slab', { against: hit(X + 2, Y, Z, [0, 0, 1], 0.8) }), 'high slab refused');
  check(variant(X + 2, Y, Z + 1) === 'oak_slab[type=top]', `high slab: ${variant(X + 2, Y, Z + 1)}`);
  check(w.placeBlock(X + 4, Y, Z + 4, 'oak_slab', { against: hit(X + 4, Y - 1, Z + 4, [0, 1, 0]) }), 'slab refused');
  check(variant(X + 4, Y, Z + 4) === 'oak_slab[type=bottom]', `slab: ${variant(X + 4, Y, Z + 4)}`);
  check(w.placeBlock(X + 4, Y + 1, Z + 4, 'oak_slab', { against: hit(X + 4, Y, Z + 4, [0, 1, 0]) }), 'second slab refused');
  check(variant(X + 4, Y, Z + 4) === 'oak_planks' && variant(X + 4, Y + 1, Z + 4) === 'air', `two slabs: ${variant(X + 4, Y, Z + 4)} / ${variant(X + 4, Y + 1, Z + 4)}`);

  // Stairs and logs.
  check(w.placeBlock(X + 5, Y, Z + 2, 'brick_stairs', { facing: 'east' }), 'stairs refused');
  check(variant(X + 5, Y, Z + 2) === 'brick_stairs[facing=east,half=bottom]', `stairs: ${variant(X + 5, Y, Z + 2)}`);
  check(w.placeBlock(X + 6, Y, Z + 1, 'spruce_log', { against: hit(X + 6, Y, Z, [0, 0, 1]) }), 'log refused');
  check(variant(X + 6, Y, Z + 1) === 'spruce_log[axis=z]', `log: ${variant(X + 6, Y, Z + 1)}`);

  // A bed: its head one further along the way it faces; not where the head has no room.
  check(w.placeBlock(X + 1, Y, Z + 5, 'red_bed', { facing: 'east' }), 'bed refused');
  check(variant(X + 1, Y, Z + 5) === 'red_bed[facing=east,part=foot]' && variant(X + 2, Y, Z + 5) === 'red_bed[facing=east,part=head]', `bed: ${variant(X + 1, Y, Z + 5)} / ${variant(X + 2, Y, Z + 5)}`);
  check(!w.placeBlock(X + 5, Y, Z + 3, 'blue_bed', { facing: 'north' }), 'a bed with its head in the stairs');

  // Breaking: the head takes the foot, the wall takes its torch, the floor takes the torch on it.
  check(w.breakBlock(X + 2, Y, Z + 5), 'breaking the bed failed');
  check(variant(X + 1, Y, Z + 5) === 'air', `bed foot left behind: ${variant(X + 1, Y, Z + 5)}`);
  w.breakBlock(X + 1, Y + 1, Z);
  check(variant(X + 1, Y + 1, Z + 1) === 'air', 'the torch stayed on a wall that went');
  w.breakBlock(X + 3, Y - 1, Z + 3);
  check(variant(X + 3, Y, Z + 3) === 'air', 'the torch stayed on a floor that went');
  const want = ['red_bed', 'red_bed', 'stone', 'torch', 'stone', 'torch'];
  check(breaks.map((b) => b.split('@')[0]).join() === want.join(), `break events: ${breaks.join(' ')}`);

  // Rays meet a slab's half, not its cell.
  const ray = w.raycast({ x: X + 2.5, y: Y + 0.25, z: Z + 3.5 }, { x: 0, y: 0, z: -1 }, 3);
  check(ray === null || !(ray.x === X + 2 && ray.z === Z + 1), 'a ray under a top slab hit the slab');
  const down = w.raycast({ x: X + 2.5, y: Y + 3, z: Z + 1.5 }, { x: 0, y: -1, z: 0 }, 5);
  check(down?.normal.y === 1 && Math.abs((down?.point.y ?? 0) - (Y + 1)) < 1e-6, `down onto the top slab: ${JSON.stringify(down)}`);
  console.log('  torches on walls and floors, slab halves and joins, stairs, logs, beds, what goes with what, rays');
}
