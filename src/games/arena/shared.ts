import { defineShared } from '@platform';
import meta from './meta';
import { FLOOR, MAP_BLOCKS, MAPS } from './maps';
import { roll } from './abilities';
import { crawl } from './run/crawl';
import { HUD } from './hud/theme';
import { DIFFICULTY } from './run/difficulty';

const first = MAPS[0];

/** Every map's blocks (every screen builds them too), the player, who can dodge-roll (Q) and crawls when downed, and the HUD's look (`hud/theme.ts`). */
export const shared = defineShared({
  ...meta,
  // The maps' own blocks (travertine, the crowd, crypts, basalt, ice…).
  blocks: MAP_BLOCKS,
  world: {
    // No landscape to make: the maps stand on a plain ground over the void (below their rims, so
    // from inside it's all sky), each far from the others, and nothing past the haze is loaded.
    terrain: 'void',
    ground: { y: FLOOR, top: 'grass_block', fill: 'dirt', depth: 4 },
    maxViewDistance: 8,
    structures: MAPS.flatMap((m) => m.build()),
    spawn: { x: first.center.x, y: first.center.y + 0.05, z: first.center.z },
    spawnYaw: 0,
    time: first.time,
    freezeTime: true,
  },
  player: { health: 20, regen: DIFFICULTY.regen, fallDamage: true, hotbar: 'items', movement: { abilities: { crawl, roll } } },
  hud: HUD,
});
