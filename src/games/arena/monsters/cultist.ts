import { CHARACTER_STYLE, Models, type Behavior, type DamageEvent, type Entity, type GameContext } from '@platform';
import { bossKind } from '../bosses';
import { spawnMonster } from '../run/spawn';
import { MONSTER_MODELS } from './models';
import type { MonsterKind } from './registry';
import { held, inward, near, ring, show } from './util';

/**
 * The Cultist hangs back behind the others and chants: its staff raised and its crystal blazing,
 * the monsters round it are empowered (quicker, harder-hitting, a red glow on them) for a while.
 * Hit it while it chants and the chant breaks. Brought low, it kneels and gives itself to the
 * ritual: a ring of red on the sand, and if it isn't finished off in time, it bursts and imps
 * claw out of the blood.
 */

interface CultistState {
  _cd?: number;
  _chant?: number;
  _rite?: number;
  _hp?: number;
  _strafe?: number;
  _flip?: number;
}

const BLOOD = '#ff2a3a';
/** How long an empowering lasts, and what it does. */
const EMPOWER = { time: 8, speed: 1.25, damage: 1.4, radius: 10, most: 3 };
const RITE = 2.8;

const empowered = (game: GameContext, e: Entity) => ((e.data.empowered as number | undefined) ?? 0) > game.clock.now;

/** Monsters near it that could use it: not cultists, not bosses, not already glowing. */
function flock(game: GameContext, self: Entity): Entity[] {
  const at = self.position;
  return near(game, at, EMPOWER.radius, self)
    .filter((e) => e.type !== 'cultist' && e.type !== 'goblin' && !bossKind(e.type) && !empowered(game, e))
    .sort((a, b) => a.distanceTo(at) - b.distanceTo(at))
    .slice(0, EMPOWER.most);
}

/** Its own speed (`data.speed`, which slows multiply on top of) times `k`: at once, unless it's held still. */
function quicken(e: Entity, k: number) {
  const speed = ((e.data.speed as number | undefined) ?? 1) * k;
  e.data.speed = speed;
  if (!((e.data.stunned as number | undefined) ?? 0)) e.setSpeed(speed);
}

function empower(game: GameContext, self: Entity) {
  const until = game.clock.now + EMPOWER.time;
  const ids: number[] = [];
  for (const e of flock(game, self)) {
    e.data.empowered = until;
    quicken(e, EMPOWER.speed);
    game.clock.after(EMPOWER.time, () => e.alive && !empowered(game, e) && quicken(e, 1 / EMPOWER.speed));
    ids.push(e.id);
  }
  if (!ids.length) return;
  show(game, 'empower', { from: self.id, ids, time: EMPOWER.time });
  game.audio.play('empower', { at: self.position });
}

/** The ritual done: it bursts, and two imps claw up out of the blood. */
function sacrifice(game: GameContext, self: Entity) {
  const at = { ...self.position };
  game.fx.burst({ x: at.x, y: at.y + 1, z: at.z }, { color: BLOOD, count: 60, speed: 6, gravity: 8, size: 0.14, glow: 0.6, life: 0.9 });
  game.fx.shockwave({ x: at.x, y: at.y + 0.1, z: at.z }, 3, BLOOD);
  game.audio.play('sacrifice', { at, volume: 1.3 });
  self.data.sacrificed = true;
  self.kill();
  for (const side of [-1, 1]) {
    let q = { x: at.x + side * 0.9, y: at.y + 0.05, z: at.z };
    if (!game.world.fits(q)) q = { x: at.x, y: at.y + 0.05, z: at.z };
    const imp = spawnMonster(game, 'imp', q, { data: { spawned: true, master: self.id } });
    imp.impulse(side * 3, 7, 0);
  }
}

const cultistAI: Behavior = (self, game, dt) => {
  const s = self.data as CultistState;
  // Caught mid-chant or at its rite, it must begin again.
  if (
    held(self, () => {
      const had = s._chant !== undefined || s._rite !== undefined;
      s._chant = s._rite = undefined;
      return had;
    })
  )
    return;
  s._cd = (s._cd ?? game.rng.range(1.5, 3)) - dt;
  const lost = Math.max(0, (s._hp ?? self.health) - self.health);
  s._hp = self.health;
  s._flip = (s._flip ?? 0) - dt;
  if (s._flip <= 0) {
    s._strafe = game.rng.chance(0.5) ? 1 : -1;
    s._flip = game.rng.range(2, 4);
  }
  const target = self.nearestPlayer();
  if (!target) {
    self.stop();
    return;
  }
  const e = self.position;
  // Kneeling at the rite: nothing moves it but death.
  if (s._rite !== undefined) {
    self.stop();
    s._rite -= dt;
    if (s._rite <= 0) sacrifice(game, self);
    return;
  }
  if (s._chant !== undefined) {
    self.stop();
    self.lookAt(target);
    if (lost >= 2.5) {
      // The chant breaks.
      s._chant = undefined;
      s._cd = 2.5;
      self.glow(null);
      self.animate('none');
      game.fx.burst({ x: e.x, y: e.y + 2.4, z: e.z }, { color: BLOOD, count: 12, speed: 2.5, glow: 1, life: 0.4 });
      return;
    }
    s._chant -= dt;
    if (s._chant > 0) return;
    s._chant = undefined;
    self.glow(null);
    self.animate('none');
    empower(game, self);
    s._cd = game.rng.range(6, 8);
    return;
  }
  // Brought low: it kneels to the rite.
  if (self.health < self.maxHealth * 0.4 && !s._rite && self.onGround) {
    s._rite = RITE;
    self.stop();
    self.animate('cast');
    self.glow(BLOOD);
    game.audio.play('ritual', { at: e, volume: 1.2 });
    ring(game, e, 2.6, RITE, BLOOD);
    show(game, 'rite', { id: self.id, time: RITE });
    game.hud.feed('A Cultist kneels to its dark rite: stop it!', { color: '#ff6a6a' });
    return;
  }
  // Behind the others, a good way off.
  const p = target.position;
  const d = self.distanceTo(target);
  const l = Math.hypot(e.x - p.x, e.z - p.z) || 1;
  const nx = (e.x - p.x) / l;
  const nz = (e.z - p.z) / l;
  const away = d < 8 ? 1 : d > 13 ? -1 : 0;
  const st = (s._strafe ?? 1) * 0.5;
  // Out of sight of them, it finds its way back round (backing off blind took it out of the
  // arena, round walls and through the gates); keeping back, it turns along the arena's edge.
  if (!self.canSee(target) || d > 13) self.moveTo(target);
  else {
    const [ix, iz] = inward(e);
    self.moveDirection(nx * away - nz * st + ix, nz * away + nx * st + iz);
  }
  self.lookAt(target);
  if (s._cd <= 0) {
    // Nobody near to bless: it looks again in a moment, not every tick.
    if (!flock(game, self).length) {
      s._cd = 0.5;
      return;
    }
    s._chant = 1;
    self.stop();
    self.animate('raise');
    self.glow(BLOOD);
    game.audio.play('chant', { at: e });
  }
};

/** An empowered monster hits harder. */
export function empoweredHits(game: GameContext, hit: DamageEvent) {
  const src = hit.source;
  if (src && src !== 'world' && src.kind === 'entity' && empowered(game, src)) hit.amount *= EMPOWER.damage;
}

const LOOK = Models.gltf(MONSTER_MODELS.cultist, { rig: 'humanoid', ...CHARACTER_STYLE });

export const cultist: MonsterKind = {
  id: 'cultist',
  cost: 2.5,
  from: 7,
  weight: 0.6,
  max: 2,
  role: 'support',
  tip: 'It makes the others stronger: kill it first. Low on life it kneels to summon: finish it',
  color: '#ff4a5a',
  define: () => ({
    name: 'Cultist',
    model: LOOK,
    hitbox: { width: 0.65, height: 1.95 },
    health: 17,
    speed: 3.2,
    ai: cultistAI,
    drops: [
      { item: 'health_potion', chance: 0.3 },
      { item: 'bomb_bundle', chance: 0.3 },
    ],
    sounds: { ambient: 'cultist', hurt: 'cultist_hurt' },
    bloodColor: '#a01a22',
  }),
};
