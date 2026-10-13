// An uploaded game's screen, in a sandboxed frame (frame.html, docs/PROPOSAL-OPEN-UPLOADS.md stage
// 3): an opaque origin with no cookie, no storage and no reach into the page around it. It runs the
// game's runtime as a page of the site's would, but its home page is the page's (it sends each call
// there: client/remote-title.ts), its settings are kept by the page, it connects with room tickets
// the page asks for, and it tells the page its address. See ui/frame-host.ts for the page's side.
import { isHandheld } from './platform/settings';
import type { FrameToShell, ShellToFrame } from './platform/client/frame-protocol';
import { RemoteTitle } from './platform/client/remote-title';
import { reportErrors } from './platform/client/errors';
import { keepWith } from './platform/client/storage';
import { Runtime } from './platform/runtime';
import { invite } from './platform/ui/home';
import { games } from './games/browser';

// In development, `__game` is the frame's runtime (tests reach in), as in a page of the site's.
if (import.meta.env.DEV) Runtime.onStart = (rt) => ((window as unknown as { __game: Runtime }).__game = rt);

// What goes wrong in the game here is reported to the game server, as its own (client/errors.ts).
reportErrors('frame');

// A phone or tablet: the touch controls' hints and settings from the start (the runtime keeps it up to date).
document.body.classList.toggle('touch-mode', isHandheld());

const canvas = document.getElementById('view') as HTMLCanvasElement;
const ui = document.getElementById('ui') as HTMLElement;
const shell = (m: FrameToShell) => parent.postMessage(m, '*');
const title = new RemoteTitle(shell);

// Settings: what the page gave, each change sent back for it to keep.
const kept = new Map<string, string>();
keepWith({
  get: (key) => kept.get(key) ?? null,
  set: (key, value) => {
    kept.set(key, value);
    shell({ t: 'keep', key, value });
  },
});
Runtime.ticket = (game) => title.ask<string | null>((id) => ({ t: 'ticket', id, game }));
invite.address = () => title.ask<string>((id) => ({ t: 'invite', id }));

// The frame's address (the game, its room, its copy) is the page's to show.
const replace = history.replaceState.bind(history);
history.replaceState = (data, unused, url) => {
  replace(data, unused, url);
  const at = new URL(location.href);
  shell({ t: 'address', game: at.searchParams.get('game') ?? '', room: at.searchParams.get('room'), shard: Number(at.searchParams.get('shard')) || null });
};

// The home page's Play button lets clicks through to here (pointer lock needs a click in this
// frame): one there presses it. While the home page is up, nothing else here takes a click.
let playButton: { x: number; y: number; w: number; h: number } | null = null;
let playing = false;
document.addEventListener(
  'pointerdown',
  (e) => {
    if (playing) return;
    const r = playButton;
    if (r && e.clientX >= r.x && e.clientX <= r.x + r.w && e.clientY >= r.y && e.clientY <= r.y + r.h) shell({ t: 'press' });
    e.stopPropagation();
    e.preventDefault();
  },
  true,
);
if (import.meta.env.DEV) (window as unknown as { __frame: unknown }).__frame = { get playButton() { return playButton; }, get playing() { return playing; } };
const show = title.show.bind(title);
title.show = (g) => ((playing = false), show(g));
const hide = title.hide.bind(title);
title.hide = () => ((playing = true), hide());

let started = false;
window.addEventListener('message', (e) => {
  if (e.source !== parent) return;
  const m = e.data as ShellToFrame;
  if (m.t === 'playButton') playButton = m.rect;
  else title.receive(m);
  if (m.t === 'init' && !started) {
    started = true;
    for (const [key, value] of Object.entries(m.kept)) kept.set(key, value);
    Runtime.start(canvas, ui, games, [], { title }).catch((err: unknown) => {
      console.error(err);
      title.failed(err instanceof Error ? err.message : String(err), () => {});
    });
  }
});
shell({ t: 'ready' });
