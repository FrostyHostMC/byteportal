import * as THREE from 'three';
import { engine, loadEngine } from './engine/wasm';
import { WorkerPool } from './workers/pool';
import { worldGenConfig } from './workers/config';
import { Refused, SocketLink } from './client/link';
import { FrameBuffer } from './client/interp';
import type { ReplayPlayback } from './client/replay';
import { ReplayView } from './client/replays';
import { Avatars, standIn } from './client/avatars';
import { Debris } from './client/debris';
import { DevTools } from './client/devtools';
import { Predictor } from './client/predict';
import { flightWorld } from './sim/flight';
import { resolveMovement, type MoveTune } from './sim/movement';
import { leanOffset, playerBoxes, rayBox, resolveHitscan, type HitscanRules } from './sim/hitboxes';
import { bulletPath } from './sim/hitscan';
import type { Penetration } from './api/items';
import { ClientMovers, propPose } from './client/movers';
import { heading, toWorld } from './sim/movers';
import { VehicleView } from './client/vehicle';
import { worldQuery } from './sim/worldquery';
import { LAYER_CHUNKS, Renderer, type FrameHooks } from './render/pipeline';
import { Environment } from './render/environment';
import { BiomeMap, builtinTextures, createBlockTextures, createNoiseTexture, type TextureSet } from './render/textures';
import { paintGameTextures } from './render/blocktextures';
import { Particles } from './render/particles';
import { BlockHighlight } from './render/highlight';
import { EntityGraphics } from './render/entities';
import { ChunkManager } from './world/chunks';
import { firstGameBlock, gameBlocks, useGameBlocks, type GameBlocks } from './world/blocks';
import { blockIdOf, destructibleIds, loadRegistry, variant, type Registry } from './world/registry';
import { Input } from './player/input';
import { gameKeys } from './player/keys';
import { padBindings, padHints, rumble } from './player/gamepad';
import { touchButtons, touchHints } from './player/touch';
import { TouchControls } from './ui/touch';
import { PadNav } from './ui/padnav';
import { Effects } from './fx/effects';
import { Sfx } from './audio/sfx';
import { Hud } from './ui/hud';
import { applyTheme, GameHud } from './ui/hudkit';
import { plainRecord, type PlainData } from './ui/markup';
import { CommandBar } from './ui/commandbar';
import { Content } from './content';
import { PLACEHOLDER_ICON, resolveIcon } from './looks';
import { Presenter } from './client/present';
import { CameraTake, PlayerCamera } from './client/camera';
import { EntityView } from './client/entities';
import { PickupView } from './client/pickups';
import { PropView } from './client/props';
import type { SimFrame } from './sim/sim';
import type { PlayerFrame } from './sim/player';
import { MESSAGE_MAX, newRoomCode, ROOM_CODE, type DevReply, type HostBatch, type TimedBatch } from './net/protocol';
import { sanitizeGameMessage } from './net/validate';
import { clipFrame, type ClipFrame } from './sim/entities';
import { Inventory as BlockPicker } from './ui/screens';
import { cosmeticCatalog } from './cosmetics';
import { entryOf, packagedEntry, packagedVersion, webOrigin } from './client/packaged';
import { errorContext } from './client/errors';
import { TitleScreen, type HomeScreen } from './ui/home';
import { PauseMenu } from './ui/pause';
import { blockIcon } from './ui/icons';
import { GRAPHICS, isHandheld, loadSettings, saveSettings, toRenderSettings, type Settings } from './settings';
import { AutoQuality, savedQuality, saveQuality, type Look } from './quality';
import type { BlockRef, IconRef, ItemDefinition, ItemStack, PadAction, PadButton, SharedDefinition, Vec3 } from './api/types';
import type { Client, ClientDefinition, ClientEvent, ClientGame, ClientTrace, GameEntry, Me } from './api/client';
import { ClientRuntime } from './client/api/client';
import { FirstPersonLayer } from './client/api/view';
import { ClientHudService } from './client/api/hud';
import { SceneService } from './client/api/scene';

type Mode = 'title' | 'playing' | 'paused' | 'picker' | 'console';

/**
 * What a game's runtime hands the next when switching games in place: the home page, and the
 * renderer with its textures (the WebGL context and compiled shaders don't need redoing).
 */
interface Carry {
  title: HomeScreen;
  /** The renderer and its textures (none: a game that ran in a frame left them; a new one's made). */
  renderer?: Renderer;
  textures?: TextureSet;
  biome?: BiomeMap;
}

/** An uploaded game to run in a sandboxed frame instead of in this page (see `Runtime.frames`). */
export interface FrameOpen {
  id: string;
  room: string | null;
  shard: number;
  /** The game server (its socket address). */
  server: string;
  /** What this page keeps for the next game it runs itself: the home page, the renderer if any. */
  carry: Carry;
  canvas: HTMLCanvasElement;
  ui: HTMLElement;
  games: GameEntry[];
  hidden: GameEntry[];
}

/** Free a finished game's meshes: geometry and materials (shared block textures stay). */
function disposeTree(root: THREE.Object3D) {
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    m.geometry?.dispose();
    const mats = Array.isArray(m.material) ? m.material : m.material ? [m.material] : [];
    for (const mat of mats) mat.dispose();
  });
}

/** The screen's pixels per point, up to 2 (more costs a lot and shows little). */
const deviceDpr = () => Math.min(window.devicePixelRatio || 1, 2);

/**
 * The browser runtime: the client (renderer, streaming world, HUD, audio, input, first-person
 * view). The game itself runs on a game server, in a `GameHost` there. Each frame the client
 * sends the player's controls and draws the newest `SimFrame` (played back smoothly, its own
 * player predicted ahead); the host's content, presentation calls and block edits arrive in the
 * same batches. It runs one game at a time from the catalog (`GameEntry`), with that game's
 * shared definition, loaded when it's picked.
 *
 * It's the frame loop and the glue: what it draws and plays is in parts of their own under
 * `client/`, each told only what it needs of the runtime (`ReplayView` for replays, `Avatars` for
 * other players' figures and name tags, `Debris` for rubble, `DevTools` for the F3 overlay and
 * `__game.dev`, besides the views of entities, pickups, props and vehicles).
 */
/** How far a third-person camera keeps off what it meets (blocks). */
const CAMERA_MARGIN = 0.3;

export class Runtime {
  mode: Mode = 'title';
  private settings: Settings;
  /** Graphics lowered while frames are slow, and the settings as they're drawn. */
  private quality = new AutoQuality();
  private look: Look | null = null;
  private renderer!: Renderer;
  private env = new Environment();
  private camera: THREE.PerspectiveCamera;
  /** The camera as the game's client code takes it for a while (`client.camera.take`), over the player's own. */
  private taken = new CameraTake();
  private pool!: WorkerPool;
  private chunks!: ChunkManager;
  private registry!: Registry;
  /** Which blocks bullets carve (`world.destructible`): the ids, and only above this height. */
  private carving: { ids: Uint8Array; above: number } | null = null;
  /** The game's own blocks (`def.blocks`). */
  private blocks!: GameBlocks;
  private textures!: TextureSet;
  private biome!: BiomeMap;
  /** Every listener this game adds goes when it's aborted (switching games). */
  private life = new AbortController();
  private disposed = false;
  /** The game's client code (its kits and frame) on this screen. */
  private client!: ClientRuntime;
  private clientStarted = false;
  private switching = false;
  /** Set by the app: told of each new runtime (a switch makes one). */
  static onStart: ((rt: Runtime) => void) | null = null;
  private input: Input;
  /** Mouse look and the first-person camera (the client's side of the player). */
  private view!: PlayerCamera;
  /** `hud.highlight`: the outline and break cracks on one block. */
  private highlight = new BlockHighlight();
  private blockIcons = new Map<number, string>();
  private particles!: Particles;
  private hud!: Hud;
  private gameHud!: GameHud;
  /** The F3 overlay, `__game.debugInfo()` and `__game.dev`. */
  private devTools!: DevTools;
  private title: HomeScreen;
  private pause!: PauseMenu;
  private picker: BlockPicker | null = null;
  private hooks!: FrameHooks;
  /** The first-person layer (`client.view`): what's in hand and the player's arms, placed by the game's kits. */
  private held!: FirstPersonLayer;
  private graphics!: EntityGraphics;
  private entityView!: EntityView;
  private pickupView!: PickupView;
  private propView!: PropView;
  private fx!: Effects;
  readonly sfx = new Sfx();
  /** The game's sounds, atlases, animations, entity and item types. */
  private content = new Content();
  private presenter!: Presenter;
  /** The newest frame from the host. */
  private frameData: SimFrame | null = null;
  /** The world's blocks as flights (and an over-the-shoulder aim) meet them. */
  private flightWorld: ReturnType<typeof flightWorld> | null = null;
  /** The host has set the game up and placed the player. */
  private hostReady = false;
  private requests = new Map<number, (value: unknown) => void>();
  /** Which player in the frames is this client's (null: watching the game, not in it yet). */
  private playerId: string | null;
  /** The server's frames, played back smoothly. */
  private playback!: FrameBuffer;
  /** This client's own movement, predicted ahead of the server (walking games). */
  private predictor: Predictor | null = null;
  /** The solid props prediction bumps into and stands on (walking games). */
  private movers: ClientMovers | null = null;
  /** The prop this player rides and which way it was drawn facing: their view turns with it. */
  private rideHeading: { prop: number; heading: number } | null = null;
  /** This client's own vehicle (`player.drive`): predicted, its camera and model's pose. */
  private vehicles!: VehicleView;
  /** Inputs sent to a server, numbered (prediction replays what the server hasn't applied). */
  private inputSeq = 0;
  /** When each recent input was applied here (local seconds): our own shots fly from then. */
  private inputTimes = new Map<number, number>();
  /** Other players drawn as figures, with their name tags. */
  private avatars!: Avatars;
  private nextRequest = 1;
  private commandBar!: CommandBar;
  private last = performance.now();
  private worldReady = false;
  /** First-person walker (default) or a game-driven camera (`player.controller: 'none'`). */
  private walker = true;
  private itemMode: boolean;
  private hudVisible = true;
  private dir = new THREE.Vector3();
  private light = new THREE.Vector3();
  private probe = new THREE.Vector3(1, 1, 1);
  private probeFrame = 0;
  private titleSpin = 0;
  /** What's on screen, to redraw only on change. */
  private shown = { health: '', hotbar: '', creative: '', held: '', arm: '', humanoid: '', spectating: false };
  /** Development: treat input as active without pointer lock (headless tests). */
  debugActive = false;
  /** In a room of a player's own: its code. */
  private room: string | null = null;
  /** The world's seed (the server's). */
  private seed: number;
  /** Where bullets meet players (`hitscan`), as the host has it (`client.world.trace`). */
  private hitscanRules: HitscanRules;
  /** The item kits' actions this frame, by kind, not yet sent (they go with the frame's controls). */
  private acts: Record<string, unknown[][]> = {};
  /** `client.hud`: client code's layers and stylesheets. */
  private clientHud!: ClientHudService;
  /** Rubble and dust knocked out of blocks. */
  private debris!: Debris;
  /** The host time of the frame last drawn (shots hit where others were then). */
  private shownT = 0;
  /** A clip our own movement abilities started (`trigger(name, { clip })`), shown on our figure until the host's word arrives. */
  private ownClip: ClipFrame | null = null;
  /** The game's movement, for prediction and a gun's spread. */
  private tune: MoveTune;
  /** Undo the game's HUD theme (switching games). */
  private unTheme: () => void = () => {};
  /** A controller in the menus: the highlighted control. */
  private padNav = new PadNav(document.body);
  /** The touch controls (phones and tablets), and whether they're over the game now. */
  private touch!: TouchControls;
  private touchShown = false;
  /** How long the right stick has been pushed all the way sideways (turning round speeds up). */
  private fullTilt = 0;
  /** Our health last frame (the controller rumbles when it drops). */
  private lastHealth = -1;
  /** A replay playing on this screen (`game.replay.show`): its frames are drawn in place of the live game's. */
  private replays!: ReplayView;

  private constructor(
    private canvas: HTMLCanvasElement,
    private ui: HTMLElement,
    /** The game: its shared definition (what this screen reads of it). */
    private def: SharedDefinition,
    /** The game's code for this screen (its kits, its own frame). */
    private clientDef: ClientDefinition,
    private games: GameEntry[],
    private hidden: GameEntry[],
    /** The connection to the game's server, where the game runs. */
    private link: SocketLink,
    /** The home page (up already, showing the game loading). */
    title: HomeScreen,
    /** What the previous game left for this one (switching in place). */
    private carried: Carry | null = null,
  ) {
    this.playerId = link.welcome.player;
    this.seed = link.welcome.seed;
    this.settings = loadSettings();
    this.camera = new THREE.PerspectiveCamera(this.settings.fov, 1, 0.1, 400);
    this.camera.layers.enable(LAYER_CHUNKS);
    this.input = new Input(canvas, this.life.signal);
    this.walker = (def.player?.controller ?? 'walk') === 'walk';
    this.tune = resolveMovement(def.player?.movement);
    this.hitscanRules = resolveHitscan(def.hitscan);
    this.itemMode = this.walker && (def.player?.hotbar ?? (def.player?.build ? 'blocks' : 'items')) === 'items';
    // The keys this game reads its moves by: a controller presses them, and the player's key bindings read as them.
    const keys = gameKeys(this.tune);
    this.input.padBindings = padBindings(def.gamepad);
    this.input.keysFor = keys;
    // The title screen asks for a name and says who's on; a game with rooms of players' own
    // offers one (or, in one, the link to it and the way back).
    const room = link.welcome.room && link.welcome.room !== 'public' ? link.welcome.room : null;
    this.room = room;
    const online = { server: new URL(link.url).origin, game: def.id, room, onRoom: def.instances ? (own: boolean) => this.switchGame(def.id, own ? newRoomCode() : null) : undefined };
    this.title = title;
    const uploaded = !!packagedVersion([...this.games, ...this.hidden].find((g) => g.meta.id === def.id));
    this.title.show({ current: def.id, title: def.title, onPlay: () => this.play(), onPick: (id) => this.switchGame(id), controls: def.controls, pad: padHints(def, this.walker, keys), touch: touchHints(touchButtons(def, this.walker, keys, this.walker), this.walker, this.walker), walks: this.walker, keys: { bound: this.settings.keys, game: keys }, online, uploaded });
  }

  /**
   * Boot the game selected by `?game=` (default: the first in the catalog) on its game server:
   * connect to it, watching behind the title screen, and join on Play. The server is `?server=`
   * (`ws://localhost:8787`, or one game on one: `ws://localhost:8787/sandbox`), else the build's
   * (`VITE_GAME_SERVER`, e.g. wss://voxel-games.fly.dev), else in development the local one that
   * `npm run dev` runs. `?room=` picks a room of a player's own there instead of the public one (a
   * game with `instances`). The game's client code (its own chunk) loads while the connection
   * opens; the home page shows it loading meanwhile.
   */
  static async start(canvas: HTMLCanvasElement, ui: HTMLElement, games: GameEntry[], hidden: GameEntry[] = [], carried: Carry | null = null): Promise<Runtime | null> {
    const url = new URL(location.href);
    const picked = url.searchParams.get('game');
    const given = url.searchParams.get('server');
    // A server (then as a build with one), or one game's address on it.
    const base = given ? (Runtime.gameAddress(given) ? null : given.replace(/\/+$/, '')) : Runtime.defaultServer();
    // Development games open by id but aren't listed in the launcher (a server names one too:
    // `?server=ws://host&game=highnoon`).
    const find = (id: string | null) => [...games, ...hidden].find((g) => g.meta.id === id);
    // A game this page wasn't built with may be one the server hosts built (uploaded: see
    // client/packaged.ts), open by id; it stays in the catalog, not listed, while the page is open.
    const fetchPackaged = async (origin: string, id: string) => {
      const entry = await packagedEntry(origin, id).catch((err: unknown) => (console.warn(err), null));
      if (entry && !find(id)) hidden.push(entry);
      return entry;
    };
    if (picked && !find(picked) && base) await fetchPackaged(webOrigin(base), picked);
    let listed = find(picked) ?? games[0];
    const room = url.searchParams.get('room');
    let own = room && listed.meta.instances && ROOM_CODE.test(room) ? room : null;
    // An invite link into a copy of the public game (started while it was full) names the copy.
    let shard = own ? 0 : Number(url.searchParams.get('shard')) || 0;
    const address = () => (base ? `${base}/${listed.meta.id}${own ? `/${own}` : shard > 1 ? `?shard=${shard}` : ''}` : given);
    if (!address()) throw new Error('No game server to play on: open with ?server=ws://host:port, or build with VITE_GAME_SERVER.');
    // The home page at once, showing the game loading (it stays up when switching games).
    const title = carried?.title ?? new TitleScreen(ui, games.map((g) => g.meta));
    // Uploaded games the server lists join the catalog (after the page's own), as the home page finds them.
    title.onListed = (entries) => {
      for (const e of entries) {
        if (games.some((g) => g.meta.id === e.id)) continue;
        const at = hidden.findIndex((g) => g.meta.id === e.id);
        if (at >= 0) hidden.splice(at, 1);
        games.push(entryOf(e));
      }
    };
    title.select(listed.meta.id, listed.meta.title);
    // What an error report says (client/errors.ts): where to send it, the game on screen.
    if (base) errorContext.server = webOrigin(base);
    errorContext.game = listed.meta.id;
    errorContext.version = packagedVersion(listed) ?? null;
    // An uploaded game, on a page that runs those in a sandboxed frame: the frame takes it from here.
    if (Runtime.frames && base && packagedVersion(listed)) {
      Runtime.frames({ id: listed.meta.id, room: own, shard, server: base, carry: carried ?? { title }, canvas, ui, games, hidden });
      return null;
    }
    // Its client code loads while the connection opens (a server's own address names the game
    // only in its welcome).
    let early = base ? listed.load() : null;
    early?.catch(() => {});
    // Turned away (the game's full, the server's busy or out of reach): the home page says so and
    // tries again, less often as it goes on, unless another game's picked meanwhile.
    let link: SocketLink | null = null;
    for (let wait = 5; !link; ) {
      try {
        link = await SocketLink.connect(await Runtime.ticketed(address()!, listed.meta.id));
      } catch (err) {
        // Turned away for good (no such game, or one an update broke): the home page says why, and
        // another game may be picked (a fresh start, on the first page; switching games handles its own).
        if (err instanceof Refused && !err.retry && !carried)
          title.failed(err.message, (next) => {
            const to = new URL(location.href);
            to.searchParams.set('game', next);
            for (const p of ['room', 'shard']) to.searchParams.delete(p);
            location.assign(to);
          });
        if (!(err instanceof Refused) || !err.retry) throw err;
        const next = await title.busy(err.message, wait);
        const entry = next === null ? null : find(next);
        if (!entry) {
          wait = Math.min(30, wait * 2);
          continue;
        }
        listed = entry;
        own = null;
        shard = 0;
        wait = 5;
        const to = new URL(location.href);
        to.searchParams.set('game', entry.meta.id);
        for (const p of ['room', 'shard']) to.searchParams.delete(p);
        history.replaceState(null, '', to);
        title.select(entry.meta.id, entry.meta.title);
        if (Runtime.frames && base && packagedVersion(entry)) {
          Runtime.frames({ id: entry.meta.id, room: null, shard: 0, server: base, carry: carried ?? { title }, canvas, ui, games, hidden });
          return null;
        }
        early = base ? entry.load() : null;
        early?.catch(() => {});
      }
    }
    // The page's address names the game, and the copy of its public game it's in (none in the
    // first): what an invite link copies.
    if (base) {
      const at = new URL(location.href);
      at.searchParams.set('game', link.welcome.game);
      if (link.welcome.shard) at.searchParams.set('shard', String(link.welcome.shard));
      else at.searchParams.delete('shard');
      history.replaceState(null, '', at);
    }
    let game: ClientGame;
    try {
      const w = link.welcome;
      let entry = find(w.game) ?? (await fetchPackaged(webOrigin(link.url), w.game));
      // A built game's room runs the version it started with: its client code, whatever's current.
      if (w.package && packagedVersion(entry) !== w.package.version) {
        const meta = entry?.meta ?? { id: w.game, title: w.game };
        const pinned = entryOf({ id: w.game, version: w.package.version, meta, modules: w.package.modules, client: w.package.client });
        const at = hidden.findIndex((g) => g.meta.id === w.game);
        if (at >= 0) hidden[at] = pinned;
        else hidden.push(pinned);
        entry = pinned;
      }
      if (!entry) throw new Error(`The server is running "${link.welcome.game}", which this client doesn't have.`);
      errorContext.game = w.game;
      errorContext.version = w.package?.version ?? null;
      game = await (entry === listed && early ? early : entry.load());
    } catch (err) {
      link.close();
      throw err;
    }
    const rt = new Runtime(canvas, ui, game.shared, game.client, games, hidden, link, title, carried);
    await rt.init();
    Runtime.onStart?.(rt);
    return rt;
  }

  /**
   * Run uploaded games in a sandboxed frame (the site's page sets this: ui/frame-host.ts): `start`
   * hands such a game over instead of running its code here.
   */
  static frames: ((o: FrameOpen) => void) | null = null;

  /**
   * A room ticket for `game` (a sandboxed frame, which can't carry the sign-in, asks the page around
   * it: client/frame.ts); null: none (a page of the site's own connects with its cookie).
   */
  static ticket: ((game: string) => Promise<string | null>) | null = null;

  /** A game's socket address with a room ticket on, if there's a way to get one. */
  private static async ticketed(address: string, game: string): Promise<string> {
    const ticket = await Runtime.ticket?.(game);
    if (!ticket) return address;
    const url = new URL(address);
    url.searchParams.set('ticket', ticket);
    return url.href;
  }

  /**
   * The server when the page doesn't name one: the build's (`VITE_GAME_SERVER`), else in
   * development the local one `npm run dev` runs (on this page's host; `VITE_DEV_GAME_PORT`).
   */
  private static defaultServer(): string | null {
    const built = (import.meta.env.VITE_GAME_SERVER as string | undefined)?.replace(/\/+$/, '');
    if (built) return built;
    if (!import.meta.env.DEV) return null;
    const port = (import.meta.env.VITE_DEV_GAME_PORT as string | undefined) ?? '8787';
    return `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.hostname || 'localhost'}:${port}`;
  }

  /** A `?server=` naming one game on a server (`ws://host/sandbox`), not the server. */
  private static gameAddress(server: string): boolean {
    try {
      return new URL(server).pathname.replace(/\/+$/, '') !== '';
    } catch {
      return false;
    }
  }

  // ---------------------------------------------------------------------------------------------
  // Setup
  // ---------------------------------------------------------------------------------------------

  private blockId(b: BlockRef): number {
    return blockIdOf(this.registry, b);
  }

  private async init() {
    const def = this.def;
    this.title.progress(0.02, 'Compiling WebAssembly engine…');
    const module = await loadEngine();
    // The game's own blocks (with the ids a server gave them, if it said), before anything that
    // needs to know them: the registry, the terrain workers, the world.
    this.blocks = gameBlocks(def, this.link.welcome.blocks);
    useGameBlocks(this.blocks);
    this.registry = loadRegistry(this.blocks);
    const destructible = def.world?.destructible;
    this.carving = destructible ? { ids: destructibleIds(this.registry, destructible), above: destructible.above ?? -1 } : null;
    this.title.progress(0.06, 'Generating textures…');
    const worldCfg = worldGenConfig(def, (b) => this.blockId(b));
    // (A phone or tablet: three at most, each a copy of the engine in memory it has little of.)
    const workers = Math.max(2, Math.min(isHandheld() ? 3 : 8, (navigator.hardwareConcurrency || 4) - 2));
    const poolPromise = WorkerPool.create(module, this.seed, workers, worldCfg, this.blocks.json);
    // The game's own block textures after the built-in ones (images fetched meanwhile).
    const own = this.blocks.textures.length ? { ...(await paintGameTextures(this.blocks.textures, builtinTextures(), this.blocks.textureNames)), key: this.blocks.textureKey } : undefined;

    // The renderer and block textures carry over from the previous game, if there was one (the
    // textures only if its own blocks were this one's).
    const c = this.carried;
    if (c?.renderer && c.textures && c.biome) {
      this.renderer = c.renderer;
      this.textures = c.textures;
      this.biome = c.biome;
      if (c.textures.key !== this.blocks.textureKey) {
        c.textures.albedo.dispose();
        c.textures.material.dispose();
        this.textures = createBlockTextures(this.renderer.gl, own);
        this.renderer.setTextures(this.textures.albedo, this.textures.material, this.biome.texture);
      }
    } else {
      const noise = createNoiseTexture();
      const torchLayer = this.registry.byName.get('torch')?.tex[0] ?? 0;
      this.renderer = new Renderer(this.canvas, toRenderSettings(this.settings), noise, torchLayer);
      this.renderer.fxScene.matrixWorldAutoUpdate = true;
      this.textures = createBlockTextures(this.renderer.gl, own);
      this.biome = new BiomeMap(this.renderer.gl);
      this.renderer.setTextures(this.textures.albedo, this.textures.material, this.biome.texture);
    }
    const biome = this.biome;
    // Over the void the sky goes on below the horizon, an abyss; a void world with ground has a horizon like any other.
    this.renderer.uniforms.uVoid.value = def.world?.terrain === 'void' && !def.world.ground ? 1 : 0;
    this.graphics = new EntityGraphics(this.renderer.uniforms);
    this.graphics.gltf.renderer = this.renderer.gl;
    // Model files the game names (glTF props and figures): fetched at once, so they're here by play.
    this.content.onModelFile((url) => this.graphics.gltf.load(url));
    this.loadEntityAtlas();

    this.pool = await poolPromise;
    this.chunks = new ChunkManager(this.pool, this.renderer, biome, this.viewDistance(this.settings));
    this.chunks.occlusion = this.settings.occlusion;
    const world = this.chunks.world;

    this.particles = new Particles((x, y, z) => {
      const id = world.get_block(x, y, z);
      return id !== 255 && (this.registry.blocks[id]?.solid ?? false);
    });
    this.renderer.opaqueScene.add(this.particles.points);
    this.debris = new Debris({ world, registry: this.registry, textures: this.textures, particles: this.particles, scene: this.renderer.opaqueScene, sunDir: this.renderer.uniforms.uSunDir });

    const icons = new Map<number, string>();
    for (const b of this.registry.blocks) {
      if (b.id === 0) continue;
      // A bed's icon shows it whole: the head too.
      const head = b.model === 'bed' ? variant(this.registry, b, { part: 'head' }) ?? undefined : undefined;
      // A game's block that faces a way shows its front (the icon's left is the south face).
      const shown = b.id >= firstGameBlock() && b.state.facing ? (variant(this.registry, b, { facing: 'south' }) ?? b) : b;
      icons.set(b.id, blockIcon(shown, this.textures.albedoData, head));
    }
    this.blockIcons = icons;
    this.hud = new Hud(this.ui, this.registry, icons);
    this.gameHud = new GameHud(this.ui, (ref) => this.iconOf(ref, 96));
    this.gameHud.onHighlight = (at, progress) => this.setHighlight(at, progress);
    // Markers and radar blips that follow things: where this screen draws them, every frame.
    this.gameHud.locate = {
      at: (a, offset, out) => {
        if ('x' in a) {
          out.set(a.x + (offset?.x ?? 0), a.y + (offset?.y ?? 0), a.z + (offset?.z ?? 0));
          return true;
        }
        if ('$prop' in a) return this.propView.locate(a.$prop, offset, out);
        if ('$entity' in a) return this.entityView.locate(a.$entity, offset, out);
        const p = this.frameData?.players.find((x) => x.id === a.$player);
        if (!p) return false;
        if (p.vehicle?.prop != null && !p.vehicle.remote) return this.propView.locate(p.vehicle.prop, offset, out);
        const avatar = this.avatars.idOf(p.id);
        if (p.id !== this.playerId && avatar !== undefined && this.entityView.locate(avatar, offset, out)) return true;
        out.set(p.x + (offset?.x ?? 0), p.y + (offset?.y ?? 0), p.z + (offset?.z ?? 0));
        return true;
      },
      heading: (a) => {
        if ('$prop' in a) return this.propView.heading(a.$prop);
        if ('$player' in a) {
          const p = this.frameData?.players.find((x) => x.id === a.$player);
          if (p?.vehicle?.prop != null && !p.vehicle.remote) return this.propView.heading(p.vehicle.prop);
          return p ? p.view.yaw : null;
        }
        return null;
      },
    };
    this.gameHud.onScreen = (open) => {
      if (open) this.input.unlock();
      // Closed by a button click: grab the mouse again (needs a user gesture), or give the controller the game back.
      else if (this.mode === 'playing' && (this.input.device !== 'mouse' || navigator.userActivation?.isActive)) this.input.lock();
    };
    this.gameHud.onCrosshair = (v) => this.hud.setCrosshair(v);
    this.gameHud.player = this.playerId;
    this.gameHud.setHealthStyle(def.hud?.health ?? 'hearts');
    this.unTheme = applyTheme(this.ui, def.hud?.theme);
    if (!this.walker) this.hud.setHotbarVisible(false);
    this.devTools = new DevTools(this.ui, {
      def,
      renderer: this.renderer,
      chunks: this.chunks,
      env: this.env,
      pool: this.pool,
      quality: this.quality,
      mode: () => this.mode,
      ready: () => this.worldReady,
      player: () => this.playerId,
      frame: () => this.frameData,
      mine: (f) => this.mine(f),
      look: () => this.view,
      request: (cmd) => this.request<DevReply>(cmd),
    });
    this.fx = new Effects(this.particles, this.gameHud, this.renderer.fxScene, this.sfx, () => this.camera.position);
    this.fx.onBlast = (at, size) => this.debris.blast(at, size);
    // Solid blocks as a flight meets them (`client.world.raycast`: through plants, where a carved block really is).
    const flying = flightWorld(world, this.registry);
    this.flightWorld = flying;

    this.propView = new PropView({
      shared: this.renderer.uniforms,
      albedo: this.textures.albedo,
      material: this.textures.material,
      registry: this.registry,
      resolve: (b) => this.blockId(b),
      scene: this.renderer.entityScene,
      fxScene: this.renderer.fxScene,
      world,
      content: this.content,
      gltf: this.graphics.gltf,
    });
    this.entityView = new EntityView(this.graphics, this.renderer.entityScene, world, this.content);
    // Every cosmetic on the platform (the platform's own and each game's), for what players wear.
    const cosmetics = cosmeticCatalog([...this.games, ...this.hidden].map((g) => g.meta));
    this.entityView.cosmetic = (id) => cosmetics.get(id);
    this.pickupView = new PickupView({
      graphics: this.graphics,
      scene: this.renderer.entityScene,
      fxScene: this.renderer.fxScene,
      content: this.content,
      blockModel: (block, size) => this.propView.localCube(block, size),
    });

    this.view = new PlayerCamera(this.camera);
    this.view.clearance = (from, dir, max) => this.clearance(from, dir, max);
    this.view.aimAt = (from, dir, max, blocksFrom) => this.aimAt(from, dir, max, blocksFrom);
    this.avatars = new Avatars({
      def,
      content: this.content,
      view: this.view,
      walker: this.walker,
      camera: this.camera,
      world,
      hud: this.gameHud,
      figure: (item, state) => this.client.kindFigure(item, state),
      ownClip: () => this.ownClip,
      cosmetic: (id) => cosmetics.get(id),
    });
    this.replays = new ReplayView({
      camera: this.camera,
      view: this.view,
      ui: this.ui,
      fx: this.fx,
      sfx: this.sfx,
      item: (id) => this.content.items.get(id),
      settings: () => this.settings,
      walkSpeed: this.tune.params[0],
      player: () => this.playerId,
      send: (cmd) => this.link.send(cmd),
      emit: (e) => this.emit(e),
      message: (name, data) => this.message(name, data),
      viewCall: (method, args) => this.viewCall(method, args),
      damage: (data) => this.debris.fromDamage(data),
      fillMe: (base, p) => this.fillMe(base, p),
    });
    this.held = new FirstPersonLayer(this.textures.albedo, this.textures.material, this.graphics, this.camera, this.content.animations, (e) => this.client?.emit(e), this.content.items);
    this.renderer.overlay = { scene: this.held.view.scene, camera: this.held.view.camera };
    this.renderer.opaqueScene.add(this.highlight.object);

    // The game's content reaches the client's renderer and audio as it's defined.
    this.content.onWidget((name, widget) => this.gameHud.defineWidget(name, widget));
    this.content.onAtlas((name, source) => {
      if ('pixels' in source) this.graphics.addAtlas(name, source.width, source.height, source.pixels, source.emissive);
      else this.graphics.addCanvasAtlas(name, source);
    });

    // The presentation calls the host sends run here; callbacks go back as messages.
    this.presenter = new Presenter(this.playerId, {
      hud: this.gameHud,
      fx: this.fx,
      sfx: this.sfx,
      view: (method, args) => this.viewCall(method, args),
      send: (m) => this.link.send({ t: 'message', msg: m }),
      message: (name, data) => this.message(name, data),
      item: (id) => this.content.items.get(id),
    });

    // The game's host is on the server: it set the game up and placed the spawn, and sends batches.
    // Two steps behind the newest frame: smooth, and about 70 ms behind the server at 30 steps a second.
    this.playback = new FrameBuffer(2 / this.link.welcome.tickRate);
    this.link.onClose = () => this.disconnected();
    if (this.walker) {
      // Movement as the server moves them: the game's tuning, and what they hold (a heavy gun,
      // aiming): its kind's kit's `move`, as the host works it out.
      this.predictor = new Predictor(
        this.chunks.world,
        this.tune,
        (input) => {
          const item = this.client?.kindMove(this.heldDef(), input.buttons) ?? null;
          return { speed: (this.mine(this.frameData)?.speed ?? 1) * (item?.speed ?? 1), noSprint: item?.noSprint ?? false };
        },
        worldQuery(this.chunks.world, this.registry),
      );
      this.movers = new ClientMovers(this.chunks.world, this.content, this.registry, (b) => this.blockId(b));
    }

    this.vehicles = new VehicleView(def.vehicles ?? {}, worldQuery(this.chunks.world, this.registry), true);
    this.link.onBatch = (b) => this.receive(b);

    if (def.player?.build) {
      this.picker = new BlockPicker(this.ui, this.registry, icons, () => this.closePicker());
      this.picker.onPick = (id) => {
        this.link.send({ t: 'message', msg: { t: 'creativePick', player: this.playerId ?? '', block: id } });
        this.hud.showToast(this.registry.blocks[id]?.label ?? '');
      };
    }
    this.hud.setVisible(false);
    this.gameHud.setVisible(false);
    this.held.visible = false;

    // The pause menu offers restarting and the world's clock only where the server takes them: in
    // a game of the player's own (the public game is everyone's), or on a development server (the
    // clock only where the game doesn't fix the time).
    const theirs = this.room !== null || import.meta.env.DEV;
    const pauseGame = {
      title: def.title,
      accent: def.accent,
      room: this.room,
      instances: def.instances,
      restart: theirs,
      clock: !def.world?.freezeTime && theirs,
      controls: def.controls,
      walks: this.walker,
      keys: { bound: this.settings.keys, game: this.input.keysFor },
      achievements: def.achievements,
    };
    this.pause = new PauseMenu(this.ui, this.settings, pauseGame, this.input.keysFor, (s) => this.applySettings(s), () => this.input.lock());
    this.pause.onTime = (t) => this.link.send({ t: 'env', time: t });
    this.gameHud.onAchievements = (earned, kept) => this.pause.setAchieved(earned, kept);
    this.pause.onRestart = () => {
      this.pause.hide();
      this.restart();
      this.input.lock();
    };
    this.pause.onExit = () => this.exit();

    this.hooks = {
      shadowCull: (vp) => this.chunks.applyShadowVisibility(vp, this.camera.position, this.renderer.settings.shadowDistance),
      mainCull: () => this.chunks.applyMainVisibility(this.camera),
    };

    this.input.onLockChange = (locked) => this.onLockChange(locked);
    this.input.onKey = (code, e) => this.onKey(code, e);
    this.input.onDevice = (d) => {
      document.body.classList.toggle('pad-mode', d === 'pad');
      document.body.classList.toggle('touch-mode', d === 'touch');
      if (d === 'mouse') this.padNav.clear();
    };
    // The touch controls (phones and tablets): the game's buttons from its controller layout.
    this.touch = new TouchControls(this.ui, this.life.signal);
    this.touch.setButtons(touchButtons(def, this.walker, this.input.keysFor, this.walker));
    this.touch.onPause = () => {
      if (this.mode === 'playing' && !this.gameHud.screenOpen) this.input.unlock();
    };
    document.body.classList.toggle('touch-mode', this.input.device === 'touch');
    this.input.onPadButton = (b, a) => this.onPadButton(b, a);
    document.body.classList.toggle('pad-mode', this.input.device === 'pad');
    this.pause.setPadHints(padHints(def, this.walker, this.input.keysFor));
    this.pause.setTouchHints(touchHints(touchButtons(def, this.walker, this.input.keysFor, this.walker), this.walker, this.walker));
    const life = { signal: this.life.signal };
    this.canvas.addEventListener('click', () => {
      this.sfx.unlock();
      if (this.mode === 'console') {
        this.commandBar.close();
        return;
      }
      if (this.gameHud.screenOpen) return;
      // (Clicking while a controller plays hands the game to the mouse.)
      const unlockedPlay = this.mode === 'playing' && !this.input.pointerLocked;
      if (this.mode === 'paused' || unlockedPlay || (this.mode === 'title' && this.worldReady)) this.input.lock();
    }, life);
    window.addEventListener('resize', () => this.resize(), life);
    // Leaving the page: leave the game, even if the browser keeps the page to come back to (its
    // connection would otherwise stay, and the player with it). Back again: a fresh start.
    window.addEventListener('pagehide', () => this.link.close(), life);
    window.addEventListener('pageshow', (e) => e.persisted && location.reload(), life);

    this.commandBar = new CommandBar(this.ui);
    this.commandBar.complete = (line) => this.request<{ start: number; options: string[] }>({ t: 'complete', line });
    this.commandBar.onClose = () => {
      if (this.mode !== 'console') return;
      this.mode = 'playing';
      this.input.lock();
    };
    this.commandBar.onSubmit = (line) => {
      this.commandBar.print(`/${line.replace(/^\/+/, '')}`, 'echo');
      void this.request<{ ok: boolean; text: string }>({ t: 'exec', line }).then((r) => this.commandBar.print(r.text, r.ok ? 'ok' : 'error'));
    };

    this.applySettings(this.settings, false);
    this.resize();
    this.renderer.warmup(this.camera);
    // The game's code for this screen: its kits and its own frame.
    const view = this.view;
    const input = this.input;
    const worldCamera = this.camera;
    const taken = this.taken;
    const settings = () => this.settings;
    const walker = this.walker;
    this.clientHud = new ClientHudService(this.hud, this.gameHud, def.hud?.theme);
    this.client = new ClientRuntime(this.def, this.clientDef, {
      services: {
        // First person.
        view: this.held,
        // Figures.
        figures: this.entityView.figures,
        // HUD and effects.
        hud: this.clientHud,
        scene: new SceneService(this.renderer.entityScene, this.graphics, this.content.items),
        // Replays.
        replay: this.replays.service(),
        // Shared services.
        camera: {
          get zoom() {
            return view.aimZoom;
          },
          set zoom(z: number) {
            view.aimZoom = z;
          },
          get fov() {
            return worldCamera.fov;
          },
          get position() {
            const p = worldCamera.position;
            return { x: p.x, y: p.y, z: p.z };
          },
          toWorld: (local) => {
            const p = worldCamera.localToWorld(new THREE.Vector3(local.x, local.y, local.z));
            return { x: p.x, y: p.y, z: p.z };
          },
          take: (pose) => taken.take(pose.position, pose.target, pose.fov),
          release: (ease) => taken.release(ease),
          get taken() {
            return taken.active;
          },
        } as Client['camera'],
        fx: this.fx,
        audio: {
          play: (name, opts) => this.sfx.play(name, opts),
          define: (name, voice, opts) => this.sfx.define(name, voice, opts),
          loop: (name, opts) => this.sfx.loop(name, opts),
          defineLoop: (name, voice) => this.sfx.defineLoop(name, voice),
          acoustics: (a) => this.sfx.acoustics(a),
          get music() {
            return settings().music;
          },
        },
        items: { look: (id, look) => this.content.lookItem(id, look), get: (id) => this.content.items.get(id) },
        input: {
          isDown: (code) => input.isDown(code),
          button: (b) => input.button(b),
          get device() {
            return input.device;
          },
          get assist() {
            return settings().aimAssist && walker;
          },
          get sticksMoving() {
            return input.padTilt > 0.05 || input.padMoving || input.touchLooking || input.touchMoving;
          },
          rumble: (strong, weak, ms) => {
            if (settings().vibration) rumble(strong, weak, ms);
          },
        },
        world: {
          blockAt: (x, y, z) => this.registry.blocks[this.chunks.world.get_block(Math.floor(x), Math.floor(y), Math.floor(z))]?.name ?? 'air',
          raycast: (from, dir, max) => {
            const h = flying.hit(from.x, from.y, from.z, dir.x, dir.y, dir.z, max);
            return h && { distance: h.t, normal: { x: h.nx, y: h.ny, z: h.nz } };
          },
          lineOfSight: (a, b) => this.chunks.world.line_clear(a.x, a.y, a.z, b.x, b.y, b.z),
          trace: (from, dir, range, opts = {}) => this.trace(from, dir, range, opts.penetration ?? null),
          blockColor: (id) => this.debris.blockColor(id),
          carvable: (block, at, normal) => this.carvable(block, at, normal),
        },
      },
      item: (id) => this.content.items.get(id),
      send: (name, data) => this.sendMessage(name, data),
      running: () => this.frameData?.started ?? false,
    });
    for (const e of this.early) this.client.emit(e);
    this.early = [];
    this.clientStarted = false;
    this.title.progress(0.1, 'Generating terrain…');
    requestAnimationFrame((t) => this.frame(t));
  }

  /** Built-in monster / item atlas generated in Rust (placeholder until the module exists). */
  private loadEntityAtlas() {
    const gen = (engine as unknown as { entity_textures?: () => Uint8Array }).entity_textures;
    const size = 256;
    if (gen) {
      const all = gen();
      this.graphics.addAtlas('builtin', size, size, all.slice(0, size * size * 4), all.slice(size * size * 4, size * size * 5));
    } else {
      const px = new Uint8Array(size * size * 4);
      for (let i = 0; i < size * size; i++) {
        const x = i % size;
        const y = Math.floor(i / size);
        const c = ((x >> 3) + (y >> 3)) & 1 ? 150 : 110;
        px.set([c, c + 20, c, 255], i * 4);
      }
      this.graphics.addAtlas('builtin', size, size, px);
    }
  }

  /**
   * A message from the host for the client code: the platform's own (`$` names: events the kits
   * draw from, or the engine's own doing), else the game's (`client.on`).
   */
  private message(name: string, data: unknown) {
    if (!name.startsWith('$')) return this.client ? this.client.message(name, data) : this.emit({ t: 'message', name, data });
    if (name === '$debris') {
      const [x, y, z, id] = data as [number, number, number, number];
      this.debris.broken(x, y, z, id);
    } else if (name === '$reset') {
      // A restart: everything the game put on screen goes (a replay too).
      this.replays.end(false);
      this.entityView.clear();
      this.pickupView.clear();
      this.propView.clear();
      this.presenter.reset();
      this.gameHud.clear();
      this.highlight.set(null);
      this.fx.clear();
      this.debris.clear();
      this.emit({ t: 'reset' });
    }
  }

  /**
   * The server's calls to this player's first-person view (`player.viewModel`, and the sim's own
   * uses, swings and kicks): events for the game's client code (its first-person kit plays them).
   */
  private viewCall(method: string, args: unknown[]) {
    const power = (args[0] as number | undefined) ?? 1;
    switch (method) {
      case 'visible':
        return this.emit({ t: 'view.visible', visible: args[0] as boolean });
      case 'setSkin':
        return this.emit({ t: 'view.setSkin', skin: args[0] as [number, number] | null, atlas: args[1] as string | undefined });
      case 'play': {
        const opts = args[1] as { power?: number; speed?: number } | undefined;
        return this.emit({ t: 'view.play', anim: args[0] as string, power: opts?.power ?? 1, speed: opts?.speed ?? 1 });
      }
      case 'kick':
        return this.emit({ t: 'kick', strength: power });
      case 'use':
        return this.emit({ t: 'use', power });
      case 'swing':
        return this.emit({ t: 'swing', power });
    }
  }

  /** Something happened for the client code (its kits see it this frame, or the first, if it hasn't started yet). */
  private emit(e: ClientEvent) {
    if (this.client) this.client.emit(e);
    else this.early.push(e);
  }
  /** Events from before the client code was made (the host's first batches come as the link's taken on). */
  private early: ClientEvent[] = [];

  /** `client.send`: a message from the client code to the game's server (`clientMessage` there), checked here as the server will. */
  private sendMessage(name: string, data: unknown) {
    const m = sanitizeGameMessage(name, data);
    if (!m) {
      console.warn(`client.send('${name}'): a message needs a name (a letter, then letters, digits, _ - . :) and plain data of at most ${MESSAGE_MAX.client} bytes as JSON`);
      return;
    }
    // (Watching, not in the game: there's no player to say it.)
    if (this.playerId) this.link.send({ t: 'message', msg: m });
  }

  /** Show a block in the hand (a bed whole: its head too), from the block picker or an item that looks like one. */
  private holdBlock(id: number, item: string | null = null, itemDef?: ItemDefinition) {
    const def = this.registry.blocks[id];
    this.held.holdBlock(def, def?.model === 'bed' ? (variant(this.registry, def, { part: 'head' }) ?? undefined) : undefined, item, itemDef);
  }

  /** `hud.highlight`: outline a block, with break cracks at `progress`. */
  private setHighlight(at: Vec3 | null, progress?: number) {
    if (!at) return this.highlight.set(null);
    const [x, y, z] = [Math.floor(at.x), Math.floor(at.y), Math.floor(at.z)];
    const def = this.registry.blocks[this.chunks.world.get_block(x, y, z)];
    // A fence or pane as it's joined there.
    let boxes = def?.boxes;
    if (def?.joins) {
      const flat = this.chunks.world.target_boxes(x, y, z);
      boxes = Array.from({ length: flat.length / 6 }, (_, i) => [...flat.subarray(i * 6, i * 6 + 6)]);
    }
    this.highlight.set(at, def?.shape === 'cross' ? 'cross' : (boxes ?? null), progress);
  }

  /** Reset game state and call `start` again. */
  restart() {
    this.link.send({ t: 'restart' });
  }

  /** A batch from the host: what happened, in order, then the frame to draw. */
  private receive(b: HostBatch) {
    for (const e of b.events) {
      switch (e.t) {
        case 'content':
          this.content.apply(e.def);
          break;
        case 'call':
          // (A replay playing: what the live game shows in the world waits for nobody.)
          if (this.replays.hides(e.call)) break;
          this.presenter.apply(e.call);
          break;
        case 'edits':
          this.chunks.mirrorEdits(e.cells);
          break;
        case 'damage':
          this.chunks.applyDamage(e.data);
          if (this.worldReady && !this.replays.playing) this.debris.seen(e.data);
          break;
        case 'replay':
          this.replays.start(e.replay);
          break;
        case 'replayEnd':
          if (this.replays.playback?.wire.id === e.id) this.replays.end(false);
          break;
        case 'revert':
          this.chunks.revertEdits();
          break;
        case 'joined':
          // In the game now, as this player.
          this.playerId = e.player;
          this.presenter.player = e.player;
          this.gameHud.player = e.player;
          break;
        case 'ready':
          this.hostReady = true;
          // The skin may live in an atlas the game registered in `setup`, which has arrived by now.
          if (this.def.player?.skin) this.held.arms.setSkin(this.def.player.skin, this.def.player.skinAtlas);
          break;
        case 'exit':
          this.exit();
          break;
        case 'reply':
          this.requests.get(e.id)?.(e.value);
          this.requests.delete(e.id);
          break;
        case 'error':
          console.error(`[game] ${e.text}`);
          break;
      }
    }
    // The batch's shots show together, and the rubble they knocked out flies.
    this.chunks.flushDamage();
    this.debris.flush();
    if (b.frame) {
      this.frameData = b.frame;
      // In a room of a player's own, the home page says who's in it.
      if (this.room && this.mode === 'title') this.title.present(b.frame.players.map((p) => p.name));
      if (this.mode === 'paused') this.pause.setPlayers(b.frame.players.map((p) => ({ name: p.name, bot: p.bot, me: p.id === this.playerId })));
      this.playback.push(b.frame, (b as TimedBatch).time);
      const me = this.playerId !== null ? b.frame.players.find((p) => p.id === this.playerId) : undefined;
      // Prediction starts again from this frame: its solid props too.
      this.movers?.sync(b.frame.props, b.frame.clock);
      if (me) {
        this.predictor?.reconcile(me);
        this.vehicles.reconcile(me);
      }
    }
  }

  /**
   * This client's player in a frame. Watching the game before joining, a stand-in at the spawn,
   * for the camera (circling above it on the title screen) and the terrain around it.
   */
  private mine(f: SimFrame | null): PlayerFrame | undefined {
    const me = f?.players.find((p) => p.id === this.playerId);
    if (me || !f || this.playerId) return me;
    return standIn(this.link.welcome.spawn, this.settings.fov);
  }

  /** The server went away: say so, and stop sending. */
  private disconnected() {
    this.input.unlock();
    this.gameHud.screen({ title: 'Disconnected', subtitle: 'The connection to the game server was lost.', tone: 'defeat', buttons: [{ label: 'Reload', primary: true, onClick: () => location.reload() }] });
  }

  /** Ask the host something; the answer comes in a later batch. */
  private request<T>(cmd: { t: 'exec' | 'complete'; line: string } | { t: 'dev'; js: string }): Promise<T> {
    const id = this.nextRequest++;
    return new Promise<T>((resolve) => {
      this.requests.set(id, resolve as (v: unknown) => void);
      this.link.send({ ...cmd, id });
    });
  }

  /** Back to the home page (this game's, fresh; the same room): `game.exit()`, the pause menu's Leave game. */
  exit() {
    this.switchGame(this.def.id, this.room);
  }

  /**
   * Another game, in place: the home page stays (showing it picked at once), the world fades
   * out, this game shuts down and the next starts, fading in when its world is ready.
   */
  private switchGame(id: string, room: string | null = null) {
    if (this.switching) return;
    this.switching = true;
    this.canvas.classList.add('fading');
    window.setTimeout(() => {
      const carry = this.shutdown();
      Runtime.switchTo(id, room, this.canvas, this.ui, this.games, this.hidden, carry);
    }, 260);
    this.title.select(id, [...this.games, ...this.hidden].find((g) => g.meta.id === id)?.meta.title);
  }

  /** Start another game (or room) on the page the last one left (the home page stays up throughout). */
  private static switchTo(id: string, room: string | null, canvas: HTMLCanvasElement, ui: HTMLElement, games: GameEntry[], hidden: GameEntry[], carry: Carry) {
    const url = new URL(location.href);
    // Back to the same public game: the same copy of it, if it still has a place.
    if (url.searchParams.get('game') !== id || room) url.searchParams.delete('shard');
    url.searchParams.set('game', id);
    if (room) url.searchParams.set('room', room);
    else url.searchParams.delete('room');
    for (const p of ['seed', 'name']) url.searchParams.delete(p);
    // A server stays (any game on it); one game's address doesn't.
    const server = url.searchParams.get('server');
    if (server && Runtime.gameAddress(server)) url.searchParams.delete('server');
    history.replaceState(null, '', url);
    carry.title.select(id, [...games, ...hidden].find((g) => g.meta.id === id)?.meta.title);
    Runtime.start(canvas, ui, games, hidden, carry).catch((err: unknown) => {
      console.error(err);
      carry.title.failed(err instanceof Error ? err.message : String(err), (next) => Runtime.switchTo(next, null, canvas, ui, games, hidden, carry));
    });
  }

  /**
   * This game is over: stop its loop, its server connection, its terrain
   * workers, its listeners and sound; free its meshes, textures and HUD. The home page, renderer
   * and block textures go to the next game.
   */
  private shutdown(): Carry {
    this.disposed = true;
    this.client?.dispose();
    this.clientHud?.dispose();
    this.life.abort();
    if (document.pointerLockElement) document.exitPointerLock();
    this.link?.close();
    this.pool?.dispose();
    this.chunks?.dispose();
    this.entityView?.clear();
    this.pickupView?.clear();
    this.propView?.clear();
    this.fx?.clear();
    const r = this.renderer;
    for (const o of [this.particles?.points, this.highlight.object]) {
      if (!o) continue;
      o.removeFromParent();
      disposeTree(o);
    }
    for (const scene of [r.entityScene, r.fxScene]) {
      for (const o of [...scene.children]) {
        scene.remove(o);
        disposeTree(o);
      }
    }
    if (r.overlay) {
      disposeTree(r.overlay.scene);
      r.overlay = null;
    }
    this.graphics?.dispose();
    this.sfx.close();
    this.unTheme();
    this.gameHud?.closeScreens();
    // The HUD, menus and overlays this game put up; the home page stays.
    for (const el of [...this.ui.children]) if (el !== this.title.root) el.remove();
    return { title: this.title, renderer: r, textures: this.textures, biome: this.biome };
  }

  // ---------------------------------------------------------------------------------------------
  // Loading
  // ---------------------------------------------------------------------------------------------

  /** The title screen's progress: the terrain around the player (the host placed them) meshed. */
  private updateReadiness() {
    const s = this.mine(this.frameData);
    if (this.worldReady || !s || !this.hostReady) return;
    const ready = this.chunks.readiness(s.x, s.z, Math.min(this.viewDistance(this.settings), 6));
    const models = this.graphics.gltf.pending;
    this.title.progress(0.1 + 0.9 * ready * (models ? 0.97 : 1), ready < 1 ? `Generating terrain… ${Math.round(ready * 100)}%` : models ? `Loading models… ${models} to go` : 'Ready');
    if (ready >= 0.999 && !models) {
      this.worldReady = true;
      this.title.setReady();
      this.canvas.classList.remove('fading');
    }
  }

  // ---------------------------------------------------------------------------------------------
  // Modes & input
  // ---------------------------------------------------------------------------------------------

  private play() {
    this.sfx.unlock();
    if (this.input.device === 'touch') void TouchControls.fill();
    if (this.worldReady) this.input.lock();
  }

  private beginPlay() {
    this.title.hide();
    this.hud.setVisible(this.hudVisible);
    this.gameHud.setVisible(this.hudVisible);
    this.held.visible = this.hudVisible;
    this.mode = 'playing';
    // Joining the game: as the name on the title screen.
    this.link.send({ t: 'start', name: this.title.name(), avatar: this.title.avatar() });
  }

  private onLockChange(locked: boolean) {
    if (locked) {
      if (this.mode === 'title') this.beginPlay();
      this.pause.hide();
      this.picker?.hide();
      this.mode = 'playing';
    } else if (this.mode === 'playing' && !this.gameHud.screenOpen) {
      this.mode = 'paused';
      this.pause.setPlayers((this.frameData?.players ?? []).map((p) => ({ name: p.name, bot: p.bot, me: p.id === this.playerId })));
      this.pause.show(this.frameData?.time ?? 0);
    }
  }

  private onKey(code: string, e?: KeyboardEvent) {
    if (this.mode === 'console') return;
    // Paused, Escape steps back out of the settings (the browser keeps it from resuming: a click does).
    if (code === 'Escape' && this.mode === 'paused') {
      this.pause.back();
      return;
    }
    // Playing with a controller there's no pointer lock for Esc to leave: it pauses here.
    if (code === 'Escape' && this.mode === 'playing' && this.input.padCaptured && !this.gameHud.screenOpen) {
      this.input.unlock();
      return;
    }
    // Match the character, not the key position: '/' is Shift+7 on many layouts.
    if ((e?.key === '/' || code === 'Slash' || code === 'KeyT') && this.mode === 'playing') {
      e?.preventDefault();
      this.mode = 'console';
      this.input.unlock();
      this.commandBar.open('/');
      return;
    }
    if (code === 'F3') this.devTools.toggle();
    if (code === 'F1') {
      this.hudVisible = !this.hudVisible;
      if (this.mode !== 'title') {
        this.hud.setVisible(this.hudVisible);
        this.gameHud.setVisible(this.hudVisible);
        this.held.visible = this.hudVisible;
      }
    }
    if (code === 'KeyE' && this.picker) {
      if (this.mode === 'playing') {
        this.mode = 'picker';
        this.picker.show();
        this.input.unlock();
      } else if (this.mode === 'picker') {
        this.closePicker();
      }
    }
    if (this.mode === 'playing' && this.def.player?.build) {
      const t = this.frameData?.time ?? 0;
      if (code === 'BracketLeft') this.link.send({ t: 'env', time: (t - 1 / 24 + 1) % 1 });
      if (code === 'BracketRight') this.link.send({ t: 'env', time: (t + 1 / 24) % 1 });
    }
  }

  /**
   * A controller button in the menus (or its pause button anywhere): the D-pad and stick move the
   * highlight, A presses, B goes back, Menu pauses and resumes.
   */
  private onPadButton(b: PadButton, a: PadAction) {
    if (this.mode === 'console') return;
    const back = () => {
      if (this.gameHud.back()) return;
      if (this.mode === 'paused' && !this.pause.back()) this.input.lock();
      else if (this.mode === 'picker') this.closePicker();
    };
    if (a === 'pause') {
      if (this.mode === 'playing' && this.input.locked && !this.gameHud.screenOpen) this.input.unlock();
      else if (this.mode === 'title') this.play();
      else if (this.mode === 'playing' && !this.gameHud.screenOpen) this.input.lock();
      else if (this.mode === 'paused') this.input.lock();
      else back();
      return;
    }
    if (b === 'Up' || b === 'Down' || b === 'Left' || b === 'Right') this.padNav.move(b);
    else if (b === 'A') this.padNav.press();
    else if (b === 'B') back();
  }

  /**
   * The right stick turns the view, as mouse movement would (so whatever reads the mouse, a
   * vehicle say, reads it too): faster with a longer push, faster still held all the way round,
   * slower aiming down the sights; with a gun, aim assist on the player in the crosshair.
   */
  private padAim(dt: number) {
    const [lx, ly] = this.input.padLook;
    this.fullTilt = Math.abs(lx) > 0.95 ? this.fullTilt + dt : 0;
    const boost = Math.min(1, Math.max(0, (this.fullTilt - 0.2) / 0.3));
    const s = this.settings.stickSensitivity / Math.pow(this.view.aimZoom, 0.85);
    // The kits' help (a gun's aim assist): slower over a target, turning with it.
    const help = this.client.kindStick();
    const yaw = lx * 3.6 * s * (1 + 0.8 * boost) * help.slow * dt - help.yaw;
    const pitch = ly * (this.settings.invertY ? -1 : 1) * 2.5 * s * help.slow * dt - help.pitch;
    // As mouse movement (the view turns by it, at the mouse's sensitivity, slowed as the zoom slows the mouse: the stick has its own).
    const k = 0.0022 * this.view.sensitivity * this.view.lookScale;
    this.input.mouseDX += yaw / k;
    this.input.mouseDY += pitch / k;
  }

  /**
   * A finger turning the view on the touch controls (pixels moved this frame), as mouse movement
   * would: a swipe across the screen turns about half way round, at the player's touch
   * sensitivity, slower down the sights; with a gun, aim assist on the player in the crosshair
   * (slower over them, turning with them) while a finger's on the screen.
   */
  private touchAim([dx, dy]: [number, number]) {
    const help = this.input.touchLooking || this.input.touchMoving ? this.client.kindStick() : { slow: 1, yaw: 0, pitch: 0 };
    const perPixel = (2.8 / Math.max(320, window.innerWidth)) * this.settings.touchSensitivity / Math.pow(this.view.aimZoom, 0.85);
    const yaw = dx * perPixel * help.slow - help.yaw;
    const pitch = dy * perPixel * help.slow * (this.settings.invertY ? -1 : 1) - help.pitch;
    const k = 0.0022 * this.view.sensitivity * this.view.lookScale;
    this.input.mouseDX += yaw / k;
    this.input.mouseDY += pitch / k;
  }

  private closePicker() {
    this.picker?.hide();
    this.mode = 'playing';
    this.input.lock();
  }

  // ---------------------------------------------------------------------------------------------
  // The local player's HUD and hand, from the frame
  // ---------------------------------------------------------------------------------------------

  /** The icon an item shows: its sprite, its block, or a picture of its model (as this screen has it: its look over the server's). */
  private itemIcon(d: ItemDefinition, size: number): string {
    return this.iconOf(d.icon ?? PLACEHOLDER_ICON, size);
  }

  /**
   * An icon as a picture: a sprite, a block's, a model's (blank until its file is here), or
   * `{ item }`, that item's as this screen has it (blank until the item is here).
   */
  private iconOf(ref: IconRef, size: number): string {
    const icon = resolveIcon(ref, (id) => this.content.items.get(id));
    if (!icon) return '';
    if (typeof icon === 'object' && 'block' in icon) return this.blockIcons.get(this.blockId(icon.block)) ?? '';
    return this.graphics.icon(icon, size);
  }

  /** The player's hands and what they hold, and (`hud`) their health and hotbar on the HUD. */
  private showPlayer(me: PlayerFrame, hud = true) {
    // A player model with a hand: their first-person arm is that part of it (once its file is here).
    const model = this.avatars.modelOf(me);
    const hand = model?.gltf?.hand;
    const arm = model?.gltf && hand ? `${model.gltf.url}|${hand}` : '';
    if (arm !== this.shown.arm) {
      if (!arm) {
        this.held.setModelArm(null);
        this.shown.arm = '';
      } else {
        const look = this.graphics.gltf.limb(model!.gltf!.url, hand!, 12 / 16);
        if (look) {
          this.held.setModelArm(look);
          this.shown.arm = arm;
        }
      }
    }
    // A humanoid model: their first-person arms are its forearms and fists (once its file is here), fitted by its `firstPerson`.
    const body = model?.gltf && (model.gltf.rig === 'humanoid' || model.gltf.joints || !model.gltf.clips) ? model.gltf.url : '';
    const fit = body ? model!.gltf!.firstPerson : undefined;
    const bodyKey = body ? `${body}|${JSON.stringify([fit ?? null, model!.gltf!.joints ?? null, model!.gltf!.poses?.heldScale ?? null])}` : '';
    if (bodyKey !== this.shown.humanoid) {
      const arms = body ? this.graphics.gltf.humanoidArms(model!.gltf!) : null;
      if (!body || arms) {
        this.held.setHumanoidArms(arms, fit);
        this.shown.humanoid = bodyKey;
      }
    }
    const creative = me.creative;
    // A spectator's hotbar and hearts are put away.
    const spectating = !!me.spectating;
    if (hud && spectating !== this.shown.spectating) {
      this.shown.spectating = spectating;
      this.hud.setHotbarVisible(this.walker && !spectating);
    }
    const hearts = me.mortal && !spectating ? me.maxHealth : 0;
    const health = `${me.health}|${hearts}`;
    if (hud && health !== this.shown.health) {
      this.shown.health = health;
      this.gameHud.setHealth(me.health, hearts);
    }
    if (creative && hud) {
      const key = `${creative.hotbar.join(',')}|${creative.selected}`;
      if (key !== this.shown.creative) {
        const announce = this.shown.creative !== '' && !this.shown.creative.endsWith(`|${creative.selected}`);
        this.shown.creative = key;
        this.hud.setHotbar(creative.hotbar, creative.selected, announce);
        this.holdBlock(creative.hotbar[creative.selected]);
      }
    }
    if (me.hotbar) this.showHotbar(me.hotbar.slots, me.hotbar.selected, hud);
  }

  private showHotbar(slots: (ItemStack | null)[], selected: number, hud = true) {
    // (Redrawn as model files arrive: an icon can be a picture of one.)
    const key = `${slots.map((s) => (s ? `${s.item}x${s.count}` : '')).join(',')}|${selected}|${this.graphics.gltf.version}`;
    if (hud && key !== this.shown.hotbar) {
      const prevSelected = this.shown.hotbar.split('|')[1];
      this.shown.hotbar = key;
      this.hud.setSlots(
        slots.map((s) => {
          if (!s) return null;
          const d = this.content.items.get(s.item);
          return d ? { icon: this.itemIcon(d, 48), count: s.count, label: d.name } : null;
        }),
        selected,
        prevSelected !== undefined && prevSelected !== String(selected),
      );
    }
    // What's in hand (the first-person layer loads it; the game's kits hold it): the item
    // selected, or a throwable being thrown with its key over it.
    // An item a kit puts in the hand instead (a grenade cooked by its key).
    const quick = hud ? this.client.kindHand() : null;
    const stack = quick ? { item: quick, count: 1 } : slots[selected];
    const def = stack ? this.content.items.get(stack.item) : undefined;
    const heldKey = stack?.item ?? '';
    if (heldKey === this.shown.held) return;
    this.shown.held = heldKey;
    if (!def) return this.held.holdNothing();
    // Looks like a block: held as a little cube of it.
    if (typeof def.icon === 'object' && 'block' in def.icon) return this.holdBlock(this.blockId(def.icon.block), stack!.item, def);
    if (!this.held.holdItem(stack!.item, def)) {
      // Its model's file is still coming: nothing in hand yet, and look again next frame.
      this.shown.held = '';
      this.held.holdNothing();
    }
  }

  /** Columns the host keeps around the player: what this client shows, within reason. */
  private hostRadius(s: Settings): number {
    return Math.min(12, this.viewDistance(s));
  }

  /**
   * The player's render distance, raised to the game's minimum (`world.viewDistance`) and held to
   * its maximum (`world.maxViewDistance`). A phone or tablet is raised to 12 at most: its memory
   * and graphics chip won't hold a desktop's view.
   */
  private viewDistance(s: Settings): number {
    const w = this.def.world;
    return Math.min(w?.maxViewDistance ?? 24, Math.max(s.renderDistance, Math.min(this.handheld ? 12 : 24, w?.viewDistance ?? 0)));
  }
  private handheld = isHandheld();

  private applySettings(s: Settings, persist = true) {
    const was = this.look ? this.settings : null;
    this.settings = { ...s };
    this.quality.enabled = s.autoQuality;
    // Where this machine settled last time; the player changing their graphics starts it again from the top.
    if (!was) this.quality.reset(savedQuality());
    else if (GRAPHICS.some((k) => was[k] !== s[k])) {
      this.quality.reset();
      saveQuality(0);
    }
    this.look = this.quality.apply(s, deviceDpr());
    this.renderer.applySettings(toRenderSettings(this.look.settings));
    const rd = this.viewDistance(s);
    if (this.chunks.renderDistance !== rd) this.chunks.setRenderDistance(rd);
    this.chunks.occlusion = s.occlusion;
    this.view.sensitivity = s.sensitivity;
    this.view.baseFov = s.fov;
    this.view.viewBobbing = s.viewBobbing;
    this.input.setBindings(s.keys);
    this.sfx.setLevel(s.volume);
    this.replays.applySettings(s);
    this.link.send({ t: 'env', dayLength: s.dayMinutes * 60 });
    this.link.send({ t: 'radius', columns: this.hostRadius(s) });
    this.camera.far = Math.max(256, (rd + 1.5) * 16 * 1.08);
    this.camera.updateProjectionMatrix();
    this.renderer.fogEnd = (rd - 0.35) * 16;
    this.resize();
    if (persist) saveSettings(s);
  }

  private resize() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    const dpr = this.look?.dpr ?? deviceDpr();
    this.renderer.setSize(w, h, dpr);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.particles?.setViewport(h * dpr * (this.look?.settings ?? this.settings).renderScale, this.camera.fov);
    // On a touch screen the HUD's drawn to fit it (style.css: body.touch-mode), a phone's at about half size.
    document.documentElement.style.setProperty('--hud-zoom', String(Math.round(Math.min(1, Math.max(0.5, Math.min(w / 1180, h / 760))) * 100) / 100));
    // And the touch controls bigger on a tablet (a phone's are sized for its thumbs).
    document.documentElement.style.setProperty('--touch-zoom', String(Math.round(Math.min(1.4, Math.max(1, Math.min(w, h) / 480)) * 100) / 100));
  }

  /** Auto quality moved a notch: draw the settings as it has them now. */
  private applyQuality() {
    saveQuality(this.quality.level);
    const was = this.look;
    this.look = this.quality.apply(this.settings, deviceDpr());
    this.renderer.applySettings(toRenderSettings(this.look.settings));
    if (!was || was.dpr !== this.look.dpr || was.settings.renderScale !== this.look.settings.renderScale) this.resize();
  }

  // ---------------------------------------------------------------------------------------------
  // Frame
  // ---------------------------------------------------------------------------------------------

  private frame(now: number) {
    if (this.disposed) return;
    requestAnimationFrame((t) => this.frame(t));
    const t0 = performance.now();
    const dt = Math.min(0.1, Math.max(0, (now - this.last) / 1000));
    // Frames while playing (not a menu, not a hidden tab) tell auto quality how the graphics keep up.
    if (this.mode === 'playing' && this.worldReady && document.visibilityState === 'visible' && this.quality.frame(now - this.last)) this.applyQuality();
    this.last = now;
    // A controller: in the game (its buttons press keys, its sticks walk and look), else the menus.
    const drives = this.mode === 'playing' && this.input.locked && !this.gameHud.screenOpen;
    this.input.pollPad(drives);
    // The touch controls: their buttons and stick, as a controller's; their look, turned here.
    const fingers = this.touch.read();
    this.input.applyTouch(fingers, drives);
    if (drives) {
      // (A menu opens with its highlight where it starts.)
      this.padNav.clear();
      if (this.input.device === 'pad') this.padAim(dt);
      if (this.input.touchCaptured) this.touchAim(fingers.look);
    } else if (this.input.device === 'pad' && this.mode !== 'console') this.padNav.sync();
    document.body.classList.toggle('pad-playing', this.input.padCaptured);
    const touchPlaying = drives && this.input.touchCaptured;
    if (touchPlaying !== this.touchShown) {
      this.touchShown = touchPlaying;
      this.touch.setActive(touchPlaying);
      document.body.classList.toggle('touch-playing', touchPlaying);
    }
    const playing = this.mode === 'playing';
    const started = this.frameData?.started ?? false;
    const dead = this.mine(this.frameData)?.dead ?? false;
    const spectating = !!this.mine(this.frameData)?.spectating;
    // The game has the controls (playing, the mouse captured, no screen open): all of them while
    // they're alive (or spectating: they fly about, dead or not); while they're dead, only what asks
    // for a dead player's keys hears them.
    const inGame = playing && (this.input.locked || this.debugActive) && !this.gameHud.screenOpen;
    const active = inGame && (!dead || spectating);
    this.sfx.hold(started && (this.mode === 'paused' || this.mode === 'console'));

    // Mouse look is the client's; the controls and the view go to the host.
    if (this.walker) {
      if (this.mode === 'title') {
        this.view.yaw += dt * 0.03;
        this.view.pitch = -0.18;
      } else {
        this.view.look(this.input, active);
        // In third person (the game's `camera.orbit`) the wheel zooms rather than changing hotbar slots.
        if (this.view.zooms) {
          if (active) this.view.zoom(this.input.wheel);
          this.input.wheel = 0;
        }
      }
    }
    // The game's client code starts once we're in the game, before anything reads an item: its
    // `setup` gives items their looks (`client.items.look`), so the hotbar, the hand, the figures
    // and the gun's controller never see an item without its look.
    const first = this.clientStarted ? undefined : this.mine(this.frameData);
    if (first) this.startClient(first);
    // The item kits act on this screen at once (a gun fires, a throwable's thrown); what they did
    // goes with the next controls sent. (A weapons-locked freeze: they don't answer here either, so
    // nothing is sent to be refused.)
    const latest = this.walker && this.itemMode ? this.mine(this.frameData) : undefined;
    if (latest) this.kitControls(dt, active && !latest.locked && !latest.dead && !latest.vehicle, latest.dead);
    // The server keeps its own clock: it gets the controls every frame, numbered, with how long
    // they lasted: walking and vehicles move at once here (prediction), and the server moves them
    // input by input, the same way.
    const input = this.withShots(this.input.snapshot(active, this.view.yaw, this.view.pitch, this.view.viewSeq));
    if (inGame && dead) input.dead = true;
    const seq = ++this.inputSeq;
    this.inputTimes.set(seq, now / 1000);
    this.inputTimes.delete(seq - 600);
    this.predictor?.step(input, dt, seq);
    this.vehicles.step(input, dt, seq);
    this.link.send({ t: 'input', input, seq, dt });
    const f = this.playback.sample() ?? this.frameData;
    if (f) this.shownT = f.t;
    this.updateReadiness();
    const played = this.mine(f);
    // A clip our own abilities started plays on our figure at once, numbered as the host will
    // number it (so its arrival doesn't start it again); gone once the host's word is in.
    const clips = this.predictor?.takeClips();
    if (clips?.length && f) {
      const c = clips[clips.length - 1];
      this.ownClip = clipFrame(Math.max(played?.clip?.seq ?? 0, this.ownClip?.seq ?? 0) + 1, c.name, c.opts, f.t);
    }
    if (this.ownClip && f && ((played?.clip?.seq ?? 0) >= this.ownClip.seq || f.t - this.ownClip.at > 3)) this.ownClip = null;
    // Our own player where prediction has them, else as the frame says.
    const predicted = this.predictor?.shown();
    let me = played && predicted ? { ...played, ...predicted } : played;
    if (f && me) me = this.onRide(f, me);
    if (!f || !me) {
      // The host is still starting: nothing to draw yet but the sky.
      this.present(dt, t0);
      return;
    }

    this.env.time = f.time;
    this.env.paused = true;
    this.env.update(dt);
    // A replay playing (`game.replay.show`): its frame is drawn in place of the live one, through
    // its player's eyes (`eyes`; null: its own camera). The live game goes on under it.
    const rp = this.replays.step();
    const shown = rp?.frame ?? f;
    const eyes = rp ? rp.eyes : me;
    // Driving: the vehicle's camera, worked out here every frame from its (predicted) state.
    const ride = !rp && me.camera.follow && this.vehicles.active ? this.vehicles.camera(dt) : null;
    if (rp) {
      this.replays.place(dt, rp.eyes);
    } else if (ride) {
      this.camera.position.copy(ride.position);
      this.camera.up.copy(ride.up);
      this.camera.lookAt(ride.target);
      this.camera.up.set(0, 1, 0);
      if (this.camera.fov !== ride.fov) {
        this.camera.fov = ride.fov;
        this.camera.updateProjectionMatrix();
      }
      this.camera.updateMatrixWorld();
    } else if (this.walker) {
      this.view.setOrbit(this.mode === 'title' ? null : me.orbit);
      // A movement ability's camera: as prediction has it, else the newest frame's.
      this.view.tilt = this.mode === 'title' || me.dead ? null : this.predictor ? this.predictor.tilt : (me.tilt ?? null);
      this.view.follow(dt, me, this.orbitPoint(f, me));
      // Our own figure faded as a third-person camera comes up close behind it (a wall at our back).
      const head = Math.hypot(this.camera.position.x - me.x, this.camera.position.y - (me.y + 1.5), this.camera.position.z - me.z);
      this.entityView.near = { player: this.view.thirdPerson ? this.playerId : null, opacity: Math.max(0.25, Math.min(1, (head - 0.8) / 0.8)) };
      if (this.mode === 'title') {
        this.camera.position.y += 22;
        this.camera.updateMatrixWorld();
      }
    } else {
      // The game's camera, as the simulation has it this tick (slowly turning on the title screen).
      if (this.mode === 'title') this.titleSpin += dt * 0.03;
      this.camera.position.set(me.camera.p[0], me.camera.p[1], me.camera.p[2]);
      this.camera.quaternion.set(me.camera.q[0], me.camera.q[1], me.camera.q[2], me.camera.q[3]);
      if (this.titleSpin) this.camera.quaternion.premultiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), this.titleSpin));
      if (this.camera.fov !== me.camera.fov) {
        this.camera.fov = me.camera.fov;
        this.camera.updateProjectionMatrix();
      }
      this.camera.updateMatrixWorld();
      if (this.mode !== 'title') this.titleSpin = 0;
    }
    // The game runs on while this client is paused: its figures keep walking.
    // (A replay's player is drawn while client code has the camera away from their eyes. While its
    // first frame stands still, so do the figures, exactly as it has them.)
    const avatars = () => (rp ? this.avatars.frames(shown, eyes ?? me, rp.follow, false, this.taken.active) : this.avatars.frames(f, me, this.playerId));
    this.entityView.sync(shown.players.length > 1 || (!rp && this.view.thirdPerson) || (rp && this.taken.active) ? [...shown.entities, ...avatars()] : shown.entities, shown.projectiles, dt, started, shown.t, !!rp?.holding);
    // A controller rumbles when we're hurt.
    if (me.health < this.lastHealth && this.lastHealth > 0 && this.input.device === 'pad' && this.settings.vibration) rumble(0.55, 0.3, 170);
    // (A phone buzzes, where it can: Android.)
    if (me.health < this.lastHealth && this.lastHealth > 0 && this.input.device === 'touch' && this.settings.vibration) navigator.vibrate?.(45);
    this.lastHealth = me.health;
    this.pickupView.sync(shown.pickups, dt);
    // Our own vehicle's model where prediction has it, not where the (older) frame does.
    const own = !rp && this.vehicles.active && this.vehicles.prop !== null ? new Map([[this.vehicles.prop, this.vehicles.pose()]]) : undefined;
    this.propView.sync(shown.props, dt, { clock: shown.clock, me: rp ? null : this.playerId, inputTime: (seq) => this.inputTimes.get(seq) ?? null, now: now / 1000, camera: this.camera.position }, own);
    // (In a replay, its player's hands and what they hold; our own HUD stays ours.)
    this.showPlayer(eyes ?? me, !rp);

    if (this.walker && !ride && !rp && !this.taken.active) {
      this.view.viewDirection(this.dir);
      this.chunks.update(me.x, me.z, this.dir.x, this.dir.z);
    } else {
      this.camera.getWorldDirection(this.dir);
      this.chunks.update(this.camera.position.x, this.camera.position.z, this.dir.x, this.dir.z);
    }

    // Light probe at the player's eyes drives the held item and particles.
    if (++this.probeFrame % 4 === 0) {
      const p = this.camera.position;
      const l = this.chunks.world.light_probe(Math.floor(p.x), Math.floor(p.y), Math.floor(p.z));
      const sky = l[0] * l[0];
      const blk = Math.pow(l[1], 2.2);
      this.probe
        .copy(this.env.ambientSky)
        .multiplyScalar(0.9 * sky)
        .addScaledVector(this.env.lightColor, 0.55 * sky)
        .add(new THREE.Vector3(1.0, 0.6, 0.28).multiplyScalar(1.4 * blk))
        .addScalar(0.012);
    }
    this.light.copy(this.probe);
    this.held.setLight(this.probe);
    // The first-person layer: drawn only in first person (nothing in hand while dead, someone out
    // of the game watching sees only the game, or in third person).
    this.held.frame(this.camera.aspect, !this.taken.active && (rp ? !!eyes && !eyes.dead && !eyes.vehicle : this.walker && this.mode !== 'title' && !me.dead && !me.spectating && !me.vehicle && !this.view.thirdPerson));
    // The game's client code: its kits (the first-person view places the hand, the figures are
    // posed, ...), then its own frame. In a replay, `client.me` is the player it follows.
    if (!this.clientStarted) this.startClient(me);
    const mine = rp && eyes ? this.replays.me(eyes) : this.meOf(me, dt);
    this.client.frame(dt, mine);
    // The camera as the client code has taken it (or easing back to ours), over the one placed above.
    this.taken.apply(this.camera, dt);
    // The figures as client code posed them (the figures kit), animated.
    this.entityView.finish();
    // The world's effects move on by the frame's time (what the client code made just now, too).
    this.particles.setLight(this.light);
    this.particles.update(dt);
    this.debris.update(dt, this.light);
    this.fx.update(dt);
    // The client code's late work, from where the eye is now (what's made here is drawn where it
    // starts: a shot's tracers leave the muzzle as it's drawn).
    this.client.late(dt);
    if (this.gameHud.wantsLocal) this.gameHud.setLocal(this.localState(me));
    this.gameHud.holdScoreboard(this.mode === 'playing' && this.input.isDown('Tab'));
    // Camera effects: shake and the death tilt (which rights itself after a moment, for someone
    // out of the game a while to watch).
    this.camera.position.add(this.fx.shakeOffset);
    // (In a replay, the eyes it follows fall as they did.)
    const fallen = rp ? eyes : me;
    if (this.walker && fallen?.dead && !fallen.spectating) {
      const k = Math.min(1, fallen.deathTime / 0.6) * Math.min(1, Math.max(0, (2.8 - fallen.deathTime) / 0.8));
      this.camera.position.y -= k * 1.2;
      this.camera.rotateZ(k * 0.45);
    }
    this.camera.updateMatrixWorld();
    const heading = rp ? (eyes ? this.replays.eyes.yaw : Math.atan2(-this.dir.x, -this.dir.z)) : this.walker ? this.view.yaw : Math.atan2(-this.dir.x, -this.dir.z);
    this.sfx.setListener(this.camera.position, heading);
    this.present(dt, t0);
  }

  /**
   * On a solid prop, this player is shown where it's drawn this frame (prediction runs ahead of
   * the frames the prop is drawn from), and their view turns as it turns.
   */
  private onRide(f: SimFrame, me: PlayerFrame): PlayerFrame {
    const ride = me.ride;
    const pose = ride && !me.vehicle ? propPose(f.props, ride.prop, f.clock) : null;
    if (!ride || !pose) {
      this.rideHeading = null;
      return me;
    }
    const h = heading(pose.q);
    if (this.walker && this.mode !== 'title' && this.rideHeading?.prop === ride.prop) {
      let d = h - this.rideHeading.heading;
      d -= Math.round(d / (Math.PI * 2)) * Math.PI * 2;
      this.view.yaw += d;
    }
    this.rideHeading = { prop: ride.prop, heading: h };
    const at = toWorld(pose, { x: ride.p[0], y: ride.p[1], z: ride.p[2] });
    return { ...me, x: at.x, y: at.y, z: at.z };
  }

  /** The point the game's orbit circles (`camera.orbit`): on a prop as it's drawn, or a player. */
  private orbitPoint(f: SimFrame, me: PlayerFrame): THREE.Vector3 | null {
    const o = me.orbit;
    if (!o) return null;
    if (o.prop !== undefined) {
      const pose = propPose(f.props, o.prop, f.clock);
      const off = o.offset ?? [0, 0, 0];
      return pose && toWorld(pose, { x: off[0], y: off[1], z: off[2] });
    }
    const p = o.player === this.playerId ? me : f.players.find((x) => x.id === o.player);
    const off = o.offset ?? [0, 1.62, 0];
    return p ? new THREE.Vector3(p.x + off[0], p.y + off[1], p.z + off[2]) : null;
  }

  /**
   * What an over-the-shoulder aim converges on (`PlayerCamera.aimAt`): how far along the camera's
   * line the first solid block or someone else's body is (as the newest frame has them), or null.
   */
  private aimAt(from: THREE.Vector3, dir: THREE.Vector3, max: number, blocksFrom: number): number | null {
    const b = blocksFrom;
    const h = this.flightWorld?.hit(from.x + dir.x * b, from.y + dir.y * b, from.z + dir.z * b, dir.x, dir.y, dir.z, max - b);
    let best = h ? h.t + b : max;
    const at = new THREE.Vector3();
    for (const p of this.frameData?.players ?? []) {
      if (p.id === this.playerId || p.dead || p.spectating) continue;
      // Where their figure is drawn (what the crosshair is on), else where the frame has them.
      const id = this.avatars.idOf(p.id);
      if (id === undefined || !this.entityView.locate(id, undefined, at)) at.set(p.x, p.y, p.z);
      const t = rayBox(from, dir, { x: at.x - 0.4, y: at.y, z: at.z - 0.4 }, { x: at.x + 0.4, y: at.y + (p.sneaking ? 1.6 : 1.9), z: at.z + 0.4 });
      if (t !== null && t < best) best = t;
    }
    return best < max ? best : null;
  }

  /** How far a third-person camera can go from a point along a direction before a block (solid props don't stop it). */
  private clearance(from: THREE.Vector3, dir: THREE.Vector3, max: number): number {
    // Blocks as they really are (a post, a slab, a fence where its bars are), and the camera kept a
    // little way off what it meets.
    const h = this.flightWorld?.hit(from.x, from.y, from.z, dir.x, dir.y, dir.z, max + CAMERA_MARGIN);
    return h ? Math.max(0, h.t - CAMERA_MARGIN) : max;
  }

  /** The game's client code starts: its kits' `setup`, then its own (the items' looks, its voices). */
  private startClient(me: PlayerFrame) {
    this.clientStarted = true;
    this.client.setup(this.meData(me));
  }

  /** The local player for the game's client code (`client.me`): as predicted and shown this frame. */
  private meOf(me: PlayerFrame, dt: number): Me {
    void dt;
    // Landing: how fast they were falling (the frame before).
    if (me.onGround && !this.wasGround) this.emit({ t: 'land', vy: this.lastVy });
    this.wasGround = me.onGround;
    this.lastVy = me.vy;
    return this.meData(me);
  }

  /** `client.me` from a player's frame (with the item kits' word on what they hold). */
  private meData(me: PlayerFrame): Me {
    return this.fillMe({
      id: this.playerId,
      position: { x: me.x, y: me.y, z: me.z },
      velocity: { x: me.vx, y: me.vy, z: me.vz },
      look: { yaw: this.view.yaw, pitch: this.view.pitch },
      onGround: me.onGround,
      flying: me.flying,
      crouching: me.sneaking,
      sprinting: me.sprinting,
      sliding: me.sliding,
      dead: me.dead,
      inVehicle: !!me.vehicle,
      health: me.health,
      maxHealth: me.maxHealth,
      bob: { phase: me.bob * Math.PI * 0.9, amount: this.settings.viewBobbing && me.onGround && !me.flying ? Math.min(1, Math.hypot(me.vx, me.vz) / 4.3) : 0 },
      thirdPerson: this.view.thirdPerson,
      walkSpeed: this.tune.params[0],
      hotbar: me.hotbar,
      // Their movement abilities' states as this screen predicts them (what `$ability` binds).
      abilities: (this.predictor?.abilities ?? me.move.abilities ?? {}) as Me['abilities'],
    }, me);
  }

  /**
   * `client.me` whole: what's in hand (and its state, as the host shows it), each kind's word
   * (`items`: its kit's `own` over the host's) and the held item as its kit has it (`held`). The
   * kits read the rest of `me` as it is this frame.
   */
  private fillMe(base: Omit<Me, 'hand' | 'held' | 'items'>, p: PlayerFrame): Me {
    const stack = p.hotbar?.slots[p.hotbar.selected] ?? null;
    const me: { -readonly [K in keyof Me]: Me[K] } = { ...base, hand: { item: stack?.item ?? null, count: stack?.count ?? 0, state: p.hand.state }, held: null, items: p.items ?? {} };
    if (!this.client) return me;
    this.client.me = me;
    me.items = this.client.kindItems(p.items);
    const def = stack ? this.content.items.get(stack.item) : undefined;
    const state = stack ? this.client.kindHeld(stack.item, def) : null;
    me.held = stack && state ? { item: stack.item, def, state } : null;
    return me;
  }
  /** On the ground last frame, and falling how fast (for `land`). */
  private wasGround = true;
  private lastVy = 0;

  /** The item in this player's hand, as the newest frame has it. */
  private heldDef(): ItemDefinition | undefined {
    const me = this.mine(this.frameData);
    const stack = me?.hotbar?.slots[me.hotbar.selected];
    return stack ? this.content.items.get(stack.item) : undefined;
  }

  /**
   * What the item kits did since the last controls sent goes with these ones (`PlayerInput.acts`,
   * by kind: a gun's shots, the throws; every kind this screen runs, even with nothing), and what
   * this screen is showing.
   */
  private withShots<T extends { acts?: Record<string, unknown[][]>; seen?: number }>(input: T): T {
    if (this.walker && this.itemMode) {
      const acts: Record<string, unknown[][]> = {};
      for (const kind of this.client.kinds) acts[kind] = this.acts[kind] ?? [];
      input.acts = acts;
      this.acts = {};
    }
    input.seen = this.shownT;
    return input;
  }

  /**
   * The item kits' turn at the controls this frame (`ClientKit.controls`), before they go: each
   * reads them (what one `consume`s reads idle to the next), turns the view, and sends actions of
   * its kind with them.
   */
  private kitControls(dt: number, active: boolean, dead: boolean) {
    const input = this.input;
    const view = this.view;
    const keys = new Set<string>();
    let buttons = 0;
    const acts = this.acts;
    this.client.kindControls(
      {
        active,
        dead,
        // What a shot or a throw goes along: where they look, or over the shoulder, at what the crosshair's on.
        get yaw() {
          return view.aim().yaw;
        },
        get pitch() {
          return view.aim().pitch;
        },
        isDown: (code) => active && input.isDown(code) && !keys.has(code),
        pressed: (code) => active && input.keyThisFrame(code) && !keys.has(code),
        button: (b) => active && input.button(b) && !(buttons & (1 << b)),
        clicked: (b) => active && input.clickedThisFrame(b) && !(buttons & (1 << b)),
        consume: (what) => {
          if (typeof what === 'number') buttons |= 1 << what;
          else keys.add(what);
        },
        act: () => {},
        turn: (dPitch, dYaw) => {
          view.pitch = Math.max(-Math.PI / 2 + 0.001, Math.min(Math.PI / 2 - 0.001, view.pitch + dPitch));
          view.yaw += dYaw;
        },
      },
      (kind, data) => (acts[kind] ??= []).push(data),
      dt,
    );
  }

  /**
   * `client.world.trace`: a bullet's path on this screen, as the host casts it: through the blocks
   * (foliage, and walls with `pen`), and to anyone drawn in the way (by the game's hitboxes).
   */
  private trace(o: Vec3, d: Vec3, range: number, pen: Penetration | null): ClientTrace {
    let { end, normal, block, walls } = bulletPath(this.chunks.world, this.registry, o, d, range, pen);
    let body: string | null = null;
    for (const p of this.frameData?.players ?? []) {
      if (p.id === this.playerId || p.dead || p.spectating) continue;
      const b = playerBoxes(p, p.sliding ? 2 : p.sneaking ? 1 : 0, this.hitscanRules, p.lean ? leanOffset(p.view.yaw, p.lean) : undefined);
      const t = Math.min(rayBox(o, d, b.body[0], b.body[1]) ?? Infinity, rayBox(o, d, b.head[0], b.head[1]) ?? Infinity);
      if (t < end) {
        end = t;
        normal = null;
        block = -1;
        body = p.id;
      }
    }
    walls = walls.filter((p) => p.at < end);
    return { point: { x: o.x + d.x * end, y: o.y + d.y * end, z: o.z + d.z * end }, normal, block, body, walls: walls.map((w) => ({ entry: w.entry, normal: w.normal, exit: w.exit, out: w.out, block: w.block })) };
  }

  /** `client.world.carvable`: a hit on `block` at `at` (its face `normal`) carves it (a world whose blocks carve, above its floor). */
  private carvable(block: number, at: Vec3, normal: Vec3 | null): boolean {
    const c = this.carving;
    if (!c || !c.ids[block]) return false;
    return Math.floor(at.y - (normal?.y ?? 0) * 1e-3) > c.above;
  }

  /**
   * What the game's widgets can bind from this screen's own state (`{{$gun.mag}}`, `{{$health}}`):
   * the held gun as this screen fires and reloads it, the movement abilities as it predicts them,
   * health and stance as the newest frame (and prediction) have them. No round trip: a widget
   * bound to `$gun.mag` changes on the frame the shot goes off.
   */
  private localState(me: PlayerFrame): PlainData {
    const abilities = plainRecord(this.predictor?.abilities ?? me.move.abilities ?? {});
    // The kits' own (`client.hud.bind`: a gun kit's `$gun`), and the platform's.
    const bound: PlainData = {};
    for (const [name, v] of Object.entries(this.clientHud.bound)) bound[`$${name}`] = v as PlainData[string];
    return {
      ...bound,
      $ability: abilities,
      $health: me.health,
      $maxHealth: me.maxHealth,
      $dead: me.dead,
      $crouching: me.sneaking,
      $sliding: me.sliding,
      $sprinting: me.sprinting,
    };
  }

  /** Render, HUD, debug overlay, end of input frame. */
  private present(dt: number, t0: number) {
    const medium = this.camera.position.y < 256 ? this.eyeMedium() : 'air';
    this.hud.setMedium(medium);
    this.renderer.render(this.camera, this.env, this.hooks, medium === 'water' ? 1 : medium === 'lava' ? 2 : 0);
    this.gameHud.update(dt, this.camera, window.innerWidth, window.innerHeight);
    const cpu = performance.now() - t0;
    this.devTools.tick(dt, cpu);
    this.input.endFrame();
  }

  private eyeMedium(): 'air' | 'water' | 'lava' {
    const p = this.camera.position;
    const w = this.chunks.world;
    const id = w.get_block(Math.floor(p.x), Math.floor(p.y), Math.floor(p.z));
    const name = this.registry.blocks[id]?.name;
    if (name === 'water') {
      const above = this.registry.blocks[w.get_block(Math.floor(p.x), Math.floor(p.y) + 1, Math.floor(p.z))]?.name;
      if (above === 'water' || p.y - Math.floor(p.y) < 0.875) return 'water';
    }
    if (name === 'lava') return 'lava';
    return 'air';
  }

  // ---------------------------------------------------------------------------------------------
  // Development hooks (automated browser tests)
  // ---------------------------------------------------------------------------------------------

  /** Join and play without the pointer lock a click would take (tests; with `debugActive`). */
  debugPlay() {
    this.beginPlay();
  }

  /** `await __game.dev('game.players.length')`: development code run in this game's room on its server (see `DevTools.dev`). */
  dev(js: string): Promise<unknown> {
    return this.devTools.dev(js);
  }

  /** The first-person view (tests steer it through `yaw` / `pitch`). */
  get controller(): PlayerCamera {
    return this.view;
  }

  /** The replay playing on this screen, if one is (tests watch its `time`). */
  get replay(): ReplayPlayback | null {
    return this.replays.playback;
  }

  /** What's on screen: the game, the mode, whether the world's ready, this player's state, chunk and render stats. */
  debugInfo() {
    return this.devTools.info();
  }

  debugView(yaw: number, pitch: number) {
    this.view.yaw = yaw;
    this.view.pitch = pitch;
  }

  debugSetTime(t: number) {
    this.link.send({ t: 'env', time: t });
  }

  debugToggle(key: string) {
    this.onKey(key);
  }

  debugInput(): Input {
    return this.input;
  }
}
