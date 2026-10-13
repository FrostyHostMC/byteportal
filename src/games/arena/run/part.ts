import type { ArenaPart } from '../part';
import { chestSetup, chestStart, chestUpdate } from './chest';
import { classesListen, classesUpdate, equip, preferred, resetClasses } from './classes';
import { coinsListen, defineCoins, resetCoins } from './coins';
import { downedListen, downedUpdate, resetDowned } from './downed';
import { featsListen, resetFeats } from './feats';
import { hypeListen, hypeUpdate, resetHype } from './hype';
import { packSetup, packUpdate } from './pack';
import { progressionListen, startProgression } from './progression';
import { resetShop, shopSetup, shopUpdate } from './shop';
import { runs } from './state';

/**
 * The run's own business, beside the server's flow (`server.ts`: the phases and the waves): gold
 * and the coins monsters spill (`coins.ts`, `gold.ts`), the crowd's hype and the Favour
 * (`hype.ts`), kills' feats (`feats.ts`), going down and reviving (`downed.ts`), classes
 * (`classes.ts`), the shop (`shop.ts`), what they carry (`pack.ts`: X drops, the merchant buys),
 * the mystery chest (`chest.ts`), and XP and levels (`progression.ts`). Each listens on the bus for itself; the flow opens and closes the shop,
 * stands the downed up, and asks for the results.
 */
export const runPart: ArenaPart = {
  name: 'run',
  setup(game) {
    defineCoins(game);
    packSetup(game);
    shopSetup(game);
    chestSetup(game);
    coinsListen(game);
    hypeListen(game);
    featsListen(game);
    downedListen(game);
    classesListen(game);
    progressionListen(game);
  },
  start(game) {
    resetCoins();
    resetHype();
    resetFeats();
    resetDowned(game);
    resetClasses();
    resetShop();
    startProgression(game);
    chestStart(game);
  },
  update(game, dt) {
    hypeUpdate(game, dt);
    downedUpdate(game, dt);
    packUpdate(game);
    shopUpdate(game);
    chestUpdate(game, dt);
    classesUpdate(game);
  },
  // Their class's kit: the one they last chose (the menu lets them change it for a while).
  arm(game, p) {
    if (runs.get(p.id)) equip(game, p, preferred(p));
  },
};
