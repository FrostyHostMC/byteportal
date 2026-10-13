// Basic stats for games' makers (and the admin): how often each game's played, by how many, for how
// long, and whether players come back.
//
// A play is a player starting a game (`start`) until they leave. Each is kept for 90 days, with the
// account that played (a guest: none), in `<data>/stats.sqlite`; after that only each day's totals
// are. Nothing else about the player (no address, no device): who played is only ever counted.

import { randomBytes } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { GameStats, StatsRow, StatsSpan } from '../package/link';

/** How long each play is kept (days); then only its day's totals are. */
const KEEP_DAYS = 90;
/** The longest a play counts for (seconds): a tab left open overnight isn't a night's play. */
const LONGEST = 6 * 3600;

const SETUP = `
  PRAGMA journal_mode = WAL;
  PRAGMA synchronous = NORMAL;
  CREATE TABLE IF NOT EXISTS plays (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    game TEXT NOT NULL,
    account TEXT,
    started INTEGER NOT NULL,
    seconds INTEGER NOT NULL DEFAULT 0
  );
  CREATE INDEX IF NOT EXISTS plays_game ON plays (game, started);
  CREATE TABLE IF NOT EXISTS daily (
    game TEXT NOT NULL,
    day TEXT NOT NULL,
    plays INTEGER NOT NULL,
    players INTEGER NOT NULL,
    guests INTEGER NOT NULL,
    seconds INTEGER NOT NULL,
    PRIMARY KEY (game, day)
  );
`;

const now = () => Math.floor(Date.now() / 1000);

export class Stats {
  private db: DatabaseSync;
  /** Plays going on: when each started. */
  private open = new Map<number, number>();

  private constructor(path: string) {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path, { timeout: 5000 });
    this.db.exec(SETUP);
    this.prune();
  }

  static open(path: string): Stats {
    return new Stats(path);
  }

  /** A player started a game (`account`: null for a guest): the play, to `end` when they leave. */
  start(game: string, account: string | null): number {
    const at = now();
    const id = Number(this.db.prepare('INSERT INTO plays (game, account, started) VALUES (?, ?, ?)').run(game, account, at).lastInsertRowid);
    this.open.set(id, at);
    return id;
  }

  /** They left. */
  end(play: number) {
    const at = this.open.get(play);
    if (at === undefined) return;
    this.open.delete(play);
    this.db.prepare('UPDATE plays SET seconds = ? WHERE id = ?').run(Math.min(LONGEST, now() - at), play);
  }

  /** Plays going on, counted so far (should the server stop without their ends). */
  flush() {
    const t = now();
    const update = this.db.prepare('UPDATE plays SET seconds = ? WHERE id = ?');
    for (const [id, at] of this.open) update.run(Math.min(LONGEST, t - at), id);
  }

  /** A game's stats. */
  game(game: string): GameStats {
    const t = now();
    const span = (seconds: number): StatsSpan => {
      const r = this.db
        .prepare('SELECT COUNT(*) AS plays, COUNT(DISTINCT account) AS players, SUM(account IS NULL) AS guests, SUM(seconds) AS seconds FROM plays WHERE game = ? AND started >= ?')
        .get(game, t - seconds) as { plays: number; players: number; guests: number | null; seconds: number | null };
      return { plays: r.plays, players: r.players, guests: r.guests ?? 0, minutes: Math.round((r.seconds ?? 0) / 60) };
    };
    const recent = this.db.prepare('SELECT COUNT(*) AS plays, SUM(seconds) AS seconds FROM plays WHERE game = ?').get(game) as { plays: number; seconds: number | null };
    const old = this.db.prepare('SELECT SUM(plays) AS plays, SUM(seconds) AS seconds FROM daily WHERE game = ?').get(game) as { plays: number | null; seconds: number | null };
    const first = this.db.prepare('SELECT MIN(day) AS day FROM (SELECT day FROM daily WHERE game = ? UNION ALL SELECT date(MIN(started), \'unixepoch\') FROM plays WHERE game = ?)').get(game, game) as { day: string | null };
    // Of the last 30 days' signed-in players, those who played on more than one day.
    const back = this.db
      .prepare(`SELECT COUNT(*) AS players, SUM(days > 1) AS back FROM (SELECT COUNT(DISTINCT date(started, 'unixepoch')) AS days FROM plays WHERE game = ? AND started >= ? AND account IS NOT NULL GROUP BY account)`)
      .get(game, t - 30 * 86400) as { players: number; back: number | null };
    const byDay = new Map(
      (this.db.prepare(`SELECT date(started, 'unixepoch') AS day, COUNT(*) AS plays, COUNT(DISTINCT account) + SUM(account IS NULL) AS players FROM plays WHERE game = ? AND started >= ? GROUP BY day`).all(game, t - 31 * 86400) as { day: string; plays: number; players: number }[]).map((r) => [r.day, r]),
    );
    const days = Array.from({ length: 30 }, (_, i) => {
      const day = new Date((t - (29 - i) * 86400) * 1000).toISOString().slice(0, 10);
      return { day, plays: byDay.get(day)?.plays ?? 0, players: byDay.get(day)?.players ?? 0 };
    });
    return {
      day: span(86400),
      week: span(7 * 86400),
      month: span(30 * 86400),
      all: { plays: recent.plays + (old.plays ?? 0), minutes: Math.round(((recent.seconds ?? 0) + (old.seconds ?? 0)) / 60), since: first.day },
      returning: back.players ? (back.back ?? 0) / back.players : null,
      days,
    };
  }

  /** Every game played: the last 7 days' and all-time plays (most played this week first). */
  overview(): StatsRow[] {
    const t = now();
    const rows = this.db
      .prepare(
        `SELECT game, SUM(plays) AS plays, SUM(players) AS players, SUM(guests) AS guests, SUM(seconds) AS seconds, SUM(total) AS total FROM (
           SELECT game, COUNT(*) AS plays, COUNT(DISTINCT account) AS players, SUM(account IS NULL) AS guests, SUM(seconds) AS seconds, 0 AS total FROM plays WHERE started >= ? GROUP BY game
           UNION ALL SELECT game, 0, 0, 0, 0, COUNT(*) FROM plays GROUP BY game
           UNION ALL SELECT game, 0, 0, 0, 0, SUM(plays) FROM daily GROUP BY game
         ) GROUP BY game ORDER BY plays DESC, total DESC`,
      )
      .all(t - 7 * 86400) as { game: string; plays: number; players: number; guests: number; seconds: number; total: number }[];
    return rows.map((r) => ({ game: r.game, week: { plays: r.plays, players: r.players, guests: r.guests, minutes: Math.round(r.seconds / 60) }, plays: r.total }));
  }

  /** Plays older than 90 days become their days' totals. */
  prune() {
    const before = now() - KEEP_DAYS * 86400;
    // Whole days only: the day the cut falls in waits until it's all past.
    const cut = Math.floor(before / 86400) * 86400;
    this.db.exec('BEGIN');
    try {
      this.db
        .prepare(
          `INSERT INTO daily (game, day, plays, players, guests, seconds)
           SELECT game, date(started, 'unixepoch'), COUNT(*), COUNT(DISTINCT account), SUM(account IS NULL), SUM(seconds) FROM plays WHERE started < ? GROUP BY game, date(started, 'unixepoch')
           ON CONFLICT (game, day) DO UPDATE SET plays = plays + excluded.plays, players = players + excluded.players, guests = guests + excluded.guests, seconds = seconds + excluded.seconds`,
        )
        .run(cut);
      this.db.prepare('DELETE FROM plays WHERE started < ?').run(cut);
      this.db.exec('COMMIT');
    } catch (err) {
      this.db.exec('ROLLBACK');
      throw err;
    }
  }

  /** An account gone: its plays are still counted, but no longer say whose they were. */
  forgetAccount(account: string) {
    this.db.prepare('UPDATE plays SET account = ? WHERE account = ?').run(`gone:${randomBytes(9).toString('base64url')}`, account);
  }

  /** A game deleted for good: its stats go with it. */
  forget(game: string) {
    this.db.prepare('DELETE FROM plays WHERE game = ?').run(game);
    this.db.prepare('DELETE FROM daily WHERE game = ?').run(game);
  }

  close() {
    this.flush();
    this.open.clear();
    this.db.close();
  }
}
