import { defineServer, type Player } from '@platform';
import { melee } from '@platform/kits';
import { shared } from './shared';
import { taggers } from './tagger.server';
import type { TaggerItem } from './tagger.shared';

/** Tags each player has made. */
const tags = new Map<string, number>();

/** Two taggers each: the quick one in hand. */
function arm(p: Player) {
  p.inventory.clear();
  p.inventory.give('zapper');
  p.inventory.give('lance');
  p.inventory.select(0);
}

/**
 * Laser Tag's rules: two taggers each (a quick one, a heavy one), a tag when a beam meets
 * someone (the tagger kit's `'tag'` damage), a point for each one that takes them down.
 */
export default defineServer(shared, {
  // Its own kind of item (`tagger.server.ts`), and the bare fist.
  items: [taggers(), melee()],
  setup(game) {
    game.items.define('zapper', { kind: 'tagger', name: 'Zapper', rate: 6, cost: 0.12, recharge: 0.5, range: 60, damage: 12, color: '#39f3ff' } satisfies TaggerItem);
    game.items.define('lance', { kind: 'tagger', name: 'Lance', rate: 1.2, cost: 0.45, recharge: 0.3, range: 90, damage: 40, color: '#ff4fd8', weight: 0.85 } satisfies TaggerItem);
    game.events.on('playerJoin', ({ player }) => arm(player));
    game.events.on('playerDeath', ({ player, source: by }) => {
      if (!by || by === player || typeof by === 'string' || by.kind !== 'player') return;
      tags.set(by.id, (tags.get(by.id) ?? 0) + 1);
      game.hud.feed(`${by.name} tagged out ${player.name}`);
    });
  },
  start(game) {
    tags.clear();
    for (const p of game.players) arm(p);
  },
});

/** Tags so far, by player id (for tests and a scoreboard). */
export const tally = (): ReadonlyMap<string, number> => tags;
