// Error tracking: what goes wrong, on the server (game code in rooms, rooms that fail, the server
// itself) and on players' screens (the site's page, an uploaded game's frame, which report it:
// client/errors.ts), kept on the game server in one SQLite file (`errors.sqlite`). Reports alike
// are grouped as one issue (by what went wrong and where: the message without its numbers, and the
// first place in the stack), counted, and kept for 30 days after they last happened. Stack traces
// are put back into the source's own files and lines from source maps: an uploaded game's (from
// the library) and the site's (fetched from the site). The admin sees every issue; an uploaded
// game's owners see their game's (host/uploads.ts).
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { SourceMapConsumer, type RawSourceMap } from 'source-map-js';
import type { GameLibrary } from './library';

/** Where an error happened. */
export type ErrorSource = 'room' | 'server' | 'page' | 'frame';

/** One report of an error (before it's grouped). */
export interface ErrorReport {
  source: ErrorSource;
  message: string;
  stack?: string;
  /** The game it happened in, and its version (an uploaded game's). */
  game?: string | null;
  version?: string | null;
  /** More about where: the page's address, the browser, the room. */
  context?: Record<string, string>;
}

/** An issue: reports alike, grouped. */
export interface ErrorIssue {
  id: string;
  source: ErrorSource;
  game: string | null;
  version: string | null;
  message: string;
  /** The last report's stack, in the source's own files and lines where that could be done. */
  stack: string;
  context: Record<string, string>;
  count: number;
  first: string;
  last: string;
  resolved: boolean;
}

const SETUP = `
  PRAGMA journal_mode = WAL;
  PRAGMA synchronous = NORMAL;
  CREATE TABLE IF NOT EXISTS issues (
    id TEXT PRIMARY KEY,
    source TEXT NOT NULL,
    game TEXT,
    version TEXT,
    message TEXT NOT NULL,
    stack TEXT NOT NULL DEFAULT '',
    context TEXT NOT NULL DEFAULT '{}',
    count INTEGER NOT NULL DEFAULT 1,
    first TEXT NOT NULL DEFAULT (datetime('now')),
    last TEXT NOT NULL DEFAULT (datetime('now')),
    resolved INTEGER NOT NULL DEFAULT 0
  );
  CREATE INDEX IF NOT EXISTS issues_game ON issues (game, last);
  CREATE INDEX IF NOT EXISTS issues_last ON issues (last);
`;

/** Days an issue is kept after it last happened. */
const KEEP_DAYS = 30;
/** Issues kept at most (the oldest go first). */
const KEEP_ISSUES = 5000;

export interface ErrorLogOptions {
  /** Uploaded games' source maps (their client code's). */
  library?: GameLibrary;
  /** The site's addresses: its scripts' source maps are fetched from there. */
  sites?: string[];
  /** A Discord webhook told of each new issue (and one that comes back after being resolved). */
  webhook?: string | null;
  log?(line: string): void;
}

export class ErrorLog {
  private db: DatabaseSync;
  private maps = new Map<string, Promise<SourceMapConsumer | null>>();
  private told = 0;

  private constructor(
    path: string,
    private o: ErrorLogOptions,
  ) {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path, { timeout: 5000 });
    this.db.exec(SETUP);
    this.prune();
  }

  static open(path: string, o: ErrorLogOptions = {}): ErrorLog {
    return new ErrorLog(path, o);
  }

  /**
   * Keep a report: a new issue, or one more of one already kept. A stack naming scripts by address
   * (a screen's) is put back into its sources first; any other is kept at once (so a server about to
   * crash keeps its last error).
   */
  record(r: ErrorReport): Promise<string> {
    const stack = this.serverFrames(r.stack ?? '');
    if (!/https?:\/\/[^\s()'"]+?\.js:\d+:\d+/.test(stack)) return Promise.resolve(this.keep(r, tidy(stack)));
    return this.symbolicate(stack).then((s) => this.keep(r, tidy(s)));
  }

  /**
   * A server stack's frames in an uploaded game's built server code, put back into its own files
   * (where Node didn't already: a development server's rooms, whose module runner keeps stacks its
   * own way).
   */
  private serverFrames(stack: string): string {
    const lib = this.o.library;
    if (!lib) return stack;
    return stack.replace(/(?:file:\/\/)?(\/[^\s()'"]*\/([a-z][a-z0-9-]+)\/([0-9a-f]{12})\/server\.js)(?:\?[^:\s)]*)?:(\d+):(\d+)/g, (all, _path: string, id: string, version: string, line: string, column: string) => {
      const v = lib.version(id, version);
      if (!v) return all;
      let map = this.serverMaps.get(v.dir);
      if (map === undefined) {
        try {
          map = new SourceMapConsumer(JSON.parse(readFileSync(join(v.dir, 'server.js.map'), 'utf8')) as RawSourceMap);
        } catch {
          map = null;
        }
        this.serverMaps.set(v.dir, map);
      }
      const at = map?.originalPositionFor({ line: Number(line), column: Math.max(0, Number(column) - 1) });
      return at?.source ? `${at.source.replace(/^(\.\.\/)+/, '')}:${at.line}:${(at.column ?? 0) + 1}` : all;
    });
  }
  private serverMaps = new Map<string, SourceMapConsumer | null>();

  private keep(r: ErrorReport, symbolicated: string): string {
    const message = r.message.slice(0, 500).trim() || 'Error';
    const stack = symbolicated.slice(0, 8000);
    const id = fingerprint(r.source, r.game ?? null, message, stack);
    const context = JSON.stringify(r.context ?? {}).slice(0, 2000);
    const was = this.db.prepare('SELECT resolved FROM issues WHERE id = ?').get(id) as { resolved: number } | undefined;
    this.db
      .prepare(
        `INSERT INTO issues (id, source, game, version, message, stack, context) VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (id) DO UPDATE SET count = count + 1, last = datetime('now'), version = excluded.version, stack = excluded.stack, context = excluded.context, resolved = 0`,
      )
      .run(id, r.source, r.game ?? null, r.version ?? null, message, stack, context);
    if (!was || was.resolved) this.tell(r, message, !!was);
    return id;
  }

  /** Issues, the latest first: every one (`game` undefined), or one game's; not resolved ones unless asked. */
  issues({ game, resolved = false, limit = 100, own = false }: { game?: string; resolved?: boolean; limit?: number; own?: boolean } = {}): ErrorIssue[] {
    // `own`: only what the game's own code did (its rooms, its frame), not the site's page around it.
    const where = [game === undefined ? '' : 'game = ?', resolved ? '' : 'resolved = 0', own ? "source IN ('room', 'frame')" : ''].filter(Boolean);
    const rows = this.db.prepare(`SELECT * FROM issues ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY last DESC LIMIT ?`).all(...(game === undefined ? [] : [game]), limit) as Record<string, unknown>[];
    return rows.map((row) => ({
      id: String(row.id),
      source: row.source as ErrorSource,
      game: (row.game as string | null) ?? null,
      version: (row.version as string | null) ?? null,
      message: String(row.message),
      stack: String(row.stack),
      context: JSON.parse(String(row.context)) as Record<string, string>,
      count: Number(row.count),
      first: String(row.first),
      last: String(row.last),
      resolved: !!row.resolved,
    }));
  }

  /** How many issues of its own code (its rooms, its frame) each game has that aren't resolved. */
  counts(): Map<string, number> {
    const out = new Map<string, number>();
    for (const r of this.db.prepare("SELECT game, COUNT(*) AS n FROM issues WHERE resolved = 0 AND game IS NOT NULL AND source IN ('room', 'frame') GROUP BY game").all() as { game: string; n: number }[]) out.set(r.game, r.n);
    return out;
  }

  /** Mark an issue resolved (it comes back if it happens again); its game, if it was one's. */
  resolve(id: string): { game: string | null } | null {
    const row = this.db.prepare('SELECT game FROM issues WHERE id = ?').get(id) as { game: string | null } | undefined;
    if (!row) return null;
    this.db.prepare('UPDATE issues SET resolved = 1 WHERE id = ?').run(id);
    return { game: row.game };
  }

  /** Forget issues not seen for `KEEP_DAYS`, and the oldest past `KEEP_ISSUES`. */
  prune() {
    this.db.prepare(`DELETE FROM issues WHERE last < datetime('now', ?)`).run(`-${KEEP_DAYS} days`);
    this.db.prepare('DELETE FROM issues WHERE id IN (SELECT id FROM issues ORDER BY last DESC LIMIT -1 OFFSET ?)').run(KEEP_ISSUES);
  }

  close() {
    this.db.close();
  }

  /** A stack in its source's own files and lines: each `address:line:column` a source map knows. */
  async symbolicate(stack: string): Promise<string> {
    const places = [...new Set([...stack.matchAll(/(https?:\/\/[^\s()'"]+?\.js):(\d+):(\d+)/g)].map((m) => m[1]))];
    if (!places.length) return stack;
    const consumers = new Map<string, SourceMapConsumer | null>();
    for (const url of places.slice(0, 12)) consumers.set(url, await this.mapFor(url));
    return stack.replace(/(https?:\/\/[^\s()'"]+?\.js):(\d+):(\d+)/g, (all, url: string, line: string, column: string) => {
      const map = consumers.get(url);
      if (!map) return all;
      const at = map.originalPositionFor({ line: Number(line), column: Math.max(0, Number(column) - 1) });
      if (!at.source) return all;
      return `${at.source.replace(/^(\.\.\/)+/, '')}:${at.line}:${(at.column ?? 0) + 1}`;
    });
  }

  /** The source map for a script's address: an uploaded game's (from the library), or the site's (fetched). */
  private mapFor(url: string): Promise<SourceMapConsumer | null> {
    let found = this.maps.get(url);
    if (found) return found;
    found = this.loadMap(url).catch(() => null);
    this.maps.set(url, found);
    // A handful kept (a site's build has a few; old ones go).
    if (this.maps.size > 64) this.maps.delete(this.maps.keys().next().value!);
    return found;
  }

  private async loadMap(url: string): Promise<SourceMapConsumer | null> {
    const u = new URL(url);
    const lib = this.o.library;
    // An uploaded game's client code (or a worker of it): /g/<id>/<version>/client.js, …/workers/<name>.js
    const own = /^\/g\/([a-z][a-z0-9-]+)\/([0-9a-f]{12})\/((?:workers\/)?[\w-]+\.js)$/.exec(u.pathname);
    if (lib && own && u.origin === new URL(lib.publicUrl).origin) {
      const v = lib.version(own[1], own[2]);
      if (!v) return null;
      return new SourceMapConsumer(JSON.parse(readFileSync(join(v.dir, `${own[3]}.map`), 'utf8')) as RawSourceMap);
    }
    // The site's own scripts: their maps sit beside them.
    if (!(this.o.sites ?? []).includes(u.origin) || !u.pathname.startsWith('/assets/')) return null;
    const r = await fetch(`${u.origin}${u.pathname}.map`, { signal: AbortSignal.timeout(5000) });
    if (!r.ok) return null;
    return new SourceMapConsumer((await r.json()) as RawSourceMap);
  }

  /** Tell the webhook (Discord) of a new issue, a few a minute at most. */
  private tell(r: ErrorReport, message: string, again: boolean) {
    const hook = this.o.webhook;
    if (!hook || Date.now() - this.told < 20_000) return;
    this.told = Date.now();
    const where = `${r.source}${r.game ? ` · ${r.game}${r.version ? ` ${r.version}` : ''}` : ''}`;
    const content = `${again ? 'Back again' : 'New error'} (${where}): ${message}`.slice(0, 1900);
    void fetch(hook, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ content }) }).catch((err: unknown) => this.o.log?.(`[errors] the webhook failed: ${err instanceof Error ? err.message : String(err)}`));
  }
}

/**
 * Which issue a report is: where it happened, its game, its message without what changes from one
 * time to the next (numbers, ids, addresses), and the first place in its stack.
 */
function fingerprint(source: ErrorSource, game: string | null, message: string, stack: string): string {
  const side = source === 'room' || source === 'server' ? 'server' : 'client';
  const general = message.replace(/https?:\/\/\S+/g, '<url>').replace(/\b[0-9a-f]{8,}\b/gi, '<id>').replace(/\d+(\.\d+)?/g, '<n>');
  const frame = /(?:at |@)\s*(?:.*?\()?([^\s()]+?):\d+:\d+/.exec(stack.split('\n').slice(1).join('\n') || stack)?.[1] ?? '';
  return createHash('sha256').update([side, game ?? '', general, frame].join('\n')).digest('hex').slice(0, 16);
}

/**
 * A stack without this machine's paths: the platform's own files from `src/platform/`, anything
 * else by its file name (an owner sees their game's lines, not where the server keeps things).
 */
function tidy(stack: string): string {
  return stack.replace(/(?:file:\/\/)?(?<![:/\w])((?:\/[^\s()'"/]+)+\/)([^\s()'"/]+:\d+:\d+)/g, (_all, dir: string, file: string) => {
    const at = dir.indexOf('/src/platform/');
    return at >= 0 ? `${dir.slice(at + 1)}${file}` : file;
  });
}
