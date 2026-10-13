import type * as THREE from 'three';
import type { ItemMove, ItemMoveControls, Penetration } from '../items';
import type { Acoustics, ClientLoop, ItemDefinition, ItemLook, LoopVoice, SharedDefinition, SoundName, SynthVoice, Vec3 as PlainVec3 } from '../types';
import type { ViewLayer } from './view';
import type { ClientFigures } from './figures';
import type { ClientHud } from './hud';

/**
 * Something drawn, or a group of things: a three.js `Object3D` as far as a game's client code
 * sees it (it never imports three.js). Positions, turns and sizes use the platform's math types
 * (`@platform/client/math`).
 */
export type Node = Pick<THREE.Object3D, 'position' | 'quaternion' | 'scale' | 'rotation' | 'visible' | 'renderOrder' | 'name' | 'updateMatrixWorld' | 'matrixWorld'> & {
  /** Hang nodes from this one (taken from wherever they hung before). */
  add(...nodes: Node[]): Node;
  remove(...nodes: Node[]): Node;
  readonly children: Node[];
  readonly parent: Node | null;
};

/** A kit: a piece of a game's client behaviour (what a first-person gun looks like, a HUD panel). */
export interface ClientKit {
  readonly name: string;
  /**
   * Once, when the game's client starts: at the first frame this screen shows the game, watching
   * from the home page or playing (so looks and voices are ready for what it shows either way).
   */
  setup?(client: Client): void;
  /** Every frame, in the order the kits are listed, before the game's own `frame`. */
  frame?(client: Client, dt: number): void;
  /**
   * Every frame after every kit's `frame` and the game's, once the world's effects (particles,
   * tracers, flares) have moved on by this frame's time and just before drawing: what's made here
   * is drawn where it starts (a shot fired this frame: its tracer leaves the muzzle as the hand
   * is drawn). `client.events` has this frame's shots by now (`bullets`, ours).
   */
  late?(client: Client, dt: number): void;
  /** When the game's client stops (switching games). */
  dispose?(): void;
  /**
   * The kind of item this kit is the screen half of (`ItemKind.kind` on the host: `'gun'`). Its
   * actions (`controls`' `act`) go to that kind's host half with the controls, and it says what
   * client code sees of the kind (`own`, `heldState`, `figureSignals`).
   */
  readonly kind?: string;
  /**
   * Every frame before this frame's controls go to the host (after the look, before movement is
   * predicted): act on them ahead of the host (a gun fires, a throwable's cooked and thrown). See
   * `KitControls`: the controls, `consume`, `act`, turning the view.
   */
  controls?(client: Client, c: KitControls, dt: number): void;
  /**
   * A controller's stick (or a finger on the touch controls), turning the view this frame (the
   * player's aim assist setting on): slow it (over a target), and turn the view with what it
   * follows (radians). Null: nothing.
   */
  stick?(client: Client): { slow?: number; yaw?: number; pitch?: number } | null;
  /** What holding one of its kind does to movement: its host half's `move`, the same function (movement is predicted). */
  move?(def: ItemDefinition, controls: ItemMoveControls): ItemMove | null;
  /**
   * What client code sees of its kind for the local player (`client.me.items[kind]`), given the
   * host's word (its `own`, null before any): a throw's count less those still going, one being
   * cooked. Default: the host's word.
   */
  own?(client: Client, host: object | null): object | null;
  /**
   * The held item's state for client code (`client.me.held.state`), when one of its kind is in
   * hand: as this screen predicts it (a gun's rounds, aim, spread), or, in a replay, from
   * `client.me.hand.state` (the host's word on the followed player's).
   */
  heldState?(client: Client, item: string, def: ItemDefinition | undefined): Record<string, unknown> | null;
  /**
   * An item this kit puts in the first-person hand in place of the hotbar's (a grenade being
   * cooked by its key, and the throw's follow-through), or null.
   */
  handItem?(client: Client): string | null;
  /**
   * What an item of its kind in a figure's hand makes the figure do, from the item's state as
   * the host shows it (its `shown`): aimed where it looks, how far down the sights, reloading.
   */
  figureSignals?(state: object | null, def: ItemDefinition): FigureSignals | null;
}

/** What a held item makes its figure do (`ClientKit.figureSignals`): see `FigureState`. */
export interface FigureSignals {
  /** It's aimed where the figure looks, 0..1. */
  aim?: number;
  /** Looking down its sights, 0..1. */
  sights?: number;
  /** Its mechanics are busy with it (a reload). */
  reloading?: boolean;
}

/**
 * The controls this frame, as a kit acting ahead of the host reads them (`ClientKit.controls`):
 * idle while this screen doesn't have the controls (paused, dead, driving), and anything a kit
 * `consume`s reads idle to the kits after it.
 */
export interface KitControls {
  /** This screen has the controls (in play, alive, not driving). */
  readonly active: boolean;
  /** They're dead, as the newest frame has it (`client.me` catches up after the controls): what's cooked in hand falls. */
  readonly dead: boolean;
  /** Where the view looks now (radians), this frame's look taken: what a shot fired now goes along. */
  readonly yaw: number;
  readonly pitch: number;
  isDown(code: string): boolean;
  /** A key that went down this frame. */
  pressed(code: string): boolean;
  /** A mouse button held (0 left, 1 middle, 2 right; a controller's triggers too), or clicked this frame. */
  button(b: number): boolean;
  clicked(b: number): boolean;
  /** Claim a key or button for the rest of this frame: the kits after this one see it idle. */
  consume(what: number | string): void;
  /** Send an action of its kind to the host with these controls (its host half's `use.acts`): plain values (numbers, short strings, booleans). */
  act(data: unknown[]): void;
  /** Turn the view (radians; up is positive): a gun's recoil. */
  turn(pitch: number, yaw: number): void;
}

/** What a game does on each player's screen, beyond its shared definition (`defineClient`). */
export interface ClientDefinition {
  /** The kits it uses, in the order they run each frame. */
  kits?: ClientKit[];
  /** Once, after the kits' `setup`, when this screen starts showing the game (watching or playing): define looks and voices, listen for messages. */
  setup?(client: Client): void;
  /** Every frame, after the kits (after prediction, before rendering). */
  frame?(client: Client, dt: number): void;
  /** Every frame, after the kits' `late` (see `ClientKit.late`). */
  late?(client: Client, dt: number): void;
}

/** The local player's held item, as this screen has it (predicted). */
export interface MeHeld {
  item: string;
  def: ItemDefinition | undefined;
  /** The item's state for client code, as its kind's kit gives it (`ClientKit.heldState`: a gun's rounds, aim, spread). */
  state: Record<string, unknown>;
}

/** The local player, as this screen predicts and shows it. */
export interface Me {
  readonly id: string | null;
  readonly position: PlainVec3;
  readonly velocity: PlainVec3;
  /** Where they look (radians; yaw 0 looks toward -z). */
  readonly look: { yaw: number; pitch: number };
  readonly onGround: boolean;
  readonly flying: boolean;
  readonly crouching: boolean;
  readonly sprinting: boolean;
  readonly sliding: boolean;
  readonly dead: boolean;
  readonly inVehicle: boolean;
  readonly health: number;
  readonly maxHealth: number;
  /** The walk cycle's phase (radians) and how much it shows (0..1, 0 when still or airborne). */
  readonly bob: { phase: number; amount: number };
  /** The camera is behind them (`camera.orbit`), not at their eyes. */
  readonly thirdPerson: boolean;
  /** How fast they walk (blocks a second): the game's movement's. */
  readonly walkSpeed: number;
  /** The hotbar (a game with items), as the host has it. */
  readonly hotbar: { readonly slots: readonly ({ item: string; count: number } | null)[]; readonly selected: number } | null;
  /** What's in hand: the hotbar's item and count, and its state as the host shows it (its kind's `shown`). */
  readonly hand: { item: string | null; count: number; state: object | null };
  /** The held item as its kind's kit has it on this screen (`ClientKit.heldState`), or null. */
  readonly held: MeHeld | null;
  readonly abilities: Record<string, Record<string, number | boolean>>;
  /** Each kind of item's word on the local player, by kind (`items.melee.strength`, `items.throwable.cooking`): its kit's `own`, else the host's. */
  readonly items: Readonly<Record<string, any>>;
}

/**
 * Something that happened this frame, on this screen or from the server: the kits react (an arm
 * swings, a sound plays). Each event type is an entry of `ClientEvents`, which kits add to with
 * their own (`declare module '@platform/client' { interface ClientEvents { … } }`): the gun kit's
 * `shot` and `bullets`, the throwable kit's `thrown`. `client.emit` sends one to every kit.
 */
export type ClientEvent = { [K in keyof ClientEvents]: { t: K } & ClientEvents[K] }[keyof ClientEvents];

/** The events, by type (see `ClientEvent`): the platform's own; kits add theirs. */
export interface ClientEvents {
  /** A message from the game's server that client code hasn't taken with `on`. */
  message: { name: string; data: unknown };
  /** Their arm swings on this screen (the host's `swing`, `player.viewModel`): using what's in hand, or swinging. */
  use: { power: number };
  swing: { power: number };
  /** The view's arm jolts (being hit). */
  kick: { strength: number };
  /** What's in hand changed. */
  equip: { item: string | null };
  /** They landed, falling this fast (blocks a second). */
  land: { vy: number };
  /** The server's calls to this player's view (`player.viewModel`). */
  'view.play': { anim: string; power: number; speed: number };
  'view.visible': { visible: boolean };
  'view.setSkin': { skin: [number, number] | null; atlas?: string };
  /** The game restarted: what the kits put on screen goes. */
  reset: {};
  /** A replay started on this screen (`client.replay`): `client.me` is now whoever it follows. */
  'replay.start': { label: string; follow: string | null; data: unknown };
  /** It ended: played out, ended by the server, or skipped here (`skipped`). `client.me` is this player again. */
  'replay.end': { label: string; skipped: boolean };
}

/**
 * A replay playing on this screen (the game's server showed one: `game.replay.show`): a stretch of
 * the last few seconds, drawn in place of the live game (which goes on underneath) with the same
 * figures and interpolation, through a player's eyes or from a camera of its own.
 *
 * While it plays, `client.me` is the player it follows as the replay shows them (their look, what
 * they hold, their gun as it was: a first-person kit draws their hands), and the events are theirs
 * (their shots, `mine`). The live HUD steps aside (the platform's panels and the game's widgets);
 * client code's own layers stay, for it to show what it likes (say whose eyes these are) and hide
 * what's the live player's own.
 */
export interface ClientReplay {
  /** A replay is playing. */
  readonly playing: boolean;
  /** Its number (0 when none is playing). */
  readonly id: number;
  /** Whose eyes it looks through (a player's id), or null for a camera of its own. */
  readonly follow: string | null;
  /** The game's name for it (`label`) and what it sent with it (`data`). */
  readonly label: string;
  readonly data: unknown;
  /** Seconds into it and how long it lasts, as played (at its speed, its `hold` first). */
  readonly time: number;
  readonly duration: number;
  readonly speed: number;
  /**
   * Seconds its first frame stands still before it plays (`ReplayOptions.hold`): while `time` is
   * under it, a freeze-frame. Client code may take the camera then (`client.camera.take`): the
   * player it follows is drawn while it's taken, to be looked at.
   */
  readonly hold: number;
  /** Its viewer may end it early. */
  readonly skippable: boolean;
  /**
   * End it on this screen, if it's skippable: as the next frame starts (`replay.end` comes then,
   * `skipped`), and the server hears (its `onEnd` runs with `skipped`).
   */
  skip(): void;
}

/** The world's camera, as client code may change it. */
export interface ClientCamera {
  /** How much the view is zoomed (1 none; 1.5 narrows the field of view 1.5 times): aiming down the sights. */
  zoom: number;
  /** The field of view as drawn (degrees, vertical). */
  readonly fov: number;
  /** Where it is this frame, before any shake (world space). */
  readonly position: PlainVec3;
  /** A point in the camera's own space (x right, y up, looking down -z) in the world, as it's placed this frame (before any shake). */
  toWorld(local: PlainVec3): PlainVec3;
  /**
   * Take the world camera (a fly-over, a cutscene): from this frame on it's drawn from `position`,
   * looking at `target` (and with `fov`, degrees, if given) instead of from the player's own
   * camera, which goes on underneath (they still look round, and walk if they're free to). Call it
   * every frame to move it. What's in first person is hidden while it's taken, and the world
   * loads round the camera. Only this screen's view: the game's server knows nothing of it.
   */
  take(pose: { position: PlainVec3; target: PlainVec3; fov?: number }): void;
  /** Give the view back: it eases from the last pose taken into the player's own camera over `ease` seconds (default 1; 0: at once). */
  release(ease?: number): void;
  /** Client code has the camera (`take`), or it's still easing back. */
  readonly taken: boolean;
}

/** Effects in the world, on this screen only. */
export interface ClientFx {
  explosion(at: PlainVec3, opts?: { size?: number; color?: string }): void;
  burst(at: PlainVec3, opts?: { color?: string; count?: number; speed?: number; size?: number; gravity?: number; glow?: number; life?: number; drag?: number }): void;
  shake(strength: number, duration?: number): void;
  flash(color: string, strength?: number, duration?: number): void;
  shockwave(at: PlainVec3, radius: number, color?: string): void;
  /**
   * A shot's streak racing from `from` to `to`: by default a bullet's (a thin line 5 blocks long at
   * 360 blocks a second, 0.06 across, glowing 6 times its colour); `speed` (blocks a second),
   * `length` and `width` (blocks) and `glow` make it something else (a blaster's bolt:
   * `{ speed: 140, length: 2, width: 0.13 }`, slow enough to watch fly; a lower `glow` keeps a
   * colour deep rather than white-hot).
   */
  tracer(from: PlainVec3, to: PlainVec3, color?: string, opts?: { speed?: number; length?: number; width?: number; glow?: number }): void;
  impact(at: PlainVec3, normal: PlainVec3 | null, color: [number, number, number], body?: boolean, mark?: boolean): void;
  /** A hot glow for a moment (a few hundredths of a second), facing the camera: `size` blocks across. */
  flare(at: PlainVec3, size?: number): void;
  /**
   * Particles, with every knob: `color` in linear RGB; `spread` (how far round `at` they start),
   * `up` (an extra push upward), `velocity` (blocks a second every one of them starts with, on top
   * of its random push: dust on the wind), `glow` (emissive), `collide` (they stop on blocks).
   */
  particles(at: PlainVec3, color: [number, number, number], opts?: { count?: number; speed?: number; size?: number; gravity?: number; glow?: number; life?: number; spread?: number; up?: number; velocity?: PlainVec3; drag?: number; collide?: boolean }): void;
  damageNumber(at: PlainVec3, amount: number, opts?: { crit?: boolean; color?: string }): void;
  fireworks(at: PlainVec3, count?: number): void;
}

/** Sounds on this screen. */
export interface ClientAudio {
  play(name: SoundName, opts?: { at?: PlainVec3; volume?: number; pitch?: number }): void;
  /**
   * A voice of the game's own (synthesised on each play, with real Web Audio: nothing is recorded
   * or sent), under a name `play` uses: here, the server's `audio.play`, and items' `sounds`. Define
   * them in `setup` (a kit's, then the game's: a later one of the same name replaces the earlier).
   * `reverb` is how much of the acoustics' reverb it takes (1 = all of it; 0 = none: a HUD's beep).
   */
  define(name: string, voice: SynthVoice, opts?: { reverb?: number }): void;
  /**
   * A continuous sound (a blade's hum, the wind, an engine): one of the game's (`defineLoop`) or
   * the platform's (`engine`, `wind`), everywhere or at a spot. Its handle moves it, changes its
   * pitch and loudness, and stops it; stop it when it's done (a kit's `dispose`). Silent until
   * sound starts on this screen, then it plays as last `set`.
   */
  loop(name: string, opts?: { at?: PlainVec3; volume?: number; pitch?: number }): ClientLoop;
  /** A continuous sound of the game's own, under a name `loop` uses: steady tones and noise. */
  defineLoop(name: string, voice: LoopVoice): void;
  /** How the world sounds from now on: distance muffling, the space's reverb (`Acoustics`). */
  acoustics(a: Acoustics): void;
  /**
   * The player's music volume (0..1; Settings → Sound in the pause menu): a game's music plays at
   * it (its plays' and loops' volume times this), and stops at 0. Read it as the music plays: the
   * player may change it at any time.
   */
  readonly music: number;
}

/**
 * Items on this screen: how they look and sound (the game's client code gives that), and their
 * definitions as this screen reads them (the server's, with the looks over them).
 */
export interface ClientItems {
  /**
   * How an item looks and sounds on this screen (`ItemLook`: its icon, its hold and model, its
   * sounds, a gun's tracer, a throwable's trail, its shown name). Each field given goes over the
   * server's definition (`sounds` sound by sound) wherever this screen reads the item:
   * `client.item(id)`, `me.held.def`, the model in hand, the hotbar, pickups on the ground, other
   * players' figures, `{ item }` icons, and the kits. Call it in `setup`, before anything's shown;
   * an item the server defines later takes its look when it comes.
   */
  look(id: string, look: ItemLook): void;
  /** An item as this screen has it (the same as `client.item(id)`). */
  get(id: string): ItemDefinition | undefined;
}

/** The controls, read for feel (the game acts on the controls on its server). */
export interface ClientInput {
  isDown(code: string): boolean;
  /** A mouse button held (0 left, 1 middle, 2 right; a controller's triggers too). */
  button(b: number): boolean;
  /** What was used last: a keyboard and mouse, a controller, or the touch controls (a phone or tablet). */
  readonly device: 'mouse' | 'pad' | 'touch';
  /** The player's aim assist setting is on (it helps a controller's stick and the touch controls only: `ClientKit.stick`). */
  readonly assist: boolean;
  /** A controller's sticks are moving (tilted, or walking), or a finger's moving or looking: aim assist follows a target only then. */
  readonly sticksMoving: boolean;
  /** Rumble a controller in use: its strong and weak motors (0..1 each), for `ms`; if the player's vibration setting is on. */
  rumble(strong: number, weak: number, ms: number): void;
}

/** The world as this screen has it, to look at (never to change). */
export interface ClientWorld {
  /** The block's name at a position (`'air'` where nothing is, or its chunk isn't here). */
  blockAt(x: number, y: number, z: number): string;
  /** The first solid block along a ray (`dir` of length 1) within `max` blocks: how far, and the face it meets. */
  raycast(from: PlainVec3, dir: PlainVec3, max: number): { distance: number; normal: PlainVec3 } | null;
  /** Nothing solid between two points (as the host's `world.lineOfSight`). */
  lineOfSight(a: PlainVec3, b: PlainVec3): boolean;
  /**
   * A bullet's path on this screen, as the host casts it (`ItemUse.hitscan`): through foliage and,
   * with `penetration`, walls, to the first block or player drawn in the way (by the game's
   * hitboxes, `hitscan`), within `range`. `body`: the player it met.
   */
  trace(from: PlainVec3, dir: PlainVec3, range: number, opts?: { penetration?: Penetration | null }): ClientTrace;
  /** A block's average colour (linear RGB), for chips of it. */
  blockColor(block: number): [number, number, number];
  /** A hit at `at` on `block` (its face `normal`) would carve it (a world whose blocks carve, `world.destructible`). */
  carvable(block: number, at: PlainVec3, normal: PlainVec3 | null): boolean;
}

/** Where a traced bullet ended on this screen (`ClientWorld.trace`). */
export interface ClientTrace {
  point: PlainVec3;
  /** The face it met (a block's), or null. */
  normal: PlainVec3 | null;
  /** The block it stopped at (-1: none). */
  block: number;
  /** The player it met (their id), or null. */
  body: string | null;
  /** The walls it went through first: where in, the face, where out, the face out, the block. */
  walls: { entry: PlainVec3; normal: PlainVec3; exit: PlainVec3; out: PlainVec3; block: number }[];
}

/** Things this screen puts in the world itself (never on the server, never on anyone else's screen). */
export interface ClientScene {
  /** A group to put things in (`add` it to the world). */
  node(): Node;
  /** Into the world, lit and shadowed as figures are. */
  add(node: Node): void;
  remove(node: Node): void;
  /**
   * An item's look as a mesh (not in the world yet): its model (glTF or boxes) or its sprite
   * pressed flat, `center` its middle in its own space. Null while its model's file is coming.
   */
  item(id: string): { node: Node; center: PlainVec3; form: 'model' | 'sprite' } | null;
}

/**
 * The services client code gets. Each part of the platform's presentation adds its own here, in
 * its own section (the view, figures, the HUD; the camera, effects, sounds, controls, the world).
 */
export interface ClientServices {
  /** The first-person layer: what's in hand and the player's own arms. */
  readonly view: ViewLayer;
  /** Players' and creatures' figures as drawn. */
  readonly figures: ClientFigures;
  /** The HUD: the game's own layers and the platform's panels. */
  readonly hud: ClientHud;
  readonly camera: ClientCamera;
  readonly fx: ClientFx;
  readonly audio: ClientAudio;
  /** Items' looks on this screen (`client.items.look`). */
  readonly items: ClientItems;
  readonly input: ClientInput;
  readonly world: ClientWorld;
  // First person.
  // Figures.
  // HUD and effects.
  /** Things this screen puts in the world itself. */
  readonly scene: ClientScene;
  /** A replay playing on this screen (see `ClientReplay`). */
  readonly replay: ClientReplay;
}

/** A game's code on each player's screen. */
export interface Client extends ClientServices {
  /** The game's shared definition. */
  readonly shared: SharedDefinition;
  readonly me: Me;
  /** This frame's events (cleared after the game's `frame`). */
  readonly events: readonly ClientEvent[];
  /** An event for every kit and the game's code, this frame (a kit's own: `ClientEvents`). */
  emit(event: ClientEvent): void;
  /** Seconds this screen has run the game. */
  readonly time: number;
  /** The game is under way (its server's `start` has run): what moves there moves here. */
  readonly running: boolean;
  /** An item as this screen has it: the server's definition, with its look (`client.items.look`) over it. */
  item(id: string): ItemDefinition | undefined;
  /** The game's own messages from its server (`game.clients.send`). */
  on(name: string, fn: (data: unknown) => void): void;
  /** A message to the game's server (`game.events.on('clientMessage')`); the server checks it. */
  send(name: string, data: unknown): void;
}

/** The game on each player's screen (`client.ts`). */
export interface ClientGame {
  readonly shared: SharedDefinition;
  readonly client: ClientDefinition;
}
