import { readFileSync } from 'node:fs';
import { GameHost } from '../../src/platform/host/game';
import type { HostEvent } from '../../src/platform/net/protocol';
import { course } from '../../src/games/obby/course';
import { check, games } from './_harness';

/**
 * Sky Obby together: each player has their own stage, clock and falls; the others hear when
 * someone reaches a checkpoint or finishes; the finish screen, the best time and the achievements
 * are the finisher's alone; a practice run (the `/stage` cheat) earns none.
 */
export default function obbyMultiplayer() {
  const def = games.find((g) => g.id === 'obby')!;
  const host = new GameHost(def, { engine: readFileSync('engine/pkg/voxel_engine_bg.wasm'), seed: 5, remote: true, radius: 6, budget: Infinity, cheats: true, player: { id: 'p1', name: 'Player' } });
  const game = host.sim.ctx;
  const events = new Map<string, HostEvent[]>();
  const step = (n = 1) => {
    for (let i = 0; i < n; i++) for (const [id, b] of host.step(1 / 30)) events.set(id, [...(events.get(id) ?? []), ...b.events]);
  };
  const calls = (id: string, method: string) => (events.get(id) ?? []).flatMap((e) => (e.t === 'call' && e.call.method === method ? [e.call.args.map(String)] : []));
  const last = (id: string, method: string, key?: string) => calls(id, method).filter((a) => key === undefined || a[0] === key).at(-1);
  const player = (name: string) => game.players.find((p) => p.name === name)!;
  // (Signed in: their best times are kept.)
  const join = (name: string) => {
    const c = host.connect(name, { account: { id: name.toLowerCase(), name, avatar: null } });
    host.command(c.id, { t: 'start' });
    return c.id;
  };

  const ann = join('Ann');
  const bob = join('Bob');
  step(15);
  check(last(ann, 'objective')?.[0] === 'Stage 1/10 · First Steps' && last(bob, 'objective')?.[0] === 'Stage 1/10 · First Steps', 'both start on stage 1');

  // Ann makes it to the second checkpoint; Bob hears about it but stays on stage 1.
  const s2 = course.stages[1];
  player('Ann').teleport(s2.spawn, s2.yaw);
  step(10);
  check(last(ann, 'objective')?.[0] === 'Stage 2/10 · The Climb', `Ann on stage 2: ${last(ann, 'objective')}`);
  check(last(bob, 'objective')?.[0] === 'Stage 1/10 · First Steps', 'Bob still on stage 1');
  check(calls(bob, 'feed').some((a) => a[0] === 'Ann reached stage 2'), 'Bob hears Ann reached stage 2');
  check(last(ann, 'stat', 'time')?.[2] !== '0:00.0' && last(bob, 'stat', 'time')?.[2] === '0:00.0', 'Ann’s clock runs; Bob hasn’t left the island');

  // Ann falls off: back to her checkpoint, one fall; Bob's run is untouched.
  player('Ann').teleport({ x: s2.spawn.x + 3, y: s2.fallY - 1, z: s2.spawn.z });
  step(3);
  const a = player('Ann').position;
  check(Math.hypot(a.x - s2.spawn.x, a.z - s2.spawn.z) < 0.5 && Math.abs(a.y - s2.spawn.y) < 0.5, `Ann back at checkpoint 2: ${JSON.stringify(a)}`);
  check(last(ann, 'stat', 'falls')?.[2] === '1' && last(bob, 'stat', 'falls')?.[2] === '0', 'the fall is Ann’s');

  // Ann reaches the finish: her screen and her best time, a feed line for Bob.
  for (let i = 2; i < course.stages.length; i++) {
    player('Ann').teleport(course.stages[i].spawn, course.stages[i].yaw);
    step(3);
  }
  player('Ann').teleport(course.finish, course.finishYaw);
  step(30 * 4);
  check(calls(ann, 'screen').length === 1 && calls(bob, 'screen').length === 0, 'only Ann sees a finish screen');
  check(calls(bob, 'feed').some((a) => a[0].startsWith('Ann finished in ')), 'Bob hears Ann finished');
  check(typeof player('Ann').store.get('best') === 'number' && player('Bob').store.get('best') === undefined, 'Ann’s best time is kept');
  check(game.store.get<{ name: string }>('board:ann')?.name === 'Ann' && game.store.get('board:bob') === undefined, 'and on the leaderboard');

  // Ann's achievements: past the notable stages, finished, quickly (teleported), but with a fall.
  const earned = ['lava_lake', 'crumble', 'blink', 'spiral', 'crossfire', 'finish', 'speedrun'];
  check(earned.every((id) => player('Ann').achieved(id)) && !player('Ann').achieved('flawless'), `Ann's achievements: ${earned.filter((id) => !player('Ann').achieved(id))} missing`);
  check(!earned.some((id) => player('Bob').achieved(id)), 'Bob has none');
  // Bob practises the lava lake (the /stage cheat) and gets past it: a practice run earns nothing.
  host.command(bob, { t: 'exec', id: 1, line: 'stage 4' });
  step(3);
  player('Bob').teleport(course.stages[4].spawn, course.stages[4].yaw);
  step(3);
  check(last(bob, 'objective')?.[0] === 'Stage 5/10 · Crumble', `Bob past the lava: ${last(bob, 'objective')}`);
  check(!player('Bob').achieved('lava_lake'), 'a practice run earns no achievements');

  // The blinking platforms take turns: a red cell is gone at some point in a cycle.
  const red = course.blinkA[0];
  let gone = false;
  for (let i = 0; i < 30 * 4 && !gone; i++) {
    step(1);
    gone = game.world.getBlock(red.x, red.y, red.z) === game.world.blockId('air');
  }
  check(gone, 'the red platforms blink out');
}
