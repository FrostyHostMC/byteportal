import * as engine from '@engine/voxel_engine.js';
import type { Actor, Anchor, AudioApi, BlockRef, Bot, BotApi, DamageCause, DestructibleOptions, Entity, GameContext, GameDefinition, GameEvents, Player, PlayerAccount, ReplayApi, ReplayClip, ReplayHandle, ReplayOptions, Rng, StoreApi, Vec3, VehicleWorld, WorldApi } from '../api/types';
import { Commands } from '../commands';
import type { Content } from '../content';
import { IDLE_INPUT, type ClientMessage, type PlayerInput } from '../net/protocol';
import { blockIdOf, blockShape, collisionBoxes, type Registry } from '../world/registry';
import { dependents, FACING_DIR, placement, type PlaceHow } from '../world/placement';
import { CreativeBuild } from './creative';
import { EntitySim, type EntityFrame, type ProjectileFrame } from './entities';
import { ItemSim, type PickupFrame } from './items';
import { BotControlsImpl, guestStore, PlayerSim, type PlayerFrame } from './player';
import { avatarCode, normalAvatar, randomAvatar } from '../avatar';

/** Where `player.store` is kept in the game's data: `$player:<account id>:<key>`. */
export const PLAYER_DATA = '$player:';
/** Accounts told `player.adopted` in this game already: `$adopted:<account id>` (the name). */
export const ADOPTED = '$adopted:';
import { castBullet, History, type Hittable } from './hitscan';
import { leanOffset, resolveHitscan, type HitscanRules } from './hitboxes';
import { flightWorld } from './flight';
import type { ItemHost, ItemKind } from '../api/items';
import { Presentation, type Sink } from './present';
import { toLocal, toWorld } from './movers';
import { PropSim, PropState, type PropFrame } from './props';
import { rayHit, surfaceY, worldQuery } from './worldquery';
import { watchBlocks, type WorldHost } from './world';

function mulberry32(seed: number): Rng {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    range: (min, max) => min + (max - min) * next(),
    int: (min, max) => Math.floor(min + (max - min + 1) * next()),
    pick: (items) => items[Math.floor(next() * items.length)],
    chance: (p) => next() < p,
  };
}

type ExplodeOptions = NonNullable<Parameters<WorldApi['explode']>[2]>;

/**
 * Which blocks a blast takes in a world with destructible blocks (`world.destructible`): those
 * higher than its `above`, breakable, not liquid, of the families it names (or any, for `'all'`)
 * and not `except`ed. Of those, the ones that carve lose a crater; the rest (glass, slabs,
 * torches) break whole. Null for a world without destructible blocks.
 */
function blastRule(registry: Registry, o: DestructibleOptions | undefined): { ids: Uint8Array; above: number } | null {
  if (!o) return null;
  const ids = new Uint8Array(256);
  const named = o.blocks === undefined || o.blocks === 'all' ? null : new Set(o.blocks);
  const except = new Set(o.except ?? []);
  for (const b of registry.blocks) {
    if (!b || !b.breakable || b.shape === 'liquid' || b.shape === 'air' || except.has(b.name)) continue;
    if (named && !named.has(b.name)) continue;
    ids[b.id] = 1;
  }
  return { ids, above: o.above ?? -1 };
}

interface Timer {
  at: number;
  every: number;
  fn: () => void;
  dead: boolean;
}

/** Everything the clients need to show one tick. */
export interface SimFrame {
  /** Host time: seconds of ticks since the host began (clients say which they're showing, for fair hits). */
  t: number;
  /** Game clock (seconds since `start`). */
  clock: number;
  /** Play has begun (`start`). */
  started: boolean;
  /** Time of day, 0..1. */
  time: number;
  players: PlayerFrame[];
  entities: EntityFrame[];
  projectiles: ProjectileFrame[];
  pickups: PickupFrame[];
  props: PropFrame[];
  /** Creative building's hotbar (`player.build`). */
}

/** What the game's `replay` API needs of whoever keeps the room's history (the host: `host/replay.ts`). */
export interface ReplayBackend {
  readonly seconds: number;
  keep(seconds: number): void;
  show(player: Player, opts: ReplayOptions): ReplayHandle | null;
  stop(player: string): void;
  playing(player: string): ReplayHandle | null;
  clip(opts: { from?: number | { at: number }; seconds?: number }): ReplayClip | null;
}

export interface SimOptions {
  def: GameDefinition;
  seed: number;
  registry: Registry;
  world: WorldHost;
  content: Content;
  /** Presentation calls out to the clients. */
  sink: Sink;
  /** `game.exit()`: back to the launcher. */
  exit(): void;
  /** The built-in cheat commands (development builds, or the game allows them). */
  cheats: boolean;
  /** The first player (`game.player`): 'local' and 'Player' unless a server names them. */
  player?: { id: string; name: string };
  /** Where `game.store` keeps its data (default: nowhere past this session). */
  store?: { data(): Map<string, unknown>; put(key: string, value: unknown): void };
  /** `game.room`: 'public' (the default), or the code of a room a player started of their own. */
  room?: string;
  /** Replays (`game.replay`): the host keeps the room's history. Without one, `replay.show` shows nothing. */
  replay?: ReplayBackend;
  /** A signed-in player earned one of the game's achievements (`player.achieve`): keep it for their account. */
  achieve?: (account: string, id: string) => void;
  /** A signed-in player was given one of the game's cosmetics (`player.grant`; `game:id`): theirs from now on. */
  grant?: (account: string, id: string) => void;
  /**
   * Game code threw (a timer, `update`, an entity's AI): report it and carry on with the tick,
   * so one bug doesn't stop the whole game. Without it, errors are thrown.
   */
  error?: (err: unknown) => void;
}

/**
 * The simulation: the game's rules and its world, headless. It owns the blocks (through its
 * `WorldHost`), the players, entities, items, props, clock, events and commands, runs the game's
 * lifecycle hooks against the `GameContext`, and describes each tick to the clients as a
 * `SimFrame` plus presentation calls. It never touches the DOM or WebGL, so it can run in a
 * page, a worker or on a server.
 */
export class Sim {
  readonly def: GameDefinition;
  readonly registry: Registry;
  readonly host: WorldHost;
  readonly content: Content;
  readonly presentation: Presentation;
  readonly entities: EntitySim;
  readonly items: ItemSim;
  readonly props: PropSim;
  readonly players: PlayerSim[] = [];
  /** `game.players`: everyone in the game now, one array kept up to date as players come and go. */
  private roster: Player[] = [];
  private nextPlayer = 2;
  /** The player on this machine (the engine's built-in body). */
  readonly local: PlayerSim;
  readonly commands: Commands;
  readonly ctx: GameContext;
  readonly rng: Rng;
  /** Time of day and how it moves. */
  readonly env = { time: 0.3, frozen: false, dayLength: 1200 };
  /** Where `restart` puts the players back. */
  spawn = { x: 0.5, y: 80, z: 0.5, yaw: 0 };
  started = false;
  private listeners = new Map<string, Set<(e: unknown) => void>>();
  private timers: Timer[] = [];
  /** The match's clock (`clock.now`: back to 0 on a restart), and all the game's time (`clock.total`). */
  private clockNow = 0;
  private clockTotal = 0;
  /** Seconds of ticks so far (running or not): the host time frames carry. */
  time = 0;
  /** Where everyone was, for the last second (shots are checked where the shooter saw them). */
  readonly history = new History();
  /** The game's item kinds (`items`), in the order they run, and by kind. */
  readonly kinds: readonly ItemKind[];
  readonly kindMap: ReadonlyMap<string, ItemKind>;
  /** What the item kinds get of the simulation (see `ItemHost`). */
  readonly itemHost: ItemHost;
  /** Where bullets meet players (`hitscan`): how far back shots look, and the hitboxes. */
  readonly hitscan: HitscanRules;
  /** Bots (`game.bots`), in the order they came. */
  private botList: Bot[] = [];
  /** Which blocks a blast takes in a world with destructible blocks (null: whole blocks, as always). */
  private blastable: { ids: Uint8Array; above: number } | null;
  private nextBot = 1;
  /**
   * The game's kept data, raw: `game.store` and every account's `player.store` (under keys of the
   * platform's own, `PLAYER_DATA`, which `game.store` doesn't list).
   */
  private readonly data: { get(key: string): unknown; set(key: string, v: unknown): void; keys(): Iterable<string> };

  constructor(private o: SimOptions) {
    const values = o.store?.data() ?? new Map<string, unknown>();
    this.data = {
      get: (key) => values.get(key),
      set: (key, v) => {
        if (v === undefined) values.delete(key);
        else values.set(key, v);
        o.store?.put(key, v);
      },
      keys: () => values.keys(),
    };
    this.def = o.def;
    this.registry = o.registry;
    // Every block that changes, told to the game (`blockChange`) while anyone's listening.
    this.host = watchBlocks(
      o.world,
      () => !!this.listeners.get('blockChange')?.size,
      (x, y, z) => this.emit('blockChange', { x, y, z, block: this.registry.blocks[o.world.world.get_block(x, y, z)]?.name ?? 'unknown' }),
    );
    this.content = o.content;
    this.hitscan = resolveHitscan(o.def.hitscan);
    this.blastable = blastRule(o.registry, o.def.world?.destructible);
    this.history.keep = Math.max(1, this.hitscan.rewind + 0.1);
    this.rng = mulberry32(o.seed ^ 0x9e3779b9);
    const world = o.world.world;
    const emit = <K extends keyof GameEvents>(k: K, e: GameEvents[K]) => this.emit(k, e);
    this.presentation = new Presentation(o.sink, o.content);
    // Markers and radar blips follow props, entities and players by id.
    this.presentation.anchor = (a: Anchor) => {
      if (a instanceof PropState) return { $prop: a.id };
      if ((a as Entity).kind === 'entity') return { $entity: (a as Entity).id };
      if ((a as Player).kind === 'player') return { $player: (a as Player).id };
      const v = a as Vec3;
      return { x: v.x, y: v.y, z: v.z };
    };
    // A widget's button names who pressed it.
    this.presentation.playerOf = (id) => this.players.find((p) => p.id === id && !p.vacant)?.api;
    this.entities = new EntitySim({
      world,
      content: o.content,
      fx: this.presentation.fx(null),
      audio: this.presentation.audio(null),
      hud: this.presentation.hud(null),
      ctx: () => this.ctx,
      emit,
      dropItem: (item, at, count) => {
        if (this.items.get(item)) this.items.spawnPickup(item, at, { count, velocity: { x: this.rng.range(-2, 2), y: 4, z: this.rng.range(-2, 2) } });
      },
      slotOf: (p) => this.players.find((x) => x.api === p)?.slot ?? -1,
      bySlot: (slot) => this.players.find((x) => x.slot === slot)?.api,
      pvp: o.def.player?.pvp ?? false,
      guard: (fn) => this.guard(fn),
      players: () => this.ctx.players,
      prop: (id) => this.props.byId(id),
      now: () => this.time,
    });
    this.items = new ItemSim({
      ctx: () => this.ctx,
      emit,
      players: () => this.ctx.players,
      isSolid: (x, y, z) => {
        const id = world.get_block(x, y, z);
        return id !== 255 && (this.registry.blocks[id]?.solid ?? false);
      },
      propUnder: (p, depth) => {
        const [id, t] = world.mover_raycast(p.x, p.y, p.z, 0, -1, 0, depth);
        return id ? { id, surface: p.y - t } : null;
      },
      onProp: (id, at, out) => {
        const prop = this.props.byId(id);
        if (!prop?.solid) return null;
        const w = toWorld(prop.worldPose(), at);
        out.x = w.x;
        out.y = w.y;
        out.z = w.z;
        return out;
      },
      propLocal: (id, at) => {
        const prop = this.props.byId(id);
        return prop ? toLocal(prop.worldPose(), at) : null;
      },
      content: o.content,
      present: this.presentation,
      kind: (name) => this.kindMap.get(name) ?? null,
    });
    this.props = new PropSim(
      this.registry,
      (b) => this.blockId(b),
      o.content,
      {
        clock: () => this.clockNow,
        ack: (p) => {
          const sim = this.players.find((x) => x.api === p);
          return sim ? { id: sim.id, seq: sim.ack } : null;
        },
      },
      world,
    );
    this.itemHost = this.makeItemHost();
    // Each item kit's kind for this game (its own state: things in flight, cooldowns).
    this.kinds = (o.def.items ?? []).map((kit) => kit(this.itemHost));
    this.kindMap = new Map(this.kinds.map((k) => [k.kind, k]));
    this.local = this.newPlayer(o.player?.id ?? 'local', o.player?.name ?? 'Player');
    this.players.push(this.local);
    this.roster.push(this.local.api);
    this.env.time = o.def.world?.time ?? 0.3;
    this.env.frozen = o.def.world?.freezeTime ?? false;
    this.commands = new Commands(() => this.ctx, o.cheats);
    this.ctx = this.createContext();
    this.registerCommands();
  }

  /** What the item kinds get of the simulation (`ItemHost`). */
  private makeItemHost(): ItemHost {
    const sim = this;
    const world = this.host.world;
    const flight = flightWorld(world, this.registry);
    const present = this.presentation;
    const audioFor = (except: string | undefined): AudioApi =>
      except === undefined
        ? present.audio(null)
        : {
            play: (name, opts) => present.send(null, 'audio', 'play', [name, opts && { ...opts, at: opts.at && { x: opts.at.x, y: opts.at.y, z: opts.at.z } }], except),
            loop: (name, opts) => present.audio(null).loop(name, opts),
          };
    return {
      get game() {
        return sim.ctx;
      },
      pvp: this.def.player?.pvp ?? false,
      carves: !!this.def.world?.destructible,
      bodies: () => [
        ...this.players.filter((p) => !p.vacant && !p.health.dead).map((p) => ({ target: p.api as Player | Entity, feet: p.position, height: p.sneaking ? 1.5 : 1.8, width: 0.6 })),
        ...this.entities.all().map((e) => ({ target: e as Player | Entity, feet: e.position, ...this.entities.hitbox(e) })),
      ],
      solid: (from, dir, max) => {
        const r = flight.hit(from.x, from.y, from.z, dir.x, dir.y, dir.z, max);
        return r && { dist: r.t, normal: { x: r.nx, y: r.ny, z: r.nz } };
      },
      blast: (c, o) => this.hurtAround(c, o.reach, o.near, o.far, o.knockback ?? 1, o.by ?? 'world', o.weapon, o.cause ?? 'explosion'),
      send: (name, data, o = {}) => present.message(o.to ? o.to.id : null, name, data, o.except?.id, true),
      audio: (o = {}) => audioFor(o.except?.id),
      emit: (k, e) => this.emit(k, e),
      now: () => this.time,
      swing: (player, view, power) => {
        const p = this.players.find((x) => x.api === player);
        if (!p) return;
        p.swings++;
        if (view) present.send(p.id, 'view', view, [power ?? 1]);
      },
      guard: (fn) => this.guard(fn),
    };
  }

  /** Run game code; with an error handler, a throw is reported and the tick goes on. */
  guard(fn: () => void) {
    if (!this.o.error) return fn();
    try {
      fn();
    } catch (err) {
      this.o.error(err);
    }
  }

  blockId(b: BlockRef): number {
    return blockIdOf(this.registry, b);
  }

  emit<K extends keyof GameEvents>(event: K, e: GameEvents[K]) {
    const set = this.listeners.get(event);
    if (set) for (const fn of [...set]) fn(e);
  }

  // ---------------------------------------------------------------------------------------------
  // Lifecycle
  // ---------------------------------------------------------------------------------------------

  /** The game's `setup`: it defines its content and subscribes to events. */
  setup() {
    this.def.setup?.(this.ctx);
  }

  /** Play begins. */
  start() {
    if (this.started) return;
    this.started = true;
    this.def.start?.(this.ctx);
  }

  /**
   * One tick: time of day, players move with their controls, then (while running) timers and the
   * game's `update` and health; props move on, solid ones carrying what rides them; then entities
   * and items, and finally the built-in hands.
   */
  tick(dt: number, running: boolean, inputs: Record<string, PlayerInput>, premoved?: ReadonlySet<string>) {
    this.time += dt;
    if (!this.env.frozen) this.env.time = (this.env.time + dt / this.env.dayLength) % 1;
    for (const p of this.players) {
      // A bot's controls are the game's code's (set last tick); a person's came from their screen.
      p.input.set(p.bot ? p.bot.snapshot(running && !p.health.dead, p.viewSeq) : (inputs[p.id] ?? IDLE_INPUT));
      // A predicting client's player moved already, input by input (see GameHost.step).
      if (!premoved?.has(p.id)) p.move(dt);
    }
    // What their movement abilities did (a dash, a wall-jump), heard once everyone has moved.
    for (const p of this.players) this.guard(() => p.announceAbilities());
    if (running) {
      this.tickTimers(dt);
      this.guard(() => this.def.update?.(this.ctx, dt));
      for (const p of this.players) p.updateHealth(dt);
    }
    this.props.update(dt);
    // Where the game moved its solid props, what stands on them goes too (before creatures step).
    if (this.props.carry(dt)) for (const p of this.players) p.syncState();
    this.entities.update(dt, running);
    // Things in flight (throwables), fires: the item kinds' own, for the whole game.
    if (running) for (const k of this.kinds) if (k.update) this.guard(() => k.update!(this.itemHost, dt));
    this.items.update(dt, running);
    for (const p of this.players) {
      p.updateHands(dt, running);
      p.creative?.update(dt);
    }
    this.record();
  }

  /** Where everyone is this tick, for shots checked in the past. */
  private record() {
    const players = new Map<string, { x: number; y: number; z: number; stance: 0 | 1 | 2; alive: boolean; lean?: { x: number; z: number } }>();
    for (const p of this.players) {
      if (p.vacant) continue;
      const s = p.state;
      players.set(p.id, { x: s.x, y: s.y, z: s.z, stance: p.sliding ? 2 : p.sneaking ? 1 : 0, alive: !p.health.dead && !p.spectating, ...(p.lean && { lean: leanOffset(p.yaw, p.lean) }) });
    }
    const entities = new Map<number, { x: number; y: number; z: number; stance: 0; alive: boolean }>();
    for (const e of this.entities.all()) {
      const q = e.position;
      entities.set(e.id, { x: q.x, y: q.y, z: q.z, stance: 0, alive: e.alive });
    }
    this.history.record(this.time, players, entities);
  }

  /** Everyone a bullet could hit, where they are now. */
  private hittable(): Hittable[] {
    const out: Hittable[] = [];
    for (const p of this.players) {
      if (p.vacant || p.health.dead || p.spectating) continue;
      const s = p.state;
      out.push({ target: p.api, key: p.id, now: { x: s.x, y: s.y, z: s.z, stance: p.sliding ? 2 : p.sneaking ? 1 : 0, alive: true, ...(p.lean && { lean: leanOffset(p.yaw, p.lean) }) } });
    }
    for (const e of this.entities.all()) {
      const q = e.position;
      out.push({ target: e, key: e.id, now: { x: q.x, y: q.y, z: q.z, stance: 0, alive: true }, box: this.entities.shape(e) });
    }
    return out;
  }

  frame(): SimFrame {
    const e = this.entities.frame();
    return {
      t: this.time,
      clock: this.clockNow,
      started: this.started,
      time: this.env.time,
      players: this.players.filter((p) => !p.vacant).map((p) => p.frame()),
      entities: e.entities,
      projectiles: e.projectiles,
      pickups: this.items.frame(),
      props: this.props.frame(),
    };
  }

  /** Something a player did on their client (menus, callbacks, the block picker, the game's own messages). */
  receive(m: ClientMessage) {
    if (m.t === 'creativePick') this.players.find((p) => p.id === m.player)?.creative?.pick(m.block);
    else if (m.t === 'game') {
      // The game's own: its code hears it, as the player whose connection it came on.
      const player = this.players.find((p) => p.id === m.player && !p.vacant)?.api;
      if (player) this.emit('clientMessage', { player, name: m.name, data: m.data });
    } else this.presentation.receive(m);
  }

  /**
   * A player joins (a client connected), frozen until their client starts playing. The first
   * player's place (`game.player`) is taken first if it's vacant; anyone else is new, at the
   * spawn. The game hears `playerJoin`.
   */
  join(name = 'Player', account: PlayerAccount | null = null, achieved: readonly string[] = [], look: { avatar: string | null; wear: string[]; owned?: string[] } = { avatar: null, wear: [] }): PlayerSim {
    let p = this.local;
    if (p.vacant) {
      p.vacant = false;
      this.roster.unshift(p.api);
      const sp = this.spawn;
      p.fresh(sp.x, sp.y, sp.z, sp.yaw);
    } else {
      p = this.newPlayer(`p${this.nextPlayer++}`, name);
      this.players.push(p);
      this.roster.push(p.api);
      const sp = this.spawn;
      p.place(sp.x, sp.y, sp.z, sp.yaw);
    }
    p.name = name;
    this.identify(p, account);
    p.achieved = new Set(account ? achieved : []);
    this.dress(p, look);
    // Their screen knows which of the game's achievements they have (the pause menu lists them).
    if (this.def.achievements) this.presentation.send(p.id, 'hud', 'achievements', [[...p.achieved], !!account]);
    this.host.world.set_frozen(p.slot, true);
    this.emit('playerJoin', { player: p.api });
    // (Their first visit since claiming their name: told once, while they're here.)
    if (account && p.adopted) this.data.set(`${ADOPTED}${account.id}`, p.adopted);
    return p;
  }

  /**
   * Who a joining player is: their account and their `player.store` (kept for the account, in the
   * game's data), or a guest's, kept until they leave.
   */
  private identify(p: PlayerSim, account: PlayerAccount | null) {
    p.account = account && { ...account };
    p.adopted = account && this.data.get(`${ADOPTED}${account.id}`) === undefined ? account.name : null;
    p.store = account ? this.scopedStore(`${PLAYER_DATA}${account.id}:`) : guestStore();
  }

  /**
   * A player leaves: the game hears `playerLeave`, then they're gone. The first player stays as
   * a vacant place for the next to join, so `game.player` keeps working.
   */
  leave(id: string) {
    const p = this.players.find((x) => x.id === id);
    if (!p || p.vacant) return;
    // Out of `game.players` first: the game counts who's left when it hears.
    this.roster.splice(this.roster.indexOf(p.api), 1);
    this.emit('playerLeave', { player: p.api });
    if (p === this.local) {
      p.vacant = true;
      this.host.world.set_frozen(p.slot, true);
      return;
    }
    this.players.splice(this.players.indexOf(p), 1);
    p.remove();
  }

  /** A bot joins (`game.bots.add`): a player with no screen, driven by the game's code, at the spawn. */
  addBot(name: string): Bot {
    const p = this.newPlayer(`b${this.nextBot++}`, name);
    p.bot = new BotControlsImpl(() => p.eye);
    // Someone of their own (the same bot, the same person, on every screen).
    let h = 2166136261;
    for (const c of `${name}|${p.id}`) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
    p.avatar = avatarCode(randomAvatar(mulberry32(h).next));
    const bot = Object.assign(p.api, { controls: p.bot }) as Bot;
    this.players.push(p);
    this.roster.push(p.api);
    const sp = this.spawn;
    p.place(sp.x, sp.y, sp.z, sp.yaw);
    p.bot.look(sp.yaw, 0);
    this.host.world.set_frozen(p.slot, false);
    this.botList.push(bot);
    this.emit('playerJoin', { player: bot });
    return bot;
  }

  removeBot(bot: Player) {
    const i = this.botList.indexOf(bot as Bot);
    if (i < 0) return;
    this.botList.splice(i, 1);
    this.leave(bot.id);
  }

  /**
   * A player's client started playing (clicked Play): their body wakes up (unless they're dead, or
   * the game froze them as they joined), the game starts, and the game hears `playerReady`.
   */
  play(p: PlayerSim) {
    this.host.world.set_frozen(p.slot, (p.health.dead && !p.spectating) || p.held);
    // Their client's camera turned on the title screen: face where they were placed.
    p.setView(p.yaw, p.pitch);
    this.start();
    // Their screen is in play now: the modal widgets up on it go again (see `resendModals`).
    this.presentation.resendModals(p.id);
    this.emit('playerReady', { player: p.api });
  }

  /** `game.store`: values copied through JSON, so nothing the game holds on to changes them. */
  private makeStore(): StoreApi {
    const store = this.scopedStore('');
    return { ...store, keys: (prefix = '') => store.keys(prefix).filter((k) => !k.startsWith(PLAYER_DATA) && !k.startsWith(ADOPTED)) };
  }

  /** A store over the kept data's keys starting with `scope` (the scope left off). */
  private scopedStore(scope: string): StoreApi {
    const copy = <T>(v: T): T => (v === undefined ? v : (JSON.parse(JSON.stringify(v)) as T));
    return {
      get: <T>(key: string) => copy(this.data.get(scope + key)) as T | undefined,
      set: (key, value) => this.data.set(scope + key, copy(value)),
      delete: (key) => this.data.set(scope + key, undefined),
      keys: (prefix = '') => [...this.data.keys()].filter((k) => k.startsWith(scope + prefix)).map((k) => k.slice(scope.length)).sort(),
    };
  }

  /** Read-only world questions (what vehicles ask). */
  private query: VehicleWorld | null = null;

  private newPlayer(id: string, name: string): PlayerSim {
    const world = this.host.world;
    const p = new PlayerSim({
      bullet: (from, dir, range, seen, shooter, pen) =>
        castBullet(
          {
            world,
            registry: this.registry,
            history: this.history,
            prop: (o, d, max) => this.props.raycast(o, d, max),
            targets: () => this.hittable(),
            rules: this.hitscan,
          },
          from,
          dir,
          range,
          this.time,
          seen,
          shooter,
          pen,
        ),
      id,
      name,
      world: this.host.world,
      options: this.def.player ?? {},
      kinds: this.kindMap,
      itemHost: this.itemHost,
      vehicles: this.def.vehicles ?? {},
      query: (this.query ??= worldQuery(this.host.world, this.registry)),
      present: this.presentation,
      entities: this.entities,
      items: this.items,
      props: this.props,
      ctx: () => this.ctx,
      emit: (k, e) => this.emit(k, e),
      now: () => this.time,
      achieve: (who, a) => this.achieve(who, a),
      grant: (who, c) => this.grant(who, c),
    });
    if (this.def.player?.build)
      p.creative = new CreativeBuild(
        this.host.world,
        this.registry,
        this.presentation,
        p,
        (x, y, z) => this.breakBlockAt(x, y, z, p.api),
        (x, y, z, id, against) => this.placeBlockAt(x, y, z, id, p.api, { against }),
      );
    return p;
  }

  /**
   * A joining player's own look: their avatar (the person they are in a game that doesn't dress
   * its players itself) and the cosmetics they wear.
   */
  private dress(p: PlayerSim, look: { avatar: string | null; wear: string[]; owned?: string[] }) {
    p.avatar = normalAvatar(look.avatar);
    p.wear = p.account ? look.wear.slice(0, 8) : [];
    p.owns = new Set(p.account ? look.owned : []);
  }

  /**
   * `player.achieve`: one of the game's achievements, the first time they earn it: it pops up on
   * their screen, and a signed-in player's is kept for their account (a guest's, for the visit).
   */
  private achieve(p: PlayerSim, id: string): boolean {
    const def = this.def.achievements?.[id];
    if (!def) {
      // A mistake in the game: reported (thrown, without a handler), and nothing's awarded.
      const err = new Error(`player.achieve: "${id}" isn't one of ${this.def.id}'s achievements (meta.achievements)`);
      if (!this.o.error) throw err;
      this.o.error(err);
      return false;
    }
    if (p.bot || p.vacant || p.achieved.has(id)) return false;
    p.achieved.add(id);
    const all = Object.keys(this.def.achievements ?? {}).length;
    const have = Object.keys(this.def.achievements ?? {}).filter((a) => p.achieved.has(a)).length;
    this.presentation.send(p.id, 'hud', 'achievement', [{ id, title: def.title, description: def.description, kept: !!p.account, count: `${have} of ${all}` }]);
    if (p.account) this.o.achieve?.(p.account.id, id);
    if (def.reward) this.grant(p, def.reward);
    return true;
  }

  /**
   * `player.grant`: one of the game's cosmetics, theirs (a signed-in player's, kept for their
   * account; the server knows if they had it): it pops up. A guest is told signing in keeps them.
   */
  private grant(p: PlayerSim, id: string): boolean {
    const def = this.def.cosmetics?.[id];
    if (!def) {
      const err = new Error(`player.grant: "${id}" isn't one of ${this.def.id}'s cosmetics (meta.cosmetics)`);
      if (!this.o.error) throw err;
      this.o.error(err);
      return false;
    }
    if (p.bot || p.vacant) return false;
    const full = `${this.def.id}:${id}`;
    if (p.account) {
      if (p.owns.has(full)) return false;
      p.owns.add(full);
      this.o.grant?.(p.account.id, full);
    }
    this.presentation.send(p.id, 'hud', 'cosmetic', [{ id: full, name: def.name, slot: def.slot, kept: !!p.account }]);
    return !!p.account;
  }

  /** A command typed by a player. */
  exec(line: string, player = this.local) {
    return this.commands.exec(line, player.api);
  }

  /** Reset game state and call `start` again. The clients clear their HUDs and views. */
  restart() {
    this.entities.clear();
    this.props.clear();
    for (const k of this.kinds) k.clear?.();
    // Put the world back the way it was generated (craters, broken blocks), unless the game
    // saves the world (Sandbox keeps your builds).
    if (!this.def.world?.persist) this.host.revert();
    this.items.clearPickups();
    // The match's clock starts again, its timers gone with it; `clock.total` runs on.
    this.timers = [];
    this.clockNow = 0;
    this.history.clear();
    this.presentation.reset();
    this.presentation.message(null, '$reset', null);
    const sp = this.spawn;
    for (const p of this.players) {
      p.inventory.clear();
      p.reset();
      // Out of any vehicle (its model went with the props): `start` puts them back in.
      p.vehicle = null;
      p.followVehicle = false;
      p.orbit = null;
      p.clip = null;
      p.health.configure(this.def.player ?? {});
      p.health.revive();
      p.place(sp.x, sp.y, sp.z, sp.yaw);
    }
    this.env.time = this.def.world?.time ?? this.env.time;
    this.def.start?.(this.ctx);
  }

  // ---------------------------------------------------------------------------------------------
  // Timers
  // ---------------------------------------------------------------------------------------------

  private addTimer(delay: number, every: number, fn: () => void): () => void {
    const t: Timer = { at: this.clockNow + delay, every, fn, dead: false };
    this.timers.push(t);
    return () => {
      t.dead = true;
    };
  }

  private tickTimers(dt: number) {
    this.clockNow += dt;
    this.clockTotal += dt;
    for (let i = 0; i < this.timers.length; i++) {
      const t = this.timers[i];
      if (t.dead) continue;
      if (this.clockNow >= t.at) {
        if (t.every > 0) t.at += t.every;
        else t.dead = true;
        this.guard(t.fn);
      }
    }
    this.timers = this.timers.filter((t) => !t.dead);
  }

  // ---------------------------------------------------------------------------------------------
  // World edits
  // ---------------------------------------------------------------------------------------------

  /** Debris flying off a broken block (the client draws it from the block's texture). */
  private debris(x: number, y: number, z: number, id: number) {
    this.presentation.message(null, '$debris', [x, y, z, id]);
  }

  /**
   * `world.explode`: hurt whoever's in reach (with `damage`), blow out the blocks (a crater in a
   * destructible world's walls, whole blocks in any other), and set off the explosion.
   */
  explode(c: Vec3, radius: number, opts: ExplodeOptions = {}): number {
    const r = Math.max(0.5, radius);
    // Those in reach are hurt first: the wall they're behind shields them, whatever the blast
    // then does to it.
    if (opts.damage !== undefined) {
      const [near, far] = typeof opts.damage === 'number' ? [opts.damage, opts.damage] : opts.damage;
      this.hurtAround(c, opts.reach ?? r * 2, near, far, opts.knockback ?? 1, opts.by ?? 'world', opts.weapon);
    }
    // (The explosion first: each screen throws what it blows out away from it.)
    if (opts.effect !== false) this.ctx.fx.explosion(c, { size: Math.max(1, r / 2) });
    return this.blowBlocks(c, r, opts);
  }

  /**
   * Blocks a blast takes: in a world with destructible blocks, a crater (`blowCrater`); in any
   * other, a ragged sphere of whole blocks (bedrock and liquids survive), with debris. Returns the
   * blocks removed altogether.
   */
  blowBlocks(c: Vec3, radius: number, opts: { filter?: (at: Vec3, block: string) => boolean; by?: Actor } = {}): number {
    if (this.blastable) return this.blowCrater(c, radius, opts);
    const world = this.host.world;
    const r = Math.max(0.5, radius);
    const ri = Math.ceil(r + 1);
    const cx = Math.floor(c.x);
    const cy = Math.floor(c.y);
    const cz = Math.floor(c.z);
    const cells: [number, number, number, number][] = [];
    const removed: [number, number, number, number][] = [];
    for (let dy = -ri; dy <= ri; dy++)
      for (let dz = -ri; dz <= ri; dz++)
        for (let dx = -ri; dx <= ri; dx++) {
          const d = Math.hypot(dx + 0.5 + cx - c.x, dy + 0.5 + cy - c.y, dz + 0.5 + cz - c.z);
          if (d > r + (Math.random() - 0.5) * 1.2) continue;
          const x = cx + dx;
          const y = cy + dy;
          const z = cz + dz;
          const id = world.get_block(x, y, z);
          if (id === 0 || id === 255) continue;
          const def = this.registry.blocks[id];
          if (!def || !def.breakable || def.shape === 'liquid') continue;
          if (opts.filter && !opts.filter({ x, y, z }, def.name)) continue;
          cells.push([x, y, z, 0]);
          removed.push([x, y, z, id]);
        }
    let n = this.host.editMany(cells);
    n += this.loosen(removed, opts.by ?? 'world');
    // Debris from a sample of what was destroyed.
    for (let i = 0; i < Math.min(12, removed.length); i++) {
      const [x, y, z, id] = removed[Math.floor(Math.random() * removed.length)];
      this.debris(x, y, z, id);
    }
    return n;
  }

  /**
   * What went with `removed` (blocks just broken: where, and what they were): torches on the
   * walls that went, plants on the ground that went, the rest of broken beds. They go too, and
   * each fires `blockBreak` (the removed blocks first). Returns how many more went.
   */
  private loosen(removed: [number, number, number, number][], by: Actor): number {
    const world = this.host.world;
    const gone = new Set(removed.map(([x, y, z]) => `${x},${y},${z}`));
    const loose: [number, number, number, number][] = [];
    for (const [x, y, z, id] of removed)
      for (const [dx, dy, dz] of dependents(this.registry, x, y, z, id, (a, b, c) => world.get_block(a, b, c))) {
        const k = `${dx},${dy},${dz}`;
        if (gone.has(k)) continue;
        gone.add(k);
        loose.push([dx, dy, dz, world.get_block(dx, dy, dz)]);
      }
    const n = loose.length ? this.host.editMany(loose.map(([x, y, z]) => [x, y, z, 0])) : 0;
    removed.push(...loose);
    for (const [x, y, z, id] of removed) this.emit('blockBreak', { x, y, z, block: this.registry.blocks[id].name, by });
    return n;
  }

  /**
   * A blast in a world with destructible blocks: the destructible blocks in reach lose a ragged
   * sphere of little voxels (`VoxelWorld.blast`; the same crater for the same blast on every
   * copy of the world, and the clients take it as damage), blocks the game made destructible
   * that can't be carved (glass, leaves, slabs, torches) break whole within `radius`, and the
   * rest (under the line, `except`) stand.
   */
  private blowCrater(c: Vec3, radius: number, opts: { filter?: (at: Vec3, block: string) => boolean; by?: Actor }): number {
    const world = this.host.world;
    const rule = this.blastable!;
    const r = Math.max(0.3, radius);
    const ROUGH = 0.3;
    const ri = Math.ceil(r * (1 + ROUGH)) + 1;
    const cx = Math.floor(c.x);
    const cy = Math.floor(c.y);
    const cz = Math.floor(c.z);
    const carve: number[] = [];
    const whole: [number, number, number, number][] = [];
    for (let dy = -ri; dy <= ri; dy++)
      for (let dz = -ri; dz <= ri; dz++)
        for (let dx = -ri; dx <= ri; dx++) {
          const x = cx + dx;
          const y = cy + dy;
          const z = cz + dz;
          if (y <= rule.above) continue;
          const id = world.get_block(x, y, z);
          if (id === 0 || id === 255 || !rule.ids[id]) continue;
          const def = this.registry.blocks[id];
          if (opts.filter && !opts.filter({ x, y, z }, def.name)) continue;
          if (world.carvable(x, y, z)) carve.push(x, y, z);
          else if (Math.hypot(x + 0.5 - c.x, y + 0.5 - c.y, z + 0.5 - c.z) <= r) whole.push([x, y, z, id]);
        }
    // The same blast, the same crater: seeded by where it is.
    const seed = (Math.imul(Math.floor(c.x * 16), 73856093) ^ Math.imul(Math.floor(c.y * 16), 19349663) ^ Math.imul(Math.floor(c.z * 16), 83492791)) >>> 0;
    const { emptied } = this.host.blast([c.x, c.y, c.z], r, ROUGH, seed, Int32Array.from(carve));
    let n = emptied.length + (whole.length ? this.host.editMany(whole.map(([x, y, z]) => [x, y, z, 0])) : 0);
    const removed = [...emptied, ...whole];
    n += this.loosen(removed, opts.by ?? 'world');
    for (let i = 0; i < Math.min(12, removed.length); i++) {
      const [x, y, z, id] = removed[Math.floor(Math.random() * removed.length)];
      this.debris(x, y, z, id);
    }
    return n;
  }

  /**
   * Hurt players and creatures round a blast: `near` at its middle falling to `far` at `reach`
   * blocks (measured to the nearest point of each body), none past it or behind a wall (a line
   * from the blast to their feet, middle or eyes has to be clear), pushed away by `knockback`
   * (less further out). The hits are `explosion`s from `by`.
   */
  hurtAround(c: Vec3, reach: number, near: number, far: number, knockback: number, by: Actor, weapon?: string, cause: DamageCause = 'explosion') {
    const world = this.host.world;
    const hit = (target: Player | Entity, feet: Vec3, height: number) => {
      // The nearest point of their body (a vertical line from feet to head) to the blast.
      const y = Math.max(feet.y + 0.1, Math.min(feet.y + height - 0.1, c.y));
      const d = Math.hypot(feet.x - c.x, y - c.y, feet.z - c.z);
      if (d >= reach) return;
      const seen = [0.25, height * 0.55, height - 0.2].some((h) => world.line_clear(c.x, c.y, c.z, feet.x, feet.y + h, feet.z));
      if (!seen) return;
      const k = d / reach;
      const amount = near + (far - near) * k;
      if (amount <= 0) return;
      target.damage(amount, { source: by, from: c, knockback: knockback * (1 - k), weapon, cause });
    };
    for (const p of this.players) {
      if (p.vacant || p.health.dead || p.spectating) continue;
      hit(p.api, p.position, p.sneaking ? 1.5 : 1.8);
    }
    for (const e of this.entities.near(c, reach + 3)) hit(e, e.position, this.entities.hitbox(e).height);
  }

  /**
   * Carve little voxels out of destructible blocks (`world.carve`): a channel from `point` along
   * `dir`. Blocks carved to nothing are gone with debris, what hung on them or stood on them goes
   * too, and each fires `blockBreak`. Returns how many little voxels went.
   */
  carve(point: Vec3, dir: Vec3, opts: { radius?: number; depth?: number; by?: Actor } = {}): number {
    const world = this.host.world;
    const reg = this.registry;
    const { removed, emptied } = this.host.carve([point.x, point.y, point.z], [dir.x, dir.y, dir.z], opts.radius ?? 0.1, opts.depth ?? 0.2);
    if (!emptied.length) return removed;
    const by = opts.by ?? 'world';
    const gone = new Set(emptied.map(([x, y, z]) => `${x},${y},${z}`));
    const loose: [number, number, number, number][] = [];
    for (const [x, y, z, id] of emptied) {
      this.debris(x, y, z, id);
      this.emit('blockBreak', { x, y, z, block: reg.blocks[id]?.name ?? 'unknown', by });
      for (const [a, b, c] of dependents(reg, x, y, z, id, (i, j, k) => world.get_block(i, j, k))) {
        const k = `${a},${b},${c}`;
        if (gone.has(k)) continue;
        gone.add(k);
        loose.push([a, b, c, world.get_block(a, b, c)]);
      }
    }
    if (loose.length) this.host.editMany(loose.map(([x, y, z]) => [x, y, z, 0]));
    for (const [x, y, z, id] of loose) {
      this.debris(x, y, z, id);
      this.emit('blockBreak', { x, y, z, block: reg.blocks[id]?.name ?? 'unknown', by });
    }
    return removed;
  }

  /** Break a block: debris, a sound, what hung on it or stood on it (and a bed's other half), the events. */
  breakBlockAt(x: number, y: number, z: number, by: Actor): boolean {
    const world = this.host.world;
    const id = world.get_block(x, y, z);
    if (id === 0 || id === 255) return false;
    const def = this.registry.blocks[id];
    if (!def || !def.breakable || def.shape === 'liquid') return false;
    const loose = dependents(this.registry, x, y, z, id, (a, b, c) => world.get_block(a, b, c)).map(([a, b, c]) => [a, b, c, world.get_block(a, b, c)]);
    if (!this.host.edit(x, y, z, 0)) return false;
    this.debris(x, y, z, id);
    if (def.sounds?.break) this.ctx.audio.play(def.sounds.break, { at: { x: x + 0.5, y: y + 0.5, z: z + 0.5 } });
    else this.ctx.audio.play('hit', { at: { x: x + 0.5, y: y + 0.5, z: z + 0.5 }, volume: 0.45, pitch: 1.6 });
    this.emit('blockBreak', { x, y, z, block: def.name, by });
    for (const [a, b, c, was] of loose) {
      if (!this.host.edit(a, b, c, 0)) continue;
      this.debris(a, b, c, was);
      this.emit('blockBreak', { x: a, y: b, z: c, block: this.registry.blocks[was].name, by });
    }
    return true;
  }

  /**
   * Place a block the way a player would (see `placement`): turned to face the right way when
   * `block` names a family rather than one of its variants, in cells that are free (air, plants)
   * and nobody is standing in, a plant on ground, a torch on something; with a sound and the
   * events. A bed takes two cells.
   */
  placeBlockAt(x: number, y: number, z: number, block: BlockRef, by: Actor, how: PlaceHow = {}): boolean {
    const world = this.host.world;
    const reg = this.registry;
    const id = this.blockId(block);
    const def = reg.blocks[id];
    if (!def) return false;
    // A family name, or its default variant's id, gets turned; anything else goes as named.
    const exact = typeof block === 'string' ? block.includes('[') : reg.byName.get(def.name) !== def;
    if (!how.look && typeof by === 'object') how = { ...how, look: 'look' in by ? by.look : by.velocity };
    const plan = placement(reg, def, x, y, z, how, exact, (a, b, c) => world.get_block(a, b, c));
    if (!plan) return false;
    for (const [cx, cy, cz, cid] of plan.cells) {
      const d = reg.blocks[cid];
      if (!d || cy < 0 || cy > 255) return false;
      const cur = world.get_block(cx, cy, cz);
      if (cur === 255 || !(plan.join || (reg.blocks[cur]?.replaceable ?? false))) return false;
      if (d.solid && this.occupied(cx, cy, cz, cid)) return false;
      // A plant needs ground under it; a vine (climbable) hangs where it's put.
      if (d.shape === 'cross' && !d.climbable && !reg.blocks[world.get_block(cx, cy - 1, cz)]?.solid) return false;
    }
    for (const [cx, cy, cz, cid] of plan.cells) {
      if (!this.host.edit(cx, cy, cz, cid)) return false;
      this.emit('blockPlace', { x: cx, y: cy, z: cz, block: reg.blocks[cid].name, by });
    }
    const [cx, cy, cz, cid] = plan.cells[0];
    const sound = reg.blocks[cid]?.sounds?.place;
    if (sound) this.ctx.audio.play(sound, { at: { x: cx + 0.5, y: cy + 0.5, z: cz + 0.5 } });
    else this.ctx.audio.play('click', { at: { x: cx + 0.5, y: cy + 0.5, z: cz + 0.5 }, volume: 0.5, pitch: 0.7 });
    return true;
  }

  /** Whether block `id` at (x, y, z) would be in someone's way: a player's or an entity's body. */
  private occupied(x: number, y: number, z: number, id: number): boolean {
    if (this.host.world.player_overlaps(x, y, z, id)) return true;
    // Its boxes' height: a bottom slab leaves room above it.
    const boxes = this.registry.blocks[id]?.boxes;
    const y0 = y + (boxes ? Math.min(...boxes.map((b) => b[1])) / 16 : 0);
    const y1 = y + (boxes ? Math.max(...boxes.map((b) => b[4])) / 16 : 1);
    for (const e of this.entities.near({ x: x + 0.5, y: y + 0.5, z: z + 0.5 }, 3)) {
      const p = e.position;
      const box = this.entities.hitbox(e);
      const hw = box.width / 2;
      // A little slack so a body standing on the block's top face (or brushing its side) doesn't count.
      if (Math.abs(p.x - (x + 0.5)) < 0.49 + hw && Math.abs(p.z - (z + 0.5)) < 0.49 + hw && p.y < y1 - 0.02 && p.y + box.height > y0 + 0.02) return true;
    }
    return false;
  }

  surfaceY(x: number, z: number): number {
    return surfaceY(this.host.world, this.registry, x, z);
  }

  // ---------------------------------------------------------------------------------------------
  // The game context (the public API)
  // ---------------------------------------------------------------------------------------------

  private createContext(): GameContext {
    const sim = this;
    const world = this.host.world;
    const reg = this.registry;
    const local = this.local.api;
    const players = this.roster;
    return {
      world: {
        getBlock: (x, y, z) => {
          const id = world.get_block(Math.floor(x), Math.floor(y), Math.floor(z));
          return id === 255 ? -1 : id;
        },
        setBlock: (x, y, z, block) => sim.host.edit(Math.floor(x), Math.floor(y), Math.floor(z), sim.blockId(block)),
        blockId: (name) => sim.blockId(name),
        blockName: (id) => reg.blocks[id]?.name ?? 'unknown',
        raycast: (o, d, max) => rayHit(world, o, d, max),
        lineOfSight: (a, b) => world.line_clear(a.x, a.y, a.z, b.x, b.y, b.z),
        surfaceY: (x, z) => sim.surfaceY(Math.floor(x), Math.floor(z)),
        explode: (c, r, opts) => sim.explode(c, r, opts),
        carve: (point, dir, opts) => sim.carve(point, dir, opts),
        carved: (x, y, z) => 1 - world.damage_left(Math.floor(x), Math.floor(y), Math.floor(z)) / 4096,
        fits: (p) => world.player_fits(p.x, p.y, p.z),
        breakBlock: (x, y, z, opts) => sim.breakBlockAt(Math.floor(x), Math.floor(y), Math.floor(z), opts?.by ?? 'world'),
        placeBlock: (x, y, z, block, opts) => {
          const f = opts?.facing && FACING_DIR[opts.facing];
          const look = f ? { x: f[0], y: 0, z: f[1] } : undefined;
          return sim.placeBlockAt(Math.floor(x), Math.floor(y), Math.floor(z), block, opts?.by ?? 'world', { against: opts?.against, look, facing: opts?.facing });
        },
        blockInfo: (block) => {
          let d;
          try {
            d = reg.blocks[blockIdOf(reg, block)];
          } catch {
            return null;
          }
          if (!d) return null;
          const boxes = collisionBoxes(d);
          return {
            id: d.id,
            name: d.name,
            label: d.label,
            state: d.state,
            variant: d.key,
            solid: d.solid,
            liquid: d.shape === 'liquid',
            plant: d.small,
            replaceable: d.replaceable,
            light: d.emit,
            breakable: d.breakable,
            ...(d.hardness !== undefined && { hardness: d.hardness }),
            shape: blockShape(d),
            height: Math.max(0, ...boxes.map((b) => b[4])),
            boxes,
            climbable: !!d.climbable,
          };
        },
        collisionHeight: (x, y, z) => world.collision_top(Math.floor(x), Math.floor(y), Math.floor(z)),
        seaLevel: engine.sea_level(),
        get spawn() {
          return { ...sim.spawn };
        },
        set spawn(s) {
          sim.spawn = { x: s.x, y: s.y, z: s.z, yaw: s.yaw ?? 0 };
        },
      },
      players,
      player: local,
      store: this.makeStore(),
      entities: this.entities,
      items: this.items,
      hud: this.presentation.hud(null),
      fx: this.presentation.fx(null),
      audio: this.presentation.audio(null),
      camera: local.camera,
      input: local.input,
      props: this.props,
      bots: this.botApi(),
      clients: this.presentation.clients(),
      replay: this.replayApi(),
      env: {
        get time() {
          return sim.env.time;
        },
        set time(t: number) {
          sim.env.time = ((t % 1) + 1) % 1;
        },
        get frozen() {
          return sim.env.frozen;
        },
        set frozen(f: boolean) {
          sim.env.frozen = f;
        },
      },
      events: {
        on: (event, fn) => {
          let set = sim.listeners.get(event);
          if (!set) {
            set = new Set();
            sim.listeners.set(event, set);
          }
          const f = fn as (e: unknown) => void;
          set.add(f);
          return () => set!.delete(f);
        },
      },
      clock: {
        get now() {
          return sim.clockNow;
        },
        get total() {
          return sim.clockTotal;
        },
        after: (seconds, fn) => sim.addTimer(seconds, 0, fn),
        every: (seconds, fn) => sim.addTimer(seconds, seconds, fn),
      },
      rng: this.rng,
      commands: this.commands,
      room: this.o.room ?? 'public',
      restart: () => sim.restart(),
      exit: () => sim.o.exit(),
    };
  }

  /** `game.replay`: the host's history, played back on one player's screen. */
  private replayApi(): ReplayApi {
    const r = () => this.o.replay;
    return {
      get seconds() {
        return r()?.seconds ?? 0;
      },
      keep: (seconds) => r()?.keep(seconds),
      show: (player, opts) => r()?.show(player, opts ?? {}) ?? null,
      stop: (player) => r()?.stop(player.id),
      playing: (player) => r()?.playing(player.id) ?? null,
      clip: (opts) => r()?.clip(opts ?? {}) ?? null,
    };
  }

  private botApi(): BotApi {
    const sim = this;
    return {
      add: (name) => sim.addBot(name),
      remove: (bot) => sim.removeBot(bot),
      get all() {
        return sim.botList;
      },
    };
  }

  /** Built-in commands: `/help` always; the cheats when allowed. */
  private registerCommands() {
    const c = this.commands;
    c.register('help', {
      help: 'List commands',
      run: () =>
        c
          .list()
          .map(([n, s]) => `/${n}${s.usage ? ` ${s.usage}` : ''}${s.help ? `  ${s.help}` : ''}`)
          .join('\n'),
    });
    if (!this.o.cheats) return;
    const num = (v: string | undefined, name: string) => {
      const n = Number(v);
      if (v === undefined || v === '' || !Number.isFinite(n)) throw new Error(`Expected a number for ${name}`);
      return n;
    };
    const simOf = (id: string) => this.players.find((p) => p.id === id) ?? this.local;
    c.register('give', {
      usage: '<item> [count]',
      help: 'Put an item in your hand',
      complete: (args) => (args.length <= 1 ? this.items.ids() : []),
      run: ([id, n], _g, player) => {
        if (!simOf(player.id).itemMode) throw new Error('This game has no item hotbar');
        if (!id) throw new Error('Which item? Tab lists them');
        const def = this.items.get(id);
        if (!def) throw new Error(`Unknown item "${id}"`);
        const count = n === undefined ? 1 : Math.max(1, Math.floor(num(n, 'count')));
        const inv = player.inventory;
        const left = inv.give(id, count);
        if (left === count) throw new Error('Your hotbar is full');
        const slot = inv.slots.findIndex((st) => st?.item === id);
        if (slot >= 0) inv.select(slot);
        return `Gave ${count - left} ${def.name}`;
      },
    });
    c.register('achieve', {
      usage: '<achievement>',
      help: "Earn one of the game's achievements (to see it pop up; a signed-in player's is kept)",
      complete: (args) => (args.length <= 1 ? Object.keys(this.def.achievements ?? {}) : []),
      run: ([id], _g, player) => {
        if (!id || !this.def.achievements?.[id]) throw new Error(`Which achievement? ${Object.keys(this.def.achievements ?? {}).join(', ') || 'This game has none'}`);
        return player.achieve(id) ? `Earned ${this.def.achievements[id].title}` : `You have ${this.def.achievements[id].title} already`;
      },
    });
    c.register('heal', {
      help: 'Full health (revives you if dead)',
      run: (_, _g, player) => {
        if (!player.alive) player.revive();
        else player.health = player.maxHealth;
        return 'Healed';
      },
    });
    const times: Record<string, number> = { midnight: 0, dawn: 0.26, day: 0.35, noon: 0.5, dusk: 0.74, night: 0.85 };
    c.register('time', {
      usage: '<day|noon|dusk|night|midnight|0..1>',
      help: 'Set the time of day',
      complete: () => Object.keys(times),
      run: ([t], g) => {
        const v = t !== undefined && t in times ? times[t] : num(t, 'time');
        g.env.time = ((v % 1) + 1) % 1;
        return `Time set to ${t}`;
      },
    });
    c.register('tp', {
      usage: '<x> <y> <z>',
      help: 'Teleport (~ for relative, e.g. ~ ~10 ~)',
      run: (args, _g, player) => {
        if (args.length !== 3) throw new Error('Need x, y and z');
        const p = player.position;
        const [x, y, z] = args.map((a, i) => {
          const base = [p.x, p.y, p.z][i];
          return a.startsWith('~') ? base + (a.length > 1 ? num(a.slice(1), 'offset') : 0) : num(a, 'xyz'[i]);
        });
        player.teleport({ x, y, z });
        return `Teleported to ${x.toFixed(1)} ${y.toFixed(1)} ${z.toFixed(1)}`;
      },
    });
    c.register('spawn', {
      usage: '<entity> [count]',
      help: 'Spawn creatures in front of you',
      complete: (args) => (args.length <= 1 ? this.entities.typeNames() : []),
      run: ([type, n], g, player) => {
        if (!type || !this.entities.typeNames().includes(type)) throw new Error(type ? `Unknown entity "${type}"` : 'Which entity? Tab lists them');
        const count = n === undefined ? 1 : Math.min(50, Math.max(1, Math.floor(num(n, 'count'))));
        const p = player.position;
        const l = player.look;
        const len = Math.hypot(l.x, l.z) || 1;
        for (let i = 0; i < count; i++) {
          const a = (i / count) * Math.PI * 2;
          const x = p.x + (l.x / len) * 5 + (count > 1 ? Math.cos(a) * 1.5 : 0);
          const z = p.z + (l.z / len) * 5 + (count > 1 ? Math.sin(a) * 1.5 : 0);
          g.entities.spawn(type, { x, y: g.world.surfaceY(x, z) + 1, z });
        }
        return `Spawned ${count} ${type}`;
      },
    });
    c.register('kill', {
      help: 'Kill every creature',
      run: (_, g) => {
        const all = g.entities.all();
        for (const e of all) e.damage(1e9, { source: 'world', knockback: 0 });
        return `Killed ${all.length}`;
      },
    });
    c.register('fly', {
      help: 'Toggle flight (double-tap Space)',
      run: (_, _g, player) => {
        const p = simOf(player.id);
        p.allowFlight = !p.allowFlight;
        if (!p.allowFlight) this.host.world.set_flying(p.slot, false);
        return p.allowFlight ? 'Flight on' : 'Flight off';
      },
    });
  }
}
