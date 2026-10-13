import { h } from './dom';
import { DEFAULT_KEYS, actionLabel, moveLabel, relabel, type KeyBindings, type KeyDefaults } from '../player/keys';

/** A game's controls, as the home page and the pause menu show them. */
export interface GameControls {
  /** Its hints (`GameMeta.controls`), written for its own keys. */
  controls?: [string, string][];
  /** The same on a controller (shown instead while one is in use). */
  pad?: [string, string][];
  /** The touch controls' hints (player/touch.ts), shown on a touch screen. */
  touch?: [string, string][];
  /** Players walk (the movement keys and jump come first). */
  walks?: boolean;
  /** The player's key bindings and the game's own keys, so the hints name the keys they actually press. */
  keys?: { bound: KeyBindings; game: KeyDefaults };
}

/**
 * The keyboard's hints: moving and jumping (a walking game: unless the game's own hints name those
 * keys), then the game's own, each with its keys as bound.
 */
export function keyHints(c: GameControls): [string, string][] {
  const { bound, game } = c.keys ?? { bound: {}, game: DEFAULT_KEYS };
  const own = c.controls ?? [['LMB', 'break'], ['RMB', 'place'], ['E', 'blocks']];
  // The game's own hints for the movement keys or jump's key (Space shoots, say) go in their place.
  const named = new Set(own.flatMap(([k]) => k.split(/[\s/,·+]+/)));
  const moves: [string, string][] = (c.walks ?? true) ? ([[moveLabel({}, game), moveLabel(bound, game), 'move'], [actionLabel({}, game, 'jump'), actionLabel(bound, game, 'jump'), 'jump']] as const).filter(([plain]) => !named.has(plain)).map(([, k, v]): [string, string] => [k, v]) : [];
  return [...moves, ...own.map(([k, v]): [string, string] => [relabel(bound, game, k), v])];
}

/** A key (or keys: 'W / S', 'Space ×2') as caps: each key its own cap, the words between as they are. */
export function caps(keys: string): HTMLElement {
  const out = h('span.caps');
  for (const part of keys.split(/(\s*\/\s*|\s+or\s+)/)) {
    if (!part) continue;
    if (/^\s*(\/|or)\s*$/.test(part)) out.append(h('span.caps-sep', {}, part.trim()));
    else out.append(h('kbd', {}, part));
  }
  return out;
}

/** Hints as a two-column list: the keys, then what they do. */
export function hintTable(hints: [string, string][]): HTMLElement {
  return h('div.hint-table', {}, ...hints.flatMap(([k, v]) => [h('div.hint-keys', {}, caps(k)), h('div.hint-what', {}, v)]));
}

/** Hints in a line (wrapping): a cap and what it does, each. */
export function hintChips(hints: [string, string][]): HTMLElement[] {
  return hints.map(([k, v]) => h('span.hint-chip', {}, caps(k), h('span', {}, v)));
}
