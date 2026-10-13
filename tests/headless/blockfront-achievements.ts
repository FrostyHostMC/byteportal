import type { Player } from '../../src/platform/api/types';
import type { Headless } from '../../src/platform/host/headless';
import { INTRO_HOLD } from '../../src/games/blockfront/cinema';
import { HEROES, HERO_IDS, type HeroId } from '../../src/games/blockfront/heroes/defs';
import { FORCE } from '../../src/games/blockfront/heroes/powers';
import { DEFLECTED } from '../../src/games/blockfront/heroes/rules';
import { match } from '../../src/games/blockfront/match';
import { other, type Team } from '../../src/games/blockfront/teams';
import { check, launch } from './_harness';

/**
 * Blockfront II's achievements (meta.ts), awarded on the server as they're earned in play: the
 * first kill, a hero taken down by a trooper, a hero paid for with battle points (not the `hero`
 * cheat's), kills with a saber, the Force and a bolt turned back, 100 kills all time, a command
 * post captured, and a match won and played out (not by the `win` cheat).
 */
export default function blockfrontAchievements() {
  conquest();
  winCheat();
}

/** Kill `victim` as `by`, up close (spawn protection off), and step once. */
function kill(h: Headless, by: Player, victim: Player, weapon: string, cause: 'gun' | 'melee' | 'explosion' = 'gun') {
  if (!victim.alive) victim.revive();
  victim.teleport({ x: by.position.x + 3, y: by.position.y, z: by.position.z });
  victim.protect(0);
  victim.damage(100000, { source: by, weapon, cause, knockback: 0 });
  check(!victim.alive, `${victim.name} killed by ${by.name} (${weapon})`);
  h.run(1 / 30);
}

function conquest() {
  const h = launch('blockfront', { seed: 3, radius: 6 });
  const g = h.ctx;
  const me = g.player;
  const has = (id: string) => me.achieved(id);
  // Past the opening fly-over; three a side.
  h.run(INTRO_HOLD + 0.1);
  g.commands.run('/bots 3');
  h.run(0.2);
  const mine = match.fighters.get(me.id)!;
  const side: Team = mine.team;
  const enemy = () => g.players.find((p) => p.bot && p.alive && match.fighters.get(p.id)?.team === other(side) && !match.fighters.get(p.id)?.hero) ?? g.players.find((p) => p.bot && match.fighters.get(p.id)?.team === other(side))!;
  const heroOf = (t: Team): HeroId => HERO_IDS.find((id) => HEROES[id].team === t && HEROES[id].weapon === `saber_${id}` && ![...match.fighters.values()].some((f) => f.hero === id))!;
  me.protect(600);

  // A trooper's first kill.
  check(!has('dont_get_cocky'), 'nothing earned yet');
  kill(h, me, enemy(), me.inventory.held!.item);
  check(has('dont_get_cocky'), "the first kill: Don't Get Cocky");
  check(!has('giant_killer') && !has('elegant_weapon'), 'a trooper downing a trooper is nothing more');

  // An enemy bot pays for a hero (it respawns as one); a trooper takes it down.
  const b = enemy();
  const bf = match.fighters.get(b.id)!;
  bf.bp = 5000;
  bf.wantHero = heroOf(bf.team);
  b.protect(0);
  b.damage(100000, { source: 'world' });
  h.run(5.5);
  check(bf.hero && b.alive, `the bot came back as a hero (${bf.hero})`);
  kill(h, me, b, 'detonator', 'explosion');
  check(has('giant_killer'), 'a trooper took down a hero: Giant Killer');

  // The `hero` cheat earns no Chosen One.
  const mineHero = heroOf(side);
  g.commands.run(`/hero ${mineHero}`);
  check(mine.hero === mineHero && !has('chosen_one'), `the hero cheat (${mine.hero}) is not Chosen One`);
  // A hero's kills: the saber, the Force, a bolt turned back.
  kill(h, me, enemy(), HEROES[mineHero].weapon, 'melee');
  check(has('elegant_weapon'), 'a saber kill: An Elegant Weapon');
  check(!has('use_the_force'), 'a saber is not the Force');
  kill(h, me, enemy(), FORCE.push, 'melee');
  check(has('use_the_force'), 'a Force Push kill: Use the Force');
  check(!has('return_to_sender'), 'no bolt turned back yet');
  kill(h, me, enemy(), DEFLECTED);
  check(has('return_to_sender'), 'a bolt turned back: Return to Sender');

  // Battle points spent on a hero, spawning as them.
  me.protect(0);
  me.damage(100000, { source: 'world' });
  mine.bp = 5000;
  mine.wantHero = heroOf(side);
  h.run(5.5);
  me.protect(600);
  check(me.alive && mine.hero && mine.bp === 5000 - HEROES[mine.hero].cost, `back as a hero, paid for (${mine.hero}, ${mine.bp} BP)`);
  check(has('chosen_one'), 'a hero paid for: Chosen One');

  // A hundred kills, all time (what's kept, and this match's).
  check(!has('galactic_veteran'), 'not a hundred yet');
  me.store.set('stats', { games: 3, wins: 1, kills: 99 - mine.kills, deaths: 0, heroes: 0 });
  kill(h, me, enemy(), HEROES[mine.hero!].weapon, 'melee');
  check(has('galactic_veteran'), 'the hundredth kill: Galactic Veteran');

  // A command post taken (everyone else held still at their side's base).
  for (const p of g.bots.all) {
    const base = match.posts.find((q) => q.spec.locked && q.owner === match.fighters.get(p.id)?.team)!.spec.spawns[0];
    p.teleport({ x: base.x, y: base.y + 0.05, z: base.z });
    p.freeze(true, { weapons: true });
  }
  const post = match.posts.find((p) => !p.spec.locked && p.owner !== side)!;
  check(post, 'a post to take');
  const at = post.spec.at;
  me.teleport({ x: at.x, y: at.y + 0.05, z: at.z });
  check(!has('high_ground'), 'no post taken yet');
  h.run(30, { until: () => has('high_ground') });
  check(post.owner === side && has('high_ground'), `post ${post.spec.id} taken: The High Ground (owner ${post.owner})`);

  // The other side down to its last ticket, and one more kill: the match won, and played out.
  check(!has('reporting_for_duty') && !has('medal_ceremony'), 'no match finished yet');
  match.tickets[other(side)] = 1;
  kill(h, me, enemy(), HEROES[mine.hero!].weapon, 'melee');
  h.run(0.2);
  check(match.phase === 'over', 'the match is over');
  check(has('reporting_for_duty') && has('medal_ceremony'), 'the match won: Reporting for Duty and Medal Ceremony');
  check(g.bots.all.every((p) => !p.achieved('dont_get_cocky')), 'bots earn nothing');
  console.log(`  a first kill, a hero downed, sabers, the Force, a bolt turned back, a hero paid for, a hundred kills, post ${post.spec.id} taken, a match won`);
}

function winCheat() {
  const h = launch('blockfront', { seed: 4, radius: 6 });
  const g = h.ctx;
  h.run(INTRO_HOLD + 0.1);
  g.commands.run('/win');
  check(match.phase === 'over', 'the win cheat ends the match');
  check(!g.player.achieved('reporting_for_duty') && !g.player.achieved('medal_ceremony'), 'the win cheat earns no achievements');
  console.log('  the win cheat earns nothing');
}
