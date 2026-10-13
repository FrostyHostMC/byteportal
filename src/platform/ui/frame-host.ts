// An uploaded game's screen, in a sandboxed frame (docs/PROPOSAL-OPEN-UPLOADS.md, stage 3): the
// page around it (this) keeps the home page, the account and sign-in; the frame runs the game (its
// world, its code, its HUD and pause menu) at an opaque origin, with no cookie, no storage and no
// reach into this page. They talk only by messages (client/frame-protocol.ts): the frame's home
// page calls drive the real one here; Play, a room of one's own and the name to play as go back;
// the frame asks this page for room tickets (to connect as the signed-in player), for its settings
// to be kept and for invite links. A fresh frame for each uploaded game; picking another game
// closes it (a built-in one runs in this page again, with the renderer it left).
import { isHandheld } from '../settings';
import { TouchControls } from './touch';
import { FRAME_KEPT, type FrameToShell, type ShellToFrame } from '../client/frame-protocol';
import { webOrigin } from '../client/packaged';
import { Runtime, type FrameOpen } from '../runtime';
import type { TitleScreen } from './home';

/** The frame's page: on this site, but an opaque origin by its sandbox. */
const FRAME_PAGE = '/frame.html';

export class FrameHost {
  private frame: HTMLIFrameElement | null = null;
  private open: FrameOpen | null = null;
  private loads = 0;
  private armed = false;

  constructor() {
    window.addEventListener('message', (e) => {
      if (this.frame && e.source === this.frame.contentWindow) this.receive(e.data as FrameToShell);
    });
    window.addEventListener('resize', () => this.arm());
  }

  /** Run an uploaded game in a frame of its own (`Runtime.frames`). */
  start(o: FrameOpen) {
    this.close();
    this.open = o;
    const url = new URL(FRAME_PAGE, location.href);
    url.searchParams.set('game', o.id);
    url.searchParams.set('server', o.server);
    if (o.room) url.searchParams.set('room', o.room);
    if (o.shard > 1) url.searchParams.set('shard', String(o.shard));
    const frame = document.createElement('iframe');
    frame.className = 'game-frame';
    frame.title = 'Game';
    // Scripts and pointer lock; not `allow-same-origin` (an opaque origin: no cookie, no storage,
    // no reach into this page), no popups, no navigating this page.
    frame.setAttribute('sandbox', 'allow-scripts allow-pointer-lock');
    frame.setAttribute('allow', 'pointer-lock; gamepad; fullscreen; autoplay; clipboard-write');
    this.loads = 0;
    // A frame that goes to another page (the game navigated it) is closed: only ours runs there.
    frame.addEventListener('load', () => {
      if (++this.loads > 1) this.leave('The game left its page');
    });
    frame.src = url.href;
    o.canvas.classList.add('framed-away');
    document.body.classList.add('framed');
    o.ui.parentElement!.insertBefore(frame, o.ui);
    this.frame = frame;
  }

  private get title(): TitleScreen {
    return this.open!.carry.title as TitleScreen;
  }

  private post(m: ShellToFrame) {
    // (An opaque origin can only be addressed as '*': the message goes to this frame's window alone.)
    this.frame?.contentWindow?.postMessage(m, '*');
  }

  private receive(m: FrameToShell) {
    const o = this.open;
    if (!o) return;
    const title = this.title;
    switch (m.t) {
      case 'ready': {
        const kept: Record<string, string> = {};
        for (const key of FRAME_KEPT) {
          try {
            const v = localStorage.getItem(key);
            if (v !== null) kept[key] = v;
          } catch {
            // (no storage: nothing kept)
          }
        }
        this.post({ t: 'init', kept, name: title.name(), avatar: title.avatar() });
        return;
      }
      case 'show': {
        const g = m.game;
        title.show({
          ...g,
          online: g.online ? { server: g.online.server, game: g.online.game, room: g.online.room, onRoom: g.online.rooms ? (own) => this.post({ t: 'room', own }) : undefined } : null,
          onPlay: () => this.post({ t: 'play', name: title.name(), avatar: title.avatar() }),
          onPick: (id) => this.pick(id),
        });
        this.arm();
        return;
      }
      case 'select':
        return title.select(m.id, m.title);
      case 'progress':
        return title.progress(m.fraction, m.text);
      case 'setReady':
        title.setReady();
        return this.arm();
      case 'present':
        return title.present(m.names);
      case 'failed':
        return title.failed(m.text, (id) => this.pick(id));
      case 'busy':
        void title.busy(m.text, m.seconds).then((value) => this.post({ t: 'reply', id: m.id, value }));
        return;
      case 'hide':
        title.hide();
        this.arm();
        // The game has the keys now.
        this.frame?.focus();
        return;
      case 'press':
        // (Only while the button may be pressed: a frame can't press it at will.)
        if (!this.armed) return;
        // A phone: the whole screen, sideways (the tap in the frame lets this page ask too).
        if (isHandheld()) void TouchControls.fill();
        title.press();
        return;
      case 'address': {
        const at = new URL(location.href);
        at.searchParams.set('game', m.game);
        if (m.room) at.searchParams.set('room', m.room);
        else at.searchParams.delete('room');
        if (m.shard && m.shard > 1) at.searchParams.set('shard', String(m.shard));
        else at.searchParams.delete('shard');
        history.replaceState(null, '', at);
        return;
      }
      case 'keep':
        if (FRAME_KEPT.includes(m.key)) {
          try {
            localStorage.setItem(m.key, m.value);
          } catch {
            // (no storage: not kept)
          }
        }
        return;
      case 'ticket':
        void this.ticket(m.game).then((value) => this.post({ t: 'reply', id: m.id, value }));
        return;
      case 'invite':
        return this.post({ t: 'reply', id: m.id, value: location.href });
    }
  }

  /** A room ticket for the signed-in player (null: a guest, or none to be had). */
  private async ticket(game: string): Promise<string | null> {
    if (!this.open || game !== this.open.id) return null;
    const r = await fetch(`${webOrigin(this.open.server)}/tickets`, { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ game }) }).catch(() => null);
    if (!r?.ok) return null;
    return ((await r.json()) as { ticket?: string }).ticket ?? null;
  }

  /**
   * Tell the frame where the Play button is while it may be pressed (the click falls through the
   * button to the frame, which needs a click of its own to lock the pointer), and nothing when not.
   */
  private arm() {
    if (!this.open) return;
    const r = this.title.playRect();
    this.armed = !!r;
    this.post({ t: 'playButton', rect: r ? { x: r.x, y: r.y, w: r.width, h: r.height } : null });
  }

  /** Another game picked: this frame goes; the game runs in this page (built in) or a frame of its own (uploaded). */
  private pick(id: string) {
    const o = this.open;
    if (!o) return;
    this.close();
    const url = new URL(location.href);
    url.searchParams.set('game', id);
    for (const p of ['room', 'shard']) url.searchParams.delete(p);
    history.replaceState(null, '', url);
    o.carry.title.select(id);
    Runtime.start(o.canvas, o.ui, o.games, o.hidden, o.carry).catch((err: unknown) => {
      console.error(err);
      o.carry.title.failed(err instanceof Error ? err.message : String(err), (next) => this.pick(next));
    });
  }

  /** The frame went wrong (left its page): it goes, and the home page says so. */
  private leave(why: string) {
    const o = this.open;
    this.close();
    if (o) o.carry.title.failed(why, (id) => ((this.open = o), this.pick(id)));
  }

  close() {
    if (!this.frame || !this.open) return;
    this.frame.remove();
    this.frame = null;
    this.open.canvas.classList.remove('framed-away');
    document.body.classList.remove('framed');
    this.armed = false;
    this.open = null;
  }
}
