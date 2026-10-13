import type { Vec3 } from '../../src/platform';
import { navGrid } from '../../src/platform/kits';
import { match } from '../../src/games/callofblocky/match';
import { RUST } from '../../src/games/callofblocky/maps/rust';
import { check, launch } from './_harness';

/** Over the tower's crow's nest (players stand at 79): anything higher is a roof or a tank. */
const ROOF = 80;

/**
 * Rust, Call of Blocky's oil yard: every spawn, site and hotspot is somewhere to stand (ground under
 * the feet, room over the head), inside the walls, and a body can walk to each from the first
 * team's start and back, all three of the tower's decks and its crow's nest, the pump house's
 * office and the tank's catwalk included; a minute's free-for-all there, the bots finding each
 * other all over the yard without leaving it; and Team Deathmatch starts there.
 */
export default function cobrust() {
  const t0 = performance.now();
  const h = launch('callofblocky', { seed: 11, radius: 5 });
  const g = h.ctx;
  g.commands.run('mode ffa rust');
  h.run(2);
  check(match.map.id === 'rust', `a free-for-all in the oil yard (got ${match.mode.id} on ${match.map.id})`);
  const M = RUST;
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
  // Walk the local player over the yard so all of it loads.
  const nav = navGrid(g, { bounds: b, live: false });
  for (let x = b.min.x; x <= b.max.x + 40 && !nav.build(); x += 40)
    for (let z = b.min.z; z <= b.max.z + 40; z += 40) {
      g.player.teleport({ x: Math.min(x, b.max.x), y: M.floorY + 30, z: Math.min(z, b.max.z) });
      h.run(0.3, { pilot: () => ({}) });
    }
  check(nav.ready, 'its walking grid builds once the yard has loaded');

  const off = places.filter(([, p]) => !standing(p)).map(([n, p]) => `${n} (${p.x}, ${p.y}, ${p.z + 512})`);
  check(off.length === 0, `every spawn, site and hotspot is somewhere to stand: not ${off.join('; ')}`);
  for (const [n, p] of places) check(p.x > b.min.x && p.x < b.max.x && p.z > b.min.z && p.z < b.max.z, `${n} is inside the walls`);

  const from = M.teams[0][0];
  const lost = places.filter(([n, p]) => n !== 'team 0 spawn 0' && (!nav.path(from, p, 200000) || !nav.path(p, from, 200000))).map(([n]) => n);
  check(lost.length === 0, `every place can be walked to from the first team's start and back: not ${lost.join(', ')}`);
  // What a body can get to from there: the yard, the tower's decks, the office and the catwalk,
  // never a roof or the top of a tank; and nowhere it can get into and not back out of.
  const start = nav.cellAt(from)!;
  const reached = new Set([start]);
  const queue = [start];
  while (queue.length) for (const e of queue.shift()!.edges) if (!reached.has(e.to)) (reached.add(e.to), queue.push(e.to));
  const levels = new Set([...reached].map((c) => c.y));
  check([64, 69, 74, 79].every((y) => levels.has(y)), `the walking grid covers the yard, the decks and the crow's nest (${[...levels].sort().join(', ')})`);
  const roofs = [...reached].filter((c) => c.y > ROOF);
  check(roofs.length === 0, `nobody gets up on the roofs: ${roofs.slice(0, 6).map((c) => `(${c.x}, ${c.y}, ${c.z + 512})`).join(' ')}`);
  const back = new Map<(typeof start), (typeof start)[]>();
  for (const c of reached) for (const e of c.edges) (back.get(e.to) ?? back.set(e.to, []).get(e.to)!).push(c);
  const home = new Set([start]);
  const todo = [start];
  while (todo.length) for (const c of back.get(todo.pop()!) ?? []) if (!home.has(c)) (home.add(c), todo.push(c));
  const traps = [...reached].filter((c) => !home.has(c));
  check(traps.length === 0, `nowhere to get stuck: ${traps.slice(0, 6).map((c) => `(${c.x}, ${c.y}, ${c.z + 512})`).join(' ')}`);

  // A minute's free-for-all: the bots find each other all over the yard, and nobody gets out of it.
  let shots = 0;
  let deaths = 0;
  g.events.on('shot', () => shots++);
  g.events.on('playerDeath', () => deaths++);
  const visited = new Set<string>();
  const heights = new Set<number>();
  let escaped = 0;
  h.run(60, {
    until: (hh) => {
      for (const p of hh.ctx.players) {
        if (!p.bot || !p.alive) continue;
        visited.add(`${Math.floor(p.position.x / 4)},${Math.floor(p.position.z / 4)}`);
        heights.add(Math.floor(p.position.y + 0.01));
        const q = p.position;
        if (q.x < b.min.x - 0.5 || q.x > b.max.x + 1.5 || q.z < b.min.z - 0.5 || q.z > b.max.z + 1.5) escaped++;
      }
      return false;
    },
  });
  console.log(`  rust: ${places.length} places to stand, all walkable from the first team's start; ${reached.size} of ${nav.size} cells reachable, on levels ${[...levels].sort().join('/')}; 60 s: ${shots} shots, ${deaths} deaths, bots on ${visited.size} 4x4 cells, at heights ${[...heights].sort().join('/')}`);
  check(shots > 40, `bots fight in the yard (${shots} shots)`);
  check(deaths >= 3, `bots kill each other there (${deaths} deaths)`);
  check(visited.size > 25, `bots roam the yard (${visited.size} cells)`);
  check(escaped === 0, `nobody gets out past the walls (${escaped} ticks outside)`);

  // Team Deathmatch starts there too.
  g.commands.run('mode tdm rust');
  h.run(2);
  check(match.map.id === 'rust' && match.mode.id === 'tdm', `Team Deathmatch in the oil yard (got ${match.mode.id} on ${match.map.id})`);
  console.log(`  (${((performance.now() - t0) / 1000).toFixed(1)} s)`);
}
