import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gunzipSync, gzipSync } from 'node:zlib';
import { DatabaseSync } from 'node:sqlite';

/**
 * Keeps the server's data (accounts and what they've earned) safe on a host whose disk is wiped
 * whenever it restarts. Copies live somewhere that isn't the disk: a private GitHub repository,
 * a channel in a Discord server (through a bot), or both. On start, a file that isn't on the disk
 * is fetched from there; then a snapshot of each file is saved every few minutes (only when it
 * changed) and once more when the server stops.
 *
 * GitHub:  BACKUP_REPO ("owner/name" of a PRIVATE repository), BACKUP_TOKEN (a fine-grained token
 *          with read and write on that repository's contents), BACKUP_BRANCH (default main).
 * Discord: BACKUP_DISCORD_TOKEN (a bot's token), BACKUP_DISCORD_CHANNEL (the id of a private
 *          channel only the bot and you can see: it needs View Channel, Send Messages, Attach
 *          Files and Read Message History).
 * Both:    BACKUP_FILES (default accounts.sqlite; names inside the data folder, comma-separated),
 *          BACKUP_EVERY_MINUTES (default 5).
 */

/** Somewhere a copy of a file is kept. */
export interface Remote {
  name: string;
  /** The saved bytes, or null if nothing's saved there yet. Throws if it can't tell. */
  get(file: string): Promise<Buffer | null>;
  put(file: string, bytes: Buffer): Promise<void>;
}

export interface BackupOptions {
  remotes: Remote[];
  dir: string;
  files: string[];
  everyMinutes: number;
  log: (line: string) => void;
}

const GITHUB = process.env.BACKUP_API ?? 'https://api.github.com';
const DISCORD = process.env.BACKUP_DISCORD_API ?? 'https://discord.com/api/v10';

/** A private GitHub repository: `backup/<file>` on a branch. */
export class GitHubRemote implements Remote {
  readonly name: string;
  private shas = new Map<string, string>();

  constructor(private repo: string, private token: string, private branch: string) {
    this.name = `GitHub ${repo}`;
  }

  private url(file: string) {
    return `${GITHUB}/repos/${this.repo}/contents/backup/${encodeURIComponent(file)}`;
  }

  private headers(extra: Record<string, string> = {}) {
    return { Authorization: `Bearer ${this.token}`, 'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': 'stonebyte-backup', ...extra };
  }

  async get(file: string): Promise<Buffer | null> {
    const r = await fetch(`${this.url(file)}?ref=${encodeURIComponent(this.branch)}`, { headers: this.headers({ Accept: 'application/vnd.github.raw+json' }) });
    if (r.status === 404) return null;
    if (!r.ok) throw new Error(`GitHub answered ${r.status}`);
    return Buffer.from(await r.arrayBuffer());
  }

  private async sha(file: string): Promise<string | null> {
    const r = await fetch(`${this.url(file)}?ref=${encodeURIComponent(this.branch)}`, { headers: this.headers() });
    if (r.status === 404) return null;
    if (!r.ok) throw new Error(`GitHub answered ${r.status}`);
    return ((await r.json()) as { sha: string }).sha;
  }

  async put(file: string, bytes: Buffer): Promise<void> {
    const send = (sha: string | null) =>
      fetch(this.url(file), {
        method: 'PUT',
        headers: this.headers({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ message: `backup ${file} ${new Date().toISOString()}`, content: bytes.toString('base64'), branch: this.branch, ...(sha ? { sha } : {}) }),
      });
    let r = await send(this.shas.get(file) ?? (await this.sha(file)));
    if (r.status === 409 || r.status === 422) r = await send(await this.sha(file));
    if (!r.ok) throw new Error(`GitHub answered ${r.status}: ${(await r.text()).slice(0, 200)}`);
    const body = (await r.json()) as { content?: { sha?: string } };
    if (body.content?.sha) this.shas.set(file, body.content.sha);
  }
}

interface DiscordMessage {
  id: string;
  attachments?: { filename: string; url: string }[];
}

/** A Discord channel the bot posts to: each save is a message with the file (gzipped) attached; the newest is the copy. */
export class DiscordRemote implements Remote {
  readonly name: string;
  /** How many saved copies of a file stay in the channel (older ones the bot posted are deleted). */
  private keep = 5;

  constructor(private token: string, private channel: string) {
    this.name = `Discord channel ${channel}`;
  }

  private headers(extra: Record<string, string> = {}) {
    return { Authorization: `Bot ${this.token}`, 'User-Agent': 'DiscordBot (stonebyte-backup, 1)', ...extra };
  }

  /** A request that waits once if Discord says "slow down". */
  private async call(url: string, init: RequestInit): Promise<Response> {
    let r = await fetch(url, init);
    if (r.status === 429) {
      const wait = Number(((await r.json().catch(() => ({}))) as { retry_after?: number }).retry_after ?? 1);
      await new Promise((resolve) => setTimeout(resolve, Math.min(30, wait) * 1000 + 100));
      r = await fetch(url, init);
    }
    return r;
  }

  /** The channel's messages carrying this file, newest first (looks back through up to 300 messages). */
  private async copies(file: string): Promise<DiscordMessage[]> {
    const found: DiscordMessage[] = [];
    let before = '';
    for (let page = 0; page < 3; page++) {
      const r = await this.call(`${DISCORD}/channels/${this.channel}/messages?limit=100${before ? `&before=${before}` : ''}`, { headers: this.headers() });
      if (!r.ok) throw new Error(`Discord answered ${r.status}: ${(await r.text()).slice(0, 200)}`);
      const messages = (await r.json()) as DiscordMessage[];
      for (const m of messages) if (m.attachments?.some((a) => a.filename === `${file}.gz`)) found.push(m);
      if (messages.length < 100 || found.length) break;
      before = messages[messages.length - 1]!.id;
    }
    return found;
  }

  async get(file: string): Promise<Buffer | null> {
    const newest = (await this.copies(file))[0];
    if (!newest) return null;
    const attachment = newest.attachments!.find((a) => a.filename === `${file}.gz`)!;
    const r = await fetch(attachment.url);
    if (!r.ok) throw new Error(`Discord's file answered ${r.status}`);
    return gunzipSync(Buffer.from(await r.arrayBuffer()));
  }

  async put(file: string, bytes: Buffer): Promise<void> {
    const zipped = gzipSync(bytes);
    if (zipped.length > 9 * 1024 * 1024) throw new Error(`${file} is ${zipped.length} bytes zipped: too big for a Discord attachment (10 MB)`);
    const form = new FormData();
    form.append('payload_json', JSON.stringify({ content: `backup ${file} ${new Date().toISOString()}`, attachments: [{ id: 0, filename: `${file}.gz` }] }));
    form.append('files[0]', new Blob([new Uint8Array(zipped)]), `${file}.gz`);
    const r = await this.call(`${DISCORD}/channels/${this.channel}/messages`, { method: 'POST', headers: this.headers(), body: form });
    if (!r.ok) throw new Error(`Discord answered ${r.status}: ${(await r.text()).slice(0, 200)}`);
    // Tidy: only the newest few copies stay (the bot can always delete its own messages).
    try {
      for (const old of (await this.copies(file)).slice(this.keep)) await this.call(`${DISCORD}/channels/${this.channel}/messages/${old.id}`, { method: 'DELETE', headers: this.headers() });
    } catch {
      // (Tidying is optional.)
    }
  }
}

export class Backup {
  private timer: ReturnType<typeof setInterval> | null = null;
  private saving: Promise<void> | null = null;
  /** The hash of what each file held when it was last saved to each remote (so unchanged files aren't saved again). */
  private saved = new Map<string, string>();

  constructor(private o: BackupOptions) {}

  /**
   * Before the server opens its files: bring back any that the disk doesn't have, from the first
   * remote that has one. If a remote can't be reached (and none had it), this throws, so the
   * server doesn't start empty and later save that over the copy.
   */
  async restore() {
    mkdirSync(this.o.dir, { recursive: true });
    for (const file of this.o.files) {
      const local = join(this.o.dir, file);
      if (existsSync(local)) continue;
      let outcome: { bytes: Buffer | null; from: string; errors: string[] } = { bytes: null, from: '', errors: [] };
      for (let attempt = 1; attempt <= 4; attempt++) {
        outcome = { bytes: null, from: '', errors: [] };
        for (const remote of this.o.remotes) {
          try {
            const bytes = await remote.get(file);
            if (bytes && !outcome.bytes) outcome = { ...outcome, bytes, from: remote.name };
          } catch (err) {
            outcome.errors.push(`${remote.name}: ${err instanceof Error ? err.message : err}`);
          }
        }
        if (outcome.bytes || !outcome.errors.length) break;
        await new Promise((resolve) => setTimeout(resolve, attempt * 2000));
      }
      if (outcome.bytes) {
        writeFileSync(local, outcome.bytes);
        const hash = createHash('sha256').update(outcome.bytes).digest('hex');
        for (const remote of this.o.remotes) this.saved.set(`${remote.name}|${file}`, hash);
        this.o.log(`[backup] ${file}: brought back ${outcome.bytes.length} bytes from ${outcome.from}`);
      } else if (outcome.errors.length) {
        throw new Error(`[backup] can't tell if ${file} is saved (${outcome.errors.join('; ')}): not starting, so an empty copy can't replace it`);
      } else {
        this.o.log(`[backup] ${file}: no saved copy yet (starting fresh)`);
      }
    }
  }

  start() {
    if (this.timer) return;
    this.o.log(`[backup] saving ${this.o.files.join(', ')} to ${this.o.remotes.map((r) => r.name).join(' and ')} every ${this.o.everyMinutes} minutes`);
    this.timer = setInterval(() => void this.save(), this.o.everyMinutes * 60_000);
    this.timer.unref();
  }

  /** Stop the timer and save one last time (the server's files are closed by now). */
  async stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    await this.save();
  }

  /** Save every file that changed, to every remote; one run at a time, and a failure is logged, never thrown. */
  save(): Promise<void> {
    if (!this.saving) {
      this.saving = (async () => {
        for (const file of this.o.files) {
          let bytes: Buffer | null = null;
          try {
            bytes = this.snapshot(file);
          } catch (err) {
            this.o.log(`[backup] ${file}: couldn't make a copy (${err instanceof Error ? err.message : err})`);
          }
          if (!bytes) continue;
          const hash = createHash('sha256').update(bytes).digest('hex');
          for (const remote of this.o.remotes) {
            const key = `${remote.name}|${file}`;
            if (this.saved.get(key) === hash) continue;
            try {
              await remote.put(file, bytes);
              this.saved.set(key, hash);
              this.o.log(`[backup] ${file}: saved ${bytes.length} bytes to ${remote.name}`);
            } catch (err) {
              this.o.log(`[backup] ${file}: couldn't save to ${remote.name} (${err instanceof Error ? err.message : err}); will try again`);
            }
          }
        }
      })().finally(() => (this.saving = null));
    }
    return this.saving;
  }

  /** A clean copy of a SQLite file, made while it's in use (VACUUM INTO writes one file with everything in it). */
  private snapshot(file: string): Buffer | null {
    const source = join(this.o.dir, file);
    if (!existsSync(source)) return null;
    const copy = join(tmpdir(), `backup-${process.pid}-${file}`);
    rmSync(copy, { force: true });
    const db = new DatabaseSync(source);
    try {
      db.exec('PRAGMA busy_timeout = 5000');
      db.exec(`VACUUM INTO '${copy.replace(/'/g, "''")}'`);
    } finally {
      db.close();
    }
    const bytes = readFileSync(copy);
    rmSync(copy, { force: true });
    return bytes;
  }
}

let active: Backup | null = null;

/** The backup the environment asks for (GitHub and/or Discord settings), or null if it asks for none. */
export function backupFromEnv(dir: string, log: (line: string) => void): Backup | null {
  const remotes: Remote[] = [];
  if (process.env.BACKUP_REPO && process.env.BACKUP_TOKEN) remotes.push(new GitHubRemote(process.env.BACKUP_REPO, process.env.BACKUP_TOKEN, process.env.BACKUP_BRANCH || 'main'));
  if (process.env.BACKUP_DISCORD_TOKEN && process.env.BACKUP_DISCORD_CHANNEL) remotes.push(new DiscordRemote(process.env.BACKUP_DISCORD_TOKEN, process.env.BACKUP_DISCORD_CHANNEL));
  if (!remotes.length) return null;
  const files = (process.env.BACKUP_FILES ?? 'accounts.sqlite').split(',').map((f) => f.trim()).filter((f) => /^[\w.-]+$/.test(f));
  const everyMinutes = Math.max(1, Number(process.env.BACKUP_EVERY_MINUTES) || 5);
  active = new Backup({ remotes, dir, files, everyMinutes, log });
  return active;
}

/** At shutdown: save what changed one last time. */
export async function stopBackup() {
  await active?.stop();
}
