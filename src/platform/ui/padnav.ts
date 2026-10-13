/** What a controller can land on: buttons, sliders, switches, and anything marked `data-pad`. */
const CONTROLS = 'button:not(:disabled), a[href], input[type=range], label.toggle, [data-pad]';

/** The first of these on show is where the highlight starts. */
const FIRST = ['.menu-entry.active', '.result-buttons .btn.primary', '.menu-entry', '.btn.primary', '.pause-item.primary', '.home-play', '.inv-cell'];

type Dir = 'Up' | 'Down' | 'Left' | 'Right';

const center = (r: DOMRect) => ({ x: r.left + r.width / 2, y: r.top + r.height / 2 });

/**
 * Menus with a controller: a highlight on one control at a time, moved by the D-pad or stick to
 * the nearest control that way, pressed with A; sliders slide with left and right. It only
 * lands on controls in the top screen (nothing covering them).
 */
export class PadNav {
  private current: HTMLElement | null = null;
  /** The highlight went where it starts, and hasn't been moved since (it follows a better start: Play, once it's ready). */
  private placed = true;

  constructor(private root: HTMLElement) {}

  /** Keep the highlight on something on show (a menu opened or closed): call each frame the controller has the menus. */
  sync() {
    const all = this.controls();
    if (this.current && all.includes(this.current) && !this.placed) return;
    // Redrawn (a menu's entries replaced): the highlight stays on the one in the same place.
    const key = this.current?.dataset.padKey;
    const again = key !== undefined && !this.current!.isConnected ? all.find((el) => el.dataset.padKey === key) : undefined;
    if (again && !this.placed) {
      this.current = null;
      this.focus(again);
      return;
    }
    this.placed = true;
    this.focus(this.first(all));
  }

  move(dir: Dir) {
    this.placed = false;
    const cur = this.current;
    if (cur instanceof HTMLInputElement && cur.type === 'range' && (dir === 'Left' || dir === 'Right')) {
      this.slide(cur, dir === 'Right' ? 1 : -1);
      return;
    }
    const all = this.controls();
    if (!cur || !all.includes(cur)) {
      this.focus(this.first(all));
      return;
    }
    const a = cur.getBoundingClientRect();
    const ac = center(a);
    let best: HTMLElement | null = null;
    let bestScore = Infinity;
    for (const el of all) {
      if (el === cur) continue;
      const r = el.getBoundingClientRect();
      const c = center(r);
      const horizontal = dir === 'Left' || dir === 'Right';
      const sign = dir === 'Right' || dir === 'Down' ? 1 : -1;
      const along = ((horizontal ? c.x - ac.x : c.y - ac.y) * sign);
      if (along < 4) continue;
      // Across: the gap between them the other way (0 on the same row or column).
      const across = horizontal ? Math.max(0, r.top - a.bottom, a.top - r.bottom) : Math.max(0, r.left - a.right, a.left - r.right);
      const score = along + across * 3 + Math.abs(horizontal ? c.y - ac.y : c.x - ac.x) * 0.2;
      if (score < bestScore) {
        bestScore = score;
        best = el;
      }
    }
    if (best) this.focus(best);
  }

  /** A: press the highlighted control. */
  press() {
    const cur = this.current;
    if (!cur || !this.controls().includes(cur)) return this.sync();
    this.placed = false;
    cur.click();
  }

  /** The mouse is back: no highlight. */
  clear() {
    this.current?.classList.remove('pad-focus');
    this.current = null;
  }

  private slide(input: HTMLInputElement, by: number) {
    const min = Number(input.min || 0);
    const max = Number(input.max || 100);
    const step = Number(input.step) || 1;
    // A fine slider moves in twentieths.
    const k = Math.max(step, (max - min) / 20);
    const v = Math.min(max, Math.max(min, Math.round((Number(input.value) + by * k - min) / step) * step + min));
    input.value = String(v);
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }

  private focus(el: HTMLElement | null) {
    if (el === this.current) return;
    // (One highlight, even one left by the game before a switch.)
    for (const x of this.root.querySelectorAll('.pad-focus')) x.classList.remove('pad-focus');
    this.current = el;
    if (!el) return;
    el.classList.add('pad-focus');
    el.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }

  private first(all = this.controls()): HTMLElement | null {
    for (const sel of FIRST) {
      const el = all.find((x) => x.matches(sel));
      if (el) return el;
    }
    return all[0] ?? null;
  }

  /** The controls on show in the top screen: nothing covers them (or, scrolled out of sight, they're in a screen that shows some). */
  private controls(): HTMLElement[] {
    const shown = [...this.root.querySelectorAll<HTMLElement>(CONTROLS)].filter((el) => el.getClientRects().length > 0);
    const w = window.innerWidth;
    const h = window.innerHeight;
    const open: HTMLElement[] = [];
    const layers = new Set<Element | null>();
    const later: HTMLElement[] = [];
    for (const el of shown) {
      const c = center(el.getBoundingClientRect());
      if (c.x < 0 || c.y < 0 || c.x > w || c.y > h) {
        later.push(el);
        continue;
      }
      const hit = document.elementFromPoint(c.x, c.y);
      if (hit && (hit === el || el.contains(hit))) {
        open.push(el);
        layers.add(el.closest('.screen'));
      }
    }
    for (const el of later) if (layers.has(el.closest('.screen'))) open.push(el);
    return open;
  }
}
