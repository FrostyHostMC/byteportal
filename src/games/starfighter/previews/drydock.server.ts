import { defineServer } from '@platform';
import { shared } from './drydock.shared';

export default defineServer(shared, {
  start: (game) => game.player.freeze(true),
});
