/**
 * The platform's item kits' host halves (see `ItemKind`): list the ones a game uses in its server
 * definition's `items`, in the order they run (throwables before guns: a throwable being cooked
 * takes the fire button).
 */
export { melee, FIST, type MeleeOptions, type Strike } from './melee';
export { bows } from './bow';
export { consumables } from './consumable';
export { guns, type Guns } from './gun';
export { throwables, type FireInfo, type Throwables } from './throwable';
