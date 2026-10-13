import { isGun } from '@platform/items';
import type { Client, ClientKit } from '@platform/client';
import { el } from './dom';
import { GUNNER_CSS } from './gunner.css';

const DEG = Math.PI / 180;

/** What the rounds panel shows. */
interface Rounds {
  mag: number;
  reserve: number;
  size: number;
  name: string;
  reloading: boolean;
}

/**
 * The held gun on the HUD, from `client.me.held` (as this screen fires and reloads it):
 * - the rounds (bottom right): the magazine big, the spare beside it, a pip per round, and
 *   RELOADING, NO AMMO, or RELOAD once a quarter or less is left;
 * - the crosshair in the plain one's place: four ticks that open up with the spread, gone while
 *   aiming down the sights;
 * - a red dot's or a holo's reticle glowing at the aim point as the sight comes to the eye, and a
 *   scope's view filling the screen when aimed through one.
 *
 * In a replay through someone's eyes (`client.replay`) the crosshair, reticle and scope are
 * theirs; the rounds panel stays hidden.
 */
export function gunner(): ClientKit {
  let unstyle: (() => void) | null = null;
  let rounds: HTMLElement;
  let roundsKey = '';
  let cross: HTMLElement;
  let scope: HTMLElement;
  let reticle: HTMLElement;
  let reticleKey = '';

  /** The rounds panel; null hides it. */
  const showRounds = (a: Rounds | null) => {
    const key = a ? `${a.mag}|${a.reserve}|${a.size}|${a.name}|${a.reloading}` : '';
    if (key === roundsKey) return;
    const prev = roundsKey.split('|');
    roundsKey = key;
    rounds.style.display = a ? '' : 'none';
    if (!a) return;
    // One pip per round in the magazine (up to a drum's worth), spent ones hollow.
    const pips = Math.min(a.size, 40);
    const bullets = el('div.ammo-pips');
    for (let i = 0; i < pips; i++) bullets.append(el(`span.ammo-pip${i < Math.round((a.mag / a.size) * pips) ? '' : '.spent'}`));
    const note = a.reloading ? el('div.ammo-reload', 'RELOADING') : a.mag === 0 && a.reserve === 0 ? el('div.ammo-reload.out', 'NO AMMO') : a.mag <= Math.ceil(a.size * 0.25) ? el('div.ammo-reload.low', 'RELOAD') : null;
    rounds.replaceChildren(
      ...[el('div.ammo-name', a.name), el('div.ammo-count', el('span.ammo-mag', String(a.mag)), el('span.ammo-sep', '/'), el('span.ammo-reserve', String(a.reserve))), bullets, note].filter((x): x is HTMLElement => x !== null),
    );
    rounds.classList.toggle('low', a.mag <= Math.ceil(a.size * 0.25));
    if (prev[0] !== undefined && Number(prev[0]) > a.mag) {
      rounds.classList.remove('fired');
      void rounds.offsetWidth;
      rounds.classList.add('fired');
    }
  };

  /** The crosshair `gap` pixels from the middle (the spread), or null for the plain one; hidden while aiming down the sights. */
  const showCross = (client: Client, gap: number | null, aiming = false) => {
    if (gap !== null) cross.style.setProperty('--gap', `${Math.round(gap)}px`);
    cross.classList.toggle('aiming', aiming);
    client.hud.crosshair.replace(gap !== null ? cross : null);
  };

  /** Looking through a scope. */
  const showScope = (on: boolean) => {
    const v = on ? '' : 'none';
    if (scope.style.display !== v) scope.style.display = v;
  };

  /** A red dot (`dot`) or a holo's ring and dot (`holo`) at the aim point, `opacity` 0..1; null hides it. */
  const showReticle = (kind: 'dot' | 'holo' | null, opacity = 1, color = '#ff2a2a') => {
    const show = kind !== null && opacity > 0.01;
    const key = show ? `${kind}|${opacity.toFixed(2)}|${color}` : '';
    if (key === reticleKey) return;
    reticleKey = key;
    reticle.style.display = show ? '' : 'none';
    if (!show) return;
    reticle.className = `gun-reticle ${kind}`;
    reticle.style.opacity = opacity.toFixed(2);
    reticle.style.setProperty('--rc', color);
  };

  const hide = (client: Client) => {
    showRounds(null);
    showCross(client, null);
    showScope(false);
    showReticle(null);
  };

  return {
    name: 'hud.gunner',
    setup(client) {
      unstyle = client.hud.style(GUNNER_CSS);
      // Seen through the sight (under the crosshair): the scope's view, then the reticle.
      const lens = client.hud.layer('gunner.sight', 'lens');
      scope = el('div.scope', el('div.scope-lens'));
      scope.style.display = 'none';
      reticle = el('div.gun-reticle', el('span.gun-reticle-ring'), el('span.gun-reticle-dot'));
      reticle.style.display = 'none';
      lens.append(scope, reticle);
      cross = el('div.gun-cross', el('span.gc-t'), el('span.gc-b'), el('span.gc-l'), el('span.gc-r'), el('span.gc-dot'));
      cross.style.display = 'none';
      client.hud.layer('gunner.cross', 'middle').append(cross);
      rounds = el('div.ammo');
      rounds.style.display = 'none';
      client.hud.layer('gunner.rounds').append(rounds);
    },
    frame(client) {
      if (client.events.some((e) => e.t === 'reset')) showRounds(null);
      const me = client.me;
      const held = me.held;
      const def = isGun(held?.def) ? held!.def : null;
      const st = held?.state as { mag?: number; reserve?: number; reload?: number; aim?: number; spread?: number; sight?: string; color?: string } | undefined;
      // (Nor while client code has the camera: a cutscene, a replay's title.)
      if (!def || !st || typeof st.mag !== 'number' || me.dead || me.inVehicle || client.camera.taken) return hide(client);
      const aim = st.aim ?? 0;
      // In a replay (someone else's eyes: `client.replay`), what they aimed through shows, not their rounds.
      showRounds(client.replay?.playing ? null : { mag: st.mag, reserve: st.reserve ?? 0, size: def.magazine, name: def.name, reloading: (st.reload ?? -1) >= 0 });
      const focal = window.innerHeight / 2 / Math.tan((client.camera.fov * DEG) / 2);
      showCross(client, Math.tan((st.spread ?? 0) * DEG) * focal + 5, aim > 0.55);
      showScope(st.sight === 'scope' && aim > 0.9);
      // An optic's reticle lights up as the window comes to the eye.
      const optic = st.sight === 'dot' || st.sight === 'holo' ? st.sight : null;
      showReticle(optic, Math.max(0, Math.min(1, (aim - 0.75) / 0.2)), st.color);
    },
    dispose() {
      unstyle?.();
    },
  };
}
