/**
 * Voxel platform: public API for games.
 *
 * ```ts
 * import { defineShared, defineServer, Blueprint, Models } from '@platform';
 * export const shared = defineShared({ ...meta, world: { ... } });        // shared.ts
 * export default defineServer(shared, { setup(game) { ... } });          // server.ts
 * ```
 * See docs/PLATFORM.md for a guide.
 */
export * from './api/types';
export * from './api/items';
export { Blueprint } from './api/blueprint';
export { Models, Skins, HeldModels, HumanoidJoints, CHARACTER_STYLE } from './api/models';
export type { CharacterLook, Uniform, CharacterBuild, HairStyle, FacialHair, FaceDetail, TopStyle, BottomStyle, ShoeStyle, HeadWear } from './character/look';
export { Behaviors } from './api/behaviors';
export * as vec from './api/vec';
export * as math from './api/math';

import type { GameDefinition, GameMeta, ServerDefinition, SharedDefinition } from './api/types';

/**
 * A whole game in one object: its shared definition and its rules together. For tests and small
 * games run only by a server (headless). A game in `src/games` is split instead: `defineMeta`,
 * `defineShared`, `defineServer`, and `defineClient` (`@platform/client`) for each player's screen.
 */
export function defineGame(def: GameDefinition): GameDefinition {
  return def;
}

/** What the launcher lists about a game (`meta.ts`): no imports but this and types. */
export function defineMeta(meta: GameMeta): GameMeta {
  return meta;
}

/** What the server and every screen both read (`shared.ts`): see `SharedDefinition`. */
export function defineShared(def: SharedDefinition): SharedDefinition {
  return def;
}

/** The game as its server runs it (`server.ts`): the shared definition with its rules. */
export function defineServer(shared: SharedDefinition, rules: ServerDefinition): GameDefinition {
  return { ...shared, ...rules };
}
