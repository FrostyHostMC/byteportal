import { CHARACTER_STYLE, Models, type Behavior, type DamageEvent, type GameContext } from '@platform';
import { MONSTER_MODELS } from './models';
import type { MonsterKind } from './registry';
import { flat, grounded, held, ring, shakeNear } from './util';

/**
 * The Golem: three metres of stone, slow and hard to hurt (armour turns aside a third of every
 * blow; blasts crack it as they would a wall). Close up it swings a fist. Its great move is the
 * ground pound: it stops, raises both arms, its runes blaze, a ring spreads on the sand round it,
 * and then it brings them down: whoever's still standing in the ring is hurt and thrown. Jump it,
 * roll out, or be somewhere else.
 */

interface GolemState {
  _cd?: number;
  _pound?: number;
  _tell?: number;
  _punch?: number;
  _step?: number;
}

const RUNE = '#ffa83a';
const POUND = { radius: 5.5, time: 1.25, damage: [9, 4] as [number, number] };

function slam(game: GameContext, self: Parameters<Behavior>[0]) {
  const e = self.position;
  self.animate('none');
  self.glow(null);
  game.audio.play('pound', { at: e, volume: 1.4 });
  game.fx.shockwave({ x: e.x, y: e.y + 0.15, z: e.z }, POUND.radius, '#d8c08a');
  game.fx.burst({ x: e.x, y: e.y + 0.3, z: e.z }, { color: '#c8b080', count: 50, speed: 7, size: 0.2, gravity: 10, life: 0.9, drag: 1.5 });
  shakeNear(game, e, 0.45, 0.5);
  for (const p of grounded(game, e, POUND.radius)) {
    const d = flat(p.position, e);
    const t = Math.min(1, d / POUND.radius);
    const l = d || 1;
    if (p.damage(POUND.damage[0] + (POUND.damage[1] - POUND.damage[0]) * t, { source: self, knockback: 0, cause: 'melee' })) p.impulse(((p.position.x - e.x) / l) * 7, 8, ((p.position.z - e.z) / l) * 7);
  }
}

const golemAI: Behavior = (self, game, dt) => {
  const s = self.data as GolemState;
  if (
    held(self, () => {
      const had = s._pound !== undefined || s._tell !== undefined;
      s._pound = s._tell = undefined;
      return had;
    })
  )
    return;
  s._cd = (s._cd ?? game.rng.range(3, 5)) - dt;
  s._punch = Math.max(0, (s._punch ?? 1) - dt);
  const target = self.nearestPlayer();
  if (!target) {
    self.stop();
    return;
  }
  const e = self.position;
  const d = self.distanceTo(target);
  if (s._pound !== undefined) {
    // Arms raised, runes blazing, the ring spreading: then down.
    self.stop();
    s._pound -= dt;
    if (s._pound > 0) return;
    s._pound = undefined;
    slam(game, self);
    s._cd = game.rng.range(6, 8);
    s._punch = 1.2;
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
    game.audio.play('golem_punch', { at: e });
    if (d < 3.6 && self.canSee(target)) target.damage(6, { source: self, knockback: 2.2, cause: 'melee' });
    s._punch = 2;
    return;
  }
  self.lookAt(d < 12 ? target : null);
  self.moveTo(target);
  // Footfalls: the ground shakes a little near it.
  s._step = (s._step ?? 0) - dt * Math.hypot(self.velocity.x, self.velocity.z);
  if (s._step <= 0) {
    s._step = 1.6;
    game.audio.play('golem_step', { at: e, volume: 0.8 });
  }
  if (s._cd <= 0 && d < POUND.radius + 1.5 && self.onGround) {
    s._pound = POUND.time;
    self.stop();
    self.animate('raise');
    self.glow(RUNE);
    game.audio.play('golem_charge', { at: e, volume: 1.2 });
    ring(game, e, POUND.radius, POUND.time, RUNE);
    return;
  }
  if (d < 3.4 && s._punch === 0 && self.canSee(target)) {
    s._tell = 0.55;
    self.stop();
    self.glow(RUNE);
    game.audio.play('golem', { at: e, pitch: 1.2 });
  }
};

/** Blasts crack a Golem: half again as hard on it. */
export function golemCracks(hit: DamageEvent) {
  if (hit.target.kind === 'entity' && hit.target.type === 'golem' && hit.cause === 'explosion') hit.amount *= 1.5;
}

const LOOK = Models.gltf(MONSTER_MODELS.golem, {
  rig: 'humanoid',
  ...CHARACTER_STYLE,
  poses: { ...CHARACTER_STYLE.poses, gait: { stride: [2.2, 3], step: [0.3, 0.5], lift: [0.14, 0.22], bob: [0.05, 0.08], lean: [0.02, 0.06], armSwing: [0.22, 0.35], width: 0.2 } },
});

export const golem: MonsterKind = {
  id: 'golem',
  cost: 6,
  from: 9,
  weight: 0.4,
  max: 2,
  role: 'heavy',
  single: true,
  tip: 'Raised arms and a ring on the sand: jump, roll or get clear. Bombs crack it',
  color: '#ffa83a',
  define: () => ({
    name: 'Golem',
    model: LOOK,
    hitbox: { width: 1.5, height: 2.8 },
    health: 95,
    speed: 2.1,
    knockbackResistance: 1,
    ai: golemAI,
    drops: [
      { item: 'health_potion', chance: 1 },
      { item: 'bomb_bundle', chance: 0.7, count: 2 },
    ],
    sounds: { ambient: 'golem', hurt: 'golem_hurt', death: 'golem_death' },
    bloodColor: '#9a9284',
  }),
  spawned(_game, e) {
    e.armor = 8;
  },
  slain(game, e) {
    // It falls to pieces: rubble and dust, and the ground shakes.
    const q = e.position;
    game.fx.burst({ x: q.x, y: q.y + 1.5, z: q.z }, { color: '#8c867a', count: 40, speed: 5, size: 0.3, gravity: 18, life: 1.2 });
    game.fx.burst({ x: q.x, y: q.y + 0.5, z: q.z }, { color: '#c8b080', count: 40, speed: 3, size: 0.25, gravity: -0.5, life: 1.4, drag: 2 });
    game.fx.burst({ x: q.x, y: q.y + 2, z: q.z }, { color: RUNE, count: 20, speed: 3, glow: 1, life: 0.7 });
    shakeNear(game, q, 0.35, 0.6);
  },
};
