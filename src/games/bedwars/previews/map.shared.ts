import { defineShared } from '@platform';
import { MAP_DEFS } from '../maps';
import meta from './map.meta';

/** How far apart the preview lays the maps out along x (the game will do the same). */
export const SPACING = 512;

/** Every map, built and moved into place: map `i` is centred on x = i * SPACING. */
export const maps = MAP_DEFS.map((def, i) => ({ def, map: def.build(), offset: { x: i * SPACING, y: 0, z: 0 } }));

const first = maps[0].map;

/**
 * Dev preview: the Bed Wars maps in the void, side by side (map `i` at x = i * 512; the order is
 * `MAP_DEFS`). Fly round (double-tap Space); `/tp 512 110 60` goes to the second map, and so on.
 */
export const shared = defineShared({
  ...meta,
  world: {
    terrain: 'void',
    structures: maps.flatMap(({ map, offset }) => map.blueprints.map((bp) => bp.moved(offset))),
    spawn: { x: first.center.x, y: first.center.y + 40, z: first.center.z + 60 },
    time: 0.42,
    freezeTime: true,
    viewDistance: 12,
  },
  player: { build: true, fly: true, health: false, hotbar: 'blocks' },
});
