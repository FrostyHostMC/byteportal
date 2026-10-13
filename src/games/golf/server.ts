import { defineServer, math, type GameContext, type Player, type Prop, type PropModel, type Vec3 } from '@platform';
import { ATLAS_NAME, paintAtlas, spriteOf } from './art';
import { freshCart, type CartState } from './cart';
import { CART_MODELS } from './carts';
import { CLUBS, clubOf, lieEffect, strike, type Swing } from './clubs';
import { course, Surf, SURF_NAMES } from './course';
import { WINDS, mph } from './course/wind';
import { HZ, puttSpeed, simulate, type ShotResult } from './physics';
import { flagItem, MSG, type AddressMsg, type BallMsg, type RoundMsg, type ShotMsg } from './protocol';
import { S, dirOf, feet, yards, yawOf } from './scale';
import { shared } from './shared';

/**
 * Blockyard Links' rules. Everyone plays their own round (stroke play), on the same course at the
 * same time: each golfer has a ball, a cart and a card. Walking up to the ball (E) steps up to it:
 * the swing is on the golfer's screen (`client/swing.ts`), which sends the strike here; the server
 * plays the shot out on the course (`physics.ts`) and tells every screen, which flies it. Water is
 * a stroke and a drop, out of bounds stroke and distance, and a hole is picked up at four over par.
 */

type Mode = RoundMsg['mode'];

interface Golfer {
  p: Player;
  hole: number;
  /** Strokes on this hole (penalties included). */
  strokes: number;
  card: (number | null)[];
  /** Where the ball lies (null while it flies, or once it's holed). */
  ball: Vec3 | null;
  lie: Surf;
  /** Where the last stroke was played from (stroke and distance). */
  prev: Vec3 | null;
  prevLie: Surf;
  mode: Mode;
  cart: Prop;
  cartYaw: number;
  color: string;
  /** When the flight (or the celebration) ends, by the game's clock. */
  until: number;
  shot: ShotResult | null;
  /** What the last stroke was: from where, with what, how far out. */
  from: { surf: Surf; club: string; tee: boolean; toPin: number; onGreen: boolean } | null;
  toasted: number;
  /** Holes skipped with `/hole`: the round doesn't count. */
  practice: boolean;
  putts: number;
}

const golfers = new Map<string, Golfer>();
let cartModels: PropModel[] = [];
let joined = 0;
/** Each club's full carry and roll on flat fairway (yards): the caddie's book. */
const BOOK = new Map<string, { carry: number; total: number }>();

const COLORS = ['#ffffff', '#6fc2ff', '#ff8a7a', '#ffd84d', '#c79bff', '#ffab4d', '#6cf0d8', '#ff9bd2'];
const GOLD = '#ffd84d';
const GREEN = '#9be26b';

const golferOf = (p: Player) => golfers.get(p.id) ?? null;
const holeOf = (g: Golfer) => course.holes[Math.min(g.hole, 17)];
const maxStrokes = (par: number) => par + 4;

function scoreName(strokes: number, par: number): string {
  if (strokes === 1) return 'Hole in one!';
  const d = strokes - par;
  return d <= -3 ? 'Albatross!' : d === -2 ? 'Eagle!' : d === -1 ? 'Birdie!' : d === 0 ? 'Par' : d === 1 ? 'Bogey' : d === 2 ? 'Double bogey' : d === 3 ? 'Triple bogey' : `${d} over`;
}

const toParText = (n: number) => (n === 0 ? 'E' : n > 0 ? `+${n}` : `${n}`);

function toPar(g: Golfer) {
  let strokes = 0;
  let par = 0;
  g.card.forEach((s, i) => {
    if (s === null) return;
    strokes += s;
    par += course.holes[i].par;
  });
  return { strokes, par, diff: strokes - par };
}

// ---------------------------------------------------------------------------------------------
// What the screens hear
// ---------------------------------------------------------------------------------------------

function ballMsg(g: Golfer): BallMsg {
  return { id: g.p.id, name: g.p.name, at: g.ball && g.mode !== 'flight' ? { x: g.ball.x, y: g.ball.y, z: g.ball.z } : null, color: g.color };
}

function sendBall(game: GameContext, g: Golfer) {
  game.clients.send('all', MSG.ball, ballMsg(g));
}

function sendRound(game: GameContext, g: Golfer) {
  if (g.p.bot) return;
  const t = toPar(g);
  const msg: RoundMsg = {
    hole: g.hole,
    strokes: g.strokes,
    card: g.card,
    total: t.strokes,
    toPar: t.diff,
    wind: WINDS[Math.min(g.hole, 17)],
    mode: g.mode,
    ball: g.ball,
    lie: g.ball ? g.lie : null,
    cart: g.p.vehicle ? null : { x: g.cart.position.x, y: g.cart.position.y, z: g.cart.position.z },
  };
  game.clients.send(g.p, MSG.round, msg);
}

function scoreboard(game: GameContext) {
  const rows = [...golfers.values()]
    .map((g) => {
      const t = toPar(g);
      const thru = g.card.filter((s) => s !== null).length;
      return { g, t, thru };
    })
    .sort((a, b) => a.t.diff - b.t.diff || b.thru - a.thru)
    .map(({ g, t, thru }) => ({
      name: g.p.name,
      values: [g.mode === 'done' ? 'F' : String(g.hole + 1), thru === 0 ? '-' : toParText(t.diff), t.strokes || '-', g.mode === 'done' ? '' : String(g.strokes)],
      color: g.color,
      player: g.p,
    }));
  game.hud.scoreboard({ title: 'Stonebyte Links', columns: ['Hole', 'To par', 'Total', 'Strokes'], rows, footer: 'Stroke play · par 72' });
}

// ---------------------------------------------------------------------------------------------
// The round
// ---------------------------------------------------------------------------------------------

function join(game: GameContext, p: Player): Golfer {
  const color = COLORS[joined % COLORS.length];
  const cart = game.props.spawn(cartModels[joined % cartModels.length]);
  joined++;
  const g: Golfer = {
    p,
    hole: 0,
    strokes: 0,
    card: new Array(18).fill(null),
    ball: null,
    lie: Surf.Tee,
    prev: null,
    prevLie: Surf.Tee,
    mode: 'walk',
    cart,
    cartYaw: 0,
    color,
    until: 0,
    shot: null,
    from: null,
    toasted: -10,
    practice: false,
    putts: 0,
  };
  golfers.set(p.id, g);
  p.color = color;
  p.inventory.clear();
  for (const c of CLUBS) p.inventory.give(c.id);
  teeUp(game, g, 0);
  return g;
}

/** To a hole's tee: the ball teed up, the golfer beside it, their cart parked by the path. */
function teeUp(game: GameContext, g: Golfer, hole: number) {
  if (g.p.vehicle) g.p.leaveVehicle();
  g.p.freeze(false);
  g.hole = hole;
  g.strokes = 0;
  g.putts = 0;
  g.mode = 'walk';
  g.prev = null;
  g.shot = null;
  const h = course.holes[hole];
  const at = course.point(hole, 1.2, 0);
  g.ball = { x: at.x, y: course.height(at.x, at.z), z: at.z };
  g.lie = Surf.Tee;
  parkCart(g, h.cartTee.x, h.cartTee.z, h.cartTee.yaw);
  const stand = course.point(hole, -1.5, -2.2);
  g.p.teleport({ x: stand.x, y: course.blockTop(stand.x, stand.z) + 0.02, z: stand.z }, h.tee.yaw, -0.05);
  send(game, g);
  // Straight from over a ball (`/hole`): the swing gives the camera back.
  game.clients.send(g.p, MSG.release, {});
  const w = WINDS[hole];
  g.p.hud.banner(`Hole ${hole + 1} · ${h.name}`, `Par ${h.par} · ${h.yards} yards · wind ${mph(w)} mph`, { duration: 3.2, color: GREEN });
  g.p.audio.play('golf_tee');
}

function send(game: GameContext, g: Golfer) {
  sendBall(game, g);
  sendRound(game, g);
  scoreboard(game);
}

function parkCart(g: Golfer, x: number, z: number, yaw: number) {
  g.cartYaw = yaw;
  const s = freshCart(x, z, yaw);
  g.cart.position.set(s.x, s.y + 0.02, s.z);
  g.cart.quaternion.setFromEuler(new math.Euler(0, yaw, 0, 'YXZ'));
}

/** How near your cart you need to be for E to get you in. */
const CART_REACH = 12;

/** Your cart, brought round to you (beside you, facing the way you look). */
function callCart(game: GameContext, g: Golfer) {
  const p = g.p.position;
  const d = dirOf(g.p.yaw);
  for (const [side, back] of [
    [2.2, 0],
    [-2.2, 0],
    [0, 3],
    [3.5, 1],
    [-3.5, 1],
  ]) {
    const x = p.x + d.z * side - d.x * back;
    const z = p.z - d.x * side - d.z * back;
    const s = course.ground(x, z).surf;
    if (s === Surf.Water || s === Surf.Green || course.treesNear(x, z).some((t) => (t.x - x) ** 2 + (t.z - z) ** 2 < 2.5)) continue;
    parkCart(g, x, z, g.p.yaw);
    sendRound(game, g);
    g.p.hud.toast('Your cart’s here · E to drive');
    g.p.audio.play('golf_cart_on');
    return;
  }
  g.p.hud.toast('No room for the cart here');
}

function enterCart(game: GameContext, g: Golfer) {
  const s = freshCart(g.cart.position.x, g.cart.position.z, g.cartYaw);
  g.p.drive<CartState>('cart', s, { prop: g.cart });
  g.mode = 'drive';
  g.p.audio.play('golf_cart_on');
  sendRound(game, g);
}

/** Out of the cart, standing beside it on the left. */
function leaveCart(g: Golfer) {
  const v = g.p.vehicle;
  if (!v) return;
  const s = v.state as CartState;
  g.cartYaw = s.yaw;
  g.p.leaveVehicle();
  // Driving held their body still (it rode along); out of the seat, it's theirs again.
  g.p.freeze(false);
  const d = dirOf(s.yaw);
  for (const side of [1.7, -1.7, 2.6, -2.6]) {
    const x = s.x + d.z * side;
    const z = s.z - d.x * side;
    const surf = course.ground(x, z).surf;
    if (surf === Surf.Water) continue;
    g.p.teleport({ x, y: course.blockTop(x, z) + 0.05, z }, s.yaw, -0.1);
    break;
  }
  g.mode = 'walk';
}

/** The caddie hands them a club for this shot. */
function suggest(g: Golfer): string {
  const h = holeOf(g);
  const b = g.ball!;
  const pin = h.green.pin;
  const dist = yards(Math.hypot(pin.x - b.x, pin.z - b.z));
  if (g.lie === Surf.Green || (g.lie === Surf.Fringe && dist < 18) || (course.onGreen(g.hole, b.x, b.z) && dist < 40)) return 'putter';
  if (g.strokes === 0 && h.par > 3) return 'driver';
  const effect = (id: string) => lieEffect(g.lie, clubOf(id)!).speed ** 1.6;
  // The shortest club that carries it there (from this lie), or the longest that's sensible.
  const bad = g.lie === Surf.Sand || g.lie === Surf.Deep || g.lie === Surf.Out;
  const order = CLUBS.filter((c) => !c.putter && (c.id !== 'driver' || g.lie === Surf.Tee) && !(bad && c.wood)).reverse();
  for (const c of order) {
    const book = BOOK.get(c.id)!;
    if (book.carry * effect(c.id) >= dist - 4) return c.id;
  }
  return g.lie === Surf.Tee ? 'driver' : bad ? 'hybrid4' : 'wood3';
}

/** Step up to the ball: frozen beside it, facing the target; their screen runs the swing. */
function address(game: GameContext, g: Golfer) {
  if (!g.ball || g.mode === 'holed' || g.mode === 'done') return;
  if (g.p.vehicle) leaveCart(g);
  const h = holeOf(g);
  const pin = h.green.pin;
  const b = g.ball;
  const yaw = g.strokes === 0 && h.par > 3 ? h.tee.yaw : yawOf(pin.x - b.x, pin.z - b.z);
  const d = dirOf(yaw);
  // A right-hander's stance: left of the ball, facing along the line.
  const sx = b.x + d.z * 0.85;
  const sz = b.z - d.x * 0.85;
  g.p.teleport({ x: sx, y: course.blockTop(sx, sz) + 0.02, z: sz }, yaw, -0.25);
  // The body held still (not the hands: the swing's clicks and the club's slot are theirs).
  g.p.freeze(true);
  g.mode = 'address';
  const club = suggest(g);
  const slot = CLUBS.findIndex((c) => c.id === club);
  if (slot >= 0) g.p.inventory.select(slot);
  const msg: AddressMsg = { hole: g.hole, ball: { ...b }, lie: g.lie, stroke: g.strokes + 1, wind: WINDS[g.hole], yaw, club };
  game.clients.send(g.p, MSG.address, msg);
  sendRound(game, g);
}

function release(game: GameContext, g: Golfer) {
  g.p.freeze(false);
  if (g.mode === 'address' || g.mode === 'flight') g.mode = 'walk';
  game.clients.send(g.p, MSG.release, {});
  sendRound(game, g);
}

/** The caddie's lift: to the ball, the cart brought round behind it. */
function toBall(game: GameContext, g: Golfer) {
  if (!g.ball || g.mode === 'flight' || g.mode === 'holed' || g.mode === 'done') return;
  if (g.p.vehicle) leaveCart(g);
  const h = holeOf(g);
  const b = g.ball;
  const pin = h.green.pin;
  const back = dirOf(yawOf(b.x - pin.x, b.z - pin.z));
  for (const k of [7, 10, 14, 5, 18]) {
    for (const side of [0, 4, -4, 8, -8]) {
      const x = b.x + back.x * k + back.z * side;
      const z = b.z + back.z * k - back.x * side;
      const s = course.ground(x, z).surf;
      if (s === Surf.Water || s === Surf.Green || s === Surf.Sand) continue;
      if (course.treesNear(x, z).some((t) => (t.x - x) ** 2 + (t.z - z) ** 2 < 4)) continue;
      parkCart(g, x, z, yawOf(pin.x - x, pin.z - z));
      address(game, g);
      return;
    }
  }
  address(game, g);
}

/** The strike, from their screen: play the shot out and tell everyone. */
function swing(game: GameContext, g: Golfer, data: unknown) {
  if (g.mode !== 'address' || !g.ball) return;
  const d = data as Partial<Swing>;
  const num = (v: unknown, lo: number, hi: number, dflt: number) => (typeof v === 'number' && Number.isFinite(v) ? Math.max(lo, Math.min(hi, v)) : dflt);
  const club = clubOf(typeof d.club === 'string' ? d.club : null);
  if (!club || !g.p.inventory.count(club.id)) return;
  const s: Swing = {
    club: club.id,
    power: num(d.power, 0, 1.1, 0),
    accuracy: num(d.accuracy, -2, 2, 0),
    spin: num(d.spin, -1, 1, 0),
    curve: num(d.curve, -1, 1, 0),
    yaw: num(d.yaw, -100, 100, g.p.yaw),
    scale: num(d.scale, 1, 60, 10),
  };
  if (s.power < 0.01) return;
  const h = holeOf(g);
  const pin = h.green.pin;
  const b = g.ball;
  const st = strike(club, s, g.lie, () => game.rng.next(), puttSpeed);
  const wind = club.putter ? { x: 0, z: 0 } : WINDS[g.hole];
  const result = simulate(course, {
    x: b.x,
    y: b.y,
    z: b.z,
    speed: st.speed,
    yaw: s.yaw + st.face,
    angle: st.angle,
    spin: st.spin,
    tilt: st.tilt,
    roll: st.roll,
    wind,
    pin,
    // On the green the pin's been taken out; from anywhere else it's in.
    flagstick: g.lie !== Surf.Green,
    seed: Math.floor(game.rng.next() * 2 ** 31),
  });
  g.from = { surf: g.lie, club: club.id, tee: g.strokes === 0, toPin: Math.hypot(pin.x - b.x, pin.z - b.z), onGreen: g.lie === Surf.Green };
  g.strokes++;
  if (club.putter) g.putts++;
  g.prev = { ...b };
  g.prevLie = g.lie;
  g.shot = result;
  g.mode = 'flight';
  g.until = game.clock.now + result.time + (result.outcome === 'holed' ? 0.6 : 1);
  const msg: ShotMsg = {
    id: g.p.id,
    path: result.path,
    hz: HZ,
    events: result.events,
    outcome: result.outcome,
    club: club.id,
    quality: st.quality,
    carry: Math.round(yards(result.carry)),
    total: Math.round(yards(result.total)),
    hole: g.hole,
    color: g.color,
  };
  game.clients.send('all', MSG.shot, msg);
  // Everyone else hears the strike (the striker's screen played it at the click).
  for (const o of game.players) if (o !== g.p) o.audio.play(club.putter ? 'golf_putt' : club.wood ? 'golf_drive' : 'golf_iron', { at: b });
  sendBall(game, g);
  sendRound(game, g);
}

/** The ball has stopped (or dropped, or splashed): where it lies now, and what's next. */
function settle(game: GameContext, g: Golfer) {
  const r = g.shot!;
  const h = holeOf(g);
  g.shot = null;
  if (r.outcome === 'holed') return holeOut(game, g);
  if (r.outcome === 'water') {
    g.strokes++;
    g.ball = r.drop ?? g.prev;
    g.lie = g.ball ? course.ground(g.ball.x, g.ball.z).surf : g.prevLie;
    g.p.hud.toast('In the water: one stroke penalty, a drop where it went in');
    g.p.achieve('splash');
  } else if (r.outcome === 'ob') {
    g.strokes++;
    g.ball = g.prev;
    g.lie = g.prevLie;
    g.p.hud.toast('Out of bounds: stroke and distance, play again from where you were');
  } else {
    g.ball = { ...r.end };
    g.lie = r.surf;
    const f = g.from;
    if (f?.tee && f.club === 'driver' && yards(r.total) >= 300) g.p.achieve('big_drive');
    if (!(g.lie === Surf.Green || g.lie === Surf.Fringe)) g.p.hud.toast(`${SURF_NAMES[g.lie].replace(/^./, (c) => c.toUpperCase())} · ${Math.round(yards(Math.hypot(h.green.pin.x - r.end.x, h.green.pin.z - r.end.z)))} yards to the pin`);
  }
  if (g.strokes >= maxStrokes(h.par)) return pickUp(game, g);
  g.mode = 'walk';
  sendBall(game, g);
  // Close to it (a putt, a chip)? Straight back to it. Otherwise, off they go.
  const p = g.p.position;
  if (g.ball && Math.hypot(p.x - g.ball.x, p.z - g.ball.z) < 14) address(game, g);
  else release(game, g);
  scoreboard(game);
}

function holeOut(game: GameContext, g: Golfer) {
  const h = holeOf(g);
  const f = g.from;
  g.card[g.hole] = g.strokes;
  g.mode = 'holed';
  g.ball = null;
  g.until = game.clock.now + 3.4;
  const d = g.strokes - h.par;
  const name = scoreName(g.strokes, h.par);
  g.p.hud.banner(name, `${g.strokes} ${g.strokes === 1 ? 'stroke' : 'strokes'} · ${toParText(toPar(g).diff)} for the round`, { duration: 3, color: d < 0 ? GOLD : GREEN });
  const pin = h.green.pin;
  game.audio.play('golf_cup', { at: pin });
  if (d < 0) {
    g.p.audio.play('golf_cheer');
    game.fx.fireworks({ x: pin.x, y: pin.y + 2, z: pin.z }, d <= -2 ? 6 : 2);
  }
  if (game.players.length > 1) game.hud.feed(`${g.p.name}: ${name.replace(/!$/, '').toLowerCase()} on ${g.hole + 1}`, { color: d < 0 ? GOLD : undefined });
  if (d <= 0) g.p.achieve('par');
  if (d <= -1) g.p.achieve('birdie');
  if (d <= -2) g.p.achieve('eagle');
  if (g.strokes === 1) g.p.achieve('ace');
  if (f && !f.onGreen && !f.tee) g.p.achieve('chip_in');
  if (f && f.onGreen && feet(f.toPin) >= 30) g.p.achieve('long_putt');
  if (f && f.surf === Surf.Sand) g.p.achieve('sandy');
  if (g.hole === 8) g.p.achieve('front_nine');
  send(game, g);
  game.clients.send(g.p, MSG.release, {});
}

function pickUp(game: GameContext, g: Golfer) {
  const h = holeOf(g);
  g.card[g.hole] = maxStrokes(h.par);
  g.mode = 'holed';
  g.ball = null;
  g.until = game.clock.now + 2.6;
  g.p.hud.banner('Picked up', `${maxStrokes(h.par)} on the card · on to the next`, { duration: 2.4 });
  send(game, g);
  game.clients.send(g.p, MSG.release, {});
}

function nextHole(game: GameContext, g: Golfer) {
  if (g.hole >= 17) return finishRound(game, g);
  teeUp(game, g, g.hole + 1);
}

function finishRound(game: GameContext, g: Golfer) {
  g.mode = 'done';
  g.p.freeze(false);
  const t = toPar(g);
  const front = g.card.slice(0, 9).reduce<number>((a, s) => a + (s ?? 0), 0);
  const back = g.card.slice(9).reduce<number>((a, s) => a + (s ?? 0), 0);
  const counts = !g.practice;
  const best = g.p.store.get<number>('best');
  const pb = counts && (best === undefined || t.strokes < best);
  if (counts) {
    g.p.achieve('round');
    if (t.diff < 0) g.p.achieve('under_par');
    g.p.store.set('rounds', (g.p.store.get<number>('rounds') ?? 0) + 1);
    if (pb) {
      g.p.store.set('best', t.strokes);
      if (g.p.account) game.store.set(`board:${g.p.account.id}`, { name: g.p.name, strokes: t.strokes });
    }
  }
  const board = game.store
    .keys('board:')
    .map((k) => game.store.get<{ name: string; strokes: number }>(k)!)
    .filter(Boolean)
    .sort((a, b) => a.strokes - b.strokes);
  const birdies = g.card.filter((s, i) => s !== null && s < course.holes[i].par).length;
  g.p.audio.play('victory');
  send(game, g);
  g.p.hud.screen({
    title: pb ? 'A new best round!' : 'Round complete',
    subtitle: counts ? `${t.strokes} strokes, ${toParText(t.diff)}.` : `${t.strokes} strokes (a practice round: holes were skipped).`,
    tone: 'victory',
    icon: { item: 'putter' },
    stats: [
      ['Out · In', `${front} · ${back}`],
      ['Total', `${t.strokes} (${toParText(t.diff)})`],
      ['Birdies or better', String(birdies)],
      ['Best round', best === undefined && !pb ? '—' : String(pb ? t.strokes : best)],
      ...board.slice(0, 5).map((e, i): [string, string] => [`#${i + 1}  ${e.name}${e.name === g.p.name ? ' (you)' : ''}`, String(e.strokes)]),
    ],
    buttons: [
      { label: 'Play again', primary: true, onClick: () => restartRound(game, g) },
      { label: 'Look around', onClick: () => {} },
      { label: 'Switch game', onClick: () => game.exit() },
    ],
  });
}

function restartRound(game: GameContext, g: Golfer) {
  g.card = new Array(18).fill(null);
  g.practice = false;
  teeUp(game, g, 0);
}

// ---------------------------------------------------------------------------------------------
// Each tick
// ---------------------------------------------------------------------------------------------

function tick(game: GameContext, g: Golfer) {
  const input = g.p.input;
  const now = game.clock.now;
  switch (g.mode) {
    case 'walk': {
      if (input.pressed('KeyF')) return toBall(game, g);
      if (input.pressed('KeyC')) return callCart(game, g);
      if (!input.pressed('KeyE')) return;
      const p = g.p.position;
      const b = g.ball;
      if (b && Math.hypot(p.x - b.x, p.z - b.z) < 3.2 && Math.abs(p.y - b.y) < 3) return address(game, g);
      // Your cart, if it's anywhere near: you walk over and get in.
      const c = g.cart.position;
      if (Math.hypot(p.x - c.x, p.z - c.z) < CART_REACH && Math.abs(p.y - c.y) < 6) return enterCart(game, g);
      g.p.hud.toast(b ? `Your ball is ${Math.round(yards(Math.hypot(p.x - b.x, p.z - b.z)))} yards away · C: call your cart · F: the caddie takes you to your ball` : 'Nothing to do here');
      return;
    }
    case 'drive': {
      const v = g.p.vehicle;
      if (!v) {
        g.mode = 'walk';
        return;
      }
      const s = v.state as CartState;
      if (input.pressed('KeyF')) return toBall(game, g);
      if (input.pressed('KeyE')) {
        const b = g.ball;
        if (b && Math.hypot(s.x - b.x, s.z - b.z) < 9) return address(game, g);
        leaveCart(g);
        sendRound(game, g);
        return;
      }
      if (s.blocked && s.blocked !== 3 && now - g.toasted > 3) {
        g.toasted = now;
        g.p.hud.toast(s.blocked === 2 ? 'Keep the cart off the greens' : 'Carts don’t float');
      }
      return;
    }
    case 'address':
      if (input.pressed('KeyE')) release(game, g);
      return;
    case 'flight':
      if (now >= g.until) settle(game, g);
      return;
    case 'holed':
      if (now >= g.until) nextHole(game, g);
      return;
    case 'done':
      return;
  }
}

export default defineServer(shared, {
  items: [],
  setup(game) {
    game.items.atlas(ATLAS_NAME, paintAtlas());
    for (const c of CLUBS) {
      game.items.define(c.id, { kind: 'club', name: c.name, icon: spriteOf(c.id), stack: 1, hold: { style: 'sword', scale: 1.1 } });
    }
    game.items.define('golf_ball', { kind: 'misc', name: 'Golf Ball', icon: spriteOf('ball') });
    // The course's squares, as each screen draws them (their models are made there: client/terrain.ts).
    for (const c of course.chunks) game.items.define(c.id, { kind: 'misc', name: 'Course' });
    course.holes.forEach((_, i) => game.items.define(flagItem(i), { kind: 'misc', name: 'Flagstick' }));
    cartModels = CART_MODELS.map((url) => game.props.gltf(url, { radius: 1.6 }));
    // The caddie's book: every club's full carry off a good lie.
    for (const c of CLUBS) {
      if (c.putter) continue;
      const st = strike(c, { club: c.id, power: 1, accuracy: 0, spin: 0, curve: 0, yaw: 0 }, Surf.Fairway, () => 0.5, puttSpeed);
      const flat = {
        ground: () => ({ y: 0, surf: Surf.Fairway }),
        slope: (_x: number, _z: number, out = { x: 0, z: 0 }) => ((out.x = 0), (out.z = 0), out),
        blockTop: () => 0,
        treesNear: () => [],
        inBounds: () => true,
      };
      const r = simulate(flat, { x: 0, y: 0, z: 0, speed: st.speed, yaw: 0, angle: st.angle, spin: st.spin, tilt: 0, wind: { x: 0, z: 0 }, pin: { x: 1e6, y: 0, z: 1e6 }, seed: 1 });
      BOOK.set(c.id, { carry: yards(r.carry), total: yards(r.total) });
    }

    game.events.on('playerJoin', ({ player }) => {
      if (!golfers.has(player.id)) join(game, player);
    });
    game.events.on('playerReady', ({ player }) => {
      for (const g of golfers.values()) game.clients.send(player, MSG.ball, ballMsg(g));
      const g = golferOf(player);
      if (g) sendRound(game, g);
    });
    game.events.on('playerLeave', ({ player }) => {
      const g = golferOf(player);
      if (!g) return;
      golfers.delete(player.id);
      g.cart.remove();
      game.clients.send('all', MSG.ball, { id: player.id, name: player.name, at: null, color: g.color } satisfies BallMsg);
      scoreboard(game);
    });
    game.events.on('clientMessage', ({ player, name, data }) => {
      const g = golferOf(player);
      if (g && name === MSG.swing) swing(game, g, data);
    });

    game.commands.register('hole', {
      usage: '<1-18>',
      help: 'Go to a hole (a practice round from then on)',
      cheat: true,
      complete: () => course.holes.map((_, i) => String(i + 1)),
      run: ([n], _game, player) => {
        const g = golferOf(player);
        const i = Number(n) - 1;
        if (!g || !(i >= 0 && i < 18)) throw new Error('Which hole? 1 to 18');
        g.practice = true;
        teeUp(game, g, i);
        return `Hole ${i + 1}`;
      },
    });
    game.commands.register('drop', {
      usage: '[feet]',
      help: 'Practice: your ball on the green, this far from the hole (a practice round from then on)',
      cheat: true,
      run: ([n], _game, player) => {
        const g = golferOf(player);
        if (!g || g.mode === 'holed' || g.mode === 'done' || g.mode === 'flight') throw new Error('Not now');
        const h = holeOf(g);
        const pin = h.green.pin;
        const ft = Math.max(1, Math.min(60, Number(n) || 15));
        const d = ft * 0.3048 * S;
        // Out from the hole toward the front of the green, onto it.
        const back = dirOf(yawOf(-h.green.dx, -h.green.dz));
        let at = { x: pin.x + back.x * d, z: pin.z + back.z * d };
        for (let a = 0; a < 12 && !course.onGreen(g.hole, at.x, at.z); a++) {
          const turn = (a + 1) * 0.5;
          at = { x: pin.x + Math.cos(turn) * d, z: pin.z + Math.sin(turn) * d };
        }
        g.practice = true;
        g.ball = { x: at.x, y: course.height(at.x, at.z), z: at.z };
        g.lie = course.ground(at.x, at.z).surf;
        address(game, g);
        sendBall(game, g);
        return `On the green, ${ft} feet out`;
      },
    });
    game.commands.register('pickup', {
      help: 'Pick up your ball: par plus four on the card, on to the next hole',
      run: (_args, _game, player) => {
        const g = golferOf(player);
        if (!g || g.mode === 'holed' || g.mode === 'done' || g.mode === 'flight') throw new Error('Not now');
        release(game, g);
        pickUp(game, g);
        return 'Picked up';
      },
    });
  },

  start(game) {
    // A restart takes the props away: every golfer gets a cart again and starts at the first.
    joined = 0;
    const players = [...game.players];
    golfers.clear();
    for (const p of players) join(game, p);
    game.hud.crosshair(false);
  },

  update(game) {
    for (const g of golfers.values()) tick(game, g);
  },
});
