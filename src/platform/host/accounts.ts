import { createHash, randomBytes } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

/** A player's Blockyard account, as the server knows it (games get `PlayerAccount`: no Discord id). */
export interface Account {
  id: string;
  /** Their Discord user id (`dev:<name>` for a development server's made-up accounts). */
  discord: string;
  /** Unique on the platform, ignoring case. */
  name: string;
  /** Their Discord avatar's URL, or null. */
  avatar: string | null;
}

/** A player's report of a game. */
export interface Report {
  id: number;
  game: string;
  version: string | null;
  /** The reporter's account (null: a guest) and name. */
  account: string | null;
  name: string | null;
  reason: string;
  at: string;
  resolved: string | null;
  resolvedBy: string | null;
}

/** What Discord says of a user (`GET /users/@me`, scope `identify`). */
export interface DiscordUser {
  id: string;
  username: string;
  global_name?: string | null;
  avatar?: string | null;
}

const SETUP = `
  PRAGMA journal_mode = WAL;
  PRAGMA synchronous = NORMAL;
  CREATE TABLE IF NOT EXISTS accounts (
    id TEXT PRIMARY KEY,
    discord TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    name_key TEXT NOT NULL UNIQUE,
    avatar TEXT,
    created TEXT NOT NULL DEFAULT (datetime('now')),
    seen TEXT NOT NULL DEFAULT (datetime('now')),
    renamed TEXT
  );
  CREATE TABLE IF NOT EXISTS sessions (
    hash TEXT PRIMARY KEY,
    account TEXT NOT NULL REFERENCES accounts (id) ON DELETE CASCADE,
    expires INTEGER NOT NULL,
    created TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS sessions_account ON sessions (account);
  CREATE TABLE IF NOT EXISTS looks (
    account TEXT PRIMARY KEY REFERENCES accounts (id) ON DELETE CASCADE,
    avatar TEXT,
    wear TEXT NOT NULL DEFAULT '[]'
  );
  CREATE TABLE IF NOT EXISTS owned (
    account TEXT NOT NULL REFERENCES accounts (id) ON DELETE CASCADE,
    cosmetic TEXT NOT NULL,
    at TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (account, cosmetic)
  );
  CREATE TABLE IF NOT EXISTS achievements (
    account TEXT NOT NULL REFERENCES accounts (id) ON DELETE CASCADE,
    game TEXT NOT NULL,
    id TEXT NOT NULL,
    at TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (account, game, id)
  );
  CREATE TABLE IF NOT EXISTS bans (
    account TEXT PRIMARY KEY REFERENCES accounts (id) ON DELETE CASCADE,
    by TEXT NOT NULL,
    reason TEXT NOT NULL DEFAULT '',
    at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS reports (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    game TEXT NOT NULL,
    version TEXT,
    account TEXT,
    reason TEXT NOT NULL,
    at TEXT NOT NULL DEFAULT (datetime('now')),
    resolved TEXT,
    resolved_by TEXT
  );
  CREATE TABLE IF NOT EXISTS terms (
    account TEXT PRIMARY KEY REFERENCES accounts (id) ON DELETE CASCADE,
    version INTEGER NOT NULL,
    at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS upload_tokens (
    hash TEXT PRIMARY KEY,
    account TEXT NOT NULL REFERENCES accounts (id) ON DELETE CASCADE,
    created TEXT NOT NULL DEFAULT (datetime('now')),
    used TEXT
  );
`;

/** How long a sign-in lasts (seconds). */
export const SESSION_SECONDS = 90 * 24 * 3600;
/** How often a name can be changed (seconds). */
const RENAME_EVERY = 24 * 3600;

/**
 * When a Discord account was made, from its id (a snowflake: milliseconds since 2015 in its top
 * bits); null for an id that isn't one (a development server's `dev:` accounts).
 */
export function discordCreated(discord: string): Date | null {
  if (!/^\d{15,20}$/.test(discord)) return null;
  return new Date(Number(BigInt(discord) >> 22n) + 1420070400000);
}

/** A name as players may have one: letters, digits, spaces, `_ . -`; 20 at most (what `start` allows). */
export function cleanName(raw: string): string {
  return raw.replace(/[^\p{L}\p{N} _.-]/gu, '').replace(/\s+/g, ' ').trim().slice(0, 20);
}

const hash = (token: string) => createHash('sha256').update(token).digest('hex');

/**
 * The server's accounts (Sign in with Discord): who they are, their unique names, and their
 * sessions. One SQLite file (`accounts.sqlite`), kept by the server's main thread; rooms hear who's
 * who from it when players connect. A session is a random token in the player's cookie; only its
 * hash is kept.
 */
export class Accounts {
  private db: DatabaseSync;

  private constructor(path: string) {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path, { timeout: 5000 });
    this.db.exec(SETUP);
    this.db.exec('PRAGMA foreign_keys = ON');
  }

  static open(path: string): Accounts {
    return new Accounts(path);
  }

  /** Signed in with Discord: their account (made the first time, with a name of their own), its avatar kept up to date. */
  fromDiscord(user: DiscordUser): Account {
    const avatar = avatarUrl(user);
    const found = this.db.prepare('SELECT id FROM accounts WHERE discord = ?').get(user.id) as { id: string } | undefined;
    if (found) {
      this.db.prepare(`UPDATE accounts SET avatar = ?, seen = datetime('now') WHERE id = ?`).run(avatar, found.id);
      return this.get(found.id)!;
    }
    const name = this.freeName(cleanName(user.global_name || user.username) || 'Player');
    const id = randomBytes(9).toString('base64url');
    this.db.prepare('INSERT INTO accounts (id, discord, name, name_key, avatar) VALUES (?, ?, ?, ?, ?)').run(id, user.id, name, name.toLowerCase(), avatar);
    return this.get(id)!;
  }

  get(id: string): Account | null {
    const row = this.db.prepare('SELECT id, discord, name, avatar FROM accounts WHERE id = ?').get(id) as Account | undefined;
    return row ? { ...row } : null;
  }

  /** `name`, or with a number after it (`Pat 2`) if an account has it: one no account has. */
  private freeName(name: string): string {
    if (!this.nameHeld(name)) return name;
    for (let n = 2; ; n++) {
      const tail = ` ${n}`;
      const next = name.slice(0, 20 - tail.length) + tail;
      if (!this.nameHeld(next)) return next;
    }
  }

  /** Whether an account has this name (ignoring case). */
  nameHeld(name: string, except?: string): boolean {
    const row = this.db.prepare('SELECT id FROM accounts WHERE name_key = ?').get(name.toLowerCase()) as { id: string } | undefined;
    return !!row && row.id !== except;
  }

  /** Change an account's name (once a day; unique; the same cleaning as a typed one): the new name, or why not. */
  rename(id: string, raw: string): { name: string } | { error: string } {
    const name = cleanName(raw);
    const row = this.db.prepare(`SELECT name, renamed FROM accounts WHERE id = ?`).get(id) as { name: string; renamed: string | null } | undefined;
    if (!row) return { error: 'No such account' };
    if (!name) return { error: 'Names need a letter or number' };
    if (name === row.name) return { name };
    if (this.nameHeld(name, id)) return { error: `${name} is taken` };
    // (Only changing case is always fine.)
    const since = row.renamed ? (Date.now() - Date.parse(`${row.renamed}Z`)) / 1000 : Infinity;
    if (name.toLowerCase() !== row.name.toLowerCase() && since < RENAME_EVERY) return { error: 'Names can be changed once a day' };
    this.db.prepare(`UPDATE accounts SET name = ?, name_key = ?, renamed = datetime('now') WHERE id = ?`).run(name, name.toLowerCase(), id);
    return { name };
  }

  /** The account with this name (ignoring case), or null. */
  byName(name: string): Account | null {
    const row = this.db.prepare('SELECT id FROM accounts WHERE name_key = ?').get(name.trim().toLowerCase()) as { id: string } | undefined;
    return row ? this.get(row.id) : null;
  }

  /** A new session for an account: the token for the player's cookie. */
  startSession(account: string): string {
    const token = randomBytes(32).toString('base64url');
    this.db.prepare('INSERT INTO sessions (hash, account, expires) VALUES (?, ?, ?)').run(hash(token), account, Math.floor(Date.now() / 1000) + SESSION_SECONDS);
    return token;
  }

  /** Who a session token is (null: unknown or expired). */
  session(token: string | undefined): Account | null {
    if (!token) return null;
    const row = this.db.prepare('SELECT account, expires FROM sessions WHERE hash = ?').get(hash(token)) as { account: string; expires: number } | undefined;
    if (!row) return null;
    if (row.expires < Date.now() / 1000) {
      this.endSession(token);
      return null;
    }
    return this.get(row.account);
  }

  endSession(token: string) {
    this.db.prepare('DELETE FROM sessions WHERE hash = ?').run(hash(token));
  }

  /**
   * A new upload token for an account (games uploaded from the command line, see host/library.ts):
   * the token, shown once; only its hash is kept. It lasts until revoked or the account goes.
   */
  newUploadToken(account: string): string {
    const token = `byu_${randomBytes(24).toString('base64url')}`;
    this.db.prepare('INSERT INTO upload_tokens (hash, account) VALUES (?, ?)').run(hash(token), account);
    return token;
  }

  /** Whose upload token this is (null: unknown or revoked). */
  uploadToken(token: string | undefined): Account | null {
    if (!token?.startsWith('byu_')) return null;
    const row = this.db.prepare('SELECT account FROM upload_tokens WHERE hash = ?').get(hash(token)) as { account: string } | undefined;
    if (!row) return null;
    this.db.prepare(`UPDATE upload_tokens SET used = datetime('now') WHERE hash = ?`).run(hash(token));
    return this.get(row.account);
  }

  /** Revoke all of an account's upload tokens: how many there were. */
  revokeUploadTokens(account: string): number {
    return Number(this.db.prepare('DELETE FROM upload_tokens WHERE account = ?').run(account).changes);
  }

  /** The version of the upload terms an account accepted (0: none). */
  termsAccepted(account: string): number {
    return (this.db.prepare('SELECT version FROM terms WHERE account = ?').get(account) as { version: number } | undefined)?.version ?? 0;
  }

  acceptTerms(account: string, version: number) {
    this.db.prepare(`INSERT INTO terms (account, version) VALUES (?, ?) ON CONFLICT (account) DO UPDATE SET version = excluded.version, at = datetime('now')`).run(account, version);
  }

  /** Ban an account from uploading and managing games (or lift it: `banned` false). */
  ban(account: string, banned: boolean, by: string, reason = '') {
    if (banned) this.db.prepare('INSERT INTO bans (account, by, reason) VALUES (?, ?, ?) ON CONFLICT (account) DO UPDATE SET by = excluded.by, reason = excluded.reason').run(account, by, reason);
    else this.db.prepare('DELETE FROM bans WHERE account = ?').run(account);
  }

  banned(account: string): boolean {
    return !!this.db.prepare('SELECT 1 FROM bans WHERE account = ?').get(account);
  }

  /** Every ban, newest first, with the banned account's name. */
  bans(): { account: string; name: string; by: string; reason: string; at: string }[] {
    return this.db.prepare('SELECT b.account, a.name, b.by, b.reason, b.at FROM bans b JOIN accounts a ON a.id = b.account ORDER BY b.at DESC').all() as { account: string; name: string; by: string; reason: string; at: string }[];
  }

  /** A player reports a game (an account's id, or null for a guest): its number. */
  report(game: string, version: string | null, account: string | null, reason: string): number {
    return Number(this.db.prepare('INSERT INTO reports (game, version, account, reason) VALUES (?, ?, ?, ?)').run(game, version, account, reason.slice(0, 1000)).lastInsertRowid);
  }

  /** Reports, newest first: those not resolved yet (or all). */
  reports(all = false): Report[] {
    return this.db.prepare(`SELECT r.id, r.game, r.version, r.account, a.name, r.reason, r.at, r.resolved, r.resolved_by AS resolvedBy FROM reports r LEFT JOIN accounts a ON a.id = r.account ${all ? '' : 'WHERE r.resolved IS NULL'} ORDER BY r.id DESC LIMIT 200`).all() as unknown as Report[];
  }

  resolveReport(id: number, by: string): boolean {
    return this.db.prepare(`UPDATE reports SET resolved = datetime('now'), resolved_by = ? WHERE id = ? AND resolved IS NULL`).run(by, id).changes > 0;
  }

  /** What an account wears: its avatar's code (null: none chosen yet) and the cosmetics it has on. */
  look(account: string): { avatar: string | null; wear: string[] } {
    const row = this.db.prepare('SELECT avatar, wear FROM looks WHERE account = ?').get(account) as { avatar: string | null; wear: string } | undefined;
    if (!row) return { avatar: null, wear: [] };
    let wear: string[] = [];
    try {
      wear = (JSON.parse(row.wear) as unknown[]).filter((w): w is string => typeof w === 'string');
    } catch {
      // (Nothing on.)
    }
    return { avatar: row.avatar, wear };
  }

  /** Change what an account wears (the caller checks it's theirs to wear). */
  setLook(account: string, look: { avatar?: string | null; wear?: string[] }) {
    const was = this.look(account);
    const avatar = look.avatar === undefined ? was.avatar : look.avatar;
    const wear = JSON.stringify(look.wear ?? was.wear);
    this.db.prepare('INSERT INTO looks (account, avatar, wear) VALUES (?, ?, ?) ON CONFLICT (account) DO UPDATE SET avatar = excluded.avatar, wear = excluded.wear').run(account, avatar, wear);
  }

  /** A cosmetic, theirs: true the first time. */
  own(account: string, cosmetic: string): boolean {
    return this.db.prepare('INSERT INTO owned (account, cosmetic) VALUES (?, ?) ON CONFLICT DO NOTHING').run(account, cosmetic).changes > 0;
  }

  /** The cosmetics an account has: when each became theirs (UTC). */
  owned(account: string): Record<string, string> {
    const out: Record<string, string> = {};
    for (const r of this.db.prepare('SELECT cosmetic, at FROM owned WHERE account = ?').all(account) as { cosmetic: string; at: string }[]) out[r.cosmetic] = r.at;
    return out;
  }

  /** One of a game's achievements, earned (kept once: the first time counts). */
  achieve(account: string, game: string, id: string) {
    this.db.prepare('INSERT INTO achievements (account, game, id) VALUES (?, ?, ?) ON CONFLICT DO NOTHING').run(account, game, id);
  }

  /** The achievements an account has in one game. */
  achievedIn(account: string, game: string): string[] {
    return (this.db.prepare('SELECT id FROM achievements WHERE account = ? AND game = ?').all(account, game) as { id: string }[]).map((r) => r.id);
  }

  /** Every achievement an account has, by game: when each was earned (UTC, `2026-09-26 18:04:11`). */
  achievements(account: string): Record<string, Record<string, string>> {
    const out: Record<string, Record<string, string>> = {};
    for (const r of this.db.prepare('SELECT game, id, at FROM achievements WHERE account = ?').all(account) as { game: string; id: string; at: string }[]) (out[r.game] ??= {})[r.id] = r.at;
    return out;
  }

  /**
   * Gone: the account, its sessions and achievements (the games' data for it is the server's to
   * clear). Its reports of games stay, as a guest's.
   */
  delete(id: string) {
    this.db.prepare('UPDATE reports SET account = NULL WHERE account = ?').run(id);
    this.db.prepare('DELETE FROM accounts WHERE id = ?').run(id);
  }

  /** Clear out what's no longer needed: expired sessions, and reports resolved more than 180 days ago. */
  tidy() {
    this.db.prepare('DELETE FROM sessions WHERE expires < ?').run(Math.floor(Date.now() / 1000));
    this.db.prepare(`DELETE FROM reports WHERE resolved IS NOT NULL AND resolved < datetime('now', '-180 days')`).run();
  }

  close() {
    this.db.close();
  }
}

/** A Discord user's avatar (their own, or Discord's default for them). */
function avatarUrl(u: DiscordUser): string {
  if (u.avatar) return `https://cdn.discordapp.com/avatars/${u.id}/${u.avatar}.png?size=64`;
  let n = 0;
  try {
    n = Number((BigInt(u.id) >> 22n) % 6n);
  } catch {
    // (A made-up id: the first default.)
  }
  return `https://cdn.discordapp.com/embed/avatars/${n}.png`;
}
