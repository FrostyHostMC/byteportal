import { isHandheld } from './platform/settings';
import { Refused } from './platform/client/link';
import { Runtime } from './platform/runtime';
import { nameTicket } from './platform/ui/account';
import { FrameHost } from './platform/ui/frame-host';
import { reportErrors } from './platform/client/errors';
import { devGames, games } from './games/browser';

const canvas = document.getElementById('view') as HTMLCanvasElement;
const ui = document.getElementById('ui') as HTMLElement;

// In development, `__game` is the running game (tests reach in); switching games replaces it.
if (import.meta.env.DEV) Runtime.onStart = (rt) => ((window as unknown as { __game: Runtime }).__game = rt);

// What goes wrong here is reported to the game server (client/errors.ts).
reportErrors('page');

// A phone or tablet: the touch controls' hints and settings from the start (the runtime keeps it up to date).
document.body.classList.toggle('touch-mode', isHandheld());

// Uploaded games run in a sandboxed frame (their code never runs in this page: ui/frame-host.ts).
const frames = new FrameHost();
Runtime.frames = (o) => frames.start(o);
// A name locked in on the home page: the game connection carries it (a ticket for the room).
Runtime.ticket = nameTicket;

// The catalog: each game's meta, and its client code loaded when it's picked. Development games
// open by id (`?game=gallery`) and aren't in a production build at all.
(import.meta.env.DEV ? devGames() : Promise.resolve([]))
  .then((hidden) => Runtime.start(canvas, ui, games, hidden))
  .catch((err: unknown) => {
    console.error(err);
    // Turned away by the server: the home page has said why.
    if (err instanceof Refused) return;
    const box = document.createElement('div');
    box.className = 'screen';
    const msg = document.createElement('div');
    msg.className = 'error-box';
    msg.textContent = `Failed to start the engine.\n\n${err instanceof Error ? `${err.message}\n\n${err.stack ?? ''}` : String(err)}\n\nThis game needs a browser with WebGL2 and WebAssembly SIMD (recent Chrome, Edge, Firefox or Safari).`;
    box.append(msg);
    ui.replaceChildren(box);
  });
