import { defineServer, vec } from '@platform';
import { shared } from './shared';

/** Its own blocks (a crate, marble, a lantern…): only the block picker has them. */
const OWN = new Set(Object.keys(shared.blocks ?? {}));
/** How long each player has been up in the air over the ground without falling (flying). */
const aloft = new Map<string, number>();

/**
 * No rules of its own: the world, its blocks and building are all shared. Just its achievements,
 * for building and getting about.
 */
export default defineServer(shared, {
  setup(game) {
    game.events.on('blockPlace', ({ y, block, by }) => {
      if (typeof by !== 'object' || by.kind !== 'player') return;
      by.achieve('first_block');
      if (OWN.has(block)) by.achieve('picker');
      if (y >= 200) by.achieve('sky_high');
      // Counted for good: a signed-in player's across visits.
      const placed = (by.store.get<number>('placed') ?? 0) + 1;
      by.store.set('placed', placed);
      if (placed >= 1000) by.achieve('master_builder');
    });
    game.events.on('playerLeave', ({ player }) => aloft.delete(player.id));
  },

  update(game, dt) {
    for (const p of game.players) {
      if (!p.achieved('flight')) {
        // 30 blocks over the ground and not falling, for two seconds: no jump or fall lasts that long.
        const { x, y, z } = p.position;
        const high = !p.onGround && p.velocity.y > -1 && y - game.world.surfaceY(x, z) >= 30;
        const t = high ? (aloft.get(p.id) ?? 0) + dt : 0;
        aloft.set(p.id, t);
        if (t >= 2) p.achieve('flight');
      }
      if (vec.distance2D(p.position, game.world.spawn) >= 1000) p.achieve('wanderer');
    }
  },
});
