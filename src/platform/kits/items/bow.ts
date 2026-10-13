import type { IconRef, ItemKind, ItemKit, Player, SpriteRef } from '@platform';
import type { BowItem, BowOwn } from '@platform/items';

/**
 * Bows (`kind: 'bow'`): hold the fire button to draw (over `drawTime`), let go to shoot an arrow
 * (one of `ammo`, if it takes any), faster and harder the further it was drawn, a critical hit at
 * full draw. A better one replaces a worse one (by `rank`) when the hotbar's full, and is taken in
 * hand when picked up. Played on the host.
 */
export function bows(): ItemKit<ItemKind<BowItem>> {
  return () => bows1();
}

/** Bows in one game. */
function bows1(): ItemKind<BowItem> {
  const draws = new WeakMap<Player, BowOwn>();
  const of = (p: Player) => {
    let d = draws.get(p);
    if (!d) draws.set(p, (d = { drawing: false, charge: 0 }));
    return d;
  };
  return {
    kind: 'bow',
    stack: 1,
    upgrades: true,
    holds: true,
    step(use) {
      const d = of(use.player);
      const bow = use.held;
      const c = use.controls;
      if (!bow || !c.active) {
        d.drawing = false;
        d.charge = 0;
        return;
      }
      const def = bow.def;
      const me = use.player;
      const inv = me.inventory;
      const hasAmmo = !def.ammo || inv.count(def.ammo) > 0;
      if (c.button(0) && hasAmmo) {
        if (!d.drawing) {
          d.drawing = true;
          d.charge = 0;
          me.audio.play(def.sounds?.draw ?? 'bow_draw', { volume: 0.7, item: { id: bow.item, sound: 'draw' } });
        }
        d.charge = Math.min(1, d.charge + use.dt / def.drawTime);
      } else if (d.drawing) {
        // Released: fire.
        d.drawing = false;
        if (d.charge > 0.1 && (!def.ammo || inv.take(def.ammo, 1))) {
          const ch = d.charge;
          const cam = me.eye;
          const dir = me.look;
          const crit = ch >= 1;
          use.game.entities.projectile(
            {
              sprite: def.projectile ?? spriteOf(def.ammo ? use.game.items.get(def.ammo)?.icon : undefined),
              glow: def.projectile || def.ammo ? undefined : '#bfe7ff',
              speed: def.speed * (0.35 + 0.65 * ch),
              gravity: 20,
              damage: def.damage[0] + (def.damage[1] - def.damage[0]) * ch,
              knockback: 0.3 + ch * 0.5,
              sticky: true,
              crit,
              weapon: bow.item,
            },
            { x: cam.x + dir.x * 0.4, y: cam.y - 0.1 + dir.y * 0.4, z: cam.z + dir.z * 0.4 },
            dir,
            me,
          );
          me.audio.play(def.sounds?.use ?? 'bow_shoot', { pitch: 0.9 + ch * 0.2, item: { id: bow.item, sound: 'use' } });
          use.swing('use', 0.6 + ch * 0.6);
        }
        d.charge = 0;
      } else if (c.buttonPressed(0) && !hasAmmo) {
        me.hud.toast('No arrows');
      }
    },
    own(v) {
      const d = of(v.player);
      return { drawing: d.drawing, charge: d.charge } satisfies BowOwn;
    },
    reset(p) {
      draws.delete(p);
    },
  };
}

/** A sprite icon, or nothing for an item that looks like a block (it can't fly as an arrow). */
function spriteOf(icon: IconRef | undefined): SpriteRef | undefined {
  return typeof icon === 'object' && ('block' in icon || 'gltf' in icon || 'item' in icon) ? undefined : icon;
}
