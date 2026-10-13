import { CHARACTER_STYLE, Models, type Behavior, type DamageEvent, type Entity, type GameContext, type Player } from '@platform';
import { bossKind } from '../bosses';
import { MONSTER_MODELS } from './models';
import type { MonsterKind } from './registry';
import { ahead, heading, held, near, shakeNear, show } from './util';

/**
 * The Minotaur: a bull-headed brute with a double axe. Close up it chops. From across the pit it
 * charges: it stops, paws the sand and bellows while a line spreads along the ground where it will
 * run (the tell), then thunders down it, trampling whatever's in the way, monsters too. Step aside
 * or roll, and if it runs into a wall it's stunned, its head ringing, and takes half again from
 * every blow until it shakes it off.
 */

interface MinotaurState {
  _cd?: number;
  _tell?: number;
  _paw?: number;
  _dir?: number;
  _charge?: number;
  _stun?: number;
  _swing?: number;
  _dust?: number;
  /** Who it's trampled this charge (fighters' ids and monsters'). */
  _hit?: (string | number)[];
}

const CHARGE = { range: [6, 18] as [number, number], tell: 1.1, time: 1.8, speed: 4, damage: 9 };
const RED = '#ff4a2a';

const stunned = (e: Entity) => ((e.data as MinotaurState)._stun ?? 0) > 0;

function endCharge(self: Entity, s: MinotaurState) {
  s._charge = undefined;
  self.setSpeed((self.data.speed as number | undefined) ?? 1);
  self.stop();
}

const minotaurAI: Behavior = (self, game, dt) => {
  const s = self.data as MinotaurState;
  if (
    held(self, () => {
      const had = s._paw !== undefined || s._tell !== undefined;
      if (s._charge !== undefined) endCharge(self, s);
      s._paw = s._tell = undefined;
      return had;
    })
  )
    return;
  s._cd = (s._cd ?? game.rng.range(2, 4)) - dt;
  s._swing = Math.max(0, (s._swing ?? 1) - dt);
  const e = self.position;
  // Stunned: reeling, stars about its head.
  if (stunned(self)) {
    s._stun! -= dt;
    self.stop();
    if (s._stun! <= 0) self.glow(null);
    return;
  }
  // Charging: down the line, trampling.
  if (s._charge !== undefined) {
    s._charge -= dt;
    const d = s._dir ?? 0;
    self.moveDirection(Math.sin(d), Math.cos(d));
    self.lookAt(ahead(e, d, 5, 1.6));
    s._dust = (s._dust ?? 0) - dt;
    if (s._dust <= 0) {
      s._dust = 0.12;
      game.fx.burst({ x: e.x, y: e.y + 0.15, z: e.z }, { color: '#c8b080', count: 5, speed: 2, size: 0.18, gravity: -0.5, life: 0.6, drag: 2 });
    }
    trample(game, self, s);
    const v = self.velocity;
    const sp = Math.hypot(v.x, v.z);
    // Into a wall: stunned.
    if (s._charge < CHARGE.time - 0.35 && sp < 3) {
      endCharge(self, s);
      s._stun = 2.4;
      self.glow('#ffe14a');
      game.audio.play('crash', { at: e, volume: 1.3 });
      game.fx.burst({ x: e.x, y: e.y + 2.4, z: e.z }, { color: '#ffe14a', count: 24, speed: 3, gravity: 2, glow: 1, life: 0.9 });
      shakeNear(game, e, 0.35, 0.4);
      show(game, 'dazed', { id: self.id, time: 2.4 });
      s._cd = game.rng.range(5, 7);
      return;
    }
    if (s._charge <= 0) {
      endCharge(self, s);
      s._cd = game.rng.range(4, 6);
    }
    return;
  }
  const target = self.nearestPlayer();
  if (!target) {
    self.stop();
    return;
  }
  const p = target.position;
  const d = self.distanceTo(target);
  // Pawing the ground, head down, the line laid out ahead of it: then off.
  if (s._paw !== undefined) {
    self.stop();
    s._paw -= dt;
    self.lookAt(ahead(e, s._dir ?? 0, 5, 1.2));
    if (Math.floor((s._paw + dt) / 0.35) !== Math.floor(s._paw / 0.35)) game.fx.burst({ x: e.x, y: e.y + 0.1, z: e.z }, { color: '#c8b080', count: 8, speed: 2.5, size: 0.15, gravity: 6, life: 0.5 });
    if (s._paw > 0) return;
    s._paw = undefined;
    self.glow(null);
    self.animate('none');
    s._charge = CHARGE.time;
    s._hit = [];
    self.setSpeed(((self.data.speed as number | undefined) ?? 1) * CHARGE.speed);
    game.audio.play('stampede', { at: e, volume: 1.2 });
    return;
  }
  if (s._tell !== undefined) {
    self.stop();
    self.lookAt(target);
    s._tell -= dt;
    if (s._tell > 0) return;
    s._tell = undefined;
    self.glow(null);
    self.animate('attack');
    game.audio.play('knight_swing', { at: e, pitch: 0.7 });
    if (d < 3.3 && self.canSee(target)) target.damage(7, { source: self, knockback: 1.8, cause: 'melee' });
    s._swing = 1.6;
    return;
  }
  self.moveTo(target);
  self.lookAt(d < 14 ? target : null);
  if (s._cd <= 0 && d > CHARGE.range[0] && d < CHARGE.range[1] && self.canSee(target) && self.onGround) {
    // Aim where they are now: they've the whole tell to get out of the way.
    s._dir = heading(e, p);
    s._paw = CHARGE.tell;
    self.stop();
    self.animate('raise');
    self.glow(RED);
    game.audio.play('bellow', { at: e, volume: 1.3 });
    show(game, 'line', { x: e.x, y: e.y, z: e.z, dir: s._dir, length: Math.min(CHARGE.range[1], d + 6), width: 1.6, time: CHARGE.tell, color: RED });
    return;
  }
  if (d < 3 && s._swing === 0 && self.canSee(target)) {
    s._tell = 0.6;
    self.stop();
    self.animate('raise');
    self.glow('#ffb43a');
    game.audio.play('minotaur', { at: e, pitch: 1.2 });
  }
};

/** Whatever's in its way as it charges: fighters gored and thrown, monsters bowled aside. */
function trample(game: GameContext, self: Entity, s: MinotaurState) {
  const e = self.position;
  const dir = s._dir ?? 0;
  const hit = (s._hit ??= []);
  for (const p of game.players) {
    if (!p.alive || p.spectating || hit.includes(p.id)) continue;
    const q = p.position;
    if (Math.hypot(q.x - e.x, q.z - e.z) < 1.7 && Math.abs(q.y - e.y) < 2) {
      hit.push(p.id);
      gore(game, self, p, dir);
    }
  }
  for (const o of near(game, e, 1.9, self)) {
    if (hit.includes(o.id) || bossKind(o.type)) continue;
    hit.push(o.id);
    const side = Math.sign(Math.sin(heading(e, o.position) - dir)) || 1;
    o.impulse(Math.cos(dir) * side * 7, 5, -Math.sin(dir) * side * 7);
    o.damage(4, { source: self, knockback: 0, cause: 'melee' });
  }
}

function gore(game: GameContext, self: Entity, p: Player, dir: number) {
  if (!p.damage(CHARGE.damage, { source: self, knockback: 0, cause: 'melee' })) return;
  p.impulse(Math.sin(dir) * 12, 7, Math.cos(dir) * 12);
  game.audio.play('golem_punch', { at: p.position, pitch: 1.2 });
}

/** Stunned, its guard's down: half again from every blow. */
export function minotaurDazed(hit: DamageEvent) {
  if (hit.target.kind === 'entity' && hit.target.type === 'minotaur' && stunned(hit.target)) hit.amount *= 1.5;
}

const LOOK = Models.gltf(MONSTER_MODELS.minotaur, { rig: 'humanoid', ...CHARACTER_STYLE, scale: 1.25 });

export const minotaur: MonsterKind = {
  id: 'minotaur',
  cost: 5,
  from: 8,
  weight: 0.5,
  max: 2,
  role: 'heavy',
  single: true,
  tip: 'It paws the sand, then charges down the line: step aside, and it stuns itself on the wall',
  color: RED,
  define: () => ({
    name: 'Minotaur',
    model: LOOK,
    hitbox: { width: 0.95, height: 2.4 },
    health: 70,
    speed: 3,
    knockbackResistance: 0.85,
    ai: minotaurAI,
    drops: [
      { item: 'health_potion', chance: 0.8 },
      { item: 'heart', chance: 0.5, count: 2 },
    ],
    sounds: { ambient: 'minotaur', hurt: 'minotaur_hurt', death: 'minotaur_death' },
    bloodColor: '#7a2f22',
  }),
};

