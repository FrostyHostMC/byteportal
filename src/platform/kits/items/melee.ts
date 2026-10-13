import type { Entity, ItemKind, ItemKit, ItemUse, Player } from '@platform';
import { math } from '@platform';
import type { MeleeItem, MeleeOwn } from '@platform/items';

/** What a melee attack needs (the bare fist is one, with no item behind it). */
export type Strike = Pick<MeleeItem, 'damage' | 'cooldown' | 'reach' | 'knockback' | 'sweep' | 'sounds'>;

/** The bare fist: anything in hand that isn't a weapon of its own swings as one. */
export const FIST: Strike = { damage: 1, cooldown: 0.3, reach: 3, knockback: 0.6 };

export interface MeleeOptions {
  /** How the bare fist hits (with nothing in hand, or anything whose kind doesn't take the mouse buttons); false: it doesn't. */
  fist?: Strike | false;
}

/**
 * Melee weapons (`kind: 'melee'`) and the bare fist: the fire button swings (held, again as soon
 * as it's ready), hitting the first creature (or, with `player.pvp`, player) within reach in
 * front, harder while falling (a critical hit); a `sweep` also hits whatever's close around the
 * target. A better weapon replaces a worse one (by `rank`) when the hotbar's full, and is taken in
 * hand when picked up. Played on the host.
 */
export function melee(o: MeleeOptions = {}): ItemKit<ItemKind<MeleeItem>> {
  const fist = o.fist === undefined ? FIST : o.fist;
  return () => melee1(fist);
}

/** Melee in one game. */
function melee1(fist: Strike | false): ItemKind<MeleeItem> {
  const ready = new WeakMap<Player, { cooldown: number; max: number }>();
  const of = (p: Player) => {
    let r = ready.get(p);
    if (!r) ready.set(p, (r = { cooldown: 0, max: 1 }));
    return r;
  };
  return {
    kind: 'melee',
    stack: 1,
    upgrades: true,
    holds: true,
    step(use) {
      const r = of(use.player);
      r.cooldown = Math.max(0, r.cooldown - use.dt);
      const c = use.controls;
      if (!c.active) return;
      const weapon = use.held;
      // A bare fist: nothing in hand, or something with no use of the mouse of its own.
      if (!weapon && (use.hand?.holds || !fist)) return;
      if (c.buttonPressed(0) || (c.button(0) && r.cooldown <= 0)) {
        // Weapons and the bare fist use their own animation; anything else just swings.
        if (r.cooldown <= 0) strike(use, r, weapon ? weapon.def : fist as Strike, !use.hand || !!weapon, weapon?.item);
      }
    },
    own(v) {
      const r = of(v.player);
      return { strength: 1 - r.cooldown / r.max } satisfies MeleeOwn;
    },
    reset(p) {
      ready.delete(p);
    },
  };
}

function strike(use: ItemUse<MeleeItem>, r: { cooldown: number; max: number }, def: Strike, weapon: boolean, item?: string) {
  const me = use.player;
  const game = use.game;
  r.cooldown = r.max = def.cooldown;
  use.swing(weapon ? 'use' : 'swing');
  // A melee weapon's own sounds, as each screen has them (anything else in hand swings as a fist).
  const own = weapon && item ? item : null;
  me.audio.play(def.sounds?.use ?? 'swing', { pitch: 0.9 + Math.random() * 0.2, ...(own && { item: { id: own, sound: 'use' as const } }) });
  const cam = me.eye;
  const dir = me.look;
  const reach = def.reach ?? 3.3;
  const hit = game.entities.raycast(cam, dir, reach, { margin: 0.25 });
  let target: Entity | Player | null = hit?.entity ?? null;
  // Another player in the way, nearer than any monster and not behind a wall.
  if (use.host.pvp) {
    let best = hit ? hit.distance : reach;
    for (const p of game.players) {
      if (p === me || !p.alive || p.spectating) continue;
      const b = p.position;
      const t = math.rayBox(cam, dir, { x: b.x - 0.55, y: b.y - 0.25, z: b.z - 0.55 }, { x: b.x + 0.55, y: b.y + 2.05, z: b.z + 0.55 });
      if (t === null || t >= best) continue;
      if (!game.world.lineOfSight(cam, { x: cam.x + dir.x * t, y: cam.y + dir.y * t, z: cam.z + dir.z * t })) continue;
      best = t;
      target = p;
    }
  }
  if (!target) return;
  const crit = use.falling;
  const dmg = def.damage * (crit ? 1.5 : 1);
  target.damage(dmg, { source: me, knockback: def.knockback ?? 1, crit, weapon: item, cause: 'melee' });
  // Its own hit sound (pitched up for a crit), else the platform's hit or crit.
  const hitSound = def.sounds?.hit;
  me.audio.play(hitSound ?? (crit ? 'crit' : 'hit'), { at: target.position, pitch: hitSound && crit ? 1.25 : 1, ...(own && { item: { id: own, sound: 'hit' as const, pitch: crit ? 1.25 : 1 } }) });
  use.hitMarker(target.alive ? crit : 'kill');
  me.fx.shake(crit ? 0.05 : 0.025, 0.12);
  if (def.sweep) {
    const tp = target.position;
    for (const e of game.entities.near(tp, 2.4)) {
      if (e === target) continue;
      const p = e.position;
      if (Math.hypot(p.x - cam.x, p.z - cam.z) > (def.reach ?? 3.3) + 1) continue;
      e.damage(dmg * 0.5, { source: me, knockback: 0.6, cause: 'melee' });
    }
    game.fx.burst({ x: tp.x, y: tp.y + 1, z: tp.z }, { color: '#e8f4ff', count: 14, speed: 4, gravity: 2 });
  }
}
