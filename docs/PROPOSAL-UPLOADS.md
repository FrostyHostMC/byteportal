# Proposal: uploading games without a redeploy

Status: **all four phases built** (2026-10-04; see "Phase 1: what was found", "Phase 2: what was
built", "Phase 3: the site" and "Phase 4: after platform updates"). Scope agreed: uploads by the owner and trusted people only. Live editing, an in-game agent and sandboxing are out of scope
(see "Later").

## Why

Today a game exists only once it's compiled into the platform: `src/games/browser.ts` and
`src/games/server.ts` list every game, and Vite and `build:server` bake them into the site and
`serve.js`. A new game, or a fix to one, means a commit to main and a full deploy of both.

The goal: **zip a game folder, upload it, and it plays.** The server starts hosting it, the home
page lists it, players' screens load its client code, all without touching the repo or deploying.

## What's there now (facts; survey at 2e0b55c)

- **Games only touch the public API.** `scripts/check-boundaries.mjs` limits a game folder to
  `@platform`, `@platform/art`, `@platform/kits`, `@platform/items`, `@platform/client` (and its
  `/kits` and `/math`) and its own files. No game imports `three` or the engine. Two Vite features
  are used (found in phase 1): `import.meta.env.DEV` for debugging hooks (Blockfront's client;
  Call of Blocky's, Bed Wars' and Starfighter's server) and a Web Worker (Golf's terrain).
- **A game is already split by side**: `meta.ts`, `shared.ts`, `server.ts`, `client.ts` and
  `client/`. Server code never reaches the browser bundle (checked by `check-bundle.mjs`).
- **Nothing per game in Rust.** The wasm engine is shared; a game is TypeScript plus assets.
  Across all games: 91 `.glb`, 15 `.gltf`, 10 `.webp`, 2 `.png` (all imported `?url`) and 4
  `.css` (`?raw`). Build tools (`tools/*.mjs`) run in Node and aren't part of the game.
- **The server already finds games asynchronously.** Each room runs in its own worker thread
  (`host/room-worker.ts`), which asks `find(id)` for its `GameDefinition`. `GameDefinition`
  extends `GameMeta`, so the server has each game's title, achievements and cosmetics.
- **`GET /games`** on the game server lists what's on and how many are playing. The browser's
  catalog (`GameEntry`: meta now, `load()` the client code when picked) is a static list.
- **Assets the server names** (player models, props) go out as site URLs (`/assets/x-<hash>.glb`).
  The `server-assets` Vite plugin makes the site carry them although the server code isn't in it.
- **The cosmetics catalog** (`cosmeticCatalog`) is built once from the static game list, both in
  the browser (home page, locker) and on the server (`Auth`).
- **Games switch in place** (`Runtime.shutdown()` hands the home page to the next game), so
  loading a game's code at runtime fits the existing flow.

## The design

### A game package is just the folder

The upload is a zip of the game folder exactly as it sits in `src/games/<id>/`: `meta.ts`,
`shared.ts`, `server.ts`, `client.ts`, `client/`, helpers and assets. Nothing extra to write.
The game's id comes from `meta.ts`. `tools/` and `previews/` are ignored.

### Building: one packager, on the server

A packager (`src/platform/package/`, Node, esbuild) turns a folder into a **built game**:

| Output | What it is |
|---|---|
| `server.js` | `shared.ts` + `server.ts` (and helpers): ESM, what a room's worker imports |
| `client.js` | `client.ts` + `client/` + `shared.ts`: ESM, what a player's screen imports |
| `game.json` | the meta as data (title, tagline, accent, controls, achievements, cosmetics, cover URL), the platform modules it imports, its version, the platform build it was checked against |
| `assets/` | every `?url` file, named by content hash; `?raw` files are inlined |

Before a build is accepted it must pass:

1. **The boundary rules for one folder** (the same rules as `check-boundaries.mjs`, refactored
   so they run on any folder, not only `src/games/*`).
2. **A smoke test**: `server.js` loads in a headless room (the `Headless` host the tests use),
   runs `setup` and `start`, takes a bot player through a few hundred ticks, and doesn't throw.
   `client.js` is checked for loading only (it needs a screen to do more).

A failure rejects the upload and returns the error text. No type check on the server in v1:
esbuild strips types without checking them. Creators type-check locally (see "Making a game").

The same packager runs locally (`npm run game -- build <folder>`), so what you test is what the
server builds. **The server builds, not the uploader**, so the stored source can be checked
again later (see "When the platform changes").

### Linking: games bind to the running platform

A built game leaves every `@platform…` import out of its bundle. At load time those imports
resolve to the platform modules that are already running, through a small registry:

```ts
// The platform, before it loads a game:
globalThis.__blockyard = { modules: { '@platform': platform, '@platform/kits': kits, … } };
// The packager turns `import { math } from '@platform'` into a read from that registry.
```

- **Server**: the room worker registers `@platform`, `/art`, `/kits` and `/items`, then
  `import()`s the game's `server.js` from disk.
- **Browser**: `game.json` lists which platform modules the game imports. The loader awaits
  those (each is its own lazy chunk, so `/client/kits` stays out of the main bundle until a game
  needs it), registers them, then `import()`s `client.js` from the game server.

One platform instance is shared, so classes, `instanceof` and module state behave as they do
for built-in games. **Risk to measure in phase 1:** exposing a whole namespace keeps all of its
exports, which tree-shaking drops today. On the server that's free. In the browser, `@platform`
and `@platform/client` may grow the main bundle; if they do, they become lazy chunks too.

### The game library (server)

Uploaded games live on the Fly volume:

```
/data/games/<id>/
  game.sqlite                    the game's data (as data/<game>.sqlite today)
  source/<version>.zip           every uploaded source, kept for rebuilds and rollback
  <version>/server.js client.js game.json
  assets/<name>-<hash>.<ext>     shared by all versions (content-addressed)
  library.json                   owners, current version, listed or not, history
```

`<version>` is the hash of the built output. A `GameLibrary` in `host/` holds the built-in games
(as today) plus the uploaded ones, scanned at boot and updated on upload. `serve()`'s fixed
`defs` map becomes the library.

- **Rooms are pinned to a version.** `RoomSpec` gains `version`; the worker imports that
  version's `server.js`. A new upload becomes current for new rooms. A running public room keeps
  its version until it empties; the owner can also restart its rooms onto the new version.
- **Players' code always matches their room.** The `welcome` message carries the room's version
  and client URL, and the screen loads that (not whatever the catalog says is current).
- **Assets are served by the game server**: `https://play.blockyard.gg/g/<id>/assets/…` and
  `/g/<id>/<version>/client.js`, cached as immutable, with CORS (already `*`). The packager
  writes absolute URLs from the server's public address (`PUBLIC_URL`), so asset URLs the server
  sends (models, props) work the same as the site's do today.
- **Ids are first come, first served.** An upload may not take a built-in game's id, or an
  uploaded game's id it doesn't own.
- **Old versions are kept** (the last 10) for rollback.

### The catalog (browser)

`GET /games` grows: each uploaded game adds its `game.json` meta, its current version and its
client URL. `Runtime.start` merges those into the static catalog as `GameEntry`s whose `load()`
runs the loader above. Built-in games are unchanged.

- **Unlisted by default.** A new game opens by link (`?game=<id>`) but isn't on the home page
  until its owner lists it, so testing never reaches the front page.
- **Cosmetics and achievements** come from the merged catalog: `cosmeticCatalog` is rebuilt when
  the library changes (server) and from `/games` (browser). Ids are already prefixed by game
  (`game:id`), so uploaded games can't collide with built-in ones.
- The home page's cover shelf shows listed uploaded games after the built-in ones.

### Who may upload

- **Uploaders** are Discord accounts on an allowlist (`UPLOADERS` env on Fly: account ids). A
  development server lets anyone upload.
- **Each game has owners.** Whoever uploads an id first owns it and may add other uploaders as
  owners. Only owners can upload new versions, roll back, list or delete.
- **Two ways in, one endpoint** (`POST /g/<id>` with the zip, max 50 MB):
  - a signed-in page on the site: drop a zip, see the build result, manage versions;
  - the CLI, `npm run game -- push <folder>`, with a personal upload token made on that page
    (stored hashed in `accounts.sqlite`).

**Trust model, stated plainly:** an uploaded game runs with the same access as a built-in one.
On the server that's everything a worker thread can reach: the file system, the network, the
environment (including the Discord secret). In the browser it runs on blockyard.gg as the
signed-in player. That is acceptable only because uploaders are trusted. What already limits the
damage of a buggy game: each room's worker has a memory ceiling, and a crash fails that room
alone.

### When the platform changes

Because built games bind to the platform at load time, a deploy doesn't need to rebuild them:
they pick up the new platform automatically. What it can do is break them (a renamed API).

- **On boot**, the server re-runs each uploaded game's smoke test if the platform build changed.
  A game that fails is marked broken: unlisted, its rooms refused with a clear message, the error
  shown to its owners. It isn't silently left running half-working.
- **Later, in CI**: fetch the uploaded games' sources and type-check plus smoke-test them against
  the new platform before deploying, so breakage shows up before it ships.

### Making a game

The expected way to make a game stays the same: clone the repo (for the platform's types, docs
and dev server), work in `src/games/<id>/` with `npm run dev`, type-check with `npm run
typecheck`, then `npm run game -- push src/games/<id>`. The difference: the game never has to be
committed or deployed. `npm run dev -- --game <folder>` also loads a game from outside the repo
through the packager.

## Plan

1. **Packager and linking, proven locally.** Build Obby with the packager and load it on the dev
   server as `obby-pkg` next to the bundled Obby. Both must play the same. Measure what the
   module registry costs the main bundle. Smoke-test harness. No upload yet.
2. **The library and uploads.** Storage on the volume, versions, the upload endpoint with tokens
   and the allowlist, asset serving, the merged `/games` catalog and cosmetics, `version` in
   `welcome`, the browser loader, `npm run game -- push`. Unlisted by default. Verified by pushing
   Obby (as a new id) to the live server.
3. **The upload page.** On the site: upload a zip, see build errors, list or unlist, versions and
   rollback, restart rooms onto the new version, owners, tokens, room logs.
4. **Platform changes.** Smoke tests on boot and the broken state; then the CI check. (Built, but
   the CI check: see "Phase 4".)

## Phase 1: what was found

Built on branch `uploads` (2026-10-04): the packager (`src/platform/package/`), `npm run game --
build`, `--package <folder>[=<id>]` on any server, the screen's loader (`client/packaged.ts`) and
`tests/headless/packages.ts`.

- **Every game builds and passes the smoke test**, the development games included: 13 games, 25
  to 85 ms each. Sky Obby, Call of Blocky, Blockfront and Golf were played built in a browser
  (models, HUD themes, `?raw` styles, Golf's workers): the same as compiled in. Golf was also
  played on the production server bundle (`serve.js`), its room importing the built code natively.
- **The module registry costs the site 6 KB** of first-visit JavaScript (1106 to 1112 KB; 320 to
  323 KB gzipped). The games' own chunks are unchanged. The lazy chunks grow by about 130 KB,
  almost all of it the worker link, loaded only when a built game starts a worker.
- **Vite features games use**: `import.meta.env` is defined by the packager (production unless
  built for a development server). Workers are bundled on their own and started by the platform
  from a script of the page's own, which imports a worker link (the public API inside a worker)
  and then the game's worker from the game server: a page may only start workers of its own
  address.
- **The smoke test must import natively.** Through Vite's loader, a game reading
  `import.meta.env` passed and would then have failed in production. The platform imports built
  games with a native `import()` everywhere, and the smoke test imports a fresh module of its own
  (ES modules are cached per thread: a second load would get the first one's state and files'
  addresses).
- **Folders may be links** (macOS's temporary folder is): the packager works on real paths.
- The single-folder boundary rules are enforced while bundling (by what each side's bundle
  reaches), rather than by refactoring `check-boundaries.mjs`. Imports TypeScript drops (unused or
  type-only) aren't seen, which is harmless.

## Phase 2: what was built

- **The library** (`host/library.ts`): games on the volume as designed, a `library.json` each.
  An upload is unpacked (`package/zip.ts`: no paths outside the folder, 4000 files and 200 MB at
  most, hidden files and `node_modules` dropped), built in `<root>/.incoming/`, checked (not a
  built-in id, not someone else's), smoke-tested in a thread of its own (a room's worker in smoke
  mode, two minutes at most), then moved in and made current. One build at a time. The last 10
  versions are kept.
- **The server's main thread never runs an uploaded game's code**: it knows a game by the meta
  its smoke test reported (kept with the version). Only rooms' threads import the code.
- **Rooms are pinned**: a room takes the current version when it starts and keeps it; the welcome
  carries that version's client address and modules, and a screen loads that, whatever the
  catalog says (checked in a browser: two tabs ran v1's code after v2 was uploaded).
- **Routes** (`host/uploads.ts`): `POST /g` (the zip as the body, 50 MB at most), `GET`/`POST
  /g/<id>/manage`, `DELETE /g/<id>`, the files by kept version, and `/uploads`, a page of the
  server's own for making an upload token (a refused account is told its id, for `UPLOADERS`).
  Credentialed CORS for the site's pages, ready for phase 3.
- **Identity**: upload tokens (`byu_…`, hashed in `accounts.sqlite`), or the signed-in account;
  `UPLOADERS` (account or Discord ids) says who may upload. A development server lets anyone.
- **`npm run game -- push`** zips and uploads a folder; `token` saves a token. `--package` now
  installs into the library the same way.
- **Listed games** come after the built-in ones in `/games` (with `packaged: <version>`); showing
  them on the home page is phase 3's.
- **Found on the way**: builds weren't deterministic. esbuild printed asset modules' absolute
  paths (the random staging folder, and where the server keeps things, in public client code),
  and read the `package.json` and `tsconfig.json` above the folder (the module-interop flag
  differed between a folder in the repo and one outside it). A game is now built from a copy of
  its own with a `package.json` and the repo's compiler settings given directly: the same folder
  builds the same version anywhere.

## Phase 3: the site

- **Your games** (`ui/mygames.ts`), in the account menu for an uploader (the menu asks `GET
  /g/mine`): drop a folder (zipped in the browser with fflate, a lazy chunk of 9 KB) or a zip, an
  optional id; what went wrong, each problem a line; each of their games with its state (on the
  home page, link only, not hosted), Play, Copy link, list or unlist, stop or start hosting, its
  versions (make one current) and owners (add by name, remove); an upload token for the CLI.
- **The home page's shelf** takes the games the server lists from `/games`, which now carries each
  one's entry (meta, version, client address, modules): they join the shelf after the built-in
  games within a poll (5 s), and the runtime's catalog, without a reload.
- Server: `GET /g/mine`, owners added by name, credentialed CORS on all the library's routes for
  the site's pages, `mine` kept as an id no game may take.
- Checked in a browser: signed in, the menu, the panel (and at phone width), an upload by zip and
  by folder, a refused one, listing (on the shelf a poll later), Play from the panel, a token.

## Phase 4: after platform updates

- **Each version's last smoke test is kept with the platform build it ran on** (`check` in
  `library.json`). The build is a hash of the engine and the server's entry (the production bundle
  names its chunks by content, so the entry changes with any of them); a development server is a
  new build each start.
- **On boot, games last checked on another build are smoke-tested again**, in the background, a
  thread each, one at a time: only once per build (a machine that sleeps and wakes doesn't redo it).
- **A game that fails is broken**: not on `/games` (so off the home page), its link turned away
  ("This game stopped working with an update to Blockyard: its owners have been told", shown on
  the home page, where a first visit used to show a misleading engine error for any refusal), and
  its owners shown the errors in Your games with **Check again** (`POST /g/<id>/manage {recheck}`).
  A new upload mends it (it's checked as it goes in).
- **Errors name the game's own lines**: built games' source maps are linked, and the platform turns
  source maps on where it runs them (`blockyard://<id>/server.ts:350:43`); the platform's own
  frames are named by file only, no paths of the server's.
- **Not built: the CI check** (fetching uploaded games' sources and type-checking them before a
  deploy). It would need an admin's token to read every game's source, and would hold the
  platform's deploys hostage to others' games; the boot recheck covers what matters (nothing
  broken is played, owners know). Worth adding if uploaders multiply.

## Decisions to make

1. **Built-in games stay bundled** (recommended). Moving them onto the upload path later is easy
   once it's proven, but nothing needs it now.
2. **The server builds from source** (recommended), rather than accepting bundles the uploader
   built. One code path, and the source is kept for checks and rollback.
3. **Unlisted by default** (recommended).
4. **The allowlist lives in an env variable** (recommended for now; a role in `accounts.sqlite`
   once there's an admin page).
5. **Assets on the Fly volume** (recommended for now). The volume is 1 GB and also holds the
   SQLite files; Blockfront is 4.3 MB, so it fits dozens of games. It's cheap to grow; R2 or
   Vercel Blob if it ever matters.
6. **No type check on the server in v1** (recommended). The smoke test catches crashes; local
   `npm run typecheck` catches the rest.

## Later (out of scope now)

- **Live editing**: pushing a version restarts your own room on it with players kept connected,
  and later swapping the game's code while keeping the world.
- **An in-game agent** that edits the game from inside it.
- **Untrusted uploaders**: V8 isolates (or a locked-down process) for server code, and the game's
  screen in an iframe on a separate domain with a room ticket instead of the sign-in cookie.
  Keep the room's message-only boundary and the client loader in one place so this can be added
  without redesigning.
