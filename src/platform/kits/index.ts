/**
 * Kits: ready-made gameplay systems for games to pick up, like `Behaviors` for mobs.
 *
 * A kit gets no special access. It is written only against the public API (`@platform`), which
 * `npm run check:boundaries` enforces, so any kit could live in a game's own folder unchanged.
 * Use one as is, copy it into your game and change it, or write your own instead.
 *
 * ```ts
 * import { building, interactions } from '@platform/kits';
 * let build: Building; let talk: Interactions;
 * setup(game) {
 *   build = building(game, { canBreak: (at, block) => block !== 'stone' });
 *   talk = interactions(game, { villager: () => openShop() });
 * },
 * update(game, dt) { talk.update(); build.update(dt); },
 * ```
 */
export { building, defaultBreakTime, type Builder, type Building, type BuildingOptions } from './building';
export { interactions, type Interactions } from './interact';
export { navGrid, type NavCell, type NavEdge, type NavGrid, type NavGridOptions } from './navgrid';
export { skipVote, type SkipVote, type SkipVoteOptions } from './skipvote';
export { shooterBots, type BotAim, type BotMind, type BotMoves, type BotSenses, type BotWeapon, type BySkill, type ShooterBotOptions, type ShooterBots } from './shooterbot';
export { bows, consumables, FIST, guns, melee, throwables, type FireInfo, type Guns, type MeleeOptions, type Strike, type Throwables } from './items';
