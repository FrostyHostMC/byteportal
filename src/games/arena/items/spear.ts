import { math, type Entity, type GameContext, type ItemBody, type ItemUse, type Player, type Prop, type PropModel, type Vec3 } from '@platform';
import { bus } from '../run/bus';
import { armsHost, type ArmsMelee, type SpearThrow } from './melee';
import { stagger } from './status';

/**
 * The spear thrown: the right button raises it, letting go throws it where they look. It flies in
 * an arc through whatever it meets (`pierce` of them), and sticks where it lands. Walk over it to
 * take it back, press the right button to call it back (it flies home through everything in its
 * way, hitting them again), or after a few seconds it comes back on its own. While it's away the
 * hand is empty; caught, it's back in hand. Skypiercer, the legendary, goes through everything and
 * calls down lightning where it lands.
 */
interface Thrown {
  p: Player;
  item: string;
  def: SpearThrow;
  legend: boolean;
  prop: Prop;
  pos: math.Vector3;
  vel: math.Vector3;
  phase: 'flying' | 'stuck' | 'back';
  /** Seconds in this phase. */
  t: number;
  hit: Set<Entity>;
  left: number;
}

const GRAVITY = 16;
/** How fast it flies home, and how near it must come to be caught (or walked over to be picked up). */
const HOME = 30;
const CATCH = 1.5;
const FWD = new math.Vector3(0, 0, 1);
const _d = new math.Vector3();

const out = new Map<Player, Thrown>();
const models = new Map<string, PropModel>();

/** The spears' models (each rarity's), as props (in `setup`): the size a fighter holds one at. */
export function spearModels(game: GameContext, urls: Record<string, string>) {
  models.clear();
  for (const [item, url] of Object.entries(urls)) models.set(item, game.props.gltf(url, { radius: 2, scale: 0.55 }));
}

export const spearOut = (p: Player): boolean => out.has(p);

/** Thrown from their hand, along their view, lobbed a little. */
export function throwSpear(use: ItemUse<ArmsMelee>, item: string, def: SpearThrow) {
  const p = use.player;
  const game = use.game;
  const model = models.get(item);
  if (!model || out.has(p) || !p.inventory.take(item, 1)) return;
  const eye = p.eye;
  const look = p.look;
  const rx = Math.cos(p.yaw);
  const rz = -Math.sin(p.yaw);
  const pos = new math.Vector3(eye.x + look.x * 0.5 + rx * 0.25, eye.y - 0.15 + look.y * 0.5, eye.z + look.z * 0.5 + rz * 0.25);
  const vel = new math.Vector3(look.x, look.y + 0.06, look.z).normalize().multiplyScalar(def.speed);
  const prop = game.props.spawn(model, { position: pos });
  prop.quaternion.setFromUnitVectors(FWD, _d.copy(vel).normalize());
  const legend = item.endsWith('_legendary');
  out.set(p, { p, item, def, legend, prop, pos, vel, phase: 'flying', t: 0, hit: new Set(), left: legend ? 99 : def.pierce });
  use.host.swing(p);
  p.viewModel.play('arena_spear_throw');
  game.audio.play('arena_spear_throw', { at: eye });
}

/** Called back: it flies home now. */
export function recallSpear(game: GameContext, p: Player) {
  const s = out.get(p);
  if (!s || s.phase === 'back') return;
  s.phase = 'back';
  s.t = 0;
  s.hit.clear();
  game.audio.play('arena_spear_recall', { at: s.pos });
}

const _min = { x: 0, y: 0, z: 0 };
const _max = { x: 0, y: 0, z: 0 };

/** Monsters whose boxes the segment from `a` along `dir` for `len` passes through, nearest first. */
function along(bodies: ItemBody[], a: Vec3, dir: Vec3, len: number, skip: Set<Entity>): Entity[] {
  const met: { e: Entity; t: number }[] = [];
  for (const b of bodies) {
    const e = b.target as Entity;
    if (skip.has(e) || !e.alive) continue;
    const hw = b.width / 2 + 0.3;
    _min.x = b.feet.x - hw;
    _min.y = b.feet.y - 0.2;
    _min.z = b.feet.z - hw;
    _max.x = b.feet.x + hw;
    _max.y = b.feet.y + b.height + 0.2;
    _max.z = b.feet.z + hw;
    const t = math.rayBox(a, dir, _min, _max);
    if (t !== null && t <= len) met.push({ e, t });
  }
  return met.sort((x, y) => x.t - y.t).map((m) => m.e);
}

/** Every tick: spears flying, stuck, or flying home. */
export function updateSpears(game: GameContext, dt: number) {
  if (!out.size) return;
  const bodies = armsHost()?.bodies().filter((b) => b.target.kind === 'entity') ?? [];
  for (const s of [...out.values()]) {
    s.t += dt;
    const p = s.p;
    if (!game.players.includes(p)) {
      s.prop.remove();
      out.delete(p);
      continue;
    }
    if (s.phase === 'flying') fly(game, s, bodies, dt);
    else if (s.phase === 'stuck') {
      const q = p.position;
      const near = p.alive && Math.hypot(q.x - s.pos.x, q.y + 0.9 - s.pos.y, q.z - s.pos.z) < CATCH + 0.6;
      if (near) catchIt(game, s);
      else if (!p.alive) s.t = 0;
      else if (s.t >= s.def.back * mods.back(p)) recallSpear(game, p);
    } else home(game, s, bodies, dt);
  }
}

function fly(game: GameContext, s: Thrown, bodies: ItemBody[], dt: number) {
  s.vel.y -= GRAVITY * dt;
  const step = s.vel.length() * dt;
  _d.copy(s.vel).normalize();
  const wall = game.world.raycast(s.pos, _d, step + 0.4);
  const reach = wall ? Math.max(0, Math.hypot(wall.point.x - s.pos.x, wall.point.y - s.pos.y, wall.point.z - s.pos.z) - 0.4) : step;
  for (const e of along(bodies, s.pos, _d, reach, s.hit)) {
    if (s.left <= 0) break;
    if (s.hit.size === 2) bus.emit('feat', { player: s.p, name: 'skewer', text: 'Skewered three!' });
    s.hit.add(e);
    s.left--;
    const amount = s.def.damage;
    if (e.damage(amount, { source: s.p, knockback: 0.9, weapon: s.item, cause: 'projectile', from: s.pos })) {
      game.audio.play('arena_spear_hit', { at: e.position });
      stagger(game, e, 0.35);
      s.p.hud.pop(e.alive ? 'Hit' : 'Skewered!', { color: '#ffd36b' });
    }
  }
  if (wall) {
    // It sticks where it struck, a little into the face.
    s.pos.set(wall.point.x - _d.x * 0.25, wall.point.y - _d.y * 0.25, wall.point.z - _d.z * 0.25);
    s.prop.position.copy(s.pos);
    s.phase = 'stuck';
    s.t = 0;
    game.audio.play('arena_spear_stick', { at: s.pos });
    game.fx.burst({ x: s.pos.x, y: s.pos.y, z: s.pos.z }, { color: '#c8b088', count: 12, speed: 2.4, size: 0.12, gravity: 8, life: 0.5 });
    if (s.legend) skyStrike(game, s);
    return;
  }
  s.pos.addScaledVector(s.vel, dt);
  s.prop.position.copy(s.pos);
  s.prop.quaternion.setFromUnitVectors(FWD, _d);
  // Thrown off the edge of everything: it comes home.
  if (s.t > 4) recallSpear(game, s.p);
}

/** Flying home to their hand, through whatever's in the way. */
function home(game: GameContext, s: Thrown, bodies: ItemBody[], dt: number) {
  const q = s.p.eye;
  const to = { x: q.x - s.pos.x, y: q.y - 0.3 - s.pos.y, z: q.z - s.pos.z };
  const d = Math.hypot(to.x, to.y, to.z);
  if (d < CATCH || !s.p.alive) {
    if (s.p.alive) catchIt(game, s);
    else {
      // Its owner's down: it waits where it is, and comes home a while after they're back.
      s.phase = 'stuck';
      s.t = 0;
    }
    return;
  }
  _d.set(to.x / d, to.y / d, to.z / d);
  const step = Math.min(d, HOME * dt);
  for (const e of along(bodies, s.pos, _d, step, s.hit)) {
    s.hit.add(e);
    if (e.damage(s.def.damage * 0.6 * mods.home(s.p), { source: s.p, knockback: 0.6, weapon: s.item, cause: 'projectile', from: s.pos })) game.audio.play('arena_spear_hit', { at: e.position, pitch: 1.2 });
  }
  s.pos.addScaledVector(_d, step);
  s.prop.position.copy(s.pos);
  s.prop.quaternion.setFromUnitVectors(FWD, _d.negate());
}

/** Back in their hand (in the slot it left, if that's still free). */
function catchIt(game: GameContext, s: Thrown) {
  const p = s.p;
  s.prop.remove();
  out.delete(p);
  const inv = p.inventory;
  const was = inv.selected;
  const emptyHand = !inv.held;
  inv.give(s.item);
  if (emptyHand) {
    const at = inv.slots.findIndex((x) => x?.item === s.item);
    if (at >= 0 && at !== was) inv.select(at);
  }
  game.audio.play('arena_spear_catch', { at: p.eye });
}

/** Skypiercer: lightning where it lands. */
function skyStrike(game: GameContext, s: Thrown) {
  const q = { x: s.pos.x, y: s.pos.y, z: s.pos.z };
  const bolt = game.props.bolt({ color: '#d8ecff', length: 16, width: 0.5, intensity: 8, flicker: 0.6 });
  bolt.position.set(q.x, q.y + 16, q.z);
  bolt.quaternion.setFromUnitVectors(new math.Vector3(0, 0, -1), new math.Vector3(0, -1, 0));
  game.clock.after(0.22, () => bolt.remove());
  game.fx.shockwave({ x: q.x, y: q.y + 0.1, z: q.z }, 3.5, '#9fd4ff');
  game.audio.play('thunder', { at: q });
  for (const e of game.entities.near(q, 3.5)) if (e.alive) e.damage(12, { source: s.p, knockback: 0.8, weapon: s.item, cause: 'lightning' });
}

/** Boomerang (a blessing): times the damage on the way home, and times the wait before it comes back (`blessings.ts` sets them). */
let mods = { home: (_p: Player) => 1, back: (_p: Player) => 1 };
export const setSpearMods = (m: typeof mods) => void (mods = m);

/** A fresh fight: every spear in the air or the sand is gone (everyone's armed afresh). */
export function clearSpears() {
  for (const s of out.values()) s.prop.remove();
  out.clear();
}
