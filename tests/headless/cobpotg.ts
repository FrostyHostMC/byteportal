import { readFileSync } from 'node:fs';
import type { Player } from '../../src/platform';
import { GameHost } from '../../src/platform/host/game';
import { FrameReader } from '../../src/platform/net/delta';
import type { HostEvent, PresentCall, ReplayWire } from '../../src/platform/net/protocol';
import type { SimFrame } from '../../src/platform/sim/sim';
import { match } from '../../src/games/callofblocky/match';
import { SCORES } from '../../src/games/callofblocky/nextvote';
import { POTG_DELAY, POTG_HOLD, type PotgData } from '../../src/games/callofblocky/potg';
import { check, games } from './_harness';

const wasm = readFileSync('engine/pkg/voxel_engine_bg.wasm');
const cob = games.find((g) => g.id === 'callofblocky')!;
const DT = 1 / 30;

/**
 * Call of Blocky's Play of the Game (`potg.ts`), in a public room with two people and bots: Ann
 * gets three in three seconds (a triple, a headshot among them), then much later Bob gets one.
 * Twenty seconds on (long past what the history keeps) the match is won: a moment later both see
 * Ann's triple through her eyes, its first frame held for the title, with its kills timed; the
 * final scores stay down while it plays, and the vote on what's next opens once it's over and the
 * scores have had their moment. A match with no kills has none, and the vote comes as before.
 */
export default function cobpotg() {
  const host = new GameHost(cob, { engine: wasm, seed: 8, remote: true, radius: 4, budget: Infinity, cheats: true });
  const g = host.sim.ctx;
  const got = new Map<string, HostEvent[]>();
  const tick = () => {
    for (const [id, b] of host.step(DT)) {
      got.get(id)?.push(...b.events);
      for (const e of b.events) if (e.t === 'error') throw new Error(`the game threw: ${e.text}`);
    }
  };
  const step = (seconds: number) => {
    for (let t = 0; t < seconds - 1e-9; t += DT) tick();
  };
  const join = (name: string) => {
    const c = host.connect(name);
    got.set(c.id, [...c.batch.events]);
    host.command(c.id, { t: 'start' });
    return c.id;
  };
  const player = (id: string) => g.players.find((p) => p.id === id)!;
  const replays = (id: string) => (got.get(id) ?? []).filter((e): e is Extract<HostEvent, { t: 'replay' }> => e.t === 'replay').map((e) => e.replay);
  const hud = (id: string, method: string) => (got.get(id) ?? []).filter((e): e is { t: 'call'; call: PresentCall } => e.t === 'call' && e.call.target === 'hud' && e.call.method === method).map((e) => e.call);
  const voteUp = (id: string) => hud(id, 'menu').some((c) => (c.args[1] as { title?: string }).title === 'Next match');

  const ann = join('Ann');
  const bob = join('Bob');
  step(1.5);
  check(match.phase === 'playing', 'a match is on');
  // The bots stand still and hold their fire: only these kills count.
  for (const b of g.bots.all) b.freeze(true, { weapons: true });
  for (const id of [ann, bob]) player(id).protect(1e6);
  const annP = player(ann);
  const bobP = player(bob);
  const victims = () => g.players.filter((p) => p.bot && p.alive);
  const kill = (by: Player, headshot = false) => {
    const v = victims()[0];
    check(v, 'a bot alive to kill');
    v.damage(1000, { source: by, weapon: 'rifle', headshot, knockback: 0 });
    check(!v.alive, `${by.name} killed ${v.name}`);
  };
  step(4);
  const first = g.clock.now;
  kill(annP);
  step(1);
  kill(annP, true);
  step(1);
  kill(annP);
  step(9);
  kill(bobP);
  step(20);
  const ago = g.clock.now - first;
  check(ago > 16 + 1, 'the triple is long gone from the history');

  // The match is won: the final scores, then the Play of the Game.
  for (const id of [ann, bob]) got.set(id, []);
  g.commands.run('win');
  step(POTG_DELAY - 0.3);
  check(replays(ann).length === 0, 'not yet');
  step(0.5);
  const wa = replays(ann)[0];
  const wb = replays(bob)[0];
  check(wa && wb && wa.label === 'potg' && wb.label === 'potg', 'both see it');
  check(wa.follow === ann && wb.follow === ann, "through Ann's eyes");
  check(wa.hold === POTG_HOLD, `the title holds its first frame ${wa.hold} s`);
  const data = wa.data as PotgData;
  check(data.name === 'Ann' && data.title === 'TRIPLE FEATURE' && data.chapter === 'CHAPTER THREE' && data.kills.length === 3, `Ann's triple: ${JSON.stringify({ ...data, icon: undefined })}`);
  check(data.kills[1].headshot && !data.kills[0].headshot, 'the headshot in it');
  const span = wa.steps[wa.steps.length - 1].t - wa.steps[0].t;
  check(Math.abs(span - (2 + 3 + 1.5)) < 0.1, `from 3 s before the first kill to 1.5 s after the last: ${span.toFixed(2)} s`);
  check(Math.abs(data.kills[0].t - 3) < 0.1 && Math.abs(data.kills[2].t - 5) < 0.1, `the kills timed in it: ${data.kills.map((k) => k.t.toFixed(2)).join(', ')}`);
  // The frames: Ann there throughout; the bots she killed alive at its start, dead by its end.
  const reader = new FrameReader<SimFrame>();
  const frames = wa.steps.map((s) => reader.read(s.f));
  check(frames.every((f) => f.players.some((p) => p.id === ann && !p.dead)), 'Ann alive all through it');
  const died = new Set(frames.flatMap((f) => f.players.filter((p) => p.bot && p.dead).map((p) => p.id)));
  check(died.size === 3 && [...died].every((id) => frames[0].players.some((p) => p.id === id && !p.dead)), `three alive at its start die in it (${died.size})`);

  // While it plays, the scores stay down and there's no vote; after it, the scores, then the vote.
  const length = POTG_HOLD + span;
  const played = (w: ReplayWire) => (got.get(ann) ?? []).some((e) => e.t === 'replayEnd' && e.id === w.id);
  step(length - 0.5);
  check(!played(wa), 'still playing');
  // (Since it started: the final scores were up a moment before it.)
  const since = (got.get(ann) ?? []).slice((got.get(ann) ?? []).findIndex((e) => e.t === 'replay'));
  const boards = since.filter((e): e is { t: 'call'; call: PresentCall } => e.t === 'call' && e.call.method === 'scoreboard').map((e) => e.call);
  check(boards.length > 0 && boards.every((c) => !(c.args[0] as { show?: boolean }).show), 'no final scores over it');
  check(!voteUp(ann), 'no vote over it');
  step(1);
  check(played(wa), 'over');
  check((hud(ann, 'scoreboard').at(-1)?.args[0] as { show?: boolean }).show, 'the final scores, after');
  step(SCORES - 1);
  check(!voteUp(ann), 'the scores get their moment');
  step(1);
  check(voteUp(ann) && voteUp(bob), 'then the vote');

  // The next match: nobody kills anybody, so there's nothing to show.
  let t = 0;
  while (match.phase !== 'playing' && t < 30) {
    step(1);
    t++;
  }
  check(match.phase === 'playing', 'the next match is on');
  for (const b of g.bots.all) b.freeze(true, { weapons: true });
  step(2);
  for (const id of [ann, bob]) got.set(id, []);
  g.commands.run('win');
  step(POTG_DELAY + 1);
  check(replays(ann).length === 0, 'no play: no Play of the Game');
  step(SCORES - POTG_DELAY);
  check(voteUp(ann), 'the vote as before');
  console.log(`  Ann's triple, made ${ago | 0} s before the end, shown to both: ${span.toFixed(1)} s after a ${POTG_HOLD} s title, ${wa.steps.length} steps; kills at ${data.kills.map((k) => k.t.toFixed(1)).join(' / ')} s`);
  host.dispose();
}
