import { h } from './dom';
import type { DirectoryGame } from '../package/link';

/**
 * The community directory, over the home page: games people have uploaded and put in it, not
 * (yet) on the home page, newest first. Picking one plays it.
 */
export class DirectoryPanel {
  readonly root = h('div.screen.profile-screen.directory-screen.hidden', { role: 'dialog', 'aria-label': 'Community games' });
  private panel = h('div.profile-panel.directory-panel');
  private grid = h('div.directory-grid');
  /** A game picked: play it. */
  onPick: ((id: string) => void) | null = null;

  constructor() {
    const close = h('button.profile-close', { onclick: () => this.close(), 'aria-label': 'Close' }, '×');
    this.panel.append(
      h(
        'header.profile-head',
        {},
        h('div.profile-who', {}, h('div.profile-name', {}, 'Community games'), h('div.profile-sub', {}, 'Made and uploaded by players, and not reviewed for the home page')),
        close,
      ),
      this.grid,
    );
    this.root.append(this.panel);
    this.root.addEventListener('pointerdown', (e) => e.target === this.root && this.close());
    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && this.open) this.close();
    });
  }

  get open(): boolean {
    return !this.root.classList.contains('hidden');
  }

  /** Show it, from the game server at `http` (its web address). */
  async show(http: string) {
    this.root.classList.remove('hidden');
    this.grid.replaceChildren(h('div.mygames-empty', {}, 'Looking…'));
    const r = await fetch(`${http}/g/directory`).catch(() => null);
    const games = r?.ok ? ((await r.json()) as { games: DirectoryGame[] }).games : null;
    if (!games) return this.grid.replaceChildren(h('div.mygames-empty', {}, "Couldn't reach the game server."));
    if (!games.length) return this.grid.replaceChildren(h('div.mygames-empty', {}, 'Nothing here yet. Upload a game from the account menu (Your games) and put it in the directory.'));
    this.grid.replaceChildren(
      ...games.map((g) => {
        const art = h('span.directory-art');
        if (g.cover) art.style.backgroundImage = `url("${g.cover}")`;
        else art.classList.add('blank');
        return h(
          'button.directory-card',
          { style: `--game: ${g.accent ?? '#7fd46b'}`, onclick: () => (this.close(), this.onPick?.(g.id)) },
          art,
          h('span.directory-text', {}, h('span.directory-title', {}, g.title), g.tagline ? h('span.directory-tagline', {}, g.tagline) : null, h('span.directory-by', {}, `by ${g.by.join(', ')}`)),
        );
      }),
    );
  }

  close() {
    this.root.classList.add('hidden');
  }
}
