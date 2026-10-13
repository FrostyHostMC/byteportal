import { guns } from '../../src/platform/kits';
import { match } from '../../src/games/blockfront/match';
import { check, launch } from './_harness';

/**
 * Blockfront II with the local player standing idle at their base: the bots fill both sides, fight
 * over the command posts along the walking grid, capture them, and drain each other's tickets;
 * blasters overheat and cool; someone earns a hero.
 */
export default function blockfront() {
  const t0 = performance.now();
  const h = launch('blockfront', { seed: 3, radius: 6 });
  const g = h.ctx;
  check(g.players.length === 20, `expected 20 fighters (1 person + 19 bots), got ${g.players.length}`);
  let shots = 0;
  let deaths = 0;
  const byWeapon = new Map<string, number>();
  g.events.on('shot', () => shots++);
  g.events.on('playerDeath', (e) => {
    deaths++;
    if (e.weapon) byWeapon.set(e.weapon, (byWeapon.get(e.weapon) ?? 0) + 1);
  });
  const captures = () => h.find('hud', 'feed').filter((c) => JSON.stringify(c.args[0]).includes(' took ')).length;
  let heroes = 0;
  let cooled = 0;
  let hot = new Map<string, number>();
  const simulated = h.run(150, {
    pilot: () => null,
    until: (hh) => {
      heroes = Math.max(heroes, [...match.fighters.values()].filter((f) => f.hero).length);
      // A blaster's rounds coming back without a reload: it cooled.
      const k = guns.of(hh.ctx)!;
      for (const p of hh.ctx.players) {
        const held = k.held(p);
        if (!held) continue;
        const key = `${p.id}:${held.item}`;
        const was = hot.get(key);
        if (was !== undefined && held.state.mag > was && held.state.reload < 0) cooled++;
        hot.set(key, held.state.mag);
      }
      return false;
    },
  });
  const wall = (performance.now() - t0) / 1000;
  const weapons = [...byWeapon].map(([w, n]) => `${w} ${n}`).join(', ');
  const owners = match.posts.map((p) => `${p.spec.id}:${p.owner ?? '-'}`).join(' ');
  console.log(`  ${simulated.toFixed(0)} s in ${wall.toFixed(1)} s: ${shots} shots, ${deaths} deaths (${weapons}); ${captures()} captures; tickets ${match.tickets.join(' / ')}; posts ${owners}; ${heroes} heroes at once at most; ${cooled} coolings`);
  check(shots > 200, `bots hardly fired (${shots} shots)`);
  check(deaths >= 10, `bots should kill each other (${deaths} deaths)`);
  check(captures() >= 1, 'a post should change hands');
  check(match.tickets[0] < match.mode.tickets && match.tickets[1] < match.mode.tickets, 'tickets should drain');
  check(cooled > 0, 'blasters should cool');

  // After a restart (the match's clock back at 0) the scoreboard still goes out.
  const boards = () => h.find('hud', 'scoreboard').length;
  g.restart();
  const before = boards();
  h.run(3, { pilot: () => null });
  check(boards() > before, 'the scoreboard should go out again after a restart');

  // Heroes vs Villains: three heroes a side, nothing but heroes.
  const hv = launch('blockfront', { seed: 4, radius: 6, cheats: true });
  hv.ctx.commands.run('/mode hvv');
  let hvDeaths = 0;
  hv.ctx.events.on('playerDeath', () => hvDeaths++);
  let allHeroes = true;
  hv.run(60, {
    pilot: () => null,
    until: () => {
      for (const f of match.fighters.values()) if (f.player.alive && !f.hero) allHeroes = false;
      return false;
    },
  });
  console.log(`  Heroes vs Villains: ${hv.ctx.players.length} fighters, ${hvDeaths} deaths in 60 s, tickets ${match.tickets.join(' / ')}`);
  check(hv.ctx.players.length === 6, `expected 6 heroes, got ${hv.ctx.players.length}`);
  check(allHeroes, 'everyone alive should be a hero');
}
