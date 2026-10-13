import type { Behavior, Entity, GameContext, ProjectileSpec } from './types';

interface MeleeState {
  _cd?: number;
  _wind?: number;
}

/**
 * Built-in AI routines. They only use the public `Entity` / `GameContext` API, so they double
 * as examples: copy one into your game and tweak it.
 */
export const Behaviors = {
  /** Path-find to the nearest player and hit them when in reach, with an optional wind-up. */
  melee(opts: { damage: number; reach?: number; cooldown?: number; windup?: number; knockback?: number }): Behavior {
    const reach = opts.reach ?? 1.8;
    const cooldown = opts.cooldown ?? 1;
    const windup = opts.windup ?? 0.2;
    return (self: Entity, _game: GameContext, dt: number) => {
      const s = self.data as MeleeState;
      s._cd = Math.max(0, (s._cd ?? 0) - dt);
      const target = self.nearestPlayer();
      if (!target) {
        self.stop();
        self.lookAt(null);
        return;
      }
      const d = self.distanceTo(target);
      if (s._wind !== undefined) {
        self.stop();
        self.lookAt(target);
        s._wind -= dt;
        if (s._wind <= 0) {
          s._wind = undefined;
          self.animate('attack');
          if (d <= reach + 0.6 && self.canSee(target)) target.damage(opts.damage, { source: self, knockback: opts.knockback ?? 1, cause: 'melee' });
        }
        return;
      }
      self.moveTo(target);
      self.lookAt(d < 10 ? target : null);
      if (d <= reach && s._cd <= 0 && self.canSee(target)) {
        s._cd = cooldown;
        if (windup > 0) {
          s._wind = windup;
          self.animate('raise');
        } else {
          self.animate('attack');
          target.damage(opts.damage, { source: self, knockback: opts.knockback ?? 1, cause: 'melee' });
        }
      }
    };
  },

  /**
   * Keep a preferred distance from the nearest player, strafe, and shoot when they're visible: a
   * bow drawn for `draw` seconds (arms raised, the tell), then loosed at where they are, give or
   * take `spread` (radians, either way), allowing for only a little of their motion (`lead`, the
   * fraction). Like Minecraft's skeletons: standing still at ten blocks you're hit most of the
   * time; strafing at fifteen, rarely.
   */
  ranged(opts: { projectile: ProjectileSpec; range?: number; preferred?: number; cooldown?: number; draw?: number; spread?: number; lead?: number }): Behavior {
    const range = opts.range ?? 18;
    const preferred = opts.preferred ?? 9;
    const cooldown = opts.cooldown ?? 2;
    const draw = opts.draw ?? 0.5;
    const spread = opts.spread ?? 0.05;
    const lead = opts.lead ?? 0.3;
    return (self: Entity, game: GameContext, dt: number) => {
      const s = self.data as { _cd?: number; _strafe?: number; _flip?: number; _draw?: number };
      s._cd = (s._cd ?? cooldown * (0.5 + game.rng.next())) - dt;
      s._flip = (s._flip ?? 0) - dt;
      if (s._flip <= 0) {
        s._strafe = game.rng.chance(0.5) ? 1 : -1;
        s._flip = game.rng.range(1.5, 3.5);
      }
      const target = self.nearestPlayer();
      const d = target ? self.distanceTo(target) : Infinity;
      if (!target || !self.canSee(target) || d > range) {
        // Lost them: the bow comes down.
        if (s._draw !== undefined) {
          s._draw = undefined;
          self.animate('none');
        }
        if (target) self.moveTo(target);
        else self.stop();
        self.lookAt(null);
        return;
      }
      self.lookAt(target);
      const p = target.position;
      const e = self.position;
      const dx = e.x - p.x;
      const dz = e.z - p.z;
      const l = Math.hypot(dx, dz) || 1;
      const nx = dx / l;
      const nz = dz / l;
      const away = d < preferred - 2 ? 1 : d > preferred + 3 ? -1 : 0;
      const st = (s._strafe ?? 1) * 0.7;
      self.moveDirection(nx * away - nz * st, nz * away + nx * st);
      if (s._draw !== undefined) {
        s._draw -= dt;
        if (s._draw > 0) return;
        s._draw = undefined;
        s._cd = cooldown * game.rng.range(0.8, 1.2);
        self.animate('attack');
        self.shoot(opts.projectile, target, { lead, spread });
      } else if (s._cd <= 0) {
        s._draw = draw;
        self.animate('raise');
      }
    };
  },

  /** Chase the nearest player, then pounce from mid range; hurts on contact. */
  leaper(opts: { damage: number; range?: [number, number]; cooldown?: number; speed?: number; height?: number }): Behavior {
    const [near, far] = opts.range ?? [2.5, 7];
    const cooldown = opts.cooldown ?? 2.5;
    return (self: Entity, _game: GameContext, dt: number) => {
      const s = self.data as { _cd?: number; _hit?: number };
      s._cd = Math.max(0, (s._cd ?? 1) - dt);
      s._hit = Math.max(0, (s._hit ?? 0) - dt);
      const target = self.nearestPlayer();
      if (!target) {
        self.stop();
        self.lookAt(null);
        return;
      }
      const d = self.distanceTo(target);
      self.moveTo(target);
      self.lookAt(d < 12 ? target : null);
      if (self.onGround && d > near && d < far && s._cd <= 0 && self.canSee(target)) {
        const p = target.position;
        const e = self.position;
        const dx = p.x - e.x;
        const dz = p.z - e.z;
        const l = Math.hypot(dx, dz) || 1;
        const sp = opts.speed ?? 9;
        self.impulse((dx / l) * sp, opts.height ?? 6.5, (dz / l) * sp);
        s._cd = cooldown;
      }
      if (d < 1.3 && s._hit <= 0) {
        s._hit = 0.9;
        self.animate('attack');
        target.damage(opts.damage, { source: self, knockback: 0.8, cause: 'melee' });
      }
    };
  },

  /** Run several behaviours in order every frame. */
  all(...behaviors: Behavior[]): Behavior {
    return (self, game, dt) => {
      for (const b of behaviors) b(self, game, dt);
    };
  },
};
