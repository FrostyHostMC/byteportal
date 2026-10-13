import coin from './coin.glb?url';
import coinPile from './coin_pile.glb?url';
import feather from './phoenix_feather.glb?url';
import chest from './chest.glb?url';
import chestLid from './chest_lid.glb?url';
import skull from './chest_skull.glb?url';
import stall from './stall.glb?url';

/**
 * The run's models (`tools/run/build.mjs` writes them): the coins, the Phoenix Feather, the mystery
 * chest and its lid, its skull, the merchant's stall. Addresses only: the server names them (props, icons),
 * each screen draws them.
 */
export const RUN_MODELS = { coin, coinPile, feather, chest, chestLid, skull, stall };

/** Where the chest's lid hangs on it (blocks, in the chest's own space): its hinge, the back of its top. */
export const LID_HINGE = { x: 0, y: 10 / 16, z: -6 / 16 };
