import type { Headless } from '../../src/platform/host/headless';
import { match } from '../../src/games/callofblocky/match';
import { KAHUNA } from '../../src/games/callofblocky/maps/kahuna';
import { ROUNDS, TDM_LIMIT, TEAMS } from '../../src/games/callofblocky/modes';
import { SCORES, VOTING } from '../../src/games/callofblocky/nextvote';
import { OUTFITS } from '../../src/games/callofblocky/art';
import { check, launch } from './_harness';

/** What's on now (read afresh: a match moves on under the test). */
const now = () => ({ mode: match.mode.id as string, map: match.map.id as string });

/**
 * Call of Blocky's modes and maps, with bots playing them: a whole Team Deathmatch (sides of
 * four in their colours and outfits, nobody hurting their own side), a whole match of The
 * Briefcase (the case planted, and cracked or gone off; the sides swapping), a person planting the
 * case (holding F at a site) and it going off, a public room moving on to the next match of its
 * rotation (Team Deathmatch at Big Kahuna Burger, fought there), and a room of one's own picking
 * its mode and map from the menu.
 */
export default function cobmodes() {
  teamDeathmatch();
  briefcase();
  plantAndBlow();
  rotation();
  ownRoom();
}

/** The feed's lines so far, as text. */
function feed(h: Headless): string[] {
  return h.find('hud', 'feed').map((c) => {
    const parts = c.args[0];
    return Array.isArray(parts) ? parts.map((p) => (typeof p === 'string' ? p : ((p as { text?: string }).text ?? ''))).join('') : String(parts);
  });
}

export function teamDeathmatch() {
  const t0 = performance.now();
  const h = launch('callofblocky', { seed: 4, radius: 5 });
  const g = h.ctx;
  g.commands.run('mode tdm jackrabbit');
  h.run(0.2);
  check(match.mode.id === 'tdm' && match.map.id === 'jackrabbit', `expected Team Deathmatch on Jackrabbit Lane, got ${match.mode.id} on ${match.map.id}`);
  check(g.players.length === 8, `expected four a side (8 fighters), got ${g.players.length}`);
  const sides = [0, 1].map((t) => [...match.fighters.values()].filter((f) => f.team === t));
  check(sides[0].length === 4 && sides[1].length === 4, `sides of ${sides[0].length} and ${sides[1].length}`);
  for (const [t, side] of sides.entries()) {
    for (const f of side) {
      check(f.player.color === TEAMS[t].color, `${f.player.name} wears their side's colour over their head (${f.player.color})`);
      check(TEAMS[t].outfits.includes(f.outfit), `${f.player.name} dresses like ${TEAMS[t].name} (${OUTFITS[f.outfit].name})`);
    }
  }
  let kills = 0;
  let friendly = 0;
  g.events.on('playerDeath', (e) => {
    const by = e.source;
    if (!by || by === 'world' || by.kind !== 'player' || by === e.player) return;
    kills++;
    if (match.fighters.get(by.id)?.team === match.fighters.get(e.player.id)?.team) friendly++;
  });
  const simulated = h.run(600, { until: () => match.phase === 'over' });
  const wall = (performance.now() - t0) / 1000;
  console.log(`  Team Deathmatch: ${simulated.toFixed(0)} s in ${wall.toFixed(1)} s: ${TEAMS[0].short} ${match.score[0]} · ${TEAMS[1].short} ${match.score[1]}, ${kills} kills, ${friendly} of them on their own side`);
  check(match.phase === 'over', 'the match should end');
  check(Math.max(...match.score) >= TDM_LIMIT, `a side should reach ${TDM_LIMIT} (${match.score.join(' to ')})`);
  check(friendly === 0, `nobody kills their own side (${friendly})`);
  const banners = h.find('hud', 'banner').map((c) => String(c.args[0]));
  check(banners.includes('VICTORY') || banners.includes('DEFEAT'), `the end is a victory or a defeat: ${banners.slice(-3).join(', ')}`);
}

export function briefcase(map = 'jackrabbit', seed = 5) {
  const t0 = performance.now();
  const h = launch('callofblocky', { seed, radius: 5 });
  const g = h.ctx;
  g.commands.run(`mode case ${map}`);
  h.run(0.2);
  check(match.mode.id === 'case', `expected The Briefcase, got ${match.mode.id}`);
  let deaths = 0;
  let maxDeathsInRound = 0;
  let roundDeaths = 0;
  let rounds = 0;
  g.events.on('playerDeath', () => {
    deaths++;
    roundDeaths++;
    maxDeathsInRound = Math.max(maxDeathsInRound, roundDeaths);
  });
  let seen = 0;
  const simulated = h.run(20 * 60, {
    until: (hh) => {
      // The person at the keyboard is away: they go down as each round starts (dropping the case
      // if it's theirs), so the bots play it out.
      const me = hh.ctx.player;
      if (me.alive && !me.frozen) me.damage(1000, { source: 'world' });
      for (; seen < hh.calls.length; seen++) {
        const c = hh.calls[seen];
        if (c.target === 'hud' && c.method === 'feed' && JSON.stringify(c.args[0]).includes(' take round ')) {
          rounds++;
          roundDeaths = 0;
        }
      }
      return match.phase === 'over';
    },
  });
  const wall = (performance.now() - t0) / 1000;
  const lines = feed(h);
  const count = (s: string) => lines.filter((l) => l.includes(s) && !l.includes(' take round ')).length;
  const planted = count('planted the case');
  const cracked = count('cracked the case');
  const boomed = lines.filter((l) => l.includes('the case went off')).length;
  const dropped = count('dropped the case');
  const picked = count('picked up the case');
  const banners = h.find('hud', 'banner').map((c) => String(c.args[0]));
  const swapped = banners.includes('SWITCHING SIDES');
  console.log(
    `  The Briefcase at ${match.map.name}: ${simulated.toFixed(0)} s in ${wall.toFixed(1)} s: ${rounds} rounds, ${TEAMS[0].short} ${match.score[0]} · ${TEAMS[1].short} ${match.score[1]}; planted ${planted}×, cracked ${cracked}×, went off ${boomed}×, dropped ${dropped}× (picked up ${picked}×), ${deaths} deaths (at most ${maxDeathsInRound} a round)`,
  );
  for (const l of lines.filter((l) => l.includes(' take round '))) console.log(`    ${l}`);
  check(match.phase === 'over', 'the match should end');
  check(Math.max(...match.score) === ROUNDS, `a side should take ${ROUNDS} rounds (${match.score.join(' to ')})`);
  check(rounds >= ROUNDS, `at least ${ROUNDS} rounds (${rounds})`);
  check(swapped, 'the sides swap at the half');
  // Bots win many rounds by clearing the other side before a plant (as the mode allows), so a plant
  // isn't certain in a bot match: plantAndBlow() plants one for sure. The case must see play,
  // though (carried, dropped, picked up or planted), and a round with a plant ends one of three
  // ways: cracked, gone off, or every defender down (the attackers win then; the case isn't waited on).
  check(planted + dropped + picked >= 1, `the case should see play (planted ${planted}, dropped ${dropped}, picked up ${picked})`);
  let plantedRound = false;
  for (const l of lines) {
    if (l.includes('planted the case')) plantedRound = true;
    else if (l.includes(' take round ')) {
      const ends = ['cracked the case', 'the case went off', 'no one left to stop them'];
      check(!plantedRound || ends.some((e) => l.includes(e)), `a round with a plant ends cracked, gone off or with the defenders down: ${l}`);
      plantedRound = false;
    }
  }
  check(maxDeathsInRound <= 8, `one life a round (${maxDeathsInRound} deaths in a round)`);
}

/** The person at the keyboard takes the case to A, holds F there, and nobody cracks it. */
export function plantAndBlow() {
  const h = launch('callofblocky', { seed: 8, radius: 5 });
  const g = h.ctx;
  g.commands.run('mode case kahuna');
  h.run(0.2);
  const me = match.fighters.get(g.player.id)!;
  check(me.team === 0, `the one person is on the side attacking first (${me.team})`);
  h.run(6);
  // The bots stand still (they'd crack it), and the case is ours.
  for (const b of g.bots.all) b.freeze(true, { weapons: true });
  check(g.commands.run('case') === 'you have the case', 'the case cheat hands it over');
  const site = match.map.bomb.sites[0];
  g.player.teleport({ x: site.at.x, y: site.at.y + 0.05, z: site.at.z });
  h.run(0.5);
  const lines = () => feed(h);
  h.run(1, { pilot: () => ({ down: ['KeyF'] }) });
  check(!lines().some((l) => l.includes('planted the case')), 'planting takes a few seconds');
  h.run(3, { pilot: () => ({ down: ['KeyF'] }) });
  check(lines().some((l) => l.includes('planted the case at A')), `holding F at A plants it: ${lines().slice(-3).join(' | ')}`);
  const deaths: string[] = [];
  g.events.on('playerDeath', (e) => deaths.push(e.player.name));
  h.run(37);
  check(lines().some((l) => l.includes('the case went off at A')), `the fuse runs out: ${lines().slice(-3).join(' | ')}`);
  check(match.score[0] === 1 && match.score[1] === 0, `the attackers take the round (${match.score.join(' to ')})`);
  const banners = h.find('hud', 'banner').map((c) => String(c.args[0]));
  check(banners.includes('ROUND WON'), 'the planter hears they won the round');
  console.log(`  a person plants the case at ${site.label} and it goes off: ${deaths.length ? `it took ${deaths.join(', ')} with it` : 'nobody near it'}`);
}

export function rotation() {
  const t0 = performance.now();
  const h = launch('callofblocky', { seed: 6, radius: 5 });
  const g = h.ctx;
  check(match.mode.id === 'ffa' && match.map.id === 'jackrabbit', 'a public room starts with a free-for-all on Jackrabbit Lane');
  h.run(2);
  g.commands.run('win');
  check(match.phase === 'over', 'the match is over');
  const t1 = performance.now();
  // (The final scores, then the vote on what's next: nobody votes, so it's the rotation's next.)
  h.run(SCORES + VOTING + 1, { until: () => match.phase === 'playing' });
  h.run(0.5);
  const moved = (performance.now() - t1) / 1000;
  check(now().mode === 'tdm' && now().map === 'kahuna', `next up: Team Deathmatch at Big Kahuna Burger (got ${now().mode} on ${now().map})`);
  const b = KAHUNA.bounds;
  const inside = g.players.filter((p) => p.position.x >= b.min.x && p.position.x <= b.max.x && p.position.z >= b.min.z && p.position.z <= b.max.z);
  check(inside.length === g.players.length, `everyone's at Big Kahuna Burger (${inside.length} of ${g.players.length})`);
  check(g.world.spawn.x === KAHUNA.home.x, `newcomers (and the home page) go there too (${JSON.stringify(g.world.spawn)})`);
  let shots = 0;
  let deaths = 0;
  g.events.on('shot', () => shots++);
  g.events.on('playerDeath', () => deaths++);
  const visited = new Set<string>();
  const t2 = performance.now();
  h.run(60, {
    until: (hh) => {
      for (const p of hh.ctx.players) if (p.bot) visited.add(`${Math.floor(p.position.x / 4)},${Math.floor(p.position.z / 4)}`);
      return false;
    },
  });
  const wall = (performance.now() - t0) / 1000;
  console.log(`  rotation: to Big Kahuna Burger in ${moved.toFixed(1)} s (its world and walking grid), then 60 s in ${((performance.now() - t2) / 1000).toFixed(1)} s: ${shots} shots, ${deaths} deaths, bots visited ${visited.size} 4x4 cells (${wall.toFixed(1)} s in all)`);
  check(shots > 40, `bots fight at Big Kahuna Burger (${shots} shots)`);
  check(deaths >= 3, `bots kill each other there (${deaths} deaths)`);
  check(visited.size > 20, `bots roam Big Kahuna Burger (${visited.size} cells)`);
}

export function ownRoom() {
  const h = launch('callofblocky', { seed: 7, radius: 5, room: 'k3x9f2' });
  const g = h.ctx;
  check(g.room === 'k3x9f2', `the room knows it's someone's own (${g.room})`);
  h.run(0.5);
  type Entry = { label: string; onSelect?: { $cb: number } };
  type Menu = { title: string; sections: { title?: string; entries: Entry[] }[] };
  const latest = (): Menu | undefined => {
    const calls = h.calls.filter((c) => c.target === 'hud' && (c.method === 'menu' || c.method === 'menuUpdate'));
    const last = calls.at(-1);
    return last ? (last.args[1] as Menu) : undefined;
  };
  const choose = (label: string) => {
    const m = latest();
    const e = m?.sections.flatMap((s) => s.entries).find((x) => x.label === label);
    check(e?.onSelect, `the menu has "${label}" (${JSON.stringify(m?.sections.map((s) => s.entries.map((x) => x.label)))})`);
    h.send({ t: 'callback', player: g.player.id, id: e.onSelect.$cb });
    h.run(0.1);
  };
  check(h.calls.some((c) => c.method === 'menu' && (c.args[1] as Menu).title === 'Your game'), 'the first one in is asked what to play');
  choose('The Briefcase');
  choose('Big Kahuna Burger');
  choose('Start the match');
  h.run(1);
  check(now().mode === 'case' && now().map === 'kahuna', `their pick is on (${now().mode} on ${now().map})`);
  check(g.player.position.x > KAHUNA.bounds.min.x, 'and they are at Big Kahuna Burger');
  console.log(`  a room of one's own: picked The Briefcase at Big Kahuna Burger from its menu`);
}
