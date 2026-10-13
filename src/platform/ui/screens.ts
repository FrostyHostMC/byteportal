import { h } from './dom';
import type { Registry } from '../world/registry';

/** Creative block picker. */
export class Inventory {
  readonly root: HTMLElement;
  onPick: ((id: number) => void) | null = null;

  constructor(parent: HTMLElement, registry: Registry, icons: Map<number, string>, onClose: () => void) {
    const grid = h('div.inv-grid');
    for (const b of registry.blocks) {
      if (!b.placeable) continue;
      const cell = h('button.inv-cell', { title: b.label, onclick: () => this.onPick?.(b.id) }, h('img', { src: icons.get(b.id) ?? '', alt: b.label, draggable: false }));
      grid.append(cell);
    }
    this.root = h(
      'div.screen.inventory-screen.hidden',
      { onclick: (e: Event) => e.target === this.root && onClose() },
      h('div.panel.inv-panel', {}, h('div.panel-head', {}, h('h2', {}, 'Blocks'), h('span.hint', {}, 'Click a block to put it in the selected hotbar slot'), h('button.btn', { onclick: () => onClose() }, 'Done')), grid),
    );
    parent.append(this.root);
  }

  show() {
    this.root.classList.remove('hidden');
  }

  hide() {
    this.root.classList.add('hidden');
  }

  get visible(): boolean {
    return !this.root.classList.contains('hidden');
  }
}
