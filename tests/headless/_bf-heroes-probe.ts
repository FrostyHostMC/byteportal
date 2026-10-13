import type { Player } from '../../src/platform/api/types';
import { HEROES, type HeroId } from '../../src/games/blockfront/heroes/defs';
import { match } from '../../src/games/blockfront/match';
import { launch } from './_harness';

/**
 * A probe (not a test): Blockfront's bots with heroes handed out early, to see how heroes fare.
 * Each hero life: how long, kills, damage done, what killed them. `SEED=3 SECONDS=180`.
 */
export default function probe() {
  const seed = Number(process.env.SEED ?? 3);
  const h = launch('blockfront', { seed, radius: 6 });
  const g = h.ctx;
  interface Life {
    hero: HeroId;
    name: string;
    from: number;
    to: number;
    kills: number;
    dealt: number;
    taken: Record<string, number>;
    by: string;
  }
  const lives = new Map<string, Life>();
  const done: Life[] = [];
  const heroOf = (p: Player) => match.fighters.get(p.id)?.hero ?? null;
  g.events.on('playerDamage', ({ player, amount, source, weapon }) => {
    const l = lives.get(player.id);
    if (l) l.taken[weapon ?? 'world'] = (l.taken[weapon ?? 'world'] ?? 0) + amount;
    const s = typeof source === 'object' && source?.kind === 'player' ? lives.get(source.id) : undefined;
    if (s) s.dealt += amount;
  });
  g.events.on('playerDeath', ({ player, source, weapon }) => {
    const s = typeof source === 'object' && source?.kind === 'player' ? lives.get(source.id) : undefined;
    if (s && source !== player) s.kills++;
    const l = lives.get(player.id);
    if (l) {
      l.to = h.time;
      l.by = weapon ?? 'world';
      done.push(l);
      lives.delete(player.id);
    }
  });
  let captures = 0;
  const seconds = Number(process.env.SECONDS ?? 180);
  h.run(seconds, {
    pilot: () => null,
    until: () => {
      // One would-be hero a side (HEROES_A_SIDE=2 lets them all be).
      const per = Number(process.env.HEROES_A_SIDE ?? 1);
      for (const t of [0, 1]) {
        const side = [...match.fighters.values()].filter((f) => f.team === t && f.player.bot);
        side.slice(0, per).forEach((f) => (f.bp = Math.max(f.bp, 1300)));
      }
      for (const f of match.fighters.values()) {
        const id = heroOf(f.player);
        if (id && f.player.alive && !lives.has(f.player.id)) lives.set(f.player.id, { hero: id, name: f.player.name, from: h.time, to: -1, kills: 0, dealt: 0, taken: {}, by: '' });
      }
      captures = h.find('hud', 'feed').filter((c) => JSON.stringify(c.args[0]).includes(' took ')).length;
      return false;
    },
  });
  for (const l of lives.values()) done.push({ ...l, to: h.time, by: '(alive)' });
  const fmt = (l: Life) =>
    `  ${HEROES[l.hero].name.padEnd(19)} ${(l.to - l.from).toFixed(0).padStart(4)} s  ${String(l.kills).padStart(2)} kills  ${l.dealt.toFixed(0).padStart(5)} dealt  by ${l.by.padEnd(16)} took ${Object.entries(l.taken)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 4)
      .map(([k, v]) => `${k} ${v.toFixed(0)}`)
      .join(', ')}`;
  console.log(done.map(fmt).join('\n'));
  const kills = done.reduce((n, l) => n + l.kills, 0);
  const time = done.reduce((n, l) => n + l.to - l.from, 0);
  console.log(`  ${done.length} hero lives, ${kills} kills, ${(time / Math.max(1, done.length)).toFixed(0)} s a life on average, ${(kills / Math.max(1, done.length)).toFixed(1)} kills a life; ${captures} captures; tickets ${match.tickets.join(' / ')}`);
}
