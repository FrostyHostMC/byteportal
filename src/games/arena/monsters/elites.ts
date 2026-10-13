import type { DamageEvent, Entity, GameContext, Player, Vec3 } from '@platform';
import { bossKind } from '../bosses';
import { bus } from '../run/bus';
import { spawnMonster } from '../run/spawn';
import { state } from '../run/state';
import { monsterKind } from './index';
import { flat, grounded, ring, shakeNear, show } from './util';

/**
 * Elites: from the sixth wave, now and then a monster comes as a champion with an affix: a power
 * of its own, a gold name over its head, an aura in the affix's colour, and much more health
 * (it takes a fraction of every blow). It's worth more gold (`data.worth`, for the run), and its
 * affix is `data.elite`.
 */
export const AFFIXES = {
  fiery: { name: 'Fiery', color: '#ff7a2a', text: 'Burns those near it, and leaves fire where it walks' },
  frozen: { name: 'Frozen', color: '#8fd8ff', text: 'Its blows chill you slow; it dies in a burst of frost' },
  vampiric: { name: 'Vampiric', color: '#e0203a', text: 'Heals by what it hurts' },
  shielded: { name: 'Shielded', color: '#7fb8ff', text: 'A ward soaks up the first blows' },
  hasted: { name: 'Hasted', color: '#ffe14a', text: 'Quick as the wind' },
  explosive: { name: 'Explosive', color: '#ffb03a', text: 'Blows up when it dies: stand back' },
  splitting: { name: 'Splitting', color: '#a6e36a', text: 'Splits in two when it dies' },
  juggernaut: { name: 'Juggernaut', color: '#c9a2ff', text: 'Huge, unstoppable, hits like a cart' },
} as const;
export type Affix = keyof typeof AFFIXES;

const GOLD = '#ffd23a';

interface Elite {
  e: Entity;
  affix: Affix;
  /** It takes a share of each blow: 1 over this. */
  tough: number;
  /** A shielded one's ward (damage it soaks before it's broken). */
  ward: number;
  /** Fiery: when it last burned those near it, where it last left fire. */
  burn: number;
  trail: Vec3 | null;
}

const elites = new Map<number, Elite>();
/** Fire left on the ground by fiery elites: where, till when. */
let fires: { at: Vec3; until: number }[] = [];
let fireTick = 0;
/** Fighters chilled slow (by id): the speed to go back to, and when. */
const chilled = new Map<string, { until: number; speed: number; p: Player }>();
/** Elite Night: thrice the champions. */
let night = false;

export function resetElites() {
  elites.clear();
  fires = [];
  chilled.clear();
  fireTick = 0;
  night = false;
}

/**
 * The elite curve's knobs, for the run's difficulty to set (rather than editing the curve here):
 * `scale` times the chance, `from` the first wave elites come in (the curve starts there), `cap`
 * the most the chance gets to (an Elite Night's tripling included).
 */
export const eliteTuning = { scale: 1, from: 6, cap: 0.6 };

/** The chance a monster of wave `n` comes as an elite: from 6% at the sixth wave to 30% at the twentieth, and on up in the endless waves (as `eliteTuning` has it). */
export function eliteChance(n: number): number {
  const { scale, from, cap } = eliteTuning;
  if (n < from) return 0;
  const base = n <= 20 ? 0.06 + (n - from) * 0.017 : Math.min(0.45, 0.06 + (20 - from) * 0.017 + (n - 20) * 0.01);
  return Math.min(cap, base * scale * (night ? 3 : 1));
}

/** How much a juggernaut grows: two fifths again, but never past the gates' height (2.8). */
const growth = (game: GameContext, type: string) => Math.min(1.4, 2.8 / about(game, type).height);

/** Which affixes a kind can take (a slime splits anyway; a bat's no juggernaut, nor anything near the gates' height already). */
function affixesFor(game: GameContext, type: string): Affix[] {
  let all = Object.keys(AFFIXES) as Affix[];
  if (type.startsWith('slime')) all = all.filter((a) => a !== 'splitting');
  if (type === 'bat') all = all.filter((a) => a !== 'splitting');
  if (type === 'bat' || growth(game, type) < 1.12) all = all.filter((a) => a !== 'juggernaut');
  return all;
}

/**
 * A monster just in: an elite, perhaps (not a boss, a goblin, or one split, summoned or flocking;
 * and none on a boss's wave, which is the boss's).
 */
export function rollElite(game: GameContext, e: Entity, type: string) {
  if (state.boss || bossKind(type) || type === 'goblin' || !monsterKind(type) || e.data.spawned || e.data.flock || e.data.master) return;
  if (!game.rng.chance(eliteChance(state.wave))) return;
  makeElite(game, e, game.rng.pick(affixesFor(game, type)));
}

/** Make `e` an elite with `affix` (the roll's, or a cheat's). */
export function makeElite(game: GameContext, e: Entity, affix: Affix) {
  const a = AFFIXES[affix];
  const big = affix === 'juggernaut';
  const x: Elite = { e, affix, tough: big ? 4 : 2.5, ward: affix === 'shielded' ? e.maxHealth * 1.2 : 0, burn: 0, trail: null };
  elites.set(e.id, x);
  e.data.elite = affix;
  e.data.worth = big ? 4 : 3;
  if (affix === 'hasted' || big) {
    const speed = ((e.data.speed as number | undefined) ?? 1) * (big ? 0.85 : 1.5);
    e.data.speed = speed;
    e.setSpeed(speed);
  }
  if (big) e.size = growth(game, e.type);
  const name = `${a.name} ${about(game, e.type).name}`;
  const h = heightOf(game, e);
  game.hud.marker(`elite:${e.id}`, e, { color: GOLD, label: name, shape: 'dot', size: 5, offset: { x: 0, y: h + 0.45, z: 0 } });
  if (affix === 'shielded') game.hud.marker(`ward:${e.id}`, e, { color: a.color, shape: 'ring', size: { world: h * 0.9, min: 24 }, offset: { x: 0, y: h * 0.5, z: 0 } });
  show(game, 'elite', { id: e.id, affix, color: a.color });
  game.audio.play('elite', { at: e.position });
  game.hud.feed([{ text: name, color: GOLD }, `: ${a.text.toLowerCase()}`], { color: '#e8dcc0' });
}

/** A kind's name and height, as its definition gives them. */
const kinds = new Map<string, { name: string; height: number }>();
function about(game: GameContext, type: string) {
  let k = kinds.get(type);
  if (!k) {
    const def = monsterKind(type)?.define(game);
    k = { name: def?.name ?? 'Champion', height: def?.hitbox.height ?? 1.9 };
    kinds.set(type, k);
  }
  return k;
}

/** How tall it stands (its hitbox, as grown). */
const heightOf = (game: GameContext, e: Entity) => about(game, e.type).height * e.size;

/** Blows at and from elites (the `damage` event). */
export function eliteHits(game: GameContext, hit: DamageEvent) {
  const src = hit.source && hit.source !== 'world' && hit.source.kind === 'entity' ? elites.get(hit.source.id) : undefined;
  if (src?.affix === 'juggernaut') hit.amount *= 1.5;
  if (hit.target.kind !== 'entity') return;
  const x = elites.get(hit.target.id);
  if (!x) return;
  if (x.affix === 'juggernaut') hit.knockback = 0;
  if (x.ward > 0) {
    const soak = Math.min(x.ward, hit.amount);
    x.ward -= soak;
    hit.amount -= soak;
    const q = x.e.position;
    const h = heightOf(game, x.e);
    if (x.ward <= 0) {
      game.hud.marker(`ward:${x.e.id}`, null);
      game.fx.burst({ x: q.x, y: q.y + h * 0.5, z: q.z }, { color: AFFIXES.shielded.color, count: 40, speed: 5, glow: 1, life: 0.6 });
      game.audio.play('ward_break', { at: q });
    } else {
      game.fx.burst({ x: q.x, y: q.y + h * 0.5, z: q.z }, { color: AFFIXES.shielded.color, count: 8, speed: 3, glow: 1, life: 0.3 });
      game.audio.play('ward_hit', { at: q, volume: 0.7 });
    }
    if (hit.amount <= 0) {
      hit.cancel();
      return;
    }
  }
  hit.amount /= x.tough;
}

/** A blow from an elite landed on a fighter: a frozen one chills, a vampiric one drinks. */
export function eliteLanded(game: GameContext, p: Player, amount: number, source: unknown) {
  const s = source as Entity | undefined;
  if (!s || typeof s !== 'object' || s.kind !== 'entity') return;
  const x = elites.get(s.id);
  if (!x || !s.alive) return;
  if (x.affix === 'frozen') chill(game, p, 2);
  if (x.affix === 'vampiric') {
    s.heal(amount * 1.5);
    const q = s.position;
    game.fx.burst({ x: q.x, y: q.y + heightOf(game, s) * 0.6, z: q.z }, { color: AFFIXES.vampiric.color, count: 10, speed: 2, gravity: -2, glow: 0.8, life: 0.6 });
  }
}

/** A fighter chilled to half speed for a while, frost on their screen. */
export function chill(game: GameContext, p: Player, seconds: number) {
  const was = chilled.get(p.id);
  chilled.set(p.id, { until: game.clock.now + seconds, speed: was?.speed ?? p.speed, p });
  p.speed = (was?.speed ?? p.speed) * 0.55;
  p.fx.flash('#bfe8ff', 0.3, 0.4);
  p.audio.play('freeze', { volume: 0.7 });
}

/** An elite dead: its affix's last word (frost, a blast, a split), and the run told it's worth more. */
export function eliteSlain(game: GameContext, e: Entity, by: Player | null) {
  const x = elites.get(e.id);
  if (!x) return;
  elites.delete(e.id);
  game.hud.marker(`elite:${e.id}`, null);
  game.hud.marker(`ward:${e.id}`, null);
  const at = { ...e.position };
  const h = heightOf(game, e);
  game.fx.burst({ x: at.x, y: at.y + h * 0.6, z: at.z }, { color: GOLD, count: 36, speed: 5, gravity: 6, glow: 1, life: 0.8 });
  game.audio.play('elite_down', { at });
  if (by) bus.emit('feat', { player: by, name: 'elite', text: `${AFFIXES[x.affix].name} ${about(game, e.type).name} slain` });
  if (x.affix === 'frozen') {
    ring(game, at, 3.5, 0.7, AFFIXES.frozen.color);
    game.clock.after(0.7, () => {
      game.fx.burst({ x: at.x, y: at.y + 0.5, z: at.z }, { color: '#cfefff', count: 50, speed: 6, glow: 1, life: 0.6, drag: 2 });
      game.fx.shockwave({ x: at.x, y: at.y + 0.1, z: at.z }, 3.5, AFFIXES.frozen.color);
      game.audio.play('freeze', { at, volume: 1.2 });
      for (const p of grounded(game, at, 3.5, 2)) if (p.damage(2, { cause: 'frost', knockback: 0 })) chill(game, p, 2.5);
    });
  } else if (x.affix === 'explosive') {
    ring(game, at, 3.4, 0.9, AFFIXES.explosive.color);
    game.audio.play('fuse', { at, pitch: 1.3 });
    game.clock.after(0.9, () => {
      // The blast is its killer's (the monsters it takes are theirs), and it hurts fighters near it too.
      const c = { x: at.x, y: at.y + 0.8, z: at.z };
      game.world.explode(c, 2.5, { damage: [8, 2], reach: 3.4, knockback: 1.6, by: by ?? e, weapon: 'elite_blast', filter: () => false });
      if (by) {
        for (const p of game.players) {
          const d = Math.hypot(p.position.x - c.x, p.position.y + 0.9 - c.y, p.position.z - c.z);
          if (p.alive && d < 3.4 && game.world.lineOfSight(c, p.eye)) p.damage(8 - 6 * (d / 3.4), { source: e, from: c, knockback: 1.6, cause: 'explosion' });
        }
      }
      shakeNear(game, at, 0.3, 0.4);
    });
  } else if (x.affix === 'splitting') {
    game.audio.play('splat', { at, pitch: 0.8 });
    for (const side of [-1, 1]) {
      let q = { x: at.x + side * 0.8, y: at.y + 0.1, z: at.z };
      if (!game.world.fits(q)) q = { x: at.x, y: at.y + 0.1, z: at.z };
      const c = spawnMonster(game, e.type, q, { data: { spawned: true, master: e.id } });
      c.health = c.maxHealth * 0.6;
      c.impulse(side * 4, 5, game.rng.range(-2, 2));
      game.fx.burst({ x: q.x, y: q.y + 1, z: q.z }, { color: AFFIXES.splitting.color, count: 16, speed: 3, glow: 1, life: 0.5 });
    }
  }
}

/** Every tick: fire about the fiery ones and where they've walked, chills wearing off. */
export function elitesTick(game: GameContext) {
  const now = game.clock.now;
  for (const [id, x] of elites) {
    if (!x.e.alive) {
      elites.delete(id);
      game.hud.marker(`elite:${id}`, null);
      game.hud.marker(`ward:${id}`, null);
      continue;
    }
    if (x.affix !== 'fiery') continue;
    const q = x.e.position;
    if (now - x.burn >= 0.5) {
      x.burn = now;
      for (const p of game.players) if (p.alive && flat(p.position, q) < 2.2 && Math.abs(p.position.y - q.y) < 2) p.damage(0.8, { source: x.e, cause: 'fire', knockback: 0 });
    }
    if (x.e.onGround && (!x.trail || flat(x.trail, q) > 1.6)) {
      x.trail = { ...q };
      fires.push({ at: { ...q }, until: now + 4 });
      show(game, 'fire', { x: q.x, y: q.y, z: q.z, time: 4 });
    }
  }
  if (fires.length && now - fireTick >= 0.5) {
    fireTick = now;
    fires = fires.filter((f) => f.until > now);
    for (const p of game.players) {
      if (!p.alive) continue;
      if (fires.some((f) => flat(f.at, p.position) < 1 && Math.abs(p.position.y - f.at.y) < 1)) p.damage(0.8, { cause: 'fire', knockback: 0 });
    }
  }
  for (const [id, c] of chilled) {
    if (c.until > now && c.p.alive) continue;
    chilled.delete(id);
    c.p.speed = c.speed;
  }
}

/** Elite Night (a twist of the run's) triples the chance this wave. */
export function eliteNight(on: boolean) {
  night = on;
}

/** The elites standing, for a screen that's only just arrived. */
export function eliteList(): { id: number; affix: Affix; color: string }[] {
  return [...elites.values()].map((x) => ({ id: x.e.id, affix: x.affix, color: AFFIXES[x.affix].color }));
}
