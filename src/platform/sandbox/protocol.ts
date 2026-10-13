// The sandbox (docs/PROPOSAL-OPEN-UPLOADS.md, stage 2): uploaded games' rooms run on a machine of
// their own, with no secrets and no data of the server's, each in a process of its own (no network,
// a user of its own, Node's permission model). The game server keeps the sockets, the accounts and
// the games' data, and relays: one WebSocket to the sandbox's supervisor, carrying every room.
//
//   game server  <── WebSocket (these messages, codec-encoded) ──>  supervisor  <── IPC ──>  a room's process
//
// Nothing here imports anything but types: both ends use it.
import type { SmokeResult } from '../host/packaged';
import type { RoomSpec } from '../host/room';
import type { FromRoom, ToRoom } from '../host/room-worker';
import type { SavedPlayer, SavedWorld } from '../host/store';

/** Both ends must speak the same version (a deploy updates one, then the other). */
export const RELAY_VERSION = 1;

/** A built version's files a room needs: its server code (and source map) and manifest. */
export interface GameFiles {
  'server.js': string;
  'server.js.map'?: string;
  'game.json': string;
}

/** What a room's store starts from (the game server's copy): see `RelayStore`. */
export interface StoreSnapshot {
  /** The kept world (the public room proper only). */
  world: SavedWorld | null;
  /** Where players left off, by name (the public room proper only). */
  players: Record<string, SavedPlayer>;
  /** The game's data (`game.store`), shared by all its rooms. */
  data: [string, unknown][];
  /** Whether it keeps its world and places (else only the game's data is saved). */
  keeps: boolean;
}

/** A change a room makes to its store, for the game server to keep. */
export type StoreOp =
  | { op: 'saveWorld'; world: SavedWorld }
  | { op: 'savePlayer'; name: string; player: SavedPlayer }
  | { op: 'forgetPlayer'; name: string }
  | { op: 'put'; key: string; value: unknown }
  | { op: 'flush' };

/** The game server to the supervisor. */
export type ToSandbox =
  | { t: 'hello'; version: number }
  | { t: 'start'; room: string; spec: RoomSpec; files: GameFiles; snapshot: StoreSnapshot }
  | { t: 'room'; room: string; msg: ToRoom }
  /** Stop a room's process at once (stuck, say). */
  | { t: 'kill'; room: string }
  | { t: 'smoke'; id: number; files: GameFiles; publicUrl: string };

/** The supervisor to the game server. */
export type FromSandbox =
  | { t: 'hello'; version: number; isolation: Isolation }
  | { t: 'room'; room: string; msg: FromRoom }
  | { t: 'store'; room: string; change: StoreOp }
  /** A room's process ended (stopped, crashed or killed). */
  | { t: 'exit'; room: string; code: number | null }
  | { t: 'smoked'; id: number; result: SmokeResult };

/**
 * How rooms' processes are kept apart: `full` (no network, a user of their own, Node's permission
 * model: a sandbox machine), `permission` (Node's permission model only: development and tests on
 * any machine), `off` (nothing: never on a real server).
 */
export type Isolation = 'full' | 'permission' | 'off';

/** The supervisor to a room's process (over IPC). */
export type ToRoomProcess =
  | { t: 'start'; spec: RoomSpec; dir: string; snapshot: StoreSnapshot }
  | { t: 'room'; msg: ToRoom }
  | { t: 'smoke'; dir: string; publicUrl: string };

/** A room's process to the supervisor. */
export type FromRoomProcess = { t: 'room'; msg: FromRoom } | { t: 'store'; change: StoreOp } | { t: 'smoked'; result: SmokeResult };
