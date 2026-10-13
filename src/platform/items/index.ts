/**
 * The platform's item kits' shared parts (`@platform/items`): what an item kit's host half
 * (`@platform/kits`) and its screen half (`@platform/client/kits`) both run, so they agree: a
 * gun's spread, recoil, rounds and reloading. Pure, with nothing of either side. Games may use
 * them too (a bot's aim, a HUD's numbers).
 */
export * from './gun';
export * from './throwable';
export * from './melee';
export * from './bow';
export * from './consumable';
