import { h } from './dom';

type Kind = 'info' | 'ok' | 'error' | 'echo';

type Completion = { start: number; options: string[] };

/**
 * Minecraft-style command line: opens at the bottom left, keeps a short log that fades after it
 * closes, Tab completes, Up / Down walk the history.
 */
export class CommandBar {
  readonly root: HTMLElement;
  private log: HTMLElement;
  private hint: HTMLElement;
  private input: HTMLInputElement;
  private history: string[] = [];
  private historyAt = -1;
  private fadeTimer = 0;
  isOpen = false;

  onSubmit: ((line: string) => void) | null = null;
  onClose: (() => void) | null = null;
  /** Completions for a line (the game's host answers, so it may take a moment). */
  complete: ((line: string) => Completion | Promise<Completion>) | null = null;

  constructor(parent: HTMLElement) {
    this.log = h('div.cmd-log');
    this.hint = h('div.cmd-hint');
    this.input = h('input.cmd-input', { type: 'text', spellcheck: false, autocomplete: 'off' }) as HTMLInputElement;
    this.root = h('div.cmd', {}, this.log, this.hint, h('div.cmd-row', {}, this.input));
    parent.append(this.root);
    // Keep typing out of the game's key handling.
    this.input.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') {
        e.preventDefault();
        const line = this.input.value.trim();
        if (line && line !== '/') {
          this.history.unshift(line);
          this.history.length = Math.min(this.history.length, 50);
        }
        this.close();
        if (line && line !== '/') this.onSubmit?.(line);
      } else if (e.key === 'Escape') {
        e.preventDefault();
        this.close();
      } else if (e.key === 'Tab') {
        e.preventDefault();
        void this.tab();
      } else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
        e.preventDefault();
        const n = this.history.length;
        if (!n) return;
        this.historyAt = Math.max(-1, Math.min(n - 1, this.historyAt + (e.key === 'ArrowUp' ? 1 : -1)));
        this.input.value = this.historyAt < 0 ? '/' : this.history[this.historyAt];
        void this.suggest();
      }
    });
    this.input.addEventListener('keyup', (e) => e.stopPropagation());
    this.input.addEventListener('input', () => void this.suggest());
  }

  open(prefill = '/') {
    this.isOpen = true;
    this.historyAt = -1;
    window.clearTimeout(this.fadeTimer);
    this.root.classList.add('open', 'recent');
    this.input.value = prefill;
    void this.suggest();
    // Focus after the key that opened us has been handled.
    requestAnimationFrame(() => {
      this.input.focus();
      this.input.setSelectionRange(this.input.value.length, this.input.value.length);
    });
  }

  close() {
    if (!this.isOpen) return;
    this.isOpen = false;
    this.input.blur();
    this.root.classList.remove('open');
    this.hint.replaceChildren();
    this.fade();
    this.onClose?.();
  }

  print(text: string, kind: Kind = 'info') {
    if (!text) return;
    for (const line of text.split('\n')) this.log.append(h(`div.cmd-line.${kind}`, {}, line));
    while (this.log.childElementCount > 10) this.log.firstElementChild?.remove();
    this.root.classList.add('recent');
    if (!this.isOpen) this.fade();
  }

  /** Show the log for a few seconds after closing, like Minecraft's chat. */
  private fade() {
    window.clearTimeout(this.fadeTimer);
    this.fadeTimer = window.setTimeout(() => this.root.classList.remove('recent'), 6000);
  }

  private async suggest() {
    const line = this.input.value;
    const c = await this.complete?.(line);
    // Typed on in the meantime: a newer suggestion is on its way.
    if (this.input.value !== line) return;
    const opts = c?.options ?? [];
    this.hint.replaceChildren(...opts.slice(0, 8).map((o) => h('span.cmd-option', {}, o)));
    if (opts.length > 8) this.hint.append(h('span.cmd-more', {}, `+${opts.length - 8}`));
  }

  /** Complete the current word: the only match, or as far as all matches agree. */
  private async tab() {
    const line = this.input.value;
    const c = await this.complete?.(line);
    if (!c || !c.options.length || this.input.value !== line) return;
    let common = c.options[0];
    for (const o of c.options) while (!o.startsWith(common)) common = common.slice(0, -1);
    const done = c.options.length === 1;
    this.input.value = line.slice(0, c.start) + (done ? c.options[0] + ' ' : common || line.slice(c.start));
    void this.suggest();
  }
}
