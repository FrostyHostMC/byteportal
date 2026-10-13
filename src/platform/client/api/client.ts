import type { Client, ClientDefinition, ClientEvent, ClientKit, ClientServices, FigureSignals, KitControls, Me } from '../../api/client/core';
import type { ItemMove } from '../../api/items';
import type { ItemDefinition, SharedDefinition } from '../../api/types';

/** What the client API needs of the runtime: the services it hands out (each built by its part of the platform), items, messages. */
export interface ClientHost {
  services: ClientServices;
  item(id: string): ItemDefinition | undefined;
  send(name: string, data: unknown): void;
  /** The game is under way on its server. */
  running(): boolean;
}

// The services are the host's, on the client object itself (`client.view`, `client.fx`, …).
// eslint-disable-next-line @typescript-eslint/no-unsafe-declaration-merging
export interface ClientRuntime extends ClientServices {}

/**
 * A game's client code at work on this screen: the `Client` its kits and its own code see, the
 * kits run in order each frame, then the game's `frame`, and this frame's events (the runtime and
 * the server's calls `emit` them as they happen; they're cleared once everyone has seen them).
 */
// eslint-disable-next-line @typescript-eslint/no-unsafe-declaration-merging
export class ClientRuntime implements Client {
  me!: Me;
  time = 0;
  private queue: ClientEvent[] = [];
  private seen: ClientEvent[] = [];
  private listeners = new Map<string, ((data: unknown) => void)[]>();
  private kits: ClientKit[];
  /** The kits that are item kinds' screen halves, by kind. */
  private byKind = new Map<string, ClientKit>();
  private started = false;

  constructor(
    readonly shared: SharedDefinition,
    private def: ClientDefinition,
    private host: ClientHost,
  ) {
    this.kits = def.kits ?? [];
    for (const k of this.kits) if (k.kind) this.byKind.set(k.kind, k);
    Object.assign(this, host.services);
  }

  get events(): readonly ClientEvent[] {
    return this.seen;
  }
  get running(): boolean {
    return this.host.running();
  }
  item(id: string) {
    return this.host.item(id);
  }
  on(name: string, fn: (data: unknown) => void) {
    const l = this.listeners.get(name) ?? [];
    l.push(fn);
    this.listeners.set(name, l);
  }
  send(name: string, data: unknown) {
    this.host.send(name, data);
  }

  /** Something happened: the kits see it next frame (or this one, if they haven't run yet). */
  emit(e: ClientEvent) {
    this.queue.push(e);
  }

  /** A message from the game's server: to its listeners now, and to the kits as an event. */
  message(name: string, data: unknown) {
    for (const fn of this.listeners.get(name) ?? []) fn(data);
    this.emit({ t: 'message', name, data });
  }

  /** Once the world is up. */
  setup(me: Me) {
    this.me = me;
    for (const k of this.kits) k.setup?.(this);
    this.def.setup?.(this);
    this.started = true;
  }

  /** Every frame: the kits in order, then the game's own. An event a kit emits reaches the kits after it (and the game's code) this frame. */
  frame(dt: number, me: Me) {
    if (!this.started) return;
    this.me = me;
    this.time += dt;
    this.seen = this.queue;
    this.queue = [];
    for (const k of this.kits) {
      k.frame?.(this, dt);
      this.flush();
    }
    this.def.frame?.(this, dt);
  }

  /** Late in the frame (the world's effects moved on, about to draw): the kits' `late`, then the game's. Events since `frame` join this frame's. */
  late(dt: number) {
    if (!this.started) return;
    this.flush();
    for (const k of this.kits) {
      k.late?.(this, dt);
      this.flush();
    }
    this.def.late?.(this, dt);
  }

  /** Events emitted since join this frame's. */
  private flush() {
    if (!this.queue.length) return;
    this.seen = [...this.seen, ...this.queue];
    this.queue = [];
  }

  // ---------------------------------------------------------------------------------------------
  // Item kinds' screen halves (`ClientKit.kind`)
  // ---------------------------------------------------------------------------------------------

  /** The kits' `controls`, in order, before this frame's controls go to the host: each one's actions are its kind's (`act`). */
  kindControls(c: KitControls, act: (kind: string, data: unknown[]) => void, dt: number) {
    if (!this.started) return;
    for (const k of this.kits) {
      if (!k.controls) continue;
      const kind = k.kind;
      const own: KitControls = Object.create(c, {
        act: {
          value: (data: unknown[]) => {
            if (kind) act(kind, data);
          },
        },
      });
      k.controls(this, own, dt);
    }
  }

  /** A controller's stick this frame: the kits' help (`stick`), together: slowed by each, turned by each. */
  kindStick(): { slow: number; yaw: number; pitch: number } {
    const out = { slow: 1, yaw: 0, pitch: 0 };
    if (!this.started) return out;
    for (const k of this.kits) {
      const h = k.stick?.(this);
      if (!h) continue;
      out.slow *= h.slow ?? 1;
      out.yaw += h.yaw ?? 0;
      out.pitch += h.pitch ?? 0;
    }
    return out;
  }

  /** What holding `def` does to movement, as its kind's kit says (`move`). */
  kindMove(def: ItemDefinition | undefined, buttons: number): ItemMove | null {
    return def ? (this.byKind.get(def.kind)?.move?.(def, { buttons }) ?? null) : null;
  }

  /** `me.items`: each kind's word, its kit's (`own`) over the host's. */
  kindItems(host: Readonly<Record<string, object>> | undefined): Record<string, object> {
    const out: Record<string, object> = { ...host };
    if (!this.started) return out;
    for (const [kind, k] of this.byKind) {
      if (!k.own) continue;
      const v = k.own(this, host?.[kind] ?? null);
      if (v) out[kind] = v;
      else delete out[kind];
    }
    return out;
  }

  /** The held item's state for client code, as its kind's kit gives it (`heldState`). */
  kindHeld(item: string, def: ItemDefinition | undefined): Record<string, unknown> | null {
    if (!this.started || !def) return null;
    return this.byKind.get(def.kind)?.heldState?.(this, item, def) ?? null;
  }

  /** What an item in a figure's hand makes the figure do (its kind's kit's `figureSignals`). */
  kindFigure(def: ItemDefinition, state: object | null): FigureSignals | null {
    return this.byKind.get(def.kind)?.figureSignals?.(state, def) ?? null;
  }

  /** An item a kit puts in the first-person hand instead of the hotbar's (`handItem`). */
  kindHand(): string | null {
    if (!this.started) return null;
    for (const k of this.kits) {
      const item = k.handItem?.(this);
      if (item) return item;
    }
    return null;
  }

  /** The kinds this screen runs (their actions go with the controls, even when there are none). */
  get kinds(): string[] {
    return [...this.byKind.keys()];
  }

  dispose() {
    for (const k of this.kits) k.dispose?.();
    this.listeners.clear();
  }
}
