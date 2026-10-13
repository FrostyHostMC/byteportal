import { readFileSync } from 'node:fs';
import { GameHost } from '../../src/platform/host/game';
import { IDLE_INPUT, type HostEvent, type PlayerInput, type PresentCall } from '../../src/platform/net/protocol';
import { padHints } from '../../src/platform/player/gamepad';
import { INTRO_HOLD } from '../../src/games/blockfront/cinema';
import { match } from '../../src/games/blockfront/match';
import { ROTATION } from '../../src/games/blockfront/modes';
import { check, games } from './_harness';

const wasm = readFileSync('engine/pkg/voxel_engine_bg.wasm');
const bf = games.find((g) => g.id === 'blockfront')!;

const now = () => `${match.mode.id} ${match.map.id}`;
const phase = (): string => match.phase;
const planned = (i: number) => `${ROTATION[i].mode} ${ROTATION[i].map}`;

/**
 * Blockfront II's vote to skip (the platform's `skipVote` kit, on N: V is the camera's), in a
 * public room with two people and bots: it opens once the fly-over's done and a moment's gone;
 * bots don't vote or count; one of two doesn't skip; two of two do (one of them dead, one by
 * `/skip`), with a SKIPPED banner and no end screen, and a few seconds later the rotation's next
 * is on; the deploy menu offers the vote too.
 */
export default function bfskip() {
  check(bf.controls?.some(([k, v]) => k === 'N' && v.includes('skip')), `N is in the controls: ${JSON.stringify(bf.controls)}`);
  const hints = padHints(bf, true, { jump: 'Space', crouch: 'KeyC', sprint: 'ShiftLeft' });
  check(hints.some(([b, v]) => b === 'Y' && v === 'vote to skip'), `the controller's hint: ${JSON.stringify(hints)}`);

  const host = new GameHost(bf, { engine: wasm, seed: 3, remote: true, radius: 4, budget: Infinity });
  const g = host.sim.ctx;
  const got = new Map<string, PresentCall[]>();
  const keep = (id: string, events: HostEvent[]) => {
    for (const e of events) {
      if (e.t === 'call') got.get(id)?.push(e.call);
      if (e.t === 'error') throw new Error(`the game threw: ${e.text}`);
    }
  };
  const tick = () => {
    for (const [id, b] of host.step(1 / 30)) keep(id, b.events);
  };
  const step = (seconds: number) => {
    for (let t = 0; t < seconds - 1e-9; t += 1 / 30) tick();
  };
  const stepUntil = (done: () => boolean, most: number) => {
    for (let t = 0; t < most && !done(); t += 1 / 30) tick();
  };
  const join = (name: string) => {
    const c = host.connect(name);
    got.set(c.id, []);
    keep(c.id, c.batch.events);
    host.command(c.id, { t: 'start' });
    return c.id;
  };
  /** They press N (and let go), their controls as given. */
  const press = (id: string, as: Partial<PlayerInput> = { active: true }) => {
    host.command(id, { t: 'input', input: { ...IDLE_INPUT, ...as, pressed: ['KeyN'], down: ['KeyN'] } });
    tick();
    host.command(id, { t: 'input', input: { ...IDLE_INPUT, ...as } });
    tick();
  };
  let n = 1;
  const exec = (id: string, line: string) => {
    host.command(id, { t: 'exec', id: n++, line });
    tick();
  };
  const calls = (id: string, method: string) => (got.get(id) ?? []).filter((c) => c.target === 'hud' && c.method === method);
  const text = (parts: unknown) => (Array.isArray(parts) ? parts.map((p) => (typeof p === 'string' ? p : ((p as { text?: string }).text ?? ''))).join('') : String(parts));
  const votes = (id: string) => calls(id, 'feed').map((c) => text(c.args[0])).filter((l) => l.includes('vote'));
  const lastVote = (id: string) => votes(id).at(-1) ?? '';
  const toasts = (id: string) => calls(id, 'toast').map((c) => String(c.args[0]));
  const banners = (id: string) => calls(id, 'banner').map((c) => String(c.args[0]));
  const card = (id: string): { votes?: number; need?: number; voted?: boolean } | null => {
    let d: Record<string, unknown> | null = null;
    for (const c of got.get(id) ?? []) {
      if (c.target === 'message' && c.method === '$reset') d = null;
      if (c.target !== 'hud' || c.args[0] !== 'skipvote') continue;
      if (c.method === 'widget') d = Object.assign({}, c.args[1]);
      else if (c.method === 'widgetSet' && d) d = Object.assign({}, d, c.args[1]);
      else if (c.method === 'widgetRemove') d = null;
    }
    return d;
  };
  const ends = (id: string) => calls(id, 'widget').filter((c) => c.args[0] === 'end').length;

  const ann = join('Ann');
  const bob = join('Bob');
  step(1);
  check(now() === planned(0) && phase() === 'playing', `a public room starts on the rotation's first (${now()})`);

  // During the fly-over: too soon.
  press(ann);
  check(!votes(ann).length && toasts(ann).some((t) => t.includes('opens in')), `too soon to vote: ${toasts(ann).slice(-1).join('')}`);
  step(INTRO_HOLD + 5.5 - g.clock.now);

  // Bots press N: nothing.
  for (const b of g.bots.all) b.controls.press('KeyN');
  step(0.5);
  check(!votes(ann).length && card(ann) === null, `bots don't vote: ${votes(ann).join(' | ')}`);

  // Ann: one of two.
  press(ann);
  const what = `${match.mode.name} on ${match.map.name}`;
  check(lastVote(bob) === `Ann voted to skip ${what} (1/2)`, `Ann's vote in everyone's feed: ${lastVote(bob)}`);
  const a = card(ann);
  const b = card(bob);
  check(a?.votes === 1 && a.need === 2 && a.voted === true && b?.voted === false, `the card: Ann's ${JSON.stringify(a)}, Bob's ${JSON.stringify(b)}`);
  step(2);
  check(now() === planned(0) && phase() === 'playing', `one vote of two doesn't skip it (${phase()})`);

  // Bob dies: his deploy menu offers the vote.
  const B = g.players.find((p) => p.name === 'Bob')!;
  B.protect(0);
  B.damage(1000, { source: 'world' });
  step(0.5);
  const menus = calls(bob, 'menu');
  const offered = JSON.stringify(menus.at(-1)?.args ?? []).includes('Vote to skip this match');
  check(!B.alive && offered, `dead, the deploy menu offers the vote (${menus.length} menus)`);
  // The menu's up, so his screen's keys aren't the game's: /skip from the dead.
  exec(bob, 'skip');
  check(votes(ann).at(-2) === `Bob voted to skip ${what} (2/2)` && lastVote(ann) === `The vote passed: ${what} skipped`, `two of two: ${votes(ann).slice(-2).join(' | ')}`);
  check(phase() === 'over' && banners(ann).at(-1) === 'SKIPPED' && card(ann) === null, `skipped, with a banner: ${phase()}, ${banners(ann).at(-1)}`);
  press(ann);
  check(toasts(ann).at(-1)?.includes('over'), `between matches, no vote: ${toasts(ann).at(-1)}`);
  const t0 = g.clock.total;
  stepUntil(() => phase() === 'playing', 10);
  const pause = g.clock.total - t0;
  check(now() === planned(1) && pause > 3 && pause < 5, `the rotation's next is on a few seconds later (${now()}, after ${pause.toFixed(1)} s)`);
  check(!ends(ann) && !ends(bob), 'a match skipped has no end screen');
  check(!(g.players.find((p) => p.name === 'Ann')!.store.get('stats')), 'nothing kept of it in the all-time numbers');

  // The next match: the count starts again; a dead player's N (no menu up) votes.
  step(INTRO_HOLD + 5.5);
  press(ann);
  const what2 = `${match.mode.name} on ${match.map.name}`;
  check(lastVote(bob) === `Ann voted to skip ${what2} (1/2)`, `a new match, a new count: ${lastVote(bob)}`);
  step(2.1);
  press(bob, { active: false, dead: true });
  check(lastVote(ann) === `The vote passed: ${what2} skipped`, `a dead player's N votes: ${votes(ann).slice(-2).join(' | ')}`);
  stepUntil(() => phase() === 'playing', 10);
  check(now() === planned(2), `and the next again (${now()})`);
  console.log(`  1/2 no skip; 2/2 skipped (/skip from the deploy menu, then N from the dead); ${planned(0)} → ${planned(1)} after ${pause.toFixed(1)} s → ${now()}`);
  host.dispose();
}
