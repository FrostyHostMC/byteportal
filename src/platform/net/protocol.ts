/**
 * The simulation / client boundary.
 *
 * The simulation (world, players, entities, rules, the game's own code) runs headless and
 * describes what each player should see and hear; the client (renderer, HUD, audio, input)
 * shows it. Everything that crosses is plain data: the simulation runs on a game server (or in
 * Node, for tests) and each player's screen is at the other end of a socket.
 *
 * Functions never cross: a callback in a presentation call (a menu entry, a screen button) is
 * sent as `{ $cb: id }` and the client answers with a `callback` message.
 */

import type { PlatformModule } from '../package/link';
import type { AtlasPixels, EntityDefinition, ItemDefinition, Vec3, ViewAnimation } from '../api/types';
import type { BlueprintData } from '../api/blueprint';
import type { SimFrame } from '../sim/sim';
import type { WidgetWire } from '../ui/markup';

/**
 * Where a presentation call goes on the client. `message` is a message for the client code: the
 * game's own (`game.clients.send(to, name, data)`: `method` is its name, `args` `[data]`), the
 * platform's (named with a `$`: `$debris`, `$reset`), or an item kind's (`kit`: `gun.shot`,
 * `throwable.thrown`, `throwable.end`, `throwable.fire`).
 */
export type PresentTarget = 'hud' | 'fx' | 'audio' | 'view' | 'message';

/** One presentation call: `target.method(...args)` on one player's client (`to`), or everyone's. */
export interface PresentCall {
  to: string | null;
  /** For everyone (`to` null) but this player (whose own screen already showed it: their shot). */
  skip?: string;
  target: PresentTarget;
  method: string;
  args: unknown[];
  /** A message from an item kind's host half (`ItemHost.send`): drawn in the world, as the platform's `$` ones are (a replay keeps it). */
  kit?: true;
}

/**
 * An `Anchor` on the wire: a spot, or something to follow by id (each screen places it where it
 * draws it, every frame).
 */
export type AnchorRef = { x: number; y: number; z: number } | { $prop: number } | { $entity: number } | { $player: string };

/** `RadarData` on the wire. */
export interface RadarWire {
  center: AnchorRef;
  heading?: number;
  range: number;
  /** A widget place (`WidgetAnchor`) to sit in; its own corner if none (or one the screen doesn't know). */
  at?: string;
  blips: (({ x: number; z: number; y?: number } | { at: AnchorRef }) & { color: string; size?: number })[];
}

/** A callback in call arguments. */
export interface CallbackRef {
  $cb: number;
}

export const isCallbackRef = (v: unknown): v is CallbackRef => typeof v === 'object' && v !== null && typeof (v as CallbackRef).$cb === 'number';

/** Client to simulation: things a player did outside the per-frame input. */
export type ClientMessage =
  /** A callback the simulation sent (a menu entry, a screen button) was triggered. */
  | { t: 'callback'; player: string; id: number }
  /** A menu was closed on the client (Esc, the close button). */
  | { t: 'menuClosed'; player: string; menu: number }
  /** Creative building: put a block in the current hotbar slot (the block picker). */
  | { t: 'creativePick'; player: string; block: number }
  /** A button in a game's widget was pressed (`data-action`, with its `data-value`). */
  | { t: 'widgetAction'; player: string; widget: string; action: string; value: string }
  /** The player closed a modal widget (Esc, B, a click outside). */
  | { t: 'widgetClosed'; player: string; widget: string }
  /** A message from the game's client code (`client.send(name, data)`), for its server (`clientMessage`). */
  | { t: 'game'; player: string; name: string; data: unknown }
  /** The player ended the replay on their screen (`client.replay.skip()`): `id` is its `ReplayWire.id`. */
  | { t: 'replaySkip'; player: string; id: number };

/** A game's message name (either way): a letter, then letters, digits, `_`, `-`, `.` or `:` (the platform's own start with `$`). */
export const MESSAGE_NAME = /^[A-Za-z][\w.:-]{0,63}$/;

/** The most a game's message may carry, as JSON: from its server, and from a client. */
export const MESSAGE_MAX = { server: 64 * 1024, client: 8 * 1024 };

/**
 * One player's controls for one tick. The client owns mouse look (it feels immediate), so the
 * view direction arrives here too; the simulation moves the player and runs the game with it.
 */
export interface PlayerInput {
  /** Controls reach the game (playing, mouse captured, no menu open, alive). */
  active: boolean;
  /**
   * They'd reach the game but that the player's dead (`active` is false): the keys pressed reach
   * what asks for a dead player's keys (`InputApi.pressed(code, { dead: true })`: a vote, a menu).
   */
  dead?: boolean;
  /** Keys held and keys that went down this tick (KeyboardEvent.code). */
  down: string[];
  pressed: string[];
  /** Mouse buttons held and clicked this tick (bit masks: 1 left, 2 middle, 4 right). */
  buttons: number;
  clicked: number;
  mouseX: number;
  mouseY: number;
  wheel: number;
  /**
   * A controller's left stick, when it's pushed: [right, forward], each -1..1 (length at most 1).
   * Walking goes that way, as fast as it's pushed; the arrow keys and WASD still work alongside.
   */
  move?: [number, number];
  /** Where the player is looking (radians; yaw 0 looks toward -z). */
  yaw: number;
  pitch: number;
  /**
   * The last view the simulation set (`PlayerFrame.view.seq`) that this client has taken on. Until
   * it catches up, its `yaw` / `pitch` are stale and the simulation keeps its own.
   */
  viewSeq: number;
  /**
   * Guns: the shots this client fired with these controls, each [serial, yaw, pitch, spread in
   * degrees]. The client fires at once (it knows the gun's rate and rounds); the host takes each
   * shot the gun could have fired and decides what it hit.
   */
  shots?: [number, number, number, number][];
  /**
   * Throwables: the throws this client made with these controls, each [serial, item, x, y, z,
   * vx, vy, vz, seconds cooked]: from where, how fast. It flies them at once; the host takes each
   * one they could have thrown and flies it the same way, and decides when and where it goes off.
   */
  throws?: [number, string, number, number, number, number, number, number, number][];
  /**
   * What this screen's item kits did ahead of the host with these controls, by kind (see
   * `ClientKit.controls`): each a list of plain values, which the kind's host half takes or turns
   * down (`ItemKind.acts`). A kind listed here, even with none, is one this screen runs.
   */
  acts?: Record<string, unknown[][]>;
  /** The host time (`SimFrame.t`) of what this client was showing when it made these controls: shots hit where targets were then. */
  seen?: number;
}

export const IDLE_INPUT: PlayerInput = { active: false, down: [], pressed: [], buttons: 0, clicked: 0, mouseX: 0, mouseY: 0, wheel: 0, yaw: 0, pitch: 0, viewSeq: -1 };

// -------------------------------------------------------------------------------------------------
// Host and client
//
// A host runs a game's simulation on a world of its own; a client draws it. On a server the host
// keeps its own clock: each client sends its controls every frame (`input`) and gets a `HostBatch`
// every step, what happened in order, then the frame to draw. A test in Node drives a host's
// clock itself, one `tick` at a time.
// -------------------------------------------------------------------------------------------------

/**
 * Something the game defined for its look and sound, as data: the client's copy of `Content`.
 * Entity and item definitions arrive without their functions (behaviours and callbacks stay with
 * the simulation).
 */
export type ContentDef =
  | { kind: 'atlas'; name: string; source: AtlasPixels }
  | { kind: 'animation'; name: string; anim: ViewAnimation }
  | { kind: 'entity'; name: string; def: EntityDefinition }
  | { kind: 'item'; name: string; def: ItemDefinition }
  | { kind: 'model'; id: number; blueprint: BlueprintData; opts: { scale?: number; pivot?: Vec3 } }
  /** A glTF prop model (`props.gltf`): each client fetches the file. */
  | { kind: 'gltf'; id: number; url: string; opts: { scale?: number; animation?: string } }
  /** A HUD widget of the game's own (`hud.define`): its markup and styles; each screen checks them. */
  | { kind: 'widget'; name: string; def: WidgetWire };

/** What a host tells a client, in the order it happened. */
export type HostEvent =
  /** The game defined content (in `setup`, or later). */
  | { t: 'content'; def: ContentDef }
  /** A presentation call. */
  | { t: 'call'; call: PresentCall }
  /** Blocks changed: [x, y, z, block id]. */
  | { t: 'edits'; cells: [number, number, number, number][] }
  /**
   * Blocks were shot into (`world.carve`, guns): the little voxels taken from each, in the
   * engine's damage format (`VoxelWorld.apply_damage`). Taking them again changes nothing.
   */
  | { t: 'damage'; data: Uint8Array }
  /** Every edit this session was undone (a restart), and the damage with it. */
  | { t: 'revert' }
  /** Set up and placed: play can begin. */
  | { t: 'ready' }
  /** The game called `exit()`: for the client whose action it answered, or everyone. */
  | { t: 'exit'; client?: string }
  /** The answer to a request (`exec`, `complete`, `dev`), for the client who asked. */
  | { t: 'reply'; id: number; value: unknown; client?: string }
  /** This client is in the game now, as this player (a server's client, after `start`). */
  | { t: 'joined'; player: string; client: string }
  /** A stretch of the recent past for this player's screen to play back (`game.replay.show`). */
  | { t: 'replay'; player: string; replay: ReplayWire }
  /** The server ended this player's replay (its time was up, the game stopped it, it was skipped). */
  | { t: 'replayEnd'; player: string; id: number }
  /** The game threw (the host carries on). */
  | { t: 'error'; text: string };

/**
 * A replay as its viewer's screen gets it (`game.replay.show`): the room's frames over a stretch of
 * the last few seconds, as the frames went out (the first whole, then each a patch on the one
 * before, `net/delta`), with what was shown in each step. The screen plays it on its own clock,
 * through the same interpolation and figures as live frames, while the live game goes on under it.
 */
export interface ReplayWire {
  /** Its number (the room's): a skip names it. */
  id: number;
  steps: ReplayStep[];
  /** Whose eyes it looks through (a player's id), or null for `camera`. */
  follow: string | null;
  /** A camera of its own, standing still: where it is, what it looks at, its field of view (null: the viewer's own). */
  camera: { at: [number, number, number]; look: [number, number, number]; fov: number | null } | null;
  /** Played this many times as fast as it happened. */
  speed: number;
  /** Seconds its first frame stands still before it plays. */
  hold: number;
  /** The game's name for it and anything it sends with it, for its client code (`client.replay`). */
  label: string;
  data: unknown;
  /** Its viewer may end it (`client.replay.skip()`). */
  skippable: boolean;
}

/** One step of a replay: the host time it was, its frame (the first step's whole, then patches), and what was shown in it. */
export interface ReplayStep {
  t: number;
  f: unknown;
  e?: ReplayEvent[];
}

/**
 * What a replay shows besides its frames: the presentation calls made in a step (to everyone, and
 * effects, sounds and view calls to one player: a replay through their eyes shows theirs) and the
 * blocks shot into (rubble; the world itself is already as it is now).
 */
export type ReplayEvent = { t: 'call'; call: PresentCall } | { t: 'damage'; data: Uint8Array };

export interface HostBatch {
  events: HostEvent[];
  /** After a tick: the state to draw. */
  frame: SimFrame | null;
}

/** What a client tells its host. */
export type ClientCommand =
  /**
   * Advance the simulation `dt` seconds with this player's controls (idle without); `running` once
   * play began. Only a host driven by one client (tests) takes it: a server keeps its own clock.
   */
  | { t: 'tick'; dt: number; running: boolean; input?: PlayerInput }
  /**
   * A server's client: the player's controls now (the server keeps its own clock). A client that
   * predicts its own movement numbers each input (`seq`) and says how long it lasted (`dt`): the
   * server moves the player once per input, the way the client did, and reports the last applied.
   */
  | { t: 'input'; input: PlayerInput; seq?: number; dt?: number }
  | { t: 'message'; msg: ClientMessage }
  /**
   * Play begins (the title screen was clicked). On a server, a client that was watching joins the
   * game here, as `name`, in their avatar (`avatarCode`: a guest's; a signed-in player's is their account's).
   */
  | { t: 'start'; name?: string; avatar?: string }
  | { t: 'restart' }
  /** Time of day (the pause menu, `[` `]`), and the day length (settings). */
  | { t: 'env'; time?: number; dayLength?: number }
  /** How many columns around the player the host keeps (the client's view distance). */
  | { t: 'radius'; columns: number }
  /** Requests answered with a `reply`: run a typed command, complete one. */
  | { t: 'exec'; id: number; line: string }
  | { t: 'complete'; id: number; line: string }
  /**
   * Development tools (`__game.dev(js)`): run `js` in the room's server, with `game` (its
   * `GameContext`) and `me` (this client's `Player`, or null while watching) in scope. The reply
   * is a `DevReply`. A server takes it only in development mode (`npm run dev`); any other refuses.
   */
  | { t: 'dev'; id: number; js: string };

/** The answer to a `dev` command: the snippet's result as JSON, or what went wrong. */
export type DevReply = { ok: true; value: unknown } | { ok: false; error: string };

/** A room a player started of their own: its code, in its address (`wss://host/bedwars/k3x9f2`). */
export const ROOM_CODE = /^[a-z0-9]{4,24}$/;

/** A new room's code: eight letters and digits, hard to guess. */
export function newRoomCode(): string {
  const abc = 'abcdefghijklmnopqrstuvwxyz0123456789';
  return Array.from(crypto.getRandomValues(new Uint8Array(8)), (b) => abc[b % abc.length]).join('');
}

/**
 * Why a server turned a connection away (its close code): the room's full or the server's busy
 * (try again soon), too much from one address, no such game or room (don't).
 */
export const CLOSE_FULL = 4001;
export const CLOSE_LIMIT = 4002;
export const CLOSE_UNKNOWN = 4004;

/** A server's first message to a client: which game, which world, and who they are in it. */
export interface ServerWelcome {
  t: 'welcome';
  game: string;
  /** `public`, or the code of a room a player started of their own (`?room=`). */
  room: string;
  /**
   * In a copy of the public game (one started while the others were full): its number, 2, 3…, which
   * an invite link names (`?shard=2`) so a friend lands in it too. Absent in the first.
   */
  shard?: number;
  seed: number;
  /** Null: watching until the client sends `start` (then `joined` names the player). */
  player: string | null;
  /** Where players start: where a watching client's camera looks on. */
  spawn: { x: number; y: number; z: number; yaw: number };
  /** Steps per second. */
  tickRate: number;
  /**
   * A game the server hosts built (not compiled into the page: uploaded, see host/library.ts): the
   * version this room runs, and what the screen loads for it (its client code's address and the
   * platform modules that imports). A room keeps its version while it runs, whatever's current.
   */
  package?: { version: string; client: string; modules: PlatformModule[] };
  /**
   * The game's own blocks' keys in id order (from the first game block id): the client gives the
   * blocks it defines the same ids, so edits and structures agree even if its copy of the game
   * differs (an older version: a block it hasn't got shows as "missing").
   */
  blocks?: string[];
}

/** A batch from a server, stamped with the host's clock (seconds) for smooth playback. */
export interface TimedBatch extends HostBatch {
  time: number;
}

/**
 * A batch as a server sends it: the frame as a patch on the one before (`net/delta`), not whole.
 * A `FrameReader` turns it back into a `TimedBatch`.
 */
export interface WireBatch {
  events: HostEvent[];
  /** The frame's patch (absent: no frame this batch). */
  f?: unknown;
  time: number;
}
