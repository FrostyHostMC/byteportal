import type {
  Anchor,
  AudioApi,
  ClientsApi,
  FxApi,
  HudApi,
  LoopHandle,
  MarkerOptions,
  MenuEntry,
  MenuHandle,
  MenuOptions,
  Player,
  RadarData,
  ScreenOptions,
  Vec3,
  ViewAnimation,
  ViewModelApi,
  WidgetData,
  WidgetDefinition,
  WidgetHandle,
} from '../api/types';
import type { Content } from '../content';
import { MESSAGE_MAX, MESSAGE_NAME, type AnchorRef, type CallbackRef, type ClientMessage, type PresentCall, type PresentTarget, type RadarWire } from '../net/protocol';
import { diffData, mergeData, parseMarkup, plainData, plainRecord, WIDGET_ANCHORS, WIDGET_NAME, type PlainData, type WidgetWire } from '../ui/markup';

export type Sink = (call: PresentCall) => void;

class MenuProxy implements MenuHandle {
  open = true;
  cbs: number[] = [];
  /**
   * The entries' callbacks before the last update, kept for one more: a click on the menu as its
   * screen showed it a moment ago (the update still on its way, another's vote say) still counts.
   */
  private was: number[] = [];

  constructor(
    readonly id: number,
    private hub: Presentation,
    /** Whose screen it's on (null: everyone's). */
    readonly to: string | null,
    private opts: MenuOptions,
  ) {}

  update(o: Partial<MenuOptions>) {
    if (!this.open) return;
    this.opts = { ...this.opts, ...o };
    // New entries, new callbacks (the ones before last go); a new title or subtitle alone keeps them.
    if (o.sections) {
      this.hub.release(this.was);
      this.was = this.cbs;
      this.cbs = [];
    }
    this.hub.send(this.to, 'hud', 'menuUpdate', [this.id, this.hub.encodeMenu(o, this.cbs, this.to)]);
  }

  close() {
    if (!this.open) return;
    this.hub.send(this.to, 'hud', 'menuClose', [this.id]);
    this.closed();
  }

  /** Closed here or by the player: forget the callbacks and tell the game. */
  closed() {
    if (!this.open) return;
    this.open = false;
    this.hub.release(this.cbs);
    this.hub.release(this.was);
    this.hub.menus.delete(this.id);
    this.opts.onClose?.();
  }
}

/** A widget the game defined: what went to the screens (to skip sending it again), and its actions. */
interface WidgetKind {
  def: WidgetDefinition;
  json: string;
  /** The actions its markup's buttons name (a player can ask for no other). */
  actions: Set<string>;
}

/**
 * What one widget shows: on everyone's screens (null: it isn't up), and on the screens of players
 * who see something else (their own data, or nothing).
 */
class WidgetScreens {
  all: PlainData | null = null;
  mine = new Map<string, PlainData | null>();

  of(player: string): PlainData | null {
    return this.mine.has(player) ? this.mine.get(player)! : this.all;
  }

  /** Every screen it's up on, as the data each shows. */
  shown(): PlainData[] {
    const out = this.all ? [this.all] : [];
    for (const d of this.mine.values()) if (d) out.push(d);
    return out;
  }
}

class WidgetProxy implements WidgetHandle {
  constructor(
    readonly name: string,
    private hub: Presentation,
    private to: string | null,
  ) {}

  private get current(): PlainData | null {
    const s = this.hub.widgetScreens.get(this.name);
    return (s && (this.to === null ? s.all : s.of(this.to))) ?? null;
  }

  get shown(): boolean {
    return this.current !== null;
  }

  get data(): WidgetData {
    return structuredClone(this.current ?? {});
  }

  set(data: WidgetData) {
    this.hub.setWidget(this.to, this.name, data);
  }

  remove() {
    this.hub.removeWidget(this.to, this.name);
  }
}

/**
 * The simulation's side of presentation: the game's `hud`, `fx`, `audio` and `viewModel` calls
 * become plain-data `PresentCall`s for the clients. Callbacks (menu entries, screen buttons) are
 * kept here and sent by id; definitions that carry code or pixels go to `Content`.
 */
export class Presentation {
  private nextCb = 1;
  private nextId = 1;
  /** Buttons on screens and menus: what each does, and whose screen it's on (null: everyone's), so only they can press it. */
  private callbacks = new Map<number, { fn: () => void; to: string | null }>();
  readonly menus = new Map<number, MenuProxy>();
  private widgetKinds = new Map<string, WidgetKind>();
  /** What each widget shows where (its handles read it). */
  readonly widgetScreens = new Map<string, WidgetScreens>();
  private widgetHandles = new Map<string, WidgetProxy>();
  /** A player by id, for a widget's actions (the simulation sets this). */
  playerOf: (id: string) => Player | undefined = () => undefined;
  /**
   * An anchor as data: a spot as it is, or what to follow by id. The simulation (which knows its
   * props, entities and players) sets this.
   */
  anchor: (a: Anchor) => AnchorRef = (a) => {
    const v = a as Vec3;
    return { x: v.x, y: v.y, z: v.z };
  };

  constructor(
    public sink: Sink,
    readonly content: Content,
  ) {}

  /** A call for one player (`to`), or everyone (null), or everyone but `skip`. */
  send(to: string | null, target: PresentTarget, method: string, args: unknown[], skip?: string) {
    this.sink(skip ? { to, target, method, args, skip } : { to, target, method, args });
  }

  /**
   * A message for the client code on one player's screen (`to`), or everyone's (null), or
   * everyone's but `skip`'s: the game's own (`clients.send`), the platform's (a `$` name), or an
   * item kind's (`kit`: its host half's `send`, drawn in the world as the platform's are).
   */
  message(to: string | null, name: string, data: unknown, skip?: string, kit = false) {
    const call: PresentCall = { to, target: 'message', method: name, args: [data] };
    if (skip) call.skip = skip;
    if (kit) call.kit = true;
    this.sink(call);
  }

  /** `game.clients`: the game's messages to its client code, checked here (a mistake throws in the game's code). */
  clients(): ClientsApi {
    return {
      send: (to, name, data) => {
        if (typeof name !== 'string' || !MESSAGE_NAME.test(name)) throw new Error(`clients.send: "${String(name)}" can't name a message (a letter, then letters, digits, _, -, . or :)`);
        const clean = data === undefined ? null : plainData(data);
        if (clean === undefined) throw new Error(`clients.send("${name}"): its data must be plain data (strings, numbers, booleans, null, lists, records)`);
        const size = JSON.stringify(clean).length;
        if (size > MESSAGE_MAX.server) throw new Error(`clients.send("${name}"): ${size} bytes of data is more than ${MESSAGE_MAX.server}`);
        if (to === 'all') return this.message(null, name, clean);
        const list = Array.isArray(to) ? (to as readonly Player[]) : [to as Player];
        // Each player once.
        for (const id of new Set(list.map((p) => p.id))) this.message(id, name, clean);
      },
    };
  }

  callback(fn: () => void, into: number[], to: string | null): CallbackRef {
    const id = this.nextCb++;
    this.callbacks.set(id, { fn, to });
    into.push(id);
    return { $cb: id };
  }

  release(ids: number[]) {
    for (const id of ids) this.callbacks.delete(id);
  }

  encodeMenu(o: Partial<MenuOptions>, cbs: number[], to: string | null): Record<string, unknown> {
    const { onClose: _onClose, sections, ...rest } = o;
    const out: Record<string, unknown> = { ...rest };
    if (sections) {
      out.sections = sections.map((s) => ({
        ...s,
        entries: s.entries.map((e: MenuEntry) => {
          const { onSelect, ...plain } = e;
          return onSelect ? { ...plain, onSelect: this.callback(onSelect, cbs, to) } : plain;
        }),
      }));
    }
    return out;
  }

  /** Something a player did on their client. */
  receive(m: ClientMessage) {
    // Only a button on their own screen (or everyone's), only a menu of theirs: the sender is who the
    // connection says, so one player can't press another's button or close their menu by its number.
    const mine = (to: string | null) => to === null || to === m.player;
    if (m.t === 'callback') {
      const cb = this.callbacks.get(m.id);
      if (cb && mine(cb.to)) cb.fn();
    } else if (m.t === 'menuClosed') {
      const menu = this.menus.get(m.menu);
      if (menu && mine(menu.to)) menu.closed();
    }
    else if (m.t === 'widgetAction') {
      // Only a button they can see: the widget's up on their screen, and its markup has it.
      const kind = this.widgetKinds.get(m.widget);
      const fn = kind?.def.actions?.[m.action];
      if (!kind || !fn || !kind.actions.has(m.action) || !this.widgetScreens.get(m.widget)?.of(m.player)) return;
      const player = this.playerOf(m.player);
      if (player) fn(player, m.value);
    } else if (m.t === 'widgetClosed') {
      const kind = this.widgetKinds.get(m.widget);
      const s = this.widgetScreens.get(m.widget);
      if (!kind?.def.modal || !s?.of(m.player)) return;
      // Down on their screen already; said again so a screen that catches up later agrees.
      this.removeWidget(m.player, m.widget);
      const player = this.playerOf(m.player);
      if (player) kind.def.onClose?.(player);
    }
  }

  /** A restart: menus, screens and widgets are gone, callbacks with them (widgets stay defined). */
  reset() {
    for (const m of [...this.menus.values()]) m.open = false;
    this.menus.clear();
    this.callbacks.clear();
    this.widgetScreens.clear();
  }

  /**
   * A player's screen went into play (they pressed Play): the modal widgets up on it go again,
   * whole. A modal is a screen of its own that takes the mouse, so it's sent once more when the
   * player's screen is surely there to take it (it rebuilds one that's up in place).
   */
  resendModals(player: string) {
    for (const [name, kind] of this.widgetKinds) {
      if (!kind.def.modal) continue;
      const d = this.widgetScreens.get(name)?.of(player);
      if (d) this.send(player, 'hud', 'widget', [name, structuredClone(d)]);
    }
  }

  /** A player left for good: what their screen showed goes. */
  forget(player: string) {
    for (const s of this.widgetScreens.values()) s.mine.delete(player);
    for (const k of [...this.widgetHandles.keys()]) if (k.endsWith(`\u0000${player}`)) this.widgetHandles.delete(k);
  }

  /** `hud.define`: checked here (a mistake shows in the game's console), sent to screens if it's new or changed. */
  defineWidget(name: string, def: WidgetDefinition) {
    if (!WIDGET_NAME.test(name)) throw new Error(`hud.define: "${name}" can't name a widget (a letter, then letters, digits, _ or -)`);
    if (typeof def?.html !== 'string') throw new Error(`hud.define("${name}"): it needs its html`);
    if (def.at !== undefined && !WIDGET_ANCHORS.includes(def.at)) throw new Error(`hud.define("${name}"): at must be one of ${WIDGET_ANCHORS.join(', ')}`);
    const wire: WidgetWire = { html: def.html };
    if (def.css) wire.css = def.css;
    if (def.at) wire.at = def.at;
    if (def.modal) wire.modal = true;
    const json = JSON.stringify(wire);
    const was = this.widgetKinds.get(name);
    const parsed = parseMarkup(def.html);
    this.widgetKinds.set(name, { def, json, actions: new Set(parsed.actions) });
    if (was?.json === json) return;
    if (parsed.dropped.length) console.warn(`hud.define("${name}"): left out ${parsed.dropped.join(', ')}`);
    this.content.defineWidget(name, wire);
  }

  private widgetHandle(to: string | null, name: string): WidgetProxy {
    const key = `${name}\u0000${to ?? ''}`;
    let h = this.widgetHandles.get(key);
    if (!h) this.widgetHandles.set(key, (h = new WidgetProxy(name, this, to)));
    return h;
  }

  /**
   * A widget's data changes on these screens (everyone's, or one player's). Not up there yet: it
   * goes up with this data. Up: only what differs goes, as a patch each screen merges in.
   *
   * Everyone's and a player's own: everyone's call reaches every screen. It changes the fields it
   * names on every screen, a player's own copy included, and it goes back up (whole) on a screen
   * where the player took it down (their own `remove`, a modal they closed). A player's own call
   * changes their screen alone: their copy starts from everyone's, and is theirs from then on.
   */
  setWidget(to: string | null, name: string, input: WidgetData) {
    if (!this.widgetKinds.has(name)) throw new Error(`hud.widget: there's no widget "${name}" (hud.define it first)`);
    const data = plainRecord(input);
    let s = this.widgetScreens.get(name);
    if (!s) this.widgetScreens.set(name, (s = new WidgetScreens()));
    if (to === null) {
      if (s.all === null) {
        // Up for everyone, with this data (whatever players saw before).
        s.all = mergeData({}, data);
        s.mine.clear();
        this.send(null, 'hud', 'widget', [name, structuredClone(s.all)]);
        return;
      }
      // What differs on any screen it's up on.
      const screens = s.shown();
      let patch: PlainData | null = null;
      for (const d of screens) {
        const p = diffData(d, data);
        if (p) patch = mergeData(patch ?? {}, p);
      }
      if (patch) {
        for (const d of screens) mergeData(d, patch);
        this.send(null, 'hud', 'widgetSet', [name, patch]);
      }
      // Down on a player's screen (they took it down, or closed it): back up there, as everyone has it.
      for (const [player, d] of [...s.mine]) {
        if (d !== null) continue;
        s.mine.delete(player);
        this.send(player, 'hud', 'widget', [name, structuredClone(s.all)]);
      }
      return;
    }
    const cur = s.of(to);
    if (cur === null) {
      // Up on their screen: everyone's (if it's up for everyone) with theirs merged in.
      const d = mergeData(s.all ? structuredClone(s.all) : {}, data);
      s.mine.set(to, d);
      this.send(to, 'hud', 'widget', [name, structuredClone(d)]);
      return;
    }
    const patch = diffData(cur, data);
    if (!patch) return;
    // Their own copy from here on (it may have been everyone's).
    s.mine.set(to, mergeData(s.mine.has(to) ? cur : structuredClone(cur), patch));
    this.send(to, 'hud', 'widgetSet', [name, patch]);
  }

  removeWidget(to: string | null, name: string) {
    const s = this.widgetScreens.get(name);
    if (!s) return;
    if (to === null) {
      if (!s.shown().length) return;
      s.all = null;
      s.mine.clear();
    } else {
      if (!s.of(to)) return;
      s.mine.set(to, null);
    }
    this.send(to, 'hud', 'widgetRemove', [name]);
  }

  hud(to: string | null): HudApi {
    const send = (method: string, ...args: unknown[]) => this.send(to, 'hud', method, args);
    return {
      banner: (title: string, subtitle?: string, opts?: { duration?: number; color?: string }) => send('banner', title, subtitle, opts),
      objective: (text: string | null) => send('objective', text),
      stat: (id: string, label: string, value: string | number | null) => send('stat', id, label, value),
      bossBar: (name: string, fraction: number, color?: string) => send('bossBar', name, fraction, color),
      hideBossBar: () => send('hideBossBar'),
      toast: (text: string) => send('toast', text),
      feed: (text, opts) => send('feed', text, opts),
      pop: (text, opts) => send('pop', text, opts),
      scoreboard: (b) =>
        send('scoreboard', b && { ...b, rows: b.rows.map((r) => ({ name: r.name, values: [...r.values], color: r.color, player: r.player?.id })) }),
      meter: (id: string, label: string, value: number | null, opts?: { color?: string; text?: string }) => send('meter', id, label, value, opts),
      marker: (id: string, at: Anchor | null, opts?: MarkerOptions) =>
        send('marker', id, at && this.anchor(at), opts?.offset ? { ...opts, offset: { x: opts.offset.x, y: opts.offset.y, z: opts.offset.z } } : opts),
      crosshair: (visible: boolean) => send('crosshair', visible),
      radar: (data: RadarData | null) => send('radar', data && this.radarWire(data)),
      progress: (fraction: number | null, opts?: { color?: string }) => send('progress', fraction, opts),
      highlight: (at: Vec3 | null, opts?: { progress?: number }) => send('highlight', at && { x: at.x, y: at.y, z: at.z }, opts),
      screen: (opts: ScreenOptions) => {
        const id = this.nextId++;
        const cbs: number[] = [];
        const buttons = opts.buttons.map(({ onClick, ...b }) => ({ ...b, onClick: this.callback(onClick, cbs, to) }));
        send('screen', id, { ...opts, buttons });
        return () => {
          this.release(cbs);
          send('closeScreen', id);
        };
      },
      menu: (opts: MenuOptions) => {
        const m = new MenuProxy(this.nextId++, this, to, opts);
        this.menus.set(m.id, m);
        send('menu', m.id, this.encodeMenu(opts, m.cbs, to));
        return m;
      },
      define: (name: string, widget: WidgetDefinition) => this.defineWidget(name, widget),
      widget: (name: string, data?: WidgetData) => {
        const w = this.widgetHandle(to, name);
        w.set(data ?? {});
        return w;
      },
    };
  }

  private radarWire(d: RadarData): RadarWire {
    return {
      center: this.anchor(d.center),
      heading: d.heading,
      range: d.range,
      ...(d.at && { at: d.at }),
      blips: d.blips.map((b) => ('at' in b ? { at: this.anchor(b.at), color: b.color, size: b.size } : { x: b.x, z: b.z, y: b.y, color: b.color, size: b.size })),
    };
  }

  fx(to: string | null): FxApi {
    const send = (method: string, ...args: unknown[]) => this.send(to, 'fx', method, args);
    const v = (p: Vec3) => ({ x: p.x, y: p.y, z: p.z });
    return {
      burst: (at, opts) => send('burst', v(at), opts),
      shake: (strength, duration) => send('shake', strength, duration),
      flash: (color, strength, duration) => send('flash', color, strength, duration),
      shockwave: (at, radius, color) => send('shockwave', v(at), radius, color),
      damageNumber: (at, amount, opts) => send('damageNumber', v(at), amount, opts),
      fireworks: (at, count) => send('fireworks', v(at), count),
      explosion: (at, opts) => send('explosion', v(at), opts),
    };
  }

  audio(to: string | null): AudioApi {
    return {
      play: (name, opts) => this.send(to, 'audio', 'play', [name, opts && { ...opts, at: opts.at && { x: opts.at.x, y: opts.at.y, z: opts.at.z } }]),
      loop: (name, opts): LoopHandle => {
        const id = this.nextId++;
        this.send(to, 'audio', 'loop', [id, name, opts]);
        return {
          set: (o) => this.send(to, 'audio', 'loopSet', [id, o]),
          stop: () => this.send(to, 'audio', 'loopStop', [id]),
        };
      },
    };
  }

  view(to: string): ViewModelApi {
    const hub = this;
    let visible = true;
    return {
      get visible() {
        return visible;
      },
      set visible(v: boolean) {
        visible = v;
        hub.send(to, 'view', 'visible', [v]);
      },
      setSkin: (skin, atlas) => this.send(to, 'view', 'setSkin', [skin, atlas]),
      play: (anim: string | ViewAnimation, opts) => this.send(to, 'view', 'play', [typeof anim === 'string' ? anim : this.content.inlineAnimation(anim), opts]),
      define: (name, anim) => this.content.defineAnimation(name, anim),
      kick: (strength) => this.send(to, 'view', 'kick', [strength]),
    };
  }
}
