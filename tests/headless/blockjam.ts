import { readFileSync } from 'node:fs';
import { advance, arc, launch, shotTime, type BallEvent } from '../../src/games/blockjam/ball';
import { FLOOR, isThree, rim } from '../../src/games/blockjam/court';
import { dunkPath, dunkTarget, JAM_STATE, SHOT_APEX } from '../../src/games/blockjam/moves';
import { inboundSpot, levelOf, type Team } from '../../src/games/blockjam/match';
import blockjam, { matchNow } from '../../src/games/blockjam/server';
import { GameHost } from '../../src/platform/host/game';
import { check } from './_harness';
import { personGame } from './_jam-levels';

const wasm = readFileSync('engine/pkg/voxel_engine_bg.wasm');

/**
 * Block Jam: the ball (a shot through the middle drops from anywhere, one at the back of the rim
 * clanks out, the flight is the same played in one go or in pieces), the court (threes), a dunk's
 * path (it ends at the rim), and a whole game of bots played out headless: tip-off, four quarters,
 * the final buzzer, a winner, and box scores that add up to the score; the team screen (the first
 * pick starts a new game, joining, taking a side over, watching) and the bots' levels.
 */
export default function blockjamTest() {
  // Shots through the middle, from close in, the elbow, the arc and deep.
  const c = rim(1);
  let made = 0;
  for (const [x, z] of [[c.x - 2, 0], [c.x - 4, 2], [c.x - 6.8, 0], [c.x - 5, 5], [c.x - 9, 3]]) {
    const from = { x, y: FLOOR + 2.6, z };
    const d = Math.hypot(c.x - x, c.z - z);
    const ux = (c.x - x) / d;
    const uz = (c.z - z) / d;
    const v = arc(from, { x: c.x + ux * 0.04, y: c.y, z: c.z + uz * 0.04 }, shotTime(d));
    const s = launch(from.x, from.y, from.z, v.vx, v.vy, v.vz);
    advance(s, 4);
    if (s.through === 1) made++;
  }
  check(made === 5, `shots through the middle drop: ${made} of 5`);
  // At the back of the rim: off the iron and out.
  {
    const from = { x: c.x - 6, y: FLOOR + 2.6, z: 0 };
    const v = arc(from, { x: c.x + 0.48, y: c.y, z: 0 }, shotTime(6));
    const s = launch(from.x, from.y, from.z, v.vx, v.vy, v.vz);
    const ev: BallEvent[] = [];
    advance(s, 4, ev);
    check(!s.through && ev.some((e) => e.kind === 'rim'), `the back iron: out (${ev.map((e) => e.kind).join(',')})`);
  }
  // The same flight played in one go and frame by frame.
  {
    const a = launch(0, FLOOR + 2, 0, 5, 7, 1);
    const b = launch(0, FLOOR + 2, 0, 5, 7, 1);
    advance(a, 2.5);
    for (let t = 0; t <= 2.5; t += 1 / 60) advance(b, t);
    advance(b, 2.5);
    check(Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z) < 1e-9, 'a flight is the same however it is played');
  }
  // Threes: behind the arc and in the corners, not inside.
  check(isThree(1, c.x - 7, 0) && isThree(1, c.x + 0.5, 7) && !isThree(1, c.x - 4, 1), 'threes');
  // A dunk's path ends at the rim, and its top is above the rim.
  {
    const s = { ...JAM_STATE, fx: c.x - 5, fy: FLOOR, fz: 2, ...(() => { const t = dunkTarget(1, c.x - 5, 2); return { tx: t.x, ty: t.y, tz: t.z }; })(), lift: 1.3 };
    const end = dunkPath(s, 1);
    const mid = dunkPath(s, 0.6);
    check(Math.hypot(end.x - c.x, end.z - c.z) < 0.7 && end.y > FLOOR + 1, `a dunk ends at the rim: ${JSON.stringify(end)}`);
    check(mid.y + 1.7 > c.y, 'and flies above it');
  }
  check(SHOT_APEX > 0.2 && SHOT_APEX < 0.35, `a jump shot's top: ${SHOT_APEX.toFixed(3)} s`);

  // A whole game of bots.
  const host = new GameHost(blockjam, { engine: wasm, seed: 7, remote: true, radius: 3, budget: Infinity });
  (host as unknown as { sim: { start(): void } }).sim.start();
  let tipped = false;
  let maxQuarter = 0;
  let over = false;
  // Every inbound starts at the inbounding side's own baseline (not up the floor at the other end).
  let inbounds = 0;
  let farInbound = 0;
  let wasInbound: Team | null = null;
  for (let i = 0; i < 30 * 60 * 11 && !over; i++) {
    host.step(1 / 30);
    const m = matchNow();
    if (wasInbound && m.ball.mode === 'held' && m.ball.holder) {
      inbounds++;
      const spot = inboundSpot(wasInbound);
      const p = m.ball.holder.player.position;
      if (m.ball.holder.team !== wasInbound || Math.hypot(p.x - spot.x, p.z - spot.z) > 2.6) farInbound++;
    }
    wasInbound = m.ball.mode === 'dead' ? m.ball.inbound : null;
    if (m.phase === 'live') tipped = true;
    maxQuarter = Math.max(maxQuarter, m.quarter);
    if (m.phase === 'over') over = true;
  }
  const m = matchNow();
  check(tipped, 'tip-off');
  check(inbounds > 10 && farInbound === 0, `every inbound at the side's own baseline (${inbounds - farInbound} of ${inbounds})`);
  check(over && maxQuarter >= 4, `the final buzzer, after ${maxQuarter} quarters`);
  const [a, b] = m.teams;
  check(a.score !== b.score, `a winner: ${a.def.abbr} ${a.score} ${b.def.abbr} ${b.score}`);
  check(a.score >= 12 && b.score >= 12, 'both sides score');
  for (const t of m.teams) {
    const pts = t.ballers.reduce((n, x) => n + x.pts, 0);
    // (A tip-in off the other side's miss scores without a scorer.)
    check(pts <= t.score && pts >= t.score * 0.7, `${t.def.abbr}'s box score adds up: ${pts} of ${t.score}`);
  }
  const all = [...a.ballers, ...b.ballers];
  check(all.reduce((n, x) => n + x.dunks, 0) > 0 && all.reduce((n, x) => n + x.reb, 0) > 0 && all.reduce((n, x) => n + x.stl, 0) > 0, 'dunks, rebounds and steals');
  // People coming and going: each picks a team on the team screen; the first in starts a new game
  // for theirs; each who takes the floor gets the turbo meter, even in a place someone left (the
  // first player's place is the same player for whoever takes it next).
  let picks = '';
  {
    const host2 = new GameHost(blockjam, { engine: wasm, seed: 3, remote: true, radius: 3, budget: Infinity });
    type Batches = Map<string, { events: { t: string; call?: { method: string; args: unknown[] } }[] }>;
    const widget = (batches: Batches, id: string, name: string) =>
      (batches.get(id)?.events ?? []).some((e) => e.t === 'call' && e.call?.method === 'widget' && (e.call.args[0] as string) === name);
    const press = (id: string, action: string, value = '') => host2.command(id, { t: 'message', msg: { t: 'widgetAction', player: '', widget: 'jam-pick', action, value } });
    // M brings the team screen back (its buttons count only while it's up).
    const key = (id: string, code: string) => {
      host2.command(id, { t: 'input', input: { active: true, down: [code], pressed: [code], buttons: 0, clicked: 0, mouseX: 0, mouseY: 0, wheel: 0, yaw: 0, pitch: 0, viewSeq: -1 } });
      host2.step(1 / 30);
      host2.command(id, { t: 'input', input: { active: true, down: [], pressed: [], buttons: 0, clicked: 0, mouseX: 0, mouseY: 0, wheel: 0, yaw: 0, pitch: 0, viewSeq: -1 } });
    };
    const steps = (n: number, id?: string, name?: string) => {
      let got = false;
      for (let i = 0; i < n; i++) {
        const b = host2.step(1 / 30) as never;
        if (id && name && widget(b, id, name)) got = true;
      }
      return got;
    };
    const arrive = (name: string) => {
      const c = host2.connect();
      host2.command(c.id, { t: 'start', name });
      const screen = steps(5, c.id, 'jam-pick');
      return { c, screen };
    };
    const team = (name: string) => matchNow().teams.find((t) => t.ballers.some((b) => b.player.name === name));
    steps(60);
    // The first person: the team screen, then a new game for the Gators.
    const first = arrive('Pat');
    check(first.screen, 'a person coming in gets the team screen');
    check(!team('Pat'), 'and watches till they pick');
    const before = matchNow();
    // (The level first: buttons count only while the screen's up, and a pick closes it.)
    press(first.c.id, 'level', 'rookie');
    steps(2);
    check(before.level === 'rookie', 'the level is set');
    press(first.c.id, 'team', 'gators');
    const meter1 = steps(20, first.c.id, 'jam-turbo');
    const m1 = matchNow();
    check(m1 !== before && m1.phase === 'tip' && m1.quarter === 1, 'the first pick starts a new game');
    check(team('Pat')?.def.id === 'gators' && m1.teams[0].def.id === 'gators', `Pat plays for the Gators (${team('Pat')?.def.id})`);
    check(m1.teams[0].ballers.length === 2 && m1.teams[1].ballers.length === 2, 'bots fill the rest');
    // The level: the room's (kept for the new game), for every bot in a game with people in it.
    const foeBot = m1.teams[1].ballers[0];
    const mateBot = m1.teams[0].ballers.find((b) => b.player.bot)!;
    check(m1.level === 'rookie' && levelOf(m1, foeBot).id === 'rookie' && levelOf(m1, mateBot).id === 'rookie', `with a person playing, every bot's a rookie (${levelOf(m1, foeBot).id}, Pat's teammate ${levelOf(m1, mateBot).id})`);
    // A second person joins the other team in this game (no new game), a bot giving way.
    const second = arrive('Sam');
    press(second.c.id, 'team', m1.teams[1].def.id);
    steps(5);
    check(matchNow() === m1 && team('Sam') === m1.teams[1] && m1.teams[1].ballers.length === 2, 'a second person joins the game on, for the other side');
    // Sam picks a team not in the game: their side takes it over (the score stays), with its bench.
    const bench = ['blaze', 'cubes', 'rockets'].find((x) => !m1.teams.some((t) => t.def.id === x))!;
    m1.teams[1].score = 7;
    press(second.c.id, 'team', bench);
    steps(2);
    check(m1.teams[1].def.id !== bench, 'a button pressed with the screen down does nothing');
    key(second.c.id, 'KeyM');
    press(second.c.id, 'team', bench);
    steps(5);
    check(m1.teams[1].def.id === bench && team('Sam') === m1.teams[1] && m1.teams[1].score === 7, `Sam's side becomes the ${bench}, keeping its 7`);
    check(m1.teams[1].ballers.every((b) => !b.player.bot || m1.teams[1].def.bench.some((x) => x.name === b.player.name)), 'its bench comes on');
    // Pat (alone on their side) picks a team that isn't playing: their own side takes it.
    const third = ['blaze', 'cubes', 'rockets', 'gators'].find((x) => !m1.teams.some((t) => t.def.id === x))!;
    key(first.c.id, 'KeyM');
    press(first.c.id, 'team', third);
    steps(3);
    check(team('Pat') === m1.teams[0] && m1.teams[0].def.id === third && team('Sam') === m1.teams[1], `Pat's side becomes the ${third}`);
    // Pat leaves; someone else comes and takes the place they left.
    host2.disconnect(first.c.id);
    steps(10);
    const fourth = arrive('Lee');
    press(fourth.c.id, 'team', third);
    const meter2 = steps(20, fourth.c.id, 'jam-turbo');
    check(meter1 && meter2, `each person gets the turbo meter (first ${meter1}, second in the same place ${meter2})`);
    check(team('Lee') === m1.teams[0] && matchNow() === m1, `Lee joins the ${third} in the game on`);
    // A third person, with people on both sides: a team that isn't playing can't take a side over.
    const fifth = arrive('Kim');
    const out = ['blaze', 'cubes', 'rockets', 'gators'].find((x) => !m1.teams.some((t) => t.def.id === x))!;
    press(fifth.c.id, 'team', out);
    steps(3);
    check(!team('Kim') && m1.teams.every((t) => t.def.id !== out), 'both sides have people: no taking one over');
    press(fifth.c.id, 'team', m1.teams[0].def.id);
    steps(3);
    check(team('Kim') === m1.teams[0] && m1.teams[0].ballers.every((b) => !b.player.bot), 'Kim joins Lee: two people, no bots');
    // A fourth onto that full side: refused, they stay on the screen.
    const sixth = arrive('Ash');
    press(sixth.c.id, 'team', m1.teams[0].def.id);
    steps(3);
    check(!team('Ash'), 'a full side turns them away');
    // Watching: off the floor, a bot in their place.
    key(second.c.id, 'KeyM');
    press(second.c.id, 'watch');
    steps(3);
    check(!team('Sam') && m1.teams[1].ballers.length === 2, 'watching: a bot takes their place');
    picks = `${m1.teams[0].def.abbr} v ${m1.teams[1].def.abbr}`;
  }

  // The levels: Rookies score far less against a (scripted) person and their bot than All-Stars do.
  const against: Record<string, string> = {};
  const scored: Record<string, number> = {};
  for (const lv of ['rookie', 'allstar'] as const) {
    const mm = personGame(11, lv, 180);
    scored[lv] = mm.teams[1].score;
    against[lv] = `${mm.teams[0].score}-${mm.teams[1].score}`;
  }
  check(scored.rookie + 5 < scored.allstar, `Rookies score less against a person (${against.rookie}) than All-Stars (${against.allstar})`);

  console.log(`  blockjam: shots drop and clank, threes, dunk paths; a bots' game ${a.def.abbr} ${a.score}-${b.score} ${b.def.abbr} (${all.reduce((n, x) => n + x.dunks, 0)} dunks, ${all.reduce((n, x) => n + x.threes, 0)} threes); picks ${picks}; a person v Rookies ${against.rookie}, v All-Stars ${against.allstar}`);
}
