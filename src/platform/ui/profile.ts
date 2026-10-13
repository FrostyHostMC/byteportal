import { h } from './dom';
import type { SignedIn } from './account';

/** A game as the profile lists it: its meta's name, colour, cover and achievements. */
export interface ProfileGame {
  id: string;
  title: string;
  accent?: string;
  cover?: string;
  achievements?: Record<string, { title: string; description: string; hidden?: boolean }>;
}

/** When each achievement was earned, by game (`GET /me/achievements`): UTC, `2026-09-26 18:04:11`. */
export type Earned = Record<string, Record<string, string>>;

const TROPHY = '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M7 3h10v2h3v3a4 4 0 0 1-4 4h-.4A5 5 0 0 1 13 14.9V17h3v2H8v-2h3v-2.1A5 5 0 0 1 8.4 12H8a4 4 0 0 1-4-4V5h3V3zm0 4H6v1a2 2 0 0 0 1 1.7V7zm10 0v2.7A2 2 0 0 0 18 8V7h-1zM6 20h12v2H6v-2z"/></svg>';

/** How many of a game's achievements there are, and how many of them are earned. */
export function tally(g: ProfileGame, earned: Earned | null): { have: number; all: number } {
  const ids = Object.keys(g.achievements ?? {});
  return { have: ids.filter((id) => earned?.[g.id]?.[id]).length, all: ids.length };
}

/**
 * The profile, over the home page: every game's achievements, done (and when) and still to do (a
 * hidden one only once it's done), game by game. A guest sees what there is to earn, and the way
 * to sign in to keep it.
 */
export class Profile {
  readonly root = h('div.screen.profile-screen.hidden', { role: 'dialog', 'aria-label': 'Achievements' });
  private panel = h('div.profile-panel');
  onSignIn: (() => void) | null = null;

  constructor(private games: ProfileGame[]) {
    this.root.append(this.panel);
    // A click outside the panel, or Escape, closes it.
    this.root.addEventListener('pointerdown', (e) => e.target === this.root && this.close());
    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && this.open) this.close();
    });
  }

  get open(): boolean {
    return !this.root.classList.contains('hidden');
  }

  /** Show it: `me` (null: a guest) and what they've earned; `game` first and in view. */
  show(me: SignedIn | null, earned: Earned | null, game?: string) {
    const listed = this.games.filter((g) => Object.keys(g.achievements ?? {}).length);
    const order = game ? [...listed.filter((g) => g.id === game), ...listed.filter((g) => g.id !== game)] : listed;
    const total = listed.reduce((n, g) => n + tally(g, earned).have, 0);
    const face = me?.avatar ? h('img.profile-avatar', { src: me.avatar, alt: '', referrerpolicy: 'no-referrer' }) : h('span.profile-avatar.blank', {}, me ? me.name.slice(0, 1) : '?');
    const close = h('button.profile-close', { onclick: () => this.close(), 'aria-label': 'Close' }, '×');
    const children: (HTMLElement | null)[] = [
      h(
        'header.profile-head',
        {},
        face,
        h('div.profile-who', {}, h('div.profile-name', {}, me?.name ?? 'Guest'), h('div.profile-sub', {}, me ? `${total} ${total === 1 ? 'achievement' : 'achievements'} across ${listed.length} games` : 'Achievements you earn as a guest last the visit')),
        close,
      ),
      me ? null : h('div.profile-guest', {}, h('span', {}, 'Type your name on the home page and press Play to keep every achievement you earn, in every game.')),
      h('div.profile-games', {}, ...order.map((g) => this.section(g, earned))),
    ];
    this.panel.replaceChildren(...children.filter((c): c is HTMLElement => !!c));
    this.root.classList.remove('hidden');
    this.panel.scrollTop = 0;
  }

  close() {
    this.root.classList.add('hidden');
  }

  private section(g: ProfileGame, earned: Earned | null): HTMLElement {
    const { have, all } = tally(g, earned);
    const mine = earned?.[g.id] ?? {};
    const art = h('span.profile-cover');
    if (g.cover) art.style.backgroundImage = `url("${g.cover}")`;
    const rows = Object.entries(g.achievements ?? {})
      // Earned first (the latest first), then the rest in the game's order.
      .sort(([a], [b]) => (mine[b] ?? '').localeCompare(mine[a] ?? ''))
      .map(([id, a]) => {
        const at = mine[id];
        const secret = a.hidden && !at;
        const icon = h(`span.feat-icon${at ? '.done' : ''}`);
        icon.innerHTML = TROPHY;
        return h(
          `div.feat${at ? '.done' : ''}`,
          {},
          icon,
          h('div.feat-text', {}, h('div.feat-title', {}, secret ? 'Hidden achievement' : a.title), h('div.feat-desc', {}, secret ? 'Keep playing to find it' : a.description)),
          at ? h('div.feat-when', {}, when(at)) : null,
        );
      });
    return h(
      'section.profile-game',
      { style: `--game: ${g.accent ?? '#7fd46b'}` },
      h(
        'div.profile-game-head',
        {},
        art,
        h('div.profile-game-title', {}, g.title),
        h('div.profile-game-count', {}, `${have} / ${all}`),
        h('div.profile-game-bar', {}, h('span', { style: `width: ${all ? (100 * have) / all : 0}%` })),
      ),
      h('div.feats', {}, ...rows),
    );
  }
}

/** When it was earned, briefly: "Today", "Yesterday", "12 Sep 2026". */
function when(utc: string): string {
  const d = new Date(`${utc.replace(' ', 'T')}Z`);
  if (Number.isNaN(d.getTime())) return '';
  const days = Math.floor((Date.now() - d.getTime()) / 86400000);
  if (days <= 0 && new Date().getDate() === d.getDate()) return 'Today';
  if (days <= 1) return 'Yesterday';
  return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}
