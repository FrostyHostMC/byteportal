import type { IconRef } from '@platform';
import type { Client, ClientKit } from '@platform/client';
import type { ThrowView } from '../items/throwable';
import { el } from './dom';
import { THROWABLES_CSS } from './throwables.css';

/** One throwable on the panel. */
interface Carried {
  icon: IconRef;
  count: number;
  key: string;
  cooking: boolean;
}

/**
 * Throwables on the HUD, from `client.me` (`quick`, `cooking`):
 * - bottom right, over the rounds: each one with a key of its own they carry, its picture, how
 *   many (less throws the server hasn't taken yet: it drops the moment one's thrown), its key,
 *   and a wiggle while it's being cooked;
 * - the fuse burning down round the crosshair while one's cooked, going red at the end.
 */
export function throwables(): ClientKit {
  let unstyle: (() => void) | null = null;
  let panel: HTMLElement;
  let panelKey = '';
  let fuseShown = false;

  /** The panel: a picture of each, how many, its key; one being cooked shows it. Null (or none) hides it. */
  const show = (client: Client, list: Carried[] | null) => {
    const key = list ? JSON.stringify(list) : '';
    if (key === panelKey) return;
    const was = panelKey ? (JSON.parse(panelKey) as { count: number }[]) : [];
    panelKey = key;
    panel.style.display = list?.length ? '' : 'none';
    if (!list?.length) return;
    panel.replaceChildren(
      ...list.map((t, i) => {
        const icon = client.hud.icon(t.icon);
        icon.classList.add('throwable-icon');
        const e = el(`div.throwable${t.count === 0 ? '.out' : ''}${t.cooking ? '.cooking' : ''}`, icon, el('span.throwable-count', `×${t.count}`), el('span.throwable-key', t.key));
        // One gone: a bump.
        if (was[i] && was[i].count > t.count) e.classList.add('spent');
        return e;
      }),
    );
  };

  return {
    name: 'hud.throwables',
    setup(client) {
      unstyle = client.hud.style(THROWABLES_CSS);
      panel = el('div.throwables');
      panel.style.display = 'none';
      client.hud.layer('throwables').append(panel);
    },
    frame(client) {
      if (client.events.some((e) => e.t === 'reset')) show(client, null);
      const me = client.me;
      // The throwable kit's word (`me.items.throwable`).
      const view = me.items.throwable as ThrowView | undefined;
      const quick = me.dead || me.inVehicle || !view ? [] : view.quick;
      const cooking = view?.cooking ?? null;
      show(
        client,
        // (Each one's icon as this screen has it: its look's, over the server's.)
        quick.map((q) => ({ icon: { item: q.item }, count: q.count, key: q.key.replace(/^Key|^Digit/, ''), cooking: cooking?.item === q.item })),
      );
      // The fuse, burning down round the crosshair while it's held.
      const burning = cooking && cooking.fuse > 0 ? 1 - cooking.held / cooking.fuse : null;
      if (burning !== null || fuseShown) client.hud.progress(burning === null ? null : Math.max(0, burning), { color: burning !== null && burning < 0.35 ? '#ff3b30' : '#ffd36b' });
      fuseShown = burning !== null;
    },
    dispose() {
      unstyle?.();
    },
  };
}
