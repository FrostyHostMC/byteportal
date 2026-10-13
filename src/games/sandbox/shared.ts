import { defineShared, type BlockTexture } from '@platform';
import crate from './blocks/crate.png?url';
import meta from './meta';

/** Marble's texture: one for the block and its slab. */
const MARBLE = { color: '#d9dcdf', noise: 0.22, scale: 3 };

/** Rungs on two rails, the rest clear (a ladder's texture). */
const LADDER: BlockTexture = {
  paint: (x, y) => (x === 2 || x === 3 || x === 12 || x === 13 ? (x % 2 ? '#6b4a2b' : '#7d5733') : x > 1 && x < 14 && y % 4 < 2 ? (y % 4 ? '#7a5530' : '#8a6238') : null),
};

/** The endless world, building in it, and the blocks of its own (the server and every screen read these). */
export const shared = defineShared({
  ...meta,
  world: { spawn: 'auto', persist: true },
  player: { build: true, fly: true, health: false, hotbar: 'blocks' },
  // A few blocks of its own, in the block picker with the built-in ones: a crate painted as a
  // PNG, marble mottled from a colour (and its slab), a paper lantern that lights the dark, and
  // shapes: a fence and a glass pane that join what's beside them, a beam that lies along the
  // axis it's placed on, a ladder to climb (it hangs on the wall it's placed against), a table.
  blocks: {
    crate: { texture: crate, hardness: 1.2 },
    marble: { texture: MARBLE },
    marble_slab: { label: 'Marble Slab', texture: MARBLE, shape: 'slab', full: 'marble' },
    paper_lantern: { texture: { top: { color: '#7a4a24' }, bottom: { color: '#7a4a24' }, side: { color: ['#ffb347', '#ffc061', '#ffa630'], scale: 4 } }, light: 13, glow: 0.8 },
    oak_fence: { texture: 'oak_planks', shape: 'fence', hardness: 1.5 },
    glass_pane: { texture: 'glass', shape: 'pane', transparency: 'cutout', hardness: 0.4 },
    oak_beam: { texture: { top: 'oak_log_top', bottom: 'oak_log_top', side: 'oak_log' }, shape: 'post', facing: 'axis', hardness: 1.5 },
    ladder: { texture: LADDER, boxes: [[0, 0, 14, 16, 16, 16]], facing: true, climbable: true, transparency: 'cutout', hardness: 0.4 },
    oak_table: { texture: 'oak_planks', boxes: [[0, 13, 0, 16, 16, 16], [1, 0, 1, 3, 13, 3], [13, 0, 1, 15, 13, 3], [1, 0, 13, 3, 13, 15], [13, 0, 13, 15, 13, 15]], hardness: 1.5 },
  },
});
