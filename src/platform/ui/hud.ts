import { h } from './dom';
import type { Registry } from '../world/registry';

/** Crosshair, hotbar and the block-name toast. */
export class Hud {
  private crosshairEl: HTMLElement;
  private hotbarEl: HTMLElement;
  readonly root: HTMLElement;
  private slots: HTMLElement[] = [];
  private toast: HTMLElement;
  private toastTimer = 0;
  private waterTint: HTMLElement;
  /** The game wants a crosshair (`hud.crosshair`). */
  private wanted = true;
  /** Client code's own crosshair, shown in the plain one's place. */
  private replacement: HTMLElement | null = null;
  /** Client code's own layers (see `layer`), by name. */
  private layers = new Map<string, HTMLElement>();

  constructor(parent: HTMLElement, private registry: Registry, private icons: Map<number, string>) {
    this.toast = h('div.toast');
    const bar = h('div.hotbar');
    for (let i = 0; i < 9; i++) {
      const slot = h('div.slot', {}, h('img', { alt: '', draggable: false }), h('span.key', {}, String(i + 1)), h('span.count'));
      this.slots.push(slot);
      bar.append(slot);
    }
    this.waterTint = h('div.water-tint');
    this.crosshairEl = h('div.crosshair');
    this.hotbarEl = bar;
    this.root = h('div.hud', {}, this.waterTint, this.crosshairEl, this.toast, bar);
    parent.append(this.root);
  }

  setHotbar(ids: number[], selected: number, announce: boolean) {
    ids.forEach((id, i) => {
      const img = this.slots[i].querySelector('img')!;
      const src = this.icons.get(id) ?? '';
      if (img.getAttribute('src') !== src) img.src = src;
      this.slots[i].classList.toggle('selected', i === selected);
      this.slots[i].title = this.registry.blocks[id]?.label ?? '';
    });
    if (announce) this.showToast(this.registry.blocks[ids[selected]]?.label ?? '');
  }

  /** Item mode: icons (data URLs) with stack counts. */
  setSlots(slots: ({ icon: string; count: number; label: string } | null)[], selected: number, announce: boolean) {
    slots.forEach((st, i) => {
      const el = this.slots[i];
      const img = el.querySelector('img')!;
      const src = st?.icon ?? '';
      if (img.getAttribute('src') !== src) {
        if (src) img.src = src;
        else img.removeAttribute('src');
      }
      img.style.visibility = src ? '' : 'hidden';
      (el.querySelector('.count') as HTMLElement).textContent = st && st.count > 1 ? String(st.count) : '';
      el.classList.toggle('selected', i === selected);
      el.title = st?.label ?? '';
    });
    if (announce) this.showToast(slots[selected]?.label ?? '');
  }

  showToast(text: string) {
    this.toast.textContent = text;
    this.toast.classList.add('show');
    window.clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => this.toast.classList.remove('show'), 1400);
  }

  setCrosshair(v: boolean) {
    this.wanted = v;
    this.showCross();
  }

  /** Client code's own crosshair in the plain one's place (null: the plain one again). */
  replaceCrosshair(el: HTMLElement | null) {
    if (this.replacement && this.replacement !== el) this.replacement.style.display = 'none';
    this.replacement = el;
    this.showCross();
  }

  get crosshairWanted(): boolean {
    return this.wanted;
  }

  private showCross() {
    this.crosshairEl.style.display = this.wanted && !this.replacement ? '' : 'none';
    if (this.replacement) this.replacement.style.display = this.wanted ? '' : 'none';
  }

  /**
   * A layer for client code's own elements, made the first time it's named: `lens` straight over
   * the world (under the crosshair), `middle` with the crosshair (under the toast and hotbar).
   * Layers at one place stack in the order they're made.
   */
  layer(name: string, place: 'lens' | 'middle'): HTMLElement {
    let el = this.layers.get(name);
    if (el) return el;
    el = h('div.hud-layer');
    el.dataset.layer = name;
    this.root.insertBefore(el, place === 'lens' ? this.crosshairEl : this.toast);
    this.layers.set(name, el);
    return el;
  }

  setHotbarVisible(v: boolean) {
    this.hotbarEl.style.display = v ? '' : 'none';
  }

  setVisible(v: boolean) {
    this.root.style.display = v ? '' : 'none';
  }

  setMedium(medium: 'air' | 'water' | 'lava') {
    this.waterTint.dataset.medium = medium;
  }
}
