import { match } from '../../src/games/blockfront/match';
import { check, launch } from './_harness';

/**
 * Probe: a Blockfront bot match played out (the local player idle at their base), minute by
 * minute: tickets, posts held, captures, deaths, heroes and battle points, and how it ends.
 * `SECONDS=600 SEED=3 node scripts/headless.mjs tests/headless/_bf-match.ts`
 */
export default function bfMatch() {
  const seconds = Number(process.env.SECONDS ?? 600);
  const h = launch('blockfront', { seed: Number(process.env.SEED ?? 3), radius: 6 });
  const g = h.ctx;
  // The idle person on the other side (TEAM=1), to tell a side's edge from the map's.
  if (process.env.TEAM === '1') g.commands.run('/team 1');
  if (process.env.SIDE) g.commands.run(`/bots ${process.env.SIDE}`);
  // EVEN=1: ten bots a side, and the idle person on top on the Rebels'.
  if (process.env.EVEN === '1') {
    g.commands.run('/bots 11');
    const extra = g.bots.all.find((b) => match.fighters.get(b.id)?.team === 1);
    if (extra) g.bots.remove(extra);
  }
  let deaths = 0;
  let heroDeaths = 0;
  const heroTimes: number[] = [];
  const kills = new Map<string, number>();
  const bump = (k: string) => kills.set(k, (kills.get(k) ?? 0) + 1);
  g.events.on('damage', () => {});
  g.events.on('playerDeath', ({ player, source, weapon }) => {
    deaths++;
    if (match.fighters.get(player.id)?.hero) heroDeaths++;
    const v = match.fighters.get(player.id);
    const k = source && source !== 'world' && source.kind === 'player' ? match.fighters.get(source.id) : undefined;
    bump(`died:${v?.team}`);
    if (k) bump(`${k.team}:${weapon}${k.hero ? ` (${k.hero})` : ''}`);
  });
  const captures = () => h.find('hud', 'feed').filter((c) => JSON.stringify(c.args[0]).includes(' took ')).length;
  const heroes = new Set<string>();
  let nextMinute = 60;
  let over = -1;
  h.run(seconds, {
    pilot: () => null,
    until: () => {
      const t = g.clock.now;
      for (const f of match.fighters.values())
        if (f.hero && !heroes.has(`${f.player.id}:${f.deaths}`)) {
          heroes.add(`${f.player.id}:${f.deaths}`);
          heroTimes.push(Math.round(t));
        }
      if (t >= nextMinute) {
        nextMinute += 60;
        const bp = [...match.fighters.values()].map((f) => f.bp).sort((a, b) => b - a);
        const posts = match.posts.map((p) => `${p.spec.id}${p.owner === null ? '-' : p.owner}`).join(' ');
        console.log(`  ${Math.round(t / 60)} min: tickets ${match.tickets.join('/')}, posts ${posts}, ${captures()} captures, ${deaths} deaths (${heroDeaths} heroes), heroes up ${[...match.fighters.values()].filter((f) => f.hero).length}, top BP ${bp.slice(0, 3).join(', ')}`);
      }
      if (match.phase === 'over' && over < 0) over = t;
      return match.phase === 'over';
    },
  });
  console.log('  ' + [...kills].sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k} ${n}`).join(', '));
  console.log(`  ended ${over >= 0 ? `at ${(over / 60).toFixed(1)} min` : 'not yet'}: tickets ${match.tickets.join('/')}; heroes taken at ${heroTimes.join(', ')} s`);
  check(true, '');
}
