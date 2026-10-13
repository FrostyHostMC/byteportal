import type { HitscanHit, ItemControls, ItemHeld, ItemHost, ItemKind, ItemMove, ItemUse, ItemView, Penetration } from '../api/items';
import type { GameContext, ItemDefinition, Player, Vec3 } from '../api/types';
import type { SimInput } from './input';
import type { Inventory } from './items';

/** What the item kinds need of the player they run for (`PlayerSim`). */
export interface ItemPlayer {
  readonly api: Player;
  readonly inventory: Inventory;
  readonly eye: Vec3;
  readonly falling: boolean;
  /** Horizontal speed as a fraction of walking speed. */
  readonly moving: number;
  readonly stance: 0 | 1 | 2;
  /** A bullet's path (lag-compensated to host time `seen` when given). */
  bullet(from: Vec3, dir: Vec3, range: number, seen: number | null, pen: Penetration | null): HitscanHit;

  hitMarker(kind: boolean | 'kill'): void;
  now(): number;
}

/**
 * A player's items: choosing a hotbar slot (the wheel, 1 to 9), telling the kinds what went into
 * and out of their hand, their screen's actions, and each kind's step, in the game's order (see
 * `ItemKind`). The platform itself does nothing with any item.
 */
export class ItemRunner {
  /** The held item last step (a change is an `equip`). */
  private heldItem: string | null = null;
  private byKind = new Map<string, ItemKind>();

  constructor(
    private kinds: readonly ItemKind[],
    private me: ItemPlayer,
    private host: ItemHost,
    private ctx: () => GameContext,
  ) {
    for (const k of kinds) this.byKind.set(k.kind, k);
  }

  kind(name: string | undefined): ItemKind | undefined {
    return name === undefined ? undefined : this.byKind.get(name);
  }

  /** `locked`: a weapons-locked freeze (`freeze(true, { weapons: true })`): the controls reach no item. */
  update(dt: number, input: SimInput, locked = false) {
    const active = input.active && !locked;
    const inv = this.me.inventory;
    if (active) {
      if (input.wheel !== 0) inv.cycle(input.wheel);
      for (let i = 0; i < 9; i++) if (input.pressed(`Digit${i + 1}`)) inv.select(i);
    }
    const controls: ItemControls = {
      active,
      locked,
      isDown: (c) => active && input.isDown(c),
      pressed: (c) => active && input.pressed(c),
      button: (b) => active && input.button(b),
      buttonPressed: (b) => active && input.buttonPressed(b),
      consume: (w) => input.consume(w),
    };
    const held = inv.held?.item ?? null;
    if (held !== this.heldItem) {
      const was = this.heldItem;
      this.heldItem = held;
      const out = was ? this.kind(this.def(was)?.kind) : undefined;
      if (out?.equip && was) out.equip(this.use(out, dt, controls, input), was, false);
      const into = held ? this.kind(this.def(held)?.kind) : undefined;
      if (into?.equip && held) into.equip(this.use(into, dt, controls, input), held, true);
    }
    for (const k of this.kinds) if (k.step) k.step(this.use(k, dt, controls, input));
  }

  /** What holding the held item does to movement (its kind's `move`), for this step. */
  move(buttons: number): ItemMove | null {
    const stack = this.me.inventory.held;
    const def = stack ? this.def(stack.item) : undefined;
    return this.kind(def?.kind)?.move?.(def, { buttons }) ?? null;
  }

  /** What their own screen gets from each kind this frame (`own`), by kind. */
  own(): Record<string, object> | undefined {
    let out: Record<string, object> | undefined;
    for (const k of this.kinds) {
      if (!k.own) continue;
      const v = k.own(this.view(k));
      if (v) (out ??= {})[k.kind] = v;
    }
    return out;
  }

  /** What everyone sees of the held item (its kind's `shown`). */
  shown(): object | null {
    const stack = this.me.inventory.held;
    const def = stack ? this.def(stack.item) : undefined;
    const k = this.kind(def?.kind);
    if (!k?.shown || !stack) return null;
    return k.shown(this.view(k), stack.item, this.me.inventory.state(stack.item));
  }

  /** They died or the game restarted (`whole`: a new person has their place). */
  reset(whole: boolean) {
    this.heldItem = null;
    for (const k of this.kinds) k.reset?.(this.me.api, whole);
  }

  private def(item: string): ItemDefinition | undefined {
    return this.me.inventory.def(item);
  }

  private heldOf<D extends ItemDefinition>(item: string): ItemHeld<D, object> {
    return { item, def: this.def(item) as D, state: this.me.inventory.state(item) };
  }

  private view(k: ItemKind): ItemView {
    const stack = this.me.inventory.held;
    const def = stack ? this.def(stack.item) : undefined;
    return { player: this.me.api, hand: stack && def ? { item: stack.item, def, holds: !!this.kind(def.kind)?.holds } : null, held: stack && def?.kind === k.kind ? this.heldOf(stack.item) : null };
  }

  private use(k: ItemKind, dt: number, controls: ItemControls, input: SimInput): ItemUse {
    const me = this.me;
    const inv = me.inventory;
    return {
      ...this.view(k),
      game: this.ctx(),
      host: this.host,
      dt,
      now: me.now(),
      controls,
      acts: input.acts(k.kind),
      carried: () => {
        const out: ItemHeld[] = [];
        const seen = new Set<string>();
        for (const s of inv.slots) {
          if (!s || seen.has(s.item) || this.def(s.item)?.kind !== k.kind) continue;
          seen.add(s.item);
          out.push(this.heldOf(s.item));
        }
        return out;
      },
      falling: me.falling,
      moving: me.moving,
      stance: me.stance,
      hitscan: (from, dir, range, opts = {}) => me.bullet(from, dir, range, opts.rewind ? input.seen : null, opts.penetration ?? null),
      swing: (how, power = 1) => this.host.swing(me.api, how, power),
      hitMarker: (kind) => me.hitMarker(kind),
    };
  }
}
