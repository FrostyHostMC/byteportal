import { readFileSync } from 'node:fs';
import lasertag, { tally } from '../../src/games/lasertag/server';
import { GameHost } from '../../src/platform/host/game';
import type { PlayerInput } from '../../src/platform/net/protocol';
import { check } from './_harness';

const wasm = readFileSync('engine/pkg/voxel_engine_bg.wasm');

/** Controls with a screen that runs the tagger's screen half (it sends the tagger's actions, even none). */
const idle = (viewSeq: number, acts: unknown[][] = []): PlayerInput => ({ active: true, down: [], pressed: [], buttons: 0, clicked: 0, mouseX: 0, mouseY: 0, wheel: 0, yaw: 0, pitch: 0, viewSeq, acts: { tagger: acts } });

/**
 * The item-kit litmus (docs/REDESIGN-ITEMS.md, 4e): Laser Tag's tagger is a kind of item of its
 * own, written only in its folder. A screen's shot is taken if the tagger could have fired it (its
 * rate and energy), tags whoever it meets where they were on that screen, and costs energy; one
 * fired faster, or with none left, is turned down; everyone else hears the beam; a bot fires from
 * its trigger; holding the heavy one slows its holder; a tag-out scores.
 */
export default function lasertagTest() {
  const host = new GameHost(lasertag, { engine: wasm, seed: 1, remote: true, radius: 3, budget: Infinity, player: { id: 'p1', name: 'Ann' } });
  const ann = host.connect('Ann');
  const bob = host.connect('Bob');
  host.command(ann.id, { t: 'start' });
  host.command(bob.id, { t: 'start' });
  const sim = host.sim;
  const A = sim.players.find((p) => p.id === ann.id)!;
  const B = sim.players.find((p) => p.id === bob.id)!;
  const step = (n = 1) => {
    for (let i = 0; i < n; i++) host.step(1 / 30);
  };
  step(3);
  check(A.api.inventory.held?.item === 'zapper' && A.api.inventory.count('lance') === 1, `armed: ${JSON.stringify(A.api.inventory.slots)}`);
  // Ann at one end of the court, Bob ten blocks ahead of her (yaw 0 looks toward -z).
  A.api.teleport({ x: 0.5, y: 64, z: 16.5 }, 0, 0);
  B.api.teleport({ x: 0.5, y: 64, z: 6.5 }, Math.PI, 0);
  step(10);
  const hurt: { amount: number; cause: string | undefined }[] = [];
  sim.ctx.events.on('damage', (e) => {
    if (e.target === B.api) hurt.push({ amount: e.amount, cause: e.cause });
  });
  const heard: unknown[] = [];
  const bobSees = () => host.step(1 / 30).get(bob.id)?.events.filter((e) => e.t === 'call' && e.call.target === 'message' && e.call.method === 'tagger.beam').length ?? 0;
  const shown = () => sim.frame().players.find((p) => p.id === ann.id)!.hand.state as { energy: number; serial: number } | null;

  // A shot from Ann's screen, aimed at Bob's chest: taken, a tag, energy spent; Bob's screen draws the beam.
  const pitch = Math.atan2(1.2 - 1.62, 10);
  host.command(ann.id, { t: 'input', input: { ...idle(A.viewSeq, [[1, 0, pitch]]), pitch, seen: sim.time } });
  heard.push(bobSees());
  check(hurt.length === 1 && hurt[0].amount === 12 && hurt[0].cause === 'tag', `a screen's shot tags (the kit's own cause): ${JSON.stringify(hurt)}`);
  check(heard[0] === 1, `Bob's screen hears the beam (${heard[0]})`);
  const e1 = shown()?.energy ?? 1;
  check(e1 < 0.9 && shown()?.serial === 1, `energy spent, the shot counted: ${JSON.stringify(shown())}`);

  // Faster than its rate (six a second): the next shot the same tick is turned down; an old serial too.
  host.command(ann.id, { t: 'input', input: { ...idle(A.viewSeq, [[2, 0, pitch], [1, 0, pitch]]), pitch, seen: sim.time } });
  step();
  check(hurt.length === 1, `too fast, or a serial already taken: turned down (${hurt.length} tags)`);
  // Out of energy: a burst empties it, and what's asked beyond is turned down (counted by the
  // beams Bob's screen hears: each shot the host takes is one). At its rate each shot costs 0.12
  // and 0.1 comes back: it runs down, then fires only as it recharges.
  let serial = 2;
  let taken = 0;
  for (let i = 0; i < 60; i++) {
    for (let k = 0; k < 6; k++) taken += bobSees();
    host.command(ann.id, { t: 'input', input: { ...idle(A.viewSeq, [[serial++, 0, pitch]]), pitch, seen: sim.time } });
  }
  taken += bobSees();
  check(taken > 5 && taken < serial - 2, `energy runs out: ${taken} of ${serial - 2} shots taken`);
  // Junk actions are turned down (the kit checks its own values).
  const before = shown()?.serial;
  host.command(ann.id, { t: 'input', input: { ...idle(A.viewSeq, [['x', 0, pitch], [serial + 5, 'yaw', 0], [serial + 6]]), pitch, seen: sim.time } });
  step(2);
  check(shown()?.serial === before, `junk actions are turned down (${before} → ${shown()?.serial})`);

  // Holding the lance (heavy) slows its holder, as the kit's `move` says; the zapper doesn't.
  const pace = (slot: number) => {
    host.command(ann.id, { t: 'input', input: { ...idle(A.viewSeq), pressed: [`Digit${slot + 1}`] } });
    step(3);
    A.api.teleport({ x: -15.5, y: 64, z: 16.5 }, -Math.PI / 2, 0);
    step(3);
    const x0 = A.api.position.x;
    for (let i = 0; i < 20; i++) host.command(ann.id, { t: 'input', input: { ...idle(A.viewSeq), down: ['KeyW'], yaw: -Math.PI / 2 } }), step();
    return (A.api.position.x - x0) / (20 / 30);
  };
  const quick = pace(0);
  const heavy = pace(1);
  check(Math.abs(heavy / quick - 0.85) < 0.05, `the lance slows its holder to 0.85: ${heavy.toFixed(2)} vs ${quick.toFixed(2)} b/s`);

  // (Ann's burst tagged Bob out: her point.) A bot (no screen) fires from its trigger, here on the
  // host; enough tags take Ann out, and score.
  const bot = sim.ctx.bots.add('Tagbot');
  step(3);
  bot.teleport({ x: 0.5, y: 64, z: 6.5 }, Math.PI, 0);
  A.api.teleport({ x: 0.5, y: 64, z: 16.5 }, 0, 0);
  // (A bot isn't a player joining: it's armed here.)
  bot.inventory.give('zapper');
  bot.inventory.give('lance');
  bot.inventory.select(1);
  step(3);
  let shots = 0;
  for (let i = 0; i < 40 && A.api.alive; i++) {
    const d = { x: A.api.eye.x - bot.eye.x, y: A.api.eye.y - 0.4 - bot.eye.y, z: A.api.eye.z - bot.eye.z };
    bot.controls.look(Math.atan2(-d.x, -d.z), Math.atan2(d.y, Math.hypot(d.x, d.z)));
    bot.controls.click(0);
    step();
    shots++;
    step(25);
  }
  check(!A.api.alive && tally().get(bot.id) === 1 && tally().get(ann.id) === 1, `the bot's trigger fires on the host, and a tag-out scores (${shots} shots; Ann ${A.api.alive ? 'up' : 'out'}; tally ${JSON.stringify([...tally()])})`);
  console.log(`  a screen's shot: tag 12 ('tag'), energy ${e1.toFixed(2)}; rate and energy hold; the lance ${(heavy / quick).toFixed(2)}× pace; a bot took Ann out in ${shots} lance shots`);
}
