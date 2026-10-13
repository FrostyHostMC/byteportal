// An uploaded game's screen runs in a sandboxed frame (docs/PROPOSAL-OPEN-UPLOADS.md, stage 3): an
// opaque origin with no cookie, no storage and no reach into the page around it. The page (the
// shell: the home page, the account, sign-in) and the frame talk only by these messages
// (`postMessage`). Nothing here imports anything but types: both sides use it.
import type { GameControls } from '../ui/controls';

/** What the frame's runtime shows on the home page (`HomeGame`, without its callbacks). */
export interface FramedGame extends GameControls {
  current: string;
  title?: string;
  uploaded?: boolean;
  /** Online (always, in a frame): the server, the game on show, its room; whether it has rooms of one's own. */
  online: { server: string; game: string; room: string | null; rooms: boolean } | null;
}

/** The frame to the page. */
export type FrameToShell =
  /** Loaded: ready for `init`. */
  | { t: 'ready' }
  /** The home page's calls (the runtime's `HomeScreen`). */
  | { t: 'show'; game: FramedGame }
  | { t: 'select'; id: string; title?: string }
  | { t: 'progress'; fraction: number; text: string }
  | { t: 'setReady' }
  | { t: 'present'; names: string[] }
  | { t: 'failed'; text: string }
  | { t: 'busy'; id: number; text: string; seconds: number }
  | { t: 'hide' }
  /** The frame's address changed (the game, its room, its copy): the page's follows. */
  | { t: 'address'; game: string; room: string | null; shard: number | null }
  /** A setting to keep (the frame has no storage). */
  | { t: 'keep'; key: string; value: string }
  /** A room ticket, to connect as the signed-in player (null: a guest). */
  | { t: 'ticket'; id: number; game: string }
  /** The page's address (an invite link). */
  | { t: 'invite'; id: number }
  /** The home page's Play button was clicked (the click fell through it to the frame). */
  | { t: 'press' };

/** The page to the frame. */
export type ShellToFrame =
  /** What it starts with: the settings kept, and the name and avatar to play as. */
  | { t: 'init'; kept: Record<string, string>; name: string; avatar: string }
  /** Play, as `name` (the home page's button or Enter). */
  | { t: 'play'; name: string; avatar: string }
  /** A room of one's own (`own`), or back to the public game. */
  | { t: 'room'; own: boolean }
  /** Where the home page's Play button is (in the frame's coordinates: the page's), while it may be pressed; null: not now. */
  | { t: 'playButton'; rect: { x: number; y: number; w: number; h: number } | null }
  /** An answer to `busy` (a game picked meanwhile, or null), `ticket` (or null) or `invite`. */
  | { t: 'reply'; id: number; value: unknown };

/** The settings the frame is given (and sends changes to): the keys `settings.ts` and `quality.ts` keep. */
export const FRAME_KEPT = ['voxel.settings.v1', 'voxel.quality.v1'];
