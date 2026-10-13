import type { Vec3 } from '../../src/platform';
import { navGrid } from '../../src/platform/kits';
import { match } from '../../src/games/callofblocky/match';
import { NUKEBLOCK } from '../../src/games/callofblocky/maps/nukeblock';
import { check, launch } from './_harness';

/** The houses' upstairs ceilings: anything higher is a roof. */
const UP_CEILING = 72;

/**
 * Nukeblock, Call of Blocky's test town: every spawn, site and hotspot is somewhere to stand (ground
 * under the feet, room over the head), inside the fences, and a body can walk to each from the
 * green house's garden and back, upstairs and into the bus included; a minute's free-for-all
 * there, the bots finding each other all over the town without leaving it; Team Deathmatch puts
 * each side in its own garden; and someone carrying the FAMAS fires it.
 */
export default function cobnukeblock() {
  const t0 = performance.now();
  const h = launch('callofblocky', { seed: 11, radius: 5 });
  const g = h.ctx;
  g.commands.run('mode ffa nukeblock');
  h.run(2);
  check(match.map.id === 'nukeblock', `a free-for-all in the test town (got ${match.mode.id} on ${match.map.id})`);
  const M = NUKEBLOCK;
  const b = M.bounds;

  const standing = (p: Vec3) => {
    const x = Math.floor(p.x);
    const y = Math.floor(p.y + 0.01);
    const z = Math.floor(p.z);
    return g.world.getBlock(x, y - 1, z) >= 0 && g.world.collisionHeight(x, y - 1, z) >= 0.5 && g.world.collisionHeight(x, y, z) === 0 && g.world.collisionHeight(x, y + 1, z) === 0;
  };
  const places: [string, Vec3][] = [
    ...M.spawns.map((s, i): [string, Vec3] => [`spawn ${i}`, s]),
    ...M.teams.flatMap((t, k) => t.map((s, i): [string, Vec3] => [`team ${k} spawn ${i}`, s])),
    ...M.bomb.attack.map((s, i): [string, Vec3] => [`attack spawn ${i}`, s]),
    ...M.bomb.defend.map((s, i): [string, Vec3] => [`defend spawn ${i}`, s]),
    ...M.bomb.sites.map((s): [string, Vec3] => [`site ${s.name}`, s.at]),
    ...M.hotspots.map((s, i): [string, Vec3] => [`hotspot ${i}`, s]),
    ['home', M.home],
  ];
  // Walk the local player over the town so all of it loads.
  const nav = navGrid(g, { bounds: b, live: false });
  for (let x = b.min.x; x <= b.max.x + 40 && !nav.build(); x += 40)
    for (let z = b.min.z; z <= b.max.z + 40; z += 40) {
      g.player.teleport({ x: Math.min(x, b.max.x), y: M.floorY + 30, z: Math.min(z, b.max.z) });
      h.run(0.3, { pilot: () => ({}) });
    }
  check(nav.ready, 'its walking grid builds once the town has loaded');

  const off = places.filter(([, p]) => !standing(p)).map(([n, p]) => `${n} (${p.x}, ${p.y}, ${p.z - 512})`);
  check(off.length === 0, `every spawn, site and hotspot is somewhere to stand: not ${off.join('; ')}`);
  for (const [n, p] of places) check(p.x > b.min.x && p.x < b.max.x && p.z > b.min.z && p.z < b.max.z, `${n} is inside the fences`);

  const from = M.teams[0][0];
  const lost = places.filter(([n, p]) => n !== 'team 0 spawn 0' && (!nav.path(from, p, 200000) || !nav.path(p, from, 200000))).map(([n]) => n);
  check(lost.length === 0, `every place can be walked to from the green garden and back: not ${lost.join(', ')}`);
  // What a body can get to from the garden: the street and the upstairs rooms, never the roofs; and
  // nowhere it can get into and not back out of.
  const start = nav.cellAt(from)!;
  const reached = new Set([start]);
  const queue = [start];
  while (queue.length) for (const e of queue.shift()!.edges) if (!reached.has(e.to)) (reached.add(e.to), queue.push(e.to));
  const levels = new Set([...reached].map((c) => c.y));
  check([64, 69].every((y) => levels.has(y)), `the walking grid covers the street and the upstairs rooms (${[...levels].sort().join(', ')})`);
  const roofs = [...reached].filter((c) => c.y > UP_CEILING);
  check(roofs.length === 0, `nobody gets up on the roofs: ${roofs.slice(0, 6).map((c) => `(${c.x}, ${c.y}, ${c.z - 512})`).join(' ')}`);
  const back = new Map<(typeof start), (typeof start)[]>();
  for (const c of reached) for (const e of c.edges) (back.get(e.to) ?? back.set(e.to, []).get(e.to)!).push(c);
  const home = new Set([start]);
  const todo = [start];
  while (todo.length) for (const c of back.get(todo.pop()!) ?? []) if (!home.has(c)) (home.add(c), todo.push(c));
  const traps = [...reached].filter((c) => !home.has(c));
  check(traps.length === 0, `nowhere to get stuck: ${traps.slice(0, 6).map((c) => `(${c.x}, ${c.y}, ${c.z - 512})`).join(' ')}`);

  // A minute's free-for-all: the bots find each other all over town, and nobody gets out of it.
  let shots = 0;
  let deaths = 0;
  let famas = 0;
  g.events.on('shot', (e) => {
    shots++;
    if (e.weapon === 'famas') famas++;
  });
  g.events.on('playerDeath', () => deaths++);
  const visited = new Set<string>();
  let escaped = 0;
  // Half the bots take the FAMAS from their next life on.
  [...match.fighters.values()].filter((f) => f.player.bot).forEach((f, i) => i % 2 === 0 && (f.primary = 'famas'));
  h.run(60, {
    until: (hh) => {
      for (const p of hh.ctx.players) {
        if (!p.bot || !p.alive) continue;
        visited.add(`${Math.floor(p.position.x / 4)},${Math.floor(p.position.z / 4)}`);
        const q = p.position;
        if (q.x < b.min.x - 0.5 || q.x > b.max.x + 1.5 || q.z < b.min.z - 0.5 || q.z > b.max.z + 1.5) escaped++;
      }
      return false;
    },
  });
  console.log(`  nukeblock: ${places.length} places to stand, all walkable from the green garden; ${reached.size} of ${nav.size} cells reachable, on levels ${[...levels].sort().join('/')}; 60 s: ${shots} shots (${famas} from a FAMAS), ${deaths} deaths, bots on ${visited.size} 4x4 cells`);
  check(shots > 40, `bots fight in the town (${shots} shots)`);
  check(deaths >= 3, `bots kill each other there (${deaths} deaths)`);
  check(visited.size > 25, `bots roam the town (${visited.size} cells)`);
  check(famas > 0, `the FAMAS is fired (${famas} shots)`);
  check(escaped === 0, `nobody gets out past the fences (${escaped} ticks outside)`);

  // Team Deathmatch: each side starts in its own garden.
  g.commands.run('mode tdm nukeblock');
  h.run(2);
  check(match.map.id === 'nukeblock' && match.mode.id === 'tdm', `Team Deathmatch in the test town (got ${match.mode.id} on ${match.map.id})`);
  console.log(`  (${((performance.now() - t0) / 1000).toFixed(1)} s)`);
}
