import { Behaviors, Models, type CharacterLook, type Entity, type GameContext, type ProjectileSpec } from '@platform';
import { MONSTER_MODELS } from './models';
import { archer, goblinAI, kegBlast, necromancerAI, sapperAI } from './ai';
import type { MonsterKind } from './registry';

/**
 * The first monsters: the platform's people gone bad (the risen dead, bones, an ogre), a sapper
 * with a powder keg, a hooded necromancer, a little gold-mad goblin, and a spider.
 */
const ZOMBIE: CharacterLook = { build: 'broad', skin: '#7a9a5e', hair: 'short', hairColor: '#2e3322', face: 'glow', eyes: '#e4ff8a', top: 'shirt', topColor: '#50708f', bottom: 'trousers', bottomColor: '#3a3f55', shoes: 'shoes', shoeColor: '#3a2a1c', ragged: true };
const SKELETON: CharacterLook = { build: 'slim', skin: '#e8e2d0', hair: 'bald', face: 'skull', eyes: '#7fd8ff', top: 'ribs', bottom: 'shorts', bottomColor: '#4a4036', shoes: 'flats', shoeColor: '#d8d2c0', ragged: true };
const BRUTE: CharacterLook = { build: 'heavy', skin: '#8e7f6a', hair: 'mohawk', hairColor: '#2a1c14', facialHair: 'beard', face: 'glow', eyes: '#ff5a2a', top: 'tank', topColor: '#5a3a24', bottom: 'trousers', bottomColor: '#4a3a2a', shoes: 'boots', shoeColor: '#2a1c14', ragged: true };
const SAPPER: CharacterLook = { build: 'broad', skin: '#9a8a5e', hair: 'mohawk', hairColor: '#e0602a', face: 'glow', eyes: '#ffb03a', top: 'apron', topColor: '#6a4424', accent: '#2a1c14', bottom: 'trousers', bottomColor: '#3a3024', shoes: 'boots', shoeColor: '#2a1c14', ragged: true };
const NECROMANCER: CharacterLook = { build: 'slim', skin: '#a9b0a8', hair: 'long', hairColor: '#101410', face: 'glow', eyes: '#5fe87f', top: 'hoodie', topColor: '#1c2a20', accent: '#5fe87f', bottom: 'trousers', bottomColor: '#141a16', shoes: 'boots', shoeColor: '#0e120f' };
const GOBLIN: CharacterLook = { build: 'slim', skin: '#78b04a', hair: 'bald', face: 'glow', eyes: '#ffe14a', top: 'apron', topColor: '#7a5230', accent: '#e8b923', bottom: 'shorts', bottomColor: '#4a3a24', shoes: 'flats', shoeColor: '#3a2a1c', hat: 'crown' };

export const ARROW: ProjectileSpec = { sprite: 'arrow', speed: 23, gravity: 20, damage: 2, knockback: 0.3, sticky: true };

export const zombie: MonsterKind = {
  id: 'zombie',
  cost: 1,
  from: 1,
  weight: 3,
  role: 'melee',
  define: () => ({
    name: 'Zombie',
    model: Models.character(ZOMBIE),
    hitbox: { width: 0.6, height: 1.95 },
    health: 20,
    speed: 3.2,
    ai: Behaviors.melee({ damage: 3, reach: 1.9, cooldown: 1.1, windup: 0.25 }),
    drops: [{ item: 'heart', chance: 0.18 }],
    sounds: { ambient: 'zombie' },
    bloodColor: '#6b8f3a',
  }),
};

export const skeleton: MonsterKind = {
  id: 'skeleton',
  cost: 1.5,
  from: 2,
  weight: 1.5,
  role: 'ranged',
  define: () => ({
    name: 'Skeleton',
    model: Models.character(SKELETON),
    hitbox: { width: 0.6, height: 1.95 },
    health: 16,
    speed: 3.2,
    held: 'bow',
    // A slow, glowing draw you can see and hear, a wide spread, and they take turns (`archer`).
    ai: archer({ projectile: ARROW, range: 20, preferred: 9, cooldown: 3, draw: 1, spread: 0.075, lead: 0.15 }),
    drops: [
      { item: 'arrow_bundle', chance: 0.6 },
      { item: 'heart', chance: 0.08 },
    ],
    sounds: { ambient: 'skeleton', hurt: 'skeleton' },
    bloodColor: '#e8e2d0',
  }),
};

export const spider: MonsterKind = {
  id: 'spider',
  cost: 1.2,
  from: 3,
  weight: 1.5,
  role: 'swarm',
  define: () => ({
    name: 'Spider',
    model: Models.gltf(MONSTER_MODELS.spider, { clips: { idle: 'idle', walk: 'walk', attack: 'attack' }, head: 'head' }),
    hitbox: { width: 1.3, height: 0.9 },
    health: 14,
    speed: 5.2,
    jump: 9,
    ai: Behaviors.leaper({ damage: 2.5, range: [2.5, 7.5], cooldown: 2.2, speed: 10, height: 6 }),
    drops: [{ item: 'heart', chance: 0.12 }],
    sounds: { ambient: 'spider', hurt: 'spider' },
    bloodColor: '#3d6b2a',
  }),
};

export const sapper: MonsterKind = {
  id: 'sapper',
  cost: 1.5,
  from: 2,
  role: 'special',
  define: () => ({
    name: 'Sapper',
    model: Models.character(SAPPER),
    hitbox: { width: 0.6, height: 1.95 },
    health: 12,
    speed: 3.9,
    ai: sapperAI,
    drops: [
      { item: 'bomb_bundle', chance: 0.35 },
      { item: 'heart', chance: 0.1 },
    ],
    sounds: { ambient: 'sapper', hurt: 'sapper' },
    bloodColor: '#8a7a4e',
  }),
  // Slain first, it drops its keg, and it goes off a moment later where it fell: a fighter's kill
  // is a blast of theirs (hard on the monsters, never on them); a Sapper caught in another's blast,
  // or anything else's, goes off as its own keg would (a few hearts for whoever's beside it), not
  // as the full dropped keg (18 at its heart, in a chain nobody saw coming).
  slain(game, e, by) {
    const q = { ...e.position };
    game.audio.play('fuse', { at: q, pitch: 1.4 });
    game.clock.after(0.45, () => (by ? kegBlast(game, q, by, true) : kegBlast(game, q, e)));
  },
};

export const necromancer: MonsterKind = {
  id: 'necromancer',
  cost: 3,
  from: 4,
  weight: 0.7,
  max: 3,
  role: 'support',
  define: () => ({
    name: 'Necromancer',
    model: Models.character(NECROMANCER),
    hitbox: { width: 0.6, height: 1.95 },
    health: 18,
    speed: 3.3,
    ai: necromancerAI,
    drops: [
      { item: 'health_potion', chance: 0.5 },
      { item: 'bomb_bundle', chance: 0.4 },
    ],
    sounds: { ambient: 'necro', hurt: 'skeleton' },
    bloodColor: '#3a5a3e',
  }),
};

export const brute: MonsterKind = {
  id: 'brute',
  cost: 6,
  from: 5,
  weight: 0.5,
  max: 3,
  role: 'heavy',
  single: true,
  define: () => ({
    name: 'Brute',
    model: Models.character(BRUTE, { scale: 1.2 }),
    hitbox: { width: 1.1, height: 2.55 },
    health: 70,
    speed: 2.9,
    knockbackResistance: 0.6,
    ai: Behaviors.melee({ damage: 7, reach: 2.7, cooldown: 1.7, windup: 0.55, knockback: 1.8 }),
    drops: [
      { item: 'health_potion', chance: 1 },
      { item: 'arrow_bundle', chance: 0.7, count: 2 },
    ],
    sounds: { ambient: 'brute', hurt: 'brute' },
    bloodColor: '#7a2f22',
  }),
};

/** A Treasure Goblin reached its gate: gone, and its loot with it. */
function goblinEscaped(game: GameContext, e: Entity) {
  const q = e.position;
  game.fx.burst({ x: q.x, y: q.y + 0.8, z: q.z }, { color: '#ffd23a', count: 30, speed: 3, gravity: -1, glow: 1 });
  game.audio.play('goblin', { at: q, pitch: 1.2 });
  game.hud.marker(`goblin:${e.id}`, null);
  game.hud.feed('The Treasure Goblin got away!', { color: '#ffd23a' });
  e.remove();
}

/** Never in a wave's budget: the director sends one in now and then (and two in a Treasure Hunt). */
export const goblin: MonsterKind = {
  id: 'goblin',
  cost: 0,
  from: 2,
  weight: 0,
  role: 'special',
  single: true,
  define: (game) => ({
    name: 'Treasure Goblin',
    model: Models.character(GOBLIN, { scale: 0.72 }),
    hitbox: { width: 0.5, height: 1.4 },
    health: 22,
    speed: 5.1,
    jump: 9,
    knockbackResistance: 0.5,
    ai: goblinAI((self) => goblinEscaped(game, self)),
    // Caught: it bursts into loot.
    drops: [
      { item: 'heart', chance: 1, count: 3 },
      { item: 'health_potion', chance: 1 },
      { item: 'bomb_bundle', chance: 1, count: 3 },
      { item: 'arrow_bundle', chance: 1, count: 2 },
    ],
    sounds: { ambient: 'goblin', hurt: 'goblin' },
    bloodColor: '#ffd23a',
  }),
  spawned(game, e) {
    game.hud.pop('Treasure Goblin!', { color: '#ffd23a', sub: 'Catch it before it gets away' });
    game.hud.marker(`goblin:${e.id}`, e, { color: '#ffd23a', shape: 'diamond', label: 'Treasure', edge: true, offset: { x: 0, y: 1.5, z: 0 } });
    game.audio.play('goblin', { at: e.position, volume: 1.2 });
  },
  slain(game, e, by) {
    const q = e.position;
    game.hud.marker(`goblin:${e.id}`, null);
    game.audio.play('coins', { at: q, volume: 1.3 });
    game.fx.burst({ x: q.x, y: q.y + 0.8, z: q.z }, { color: '#ffd23a', count: 60, speed: 6, gravity: 10, glow: 1 });
    if (by) game.hud.feed(`${by.name} caught the Treasure Goblin!`, { color: '#ffd23a' });
  },
};
