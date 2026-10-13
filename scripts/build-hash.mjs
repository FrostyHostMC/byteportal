// A short hash of what a deploy would ship: the deploy scripts tag each release with it, and skip
// a deploy (`--if-changed`) when the live release already carries the same one. Source maps are
// left out: they differ from build to build (absolute paths) while the code doesn't.
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

/** Hashes these files and folders (their paths and contents, in a fixed order). */
export function buildHash(paths) {
  const hash = createHash('sha256');
  const add = (path) => {
    if (statSync(path).isDirectory()) {
      for (const name of readdirSync(path).sort()) add(join(path, name));
    } else if (!path.endsWith('.map')) {
      hash.update(`${path}\0`).update(readFileSync(path)).update('\0');
    }
  };
  for (const path of paths) add(path);
  return hash.digest('hex').slice(0, 16);
}
