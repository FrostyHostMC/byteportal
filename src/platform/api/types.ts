/**
 * Public game API.
 *
 * A game is a `GameDefinition`: plain data describing the world and player rules, plus a few
 * lifecycle hooks that receive a `GameContext`. Everything a game can do goes through the
 * context. Games never touch the renderer, workers or WebAssembly directly, which keeps them
 * small and makes it possible to run game logic on a server later.
 */

import type { Quaternion as MathQuaternion, Vector3 as MathVector3 } from 'three';
import type { Blueprint } from './blueprint';
import type { Uniform } from '../character/look';
import type { ItemKind, ItemKit } from './items';

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

// ---------------------------------------------------------------------------------------------
// Game definition
// ---------------------------------------------------------------------------------------------

/**
 * What the launcher lists about a game: small, and all a browser loads of a game until someone
 * picks it (`src/games/<id>/meta.ts`).
 */
export interface GameMeta {
  /** Stable identifier, used in the URL (`?game=arena`) and for saves. */
  id: string;
  title: string;
  /** One line shown under the title in the launcher. */
  tagline?: string;
  /** Accent colour for the launcher card (CSS colour). */
  accent?: string;
  /**
   * The launcher card's picture, 16:9 (about 960×540, a WebP or JPEG under 100 KB): a shot of the
   * game that reads as it at a glance, with no HUD and no title (the launcher writes the title over
   * its lower left). `import cover from './cover.webp?url'`, then `cover`. It also shows, blurred,
   * behind the home page while the game's world loads.
   */
  cover?: string;
  /** Control hints for the title screen, e.g. `[['LMB', 'attack']]` (movement keys are always shown). */
  controls?: [string, string][];
  /**
   * Controllers: what each button does, over the platform's layout (see `PadAction`; `A` jump,
   * `B` crouch, `X` R, `Y` / `RB` next slot, `LB` previous, `LT` right mouse, `RT` left mouse,
   * `L3` sprint, `R3` middle mouse, `View` Tab, `Menu` pause, D-pad ↑ E, ↓ F, ← → slots). A
   * controller drives the same keys and mouse buttons the keyboard and mouse do, so a game reads
   * them all the same way; its hints on the home page come from `controls` (the entry for the
   * key a button presses), or give one: `{ Up: ['KeyL', 'loadout'] }`.
   */
  gamepad?: Partial<Record<PadButton, PadAction | [PadAction, string]>>;
  /**
   * Touch controls (phones and tablets): a stick to move (pushed all the way ahead, it sprints),
   * the rest of the screen to look, and buttons for the controller layout's jobs (`gamepad`), named
   * as it names them: the triggers' as big buttons in the right thumb's reach (a finger on fire or
   * aim turns the view too), the face buttons' round them, the D-pad's up the right edge. The
   * hotbar's slots are tapped. Change a button here, over `gamepad` (as `gamepad` does, with a
   * key or `[key, label]`), or leave one off a touch screen with null: `touch: { Up: null }`.
   */
  touch?: Partial<Record<PadButton, PadAction | [PadAction, string]>>;
  /**
   * Players can start a game of their own on a server (just them, or friends they send the link
   * to) instead of joining the public one: each such game is a separate copy with its own world,
   * and the home page offers both. For match games (Bed Wars, the Arena); leave it off for one
   * shared world everyone builds in (Sandbox).
   */
  instances?: boolean;
  /**
   * The game's achievements, by id: things to do in it, which the server awards
   * (`player.achieve(id)`). The platform keeps each for the player's account, pops it up on their
   * screen, and lists every game's on their profile (done, and still to do). They're the game's
   * alone: they don't add up across games. A guest sees them pop up, but they last the visit.
   */
  achievements?: Record<string, AchievementDef>;
  /**
   * Cosmetics the game gives (`player.grant(id)`, or an achievement's `reward`): hats, things worn
   * on the back, titles and name tag colours that players keep for their account and wear in every
   * game. Their ids are the game's own: `gold_fedora` here is `callofblocky:gold_fedora` everywhere.
   */
  cosmetics?: Record<string, CosmeticDef>;
  /**
   * Which cosmetics show in this game (default: all of them). A game can leave some out (`['title',
   * 'tag']`: no hats in the way of its own headgear), or all (`[]`).
   */
  cosmeticSlots?: CosmeticSlot[];
}

/** One of a game's achievements (`GameMeta.achievements`). */
export interface AchievementDef {
  /** Short: "First Blood". */
  title: string;
  /** How it's earned, as the profile says it: "Take down another player". */
  description: string;
  /** Kept off the profile until someone earns it (a surprise): "Hidden achievement" till then. */
  hidden?: boolean;
  /** One of the game's cosmetics (`cosmetics`), given with it. */
  reward?: string;
}

/** Where a cosmetic is worn: on the head, on the back, under the name (a title), or as the name tag's colour. */
export type CosmeticSlot = 'hat' | 'back' | 'title' | 'tag';

/**
 * A cosmetic (`GameMeta.cosmetics`): something players keep for their account and wear in every game
 * that shows its slot. Worn things are small models of coloured boxes; a title is text; a tag is a
 * colour.
 */
export interface CosmeticDef {
  name: string;
  slot: CosmeticSlot;
  /**
   * A hat's or a back item's model, in texels (16 to a block), sized for the platform's box head (8
   * texels across) and body (8 wide, 4 deep); on other bodies it's scaled to fit. A hat's origin is
   * the middle of the top of the head (+y up, +z toward the face); a back item's is the middle of the
   * back between the shoulders (+z out behind them). Keep hats within 12 texels across and 10 tall.
   */
  model?: CosmeticModel;
  /** A title's words, under the name. */
  text?: string;
  /** A tag's colour (CSS). */
  color?: string;
  /** How it's earned, as the locker says it: "Reach level 10". */
  how?: string;
}

/** A cosmetic's model: boxes, each from one corner to the other (texels), in one colour. */
export interface CosmeticModel {
  boxes: { from: [number, number, number]; to: [number, number, number]; color: string; glow?: boolean }[];
}

/**
 * What a game's server and each player's screen both read (`src/games/<id>/shared.ts`): the world
 * and its blocks (each screen generates the terrain and draws it), how players move (each screen
 * predicts its own), vehicles, gun rules, the HUD's look. Data, and pure functions both sides run
 * the same way (structure builders, block painters, vehicles' and abilities' steps).
 */
export interface SharedDefinition extends GameMeta {
  /**
   * Allow the built-in cheat commands (`/give`, `/tp`, `/spawn`, `/kill`, `/heal`, `/time`, `/fly`)
   * in production builds. They're always available in development.
   */
  cheats?: boolean;
  world?: WorldOptions;
  player?: PlayerOptions;
  /** Where bullets meet players: how far back the host looks for a shot's target, and the hitboxes (see `HitscanOptions`). */
  hitscan?: HitscanOptions;
  /**
   * Vehicles players can drive (`player.drive(name, state)`): ships, cars, boards. Defined here,
   * not in `setup`, because a pilot's own screen runs them too (see `VehicleDefinition`).
   */
  vehicles?: Record<string, VehicleDefinition>;
  /**
   * Blocks of the game's own, by name: `{ crate: { texture: crateUrl }, lamp: { texture: { color:
   * '#ffd27a' }, light: 15 } }` (see `BlockDefinition`). They're used like the built-in blocks, by
   * name: `world.setBlock`, `Blueprint`s and `world.structures`, the creative block picker,
   * `world.blockInfo`; saves keep them by name, and every player gets them. Defined here, not in
   * `setup`, because each player's screen generates the terrain (structures too) and draws it.
   */
  blocks?: Record<string, BlockDefinition>;
  /** How the HUD looks: the health display, health bars over heads, fonts and colours. */
  hud?: HudOptions;
}

/** A game's rules (`src/games/<id>/server.ts`): they run only on the server. */
export interface ServerDefinition {
  /**
   * Runs once after the engine has loaded and before the world streams in. Register entity
   * types, items and event handlers here.
   */
  setup?(game: GameContext): void;
  /** Runs when play begins, and again after `game.restart()`. */
  start?(game: GameContext): void;
  /**
   * Play begins as soon as the ground at the spawn has loaded, without waiting for someone to
   * press Play: a match the bots play while people watch from the home page (an arcade's attract
   * mode), which a player pressing Play then joins. Off by default (`start` waits for the first
   * player). Block Jam has it.
   */
  autoStart?: boolean;
  /** Runs every frame while the game is running (not while paused). `dt` is in seconds. */
  update?(game: GameContext, dt: number): void;
  /**
   * The kinds of item it uses, each made to work by an item kit (see `ItemKit`), in the order
   * they run each step: `[throwables(), guns(RULES), melee()]` from `@platform/kits`. An item whose
   * kind isn't listed does nothing but be carried.
   */
  items?: ItemKit[];
}

/** A whole game as the server runs it: its shared definition and its rules (`defineServer`). */
export interface GameDefinition extends SharedDefinition, ServerDefinition {}

/** The HUD's look for a game (read by each player's screen, so it's data). */
export interface HudOptions {
  /** The player's own health: Minecraft's hearts (default), a bar with the number, or nothing. */
  health?: 'hearts' | 'bar' | 'none';
  /** Health bars over other players' heads (and creatures'), under their names. */
  healthBars?: boolean;
  /**
   * Other players' names over their heads: always (default), only while nothing blocks the view
   * of them (shooters: no seeing names through walls), or never.
   */
  nameTags?: 'always' | 'sight' | 'never';
  /** Fonts and colours for the whole HUD, the menus and the result screens. */
  theme?: HudTheme;
}

export interface HudTheme {
  /** Font for titles, banners, big numbers (a CSS font-family). */
  display?: string;
  /** Font for everything else. */
  text?: string;
  /**
   * Google Fonts families to load for them, e.g. `['Bangers', 'Anton']`; weights after a colon
   * (`'Barlow Condensed:300;500;600'`), else 400 and 700.
   */
  fonts?: string[];
  /**
   * `accent`: highlights and your own row; `ink`: outlines and shadows; `paper`: panel
   * backgrounds; `text`; `danger`: damage and low health; `good`: health and healing.
   */
  colors?: { accent?: string; ink?: string; paper?: string; text?: string; danger?: string; good?: string };
  /**
   * The game's own stylesheet for its HUD: it restyles the platform's pieces by their classes
   * (`.stat`, `.banner-title`, `.scoreboard`, `.menu-card`, `.hotbar`…), the menus and result
   * screens, and the game's widgets. It reaches only those (not the home page or the pause menu)
   * and each rule counts one class more than written, so `.stat { … }` wins over the platform's
   * own `.stat`. Keep it in a file: `import css from './hud.css?raw'`. No `@import`, fonts (use
   * `fonts`) or pictures from other sites.
   */
  css?: string;
}

export interface WorldOptions {
  /** Fixed seed. Default: `?seed=` from the URL, else random. */
  seed?: number;
  /**
   * `natural` (default: a whole generated landscape), `flat` (natural ground made flat at
   * `flatHeight`, trees and all), or `void`: nothing but your structures (sky islands), or your
   * structures on a plain `ground`, which costs next to nothing to make and draw (an arena's).
   */
  terrain?: 'natural' | 'flat' | 'void';
  flatHeight?: number;
  /**
   * A `void` world's own ground: a plain slab under your structures, as far as anyone sees, its
   * `top` block (default grass) at `y` over `depth - 1` of `fill` (dirt; default 4 deep in all),
   * the void below. `terraform` raises or lowers it (a hill for a backdrop, a sunken yard). The
   * sky's horizon then meets the ground, not an abyss.
   */
  ground?: { y: number; top?: BlockRef; fill?: BlockRef; depth?: number };
  /** Voxel structures stamped into the world while it generates (see `Blueprint`). */
  structures?: BlueprintLike[];
  /** Flatten terrain around points: `radius` fully flat at `height`, blending back over `blend` blocks (on a `ground`, `height` may raise a hill). */
  terraform?: { x: number; z: number; radius: number; blend: number; height: number }[];
  /** Player spawn point. `auto` picks pleasant land near the origin. */
  spawn?: Vec3 | 'auto';
  /** Initial look direction in radians (0 = looking toward -Z). */
  spawnYaw?: number;
  /** Time of day at start: 0 = midnight, 0.25 = sunrise, 0.5 = noon, 0.75 = sunset. */
  time?: number;
  freezeTime?: boolean;
  /** Minimum view distance in chunks (flight games see further); the player's setting wins if higher. Max 24. */
  viewDistance?: number;
  /**
   * Maximum view distance in chunks: the player's setting is held to it. For a game played in
   * a small space (an arena, a street), there's nothing further to load, mesh and draw.
   */
  maxViewDistance?: number;
  /** Save block edits and the player position between sessions. Default false. */
  persist?: boolean;
  /**
   * Blocks you can shoot holes in. Each block is really a 16 x 16 x 16 grid of little voxels, one
   * per pixel of its texture: guns chip them away where their bullets land (see `GunItem.carve`)
   * and `world.carve` does it on purpose (a blast, a melee strike). Players collide with what's
   * left, walk through a hole big enough, and see and shoot through one; a block carved to nothing
   * is gone. Only solid, opaque, full blocks carve (not glass, slabs, stairs, plants or liquids).
   *
   * `above`: only blocks higher than this y (keep the ground you stand on whole, so nobody falls
   * out of the world). `blocks`: which (by name, every variant; default `'all'`), less `except`.
   * Off by default. Damage is undone with the rest of the world on `restart`, and isn't saved.
   */
  destructible?: DestructibleOptions;
}

/** Which blocks can be shot into (`WorldOptions.destructible`). */
export interface DestructibleOptions {
  /** Only blocks higher than this y. Default: every height. */
  above?: number;
  /** The blocks that carve, by name. Default `'all'`. */
  blocks?: string[] | 'all';
  /** Blocks that don't, by name. */
  except?: string[];
}

export interface PlayerOptions {
  /** Break and place blocks with the mouse. Default false. */
  build?: boolean;
  /** Allow toggling flight (double-tap space / F). Default false. */
  fly?: boolean;
  /** Max health in half-hearts (20 = 10 hearts). `false` disables damage entirely. Default 20. */
  health?: number | false;
  /** Natural regeneration: `perSecond` health after `delay` seconds without taking damage. */
  regen?: { delay: number; perSecond: number };
  fallDamage?: boolean;
  /** What the hotbar holds: `blocks` (creative building) or `items` (inventory). */
  hotbar?: 'blocks' | 'items';
  /**
   * `walk` (default): the first-person player. `none`: no walking body, hand or hotbar; the game
   * drives the camera (`game.camera`) and reads the controls (`game.input`) itself, e.g. for
   * vehicles, flight or strategy games. The world streams around the camera.
   */
  controller?: 'walk' | 'none';
  /**
   * Player skin (Minecraft layout, origin in `skinAtlas`). Used for the first-person arm.
   * Default `Skins.player`.
   */
  skin?: [number, number];
  skinAtlas?: string;
  /**
   * A model for players' figures instead of the skin: `Models.gltf(url, { clips, head, hand })`.
   * With a `hand` node, their own first-person arm is that part of the model. Per player:
   * `player.setModel`.
   */
  model?: ModelSpec;
  /**
   * Players can hurt each other: melee hits and shots land on other players (never the shooter).
   * Off by default, so co-op games have no friendly fire.
   */
  pvp?: boolean;
  /** How players move (see `MovementOptions`). Default: Minecraft's walking. */
  movement?: MovementOptions;
  /** Seconds a player ignores further damage after a hit (Minecraft's 0.45; 0 for shooters). */
  hurtCooldown?: number;
}

/**
 * How players move: speeds in blocks a second, and the extras a game can turn on. Movement runs on
 * each player's own screen as well as the host (prediction), so it's data, and the moves a game
 * adds (`abilities`) are pure functions. Defaults are Minecraft's.
 */
export interface MovementOptions {
  /** Walking (4.3), sprinting (5.6) and crouching (1.3) speeds. */
  walk?: number;
  sprint?: number;
  crouch?: number;
  /** Jump height in blocks (1.27). */
  jump?: number;
  /** Blocks a second per second (32). */
  gravity?: number;
  /** How quickly speed follows the controls: on the ground (14) and in the air (3), per second. */
  acceleration?: number;
  airControl?: number;
  /** Keys (KeyboardEvent.code) that sprint and crouch. Default: Ctrl sprints, Shift crouches (sneaks). */
  sprintKeys?: string[];
  crouchKeys?: string[];
  /** Double-tapping W sprints. Default true. */
  doubleTapSprint?: boolean;
  /** Crouching on the ground stops at edges, like Minecraft's sneaking. Default true. */
  edgeGuard?: boolean;
  /**
   * Crouching out of a sprint slides: a burst of `speed` (default 1.45 x sprint) that bleeds away
   * (`friction` per second, 1.4) over up to `time` seconds (0.75); jumping out of it keeps the
   * speed. `cooldown` seconds (0.5) before the next. `true` for the defaults.
   */
  slide?: boolean | { speed?: number; time?: number; friction?: number; cooldown?: number };
  /** Jumping into a ledge climbs onto it if its top is up to this far above the feet (blocks; `true` = 1). */
  mantle?: boolean | number;
  /**
   * Moves of the game's own, by name: a dash, a double jump, a wall-run, a grapple, a ground pound
   * (see `MovementAbility`). They run inside every step of a player's movement, in the order
   * given, on the host and on the player's own screen alike, so they answer at once online.
   */
  abilities?: Record<string, MovementAbility>;
}

/**
 * A movement ability (`movement.abilities`): code of the game's own inside each step of a walking
 * player's movement. Like a vehicle's `step`, it runs on the host for everyone and, ahead of the
 * host, on each player's own screen (client-side prediction), which starts again from the host's
 * state whenever it arrives and replays the inputs since. So `step` must be pure: it reads its
 * state, the controls, the body and the world; it changes only its state and the body's step
 * (`AbilityBody`); and it does the same with the same inputs wherever it runs (no `Math.random`,
 * no clock but `body.time`, nothing kept outside its state). Anything with consequences (a sound,
 * a trail, damage) is the game's: `body.trigger` tells the game (the `ability` event), and the
 * state is there to read (`player.abilities`).
 */
export interface MovementAbility<S extends object = any> {
  /**
   * Its state when a player starts: plain data (numbers, booleans, strings, short lists), copied
   * for each player. It goes to their screen with every frame, so keep it small.
   */
  state: S;
  /** One step of `dt` seconds, before the body moves (see `AbilityBody`). */
  step(state: S, controls: AbilityControls, body: AbilityBody, dt: number, world: VehicleWorld): void;
}

/**
 * The controls of one step, as an ability reads them (one frame on the player's screen): held
 * keys, this frame's presses, mouse buttons. `consume` claims one for the rest of the step, so the
 * abilities after this one see it idle (a wall-jump's Space isn't also a double jump's).
 */
export type AbilityControls = Pick<InputApi, 'isDown' | 'pressed' | 'button' | 'buttonPressed' | 'consume' | 'mouseX' | 'mouseY' | 'wheel'>;

/**
 * A player's body as an ability's step begins, and what that step does. The platform has read the
 * controls (`wish`, `jump`); the abilities can change them, change the velocity, and scale this
 * step's gravity and steering; then the body moves.
 */
export interface AbilityBody {
  /** Feet position and velocity (blocks, blocks a second), as they are now. */
  readonly position: Vec3;
  readonly velocity: Vec3;
  readonly onGround: boolean;
  readonly inWater: boolean;
  readonly flying: boolean;
  /** What the platform's movement is doing this step. */
  readonly crouching: boolean;
  readonly sprinting: boolean;
  readonly sliding: boolean;
  /** Where they look: `yaw` (0 looks toward -z), `pitch` (up is positive), and as a unit vector. */
  readonly yaw: number;
  readonly pitch: number;
  readonly look: Vec3;
  /** Seconds of movement so far: a clock that runs the same on the host and on their screen. */
  readonly time: number;
  /**
   * Where the controls push them this step: a direction on the ground (world space, length 0..1),
   * from the keys or the stick, turned by the view. Change it to steer the step; zero coasts.
   */
  wish: { x: number; z: number };
  /** Jump is held (the body jumps if it's on the ground): `false` swallows it. */
  jump: boolean;
  /** Gravity this step, times the game's (1): 0 floats (a dash), 0.1 slides slowly down a wall. */
  gravity: number;
  /**
   * How quickly speed follows `wish` this step, times the game's (1): 0 keeps the velocity as the
   * ability left it, with no steering or friction (a dash, a grapple's swing).
   */
  control: number;
  /** Multiplies walking, sprinting and crouching speed this step (1). */
  speed: number;
  /**
   * How low the body is this step: `'stand'`, `'crouch'`, or `'low'` (a slide's height). It starts
   * as the platform's movement has it (crouching, sliding); an ability can change it for this step
   * (a dodge roll goes `'low'`). It's the body's hitbox for bullets, the height of their eyes (and
   * their camera), and how their figure looks to others (crouched, or low as in a slide), and it's
   * predicted on their screen like the rest. It isn't how the body moves: speeds stay the ability's.
   */
  stance: AbilityStance;
  /**
   * How far their head and shoulders lean out sideways this step (blocks, positive to the right of
   * where they look, up to 0.6 either way; 0 at the start of each step): a peek round a corner.
   * Their eyes go with it (their camera, and where their shots start), and so do their head's
   * hitbox for bullets and their figure (tipped over at the waist), for everyone, predicted like
   * `stance`. It doesn't move their feet or check for walls: keep it out of blocks with `raycast`.
   */
  lean: number;
  /**
   * Their camera this step, on their own screen only (predicted, so it moves the moment they do):
   * `roll` tilts it (radians, positive leans right, as a head tilts), `pitch` tips it (radians, up
   * is positive; where they aim doesn't move), `dip` lowers it (blocks). All 0 at the start of each
   * step: set them on every step they should show (a roll's tumble, a landing's dip).
   */
  camera: { roll: number; pitch: number; dip: number };
  /** Set the velocity (the axes given), or add to it. Upward speed lifts them off the ground. */
  setVelocity(v: Partial<Vec3>): void;
  addVelocity(v: Partial<Vec3>): void;
  /** Put their feet somewhere (a blink): check it's free with `fits` first. */
  setPosition(p: Vec3): void;
  /** Whether their body (0.6 x 1.8 x 0.6) would fit with its feet at `p`: no solid block or solid prop in the way. */
  fits(p: Vec3): boolean;
  /**
   * Tell the game this ability did something (`'dash'`, `'jump'`, `'start'`): the host's `ability`
   * event, heard once, after the step. (Their screen replays steps, so only the host's are heard.)
   * With `clip`, their figure plays that clip of their model (as `player.animate` would, with its
   * options): on their own screen at once, and on everyone else's from the host.
   */
  trigger(name: string, opts?: AbilityTriggerOptions): void;
}

/** How low a body is (`AbilityBody.stance`): standing, crouched, or as low as a slide. */
export type AbilityStance = 'stand' | 'crouch' | 'low';

/** `AbilityBody.trigger`'s options: a clip for their figure to play, and how (see `ClipOptions`). */
export interface AbilityTriggerOptions extends ClipOptions {
  clip?: string;
}

// ---------------------------------------------------------------------------------------------
// Context
// ---------------------------------------------------------------------------------------------

/**
 * Data a game keeps across restarts: all-time stats, leaderboards, unlocks, settings. On a game
 * server it lives in the server's database; in single-player, in the browser. Values are anything
 * JSON can hold, copied in and out.
 */
export interface StoreApi {
  get<T = unknown>(key: string): T | undefined;
  set(key: string, value: unknown): void;
  delete(key: string): void;
  /** The keys saved, or those starting with `prefix` (`'stats:'`). */
  keys(prefix?: string): string[];
}

export interface GameContext {
  readonly world: WorldApi;
  /**
   * Data kept across restarts (see `StoreApi`), the game's own: records, leaderboards, the state
   * of its world. A player's own data goes in `player.store`, which is kept for their account.
   */
  readonly store: StoreApi;
  /**
   * Everyone playing. A single-player game has exactly one; in a multiplayer game players join
   * and leave (`playerJoin` / `playerLeave` events). Players already here when `start` runs are
   * in the list.
   */
  readonly players: readonly Player[];
  /**
   * The player, for single-player games (in a multiplayer game, the first one). Multiplayer
   * games use `players` and the player each event and callback names.
   */
  readonly player: Player;
  readonly entities: EntityApi;
  readonly items: ItemApi;
  /** Everyone's screen: banners, the scoreboard, messages for all. One player's: `player.hud`. */
  readonly hud: HudApi;
  readonly fx: FxApi;
  readonly audio: AudioApi;
  readonly env: EnvApi;
  readonly events: EventApi;
  readonly clock: ClockApi;
  /** Deterministic random numbers (seeded per session). */
  readonly rng: Rng;
  /** Slash commands typed into the command bar (`/` or `T`). */
  readonly commands: CommandApi;
  /** The player's camera (single-player shortcut for `player.camera`). */
  readonly camera: CameraApi;
  /** The player's keyboard and mouse (single-player shortcut for `player.input`). */
  readonly input: InputApi;
  /** Movable objects: block builds (ships, lifts, vehicles) and glowing bolts. */
  readonly props: PropApi;
  /** Players driven by the game's code (see `BotApi`). */
  readonly bots: BotApi;
  /** Messages to the game's own code on players' screens (see `ClientsApi`). */
  readonly clients: ClientsApi;
  /**
   * Which copy of the game this is: `'public'`, the game everyone joins, or the code of a game
   * someone started of their own (`instances`: `?room=k3x9f2`), which its players may want to set
   * up their way (a mode, a map). Tests and a server running one game are `'public'`.
   */
  readonly room: string;
  /** The last few seconds, played back on a player's screen (a kill cam, a goal again): see `ReplayApi`. */
  readonly replay: ReplayApi;
  /** Clear entities, timers, pickups and HUD, revive the player at spawn, then call `start` again. */
  restart(): void;
  /** Return to the game launcher. */
  exit(): void;
}

// ---------------------------------------------------------------------------------------------
// Camera, input, props
// ---------------------------------------------------------------------------------------------

export interface CameraApi {
  /** Current camera position and look direction (world). */
  readonly position: Vec3;
  readonly forward: Vec3;
  /** Place the camera looking at `target`. Only applies with `player.controller: 'none'`. */
  set(position: Vec3, target: Vec3, up?: Vec3): void;
  /** Or place it with an orientation (camera looks down its -z). */
  setPose(position: Vec3, rotation: { x: number; y: number; z: number; w: number }): void;
  /** Vertical field of view in degrees. */
  fov: number;
  /**
   * Back to the vehicle's own camera (`VehicleDefinition.camera`) after `set` / `setPose` took
   * over (a cutscene, watching after being shot down). Driving starts with it.
   */
  follow(): void;
  /**
   * Third person, for a walking player: the mouse wheel pulls the camera back from their eyes to
   * circle `target` (a prop: the ship they're steering; or a player: themselves) at a distance,
   * turned by their own mouse look. It's worked out on their screen every frame, so it's smooth
   * and immediate online. Blocks stop it; solid props don't (it sees a ship from outside). Zoomed
   * all the way in (distance 0) they're back in first person. While it's on, the wheel zooms
   * rather than changing hotbar slots. Their figure shows while the camera is out of their eyes.
   * `null` returns to first person.
   */
  orbit(target: Prop | Player | null, opts?: OrbitOptions): void;
}

export interface OrbitOptions {
  /** The point it circles, from the target: in a prop's own space, or up from a player's feet. Default: a player's eyes, a prop's origin. */
  offset?: Vec3;
  /** Blocks from that point to start at (0: still first person until they zoom out). Default 0. */
  distance?: number;
  /** How close and how far the wheel takes it. Default 0 and 30. */
  min?: number;
  max?: number;
  /**
   * Over the shoulder (a third-person shooter's camera): the camera this far to the side and up from
   * straight behind the point it circles, across and up the view, in blocks (`{ right: 0.65, up:
   * 0.5 }`). Their figure then stands clear of the middle of the screen. Where they look (and walk)
   * stays the camera's; what they shoot and throw from their screen converges on what's under the
   * crosshair, from their eyes (see docs/PLATFORM.md, "A third-person shooter").
   */
  shoulder?: { right: number; up: number };
  /** The wheel zooms it (default true); false keeps the wheel for the hotbar, the camera at `distance`. */
  wheel?: boolean;
}

/** A controller's buttons (the standard layout: Xbox names; `Back` is View, `Start` is Menu). */
export type PadButton = 'A' | 'B' | 'X' | 'Y' | 'LB' | 'RB' | 'LT' | 'RT' | 'Back' | 'Start' | 'L3' | 'R3' | 'Up' | 'Down' | 'Left' | 'Right';

/**
 * What a controller button does: press a key (KeyboardEvent.code, e.g. `'KeyL'`) or a mouse
 * button (`'LMB'`, `'MMB'`, `'RMB'`); or `'jump'`, `'crouch'`, `'sprint'` (the player's movement
 * keys; sprint stays on until the stick lets go), `'next'` / `'prev'` (hotbar slot, skipping
 * empty ones for items), `'pause'`; or null for nothing.
 */
export type PadAction = string | null;

export interface InputApi {
  /** Key held (KeyboardEvent.code: 'KeyW', 'Space', 'ShiftLeft'…). */
  isDown(code: string): boolean;
  /**
   * Key went down this frame. Nothing reads as pressed while the controls aren't the game's (a
   * menu open, the pause screen, typing in chat), nor while the player's dead; `{ dead: true }`
   * hears a dead player's keys too (a vote, the scoreboard, a menu of the game's).
   */
  pressed(code: string, opts?: { dead?: boolean }): boolean;
  /** Mouse button held / clicked this frame (0 left, 1 middle, 2 right). */
  button(b: number): boolean;
  buttonPressed(b: number): boolean;
  /**
   * Claim a mouse button (0, 1, 2) or key code for the rest of this frame: everything that reads
   * input after you, including the platform's built-in weapons, sees it as idle. Your game's
   * `update` runs before the built-in systems each frame, so handling a click and consuming it
   * (a pickaxe mining a block, say) stops the sword from also swinging.
   */
  consume(input: number | string): void;
  /** Mouse movement this frame, in pixels (while the mouse is captured). */
  readonly mouseX: number;
  readonly mouseY: number;
  readonly wheel: number;
}

/** A meshed block build, ready to spawn (see `PropApi.model`). */
export interface PropModel {
  /** Bounding radius in world units (from the pivot). */
  readonly radius: number;
  /** Number of blocks. */
  readonly blocks: number;
}

/** A rotation as a unit quaternion (a `math.Quaternion` is one). */
export interface Quat {
  x: number;
  y: number;
  z: number;
  w: number;
}

/** Where a prop could be: a position and / or rotation (on its parent, if it rides one), the rest as it is. */
export interface PropPose {
  position?: Vec3;
  quaternion?: Quat;
}

/** A movable object. Mutate `position` / `quaternion` directly each frame. */
export interface Prop {
  /** Where it is and how it's turned: in the world, or on its parent (`attach`). */
  readonly position: MathVector3;
  readonly quaternion: MathQuaternion;
  scale: number;
  visible: boolean;
  /**
   * Solid, like the world's blocks (block builds only, `props.model`): players and creatures
   * bump into it, stand on it and ride along wherever you move and turn it (a ship's deck, a
   * lift, a moving platform), and are pushed out of its way when it runs into them; shots and
   * lines of sight stop at it. Its solid blocks count, and it stays solid while hidden. Walking
   * over it is smoothest turned about the vertical; a gentle tilt (a rolling deck) is walkable.
   * Default false.
   */
  solid: boolean;
  /**
   * How many of its blocks are inside the world's solid blocks (a block counts when its middle is
   * in one): where it is, or with it at `at` (to test a move before making it). 0 when it's clear.
   * Solid props only.
   */
  overlap(at?: PropPose): number;
  /**
   * Move it toward `to` without going into the world's blocks, the way a walker moves: all the way
   * if that doesn't put more of it into blocks than there is now, or else as far as it can (the
   * turn alone, then the move one axis at a time, sliding along whatever is in the way). It can
   * always back off or turn away from what it's touching. True if it got all the way. Solid
   * props only; `position` and `quaternion` hold where it got to.
   */
  sweep(to: PropPose): boolean;
  /** A point on it (its own space, like `offset`s and `attach`ed props) in the world, and back. */
  toWorld(local: Vec3): Vec3;
  toLocal(world: Vec3): Vec3;
  /** Tint it briefly (hits). */
  flash(color?: string, seconds?: number): void;
  /**
   * Ride on another prop (an engine flame on its ship, a turret on its tank): from now on
   * `position` and `quaternion` are on the parent, so it goes wherever the parent goes, on every
   * screen and without being moved each tick. Null puts it back in the world.
   */
  attach(parent: Prop | null): void;
  /**
   * Send it flying in a straight line from `from` at `velocity` (blocks a second): it moves on its
   * own, on every screen, and its `position` follows (moving it yourself stops that). For shots:
   * nothing is sent while it flies. `by` the player who fired it: on their own screen it leaves
   * from where their (predicted) guns were when they fired, rather than where the server had them.
   */
  launch(from: Vec3, velocity: Vec3, opts?: { by?: Player }): void;
  /** Loop one of its glTF model's animations (by name), or stop with null. */
  play(animation: string | null): void;
  remove(): void;
}

export interface PropApi {
  /**
   * Mesh a Blueprint as a movable object drawn with the world's block textures (lit, shadowed,
   * glowing blocks glow). `pivot` (blueprint coordinates) becomes its origin; `scale` is the size
   * of one block in world units (e.g. 0.25 for a detailed "micro-block" build). Do this once and
   * spawn as many copies as you like.
   */
  model(blueprint: Blueprint, opts?: { scale?: number; pivot?: Vec3 }): PropModel;
  /** A copy of a model; `solid` makes it something to stand on (see `Prop.solid`). */
  spawn(model: PropModel, opts?: { position?: Vec3; scale?: number; solid?: boolean }): Prop;
  /**
   * A glTF or GLB model (tables, machines, anything made in Blockbench or Blender), drawn lit and
   * shadowed like the world's blocks; spawn copies with `spawn`. Each player's screen fetches the
   * file itself (import it: `import slot from './models/slot.gltf?url'`); the host doesn't open
   * it, so give its `radius` if you need one. `animation` loops one of its animations on every
   * copy (see `Prop.play`).
   */
  gltf(url: string, opts?: { scale?: number; radius?: number; animation?: string }): PropModel;
  /**
   * A glowing streak pointing along its -z (lasers, tracers, engine flames). Length and width in
   * blocks; `flicker` (0..1) makes it waver in length on its own (flames); past `far` blocks from
   * each player's camera it grows with the distance, so it stays visible.
   */
  bolt(opts: { color: string; length?: number; width?: number; intensity?: number; flicker?: number; far?: number }): Prop;
  /** The first solid prop along a ray (a cannonball hitting a ship's hull), within `maxDistance`. */
  raycast(origin: Vec3, dir: Vec3, maxDistance: number): PropHit | null;
}

export interface PropHit {
  prop: Prop;
  distance: number;
  point: Vec3;
}

// ---------------------------------------------------------------------------------------------
// Vehicles
// ---------------------------------------------------------------------------------------------

/** One input's controls, as a vehicle's `step` reads them (one frame on the pilot's screen). */
export type VehicleControls = Pick<InputApi, 'isDown' | 'pressed' | 'button' | 'buttonPressed' | 'mouseX' | 'mouseY' | 'wheel'>;

/** What a vehicle's `step` and `camera` may ask of the world: the same answers on the host and on the pilot's screen. */
export type VehicleWorld = Pick<WorldApi, 'getBlock' | 'blockName' | 'raycast' | 'lineOfSight' | 'surfaceY' | 'seaLevel'>;

/** A vehicle's camera, kept from frame to frame (so it can ease after the vehicle). */
export interface VehicleCamera {
  readonly position: MathVector3;
  /** The point it looks at, and which way is up. */
  readonly target: MathVector3;
  readonly up: MathVector3;
  /** Vertical field of view in degrees. */
  fov: number;
  /** The first frame, or after a jump (a respawn): place it rather than ease into it. */
  readonly snap: boolean;
}

/**
 * Something players drive with the game's own physics: a ship, a car, a board. `step` runs on the
 * host for everyone and, ahead of it, on each pilot's own screen (client-side prediction, as
 * walking has), so the controls answer at once however far away the server is; when the host's
 * state comes back, the pilot's screen starts again from it and replays the inputs it hasn't
 * seen yet. So `step` must be pure: it reads the state, the controls and the world, changes only
 * the state, and does the same with the same inputs wherever it runs. Anything with consequences
 * (damage, sounds, shots) is the game's `update`, reading the state.
 */
export interface VehicleDefinition<S extends object = any> {
  /** Move it `dt` seconds under these controls. */
  step(state: S, controls: VehicleControls, dt: number, world: VehicleWorld): void;
  /** Where it is and how it's turned: its model (`drive`'s `prop`) goes there. */
  pose(state: S, position: MathVector3, quaternion: MathQuaternion): void;
  /** The pilot's camera, every frame on their screen (a chase camera, a cockpit). */
  camera?(state: S, camera: VehicleCamera, dt: number, world: VehicleWorld): void;
}

/** A player's vehicle (`player.drive`). */
export interface Vehicle<S extends object = any> {
  readonly name: string;
  /** Its state, live: the game reads it and may change it (a knock-back, a refill); the pilot's screen follows. */
  readonly state: S;
  /** Its model, kept at its pose (on the pilot's own screen, where prediction has it). */
  readonly prop: Prop | null;
  /** Steered from afar (`drive`'s `remote`): the pilot's body stays where it was. */
  readonly remote: boolean;
}

// ---------------------------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------------------------

export interface CommandSpec {
  /** One line for `/help`. */
  help?: string;
  /** Argument summary, e.g. `<item> [count]`. */
  usage?: string;
  /** Do it. Return a message to show; throw an Error to report a problem. */
  run(args: string[], game: GameContext, player: Player): string | void;
  /** Tab-completion candidates for the last argument (filtered by what's typed). */
  complete?(args: string[], game: GameContext): string[];
  /**
   * A developer tool (win now, fill the wallet, skip a wave): it only exists where cheats are on
   * (development, a server started with `--cheats`, or a game with `cheats: true`). Public
   * servers don't have it.
   */
  cheat?: boolean;
}

export interface CommandApi {
  /** Add or replace a command (name without the slash). */
  register(name: string, spec: CommandSpec): void;
  /** Run a command line as if typed; returns the message it printed. */
  run(line: string): string;
}

// ---------------------------------------------------------------------------------------------
// World
// ---------------------------------------------------------------------------------------------

/**
 * A block: its id, its name (`'oak_stairs'`), or a name with a state, Minecraft style, for one
 * variant of a block that has several (`'oak_stairs[facing=east,half=top]'`,
 * `'red_bed[facing=south,part=head]'`, `'torch[facing=west]'` on a wall, `'oak_log[axis=x]'`).
 * States left out are the default's. `world.blockInfo` tells a block's state.
 */
export type BlockRef = number | string;

/** Horizontal directions: north is -z, east +x. */
export type Facing = 'north' | 'east' | 'south' | 'west';

export interface RayHit {
  /** The block hit. */
  x: number;
  y: number;
  z: number;
  /** The face hit: which way it faces. */
  normal: Vec3;
  block: number;
  /** Exactly where the ray hit it. */
  point: Vec3;
}

export interface WorldApi {
  /** Block id at a position; -1 if the chunk is not loaded. */
  getBlock(x: number, y: number, z: number): number;
  /** Set a block by id or name. Returns false if the chunk is not loaded. Lighting updates. */
  setBlock(x: number, y: number, z: number, block: BlockRef): boolean;
  blockId(name: string): number;
  blockName(id: number): string;
  /** What a block is (by id or name): solid, a liquid, a plant (instant to break, walk-through), replaceable by placing, its shape and collision. Null if unknown. */
  blockInfo(block: BlockRef): BlockInfo | null;
  /**
   * How high bodies collide with the block at a position, in blocks above the bottom of its
   * cell: 0 for air, plants and anything else not solid, 1 for a full block, 0.5 for a bottom
   * slab, 1.5 for a fence (nobody jumps it). A fence counts as it's joined there, and a carved
   * block (`world.destructible`) as what's left of it. An unloaded chunk counts as 1. By block,
   * `blockInfo(block).height` says the same for a whole one.
   */
  collisionHeight(x: number, y: number, z: number): number;
  /** First targetable block along a ray (blocks only: `props.raycast` finds solid props). */
  raycast(origin: Vec3, dir: Vec3, maxDistance: number): RayHit | null;
  /** True if nothing solid (a block, a solid prop) blocks the straight line between two points. */
  lineOfSight(a: Vec3, b: Vec3): boolean;
  /** Highest non-air, non-plant block in a column (-1 if unloaded). */
  surfaceY(x: number, z: number): number;
  /** The water surface: the top of sea-level water is at `seaLevel + 1`. */
  readonly seaLevel: number;
  /**
   * Where players come in (joining, `restart`) and what someone watching from the game's home page
   * looks at: the definition's `world.spawn` to begin with. A game played in several places (the
   * maps of one world) moves it to the one in play, so the home page shows where the action is to
   * whoever opens it; anyone already watching keeps the view they came in with.
   */
  spawn: { x: number; y: number; z: number; yaw: number };
  /**
   * Blow a ragged sphere out of the world (bedrock and liquids survive) with debris and an
   * explosion. `filter` decides which blocks go (e.g. only ones placed this match); `by` is
   * passed on to the `blockBreak` events. Returns blocks removed.
   *
   * In a world with destructible blocks (`world.destructible`) it blows a crater instead: the
   * destructible blocks lose a ragged sphere of little voxels (a wall is bitten into, a thin one
   * holed), glass and the like within `radius` break whole, and what isn't destructible (the
   * ground under the line, `except`) stands. Returns the blocks removed altogether.
   *
   * With `damage` it hurts too: players and creatures within `reach` blocks (default twice the
   * radius) take `damage` (or `[middle, edge]`: falling off from the middle to the edge of the
   * reach), none behind a wall, and are thrown back by `knockback` (default 1, less further out).
   * The hits' `cause` is `'explosion'`, from `by`, with `weapon`.
   */
  explode(
    center: Vec3,
    radius: number,
    opts?: { effect?: boolean; filter?: (at: Vec3, block: string) => boolean; by?: Actor; damage?: number | [middle: number, edge: number]; reach?: number; knockback?: number; weapon?: string },
  ): number;
  /**
   * Carve little voxels out of destructible blocks (`world.destructible`): a rounded channel
   * from `point` along `dir`, `depth` blocks long (default 0.2) and `radius` round (default 0.1),
   * through every block it reaches, like a bullet's (a big radius blows a hole, a long depth
   * drills). Blocks it carves to nothing are gone (and fire `blockBreak`, from `by`). Everyone
   * sees the same holes. Returns how many little voxels went (4096 make a block): 0 when there
   * was nothing it could take, so doing it again changes nothing.
   */
  carve(point: Vec3, dir: Vec3, opts?: { radius?: number; depth?: number; by?: Actor }): number;
  /**
   * How much of the block at (x, y, z) has been carved away (`carve`, a gun's bullets): 0 for a
   * whole block (and anything that can't be carved), up to 1. A block carved to nothing is air.
   */
  carved(x: number, y: number, z: number): number;
  /**
   * Whether a player's body (0.6 x 1.8 x 0.6) fits with its feet at `p`: no block, slab, what's
   * left of a carved block, or solid prop in its way (unloaded chunks count as in the way). Where
   * a hole goes through a wall, for one.
   */
  fits(p: Vec3): boolean;
  /**
   * Break a block with debris and a sound (and the plant on top), and fire `blockBreak`.
   * Bedrock and liquids don't break. Returns false if nothing was broken. (`setBlock` is the
   * silent version.) Who may break what is up to your game.
   */
  breakBlock(x: number, y: number, z: number, opts?: { by?: Actor }): boolean;
  /**
   * Place a block the way a player would, if the cell is free (air or a plant), nobody is standing
   * in it, a plant has ground under it and a torch something to stand or hang on; with a sound,
   * and fire `blockPlace`. Returns false if it couldn't.
   *
   * Given by name (`'torch'`, `'oak_stairs'`), a block is turned the Minecraft way: `against`
   * (the face aimed at, a `raycast` hit) hangs a torch on the side of a block, puts a slab or
   * stairs in the upper half (aiming at a ceiling or high on a side) and lays a log along the
   * axis aimed along; stairs and beds face `facing`, else the way `by` is looking. A block of the
   * game's own that faces (`BlockDefinition.facing`) faces `facing`, else out from the side of
   * the block aimed at (a sign on a wall), else back at whoever places it. A bed takes two
   * cells, its head beyond (x, y, z). A slab placed on the same kind of slab makes a full block.
   * Given with a state (`'oak_stairs[facing=east]'`), it goes as it is.
   */
  placeBlock(x: number, y: number, z: number, block: BlockRef, opts?: { by?: Actor; against?: RayHit; facing?: Facing }): boolean;
}

export interface BlockInfo {
  id: number;
  name: string;
  /** Display name, e.g. "Oak Planks". */
  label: string;
  /** Which variant it is, for blocks with several: `{ facing: 'east', half: 'top' }`; else `{}`. */
  state: Record<string, string>;
  /** Exactly this variant, as a block reference (`'oak_stairs[facing=east,half=top]'`). */
  variant: string;
  /** Bodies collide with it. */
  solid: boolean;
  liquid: boolean;
  /** Something small that breaks at a touch and you walk through: plants, torches. */
  plant: boolean;
  /** Placing a block here replaces it (air, plants, liquids). */
  replaceable: boolean;
  /** Light it gives off, 0..15. */
  light: number;
  /** Players and explosions can break it (not bedrock, not liquids, not a game block made unbreakable). */
  breakable: boolean;
  /** A game's own block: seconds to mine it by hand, if the game gave it (`BlockDefinition.hardness`). */
  hardness?: number;
  /** Its shape (`'fence'`, `'stairs'`...): see `BlockShape`. */
  shape: BlockShape;
  /**
   * How high bodies collide with it, in blocks above the bottom of its cell: 0 if it isn't
   * solid, 1 for a full block, 0.5 for a bottom slab (1 for a top one), 0.5625 for a bed, 1.5 for
   * a fence. `world.collisionHeight` says it at a position (a fence joined, a block carved).
   */
  height: number;
  /**
   * The boxes bodies collide with, in blocks within its cell (`[x0, y0, z0, x1, y1, z1]`, 0 to 1,
   * a fence's to 1.5); none if it isn't solid. A fence or pane is its post alone here: its arms
   * depend on what's beside it.
   */
  boxes: number[][];
  /** Bodies climb it: ladders, vines (`BlockDefinition.climbable`). */
  climbable: boolean;
}

/**
 * What shape a block is: `air`; `cube`, a full block; `cross`, a plant's two crossed planes;
 * `liquid`; `slab` and `stairs` (built-in or a game's); `torch` (standing or on a wall); `bed`
 * (half of one); and a game's own: `fence`, `pane`, `post`, `boxes`.
 */
export type BlockShape = 'air' | 'cube' | 'cross' | 'liquid' | 'slab' | 'stairs' | 'torch' | 'bed' | 'fence' | 'pane' | 'post' | 'boxes';

/**
 * A block of the game's own (`GameDefinition.blocks`). A texture (or a built-in block it's
 * `like`) is all it needs: the rest defaults to a plain solid block, like stone.
 */
export interface BlockDefinition {
  /** Its name for players (the block picker, `blockInfo`). Default: the name in words (`neon_sign` is "Neon Sign"). */
  label?: string;
  /**
   * What it looks like: one texture on every face, or face by face (`{ top, bottom, side }`, see
   * `BlockFaces`).
   */
  texture?: BlockTexture | BlockFaces;
  /**
   * Start from a built-in full block or plant (`'glass'`, `'neon_red'`, `'poppy'`): its textures,
   * shape, light and the rest, which anything given here changes (`{ like: 'stone', breakable:
   * false }`, `{ like: 'white_wool', tint: '#e0457b' }`).
   */
  like?: string;
  /**
   * `cube` (default); `cross`: two crossed planes, like flowers (walked through, broken at a
   * touch, needs ground under it); `slab`: half a block (`name[type=top]` is the upper half);
   * `stairs` (`name[facing=east,half=top]`). Slabs and stairs are placed the way the built-in ones
   * are: in the half aimed at, climbing away from whoever places them.
   *
   * Thin things, which let light through: `fence`, a post with rails to the fences and solid
   * blocks beside it, 1.5 blocks high to bodies so nobody jumps it (Minecraft's); `pane`, a wall
   * 2/16 thick joining the panes and solid blocks beside it (glass panes, bars); `post`, a pillar
   * 4/16 across (with `facing: 'axis'`, a beam lying along x or z). For a shape of your own give
   * `boxes` instead.
   */
  shape?: 'cube' | 'cross' | 'slab' | 'stairs' | 'fence' | 'pane' | 'post';
  /**
   * A shape of its own: boxes on the block's 16 x 16 x 16 grid, `[x0, y0, z0, x1, y1, z1]` each (0
   * to 16, up to 16 boxes), written as it faces north if it has a `facing`. Bodies collide with
   * them (if it's `solid`), you aim at them, and each face shows the part of its texture it
   * covers. A table: `[[0, 13, 0, 16, 16, 16], [1, 0, 1, 3, 13, 3], [13, 0, 1, 15, 13, 3], [1, 0,
   * 13, 3, 13, 15], [13, 0, 13, 15, 13, 15]]`; a poster flat on the wall behind it: `[[1, 1, 15, 15,
   * 15, 16]]`. It lets light through.
   */
  boxes?: [number, number, number, number, number, number][];
  /**
   * It faces a way, one variant per way (a cube, a `post` or `boxes`): `true` or `'horizontal'`,
   * the four sides (`name[facing=east]`; furnaces, signs, ladders); `'all'`, up and down too
   * (`name[facing=up]`); `'axis'`, lying along x, y or z like a log (`name[axis=x]`). Written
   * (textures and boxes) as it faces north, or stands upright for `'axis'`; its `front` texture
   * goes where it faces. Placed, it faces out from the side of the block aimed at (a sign on a
   * wall), or up or down from the top or bottom for `'all'`, else back at whoever places it;
   * `'axis'` lies along the axis aimed along.
   */
  facing?: boolean | 'horizontal' | 'all' | 'axis';
  /**
   * Bodies climb it (ladders, vines): standing in it, pushing into what's behind it (or its own
   * boxes) or holding jump climbs, sneaking holds on, and otherwise they slide down slowly.
   * Usually not `solid` (a vine) or thin (a ladder's `boxes`).
   */
  climbable?: boolean;
  /** A slab: the block two of them make, one placed on the other (default: they don't join). */
  full?: string;
  /**
   * How light and sight get through: `opaque` (default); `cutout`: through the clear pixels of
   * its texture (grates, leaves, fences); `transparent`: like glass (clear pixels show through,
   * and faces between two of it aren't drawn). A pixel is there or not: half-clear colours show
   * solid.
   */
  transparency?: 'opaque' | 'cutout' | 'transparent';
  /** Bodies collide with it. Default: true (a `cross` plant is walked through). */
  solid?: boolean;
  /** Light it gives off, 0..15 (a torch is 14, glowstone 15). Default 0. */
  light?: number;
  /**
   * How much its textures glow, 0..1: lit by themselves in the dark, and blooming (neon, lamps).
   * Default: `light / 15`, so a lamp looks lit.
   */
  glow?: number;
  /**
   * Multiply its textures by a colour (`'#e0457b'`: one grey texture, many colours), or by the
   * grass colour of where it stands (`'grass'`, like grass and leaves).
   */
  tint?: string;
  /** In the creative block picker (games with `player.build`). Default true. */
  picker?: boolean;
  /** Players and explosions can break it (`world.breakBlock`, `world.explode`, building). Default true. */
  breakable?: boolean;
  /** Seconds to mine it by hand with the `building` kit (`blockInfo().hardness`). Default: like stone. */
  hardness?: number;
  /** Placing a block into its cell replaces it (default: only `cross` plants). */
  replaceable?: boolean;
  /** Sounds when it's broken and placed (built-in or `audio.define`d). Default: the platform's. */
  sounds?: { break?: SoundName; place?: SoundName };
}

/**
 * One face's texture, 16 x 16 pixels:
 * - an image: a PNG imported with `?url` (`import crate from './crate.png?url'`); other sizes are
 *   scaled to fit, and a tall strip (animation frames) shows its top square;
 * - a built-in block texture by name: `'oak_planks'`, `'glass'`, `'neon_red'`, `'grass_top'`;
 * - a colour, mottled: `{ color: '#8a8f96', noise: 0.25 }`. `noise` 0..1 (default 0.12) is how
 *   much it varies, `scale` the size of its blotches in pixels (default 2), `seed` another
 *   pattern. Several colours (`['#5b3a1e', '#6e4827', '#82562f']`) are picked between by the
 *   noise, pixel-art style;
 * - pixel art: 16 rows of 16 characters, each a colour from `palette` (`.` or a character not in
 *   it is clear);
 * - painted by code: `paint(x, y)` gives each pixel's colour (`null`: clear), row 0 at the top.
 */
export type BlockTexture =
  | string
  | { color: string | string[]; noise?: number; scale?: number; seed?: number }
  | { pixels: string[]; palette: Record<string, string> }
  | { paint(x: number, y: number): string | null };

/**
 * A block's textures face by face: `top`, `bottom`, the four `side`s, or one side (`north`,
 * `south`, `east`, `west`); `all` for any face not given. A block that faces a way
 * (`BlockDefinition.facing`) is written facing north: its `front` (the north face) and `back`.
 */
export interface BlockFaces {
  all?: BlockTexture;
  top?: BlockTexture;
  bottom?: BlockTexture;
  side?: BlockTexture;
  /** The face toward where it faces (as written, north). */
  front?: BlockTexture;
  /** The face opposite its front (as written, south). */
  back?: BlockTexture;
  north?: BlockTexture;
  south?: BlockTexture;
  east?: BlockTexture;
  west?: BlockTexture;
}

/** Anything that can be packed into generator data (the `Blueprint` class). */
export interface BlueprintLike {
  build(resolve: (block: BlockRef) => number): BlueprintData;
}

/** Serialisable structure produced by `Blueprint.build()`. */
export interface BlueprintData {
  origin: Vec3;
  size: Vec3;
  /** Block ids, index `(y * size.z + z) * size.x + x`; 255 = leave terrain untouched. */
  data: Uint8Array;
}

// ---------------------------------------------------------------------------------------------
// Player
// ---------------------------------------------------------------------------------------------

/** A player (the same object as in `game.players`). */
export type Player = PlayerApi;

/** A player's Blockyard account, as games see it (`player.account`). */
export interface PlayerAccount {
  /** Stable forever: key what's kept for them by it. */
  id: string;
  /** Their name on the platform (unique); it can change. */
  name: string;
  /** Their avatar picture's address (their Discord one, by way of the game server: `/avatars/<id>`). */
  avatar: string | null;
}

/** Who did something: an entity, a player, or the world (explosions, the void, traps). Check `kind` to tell them apart. */
export type Actor = Entity | Player | 'world';

export interface DamageOptions {
  /** Who dealt the damage (for events and knockback direction). */
  source?: Actor;
  /** Knockback strength (0 = none, 1 = normal). */
  knockback?: number;
  /** Where the hit came from; defaults to the source position. */
  from?: Vec3;
  /** Show as a critical hit. */
  crit?: boolean;
  /** The item it was done with (its id), for kill feeds. */
  weapon?: string;
  /** A head hit (guns). */
  headshot?: boolean;
  /**
   * What did it, for the `damage` event (see `DamageCause`). The platform says for its own
   * guns, blades, arrows and falls; without it, a hit from someone is `melee` and anything else `world`.
   */
  cause?: DamageCause;
  /** The part of the target hit, when it's known (a bullet knows). */
  part?: 'head' | 'body';
  /** Blocks of wall a bullet went through before it hit (wall-banging, a gun's `penetration`). */
  through?: number;
}

export interface PlayerApi {
  /** Tells players from entities in an `Actor`. */
  readonly kind: 'player';
  /** Stable for the session (`local` in single-player). */
  readonly id: string;
  /** Over their head; a signed-in player's is their account's (unique on the platform). */
  readonly name: string;
  /** Their Blockyard account (signed in with Discord), or null: a guest, or a bot. */
  readonly account: PlayerAccount | null;
  /**
   * This player's own data in this game (their XP, unlocks, best times), kept for their account:
   * the same wherever and whenever they play it, in the public game or one of their own. A
   * guest's lasts until they leave (signing in is what keeps it).
   */
  readonly store: StoreApi;
  /**
   * A signed-in player's first time in this game since they claimed their name: that name. What
   * the game kept under it before accounts (`xp:${name}` in `game.store`) is theirs now, for the
   * game to move into `player.store` (the name is theirs, so nobody else can claim it). Null
   * otherwise, and after this visit.
   */
  readonly adopted: string | null;
  /**
   * Award one of the game's achievements (`meta.achievements`): kept for their account (a guest's
   * lasts the visit), and it pops up on their screen. True the first time; false if they had it
   * already, or they're a bot. An id the game doesn't list is a mistake: it's reported, and false.
   */
  achieve(id: string): boolean;
  /** Whether they have one of the game's achievements. */
  achieved(id: string): boolean;
  /**
   * Give them one of the game's cosmetics (`meta.cosmetics`), theirs to wear in every game: kept for
   * their account, and it pops up. False for a guest (they're told signing in keeps such things),
   * a bot, or an id the game doesn't list (reported). An achievement's `reward` gives one itself.
   */
  grant(id: string): boolean;
  /** This player's screen: HUD calls here reach only them (their wallet, their shop, their toasts). */
  readonly hud: HudApi;
  /** Sounds only this player hears (their coins, their kill). */
  readonly audio: AudioApi;
  /** Effects only this player sees (their screen shaking, a flash when they're hit). */
  readonly fx: FxApi;
  /** This player's keyboard and mouse. */
  readonly input: InputApi;
  /** This player's camera (drive it with `player.controller: 'none'`). */
  readonly camera: CameraApi;
  /** Feet position. */
  readonly position: Vec3;
  readonly eye: Vec3;
  readonly velocity: Vec3;
  /** Unit vector the camera looks along. */
  readonly look: Vec3;
  readonly yaw: number;
  readonly pitch: number;
  readonly onGround: boolean;
  health: number;
  maxHealth: number;
  readonly alive: boolean;
  readonly inventory: InventoryApi;
  teleport(pos: Vec3, yaw?: number, pitch?: number): void;
  /** Apply damage. Returns false if ignored (invulnerable, dead, or damage disabled). */
  damage(amount: number, opts?: DamageOptions): boolean;
  /** Give back health: at once, or bit by bit `over` that many seconds (a golden apple's regeneration; death ends it). */
  heal(amount: number, opts?: { over?: number }): void;
  /** Restore full health after death. */
  revive(): void;
  impulse(x: number, y: number, z: number): void;
  /**
   * Freeze movement (cutscenes, countdowns), or let them go (`false`). With `weapons: true` their
   * weapons are locked too while it lasts: no switching slots, aiming, reloading, firing or using
   * items, and a shot their screen fires anyway is refused (no rounds spent). The lock ends with
   * the freeze (`freeze(false)`, or a `revive`). A freeze before they're in play (at `playerJoin`)
   * holds when they press Play.
   */
  freeze(frozen: boolean, opts?: { weapons?: boolean }): void;
  /** Their body is frozen: `freeze`, dead, driving, or not in play yet. */
  readonly frozen: boolean;
  /**
   * Watching, not playing (`true`), or back in play (`false`; a `revive` ends it too). A
   * spectator flies anywhere, straight through blocks (sprint for speed, jump and crouch to rise
   * and sink), whether alive or dead. Nobody sees them, and nothing hits, hurts, chases or
   * collects near them: shots, blades, explosions, creatures, pickups and building all pass them
   * by, and their hotbar and hands are put away (what they carry stays theirs). A `freeze`
   * still holds them. Games decide who spectates (someone out of a match, waiting to respawn,
   * joining a full one); `alive` stays as it was, so a game's own checks keep working.
   */
  spectate(on: boolean): void;
  readonly spectating: boolean;
  /**
   * Put them in one of the game's `vehicles`, starting from `state` (plain numbers, booleans and
   * lists: it goes to their screen as data). From now on their controls drive it (the vehicle's
   * `step`, on the host and, ahead of it, on their own screen), `prop` (its model) is kept at its
   * `pose` on every screen, their camera is the vehicle's, and their body goes where it goes.
   *
   * `remote`: they steer it from where they stand (a guided missile, a drone, a turret's camera):
   * their body stays put, frozen, and everyone still sees it there (it can be shot, and a marker
   * or an orbit that follows them stays on it), while their controls and camera go to the vehicle.
   */
  drive<S extends object>(vehicle: string, state: S, opts?: { prop?: Prop; remote?: boolean }): Vehicle<S>;
  /** Out of their vehicle (their model stays where it was; remove it if it should go). */
  leaveVehicle(): void;
  /** The vehicle they're driving, if any. */
  readonly vehicle: Vehicle | null;
  /**
   * The solid prop they're riding (`Prop.solid`): the one they stand on, or jumped from and
   * haven't left. Null on the ground, swimming, flying.
   */
  readonly riding: Prop | null;
  /** Armour points, 0..20: each blocks 4% of incoming damage (Minecraft-style). Default 0. */
  armor: number;
  /** The first-person arm and held item. */
  readonly viewModel: ViewModelApi;
  /**
   * How others see this player: their figure's skin (Minecraft layout, origin in `atlas`), which
   * their own first-person arm wears too. Default: the game's `player.skin`.
   */
  setSkin(skin: [number, number], atlas?: string): void;
  /**
   * How others see this player: a model (`Models.gltf(...)`) instead of a skin, or null for the
   * game's (`player.model`, else the skin). With a `hand` node, their first-person arm is that part.
   */
  setModel(model: ModelSpec | null): void;
  /**
   * Dress their avatar in the game's colours (a team's kit): the top, bottoms and shoes, styles and
   * colours (`{ topColor: '#d33', accent: '#fff' }`), over what they chose; who they are (their
   * build, face, hair) stays theirs (`hatHair` cuts the hair close, under a helmet the game hangs
   * on them). Null: their own clothes again. For players in their avatars (a game without
   * `player.model` or `player.skin`, and none given them with `setModel`).
   */
  setUniform(uniform: Uniform | null): void;
  /**
   * Play one of their model's animation clips (by name) on their figure, on every screen: an
   * emote, a victory pose, a reload of its own. It blends over the platform's own animation (the
   * whole body, or a `layer`); null stops it, fading out. Only on glTF models with the clip.
   */
  animate(clip: string | null, opts?: ClipOptions): void;
  /** The colour of their name above their figure (team colours); null for white. */
  color: string | null;
  /** A bot (`game.bots`): driven by the game's code, not a person. */
  readonly bot: boolean;
  /** Crouching (or sneaking), and sliding (`movement.slide`). */
  readonly crouching: boolean;
  readonly sliding: boolean;
  /** Multiplies their movement speed (a power-up, a heavy load). Default 1. */
  speed: number;
  /**
   * Their movement abilities' states (`movement.abilities`), by name, live: read them for the HUD
   * (a cooldown), or change them (reset a cooldown, unlock a move); their screen follows.
   */
  readonly abilities: Record<string, any>;
  /** Ignore damage for this long (spawn protection); 0 ends it. */
  protect(seconds: number): void;
}

// ---------------------------------------------------------------------------------------------
// Bots
// ---------------------------------------------------------------------------------------------

/**
 * Players driven by the game's code instead of a person: they're in `game.players`, everyone sees
 * them like any player (a figure, a name, what they hold), and they move, jump, slide, swing and
 * shoot by the same rules, through the same controls a person has. Steer each one every tick
 * with `bot.controls`; what a person's keyboard and mouse would do, they do.
 */
export interface BotApi {
  /** A new bot, standing at the spawn; the game hears `playerJoin`. */
  add(name: string): Bot;
  /** It leaves (the game hears `playerLeave`). */
  remove(bot: Player): void;
  readonly all: readonly Bot[];
}

export interface Bot extends PlayerApi {
  readonly controls: BotControls;
}

/** A bot's keyboard and mouse. Held keys and buttons stay held until released; presses and clicks last one tick. */
export interface BotControls {
  /** Hold or let go of a key (KeyboardEvent.code: 'KeyW', 'ShiftLeft', 'Space'…). */
  hold(code: string, down?: boolean): void;
  /** Press a key this tick ('KeyR' to reload, 'Digit2' for the second slot). */
  press(code: string): void;
  /** Hold or let go of a mouse button (0 left: attack / fire; 2 right: use / aim). */
  button(b: number, down?: boolean): void;
  /** Click a mouse button this tick. */
  click(b: number): void;
  /** Turn to look (radians, like `player.yaw` and `pitch`), or toward a point. */
  look(yaw: number, pitch: number): void;
  lookAt(point: Vec3): void;
  /** Let go of every key and button. */
  release(): void;
  readonly yaw: number;
  readonly pitch: number;
}

// ---------------------------------------------------------------------------------------------
// First-person view model
// ---------------------------------------------------------------------------------------------

/**
 * How an item sits in the first-person hand. The arm is posed like Minecraft's first-person arm,
 * and the item is held upright in the fist, turned the way Minecraft shows it in first person:
 * - `sword`, `axe`: gripped at the handle, blade up (`item/handheld.json`).
 * - `bow`: held at its middle; drawing swings it up to aim (Java's first-person draw pose).
 * - `item`: potions, food, trinkets (`item/generated.json`).
 * - `block`: a small cube on the fist (`block/block.json`).
 * - `polearm`: two-handed, low at the right with the tip just under the crosshair (pikes, spears).
 * - `gun`: two hands on a gun (guns' default): at the hip, up to the eye to aim down the sights,
 *   down and across the chest to sprint.
 * - `throw`: a throwable (their default), up by the shoulder ready to throw; it's thrown with `toss`.
 */
export type HoldStyle = 'sword' | 'axe' | 'bow' | 'item' | 'block' | 'polearm' | 'gun' | 'throw' | (string & {});

/**
 * A 3D held item made of boxes, for things a 16x16 sprite can't do (pikes, staffs, shields).
 * Same conventions as entity model parts: sizes and offsets in pixels, Minecraft box UVs.
 * The item's length runs along +z (the tip end) and +y is up.
 */
export interface HeldModelSpec {
  /** Atlas the UVs refer to. Default `builtin`. */
  atlas?: string;
  parts: {
    size: [number, number, number];
    uv: [number, number];
    /** Box min corner, in pixels. */
    offset: [number, number, number];
    /** Degrees about X, Y, Z around the box centre. */
    rotation?: [number, number, number];
  }[];
  /** Where the hands hold it (pixels): the rear / main hand, and the front hand for two-handed styles. */
  grip?: [number, number, number];
  grip2?: [number, number, number];
  /**
   * Guns: the barrel's tip (flashes and tracers start there), the point that sits on the eye line
   * when aiming down the sights, and the magazine (a reload's hand goes there). Pixels. A glTF
   * model can mark all of these (and the grips) with empty nodes named `grip`, `grip2`, `muzzle`,
   * `sight` and `mag` instead.
   */
  muzzle?: [number, number, number];
  sight?: [number, number, number];
  mag?: [number, number, number];
  /**
   * A glTF or GLB model instead of boxes (`HeldModels.gltf`): its file, turned (degrees about X,
   * then Y, then Z) and scaled so it runs along +z to its tip, like the built-in ones.
   */
  gltf?: { url: string; rotation?: [number, number, number]; scale?: number };
}

/**
 * How an item is held. Every field is optional. `rotation` and `scale` take the same numbers as
 * a Minecraft model's `display.firstperson_righthand`.
 */
export interface HoldSpec {
  /** Base pose. Default: melee `sword`, bow `bow`, otherwise `item`. */
  style?: HoldStyle;
  /** Which hand. Default right. */
  hand?: 'right' | 'left';
  /** Sprite pixel `[x, y]` (0..16 from the top left) that sits in the fist. Swords: `[3, 12.5]`. */
  grip?: [number, number];
  /** Hold a 3D model (`HeldModelSpec`, e.g. `HeldModels.ironSword`). Without one, the icon is extruded into 3D. */
  model?: HeldModelSpec;
  /** Degrees about X, then Y, then Z. Swords: `[0, -90, 25]`. */
  rotation?: [number, number, number];
  /** Extra offset in pixels (camera axes: x right, y up, z back). */
  translation?: [number, number, number];
  /** Multiplies the style's scale (swords: 0.68; guns: 0.42 of the model's own size). */
  scale?: number;
  /** How a humanoid figure holds this gun (`HumanoidPoses`). Default: a pistol if it's short (`pistolUnder`), else a rifle. */
  stance?: 'rifle' | 'pistol';
  /**
   * How a humanoid figure holds this item, over its model's `poses` (docs/HUMANOID.md): this gun's
   * stance, its kick, its sprint carry, its reload (the pose and the hand's `cycle`), its action.
   */
  poses?: ItemPoses;
  /** Animation for attacking or using: built-in (`swing`, `punch`, `jab`, `drink`, `release`, `chop`, `stab`), registered with `viewModel.define`, or inline. */
  use?: string | ViewAnimation;
  /** The `gun` style's poses for this gun: whatever it gives goes over the defaults (see `GunHold`). */
  gun?: GunHold;
  /** An energy blade on its model (a saber's): light drawn along it wherever it's held or thrown (`BladeSpec`). */
  blade?: BladeSpec;
}

/**
 * An energy blade on a held model (`hold.blade`): a white-hot core in a halo of `color` that
 * blooms and flickers, from `start` (a fraction of the way from the model's `grip` to its
 * `muzzle`, the blade's tip; default 0.15) to the tip, leaving a fading arc as it's swung.
 */
export interface BladeSpec {
  color: string;
  start?: number;
  /** The halo's radius (metres; default 0.11), and how bright it is (default 5). */
  width?: number;
  glow?: number;
  /** A fading arc behind the swing (default on). */
  trail?: boolean;
}

/**
 * Where a gun sits in first person (the `gun` hold style), per gun. Camera space: x right, y up,
 * z back (so ahead is -z), in blocks, written for the right hand and mirrored for the left. Every
 * field is optional and goes over its default, so `{ ads: 0.36 }` changes only that.
 */
export interface GunHold {
  /**
   * The firing fist at the hip: [0.235, -0.255, -0.62], low at the right; a compact gun (a
   * pistol's length or less ahead of the hand) [0.12, -0.19, -0.52], nearer the middle.
   */
  fist?: [number, number, number];
  /** Which way the barrel points at the hip: nearly straight ahead, a touch inward and up ([-0.1, 0.045, -1]). */
  barrel?: [number, number, number];
  /** Cant about the barrel at the hip, radians (-0.22). */
  roll?: number;
  /** Sprinting: swung down and across the chest (radians: yaw 0.8, pitch -0.5, roll -0.45) and moved (blocks: [-0.08, -0.06, 0.08]). */
  sprint?: { yaw?: number; pitch?: number; roll?: number; move?: [number, number, number] };
  /** Sliding: leaning into it (roll, radians: 0.35) and moved (blocks: [-0.04, -0.03, 0.02]). */
  slide?: { roll?: number; move?: [number, number, number] };
  /**
   * How far ahead of the eye the `sight` point sits when aiming down the sights, in blocks. By
   * the gun's sight: iron sights 0.42, a `dot` or `holo` optic's window 0.3 (nearer, so it frames
   * more), a scope 0.46.
   */
  ads?: number;
  /**
   * The firing forearm's direction, from the fist toward the elbow: at the hip ([0.32, -0.74, 0.6])
   * and aiming ([0.22, -0.64, 0.74]). `forearm2` is the support arm's: [-0.52, -0.72, 0.48] and
   * [-0.4, -0.72, 0.56]. They needn't be unit length.
   */
  forearm?: { hip?: [number, number, number]; ads?: [number, number, number] };
  forearm2?: { hip?: [number, number, number]; ads?: [number, number, number] };
  /** A shot's kick back (blocks, 0.075) and muzzle rise (degrees, 7), per unit of recoil. */
  kick?: number;
  rise?: number;
  /**
   * Hands on the gun: 2 (the default: the support hand on `grip2`), or 1, a gun fired one-handed
   * (a revolver). With 1 the support hand is out of sight in first person, and comes up only to
   * reload (to the `mag` point, and away); a humanoid figure's free hand takes its stance's
   * `offHand` pose, and comes to the gun only to reload.
   */
  hands?: 1 | 2;
  /** A humanoid player's own arms on this gun, over their model's `firstPerson` (see `FirstPersonArms`). */
  arm?: FirstPersonArms;
}

/**
 * A humanoid player's own arms in first person (`GltfSpec.firstPerson` for the model, and a gun's
 * `hold.gun.arm` over that for one gun). Every value is optional.
 */
export interface FirstPersonArms {
  /**
   * Times life size: 1.2 (a little bigger, as shooters draw them, so the hands read round a gun).
   * The arms' size doesn't change with the gun's (`hold.scale`).
   */
  scale?: number;
  /**
   * The fists' size, times the arms' (1). A figure drawn with big stylized mitts (right at a
   * distance) can show life-size hands round the gun in first person with less, the forearms as
   * thick as ever; the fist still closes on the grip, and the wrist comes in to meet it.
   */
  hands?: number;
  /**
   * How far the firing and the support arm run from the wrist to the shoulder, in blocks
   * ([0.55, 0.72]), along the gun pose's `forearm` and `forearm2`: far enough that the shoulder is
   * off the screen, as in any shooter.
   */
  reach?: [firing: number, support: number];
  /**
   * The elbow, radians: 0 (the default), a straight arm, forearm and upper arm in one line from
   * the wrist to the shoulder. More bends it: the arm runs from the wrist to the same shoulder
   * (`reach` along `forearm`) with the elbow bent this much at rest, dropped down and out, and
   * the shoulder stays put as the hand moves (a reload, a kick), so the elbow bends and straightens
   * to follow. One number for both arms, or [firing, support]. A one-handed gun aimed at the eye
   * wants it (0.6 or so), with its `forearm.ads` running back toward the camera: the forearm then
   * drops away under the gun instead of crossing the screen.
   */
  bend?: number | [firing: number, support: number];
  /** Where the support fist sits from the handguard's near side, in the model's own blocks along the gun's axes (x out to the side we see, y up, z toward the muzzle; [0.01, -0.012, 0]). */
  support?: [number, number, number];
}

/**
 * One keyframe of a first-person animation. Values are offsets from the rest pose and default
 * to 0. `t` is normalised time (0..1); `ease` shapes the segment that ends at this key.
 * Written for the right hand; mirrored for the left.
 */
export interface ViewKey {
  t: number;
  /** Move the hand, in blocks (camera axes: x right, y up, z back). */
  move?: [number, number, number];
  /** Turn the hand (item and forearm together) about the grip: [pitch, yaw, roll] in radians. */
  hand?: [number, number, number];
  /** Turn only the item about the grip, same axes. */
  wrist?: [number, number, number];
  ease?: 'linear' | 'in' | 'out' | 'inOut';
}

/** Keyframes, or a function of normalised time for procedural motion. Duration in seconds. */
export type ViewAnimation =
  | { duration: number; keys: ViewKey[] }
  | { duration: number; sample(t: number): Omit<ViewKey, 't' | 'ease'> };

export interface ViewModelApi {
  /** Show the first-person arm and held item. Default true. */
  visible: boolean;
  /** Skin for the arm (Minecraft layout origin in `atlas`, default `builtin`); `null` hides the arm and keeps the item. */
  setSkin(skin: [number, number] | null, atlas?: string): void;
  /** Play an animation: a built-in name, one registered with `define`, or keyframes. `power` scales it. */
  play(anim: string | ViewAnimation, opts?: { power?: number; speed?: number }): void;
  /** Register a named animation for `play` and `HoldSpec.use`. */
  define(name: string, anim: ViewAnimation): void;
  /** Jolt the arm (recoil, being hit). */
  kick(strength?: number): void;
}

export interface ItemStack {
  item: string;
  count: number;
}

export interface InventoryApi {
  /** Nine hotbar slots. */
  readonly slots: readonly (ItemStack | null)[];
  readonly selected: number;
  readonly held: ItemStack | null;
  /**
   * A carried item's state, as its kind's kit keeps it (`ItemKind.state`: a gun's rounds), made
   * when first asked for; null if they carry none, or its kind keeps none.
   */
  state<S extends object = Record<string, unknown>>(item: string): S | null;
  /** Add items; returns the amount that did not fit. */
  give(item: string, count?: number): number;
  take(item: string, count?: number): boolean;
  count(item: string): number;
  /** Put a stack in hotbar slot `slot` (0 to 8), in place of whatever was there; `null` empties it (a drop, a swap). */
  set(slot: number, stack: ItemStack | null): void;
  select(slot: number): void;
  clear(): void;
}

// ---------------------------------------------------------------------------------------------
// Items
// ---------------------------------------------------------------------------------------------

/** A built-in sprite name, or a 16x16 region of a custom atlas registered with `items.atlas`. */
export type SpriteRef = BuiltinSprite | { atlas: string; x: number; y: number };

export type BuiltinSprite =
  | 'wooden_sword'
  | 'stone_sword'
  | 'iron_sword'
  | 'diamond_sword'
  | 'bow'
  | 'bow_pulling'
  | 'arrow'
  | 'health_potion'
  | 'heart';

export interface ItemBase {
  name: string;
  /**
   * A sprite, a picture of a glTF model, or `{ block }`: an item that looks like a block is shown
   * as the block in the hotbar, held as a little cube, and dropped as a spinning cube of it.
   * Optional: the game's client code can give it instead (`ItemLook`), and an item given one by
   * neither side shows a placeholder.
   */
  icon?: ItemIcon;
  /** How it is held and swung in first person (or given by the game's client code: `ItemLook`). */
  hold?: HoldSpec;
  /**
   * Its own sounds (built-in or `audio.define`d); each defaults to the platform's generic one.
   * Or given by the game's client code, with the voices defined there too (`ItemLook`).
   */
  sounds?: ItemSounds;
  /** Max stack size. Default 1 for weapons, 64 otherwise. */
  stack?: number;
  /** Higher-ranked weapons are auto-selected when picked up. */
  rank?: number;
  /**
   * Called when the player walks over a pickup of this item. Return true to consume it
   * immediately (e.g. hearts) instead of adding it to the inventory; play your own sound then.
   */
  onPickup?(game: GameContext, count: number, player: Player): boolean;
}

/**
 * How an item looks and sounds, given by the game's client code on each screen
 * (`client.items.look(id, look)`, in its `setup`) rather than by its server: its icon, how it's
 * held (its model, a gun's first-person poses), its sounds, a gun's tracer, a throwable's trail, a
 * bow's drawn sprite, the name the hotbar shows. Each field given goes over the server's
 * definition (`sounds` sound by sound) wherever the screen reads the item. The server then needs
 * no model files or voices: it names items (`{ item }` icons, `audio.play`'s `item`), and each
 * screen shows them as it has them.
 */
export interface ItemLook {
  /** The name this screen shows (the hotbar's label); the server's own messages use its own. */
  name?: string;
  icon?: ItemIcon;
  hold?: HoldSpec;
  sounds?: ItemSounds;
  /** Its kind's own look (a gun's `tracer`, a throwable's `trail`, a bow's `drawIcon`: see the kits' item types). */
  [field: string]: unknown;
}

/**
 * One of an item's own sounds, as each screen has it (`AudioApi.play`'s `item`): the item, which
 * of its `sounds`, and the pitch to play that at (default the call's own).
 */
export interface ItemSoundRef {
  id: string;
  sound: keyof ItemSounds;
  pitch?: number;
}

export interface ItemSounds {
  /** Melee swing, bow release, a gunshot, or using a consumable. Defaults: `swing`, `bow_shoot`, `gunshot`, none. */
  use?: SoundName;
  /** Guns: reloading (`gun_reload`), pulling the trigger on an empty gun (`gun_empty`), working a pump or bolt (`gun_cycle`). */
  reload?: SoundName;
  empty?: SoundName;
  cycle?: SoundName;
  /** A melee hit landing. Default `hit` (`crit` for critical hits). */
  hit?: SoundName;
  /** Starting to draw a bow. Default `bow_draw`. */
  draw?: SoundName;
  /**
   * Throwables use `draw` for pulling the pin (none by default), `use` for the throw (`whoosh`)
   * and `hit` for each bounce (`arrow_hit`, quiet); a molotov's `hit` is its bottle breaking.
   */
}

/**
 * Where bullets meet players (`SharedDefinition.hitscan`), for any item kit that casts them
 * (`ItemUse.hitscan`): how far back the host looks, and the hitboxes.
 */
export interface HitscanOptions {
  /**
   * The furthest back a shot looks for its target, in seconds (0.35). The host checks each shot
   * against where people were on the shooter's screen, but no further back than this, so a laggy
   * screen can't hit someone where they were a second ago.
   */
  rewind?: number;
  /** Players' hitboxes for bullets, standing, crouching and sliding: what's given goes over each stance's default (see `PlayerHitbox`). */
  hitboxes?: { stand?: Partial<PlayerHitbox>; crouch?: Partial<PlayerHitbox>; slide?: Partial<PlayerHitbox> };
}

/**
 * A player's hitboxes in one stance, in blocks up from their feet: the body from the feet to
 * `neck`, the head from there to `height`, `width` across the body and `headWidth` across the
 * head (both square). Standing `{ height: 2, neck: 1.5, width: 0.72, headWidth: 0.56 }`;
 * crouching 1.7, 1.2, 0.76, 0.6; sliding (leaning back from the hips: lower and wider) 1.4, 0.85,
 * 0.9, 0.9. They match the figure everyone sees.
 */
export interface PlayerHitbox {
  height: number;
  neck: number;
  width: number;
  headWidth: number;
}

/**
 * An item, as a game defines it (`items.define`): what every item has (`ItemBase`), the `kind`
 * whose kit makes it work (see `ItemKind`: `'melee'`, `'gun'`, a kind of the game's own), and that
 * kind's own fields (a gun's `magazine`: see the kits' types in `@platform/items`, `GunItem`).
 * An item whose kind no listed kit makes (`'misc'`) is carried, dropped and given, and nothing else.
 */
export type ItemDefinition = ItemBase & { kind: string };

/**
 * An item's own icon: a sprite, a block's picture, or a picture of a glTF model (`{ gltf: url }`,
 * drawn once it has loaded; `view: 'side'` draws it from the side, the way kill feeds show guns).
 */
export type ItemIcon = SpriteRef | { block: string } | { gltf: string; view?: 'iso' | 'side' };

/**
 * An icon anywhere the HUD shows one (a feed line, a menu entry, a result screen, client code's
 * `client.hud.icon`): any item icon, or `{ item: id }`, that item's icon as each screen has it
 * (its look, from the game's client code: `client.items.look`), so a server names an item rather
 * than sending a picture of it. `view: 'side'` draws a model's picture from the side
 * (`{ item: 'rifle', view: 'side' }` in a kill feed).
 */
export type IconRef = ItemIcon | { item: string; view?: 'iso' | 'side' };

export interface Pickup {
  readonly id: number;
  readonly item: string;
  readonly count: number;
  readonly position: Vec3;
  /** False once collected, despawned or removed. */
  readonly alive: boolean;
  remove(): void;
}

/**
 * Raw atlas pixels (for art painted in code): sRGB RGBA, row 0 at the top, plus an optional
 * glow map (one byte per texel, 0..255) for emissive parts like eyes and fire.
 */
export interface AtlasPixels {
  width: number;
  height: number;
  pixels: Uint8Array;
  emissive?: Uint8Array;
}

export interface ItemApi {
  /** An item of the game's (`ItemDefinition`: what every item has, its `kind`, and that kind's own fields: type it with its kit's, `satisfies GunItem`). */
  define<D extends ItemDefinition>(id: string, def: D): void;
  get(id: string): ItemDefinition | undefined;
  /** The running kind of item this game lists (`items`), by its `kind` (`'gun'`): its kit's hooks and helpers. Null if it isn't listed. */
  kind<K extends ItemKind = ItemKind>(kind: string): K | null;
  /**
   * Drop an item into the world. `beam` adds a light pillar so players can find it. `for`: only
   * that player can pick it up (a reward each); once they've left, anyone can. `delay`: seconds
   * before anyone can take it (default 0.5). `from`: who threw it (a drop): it isn't pulled back
   * to them until they've once been out of its reach.
   */
  spawnPickup(item: string, at: Vec3, opts?: { count?: number; velocity?: Vec3; beam?: string; despawn?: number; for?: Player; delay?: number; from?: Player }): Pickup;
  clearPickups(): void;
  /** Register a custom sprite / skin atlas from any canvas (e.g. drawn with Canvas 2D). */
  atlas(name: string, source: HTMLCanvasElement | OffscreenCanvas | AtlasPixels): void;
}

// ---------------------------------------------------------------------------------------------
// Entities
// ---------------------------------------------------------------------------------------------

/** Box model description (see `Models`). Units are texels, 16 per block. */
export interface ModelSpec {
  rig: 'humanoid' | 'spider' | 'static' | 'gltf';
  parts: ModelPart[];
  /** Skin atlas (`builtin` or a name registered with `items.atlas`). */
  atlas: string;
  /** Uniform scale applied to the whole model. */
  scale: number;
  /** A glTF model (`Models.gltf`) instead of boxes. */
  gltf?: GltfSpec;
  /**
   * A box humanoid on the humanoid rig (docs/HUMANOID.md) instead of animating itself: its body,
   * arms and legs are jointed at the waist, elbows and knees, client code poses it (the figures
   * kit), and what's worn (cosmetics) hangs from its joints. Players' bodies always are.
   */
  skeleton?: boolean;
}

/**
 * A glTF / GLB model for a figure (`Models.gltf`): the file, and which of its animations play
 * when. Each player's screen fetches the file itself (a game imports it: `import zombie from
 * './models/zombie.gltf?url'`); a host never opens it.
 */
export interface GltfSpec {
  /** Where the file is: a game's own (imported with `?url`) or any address. */
  url: string;
  /**
   * The model's animations (by name) for what the figure does. A list plays together (a model
   * split into upper and lower body: `['walk_upper', 'walk_lower']`). Missing ones fall back:
   * `run` to `walk`, `walk` to `idle`; without `idle`, the model stands still.
   */
  clips?: { idle?: string | string[]; walk?: string | string[]; run?: string | string[]; attack?: string | string[]; cast?: string | string[] };
  /** Turn the model this far about its up axis (radians) if it doesn't face +z like glTF models should. */
  yaw?: number;
  /** The node that turns to look (its name in the file). */
  head?: string;
  /** The node a held item hangs from (its name in the file). */
  hand?: string;
  /** Nodes not to draw (by name). A node named `hitbox` (a collision box) is never drawn. */
  hide?: string[];
  /**
   * `humanoid`: the model is built on the platform's humanoid rig (docs/HUMANOID.md: joints named
   * `hips`, `spine`, `chest`, `head`, `upperArmR` …) and the platform animates it in code: walking,
   * running and strafing, crouching, sliding, jumping, looking, a gun in both hands, a sword, a fall
   * on death. A model with those joints and no `clips` is taken to be one. Its parts may be rigid
   * (a mesh on each joint) or skinned (one mesh on a skeleton of bones).
   */
  rig?: 'humanoid';
  /**
   * A humanoid player's own arms in first person (its forearms and fists on what they hold), for
   * a model whose proportions want other numbers (see `FirstPersonArms`): `scale` times life size
   * (1.2), how far each arm `reach`es to its shoulder, the elbow's `bend` (0, straight), where the
   * `support` fist sits. A gun's `hold.gun.arm` goes over these for that gun.
   */
  firstPerson?: FirstPersonArms;
  /**
   * A skeleton named its own way (a Mixamo or Blender export) driving the humanoid rig: which of
   * its nodes (bones or not) is each of the rig's joints, e.g. `HumanoidJoints.mixamo`. Joints
   * left out go by the rig's own names. It may rest in any pose (a T-pose, bones turned every
   * which way): the rig works from where its joints are.
   */
  joints?: Partial<Record<HumanoidJoint, string>>;
  /** How a humanoid holds things and moves (`HumanoidPoses`); what's left out is the platform's own. */
  poses?: HumanoidPoses;
}

/** The humanoid rig's joints (docs/HUMANOID.md), and the empties at the centre of each fist's hold. */
export type HumanoidJoint =
  | 'hips'
  | 'spine'
  | 'chest'
  | 'neck'
  | 'head'
  | 'upperArmL'
  | 'lowerArmL'
  | 'handL'
  | 'upperArmR'
  | 'lowerArmR'
  | 'handR'
  | 'upperLegL'
  | 'lowerLegL'
  | 'footL'
  | 'upperLegR'
  | 'lowerLegR'
  | 'footR'
  | 'gripL'
  | 'gripR';

/**
 * How a humanoid figure (`rig: 'humanoid'`) holds things and moves: `Models.gltf(url, { rig:
 * 'humanoid', poses })`, per model (give every model of a game the same object for a game-wide
 * look). Every value is optional and defaults to the platform's own (docs/HUMANOID.md lists them).
 * Offsets are metres in the figure's own frame before its scale (x its left, y up, z ahead), held
 * items' from the middle of its shoulders; turns are radians `[tip, turn, roll]`: about its x (a
 * positive tip points the muzzle down), then its y (a positive turn is to its left), then along
 * the muzzle.
 */
export interface HumanoidPoses {
  /** A gun's or sword's size in the hands: world units per unit of its model. Default 0.52. */
  heldScale?: number;
  /** A gun at the shoulder, and a pistol held out in both hands. */
  rifle?: GunStance;
  pistol?: GunStance;
  /** A gun without a `hold.stance` is held as a pistol when it's shorter than this (metres, as held). Default 0.45. */
  pistolUnder?: number;
  /** Each shot: the gun back (metres) and tipped up (radians), dying away at `decay` a second. Default 0.05, 0.14, 22. */
  kick?: { back?: number; tip?: number; decay?: number };
  /** Sprinting with a gun: carried low across the chest, the muzzle down and to the left. */
  sprint?: HeldPose;
  /** Reloading: the gun tipped to show its magazine, the support hand to the magazine and to `belt` (the hips' space) and back every `cycle` seconds. */
  reload?: HeldPose & { cycle?: number; belt?: [number, number, number] };
  /**
   * Working a gun's action after each shot (`GunItem.action`): a `lever` (default: the gun dipped
   * and its muzzle rocked up, offset [0, -0.035, 0.01], turn [-0.2, 0, 0]) or a `hammer` cocked
   * (tipped up and canted in, offset [0, 0.01, 0], turn [-0.12, 0, 0.3]): the change to where the
   * gun is at its height, `time` seconds in and out (0.45, 0.26), a beat (0.08 s) after the shot.
   */
  lever?: HeldPose & { time?: number };
  hammer?: HeldPose & { time?: number };
  /** A sword in both hands: low, the blade up and forward; a swing (the item's attack) lifts it for `windup` of `time` seconds and chops. */
  sword?: HeldPose & { swing?: { time?: number; windup?: number; raise?: HeldPose; chop?: HeldPose } };
  /** The fall on death: seconds to the ground, and how often it's backward (0..1). Default 0.65, 0.65. */
  death?: { time?: number; backward?: number };
  gait?: HumanoidGait;
}

/** Where a held gun is: from the hip, and aiming down the sights; the body's twist to it and the head's tilt to the sights. */
export interface GunStance {
  hip?: [number, number, number];
  ads?: [number, number, number];
  twist?: number;
  cheek?: number;
  /**
   * A gun held in one hand (`hold.gun.hands: 1`): where the free hand is, its fist's place from
   * the middle of the shoulders and its turn, both in the chest's frame (so it goes with the
   * body's lean and twist). Default: hanging loose at the side, offset [0.21, -0.56, 0.04], turn
   * [0, 0, 0]. A reload brings it to the gun.
   */
  offHand?: HeldPose;
}

/**
 * How a humanoid figure holds one item (`hold.poses`): the parts of `HumanoidPoses` about holding
 * things, over the figure's own for this item. Say only what differs: `{ reload: { cycle: 0.42 } }`
 * changes that and keeps the rest of the figure's reload pose.
 */
export type ItemPoses = Pick<HumanoidPoses, 'rifle' | 'pistol' | 'kick' | 'sprint' | 'reload' | 'sword' | 'lever' | 'hammer'>;

/** A held item's place (from the shoulders' middle) and turn (from the body's), or a change to them. */
export interface HeldPose {
  offset?: [number, number, number];
  turn?: [number, number, number];
}

/**
 * Walking and running. Pairs are `[walking, running]`: the figure goes from one to the other as
 * its speed goes from `run[0]` to `run[1]` (blocks a second).
 */
export interface HumanoidGait {
  /** Default [3.5, 7.5]. */
  run?: [number, number];
  /** Ground covered in a stride, metres: default [1.15, 2.4]. */
  stride?: [number, number];
  /** How far each foot reaches ahead and behind (default [0.22, 0.52]), and how high it lifts ([0.1, 0.22]). */
  step?: [number, number];
  lift?: [number, number];
  /** The hips' bob (default [0.02, 0.055]) and the back's lean into it (radians, [0.04, 0.18]). */
  bob?: [number, number];
  lean?: [number, number];
  /** Empty hands swinging (radians, default [0.45, 0.95]). */
  armSwing?: [number, number];
  /** The hips' sway from side to side walking (default 0.018), each foot's distance from the middle (0.1), how far the hips drop to crouch (0.33). */
  sway?: number;
  width?: number;
  crouch?: number;
}

/** How a model's animation clip plays on a figure (`player.animate`, `entity.animate`). */
export interface ClipOptions {
  /** Keep playing it (until another, or `animate(null)`), or once. Default once. */
  loop?: boolean;
  /** Seconds to blend it in, and out when it ends or stops. Default 0.2. */
  fade?: number;
  /**
   * What it moves: `full` (default: over everything the platform animates), `upper` (the spine
   * and all on it: the legs keep walking), or a list of joints (the rig's names, or the model's
   * own node names), each with all that hangs from it.
   */
  layer?: 'full' | 'upper' | string[];
  /** Playback speed. Default 1. */
  speed?: number;
}

export interface ModelPart {
  name: string;
  /** Box size in texels (x, y, z). */
  size: [number, number, number];
  /** Minecraft-style box UV origin in the atlas. */
  uv: [number, number];
  /** Joint position in texels relative to the entity's feet (or the parent's joint). */
  pivot: [number, number, number];
  /** Box min corner relative to the pivot. */
  offset: [number, number, number];
  /** Rest pose rotation in radians (x, y, z). */
  rotation?: [number, number, number];
  parent?: string;
  /** Mirror the texture horizontally (left limbs). */
  mirror?: boolean;
}

/** AI: runs every frame for each living entity of the type. */
export type Behavior = (self: Entity, game: GameContext, dt: number) => void;

export interface EntityDefinition {
  name: string;
  model: ModelSpec;
  hitbox: { width: number; height: number };
  health: number;
  /** Walking speed in blocks per second. */
  speed: number;
  jump?: number;
  /** 0 = full knockback, 1 = immovable. */
  knockbackResistance?: number;
  ai?: Behavior;
  /** Items dropped on death. */
  drops?: { item: string; chance: number; count?: number }[];
  /** Show a boss bar while alive. */
  boss?: boolean;
  sounds?: { hurt?: SoundName; death?: SoundName; ambient?: SoundName };
  /** Particle colour for hits and death puffs. */
  bloodColor?: string;
  /** Ignores all damage (shopkeepers, scenery). */
  invulnerable?: boolean;
  /** An item it holds in its right hand (by id), as a player's figure does (`Entity.held` changes it). */
  held?: string;
}

export interface ProjectileSpec {
  /** A sprite (drawn on the diagonal, tip at the top right, like an arrow). Without one, a glowing bolt in the `glow` colour. */
  sprite?: SpriteRef;
  speed: number;
  gravity?: number;
  damage: number;
  knockback?: number;
  /** Arrows stick in walls for a few seconds. */
  sticky?: boolean;
  /** Emissive glow colour (fireballs). */
  glow?: string;
  /** Its hits are critical (the `damage` event's `crit`: a fully drawn bow's). */
  crit?: boolean;
  /** The item it's from, for the `damage` event (`weapon`). */
  weapon?: string;
}

export interface Entity {
  /** Tells entities from players in an `Actor`. */
  readonly kind: 'entity';
  readonly id: number;
  readonly type: string;
  readonly position: Vec3;
  readonly velocity: Vec3;
  health: number;
  readonly maxHealth: number;
  /** Armour points, 0..20: each blocks 4% of incoming damage, like the player's. Default 0. */
  armor: number;
  readonly alive: boolean;
  readonly onGround: boolean;
  /** The solid prop it stands on and rides (`Prop.solid`), if any. */
  readonly riding: Prop | null;
  /** Seconds since spawn. */
  readonly age: number;
  /** Free-form per-entity state for behaviours and games. */
  readonly data: Record<string, unknown>;
  /** Apply damage. Returns false if it didn't land (dead, invulnerable, or cancelled by a `damage` listener). */
  damage(amount: number, opts?: DamageOptions): boolean;
  heal(amount: number): void;
  kill(): void;
  /** Remove without a death animation or drops. */
  remove(): void;
  impulse(x: number, y: number, z: number): void;
  /** Path-find toward the player or walk straight to a point. */
  moveTo(target: Player | Vec3): void;
  /** Walk in a world-space direction (x, z), e.g. strafing. */
  moveDirection(x: number, z: number): void;
  stop(): void;
  /**
   * Fly in a world direction (x, y, z; a length under 1 is that share of its speed): weightless,
   * rising or sinking as it says, colliding with blocks. Call it every tick while it flies (a bat,
   * a wisp); `moveTo`, `moveDirection` or `stop` lands it, and it falls.
   */
  fly(x: number, y: number, z: number): void;
  /** Put it somewhere at once (a blink), standing still. */
  teleport(at: Vec3): void;
  /**
   * How big it is, times its type's: its hitbox (for walking, shots and blades) and its figure
   * grow together. Default 1 (a champion's 1.4).
   */
  size: number;
  jump(): void;
  /** Turn to face a point (otherwise entities face their movement). */
  lookAt(target: Player | Entity | Vec3 | null): void;
  /** The closest living player (null if nobody's alive). */
  nearestPlayer(): Player | null;
  /** A clear line from its eyes to them (to a player's eyes, an entity's middle, or a point). */
  canSee(target: Player | Entity | Vec3): boolean;
  distanceTo(target: Player | Entity | Vec3): number;
  /**
   * Play a model animation: `attack` swings arms, `raise` holds them up (wind-ups), `cast`, and
   * `none` ends those (and a clip). Any other name plays that clip of a glTF model, on every
   * screen, as `opts` say (as `player.animate`).
   */
  animate(name: 'attack' | 'raise' | 'cast' | 'none' | (string & {}), opts?: ClipOptions): void;
  /** Speed multiplier on top of the type's speed. */
  setSpeed(multiplier: number): void;
  /** Tint the model (flash on wind-up). */
  glow(color: string | null): void;
  /** The item in its right hand (by id; its type's `held` to begin with), or null: empty-handed. */
  held: string | null;
  /**
   * Fire a projectile at a target, arcing for its gravity. `spread`: radians of error either way.
   * `lead`: allow for a moving target's motion while it flies (`true`: most of it, 0.8; or the
   * fraction, 0 to 1).
   */
  shoot(spec: ProjectileSpec, target: Player | Entity | Vec3, opts?: { spread?: number; lead?: boolean | number }): void;
}

export interface EntityApi {
  define(type: string, def: EntityDefinition): void;
  spawn(type: string, at: Vec3, opts?: { yaw?: number; data?: Record<string, unknown> }): Entity;
  all(type?: string): Entity[];
  count(type?: string): number;
  near(center: Vec3, radius: number): Entity[];
  clear(): void;
  /** Fire a projectile from anywhere (traps, turrets). */
  projectile(spec: ProjectileSpec, from: Vec3, dir: Vec3, owner?: Entity | Player): void;
  /** The first living entity along a ray, stopping at solid blocks (what the crosshair is on); `margin` widens each body by that much (default 0.1). */
  raycast(origin: Vec3, dir: Vec3, maxDistance: number, opts?: { margin?: number }): { entity: Entity; distance: number } | null;
}

// ---------------------------------------------------------------------------------------------
// HUD, effects, audio, environment
// ---------------------------------------------------------------------------------------------

/** One part of a feed line: text, coloured text, or an icon. */
export type FeedPart = string | { text: string; color?: string } | { icon: IconRef };

export interface Scoreboard {
  title?: string;
  /** Headers of the columns after the name ('Kills', 'Deaths', 'Score'). */
  columns: string[];
  rows: { name: string; values: (string | number)[]; color?: string; player?: Player }[];
  /** A line under the table (time left, the score to win). */
  footer?: string;
  /** Keep it up whether or not Tab is held. */
  show?: boolean;
}

export interface MenuEntry {
  icon?: IconRef;
  label: string;
  /** Shown on the right (a price, a level). */
  detail?: string;
  /** A second line under the label. */
  note?: string;
  /** Greyed out and not clickable (can't afford, locked). */
  disabled?: boolean;
  /** Highlighted (owned, selected). */
  active?: boolean;
  onSelect?(): void;
}

export interface MenuOptions {
  title: string;
  subtitle?: string;
  sections: { title?: string; entries: MenuEntry[] }[];
  /** Called when the menu closes (Esc, the close button, or `close()`). */
  onClose?(): void;
}

export interface MenuHandle {
  /** Replace its contents (e.g. after a purchase). */
  update(opts: Partial<MenuOptions>): void;
  close(): void;
  readonly open: boolean;
}

export interface ScreenOptions {
  title: string;
  subtitle?: string;
  tone?: 'victory' | 'defeat' | 'neutral';
  /** A sprite, or any icon (`{ item: 'trophy' }`: the item's, as each screen has it). */
  icon?: IconRef;
  stats?: [string, string][];
  buttons: { label: string; primary?: boolean; onClick: () => void }[];
}

export interface HudApi {
  /** Big centred title, e.g. "Wave 3". */
  banner(title: string, subtitle?: string, opts?: { duration?: number; color?: string }): void;
  /** Persistent status line at the top (null hides it). */
  objective(text: string | null): void;
  /** Small labelled values in the top-right corner (null value removes the chip). */
  stat(id: string, label: string, value: string | number | null): void;
  bossBar(name: string, fraction: number, color?: string): void;
  hideBossBar(): void;
  toast(text: string): void;
  /**
   * A line in the message feed (top left): kill feeds, match events, chat. Lines stack, newest at
   * the bottom, and fade after a few seconds. `color` tints the line. A line can be parts: text,
   * coloured text and icons (`['Ann', { icon: { item: 'rifle', view: 'side' } }, { text: 'Bob', color: '#f55' }]`:
   * the rifle's icon as each screen has it, drawn from the side).
   */
  feed(text: string | FeedPart[], opts?: { color?: string }): void;
  /** A short pop-up under the crosshair ("+100", "Headshot!", "Double kill"): `big` for the big moments. */
  pop(text: string, opts?: { color?: string; big?: boolean; sub?: string }): void;
  /**
   * The scoreboard, shown while the player holds Tab (or kept up with `show`, at a match's end);
   * `null` removes it. Rows naming a `player` are theirs: that player sees their own highlighted.
   */
  scoreboard(board: Scoreboard | null): void;
  /** Modal screen with buttons; releases the mouse. Returns a function that closes it. */
  screen(opts: ScreenOptions): () => void;
  /** A labelled bar at the bottom left (shields, fuel, boost); `null` removes it. */
  meter(id: string, label: string, value: number | null, opts?: { color?: string; text?: string }): void;
  /**
   * A marker drawn over a world position (targets, waypoints); `null` removes it. With `edge`,
   * an off-screen target shows as an arrow on the screen edge.
   */
  marker(id: string, at: Anchor | null, opts?: MarkerOptions): void;
  /** Show or hide the default crosshair. */
  crosshair(visible: boolean): void;
  /** A round radar, in the bottom-right corner (or where its `at` puts it); `null` hides it. */
  radar(data: RadarData | null): void;
  /** A panel of clickable entries (shops, upgrade trees, level select); releases the mouse while open. The game keeps running. */
  menu(opts: MenuOptions): MenuHandle;
  /** A ring round the crosshair filling 0..1 (mining, charging, capturing); `null` hides it. */
  progress(fraction: number | null, opts?: { color?: string }): void;
  /**
   * Outline one block (the one being aimed at), with Minecraft's break cracks growing over it as
   * `progress` goes 0..1. `null` hides it. It stays until moved or hidden.
   */
  highlight(at: Vec3 | null, opts?: { progress?: number }): void;
  /**
   * Define a widget of the game's own: its markup, styles, place and buttons (see
   * `WidgetDefinition`). Once, in `setup`, from `game.hud` or any player's (a widget is the
   * game's, whoever shows it). Defining it again with other markup redraws it wherever it's up.
   */
  define(name: string, widget: WidgetDefinition): void;
  /**
   * Put a defined widget up on these screens (everyone's from `game.hud`, one player's from
   * `player.hud`), filled in from `data`, and get its handle. Calling it again (every tick is
   * fine) changes what it shows: only what changed goes to the screens.
   */
  widget(name: string, data?: WidgetData): WidgetHandle;
}

/**
 * What a widget is filled in from: text, numbers, flags, and lists and records of them (anything
 * else, a function say, is left out).
 */
export type WidgetData = { readonly [key: string]: unknown };

/** Where a widget sits: a corner, the middle of an edge, or the centre (widgets in one place stack). */
export type WidgetAnchor = 'top-left' | 'top' | 'top-right' | 'left' | 'center' | 'right' | 'bottom-left' | 'bottom' | 'bottom-right';

/**
 * A HUD widget of the game's own: HTML and CSS, filled in from data on each player's screen.
 *
 * ```ts
 * game.hud.define('streak', {
 *   at: 'bottom-left',
 *   html: `<div class="card" data-if="streak > 0">Streak <b>{{streak}}</b>
 *            <span class="pip" data-each="pips" style="--c: {{color}}"></span></div>`,
 *   css: `.card { background: #111c; padding: 6px 10px } .pip { background: var(--c) }`,
 * });
 * player.hud.widget('streak', { streak: 3, pips: [{ color: 'gold' }, { color: 'gold' }] });
 * ```
 *
 * The markup's template: `{{name}}` in text and attributes (`me.kills`, `rows.0.name`; in a list,
 * the item's fields, `.` for the item itself, `$i` / `$n` for its place from 0 / 1);
 * `data-if="cond"` shows an element while `cond` holds (`uav`, `!uav`, `kills >= 3`,
 * `state == 'low'`); `data-each="rows"` repeats an element for each item of a list (a
 * scoreboard's rows). Bind CSS variables in `style` (`style="--fill: {{hp}}"`) to drive bars and
 * colours from data. Scripts, `on…` attributes, links, frames, forms and pictures from other
 * sites are left out; `id` and `name` too.
 */
export interface WidgetDefinition {
  html: string;
  /**
   * Its styles, kept to it: `.row` is its own `.row`, `:scope` the widget itself. Its
   * `@keyframes` are its own; `@media` and `@supports` work; `@import` and `@font-face` don't.
   */
  css?: string;
  /** Where it sits (default `top-left`); its `:scope` CSS can nudge it from there (`margin-top`). */
  at?: WidgetAnchor;
  /**
   * Takes the mouse while it's up, like a menu: the player can click its buttons (a controller's
   * D-pad moves between them, A presses), and Esc, B or a click outside closes it.
   */
  modal?: boolean;
  /**
   * What its buttons do: `<button data-action="buy" data-value="{{id}}">` calls `buy(player,
   * value)`, with the player who pressed it (only while it's on their screen). The value comes
   * from their screen: check it like any input.
   */
  actions?: Record<string, (player: Player, value: string) => void>;
  /** A `modal` widget closed by the player (it's off their screen now). */
  onClose?(player: Player): void;
}

/** A widget on some screens (`hud.widget`): change it, or take it down. */
export interface WidgetHandle {
  readonly name: string;
  /** Change what it shows (it's merged in, records field by field; `null` clears a field). Only what differs goes out. */
  set(data: WidgetData): void;
  /** Take it off these screens (`widget(name, data)` puts it back). */
  remove(): void;
  /** Whether it's up on these screens. */
  readonly shown: boolean;
  /** What it shows there now. */
  readonly data: WidgetData;
}

/**
 * Where a marker or radar blip is: a spot, or something it follows (a prop, an entity, a player).
 * Followed things are placed by each player's screen every frame, where that screen draws them
 * (smooth, and where prediction has a pilot's own ship), and sent only once.
 */
export type Anchor = Vec3 | Prop | Entity | Player;

export interface MarkerOptions {
  /** Offset from what it follows: in a prop's own space (`{ z: -30 }` is 30 ahead of a ship's nose), else in the world. */
  offset?: Vec3;
  color?: string;
  /** `box` (target brackets), `diamond`, `ring`, `reticle` (aiming sight), `dot`. */
  shape?: 'box' | 'diamond' | 'ring' | 'reticle' | 'dot';
  /** Size in pixels, or `{ world: n }` to scale with distance like an object n blocks wide. */
  size?: number | { world: number; min?: number; max?: number };
  label?: string;
  /** A second, smaller line under the label (a player's title, on their name tag). */
  sub?: string;
  /** Arrow on the screen edge when off-screen. */
  edge?: boolean;
  /** Pulse (locks, warnings). */
  pulse?: boolean;
  /** A bar under the label, 0..1 (a health bar over someone's head). */
  bar?: number;
}

export interface RadarData {
  /** The middle of the radar: a spot, or something to follow (a pilot's ship). */
  center: Anchor;
  /**
   * Heading in radians (0 = looking toward -z, like `player.yaw`); the radar turns with it.
   * Following a prop, leave it out to turn with the prop.
   */
  heading?: number;
  /** Blocks from the centre to the rim. */
  range: number;
  /** Blips at spots (`x`, `z`, and `y` for the above / below tick), or following things (`at`). */
  blips: RadarBlip[];
  /**
   * Where it sits: in a corner of its own, bottom right (the default), or in a place the game's
   * widgets use (`'top-right'`), under the widgets there (it moves as they grow and shrink).
   */
  at?: WidgetAnchor;
}

export type RadarBlip = ({ x: number; z: number; y?: number } | { at: Anchor }) & { color: string; size?: number };

export interface FxApi {
  /** Particles: `glow` makes them emissive, `life` (seconds) and `drag` shape trails and smoke. */
  burst(at: Vec3, opts?: { color?: string; count?: number; speed?: number; size?: number; gravity?: number; glow?: number; life?: number; drag?: number }): void;
  shake(strength: number, duration?: number): void;
  flash(color: string, strength?: number, duration?: number): void;
  shockwave(at: Vec3, radius: number, color?: string): void;
  damageNumber(at: Vec3, amount: number, opts?: { crit?: boolean; color?: string }): void;
  fireworks(at: Vec3, count?: number): void;
  /** Fireball, smoke, shockwave, sound and a shake scaled by distance. `size` 1 = a small vehicle. */
  explosion(at: Vec3, opts?: { size?: number; color?: string }): void;
}

/** Sounds the platform provides (its own systems use them; games may too). */
export type BuiltinSound =
  | 'swing'
  | 'hit'
  | 'crit'
  | 'hurt'
  | 'mob_hurt'
  | 'mob_death'
  | 'bow_draw'
  | 'bow_shoot'
  | 'arrow_hit'
  | 'pickup'
  | 'heal'
  | 'wave'
  | 'victory'
  | 'defeat'
  | 'spawn'
  | 'click'
  | 'countdown'
  | 'explosion'
  | 'explosion_big'
  | 'lock'
  | 'alarm'
  | 'whoosh'
  | 'gunshot'
  | 'gun_reload'
  | 'gun_empty'
  | 'gun_cycle'
  | 'hitmarker'
  | 'kill'
  | 'bounce'
  | 'glass'
  | 'fire';

/** A built-in sound, or one a game added with `audio.define`. */
export type SoundName = BuiltinSound | (string & {});

/** Continuous sounds: `engine` (a throttling thruster roar) and `wind`. */
export type LoopName = 'engine' | 'wind';

export interface LoopHandle {
  /** `pitch` 1 = normal; 0..1 volume. */
  set(opts: { volume?: number; pitch?: number }): void;
  stop(): void;
}

/**
 * What a voice (a game-defined sound, `client.audio.define`) makes its sound from: layers of
 * tones and noise, each with its own envelope. Frequencies are Hz; times are seconds from the
 * start of the sound; `pitch` is the play's pitch multiplier (apply it yourself).
 *
 * Each layer rises over `attack`, stays at its `volume` for `hold`, then dies away over `duration`
 * (so it lasts `attack + hold + duration`).
 */
export interface SynthKit {
  /** The play's pitch (1 = as written): multiply frequencies by it. */
  readonly pitch: number;
  /** An oscillator sweeping `from` -> `to` (exponential) over `duration`, or along `glide`. */
  tone(o: {
    wave?: OscillatorType;
    from: number;
    to?: number;
    duration: number;
    volume?: number;
    delay?: number;
    attack?: number;
    /** Seconds at full volume after the attack, before it dies away: a held note, a steady hum. */
    hold?: number;
    /**
     * The pitch's path instead of `to`: `[seconds, Hz]` points it slides through (exponentially)
     * from `from`. A blaster's bolt drops fast, then slower (`[[0.01, 1800], [0.04, 700], [0.15, 300]]`);
     * a swung blade rises and falls.
     */
    glide?: [number, number][];
    /**
     * Frequency modulation: a sine at `ratio` times the tone's frequency bends its pitch by `depth`
     * times that frequency, easing to `to` times by the end if given. Whole ratios make it richer
     * (brass, buzz); others ring like metal (1.41, 2.76). `depth` 0.3 shimmers, 1 is rich, 3 clangs.
     */
    fm?: { ratio: number; depth: number; to?: number };
    /** Distortion, 0..1: grit, crackle, a harsher edge. */
    drive?: number;
    /** A lowpass filter (Hz), or one sweeping from `freq` to `to` over `time` seconds (default the whole tone). */
    lowpass?: number | { freq: number; to?: number; q?: number; time?: number };
    /** A highpass filter (Hz): thins the bottom out. */
    highpass?: number;
    /** A bandpass filter, sweeping from `freq` to `to` over the duration if given. */
    bandpass?: { freq: number; to?: number; q?: number };
    vibrato?: { rate: number; depth: number };
  }): void;
  /** Filtered white noise, the filter sweeping `from` -> `to` over `duration`. */
  noise(o: { duration: number; from: number; to?: number; filter?: BiquadFilterType; q?: number; volume?: number; delay?: number; attack?: number; hold?: number }): void;
}

export type SynthVoice = (s: SynthKit) => void;

/**
 * A continuous sound's layers (`client.audio.defineLoop`): steady tones and noise. The loop's
 * `pitch` moves every frequency (and filter) of them together, its `volume` their loudness.
 */
export interface LoopKit {
  /** A steady oscillator at `freq` Hz (see `SynthKit.tone` for `fm`, `drive`, `vibrato`). */
  tone(o: {
    wave?: OscillatorType;
    freq: number;
    volume?: number;
    lowpass?: number;
    highpass?: number;
    bandpass?: { freq: number; q?: number };
    vibrato?: { rate: number; depth: number };
    fm?: { ratio: number; depth: number };
    drive?: number;
  }): void;
  /** Steady noise through a filter at `freq` Hz. */
  noise(o: { freq: number; filter?: BiquadFilterType; q?: number; volume?: number }): void;
}

export type LoopVoice = (l: LoopKit) => void;

/** A continuous sound on this screen (`client.audio.loop`): moved, changed and stopped as it goes. */
export interface ClientLoop {
  /** Its loudness (0..1), its pitch (1 = as defined; it scales every frequency) and where it is (none: everywhere). */
  set(o: { volume?: number; pitch?: number; at?: Vec3 | null }): void;
  stop(): void;
}

/**
 * How the world sounds on this screen (`client.audio.acoustics`), for every sound from then on.
 * Without it sounds only fade with distance, dry.
 */
export interface Acoustics {
  /** Distance muffles: a sound far off loses its highs, as through air (1: as outdoors; 2: thicker; 0: never). */
  air?: number;
  /**
   * A shared reverb, the space's echo: how much of each sound goes into it close by (`near`) and
   * 100 blocks off (`far`); how long its tail rings (`seconds`), and how dark it is (`damp`, 0..1).
   * Far sounds come mostly as their echo. A voice can take less of it or none (`define`'s `reverb`).
   */
  reverb?: { near?: number; far?: number; seconds?: number; damp?: number };
}

export interface AudioApi {
  /**
   * Play a sound: at a spot (fainter further off), or everywhere. `item` plays one of an item's own
   * sounds instead, as each screen has them (the server's `sounds`, or its look's: `ItemLook`),
   * where it has that one; `name` plays where it hasn't.
   */
  play(name: SoundName, opts?: { at?: Vec3; volume?: number; pitch?: number; item?: ItemSoundRef }): void;
  /** Start a continuous sound; keep the handle to change it and stop it. */
  loop(name: LoopName, opts?: { volume?: number; pitch?: number }): LoopHandle;
}

export interface EnvApi {
  /** Time of day (0..1). */
  time: number;
  frozen: boolean;
}

/** What a hit was done with, when a weapon did it: its item id, and whether it was a head hit. */
export interface HitDetails {
  weapon?: string;
  headshot?: boolean;
  /** Blocks of wall the bullet went through first (wall-banging). */
  through?: number;
}

/**
 * What did some damage: the platform's own causes, a melee hit (a mob's swing, anything from
 * someone without its own cause), a projectile (an arrow, a fireball), an explosion (`world.explode`
 * with `damage`), or the world (a fall, `'world'` damage); or an item kit's own (the gun kit's
 * `'gun'`, the throwable kit's `'explosion'` and `'fire'`, the melee kit's `'melee'`).
 */
export type DamageCause = 'melee' | 'projectile' | 'explosion' | 'world' | (string & {});

/**
 * Damage about to land on a player or a creature (the `damage` event), before armour and before
 * their health changes. A listener can change `amount` or `knockback`, or `cancel()` it (then it
 * doesn't land at all: no hurt, no knockback, no `playerDamage` or `entityDamage`, and a gun's
 * shooter gets no hit marker).
 */
export interface DamageEvent extends HitDetails {
  readonly target: Player | Entity;
  /** How much, before armour. Change it to deal more or less; 0 or less is the same as cancelling. */
  amount: number;
  knockback: number;
  /** Who dealt it (an entity, a player, the world), if anyone said. */
  readonly source: DamageOptions['source'];
  readonly cause: DamageCause;
  /** The part hit, when it's known (bullets: `head` or `body`). */
  readonly part?: 'head' | 'body';
  /** Where it came from, if anywhere. */
  readonly from?: Vec3;
  readonly crit: boolean;
  readonly cancelled: boolean;
  cancel(): void;
}

export interface GameEvents {
  /**
   * Any damage about to land, from anything (a gun, a blade, an arrow, a fall, your own `damage`
   * call): change it or cancel it (see `DamageEvent`). Listeners run in the order they were added.
   */
  damage: DamageEvent;
  entityDamage: { entity: Entity; amount: number; source: DamageOptions['source'] } & HitDetails;
  entityDeath: { entity: Entity; killer: DamageOptions['source'] } & HitDetails;
  playerDamage: { player: Player; amount: number; source: DamageOptions['source'] } & HitDetails;
  playerDeath: { player: Player; source: DamageOptions['source'] } & HitDetails;
  /** A gun went off (every shot; a shotgun's pellets are one shot). */
  shot: { player: Player; weapon: string; from: Vec3; dir: Vec3 };
  pickup: { player: Player; item: string; count: number };
  /** A player joined a game in progress (multiplayer). */
  playerJoin: { player: Player };
  /**
   * A person's screen is in play: they pressed Play (after `start`, for the first). On a server
   * that's right after their `playerJoin`; in single-player, the first click on Play. The place
   * for what needs their screen (a modal widget, a welcome). Bots have no screen: not for them.
   */
  playerReady: { player: Player };
  /** A player left (multiplayer). They're no longer in `players`. */
  playerLeave: { player: Player };
  /** A block was broken by the player, an entity, an explosion or `world.breakBlock`. */
  blockBreak: { x: number; y: number; z: number; block: string; by: Actor };
  blockPlace: { x: number; y: number; z: number; block: string; by: Actor };
  /**
   * A block changed, however it happened: set, broken, placed, blown up, carved into (see
   * `world.carved`), or put back whole by a restart. One per block, after the change; `block` is
   * what's there now. For keeping something built from the world's blocks up to date (the
   * `navGrid` kit's walking grid).
   */
  blockChange: { x: number; y: number; z: number; block: string };
  /** A movement ability called `body.trigger(name)`: a dash began, a wall-jump (for sounds, effects). */
  ability: { player: Player; ability: string; name: string };
  /**
   * A message from the game's code on a player's screen (`client.send(name, data)`): who sent it
   * (the connection's player, whatever it says), its name, and its data (plain data, checked for
   * size and shape already). What it asks for is the game's to check: any client can send anything.
   */
  clientMessage: { player: Player; name: string; data: unknown };
}

/**
 * Messages to the game's own code on players' screens (`client.ts`): they arrive at
 * `client.on(name, fn)` there, in order with the presentation calls. Bots have no screen.
 */
export interface ClientsApi {
  /**
   * To one player's screen, several players', or everyone's (`'all'`). `name`: a letter, then
   * letters, digits, `_`, `-`, `.` or `:` (at most 64). `data`: plain data (strings, numbers,
   * booleans, null, lists and records; functions and `undefined` are left out), at most 64 KB as
   * JSON. A bad name or too much data throws.
   */
  send(to: Player | readonly Player[] | 'all', name: string, data?: unknown): void;
}

/**
 * Replays (`game.replay`). The room keeps its last few seconds, step by step: everyone's places,
 * looks, poses and what they hold, creatures, props and pickups (the frames, as they went out), and
 * what was shown in each step (shots and what they hit, throws, effects, sounds, blocks shot into).
 * `show` plays a stretch of it on one player's screen, through someone's eyes or from a camera,
 * while the game goes on underneath: their own player stays where the game has them (dead,
 * waiting). Their screen draws it with the same figures and interpolation as the live game, and
 * its client code knows (`client.replay`: hide the HUD, say whose eyes these are).
 *
 * The world's blocks are shown as they are now: a block shot away during the replay is already
 * gone at its start.
 */
export interface ReplayApi {
  /** How many seconds back the room's history reaches now. */
  readonly seconds: number;
  /** Keep this many seconds (default 8, at most 30; 0 keeps none and turns recording off). */
  keep(seconds: number): void;
  /**
   * Play a stretch of the last few seconds on this player's screen (not a bot's: they have none).
   * A replay already playing there ends (its `onEnd` runs) and this one takes its place. Null:
   * nothing kept yet to show.
   */
  show(player: Player, opts?: ReplayOptions): ReplayHandle | null;
  /** End the player's replay now (its `onEnd` runs). */
  stop(player: Player): void;
  /** The replay playing on the player's screen, if any. */
  playing(player: Player): ReplayHandle | null;
  /**
   * Keep a stretch of the history for later (`show(player, { clip })`), past what the history
   * keeps: a play of the game, saved as it happens and shown once the match is over. `from` and
   * `seconds` as `show`'s. Null: nothing kept in that stretch.
   */
  clip(opts?: { from?: number | { at: number }; seconds?: number }): ReplayClip | null;
}

/** A stretch of a room's past, kept (`game.replay.clip`): shown with `game.replay.show(player, { clip })`, to as many players as like. */
export interface ReplayClip {
  /** The stretch it holds, by the game's clock. */
  readonly from: number;
  readonly to: number;
  /** How long it lasts (seconds, as it happened). */
  readonly seconds: number;
}

export interface ReplayOptions {
  /**
   * Where it starts: seconds ago (`from: 5`), or a moment by the game's clock
   * (`{ at: game.clock.now - 5 }`). Default: as far back as the history goes.
   */
  from?: number | { at: number };
  /** How long a stretch (seconds; default: up to now). It ends by now at the latest. */
  seconds?: number;
  /**
   * Through this player's eyes: their view, their hands and what they hold (first person), their
   * shots leaving their gun, and what their own screen showed (their effects and sounds).
   */
  follow?: Player;
  /** Or from a camera standing still: where it is and what it looks at (its field of view, degrees). */
  camera?: { at: Vec3; look: Vec3; fov?: number };
  /** Played this many times as fast as it happened (default 1; 0.25 to 4). */
  speed?: number;
  /** A clip kept earlier (`game.replay.clip`), shown whole, in place of the recent past (`from` and `seconds` aren't used). */
  clip?: ReplayClip;
  /**
   * Seconds its first frame stands still before it plays (at most 10; default 0), part of its
   * `duration`: a freeze-frame for a title to go over (`client.replay.hold`). The figures in it
   * stop where they are, and nothing it shows (shots, sounds) comes till it moves.
   */
  hold?: number;
  /** A name for its client code (`client.replay.label`: 'killcam'), and plain data to go with it. */
  label?: string;
  data?: unknown;
  /** The player may end it early (`client.replay.skip()`); default true. */
  skippable?: boolean;
  /**
   * It ended: played out, skipped by the player (`skipped`), stopped, or replaced by another. Not
   * called if the player leaves the game.
   */
  onEnd?(e: { player: Player; skipped: boolean }): void;
}

/** A replay playing on a player's screen. */
export interface ReplayHandle {
  readonly id: number;
  /** Seconds it plays for (at its speed, and its `hold`). */
  readonly duration: number;
  /** The stretch it shows, by the game's clock. */
  readonly from: number;
  readonly to: number;
  /** Still playing. */
  readonly playing: boolean;
  /** End it now (its `onEnd` runs). */
  stop(): void;
}

export interface EventApi {
  on<K extends keyof GameEvents>(event: K, fn: (e: GameEvents[K]) => void): () => void;
}

export interface ClockApi {
  /**
   * Seconds of game time since `start`: the match's clock. It pauses with the game, and a
   * `restart()` puts it back to 0 (with the timers, which it clears).
   */
  readonly now: number;
  /**
   * Seconds of game time since the game first started, which a `restart()` doesn't reset: for
   * what outlives a match (a cooldown across restarts, when someone joined). Pauses with the game.
   */
  readonly total: number;
  after(seconds: number, fn: () => void): () => void;
  every(seconds: number, fn: () => void): () => void;
}

export interface Rng {
  /** Uniform in [0, 1). */
  next(): number;
  range(min: number, max: number): number;
  int(min: number, max: number): number;
  pick<T>(items: readonly T[]): T;
  chance(p: number): boolean;
}
