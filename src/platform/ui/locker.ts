import { h } from './dom';
import { characterView } from './characterview';
import { AVATAR_COLORS, AVATAR_OPTIONS, AVATAR_PRESETS, avatarCode, avatarLook, presetAvatar, randomAvatar, type Avatar } from '../avatar';
import type { Cosmetic } from '../cosmetics';
import type { CosmeticSlot } from '../api/types';

/** What they wear, as the locker changes it. */
export interface Look {
  avatar: Avatar;
  wear: string[];
}

type Tab = 'avatar' | CosmeticSlot;

const TABS: [Tab, string][] = [
  ['avatar', 'Avatar'],
  ['hat', 'Hats'],
  ['back', 'On the back'],
  ['title', 'Titles'],
  ['tag', 'Name tags'],
];

const hex = (n: number) => `#${n.toString(16).padStart(6, '0')}`;

/**
 * The ready-made people's pictures, drawn once for the page (each a figure built: a few ms apiece)
 * and kept, the same canvases put back each time the tab's drawn.
 */
let presetPictures: HTMLCanvasElement[] | null = null;
function presetPicture(i: number): HTMLCanvasElement {
  if (!presetPictures) {
    presetPictures = AVATAR_PRESETS.map((p) => {
      const c = h('canvas.locker-preset-figure') as HTMLCanvasElement;
      c.width = 120;
      c.height = 200;
      characterView().draw(c, avatarLook(p.avatar), [], { yaw: 0.35 });
      return c;
    });
  }
  return presetPictures[i];
}

/**
 * The locker, over the home page: their avatar (skin, hair, eyes, top, bottoms, shoes) and the
 * cosmetics they wear (a hat, something on the back, a title, a name tag colour), with a picture of
 * the lot. Signed in, it wears what the account owns (and the platform's, free); a guest makes an
 * avatar (kept in this browser) and sees what signing in would let them wear.
 */
export class Locker {
  readonly root = h('div.screen.locker-screen.hidden', { role: 'dialog', 'aria-label': 'Your look' });
  private panel = h('div.locker-panel');
  private preview = h('canvas.locker-preview') as HTMLCanvasElement;
  private body = h('div.locker-body');
  private tabBar = h('div.locker-tabs');
  private note = h('div.locker-note');
  private tab: Tab = 'avatar';
  /** How the figure's turned (radians), and where it's turning to (dragged, or turned round). */
  private yaw = 0;
  private toYaw = 0;
  private drag: { x: number; yaw: number } | null = null;
  private frame = 0;
  private look: Look = { avatar: presetAvatar(), wear: [] };
  private owned = new Set<string>();
  private signedIn = false;
  private name = '';
  /** Save what's chosen (Done). */
  onSave: ((look: Look) => void) | null = null;
  onSignIn: (() => void) | null = null;

  constructor(private catalog: ReadonlyMap<string, Cosmetic>) {
    const turn = h('button.locker-turn', { onclick: () => (this.toYaw = Math.round(this.toYaw / Math.PI + 1) * Math.PI) }, 'Turn around');
    // Drag the figure round.
    this.preview.width = 432;
    this.preview.height = 720;
    this.preview.addEventListener('pointerdown', (e) => {
      this.drag = { x: e.clientX, yaw: this.toYaw };
      this.preview.setPointerCapture(e.pointerId);
    });
    this.preview.addEventListener('pointermove', (e) => {
      if (this.drag) this.toYaw = this.yaw = this.drag.yaw + (e.clientX - this.drag.x) * 0.012;
    });
    const letGo = () => (this.drag = null);
    this.preview.addEventListener('pointerup', letGo);
    this.preview.addEventListener('pointercancel', letGo);
    const close = h('button.profile-close', { onclick: () => this.close(), 'aria-label': 'Close' }, '×');
    const done = h('button.locker-done', { onclick: () => this.save() }, 'Done');
    this.panel.append(
      h('header.locker-head', {}, h('div.locker-title', {}, 'Your look'), close),
      h(
        'div.locker-main',
        {},
        h('div.locker-stage', {}, this.preview, h('div.locker-tagline'), turn),
        h('div.locker-side', {}, this.tabBar, this.body, this.note, done),
      ),
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

  /** Open it on what they wear now: `owned`, the cosmetics theirs (signed in), `name` for the preview's tag. */
  show(look: Look, opts: { signedIn: boolean; owned: Iterable<string>; name: string }) {
    this.look = { avatar: { ...look.avatar }, wear: [...look.wear] };
    this.signedIn = opts.signedIn;
    this.owned = new Set(opts.owned);
    this.name = opts.name;
    this.yaw = this.toYaw = 0.35;
    this.renderTabs();
    this.render();
    this.root.classList.remove('hidden');
    cancelAnimationFrame(this.frame);
    this.frame = requestAnimationFrame(this.spin);
  }

  close() {
    this.root.classList.add('hidden');
    cancelAnimationFrame(this.frame);
    characterView().release();
  }

  /** The preview, a frame at a time while it's open: the figure easing round to where it's turned. */
  private spin = () => {
    if (!this.open) return;
    this.yaw += (this.toYaw - this.yaw) * 0.18;
    this.drawFigure();
    this.frame = requestAnimationFrame(this.spin);
  };

  private drawFigure() {
    characterView().draw(this.preview, avatarLook(this.look.avatar), this.look.wear.map((id) => this.catalog.get(id)).filter((c): c is Cosmetic => !!c), { yaw: this.yaw });
  }

  private save() {
    this.onSave?.({ avatar: { ...this.look.avatar }, wear: [...this.look.wear] });
    this.close();
  }

  private renderTabs() {
    this.tabBar.replaceChildren(
      ...TABS.map(([t, label]) => h(`button.pause-tab${t === this.tab ? '.active' : ''}`, { onclick: () => ((this.tab = t), this.renderTabs(), this.render()) }, label)),
    );
  }

  private worn(slot: CosmeticSlot): Cosmetic | undefined {
    for (const id of this.look.wear) {
      const c = this.catalog.get(id);
      if (c?.slot === slot) return c;
    }
    return undefined;
  }

  /** The preview: the avatar in what it wears, the name tag under it. */
  private draw() {
    this.drawFigure();
    const tag = this.panel.querySelector('.locker-tagline') as HTMLElement;
    const title = this.worn('title')?.text;
    tag.replaceChildren(h('span.locker-name', { style: `color: ${this.worn('tag')?.color ?? '#ffffff'}` }, this.name || 'You'), ...(title ? [h('span.locker-sub', {}, title)] : []));
  }

  private render() {
    this.draw();
    this.note.replaceChildren();
    if (this.tab === 'avatar') return this.renderAvatar();
    this.renderSlot(this.tab);
  }

  private renderAvatar() {
    const a = this.look.avatar;
    const set = (k: keyof Avatar, v: number) => {
      a[k] = v;
      this.render();
    };
    const swatches = (k: keyof Avatar, colors: readonly number[], names: readonly string[]) =>
      h('div.locker-swatches', {}, ...colors.map((c, i) => h(`button.locker-swatch${a[k] === i ? '.on' : ''}`, { style: `background: ${hex(c)}`, title: names[i], 'aria-label': names[i], onclick: () => set(k, i) })));
    const chips = (k: keyof Avatar) => h('div.locker-chips', {}, ...AVATAR_OPTIONS[k].map((n, i) => h(`button.locker-chip${a[k] === i ? '.on' : ''}`, { onclick: () => set(k, i) }, n)));
    const row = (label: string, ...kids: HTMLElement[]) => h('div.locker-row', {}, h('div.locker-label', {}, label), ...kids);
    // Ready-made: pick one as is, or start from it.
    const code = avatarCode(a);
    const presets = h(
      'div.locker-presets',
      {},
      ...AVATAR_PRESETS.map((p, i) =>
        h(
          `button.locker-preset${avatarCode(p.avatar) === code ? '.on' : ''}`,
          { onclick: () => ((this.look.avatar = { ...p.avatar }), this.render()), title: p.name },
          presetPicture(i),
          h('span.locker-preset-name', {}, p.name),
        ),
      ),
    );
    this.body.replaceChildren(
      row('Pick one', presets),
      h('div.locker-label.locker-or', {}, 'Or make it yours'),
      row('Build', chips('build'), chips('curvy')),
      row('Skin', swatches('tone', AVATAR_COLORS.tone, AVATAR_OPTIONS.tone)),
      row('Hair', chips('hair'), swatches('hairColor', AVATAR_COLORS.hairColor, AVATAR_OPTIONS.hairColor)),
      row('Face', chips('face'), chips('facialHair')),
      row('Eyes', swatches('eyes', AVATAR_COLORS.eyes, AVATAR_OPTIONS.eyes)),
      row('Top', chips('top'), swatches('topColor', AVATAR_COLORS.cloth, AVATAR_OPTIONS.topColor)),
      row('Trim', swatches('accent', AVATAR_COLORS.cloth, AVATAR_OPTIONS.accent)),
      row('Bottoms', chips('bottom'), swatches('bottomColor', AVATAR_COLORS.cloth, AVATAR_OPTIONS.bottomColor)),
      row('Shoes', chips('shoes'), swatches('shoeColor', AVATAR_COLORS.shoes, AVATAR_OPTIONS.shoeColor)),
      h('button.locker-chip.locker-random', { onclick: () => ((this.look.avatar = randomAvatar()), this.render()) }, 'Surprise me'),
    );
    this.note.textContent = 'This is you in every game that doesn’t dress its players itself (a team game puts you in its colours). Games with outfits of their own keep them, and show your hat, title and name tag.';
  }

  private renderSlot(slot: CosmeticSlot) {
    const all = [...this.catalog.values()].filter((c) => c.slot === slot);
    const on = this.worn(slot)?.id;
    const wear = (id: string | null) => {
      this.look.wear = this.look.wear.filter((w) => this.catalog.get(w)?.slot !== slot);
      if (id) this.look.wear.push(id);
      this.render();
    };
    const mine = (c: Cosmetic) => this.signedIn && (c.free || this.owned.has(c.id));
    // Theirs first, then what's still to earn.
    all.sort((p, q) => Number(mine(q)) - Number(mine(p)));
    this.body.replaceChildren(
      h(
        'div.locker-items',
        {},
        h(`button.locker-item${on ? '' : '.on'}`, { onclick: () => wear(null) }, h('span.locker-item-name', {}, 'None')),
        ...all.map((c) => {
          const have = mine(c);
          const swatch = c.slot === 'tag' ? h('span.locker-item-dot', { style: `background: ${c.color}` }) : c.slot === 'title' ? h('span.locker-item-title', {}, c.text ?? '') : null;
          return h(
            `button.locker-item${on === c.id ? '.on' : ''}${have ? '' : '.locked'}`,
            { onclick: () => have && wear(c.id), title: c.how ?? '' },
            swatch,
            h('span.locker-item-name', {}, c.name),
            h('span.locker-item-how', {}, have ? (c.game ? `From ${gameName(c.game)}` : 'Everyone’s') : (c.how ?? 'Earned in play')),
          );
        }),
      ),
    );
    if (!this.signedIn) {
      this.note.replaceChildren('Press Play with your name typed in to wear these, and to keep what you earn in every game.');
    }
  }
}

/** A game's name from its id, for the locker (set by the home page from the catalog's games). */
let names = new Map<string, string>();
export function setGameNames(list: { id: string; title: string }[]) {
  names = new Map(list.map((g) => [g.id, g.title]));
}
const gameName = (id: string) => names.get(id) ?? id;

export { avatarCode };
