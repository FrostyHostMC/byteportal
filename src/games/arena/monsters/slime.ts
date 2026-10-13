import { Models, type Behavior, type Entity, type GameContext, type Player, type Vec3 } from '@platform';
import { spawnMonster } from '../run/spawn';
import { MONSTER_MODELS } from './models';
import type { MonsterKind } from './registry';
import { flat, held } from './util';

/**
 * Slimes: they come at you in hops, squashing down before each (the tell) and landing on you. Kill
 * a big one and it splits in two smaller ones, and those into two tiny ones: seven to finish one
 * off, so bombs and wide swings are the answer to a big slime.
 */

interface SlimeSize {
  name: string;
  /** What it splits into, if anything. */
  into?: string;
  health: number;
  width: number;
  height: number;
  /** A landing on someone: damage, and how hard the hops are (sideways, up). */
  damage: number;
  hop: [number, number];
  /** Seconds between hops. */
  rest: [number, number];
  /** How far past its body its coming down splashes (blocks): whoever's in it is hurt, less at the edge. */
  splash: number;
  pitch: number;
}

const SIZES: Record<string, SlimeSize> = {
  slime: { name: 'Slime', into: 'slime_small', health: 28, width: 1.1, height: 0.95, damage: 6, hop: [5.5, 7.5], rest: [1, 1.5], splash: 1.1, pitch: 0.75 },
  slime_small: { name: 'Small Slime', into: 'slime_tiny', health: 11, width: 0.62, height: 0.55, damage: 3.5, hop: [6, 7], rest: [0.7, 1.1], splash: 0.5, pitch: 1.05 },
  slime_tiny: { name: 'Tiny Slime', health: 4, width: 0.38, height: 0.32, damage: 1.5, hop: [6.5, 6], rest: [0.4, 0.8], splash: 0, pitch: 1.5 },
};

/** Seconds of a fighter's running a hop allows for. */
const LEAD = 0.3;

interface SlimeState {
  _rest?: number;
  _crouch?: number;
  _air?: boolean;
  _hit?: number;
  /** The way its next hop goes when it's finding its way round something (x, z), not at them. */
  _way?: [number, number];
  /** Seconds it's been going nowhere, finding its way round. */
  _stuck?: number;
}

function slimeAI(o: SlimeSize): Behavior {
  return (self, game, dt) => {
    const s = self.data as SlimeState;
    if (held(self, () => ((s._crouch = undefined), false))) return;
    s._rest = (s._rest ?? game.rng.range(0.3, 1)) - dt;
    s._hit = Math.max(0, (s._hit ?? 0) - dt);
    const target = self.nearestPlayer();
    if (!target) {
      self.stop();
      return;
    }
    const e = self.position;
    const p = target.position;
    self.lookAt(target);
    // In the air: steering a little, and landing on whoever's under it.
    if (!self.onGround) {
      s._air = true;
      const l = Math.hypot(p.x - e.x, p.z - e.z) || 1;
      self.moveDirection((p.x - e.x) / l, (p.z - e.z) / l);
      if (s._hit === 0 && flat(e, p) < o.width * 0.5 + 0.7 && Math.abs(p.y - e.y) < 1.4) land(game, self.position, target, o, s, self);
      return;
    }
    if (s._air) {
      // Down: a squelch, and a splash on whoever it came down on.
      s._air = false;
      game.audio.play('slime', { at: e, pitch: o.pitch * game.rng.range(0.9, 1.1), volume: 0.7 });
      if (s._hit === 0) splash(game, e, o, s, self);
    }
    // Out of sight of them (a wall, a gate between): it oozes along the way round, and hops along
    // it now and then (a hop straight at them would only hit the wall, for good).
    if (s._crouch === undefined && !self.canSee(target)) {
      self.moveTo(target);
      const v = self.velocity;
      const sp = Math.hypot(v.x, v.z);
      s._stuck = sp < 0.3 ? (s._stuck ?? 0) + dt : 0;
      if (s._rest <= 0 && (sp > 0.4 || s._stuck > 0.5)) {
        if (sp > 0.4) s._way = [v.x / sp, v.z / sp];
        else {
          // Caught on a corner (it's wider than a block): a hop off to one side of the way to them.
          const l = Math.hypot(p.x - e.x, p.z - e.z) || 1;
          const side = game.rng.chance(0.5) ? 1 : -1;
          s._way = [((p.x - e.x) / l) * 0.5 - ((p.z - e.z) / l) * side, ((p.z - e.z) / l) * 0.5 + ((p.x - e.x) / l) * side];
        }
        s._stuck = 0;
        s._crouch = 0.22;
        self.animate('hop', { fade: 0.05 });
      }
      return;
    }
    self.stop();
    // Squashing down to hop (the tell), then off toward them (or along its way round).
    if (s._crouch !== undefined) {
      s._crouch -= dt;
      if (s._crouch > 0) return;
      s._crouch = undefined;
      // At where they'll be when it comes down (a running fighter is led, a little).
      const v = target.velocity;
      const ax = p.x + v.x * LEAD - e.x;
      const az = p.z + v.z * LEAD - e.z;
      const l = Math.hypot(ax, az) || 1;
      const far = Math.min(1, l / 6);
      const [wx, wz] = s._way ?? [ax / l, az / l];
      const k = s._way ? 0.7 : 0.55 + 0.45 * far;
      s._way = undefined;
      self.impulse(wx * o.hop[0] * k, o.hop[1], wz * o.hop[0] * k);
      s._rest = game.rng.range(o.rest[0], o.rest[1]);
      return;
    }
    if (s._rest <= 0) {
      s._crouch = 0.22;
      self.animate('hop', { fade: 0.05 });
    }
  };
}

/** Come down on the ground: whoever it lands on is hurt, and those about it a little less. */
function splash(game: GameContext, at: Vec3, o: SlimeSize, s: SlimeState, self: Entity) {
  const inner = o.width * 0.5 + 0.9;
  if (o.splash > 0) game.fx.burst({ x: at.x, y: at.y + 0.15, z: at.z }, { color: '#7fe05a', count: 22, speed: 5, gravity: 14, size: 0.1, life: 0.5 });
  for (const p of game.players) {
    const d = flat(at, p.position);
    if (!p.alive || d > inner + o.splash || Math.abs(p.position.y - at.y) > 1.2) continue;
    if (d < inner) land(game, at, p, o, s, self);
    else {
      s._hit = 0.8;
      p.damage(o.damage * 0.6, { source: self, knockback: 0.6, cause: 'melee' });
    }
  }
}

/** Come down on someone: a splash, and they're hurt and knocked about. */
function land(game: GameContext, at: Vec3, target: Player, o: SlimeSize, s: SlimeState, self: Entity) {
  s._hit = 0.8;
  self.animate('attack', { fade: 0.05 });
  target.damage(o.damage, { source: self, knockback: 0.9, cause: 'melee' });
  game.fx.burst({ x: at.x, y: at.y + 0.3, z: at.z }, { color: '#7fe05a', count: 14, speed: 3, gravity: 12, size: 0.12, life: 0.6 });
}

function slimeKind(id: string, extra: Partial<MonsterKind>): MonsterKind {
  const o = SIZES[id];
  return {
    id,
    cost: 1,
    from: 3,
    weight: 0,
    role: 'swarm',
    define: () => ({
      name: o.name,
      model: Models.gltf(MONSTER_MODELS[id as keyof typeof MONSTER_MODELS], { clips: { idle: 'idle', walk: 'walk', attack: 'attack' } }),
      hitbox: { width: o.width, height: o.height },
      health: o.health,
      speed: 2.2,
      jump: 7,
      knockbackResistance: id === 'slime' ? 0.35 : 0,
      ai: slimeAI(o),
      drops: id === 'slime' ? [{ item: 'heart', chance: 0.2 }] : id === 'slime_small' ? [{ item: 'heart', chance: 0.06 }] : [],
      sounds: { ambient: 'slime', hurt: 'slime_hurt', death: 'splat' },
      bloodColor: '#7fe05a',
    }),
    // Splitting: two smaller ones, thrown apart (the tiny ones just burst).
    slain(game, e) {
      const q = e.position;
      game.fx.burst({ x: q.x, y: q.y + o.height * 0.5, z: q.z }, { color: '#8ff06a', count: o.into ? 30 : 12, speed: 4, gravity: 12, size: 0.14, life: 0.7 });
      if (!o.into) {
        e.remove();
        return;
      }
      const a = game.rng.range(0, Math.PI * 2);
      for (const side of [1, -1]) {
        const dx = Math.cos(a) * side;
        const dz = Math.sin(a) * side;
        let at = { x: q.x + dx * o.width * 0.35, y: q.y + 0.1, z: q.z + dz * o.width * 0.35 };
        if (!game.world.fits(at)) at = { x: q.x, y: q.y + 0.1, z: q.z };
        const child = spawnMonster(game, o.into, at, { data: { spawned: true, master: e.id } });
        child.impulse(dx * 4, 5, dz * 4);
        (child.data as SlimeState)._rest = 0.6 + game.rng.next() * 0.4;
      }
      // Gone into them at once (no body left to topple over).
      e.remove();
    },
    ...extra,
  };
}

export const slime = slimeKind('slime', { cost: 3, from: 4, weight: 0.8, max: 3, tip: 'It splits when it dies, and again: bombs and wide swings', color: '#8ff06a' });
export const slimeSmall = slimeKind('slime_small', {});
export const slimeTiny = slimeKind('slime_tiny', { from: 99 });
