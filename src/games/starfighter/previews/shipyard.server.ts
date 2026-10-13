import { defineServer } from '@platform';
import { shared } from './shipyard.shared';

export default defineServer(shared, {
  // Hang in the air; move the camera with player.teleport + debugView.
  start: (game) => game.player.freeze(true),
});
