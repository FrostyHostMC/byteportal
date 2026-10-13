import type { GameContext, Pickup, Player, Vec3 } from '@platform';
import { isGun } from '@platform/items';
import { guns } from '@platform/kits';
import { COLORS } from './shared';

/**
 * Ammo bags (a scavenger for everyone): whoever goes down drops one where they fell. Walking over
 * one tops up the spare rounds of every gun you carry to what you came in with (the magazines as
 * they are), so you can keep shooting without dying. A bag's used up by whoever touches it first,
 * full up or not, and it's gone after `LIFE` seconds. Bots low on rounds go and get the nearest
 * (`bots.supplies`). Someone whose primary runs out of spare rounds is told where more come from,
 * once each time it does.
 *
 * Its look (an ammo can, `models/ammo.glb`) and its voice (`ammo`) are each screen's.
 */

/** Seconds a bag lies there. */
const LIFE = 30;
/** Never more than this many lying about: the oldest go first. */
const MAX = 12;
/** How often (seconds) people's primaries are checked for running dry. */
const CHECK = 0.5;

export class AmmoBags {
  private bags: Pickup[] = [];
  /** People told their primary's out of spare rounds (until it isn't). */
  private told = new Set<string>();
  private checkAt = 0;

  /** `extra(p)`: whatever else a bag gives `p` (Scavenger's lethals, `server.ts`). */
  constructor(
    private game: GameContext,
    private extra: (p: Player) => void = () => {},
  ) {
    game.items.define('ammo', {
      kind: 'misc',
      name: 'Ammo',
      onPickup: (_g, _n, player) => {
        this.resupply(player);
        return true;
      },
    });
  }

  /** A bag where someone fell. */
  drop(at: Vec3) {
    this.bags = this.bags.filter((b) => b.alive);
    while (this.bags.length >= MAX) this.bags.shift()?.remove();
    this.bags.push(this.game.items.spawnPickup('ammo', { x: at.x, y: at.y + 0.8, z: at.z }, { despawn: LIFE, velocity: { x: 0, y: 3, z: 0 } }));
  }

  /** None lying about (a new match). */
  clear() {
    for (const b of this.bags) b.remove();
    this.bags = [];
    this.told.clear();
  }

  /** The nearest bag within `within` blocks of `at`, if there is one. */
  nearest(at: Vec3, within = 40): Vec3 | null {
    let best: Vec3 | null = null;
    let d = within;
    for (const b of this.bags) {
      if (!b.alive) continue;
      const e = Math.hypot(b.position.x - at.x, b.position.y - at.y, b.position.z - at.z);
      if (e < d) {
        d = e;
        best = b.position;
      }
    }
    return best;
  }

  /** Their primary (the first slot) is down to its last magazine or less, all told. */
  low(p: Player): boolean {
    const item = p.inventory.slots[0]?.item;
    const def = item ? this.game.items.get(item) : undefined;
    const a = item ? guns.of(this.game)?.ammo(p, item) : null;
    return !!a && isGun(def) && a.magazine + a.reserve <= def.magazine;
  }

  /** Every gun they carry topped up to its full spare rounds. */
  resupply(p: Player) {
    const kit = guns.of(this.game);
    let topped = false;
    for (const slot of p.inventory.slots) {
      const def = slot ? this.game.items.get(slot.item) : undefined;
      if (!slot || !kit || !isGun(def)) continue;
      const full = def.reserve ?? def.magazine * 3;
      const a = kit.ammo(p, slot.item);
      if (a && a.reserve < full) {
        kit.setAmmo(p, slot.item, { reserve: full });
        topped = true;
      }
    }
    this.extra(p);
    p.audio.play('ammo');
    if (p.bot) return;
    if (topped) p.hud.pop('+AMMO', { color: COLORS.gold });
    else p.hud.toast('Full up on ammo');
  }

  /** People whose primary's just run out of spare rounds are told where to get more. */
  update() {
    const now = this.game.clock.now;
    if (now < this.checkAt) return;
    this.checkAt = now + CHECK;
    const kit = guns.of(this.game);
    for (const p of this.game.players) {
      if (p.bot || !p.alive) continue;
      const item = p.inventory.slots[0]?.item;
      const a = item && kit?.ammo(p, item);
      if (!a || a.reserve > 0) {
        this.told.delete(p.id);
        continue;
      }
      if (this.told.has(p.id)) continue;
      this.told.add(p.id);
      p.hud.toast('Out of spare rounds: the fallen drop ammo bags');
    }
  }
}
