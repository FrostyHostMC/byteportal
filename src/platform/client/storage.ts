// What this page keeps for next time (settings, auto quality): `localStorage`, or in a sandboxed
// frame (an uploaded game's screen, which has no storage of its own: see client/frame.ts) what the
// page around it gave, each change sent back for it to keep.

export interface Keeping {
  get(key: string): string | null;
  set(key: string, value: string): void;
}

const local: Keeping = {
  get: (key) => {
    try {
      return localStorage.getItem(key);
    } catch {
      return null;
    }
  },
  set: (key, value) => {
    try {
      localStorage.setItem(key, value);
    } catch {
      // Storage unavailable (private mode, quota): not kept.
    }
  },
};

let keeping: Keeping = local;

/** What the page keeps. */
export const kept: Keeping = {
  get: (key) => keeping.get(key),
  set: (key, value) => keeping.set(key, value),
};

/** Keep things somewhere else (a sandboxed frame: with the page around it). */
export function keepWith(k: Keeping) {
  keeping = k;
}

/**
 * Start a module Web Worker from its script's address (`url`), wherever this page is: by address
 * in a page of the site's own; in a sandboxed frame (an opaque origin, where a worker by address
 * or from a `blob:` is refused) from a `data:` URL that imports it.
 */
export function startWorker(url: string, options: WorkerOptions = {}): Worker {
  const href = new URL(url, location.href).href;
  if (self.origin !== 'null') return new Worker(href, { ...options, type: 'module' });
  return new Worker(`data:text/javascript,${encodeURIComponent(`import ${JSON.stringify(href)};`)}`, { ...options, type: 'module' });
}
