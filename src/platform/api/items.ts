import type { Actor, AudioApi, DamageCause, Entity, GameContext, GameEvents, ItemBase, ItemDefinition, Player, Vec3 } from './types';

/**
 * An item kit as a game lists it (`defineServer(shared, { items: [throwables(), guns(RULES),
 * melee()] })`): it starts one `ItemKind` for each running game, with that game's `ItemHost`, so
 * whatever the kind keeps (things in flight, each player's cooldown) is that game's alone. Don't
 * call the game from here: it isn't set up yet (keep `host`, and ask `host.game` later).
 */
export type ItemKit<K extends ItemKind = ItemKind> = (host: ItemHost) => K;

/**
 * What items of one kind do on the host, in one game: an **item kit**'s server half (see
 * `ItemKit`). An item names its `kind` (`game.items.define('rifle', { kind: 'gun', … })`); the
 * game lists the kits it uses, and each one's kind makes its items work. Game code reaches a
 * running kind with `game.items.kind('gun')` (the platform's kits have typed helpers:
 * `guns.of(game)`). The platform knows no kinds: an item whose kind no listed kit makes does nothing (it's
 * carried, dropped, picked up and given; a `misc` item). The platform's own kits are in
 * `@platform/kits` (`melee`, `bows`, `guns`, `throwables`, `consumables`), each written with this
 * API alone, so a game can copy one into its folder and change it, or write its own.
 *
 * Each step, every player's kinds run in the order the game lists them (`step`), after the hotbar
 * slot is chosen (the wheel, 1 to 9). A kind that uses a control the kinds after it mustn't see
 * `consume`s it (a throwable cooking claims the fire button, so the gun in hand doesn't fire).
 *
 * A kind can also run ahead of the host on the holder's own screen: its client half (a `ClientKit`
 * with its `kind`) acts at once (fires, throws) and sends what it did with the controls; the host
 * takes each action in `acts` if it could have happened, and decides what came of it. Without a
 * client half, the host plays the kind from the controls (bots always are).
 */
export interface ItemKind<D extends ItemBase = any, S extends object = any> {
  /** The `kind` its items name. */
  readonly kind: string;
  /** Most of one in a hotbar slot, unless the item says (`stack`). Default 64. */
  stack?: number;
  /**
   * In hand, one of these takes the mouse buttons (a gun fires, a bow draws): a bare fist's kit
   * leaves them alone then (`ItemView.hand.holds`).
   */
  holds?: boolean;
  /**
   * A better one (higher `rank`) takes the place of a worse one of this kind when the hotbar is
   * full, and is taken in hand when picked up (Minecraft's weapons).
   */
  upgrades?: boolean;
  /**
   * The state of a carried one, per player (a gun's rounds): plain data, made when it's first
   * needed, and forgotten once none is carried (given again, it starts afresh). Read it with
   * `inventory.state(item)`; the holder's screen gets the held one's (`shown`).
   */
  state?(def: D, item: string): S;
  /** One step for one player (every player, every step, whether they hold one or not). */
  step?(use: ItemUse<D, S>): void;
  /** One of this kind went into their hand (`held`), or out of it (a gun comes up; a reload stops). */
  equip?(use: ItemUse<D, S>, item: string, held: boolean): void;
  /**
   * What holding one does to how they move this step: a gun's weight, aiming slows, firing stops
   * sprinting. Pure (the holder's screen runs the same function to predict their movement).
   */
  move?(def: D, controls: ItemMoveControls): ItemMove | null;
  /**
   * What their own screen gets each frame from this kind (the client half's `me.items[kind]`): a
   * throw's serial, a sword's readiness. Plain data, small.
   */
  own?(use: ItemView<D, S>): object | null;
  /**
   * What everyone's screen gets of the held one (on their figure, `hand.state`): a gun's rounds,
   * its aim, a reload. Plain data, small.
   */
  shown?(use: ItemView<D, S>, item: string, state: S | null): object | null;
  /** Once a step for the whole game, before the players' `step`s (things in flight, fires). */
  update?(host: ItemHost, dt: number): void;
  /**
   * They died or the game restarted: whatever the kind keeps of theirs starts afresh. `whole`: a
   * new person has their place (a new screen, which counts its actions from the start).
   */
  reset?(player: Player, whole: boolean): void;
  /** The game restarted: everything in flight is gone. */
  clear?(): void;
}

/** A carried item of a kind, as its kit sees it. */
export interface ItemHeld<D extends ItemBase = ItemBase, S extends object = object> {
  readonly item: string;
  readonly def: D;
  /** Its state (`ItemKind.state`), or null for a kind with none. */
  readonly state: S | null;
}

/** The controls a kind's `move` reads: mouse buttons held (bit 0 the left, 1 the middle, 2 the right). */
export interface ItemMoveControls {
  buttons: number;
}

/** What holding an item does to movement this step (`ItemKind.move`). */
export interface ItemMove {
  /** Times walking, sprinting and crouching speed (1). */
  speed?: number;
  /** No sprinting. */
  noSprint?: boolean;
}

/** The controls a kind reads this step: as `InputApi`, and whether they reach the items at all. */
export interface ItemControls {
  /** The controls are live (a person at the screen, or a bot), and the items aren't locked. */
  readonly active: boolean;
  /** A weapons-locked freeze (`freeze(true, { weapons: true })`): nothing may fire or throw, and their screen's actions are turned down. */
  readonly locked: boolean;
  isDown(code: string): boolean;
  pressed(code: string): boolean;
  button(b: number): boolean;
  buttonPressed(b: number): boolean;
  /** Claim a key or button for the rest of the step: the kinds after this one see it idle. */
  consume(what: number | string): void;
}

/** A player as their kinds see them now (see `ItemUse`). */
export interface ItemView<D extends ItemBase = ItemBase, S extends object = object> {
  readonly player: Player;
  /** The held item if it's this kind. */
  readonly held: ItemHeld<D, S> | null;
  /**
   * What's in their hand, whatever its kind (null: nothing), and whether its kind takes the mouse
   * buttons (`ItemKind.holds`): a bare fist's kit swings with anything else in hand.
   */
  readonly hand: { readonly item: string; readonly def: ItemDefinition; readonly holds: boolean } | null;
}

/** One step of a kind for one player (`ItemKind.step`, `equip`). */
export interface ItemUse<D extends ItemBase = ItemBase, S extends object = object> extends ItemView<D, S> {
  readonly game: GameContext;
  readonly host: ItemHost;
  /** Seconds this step (0 while the game's paused). */
  readonly dt: number;
  /** Host time (seconds). */
  readonly now: number;
  readonly controls: ItemControls;
  /**
   * Their screen's actions for this kind since the last step, each a list of plain values its
   * client half sent (see `ClientKit.controls`): take each that could have happened. Null when
   * their screen doesn't run this kind's client half (bots, a screen without it): then the kind
   * acts from the controls itself.
   */
  readonly acts: readonly (readonly unknown[])[] | null;
  /** Every carried item of this kind, in hotbar order. */
  carried(): ItemHeld<D, S>[];
  /** Falling (for critical hits). */
  readonly falling: boolean;
  /** Horizontal speed as a fraction of walking speed (a gun's spread). */
  readonly moving: number;
  /** 0 standing, 1 crouched, 2 as low as a slide. */
  readonly stance: 0 | 1 | 2;
  /**
   * A bullet's path from `from` along `dir` (unit), up to `range`: the first body it meets or solid
   * block, through foliage and, with `penetration`, through walls (see `Penetration`). With
   * `rewind` (for an action their screen sent), bodies are where that screen showed them when it
   * acted, as far back as the game's `hitscan.rewind` allows (lag compensation).
   */
  hitscan(from: Vec3, dir: Vec3, range: number, opts?: { penetration?: Penetration | null; rewind?: boolean }): HitscanHit;
  /**
   * Their arm swings, on their screen (the first-person view's `use` or `swing` event, `power`
   * scaling it) and on their figure for everyone. Anything else a kit shows its client half is a
   * message (`host.send`).
   */
  swing(how: 'use' | 'swing', power?: number): void;
  /** Their screen's hit marker (a hit, a critical or head hit, a kill). */
  hitMarker(kind: boolean | 'kill'): void;
}

/** How a bullet goes through walls (`ItemUse.hitscan`). */
export interface Penetration {
  /** Solid blocks' total thickness it can go through (blocks). */
  depth: number;
  /** Its damage lost per block gone through, 0..1 (see `HitscanHit.through`). */
  loss: number;
}

/** Where a bullet ended (`ItemUse.hitscan`). */
export interface HitscanHit {
  point: Vec3;
  /** The face it hit (a block's), or null (a body, or nothing within range). */
  normal: Vec3 | null;
  /** The block it stopped at (-1: none). */
  block: number;
  dist: number;
  /** Who it hit, if anyone, and whether in the head. */
  target: Player | Entity | null;
  head: boolean;
  /** Blocks' thickness it went through first (0..1 of the damage it's lost: see `Penetration.loss`). */
  through: number;
  /** The walls it went through, in order: where in, the face, where out, the face out, the block. */
  walls: { entry: Vec3; normal: Vec3; exit: Vec3; out: Vec3; block: number }[];
}

/** Everyone a blast, a fire or a thrown thing can meet: a body's feet, height and width (`ItemHost.bodies`). */
export interface ItemBody {
  target: Player | Entity;
  feet: Vec3;
  height: number;
  width: number;
}

/**
 * What the platform gives item kits on the host beyond the game's API (`ItemUse.host`,
 * `ItemKind.update`): the whole game, and the pieces of the simulation items are made of.
 */
export interface ItemHost {
  readonly game: GameContext;
  /** Players' weapons hurt other players (the game's `player.pvp`). */
  readonly pvp: boolean;
  /** The world's blocks can be carved (`world.destructible`: `world.carve` takes bits out of them). */
  readonly carves: boolean;
  /** Everyone who can be hurt now: living players and creatures, as boxes. */
  bodies(): ItemBody[];
  /**
   * The first solid block along a ray (through plants, torches and anything bodies walk
   * through; a carved block or a slab where it really is): how far, and its face. Null within `max`.
   */
  solid(from: Vec3, dir: Vec3, max: number): { dist: number; normal: Vec3 } | null;
  /**
   * Hurt everyone within `reach` of `center` (not behind a wall from it): `near` at the middle down
   * to `far` at the edge, thrown back by `knockback` (less further out), from `by`, with `weapon`.
   */
  blast(center: Vec3, opts: { reach: number; near: number; far: number; knockback?: number; by?: Actor; weapon?: string; cause?: DamageCause }): void;
  /** A message to screens (`client.on`): everyone's, one player's (`to`), or everyone's but `except`'s (their screen showed it already). Replays keep it. */
  send(name: string, data: unknown, opts?: { to?: Player; except?: Player }): void;
  /** Sounds for everyone, or everyone but `except` (their screen played it already). */
  audio(opts?: { except?: Player }): AudioApi;
  /** Tell the game (its `events.on` listeners): a shot, say. */
  emit<K extends keyof GameEvents>(event: K, e: GameEvents[K]): void;
  /** Host time (seconds): what `ItemUse.now` says. */
  now(): number;
  /**
   * Their figure swings its arm, for everyone (a throw); with `view`, their own first-person arm
   * too (the `use` or `swing` event on their screen, `power` scaling it).
   */
  swing(player: Player, view?: 'use' | 'swing', power?: number): void;
  /** Run game code (a `damage` listener) so that an error in it doesn't stop the step. */
  guard(fn: () => void): void;
}
