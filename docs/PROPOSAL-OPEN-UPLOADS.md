# Proposal: open uploads (anyone may upload a game)

Status: **all four stages built** (2026-10-04; see each stage's "what was built"). Opening uploads to
everyone is one setting (`UPLOADERS=*`), left for the owner to turn on after reviewing the terms. Follows `PROPOSAL-UPLOADS.md`, which built
uploads for trusted people only.

## Why it's not open yet

An uploaded game runs with the platform's own power, which is fine only while every uploader is
trusted:

- **On the server**, its room's worker thread reaches everything the server process can: the
  Discord client secret in the environment, `accounts.sqlite` and every game's data on the volume,
  the network, other programs. A room that loops forever holds a core and a room slot until the
  server restarts (nothing stops it).
- **While it's built**, the packager ran the game's `meta.ts` in the server's main thread.
- **In players' browsers**, its client code runs on blockyard.gg as the signed-in player: it can
  call `DELETE /me`, rename them, mint an upload token as them, manage their games, or draw a fake
  sign-in.

## Decisions (the owner's, 2026-10-04)

1. **A second Fly machine for the sandbox: yes.**
2. **The home page is approval only.** Everything else that's hosted can be found in a **community
   directory** (a page of its own).
3. **Admin tooling on the site, for the owner's Discord id only** (`ADMINS`).

## The design

### Visibility

A hosted game is one of:

| | Who finds it | Who decides |
|---|---|---|
| **Link only** | whoever has its link | its owners (the default for a new game) |
| **In the directory** | anyone, on the community directory | its owners |
| **On the home page** | everyone, on the shelf | an admin approves an owner's request |

Approval is for the game, not a version: an approved game's new versions stay on the home page
(its owners have been trusted once); an admin can take it off again.

### Admin tooling (stage 1)

`ADMINS` (Discord or account ids; on Fly: the owner's) see an **Admin** tab in Your games:

- every uploaded game: its owners, state, versions, reports; **approve or decline** a request for
  the home page, **take one off** the home page or the directory, **stop hosting** any game;
- **reports** from players (a "Report this game" on an uploaded game's page), to resolve;
- **bans**: a banned account can't upload or manage games (and their games can be unhosted);
- **recent activity**: uploads, refusals and changes, newest first.

An admin may manage any game as its owners can.

### The server sandbox (stage 2)

Uploaded games' rooms (and their smoke tests) run on a **sandbox machine** with no secrets and no
volume: a process per room, as an unprivileged user under Node's permission model (it reads its own
code only, starts no programs), its outbound network firewalled. The main server keeps the sockets,
accounts and data, and relays each room's messages (the room boundary is already messages only).
A room's `game.store` becomes a copy loaded when it starts and saved back through the relay. The
main server's games stay where they are.

### The browser sandbox (stage 3)

See "Stage 3 in detail" below: an uploaded game's screen runs in a sandboxed iframe with an opaque
origin, served from blockyard.gg itself (no second domain needed); it joins with a room ticket.

### Opening up (stage 4)

Any signed-in Discord account may upload, within **quotas** (games, versions and storage per
account; uploads per hour; a build queue a flood can't block) and a **pool of rooms** of its own
for uploaded games, so they never crowd out the built-in ones. Plus terms of service and a
takedown route.

## Plan

1. **Admin, visibility and reports; the quick fixes**: `ADMINS`; link only / directory / home page
   with approval; the community directory page; reports; bans; activity; a watchdog for rooms that
   stop responding (every room); no game code in the main thread while building (its id is read
   from `meta.ts` as text).
2. **The sandbox machine** and the relay.
3. **The browser sandbox**: shell and game frame, room tickets.
4. **Open uploads**: quotas, the room pool, terms.

## Stage 1: what was built

- **Visibility**: `listed` now means "in the community directory"; `home` (asked, approved,
  declined) gates the home page. `/games` lists only approved games; `GET /g/directory` lists
  those in the directory and not on the home page. Owners put a game in the directory and ask for
  the home page from Your games; the directory is the shelf's last card ("Community games") and
  `?directory`.
- **Admin** (`ADMINS`; on Fly the owner's Discord id): an Admin tab in Your games with requests
  for the home page (approve, decline), reports (resolve, stop hosting), every game (take it off
  the home page or out of the directory, stop hosting, host the newest), bans by name (optionally
  stopping their games; an admin can't be banned) and the last activity (`<data>/games/
  activity.jsonl`). Admins may manage any game.
- **Reports**: "Report this game" under an uploaded game on the home page, for players signed in
  or not (five per address per ten minutes), kept in `accounts.sqlite`.
- **Bans** in `accounts.sqlite`: a banned account may neither upload nor manage.
- **The watchdog**: a room's thread says it's alive every 2 s; one quiet for 30 s (or not started
  in 2 minutes) is terminated and its players told "The game stopped responding". Every room.
- **No game code in the main thread while building**: meta.ts's id and title are read as text.
- **Development rooms' threads no longer start a Vite of their own**: they run Vite's module
  runner, compiled by the starting thread's Vite over a message channel (`scripts/dev-worker.mjs`).
  Terminating a thread holding Vite's native bundler aborted the whole process (found testing the
  watchdog); a bare `room-worker-dev.mjs` still starts its own.

## Stage 2: the sandbox machine

- **`voxel-sandbox`** (fly.sandbox.toml): the game server's image running `dist-sandbox/sandbox.js`
  (src/sandbox.ts, bundled by esbuild in scripts/build-sandbox.mjs: the platform's server code, no
  games), performance-1x 2 GB, one machine, Flycast only (`ws://voxel-sandbox.flycast`, no public
  address), stopped when idle. Its one secret, `SANDBOX_TOKEN`, is the game server's too. CI deploys
  it before the game server (`deploy-server.mjs --sandbox`, secret `FLY_SANDBOX_TOKEN`: a deploy
  token for that app only).
- **The supervisor** takes one authenticated WebSocket from the game server (a new one replaces it
  and its rooms go) and starts a process per room and per smoke test: `unshare --net` (a network
  namespace with nothing in it), `setpriv` (a uid of its own per room, 20000 up, no new
  privileges, no groups), Node's permission model (reads the app and its room's folder, 0700 and its
  own; writes nothing; no processes, threads or addons), a 256 MB heap and a clean environment. It
  runs a probe before starting (no network, its own uid, can't read the supervisor's) and refuses to
  start at `full` isolation if any fails. Checked on Fly: it passes.
- **The game server's link** (`host/sandbox-link.ts`) opens when an uploaded room or smoke test
  needs it, speaks a version (both ends must match), refuses less than full isolation outside
  development, and closes after 5 idle minutes (so the sandbox machine stops). A room's run sends
  the game's built code and a snapshot of its store; the room's store (`RelayStore`) reads that and
  sends every change back, which the game server keeps in the game's SQLite. The watchdog and
  everything else are as for a worker.
- **Checked** in a Linux container at full isolation: a probe game saw a clean environment
  (`PATH`, `NODE_ENV`), uid 20000, `ENETUNREACH`, and access denied reading the supervisor's
  environment; Call of Blocky played through it (bots, the killcam). `tests/headless/
  sandboxed-rooms.ts` runs the real bundle at `permission` isolation (any machine).
- Without `SANDBOX_URL` (development), uploaded rooms run in worker threads as before.

## Stage 3 in detail: the browser sandbox

### What a spike in Chrome showed (2026-10-04)

A page with `<iframe sandbox="allow-scripts allow-pointer-lock">` (no `allow-same-origin`), its
frame served from the page's own site, and a "game server" on another port that had set a session
cookie (`HttpOnly; SameSite=Lax`, as play.blockyard.gg's is):

| In the frame | Result |
|---|---|
| its origin | `null` (opaque): it's no page of the site's, whatever its URL |
| `document.cookie`, `localStorage`, `parent.document` | `SecurityError` each |
| `top.location = …`, `window.open(…)` | refused, blocked |
| a request to the game server with credentials | sent with `Origin: null` and **no cookie** (the page's own request carried it) |
| `import()` of a module from the site (served with `Access-Control-Allow-Origin: *`) | works |
| WebGL2 | works |
| `new Worker(url)` | `SecurityError` (not same-origin) |
| a module worker from a `blob:` URL (importing, inline or fetched code) | fails |
| a module worker from a `data:` URL that imports the worker's code | **works** |

So the sandbox attribute alone gives the isolation needed, and the frame can come from
blockyard.gg (`/frame.html`): **no second domain**. The one change for workers: start them from a
`data:` URL (`import "<the worker's address>"`) rather than by URL or blob, the platform's engine
workers and games' workers alike.

### The shape

- **Built-in games stay as they are**: in the page, switching in place.
- **An uploaded game runs in a frame**: the home page (the shell) stays in the page, with the
  account, sign-in, Your games, the directory and the locker; behind it, where the canvas is, an
  iframe (`/frame.html`, sandboxed: `allow-scripts allow-pointer-lock`; `allow="pointer-lock;
  gamepad; fullscreen; autoplay; clipboard-write"`) runs the runtime: the world, the game's client
  code, its HUD, the pause menu. A new frame for each uploaded game (switching away destroys it),
  so nothing an uploaded game leaves behind reaches the next game.
- **The home page talks to the frame by `postMessage`**, through an interface both sides share:
  today's `TitleScreen` calls (`show`, `select`, `progress`, `setReady`, `present`, `busy`,
  `failed`, `hide`, `name`, `avatar`) become messages from the frame; the shell answers with Play,
  a pick (another game: the shell switches), a room of one's own, the name and avatar typed. The
  runtime gets a `RemoteTitle` with the same methods, so its code barely changes.
- **Identity by room ticket**: the shell asks the game server (`POST /tickets {game, room}`, with
  the sign-in cookie) for a ticket good for one connection to that game's room, for a minute; the
  frame connects with `?ticket=…`. The server accepts a ticket instead of the cookie (a frame's
  `Origin: null` gets no account otherwise). Guests need none.
- **Settings without storage**: the frame can't use `localStorage`. The shell sends the settings
  (keys, quality, volume) when it starts the frame and keeps the changes the pause menu sends back.
  `settings.ts` and `quality.ts` read and write through a store the frame is given.
- **The page's address**: the frame reports the game, room and copy it's in; the shell keeps them
  in its address (invite links). "Copy invite link" in the pause menu asks the shell for the link.
- **Play with one click**: pointer lock needs a click in the frame itself (a click on the shell's
  button doesn't count). So, for an uploaded game, the shell's Play button lets clicks through
  (`pointer-events: none`) and the frame, which knows where the button is, takes the click: it
  locks the pointer and starts. Enter in the name box (no click) shows "click to play" in the
  frame. Controllers need no lock.
- **A content security policy on `/frame.html`**: scripts from the site, the game server and
  `data:` (workers), `'wasm-unsafe-eval'`; connections only to the game server; pictures, sounds and
  fonts from the site, the game server and Google Fonts. An uploaded game can't send anything
  anywhere but the game server.
- **The site serves its assets with `Access-Control-Allow-Origin: *`** (the frame's module loads
  are cross-origin now); the dev server allows the `null` origin.

### Plan

1. **Workers by `data:` URL** (platform pool and game workers), and settings through a given
   store. Safe on their own; built-in games unchanged.
2. **Tickets**: `POST /tickets`, `?ticket=` on the socket, one use, a minute.
3. **The frame**: `/frame.html` and its entry (runtime with `RemoteTitle`), the shell's
   `FrameHost` (drives the real home page from the frame's messages, starts and destroys frames),
   uploaded games routed to it; the CSP and CORS headers; Play's click-through.
4. **Checks**: a browser test (an uploaded game plays in the frame; it can't read the cookie, the
   parent, storage; its requests carry no cookie; it can't reach another address), plus the usual.

### Decisions to make

1. **Built-in games stay in the page** (recommended): only uploaded games pay for the frame. All
   games in frames would be one path, but a riskier change for no security gain.
2. **A switch to or from an uploaded game loads a fresh frame** (about a second, from cache)
   rather than switching in place: recommended, for the isolation between games.

## Stage 3: what was built

- **The frame**: `frame.html` + `src/frame.ts` (a second page in the site's build), shown in
  `<iframe sandbox="allow-scripts allow-pointer-lock">` by `ui/frame-host.ts` for an uploaded game
  (`Runtime.frames`: `Runtime.start` hands such a game over instead of running its code in the
  page; the busy loop too). Built-in games run in the page as before. A fresh frame per uploaded
  game; picking another game closes it (a built-in one runs in the page with the renderer it left:
  `Carry`'s renderer is optional now). A frame that loads a second page (the game navigated it) is
  closed and the home page says "The game left its page".
- **The bridge** (`client/frame-protocol.ts`): the runtime's home page is a `HomeScreen` now
  (`TitleScreen` in the page, `client/remote-title.ts` in the frame); the frame's calls drive the
  real one; Play, rooms of one's own, the name to play as, settings (`client/storage.ts`: what the
  page gave, changes sent back), invite links and the page's address cross by message.
- **Room tickets**: `POST /tickets {game}` (the site's pages, signed in), `?ticket=` on the socket
  (once, a minute, that game); `Runtime.ticket` asks the page for one before each connection.
- **Workers by `data:` URL** in a frame (`startWorker`: the engine's pool; games' workers too).
- **Play's click-through**: the page's Play button lets clicks through to the frame (CSS while
  `body.framed`); the frame, told where the button is while it may be pressed, sends `press`; the
  page presses it (its rename flow and all) and the frame's runtime locks the pointer within the
  click's activation. While the home page is up the frame takes no other click.
- **Production headers** (`scripts/deploy-site.mjs`): assets with `Access-Control-Allow-Origin: *`;
  `frame.html` with a content security policy (scripts from the site and the game server,
  `'wasm-unsafe-eval'`; workers from `data:`/`blob:`; connections, pictures and sounds only to the
  site and the game server; Google Fonts; `frame-ancestors` the site). The dev server allows the
  `null` origin.
- **Checked** in Chrome: an uploaded Golf plays in the frame (its terrain workers too); signed in,
  it joins as the player through a ticket; inside the frame `document.cookie`, `localStorage` and
  `parent.document` throw, and its credentialed requests to `/me` and `/tickets` are refused;
  switching frame → built-in and built-in → frame (from the directory) works; a frame navigating
  itself is closed. On the production build with the CSP, the game loads and runs, and the frame's
  `fetch`, WebSocket and image beacon to another site are all blocked (`connect-src`, `img-src`).
  Pointer lock itself couldn't be exercised from CDP (synthetic clicks don't get it, in a frame or
  not): to check by hand. `tests/headless/tickets.ts` covers tickets.

## Stage 4: what was built

- **Anyone may upload with `UPLOADERS=*`**: any signed-in account whose Discord account is a week old
  (a Discord id is a snowflake: its creation time is in it; `minAgeDays`). Accounts named in
  `UPLOADERS` skip the age check. "Your games" is in the account menu for everyone signed in then,
  and says why if they can't upload yet.
- **Terms**: `public/upload-terms.html` (a plain-language draft for the owner to review), version 1;
  an uploader accepts once in Your games before uploading (`POST /uploads/terms`, kept in
  `accounts.sqlite`); a new version (`UPLOAD_TERMS_VERSION`) asks again. Admins and development
  servers aren't asked.
- **Limits** (`host/uploads.ts`, `UPLOAD_LIMITS`; admins exempt): 10 games created per account,
  200 MB on disk for them (what a new version adds, counted once built), 20 uploads an hour, and
  10 builds waiting at once (then "try again in a minute"). Your games shows what's used.
  **Delete for good** (`DELETE /g/<id>?forever=1`, asked again in place) frees room.
- **A room pool for uploaded games** (`Limits.uploadedRooms`, `UPLOADED_ROOMS`, 8 by default): past
  it, "Uploaded games are full right now" (a refusal screens retry); with a sandbox, uploaded rooms
  don't count toward the game server's own `ROOMS`, so built-in games always have theirs.
- `tests/headless/open-uploads.ts` covers it: the age gate, terms, each limit, deleting, admins,
  the pool beside a built-in game.

### To open uploads

1. Read `public/upload-terms.html` (live at blockyard.gg/upload-terms.html) and change what you'd
   word differently; a contact for takedowns could go in it (the Report button is the route now).
2. Set `UPLOADERS = "*"` in fly.toml (the names there now can stay: they skip the age check).

