import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { SavedPlayer, SavedWorld, Store } from './store';

/** Each connection's setup: the tables, if they're not there yet. */
const SETUP = `
  PRAGMA journal_mode = WAL;
  PRAGMA synchronous = NORMAL;
  CREATE TABLE IF NOT EXISTS world (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    game TEXT NOT NULL,
    seed INTEGER NOT NULL,
    edits BLOB,
    time REAL NOT NULL DEFAULT 0.3,
    created TEXT NOT NULL DEFAULT (datetime('now')),
    saved TEXT
  );
  CREATE TABLE IF NOT EXISTS players (
    name TEXT PRIMARY KEY,
    state TEXT NOT NULL,
    seen TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS kv (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated TEXT NOT NULL DEFAULT (datetime('now'))
  );
`;

/**
 * A game server's store: one SQLite file per server (Node's built-in `node:sqlite`). The world,
 * players by name, and the game's `game.store` data. Changes to the game's data are kept in
 * memory and written in one transaction on `flush` (the server flushes every few seconds and when
 * it stops), so a game setting values every tick costs nothing. Several rooms of a game (each in
 * its own thread) each open it: a flush also picks up what the others wrote.
 */
export class SqliteStore implements Store {
  private db: DatabaseSync;
  private values = new Map<string, unknown>();
  private dirty = new Map<string, unknown>();
  /** The database's version as of our last read (other connections' writes change it). */
  private version = -1;

  private constructor(
    path: string,
    private game: string,
  ) {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
    this.db = SqliteStore.connect(path);
    this.refresh();
  }

  /**
   * Open the file and set it up. A game's rooms each open it, in threads of their own, and wait
   * for one another's writes (the timeout). Two setting up a new file at once can still find
   * each other in the way (SQLite then answers "locked" at once rather than wait for a deadlock
   * to clear): the one turned away tries again a moment later.
   */
  private static connect(path: string): DatabaseSync {
    const pause = new Int32Array(new SharedArrayBuffer(4));
    for (let attempt = 0; ; attempt++) {
      const db = new DatabaseSync(path, { timeout: 5000 });
      try {
        db.exec(SETUP);
        SqliteStore.migrate(db);
        return db;
      } catch (err) {
        db.close();
        if (attempt >= 50 || !/locked|busy/i.test(String(err))) throw err;
        Atomics.wait(pause, 0, 0, 10 + Math.random() * 40);
      }
    }
  }

  /**
   * Columns added since a file was made: the world's `blocks` (the game's own blocks' keys, JSON).
   * Another room opening the file at the same moment may add it first.
   */
  private static migrate(db: DatabaseSync) {
    const columns = db.prepare('PRAGMA table_info(world)').all() as { name: string }[];
    if (columns.some((c) => c.name === 'blocks')) return;
    try {
      db.exec('ALTER TABLE world ADD COLUMN blocks TEXT');
    } catch (err) {
      if (!/duplicate column/i.test(String(err))) throw err;
    }
  }

  /**
   * Read the game's data again if another connection wrote to the database since we last did: the
   * game's other rooms (each in a thread of its own, with a connection of its own) share it.
   */
  private refresh() {
    const version = (this.db.prepare('PRAGMA data_version').get() as { data_version: number }).data_version;
    if (version === this.version) return;
    this.version = version;
    const seen = new Set<string>();
    for (const row of this.db.prepare('SELECT key, value FROM kv').all() as { key: string; value: string }[]) {
      seen.add(row.key);
      if (!this.dirty.has(row.key)) this.values.set(row.key, JSON.parse(row.value));
    }
    for (const key of [...this.values.keys()]) if (!seen.has(key) && !this.dirty.has(key)) this.values.delete(key);
  }

  /** Open (or create) a server's database. It belongs to one game: opening it for another fails. */
  static open(path: string, game: string): SqliteStore {
    const s = new SqliteStore(path, game);
    const w = s.world();
    if (w && w.game !== game) {
      s.close();
      throw new Error(`${path} holds a ${w.game} world, not ${game}: use another --db`);
    }
    // Where players left off by name (from before accounts) goes once nobody's claimed it for 90 days.
    s.db.prepare(`DELETE FROM players WHERE name NOT LIKE '#%' AND seen < datetime('now', '-90 days')`).run();
    return s;
  }

  world(): SavedWorld | null {
    const row = this.db.prepare('SELECT game, seed, edits, blocks, time FROM world WHERE id = 1').get() as
      | { game: string; seed: number; edits: Uint8Array | null; blocks: string | null; time: number }
      | undefined;
    if (!row) return null;
    return { game: row.game, seed: row.seed >>> 0, edits: row.edits ? new Uint8Array(row.edits) : null, blocks: row.blocks ? (JSON.parse(row.blocks) as string[]) : null, time: row.time };
  }

  saveWorld(w: SavedWorld) {
    this.db
      .prepare(
        `INSERT INTO world (id, game, seed, edits, blocks, time, saved) VALUES (1, ?, ?, ?, ?, ?, datetime('now'))
         ON CONFLICT (id) DO UPDATE SET seed = excluded.seed, edits = excluded.edits, blocks = excluded.blocks, time = excluded.time, saved = excluded.saved`,
      )
      .run(this.game, w.seed, w.edits, w.blocks?.length ? JSON.stringify(w.blocks) : null, w.time);
  }

  player(name: string): SavedPlayer | null {
    const row = this.db.prepare('SELECT state FROM players WHERE name = ?').get(name) as { state: string } | undefined;
    return row ? (JSON.parse(row.state) as SavedPlayer) : null;
  }

  savePlayer(name: string, p: SavedPlayer) {
    this.db.prepare(`INSERT INTO players (name, state, seen) VALUES (?, ?, datetime('now')) ON CONFLICT (name) DO UPDATE SET state = excluded.state, seen = excluded.seen`).run(name, JSON.stringify(p));
  }

  forgetPlayer(name: string) {
    this.db.prepare('DELETE FROM players WHERE name = ?').run(name);
  }

  players(): Record<string, SavedPlayer> {
    const out: Record<string, SavedPlayer> = {};
    for (const row of this.db.prepare('SELECT name, state FROM players').all() as { name: string; state: string }[]) out[row.name] = JSON.parse(row.state) as SavedPlayer;
    return out;
  }

  data() {
    return this.values;
  }

  put(key: string, value: unknown) {
    this.dirty.set(key, value);
  }

  /** Write the game's data that changed, and pick up what other rooms of the game wrote. */
  flush() {
    this.write();
    this.refresh();
  }

  private write() {
    if (!this.dirty.size) return;
    const set = this.db.prepare(`INSERT INTO kv (key, value, updated) VALUES (?, ?, datetime('now')) ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated = excluded.updated`);
    const del = this.db.prepare('DELETE FROM kv WHERE key = ?');
    // Taking the write lock up front (rather than on the first write) waits its turn behind other rooms.
    this.db.exec('BEGIN IMMEDIATE');
    try {
      for (const [k, v] of this.dirty) {
        if (v === undefined) del.run(k);
        else set.run(k, JSON.stringify(v));
      }
      this.db.exec('COMMIT');
    } catch (err) {
      this.db.exec('ROLLBACK');
      throw err;
    }
    this.dirty.clear();
  }

  close() {
    this.write();
    this.db.close();
  }
}
