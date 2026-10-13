import { throwables } from '../../src/platform/kits';
import { check, launch } from './_harness';

/**
 * Call of Blocky with the local player standing idle: the bots fill the street, find each other
 * along the walking grid, and shoot it out with the platform's guns (bots fire from the trigger,
 * the host casts every bullet), lob their lethals after whoever ducks out of sight, and pick up
 * the ammo the fallen drop.
 */
export default function callofblocky() {
  const t0 = performance.now();
  const h = launch('callofblocky', { seed: 3, radius: 5 });
  const g = h.ctx;
  check(g.players.length === 6, `expected 6 fighters (1 person + 5 bots), got ${g.players.length}`);
  let shots = 0;
  let deaths = 0;
  let heads = 0;
  let mine = 0;
  const byWeapon = new Map<string, number>();
  let bags = 0;
  g.events.on('shot', () => shots++);
  g.events.on('pickup', (e) => e.item === 'ammo' && bags++);
  g.events.on('playerDeath', (e) => {
    deaths++;
    if (!e.player.bot) mine++;
    if (e.headshot) heads++;
    if (e.weapon) byWeapon.set(e.weapon, (byWeapon.get(e.weapon) ?? 0) + 1);
  });
  // Where the bots go: they should cover the map, not stand at their spawns.
  const visited = new Set<string>();
  // Lethals thrown (at least: each time more are in the air than a step before).
  let thrown = 0;
  let flying = 0;
  const simulated = h.run(90, {
    pilot: () => null,
    until: (hh) => {
      for (const p of hh.ctx.players) if (p.bot) visited.add(`${Math.floor(p.position.x / 4)},${Math.floor(p.position.z / 4)}`);
      const now = throwables.of(hh.ctx)!.thrown().length;
      if (now > flying) thrown += now - flying;
      flying = now;
      return false;
    },
  });
  const wall = (performance.now() - t0) / 1000;
  const cases = h.find('hud', 'feed').filter((c) => JSON.stringify(c.args[0]).includes('has the briefcase')).length;
  const weapons = [...byWeapon].map(([w, n]) => `${w} ${n}`).join(', ');
  console.log(`  ${simulated.toFixed(0)} s in ${wall.toFixed(1)} s: ${shots} shots, ${deaths} deaths (${mine} of them the idle player; ${heads} headshots; ${weapons}), bots visited ${visited.size} 4x4 cells, ${thrown} lethals thrown, the briefcase taken ${cases}×, ${bags} ammo bags picked up`);
  check(shots > 40, `bots hardly fired (${shots} shots)`);
  check(deaths >= 3, `bots should kill each other (${deaths} deaths)`);
  check(thrown >= 1, `bots should throw their lethals (${thrown} thrown)`);
  check(visited.size > 25, `bots should roam the map (${visited.size} cells)`);
  check(bags >= 1, `the fallen's ammo bags should get picked up (${bags})`);
}
