import { math, type Entity, type GameContext, type ItemBody, type Player, type Prop, type PropModel, type Vec3 } from '@platform';
import { armsHost } from './melee';

/**
 * What the arsenal looses that flies: crossbow bolts, fireballs, frost shards, the Sunderer's wave.
 * Each flies straight (its prop `launch`ed, so every screen moves it itself and nothing is sent
 * while it flies), and the host steps it each tick: through the monsters' boxes along the way
 * (each hit once, up to `pierce` of them), until a wall or its `life` stops it. What a hit or the
 * end does is the missile's own (`hit`, `end`).
 */
export interface MissileSpec {
  /** A glowing streak (`props.bolt`'s options) or a model (a prop model, its +z the tip). */
  look: { streak: { color: string; length: number; width: number; intensity: number; flicker?: number } } | { model: PropModel };
  speed: number;
  /** Seconds it flies at most. */
  life: number;
  /** How near a body it must pass to hit it (blocks). */
  radius: number;
  /** How many it can hit before it's spent. */
  pierce: number;
  damage: number;
  knockback: number;
  weapon: string;
  cause?: string;
  /** Seconds it stays stuck in a wall (a bolt), else it's gone where it stops. */
  stick?: number;
  /**
   * Puffs behind it every so often, drawn by each screen as it flies (`client/fx.ts`): colour,
   * seconds between; `end`, a puff of that colour where it stops (a shard shattering).
   */
  trail?: { color: string; every: number; size?: number; end?: string };
  /** After it hits someone (the damage done): its own effects; how much the next takes (times). */
  hit?(game: GameContext, m: Missile, e: Entity): void;
  /** Where it stopped: a wall (with the face's normal), spent, or out of time. */
  end?(game: GameContext, m: Missile, at: Vec3, wall: Vec3 | null): void;
}

export interface Missile {
  spec: MissileSpec;
  by: Player;
  pos: math.Vector3;
  vel: math.Vector3;
  dir: math.Vector3;
  prop: Prop;
  age: number;
  left: number;
  damage: number;
  hit: Set<Entity>;
  /** Its number, for the screens drawing its trail (0: none). */
  n: number;
}

const FWD_STREAK = new math.Vector3(0, 0, -1);
const FWD_MODEL = new math.Vector3(0, 0, 1);
const flying: Missile[] = [];
const stuck: { prop: Prop; until: number }[] = [];
let trails = 0;

/** Loose one from `from` along `dir` (a unit vector). */
export function launch(game: GameContext, by: Player, spec: MissileSpec, from: Vec3, dir: Vec3): Missile {
  const d = new math.Vector3(dir.x, dir.y, dir.z).normalize();
  const prop = 'streak' in spec.look ? game.props.bolt(spec.look.streak) : game.props.spawn(spec.look.model);
  prop.quaternion.setFromUnitVectors('streak' in spec.look ? FWD_STREAK : FWD_MODEL, d);
  const vel = d.clone().multiplyScalar(spec.speed);
  prop.launch(from, vel, { by });
  const m: Missile = { spec, by, pos: new math.Vector3(from.x, from.y, from.z), vel, dir: d, prop, age: 0, left: spec.pierce, damage: spec.damage, hit: new Set(), n: 0 };
  flying.push(m);
  // Its trail is each screen's to draw, from where and how fast it goes (one word now, one as it lands).
  if (spec.trail) {
    m.n = ++trails;
    const t = spec.trail;
    game.clients.send('all', 'armory.trail', { n: m.n, x: from.x, y: from.y, z: from.z, vx: vel.x, vy: vel.y, vz: vel.z, life: spec.life, color: t.color, every: t.every, size: t.size ?? 0.12, end: t.end ?? null });
  }
  return m;
}

const _min = { x: 0, y: 0, z: 0 };
const _max = { x: 0, y: 0, z: 0 };

/** Every tick: each missile on along its path, hitting what it meets. */
export function updateMissiles(game: GameContext, dt: number) {
  const now = game.clock.now;
  for (let i = stuck.length - 1; i >= 0; i--) {
    if (now < stuck[i].until) continue;
    stuck[i].prop.remove();
    stuck.splice(i, 1);
  }
  if (!flying.length) return;
  const bodies: ItemBody[] = armsHost()?.bodies().filter((b) => b.target.kind === 'entity') ?? [];
  for (let i = flying.length - 1; i >= 0; i--) {
    const m = flying[i];
    const s = m.spec;
    m.age += dt;
    const step = s.speed * dt;
    // A wall ahead within this step?
    const wall = game.world.raycast(m.pos, m.dir, step);
    const reach = wall ? Math.hypot(wall.point.x - m.pos.x, wall.point.y - m.pos.y, wall.point.z - m.pos.z) : step;
    // Who's in the way before it: nearest first.
    const met: { e: Entity; t: number }[] = [];
    for (const b of bodies) {
      const e = b.target as Entity;
      if (m.hit.has(e) || !e.alive) continue;
      const hw = b.width / 2 + s.radius;
      _min.x = b.feet.x - hw;
      _min.y = b.feet.y - s.radius;
      _min.z = b.feet.z - hw;
      _max.x = b.feet.x + hw;
      _max.y = b.feet.y + b.height + s.radius;
      _max.z = b.feet.z + hw;
      const t = math.rayBox(m.pos, m.dir, _min, _max);
      if (t !== null && t <= reach) met.push({ e, t });
    }
    met.sort((a, b) => a.t - b.t);
    let spentAt: Vec3 | null = null;
    for (const { e, t } of met) {
      m.hit.add(e);
      e.damage(m.damage, { source: m.by, knockback: s.knockback, weapon: s.weapon, cause: s.cause ?? 'projectile', from: m.pos });
      s.hit?.(game, m, e);
      if (--m.left <= 0) {
        spentAt = { x: m.pos.x + m.dir.x * t, y: m.pos.y + m.dir.y * t, z: m.pos.z + m.dir.z * t };
        break;
      }
    }
    if (spentAt) {
      finish(game, i, m, spentAt, null);
      continue;
    }
    if (wall) {
      finish(game, i, m, { x: wall.point.x - m.dir.x * 0.05, y: wall.point.y - m.dir.y * 0.05, z: wall.point.z - m.dir.z * 0.05 }, wall.normal);
      continue;
    }
    m.pos.addScaledVector(m.vel, dt);
    if (m.age >= s.life) finish(game, i, m, { x: m.pos.x, y: m.pos.y, z: m.pos.z }, null);
  }
}

/** It stops at `at`: stuck in the wall a while, or gone; its own end. */
function finish(game: GameContext, i: number, m: Missile, at: Vec3, wall: Vec3 | null) {
  flying.splice(i, 1);
  if (m.n) game.clients.send('all', 'armory.land', { n: m.n, x: at.x, y: at.y, z: at.z });
  if (wall && m.spec.stick) {
    // (Setting where it is stops its flight on every screen.)
    m.prop.position.set(at.x, at.y, at.z);
    stuck.push({ prop: m.prop, until: game.clock.now + m.spec.stick });
  } else m.prop.remove();
  m.spec.end?.(game, m, at, wall);
}

/** A fresh fight: nothing in the air or stuck in the walls. */
export function clearMissiles() {
  for (const m of flying) m.prop.remove();
  for (const s of stuck) s.prop.remove();
  flying.length = 0;
  stuck.length = 0;
}

/** The Sunderer's wave of steel: a low crescent that rolls on through everything ahead. */
export function wave(game: GameContext, by: Player, item: string) {
  const eye = by.eye;
  const dir = { x: -Math.sin(by.yaw), y: 0, z: -Math.cos(by.yaw) };
  launch(
    game,
    by,
    {
      look: { streak: { color: '#bfe2ff', length: 0.5, width: 2.4, intensity: 3.5, flicker: 0.2 } },
      speed: 20,
      life: 0.5,
      radius: 0.9,
      pierce: 99,
      damage: 7,
      knockback: 0.9,
      weapon: item,
      cause: 'melee',
      trail: { color: '#d8ecff', every: 0.05, size: 0.16 },
    },
    { x: eye.x + dir.x * 0.8, y: eye.y - 0.7, z: eye.z + dir.z * 0.8 },
    dir,
  );
  game.audio.play('arena_wave', { at: eye });
}
