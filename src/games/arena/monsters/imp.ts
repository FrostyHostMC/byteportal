import { CHARACTER_STYLE, Models, type Behavior, type GameContext, type Player, type ProjectileSpec } from '@platform';
import { MONSTER_MODELS } from './models';
import type { MonsterKind } from './registry';
import { held, inward } from './util';

/**
 * The Imp: a little winged devil, quick and never still, hopping about at a distance and lobbing
 * balls of fire. Each throw is a cackle and a hand raised blazing first, and the fire arcs, so a
 * fighter who keeps moving sidesteps it; one that lands sets you alight for a moment.
 */

export const FIREBALL: ProjectileSpec = { glow: '#ff8a2a', speed: 15, gravity: 9, damage: 3, knockback: 0.5, weapon: 'imp_fire' };

interface ImpState {
  _cd?: number;
  _tell?: number;
  _hop?: number;
  _flee?: number;
  _strafe?: number;
  _flip?: number;
}

const impAI: Behavior = (self, game, dt) => {
  const s = self.data as ImpState;
  if (held(self, () => s._tell !== undefined && ((s._tell = undefined), true))) return;
  s._cd = (s._cd ?? game.rng.range(1.2, 2.5)) - dt;
  s._hop = (s._hop ?? game.rng.range(0.5, 1.5)) - dt;
  s._flee = Math.max(0, (s._flee ?? 0) - dt);
  s._flip = (s._flip ?? 0) - dt;
  if (s._flip <= 0) {
    s._strafe = game.rng.chance(0.5) ? 1 : -1;
    s._flip = game.rng.range(1, 2.5);
  }
  const target = self.nearestPlayer();
  if (!target) {
    self.stop();
    return;
  }
  const e = self.position;
  const p = target.position;
  const d = self.distanceTo(target);
  self.lookAt(target);
  if (s._tell !== undefined) {
    // A ball of fire held up, blazing: thrown in a moment.
    self.stop();
    s._tell -= dt;
    if (s._tell > 0) return;
    s._tell = undefined;
    self.glow(null);
    self.animate('attack');
    if (self.canSee(target)) {
      self.shoot(FIREBALL, target, { lead: 0.35, spread: 0.04 });
      game.audio.play('fireball', { at: e });
    }
    s._cd = game.rng.range(2.4, 3.4);
    return;
  }
  const l = Math.hypot(e.x - p.x, e.z - p.z) || 1;
  const nx = (e.x - p.x) / l;
  const nz = (e.z - p.z) / l;
  // Too close: a spring back out of reach, wings flapping.
  if (d < 3 && s._flee === 0 && self.onGround) {
    s._flee = 2.5;
    self.impulse(nx * 7 - nz * (s._strafe ?? 1) * 3, 7, nz * 7 + nx * (s._strafe ?? 1) * 3);
    game.audio.play('imp', { at: e, pitch: 1.3, volume: 0.7 });
    return;
  }
  if (!self.canSee(target) || d > 15) {
    self.moveTo(target);
  } else {
    const away = d < 6 ? 1 : d > 11 ? -1 : 0;
    const st = (s._strafe ?? 1) * 0.8;
    const [ix, iz] = inward(e);
    self.moveDirection(nx * away - nz * st + ix, nz * away + nx * st + iz);
    // Never still: a hop now and then.
    if (s._hop <= 0 && self.onGround) {
      s._hop = game.rng.range(0.7, 1.6);
      self.jump();
    }
    if (s._cd <= 0 && d < 15 && self.onGround) {
      s._tell = 0.55;
      self.animate('raise');
      self.glow('#ff9a2a');
      game.audio.play('imp', { at: e });
    }
  }
};

/** A fireball that landed sets them alight: a few licks of fire over a second and a half. */
export function impFire(game: GameContext, p: Player) {
  for (let n = 1; n <= 3; n++)
    game.clock.after(n * 0.5, () => {
      if (!p.alive) return;
      p.damage(0.5, { cause: 'fire', knockback: 0 });
      const q = p.position;
      game.fx.burst({ x: q.x, y: q.y + 1, z: q.z }, { color: '#ff8a2a', count: 8, speed: 1.5, gravity: -3, glow: 1, life: 0.5 });
    });
  p.fx.flash('#ff7a2a', 0.25, 0.3);
}

const LOOK = Models.gltf(MONSTER_MODELS.imp, { rig: 'humanoid', ...CHARACTER_STYLE, scale: 0.62 });

export const imp: MonsterKind = {
  id: 'imp',
  cost: 1.5,
  from: 5,
  weight: 1,
  role: 'ranged',
  tip: 'It lobs fire: keep moving, and run it down',
  color: '#ff8a2a',
  define: () => ({
    name: 'Imp',
    model: LOOK,
    hitbox: { width: 0.5, height: 1.15 },
    health: 11,
    speed: 4.4,
    jump: 9,
    ai: impAI,
    drops: [{ item: 'heart', chance: 0.12 }],
    sounds: { ambient: 'imp', hurt: 'imp_hurt' },
    bloodColor: '#ff6a2a',
  }),
  slain(game, e) {
    // Gone in a puff of brimstone.
    const q = e.position;
    game.fx.burst({ x: q.x, y: q.y + 0.6, z: q.z }, { color: '#ff8a2a', count: 16, speed: 2.5, gravity: -3, glow: 1, life: 0.5 });
    game.fx.burst({ x: q.x, y: q.y + 0.6, z: q.z }, { color: '#3a2a26', count: 14, speed: 1.5, size: 0.2, gravity: -2, life: 0.9, drag: 2 });
  },
};
