import { defineServer } from '@platform';
import { shared } from './map.shared';

export default defineServer(shared, {
  start: (game) => game.player.freeze(true),
});
