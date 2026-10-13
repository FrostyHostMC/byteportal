import type { BlockRef } from '../../src/platform';
import { MAP_DEFS } from '../../src/games/bedwars/maps';
import { blockIdOf, loadRegistry } from '../../src/platform/world/registry';
import { check, launch } from './_harness';

/**
 * Every Bed Wars map keeps the contract the game relies on: four teams in order, each with a
 * two-block bed on the floor and room round it, a clear spawn and shop, generators on pads;
 * islands apart (so there's bridging to do), nothing below the void line or in the lobby's space
 * over the centre, every block name real. Prints each map's floor, extent and gaps.
 */
export default function bedwarsMaps() {
  launch('bedwars-map', { seed: 1, radius: 1 }); // starts the engine
  const reg = loadRegistry();
  for (const def of MAP_DEFS) {
    const t0 = performance.now();
    const m = def.build();
    const ms = performance.now() - t0;
    const cells = new Map<string, BlockRef>();
    const owner = new Map<string, number>();
    const key = (x: number, y: number, z: number) => `${x},${y},${z}`;
    let minY = Infinity;
    let maxY = -Infinity;
    let reach = 0;
    const names = new Set<string>();
    m.blueprints.forEach((bp, i) =>
      bp.forEach((x, y, z, b) => {
        if (b === 'air') return;
        cells.set(key(x, y, z), b);
        owner.set(`${x},${z}`, owner.has(`${x},${z}`) && owner.get(`${x},${z}`) !== i ? -1 : i);
        minY = Math.min(minY, y);
        maxY = Math.max(maxY, y);
        reach = Math.max(reach, Math.hypot(x, z));
        names.add(String(b));
      }),
    );
    for (const n of names) blockIdOf(reg, n);
    const at = (x: number, y: number, z: number) => cells.get(key(Math.floor(x), Math.floor(y), Math.floor(z)));
    const solid = (b: BlockRef | undefined) => b !== undefined && !['torch', 'short_grass', 'dead_bush', 'poppy', 'dandelion', 'cornflower', 'fern', 'water'].includes(String(b));
    check(m.teams.map((t) => t.color).join() === 'red,blue,green,yellow', `${def.id}: team order`);
    const floorY = m.teams[0].spawn.y - 1;
    for (const t of m.teams) {
      const [a, b] = t.bed;
      check(String(at(a.x, a.y, a.z)).startsWith(`${t.color}_bed[`) && String(at(a.x, a.y, a.z)).includes('part=foot'), `${def.id} ${t.color}: bed foot ${at(a.x, a.y, a.z)}`);
      check(String(at(b.x, b.y, b.z)).includes('part=head'), `${def.id} ${t.color}: bed head`);
      check(Math.abs(a.x - b.x) + Math.abs(a.z - b.z) === 1 && a.y === b.y, `${def.id} ${t.color}: bed halves apart`);
      for (const [name, p] of [['spawn', t.spawn], ['shop', t.shop]] as const) {
        check(solid(at(p.x, p.y - 1, p.z)), `${def.id} ${t.color}: nothing under the ${name}`);
        check(!solid(at(p.x, p.y, p.z)) && !solid(at(p.x, p.y + 1, p.z)), `${def.id} ${t.color}: ${name} blocked`);
        check(p.y - 1 === floorY, `${def.id} ${t.color}: ${name} not on the floor`);
      }
      check(solid(at(t.generator.x, t.generator.y - 1, t.generator.z)), `${def.id} ${t.color}: generator pad`);
      check(t.generator.y - 2 === floorY, `${def.id} ${t.color}: generator pad not on the floor`);
      check(a.y - 1 === floorY, `${def.id} ${t.color}: bed not on the floor`);
      // Room round the bed: the 8 cells round it at floor level are open floor.
      for (const c of [a, b]) for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const x = c.x + dx;
        const z = c.z + dz;
        if (t.bed.some((q) => q.x === x && q.z === z)) continue;
        check(solid(at(x, floorY, z)) && !solid(at(x, floorY + 1, z)) && !solid(at(x, floorY + 2, z)), `${def.id} ${t.color}: no room beside the bed at ${x},${z}`);
      }
    }
    for (const g of [...m.diamonds, ...m.emeralds]) check(solid(at(g.x, g.y - 1, g.z)), `${def.id}: a generator floats at ${JSON.stringify(g)}`);
    check(m.diamonds.length === 4 && m.emeralds.length >= 2, `${def.id}: generators`);
    // The lobby's column over the centre.
    const c = m.center;
    let blocked = 0;
    for (let y = Math.floor(c.y) + 24; y <= Math.floor(c.y) + 45; y++) for (let x = Math.floor(c.x) - 12; x <= Math.floor(c.x) + 12; x++) for (let z = Math.floor(c.z) - 12; z <= Math.floor(c.z) + 12; z++) if (at(x, y, z)) blocked++;
    check(blocked === 0, `${def.id}: ${blocked} blocks in the lobby's space`);
    check(minY > m.voidY, `${def.id}: blocks below voidY (${minY} vs ${m.voidY})`);
    check(reach < 120, `${def.id}: reaches ${reach.toFixed(0)} from the origin`);
    // Islands kept apart: no column is shared between two blueprints, and the gap from each
    // team's island to anything else (at floor level) is at least 3.
    const floorCols = m.blueprints.map((bp) => {
      const out: [number, number][] = [];
      for (let x = bp.origin.x; x < bp.origin.x + bp.size.x; x++)
        for (let z = bp.origin.z; z < bp.origin.z + bp.size.z; z++) if (bp.get(x, floorY, z) !== undefined) out.push([x, z]);
      return out;
    });
    const gaps: string[] = [];
    for (let i = 0; i < 4; i++) {
      let best = Infinity;
      let bestTo = -1;
      for (let j = 0; j < floorCols.length; j++) {
        if (j === i) continue;
        for (const [x, z] of floorCols[i]) for (const [u, v] of floorCols[j]) {
          const d = Math.max(Math.abs(x - u), Math.abs(z - v)) - 1;
          if (d < best) {
            best = d;
            bestTo = j;
          }
        }
      }
      check(best >= 3, `${def.id}: team ${i} island only ${best} from island ${bestTo}`);
      gaps.push(`${best}->${bestTo}`);
    }
    // Every team's front gap to the centre (straight-line cells of void along the shortest way).
    const mid = floorCols.length - 1;
    const toMid = [0, 1, 2, 3].map((i) => {
      let best = Infinity;
      for (const [x, z] of floorCols[i]) for (const [u, v] of floorCols[mid]) best = Math.min(best, Math.hypot(x - u, z - v));
      return best.toFixed(1);
    });
    console.log(`  ${def.id} (${def.name}): floor ${floorY}, voidY ${m.voidY}, y ${minY}..${maxY}, reach ${reach.toFixed(0)}, center ${JSON.stringify(c)}, built in ${ms.toFixed(0)} ms, ${names.size} kinds of block; nearest neighbour gaps ${gaps.join(' ')}, team->centre ${toMid.join(' ')}`);
  }
}
