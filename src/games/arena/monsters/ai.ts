import type { Actor, Behavior, Entity, GameContext, ProjectileSpec, Vec3 } from '@platform';
import { map } from '../run/state';
import { spawnMonster } from '../run/spawn';

/**
 * The Arena's own monster brains (the Warden's is in `content.ts`). Each is written to be fair:
 * whatever hurts you is telegraphed first (a raised bow that glows, a hissing keg, a glowing
 * cast), so a player who watches can dodge it.
 */

interface ArcherState {
  _cd?: number;
  _draw?: number;
  _strafe?: number;
  _flip?: number;
  _hp?: number;
}

/** How many skeletons may have a bow drawn at once: a couple, and one more for each extra fighter. */
const volley = (game: GameContext) => 1 + Math.max(1, game.players.filter((p) => p.alive).length);

const drawing = (game: GameContext) => game.entities.all('skeleton').filter((e) => (e.data as ArcherState)._draw !== undefined).length;

/**
 * A skeleton archer. It keeps its distance and strafes, then draws: arms up, glowing, with the
 * creak of a bow (the tell), for `draw` seconds, and looses at where you are (give or take
 * `spread`, allowing for only a little of your motion). Only a few may draw at once (`volley`),
 * so a crowd of them takes turns rather than firing from every side together. Hitting one spoils
 * its shot, and with you in its face it backs off rather than shooting point blank.
 */
export function archer(opts: { projectile: ProjectileSpec; range: number; preferred: number; cooldown: number; draw: number; spread: number; lead: number }): Behavior {
  const { projectile, range, preferred, cooldown, draw, spread, lead } = opts;
  const lower = (self: Entity, s: ArcherState) => {
    s._draw = undefined;
    self.glow(null);
    self.animate('none');
  };
  return (self, game, dt) => {
    const s = self.data as ArcherState;
    s._cd = (s._cd ?? cooldown * (0.4 + game.rng.next())) - dt;
    s._flip = (s._flip ?? 0) - dt;
    if (s._flip <= 0) {
      s._strafe = game.rng.chance(0.5) ? 1 : -1;
      s._flip = game.rng.range(1.5, 3.5);
    }
    // Struck: the shot is spoiled, and it takes a moment to nock another.
    if (self.health < (s._hp ?? self.health)) {
      if (s._draw !== undefined) lower(self, s);
      s._cd = Math.max(s._cd, 1.2);
    }
    s._hp = self.health;

    const target = self.nearestPlayer();
    const d = target ? self.distanceTo(target) : Infinity;
    if (!target || !self.canSee(target) || d > range) {
      if (s._draw !== undefined) lower(self, s);
      if (target) self.moveTo(target);
      else self.stop();
      self.lookAt(null);
      return;
    }
    self.lookAt(target);
    const p = target.position;
    const e = self.position;
    const l = Math.hypot(e.x - p.x, e.z - p.z) || 1;
    const nx = (e.x - p.x) / l;
    const nz = (e.z - p.z) / l;
    const close = d < 3.5;
    const away = close || d < preferred - 3 ? 1 : d > preferred + 3 ? -1 : 0;
    const st = close ? 0 : (s._strafe ?? 1) * 0.5;
    self.moveDirection(nx * away - nz * st, nz * away + nx * st);
    if (close) {
      // Too close to shoot: it backs off instead.
      if (s._draw !== undefined) lower(self, s);
      return;
    }
    if (s._draw !== undefined) {
      s._draw -= dt;
      if (s._draw > 0) return;
      lower(self, s);
      s._cd = cooldown * game.rng.range(0.8, 1.25);
      self.animate('attack');
      self.shoot(projectile, target, { lead, spread });
    } else if (s._cd <= 0 && drawing(game) < volley(game)) {
      s._draw = draw;
      self.animate('raise');
      self.glow('#7fd8ff');
      game.audio.play('bow_draw', { at: e, volume: 0.9, pitch: 0.8 });
    }
  };
}

/**
 * A powder keg going off where it stands: the Sapper's own (`dropped` false: a few hearts, if you
 * didn't get away), or the one a slain Sapper drops, which is as hard on the monsters about it as
 * a bomb.
 */
export function kegBlast(game: GameContext, at: Vec3, by: Actor, dropped = false) {
  const damage: [number, number] = dropped ? [18, 6] : [8, 2];
  game.world.explode({ x: at.x, y: at.y + 0.8, z: at.z }, 3.4, { damage, reach: dropped ? 4.2 : 3.8, knockback: dropped ? 2.2 : 1.7, by, weapon: 'powder_keg', filter: () => false });
  game.fx.shake(0.25, 0.4);
}

interface SapperState {
  _fuse?: number;
  _spark?: number;
  _blink?: number;
  _lit?: boolean;
}

/**
 * The Sapper runs at you with a lit powder keg on its back, throwing off sparks. In reach it
 * stops and the keg hisses and flashes for a second: get away (or roll through it) before it
 * blows, taking the Sapper and whatever stands near it too. Slain first, it drops the keg where it
 * stood (the server's `entityDeath`).
 */
export const sapperAI: Behavior = (self, game, dt) => {
  const s = self.data as SapperState;
  s._spark = (s._spark ?? 0) - dt;
  if (s._spark <= 0) {
    s._spark = s._fuse !== undefined ? 0.08 : 0.2;
    const q = self.position;
    game.fx.burst({ x: q.x, y: q.y + 2.05, z: q.z }, { color: '#ffb03a', count: s._fuse !== undefined ? 5 : 3, speed: 1.6, size: 0.1, gravity: 6, glow: 1, life: 0.35 });
  }
  if (s._fuse !== undefined) {
    self.stop();
    s._fuse -= dt;
    s._blink = (s._blink ?? 0) - dt;
    if (s._blink <= 0) {
      // Flashing faster as it burns down.
      s._blink = s._fuse > 0.5 ? 0.16 : 0.07;
      s._lit = !s._lit;
      self.glow(s._lit ? '#ffffff' : '#ff3a1a');
    }
    if (s._fuse <= 0) {
      kegBlast(game, self.position, self);
      self.remove();
    }
    return;
  }
  const target = self.nearestPlayer();
  if (!target) {
    self.stop();
    return;
  }
  self.moveTo(target);
  self.lookAt(target);
  if (self.distanceTo(target) < 2.6 && self.canSee(target)) {
    s._fuse = 1.15;
    self.animate('raise');
    game.audio.play('fuse', { at: self.position });
  }
};

interface NecroState {
  _cd?: number;
  _cast?: number;
  _shove?: number;
  _strafe?: number;
  _flip?: number;
}

/** How many risen dead each Necromancer can keep up at once. */
const MAX_RAISED = 3;

/**
 * The Necromancer hangs back and raises the dead: a glowing green cast (a second to stop it: hit
 * it and the spell breaks), then two zombies claw up out of the sand beside it. Weak itself, so
 * it's the one to rush; come too close and it throws you back with a burst of grave-light.
 */
export const necromancerAI: Behavior = (self, game, dt) => {
  const s = self.data as NecroState & { _hp?: number };
  s._cd = (s._cd ?? 2.5) - dt;
  s._shove = Math.max(0, (s._shove ?? 0) - dt);
  s._flip = (s._flip ?? 0) - dt;
  if (s._flip <= 0) {
    s._strafe = game.rng.chance(0.5) ? 1 : -1;
    s._flip = game.rng.range(2, 4);
  }
  const hurt = self.health < (s._hp ?? self.health);
  s._hp = self.health;
  const target = self.nearestPlayer();
  if (!target) {
    self.stop();
    return;
  }
  const d = self.distanceTo(target);

  if (s._cast !== undefined) {
    self.stop();
    self.lookAt(target);
    if (hurt) {
      // The spell breaks.
      s._cast = undefined;
      s._cd = 2.5;
      self.glow(null);
      self.animate('none');
      game.fx.burst({ x: self.position.x, y: self.position.y + 1.6, z: self.position.z }, { color: '#5fe87f', count: 10, speed: 2 });
      return;
    }
    s._cast -= dt;
    if (s._cast > 0) return;
    s._cast = undefined;
    self.glow(null);
    self.animate('none');
    const q = target.position;
    raise(self, game, Math.atan2(q.z - self.position.z, q.x - self.position.x));
    s._cd = game.rng.range(6, 8);
    return;
  }

  // Too close: a burst of grave-light throws them back.
  if (d < 3.2 && s._shove === 0 && self.canSee(target)) {
    s._shove = 5;
    const p = self.position;
    const q = target.position;
    const l = Math.hypot(q.x - p.x, q.z - p.z) || 1;
    self.animate('cast');
    game.clock.after(0.3, () => self.alive && self.animate('none'));
    game.fx.shockwave({ x: p.x, y: p.y + 0.2, z: p.z }, 4, '#5fe87f');
    game.audio.play('necro', { at: p, pitch: 1.4, volume: 0.8 });
    target.damage(2, { source: self, knockback: 0, cause: 'melee' });
    target.impulse(((q.x - p.x) / l) * 11, 5, ((q.z - p.z) / l) * 11);
    return;
  }

  // Keep well back, sidling about.
  const p = target.position;
  const e = self.position;
  const l = Math.hypot(e.x - p.x, e.z - p.z) || 1;
  const nx = (e.x - p.x) / l;
  const nz = (e.z - p.z) / l;
  const away = d < 9 ? 1 : d > 16 ? -1 : 0;
  const st = (s._strafe ?? 1) * 0.6;
  // Not into the wall: turn along it.
  const m = map();
  const ox = e.x - m.center.x;
  const oz = e.z - m.center.z;
  const r = Math.hypot(ox, oz);
  const inward = r > m.radius - 4 ? 0.8 : 0;
  self.moveDirection(nx * away - nz * st - (ox / (r || 1)) * inward, nz * away + nx * st - (oz / (r || 1)) * inward);
  self.lookAt(target);

  // (Its risen counted only when it could raise more: not a scan of every zombie every tick.)
  if (s._cd <= 0 && self.canSee(target) && game.entities.all('zombie').filter((z) => z.data.master === self.id).length < MAX_RAISED) {
    s._cast = 1.1;
    self.stop();
    self.animate('raise');
    self.glow('#5fe87f');
    game.audio.play('necro', { at: e });
  }
};

/** Two of the dead up out of the sand, either side of it and a little toward `toward` (an angle). */
function raise(self: Entity, game: GameContext, toward: number) {
  const e = self.position;
  for (const side of [-1, 1]) {
    const t = toward + side * 1.1;
    let at = { x: e.x + Math.cos(t) * 2, y: e.y + 0.05, z: e.z + Math.sin(t) * 2 };
    if (!game.world.fits(at)) at = { x: e.x, y: e.y + 0.05, z: e.z };
    const z = spawnMonster(game, 'zombie', at, { data: { master: self.id, risen: true } });
    // The risen are frailer than the arena's own dead.
    z.health = 12;
    game.fx.burst({ x: at.x, y: at.y + 0.2, z: at.z }, { color: '#5fe87f', count: 26, speed: 2.4, gravity: -2, glow: 1 });
    game.fx.burst({ x: at.x, y: at.y + 0.1, z: at.z }, { color: '#c2a878', count: 14, speed: 2, gravity: 6 });
  }
  game.audio.play('spawn', { at: e, pitch: 0.7 });
}

interface GoblinState {
  _escape?: boolean;
  _gate?: number;
  _coin?: number;
  _jink?: number;
  _jinkDir?: number;
}

/** How long a Treasure Goblin runs about the pit before it makes for a gate. */
export const GOBLIN_STAYS = 18;

/**
 * The Treasure Goblin: it never fights. It runs from whoever's nearest, jinking this way and that
 * and shedding sparks of gold, and after a while it bolts for a gate. Catch it first and it bursts
 * into loot (its `drops`); let it reach the gate and it's gone (the server's `goblinEscaped`).
 */
export function goblinAI(escaped: (self: Entity) => void): Behavior {
  return (self, game, dt) => {
    const s = self.data as GoblinState;
    s._coin = (s._coin ?? 0) - dt;
    if (s._coin <= 0) {
      s._coin = 0.25;
      const q = self.position;
      game.fx.burst({ x: q.x, y: q.y + 0.7, z: q.z }, { color: '#ffd23a', count: 3, speed: 1, gravity: 8, glow: 0.8 });
    }
    const e = self.position;
    if (!s._escape && self.age > GOBLIN_STAYS) {
      s._escape = true;
      // The gate furthest from everyone.
      let best = 0;
      let far = -1;
      map().gates.forEach(({ at: g }, i) => {
        const near = Math.min(...game.players.filter((p) => p.alive).map((p) => Math.hypot(p.position.x - g.x, p.position.z - g.z)), 99);
        if (near > far) {
          far = near;
          best = i;
        }
      });
      s._gate = best;
      self.setSpeed(1.15);
    }
    if (s._escape) {
      const gates = map().gates;
      const pen = gates[Math.min(s._gate ?? 0, gates.length - 1)].at;
      self.moveTo(pen);
      if (Math.hypot(e.x - pen.x, e.z - pen.z) < 2 || self.age > GOBLIN_STAYS + 14) escaped(self);
      return;
    }
    const target = self.nearestPlayer();
    if (!target) {
      self.stop();
      return;
    }
    const p = target.position;
    const l = Math.hypot(e.x - p.x, e.z - p.z) || 1;
    let dx = (e.x - p.x) / l;
    let dz = (e.z - p.z) / l;
    // A jink to one side now and then.
    s._jink = (s._jink ?? 0) - dt;
    if (s._jink <= 0) {
      s._jink = game.rng.range(0.6, 1.4);
      s._jinkDir = game.rng.chance(0.5) ? 1 : -1;
    }
    const j = (s._jinkDir ?? 1) * 0.7;
    [dx, dz] = [dx - dz * j, dz + dx * j];
    // Near the wall: run along it rather than into it (the way round that's further from them).
    const m = map();
    const cx = e.x - m.center.x;
    const cz = e.z - m.center.z;
    const r = Math.hypot(cx, cz) || 1;
    if (r > m.radius - 5) {
      const ox = -cz / r;
      const oz = cx / r;
      const dir = ox * dx + oz * dz >= 0 ? 1 : -1;
      dx = ox * dir - (cx / r) * 0.5;
      dz = oz * dir - (cz / r) * 0.5;
    }
    self.moveDirection(dx, dz);
  };
}
