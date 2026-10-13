import { math, type GameContext, type Pickup, type Player, type Prop, type PropModel, type Vec3 } from '@platform';
import { LID_HINGE, RUN_MODELS } from '../models/run';
import { bus } from './bus';
import { addGold, spend } from './gold';
import { chestSpin, describe, dropWeapon, rarityColor, rarityOf, rollWeapon } from './loot';
import { map, state } from './state';
import { addUsable } from './use';

/**
 * The mystery chest: it stands at one of the map's `chests` spots, any time, and for `PRICE` gold
 * E opens it. Light pours out and weapons spin above it (each screen's show, `client/run.ts`, the
 * `arena.chest` message) until it settles on one, of some rarity (`loot.ts`: rarer later, never a
 * plain one from wave 10), left floating in a
 * beam of its colour for whoever paid. After a few rolls at one spot it may laugh a skull out
 * instead: the gold back, and the chest flies off to another spot.
 */
export const PRICE = 200;
/** The show, and how long the weapon waits there for them. */
export const ROLL_TIME = 4.2;
const TAKE_TIME = 12;
/** It may fly off once it's given this many at one spot, this often. */
const STAYS = 3;
const FLY_CHANCE = 0.2;
const FLY_TIME = 1.6;
const AWAY = 8;
/** Not shown to anyone: what the screens draw spinning out of it when it flies off. */
export const SKULL = 'chest_skull';
/** How fast the lid swings (fractions of open a second), and how far open is. */
const LID_SPEED = 3;
const LID_OPEN = 1.9;

const UP = new math.Vector3(0, 1, 0);
const X = new math.Vector3(1, 0, 0);
const FWD = new math.Vector3(0, 0, -1);

const chest = {
  /** Which of the map's spots it's at, and its props there (null: away). */
  spot: 0,
  base: null as Prop | null,
  lid: null as Prop | null,
  beam: null as Prop | null,
  rolls: 0,
  /** The lid: how open (0..1) and where it's going. */
  open: 0,
  to: 0,
  /** A roll under way: whose, when it shows, what it gives (null: the skull), what they paid. */
  roll: null as { by: Player; at: number; item: string | null; color: string; price: number } | null,
  /** The weapon waiting for them, and until when. */
  prize: null as { pickup: Pickup; until: number } | null,
  /** Flying off (since when), and when it comes back. */
  flying: -1,
  backAt: 0,
};
let models: { base: PropModel; lid: PropModel } | null = null;

const spots = (): Vec3[] => map().chests ?? [];
/** Where its top is (rolls show above it), or null while it's away. */
const top = (): Vec3 | null => {
  const b = chest.base;
  return b ? { x: b.position.x, y: b.position.y + 0.9, z: b.position.z } : null;
};

/** Stand it at spot `i`, facing the middle of the map. */
function place(game: GameContext, i: number) {
  const s = spots()[i];
  if (!s || !models) return;
  const c = map().center;
  chest.spot = i;
  chest.rolls = 0;
  chest.open = chest.to = 0;
  const base = game.props.spawn(models.base, { position: { x: s.x, y: s.y, z: s.z } });
  base.quaternion.setFromAxisAngle(UP, Math.atan2(c.x - s.x, c.z - s.z));
  const lid = game.props.spawn(models.lid);
  lid.attach(base);
  lid.position.set(LID_HINGE.x, LID_HINGE.y, LID_HINGE.z);
  chest.base = base;
  chest.lid = lid;
  game.hud.marker('arena.chest', { x: s.x, y: s.y + 1.4, z: s.z }, { label: '?', color: '#7fc8ff', shape: 'diamond', size: 9 });
}

function clear() {
  chest.beam?.remove();
  chest.lid?.remove();
  chest.base?.remove();
  chest.beam = chest.lid = chest.base = null;
}

/** A light pillar out of the open chest. */
function beam(game: GameContext, color: string) {
  chest.beam?.remove();
  const t = top();
  if (!t) return;
  const b = game.props.bolt({ color, length: 9, width: 0.55, intensity: 3.5, flicker: 0.15 });
  b.position.set(t.x, t.y - 0.3, t.z);
  b.quaternion.setFromUnitVectors(FWD, UP);
  chest.beam = b;
}

/** Pay, and open it: the show begins on every screen; what it gives is decided now. */
export function rollChest(game: GameContext, p: Player): boolean {
  const t = top();
  if (!t || chest.roll || chest.prize || chest.flying >= 0) return false;
  if (!spend(game, p, PRICE)) {
    p.hud.toast(`The mystery chest takes ${PRICE} gold`);
    p.audio.play('gun_empty');
    return false;
  }
  chest.rolls++;
  const cleared = state.phase === 'fighting' ? state.wave - 1 : state.wave;
  const flies = chest.rolls > STAYS && spots().length > 1 && game.rng.chance(FLY_CHANCE);
  const item = rollWeapon(game, Math.max(1, cleared));
  const color = flies ? '#ff4d4d' : rarityColor(item);
  chest.roll = { by: p, at: game.clock.now + ROLL_TIME, item: flies ? null : item, color, price: PRICE };
  chest.to = 1;
  beam(game, '#ffe9a8');
  // What spins above it on every screen: a run of the arsenal, slowing to what it gives.
  const spin = chestSpin(game, 16);
  const b = chest.base!;
  game.clients.send('all', 'arena.chest', { at: [t.x, t.y, t.z], yaw: Math.atan2(map().center.x - b.position.x, map().center.z - b.position.z), spin, final: flies ? SKULL : item, color, time: ROLL_TIME });
  game.audio.play('chest_open', { at: t });
  game.audio.play('chest_spin', { at: t });
  return true;
}

function reveal(game: GameContext) {
  const r = chest.roll!;
  chest.roll = null;
  const t = top()!;
  if (!r.item) return flyOff(game, r.by, r.price);
  const legendary = rarityOf(r.item) === 'legendary';
  const pickup = dropWeapon(game, r.item, { x: t.x, y: t.y + 0.4, z: t.z }, { despawn: TAKE_TIME, for: game.players.length > 1 ? r.by : undefined });
  chest.prize = { pickup, until: game.clock.now + TAKE_TIME };
  beam(game, r.color);
  game.audio.play('chest_reveal', { at: t, pitch: legendary ? 0.8 : 1 });
  game.fx.burst(t, { color: r.color, count: 40, speed: 4, gravity: 2, glow: 1 });
  const name = game.items.get(r.item)?.name ?? r.item;
  const line = describe(r.item);
  r.by.hud.toast(line ? `${name}: ${line}` : name);
  if (legendary) {
    r.by.achieve('high_roller');
    game.hud.feed([{ text: r.by.name, color: '#ffd23a' }, ' rolled a legendary ', { icon: { item: r.item } }, { text: name, color: r.color }]);
  }
  bus.emit('chest', { player: r.by, item: r.item });
}

/** The skull: the gold back, a laugh, and up and away it goes. */
function flyOff(game: GameContext, by: Player, price: number) {
  addGold(game, by, price, undefined, 'gift');
  chest.flying = game.clock.now;
  chest.to = 0;
  chest.beam?.remove();
  chest.beam = null;
  const t = top()!;
  game.audio.play('chest_laugh', { at: t });
  game.fx.burst(t, { color: '#ff4d4d', count: 30, speed: 3, glow: 1 });
  game.hud.feed('The mystery chest flies away!', { color: '#ff8a4c' });
  by.achieve('bad_luck');
  bus.emit('chest', { player: by, item: null });
}

export function chestSetup(game: GameContext) {
  models = { base: game.props.gltf(RUN_MODELS.chest, { radius: 0.9 }), lid: game.props.gltf(RUN_MODELS.chestLid, { radius: 0.8 }) };
  game.items.define(SKULL, { kind: 'misc', name: 'Skull' });
  addUsable({
    id: 'chest',
    at: () => (chest.roll || chest.prize || chest.flying >= 0 ? null : top()),
    reach: 2.6,
    label: () => `Mystery chest · ${PRICE} gold`,
    use: (g, p) => void rollChest(g, p),
  });
}

/** A fight begins: the chest at the first of the map's spots. */
export function chestStart(game: GameContext) {
  // (The restart took the props and the timers.)
  chest.base = chest.lid = chest.beam = null;
  chest.roll = null;
  chest.prize = null;
  chest.flying = -1;
  game.hud.marker('arena.chest', null);
  if (spots().length) place(game, game.rng.int(0, spots().length - 1));
}

export function chestUpdate(game: GameContext, dt: number) {
  const now = game.clock.now;
  if (chest.roll && now >= chest.roll.at) reveal(game);
  if (chest.prize && (!chest.prize.pickup.alive || now >= chest.prize.until)) {
    chest.prize.pickup.remove();
    chest.prize = null;
    chest.to = 0;
    chest.beam?.remove();
    chest.beam = null;
  }
  // The lid swings to where it's going.
  if (chest.lid && chest.open !== chest.to) {
    chest.open = chest.to > chest.open ? Math.min(chest.to, chest.open + LID_SPEED * dt) : Math.max(chest.to, chest.open - LID_SPEED * 1.5 * dt);
    chest.lid.quaternion.setFromAxisAngle(X, -LID_OPEN * chest.open);
  }
  // Flying off: up, spinning faster, then gone till it lands somewhere else.
  if (chest.flying >= 0 && chest.base) {
    const t = now - chest.flying;
    const s = spots()[chest.spot];
    chest.base.position.set(s.x, s.y + t * t * 6, s.z);
    chest.base.quaternion.setFromAxisAngle(UP, t * t * 9);
    if (t >= FLY_TIME) {
      game.fx.burst({ x: s.x, y: s.y + FLY_TIME * FLY_TIME * 6, z: s.z }, { color: '#7fc8ff', count: 40, speed: 5, glow: 1 });
      clear();
      game.hud.marker('arena.chest', null);
      chest.backAt = now + AWAY;
    }
  } else if (chest.flying >= 0 && now >= chest.backAt) {
    chest.flying = -1;
    const others = spots().map((_, i) => i).filter((i) => i !== chest.spot);
    place(game, game.rng.pick(others));
    const s = spots()[chest.spot];
    game.fx.burst({ x: s.x, y: s.y + 0.6, z: s.z }, { color: '#7fc8ff', count: 40, speed: 4, gravity: -1, glow: 1 });
    game.audio.play('chest_land', { at: s });
    game.hud.feed('The mystery chest has landed somewhere new', { color: '#7fc8ff' });
  }
}
