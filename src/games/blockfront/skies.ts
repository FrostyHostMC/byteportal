import { math, type GameContext, type Prop, type PropModel } from '@platform';
import { match } from './match';
import { CRAFT_SCALE, eyeFighter, wingFighter, type SkyCraft } from './skycraft';

/**
 * The sky over the battle: every so often starfighters scream over, far above the posts and out
 * past the map. A pair of the Empire's eye fighters; a pair of the Rebels' wing fighters; or a
 * dogfight, one chasing the other and firing (now and then it gets them, and they go up in a
 * fireball). Scenery only: nothing up there touches the fight.
 *
 * Each craft is a prop flown in a straight line (`launch`: on every screen, nothing sent while it
 * flies) and taken away once it's out past the other side. Each person hears a pass go over as it
 * comes nearest them (the voices are `client/sounds.ts`'s `amb_scream`, `amb_roar` and the
 * cannons' `amb_sky_laser`). Everything runs on `clock.total`: a restart takes the props (and
 * clears the match's timers), and the sky carries on.
 */

type Kind = 'eye' | 'wing';

/** Seconds between passes (the first comes sooner). */
const GAP: [number, number] = [25, 50];
/** A pass starts and ends this far out from the middle of the map, this high over its floor. */
const REACH = 260;
const HEIGHT: [number, number] = [40, 70];
/** Blocks a second: the eye fighters are the faster. */
const SPEED: Record<Kind, number> = { eye: 80, wing: 68 };
/** Each side's cannon fire: colour, and its voice. */
const LASER: Record<Kind, { color: string; voice: string }> = { eye: { color: '#3dff6a', voice: 'amb_sky_laser_imp' }, wing: { color: '#ff3b2f', voice: 'amb_sky_laser' } };
/** How loud a pass is (it's far off: the platform fades a voice with distance). */
const LOUD = 4.5;

const FWD = new math.Vector3(0, 0, -1);
const UP = new math.Vector3(0, 1, 0);
const _q = new math.Quaternion();

interface Model {
  model: PropModel;
  design: SkyCraft;
}

/** A craft in the air: its props (the craft, its flames), where and when it set off, how fast. */
interface Flight {
  props: Prop[];
  from: math.Vector3;
  vel: math.Vector3;
  start: number;
  until: number;
  gone: boolean;
}

let models: Record<Kind, Model> | null = null;
let flights: Flight[] = [];
/** What's to happen later in a pass (a voice, a burst of fire, a fireball), on `clock.total`. */
let cues: { at: number; run: () => void }[] = [];
let next = 0;
let lastNow = 0;

/**
 * The sky's own dice (a small seeded generator): scenery mustn't take numbers from anything the
 * fight draws on.
 */
let seed = 0x5eed;
function random(): number {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
const rand = (a: number, b: number) => a + random() * (b - a);

/** The sky's craft, meshed the first time they fly (a game nobody watches never makes them). */
function craftModels(game: GameContext): Record<Kind, Model> {
  if (models) return models;
  const eye = eyeFighter();
  const wing = wingFighter();
  return (models = {
    eye: { model: game.props.model(eye.blueprint, { scale: CRAFT_SCALE }), design: eye },
    wing: { model: game.props.model(wing.blueprint, { scale: CRAFT_SCALE }), design: wing },
  });
}

/** The sky, clear, and a cheat to send a pass over now (`/sky`). */
export function setupSkies(game: GameContext) {
  seed = Date.now() | 0;
  models = null;
  flights = [];
  cues = [];
  next = game.clock.total + 15;
  lastNow = game.clock.now;
  game.commands.register('sky', {
    usage: '[empire|rebels|dogfight]',
    help: 'Send starfighters over now',
    cheat: true,
    complete: () => ['empire', 'rebels', 'dogfight'],
    run: ([what], g) => {
      const over = pass(g, g.clock.total, what === 'empire' ? 0 : what === 'rebels' ? 0.5 : what === 'dogfight' ? 0.9 : random());
      return `over ${over.x.toFixed(0)} ${over.y.toFixed(0)} ${over.z.toFixed(0)} in ${(REACH / SPEED.eye).toFixed(1)} s`;
    },
  });
}

/** Each step: what's due in the passes under way, the ones out past the map taken away, and a new one now and then. */
export function updateSkies(game: GameContext, _dt: number) {
  const t = game.clock.total;
  // A restart took the props with it.
  if (game.clock.now < lastNow) {
    flights = [];
    cues = [];
  }
  lastNow = game.clock.now;
  if (cues.length) {
    const due = cues.filter((c) => c.at <= t);
    if (due.length) {
      cues = cues.filter((c) => c.at > t);
      for (const c of due) c.run();
    }
  }
  for (const f of flights) if (t >= f.until) land(f);
  flights = flights.filter((f) => !f.gone);
  if (t >= next) {
    // Nobody to see it: no pass.
    const seen = game.players.some((p) => !p.bot);
    next = t + (seen ? rand(GAP[0], GAP[1]) : GAP[0]);
    if (seen) pass(game, t);
  }
}

/** A pass: a pair of either side's, or a dogfight (`r`, 0..1, picks which). Where it crosses the middle. */
function pass(game: GameContext, t: number, r = random()): math.Vector3 {
  const b = match.map.bounds;
  const mid = new math.Vector3((b.min.x + b.max.x) / 2 + rand(-25, 25), match.map.floorY + rand(HEIGHT[0], HEIGHT[1]), (b.min.z + b.max.z) / 2 + rand(-25, 25));
  const a = random() * Math.PI * 2;
  const dir = new math.Vector3(Math.sin(a), rand(-0.04, 0.04), Math.cos(a)).normalize();
  const side = new math.Vector3().crossVectors(dir, UP).normalize();
  if (r < 0.7) {
    // A pair in formation: the wingman out to one side, a little back and down.
    const kind: Kind = r < 0.36 ? 'eye' : 'wing';
    const lead = mid.clone().addScaledVector(dir, -REACH);
    const wingman = lead.clone().addScaledVector(side, rand(9, 13) * (random() < 0.5 ? -1 : 1)).addScaledVector(dir, -rand(8, 14)).addScaledVector(UP, -rand(1, 4));
    const roll = kind === 'wing' ? rand(-0.25, 0.25) : 0;
    const f = fly(game, kind, lead, dir, roll, t);
    fly(game, kind, wingman, dir, roll, t);
    heard(game, f, kind === 'eye' ? 'amb_scream' : 'amb_roar');
    return mid;
  }
  // A dogfight: one runs, the other chases a little above and behind, firing as they cross the map.
  const prey: Kind = random() < 0.55 ? 'eye' : 'wing';
  const hunter: Kind = prey === 'eye' ? 'wing' : 'eye';
  const speed = Math.max(SPEED.eye, SPEED.wing);
  const lead = mid.clone().addScaledVector(dir, -REACH);
  const gap = rand(22, 32);
  const back = lead.clone().addScaledVector(dir, -gap).addScaledVector(UP, rand(2, 5)).addScaledVector(side, rand(-4, 4));
  const runner = fly(game, prey, lead, dir, rand(-0.5, 0.5), t, speed);
  const chaser = fly(game, hunter, back, dir, 0, t, speed);
  heard(game, runner, prey === 'eye' ? 'amb_scream' : 'amb_roar');
  heard(game, chaser, hunter === 'eye' ? 'amb_scream' : 'amb_roar', 0.4);
  // Bursts while the chaser is over the map.
  const over0 = (REACH - gap - 90) / speed;
  const over1 = (REACH - gap + 90) / speed;
  for (let s = over0; s < over1; s += rand(0.9, 1.4)) for (let k = 0; k < 3; k++) cues.push({ at: t + s + k * 0.18, run: () => fire(game, chaser, runner, hunter) });
  // Now and then the chase ends in a fireball, over the middle.
  if (random() < 0.35) cues.push({ at: t + (REACH + rand(-30, 30)) / speed, run: () => downed(game, runner) });
  return mid;
}

/** A craft set flying from `from` along `dir`, `roll` about its nose; its engines' flames ride along. */
function fly(game: GameContext, kind: Kind, from: math.Vector3, dir: math.Vector3, roll: number, t: number, speed = SPEED[kind]): Flight {
  const m = craftModels(game)[kind];
  const craft = game.props.spawn(m.model);
  craft.quaternion.setFromUnitVectors(FWD, dir).multiply(_q.setFromAxisAngle(FWD, roll));
  const props = [craft];
  if (kind === 'wing')
    for (const e of m.design.engines) {
      const fl = game.props.bolt({ color: '#ff8a4a', length: 1.4, width: 0.55, intensity: 3.5, flicker: 0.25 });
      fl.attach(craft);
      fl.position.set(e.x * CRAFT_SCALE, e.y * CRAFT_SCALE, e.z * CRAFT_SCALE);
      fl.quaternion.setFromAxisAngle(UP, Math.PI);
      props.push(fl);
    }
  const vel = dir.clone().multiplyScalar(speed);
  craft.launch(from, vel);
  const f: Flight = { props, from: from.clone(), vel, start: t, until: t + (REACH * 2 + 40) / speed, gone: false };
  flights.push(f);
  return f;
}

/** Where a flight is at `t` (on `clock.total`). */
const at = (f: Flight, t: number) => f.from.clone().addScaledVector(f.vel, t - f.start);

/** Away with it. */
function land(f: Flight) {
  if (f.gone) return;
  f.gone = true;
  for (const p of f.props) p.remove();
}

/**
 * Each person hears it come over: the voice starts a moment before it's nearest them (its howl
 * builds), from the point where it's nearest.
 */
function heard(game: GameContext, f: Flight, voice: string, delay = 0) {
  const v2 = f.vel.lengthSq();
  const span = (REACH * 2) / Math.sqrt(v2);
  for (const p of game.players) {
    if (p.bot) continue;
    const rel = new math.Vector3(p.position.x, p.position.y, p.position.z).sub(f.from);
    const near = Math.max(0, Math.min(span, rel.dot(f.vel) / v2));
    const point = f.from.clone().addScaledVector(f.vel, near);
    cues.push({ at: f.start + Math.max(0, near - 1 + delay), run: () => !f.gone && p.audio.play(voice, { at: { x: point.x, y: point.y, z: point.z }, volume: LOUD, pitch: rand(0.92, 1.08) }) });
  }
}

/** Two bolts from the chaser's cannons at the one it chases (near enough: most miss). */
function fire(game: GameContext, chaser: Flight, prey: Flight, kind: Kind) {
  if (chaser.gone) return;
  const t = game.clock.total;
  const from = at(chaser, t);
  const aim = (prey.gone ? from.clone().addScaledVector(chaser.vel, 1) : at(prey, t + 0.15)).sub(from).normalize();
  const guns = models![kind].design.guns;
  const craft = chaser.props[0];
  for (const g of [guns[Math.floor(random() * guns.length)], guns[Math.floor(random() * guns.length)]]) {
    const muzzle = new math.Vector3(g.x * CRAFT_SCALE, g.y * CRAFT_SCALE, g.z * CRAFT_SCALE).applyQuaternion(craft.quaternion).add(from);
    const dir = aim.clone().add(new math.Vector3(rand(-0.02, 0.02), rand(-0.02, 0.02), rand(-0.02, 0.02))).normalize();
    const bolt = game.props.bolt({ color: LASER[kind].color, length: 5, width: 0.6, intensity: 4, far: 40 });
    bolt.quaternion.setFromUnitVectors(FWD, dir);
    const vel = dir.multiplyScalar(170).add(chaser.vel);
    bolt.launch({ x: muzzle.x, y: muzzle.y, z: muzzle.z }, vel);
    flights.push({ props: [bolt], from: muzzle, vel, start: t, until: t + 1.2, gone: false });
  }
  game.audio.play(LASER[kind].voice, { at: { x: from.x, y: from.y, z: from.z }, volume: 3, pitch: rand(0.9, 1.1) });
}

/** The one being chased goes up in a fireball. */
function downed(game: GameContext, f: Flight) {
  if (f.gone) return;
  const p = at(f, game.clock.total);
  land(f);
  game.fx.explosion({ x: p.x, y: p.y, z: p.z }, { size: 1.7, color: '#ffb347' });
}
