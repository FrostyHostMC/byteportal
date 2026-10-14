import { h } from './dom';
import { AccountCorner } from './account';
import { Profile, tally, type Earned } from './profile';
import { Locker, setGameNames, type Look } from './locker';
import { characterView } from './characterview';
import { avatarCode, avatarLook, parseAvatar, presetAvatar } from '../avatar';
import { cosmeticCatalog, type Cosmetic } from '../cosmetics';
import type { CosmeticDef } from '../api/types';
import { hintChips, keyHints, type GameControls } from './controls';
import { MyGamesPanel } from './mygames';
import { DirectoryPanel } from './directory';
import type { PackageEntry } from '../package/link';

/** Playing on a game server: the home page asks for a name, and says who's on. */
export interface OnlineOptions {
  /** The server (`wss://host`), to ask how many are playing each game. */
  server: string;
  /** The game on show. */
  game: string;
  /** In a room a player started of their own: its code (else the public game). */
  room: string | null;
  /** A game with rooms of players' own: start one (`true`), or go back to the public game. */
  onRoom?: (own: boolean) => void;
}

/** A game in the list: its meta (`GameMeta`), all the home page knows of it. */
interface ListedGame {
  id: string;
  title: string;
  tagline?: string;
  accent?: string;
  cover?: string;
  achievements?: Record<string, { title: string; description: string; hidden?: boolean }>;
  cosmetics?: Record<string, CosmeticDef>;
}

/** Blockyard's mark: the yard (a plot with a build on it, and someone holding up the next block), drawn isometric. */
export const MARK = '<svg aria-hidden="true" viewBox="15.8 -1.9 168.5 168.5"><defs><filter id="by-mark" x="-10%" y="-10%" width="120%" height="120%"><feMorphology in="SourceAlpha" operator="dilate" radius="2.0" result="d"/><feFlood flood-color="#0c0e12"/><feComposite in2="d" operator="in" result="o"/><feMerge><feMergeNode in="o"/><feMergeNode in="SourceGraphic"/></feMerge></filter></defs><g filter="url(#by-mark)"><polygon points="100.00,74.96 171.08,116.00 100.00,157.04 28.92,116.00" fill="#515761" />\n<polygon points="171.08,120.56 100.00,161.60 100.00,157.04 171.08,116.00" fill="#1b202a" />\n<polygon points="28.92,120.56 100.00,161.60 100.00,157.04 28.92,116.00" fill="#262d3a" />\n<polygon points="100.00,72.30 130.93,90.16 100.00,108.02 69.07,90.16" fill="#575f6e" />\n<polygon points="130.93,97.00 100.00,114.86 100.00,108.02 130.93,90.16" fill="#242b38" />\n<polygon points="69.07,97.00 100.00,114.86 100.00,108.02 69.07,90.16" fill="#323c4e" />\n<polygon points="100.00,75.87 124.75,90.16 100.00,104.45 75.25,90.16" fill="#686f7c" />\n<polygon points="127.84,98.10 103.09,112.39 103.09,106.92 127.84,92.63" fill="#252d3a" />\n<polygon points="72.16,98.10 96.91,112.39 96.91,106.92 72.16,92.63" fill="#3a4455" />\n<polygon points="67.09,91.30 98.03,109.16 67.09,127.02 36.16,109.16" fill="#5d6677" />\n<polygon points="98.03,116.00 67.09,133.86 67.09,127.02 98.03,109.16" fill="#2a3240" />\n<polygon points="36.16,116.00 67.09,133.86 67.09,127.02 36.16,109.16" fill="#3a4559" />\n<polygon points="132.91,91.30 163.84,109.16 132.91,127.02 101.97,109.16" fill="#5d6677" />\n<polygon points="163.84,116.00 132.91,133.86 132.91,127.02 163.84,109.16" fill="#2a3240" />\n<polygon points="101.97,116.00 132.91,133.86 132.91,127.02 101.97,109.16" fill="#3a4559" />\n<polygon points="67.09,94.87 91.84,109.16 67.09,123.45 42.34,109.16" fill="#6e7685" />\n<polygon points="94.93,117.10 70.18,131.39 70.18,125.92 94.93,111.63" fill="#2b3443" />\n<polygon points="39.25,117.10 64.00,131.39 64.00,125.92 39.25,111.63" fill="#424c60" />\n<polygon points="132.91,94.87 157.66,109.16 132.91,123.45 108.16,109.16" fill="#6e7685" />\n<polygon points="160.75,117.10 136.00,131.39 136.00,125.92 160.75,111.63" fill="#2b3443" />\n<polygon points="105.07,117.10 129.82,131.39 129.82,125.92 105.07,111.63" fill="#424c60" />\n<polygon points="100.00,110.30 130.93,128.16 100.00,146.02 69.07,128.16" fill="#575f6e" />\n<polygon points="130.93,135.00 100.00,152.86 100.00,146.02 130.93,128.16" fill="#242b38" />\n<polygon points="69.07,135.00 100.00,152.86 100.00,146.02 69.07,128.16" fill="#323c4e" />\n<polygon points="100.00,113.87 124.75,128.16 100.00,142.45 75.25,128.16" fill="#686f7c" />\n<polygon points="127.84,136.10 103.09,150.39 103.09,144.92 127.84,130.63" fill="#252d3a" />\n<polygon points="72.16,136.10 96.91,150.39 96.91,144.92 72.16,130.63" fill="#3a4455" />\n<polygon points="100.00,41.14 128.30,57.48 100.00,73.82 71.70,57.48" fill="#ff786e" />\n<polygon points="128.30,90.16 100.00,106.50 100.00,73.82 128.30,57.48" fill="#b84138" />\n<polygon points="71.70,90.16 100.00,106.50 100.00,73.82 71.70,57.48" fill="#ff5a4e" />\n<polygon points="100.00,45.06 121.51,57.48 100.00,69.90 78.49,57.48" fill="#ff857c" />\n<polygon points="124.91,88.20 103.40,100.62 103.40,75.78 124.91,63.36" fill="#bf433a" />\n<polygon points="75.09,88.20 96.60,100.62 96.60,75.78 75.09,63.36" fill="#ff6155" />\n<polygon points="67.09,75.72 95.39,92.06 67.09,108.40 38.79,92.06" fill="#ffcd60" />\n<polygon points="95.39,109.16 67.09,125.50 67.09,108.40 95.39,92.06" fill="#b88c2c" />\n<polygon points="38.79,109.16 67.09,125.50 67.09,108.40 38.79,92.06" fill="#ffc23d" />\n<polygon points="67.09,80.30 87.47,92.06 67.09,103.82 46.71,92.06" fill="#ffd270" />\n<polygon points="91.43,109.05 71.05,120.82 71.05,108.51 91.43,96.74" fill="#bf912e" />\n<polygon points="42.75,109.05 63.13,120.82 63.13,108.51 42.75,96.74" fill="#ffc445" />\n<polygon points="132.91,60.14 161.21,76.48 132.91,92.82 104.61,76.48" fill="#61b5ff" />\n<polygon points="161.21,109.16 132.91,125.50 132.91,92.82 161.21,76.48" fill="#2d77b8" />\n<polygon points="104.61,109.16 132.91,125.50 132.91,92.82 104.61,76.48" fill="#3ea5ff" />\n<polygon points="132.91,64.06 154.42,76.48 132.91,88.90 111.40,76.48" fill="#71bdff" />\n<polygon points="157.81,107.20 136.31,119.62 136.31,94.78 157.81,82.36" fill="#2e7cbf" />\n<polygon points="108.00,107.20 129.51,119.62 129.51,94.78 108.00,82.36" fill="#46a9ff" />\n<polygon points="100.00,3.14 128.30,19.48 100.00,35.82 71.70,19.48" fill="#54dfac" />\n<polygon points="128.30,52.16 100.00,68.50 100.00,35.82 128.30,19.48" fill="#229c6f" />\n<polygon points="71.70,52.16 100.00,68.50 100.00,35.82 71.70,19.48" fill="#2fd89a" />\n<polygon points="100.00,7.06 121.51,19.48 100.00,31.90 78.49,19.48" fill="#66e2b5" />\n<polygon points="124.91,50.20 103.40,62.62 103.40,37.78 124.91,25.36" fill="#23a273" />\n<polygon points="75.09,50.20 96.60,62.62 96.60,37.78 75.09,25.36" fill="#37da9e" />\n<polygon points="96.05,121.32 100.33,123.79 93.75,127.59 89.47,125.12" fill="#f6f4ee" />\n<polygon points="100.33,126.83 93.75,130.63 93.75,127.59 100.33,123.79" fill="#b0aea8" />\n<polygon points="89.47,128.16 93.75,130.63 93.75,127.59 89.47,125.12" fill="#f4f1ea" />\n<polygon points="101.65,124.55 105.92,127.02 99.34,130.82 95.06,128.35" fill="#f6f4ee" />\n<polygon points="105.92,130.06 99.34,133.86 99.34,130.82 105.92,127.02" fill="#b0aea8" />\n<polygon points="95.06,131.39 99.34,133.86 99.34,130.82 95.06,128.35" fill="#f4f1ea" />\n<polygon points="96.38,110.11 100.00,112.20 95.39,114.86 91.77,112.77" fill="#526282" />\n<polygon points="100.00,123.60 95.39,126.26 95.39,114.86 100.00,112.20" fill="#202d49" />\n<polygon points="91.77,124.17 95.39,126.26 95.39,114.86 91.77,112.77" fill="#2c3f66" />\n<polygon points="101.97,113.34 105.59,115.43 100.99,118.09 97.37,116.00" fill="#526282" />\n<polygon points="105.59,126.83 100.99,129.49 100.99,118.09 105.59,115.43" fill="#202d49" />\n<polygon points="97.37,127.40 100.99,129.49 100.99,118.09 97.37,116.00" fill="#2c3f66" />\n<polygon points="96.38,96.05 107.57,102.51 100.99,106.31 89.80,99.85" fill="#f4f2ed" />\n<polygon points="107.57,115.43 100.99,119.23 100.99,106.31 107.57,102.51" fill="#aeaca8" />\n<polygon points="89.80,112.77 100.99,119.23 100.99,106.31 89.80,99.85" fill="#f1efe9" />\n<polygon points="93.09,107.07 93.91,107.55 93.91,103.75 93.09,103.27" fill="#ff5a4e" />\n<polygon points="96.71,109.16 97.53,109.64 97.53,105.84 96.71,105.36" fill="#ff5a4e" />\n<polygon points="91.77,112.39 99.01,116.57 99.01,112.77 91.77,108.59" fill="#d4d2cd" />\n<polygon points="97.37,82.18 109.21,89.02 99.34,94.72 87.49,87.88" fill="#f3c69f" />\n<polygon points="109.21,101.94 99.34,107.64 99.34,94.72 109.21,89.02" fill="#ad8563" />\n<polygon points="87.49,100.80 99.34,107.64 99.34,94.72 87.49,87.88" fill="#f0b98a" />\n<polygon points="97.37,80.09 110.20,87.50 99.34,93.77 86.51,86.36" fill="#6b5548" />\n<polygon points="110.20,90.54 99.34,96.81 99.34,93.77 110.20,87.50" fill="#352317" />\n<polygon points="86.51,89.40 99.34,96.81 99.34,93.77 86.51,86.36" fill="#4a3020" />\n<polygon points="86.50,91.68 99.34,99.09 99.34,96.43 86.50,89.02" fill="#3b2619" />\n<polygon points="110.21,93.58 99.35,99.85 99.35,95.29 110.21,89.02" fill="#2c1c12" />\n<polygon points="87.32,93.68 89.96,95.20 89.96,93.30 87.32,91.78" fill="#3b2619" />\n<polygon points="91.60,96.15 94.23,97.67 94.23,95.77 91.60,94.25" fill="#3b2619" />\n<polygon points="95.55,98.43 98.18,99.95 98.18,98.05 95.55,96.53" fill="#3b2619" />\n<polygon points="88.97,98.43 90.61,99.38 90.61,96.72 88.97,95.77" fill="#1c120e" />\n<polygon points="94.56,101.66 96.21,102.61 96.21,99.95 94.56,99.00" fill="#1c120e" />\n<polygon points="91.60,102.23 94.23,103.75 94.23,102.80 91.60,101.28" fill="#906f53" />\n<polygon points="105.60,100.99 103.63,102.13 103.63,99.47 105.60,98.33" fill="#a37e5e" />\n<polygon points="89.14,77.81 92.43,79.71 88.48,81.99 85.19,80.09" fill="#f4f2ed" />\n<polygon points="92.43,99.47 88.48,101.75 88.48,81.99 92.43,79.71" fill="#aeaca8" />\n<polygon points="85.19,99.85 88.48,101.75 88.48,81.99 85.19,80.09" fill="#f1efe9" />\n<polygon points="89.14,74.58 92.10,76.29 88.48,78.38 85.52,76.67" fill="#f3c69f" />\n<polygon points="92.10,79.71 88.48,81.80 88.48,78.38 92.10,76.29" fill="#ad8563" />\n<polygon points="85.52,80.09 88.48,81.80 88.48,78.38 85.52,76.67" fill="#f0b98a" />\n<polygon points="106.91,88.07 110.20,89.97 106.25,92.25 102.96,90.35" fill="#f4f2ed" />\n<polygon points="110.20,109.73 106.25,112.01 106.25,92.25 110.20,89.97" fill="#aeaca8" />\n<polygon points="102.96,110.11 106.25,112.01 106.25,92.25 102.96,90.35" fill="#f1efe9" />\n<polygon points="106.91,84.84 109.87,86.55 106.25,88.64 103.29,86.93" fill="#f3c69f" />\n<polygon points="109.87,89.97 106.25,92.06 106.25,88.64 109.87,86.55" fill="#ad8563" />\n<polygon points="103.29,90.35 106.25,92.06 106.25,88.64 103.29,86.93" fill="#f0b98a" />\n<polygon points="94.08,55.96 113.16,66.98 98.68,75.34 79.60,64.32" fill="#a086ff" />\n<polygon points="113.16,83.70 98.68,92.06 98.68,75.34 113.16,66.98" fill="#644eb8" />\n<polygon points="79.60,81.04 98.68,92.06 98.68,75.34 79.60,64.32" fill="#8b6cff" />\n<polygon points="94.72,58.67 108.46,66.61 98.04,72.63 84.30,64.69" fill="#a993ff" />\n<polygon points="111.14,82.53 100.71,88.55 100.71,76.51 111.14,70.49" fill="#6851bf" />\n<polygon points="82.27,80.24 96.01,88.18 96.01,76.14 82.27,68.20" fill="#9072ff" /></g><path d="M79.9 51.7 L81.0 54.4 L83.6 55.4 L81.0 56.4 L79.9 59.0 L78.9 56.4 L76.3 55.4 L78.9 54.4 Z" fill="#fff6c9"/><path d="M124.4 58.2 L125.1 60.1 L127.1 60.9 L125.1 61.7 L124.4 63.6 L123.6 61.7 L121.6 60.9 L123.6 60.1 Z" fill="#fff6c9"/><path d="M88.2 60.4 L88.8 62.1 L90.6 62.8 L88.8 63.5 L88.2 65.2 L87.5 63.5 L85.7 62.8 L87.5 62.1 Z" fill="#fff6c9"/></svg>';

/** How many of the game's control hints the home page shows before "more". */
const HINTS = 6;

/** What the home page shows for one game (and does when played or another game is picked). */
export interface HomeGame extends GameControls {
  current: string;
  /** Its name (for a game not in the list: a development preview). */
  title?: string;
  onPlay: () => void;
  onPick: (id: string) => void;
  online?: OnlineOptions | null;
  /** Uploaded by a player (not built into the site): it may be reported. */
  uploaded?: boolean;
}

/**
 * What a game's runtime needs of the home page: `TitleScreen` in a page of the site's own, and in
 * an uploaded game's sandboxed frame a stand-in that passes each call to the page around it
 * (client/remote-title.ts).
 */
export interface HomeScreen {
  readonly root: HTMLElement;
  onListed: ((entries: PackageEntry[]) => void) | null;
  show(g: HomeGame): void;
  select(id: string, title?: string): void;
  progress(fraction: number, text: string): void;
  setReady(): void;
  present(names: string[]): void;
  failed(text: string, onPick: (id: string) => void): void;
  busy(text: string, seconds: number): Promise<string | null>;
  hide(): void;
  name(): string;
  avatar(): string;
}

/** A card on the shelf: the game's picture and name, and how many are playing it. */
interface Card {
  el: HTMLButtonElement;
  live: HTMLElement;
}

/**
 * The home page, shown while the world loads and until the player clicks Play. The game on show
 * fills the page (its world, slowly circling, behind everything; its cover, blurred, until the
 * world is in): its name and pitch large on the left, the name to play under and one button that
 * fills as the world loads and then starts the game, and a shelf of every game along the bottom
 * (with how many are playing each). It outlives a game: picking another switches in place
 * (`select`, then `show` for the new game), with the page staying put.
 */
export class TitleScreen implements HomeScreen {
  readonly root: HTMLElement;
  private nameInput: HTMLInputElement;
  private cover: HTMLElement;
  private kicker: HTMLElement;
  private heading: HTMLElement;
  private tagline: HTMLElement;
  private status: HTMLElement;
  private actions: HTMLElement;
  private rooms: HTMLElement;
  private hints: HTMLElement;
  private shelf: HTMLElement;
  private online: HTMLElement;
  /** Who you are: sign in, or your account. */
  private account: AccountCorner;
  /** For a guest: what's kept, and a way to sign in. */
  private guest: HTMLElement;
  /** The game on show's achievements (how many, how many earned): opens the profile. */
  private feats: HTMLElement;
  private profile: Profile;
  private locker: Locker;
  /** An uploader's games (the account menu's "Your games"). */
  private mygames = new MyGamesPanel();
  /** The community directory: uploaded games not on the home page. */
  private directory = new DirectoryPanel();
  /** Under an uploaded game: report it. */
  private report = h('div.home-report');
  /** `?directory` opens the directory, once. */
  private askedDirectory = new URL(location.href).searchParams.has('directory');
  /**
   * Games the server hosts built (uploaded) and lists, which the page wasn't built with: they've
   * joined the shelf (their entries, for the runtime's catalog).
   */
  onListed: ((entries: PackageEntry[]) => void) | null = null;
  private catalog: Map<string, Cosmetic>;
  /** What they wear (their account's once signed in; a guest's, kept in this browser). */
  private look: Look;
  private owned: string[] = [];
  /** Their face, beside the name: opens the locker. */
  private face = h('canvas.home-face') as HTMLCanvasElement;
  /** What the player has earned, as last asked (null: a guest, or not asked yet). */
  private earned: Earned | null = null;
  private fill: HTMLElement;
  private label: HTMLElement;
  private button: HTMLButtonElement;
  private cards = new Map<string, Card>();
  private ready = false;
  private title = 'the game';
  private poll = 0;
  private game: HomeGame | null = null;
  /** Who's in the room on show (a room of a player's own), as last said. */
  private here: string | null = null;

  constructor(
    parent: HTMLElement,
    private games: ListedGame[],
  ) {
    const mark = h('span.home-mark');
    mark.innerHTML = MARK;
    this.cover = h('div.home-cover');
    this.kicker = h('div.home-kicker');
    this.heading = h('h1.home-title');
    this.tagline = h('p.home-tagline');
    this.status = h('div.home-status');
    this.fill = h('span.home-play-fill');
    this.label = h('span.home-play-label', {}, 'Starting the engine…');
    this.button = h('button.home-play', { disabled: true, onclick: () => void this.play() }, this.fill, this.label) as HTMLButtonElement;
    this.nameInput = this.makeName();
    this.nameInput.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') void this.play();
    });
    this.nameInput.addEventListener('input', () => this.status.classList.remove('error'));
    this.account = new AccountCorner(() => this.nameInput.value.trim());
    this.account.onSay = (text) => this.setStatus(text);
    this.account.onChange = (me) => {
      if (me) this.nameInput.value = me.name;
      // A name that's locked in is the account: it can't be typed over (sign out to use another).
      this.nameInput.readOnly = !!me && this.account.nameLogin;
      this.nameInput.title = this.nameInput.readOnly ? 'Locked in: your progress is saved to this name' : '';
      this.guest.classList.toggle('hidden', !!me || !this.game?.online);
      void this.refreshEarned();
      void this.refreshLook();
    };
    this.profile = new Profile(games);
    this.account.onProfile = () => this.openProfile();
    this.feats = h('button.home-feats.hidden', { onclick: () => this.openProfile(this.game?.current) });
    this.catalog = cosmeticCatalog(games);
    setGameNames(games);
    this.look = localLook();
    this.locker = new Locker(this.catalog);
    this.locker.onSave = (look) => void this.saveLook(look);
    this.account.onLocker = () => this.openLocker();
    this.account.onGames = () => this.account.server && this.mygames.show(this.account.server);
    this.mygames.onOpen = (id) => this.game?.onPick(id);
    this.directory.onPick = (id) => id !== this.game?.current && this.game?.onPick(id);
    this.guest = h('div.home-guest.hidden', {}, 'Type your name above and press Play: it locks in, and your progress is saved to it. ', h('a.home-guest-privacy', { href: `${import.meta.env.BASE_URL}privacy.html`, target: '_blank', rel: 'noopener' }, 'Privacy'));
    const faceButton = h('button.home-face-button', { onclick: () => this.openLocker(), title: 'Your look', 'aria-label': 'Your look' }, this.face);
    this.actions = h('div.home-actions', {}, faceButton, h('label.home-name', {}, h('span', {}, 'Playing as'), this.nameInput), this.button);
    this.drawFace();
    this.rooms = h('div.home-rooms');
    this.hints = h('div.home-hints');
    this.shelf = h('nav.home-shelf', { 'aria-label': 'Games' });
    this.online = h('div.home-online');
    this.root = h(
      'div.screen.title-screen.home',
      {},
      this.cover,
      h('div.home-scrim'),
      h('header.home-top', {}, h('div.home-brand', {}, mark, h('span.home-logo', {}, 'Stonebyte'), h('span.home-pitch', {}, 'Block games anyone can build, played together')), h('div.home-top-right', {}, this.online, this.account.root)),
      h('main.home-hero', {}, this.kicker, this.heading, this.tagline, this.feats, this.status, this.actions, this.guest, homeScreenTip(), this.rooms, this.hints, this.report),
      this.shelf,
      this.profile.root,
      this.locker.root,
      this.mygames.root,
      this.directory.root,
    );
    // The mouse wheel runs the shelf sideways, when there are more games than fit.
    this.shelf.addEventListener('wheel', (e) => {
      if (this.shelf.scrollWidth <= this.shelf.clientWidth || Math.abs(e.deltaX) > Math.abs(e.deltaY)) return;
      e.preventDefault();
      this.shelf.scrollLeft += e.deltaY;
    }, { passive: false });
    this.renderShelf();
    parent.append(this.root);
  }

  /** Show the page for a game: it's the selected one, loading until `setReady`. */
  show(g: HomeGame) {
    this.game = g;
    this.feature(g.current, g.title);
    this.actions.querySelector('.home-name')?.classList.toggle('hidden', !g.online);
    if (g.online) this.account.use(g.online.server.replace(/^ws/, 'http').replace(/\/+$/, ''));
    // (Back from a game: what was earned there.)
    void this.refreshEarned();
    this.guest.classList.toggle('hidden', !g.online || !this.account.loaded || !!this.account.me);
    this.renderRooms(g.online ?? null);
    this.renderHints(g);
    this.here = null;
    window.clearInterval(this.poll);
    if (g.online) this.watchCounts(g.online);
    this.renderReport(g);
    if (this.askedDirectory && g.online) {
      this.askedDirectory = false;
      this.openDirectory();
    }
  }

  /** The game server's web address (online), for the directory and reports. */
  private get http(): string | null {
    return this.game?.online ? this.game.online.server.replace(/^ws/, 'http').replace(/\/+$/, '') : null;
  }

  private openDirectory() {
    if (this.http) void this.directory.show(this.http);
  }

  /** Under an uploaded game: "Report this game", which opens a line to say what's wrong. */
  private renderReport(g: HomeGame) {
    this.report.replaceChildren();
    if (!g.uploaded || !g.online) return;
    const id = g.current;
    const open = h('button.home-report-link', {}, 'Report this game') as HTMLButtonElement;
    open.onclick = () => {
      const text = h('input.mygames-id.home-report-text', { type: 'text', maxlength: '500', placeholder: 'What’s wrong with it?' }) as HTMLInputElement;
      const send = h('button.mygames-button.small', { type: 'submit' }, 'Send');
      const form = h(
        'form.home-report-form',
        {
          onsubmit: async (e: SubmitEvent) => {
            e.preventDefault();
            if (!text.value.trim() || !this.http) return;
            const r = await fetch(`${this.http}/g/${id}/report`, { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ reason: text.value.trim() }) }).catch(() => null);
            const body = (await r?.json().catch(() => ({}))) as { error?: string } | undefined;
            this.report.replaceChildren(h('span.home-report-done', {}, r?.ok ? 'Thanks: the admins will look at it.' : (body?.error ?? "Couldn't send it")));
          },
        },
        text,
        send,
        h('button.mygames-button.small', { type: 'button', onclick: () => this.renderReport(g) }, 'Cancel'),
      );
      this.report.replaceChildren(form);
      text.focus();
      text.addEventListener('keydown', (e) => e.stopPropagation());
    };
    this.report.append(open);
  }

  /** Ask again what the player has earned (signed in), and show it. */
  private async refreshEarned() {
    this.earned = await this.account.earned();
    if (this.game) this.renderFeats(this.game.current);
  }

  /** The line under the game's name: its achievements, and how many are earned. */
  private renderFeats(id: string) {
    const g = this.games.find((x) => x.id === id);
    const { have, all } = g ? tally(g, this.earned) : { have: 0, all: 0 };
    this.feats.classList.toggle('hidden', !all);
    if (!all) return;
    this.feats.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M7 3h10v2h3v3a4 4 0 0 1-4 4h-.4A5 5 0 0 1 13 14.9V17h3v2H8v-2h3v-2.1A5 5 0 0 1 8.4 12H8a4 4 0 0 1-4-4V5h3V3zm0 4H6v1a2 2 0 0 0 1 1.7V7zm10 0v2.7A2 2 0 0 0 18 8V7h-1zM6 20h12v2H6v-2z"/></svg>';
    this.feats.append(h('span', {}, this.account.me ? `${have} of ${all} achievements` : `${all} achievements to earn`));
  }

  /** What a signed-in player wears (their account's), and owns; a guest's stays as this browser has it. */
  private async refreshLook() {
    const kept = await this.account.look();
    if (!kept) return;
    this.owned = Object.keys(kept.owned);
    this.look = { avatar: parseAvatar(kept.avatar) ?? this.look.avatar, wear: kept.wear };
    this.drawFace();
  }

  private openLocker() {
    this.locker.show(this.look, { signedIn: !!this.account.me, owned: this.owned, name: this.nameInput.value.trim() || this.account.me?.name || 'You' });
  }

  private async saveLook(look: Look) {
    this.look = look;
    saveLocalLook(look);
    const kept = await this.account.saveLook(avatarCode(look.avatar), look.wear);
    if (kept) this.look = { avatar: parseAvatar(kept.avatar) ?? look.avatar, wear: kept.wear };
    this.drawFace();
  }

  private drawFace() {
    const hat = this.look.wear.map((id) => this.catalog.get(id)).find((c) => c?.slot === 'hat');
    this.face.width = this.face.height = 96;
    characterView().draw(this.face, avatarLook(this.look.avatar), hat ? [hat] : [], { face: true });
  }

  /** Their avatar's code, to play in (a signed-in player's account's is used anyway). */
  avatar(): string {
    return avatarCode(this.look.avatar);
  }

  private openProfile(game?: string) {
    this.profile.show(this.account.me, this.earned, game);
    void this.refreshEarned().then(() => this.profile.open && this.profile.show(this.account.me, this.earned, game));
  }

  /** Picked another game: show it chosen at once, while the switch happens behind. */
  select(id: string, title?: string) {
    this.feature(id, title);
    this.rooms.replaceChildren();
    this.hints.replaceChildren();
  }

  /** The game on show, loading: its name, pitch, colour and cover, and its card picked on the shelf. */
  private feature(id: string, title?: string) {
    const entry = this.games.find((x) => x.id === id);
    this.title = entry?.title ?? title ?? 'the game';
    this.root.style.setProperty('--game', entry?.accent ?? '#7fd46b');
    this.root.classList.remove('hidden', 'ready');
    this.ready = false;
    this.cover.style.backgroundImage = entry?.cover ? `url("${entry.cover}")` : '';
    this.heading.textContent = this.title;
    this.tagline.textContent = entry?.tagline ?? '';
    this.renderFeats(id);
    this.kicker.replaceChildren();
    this.status.replaceChildren();
    this.status.classList.remove('error');
    for (const [gid, card] of this.cards) {
      const on = gid === id;
      card.el.classList.toggle('current', on);
      if (on) card.el.setAttribute('aria-current', 'true');
      else card.el.removeAttribute('aria-current');
    }
    const card = this.cards.get(id)?.el;
    if (card) this.reveal(card);
    this.loading(`Loading ${this.title}…`);
  }

  /** Scroll the shelf (only the shelf: never the page) so a card is in full view. */
  private reveal(card: HTMLElement) {
    const s = this.shelf;
    const margin = parseFloat(getComputedStyle(s).paddingLeft) || 0;
    const left = card.offsetLeft - margin;
    const right = card.offsetLeft + card.offsetWidth + margin - s.clientWidth;
    if (s.scrollLeft > left) s.scrollLeft = left;
    else if (s.scrollLeft < right) s.scrollLeft = right;
  }

  /** More games on the shelf, after the others (uploaded ones the server lists). */
  private addGames(more: ListedGame[]) {
    this.games.push(...more);
    // What may be worn and the games' names include theirs (the same map the locker has).
    const all = cosmeticCatalog(this.games);
    this.catalog.clear();
    for (const [k, v] of all) this.catalog.set(k, v);
    setGameNames(this.games);
    this.renderShelf();
    const current = this.game?.current;
    for (const [gid, card] of this.cards) card.el.classList.toggle('current', gid === current);
  }

  private renderShelf() {
    this.cards.clear();
    if (this.games.length < 2) return this.shelf.replaceChildren();
    this.shelf.replaceChildren(
      ...this.games.map((x) => {
        const live = h('span.home-card-live');
        const art = h('span.home-card-art');
        if (x.cover) art.style.backgroundImage = `url("${x.cover}")`;
        else art.classList.add('blank');
        const el = h(
          'button.home-card',
          { style: `--game: ${x.accent ?? '#7fd46b'}`, title: x.tagline ?? x.title, onclick: () => x.id !== this.game?.current && this.game?.onPick(x.id) },
          art,
          live,
          h('span.home-card-name', {}, x.title),
        ) as HTMLButtonElement;
        this.cards.set(x.id, { el, live });
        return el;
      }),
      // Last: the community's games, not on the home page.
      h('button.home-card.home-card-community', { title: 'Games made and uploaded by players', onclick: () => this.openDirectory() }, h('span.home-card-art.blank'), h('span.home-card-name', {}, 'Community games')),
    );
  }

  /**
   * The choice of room, under Play: in the public game, a game of one's own instead; in one's
   * own, its invite link and the way back.
   */
  private renderRooms(online: OnlineOptions | null) {
    this.rooms.replaceChildren();
    if (!online?.onRoom) return;
    const onRoom = online.onRoom;
    if (!online.room) {
      this.rooms.append(
        h('button.home-alt', { onclick: () => onRoom(true) }, h('span.home-alt-title', {}, 'Start a private game'), h('span.home-alt-note', {}, 'Just you and the bots, or friends you send the link to')),
      );
      return;
    }
    this.kicker.replaceChildren(h('span.home-room-tag', {}, 'Private game'));
    const copy = h('button.home-alt.compact', {}, 'Copy invite link') as HTMLButtonElement;
    copy.onclick = () => copyInvite((text) => {
      copy.textContent = text;
      window.setTimeout(() => (copy.textContent = 'Copy invite link'), 2000);
    });
    this.rooms.append(copy, h('button.home-alt.compact', { onclick: () => onRoom(false) }, 'Back to the public game'));
  }

  /** The controls in a line: the first few, and the rest on asking. */
  private renderHints(g: HomeGame) {
    const keys = keyHints(g);
    const shown = hintChips(keys.slice(0, HINTS));
    const rest = hintChips(keys.slice(HINTS));
    for (const r of rest) r.classList.add('extra');
    const more = rest.length
      ? h('button.home-more', {
          onclick: () => {
            const open = this.hints.classList.toggle('open');
            more!.textContent = open ? 'Fewer' : `+${rest.length} more`;
          },
        }, `+${rest.length} more`)
      : null;
    this.hints.classList.remove('open');
    this.hints.replaceChildren(
      h('div.hint-line.keys-only', {}, ...shown, ...rest, more),
      h('div.hint-line.pad-only', {}, ...hintChips(g.pad ?? [])),
      h('div.hint-line.touch-only', {}, ...hintChips((g.touch ?? []).slice(0, 3))),
    );
  }

  /**
   * Play (the button, or Enter in the name box): signed in with a new name typed, that's saved
   * first (and if it can't be, why not is said instead).
   */
  /** Press Play (an uploaded game's frame took the click on the button: ui/frame-host.ts). */
  press() {
    void this.play();
  }

  /** Where the Play button is, while it may be pressed and the page is up (null: not now). */
  playRect(): DOMRect | null {
    if (!this.ready || this.button.disabled || this.root.classList.contains('hidden')) return null;
    const r = this.button.getBoundingClientRect();
    return r.width ? r : null;
  }

  private async play() {
    if (!this.ready || !this.game) return;
    // Not locked in yet, on a server that saves by name: Play locks in the name typed.
    if (!this.account.me && this.account.nameOn) {
      await this.account.lockName();
      if (!this.account.me) return;
    }
    const me = this.account.me;
    const typed = this.nameInput.value.trim();
    if (me && typed && typed !== me.name && !this.account.nameLogin) {
      try {
        this.nameInput.value = await this.account.rename(typed);
      } catch (err) {
        this.status.classList.add('error');
        this.setStatus(err instanceof Error ? err.message : String(err));
        this.nameInput.focus();
        return;
      }
    }
    this.game.onPlay();
  }

  /** Who's in the room on show (a room of a player's own). */
  present(names: string[]) {
    const here = names.join(', ');
    if (here === this.here) return;
    this.here = here;
    this.setStatus(names.length ? `Here now: ${here}` : 'Nobody here yet: send friends the link to play together', names.length > 0);
  }

  private setStatus(text: string, live = false) {
    this.status.replaceChildren(...(live ? [h('span.live-dot')] : []), text);
  }

  private loading(text: string) {
    this.button.disabled = true;
    this.fill.style.width = '0%';
    this.label.textContent = text;
  }

  /** How many are playing each game (online), kept fresh while the page is up. */
  private watchCounts(online: OnlineOptions) {
    const http = online.server.replace(/^ws/, 'http').replace(/\/+$/, '');
    const load = () =>
      fetch(`${http}/games`)
        .then((r) => r.json() as Promise<{ games: { id: string; players: number; packaged?: PackageEntry }[] }>)
        .then(({ games }) => {
          // Uploaded games the server lists: onto the shelf (and into the catalog), once.
          const fresh = games.flatMap((g) => (g.packaged && !this.games.some((x) => x.id === g.id) ? [g.packaged] : []));
          if (fresh.length) {
            this.addGames(fresh.map((e) => ({ ...e.meta, id: e.id })));
            this.onListed?.(fresh);
          }
          let total = 0;
          for (const g of games) {
            total += g.players;
            const card = this.cards.get(g.id);
            if (!card) continue;
            card.live.textContent = g.players ? String(g.players) : '';
            card.live.classList.toggle('on', g.players > 0);
          }
          this.online.replaceChildren(...(total ? [h('span.live-dot'), `${total} playing now`] : []));
          // (In a room of one's own, `present` says who's in it; a problem stays said.)
          if (online.room || this.status.classList.contains('error')) return;
          const here = games.find((g) => g.id === online.game)?.players ?? 0;
          this.setStatus(here ? `${here} ${here === 1 ? 'player' : 'players'} in this game now` : 'Nobody in this game yet: you could be first', here > 0);
        })
        .catch(() => {});
    void load();
    this.poll = window.setInterval(load, 5000);
  }

  private makeName(): HTMLInputElement {
    let saved = '';
    try {
      saved = localStorage.getItem('voxel.name') ?? '';
    } catch {
      // no storage: no remembered name
    }
    return h('input.home-name-input', { type: 'text', maxlength: '20', placeholder: 'Pick a name', value: saved, spellcheck: false, autocomplete: 'nickname' }) as HTMLInputElement;
  }

  /** The name typed (remembered for next time), online. */
  name(): string {
    const n = this.nameInput.value.trim().slice(0, 20) || 'Player';
    try {
      localStorage.setItem('voxel.name', n);
    } catch {
      // not remembered
    }
    return n;
  }

  progress(fraction: number, text: string) {
    if (this.ready) return;
    this.fill.style.width = `${Math.round(Math.min(1, Math.max(0, fraction)) * 100)}%`;
    this.label.textContent = text;
  }

  setReady() {
    if (this.ready) return;
    this.ready = true;
    this.button.disabled = false;
    this.fill.style.width = '100%';
    this.label.textContent = 'Play';
    this.root.classList.add('ready');
  }

  /** The game couldn't start (say, its server is down): say so; another can still be picked. */
  failed(text: string, onPick: (id: string) => void) {
    // Any game may be picked again, this one included (its public game).
    this.game = { current: '', onPlay: () => {}, onPick };
    this.label.textContent = `Couldn't load ${this.title}`;
    this.status.classList.add('error');
    this.setStatus(text);
  }

  /**
   * The game's full (or the server's busy, or out of reach): say so, counting down to trying
   * again. Resolves with a game picked meanwhile (this one too: at once), else null when it's time.
   */
  busy(text: string, seconds: number): Promise<string | null> {
    this.status.classList.remove('error');
    this.loading(`Waiting for ${this.title}…`);
    const said = text.replace(/[.\s]+$/, '');
    return new Promise((done) => {
      let left = seconds;
      const tick = () => this.setStatus(`${said}. Trying again in ${left} s, or pick another game.`);
      tick();
      const timer = window.setInterval(() => {
        if (--left > 0) return tick();
        window.clearInterval(timer);
        done(null);
      }, 1000);
      this.game = {
        current: '',
        onPlay: () => {},
        onPick: (id) => {
          window.clearInterval(timer);
          done(id);
        },
      };
    });
  }

  /** Playing: the page fades away (it comes back with `show`). */
  hide() {
    window.clearInterval(this.poll);
    this.root.classList.add('hidden');
  }
}

/** Copy the link to this game (and room) for a friend: `said` gets what to show on the button. */
/** The page's address for an invite link (an uploaded game's sandboxed frame asks the page around it). */
export const invite = { address: async (): Promise<string> => location.href };

export async function copyInvite(said: (text: string) => void) {
  const link = new URL(await invite.address());
  for (const p of ['server', 'name', 'seed']) link.searchParams.delete(p);
  const done = navigator.clipboard?.writeText(link.href).then(
    () => said('Link copied'),
    () => said(link.href),
  );
  if (!done) said(link.href);
}

/** A guest's look, as this browser keeps it (their first: one of the ready-made people, kept). */
function localLook(): Look {
  try {
    const kept = JSON.parse(localStorage.getItem('voxel.look') ?? 'null') as { avatar?: string } | null;
    const avatar = parseAvatar(kept?.avatar);
    if (avatar) return { avatar, wear: [] };
  } catch {
    // (A fresh one.)
  }
  const look = { avatar: presetAvatar(), wear: [] };
  saveLocalLook(look);
  return look;
}

function saveLocalLook(look: Look) {
  try {
    localStorage.setItem('voxel.look', JSON.stringify({ avatar: avatarCode(look.avatar) }));
  } catch {
    // not kept
  }
}

/**
 * On an iPhone in Safari (which can't put a page full screen): a line saying the game plays full
 * screen from the home screen (Share, then Add to Home Screen: the site's manifest opens it with
 * no bars). Nothing elsewhere, or once it's been opened from there.
 */
function homeScreenTip(): HTMLElement | null {
  const nav = navigator as Navigator & { standalone?: boolean };
  const iphone = /iPhone|iPod/.test(navigator.userAgent);
  const installed = nav.standalone === true || (typeof matchMedia === 'function' && matchMedia('(display-mode: fullscreen), (display-mode: standalone)').matches);
  return iphone && !installed ? h('div.home-tip', {}, 'Full screen on an iPhone: Share, then Add to Home Screen, and play from there.') : null;
}
