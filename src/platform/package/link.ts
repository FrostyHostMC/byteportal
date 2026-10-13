// How a built game (see ./build.ts) meets the platform that runs it: the packager turns each
// `@platform…` import into a read of `globalThis.__blockyard.modules`, which the server's room
// (host/packaged.ts) and the player's screen (client/packaged.ts) fill before importing it.
// Nothing here imports anything but types (no bundler, no Node): the packager, the server (its
// rooms' threads too) and screens all use it.
import type { GameMeta } from '../api/types';

/** Why a folder can't be built: its problems, one per line (see ./build.ts). */
export class BuildError extends Error {
  constructor(readonly problems: string[]) {
    super(problems.join('\n'));
  }
}

/** Ids are a URL's path segment and a file name: lowercase letters, digits and dashes. */
export const GAME_ID = /^[a-z][a-z0-9-]{1,31}$/;

/** The global the platform hands built games its modules through. */
export const GLOBAL = '__blockyard';

/** The public API a game's server side may import (shared code included). */
export const SERVER_MODULES = ['@platform', '@platform/art', '@platform/kits', '@platform/items'] as const;
/** The public API a game's client side may import (shared code included). */
export const CLIENT_MODULES = ['@platform', '@platform/art', '@platform/items', '@platform/client', '@platform/client/kits', '@platform/client/math'] as const;

/** The public API a game's client Web Workers may import (no screen there). */
export const WORKER_MODULES = ['@platform', '@platform/art', '@platform/items', '@platform/client/math'] as const;

export type PlatformModule = (typeof SERVER_MODULES)[number] | (typeof CLIENT_MODULES)[number];

/** What `globalThis.__blockyard` holds while built games load and run. */
export interface PlatformLink {
  /** The public API by import name. */
  modules: Partial<Record<PlatformModule, unknown>>;
  /** A file of a game's (`assets/rifle-1a2b3c4d.glb`) by the address the server serves it at. */
  asset(game: string, path: string): string;
  /**
   * Start one of a game's client Web Workers (`workers/<name>.js` by its absolute address): the
   * packager turns `new Worker(new URL('./x.ts', import.meta.url), options)` into this. The worker
   * gets the public API too. Screens only.
   */
  worker?(url: string, options?: WorkerOptions): Worker;
}

/** A built version's manifest (`game.json`). */
export interface PackageManifest {
  id: string;
  /** The hash of what was built (its code and its files' names). */
  version: string;
  title: string;
  /** When it was built (ISO time). */
  built: string;
  /** The platform modules each side imports: a screen loads those before the game. */
  modules: { server: PlatformModule[]; client: PlatformModule[] };
  /** Its client's Web Workers, in `<version>/workers/`. */
  workers: string[];
  /** Its files, in `<id>/assets/`. */
  assets: string[];
}

/**
 * A native `import()`, never a bundler's or a dev server's: a built game must run as plain Node
 * runs it (Vite's loader would quietly give it `import.meta.env`, say). Node only.
 */
export function nativeImport(url: string): Promise<unknown> {
  importer ??= new Function('url', 'return import(url)') as (url: string) => Promise<unknown>;
  return importer(url);
}
let importer: ((url: string) => Promise<unknown>) | undefined;

/** Where a game server serves a built game: its manifest and code by version, its files by name. */
export const packagePath = {
  /** The game: its meta, current version and client code's address (JSON). */
  entry: (id: string) => `/g/${id}`,
  version: (id: string, version: string, file: 'client.js' | 'server.js' | 'game.json') => `/g/${id}/${version}/${file}`,
  asset: (id: string, path: string) => `/g/${id}/${path}`,
};

/** What `GET /g/<id>` answers: enough for a screen to list the game and load it. */
export interface PackageEntry {
  id: string;
  version: string;
  /** The game's meta, as the server has it. */
  meta: GameMeta;
  /** The platform modules its client code imports. */
  modules: PlatformModule[];
  /** Its client code's address (absolute). */
  client: string;
}

/** A game as its owners' page shows it (`GET /g/mine`). */
export interface MyGame {
  id: string;
  title: string;
  accent?: string;
  cover?: string;
  listed: boolean;
  /** The version new rooms run (null: not hosted). */
  current: string | null;
  created: string;
  owners: { id: string; name: string }[];
  /** Newest first. */
  versions: { version: string; built: string; by: string; title: string }[];
  /** Its link on the site. */
  play: string | null;
  /**
   * Its current version stopped passing its smoke test after an update to the platform: not listed
   * or played until it passes again (or a new version is uploaded). When, and what went wrong.
   */
  broken: { at: string; errors: string[] } | null;
  /** The home page: asked for (waiting for an admin), approved (on the shelf), declined; null: not asked. */
  home: 'asked' | 'approved' | 'declined' | null;
  /** Error issues of its not resolved (`GET /g/<id>/errors`). */
  errors: number;
  /** How it's played (null: the server keeps no stats). */
  stats: GameStats | null;
}

/** Plays over a span of time: how many, by how many signed-in players and guests, and for how long. */
export interface StatsSpan {
  plays: number;
  /** Signed-in players (each counted once). */
  players: number;
  /** Guests' plays (a guest can't be told from another, so each play counts). */
  guests: number;
  minutes: number;
}

/** A game's stats (host/stats.ts). */
export interface GameStats {
  /** The last 24 hours, 7 days and 30 days. */
  day: StatsSpan;
  week: StatsSpan;
  month: StatsSpan;
  /** Since its first play (`since`, a UTC day: null if never played). */
  all: { plays: number; minutes: number; since: string | null };
  /** Of the last 30 days' signed-in players, the share who played on more than one day (null: none). */
  returning: number | null;
  /** Plays and players each of the last 30 days (UTC), oldest first. */
  days: { day: string; plays: number; players: number }[];
}

/** A game in the admin's overview of every game's stats. */
export interface StatsRow {
  game: string;
  title?: string;
  /** The last 7 days. */
  week: StatsSpan;
  /** Every play. */
  plays: number;
}

/** An error issue (reports alike, grouped), as an owner or the admin sees it. */
export interface ErrorIssueView {
  id: string;
  source: 'room' | 'server' | 'page' | 'frame';
  game: string | null;
  version: string | null;
  message: string;
  stack: string;
  context: Record<string, string>;
  count: number;
  first: string;
  last: string;
}

/** A game in the community directory (`GET /g/directory`): hosted, in the directory, not on the home page. */
export interface DirectoryGame {
  id: string;
  title: string;
  tagline?: string;
  accent?: string;
  cover?: string;
  /** Its owners' names. */
  by: string[];
  /** When its current version went up (ISO time). */
  updated: string;
  /** What a screen loads to play it. */
  entry: PackageEntry;
}

/** A player's report of a game, as the admin sees it. */
export interface AdminReport {
  id: number;
  game: string;
  version: string | null;
  /** The reporter's name (null: a guest). */
  name: string | null;
  reason: string;
  at: string;
}

/** What an admin sees (`GET /admin`). */
export interface AdminView {
  games: (MyGame & { reports: number })[];
  /** Waiting: not resolved yet. */
  reports: AdminReport[];
  bans: { account: string; name: string; reason: string; at: string }[];
  activity: { at: string; by: string; game?: string; text: string }[];
  /** Every game's plays (built in and uploaded). */
  stats: StatsRow[];
}

/** What `GET /g/mine` answers. */
export interface MyGames {
  uploader: boolean;
  /** May manage every game (the server's `ADMINS`): `GET /admin`. */
  admin: boolean;
  /** Why they may not upload (null: they may). */
  why: string | null;
  /** Anyone signed in may upload here (`UPLOADERS=*`), within the limits. */
  open: boolean;
  /** Their limits and what they use (null: none, an admin or a development server). */
  limits: { games: number; bytes: number; usedGames: number; usedBytes: number } | null;
  /** The upload terms to accept before uploading (null: none asked). */
  terms: { version: number; url: string; accepted: boolean } | null;
  account: { id: string; name: string } | null;
  games: MyGame[];
}
