import type { FeedPart, HudTheme, IconRef, MarkerOptions, Vec3 } from '../types';

/**
 * Where a HUD layer stacks, from the bottom:
 * - `lens`: straight over the world, under the crosshair and everything else (a sight's glow, a
 *   scope's view: what's seen through something);
 * - `middle`: with the crosshair, over the lens, under the hotbar and the panels;
 * - `panels`: with the HUD's panels (health, the feed), under the game's widgets and the
 *   scoreboard (the default).
 */
export type HudPlace = 'lens' | 'middle' | 'panels';

/** The crosshair in the middle of the screen. */
export interface HudCrosshair {
  /** The game shows a crosshair (its server's `hud.crosshair(visible)`; default true). */
  readonly wanted: boolean;
  /**
   * Show `el` (an element in one of the kit's layers) in the plain cross's place: the HUD hides
   * the plain one and shows `el` whenever the game wants a crosshair. Null puts the plain one back.
   */
  replace(el: HTMLElement | null): void;
}

/**
 * The HUD, for a game's client code and kits (see `hud.gunner()`, `hud.throwables()`).
 * Layers are plain DOM: client code is bundled with the game and trusted, so it builds its own
 * elements (what the server sends stays sanitized). The widget calls are the server's `hud.*`,
 * on this screen only.
 */
export interface ClientHud {
  /**
   * A layer of the HUD for client code's own elements, made the first time it's named (and the
   * same one after). It covers the screen and passes the mouse through; layers at one place stack
   * in the order they were made.
   */
  layer(name: string, place?: HudPlace): HTMLElement;
  /**
   * A stylesheet for what the layers show. It goes under the game's HUD theme (`hud.theme.css`
   * restyles a kit's elements as it does the platform's). Returns a function that takes it out.
   */
  style(css: string): () => void;
  readonly crosshair: HudCrosshair;
  /** An icon (a sprite, a block, a picture of a model) as an image: blank until it's ready, filled in then. */
  icon(ref: IconRef): HTMLImageElement;
  /** The game's HUD theme (`hud.theme`), if it has one. */
  readonly theme: HudTheme | undefined;
  /** The ring round the crosshair, `fraction` full (null hides it). */
  progress(fraction: number | null, opts?: { color?: string }): void;
  /** A marker on something in the world (null removes it). */
  marker(id: string, at: Vec3 | null, opts?: MarkerOptions): void;
  banner(title: string, subtitle?: string, opts?: { duration?: number; color?: string }): void;
  toast(text: string): void;
  pop(text: string, opts?: { color?: string; big?: boolean; sub?: string }): void;
  feed(text: string | FeedPart[], opts?: { color?: string }): void;
  /**
   * A value of this screen's that the game's widgets bind as `$name` (`{{$gun.mag}}`,
   * `data-if="$gun.reloading"`): the local player's own, as a kit has it this frame (null: none).
   */
  bind(name: string, value: Record<string, unknown> | null): void;
}
