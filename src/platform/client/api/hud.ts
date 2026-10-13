import type { ClientHud, HudCrosshair, HudPlace } from '../../api/client/hud';
import type { HudTheme, IconRef } from '../../api/types';
import type { Hud } from '../../ui/hud';
import type { GameHud } from '../../ui/hudkit';

/**
 * `client.hud`: layers of client code's own at their places in the HUD, stylesheets under the
 * game's theme, the crosshair, icons, and the widget calls on this screen.
 */
export class ClientHudService implements ClientHud {
  private sheets = new Set<HTMLStyleElement>();
  readonly crosshair: HudCrosshair;

  constructor(
    private base: Hud,
    private game: GameHud,
    readonly theme: HudTheme | undefined,
  ) {
    this.crosshair = {
      get wanted() {
        return base.crosshairWanted;
      },
      replace: (el) => base.replaceCrosshair(el),
    };
  }

  layer(name: string, place: HudPlace = 'panels'): HTMLElement {
    return place === 'panels' ? this.game.layer(name) : this.base.layer(name, place);
  }

  style(css: string): () => void {
    const sheet = document.createElement('style');
    sheet.dataset.hudKit = '';
    sheet.textContent = css;
    // Under the game's theme (it restyles what client code draws, as it does the platform's).
    const theme = document.head.querySelector('style[data-hud-theme]');
    if (theme) document.head.insertBefore(sheet, theme);
    else document.head.append(sheet);
    this.sheets.add(sheet);
    return () => {
      sheet.remove();
      this.sheets.delete(sheet);
    };
  }

  icon(ref: IconRef): HTMLImageElement {
    return this.game.icon('img', ref);
  }

  progress(fraction: number | null, opts?: { color?: string }) {
    this.game.progress(fraction, opts);
  }

  marker(id: string, at: Parameters<ClientHud['marker']>[1], opts?: Parameters<ClientHud['marker']>[2]) {
    this.game.marker(id, at && { x: at.x, y: at.y, z: at.z }, opts);
  }

  banner(title: string, subtitle?: string, opts?: { duration?: number; color?: string }) {
    this.game.banner(title, subtitle, opts);
  }

  toast(text: string) {
    this.game.toast(text);
  }

  pop(text: string, opts?: { color?: string; big?: boolean; sub?: string }) {
    this.game.pop(text, opts);
  }

  feed(text: Parameters<ClientHud['feed']>[0], opts?: { color?: string }) {
    this.game.feed(text, opts);
  }

  /** This screen's values for widgets' `$` names, by name (`bind`): the runtime puts them with its own. */
  readonly bound: Record<string, Record<string, unknown> | null> = {};

  bind(name: string, value: Record<string, unknown> | null) {
    this.bound[name] = value;
  }

  /** The game's over on this screen: its stylesheets go (its layers go with the HUD). */
  dispose() {
    for (const s of this.sheets) s.remove();
    this.sheets.clear();
  }
}
