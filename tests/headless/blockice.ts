import { readFileSync } from 'node:fs';
import { everyone, levelOf } from '../../src/games/blockice/match';
import { advance, aim, launch, REST, type PuckEvent } from '../../src/games/blockice/puck';
import { boards, GOAL_X, HALF_WIDTH, ICE, keepIn, netBox } from '../../src/games/blockice/rink';
import blockice, { matchNow } from '../../src/games/blockice/server';
import { GameHost } from '../../src/platform/host/game';
import { check } from './_harness';
import { personGame } from './_ice-levels';

const wasm = readFileSync('engine/pkg/voxel_engine_bg.wasm');

/**
 * Block Ice: the puck (a shot at the mouth goes in from anywhere in front, one at the post rings
 * off, one over the bar stays out, one into the back of the net from behind bounces off it, the
 * flight is the same played in one go or in pieces, it slides and the boards turn it back), the
 * rink (bodies kept off the boards and out of the nets), a whole game of bots played out headless
 * (faceoffs, three periods, the final horn, a winner, goals, saves and hits, the box score adding
 * up), the team screen (the first pick starts a new game, joining, taking a side over) and the
 * bots' levels.
 */
export default function blockiceTest() {
  const shot = (from: [number, number, number], to: [number, number, number], speed: number) => {
    const f = { x: from[0], y: from[1], z: from[2] };
    const t = { x: to[0], y: to[1], z: to[2] };
    const v = aim(f, t, Math.hypot(t.x - f.x, t.z - f.z) / speed);
    const s = launch(f.x, f.y, f.z, v.vx, v.vy, v.vz);
    const ev: PuckEvent[] = [];
    advance(s, 4, ev);
    return { s, ev: ev.map((e) => e.kind) };
  };
  // At the mouth, from the slot, the wings, a sharp angle: in.
  let made = 0;
  for (const [x, z, tz, ty] of [[GOAL_X - 6, 0, 0.6, 0.3], [GOAL_X - 8, 4, -0.7, 0.9], [GOAL_X - 5, -4, 0.8, 0.15], [GOAL_X - 2, 3, -0.5, 0.5]]) {
    const r = shot([x, REST + 0.02, z], [GOAL_X + 0.35, ICE + ty, tz], 24);
    if (r.s.through === 1 && r.s.net === 1) made++;
  }
  check(made === 4, `shots at the mouth go in: ${made} of 4`);
  {
    const post = shot([GOAL_X - 8, REST, 0], [GOAL_X, ICE + 0.3, 1.1], 24);
    check(!post.s.through && post.ev.includes('post'), `off the post and out (${post.ev.join(',')})`);
    const high = shot([GOAL_X - 8, REST, 0], [GOAL_X, ICE + 1.7, 0], 24);
    check(!high.s.through, `over the bar (${high.ev.join(',')})`);
    const behind = shot([GOAL_X + 3, REST, 0], [GOAL_X - 2, REST, 0], 15);
    check(!behind.s.through && behind.ev.includes('net'), `into the back of the net from behind: off it (${behind.ev.join(',')})`);
  }
  {
    const a = launch(-10, REST, 2, 16, 3, 9);
    const b = launch(-10, REST, 2, 16, 3, 9);
    advance(a, 3);
    for (let t = 0; t <= 3; t += 1 / 60) advance(b, t);
    advance(b, 3);
    check(Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z) < 1e-9, 'a flight is the same however it is played');
    const s = launch(0, REST, 0, 2, 0, 18);
    const ev: PuckEvent[] = [];
    advance(s, 3, ev);
    check(ev.some((e) => e.kind === 'boards') && Math.abs(s.z) < HALF_WIDTH && s.vz < 0.5, 'the boards turn a puck back');
  }
  // Bodies kept in: out of the corner past the boards, out of a net.
  {
    const k = keepIn(19.5, 9, 0.38);
    check(boards(k.x, k.z).d >= 0.37, `out of the corner (${k.x.toFixed(2)}, ${k.z.toFixed(2)})`);
    const n = netBox(1);
    const j = keepIn((n.x0 + n.x1) / 2, 0.2, 0.38);
    check(j.x < n.x0 - 0.3 || j.x > n.x1 + 0.3 || Math.abs(j.z) > n.z1 + 0.3, `out of the net (${j.x.toFixed(2)}, ${j.z.toFixed(2)})`);
  }

  // A whole game of bots.
  const host = new GameHost(blockice, { engine: wasm, seed: 7, remote: true, radius: 3, budget: Infinity });
  (host as unknown as { sim: { start(): void } }).sim.start();
  let dropped = false;
  let maxPeriod = 0;
  let over = false;
  for (let i = 0; i < 30 * 60 * 12 && !over; i++) {
    host.step(1 / 30);
    const m = matchNow();
    if (m.phase === 'live') dropped = true;
    maxPeriod = Math.max(maxPeriod, m.period);
    if (m.phase === 'over') over = true;
  }
  const m = matchNow();
  check(dropped, 'the puck drops');
  check(over && maxPeriod >= 3, `the final horn, after ${maxPeriod} periods`);
  const [a, b] = m.teams;
  check(a.score !== b.score, `a winner: ${a.def.abbr} ${a.score} ${b.def.abbr} ${b.score}`);
  check(a.score + b.score >= 3 && a.score + b.score <= 30, `goals, not too many: ${a.score + b.score}`);
  const all = everyone(m);
  const saves = all.reduce((n, x) => n + x.saves, 0);
  const hits = all.reduce((n, x) => n + x.hits, 0);
  check(saves > 5 && hits > 0, `saves (${saves}) and hits (${hits})`);
  for (const t of m.teams) {
    const g = t.skaters.reduce((n, x) => n + x.g, 0);
    // (An own goal scores without a scorer of theirs.)
    check(g <= t.score && g >= t.score * 0.7, `${t.def.abbr}'s goals add up: ${g} of ${t.score}`);
    check(t.shots >= t.score, `${t.def.abbr}: ${t.shots} shots on goal, ${t.score} goals`);
  }

  // The team screen: the first pick starts a new game, then joining, taking a side over.
  {
    const h = new GameHost(blockice, { engine: wasm, seed: 3, remote: true, radius: 3, budget: Infinity });
    type Batches = Map<string, { events: { t: string; call?: { method: string; args: unknown[] } }[] }>;
    const widget = (batches: Batches, id: string, name: string) =>
      (batches.get(id)?.events ?? []).some((e) => e.t === 'call' && e.call?.method === 'widget' && (e.call.args[0] as string) === name);
    const press = (id: string, action: string, value = '') => h.command(id, { t: 'message', msg: { t: 'widgetAction', player: '', widget: 'ice-pick', action, value } });
    const steps = (n: number, id?: string, name?: string) => {
      let got = false;
      for (let i = 0; i < n; i++) {
        const out = h.step(1 / 30) as never;
        if (id && name && widget(out, id, name)) got = true;
      }
      return got;
    };
    const key = (id: string, code: string) => {
      h.command(id, { t: 'input', input: { active: true, down: [code], pressed: [code], buttons: 0, clicked: 0, mouseX: 0, mouseY: 0, wheel: 0, yaw: 0, pitch: 0, viewSeq: -1 } });
      h.step(1 / 30);
      h.command(id, { t: 'input', input: { active: true, down: [], pressed: [], buttons: 0, clicked: 0, mouseX: 0, mouseY: 0, wheel: 0, yaw: 0, pitch: 0, viewSeq: -1 } });
    };
    const arrive = (name: string) => {
      const c = h.connect();
      h.command(c.id, { t: 'start', name });
      return { c, screen: steps(5, c.id, 'ice-pick') };
    };
    const team = (name: string) => matchNow().teams.find((t) => t.skaters.some((s) => s.player.name === name));
    steps(60);
    const first = arrive('Pat');
    check(first.screen && !team('Pat'), 'a person coming in gets the team screen, and watches till they pick');
    const before = matchNow();
    press(first.c.id, 'level', 'rookie');
    press(first.c.id, 'team', 'jacks');
    const meter = steps(20, first.c.id, 'ice-turbo');
    const m1 = matchNow();
    check(m1 !== before && m1.phase === 'faceoff' && m1.period === 1, 'the first pick starts a new game');
    check(team('Pat') === m1.teams[0] && m1.teams[0].def.id === 'jacks' && meter, `Pat skates for the Lumberjacks, with the turbo meter (${meter})`);
    check(m1.teams.every((t) => t.skaters.length === 2 && t.goalie?.player.bot), 'bots fill the rest, a goalie in each net');
    check(m1.level === 'rookie' && everyone(m1).filter((s) => s.player.bot).every((s) => levelOf(m1, s).id === 'rookie'), 'with a person playing, every bot is a rookie');
    const second = arrive('Sam');
    press(second.c.id, 'team', m1.teams[1].def.id);
    steps(5);
    check(matchNow() === m1 && team('Sam') === m1.teams[1], 'a second person joins the game on, for the other side');
    const bench = ['yetis', 'blades', 'rhinos'].find((x) => !m1.teams.some((t) => t.def.id === x))!;
    m1.teams[1].score = 2;
    key(second.c.id, 'KeyM');
    press(second.c.id, 'team', bench);
    steps(5);
    check(m1.teams[1].def.id === bench && team('Sam') === m1.teams[1] && m1.teams[1].score === 2, `Sam's side becomes the ${bench}, keeping its 2`);
    check(m1.teams[1].goalie?.player.name === m1.teams[1].def.goalie.name, 'with its own goalie');
  }

  // The levels: Rookies get far fewer shots on a (scripted) person's goal than All-Stars do.
  const vs: Record<string, string> = {};
  const against: Record<string, number> = {};
  for (const lv of ['rookie', 'allstar'] as const) {
    const mm = personGame(11, lv, 240);
    against[lv] = mm.teams[1].shots;
    vs[lv] = `${mm.teams[0].score}-${mm.teams[1].score}, ${mm.teams[0].shots}-${mm.teams[1].shots} shots`;
  }
  check(against.rookie + 4 < against.allstar, `Rookies get fewer shots on a person (${vs.rookie}) than All-Stars (${vs.allstar})`);

  console.log(`  blockice: shots in, off the post, over the bar, off the net; a bots' game ${a.def.abbr} ${a.score}-${b.score} ${b.def.abbr} (${a.shots}-${b.shots} shots, ${saves} saves, ${hits} hits); a person v Rookies ${vs.rookie}, v All-Stars ${vs.allstar}`);
}
