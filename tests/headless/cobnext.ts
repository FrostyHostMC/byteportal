import { readFileSync } from 'node:fs';
import { GameHost } from '../../src/platform/host/game';
import { IDLE_INPUT, type HostEvent, type PresentCall } from '../../src/platform/net/protocol';
import { match } from '../../src/games/callofblocky/match';
import { MAPS } from '../../src/games/callofblocky/map';
import { MODES, ROTATION } from '../../src/games/callofblocky/modes';
import { SCORES, VOTING } from '../../src/games/callofblocky/nextvote';
import { check, games } from './_harness';

const wasm = readFileSync('engine/pkg/voxel_engine_bg.wasm');
const cob = games.find((g) => g.id === 'callofblocky')!;

const now = () => `${match.mode.id} ${match.map.id}`;
const phase = (): string => match.phase;
const planned = (i: number) => `${ROTATION[i].mode} ${ROTATION[i].map}`;

type Entry = { label: string; detail?: string; active?: boolean; onSelect?: { $cb: number } };
type Menu = { title?: string; subtitle?: string; sections?: { title?: string; entries: Entry[] }[] };

/**
 * Call of Blocky's vote on what's next (`nextvote.ts`), in a public room with two people and
 * bots: a match played out shows its final scores, then each person gets the menu (a mode and a
 * map); the counts come in on both screens as they vote, a tie goes to the first tied (or to
 * what was coming next, if that's one of them), and a change of mind counts; closed, M brings it
 * back; the most votes wins each, and that's what's on next. Nobody voting: the rotation's next.
 * A match skipped moves straight on, no vote. (Cheats on: `/win` ends a match.)
 */
export default function cobnext() {
  const host = new GameHost(cob, { engine: wasm, seed: 5, remote: true, radius: 4, budget: Infinity, cheats: true });
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
    let t = 0;
    for (; t < most && !done(); t += 1 / 30) tick();
    return t;
  };
  const join = (name: string) => {
    const c = host.connect(name);
    got.set(c.id, []);
    keep(c.id, c.batch.events);
    host.command(c.id, { t: 'start' });
    return c.id;
  };
  const calls = (id: string) => (got.get(id) ?? []).filter((c) => c.target === 'hud');
  /** The vote's menu as this screen has it now (null: not up), from what it was sent. */
  const menu = (id: string): (Menu & { id: number }) | null => {
    let m = null as (Menu & { id: number }) | null;
    for (const c of calls(id)) {
      const [mid, o] = c.args as [number, Menu];
      if (c.method === 'menu') m = o.title === 'Next match' ? { ...o, id: mid } : m;
      else if (c.method === 'menuUpdate' && m?.id === mid) m = { ...m, ...o };
      else if (c.method === 'menuClose' && m?.id === mid) m = null;
    }
    return m;
  };
  const entry = (id: string, label: string) => menu(id)?.sections?.flatMap((s) => s.entries).find((e) => e.label === label);
  const choose = (id: string, label: string) => {
    const e = entry(id, label);
    check(e?.onSelect, `${label} is on the menu: ${JSON.stringify(menu(id)?.sections?.map((s) => s.entries.map((x) => x.label)))}`);
    host.command(id, { t: 'message', msg: { t: 'callback', player: id, id: e.onSelect.$cb } });
    tick();
  };
  const feed = (id: string) => calls(id).filter((c) => c.method === 'feed').map((c) => (Array.isArray(c.args[0]) ? (c.args[0] as unknown[]).map((p) => (typeof p === 'string' ? p : ((p as { text?: string }).text ?? ''))).join('') : String(c.args[0])));

  const ann = join('Ann');
  const bob = join('Bob');
  step(1);
  check(now() === planned(0), `the rotation's first is on (${now()})`);

  // Played out: the final scores, then the vote.
  g.commands.run('win');
  check(phase() === 'over', 'the match is over');
  step(SCORES - 0.5);
  check(!menu(ann) && !menu(bob), 'the scores first, no vote yet');
  step(1);
  let m = menu(ann);
  check(m && menu(bob), 'then each person gets the vote on what next');
  check(m.sections?.map((s) => s.title).join() === 'Mode,Map' && m.sections[0].entries.length === Object.keys(MODES).length && m.sections[1].entries.length === MAPS.length, `a mode and a map to vote on, every one of each: ${JSON.stringify(m.sections?.map((s) => s.entries.map((e) => e.label)))}`);
  // Nobody's voted: what's coming next anyway is marked.
  const fallback = ROTATION[1];
  check(entry(ann, 'Team Deathmatch')?.detail === 'next' && entry(ann, 'Big Kahuna Burger')?.detail === 'next', `up next if nobody votes: ${planned(1)} (${entry(ann, 'Team Deathmatch')?.detail}, ${entry(ann, 'Big Kahuna Burger')?.detail})`);

  // Two clicks at once, both from the menu as her screen had it (the first's update still on its
  // way when she makes the second): both count.
  const stale = [entry(ann, 'Free-for-all')!.onSelect!.$cb, entry(ann, 'Big Kahuna Burger')!.onSelect!.$cb];
  for (const cb of stale) host.command(ann, { t: 'message', msg: { t: 'callback', player: ann, id: cb } });
  tick();
  check(entry(ann, 'Free-for-all')?.active && entry(ann, 'Big Kahuna Burger')?.active, `two quick clicks, both counted: ${entry(ann, 'Free-for-all')?.detail} / ${entry(ann, 'Big Kahuna Burger')?.detail}`);

  // Ann: The Briefcase on Hijacked. Bob: The Briefcase on Jackrabbit Lane. The mode's two to
  // none; the maps tie, neither of them what was coming next: the first of them, Jackrabbit Lane.
  choose(ann, 'The Briefcase');
  choose(ann, 'Hijacked');
  check(entry(bob, 'The Briefcase')?.detail === '1 vote · next' && entry(ann, 'The Briefcase')?.active && !entry(bob, 'The Briefcase')?.active, `Ann's votes on Bob's screen too, hers marked on hers: ${entry(bob, 'The Briefcase')?.detail}`);
  choose(bob, 'The Briefcase');
  choose(bob, 'Jackrabbit Lane');
  check(entry(ann, 'The Briefcase')?.detail === '2 votes · next', `two for The Briefcase: ${entry(ann, 'The Briefcase')?.detail}`);
  check(entry(ann, 'Jackrabbit Lane')?.detail === '1 vote · next' && entry(ann, 'Hijacked')?.detail === '1 vote', `a tie of maps goes to the first: ${entry(ann, 'Jackrabbit Lane')?.detail} / ${entry(ann, 'Hijacked')?.detail}`);
  // Bob closes his menu; M brings it back; he changes his mind: Hijacked, two to none.
  const closed = menu(bob)!.id;
  host.command(bob, { t: 'message', msg: { t: 'menuClosed', player: bob, menu: closed } });
  tick();
  host.command(bob, { t: 'input', input: { ...IDLE_INPUT, active: true, pressed: ['KeyM'], down: ['KeyM'] } });
  tick();
  host.command(bob, { t: 'input', input: { ...IDLE_INPUT, active: true } });
  tick();
  check(menu(bob) && menu(bob)!.id !== closed && entry(bob, 'Jackrabbit Lane')?.active, 'M brings his menu back, his votes still on it');
  choose(bob, 'Hijacked');
  check(entry(ann, 'Hijacked')?.detail === '2 votes · next' && !entry(ann, 'Jackrabbit Lane')?.detail, `he changed his mind: ${entry(ann, 'Hijacked')?.detail}`);
  // The countdown ticks down on the menu (its entries untouched).
  const before = menu(ann)!.subtitle;
  step(1.2);
  check(menu(ann)!.subtitle !== before && menu(ann)!.subtitle!.includes('The Briefcase on Hijacked'), `the countdown: ${menu(ann)!.subtitle}`);
  const t = stepUntil(() => phase() === 'playing', VOTING + 2);
  check(now() === 'case hijacked', `what they voted for is on (${now()}; ${planned(1)} was next)`);
  check(!menu(ann) && !menu(bob), 'the menus went with the vote');
  check(feed(ann).some((l) => l === "The vote's in: The Briefcase on Hijacked next"), `the feed says so: ${feed(ann).slice(-2).join(' | ')}`);
  console.log(`  voted: The Briefcase 2-0; maps 1-1 (the first tied leads), then 2-0 for Hijacked after a change of mind; on in ${(SCORES + 2.4 + t).toFixed(0)} s: ${now()}`);

  // Nobody votes: what was coming next anyway. (The rotation's next is The Briefcase on
  // Hijacked, just played by their vote: the one after it.)
  check(planned(2) === 'case hijacked', `the rotation's third is what they voted for (${planned(2)})`);
  g.commands.run('win');
  step(SCORES + 0.5);
  check(menu(ann), 'the vote again');
  stepUntil(() => phase() === 'playing', VOTING + 2);
  check(now() === planned(3), `no votes: the rotation's next, not the same match again (${now()}; ${fallback.mode} ${fallback.map} was next the first time)`);

  // Skipped (both vote to skip): straight on, no vote on what's next.
  step(10.5);
  for (const id of [ann, bob]) host.command(id, { t: 'exec', id: 1, line: 'skip' });
  tick();
  check(phase() === 'over', 'skipped');
  stepUntil(() => phase() === 'playing', 6);
  check(!menu(ann) && phase() === 'playing', `a skip moves straight on, no vote (${now()})`);
  console.log(`  no votes: ${planned(3)} (not ${planned(2)} again); skipped: straight on to ${now()}`);
  host.dispose();
}
