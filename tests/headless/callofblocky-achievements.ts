import type { Player } from '../../src/platform/api/types';
import type { Headless } from '../../src/platform/host/headless';
import { match } from '../../src/games/callofblocky/match';
import { FFA_LIMIT } from '../../src/games/callofblocky/modes';
import { xpForLevel } from '../../src/games/callofblocky/progression';
import { check, launch } from './_harness';

/**
 * Call of Blocky's achievements (meta.ts), awarded on the server as they're earned in play: the
 * first kill, a headshot through a wall, a triple kill, a killstreak's kill, level 10 (not by the
 * `xp` cheat), the briefcase, a free-for-all won and played out (not by the `win` cheat), going
 * overboard on Hijacked, and a case planted that goes off.
 */
export default function cobAchievements() {
  kills();
  cheatsAndSea();
  delivery();
}

/** Kill `victim` as `by`, up close (spawn protection off), and step once. */
function kill(h: Headless, by: Player, victim: Player, opts: { weapon: string; headshot?: boolean; through?: number; cause?: 'gun' | 'explosion' }) {
  if (!victim.alive) victim.revive();
  victim.teleport({ x: by.position.x + 4, y: by.position.y, z: by.position.z });
  victim.protect(0);
  victim.damage(1000, { source: by, weapon: opts.weapon, headshot: opts.headshot, through: opts.through, cause: opts.cause ?? 'gun', knockback: 0 });
  check(!victim.alive, `${victim.name} killed by ${by.name} (${opts.weapon})`);
  h.run(1 / 30);
}

function kills() {
  const h = launch('callofblocky', { seed: 9, radius: 5 });
  const g = h.ctx;
  const me = g.player;
  const has = (id: string) => me.achieved(id);
  const bot = () => g.players.find((p) => p.bot && p.alive) ?? g.bots.all[0];
  h.run(2);
  me.protect(600);
  check(!has('made_your_bones'), 'nothing earned yet');

  // A headshot through a wall: the first kill, and Knock Knock.
  kill(h, me, bot(), { weapon: 'rifle', headshot: true, through: 1 });
  check(has('made_your_bones') && has('knock_knock'), 'the first kill, a headshot through a wall');
  // Two more right after: a double kill isn't it; the third is.
  kill(h, me, bot(), { weapon: 'rifle' });
  check(!has('triple_feature'), 'a double kill is not a triple');
  kill(h, me, bot(), { weapon: 'rifle' });
  check(has('triple_feature'), 'three kills in four seconds: Triple Feature');
  check(!has('death_from_above'), 'no streak kill yet');
  kill(h, me, bot(), { weapon: 'hellstorm', cause: 'explosion' });
  check(has('death_from_above'), 'a Hellstorm kill: Death from Above');

  // Level 10 by the `xp` cheat earns nothing; the next XP earned in play does.
  g.commands.run(`xp ${xpForLevel(10) + 100}`);
  check(!has('made_man'), 'level 10 by a cheat is not Made Man');
  kill(h, me, bot(), { weapon: 'rifle' });
  check(has('made_man'), 'a kill at level 10: Made Man');

  // The briefcase.
  check(!has('whats_in_the_case'), 'no case yet');
  g.items.spawnPickup('briefcase', me.position, { despawn: 40 });
  h.run(1.2);
  check(has('whats_in_the_case'), "grabbing the briefcase: What's in the Case?");

  // Twenty-five kills: the free-for-all won, and played out.
  check(!has('on_the_payroll') && !has('top_billing'), 'no match finished yet');
  for (let i = 0; i < FFA_LIMIT && match.phase === 'playing'; i++) kill(h, me, bot(), { weapon: 'rifle' });
  check(match.phase === 'over', 'the free-for-all is over');
  check(has('on_the_payroll') && has('top_billing'), 'the free-for-all won: On the Payroll and Top Billing');
  check(!has('sleeps_with_the_fishes') && !has('special_delivery'), 'nothing earned that was not done');
  check(g.bots.all.every((b) => !b.achieved('made_your_bones')), 'bots earn nothing');
  console.log(`  kills: first, through a wall, a triple, a Hellstorm's, level 10, the briefcase, a free-for-all won`);
}

function cheatsAndSea() {
  const h = launch('callofblocky', { seed: 10, radius: 5 });
  const g = h.ctx;
  const me = g.player;
  h.run(2);
  // The `win` cheat ends the match, but earns nothing.
  g.commands.run('win');
  check(match.phase === 'over', 'the win cheat ends the match');
  check(!me.achieved('on_the_payroll') && !me.achieved('top_billing'), 'the win cheat earns no achievements');
  // Overboard on Hijacked.
  g.commands.run('mode ffa hijacked');
  h.run(1);
  // (A restart: the match's phase isn't what it was before it.)
  check(match.map.id === 'hijacked' && (match.phase as string) === 'playing' && match.map.sea !== undefined, `a free-for-all on Hijacked (${match.map.id})`);
  check(!me.achieved('sleeps_with_the_fishes'), 'still aboard');
  me.teleport({ x: me.position.x, y: match.map.sea - 2, z: me.position.z });
  h.run(0.1);
  check(me.achieved('sleeps_with_the_fishes'), 'overboard: Sleeps with the Fishes');
  console.log('  the win cheat earns nothing; overboard on Hijacked');
}

/** The person at the keyboard plants the case at A and nobody cracks it (as cobmodes.ts's plantAndBlow). */
function delivery() {
  const h = launch('callofblocky', { seed: 8, radius: 5 });
  const g = h.ctx;
  const me = g.player;
  g.commands.run('mode case kahuna');
  h.run(0.2);
  check(match.fighters.get(me.id)?.team === 0, 'the one person attacks first');
  h.run(6);
  for (const b of g.bots.all) b.freeze(true, { weapons: true });
  check(g.commands.run('case') === 'you have the case', 'the case cheat hands it over');
  const site = match.map.bomb.sites[0];
  me.teleport({ x: site.at.x, y: site.at.y + 0.05, z: site.at.z });
  h.run(0.5);
  h.run(4, { pilot: () => ({ down: ['KeyF'] }) });
  check(!me.achieved('special_delivery'), 'planted, not gone off yet');
  h.run(37);
  check(match.score[0] === 1, `the attackers take the round (${match.score.join(' to ')})`);
  check(me.achieved('special_delivery'), 'the case went off: Special Delivery');
  console.log('  the case planted and gone off: Special Delivery');
}
