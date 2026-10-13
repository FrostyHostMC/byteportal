// A game's folder as a zip and back: the CLI zips one to upload it, the server unpacks an upload
// (host/library.ts). Unpacking is careful: no file outside the folder, no more than the limits.
import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
import { unzipSync, zipSync, type Zippable } from 'fflate';

/** The most an upload may hold. */
export const ZIP_LIMITS = { files: 4000, bytes: 200 * 1024 * 1024 };

/** What's never part of a game (a `/`-separated path in its folder): hidden files and folders (`.git`, `.DS_Store`), packages, macOS's zip leftovers. */
export const skipped = (path: string) => path.split('/').some((part) => part.startsWith('.') || part === 'node_modules' || part === '__MACOSX');

/** A folder's files as a zip (what `npm run game -- push` uploads). */
export function zipFolder(folder: string): Uint8Array {
  const files: Zippable = {};
  let count = 0;
  let bytes = 0;
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const file = join(dir, name);
      const path = relative(folder, file).split(sep).join('/');
      if (skipped(path)) continue;
      const stat = statSync(file);
      if (stat.isDirectory()) walk(file);
      else if (stat.isFile()) {
        if (++count > ZIP_LIMITS.files || (bytes += stat.size) > ZIP_LIMITS.bytes) throw new Error(`${folder} is too big to upload (${ZIP_LIMITS.files} files, ${ZIP_LIMITS.bytes / 1024 / 1024} MB at most)`);
        files[path] = readFileSync(file);
      }
    }
  };
  walk(folder);
  return zipSync(files, { level: 6 });
}

/**
 * Unpack an uploaded zip into `dest`, and say where the game is in it: the folder with `meta.ts`
 * (the zip's top, or the one folder a zip of a folder has). Throws on anything amiss.
 */
export function unzipGame(zip: Uint8Array, dest: string): string {
  let count = 0;
  let declared = 0;
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(zip, {
      filter: (f) => {
        if (++count > ZIP_LIMITS.files) throw new Error(`more than ${ZIP_LIMITS.files} files`);
        if ((declared += f.originalSize) > ZIP_LIMITS.bytes) throw new Error(`more than ${ZIP_LIMITS.bytes / 1024 / 1024} MB unpacked`);
        return !f.name.endsWith('/');
      },
    });
  } catch (err) {
    throw new Error(`not a zip we can read: ${err instanceof Error ? err.message : String(err)}`);
  }
  let total = 0;
  const kept: string[] = [];
  for (const [raw, bytes] of Object.entries(files)) {
    const path = raw.replace(/\\/g, '/');
    if (path.startsWith('/') || /^[a-zA-Z]:/.test(path) || path.split('/').some((p) => p === '..' || p === '')) throw new Error(`"${raw}" isn't a path inside the zip`);
    if (skipped(path)) continue;
    if ((total += bytes.length) > ZIP_LIMITS.bytes) throw new Error(`more than ${ZIP_LIMITS.bytes / 1024 / 1024} MB unpacked`);
    const file = join(dest, ...path.split('/'));
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, bytes);
    kept.push(path);
  }
  // The game: the shallowest meta.ts.
  const metas = kept.filter((p) => p === 'meta.ts' || p.endsWith('/meta.ts')).sort((a, b) => a.split('/').length - b.split('/').length);
  if (!metas.length) throw new Error('no meta.ts in it (zip the game\'s folder: meta.ts, shared.ts, server.ts, client.ts…)');
  const depth = metas[0].split('/').length;
  if (metas.filter((p) => p.split('/').length === depth).length > 1) throw new Error(`more than one game in it (${metas.filter((p) => p.split('/').length === depth).join(', ')})`);
  return join(dest, ...metas[0].split('/').slice(0, -1));
}
