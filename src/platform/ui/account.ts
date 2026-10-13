import { h } from './dom';
import type { Earned } from './profile';

/** Who's signed in (`GET /me` on the game server). */
export interface SignedIn {
  id: string;
  name: string;
  avatar: string | null;
}

// Signing in with a name (on a server that allows it): no cookie, so a token the page sends itself.
const SAVED_NAME = 'blockyard.account';
const realFetch: typeof fetch = typeof window === 'undefined' ? (undefined as unknown as typeof fetch) : window.fetch.bind(window);
let bearer: { base: string; token: string } | null = null;
let active: AccountCorner | null = null;

/** From now on, requests to the game server `base` carry this token (null: none). */
function useToken(base: string, token: string | null) {
  bearer = token ? { base, token } : null;
}
if (typeof window !== 'undefined') window.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  if (!bearer || !url.startsWith(`${bearer.base}/`)) return realFetch(input, init);
  const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined));
  headers.set('Authorization', `Bearer ${bearer.token}`);
  // (No cookies with a token: the server answers other sites' pages for that.)
  return realFetch(input, { ...init, headers, credentials: 'omit' });
};

/** A room ticket for the name that's locked in (so the game's connection is theirs): null if none. */
export function nameTicket(game: string): Promise<string | null> {
  return active ? active.ticket(game) : Promise.resolve(null);
}

/**
 * The home page's corner for who you are: "Sign in with Discord" for a guest; your avatar and
 * name, and a menu (sign out, delete the account), once you're signed in. Signing in happens on
 * the game server (its `/auth/discord`, back to this page after); its session cookie is the
 * server's, so this page only ever learns who you are (`/me`), never the session.
 */
export class AccountCorner {
  readonly root = h('div.home-account');
  /** The server lets players sign in with just a name. */
  nameOn = false;
  /** Signed in with a name (so the name is locked, and a token goes with each request). */
  get nameLogin(): boolean {
    return !!bearer;
  }
  /** Who's signed in (null: a guest), once `loaded`. */
  me: SignedIn | null = null;
  loaded = false;
  /** Signed in or out, or renamed. */
  onChange: ((me: SignedIn | null) => void) | null = null;
  /** Something to say on the page (signing in failed, say). */
  onSay: ((text: string) => void) | null = null;
  /** "Achievements" in the menu: open the profile. */
  onProfile: (() => void) | null = null;
  /** "Your look" in the menu: open the locker. */
  onLocker: (() => void) | null = null;
  /** "Your games" in the menu (an uploader's): open their games. */
  onGames: (() => void) | null = null;
  /** May upload games to this server (asked once signed in). */
  uploader = false;
  private http: string | null = null;
  private menuOpen = false;

  /**
   * @param typed the name in the name box (a development server signs in as it).
   */
  constructor(private typed: () => string) {
    active = this;
    // A click anywhere else closes the menu.
    document.addEventListener('pointerdown', (e) => {
      if (this.menuOpen && !this.root.contains(e.target as Node)) this.toggleMenu(false);
    });
  }

  /** The game server it asks (its `https://` address), once known. */
  get server(): string | null {
    return this.http;
  }

  /** Ask this game server (its `https://` address) who's signed in: once per server. */
  use(http: string) {
    if (this.http === http) return;
    this.http = http;
    // Back from Discord without signing in: say why, and tidy the address.
    const url = new URL(location.href);
    const outcome = url.searchParams.get('signin');
    if (outcome) {
      url.searchParams.delete('signin');
      history.replaceState(null, '', url);
      this.onSay?.(outcome === 'cancelled' ? 'Signing in was cancelled' : "Signing in didn't work: try again");
    }
    void this.begin(http);
  }

  /** Learn if names can sign in here, sign back in as the one kept, and ask who's signed in. */
  private async begin(http: string) {
    this.nameOn = await realFetch(`${http}/auth/name`).then((r) => r.ok).catch(() => false);
    // (Not signed back in from a name kept in this browser: every screen in one browser shares it,
    // and they'd all become one player. Play locks in the name typed on that screen.)
    const me = await fetch(`${http}/me`, { credentials: 'include' })
      .then((r) => (r.ok ? (r.json() as Promise<SignedIn>) : null))
      .catch(() => null);
    if (this.http !== http) return;
    this.me = me;
    this.loaded = true;
    this.render();
    this.onChange?.(me);
    if (me) void this.askUploader(http);
  }

  /** Sign in as this name (the same account every time): keeps it for next time. */
  private async nameSignIn(http: string, name: string) {
    const r = await realFetch(`${http}/auth/name`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name }) });
    const body = (await r.json().catch(() => ({}))) as { token?: string; error?: string };
    if (!r.ok || !body.token) throw new Error(body.error ?? "Couldn't lock in that name");
    useToken(http, body.token);
  }

  /** The button: lock in the name typed, and save progress to it. */
  async lockName() {
    const http = this.http;
    if (!http) return;
    const name = this.typed();
    if (name.length < 2) return this.onSay?.('Type a name first (2 or more letters or numbers)');
    try {
      await this.nameSignIn(http, name);
    } catch (err) {
      return this.onSay?.(err instanceof Error ? err.message : String(err));
    }
    const me = await fetch(`${http}/me`).then((r) => (r.ok ? (r.json() as Promise<SignedIn>) : null)).catch(() => null);
    this.me = me;
    this.render();
    this.onChange?.(me);
    if (me) this.onSay?.(`Locked in as ${me.name}: your progress is saved to it`);
  }

  /** A room ticket, so the game connection is theirs (only a name sign-in needs one). */
  async ticket(game: string): Promise<string | null> {
    if (!this.me || !this.http || !bearer) return null;
    const r = await fetch(`${this.http}/tickets`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ game }) }).catch(() => null);
    return r?.ok ? (((await r.json().catch(() => ({}))) as { ticket?: string }).ticket ?? null) : null;
  }

  /** Whether they may upload games here: then "Your games" is in the menu. */
  private async askUploader(http: string) {
    const r = await fetch(`${http}/g/mine`, { credentials: 'include' }).catch(() => null);
    const mine = r?.ok ? ((await r.json()) as { uploader?: boolean; open?: boolean }) : null;
    // (Where anyone may upload, it's there for everyone signed in: it says why if they can't yet.)
    if (this.http !== http || !(mine?.uploader || mine?.open)) return;
    this.uploader = true;
    this.render();
  }

  /** The achievements they've earned in every game (signed in; null for a guest, or if it can't be had). */
  async earned(): Promise<Earned | null> {
    if (!this.me || !this.http) return null;
    try {
      const r = await fetch(`${this.http}/me/achievements`, { credentials: 'include' });
      return r.ok ? ((await r.json()) as { achievements: Earned }).achievements : null;
    } catch {
      return null;
    }
  }

  /** What they wear and own (signed in), or null. */
  async look(): Promise<{ avatar: string | null; wear: string[]; owned: Record<string, string> } | null> {
    if (!this.me || !this.http) return null;
    try {
      const r = await fetch(`${this.http}/me/look`, { credentials: 'include' });
      return r.ok ? ((await r.json()) as { avatar: string | null; wear: string[]; owned: Record<string, string> }) : null;
    } catch {
      return null;
    }
  }

  /** Keep what they wear for their account (signed in): what was kept (what they may wear of it). */
  async saveLook(avatar: string, wear: string[]): Promise<{ avatar: string | null; wear: string[] } | null> {
    if (!this.me || !this.http) return null;
    try {
      const r = await fetch(`${this.http}/me/look`, { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ avatar, wear }) });
      return r.ok ? ((await r.json()) as { avatar: string | null; wear: string[] }) : null;
    } catch {
      return null;
    }
  }

  /** Take a new name (signed in): the name as kept, or throws with why not. */
  async rename(name: string): Promise<string> {
    const r = await fetch(`${this.http}/me/name`, { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name }) });
    const body = (await r.json().catch(() => ({}))) as { name?: string; error?: string };
    if (!r.ok || !body.name) throw new Error(body.error ?? "Couldn't change your name");
    this.me = { ...this.me!, name: body.name };
    this.render();
    this.onChange?.(this.me);
    return body.name;
  }

  /** Off to Discord (a development server signs in as the name typed, at once), and back here. */
  signIn() {
    if (!this.http) return;
    if (this.nameOn) return void this.lockName();
    const back = encodeURIComponent(location.href);
    location.assign(import.meta.env.DEV ? `${this.http}/auth/dev?name=${encodeURIComponent(this.typed() || 'Tester')}&back=${back}` : `${this.http}/auth/discord?back=${back}`);
  }

  private render() {
    this.toggleMenu(false);
    if (!this.loaded) return this.root.replaceChildren();
    if (!this.me) {
      // (No sign-in button: the name typed is locked in when they press Play.)
      return this.root.replaceChildren();
    }
    const me = this.me;
    const face = me.avatar ? h('img.home-avatar', { src: me.avatar, alt: '', referrerpolicy: 'no-referrer' }) : h('span.home-avatar.blank', {}, me.name.slice(0, 1));
    const chip = h('button.home-me', { onclick: () => this.toggleMenu(!this.menuOpen), 'aria-haspopup': 'menu' }, face, h('span.home-me-name', {}, me.name));
    const remove = h('button.home-menu-item.danger', {}, 'Delete my account') as HTMLButtonElement;
    let armed = false;
    remove.onclick = () => {
      // Twice to be sure (no browser dialogs).
      if (!armed) {
        armed = true;
        remove.textContent = 'Click again: this deletes everything kept for you';
        return;
      }
      void fetch(`${this.http}/me`, { method: 'DELETE', credentials: 'include' }).finally(() => location.reload());
    };
    const menu = h(
      'div.home-menu',
      { role: 'menu' },
      h('div.home-menu-head', {}, 'Progress saved to this name'),
      h('button.home-menu-item', { onclick: () => (this.toggleMenu(false), this.onLocker?.()) }, 'Your look'),
      h('button.home-menu-item', { onclick: () => (this.toggleMenu(false), this.onProfile?.()) }, 'Your achievements'),
      this.uploader ? h('button.home-menu-item', { onclick: () => (this.toggleMenu(false), this.onGames?.()) }, 'Your games') : null,
      h('a.home-menu-item', { href: '/privacy.html', target: '_blank', rel: 'noopener' }, 'Privacy'),
      h('button.home-menu-item', { onclick: () => void this.signOut() }, 'Sign out'),
      remove,
    );
    this.root.replaceChildren(chip, menu);
  }

  private toggleMenu(open: boolean) {
    this.menuOpen = open;
    this.root.classList.toggle('open', open);
  }

  private async signOut() {
    await fetch(`${this.http}/auth/logout`, { method: 'POST', credentials: 'include' }).catch(() => {});
    try {
      localStorage.removeItem(SAVED_NAME);
    } catch {
      // (nothing kept)
    }
    // (The connection open now is theirs: a fresh page plays as a guest.)
    location.reload();
  }
}
