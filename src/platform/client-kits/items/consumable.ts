import type { ClientKit } from '@platform/client';
import { consumableMove, isConsumable } from '@platform/items';

/**
 * Consumables on a screen: eating one (its `useTime`, the right mouse button held) slows their
 * movement here as on the host (it's predicted). What they're eating is the host's word
 * (`client.me.items.consumable`, a `ConsumableOwn`), and the first-person view holds it to the mouth.
 */
export function consumables(): ClientKit {
  return {
    name: 'consumables',
    kind: 'consumable',
    move: (def, controls) => (isConsumable(def) ? consumableMove(def, controls.buttons) : null),
  };
}
