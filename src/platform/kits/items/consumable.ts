import type { ItemKind, ItemKit, Player } from '@platform';
import { consumableMove, isConsumable, type ConsumableItem, type ConsumableOwn } from '@platform/items';

/** How often eating crunches (seconds). */
const CRUNCH_EVERY = 0.22;

/**
 * Consumables (`kind: 'consumable'`): the right mouse button uses the one in hand (its `use`, the
 * game's code); if that says so, one is used up. One with a `useTime` is eaten: held that long
 * (slowed, crunching, crumbs), then used; let go, or put it away, and it isn't. The fire button
 * still swings (a bare fist's kit). Played on the host.
 */
export function consumables(): ItemKit<ItemKind<ConsumableItem>> {
  return () => {
    const eating = new WeakMap<Player, { item: string; t: number; crunch: number }>();
    return {
      kind: 'consumable',
      step(use) {
        const held = use.held;
        const me = use.player;
        const c = use.controls;
        const def = held?.def;
        if (!held || !def) {
          eating.delete(me);
          return;
        }
        if (!def.useTime) {
          if (!c.buttonPressed(2)) return;
          if (def.use(use.game, me)) {
            me.inventory.take(held.item, 1);
            use.swing('use');
            // Its own sound, as their screen has it (none by default).
            me.audio.play(def.sounds?.use ?? '', { item: { id: held.item, sound: 'use' } });
          }
          return;
        }
        let e = eating.get(me);
        if (!c.active || c.locked || !c.button(2) || (e && e.item !== held.item)) {
          eating.delete(me);
          e = undefined;
          if (!c.active || c.locked || !c.button(2)) return;
        }
        if (!e) {
          if (def.canUse && !def.canUse(use.game, me)) return;
          eating.set(me, (e = { item: held.item, t: 0, crunch: 0 }));
        }
        e.t += use.dt;
        e.crunch -= use.dt;
        if (e.crunch <= 0 && e.t > 0.15) {
          e.crunch = CRUNCH_EVERY;
          // Everyone near hears it, and crumbs fall from their mouth.
          use.game.audio.play(def.sounds?.use ?? 'eat', { at: me.position, pitch: 0.85 + Math.random() * 0.3, volume: 0.6 });
          const eye = me.eye;
          const d = me.look;
          use.game.fx.burst({ x: eye.x + d.x * 0.35, y: eye.y - 0.2, z: eye.z + d.z * 0.35 }, { color: '#e8c24a', count: 4, speed: 1.2, gravity: 14, size: 0.06, life: 0.5 });
        }
        if (e.t < def.useTime) return;
        eating.delete(me);
        if (def.use(use.game, me)) me.inventory.take(held.item, 1);
      },
      move: (def, controls) => (isConsumable(def) ? consumableMove(def, controls.buttons) : null),
      own(v) {
        const e = eating.get(v.player);
        const def = v.held?.def;
        if (!e || !def?.useTime) return null;
        return { eating: e.item, progress: Math.min(1, e.t / def.useTime), time: def.useTime } satisfies ConsumableOwn;
      },
      reset(p) {
        eating.delete(p);
      },
    };
  };
}
