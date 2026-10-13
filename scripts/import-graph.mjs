// The source's import graph, for the boundary and bundle checks: which file imports which,
// resolved the way Vite resolves them (relative paths, the @platform / @engine aliases).
//
// Each edge says whether it's type-only (`import type`, `export type ... from`), which TypeScript
// erases: those never put code in a bundle. Packages (`three`, `node:fs`) are nodes named
// `pkg:<name>`; nothing is followed into them.
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { basename, dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

/** This project's root. */
export const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** The aliases in vite.config.ts and tsconfig.json. */
const ALIASES = [
  [/^@platform\/art$/, 'src/platform/art/index.ts'],
  [/^@platform\/kits$/, 'src/platform/kits/index.ts'],
  [/^@platform\/items$/, 'src/platform/items/index.ts'],
  [/^@platform\/client\/kits$/, 'src/platform/client-kits/index.ts'],
  [/^@platform\/client\/math$/, 'src/platform/api/client/math.ts'],
  [/^@platform\/client$/, 'src/platform/api/client.ts'],
  [/^@platform$/, 'src/platform/index.ts'],
  [/^@engine\/(.*)$/, 'engine/pkg/$1'],
];

/** Every source file under `dir` (TypeScript and JavaScript). */
export function sourceFiles(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? sourceFiles(p) : /\.(ts|tsx|js|mjs)$/.test(f) ? [p] : [];
  });
}

/** The code without its comments (so examples in doc comments aren't imports). */
const code = (file) =>
  readFileSync(file, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');

/**
 * What a file imports: `{ spec, type, dynamic }` for each static import or re-export (`type`:
 * erased by TypeScript), dynamic `import()` (`dynamic`: loaded when it's called), and
 * `new URL('./x.ts', import.meta.url)` (a worker's entry).
 */
export function importsOf(file) {
  const src = code(file);
  const out = [];
  for (const m of src.matchAll(/\b(import|export)\s+(type\s+)?(?:[\w$*{}\s,]*?\bfrom\s*)?['"]([^'"\n]+)['"]/g)) out.push({ spec: m[3], type: !!m[2], dynamic: false });
  for (const m of src.matchAll(/\bimport\s*\(\s*['"]([^'"\n]+)['"]\s*\)/g)) out.push({ spec: m[1], type: false, dynamic: true });
  for (const m of src.matchAll(/new\s+URL\s*\(\s*['"]([^'"\n]+)['"]\s*,\s*import\.meta\.url\s*\)/g)) out.push({ spec: m[1], type: false, dynamic: false });
  return out;
}

const EXTS = ['', '.ts', '.tsx', '.js', '.mjs', '/index.ts', '/index.js'];

function asFile(p) {
  for (const e of EXTS) {
    const f = p + e;
    if (existsSync(f) && statSync(f).isFile()) return f;
  }
  // TypeScript's convention: `./x.js` names `./x.ts`.
  if (p.endsWith('.js') && existsSync(p.slice(0, -3) + '.ts')) return p.slice(0, -3) + '.ts';
  return null;
}

/** Whether `file` is `dir` or inside it. */
export function under(file, dir) {
  return file === dir || file.startsWith(dir + sep);
}

/**
 * Which part of a game a file in its folder (`dir`) is: `server`, `client` (its `client.ts`, or
 * anything in a `client/` folder), `shared` or `meta`; null for its other files (helpers). The
 * parts are at the top of the folder (`server.ts`); a preview sharing the folder names its own
 * with a prefix, anywhere in it (`previews/shipyard.server.ts`). (A helper deeper in, like
 * `art/shared.ts`, is a helper.)
 */
export function role(file, dir) {
  const path = relative(dir, file).split(sep);
  const name = basename(file);
  const is = (part) => (path.length === 1 && name === `${part}.ts`) || name.endsWith(`.${part}.ts`);
  if (is('server')) return 'server';
  if (is('client') || path.slice(0, -1).includes('client')) return 'client';
  if (is('shared')) return 'shared';
  if (is('meta')) return 'meta';
  return null;
}

/** The import graph over a project's files, built as they're asked for (and cached). */
export class ImportGraph {
  #edges = new Map();

  constructor(root = projectRoot) {
    this.root = root;
  }

  /**
   * Where an import leads: an absolute file path, or `pkg:<name>` for a package or Node built-in.
   * A query (`?raw`, `?url`) is dropped: the file is the node.
   */
  resolve(from, spec) {
    const bare = spec.replace(/[?#].*$/, '');
    for (const [re, to] of ALIASES) {
      if (re.test(bare)) {
        const p = join(this.root, bare.replace(re, to));
        return asFile(p) ?? p;
      }
    }
    if (bare.startsWith('.') || bare.startsWith('/')) {
      const p = bare.startsWith('/') ? join(this.root, bare) : resolve(dirname(from), bare);
      return asFile(p) ?? p;
    }
    const pkg = bare.startsWith('node:') ? bare : bare.startsWith('@') ? bare.split('/').slice(0, 2).join('/') : bare.split('/')[0];
    return `pkg:${pkg}`;
  }

  /** A file's imports, resolved: `{ spec, to, type, dynamic }`. */
  edges(file) {
    let e = this.#edges.get(file);
    if (!e) {
      e = existsSync(file) && /\.(ts|tsx|js|mjs)$/.test(file) ? importsOf(file).map((i) => ({ ...i, to: this.resolve(file, i.spec) })) : [];
      this.#edges.set(file, e);
    }
    return e;
  }

  /**
   * Everything reachable from `entries` (included), following runtime imports (and type-only ones
   * with `types`; not dynamic ones with `dynamic: false`). `within(file)`: only follow imports out
   * of files it accepts (the rest are reached, not entered). Returns a map from each file to the
   * file it was first reached from (entries: null), so a path can be told (`path`).
   */
  reach(entries, { types = false, dynamic = true, within = () => true } = {}) {
    const via = new Map();
    const queue = [];
    for (const e of entries) {
      if (via.has(e)) continue;
      via.set(e, null);
      queue.push(e);
    }
    while (queue.length) {
      const f = queue.shift();
      if (f.startsWith('pkg:') || !within(f)) continue;
      for (const { to, type, dynamic: later } of this.edges(f)) {
        if ((type && !types) || (later && !dynamic)) continue;
        if (via.has(to)) continue;
        via.set(to, f);
        queue.push(to);
      }
    }
    return via;
  }

  /** A project-relative path (with forward slashes), or a package's name. */
  rel(file) {
    return file.startsWith('pkg:') ? file.slice(4) : relative(this.root, file).split(sep).join('/');
  }

  /** The chain of imports by which `file` was reached (from `reach`'s map). */
  path(via, file) {
    const chain = [];
    for (let f = file; f; f = via.get(f)) chain.unshift(this.rel(f));
    return chain.join(' -> ');
  }
}
