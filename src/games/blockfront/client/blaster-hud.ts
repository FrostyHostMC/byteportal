import type { GunItem } from '@platform/items';
import type { Client, ClientKit } from '@platform/client';
import css from './blaster-hud.css?raw';

const DEG = Math.PI / 180;

/** Heat past this is running hot (the bar goes orange), past `HOT` about to overheat (red). */
const WARM = 0.6;
const HOT = 0.84;

/** An element from `'tag.class.class'` (a div if no tag), holding `children`. */
function el(spec: string, ...children: (Node | string)[]): HTMLElement {
  const [tag, ...classes] = spec.split('.');
  const e = document.createElement(tag || 'div');
  for (const c of classes) e.classList.add(c);
  e.append(...children);
  return e;
}

/** What the held blaster's state says (`client.me.held.state`). */
interface GunState {
  mag?: number;
  reload?: number;
  aim?: number;
  spread?: number;
  sight?: string;
  color?: string;
}

/**
 * The held blaster on the HUD, from `client.me.held` (as this screen fires and vents it). A
 * blaster's magazine is its heat (`weapons.ts`): shots left before it overheats. So instead of
 * rounds:
 *
 * - **Heat** (bottom right): the blaster's name and a bar filling as it heats (orange running hot,
 *   red about to overheat), OVERHEATED while it vents by itself, VENTING when R vents it early,
 *   the bar draining as it cools; and a thin arc of the same heat beside the crosshair.
 * - **The crosshair**: four ticks opening with the spread and a dot. Over the shoulder it always
 *   shows, tighter while aiming (the view there isn't down the sights); through the eyes it goes
 *   while aiming, and a red dot's or holo's reticle glows at the aim point as the sight comes up.
 * - **A scope's view** (the cycler) filling the screen when aimed, either way.
 *
 * In a replay through someone's eyes (`client.replay`) the crosshair and scope are theirs, the
 * heat hidden.
 */
export function blasterHud(): ClientKit {
  let unstyle: (() => void) | null = null;
  let panel: HTMLElement;
  let nameEl: HTMLElement;
  let noteEl: HTMLElement;
  let pctEl: HTMLElement;
  let cross: HTMLElement;
  let scope: HTMLElement;
  let reticle: HTMLElement;
  let reticleKey = '';
  let shown = '';
  /** The blaster whose heat shows, and what its last vent started from (heat 0..1, and why). */
  let item = '';
  let venting: { from: number; over: boolean } | null = null;
  let lastMag = -1;

  const setClass = (e: HTMLElement, cls: string, on: boolean) => {
    if (e.classList.contains(cls) !== on) e.classList.toggle(cls, on);
  };
  const setText = (e: HTMLElement, text: string) => {
    if (e.textContent !== text) e.textContent = text;
  };
  const setVar = (e: HTMLElement, name: string, value: string) => {
    if (e.style.getPropertyValue(name) !== value) e.style.setProperty(name, value);
  };

  /** The heat panel for the blaster in hand (null hides it). */
  const showHeat = (h: { name: string; heat: number; note: 'over' | 'vent' | null } | null) => {
    const key = h ? 'on' : '';
    if (key !== shown) {
      shown = key;
      panel.style.display = h ? '' : 'none';
    }
    if (!h) return;
    setText(nameEl, h.name);
    setVar(panel, '--heat', h.heat.toFixed(3));
    setVar(cross, '--heat', h.heat.toFixed(3));
    setText(pctEl, `${Math.round(h.heat * 100)}%`);
    setText(noteEl, h.note === 'over' ? 'OVERHEATED' : h.note === 'vent' ? 'VENTING' : h.heat >= HOT ? 'OVERHEATING' : '');
    for (const e of [panel, cross]) {
      setClass(e, 'warm', h.heat >= WARM && h.heat < HOT && !h.note);
      setClass(e, 'hot', h.heat >= HOT && !h.note);
      setClass(e, 'over', h.note === 'over');
      setClass(e, 'vent', h.note === 'vent');
    }
  };

  /** The crosshair `gap` pixels from the middle (the spread), or null for the plain one (no blaster in hand). */
  const showCross = (client: Client, gap: number | null, aiming: boolean) => {
    if (gap !== null) setVar(cross, '--gap', `${Math.round(gap)}px`);
    setClass(cross, 'aiming', aiming);
    client.hud.crosshair.replace(gap !== null ? cross : null);
  };

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
    reticle.className = `bf-reticle ${kind}`;
    reticle.style.opacity = opacity.toFixed(2);
    reticle.style.setProperty('--rc', color);
  };

  const hide = (client: Client) => {
    showHeat(null);
    showCross(client, null, false);
    showScope(false);
    showReticle(null);
  };

  return {
    name: 'blockfront.blasterHud',
    setup(client) {
      unstyle = client.hud.style(css);
      // Seen through the sight (under the crosshair): the scope's view, then the reticle.
      const lens = client.hud.layer('bf.sight', 'lens');
      scope = el('div.bf-scope', el('div.bf-scope-lens', el('div.bf-scope-ring'), el('div.bf-scope-ticks'), el('div.bf-scope-read', 'RNG'), el('div.bf-scope-dot')));
      scope.style.display = 'none';
      reticle = el('div.bf-reticle', el('span.bf-reticle-ring'), el('span.bf-reticle-dot'));
      reticle.style.display = 'none';
      lens.append(scope, reticle);
      cross = el('div.bf-cross', el('span.bf-arc'), el('span.bf-arc-fill'), el('span.t'), el('span.b'), el('span.l'), el('span.r'), el('span.dot'));
      client.hud.layer('bf.cross', 'middle').append(cross);
      nameEl = el('div.bf-heat-name');
      noteEl = el('div.bf-heat-note');
      pctEl = el('span.bf-heat-pct');
      panel = el(
        'div.bf-heat',
        nameEl,
        el('div.bf-heat-row', el('span.bf-heat-label', 'HEAT'), el('div.bf-heat-track', el('div.bf-heat-fill'), el('div.bf-heat-ticks')), pctEl),
        noteEl,
      );
      panel.style.display = 'none';
      client.hud.layer('bf.heat').append(panel);
    },
    frame(client) {
      if (client.events.some((e) => e.t === 'reset')) {
        item = '';
        venting = null;
      }
      const me = client.me;
      const held = me.held;
      const def = held?.def?.kind === 'gun' ? (held.def as GunItem) : null;
      const st = held?.state as GunState | undefined;
      if (!def || !st || typeof st.mag !== 'number' || me.dead || me.inVehicle) return hide(client);
      if (held!.item !== item) {
        item = held!.item;
        venting = null;
        lastMag = st.mag;
      }
      const size = Math.max(1, def.magazine);
      const aim = st.aim ?? 0;
      const reload = st.reload ?? -1;
      // A vent starting: from how hot, and whether it overheated (empty) or R vented it early.
      if (reload >= 0 && !venting) {
        venting = { from: 1 - st.mag / size, over: st.mag === 0 || lastMag === 0 };
        if (venting.over && !client.replay?.playing) client.audio.play('blaster_overheat', { volume: 0.9 });
      }
      if (reload < 0) venting = null;
      lastMag = st.mag;
      const heat = venting ? venting.from * (1 - reload) : 1 - st.mag / size;
      showHeat(client.replay?.playing ? null : { name: def.name, heat: Math.max(0, Math.min(1, heat)), note: venting ? (venting.over ? 'over' : 'vent') : null });
      // Over the shoulder the crosshair stays up aiming (the view isn't down the sights); through the eyes it goes.
      const third = me.thirdPerson && !client.replay?.playing;
      const scoped = st.sight === 'scope' && aim > 0.9;
      const focal = window.innerHeight / 2 / Math.tan((client.camera.fov * DEG) / 2);
      const gap = Math.tan((st.spread ?? 0) * DEG) * focal + (third ? 7 : 5);
      showCross(client, gap, third && aim > 0.4);
      setClass(cross, 'gone', scoped || (!third && aim > 0.55));
      setClass(cross, 'third', third);
      showScope(scoped);
      // An optic's reticle lights up as its window comes to the eye (through the eyes only).
      const optic = !third && (st.sight === 'dot' || st.sight === 'holo') ? st.sight : null;
      showReticle(optic, Math.max(0, Math.min(1, (aim - 0.75) / 0.2)), st.color);
    },
    dispose() {
      unstyle?.();
    },
  };
}
