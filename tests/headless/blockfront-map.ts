import { navGrid, type NavCell } from '../../src/platform/kits';
import { MAPS } from '../../src/games/blockfront/map';
import { check, launch } from './_harness';

/**
 * Blockfront's maps hold together: every command post's spawn points fit a body standing on
 * something solid inside the map's bounds, every post can be walked to on the bots' grid from
 * both bases, nowhere a bot can walk into is a trap it can't walk out of, and no open line of
 * sight across the town runs much further than a sniper's lane.
 */
export default function blockfrontMap() {
  const h = launch('blockfront', { seed: 3, radius: 8 });
  const g = h.ctx;
  for (const map of MAPS) {
    const { min, max } = map.bounds;
    // Load all of it: walk the local player over the bounds until the grid can build.
    const nav = navGrid(g, { bounds: map.bounds, live: false });
    for (let x = min.x; x <= max.x + 64 && !nav.build(); x += 64)
      for (let z = min.z; z <= max.z + 64; z += 64) {
        g.player.teleport({ x: Math.min(x, max.x), y: map.floorY + 30, z: Math.min(z, max.z) });
        h.run(0.3, { pilot: () => ({}) });
      }
    check(nav.ready, `${map.id}: the walking grid should build once the bounds have loaded`);

    // ---- Spawn points: room for a body, standing on something, inside the bounds ----
    const solid = (x: number, y: number, z: number) => g.world.collisionHeight(x, y, z) > 0;
    for (const post of map.posts) {
      check(post.spawns.length >= 8, `${map.id} ${post.id}: ${post.spawns.length} spawn points, want 8 or more`);
      for (const sp of post.spawns) {
        const where = `${map.id} ${post.id} spawn (${sp.x}, ${sp.y}, ${sp.z})`;
        check(sp.x > min.x && sp.x < max.x && sp.z > min.z && sp.z < max.z && sp.y >= min.y && sp.y <= max.y, `${where} is outside the bounds`);
        check(g.world.fits(sp), `${where}: a body doesn't fit`);
        const bx = Math.floor(sp.x);
        const by = Math.floor(sp.y);
        const bz = Math.floor(sp.z);
        check(!solid(bx, by + 1, bz), `${where}: no headroom`);
        check(solid(bx, by - 1, bz) || g.world.collisionHeight(bx, by, bz) > 0, `${where}: nothing to stand on`);
      }
    }

    // ---- Walking: from each base to every post, and nowhere to get stuck ----
    const parent = new Map<NavCell, NavCell>();
    const reach = (from: NavCell) => {
      const seen = new Set<NavCell>([from]);
      const queue = [from];
      while (queue.length) {
        const c = queue.shift()!;
        for (const e of c.edges) if (!seen.has(e.to)) (seen.add(e.to), queue.push(e.to), parent.has(e.to) || parent.set(e.to, c));
      }
      return seen;
    };
    const bases = [map.posts[0], map.posts[map.posts.length - 1]];
    const reached = bases.map((b) => {
      const cell = nav.cellAt(b.spawns[0]);
      check(cell, `${map.id} ${b.id}: its first spawn point isn't on the grid`);
      return reach(cell!);
    });
    for (const post of map.posts) {
      const cell = nav.cellAt(post.at);
      check(cell && Math.hypot(cell.x + 0.5 - post.at.x, cell.z + 0.5 - post.at.z) < post.radius, `${map.id} ${post.id}: no walkable cell in the post`);
      reached.forEach((r, i) => check(r.has(cell!), `${map.id} ${post.id} (${post.name}) can't be walked to from ${bases[i].name}`));
      for (const sp of post.spawns) {
        const c = nav.cellAt(sp);
        check(c && reached[0].has(c) && reached[1].has(c), `${map.id} ${post.id}: spawn (${sp.x}, ${sp.y}, ${sp.z}) is cut off from the bases`);
      }
    }
    // Traps: cells a bot can get to from the Rebels' base and not get back from.
    const from = reached[0];
    const back = new Map<NavCell, NavCell[]>();
    for (const c of from) for (const e of c.edges) (back.get(e.to) ?? back.set(e.to, []).get(e.to)!).push(c);
    const home = nav.cellAt(bases[0].spawns[0])!;
    const canReturn = new Set<NavCell>([home]);
    const queue = [home];
    while (queue.length) for (const c of back.get(queue.pop()!) ?? []) if (!canReturn.has(c)) (canReturn.add(c), queue.push(c));
    const traps = [...from].filter((c) => !canReturn.has(c));
    const spots = traps.slice(0, 8).map((c) => `(${c.x}, ${c.y}, ${c.z})`).join(' ');
    if (traps.length) {
      // The way in to the first, to see where the grid lets a bot up.
      const way: NavCell[] = [];
      for (let c: NavCell | undefined = traps[0]; c && c !== home; c = parent.get(c)) way.unshift(c);
      // Where it climbs or drops: the steps that change height.
      const steps = way.filter((c, i) => i > 0 && c.y !== way[i - 1].y).map((c) => `(${c.x}, ${c.y}, ${c.z})`);
      console.log(`  the way into (${traps[0].x}, ${traps[0].y}, ${traps[0].z}) changes height at ${steps.join(' > ')}`);
    }
    console.log(`  ${map.id}: ${nav.size} cells, ${from.size} reachable from ${bases[0].name}; ${traps.length} trapped${traps.length ? `: ${spots}` : ''}`);
    check(traps.length === 0, `${map.id}: ${traps.length} cells a bot can walk into and not out of, e.g. ${spots}`);

    // ---- Sight lines: the longest clear views at eye height, from the streets and from up high ----
    // (From a roof a ray skims over the others: it sees the rooftops, not the streets.)
    const cells = [...from];
    const lines: { d: number; at: NavCell; yaw: number }[] = [];
    for (let i = 0; i < cells.length; i += 5) {
      const c = cells[i];
      const eye = { x: c.x + 0.5, y: c.y + 1.6, z: c.z + 0.5 };
      for (let k = 0; k < 32; k++) {
        const a = (k / 32) * Math.PI * 2;
        const dir = { x: Math.cos(a), y: 0, z: Math.sin(a) };
        // Out to where the ray leaves the bounds.
        const tx = dir.x > 0 ? (max.x - eye.x) / dir.x : dir.x < 0 ? (min.x - eye.x) / dir.x : Infinity;
        const tz = dir.z > 0 ? (max.z - eye.z) / dir.z : dir.z < 0 ? (min.z - eye.z) / dir.z : Infinity;
        const out = Math.min(tx, tz);
        if (out < 60) continue;
        const hit = g.world.raycast(eye, dir, out);
        const d = hit ? Math.hypot(hit.point.x - eye.x, hit.point.z - eye.z) : out;
        lines.push({ d, at: c, yaw: a });
      }
    }
    lines.sort((a, b) => b.d - a.d);
    const say = (l: (typeof lines)[number]) => `${l.d.toFixed(0)} from (${l.at.x}, ${l.at.y}, ${l.at.z}) toward ${((l.yaw * 180) / Math.PI).toFixed(0)}°`;
    const low = lines.filter((l) => l.at.y <= map.floorY);
    const high = lines.filter((l) => l.at.y > map.floorY);
    const longLow = low.filter((l) => l.d > 60);
    console.log(`  ${map.id}: longest sight lines in the streets ${low.slice(0, 4).map(say).join('; ')} (${longLow.length} of ${low.length} rays over 60)`);
    console.log(`  ${map.id}: from up high ${high.slice(0, 3).map(say).join('; ')} (${high.filter((l) => l.d > 60).length} of ${high.length} over 60)`);
    // A lane or two a sniper can use; not a street you can see the length of.
    check(!low.length || low[0].d < 90, `${map.id}: a sight line down the streets ${say(low[0])}`);
    check(longLow.length < low.length * 0.005, `${map.id}: too many long sight lines down the streets (${longLow.length} of ${low.length} over 60)`);
  }
}
