// The games a server hosts that aren't compiled into it (docs/PROPOSAL-UPLOADS.md): uploaded, or
// built from a folder (`--package`). Kept on disk, so they outlast a restart or a deploy:
//
//   <root>/<id>/library.json               who owns it, its versions, the current one, listed or not
//   <root>/<id>/<version>/…                a built version (see package/build.ts)
//   <root>/<id>/assets/…                   its files, shared by its versions
//   <root>/<id>/source/<version>.zip       what each version was built from
//
// A new version is built in a folder of its own (<root>/.incoming/), smoke-tested in a thread of
// its own (the server's main thread never runs a built game's code), and only then moved in and
// made current. Rooms already running keep the version they started with.
import { randomBytes } from 'node:crypto';
import { appendFileSync, cpSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { GameDefinition, GameMeta } from '../api/types';
import type { BuiltGame } from '../package/build';
import { BuildError, GAME_ID, packagePath, type PackageManifest } from '../package/link';
import { unzipGame, zipFolder } from '../package/zip';
import type { Worker } from 'node:worker_threads';
import type { SmokeResult } from './packaged';
import type { SmokeWorkerData, SmokeWorkerResult } from './room-worker';

/** One built version, as the library keeps it. */
export interface VersionRecord {
  version: string;
  /** When it was built (ISO time). */
  built: string;
  /** Who uploaded it: an account's id, or `local` (`--package`), or `dev` (a development server's guest). */
  by: string;
  /** Its meta, as its server code defines it (from the smoke test). */
  meta: GameMeta;
  /** Its last smoke test: on which platform build (`LibraryOptions.platform`), and how it went. */
  check?: VersionCheck;
}

/** A version's smoke test against one build of the platform. */
export interface VersionCheck {
  platform: string;
  ok: boolean;
  /** When (ISO time). */
  at: string;
  /** What went wrong. */
  errors?: string[];
}

/** A game in the library (`library.json`). */
export interface GameRecord {
  id: string;
  /** Who may upload versions of it and manage it (accounts' ids, or `local`). */
  owners: string[];
  /** The version new rooms run (null: not hosted). */
  current: string | null;
  /** In the community directory (else found by its link only). */
  listed: boolean;
  /**
   * The home page: its owners asked for it, an admin approved (it's on the shelf) or declined it
   * (absent: nobody asked). Approval is for the game, its new versions too, until taken back.
   */
  home?: 'asked' | 'approved' | 'declined';
  /** Its versions, oldest first (the last `KEEP_VERSIONS`). */
  versions: VersionRecord[];
  created: string;
}

/** A version the server can run: where it is, and its manifest and meta. */
export interface HostedVersion {
  id: string;
  version: string;
  dir: string;
  manifest: PackageManifest;
  meta: GameMeta;
}

/** An uploader's limits, asked once a game's id is known: why it may not go up (or null). */
export type Admit = (id: string, isNew: boolean, bytes: number) => string | null;

export type UploadResult = { ok: true; id: string; version: string; record: GameRecord; summary: string } | { ok: false; status: number; problems: string[] };

export interface LibraryOptions {
  /** Where it's kept (`<data>/games`). */
  root: string;
  /** The server's address as players reach it: where a game's files are named. */
  publicUrl: string;
  /** Ids no upload may take (the games compiled into the server). */
  taken(id: string): boolean;
  /** Build a game's folder into `out` (package/build.ts's `buildGame`, which loads esbuild: only when building). */
  build(folder: string, out: string, id: string | undefined): Promise<BuiltGame>;
  /** Smoke-test a built version (its folder), in a thread of its own. */
  smoke(dir: string): Promise<SmokeResult>;
  /**
   * Which build of the platform this is (a hash of the server's code and the engine): a game's
   * current version is smoke-tested again (`recheck`) when the platform it last passed on differs.
   */
  platform: string;
  log?(line: string): void;
}

/** Ids no game may have: the server's own routes (`/g/mine`, `/g/directory`). */
const RESERVED = new Set(['mine', 'directory', 'admin']);
/** How long the library's activity log keeps what happened (days). */
const ACTIVITY_DAYS = 90;

/** Something that happened in the library (the admin's recent activity). */
export interface Activity {
  at: string;
  /** Who did it (an account's id, `local`, `dev`, `server`). */
  by: string;
  game?: string;
  text: string;
}

/** Versions kept of each game (with their files): older ones go. */
export const KEEP_VERSIONS = 10;

export class GameLibrary {
  private games = new Map<string, GameRecord>();
  /** Builds one at a time (each takes a core and some memory for a few seconds). */
  private queue: Promise<unknown> = Promise.resolve();
  /** Told when a game's hosting changes (a new current version, listed, gone): its id. */
  onChange: ((id: string) => void) | null = null;

  private constructor(private o: LibraryOptions) {}

  /** The library at `o.root`, as it was left. */
  static open(o: LibraryOptions): GameLibrary {
    const lib = new GameLibrary(o);
    mkdirSync(o.root, { recursive: true });
    rmSync(join(o.root, '.incoming'), { recursive: true, force: true });
    for (const id of readdirSync(o.root)) {
      const file = join(o.root, id, 'library.json');
      if (!GAME_ID.test(id) || !existsSync(file)) continue;
      try {
        const record = JSON.parse(readFileSync(file, 'utf8')) as GameRecord;
        if (record.id === id) lib.games.set(id, record);
      } catch (err) {
        o.log?.(`[library] ${id}: library.json unreadable (${err instanceof Error ? err.message : String(err)}); not hosted`);
      }
    }
    return lib;
  }

  /** Every game in it. */
  records(): GameRecord[] {
    return [...this.games.values()];
  }

  record(id: string): GameRecord | undefined {
    return this.games.get(id);
  }

  /** A version of a game, if it's kept. */
  version(id: string, version: string): HostedVersion | undefined {
    const v = this.games.get(id)?.versions.find((r) => r.version === version);
    if (!v) return undefined;
    const dir = join(this.o.root, id, version);
    try {
      return { id, version, dir, manifest: JSON.parse(readFileSync(join(dir, 'game.json'), 'utf8')) as PackageManifest, meta: v.meta };
    } catch {
      return undefined;
    }
  }

  /** The version new rooms of a game run (none: not hosted). */
  current(id: string): HostedVersion | undefined {
    const r = this.games.get(id);
    return r?.current ? this.version(id, r.current) : undefined;
  }

  /** The server's address as players reach it. */
  get publicUrl(): string {
    return this.o.publicUrl;
  }

  /** Where a game's files are kept (`<root>/<id>`). */
  folder(id: string): string {
    return join(this.o.root, id);
  }

  /** What a room of a game's version needs to run it (`RoomSpec.package`). */
  spec(v: HostedVersion) {
    return { dir: v.dir, publicUrl: this.o.publicUrl, version: v.version, client: this.o.publicUrl + packagePath.version(v.id, v.version, 'client.js'), modules: v.manifest.modules.client };
  }

  /**
   * A game's current version as the server's main thread knows it: its meta only (its code runs
   * only in its rooms' threads), as a definition.
   */
  definition(id: string): GameDefinition | undefined {
    const v = this.current(id);
    return v ? ({ ...v.meta, id } as GameDefinition) : undefined;
  }

  /**
   * Why a game can't be played (its current version failed its smoke test on this platform: a
   * platform update broke it), or null.
   */
  broken(id: string): VersionCheck | null {
    const r = this.games.get(id);
    const check = r?.versions.find((v) => v.version === r.current)?.check;
    return check && !check.ok ? check : null;
  }

  /**
   * Smoke-test hosted games' current versions again on this build of the platform: those last
   * checked on another (`force`: all, or just `only`). A failing one is broken (not listed, not
   * played, its owners told) until it passes again or a new version is uploaded. One at a time,
   * like builds. What it found: each game checked, and whether it passed.
   */
  recheck({ force = false, only }: { force?: boolean; only?: string } = {}): Promise<{ id: string; ok: boolean }[]> {
    const due = [...this.games.values()].filter((r) => r.current && (!only || r.id === only) && (force || r.versions.find((v) => v.version === r.current)?.check?.platform !== this.o.platform));
    const run = this.queue.then(async () => {
      const found: { id: string; ok: boolean }[] = [];
      for (const r of due) {
        const v = r.current ? this.version(r.id, r.current) : undefined;
        const kept = r.versions.find((x) => x.version === r.current);
        if (!v || !kept) continue;
        const smoke = await this.o.smoke(v.dir).catch((err: unknown) => ({ ok: false, errors: [err instanceof Error ? err.message : String(err)], summary: 'the smoke test failed' }) as SmokeResult);
        const ok = smoke.ok;
        kept.check = { platform: this.o.platform, ok, at: new Date().toISOString(), ...(ok ? {} : { errors: smoke.errors.slice(0, 10) }) };
        this.save(r);
        found.push({ id: r.id, ok });
        if (!ok) this.note('server', `broken by a platform update (${this.o.platform}): ${smoke.errors[0]?.split('\n')[0]}`, r.id);
        this.o.log?.(`[library] ${r.id}: version ${v.version} ${ok ? 'passes' : 'FAILS'} its smoke test on platform ${this.o.platform}${ok ? '' : `: ${smoke.errors[0]?.split('\n')[0]}`}`);
      }
      return found;
    });
    this.queue = run.catch(() => {});
    return run;
  }

  /** Who may manage a game: its owners (anyone, for a game nobody has yet). */
  mayManage(id: string, who: string): boolean {
    const r = this.games.get(id);
    return !r || r.owners.includes(who);
  }

  /**
   * Build and host an uploaded zip of a game's folder, by `by`. `id`: under another id than its
   * meta's. `admit`: the uploader's limits, asked once the game's id is known (whether it's a new
   * game of theirs): why not, or null.
   */
  upload(zip: Uint8Array, by: string, id?: string, admit?: Admit): Promise<UploadResult> {
    return this.serially(async (work) => {
      let folder: string;
      try {
        folder = unzipGame(zip, join(work, 'src'));
      } catch (err) {
        return { ok: false, status: 400, problems: [err instanceof Error ? err.message : String(err)] };
      }
      return this.add(folder, zip, by, id, work, admit);
    });
  }

  /** Build and host the game in a folder on this machine (`--package`), by `by`. */
  install(folder: string, by: string, id?: string): Promise<UploadResult> {
    return this.serially(async (work) => {
      let zip: Uint8Array;
      try {
        zip = zipFolder(folder);
      } catch (err) {
        return { ok: false, status: 400, problems: [err instanceof Error ? err.message : String(err)] };
      }
      return this.add(folder, zip, by, id, work);
    });
  }

  /** Make a kept version the current one (back to an older one, say). */
  setCurrent(id: string, version: string | null): boolean {
    const r = this.games.get(id);
    if (!r || (version !== null && !r.versions.some((v) => v.version === version))) return false;
    r.current = version;
    this.save(r);
    return true;
  }

  /** A game's home page state (see `GameRecord.home`; null: none). */
  setHome(id: string, home: GameRecord['home'] | null): boolean {
    const r = this.games.get(id);
    if (!r) return false;
    if (home) r.home = home;
    else delete r.home;
    this.save(r);
    return true;
  }

  /** Note something that happened (kept in `<root>/activity.jsonl` for 90 days). */
  note(by: string, text: string, game?: string) {
    const entry: Activity = { at: new Date().toISOString(), by, ...(game ? { game } : {}), text };
    const file = join(this.o.root, 'activity.jsonl');
    try {
      appendFileSync(file, `${JSON.stringify(entry)}\n`);
      // Once a day, what's older than 90 days goes.
      if (Date.now() - this.trimmed < 24 * 3600_000) return;
      this.trimmed = Date.now();
      const since = new Date(Date.now() - ACTIVITY_DAYS * 24 * 3600_000).toISOString();
      const lines = readFileSync(file, 'utf8').trim().split('\n');
      const kept = lines.filter((l) => (/"at":"([^"]+)"/.exec(l)?.[1] ?? '') >= since);
      if (kept.length < lines.length) writeFileSync(file, kept.length ? `${kept.join('\n')}\n` : '');
    } catch {
      // (the activity log is a convenience)
    }
  }
  private trimmed = 0;

  /** What happened lately, newest first. */
  activity(limit = 200): Activity[] {
    try {
      const lines = readFileSync(join(this.o.root, 'activity.jsonl'), 'utf8').trim().split('\n').slice(-limit).reverse();
      return lines.flatMap((l) => {
        try {
          return [JSON.parse(l) as Activity];
        } catch {
          return [];
        }
      });
    } catch {
      return [];
    }
  }

  setListed(id: string, listed: boolean): boolean {
    const r = this.games.get(id);
    if (!r) return false;
    r.listed = listed;
    this.save(r);
    return true;
  }

  /** Delete a game for good: its versions, files, source and record (its data in its own database stays). */
  remove(id: string): boolean {
    if (!this.games.has(id)) return false;
    this.games.delete(id);
    this.sizes.delete(id);
    rmSync(this.folder(id), { recursive: true, force: true });
    this.onChange?.(id);
    return true;
  }

  /** Add or remove an owner (a game keeps at least one). */
  setOwner(id: string, account: string, owner: boolean): boolean {
    const r = this.games.get(id);
    if (!r || (!owner && r.owners.length === 1 && r.owners[0] === account)) return false;
    r.owners = owner ? [...new Set([...r.owners, account])] : r.owners.filter((o) => o !== account);
    this.save(r);
    return true;
  }

  /** Builds waiting or under way. */
  get waiting(): number {
    return this.queued;
  }
  private queued = 0;

  /**
   * What the games `by` created (whose first owner they are) take: how many, and their bytes on disk
   * (their versions, sources and files).
   */
  usage(by: string): { games: number; bytes: number } {
    const mine = [...this.games.values()].filter((r) => r.owners[0] === by);
    return { games: mine.length, bytes: mine.reduce((n, r) => n + this.size(r.id), 0) };
  }

  /** A game's bytes on disk (counted once, again after it changes). */
  private size(id: string): number {
    const known = this.sizes.get(id);
    if (known !== undefined) return known;
    const bytes = existsSync(this.folder(id)) ? dirBytes(this.folder(id)) : 0;
    this.sizes.set(id, bytes);
    return bytes;
  }
  private sizes = new Map<string, number>();

  private serially(run: (work: string) => Promise<UploadResult>): Promise<UploadResult> {
    this.queued++;
    const next = this.queue.then(async () => {
      const work = join(this.o.root, '.incoming', randomBytes(6).toString('hex'));
      mkdirSync(work, { recursive: true });
      try {
        return await run(work);
      } finally {
        this.queued--;
        rmSync(work, { recursive: true, force: true });
      }
    });
    this.queue = next.catch(() => {});
    return next;
  }

  /** Build `folder` in `work`, check it may be hosted, smoke-test it, move it in and make it current. */
  private async add(folder: string, zip: Uint8Array, by: string, asId: string | undefined, work: string, admit?: Admit): Promise<UploadResult> {
    let built: BuiltGame;
    try {
      built = await this.o.build(folder, join(work, 'out'), asId);
    } catch (err) {
      if (err instanceof BuildError) {
        this.note(by, `upload refused: ${err.problems[0]}`, asId);
        return { ok: false, status: 400, problems: err.problems };
      }
      throw err;
    }
    const { id, version } = built;
    const refuse = (status: number, problems: string[]): UploadResult => {
      this.note(by, `upload refused: ${problems[0]}`, id);
      return { ok: false, status, problems };
    };
    if (RESERVED.has(id)) return refuse(409, [`"${id}" is a word the server keeps for itself: give your game another id`]);
    if (this.o.taken(id)) return refuse(409, [`"${id}" is a game this server has built in: give yours another id`]);
    if (!this.mayManage(id, by)) return refuse(403, [`"${id}" is someone else's game: ask one of its owners to add you, or give yours another id`]);
    // What it would add on disk: its built code, its files not kept yet, its source.
    const home = this.folder(id);
    const adds = zip.length + dirBytes(built.dir) + built.manifest.assets.filter((a) => !existsSync(join(home, 'assets', a))).reduce((n, a) => n + statSync(join(work, 'out', id, 'assets', a)).size, 0);
    const over = admit?.(id, !this.games.has(id), adds);
    if (over) return refuse(403, [over]);
    const smoke = await this.o.smoke(built.dir);
    if (!smoke.ok || !smoke.meta) return refuse(400, [`it failed its smoke test (${smoke.summary}):`, ...smoke.errors]);
    // Moved in: the version, its new files, its source.
    mkdirSync(join(home, 'assets'), { recursive: true });
    mkdirSync(join(home, 'source'), { recursive: true });
    if (!existsSync(join(home, version))) renameSync(built.dir, join(home, version));
    for (const name of built.manifest.assets) if (!existsSync(join(home, 'assets', name))) cpSync(join(work, 'out', id, 'assets', name), join(home, 'assets', name));
    writeFileSync(join(home, 'source', `${version}.zip`), zip);
    const now = new Date().toISOString();
    const r: GameRecord = this.games.get(id) ?? { id, owners: [by], current: null, listed: false, versions: [], created: now };
    r.versions = [...r.versions.filter((v) => v.version !== version), { version, built: now, by, meta: { ...smoke.meta, id }, check: { platform: this.o.platform, ok: true, at: now } }];
    r.current = version;
    // Older versions go (their code and source; files still in use stay).
    while (r.versions.length > KEEP_VERSIONS) {
      const old = r.versions.shift()!;
      rmSync(join(home, old.version), { recursive: true, force: true });
      rmSync(join(home, 'source', `${old.version}.zip`), { force: true });
    }
    this.games.set(id, r);
    this.sizes.delete(id);
    this.save(r);
    this.o.log?.(`[library] ${id}: version ${version} by ${by} (${smoke.summary})`);
    this.note(by, `uploaded version ${version} (${smoke.meta.title})`, id);
    return { ok: true, id, version, record: r, summary: smoke.summary };
  }

  private save(r: GameRecord) {
    const file = join(this.folder(r.id), 'library.json');
    mkdirSync(this.folder(r.id), { recursive: true });
    writeFileSync(`${file}.new`, JSON.stringify(r, null, 1));
    renameSync(`${file}.new`, file);
    this.onChange?.(r.id);
  }
}

/**
 * Smoke-test built games each in a thread of its own (a room's worker in smoke mode: the server's
 * main thread never runs a built game's code), given `limit` seconds.
 */
export function smokeInThread(start: (data: SmokeWorkerData) => Worker, wasm: Uint8Array | WebAssembly.Module, publicUrl: string, limit = 120): (dir: string) => Promise<SmokeResult> {
  return (dir) => {
    const thread = start({ smoke: { dir, publicUrl }, wasm });
    return new Promise<SmokeResult>((done) => {
      const fail = (why: string) => done({ ok: false, errors: [why], summary: 'the smoke test failed' });
      const timer = setTimeout(() => {
        fail(`it took more than ${limit} s (a loop that never ends?)`);
        void thread.terminate();
      }, limit * 1000);
      thread.on('message', (m: SmokeWorkerResult) => {
        clearTimeout(timer);
        done(m.result);
      });
      thread.on('error', (err: Error) => {
        clearTimeout(timer);
        fail(err.stack ?? err.message);
      });
      thread.on('exit', (code) => {
        clearTimeout(timer);
        fail(`its thread ended (${code})`);
      });
    });
  };
}

/** A folder's bytes, all the way down. */
function dirBytes(dir: string): number {
  let n = 0;
  for (const e of readdirSync(dir, { withFileTypes: true })) n += e.isDirectory() ? dirBytes(join(dir, e.name)) : statSync(join(dir, e.name)).size;
  return n;
}
