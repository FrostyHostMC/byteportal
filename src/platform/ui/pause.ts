import { h } from './dom';
import { hintTable, keyHints, type GameControls } from './controls';
import { copyInvite } from './home';
import { ACTIONS, actionLabel, canBind, keyFor, keyLabel, normalize, rebind, resolve, type Action, type KeyDefaults } from '../player/keys';
import type { Settings, ShadowQuality } from '../settings';

type Change = (s: Settings) => void;

const TROPHY = '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M7 3h10v2h3v3a4 4 0 0 1-4 4h-.4A5 5 0 0 1 13 14.9V17h3v2H8v-2h3v-2.1A5 5 0 0 1 8.4 12H8a4 4 0 0 1-4-4V5h3V3zm0 4H6v1a2 2 0 0 0 1 1.7V7zm10 0v2.7A2 2 0 0 0 18 8V7h-1zM6 20h12v2H6v-2z"/></svg>';

/** What the pause menu says of the game being played, and what it offers. */
export interface PauseGame extends GameControls {
  title: string;
  accent?: string;
  /** In a room of the player's own: its code (else the public game). */
  room: string | null;
  /** The game has rooms of players' own (so an invite link names one, or the public game). */
  instances?: boolean;
  /** Restarting is offered: only where the server takes it (a game of one's own, not everyone's). */
  restart: boolean;
  /** The world's clock can be changed (time of day, day length): where the server takes it, and the game doesn't fix the time. */
  clock: boolean;
  /** The game's achievements (its meta's). */
  achievements?: Record<string, { title: string; description: string; hidden?: boolean }>;
}

/** Someone in the game, as the pause menu lists them. */
export interface PausePlayer {
  name: string;
  bot: boolean;
  me: boolean;
}

type Pane = 'help' | 'settings';
type Tab = 'graphics' | 'controls' | 'controller' | 'touch' | 'sound' | 'world';

/**
 * The pause menu (Escape, or a controller's Menu button): the game's name and room down the left
 * with what to do (resume, how to play, settings, invite, restart, leave), and beside it how to
 * play (the game's controls, and who's playing), or the settings in tabs.
 */
export class PauseMenu {
  readonly root: HTMLElement;
  private settings: Settings;
  private timeSlider!: HTMLInputElement;
  private padKeys = h('div.pad-only');
  private touchKeys = h('div.touch-only');
  private roomLine = h('div.pause-room');
  private players = h('div.pause-players');
  private feats = h('div.feats');
  private featsHead = h('h3', {}, 'Achievements');
  private earned: ReadonlySet<string> = new Set();
  /** Signed in: what's earned is kept (a guest's lasts the visit). */
  private kept = true;
  private panes: Record<Pane, HTMLElement>;
  private tabs: Record<Tab, { button: HTMLElement; body: HTMLElement } | null>;
  private navItems = new Map<Pane, HTMLElement>();
  private pane: Pane = 'help';
  /** Who's playing, as last shown (so an unchanged list isn't rebuilt). */
  private seen = '';
  /** The control waiting for its new key, if any. */
  private rebinding: Action | null = null;
  private stopRebinding: () => void = () => {};
  onTime: ((t: number) => void) | null = null;
  onRestart: (() => void) | null = null;
  onExit: (() => void) | null = null;

  constructor(parent: HTMLElement, settings: Settings, private game: PauseGame, keys: KeyDefaults, private onChange: Change, onResume: () => void) {
    this.settings = { ...settings };
    const s = this.settings;
    const set = <K extends keyof Settings>(k: K, v: Settings[K]) => {
      s[k] = v;
      this.onChange({ ...s });
    };

    const slider = (label: string, key: keyof Settings, min: number, max: number, step: number, fmt: (v: number) => string) => {
      const val = h('span.value', {}, fmt(s[key] as number));
      const input = h('input', { type: 'range', min, max, step, value: String(s[key]) }) as HTMLInputElement;
      input.addEventListener('input', () => {
        const v = Number(input.value);
        val.textContent = fmt(v);
        set(key, v as never);
      });
      return h('label.row', {}, h('span.name', {}, label), input, val);
    };
    const toggle = (label: string, key: keyof Settings, note?: string) => {
      const input = h('input', { type: 'checkbox', checked: Boolean(s[key]) }) as HTMLInputElement;
      input.addEventListener('change', () => set(key, input.checked as never));
      return h('label.toggle', {}, input, h('span.switch'), h('span.toggle-text', {}, label, note ? h('small', {}, note) : null));
    };
    const shadowOpts: ShadowQuality[] = ['off', 'low', 'medium', 'high', 'ultra'];
    const seg = h('div.segmented');
    for (const q of shadowOpts) {
      const b = h('button', { class: s.shadows === q ? 'on' : '', onclick: () => {
        seg.querySelectorAll('button').forEach((x) => x.classList.remove('on'));
        b.classList.add('on');
        set('shadows', q);
      } }, q);
      seg.append(b);
    }

    // Keyboard: click a key, then press the new one (Escape cancels). Taking a key another control
    // has swaps the two, so Sprint on Shift puts Crouch on Ctrl. `keys` are this game's own.
    const keyButtons = new Map<Action, HTMLButtonElement>();
    const hint = h('div.keybind-hint', {});
    const reset = h('button.link-btn', {
      onclick: () => {
        set('keys', {});
        hint.textContent = '';
        refreshKeys();
      },
    }, 'Reset to defaults') as HTMLButtonElement;
    const refreshKeys = () => {
      const bound = resolve(s.keys, keys);
      for (const a of ACTIONS) {
        const b = keyButtons.get(a.id)!;
        b.textContent = keyLabel(bound[a.id]);
        b.classList.toggle('changed', normalize(bound[a.id]) !== normalize(keys[a.id]));
        b.classList.remove('listening');
      }
      reset.disabled = Object.keys(s.keys).length === 0;
      // How to play names the keys as bound.
      this.game.keys = { bound: s.keys, game: keys };
      this.renderHelp();
    };
    const capture = (e: KeyboardEvent) => {
      // Ours alone: the game mustn't see the key being bound.
      e.preventDefault();
      e.stopImmediatePropagation();
      const action = this.rebinding;
      if (!action || e.repeat) return;
      if (e.code === 'Escape') return this.stopRebinding();
      if (!canBind(e.code)) {
        hint.textContent = `${e.code ? keyLabel(e.code) : 'That key'} can’t be bound. Press another key, or Escape to cancel.`;
        return;
      }
      const taken = ACTIONS.find((a) => a.id !== action && normalize(keyFor(s.keys, keys, a.id)) === normalize(e.code));
      set('keys', rebind(s.keys, keys, action, e.code));
      hint.textContent = taken ? `${taken.label} moved to ${actionLabel(s.keys, keys, taken.id)}.` : '';
      this.stopRebinding();
    };
    this.stopRebinding = () => {
      if (!this.rebinding) return;
      this.rebinding = null;
      window.removeEventListener('keydown', capture, true);
      // Let go of the button, so the key's release doesn't press it again.
      if (document.activeElement instanceof HTMLElement && document.activeElement.classList.contains('keycap')) document.activeElement.blur();
      refreshKeys();
    };
    const keybinds = h(
      'div.keybinds',
      {},
      ...ACTIONS.map((a) => {
        const b = h('button.keycap', {
          onclick: () => {
            this.stopRebinding();
            this.rebinding = a.id;
            hint.textContent = `Press a key for ${a.label.toLowerCase()}. Escape cancels.`;
            b.textContent = '…';
            b.classList.add('listening');
            window.addEventListener('keydown', capture, true);
          },
          onblur: () => this.rebinding === a.id && this.stopRebinding(),
        }) as HTMLButtonElement;
        keyButtons.set(a.id, b);
        return h('div.keybind', {}, h('span.name', {}, a.label), b);
      }),
    );

    this.timeSlider = h('input', { type: 'range', min: 0, max: 1, step: 0.001, value: '0.3' }) as HTMLInputElement;
    const clock = h('span.value', {}, '');
    this.timeSlider.addEventListener('input', () => {
      clock.textContent = clockText(Number(this.timeSlider.value));
      this.onTime?.(Number(this.timeSlider.value));
    });

    const group = (title: string, ...rows: (HTMLElement | null)[]) => h('section.set-group', {}, h('h3', {}, title), ...rows);
    const tabBodies: Record<Tab, HTMLElement | null> = {
      graphics: h(
        'div.tab-body',
        {},
        group(
          'Quality',
          h('div.toggles.single', {}, toggle('Auto quality', 'autoQuality', 'Lowers the settings below while frames are slow')),
          h('div.row', {}, h('span.name', {}, 'Shadows'), seg),
          slider('Resolution', 'renderScale', 0.4, 1, 0.05, (v) => `${Math.round(v * 100)}%`),
          slider('Render distance', 'renderDistance', 4, 24, 1, (v) => `${v} chunks`),
        ),
        group(
          'Effects',
          h(
            'div.toggles',
            {},
            toggle('Anti-aliasing (MSAA)', 'msaa'),
            toggle('Bloom', 'bloom'),
            toggle('God rays', 'godrays'),
            toggle('Water reflections', 'ssr'),
            toggle('Clouds', 'clouds'),
            toggle('Cave culling', 'occlusion'),
          ),
        ),
      ),
      controls: h(
        'div.tab-body',
        {},
        group(
          'Mouse and camera',
          slider('Mouse sensitivity', 'sensitivity', 0.2, 3, 0.05, (v) => v.toFixed(2)),
          slider('Field of view', 'fov', 55, 110, 1, (v) => `${v}°`),
          h('div.toggles.single', {}, toggle('View bobbing', 'viewBobbing')),
        ),
        // Keyboard keys: hidden (and out of a controller's reach) while a controller is in use.
        h('section.set-group.keys-only', {}, h('div.section-head', {}, h('h3', {}, 'Keyboard'), reset), keybinds, hint),
      ),
      controller: h(
        'div.tab-body',
        {},
        group(
          'Controller',
          slider('Stick sensitivity', 'stickSensitivity', 0.3, 2.5, 0.05, (v) => v.toFixed(2)),
          h('div.toggles', {}, toggle('Invert look', 'invertY'), toggle('Vibration', 'vibration'), toggle('Aim assist', 'aimAssist', 'With guns')),
        ),
      ),
      touch: h(
        'div.tab-body',
        {},
        group(
          'Touch',
          slider('Look sensitivity', 'touchSensitivity', 0.3, 3, 0.05, (v) => v.toFixed(2)),
          slider('Field of view', 'fov', 55, 110, 1, (v) => `${v}°`),
          h('div.toggles', {}, toggle('Invert look', 'invertY'), toggle('Aim assist', 'aimAssist', 'With guns'), toggle('View bobbing', 'viewBobbing'), toggle('Vibration', 'vibration', 'When hurt')),
        ),
      ),
      sound: h(
        'div.tab-body',
        {},
        group(
          'Sound',
          slider('Volume', 'volume', 0, 1, 0.05, (v) => `${Math.round(v * 100)}%`),
          slider('Music', 'music', 0, 1, 0.05, (v) => (v > 0 ? `${Math.round(v * 100)}%` : 'Off')),
        ),
      ),
      world: game.clock
        ? h(
            'div.tab-body',
            {},
            group('World', h('label.row', {}, h('span.name', {}, 'Time of day'), this.timeSlider, clock), slider('Day length', 'dayMinutes', 2, 60, 1, (v) => `${v} min`)),
          )
        : null,
    };
    const labels: Record<Tab, string> = { graphics: 'Graphics', controls: 'Mouse & keys', controller: 'Controller', touch: 'Touch', sound: 'Sound', world: 'World' };
    // On a touch screen, its own tab in place of the mouse's and the controller's (and off one, none).
    const only: Partial<Record<Tab, string>> = { controls: '.no-touch', controller: '.no-touch', touch: '.touch-only' };
    const tabBar = h('div.pause-tabs', { role: 'tablist' });
    this.tabs = { graphics: null, controls: null, controller: null, touch: null, sound: null, world: null };
    for (const t of Object.keys(labels) as Tab[]) {
      const body = tabBodies[t];
      if (!body) continue;
      const button = h(`button.pause-tab${only[t] ?? ''}`, { role: 'tab', onclick: () => this.showTab(t) }, labels[t]);
      tabBar.append(button);
      this.tabs[t] = { button, body };
    }

    this.panes = {
      help: h(
        'div.pause-pane',
        {},
        h('section.pause-card', {}, h('h3', {}, 'How to play'), h('div.keys-only.help-keys'), this.padKeys, this.touchKeys),
        h('section.pause-card', {}, h('h3', {}, 'In this game'), this.players),
        game.achievements && Object.keys(game.achievements).length ? h('section.pause-card', {}, this.featsHead, this.feats) : null,
      ),
      settings: h('div.pause-pane.settings', {}, tabBar, ...Object.values(this.tabs).filter((x) => !!x).map((x) => x.body)),
    };

    // Down the left: the game, then what to do.
    const item = (label: string, attrs: Record<string, unknown>, cls = '') => h(`button.pause-item${cls}`, attrs, label);
    const paneItem = (label: string, p: Pane) => {
      const b = item(label, { onclick: () => this.showPane(p) });
      this.navItems.set(p, b);
      return b;
    };
    const invite = item('Invite friends', {}) as HTMLButtonElement;
    invite.onclick = () => copyInvite((text) => {
      invite.textContent = text === 'Link copied' ? 'Link copied!' : 'Copy this link';
      invite.title = text;
      window.setTimeout(() => (invite.textContent = 'Invite friends'), 2000);
    });
    const title = h('h2.pause-title', {}, game.title);
    this.root = h(
      'div.screen.pause-screen.hidden',
      { style: `--game: ${game.accent ?? '#7fd46b'}` },
      h(
        'aside.pause-rail',
        {},
        h('div.pause-head', {}, h('div.pause-kicker', {}, 'Paused'), title, this.roomLine),
        h(
          'nav.pause-nav',
          {},
          item('Resume', { onclick: onResume }, '.primary'),
          paneItem('How to play', 'help'),
          paneItem('Settings', 'settings'),
          invite,
          game.restart ? item('Restart match', { onclick: () => this.onRestart?.() }) : null,
        ),
        h('div.pause-bottom', {}, item('Leave game', { onclick: () => this.onExit?.(), title: 'Back to the games' }, '.leave'), h('div.pause-foot.keys-only', {}, h('kbd', {}, 'F1'), ' hide HUD ', h('kbd', {}, '/'), ' commands'), h('div.pause-foot.pad-only', {}, h('kbd', {}, 'A'), ' select ', h('kbd', {}, 'B'), ' back')),
      ),
      h('section.pause-main', {}, this.panes.help, this.panes.settings),
    );
    parent.append(this.root);
    refreshKeys();
    this.renderFeats();
    this.showTab('graphics');
    this.showPane('help');
  }

  /** What the controller's buttons do in this game (shown while one is in use). */
  setPadHints(hints: [string, string][]) {
    this.game.pad = hints;
    this.padKeys.replaceChildren(hintTable(hints));
  }

  /** What the touch controls do in this game (shown on a touch screen). */
  setTouchHints(hints: [string, string][]) {
    this.touchKeys.replaceChildren(hintTable(hints));
  }

  /** Who's in the game (kept fresh while the menu is up): people by name, bots counted. */
  setPlayers(list: PausePlayer[]) {
    const people = list.filter((p) => !p.bot);
    const bots = list.length - people.length;
    const key = `${people.map((p) => `${p.name}${p.me ? '*' : ''}`).join('\n')}|${bots}`;
    if (key === this.seen) return;
    this.seen = key;
    this.players.replaceChildren(
      ...people.map((p) => h(`span.pause-player${p.me ? '.me' : ''}`, {}, p.name, p.me ? h('small', {}, 'you') : null)),
      ...(bots ? [h('span.pause-player.bots', {}, `+ ${bots} ${bots === 1 ? 'bot' : 'bots'}`)] : []),
    );
    const n = people.length;
    const room = this.game.room ? 'Private game' : 'Public game';
    this.roomLine.replaceChildren(h('span.live-dot'), `${room} · ${n} ${n === 1 ? 'player' : 'players'}`);
  }

  /** Which of the game's achievements the player has (the HUD hears as they join, and each one since). */
  setAchieved(earned: ReadonlySet<string>, kept: boolean) {
    this.earned = earned;
    this.kept = kept;
    this.renderFeats();
  }

  private renderFeats() {
    const all = Object.entries(this.game.achievements ?? {});
    if (!all.length) return;
    const have = all.filter(([id]) => this.earned.has(id)).length;
    this.featsHead.textContent = `Achievements · ${have} of ${all.length}${this.kept ? '' : ' · a guest’s last the visit'}`;
    this.feats.replaceChildren(
      ...all.map(([id, a]) => {
        const done = this.earned.has(id);
        const secret = a.hidden && !done;
        const icon = h(`span.feat-icon${done ? '.done' : ''}`);
        icon.innerHTML = TROPHY;
        return h(`div.feat${done ? '.done' : ''}`, {}, icon, h('div.feat-text', {}, h('div.feat-title', {}, secret ? 'Hidden achievement' : a.title), h('div.feat-desc', {}, secret ? 'Keep playing to find it' : a.description)));
      }),
    );
  }

  private renderHelp() {
    this.panes?.help.querySelector('.help-keys')?.replaceChildren(hintTable(keyHints(this.game)));
  }

  private showPane(p: Pane) {
    this.stopRebinding();
    this.pane = p;
    for (const [k, el] of Object.entries(this.panes)) el.classList.toggle('hidden', k !== p);
    for (const [k, el] of this.navItems) el.classList.toggle('active', k === p);
  }

  private showTab(t: Tab) {
    this.stopRebinding();
    for (const [k, x] of Object.entries(this.tabs)) {
      if (!x) continue;
      x.button.classList.toggle('active', k === t);
      x.body.classList.toggle('hidden', k !== t);
    }
  }

  /** Back (Escape, or a controller's B): from the settings to how to play; `false` when already there. */
  back(): boolean {
    if (this.rebinding) return true;
    if (this.pane === 'help') return false;
    this.showPane('help');
    return true;
  }

  show(time: number) {
    this.timeSlider.value = String(time);
    const clock = this.timeSlider.parentElement?.querySelector('.value');
    if (clock) clock.textContent = clockText(time);
    this.showPane('help');
    this.root.classList.remove('hidden');
  }

  hide() {
    this.stopRebinding();
    this.root.classList.add('hidden');
  }

  get visible(): boolean {
    return !this.root.classList.contains('hidden');
  }
}

/** The time of day (0 midnight, 0.5 noon) on a clock: '6:30 am'. */
function clockText(t: number): string {
  const minutes = Math.round((((t % 1) + 1) % 1) * 24 * 60) % (24 * 60);
  const hh = Math.floor(minutes / 60);
  const mm = minutes % 60;
  return `${hh % 12 || 12}:${String(mm).padStart(2, '0')} ${hh < 12 ? 'am' : 'pm'}`;
}
