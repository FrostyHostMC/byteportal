// Built games on a player's screen (see package/build.ts): games the page wasn't built with,
// which the game server hosts. `GET /g/<id>` says what to load; the page hands the game the
// platform modules it imports (each loaded only when a game needs it), then imports its client
// code from the game server.
import type { ClientGame, GameEntry } from '../api/client';
import { GLOBAL, packagePath, type PackageEntry, type PlatformLink, type PlatformModule } from '../package/link';
import workerLink from './worker-link?worker&url';

/** The public API a screen can hand a game, each loaded when first asked for. */
const MODULES: Partial<Record<PlatformModule, () => Promise<unknown>>> = {
  '@platform': () => import('../index'),
  '@platform/art': () => import('../art/index'),
  '@platform/items': () => import('../items/index'),
  '@platform/client': () => import('../api/client'),
  '@platform/client/kits': () => import('../client-kits/index'),
  '@platform/client/math': () => import('../api/client/math'),
};

/** The game server's web address for its socket's (`wss://play.blockyard.gg/cob` → `https://play.blockyard.gg`). */
export function webOrigin(socket: string): string {
  const url = new URL(socket);
  url.protocol = url.protocol === 'wss:' ? 'https:' : 'http:';
  return url.origin;
}

/**
 * The built game `id` on the game server at `origin` (its web address), as a catalog entry (its
 * current version); null if it hosts no such built game.
 */
export async function packagedEntry(origin: string, id: string): Promise<GameEntry | null> {
  const res = await fetch(origin + packagePath.entry(id));
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`The game server couldn't say what "${id}" is (${res.status})`);
  return entryOf((await res.json()) as PackageEntry);
}

/** The version of a built game a catalog entry loads (undefined: a game compiled into the page). */
export function packagedVersion(entry: GameEntry | null | undefined): string | undefined {
  return entry ? versions.get(entry) : undefined;
}
const versions = new WeakMap<GameEntry, string>();

/** A catalog entry that loads one version of a built game. */
export function entryOf(entry: PackageEntry): GameEntry {
  const meta = { ...entry.meta, id: entry.id };
  const out: GameEntry = {
    meta,
    async load(): Promise<ClientGame> {
      await link(entry.modules);
      const mod = (await import(/* @vite-ignore */ entry.client)) as { default?: ClientGame };
      const game = mod.default;
      if (!game?.shared || !game.client) throw new Error(`${entry.id}: client.ts must export its game by default (\`export default defineClient(shared, { … })\`)`);
      // Under the id it's hosted by (the server's), whatever its meta says.
      return game.shared.id === entry.id ? game : { ...game, shared: { ...game.shared, id: entry.id } };
    },
  };
  versions.set(out, entry.version);
  return out;
}

/** Hand built games the modules they import. */
async function link(modules: PlatformModule[]) {
  const g = globalThis as unknown as Record<string, PlatformLink | undefined>;
  const at = (g[GLOBAL] ??= {
    modules: {},
    // Screens name a game's files by its client code's address, not through the platform.
    asset: () => {
      throw new Error('a screen has no asset addresses');
    },
    worker: startGameWorker,
  });
  await Promise.all(
    modules.map(async (name) => {
      if (at.modules[name]) return;
      const load = MODULES[name];
      if (!load) throw new Error(`a game's client code can't use ${name}`);
      at.modules[name] = await load();
    }),
  );
}

/**
 * Start a built game's Web Worker (its code at `url`, on the game server). A page may start only
 * workers of its own address, so it starts one from a script of its own, which imports the
 * platform's worker link (the public API in there) and then the game's worker code (the game
 * server allows that: CORS).
 */
function startGameWorker(url: string, options?: WorkerOptions): Worker {
  const script = `import ${JSON.stringify(new URL(workerLink, location.href).href)};\nimport ${JSON.stringify(url)};\n`;
  // In a sandboxed frame (an uploaded game's screen: an opaque origin) only a `data:` worker starts.
  if (self.origin === 'null') return new Worker(`data:text/javascript,${encodeURIComponent(script)}`, { ...options, type: 'module' });
  const src = URL.createObjectURL(new Blob([script], { type: 'text/javascript' }));
  const worker = new Worker(src, { ...options, type: 'module' });
  // The worker has fetched its script once it's said anything (or failed): the address can go.
  const free = () => URL.revokeObjectURL(src);
  worker.addEventListener('message', free, { once: true });
  worker.addEventListener('error', free, { once: true });
  return worker;
}
