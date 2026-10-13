import type { PadAction } from '../api/types';
import type { TouchButton, TouchState } from '../player/touch';
import { h } from './dom';

/** The stick's reach from where the finger came down (CSS pixels, on a phone: a tablet's is bigger, `--touch-zoom`): pushed this far, it's all the way. */
const REACH_PHONE = 56;
/** The stick's reach now (its size goes with the screen's). */
let REACH = REACH_PHONE;
/** Pushed ahead this far (0..1, forward) and all the way out for `SPRINT_HOLD` seconds, the stick sprints... */
const SPRINT_AHEAD = 0.9;
const SPRINT_HOLD = 0.7;
/** ...or dragged on past its ring this far ahead (in reaches) at once. */
const SPRINT_PAST = 1.35;
/** A button's finger, moving less than this before it lets go, was a tap; more, and a looking button turns the view. */
const STILL = 6;

/** What a finger on the screen is doing. */
type Finger =
  | { role: 'stick'; x0: number; y0: number; x: number; y: number }
  | { role: 'look'; x: number; y: number }
  | { role: 'button'; button: TouchButton; el: HTMLElement; x: number; y: number; moved: number };

/** Little pictures for the buttons the platform knows: what fire, aim, jump and crouch look like. */
const ICONS: Partial<Record<string, string>> = {
  fire: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="7" fill="none" stroke="currentColor" stroke-width="2"/><path d="M12 2v5M12 17v5M2 12h5M17 12h5" stroke="currentColor" stroke-width="2"/></svg>',
  aim: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="8" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="12" cy="12" r="2.5" fill="currentColor"/></svg>',
  jump: '<svg viewBox="0 0 24 24"><path d="M5 14l7-7 7 7" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  crouch: '<svg viewBox="0 0 24 24"><path d="M5 10l7 7 7-7" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  more: '<svg viewBox="0 0 24 24"><circle cx="5" cy="12" r="2.2" fill="currentColor"/><circle cx="12" cy="12" r="2.2" fill="currentColor"/><circle cx="19" cy="12" r="2.2" fill="currentColor"/></svg>',
  switch: '<svg viewBox="0 0 24 24"><path d="M4 9h13l-3-3M20 15H7l3 3" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  pause: '<svg viewBox="0 0 24 24"><rect x="6" y="5" width="4" height="14" rx="1" fill="currentColor"/><rect x="14" y="5" width="4" height="14" rx="1" fill="currentColor"/></svg>',
};

/**
 * The touch controls (phones and tablets), over the game while it has them: a stick wherever the
 * left thumb comes down (pushed all the way ahead it sprints), the rest of the screen to look
 * (as the mouse would), the game's buttons (player/touch.ts: its controller layout's jobs) in the
 * right thumb's reach, and a pause button. A tap on something of the HUD's that's for tapping (a
 * hotbar slot, a button, anything marked `data-touch-key`) goes to it instead.
 *
 * Each frame the runtime `read`s what the fingers hold and gives it to `Input.applyTouch`.
 */
export class TouchControls {
  readonly root = h('div.touch', { 'aria-hidden': 'true' });
  private buttonsEl = h('div.touch-buttons');
  private base = h('div.touch-stick');
  private knob = h('div.touch-knob');
  private sprintEl = h('div.touch-sprint', {}, 'Sprint');
  /** The drawer of the buttons used less (`more`), and its button. */
  private drawer = h('div.touch-drawer');
  private moreBtn = h('button.touch-more', { type: 'button', 'aria-label': 'More' });
  private fingers = new Map<number, Finger>();
  private lookDX = 0;
  private lookDY = 0;
  private taps: string[] = [];
  private sprinting = false;
  /** Since when the stick's been all the way ahead (null: it isn't). */
  private aheadSince: number | null = null;
  /** The pause button. */
  onPause: (() => void) | null = null;

  constructor(parent: HTMLElement, signal?: AbortSignal) {
    const pause = h('button.touch-pause', { type: 'button', 'aria-label': 'Pause' });
    pause.innerHTML = ICONS.pause!;
    pause.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      this.onPause?.();
    }, { signal });
    this.moreBtn.innerHTML = ICONS.more!;
    this.moreBtn.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      this.root.classList.toggle('drawer-open');
    }, { signal });
    this.base.append(this.knob, this.sprintEl);
    this.root.append(this.base, this.buttonsEl, this.drawer, this.moreBtn, pause);
    // Upright, the game's cramped: turn the phone sideways (or play on like that, if they'd rather).
    const rotate = h(
      'div.touch-rotate',
      {},
      h('div.touch-rotate-phone'),
      h('div.touch-rotate-text', {}, 'Turn your phone sideways'),
      h('button.touch-rotate-anyway', { type: 'button', onclick: () => document.body.classList.add('upright-ok') }, 'Play upright anyway'),
    );
    parent.append(this.root, rotate);
    const opts = { signal };
    this.root.addEventListener('pointerdown', (e) => this.down(e as PointerEvent), opts);
    this.root.addEventListener('pointermove', (e) => this.move(e as PointerEvent), opts);
    this.root.addEventListener('pointerup', (e) => this.up(e as PointerEvent), opts);
    this.root.addEventListener('pointercancel', (e) => this.up(e as PointerEvent), opts);
    this.root.addEventListener('lostpointercapture', (e) => this.up(e as PointerEvent), opts);
    // No scrolling, zooming or the long-press menu over the game.
    this.root.addEventListener('touchstart', (e) => e.preventDefault(), { passive: false, signal });
    this.root.addEventListener('contextmenu', (e) => e.preventDefault(), opts);
    // Safari's own pinch (its gesture events) while the game has the touch controls.
    document.addEventListener('gesturestart', (e) => document.body.classList.contains('touch-playing') && e.preventDefault(), { passive: false, signal });
    this.rest();
  }

  /** The game's buttons (player/touch.ts). */
  setButtons(buttons: TouchButton[]) {
    this.release();
    const more = buttons.filter((b) => b.slot === 'more');
    this.moreBtn.style.display = more.length ? '' : 'none';
    this.drawer.replaceChildren(
      ...more.map((b) => {
        const el = h('div.touch-btn.touch-pill', { title: b.title }, h('span.touch-label', {}, b.title));
        (el as HTMLElement & { touchButton?: TouchButton }).touchButton = b;
        return el;
      }),
    );
    this.buttonsEl.replaceChildren(
      ...buttons.filter((b) => b.slot !== 'more').map((b) => {
        const el = h(`div.touch-btn.${b.slot}`, { title: b.title });
        el.dataset.index = String(b.index);
        const icon = b.action === 'next' ? ICONS.switch : ICONS[b.slot];
        if (icon) el.innerHTML = icon;
        el.append(h('span.touch-label', {}, b.label));
        (el as HTMLElement & { touchButton?: TouchButton }).touchButton = b;
        return el;
      }),
    );
  }

  /** Shown (the touch controls have the game) or not: hidden, every finger lets go. */
  setActive(on: boolean) {
    if (!on) this.release();
    else REACH = REACH_PHONE * (Number(getComputedStyle(document.documentElement).getPropertyValue('--touch-zoom')) || 1);
  }

  /**
   * The game's starting on a touch screen (Play was tapped: the browser lets a tap do this): the
   * whole screen, held sideways, where the browser allows it (Android; an iPhone keeps its bars).
   */
  static async fill() {
    const el = document.documentElement as HTMLElement & { webkitRequestFullscreen?: () => void };
    try {
      if (!document.fullscreenElement && el.requestFullscreen) await el.requestFullscreen({ navigationUI: 'hide' });
      else if (!document.fullscreenElement) el.webkitRequestFullscreen?.();
    } catch {
      // (not allowed here: an iPhone, or an embedded page)
    }
    try {
      await (screen.orientation as ScreenOrientation & { lock?: (o: string) => Promise<void> }).lock?.('landscape');
    } catch {
      // (not allowed: not full screen, or a desktop)
    }
  }

  /** What the fingers hold this frame (look movement and taps start over). */
  read(): TouchState {
    const held: PadAction[] = [];
    let move: [number, number] | null = null;
    let looking = false;
    for (const f of this.fingers.values()) {
      if (f.role === 'button') {
        held.push(f.button.action);
        if (f.button.looks && f.moved >= STILL) looking = true;
      } else if (f.role === 'look') looking = true;
      else {
        const dx = (f.x - f.x0) / REACH;
        const dy = (f.y0 - f.y) / REACH;
        const m = Math.hypot(dx, dy);
        move = m > 1 ? [dx / m, dy / m] : [dx, dy];
        // A little dead zone in the middle.
        if (m < 0.12) move = [0, 0];
      }
    }
    if (this.aheadSince !== null && performance.now() - this.aheadSince > SPRINT_HOLD * 1000) this.sprinting = true;
    if (!move || move[1] < 0.35) {
      this.sprinting = false;
      this.aheadSince = null;
    }
    this.base.classList.toggle('sprinting', this.sprinting);
    const out: TouchState = { held, move, sprint: this.sprinting, look: [this.lookDX, this.lookDY], looking, taps: this.taps };
    this.lookDX = 0;
    this.lookDY = 0;
    this.taps = [];
    return out;
  }

  private down(e: PointerEvent) {
    if (e.pointerType === 'mouse') return;
    e.preventDefault();
    const x = e.clientX;
    const y = e.clientY;
    // One of the game's buttons.
    const btn = (e.target as HTMLElement).closest('.touch-btn') as (HTMLElement & { touchButton?: TouchButton }) | null;
    if (btn?.touchButton) {
      btn.classList.add('held');
      this.fingers.set(e.pointerId, { role: 'button', button: btn.touchButton, el: btn, x, y, moved: 0 });
      this.capture(e);
      return;
    }
    // Something of the HUD's to tap (a hotbar slot, a button, a widget marked with its key).
    if (this.tapThrough(x, y)) return;
    const w = window.innerWidth;
    // The left of the screen (below its top strip) walks; the rest looks.
    if (x < w * 0.42 && y > window.innerHeight * 0.2 && ![...this.fingers.values()].some((f) => f.role === 'stick')) {
      this.fingers.set(e.pointerId, { role: 'stick', x0: x, y0: y, x, y });
      this.base.classList.add('on');
      this.base.style.transform = `translate(${x}px, ${y}px)`;
      this.knob.style.transform = '';
    } else this.fingers.set(e.pointerId, { role: 'look', x, y });
    this.capture(e);
  }

  private move(e: PointerEvent) {
    const f = this.fingers.get(e.pointerId);
    if (!f) return;
    // Every movement since the last event (a fast swipe's coalesced ones too).
    const events = typeof e.getCoalescedEvents === 'function' ? e.getCoalescedEvents() : [];
    const last = events.length ? events[events.length - 1] : e;
    const x = last.clientX;
    const y = last.clientY;
    if (f.role === 'stick') {
      f.x = x;
      f.y = y;
      let dx = x - f.x0;
      let dy = y - f.y0;
      const m = Math.hypot(dx, dy);
      // Dragged on past the ring ahead: sprint (and the ring follows the thumb, so letting it back eases off at once).
      if (-dy / REACH > SPRINT_PAST && Math.abs(dx) < -dy) this.sprinting = true;
      if (m > REACH) {
        const over = m - REACH;
        f.x0 += (dx / m) * over;
        f.y0 += (dy / m) * over;
        dx = x - f.x0;
        dy = y - f.y0;
        this.base.style.transform = `translate(${f.x0}px, ${f.y0}px)`;
      }
      if (Math.hypot(dx, dy) >= REACH * 0.98 && -dy / REACH > SPRINT_AHEAD) this.aheadSince ??= performance.now();
      else this.aheadSince = null;
      this.knob.style.transform = `translate(${dx}px, ${dy}px)`;
      return;
    }
    const dx = x - f.x;
    const dy = y - f.y;
    f.x = x;
    f.y = y;
    if (f.role === 'button') {
      f.moved += Math.abs(dx) + Math.abs(dy);
      if (!f.button.looks || f.moved < STILL) return;
    }
    this.lookDX += dx;
    this.lookDY += dy;
  }

  private up(e: PointerEvent) {
    const f = this.fingers.get(e.pointerId);
    if (!f) return;
    this.fingers.delete(e.pointerId);
    if (f.role === 'button') {
      f.el.classList.remove('held');
      // A drawer's button pressed and let go: the drawer shuts.
      if (f.button.slot === 'more') this.root.classList.remove('drawer-open');
    }
    if (f.role === 'stick') this.rest();
  }

  /**
   * A tap on something of the HUD's for tapping, under the touch controls: true if there was one.
   * (The HUD lets the mouse through, so it's found by where things are, not by hit testing.)
   */
  private tapThrough(x: number, y: number): boolean {
    const under = (el: Element) => {
      if (this.root.contains(el)) return false;
      const r = el.getBoundingClientRect();
      if (!r.width || !r.height || x < r.left - 4 || x > r.right + 4 || y < r.top - 4 || y > r.bottom + 4) return false;
      const style = getComputedStyle(el);
      return style.visibility !== 'hidden' && (el as HTMLElement).offsetParent !== null && style.opacity !== '0';
    };
    const ui = this.root.parentElement ?? document.body;
    for (const el of ui.querySelectorAll('[data-touch-key]')) {
      if (!under(el)) continue;
      this.taps.push((el as HTMLElement).dataset.touchKey!);
      return true;
    }
    const slots = [...ui.querySelectorAll('.hotbar .slot')];
    const slot = slots.findIndex(under);
    if (slot >= 0) {
      this.taps.push(`Digit${slot + 1}`);
      return true;
    }
    for (const el of ui.querySelectorAll('button, a[href], [role="button"]')) {
      if (!under(el)) continue;
      (el as HTMLElement).click();
      return true;
    }
    return false;
  }

  private capture(e: PointerEvent) {
    try {
      this.root.setPointerCapture(e.pointerId);
    } catch {
      // (a finger already gone)
    }
  }

  /** The stick at rest: faded, low on the left, where a thumb would go. */
  private rest() {
    this.base.classList.remove('on', 'sprinting');
    this.base.style.transform = '';
    this.knob.style.transform = '';
    this.sprinting = false;
    this.aheadSince = null;
  }

  /** Every finger lets go (the controls hidden, a menu over them). */
  private release() {
    for (const f of this.fingers.values()) if (f.role === 'button') f.el.classList.remove('held');
    this.fingers.clear();
    this.lookDX = 0;
    this.lookDY = 0;
    this.taps = [];
    this.root.classList.remove('drawer-open');
    this.rest();
  }
}
