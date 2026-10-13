// Built games on the server (see package/build.ts): the platform's public API handed to them, a
// built version loaded as a `GameDefinition`, and the smoke test a build must pass.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import * as art from '../art/index';
import * as platform from '../index';
import * as items from '../items/index';
import * as kits from '../kits/index';
import type { GameDefinition, GameMeta } from '../api/types';
import type { PlayerInput } from '../net/protocol';
import { GLOBAL, nativeImport, packagePath, type PackageManifest, type PlatformLink } from '../package/link';
import { RoomCore } from './room';

/**
 * Hand built games this thread's platform (once per thread; a room's worker, the server's main
 * thread). `publicUrl` is the game server's address as players reach it (`https://play.blockyard.gg`):
 * the files a game's server code names by URL (models, props) are served there.
 */
export function linkServer(publicUrl: string) {
  const g = globalThis as unknown as Record<string, PlatformLink | undefined>;
  const base = publicUrl.replace(/\/+$/, '');
  g[GLOBAL] = {
    modules: { '@platform': platform, '@platform/art': art, '@platform/kits': kits, '@platform/items': items },
    asset: (game, path) => base + packagePath.asset(game, path),
  };
}

/** A built version's manifest (`<dir>/game.json`). */
export function readManifest(dir: string): PackageManifest {
  return JSON.parse(readFileSync(join(dir, 'game.json'), 'utf8')) as PackageManifest;
}

let imports = 0;

/**
 * The game a built version (its folder) defines, as its server code runs it. It's hosted under
 * its manifest's id (the packager may have given it another than its meta's). Its module-level
 * state is this thread's: each room's worker imports it afresh.
 */
export async function loadPackaged(dir: string, publicUrl: string, { fresh = false } = {}): Promise<GameDefinition> {
  linkServer(publicUrl);
  // Its errors name its own files and lines (blockyard://<id>/server.ts:12), from its source map.
  process.setSourceMapsEnabled(true);
  const manifest = readManifest(dir);
  // `fresh`: a module of its own (state, files' addresses), not the one this thread has cached.
  const url = pathToFileURL(join(dir, 'server.js')).href + (fresh ? `?fresh=${++imports}` : '');
  const mod = (await nativeImport(url)) as { default?: GameDefinition };
  const def = mod.default;
  if (!def || typeof def !== 'object' || typeof def.id !== 'string') throw new Error(`${manifest.id}: server.ts must export its game by default (\`export default defineServer(shared, { … })\`)`);
  return def.id === manifest.id ? def : { ...def, id: manifest.id };
}

/** The keys of a game's meta (`GameMeta`): what a screen gets of a built game before its code. */
const META_KEYS = ['id', 'title', 'tagline', 'accent', 'cover', 'controls', 'gamepad', 'touch', 'instances', 'achievements', 'cosmetics', 'cosmeticSlots'] as const satisfies readonly (keyof GameMeta)[];

/** A game's meta alone, as data (`GET /g/<id>`). */
export function metaOf(def: GameMeta): GameMeta {
  const out: Record<string, unknown> = {};
  for (const k of META_KEYS) if (def[k] !== undefined) out[k] = def[k];
  return out as unknown as GameMeta;
}

export interface SmokeResult {
  ok: boolean;
  /** What went wrong: errors thrown or logged by the game. */
  errors: string[];
  /** What happened, in a line. */
  summary: string;
  /** The game's meta, as its server code defines it (once it has loaded). */
  meta?: GameMeta;
}

/**
 * A built version's smoke test: its server code loads, a room starts, a player joins and plays
 * (walks, looks round, clicks) for `seconds` of game time, and nothing throws. It imports the
 * game afresh (a module of its own), though in this thread.
 */
export async function smokeTest(dir: string, wasm: BufferSource | WebAssembly.Module, { seconds = 10, publicUrl = 'http://localhost' } = {}): Promise<SmokeResult> {
  const errors: string[] = [];
  let def: GameDefinition;
  try {
    def = await loadPackaged(dir, publicUrl, { fresh: true });
  } catch (err) {
    return { ok: false, errors: [describe(err)], summary: 'its server code failed to load' };
  }
  let sent = 0;
  let core: RoomCore | undefined;
  try {
    core = new RoomCore(def, { game: def.id, instance: 'smoke', tickRate: 30, cheats: false, dev: false, seed: 1, saveEvery: 1e9 }, wasm, undefined, {
      send: () => sent++,
      counts: () => {},
      log: (line) => {
        if (line.startsWith('error:')) errors.push(line.slice(7));
      },
    });
    // Stepped here, as fast as it goes, rather than on the room's clock.
    const c = core as unknown as { timer: ReturnType<typeof setInterval>; step(dt: number): void };
    clearInterval(c.timer);
    core.connect('c1');
    core.command('c1', { t: 'start', name: 'Smoke' });
    const steps = Math.round(seconds * 30);
    for (let i = 0; i < steps && errors.length < 5; i++) {
      const t = i / 30;
      const input: PlayerInput = {
        active: true,
        down: i % 90 < 50 ? ['KeyW'] : i % 90 < 60 ? ['Space'] : [],
        pressed: i % 90 === 50 ? ['Space'] : [],
        buttons: i % 60 < 10 ? 1 : 0,
        clicked: i % 60 === 0 ? 1 : 0,
        mouseX: Math.sin(t) * 4,
        mouseY: Math.cos(t * 0.7),
        wheel: 0,
        yaw: 0,
        pitch: 0,
        viewSeq: -1,
      };
      core.command('c1', { t: 'input', input, seq: i + 1, dt: 1 / 30 });
      c.step(1 / 30);
    }
    core.disconnect('c1');
  } catch (err) {
    errors.push(describe(err));
  } finally {
    try {
      core?.stop();
    } catch (err) {
      errors.push(describe(err));
    }
  }
  if (!sent && !errors.length) errors.push('the room sent its player nothing');
  return { ok: errors.length === 0, errors, summary: `${def.id} ran ${seconds} s with a player (${sent} messages sent)`, meta: metaOf(def) };
}

/**
 * An error as a game's owners see it: its stack, its frames in the platform named by file only (no
 * paths of this machine's), a few of them.
 */
const describe = (err: unknown) => {
  const text = err instanceof Error ? (err.stack ?? err.message) : String(err);
  return text
    .replace(/\?fresh=\d+/g, '')
    .replace(/(?:file:\/\/)?(?<![:/\w])(?:\/[^\s/():]+)+\/([^\s/():]+)/g, '$1')
    .split('\n')
    .slice(0, 8)
    .join('\n');
};
