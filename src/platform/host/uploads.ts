// The game server's routes for games that aren't compiled into it (see host/library.ts):
//
//   GET    /g/<id>                         what a screen loads (`PackageEntry`): the current version
//   GET    /g/<id>/<version>/client.js     a kept version's client code (and its .map, game.json, workers/)
//   GET    /g/<id>/assets/<file>           its files
//   POST   /g[?id=<id>]                    upload a zip of a game's folder: built, smoke-tested, made current
//   GET    /g/mine                         the games one may manage, and whether one may upload
//   GET    /g/<id>/manage                  its record (owners only)
//   POST   /g/<id>/manage                  `{ current?, listed?, addOwner?, removeOwner?, recheck? }` (owners only)
//   DELETE /g/<id>[?forever=1]             stop hosting it (its files and record stay); for good: gone
//   POST   /uploads/terms                  `{ version }`: accept the upload terms
//   GET    /g/directory                    the community directory: hosted games in it, not on the home page
//   POST   /g/<id>/report                  `{ reason }`: a player reports a game
//   GET    /uploads                        a page for making an upload token (for `npm run game -- push`)
//   POST   /uploads/token                  a new upload token
//   GET    /admin                          every game, reports, bans, recent activity (admins only)
//   POST   /admin/reports/<n>              resolve a report
//   POST   /admin/bans                     `{ account (a name or id), banned, reason?, unhost? }`
//   GET    /admin/errors                   every error issue not resolved (POST /admin/errors/<id>: resolve it)
//   GET    /g/<id>/errors                  an uploaded game's error issues (owners; POST …/errors/<n>: resolve)
//
// Who's asking: an upload token (`Authorization: Bearer byu_…`), else the signed-in account (a page
// on the site, or this server's own). Who may upload: the accounts on the server's list of
// uploaders (UPLOADERS: their ids or Discord ids); on a development server, anyone. Admins (ADMINS)
// may also manage every game: approve one for the home page, take one off, stop hosting it, ban an
// account from uploading, resolve reports. A banned account may neither upload nor manage. Never a
// built game's server code.
import { readFile } from 'node:fs/promises';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { extname, join } from 'node:path';
import { packagePath, type AdminView, type DirectoryGame, type MyGame, type MyGames, type PackageEntry } from '../package/link';
import { discordCreated, type Account, type Accounts } from './accounts';
import type { Auth } from './auth';
import type { ErrorLog } from './errors';
import type { Stats } from './stats';
import type { GameLibrary, GameRecord } from './library';

/** What an uploader may do (admins: anything). */
export interface UploadLimits {
  /** Games an account may create (be the first owner of). */
  games: number;
  /** Bytes the games it created may take on disk (their versions, sources, files). */
  bytes: number;
  /** Uploads an hour. */
  perHour: number;
  /** Builds waiting at once (anyone's): past it, an upload is asked to wait. */
  queue: number;
  /** With `UPLOADERS=*` (anyone signed in): how old a Discord account must be (days). */
  minAgeDays: number;
}

export const UPLOAD_LIMITS: UploadLimits = { games: 10, bytes: 200 * 1024 * 1024, perHour: 20, queue: 10, minAgeDays: 7 };

/** The upload terms uploaders accept before their first upload: which version, and where to read them. */
export interface UploadTerms {
  version: number;
  url: string;
}

export interface UploadsOptions {
  library: GameLibrary;
  /** Error tracking: the admin sees every issue, an uploaded game's owners its own. */
  errors?: ErrorLog;
  /** Stats: an uploaded game's owners see its own, the admin every game's. */
  stats?: Stats;
  /** A built-in game's title (the admin's overview of stats names them). */
  titleOf?(id: string): string | undefined;
  accounts?: Accounts;
  auth?: Auth | null;
  /** Accounts that may upload: their ids or Discord ids; `*`: anyone signed in (old enough: `limits.minAgeDays`). */
  uploaders: string[];
  limits?: Partial<UploadLimits>;
  /** Terms to accept before uploading (none: not asked). */
  terms?: UploadTerms | null;
  /** Accounts that may manage every game (and upload): their ids or Discord ids. */
  admins?: string[];
  /** The site's addresses: where a game's link points (the first), and the pages that may manage games. */
  sites: string[];
  /** A development server: anyone may upload and manage (a guest as `dev`). */
  dev: boolean;
  log?(line: string): void;
}

/** The biggest upload (a zip). */
export const MAX_UPLOAD = 50 * 1024 * 1024;

const CONTENT_TYPES: Record<string, string> = {
  '.js': 'text/javascript; charset=utf-8',
  '.map': 'application/json',
  '.json': 'application/json',
  '.glb': 'model/gltf-binary',
  '.gltf': 'model/gltf+json',
  '.bin': 'application/octet-stream',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.ogg': 'audio/ogg',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.css': 'text/css; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
};

const VERSION = /^[0-9a-f]{12}$/;

export class Uploads {
  private readonly own: string;

  private readonly limits: UploadLimits;
  /** Each uploader's uploads in the last hour (when). */
  private recent = new Map<string, number[]>();

  constructor(private o: UploadsOptions) {
    this.own = new URL(o.library.publicUrl).origin;
    this.limits = { ...UPLOAD_LIMITS, ...o.limits };
  }

  /** Answer a `/g…` or `/uploads…` request: true if it was one. */
  handle(req: IncomingMessage, res: ServerResponse, path: string): boolean {
    if (path !== '/g' && !path.startsWith('/g/') && path !== '/uploads' && !path.startsWith('/uploads/') && path !== '/admin' && !path.startsWith('/admin/')) return false;
    const method = req.method ?? 'GET';
    // The site's pages ask with the player's sign-in (their games, uploads, changes).
    this.cors(req, res);
    if (method !== 'GET' && method !== 'HEAD') {
      if (method === 'OPTIONS') {
        res.writeHead(204, { 'Access-Control-Allow-Methods': 'GET, POST, DELETE', 'Access-Control-Allow-Headers': 'Authorization, Content-Type', 'Access-Control-Max-Age': '600' }).end();
        return true;
      }
    }
    void this.route(req, res, path, method).catch((err: unknown) => {
      this.o.log?.(`[uploads] ${method} ${path} failed: ${err instanceof Error ? (err.stack ?? err.message) : String(err)}`);
      if (!res.headersSent) this.json(res, 500, { error: 'Something went wrong on the server' });
    });
    return true;
  }

  private async route(req: IncomingMessage, res: ServerResponse, path: string, method: string) {
    if (path === '/uploads') return method === 'GET' ? this.tokenPage(res) : this.json(res, 405, { error: 'GET it' });
    if (path === '/uploads/token') return method === 'POST' ? this.newToken(req, res) : this.json(res, 405, { error: 'POST it' });
    if (path === '/uploads/terms') return method === 'POST' ? this.acceptTerms(req, res) : this.json(res, 405, { error: 'POST it' });
    if (path === '/g') return method === 'POST' ? this.upload(req, res, new URL(req.url ?? '/', 'http://server').searchParams.get('id') ?? undefined) : this.json(res, 405, { error: 'POST a zip' });
    if (path === '/g/mine') return method === 'GET' ? this.mine(req, res) : this.json(res, 405, { error: 'GET it' });
    if (path === '/g/directory') return method === 'GET' ? this.directory(res) : this.json(res, 405, { error: 'GET it' });
    if (path === '/admin' || path.startsWith('/admin/')) return this.admin(req, res, path, method);
    const parts = path.split('/').slice(2);
    const id = parts[0];
    if (parts.length === 2 && parts[1] === 'report' && method === 'POST') return this.report(req, res, id);
    if (parts[1] === 'errors' && (parts.length === 2 || parts.length === 3)) return this.gameErrors(req, res, id, method === 'POST' ? parts[2] : undefined);
    if (parts.length === 1 && method === 'DELETE') return this.manage(req, res, id, new URL(req.url ?? '/', 'http://server').searchParams.get('forever') ? { forever: true } : { current: null });
    if (parts.length === 2 && parts[1] === 'manage') {
      if (method === 'GET') return this.manage(req, res, id, null);
      if (method === 'POST') {
        const body = await readBody(req, 64 * 1024);
        let change: Change;
        try {
          change = JSON.parse(body?.toString() ?? '') as Change;
        } catch {
          return this.json(res, 400, { error: 'Send JSON: { current?, listed?, addOwner?, removeOwner? }' });
        }
        return this.manage(req, res, id, change);
      }
    }
    if (method === 'GET' || method === 'HEAD') return this.serve(res, parts);
    this.json(res, 405, { error: 'Not here' });
  }

  /** A screen's view of a game: what to load, then its code by version and its files. Never its server code. */
  private async serve(res: ServerResponse, parts: string[]) {
    const lib = this.o.library;
    const [id] = parts;
    const missing = () => res.writeHead(404, { 'Content-Type': 'text/plain' }).end('not found');
    if (parts.length === 1) {
      const v = lib.current(id);
      if (!v) return missing();
      const spec = lib.spec(v);
      const entry: PackageEntry = { id, version: v.version, meta: { ...v.meta, id }, modules: spec.modules, client: spec.client };
      return res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-cache' }).end(JSON.stringify(entry));
    }
    if (!lib.record(id)) return missing();
    const file =
      parts.length === 3 && parts[1] === 'assets' && /^[\w.-]+$/.test(parts[2]) && !parts[2].startsWith('.')
        ? join(lib.folder(id), 'assets', parts[2])
        : VERSION.test(parts[1]) && lib.version(id, parts[1])
          ? parts.length === 3 && ['client.js', 'client.js.map', 'game.json'].includes(parts[2])
            ? join(lib.folder(id), parts[1], parts[2])
            : parts.length === 4 && parts[2] === 'workers' && /^[\w-]+\.js(\.map)?$/.test(parts[3])
              ? join(lib.folder(id), parts[1], 'workers', parts[3])
              : null
          : null;
    if (!file) return missing();
    try {
      const body = await readFile(file);
      res.writeHead(200, { 'Content-Type': CONTENT_TYPES[extname(file)] ?? 'application/octet-stream', 'Cache-Control': 'public, max-age=31536000, immutable' }).end(body);
    } catch {
      missing();
    }
  }

  private async upload(req: IncomingMessage, res: ServerResponse, asId: string | undefined) {
    const who = this.who(req);
    if (!who) return this.json(res, 401, { error: req.headers.authorization ? 'That upload token is unknown or revoked' : 'Sign in, or send an upload token (Authorization: Bearer …)' });
    const why = this.whyNot(who);
    if (why) return this.json(res, 403, { error: why });
    const exempt = this.isAdmin(who) || this.o.dev;
    if (!exempt && this.o.terms && who.account && (this.o.accounts?.termsAccepted(who.account.id) ?? 0) < this.o.terms.version) {
      return this.json(res, 403, { error: `Accept the upload terms first: Your games, on the site (${this.o.terms.url})`, terms: this.o.terms });
    }
    const now = Date.now();
    const recent = (this.recent.get(who.by) ?? []).filter((t) => now - t < 3600_000);
    if (!exempt && recent.length >= this.limits.perHour) return this.json(res, 429, { error: `That's ${this.limits.perHour} uploads this hour: the most. Try again later` });
    if (this.o.library.waiting >= this.limits.queue) return this.json(res, 503, { error: 'Busy building other games: try again in a minute' });
    this.recent.set(who.by, [...recent, now]);
    const zip = await readBody(req, MAX_UPLOAD);
    if (!zip) return this.json(res, 413, { error: `Too big: ${MAX_UPLOAD / 1024 / 1024} MB at most` });
    if (!zip.length) return this.json(res, 400, { error: "Send the zip of a game's folder as the body" });
    const t0 = performance.now();
    // Its creator's limits, once its id is known: games and room on disk.
    const admit = exempt
      ? undefined
      : (_id: string, isNew: boolean, bytes: number) => {
          const used = this.o.library.usage(who.by);
          if (isNew && used.games >= this.limits.games) return `You have ${used.games} games here: the most is ${this.limits.games}. Delete one for good (Your games) to make room`;
          if (used.bytes + bytes > this.limits.bytes) return `Your games take ${mb(used.bytes)} of ${mb(this.limits.bytes)}: delete old ones (Your games) to make room`;
          return null;
        };
    const result = await this.o.library.upload(new Uint8Array(zip.buffer, zip.byteOffset, zip.length), who.by, asId, admit);
    if (!result.ok) {
      this.o.log?.(`[uploads] ${who.account?.name ?? who.by}'s upload refused (${result.status}): ${result.problems[0]}`);
      return this.json(res, result.status, { error: "Your game can't be hosted", problems: result.problems });
    }
    const play = this.o.sites[0] ? `${this.o.sites[0]}/?game=${result.id}` : null;
    this.json(res, 201, { id: result.id, version: result.version, summary: result.summary, ms: Math.round(performance.now() - t0), listed: result.record.listed, play });
  }

  /** A game's record (`change` null), or a change to it: its owners only. */
  private manage(req: IncomingMessage, res: ServerResponse, id: string, change: Change | null) {
    const lib = this.o.library;
    const who = this.who(req);
    if (!who) return this.json(res, 401, { error: 'Sign in, or send an upload token' });
    const record = lib.record(id);
    if (!record) return this.json(res, 404, { error: `No game "${id}" here` });
    const admin = this.isAdmin(who);
    if (!admin && this.banned(who)) return this.json(res, 403, { error: "You're banned from managing games here" });
    if (!this.o.dev && !admin && !record.owners.includes(who.by)) return this.json(res, 403, { error: `"${id}" isn't yours` });
    if (change?.forever) {
      lib.remove(id);
      this.o.stats?.forget(id);
      lib.note(who.by, 'deleted it for good', id);
      this.o.log?.(`[uploads] ${id} deleted for good by ${who.account?.name ?? who.by}`);
      return this.json(res, 200, { deleted: id });
    }
    if (change?.recheck) {
      // Smoke-test its current version again now (after a fix to the platform, say).
      void lib.recheck({ force: true, only: id }).then(() => this.json(res, 200, { record: lib.record(id), broken: lib.broken(id) }));
      return;
    }
    if (change) {
      const problems: string[] = [];
      if (change.current !== undefined && !lib.setCurrent(id, change.current)) problems.push(`no version "${change.current}"`);
      if (change.listed !== undefined && !lib.setListed(id, !!change.listed)) problems.push('not listed');
      if (change.addOwner) {
        // By account id or by name.
        const owner = this.o.accounts?.get(change.addOwner) ?? this.o.accounts?.byName(change.addOwner);
        if (!owner) problems.push(`no account "${change.addOwner}"`);
        else if (!lib.setOwner(id, owner.id, true)) problems.push(`can't add ${owner.name}`);
      }
      if (change.removeOwner && !lib.setOwner(id, change.removeOwner, false)) problems.push(`can't remove ${change.removeOwner} (a game keeps an owner)`);
      if (change.home) {
        // Owners ask (or stop asking); admins approve, decline, or take it off.
        const mine = change.home === 'ask' || change.home === 'withdraw';
        if (!mine && !admin) problems.push('only an admin may do that');
        else if (change.home === 'ask' && record.home === 'approved') problems.push("it's on the home page already");
        else lib.setHome(id, { ask: 'asked', withdraw: null, approve: 'approved', decline: 'declined', remove: null }[change.home] as GameRecord['home'] | null);
      }
      if (problems.length) return this.json(res, 400, { error: problems.join('; '), record: lib.record(id) });
      this.o.log?.(`[uploads] ${id}: ${JSON.stringify(change)} by ${who.account?.name ?? who.by}`);
      lib.note(who.by, describeChange(change, (a) => this.name(a)), id);
    }
    this.json(res, 200, { record: lib.record(id) satisfies GameRecord | undefined, entry: packagePath.entry(id) });
  }

  /** The games one may manage (all of them on a development server), and whether one may upload. */
  private mine(req: IncomingMessage, res: ServerResponse) {
    const who = this.who(req);
    if (!who) return this.json(res, 401, { error: 'Sign in first' });
    const games = this.o.library
      .records()
      .filter((r) => this.o.dev || r.owners.includes(who.by))
      .map((r) => this.myGame(r))
      .sort((a, b) => (b.versions[0]?.built ?? '').localeCompare(a.versions[0]?.built ?? ''));
    const exempt = this.isAdmin(who) || this.o.dev;
    const used = this.o.library.usage(who.by);
    this.json(res, 200, {
      uploader: this.mayUpload(who),
      admin: this.isAdmin(who),
      account: who.account ? { id: who.account.id, name: who.account.name } : null,
      games,
      why: this.whyNot(who),
      open: this.o.uploaders.includes('*'),
      limits: exempt ? null : { games: this.limits.games, bytes: this.limits.bytes, usedGames: used.games, usedBytes: used.bytes },
      terms: this.o.terms && !exempt ? { ...this.o.terms, accepted: !!who.account && (this.o.accounts?.termsAccepted(who.account.id) ?? 0) >= this.o.terms.version } : null,
    } satisfies MyGames);
  }

  /** A game as its owners' page shows it. */
  private myGame(r: GameRecord): MyGame {
    const lib = this.o.library;
    const latest = r.versions[r.versions.length - 1];
    const shown = r.versions.find((v) => v.version === r.current)?.meta ?? latest?.meta;
    return {
      id: r.id,
      title: shown?.title ?? r.id,
      accent: shown?.accent,
      cover: shown?.cover,
      listed: r.listed,
      current: r.current,
      created: r.created,
      owners: r.owners.map((id) => ({ id, name: this.name(id) })),
      versions: [...r.versions].reverse().map((v) => ({ version: v.version, built: v.built, by: this.name(v.by), title: v.meta.title })),
      play: this.o.sites[0] ? `${this.o.sites[0]}/?game=${r.id}` : null,
      broken: ((b) => (b ? { at: b.at, errors: b.errors ?? [] } : null))(lib.broken(r.id)),
      home: r.home ?? null,
      errors: this.o.errors?.counts().get(r.id) ?? 0,
      stats: this.o.stats?.game(r.id) ?? null,
    };
  }

  /** Someone, by name: an account's, or what `local` and `dev` stand for. */
  private name(id: string): string {
    return id === 'local' ? 'this server' : id === 'dev' || id === 'guest' ? 'a guest' : id === 'server' ? 'the server' : (this.o.accounts?.get(id)?.name ?? 'someone gone');
  }

  /** The community directory: hosted games in it that aren't on the home page (nor broken). */
  private directory(res: ServerResponse) {
    const lib = this.o.library;
    const games: DirectoryGame[] = lib.records().flatMap((r) => {
      const v = r.listed && r.home !== 'approved' && !lib.broken(r.id) ? lib.current(r.id) : undefined;
      if (!v) return [];
      const spec = lib.spec(v);
      const kept = r.versions.find((x) => x.version === v.version);
      return [{ id: r.id, title: v.meta.title, tagline: v.meta.tagline, accent: v.meta.accent, cover: v.meta.cover, by: r.owners.map((o) => this.name(o)), updated: kept?.built ?? r.created, entry: { id: r.id, version: v.version, meta: { ...v.meta, id: r.id }, modules: spec.modules, client: spec.client } }];
    });
    games.sort((a, b) => b.updated.localeCompare(a.updated));
    res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-cache' }).end(JSON.stringify({ games }));
  }

  /** An uploaded game's errors, for its owners (and admins): what's not resolved; or resolve one. */
  private gameErrors(req: IncomingMessage, res: ServerResponse, id: string, resolve?: string) {
    const who = this.who(req);
    if (!who) return this.json(res, 401, { error: 'Sign in first' });
    const record = this.o.library.record(id);
    if (!record) return this.json(res, 404, { error: `No game "${id}" here` });
    if (!this.o.dev && !this.isAdmin(who) && !record.owners.includes(who.by)) return this.json(res, 403, { error: `"${id}" isn't yours` });
    if (!this.o.errors) return this.json(res, 200, { issues: [] });
    if (resolve) {
      const done = this.o.errors.resolve(resolve);
      if (!done || done.game !== id) return this.json(res, 404, { error: 'No such error' });
      return this.json(res, 200, { ok: true });
    }
    this.json(res, 200, { issues: this.o.errors.issues({ game: id, own: true }) });
  }

  /** A player reports a game (signed in, or a guest): kept for the admins. */
  private async report(req: IncomingMessage, res: ServerResponse, id: string) {
    const lib = this.o.library;
    if (!lib.record(id) || !this.o.accounts) return this.json(res, 404, { error: `No game "${id}" here` });
    const body = await readBody(req, 8 * 1024);
    let reason = '';
    try {
      reason = String((JSON.parse(body?.toString() ?? '{}') as { reason?: unknown }).reason ?? '').trim();
    } catch {
      // not JSON: no reason
    }
    if (!reason) return this.json(res, 400, { error: 'Say what the problem is' });
    // A few a while from each address (a guest's are as welcome, but not a flood).
    const address = String(req.headers['fly-client-ip'] ?? req.socket.remoteAddress ?? '?');
    const now = Date.now();
    const recent = (this.reported.get(address) ?? []).filter((t) => now - t < 10 * 60_000);
    if (recent.length >= 5) return this.json(res, 429, { error: 'Thanks: that is plenty for now' });
    this.reported.set(address, [...recent, now]);
    const account = this.o.auth?.who(req) ?? null;
    const n = this.o.accounts.report(id, lib.record(id)?.current ?? null, account?.id ?? null, reason);
    lib.note(account?.id ?? 'guest', `reported: ${reason.slice(0, 120)}`, id);
    this.o.log?.(`[uploads] ${id} reported (#${n}) by ${account?.name ?? 'a guest'}`);
    this.json(res, 201, { ok: true });
  }

  private reported = new Map<string, number[]>();

  /** The admins' routes. */
  private async admin(req: IncomingMessage, res: ServerResponse, path: string, method: string) {
    const who = this.who(req);
    if (!who) return this.json(res, 401, { error: 'Sign in first' });
    if (!this.isAdmin(who)) return this.json(res, 403, { error: 'Admins only' });
    const accounts = this.o.accounts;
    const lib = this.o.library;
    if (path === '/admin' && method === 'GET') {
      const reports = accounts?.reports() ?? [];
      const view: AdminView = {
        games: lib
          .records()
          .map((r) => ({ ...this.myGame(r), reports: reports.filter((x) => x.game === r.id).length }))
          .sort((a, b) => (b.versions[0]?.built ?? '').localeCompare(a.versions[0]?.built ?? '')),
        reports: reports.map((r) => ({ id: r.id, game: r.game, version: r.version, name: r.name, reason: r.reason, at: r.at })),
        bans: (accounts?.bans() ?? []).map((b) => ({ account: b.account, name: b.name, reason: b.reason, at: b.at })),
        activity: lib.activity(100).map((a) => ({ ...a, by: this.name(a.by) })),
        stats: (this.o.stats?.overview() ?? []).map((row) => ({ ...row, title: this.o.titleOf?.(row.game) ?? lib.current(row.game)?.meta.title })),
      };
      return this.json(res, 200, view);
    }
    if (path === '/admin/errors' && method === 'GET') return this.json(res, 200, { issues: this.o.errors?.issues({ limit: 200 }) ?? [] });
    const fixed = /^\/admin\/errors\/([0-9a-f]{16})$/.exec(path);
    if (fixed && method === 'POST') return this.json(res, this.o.errors?.resolve(fixed[1]) ? 200 : 404, {});
    const resolve = /^\/admin\/reports\/(\d+)$/.exec(path);
    if (resolve && method === 'POST') {
      const ok = !!accounts?.resolveReport(Number(resolve[1]), who.by);
      return this.json(res, ok ? 200 : 404, ok ? { ok } : { error: 'No such report waiting' });
    }
    if (path === '/admin/bans' && method === 'POST' && accounts) {
      const body = await readBody(req, 8 * 1024);
      let ask: { account?: string; banned?: boolean; reason?: string; unhost?: boolean };
      try {
        ask = JSON.parse(body?.toString() ?? '') as typeof ask;
      } catch {
        return this.json(res, 400, { error: 'Send JSON: { account, banned, reason?, unhost? }' });
      }
      const target = ask.account ? (accounts.get(ask.account) ?? accounts.byName(ask.account)) : null;
      if (!target) return this.json(res, 404, { error: `No account "${ask.account ?? ''}"` });
      if (this.isAdmin({ account: target })) return this.json(res, 400, { error: "An admin can't be banned" });
      const banned = ask.banned !== false;
      accounts.ban(target.id, banned, who.by, ask.reason ?? '');
      // Their games, stopped too (if asked): those they own alone.
      const stopped = banned && ask.unhost ? lib.records().filter((r) => r.current && r.owners.length === 1 && r.owners[0] === target.id).map((r) => (lib.setCurrent(r.id, null), r.id)) : [];
      lib.note(who.by, `${banned ? 'banned' : 'unbanned'} ${target.name}${ask.reason ? ` (${ask.reason})` : ''}${stopped.length ? `; stopped hosting ${stopped.join(', ')}` : ''}`);
      return this.json(res, 200, { ok: true, stopped });
    }
    this.json(res, 404, { error: 'Not here' });
  }

  private newToken(req: IncomingMessage, res: ServerResponse) {
    const account = this.o.auth?.who(req, this.own) ?? null;
    if (!account || !this.o.accounts) return this.json(res, 401, { error: 'Sign in first' });
    if (!this.mayUpload({ by: account.id, account })) return this.json(res, 403, { error: `${account.name} isn't one of this server's uploaders (their account id: ${account.id})` });
    const token = this.o.accounts.newUploadToken(account.id);
    this.o.log?.(`[uploads] an upload token for ${account.name}`);
    this.json(res, 200, { token, account: { id: account.id, name: account.name } });
  }

  /** A page of the server's own for making an upload token (the site gets a proper one later). */
  private tokenPage(res: ServerResponse) {
    const signIn = this.o.dev ? '/auth/dev?name=Tester' : `/auth/discord?back=${encodeURIComponent(this.o.sites[0] ?? '')}`;
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' }).end(TOKEN_PAGE.replace('{{signIn}}', signIn));
  }

  /** Who's asking: an upload token's account, the signed-in account, or (a development server) a guest. */
  private who(req: IncomingMessage): { by: string; account: Account | null } | null {
    const bearer = /^Bearer\s+(\S+)$/.exec(req.headers.authorization ?? '')?.[1];
    if (bearer) {
      const account = this.o.accounts?.uploadToken(bearer) ?? null;
      return account ? { by: account.id, account } : null;
    }
    const account = this.o.auth?.who(req, this.own) ?? null;
    if (account) return { by: account.id, account };
    return this.o.dev ? { by: 'dev', account: null } : null;
  }

  private mayUpload(who: { by: string; account: Account | null }): boolean {
    return this.whyNot(who) === null;
  }

  /** Why `who` may not upload (null: they may). */
  private whyNot(who: { by: string; account: Account | null }): string | null {
    if (this.isAdmin(who)) return null;
    if (this.banned(who)) return "You're banned from uploading games here";
    if (this.o.dev) return null;
    const a = who.account;
    if (!a) return 'Sign in to upload games';
    if (this.o.uploaders.includes(a.id) || this.o.uploaders.includes(a.discord)) return null;
    if (!this.o.uploaders.includes('*')) return `${a.name} isn't one of this server's uploaders`;
    // Anyone signed in, with a Discord account old enough (a new one is cheap to make).
    const made = discordCreated(a.discord);
    if (made && Date.now() - made.getTime() < this.limits.minAgeDays * 86400_000) return `Your Discord account is newer than ${this.limits.minAgeDays} days: try again when it's older`;
    return null;
  }

  /** `POST /uploads/terms {version}`: the signed-in account (or a token's) accepts the upload terms. */
  private async acceptTerms(req: IncomingMessage, res: ServerResponse) {
    const who = this.who(req);
    if (!who?.account || !this.o.accounts) return this.json(res, 401, { error: 'Sign in first' });
    const body = await readBody(req, 4096);
    let version = 0;
    try {
      version = Number((JSON.parse(body?.toString() ?? '{}') as { version?: unknown }).version);
    } catch {
      // (no version)
    }
    if (!this.o.terms || version !== this.o.terms.version) return this.json(res, 400, { error: 'Those terms are out of date: read them again', terms: this.o.terms });
    this.o.accounts.acceptTerms(who.account.id, version);
    this.o.library.note(who.by, `accepted the upload terms (version ${version})`);
    this.json(res, 200, { ok: true });
  }

  /** On the server's list of admins (by account id or Discord id). */
  private isAdmin(who: { account: Account | null }): boolean {
    const a = who.account;
    return !!a && !!this.o.admins?.length && (this.o.admins.includes(a.id) || this.o.admins.includes(a.discord));
  }

  private banned(who: { account: Account | null }): boolean {
    return !!who.account && !!this.o.accounts?.banned(who.account.id);
  }

  /** The site's pages (and this server's own) may manage games with the player's sign-in. */
  private cors(req: IncomingMessage, res: ServerResponse) {
    const origin = req.headers.origin;
    res.setHeader('Vary', 'Origin');
    if (origin && (this.o.auth?.allowed(origin) || origin === this.own)) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Access-Control-Allow-Credentials', 'true');
    }
  }

  private json(res: ServerResponse, status: number, body: unknown) {
    res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }).end(JSON.stringify(body));
  }
}

/** What an owner may change of a game (`POST /g/<id>/manage`). */
interface Change {
  /** The version new rooms run (null: stop hosting it). */
  current?: string | null;
  listed?: boolean;
  addOwner?: string;
  removeOwner?: string;
  /** Smoke-test its current version again now. */
  recheck?: boolean;
  /** Delete it for good (`DELETE /g/<id>?forever=1`). */
  forever?: boolean;
  /** The home page: its owners ask (or withdraw); an admin approves, declines or takes it off (remove). */
  home?: 'ask' | 'withdraw' | 'approve' | 'decline' | 'remove';
}

/** A change to a game, in words (the activity log). */
function describeChange(c: Change, name: (account: string) => string): string {
  const said: string[] = [];
  if (c.current === null) said.push('stopped hosting it');
  else if (c.current) said.push(`made version ${c.current} current`);
  if (c.listed !== undefined) said.push(c.listed ? 'put it in the directory' : 'took it out of the directory');
  if (c.addOwner) said.push(`added owner ${c.addOwner}`);
  if (c.removeOwner) said.push(`removed owner ${name(c.removeOwner)}`);
  if (c.home) said.push({ ask: 'asked for the home page', withdraw: 'stopped asking for the home page', approve: 'approved it for the home page', decline: 'declined it for the home page', remove: 'took it off the home page' }[c.home]);
  return said.join('; ') || 'changed it';
}

/** A request's body, or null if it's longer than `limit`. */
function readBody(req: IncomingMessage, limit: number): Promise<Buffer | null> {
  return new Promise((done, fail) => {
    const declared = Number(req.headers['content-length'] ?? 0);
    if (declared > limit) {
      req.resume();
      return done(null);
    }
    const chunks: Buffer[] = [];
    let size = 0;
    let over = false;
    req.on('data', (c: Buffer) => {
      if (over) return;
      size += c.length;
      if (size > limit) {
        over = true;
        chunks.length = 0;
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => done(over ? null : Buffer.concat(chunks)));
    req.on('error', fail);
  });
}

const TOKEN_PAGE = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Upload token</title>
<style>
  :root { color-scheme: dark; --bg: #14161b; --panel: #1e2129; --text: #e9ebf0; --dim: #9aa1ad; --accent: #ffd36b; }
  body { margin: 0; background: var(--bg); color: var(--text); font: 16px/1.5 system-ui, sans-serif; display: grid; place-items: center; min-height: 100vh; padding: 16px; box-sizing: border-box; }
  main { background: var(--panel); border-radius: 12px; padding: 28px; max-width: 560px; width: 100%; box-sizing: border-box; }
  h1 { margin: 0 0 8px; font-size: 22px; } p { color: var(--dim); margin: 8px 0 16px; }
  button { background: var(--accent); color: #111; border: 0; border-radius: 8px; padding: 10px 18px; font: inherit; font-weight: 600; cursor: pointer; }
  code, pre { background: #0d0f13; border-radius: 6px; padding: 2px 6px; font-size: 14px; }
  pre { padding: 12px; overflow-x: auto; white-space: pre-wrap; word-break: break-all; }
  a { color: var(--accent); } .error { color: #ff7a7a; }
</style></head>
<body><main>
  <h1>Upload games from the command line</h1>
  <p>An upload token lets <code>npm run game -- push</code> upload games as you. It lasts until revoked: keep it to yourself.</p>
  <button id="make">Make a token</button>
  <div id="out"></div>
</main>
<script>
  const out = document.getElementById('out');
  document.getElementById('make').onclick = async () => {
    const res = await fetch('/uploads/token', { method: 'POST', credentials: 'same-origin' });
    const body = await res.json().catch(() => ({}));
    if (res.status === 401) { out.innerHTML = '<p>Sign in first: <a href="{{signIn}}">sign in</a>, then come back here.</p>'; return; }
    if (!res.ok) { out.innerHTML = '<p class="error"></p>'; out.firstChild.textContent = body.error || 'That failed'; return; }
    out.innerHTML = '<p>Your token, shown this once (as ' + body.account.name.replace(/[<>&]/g, '') + '):</p><pre></pre><p>Then, in the repo:</p><pre></pre>';
    const pres = out.querySelectorAll('pre');
    pres[0].textContent = body.token;
    pres[1].textContent = 'npm run game -- token ' + body.token + ' --server ' + location.origin + '\\nnpm run game -- push src/games/<your game> --server ' + location.origin;
  };
</script>
</body></html>`;

const mb = (bytes: number) => (bytes < 1024 * 1024 ? `${Math.round(bytes / 1024)} KB` : `${Math.round(bytes / 1024 / 1024)} MB`);
