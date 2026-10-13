import type { GameContext, IconRef, ItemDefinition } from '@platform';
import type { GunItem, ThrowableItem } from '@platform/items';
import type { Team } from './teams';

/**
 * The troopers' arsenal: blasters (the platform's guns, `kind: 'gun'`) and the thermal detonator
 * (a throwable). Numbers are tuned for 100 health: a blaster rifle takes five or six body hits, the
 * heavy repeater eight, the cycler rifle one to the head and two to the body, a blaster pistol three.
 *
 * **Heat, not magazines.** A blaster doesn't run dry: it heats up. Its `magazine` is how many
 * shots it takes to overheat; the reserve never runs out; its `reload` is venting (R vents early;
 * overheated, it vents by itself). And it cools while the trigger rests: `cool(game)` (each step on the server) puts shots back, and each shooter's screen
 * takes the cooled heat as its own once it's been quiet a moment (the gun kit's reconciling).
 *
 * The Rebels and the Empire carry their own blasters (their own look), which play alike: what a
 * class fights with is the same on both sides.
 *
 * This is what they do. How they look and sound (their models, bolts, holds and voices) is each
 * screen's: `client/looks.ts`.
 */

/** Rounds a blaster's reserve says it has: it never runs out. */
const ENDLESS = 99999;

const rifle: Omit<GunItem, 'name'> = {
  kind: 'gun',
  auto: true,
  rpm: 400,
  damage: [20, 14],
  falloff: [24, 60],
  headshot: 1.5,
  magazine: 26,
  reserve: ENDLESS,
  reload: 1.6,
  range: 180,
  spread: { hip: 1.6, aim: 0.18, move: 1.1, air: 2.6, bloom: 0.16 },
  recoil: { up: 0.55, side: 0.25, recover: 0.75 },
  aim: { zoom: 1.4, time: 0.2, move: 0.65, sight: 'holo', color: '#ff3b2e' },
  mobility: 1,
  carve: { radius: 0.11, depth: 0.03 },
};

const heavy: Omit<GunItem, 'name'> = {
  kind: 'gun',
  auto: true,
  rpm: 720,
  damage: [13, 9],
  falloff: [16, 42],
  headshot: 1.4,
  magazine: 70,
  reserve: ENDLESS,
  reload: 2.4,
  range: 140,
  spread: { hip: 2.6, aim: 1.0, move: 1.2, air: 3, bloom: 0.1 },
  recoil: { up: 0.35, side: 0.4, recover: 0.8 },
  aim: { zoom: 1.2, time: 0.3, move: 0.55, sight: 'holo', color: '#ff3b2e' },
  mobility: 0.88,
  carve: { radius: 0.1, depth: 0.025 },
};

const sniper: Omit<GunItem, 'name'> = {
  kind: 'gun',
  rpm: 55,
  damage: [62, 55],
  falloff: [70, 160],
  headshot: 2.2,
  magazine: 4,
  reserve: ENDLESS,
  reload: 2.2,
  range: 260,
  spread: { hip: 6, aim: 0, move: 4, air: 7, bloom: 0 },
  recoil: { up: 3.6, side: 0.8, recover: 0.65 },
  aim: { zoom: 4, time: 0.3, move: 0.45, sight: 'scope' },
  action: 'bolt',
  mobility: 0.92,
  carve: { radius: 0.13, depth: 0.25 },
  penetration: { depth: 1.1, damageLoss: 0.3 },
};

const pistol: Omit<GunItem, 'name'> = {
  kind: 'gun',
  rpm: 330,
  damage: [34, 22],
  falloff: [14, 36],
  headshot: 1.6,
  magazine: 12,
  reserve: ENDLESS,
  reload: 1.2,
  range: 120,
  spread: { hip: 1.5, aim: 0.3, move: 0.9, air: 2.2, bloom: 0.45 },
  recoil: { up: 1.2, side: 0.35, recover: 0.85 },
  aim: { zoom: 1.2, time: 0.14, move: 0.85, sight: 'dot', color: '#ff3b2e' },
  mobility: 1.08,
  carve: { radius: 0.1, depth: 0.03 },
};

export const BLASTERS: Record<string, GunItem> = {
  // The Rebels'.
  rebel_rifle: { ...rifle, name: 'A-28 Blaster Rifle' },
  rebel_heavy: { ...heavy, name: 'Z-7 Rotary Blaster' },
  rebel_sniper: { ...sniper, name: 'Longshot Cycler' },
  rebel_pistol: { ...pistol, name: 'Heavy Blaster Pistol' },
  // The Empire's.
  imp_rifle: { ...rifle, name: 'E-12 Blaster Rifle' },
  imp_heavy: { ...heavy, name: 'T-22 Repeater' },
  imp_sniper: { ...sniper, name: 'E-12 Sniper' },
  imp_pistol: { ...pistol, name: 'Scout Blaster Pistol' },
};

/** How long after a shot a blaster starts cooling, and how fast (a full magazine's worth in this many seconds). */
export const COOL_AFTER = 0.45;
export const COOL_FULL = 1.6;

export const DETONATOR: ThrowableItem = {
  kind: 'throwable',
  name: 'Thermal Detonator',
  key: 'KeyG',
  fuse: 2.6,
  cook: true,
  speed: 20,
  lift: 8,
  physics: { gravity: 24, bounce: 0.25, friction: 0.5, radius: 0.12 },
  blast: { radius: 5.5, damage: [150, 18], knockback: 1.3, carve: 2.2, size: 2, color: '#9fd8ff' },
  cooldown: 0.9,
  stack: 2,
};

/** The weapons a class carries, for each side. */
export type Slot = 'rifle' | 'heavy' | 'sniper' | 'pistol';
export const weaponFor = (team: Team, slot: Slot) => `${team === 0 ? 'rebel' : 'imp'}_${slot}`;

export function defineWeapons(game: GameContext) {
  for (const [id, def] of Object.entries(BLASTERS)) game.items.define(id, def as ItemDefinition);
  game.items.define('detonator', DETONATOR);
}

/** The icon a weapon shows in the kill feed: its own, side on, as each screen has it. */
export const feedIcon = (id: string): IconRef | null => (BLASTERS[id] ? { item: id, view: 'side' } : id === 'detonator' ? { item: id } : null);

export const weaponName = (id: string) => BLASTERS[id]?.name ?? (id === 'detonator' ? DETONATOR.name : id);
