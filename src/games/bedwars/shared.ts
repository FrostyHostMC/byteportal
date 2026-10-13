import { defineShared } from '@platform';
import meta from './meta';
import { MAPS, STRUCTURES } from './world';

/** Where people come in: the first map's lobby (the game moves them to the one in use). */
const LOBBY = MAPS[0].lobby;

/**
 * The block items: the block each places (the server's building rules) and shows as (each
 * screen's look: in the hotbar, in hand, dropped). Each team has its wool.
 */
export const BLOCK_ITEMS: Record<string, string> = {
  wool_red: 'red_wool',
  wool_blue: 'blue_wool',
  wool_green: 'green_wool',
  wool_yellow: 'yellow_wool',
  planks: 'oak_planks',
  end_stone: 'end_stone',
  obsidian: 'obsidian',
};

/** The islands in the void and the player (in their own clothes till they take a team). */
export const shared = defineShared({
  ...meta,
  world: {
    terrain: 'void',
    // Every map and its lobby, far apart (every screen builds their blocks too).
    structures: STRUCTURES,
    spawn: LOBBY.spawn,
    spawnYaw: LOBBY.yaw,
    time: 0.36,
    freezeTime: true,
    viewDistance: 8,
  },
  player: {
    hotbar: 'items',
    health: 20,
    regen: { delay: 5, perSecond: 0.5 },
    fallDamage: true,
    // Players fight each other (swords, bows, fireballs).
    pvp: true,
  },
});
