import type { Entity } from '@platform';
import { addGold } from '../../src/games/arena/run/gold';
import { bus } from '../../src/games/arena/run/bus';
import { state } from '../../src/games/arena/run/state';
import type { CallMsg, GoldMsg, GoreMsg, HitMsg, MeMsg, RunMsg, WaveCard } from '../../src/games/arena/hud/messages';
import { check, launch } from './_harness';

/**
 * Probe: what the Arena's HUD part (`hud/part.ts`) tells the screens over a fight: the run's
 * state as it changes (the countdown, a wave with its monsters left), the announcer, a hit's word
 * to whoever landed it and gore for everyone, gold, a wave's card, the end screen when everyone's
 * down (and its buttons, and the HUD going on after Play again), and how few messages it all takes.
 * `node scripts/headless.mjs tests/headless/_arena-hud.ts`
 */
export default function arenaHud() {
  const h = launch('arena', { seed: 7 });
  const game = h.ctx;
  const me = game.player;
  const msgs = <T>(name: string) => h.find('message', name).map((c) => c.args[0] as T);
  const rows: string[] = [];
  const log = (r: string) => (rows.push(r), console.log(`  ${r}`));

  // My kills, as the bus has them (and how many by the time wave 1 was cleared).
  let kills = 0;
  let killsAtClear = -1;
  bus.on('slain', ({ by }) => void (by === me && kills++));
  bus.on('waveCleared', () => void (killsAtClear < 0 && (killsAtClear = kills)));
  // The countdown (the class pick's), then the first wave.
  h.run(25, { until: () => state.phase === 'fighting' });
  const runs = msgs<RunMsg>('ar.run');
  check(runs.some((r) => r.phase === 'countdown' && r.next > 0 && r.upcoming?.wave === 1), 'the countdown, and the wave it counts down to');
  h.run(3);
  const fighting = msgs<RunMsg>('ar.run').filter((r) => r.phase === 'fighting');
  const first = fighting.at(-1)!;
  check(first.wave === 1 && first.total >= 5 && first.left > 0 && first.name === 'The Dead Rise', `wave 1 on the HUD: ${JSON.stringify(first)}`);
  check(msgs<CallMsg>('ar.call').some((c) => c.k === 'wave' && c.t === 'Wave 1'), 'the announcer calls wave 1');
  log(`countdown and wave 1: ${first.left} of ${first.total} left`);

  // A heavy hit, and a kill: the hit's word to me (heavy, then a kill), gore for everyone.
  const z = game.entities.all('zombie')[0] as Entity;
  z.damage(12, { source: me });
  z.damage(99, { source: me });
  h.run(0.1);
  const hits = msgs<HitMsg>('ar.hit');
  check(hits.length === 2 && hits[0].e === z.id && hits[0].h >= 0.45 && !hits[0].k && hits[1].k === 1, `hits: ${JSON.stringify(hits)}`);
  const gore = msgs<GoreMsg>('ar.gore');
  check(gore.length === 1 && gore[0].c === '#6b8f3a' && gore[0].s > 1, `gore in the zombie's green: ${JSON.stringify(gore)}`);
  check(h.find('message', 'ar.gore')[0].to === null && h.find('message', 'ar.hit')[0].to === me.id, 'gore for all, hits to who landed them');
  log(`a heavy hit (${hits[0].h}) and a kill; gore ${gore[0].c}`);

  // Gold: popped where it's picked up, and the purse.
  addGold(game, me, 25, me.position);
  h.run(0.3);
  const pop = msgs<GoldMsg>('ar.gold').at(-1);
  check(pop?.d === 25 && Array.isArray(pop.at), `gold pops: ${JSON.stringify(pop)}`);
  check(msgs<MeMsg>('ar.me').at(-1)?.gold === 25, 'the purse says 25');

  // The rest of the wave goes down: a card with my part in it, and the run between waves.
  const before = h.calls.length;
  const t0 = h.time;
  h.run(30, {
    until: () => {
      for (const e of game.entities.all()) e.damage(99, { source: me });
      return msgs<WaveCard>('ar.wave').length > 0;
    },
  });
  const card = msgs<WaveCard>('ar.wave')[0];
  check(card?.wave === 1 && card.kills === killsAtClear && card.kills >= 4 && card.gold >= 25 && card.next?.wave === 2 && card.mvp === null, `the card: ${JSON.stringify(card)}`);
  log(`wave 1 cleared: ${card.kills} kills, ${card.gold} gold, ${card.damage} damage in ${card.time} s`);
  const busy = h.calls.slice(before).filter((c) => c.target === 'message').length / Math.max(1, h.time - t0);
  h.run(2);
  const between = msgs<RunMsg>('ar.run').at(-1)!;
  check(between.phase === 'intermission' && between.upcoming?.wave === 2 && between.next > 0, `between waves: ${JSON.stringify(between)}`);

  // A quiet stretch sends almost nothing: the countdown's seconds, the crowd now and then.
  const quiet0 = h.calls.length;
  h.run(5);
  const quiet = h.calls.slice(quiet0).filter((c) => c.target === 'message').length / 5;
  check(quiet <= 3, `messages a second between waves: ${quiet} (${h.calls.slice(quiet0).filter((c) => c.target === 'message').map((c) => c.method).join(' ')})`);
  log(`messages a second: ${busy.toFixed(1)} killing a wave down, ${quiet.toFixed(1)} between waves`);

  // Everyone's down: the end screen, its numbers mine, and Play again starts afresh.
  h.run(20, { until: () => state.phase === 'fighting' });
  me.damage(1000);
  h.run(3.5);
  check(msgs<{ won: boolean }>('ar.end').at(-1)?.won === false, 'the end, lost');
  const end = h.find('hud', 'widget').find((c) => c.args[0] === 'arena-end')?.args[1] as { word: string; kills: string; waves: string[]; headline: string } | undefined;
  check(end?.word === 'Defeated' && Number(end.kills) === kills && msgs<HitMsg>('ar.hit').filter((x) => x.k).length === kills && end.waves[1] === 'lost' && end.waves[0] === 'won', `the end screen (${kills} kills of mine): ${JSON.stringify(end)?.slice(0, 300)}`);
  log(`end screen: ${end.word}, "${end.headline}", track ${end.waves.join(' ')}`);
  h.send({ t: 'widgetAction', player: me.id, widget: 'arena-end', action: 'again', value: '' });
  h.run(2);
  check(state.phase === 'countdown' && state.wave === 0, `play again: ${state.phase}, wave ${state.wave}`);
  // (The clock starts again with the fight: what each screen's told keeps coming.)
  const before2 = msgs<MeMsg>('ar.me').length;
  addGold(game, me, 7);
  h.run(0.5);
  check(msgs<MeMsg>('ar.me').at(-1)?.gold === 7 && msgs<MeMsg>('ar.me').length > before2, 'the purse after Play again');
  log('Play again: a fresh countdown, the HUD still told');
  return rows.join(' · ');
}
