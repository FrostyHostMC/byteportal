/**
 * The platform's item kits' screen halves: list the ones a game uses in its client kits, before
 * the kits that show them (first person, the HUD, effects), throwables before guns (a throwable
 * being cooked takes the fire button). Each goes with its host half (`@platform/kits`), with the
 * same options.
 */
export { consumables } from './consumable';
export { guns, type ClientBullet, type GunView } from './gun';
export { throwables, thrownOn, type ThrowView } from './throwable';
export type { ClientThrown } from './thrower';
