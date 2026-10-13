import type { Vec3 } from '../../src/platform';
import { navGrid } from '../../src/platform/kits';
import type { Headless } from '../../src/platform/host/headless';
import { match } from '../../src/games/callofblocky/match';
import { HIJACKED } from '../../src/games/callofblocky/maps/hijacked';
import { check, launch } from './_harness';

/**
 * Hijacked, Call of Blocky's yacht: every spawn, site and hotspot is somewhere to stand (a deck
 * under the feet, room over the head), and a body can walk to each from the swim platform and
 * back, over all five levels; whoever goes overboard is lost; bots fight their way round her for
 * a minute without falling in; and a round of The Briefcase aboard her is played out.
 */
export default function cobyacht() {
  standAndWalk();
  briefcaseRound();
}

/** The feed's lines so far, as text. */
function feed(h: Headless): string[] {
  return h.find('hud', 'feed').map((c) => {
    const parts = c.args[0];
    return Array.isArray(parts) ? parts.map((p) => (typeof p === 'string' ? p : ((p as { text?: string }).text ?? ''))).join('') : String(parts);
  });
}

function standAndWalk() {
  const t0 = performance.now();
  const h = launch('callofblocky', { seed: 9, radius: 5 });
  const g = h.ctx;
  g.commands.run('mode ffa hijacked');
  h.run(2);
  check(match.map.id === 'hijacked', `a free-for-all aboard her (got ${match.mode.id} on ${match.map.id})`);
  const M = HIJACKED;

  // Somewhere to stand: a deck under the feet (loaded), nothing in the way of the body.
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
  const off = places.filter(([, p]) => !standing(p)).map(([n, p]) => `${n} (${p.x - -512}, ${p.y}, ${p.z})`);
  check(off.length === 0, `every spawn, site and hotspot is somewhere to stand: not ${off.join('; ')}`);
  for (const [n, p] of places) {
    const b = M.bounds;
    check(p.x >= b.min.x && p.x <= b.max.x && p.z >= b.min.z && p.z <= b.max.z && p.y > (M.sea ?? 0), `${n} is aboard, over the sea`);
  }

  // Walked to from the swim platform, and back, every one.
  const nav = navGrid(g, { bounds: M.bounds, live: false });
  check(nav.build(), 'her walking grid builds (her chunks have loaded)');
  const from = M.spawns[0];
  const lost = places.filter(([n, p]) => n !== 'spawn 0' && (!nav.path(from, p, 200000) || !nav.path(p, from, 200000))).map(([n]) => n);
  check(lost.length === 0, `every place can be walked to from the swim platform and back: not ${lost.join(', ')}`);
  const levels = new Set<number>();
  for (let i = 0; i < 4000; i++) {
    const c = nav.random();
    if (c) levels.add(c.y);
  }
  check([64, 69, 74, 79].every((y) => levels.has(y)), `her walking grid covers all her decks (${[...levels].sort().join(', ')})`);

  // Overboard: the sea takes whoever falls in.
  let drowned = 0;
  g.events.on('playerDeath', (e) => {
    if (e.source === 'world') drowned++;
  });
  const bot = g.players.find((p) => p.bot && p.alive)!;
  bot.teleport({ x: -512.5, y: 65, z: 19.5 });
  h.run(1.5);
  check(!bot.alive && drowned === 1, `over the side, into the sea: lost (${bot.name} ${bot.alive ? 'still alive' : 'gone'})`);

  // A minute's free-for-all: the bots find each other all over her, and nobody falls in.
  drowned = 0;
  let shots = 0;
  let deaths = 0;
  g.events.on('shot', () => shots++);
  g.events.on('playerDeath', () => deaths++);
  const visited = new Set<string>();
  const decks = new Set<number>();
  h.run(60, {
    until: (hh) => {
      for (const p of hh.ctx.players) {
        if (!p.bot || !p.alive) continue;
        visited.add(`${Math.floor(p.position.x / 4)},${Math.floor(p.position.z / 4)}`);
        if (p.onGround) decks.add(Math.round(p.position.y));
      }
      return false;
    },
  });
  console.log(`  aboard: ${places.length} places to stand, all walkable from the swim platform; ${nav.size} cells over decks ${[...levels].sort().join('/')}; 60 s: ${shots} shots, ${deaths} deaths (${drowned} overboard), bots on ${visited.size} 4x4 cells, decks ${[...decks].filter((y) => [64, 69, 74, 79].includes(y)).sort().join('/')} (${((performance.now() - t0) / 1000).toFixed(1)} s)`);
  check(shots > 40, `bots fight aboard her (${shots} shots)`);
  check(deaths >= 3, `bots kill each other there (${deaths} deaths)`);
  check(drowned === 0, `bots don't fall overboard (${drowned})`);
  check(visited.size > 25, `bots roam her (${visited.size} cells)`);
  check([64, 69, 74].filter((y) => decks.has(y)).length >= 2, `bots fight on more than one deck (${[...decks].sort().join(', ')})`);
}

function briefcaseRound() {
  const t0 = performance.now();
  const h = launch('callofblocky', { seed: 10, radius: 5 });
  const g = h.ctx;
  g.commands.run('mode case hijacked');
  h.run(0.5);
  check(match.mode.id === 'case' && match.map.id === 'hijacked', `The Briefcase aboard her (got ${match.mode.id} on ${match.map.id})`);
  const simulated = h.run(240, {
    until: (hh) => {
      const me = hh.ctx.player;
      if (me.alive && !me.frozen) me.damage(1000, { source: 'world' });
      return feed(hh).some((l) => l.includes(' take round '));
    },
  });
  const lines = feed(h);
  const round = lines.find((l) => l.includes(' take round '));
  const play = lines.filter((l) => /planted the case|picked up the case|dropped the case|cracked the case|went off/.test(l)).length;
  console.log(`  The Briefcase aboard her: a round in ${simulated.toFixed(0)} s (${((performance.now() - t0) / 1000).toFixed(1)} s): ${round}; the case: ${play} moments`);
  check(round, 'a round is played out');
}
