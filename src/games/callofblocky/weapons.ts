import type { GameContext, IconRef } from '@platform';
import type { GunItem, MeleeItem, ThrowableItem } from '@platform/items';
import { isKillstreak, isStreak, KILLSTREAKS } from './streaks/kinds';

/**
 * The arsenal. Everyone carries a primary and a sidearm of their choosing and the Hattori katana.
 * Numbers are tuned for 100 health: most guns kill in three to five body shots, heads take fewer,
 * the katana, the Honey Bunny and Rock Salt (up close) in one, Bad Mother in two.
 *
 * The primaries: the Big Kahuna (an all-rounder), the FAMAS (a bullpup that fires faster and hits
 * a little lighter: four to the body up close, five further off), two SMGs (the Mac-10, quick and light; the
 * Wolf, a Tommy gun with a fifty-round drum, heavier to swing), two shotguns (Zed's Pump; Rock
 * Salt, a sawn-off with both barrels one after the other and then a reload), Marsellus (a
 * machine gun: a hundred-round belt, slow to aim and to reload), and two scoped rifles (Ezekiel,
 * semi-automatic, three to the body; the Honey Bunny, a bolt gun, one). The sidearms: the Lucky
 * 45, quick and steady, or Bad Mother, a magnum revolver that kicks.
 *
 * Every bullet chips the walls (`carve`): a pit `radius` round, and each shot on the same spot
 * goes about `radius + depth` further in. Through a block-thick wall that's about eight rifle or
 * pistol shots, ten from the SMG, two from the Honey Bunny; the shotgun's pellets pepper it.
 *
 * The rifles (the FAMAS a little less), Marsellus, the pistols and the Honey Bunny wall-bang (`penetration`): the rifle
 * through a block-thick wall head on (at about two thirds of its damage), Marsellus and Ezekiel a
 * little more, the pistols only through thinner stuff (a wall already shot into, a slab, a door),
 * the Honey Bunny through two blocks and still a kill up close.
 *
 * And a lethal (G): the Pineapple, a frag that bounces and rolls and blows a crater in a wall,
 * or the Mia, a five-dollar shake bottle full of fuel that breaks where it lands and burns.
 *
 * This is what they do. How they look and sound (their models and icons, where they sit in first
 * person, tracers, trails, their voices) is each screen's: `client/looks.ts`.
 */

export const WEAPONS: Record<string, GunItem | MeleeItem> = {
  rifle: {
    kind: 'gun',
    name: 'Big Kahuna',
    auto: true,
    rpm: 640,
    damage: [30, 22],
    falloff: [22, 48],
    headshot: 1.5,
    magazine: 30,
    reserve: 120,
    reload: 2.1,
    spread: { hip: 2.2, aim: 0.12, move: 1.3, air: 3, bloom: 0.22 },
    recoil: { up: 0.85, side: 0.35, recover: 0.7 },
    aim: { zoom: 1.35, time: 0.22, move: 0.62, sight: 'holo' },
    mobility: 0.95,
    carve: { radius: 0.09, depth: 0.04 },
    penetration: { depth: 1.15, damageLoss: 0.32 },
  } satisfies GunItem,
  famas: {
    kind: 'gun',
    name: 'FAMAS',
    auto: true,
    rpm: 900,
    damage: [28, 20],
    falloff: [18, 42],
    headshot: 1.5,
    magazine: 30,
    reserve: 120,
    reload: 2.4,
    spread: { hip: 2.3, aim: 0.15, move: 1.2, air: 3, bloom: 0.2 },
    recoil: { up: 0.55, side: 0.3, recover: 0.75 },
    aim: { zoom: 1.35, time: 0.2, move: 0.65, sight: 'holo', color: '#6fa8ff' },
    mobility: 0.97,
    carve: { radius: 0.09, depth: 0.035 },
    penetration: { depth: 1.05, damageLoss: 0.36 },
  } satisfies GunItem,
  smg: {
    kind: 'gun',
    name: 'Mac-10',
    auto: true,
    rpm: 950,
    damage: [24, 14],
    falloff: [10, 26],
    headshot: 1.4,
    magazine: 32,
    reserve: 160,
    reload: 1.7,
    spread: { hip: 2.6, aim: 0.55, move: 0.8, air: 2.4, bloom: 0.18 },
    recoil: { up: 0.5, side: 0.5, recover: 0.8 },
    aim: { zoom: 1.2, time: 0.15, move: 0.8, sight: 'holo' },
    mobility: 1.08,
    carve: { radius: 0.1, depth: 0.025 },
  } satisfies GunItem,
  shotgun: {
    kind: 'gun',
    name: "Zed's Pump",
    rpm: 72,
    pellets: 9,
    damage: [15, 4],
    falloff: [6, 18],
    headshot: 1.2,
    magazine: 6,
    reserve: 30,
    reload: 0.48,
    shells: true,
    range: 45,
    spread: { hip: 5.2, aim: 4.2, move: 0.8, air: 1, bloom: 0 },
    recoil: { up: 3.5, side: 1, recover: 0.8 },
    aim: { zoom: 1.15, time: 0.18, move: 0.75, sight: 'holo' },
    action: 'pump',
    carve: { radius: 0.07, depth: 0.01 },
  } satisfies GunItem,
  sniper: {
    kind: 'gun',
    name: 'Honey Bunny',
    rpm: 46,
    damage: [110, 90],
    falloff: [60, 120],
    headshot: 2,
    magazine: 5,
    reserve: 25,
    reload: 2.6,
    range: 250,
    spread: { hip: 7, aim: 0, move: 5, air: 8, bloom: 0 },
    recoil: { up: 4.5, side: 1, recover: 0.6 },
    aim: { zoom: 4, time: 0.32, move: 0.45, sight: 'scope' },
    action: 'bolt',
    mobility: 0.9,
    carve: { radius: 0.12, depth: 0.42 },
    penetration: { depth: 2.2, damageLoss: 0.18 },
  } satisfies GunItem,
  tommy: {
    kind: 'gun',
    name: 'The Wolf',
    auto: true,
    rpm: 720,
    damage: [27, 17],
    falloff: [12, 30],
    headshot: 1.4,
    magazine: 50,
    reserve: 150,
    reload: 2.8,
    spread: { hip: 2.3, aim: 0.5, move: 0.9, air: 2.6, bloom: 0.16 },
    recoil: { up: 0.62, side: 0.5, recover: 0.75 },
    aim: { zoom: 1.2, time: 0.2, move: 0.75, sight: 'holo', color: '#5fffe0' },
    mobility: 1.02,
    carve: { radius: 0.1, depth: 0.03 },
  } satisfies GunItem,
  lmg: {
    kind: 'gun',
    name: 'Marsellus',
    auto: true,
    rpm: 600,
    damage: [30, 23],
    falloff: [25, 55],
    headshot: 1.4,
    magazine: 100,
    reserve: 200,
    reload: 5,
    range: 170,
    spread: { hip: 3.4, aim: 0.35, move: 1.8, air: 3.5, bloom: 0.12 },
    recoil: { up: 0.7, side: 0.6, recover: 0.6 },
    aim: { zoom: 1.3, time: 0.4, move: 0.45, sight: 'holo', color: '#ff8a2a' },
    mobility: 0.84,
    carve: { radius: 0.1, depth: 0.05 },
    penetration: { depth: 1.4, damageLoss: 0.28 },
  } satisfies GunItem,
  marksman: {
    kind: 'gun',
    name: 'Ezekiel',
    rpm: 320,
    damage: [40, 34],
    falloff: [40, 100],
    headshot: 1.8,
    magazine: 12,
    reserve: 48,
    reload: 2.4,
    range: 220,
    spread: { hip: 4.5, aim: 0.04, move: 2.2, air: 5, bloom: 0.9 },
    recoil: { up: 2.4, side: 0.5, recover: 0.8 },
    aim: { zoom: 2.6, time: 0.28, move: 0.55, sight: 'scope' },
    mobility: 0.94,
    carve: { radius: 0.1, depth: 0.1 },
    penetration: { depth: 1.6, damageLoss: 0.25 },
  } satisfies GunItem,
  sawnoff: {
    kind: 'gun',
    name: 'Rock Salt',
    rpm: 260,
    pellets: 10,
    damage: [17, 3],
    falloff: [5, 13],
    headshot: 1.2,
    magazine: 2,
    reserve: 24,
    reload: 2.1,
    range: 30,
    spread: { hip: 6, aim: 5, move: 0.8, air: 1, bloom: 0 },
    recoil: { up: 5, side: 1.5, recover: 0.75 },
    aim: { zoom: 1.1, time: 0.16, move: 0.8, sight: 'dot' },
    mobility: 1.04,
    carve: { radius: 0.07, depth: 0.012 },
  } satisfies GunItem,
  pistol: {
    kind: 'gun',
    name: 'Lucky 45',
    rpm: 420,
    damage: [38, 26],
    falloff: [15, 35],
    headshot: 1.6,
    magazine: 8,
    reserve: 48,
    reload: 1.4,
    spread: { hip: 1.8, aim: 0.3, move: 1, air: 2.5, bloom: 0.5 },
    recoil: { up: 1.4, side: 0.4, recover: 0.85 },
    aim: { zoom: 1.2, time: 0.14, move: 0.85, sight: 'dot' },
    mobility: 1.1,
    carve: { radius: 0.09, depth: 0.04 },
    penetration: { depth: 0.7, damageLoss: 0.45 },
  } satisfies GunItem,
  revolver: {
    kind: 'gun',
    name: 'Bad Mother',
    rpm: 160,
    damage: [58, 40],
    falloff: [14, 38],
    headshot: 1.75,
    magazine: 6,
    reserve: 30,
    reload: 2.3,
    spread: { hip: 1.9, aim: 0.2, move: 1.1, air: 2.6, bloom: 1 },
    recoil: { up: 4.2, side: 0.8, recover: 0.8 },
    aim: { zoom: 1.25, time: 0.18, move: 0.82, sight: 'dot' },
    mobility: 1.08,
    carve: { radius: 0.1, depth: 0.06 },
    penetration: { depth: 0.8, damageLoss: 0.4 },
  } satisfies GunItem,
  katana: {
    kind: 'melee',
    name: 'Hattori Katana',
    damage: 101,
    cooldown: 0.65,
    reach: 3.6,
    knockback: 0.4,
  } satisfies MeleeItem,
};

/** The lethals, thrown with G (hold to cook the Pineapple). */
export const LETHALS: Record<string, ThrowableItem> = {
  frag: {
    kind: 'throwable',
    name: 'The Pineapple',
    key: 'KeyG',
    fuse: 3.2,
    speed: 21,
    lift: 8,
    // It doesn't bounce far off a wall, so it goes off by the wall it was thrown at.
    physics: { gravity: 24, bounce: 0.18, friction: 0.55, radius: 0.1 },
    // Lethal within about two and a half blocks, a scratch at five and a half; it blows through a
    // wall a block thick from a block away.
    blast: { radius: 5.5, damage: [165, 18], knockback: 1.2, carve: 2.4, size: 2.2 },
    cooldown: 0.9,
    stack: 2,
  },
  molotov: {
    kind: 'throwable',
    name: 'The Mia',
    key: 'KeyG',
    impact: true,
    fuse: 4,
    speed: 18,
    lift: 10,
    physics: { gravity: 24, bounce: 0.2, friction: 0.5, radius: 0.1 },
    // A puddle of fire three blocks round for seven seconds: stand in it and it's about three.
    fire: { radius: 3, duration: 7, damage: 34, color: '#ff8a2a' },
    cooldown: 0.9,
    stack: 1,
  },
};

/** How many of each a fighter carries a life. */
export const LETHAL_COUNT: Record<string, number> = { frag: 2, molotov: 1 };
export type Lethal = keyof typeof LETHALS & string;

/** One line about each, for the loadout menu. */
export const LETHAL_BLURBS: Record<string, string> = {
  frag: 'Frag ×2 · cook it, bank it, crater a wall',
  molotov: 'Firebomb ×1 · breaks where it lands, burns a while',
};

/** The primaries on offer, in the order the loadout menu lists them. */
export const PRIMARIES = ['rifle', 'famas', 'smg', 'tommy', 'shotgun', 'sawnoff', 'lmg', 'marksman', 'sniper'] as const;
export type Primary = (typeof PRIMARIES)[number];

/** The sidearms on offer. */
export const SIDEARMS = ['pistol', 'revolver'] as const;
export type Sidearm = (typeof SIDEARMS)[number];

/** One line about each, for the loadout menu. */
export const BLURBS: Record<Primary | Sidearm, string> = {
  rifle: 'Assault rifle · all-rounder',
  famas: 'Bullpup rifle · fast fire, light recoil',
  smg: 'SMG · fast and close',
  tommy: 'Drum SMG · fifty rounds, a heavy hand',
  shotgun: 'Pump shotgun · one pump, one body',
  sawnoff: 'Sawn-off · both barrels, then reload',
  lmg: 'Machine gun · a hundred-round belt, slow to aim',
  marksman: 'Marksman rifle · semi-auto, low scope, three to the body',
  sniper: 'Bolt sniper · one shot, long street',
  pistol: 'Pistol · quick and steady',
  revolver: 'Magnum revolver · two to the body, kicks like a mule',
};

export function defineWeapons(game: GameContext) {
  for (const [id, def] of Object.entries(WEAPONS)) game.items.define(id, def);
  for (const [id, def] of Object.entries(LETHALS)) game.items.define(id, def);
}

/**
 * The icon a weapon shows in the kill feed and the loadout menu: its own, as each screen has it
 * (`client/looks.ts`), side on (a lethal as it is).
 */
export const feedIcon = (id: string): IconRef | null => (WEAPONS[id] || isStreak(id) ? { item: id, view: 'side' } : LETHALS[id] ? { item: id } : null);

/** A weapon's name, for the kill feed (a killstreak's too: the Mortar Team's shells are `mortar`). */
export const weaponName = (id: string) => WEAPONS[id]?.name ?? LETHALS[id]?.name ?? (isKillstreak(id) ? KILLSTREAKS[id].name : id);
