import type { Headless } from '../../src/platform/host/headless';
import { CLUBS } from '../../src/games/golf/clubs';
import { course } from '../../src/games/golf/course';
import { simulate } from '../../src/games/golf/physics';
import { MSG, type AddressMsg, type RoundMsg, type ShotMsg } from '../../src/games/golf/protocol';
import { S, yards, yawOf } from '../../src/games/golf/scale';
import { Surf } from '../../src/games/golf/course/types';
import { check, launch, lastScreen } from './_harness';

/**
 * Blockyard Links, played headless: a scripted golfer takes the caddie's club, aims at the pin and
 * swings a little off perfect, over all eighteen holes. The round must finish with every hole on
 * the card, the shots must fly and land on the course, and a decent golfer should score like one.
 */
export default function golf() {
  courseSane();
  twoGolfers();
  const t0 = performance.now();
  const h = launch('golf', { seed: 3 });
  const me = h.ctx.player;
  const msgs = <T>(name: string) => h.calls.filter((c) => c.target === 'message' && c.method === name).map((c) => c.args[0] as T);
  const round = () => msgs<RoundMsg>(MSG.round).at(-1)!;
  h.run(1, { dt: 1 / 30 });
  check(round()?.mode === 'walk' && round().hole === 0, `on the first tee: ${JSON.stringify(round())}`);

  // The cart: up to it, E to get in, W to drive (A to turn), E to get out beside it.
  const cart = round().cart!;
  me.teleport({ x: cart.x + 1.5, y: cart.y + 0.5, z: cart.z }, 0, 0);
  h.run(0.5, { dt: 1 / 30 });
  h.step(1 / 30, { pressed: ['KeyE'], down: ['KeyE'] });
  h.run(0.3, { dt: 1 / 30 });
  check(round().mode === 'drive' && me.vehicle?.name === 'cart', `in the cart: ${round().mode}`);
  const start = { ...me.position };
  h.run(3, { dt: 1 / 30, pilot: () => ({ down: ['KeyW'] }) });
  const moved = Math.hypot(me.position.x - start.x, me.position.z - start.z);
  const state = me.vehicle!.state as { speed: number; yaw: number };
  check(moved > 12 && state.speed > 5, `the cart drove off: ${moved.toFixed(1)} blocks, ${state.speed.toFixed(1)} b/s`);
  const yaw0 = state.yaw;
  h.run(1.5, { dt: 1 / 30, pilot: () => ({ down: ['KeyW', 'KeyA'] }) });
  check((me.vehicle!.state as { yaw: number }).yaw > yaw0 + 0.3, 'A steers it left');
  h.run(2, { dt: 1 / 30, pilot: () => ({ down: ['Space'] }) });
  h.step(1 / 30, { pressed: ['KeyE'], down: ['KeyE'] });
  h.run(0.3, { dt: 1 / 30 });
  check(round().mode === 'walk' && !me.vehicle && round().cart, `out of the cart, parked: ${round().mode}`);
  // On foot again (driving held the body still).
  const out = { ...me.position };
  h.run(1, { dt: 1 / 30, pilot: () => ({ down: ['KeyW'] }) });
  const walked = Math.hypot(me.position.x - out.x, me.position.z - out.z);
  check(!me.frozen && walked > 2.5, `walks off from the cart: ${walked.toFixed(2)} blocks, frozen ${me.frozen}`);
  console.log(`  the cart: ${moved.toFixed(0)} blocks in 3 s, turned, braked, parked, walked away`);

  // The caddie's lift to the ball (F), from anywhere.
  const press = (code: string) => h.step(1 / 30, { pressed: [code], down: [code] });
  let shots = 0;
  let wobble = 0;
  const outcomes: Record<string, number> = {};
  for (let guard = 0; guard < 400 && round().mode !== 'done'; guard++) {
    const r = round();
    if (r.mode === 'walk' || r.mode === 'drive') {
      press('KeyF');
      h.run(0.2, { dt: 1 / 30 });
      continue;
    }
    if (r.mode !== 'address') {
      h.run(0.5, { dt: 1 / 30 });
      continue;
    }
    const a = msgs<AddressMsg>(MSG.address).at(-1)!;
    const hole = course.holes[a.hole];
    const pin = hole.green.pin;
    const dist = Math.hypot(pin.x - a.ball.x, pin.z - a.ball.z);
    const club = CLUBS.find((c) => c.id === a.club)!;
    // A decent golfer: a little off in timing, power judged by the book (and the break read a touch).
    wobble = (wobble * 7 + 3) % 11;
    const accuracy = (wobble - 5) / 14;
    let power: number;
    let scale: number | undefined;
    if (club.putter) {
      scale = Math.max(4, dist * 1.3);
      power = Math.min(1, (dist * 1.08) / scale);
    } else {
      const full = FULL[club.id];
      power = Math.min(1, Math.pow(yards(dist) / full, 1 / 1.2));
    }
    const aim = a.stroke === 1 && hole.par > 3 ? a.yaw : yawOf(pin.x - a.ball.x, pin.z - a.ball.z);
    h.send({ t: 'game', player: me.id, name: MSG.swing, data: { club: club.id, power, accuracy, spin: 0, curve: 0, yaw: aim, scale } });
    shots++;
    h.run(0.1, { dt: 1 / 30 });
    const shot = msgs<ShotMsg>(MSG.shot).at(-1);
    check(shot && shot.path.length >= 6, 'the shot flew');
    outcomes[shot!.outcome] = (outcomes[shot!.outcome] ?? 0) + 1;
    h.run(40, { dt: 1 / 30, until: () => round().mode !== 'flight' });
    if (process.env.GOLF_DEBUG) {
      const b = round().ball;
      const left = b ? Math.hypot(pin.x - b.x, pin.z - b.z) : 0;
      console.log(`    ${a.hole + 1}.${a.stroke} ${club.id.padEnd(7)} from ${yards(dist).toFixed(0).padStart(3)}y lie ${a.lie} pow ${power.toFixed(2)} acc ${accuracy.toFixed(2)} -> ${shot!.outcome} carry ${shot!.carry} total ${shot!.total}, left ${yards(left).toFixed(1)}y (${(left / S / 0.3048).toFixed(1)} ft) lie ${round().lie} mode ${round().mode}`);
    }
  }
  const r = round();
  check(r.mode === 'done', `the round finished (${r.mode} on ${r.hole + 1})`);
  check(r.card.every((s) => s !== null), `every hole on the card: ${r.card}`);
  check(lastScreen(h) === 'Round complete' || lastScreen(h) === 'A new best round!', `the result screen: ${lastScreen(h)}`);
  check(r.total < 18 * 7 && r.total >= 50, `a sane score: ${r.total}`);
  console.log(`  card ${r.card.join(' ')} = ${r.total} (${r.toPar >= 0 ? '+' : ''}${r.toPar}), ${shots} swings ${JSON.stringify(outcomes)}, ${h.time.toFixed(0)} s of play in ${((performance.now() - t0) / 1000).toFixed(1)} s`);
  console.log(`  ${h.ctx.world.spawn ? '' : ''}${(shared(h))}`);
}

/** Each club's full carry (yards) as the scripted golfer judges it. */
const FULL: Record<string, number> = { driver: 267, wood3: 252, hybrid4: 229, iron5: 205, iron7: 175, iron9: 153, pw: 139, sw: 109 };

/** How big the course's blocks are (the tiles the world stamps). */
function shared(h: Headless): string {
  const def = h.host.sim.def;
  const tiles = def.world?.structures ?? [];
  let cells = 0;
  for (const t of tiles) {
    const b = t as unknown as { size: { x: number; y: number; z: number } };
    cells += b.size.x * b.size.y * b.size.z;
  }
  return `${tiles.length} course tiles, ${(cells / 1e6).toFixed(2)} M cells; scale ${S} blocks a metre`;
}

/** The course as built: every pin on its green at a whole block, tees clear, holes apart. */
function courseSane() {
  for (const h of course.holes) {
    const pin = h.green.pin;
    const g = course.ground(pin.x, pin.z);
    check(g.surf === Surf.Green, `hole ${h.index + 1}: the pin is on the green (${g.surf})`);
    check(Math.abs(pin.y - Math.round(pin.y)) < 1e-6, `hole ${h.index + 1}: the pin's height is a whole block (${pin.y})`);
    const s = course.slope(pin.x, pin.z);
    check(Math.hypot(s.x, s.z) < 0.045, `hole ${h.index + 1}: the pin isn't on a steep slope (${(Math.hypot(s.x, s.z) * 100).toFixed(1)}%)`);
    const tee = course.point(h.index, 1.2, 0);
    check(course.ground(tee.x, tee.z).surf === Surf.Tee, `hole ${h.index + 1}: the ball tees up on the tee box`);
    const cart = course.ground(h.cartTee.x, h.cartTee.z).surf;
    check(cart !== Surf.Water && cart !== Surf.Green, `hole ${h.index + 1}: the cart parks on dry ground`);
  }
  // No two holes' lines of play within 50 blocks (but where one ends and the next begins).
  let near = Infinity;
  for (const a of course.holes)
    for (const b of course.holes) {
      if (b.index <= a.index + 1) continue;
      for (let v = 0; v <= a.len; v += 6)
        for (let w = 0; w <= b.len; w += 6) {
          const p = course.point(a.index, v, 0);
          const q = course.point(b.index, w, 0);
          near = Math.min(near, Math.hypot(p.x - q.x, p.z - q.z));
        }
    }
  check(near > 50, `the holes keep apart (closest ${near.toFixed(0)} blocks)`);
  console.log(`  the course: 18 pins on their greens, tees and carts clear, holes at least ${near.toFixed(0)} blocks apart`);

  // The flagstick: a firm putt straight at it (on a flat green) rattles off it when it's in, and
  // never meets it when it's out.
  const green = {
    ground: () => ({ y: 0, surf: Surf.Green }),
    slope: (_x: number, _z: number, o = { x: 0, z: 0 }) => ((o.x = 0), (o.z = 0), o),
    blockTop: () => 0,
    treesNear: () => [],
    inBounds: () => true,
  };
  const pin = { x: 0, y: 0, z: 0 };
  const putt = (flagstick: boolean) => simulate(green, { x: 0, y: 0, z: 2.5, speed: 2.4, yaw: 0, angle: 0, spin: 0, tilt: 0, roll: 1, wind: { x: 0, z: 0 }, pin, flagstick, seed: 1 });
  const hit = (r: ReturnType<typeof simulate>) => r.events.some((e) => e.kind === 'pin');
  const inCup = putt(true);
  const outCup = putt(false);
  check(hit(inCup) && !hit(outCup), `the pin in, it's hit (${inCup.events.map((e) => e.kind)}); out, it isn't (${outCup.events.map((e) => e.kind)})`);
  console.log(`  a firm putt at the pin: in, ${inCup.outcome} off the stick; out, ${outCup.outcome}`);
}

/** Two golfers at once: each their own ball, round and card. */
function twoGolfers() {
  const h = launch('golf', { seed: 5 });
  const bot = h.ctx.bots.add('Second');
  h.run(1, { dt: 1 / 30 });
  const balls = () => h.calls.filter((c) => c.target === 'message' && c.method === MSG.ball).map((c) => c.args[0] as { id: string; at: unknown });
  const ids = new Set(balls().map((b) => b.id));
  check(ids.has(h.ctx.player.id) && ids.has(bot.id), `a ball each: ${[...ids]}`);
  // The bot steps up (the caddie), and so do we; we drive, the bot's ball stays put.
  bot.controls.press('KeyF');
  h.run(0.3, { dt: 1 / 30, pilot: () => ({ pressed: ['KeyF'] }) });
  check(bot.frozen && h.ctx.player.frozen, 'both golfers at their balls');
  const a = course.holes[0];
  h.send({ t: 'game', player: h.ctx.player.id, name: MSG.swing, data: { club: 'driver', power: 1, accuracy: 0.1, spin: 0, curve: 0, yaw: a.tee.yaw } });
  h.run(0.2, { dt: 1 / 30 });
  const shot = h.calls.filter((c) => c.target === 'message' && c.method === MSG.shot).map((c) => c.args[0] as ShotMsg).at(-1);
  check(shot?.id === h.ctx.player.id && shot.total > 250, `our drive: ${shot?.total} yards`);
  h.run(16, { dt: 1 / 30 });
  const theirs = balls().filter((b) => b.id === bot.id).at(-1) as { at: { x: number; z: number } | null } | undefined;
  const tee = course.point(0, 1.2, 0);
  check(!!theirs?.at && Math.hypot(theirs.at.x - tee.x, theirs.at.z - tee.z) < 0.1, "the second golfer's ball is still on the tee");
  check(bot.frozen, 'the second golfer is still over their ball');

  // Straight from over the ball to another tee (the /hole cheat): the swing lets the camera go.
  const me = h.ctx.player;
  h.run(0.3, { dt: 1 / 30, pilot: () => ({ pressed: ['KeyF'] }) });
  check(me.frozen, 'over our ball again');
  const before = h.calls.length;
  h.host.command(me.id, { t: 'exec', id: 1, line: 'hole 5' });
  h.run(0.2, { dt: 1 / 30 });
  const sent = h.calls.slice(before).filter((c) => c.target === 'message');
  const round = sent.filter((c) => c.method === MSG.round).at(-1)?.args[0] as RoundMsg | undefined;
  check(sent.some((c) => c.method === MSG.release), `/hole from over the ball releases the swing: ${sent.map((c) => c.method)}`);
  check(round?.hole === 4 && round.mode === 'walk' && !me.frozen, `on the fifth tee, walking: ${round?.hole} ${round?.mode}`);
  console.log(`  two golfers: a ball each; we drove ${shot!.total} yards while the other waited over theirs; /hole from over the ball lets go`);
}
