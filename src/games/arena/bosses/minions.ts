import { Behaviors, Models, type Behavior, type CharacterLook, type Entity, type EntityDefinition, type GameContext, type Player } from '@platform';
import { spawnMonster } from '../run/spawn';
import { bus } from '../run/bus';
import { MODEL } from './models';

/**
 * What the bosses bring with them, never in a wave of their own: the Bone Colossus's thralls
 * (climbing out of its ribcage), the Broodmother's egg sacs and the spiderlings that hatch from
 * them, and the Lich King's phylacteries. Each has its master's id in `data.master`, and falls
 * when its master does (`part.ts`).
 */
export interface Minion {
  id: string;
  define(game: GameContext): EntityDefinition;
  spawned?(game: GameContext, e: Entity): void;
  slain?(game: GameContext, e: Entity, by: Player | null): void;
}

const THRALL: CharacterLook = { build: 'slim', skin: '#d6c9a8', hair: 'bald', face: 'skull', eyes: '#ffae42', top: 'ribs', bottom: 'shorts', bottomColor: '#3a2e24', shoes: 'flats', shoeColor: '#c8bc9c', ragged: true };

/** A bone thrall: a skeleton that climbs out of the Colossus's ribcage, sword in hand. */
export const thrall: Minion = {
  id: 'thrall',
  define: () => ({
    name: 'Bone Thrall',
    model: Models.character(THRALL),
    hitbox: { width: 0.6, height: 1.95 },
    health: 12,
    speed: 3.6,
    held: 'stone_sword',
    ai: Behaviors.melee({ damage: 2, reach: 2, cooldown: 1.1, windup: 0.3 }),
    sounds: { ambient: 'skeleton', hurt: 'skeleton' },
    bloodColor: '#e8dcc0',
  }),
};

/** A spiderling: quick and frail, it pounces. */
export const spiderling: Minion = {
  id: 'spiderling',
  define: () => ({
    name: 'Spiderling',
    model: Models.gltf(MODEL.spiderling, { clips: { idle: 'idle', walk: 'walk' } }),
    hitbox: { width: 0.8, height: 0.55 },
    health: 5,
    speed: 6.2,
    jump: 9,
    ai: Behaviors.leaper({ damage: 1.2, range: [2, 6.5], cooldown: 1.8, speed: 9, height: 5 }),
    sounds: { ambient: 'spiderling', hurt: 'spiderling' },
    bloodColor: '#7fd23a',
  }),
};

/** Seconds an egg sac takes to hatch, and the spiderlings in it. */
export const HATCH = 8;
const BROOD = 3;

interface EggState {
  _blink?: number;
  _lit?: boolean;
}

/** An egg sac: it throbs, quicker and brighter as it ripens; smash it in time, or out come spiderlings. */
const eggAI: Behavior = (self, game, dt) => {
  const s = self.data as EggState;
  // (Its mother in a frenzy hatches every egg at once.)
  const left = self.data.hatchNow ? 0 : HATCH - self.age;
  s._blink = (s._blink ?? 0) - dt;
  if (s._blink <= 0) {
    s._blink = Math.max(0.1, left * 0.12);
    s._lit = !s._lit;
    self.glow(s._lit ? (left < 2 ? '#e8ff5a' : '#9cff4a') : null);
    if (s._lit && left < 3) game.audio.play('egg_pulse', { at: self.position, pitch: 1 + (3 - left) * 0.15 });
  }
  if (left > 0) return;
  const q = self.position;
  game.fx.burst({ x: q.x, y: q.y + 0.6, z: q.z }, { color: '#9cff4a', count: 40, speed: 4, gravity: 10, size: 0.14 });
  game.fx.burst({ x: q.x, y: q.y + 0.5, z: q.z }, { color: '#e8f0d0', count: 18, speed: 2.5, gravity: 6, size: 0.18 });
  game.audio.play('egg_hatch', { at: q });
  game.hud.marker(`egg:${self.id}`, null);
  for (let i = 0; i < BROOD; i++) {
    const a = (i / BROOD) * Math.PI * 2 + game.rng.range(0, 1);
    const at = { x: q.x + Math.cos(a) * 0.6, y: q.y + 0.1, z: q.z + Math.sin(a) * 0.6 };
    const sp = spawnMonster(game, 'spiderling', game.world.fits(at) ? at : { ...q }, { data: { master: self.data.master } });
    sp.impulse(Math.cos(a) * 5, 6, Math.sin(a) * 5);
  }
  self.remove();
};

export const eggSac: Minion = {
  id: 'egg_sac',
  define: () => ({
    name: 'Egg Sac',
    model: Models.gltf(MODEL.egg_sac, { clips: { idle: 'pulse' } }),
    hitbox: { width: 1.1, height: 1.3 },
    health: 20,
    speed: 0,
    knockbackResistance: 1,
    ai: eggAI,
    drops: [{ item: 'heart', chance: 0.3 }],
    sounds: { hurt: 'egg_squish', death: 'egg_splat' },
    bloodColor: '#9cff4a',
  }),
  spawned(game, e) {
    game.hud.marker(`egg:${e.id}`, e, { color: '#9cff4a', shape: 'diamond', size: 12, edge: true, pulse: true, offset: { x: 0, y: 1.7, z: 0 } });
  },
  slain(game, e, by) {
    const q = e.position;
    game.hud.marker(`egg:${e.id}`, null);
    game.fx.burst({ x: q.x, y: q.y + 0.6, z: q.z }, { color: '#9cff4a', count: 50, speed: 5, gravity: 12, size: 0.15 });
    if (by) bus.emit('feat', { player: by, name: 'boss_egg', text: `${by.name} smashed an egg sac` });
  },
};

/** A phylactery: a soul in a crystal, its master's shield while it stands. */
export const phylactery: Minion = {
  id: 'phylactery',
  define: () => ({
    name: 'Phylactery',
    model: Models.gltf(MODEL.phylactery, { clips: { idle: 'idle' } }),
    hitbox: { width: 1, height: 2.2 },
    health: 45,
    speed: 0,
    knockbackResistance: 1,
    ai: (self) => {
      // A slow pulse of soul-light.
      self.glow(Math.sin(self.age * 3) > 0.2 ? '#9fe8ff' : null);
    },
    sounds: { hurt: 'phylactery_hit', death: 'phylactery_break' },
    bloodColor: '#9fe8ff',
  }),
  spawned(game, e) {
    game.hud.marker(`phyl:${e.id}`, e, { color: '#9fe8ff', shape: 'diamond', size: 13, label: 'Phylactery', edge: true, pulse: true, offset: { x: 0, y: 2.6, z: 0 } });
  },
  slain(game, e, by) {
    const q = e.position;
    game.hud.marker(`phyl:${e.id}`, null);
    game.fx.burst({ x: q.x, y: q.y + 1.3, z: q.z }, { color: '#9fe8ff', count: 60, speed: 6, size: 0.16, gravity: 4, glow: 1.5 });
    game.fx.shockwave({ x: q.x, y: q.y + 0.1, z: q.z }, 4, '#9fe8ff');
    if (by) bus.emit('feat', { player: by, name: 'boss_phylactery', text: `${by.name} shattered a phylactery` });
  },
};

export const MINIONS: readonly Minion[] = [thrall, spiderling, eggSac, phylactery];
