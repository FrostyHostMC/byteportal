// The home page, as an uploaded game's sandboxed frame sees it: each call the runtime makes goes
// to the page around the frame (which has the real one: ui/frame-host.ts), and what the page says
// back (Play, a room of one's own, the name to play as) comes in. See client/frame-protocol.ts.
import type { PackageEntry } from '../package/link';
import type { HomeGame, HomeScreen } from '../ui/home';
import type { FrameToShell, ShellToFrame } from './frame-protocol';

export class RemoteTitle implements HomeScreen {
  /** (Nothing of the home page is in the frame: the runtime keeps this when it clears its HUD.) */
  readonly root = document.createElement('div');
  onListed: ((entries: PackageEntry[]) => void) | null = null;
  private game: HomeGame | null = null;
  private onPick: ((id: string) => void) | null = null;
  private played = { name: '', avatar: '' };
  private waiting = new Map<number, (value: unknown) => void>();
  private next = 0;

  constructor(private send: (m: FrameToShell) => void) {}

  /** A message from the page. */
  receive(m: ShellToFrame) {
    if (m.t === 'play') {
      this.played = { name: m.name, avatar: m.avatar };
      this.game?.onPlay();
    } else if (m.t === 'room') this.game?.online?.onRoom?.(m.own);
    else if (m.t === 'reply') {
      this.waiting.get(m.id)?.(m.value);
      this.waiting.delete(m.id);
    } else if (m.t === 'init') this.played = { name: m.name, avatar: m.avatar };
  }

  /** Ask the page something, and wait for its answer. */
  ask<T>(make: (id: number) => FrameToShell): Promise<T> {
    const id = ++this.next;
    return new Promise<T>((done) => {
      this.waiting.set(id, done as (value: unknown) => void);
      this.send(make(id));
    });
  }

  show(g: HomeGame) {
    this.game = g;
    const { onPlay: _play, onPick, online, ...rest } = g;
    this.onPick = onPick;
    this.send({ t: 'show', game: { ...rest, online: online ? { server: online.server, game: online.game, room: online.room, rooms: !!online.onRoom } : null } });
  }

  select(id: string, title?: string) {
    this.send({ t: 'select', id, title });
  }

  progress(fraction: number, text: string) {
    this.send({ t: 'progress', fraction, text });
  }

  setReady() {
    this.send({ t: 'setReady' });
  }

  present(names: string[]) {
    this.send({ t: 'present', names });
  }

  failed(text: string, onPick: (id: string) => void) {
    this.onPick = onPick;
    this.send({ t: 'failed', text });
  }

  busy(text: string, seconds: number): Promise<string | null> {
    return this.ask<string | null>((id) => ({ t: 'busy', id, text, seconds }));
  }

  hide() {
    this.send({ t: 'hide' });
  }

  name(): string {
    return this.played.name;
  }

  avatar(): string {
    return this.played.avatar;
  }

  /** (A pick on the page goes to the page; the frame never switches to another game itself.) */
  get picked(): ((id: string) => void) | null {
    return this.onPick;
  }
}
