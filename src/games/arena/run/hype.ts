import type { GameContext, Player, Vec3 } from '@platform';
import { bossKind } from '../bosses';
import { bus } from './bus';
import { map, state } from './state';

/**
 * The crowd's hype (0..1), one crowd for everyone: every kill warms it, style warms it faster (a
 * feat on the bus: multikills, blasts, traps, clutch kills, elites, a goblin caught, a revive, a
 * parry), blows on a boss stir it, and it cools when nothing happens. Full, it boils over into the
 * Crowd's Favour: ten seconds of double gold (`favoured`), the crowd roaring, and the emperor's gifts
 * thrown down into the arena. Each change goes out on the bus (`hype`) for the HUD and the crowd's
 * voice; feats go out as `feat` for the announcer.
 */

/** Each kill, and each feat by name (a feat not named here: `FEAT_DEFAULT`). */
const KILL = 0.025;
const FEATS: Record<string, number> = {
  double_kill: 0.04,
  triple_kill: 0.07,
  multi_kill: 0.1,
  rampage: 0.12,
  kaboom: 0.1,
  trap: 0.04,
  clutch: 0.07,
  elite: 0.05,
  goblin: 0.12,
  boss_slain: 0.5,
  revive: 0.1,
  phoenix: 0.08,
  untouched: 0.06,
  last_stand: 0.15,
  parry: 0.05,
  boss_crash: 0.12,
  boss_stagger: 0.08,
};
const FEAT_DEFAULT = 0.05;
/** A boss's blows: this much per point of damage dealt to it. */
const BOSS_HIT = 0.0009;
/** It cools this much a second once nothing has happened for `COOL_AFTER` seconds (faster between waves). */
const COOL = 0.025;
const COOL_CALM = 0.05;
const COOL_AFTER = 2.5;
/** How far it cools before the bus is told again. */
const COOL_STEP = 0.04;
export const FAVOUR = 10;
/** Seconds between the emperor's gifts while the Favour lasts. */
const GIFT_EVERY = 0.7;
/** What the emperor throws: picked by weight. Coins are thrown as gold (`coins.ts` defines them). */
const GIFTS: { item: string; count: number; weight: number }[] = [
  { item: 'coin_pile', count: 25, weight: 4 },
  { item: 'health_potion', count: 1, weight: 2 },
  { item: 'heart', count: 1, weight: 2 },
  { item: 'bomb_bundle', count: 2, weight: 2 },
  { item: 'arrow_bundle', count: 2, weight: 1 },
];

const hype = { value: 0, lastGain: -99, favourUntil: 0, nextGift: 0, sent: -1, sentFavour: false };

/** The Crowd's Favour is on: gold counts double. */
export const favoured = (game: GameContext) => game.clock.now < hype.favourUntil;
export const hypeValue = () => hype.value;

/** Warm the crowd (in a fight, or a moment after one). Full, it boils over. */
export function cheer(game: GameContext, amount: number) {
  if (state.phase !== 'fighting' && state.phase !== 'intermission') return;
  hype.lastGain = game.clock.now;
  if (favoured(game)) return;
  hype.value = Math.min(1, hype.value + amount);
  if (hype.value >= 1) boilOver(game);
}

/** Tell the bus of a feat (and the crowd warms to it). */
export function feat(player: Player | null, name: string, text: string) {
  bus.emit('feat', { player, name, text });
}

function boilOver(game: GameContext) {
  hype.favourUntil = game.clock.now + FAVOUR;
  hype.nextGift = game.clock.now + 0.6;
  hype.value = 1;
  game.audio.play('roar', { volume: 1.2 });
  game.fx.shake(0.08, 0.8);
  for (const p of game.players) if (!p.bot) p.achieve('crowd_favourite');
  bus.emit('feat', { player: null, name: 'favour', text: "The Crowd's Favour!" });
}

/** A gift from the emperor, thrown from the stands to somewhere on the sand. */
function gift(game: GameContext) {
  const m = map();
  const total = GIFTS.reduce((a, g) => a + g.weight, 0);
  let r = game.rng.next() * total;
  const g = GIFTS.find((x) => (r -= x.weight) <= 0) ?? GIFTS[0];
  // Thrown from the rim of the stands toward a spot near someone fighting (or the middle).
  const fighters = game.players.filter((p) => p.alive && !p.spectating);
  const near: Vec3 = fighters.length ? game.rng.pick(fighters).position : m.center;
  const to = { x: near.x + game.rng.range(-3, 3), z: near.z + game.rng.range(-3, 3) };
  const a = Math.atan2(to.z - m.center.z, to.x - m.center.x) + game.rng.range(-0.6, 0.6);
  const from = { x: m.center.x + Math.cos(a) * (m.radius + 1), y: m.center.y + 10, z: m.center.z + Math.sin(a) * (m.radius + 1) };
  // A lob that lands about where it's aimed (the pickup's own drag and gravity: 22).
  const t = 1.3;
  const k = (1 - Math.exp(-2 * t)) / 2;
  const velocity = { x: (to.x - from.x) / k, y: (near.y - from.y + 11 * t * t) / t, z: (to.z - from.z) / k };
  game.items.spawnPickup(g.item, from, { count: g.count, velocity, despawn: 40 });
  game.fx.burst(from, { color: '#ffd23a', count: 10, speed: 2, glow: 1, life: 0.6 });
}

export function hypeListen(game: GameContext) {
  bus.on('slain', ({ by, type }) => {
    if (by && !bossKind(type)) cheer(game, KILL);
  });
  bus.on('feat', ({ name }) => {
    if (name !== 'favour') cheer(game, FEATS[name] ?? FEAT_DEFAULT);
  });
  game.events.on('entityDamage', ({ entity, amount, source }) => {
    if (source && source !== 'world' && source.kind === 'player' && bossKind(entity.type)) cheer(game, amount * BOSS_HIT);
  });
}

export function hypeUpdate(game: GameContext, dt: number) {
  const now = game.clock.now;
  const on = favoured(game);
  if (on) {
    hype.value = Math.max(0, (hype.favourUntil - now) / FAVOUR);
    if (now >= hype.nextGift) {
      hype.nextGift = now + GIFT_EVERY;
      gift(game);
    }
  } else if (hype.favourUntil > 0 && hype.value > 0 && now >= hype.favourUntil) {
    // The Favour's over: the crowd starts again from nothing.
    hype.value = 0;
  } else if (now - hype.lastGain > COOL_AFTER) {
    hype.value = Math.max(0, hype.value - (state.phase === 'fighting' ? COOL : COOL_CALM) * dt);
  }
  // (Told when it rises, but cooling only every few hundredths: the meter needn't hear every tick of it.)
  const d = hype.value - hype.sent;
  if (d >= 0.01 || d <= -COOL_STEP || on !== hype.sentFavour || (hype.value === 0 && hype.sent !== 0)) {
    hype.sent = hype.value;
    hype.sentFavour = on;
    bus.emit('hype', { value: hype.value, favour: on });
  }
}

/** A fresh fight: a quiet crowd. */
export function resetHype() {
  Object.assign(hype, { value: 0, lastGain: -99, favourUntil: 0, nextGift: 0, sent: -1, sentFavour: false });
}
