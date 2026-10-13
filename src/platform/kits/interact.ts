import type { Entity, GameContext, Player } from '@platform';

export interface Interactions {
  /** Call every frame from your game's `update` (before `Building.update`, so talking wins over placing). */
  update(): void;
}

/**
 * Right-click a mob to talk to it: shopkeepers, quest givers, levers. Handlers are keyed by
 * entity type and get the player who clicked. The click is consumed, so it doesn't also place a
 * block or use an item.
 *
 * Built only on the public API (`entities.raycast`, `input.consume`).
 */
export function interactions(
  game: GameContext,
  handlers: Record<string, (entity: Entity, player: Player, game: GameContext) => void>,
  opts: { reach?: number } = {},
): Interactions {
  const reach = opts.reach ?? 4;
  return {
    update() {
      for (const player of game.players) {
        if (!player.alive || player.spectating || !player.input.buttonPressed(2)) continue;
        const hit = game.entities.raycast(player.eye, player.look, reach);
        const fn = hit && handlers[hit.entity.type];
        if (!hit || !fn) continue;
        player.input.consume(2);
        fn(hit.entity, player, game);
      }
    },
  };
}
