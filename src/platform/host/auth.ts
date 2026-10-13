import { randomBytes } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { SESSION_SECONDS, cleanName, type Account, type Accounts, type DiscordUser } from './accounts';
import { normalAvatar } from '../avatar';
import { wearable, type Cosmetic } from '../cosmetics';

/** Sign in with Discord: its application's id and secret (Fly secrets `DISCORD_CLIENT_ID`, `DISCORD_CLIENT_SECRET`). */
export interface DiscordApp {
  id: string;
  secret: string;
}

export interface AuthOptions {
  accounts: Accounts;
  /** Absent: signing in with Discord is off (a development server still has `/auth/dev`). */
  discord?: DiscordApp | null;
  /**
   * The site's addresses (`https://blockyard.gg`): where players may be sent back to
   * after signing in, and the only pages that may ask who's signed in or connect as them. A
   * development server also allows any `http://localhost` page.
   */
  sites: string[];
  /** A development server: `GET /auth/dev?name=Ann` signs in as a made-up account. */
  dev: boolean;
  /**
   * Sign in with just a typed name (`POST /auth/name`): the name is the account, the session a
   * token the page sends as `Authorization: Bearer` (no cookie, so it works inside another site's
   * frame). Anyone may type any name: it keeps progress, it doesn't prove who someone is.
   */
  nameSignIn?: boolean;
  /** Everything kept for an account is going (`DELETE /me`): the server clears the games' data for it. */
  onDelete?: (account: Account) => void;
  /** Every cosmetic on the platform (what may be worn: `/me/look`). */
  catalog?: ReadonlyMap<string, Cosmetic>;
  log?: (line: string) => void;
}

const DISCORD = 'https://discord.com';

/** The cookies a request carries. */
export function cookies(req: IncomingMessage): Map<string, string> {
  const out = new Map<string, string>();
  for (const part of (req.headers.cookie ?? '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out.set(part.slice(0, i).trim(), decodeURIComponent(part.slice(i + 1).trim()));
  }
  return out;
}

/** Whether the request came over HTTPS (behind Fly's proxy, it says so in a header). */
const secure = (req: IncomingMessage) => req.headers['x-forwarded-proto'] === 'https' || !!(req.socket as { encrypted?: boolean }).encrypted;

/**
 * The session cookie's name: `__Host-session` over HTTPS (only this host, only secure, the
 * browser holds it to that), plain `session` on `http://localhost` in development.
 */
const sessionCookie = (req: IncomingMessage) => (secure(req) ? '__Host-session' : 'session');

/**
 * Sign in with Discord and sessions, on the game server: the routes, and who a request (or a
 * WebSocket upgrade) is. The session is an HttpOnly cookie on the server's own address, which the
 * site (the same site: both under one domain) sends with its requests and connections, and no
 * page script can read.
 */
export class Auth {
  constructor(private o: AuthOptions) {}

  /** A page at this origin may use the player's sign-in. */
  allowed(origin: string | undefined): boolean {
    if (!origin) return false;
    if (this.o.sites.includes(origin)) return true;
    return this.o.dev && /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);
  }

  /**
   * Who's signed in, making this request (a WebSocket upgrade, say): only for a page on the site
   * (or at `alsoFrom`: the game server's own pages).
   */
  who(req: IncomingMessage, alsoFrom?: string): Account | null {
    const bearer = this.bearer(req);
    if (bearer) {
      const a = this.o.accounts.session(bearer);
      if (a) return a;
    }
    const origin = req.headers.origin;
    // (A browser always says where a WebSocket comes from; a page elsewhere doesn't get to be them.)
    if (origin !== undefined && !this.allowed(origin) && origin !== alsoFrom) return null;
    return this.o.accounts.session(cookies(req).get(sessionCookie(req)));
  }

  /** The token a request sends as `Authorization: Bearer …` (a name sign-in's session), if any. */
  private bearer(req: IncomingMessage): string | undefined {
    const h = req.headers.authorization;
    return h && h.startsWith('Bearer ') ? h.slice(7).trim() || undefined : undefined;
  }

  /** Answer an `/auth/…` or `/me` request: true if it was one. */
  handle(req: IncomingMessage, res: ServerResponse, path: string): boolean {
    if (path === '/auth/name' || path === '/me' || path === '/me/name' || path === '/me/achievements' || path === '/me/look' || path === '/auth/logout') {
      this.cors(req, res);
      if (req.method === 'OPTIONS') {
        res.writeHead(204, { 'Access-Control-Allow-Methods': 'GET, POST, DELETE', 'Access-Control-Allow-Headers': 'Content-Type, Authorization', 'Access-Control-Max-Age': '600' }).end();
        return true;
      }
    }
    const url = new URL(req.url ?? '/', 'http://server');
    switch (path) {
      case '/auth/discord':
        this.startDiscord(req, res, url);
        return true;
      case '/auth/discord/callback':
        void this.finishDiscord(req, res, url).catch((err: unknown) => {
          this.o.log?.(`sign-in failed: ${err instanceof Error ? err.message : String(err)}`);
          this.back(res, this.site(), 'failed');
        });
        return true;
      case '/auth/dev':
        this.devSignIn(req, res, url);
        return true;
      case '/auth/name':
        void this.nameRoute(req, res);
        return true;
      case '/auth/logout':
        if (req.method === 'POST') this.signOut(req, res);
        else this.fail(res, 405, 'POST it');
        return true;
      case '/me':
        this.me(req, res);
        return true;
      case '/me/name':
        void this.rename(req, res);
        return true;
      case '/me/look':
        void this.lookRoute(req, res);
        return true;
      case '/me/achievements': {
        const account = this.account(req);
        if (!account) this.fail(res, 401, 'Not signed in');
        else res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }).end(JSON.stringify({ achievements: this.o.accounts.achievements(account.id) }));
        return true;
      }
    }
    return false;
  }

  /** CORS for the site's own pages, with the cookie (and nobody else). */
  private cors(req: IncomingMessage, res: ServerResponse) {
    const origin = req.headers.origin;
    res.setHeader('Vary', 'Origin');
    if (origin && this.allowed(origin)) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Access-Control-Allow-Credentials', 'true');
    } else if (this.o.nameSignIn) {
      // Another site's page (Partytime's frame): it has no cookie here, only a bearer token it sends itself.
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.removeHeader('Access-Control-Allow-Credentials');
    } else res.removeHeader('Access-Control-Allow-Origin');
  }

  /** The request's signed-in account, for the site's routes: the cookie is enough (CORS keeps other pages from reading the answer). */
  private account(req: IncomingMessage): Account | null {
    const bearer = this.bearer(req);
    if (bearer) {
      const a = this.o.accounts.session(bearer);
      if (a) return a;
    }
    const origin = req.headers.origin;
    if (origin !== undefined && !this.allowed(origin)) return null;
    return this.o.accounts.session(cookies(req).get(sessionCookie(req)));
  }

  /** Where to send someone back to: a page on the site (asked for), else the site. */
  private site(asked?: string | null): string {
    if (asked) {
      try {
        const u = new URL(asked);
        if (this.allowed(u.origin)) return u.href;
      } catch {
        // not a URL
      }
    }
    return this.o.sites[0] ?? '/';
  }

  private startDiscord(req: IncomingMessage, res: ServerResponse, url: URL) {
    const app = this.o.discord;
    if (!app) return this.fail(res, 404, 'Signing in with Discord is off on this server');
    const state = randomBytes(18).toString('base64url');
    const back = this.site(url.searchParams.get('back'));
    const q = new URLSearchParams({ client_id: app.id, response_type: 'code', redirect_uri: this.callback(req), scope: 'identify', state, prompt: 'none' });
    res.setHeader('Set-Cookie', this.cookie(req, 'oauth', `${state}.${Buffer.from(back).toString('base64url')}`, 600, '/auth'));
    res.writeHead(302, { Location: `${DISCORD}/oauth2/authorize?${q}` }).end();
  }

  /** Discord's redirect back here (what the application has on its list). */
  private callback(req: IncomingMessage): string {
    return `${secure(req) ? 'https' : 'http'}://${req.headers.host}/auth/discord/callback`;
  }

  private async finishDiscord(req: IncomingMessage, res: ServerResponse, url: URL) {
    const app = this.o.discord;
    if (!app) return this.fail(res, 404, 'Signing in with Discord is off on this server');
    const [state, back64] = (cookies(req).get('oauth') ?? '').split('.');
    const back = this.site(back64 ? Buffer.from(back64, 'base64url').toString() : null);
    res.setHeader('Set-Cookie', this.cookie(req, 'oauth', '', 0, '/auth'));
    // Turned down on Discord's page, or not the sign-in we started.
    if (url.searchParams.get('error')) return this.back(res, back, 'cancelled');
    if (!state || url.searchParams.get('state') !== state) return this.back(res, back, 'failed');
    const code = url.searchParams.get('code');
    if (!code) return this.back(res, back, 'failed');
    const token = await fetch(`${DISCORD}/api/oauth2/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Authorization: `Basic ${Buffer.from(`${app.id}:${app.secret}`).toString('base64')}` },
      body: new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri: this.callback(req) }),
    });
    if (!token.ok) throw new Error(`Discord's token: ${token.status} ${await token.text()}`);
    const { access_token } = (await token.json()) as { access_token: string };
    const me = await fetch(`${DISCORD}/api/users/@me`, { headers: { Authorization: `Bearer ${access_token}` } });
    if (!me.ok) throw new Error(`Discord's user: ${me.status}`);
    // Who they are is all we wanted: Discord's token isn't kept.
    const account = this.o.accounts.fromDiscord((await me.json()) as DiscordUser);
    this.o.log?.(`signed in: ${account.name} (${account.id})`);
    this.signIn(req, res, account, back);
  }

  /** A development server's sign-in, as a made-up account: `/auth/dev?name=Ann[&back=page]`. */
  private devSignIn(req: IncomingMessage, res: ServerResponse, url: URL) {
    if (!this.o.dev) return this.fail(res, 404, 'not found');
    const name = url.searchParams.get('name') || 'Tester';
    const account = this.o.accounts.fromDiscord({ id: `dev:${name}`, username: name });
    const back = url.searchParams.get('back');
    if (back) return this.signIn(req, res, account, this.site(back));
    const token = this.o.accounts.startSession(account.id);
    res.setHeader('Set-Cookie', this.cookie(req, sessionCookie(req), token, SESSION_SECONDS));
    res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify(this.public(account)));
  }

  /**
   * `GET /auth/name`: is signing in with a name on here? `POST /auth/name {name}`: sign in as that
   * name (the account is made the first time, the same one every time after) and get `{ token, id,
   * name, avatar }`; the page sends the token as `Authorization: Bearer`.
   */
  private async nameRoute(req: IncomingMessage, res: ServerResponse) {
    if (!this.o.nameSignIn) return this.fail(res, 404, 'Signing in with a name is off on this server');
    if (req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }).end(JSON.stringify({ enabled: true }));
      return;
    }
    if (req.method !== 'POST') return this.fail(res, 405, 'POST it');
    let body = '';
    for await (const chunk of req) {
      body += chunk;
      if (body.length > 1000) return this.fail(res, 413, 'Too long');
    }
    let asked = '';
    try {
      asked = String((JSON.parse(body) as { name?: unknown }).name ?? '');
    } catch {
      return this.fail(res, 400, 'Send { "name": "..." }');
    }
    const name = cleanName(asked);
    if (name.length < 2) return this.fail(res, 400, 'Pick a name of at least 2 letters or numbers');
    const account = this.o.accounts.fromDiscord({ id: `name:${name.toLowerCase()}`, username: name });
    const token = this.o.accounts.startSession(account.id);
    res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }).end(JSON.stringify({ token, ...this.public(account) }));
  }

  private signIn(req: IncomingMessage, res: ServerResponse, account: Account, back: string) {
    const token = this.o.accounts.startSession(account.id);
    res.appendHeader('Set-Cookie', this.cookie(req, sessionCookie(req), token, SESSION_SECONDS));
    res.writeHead(302, { Location: back }).end();
  }

  /** Back to the site, saying how signing in went (`?signin=failed`) when it didn't. */
  private back(res: ServerResponse, page: string, outcome: 'failed' | 'cancelled') {
    const u = new URL(page);
    u.searchParams.set('signin', outcome);
    res.writeHead(302, { Location: u.href }).end();
  }

  private signOut(req: IncomingMessage, res: ServerResponse) {
    const token = cookies(req).get(sessionCookie(req));
    if (token) this.o.accounts.endSession(token);
    const bearer = this.bearer(req);
    if (bearer) this.o.accounts.endSession(bearer);
    res.setHeader('Set-Cookie', this.cookie(req, sessionCookie(req), '', 0));
    res.writeHead(204).end();
  }

  private me(req: IncomingMessage, res: ServerResponse) {
    const account = this.account(req);
    if (!account) return this.fail(res, 401, 'Not signed in');
    if (req.method === 'DELETE') {
      this.o.accounts.delete(account.id);
      this.o.onDelete?.(account);
      this.o.log?.(`account deleted: ${account.id}`);
      res.setHeader('Set-Cookie', this.cookie(req, sessionCookie(req), '', 0));
      res.writeHead(204).end();
      return;
    }
    res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }).end(JSON.stringify(this.public(account)));
  }

  private async rename(req: IncomingMessage, res: ServerResponse) {
    const account = this.account(req);
    if (!account) return this.fail(res, 401, 'Not signed in');
    if (req.method !== 'POST') return this.fail(res, 405, 'POST it');
    let body = '';
    for await (const chunk of req) {
      body += chunk;
      if (body.length > 1000) return this.fail(res, 413, 'Too long');
    }
    let asked = '';
    try {
      asked = String((JSON.parse(body) as { name?: unknown }).name ?? '');
    } catch {
      return this.fail(res, 400, 'Send { "name": "..." }');
    }
    const r = this.o.accounts.rename(account.id, asked);
    if ('error' in r) return this.fail(res, 409, r.error);
    res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify(this.public({ ...account, name: r.name })));
  }

  /**
   * `GET /me/look`: what they wear (their avatar's code, the cosmetics on) and what they own.
   * `POST` `{ avatar?, wear? }` changes it: an avatar's code (or null), and cosmetics they own or
   * anyone may wear, one to a slot (anything else is left off).
   */
  private async lookRoute(req: IncomingMessage, res: ServerResponse) {
    const account = this.account(req);
    if (!account) return this.fail(res, 401, 'Not signed in');
    const accounts = this.o.accounts;
    const answer = () => {
      const look = accounts.look(account.id);
      res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }).end(JSON.stringify({ ...look, owned: accounts.owned(account.id) }));
    };
    if (req.method !== 'POST') return answer();
    let body = '';
    for await (const chunk of req) {
      body += chunk;
      if (body.length > 4000) return this.fail(res, 413, 'Too long');
    }
    let asked: { avatar?: unknown; wear?: unknown };
    try {
      asked = JSON.parse(body) as typeof asked;
    } catch {
      return this.fail(res, 400, 'Send { "avatar": "...", "wear": [...] }');
    }
    const change: { avatar?: string | null; wear?: string[] } = {};
    if (asked.avatar === null || (typeof asked.avatar === 'string' && normalAvatar(asked.avatar))) change.avatar = asked.avatar === null ? null : normalAvatar(asked.avatar as string);
    else if (asked.avatar !== undefined) return this.fail(res, 400, "That isn't an avatar");
    if (Array.isArray(asked.wear)) change.wear = wearable(asked.wear.filter((w): w is string => typeof w === 'string').slice(0, 16), new Set(Object.keys(accounts.owned(account.id))), this.o.catalog ?? new Map());
    accounts.setLook(account.id, change);
    answer();
  }

  /** What the site gets to know of an account. */
  private public(a: Account) {
    return { id: a.id, name: a.name, avatar: a.avatar };
  }

  private fail(res: ServerResponse, status: number, error: string) {
    res.writeHead(status, { 'Content-Type': 'application/json' }).end(JSON.stringify({ error }));
  }

  private cookie(req: IncomingMessage, name: string, value: string, maxAge: number, path = '/'): string {
    return `${name}=${encodeURIComponent(value)}; Path=${path}; Max-Age=${maxAge}; HttpOnly; SameSite=Lax${secure(req) ? '; Secure' : ''}`;
  }
}
