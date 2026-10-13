// Error tracking on a player's screen (host/errors.ts keeps it): what goes wrong here, uncaught,
// is reported to the game server, with the game and its version (the runtime keeps them up to
// date: `errorContext`). The site's page and an uploaded game's frame each report their own. A few
// of each a visit, never the same many times, and nothing from browser extensions.

/** What a report says about where: the game server to tell, and the game on screen. */
export const errorContext: { server: string | null; game: string | null; version: string | null } = { server: null, game: null, version: null };

/** The script this came from: which build of the site (its name is its contents' hash). */
const build = (() => {
  try {
    return new URL(import.meta.url).pathname.split('/').pop() ?? '';
  } catch {
    return '';
  }
})();

const sent = new Map<string, number>();
let total = 0;

/** Report uncaught errors and rejections from here on: `source` is this page's kind. */
export function reportErrors(source: 'page' | 'frame') {
  window.addEventListener('error', (e) => report(source, e.error ?? e.message));
  window.addEventListener('unhandledrejection', (e) => report(source, e.reason));
}

/** Report an error (one caught and carried on from, say). */
export function report(source: 'page' | 'frame', err: unknown) {
  const server = errorContext.server;
  if (!server) return;
  const message = err instanceof Error ? `${err.name}: ${err.message}` : String(err ?? 'Error');
  const stack = err instanceof Error ? (err.stack ?? '') : '';
  // Not ours: extensions, a script elsewhere with nothing to say, a known harmless browser warning.
  if (/chrome-extension:|moz-extension:|safari-extension:/.test(stack) || message === 'Script error.' || /ResizeObserver loop/.test(message)) return;
  const key = `${message}\n${stack.split('\n')[1] ?? ''}`;
  const times = sent.get(key) ?? 0;
  if (times >= 3 || total >= 30) return;
  sent.set(key, times + 1);
  total++;
  const body = JSON.stringify({ source, message, stack, game: errorContext.game, version: errorContext.version, url: location.href, build });
  // (Plain text: no preflight; kept alive if the page is going.)
  void fetch(`${server}/errors`, { method: 'POST', body, keepalive: true, headers: { 'Content-Type': 'text/plain' } }).catch(() => {});
}
