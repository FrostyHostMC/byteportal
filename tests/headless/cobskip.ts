import { readFileSync } from 'node:fs';
import { GameHost } from '../../src/platform/host/game';
import { IDLE_INPUT, type HostEvent, type PlayerInput, type PresentCall } from '../../src/platform/net/protocol';
import { padHints } from '../../src/platform/player/gamepad';
import { match } from '../../src/games/callofblocky/match';
import { ROTATION } from '../../src/games/callofblocky/modes';
import { check, games } from './_harness';

const wasm = readFileSync('engine/pkg/voxel_engine_bg.wasm');
const cob = games.find((g) => g.id === 'callofblocky')!;

/** What's on now, and whether it's being fought (read afresh: a match moves on under the test). */
const now = () => `${match.mode.id} ${match.map.id}`;
const phase = (): string => match.phase;
const planned = (i: number) => `${ROTATION[i].mode} ${ROTATION[i].map}`;

/**
 * Call of Blocky's vote to skip (the platform's `skipVote` kit), in a public room on a server with people and
 * bots, cheats off (`/skip` is everyone's): the vote opens a few seconds into a match; bots can't
 * vote, and neither they nor anyone watching from the home page count toward the majority; one
 * vote of two people doesn't skip, and V again takes it back; two of two skip, and the
 * rotation's next is on, with nothing kept of the match skipped; the votes start again from
 * nothing in the next, where two of three skip it (one of them dead: a dead player still votes,
 * though V typed in the chat doesn't); and someone leaving takes their vote with them, or leaves
 * the votes still in a majority.
 */
export default function cobskip() {
  // The bots pick with Math.random too: seeded, a failure plays out the same way again.
  let seed = 0x2545f491;
  Math.random = () => {
    seed = (seed + 0x6d2b79f5) >>> 0;
    let t = seed;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  // The controls: V on the keyboard, Y on a controller, both on the home page.
  check(cob.controls?.some(([k, v]) => k === 'V' && v.includes('skip')), `V is in the controls: ${JSON.stringify(cob.controls)}`);
  const hints = padHints(cob, true, { jump: 'Space', crouch: 'KeyC', sprint: 'ShiftLeft' });
  check(hints.some(([b, v]) => b === 'Y' && v === 'vote to skip'), `the controller's hint: ${JSON.stringify(hints)}`);

  const host = new GameHost(cob, { engine: wasm, seed: 3, remote: true, radius: 4, budget: Infinity });
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
  const leave = (id: string) => {
    host.disconnect(id);
    got.delete(id);
    tick();
  };
  /** They press V (and let go). */
  const press = (id: string) => {
    host.command(id, { t: 'input', input: { ...IDLE_INPUT, active: true, pressed: ['KeyV'], down: ['KeyV'] } });
    tick();
    host.command(id, { t: 'input', input: { ...IDLE_INPUT, active: true } });
    tick();
  };
  /** They press V with their controls as they are: dead (their screen's still the game's), or typing in chat (it isn't). */
  const pressAs = (id: string, as: Partial<PlayerInput>) => {
    host.command(id, { t: 'input', input: { ...IDLE_INPUT, ...as, pressed: ['KeyV'], down: ['KeyV'] } });
    tick();
    host.command(id, { t: 'input', input: { ...IDLE_INPUT, ...as } });
    tick();
  };
  let n = 1;
  /** They type a command. */
  const exec = (id: string, line: string) => {
    host.command(id, { t: 'exec', id: n++, line });
    tick();
  };
  const calls = (id: string, method: string) => (got.get(id) ?? []).filter((c) => c.target === 'hud' && c.method === method);
  const text = (parts: unknown) => (Array.isArray(parts) ? parts.map((p) => (typeof p === 'string' ? p : ((p as { text?: string }).text ?? ''))).join('') : String(parts));
  const feed = (id: string) => calls(id, 'feed').map((c) => text(c.args[0]));
  /** The feed's lines about the vote. */
  const votes = (id: string) => feed(id).filter((l) => l.includes('vote'));
  const lastVote = (id: string) => votes(id).at(-1) ?? '';
  const toasts = (id: string) => calls(id, 'toast').map((c) => String(c.args[0]));
  const banners = (id: string) => calls(id, 'banner').map((c) => String(c.args[0]));
  /** The vote's card as this screen has it now (null: it isn't up), from what it was sent. */
  const card = (id: string): { votes?: number; need?: number; voted?: boolean; what?: string } | null => {
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
  /** Into the match far enough for the vote to be open. */
  const opened = () => step(Math.max(0, 10.5 - g.clock.now));

  // Two people, and bots making up the free-for-all; and someone watching from the home page
  // (connected, not playing), who isn't one of the people.
  const ann = join('Ann');
  const bob = join('Bob');
  const watcher = host.connect();
  got.set(watcher.id, []);
  step(1);
  check(now() === planned(0), `a public room starts on the rotation's first (${now()})`);
  const people = g.players.filter((p) => !p.bot).length;
  check(people === 2 && g.bots.all.length >= 3, `two people and some bots (${people}, ${g.bots.all.length} bots)`);

  // Too soon: the vote opens a few seconds in.
  press(ann);
  check(!votes(ann).length && toasts(ann).some((t) => t.includes('opens in')), `too soon to vote: ${toasts(ann).slice(-2).join(' | ')}`);
  opened();

  // The bots all press V: nothing (and there are enough of them for a majority of the fighters).
  for (const b of g.bots.all) b.controls.press('KeyV');
  step(0.5);
  check(!votes(ann).length && card(ann) === null, `bots don't vote: ${votes(ann).join(' | ')}`);

  // Ann votes: one of two people, short of a majority (and the bots aren't counted: 2 needed, not 4).
  press(ann);
  check(lastVote(bob) === 'Ann voted to skip Free-for-all on Jackrabbit Lane (1/2)', `Ann's vote in everyone's feed: ${lastVote(bob)}`);
  let a = card(ann);
  let b = card(bob);
  check(a?.votes === 1 && a.need === 2 && a.voted === true && b?.votes === 1 && b.voted === false, `the card: Ann's ${JSON.stringify(a)}, Bob's ${JSON.stringify(b)}`);
  // V again at once: a moment first (no hammering it).
  press(ann);
  check(votes(ann).length === 1 && toasts(ann).at(-1) === 'Hang on a second', `a second press at once is held off: ${votes(ann).join(' | ')} · ${toasts(ann).at(-1)}`);
  step(2);
  check(now() === planned(0) && phase() === 'playing', `one vote of two doesn't skip it (${now()}, ${phase()})`);

  // She takes it back.
  press(ann);
  check(lastVote(bob) === 'Ann took back their vote to skip (0/2)', `taken back: ${lastVote(bob)}`);
  check(card(ann) === null && card(bob) === null, 'no votes in: the card goes');
  step(2.1);

  // Both vote (Bob types it): two of two, skipped.
  press(ann);
  check(lastVote(ann).endsWith('(1/2)') && phase() === 'playing', `Ann's in again: ${lastVote(ann)}`);
  exec(bob, 'skip');
  check(lastVote(ann) === 'The vote passed: Free-for-all on Jackrabbit Lane skipped', `the vote passed: ${votes(ann).slice(-2).join(' | ')}`);
  check(votes(ann).at(-2) === 'Bob voted to skip Free-for-all on Jackrabbit Lane (2/2)', `Bob's vote, by /skip: ${votes(ann).at(-2)}`);
  check(phase() === 'over' && banners(bob).at(-1) === 'SKIPPED', `skipped, with a banner: ${phase()}, ${banners(bob).at(-1)}`);
  check(card(ann) === null, 'the card goes with it');
  // Voting now is voting on nothing.
  press(ann);
  check(toasts(ann).at(-1)?.includes('over'), `between matches, no vote: ${toasts(ann).at(-1)}`);
  const t0 = g.clock.total;
  stepUntil(() => phase() === 'playing', 8);
  const pause = g.clock.total - t0;
  check(now() === planned(1) && pause > 3 && pause < 5, `the rotation's next is on a few seconds later (${now()}, after ${pause.toFixed(1)} s)`);
  // Nothing kept of the match skipped: nobody won or lost it, and no all-time numbers.
  const ends = [...banners(ann), ...banners(bob)].filter((x) => ['YOU WIN', 'GAME OVER', 'VICTORY', 'DEFEAT', 'DRAW'].includes(x));
  check(!ends.length && g.store.get('stats:Ann') === undefined && g.store.get('stats:Bob') === undefined, `a match skipped isn't a match played: ${ends.join(', ')} ${JSON.stringify(g.store.get('stats:Ann'))}`);
  console.log(`  two people: 1/2 no skip, taken back, 2/2 skipped (/skip for one); ${planned(0)} → ${now()} after ${pause.toFixed(1)} s`);

  // Cat joins: three people, two needed; the votes start again from nothing.
  const cat = join('Cat');
  opened();
  press(ann);
  check(lastVote(bob) === 'Ann voted to skip Team Deathmatch on Big Kahuna Burger (1/2)', `a new match, a new count, three people: ${lastVote(bob)}`);
  step(1);
  check(now() === planned(1) && phase() === 'playing', `one of three doesn't skip it (${now()})`);
  // Cat's down, watching her kill cam: V still votes. (A V typed into the chat doesn't: her screen hasn't the controls.)
  const C = g.players.find((p) => p.name === 'Cat')!;
  C.protect(0);
  C.damage(1000, { source: 'world' });
  step(0.2);
  pressAs(cat, { active: false });
  check(!C.alive && lastVote(bob).startsWith('Ann voted') && phase() === 'playing', `V typed in the chat isn't a vote: ${lastVote(bob)}`);
  pressAs(cat, { active: false, dead: true });
  check(votes(bob).at(-2) === 'Cat voted to skip Team Deathmatch on Big Kahuna Burger (2/2)' && phase() === 'over', `two of three skip it, one of them dead: ${votes(bob).slice(-2).join(' | ')}`);
  stepUntil(() => phase() === 'playing', 8);
  check(now() === planned(2), `the rotation's next again (${now()})`);
  console.log(`  three people: 1/2 no skip, 2/2 skipped (the second vote from the dead); → ${now()}`);

  // Cat votes and leaves: her vote goes with her.
  opened();
  press(cat);
  check(lastVote(ann) === 'Cat voted to skip The Briefcase on Hijacked (1/2)', `Cat's vote: ${lastVote(ann)}`);
  leave(cat);
  a = card(ann);
  check(a === null && now() === planned(2) && phase() === 'playing', `Cat left, her vote with her: ${JSON.stringify(a)}`);
  step(0.5);
  // Ann votes (one of two, short), then Bob leaves without voting: one of one is a majority (the
  // one watching doesn't count, or it would take two).
  press(ann);
  a = card(ann);
  check(lastVote(ann) === 'Ann voted to skip The Briefcase on Hijacked (1/2)' && a?.votes === 1 && a.need === 2 && phase() === 'playing', `Ann's vote, two people: ${lastVote(ann)} ${JSON.stringify(a)}`);
  leave(bob);
  check(lastVote(ann) === 'The vote passed: The Briefcase on Hijacked skipped' && phase() === 'over', `counted again when Bob left, Ann's vote carries: ${votes(ann).slice(-2).join(' | ')} (${phase()})`);
  check(votes(watcher.id).at(-1) === lastVote(ann), 'the one watching sees the vote go by too');
  stepUntil(() => phase() === 'playing', 8);
  check(now() === planned(3), `and the next is on (${now()})`);
  console.log(`  leaving: Cat's vote went with her; Bob leaving left Ann's a majority; → ${now()}`);
  host.dispose();
}
