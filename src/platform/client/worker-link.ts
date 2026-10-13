// The public API inside a built game's client Web Worker (see client/packaged.ts): a worker
// started through the platform imports this first, then the game's worker code.
import * as art from '../art/index';
import * as platform from '../index';
import * as items from '../items/index';
import * as math from '../api/client/math';
import { GLOBAL, type PlatformLink } from '../package/link';

const link: PlatformLink = {
  modules: { '@platform': platform, '@platform/art': art, '@platform/items': items, '@platform/client/math': math },
  asset: () => {
    throw new Error('a worker has no asset addresses');
  },
};
(globalThis as unknown as Record<string, PlatformLink>)[GLOBAL] = link;
