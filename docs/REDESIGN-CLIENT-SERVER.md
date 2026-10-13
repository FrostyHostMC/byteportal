# Redesign: client/server split and a client API of primitives

Status: **built**, phases 1 to 3 (2026-09-26; approved 2026-09-25). Phase 4 is for later. How the platform works now is in PLATFORM.md; this is the design and its record.

## Why

Two problems, one cause:

1. **The engine knows what the game is.** The client decides how things look by item kind and style
   name:
   - the view model has `gun` / `sword` / `bow` / `throw` / `block` hold styles;
   - figures have `rifle` / `pistol` / `sword` stances;
   - the HUD has an ammo panel and lethal counters;
   - the runtime draws gun tracers, the scope overlay and the fuse ring.

   A game can only nudge numbers inside those routines. Every look it wants that the routine
   doesn't have becomes an engine change: the muzzle flash's depth, where a gun sits, a sight's
   outline. Replacing those routines with a data format would only move the overfit into config.
2. **Game code runs where it shouldn't.**
   - The browser bundle carries every game's full definition, meaning its server logic, and
     runs every game's top-level code (map builds) at page load.
   - The sim worker carries a second copy.
   - Single-player (hosting in the page or a worker) is legacy, and it's the only reason the
     client needs server code.

The fix for both is to give each game **code of its own on the client**, separate from its
server code, and an engine API made of **primitives** (things in the view, the local player's
state, events, messages) instead of features. Today's gun and sword behaviour becomes **kits**
written against those primitives, which games use, copy or replace.

## Principles

1. **Mechanisms in the engine, policy in the game.**
   - The engine never branches on item kinds, style names or other game vocabulary to decide
     how something looks or behaves on screen. (Simulation mechanics such as hitscan, lag
     compensation and prediction stay platform features; see "Later".)
   - A check script enforces this in the client core.
2. **Code runs where it's needed.**
   - Server logic runs only on the server.
   - Presentation runs only on each player's screen.
   - What both must agree on is **shared**: prediction steps, terrain builders, block
     painters, the tuning and stats that prediction reads.
3. **Defaults are kits, not special cases.**
   - Everything the platform does for a game today is rebuilt from the public client API as
     kits.
   - A game lists the kits it uses, and can copy any of them into its own folder and change it
     (as it already can with `navGrid` and `shooterBots`).
4. **Primitives, not features.**
   - The client API gives nodes, transforms, model points, the local state, events and
     messages.
   - It never gives "poses", "stances" or "ADS".

## What's there now (facts; survey at 64716a0)

**What the client takes from a game's definition when online:**
- id, title, tagline, accent, controls, gamepad, instances;
- `world` (terrain options, ground, terraform, `structures[].build()` run in the client's
  terrain workers, destructible, view distance);
- `blocks` (including texture `paint()` functions);
- `player` (movement tuning, controller, hotbar, skin/model with `firstPerson` and `poses`);
- `guns` rules;
- `hud` theme;
- `vehicles` (`step`/`pose`/`camera`, run for prediction).

`setup`, `start` and `update` are not used, but they ship anyway.

**What the host sends each screen:**
- content definitions: sounds recorded to layers, animations baked to keyframes, item and
  entity definitions with functions stripped, glTF urls, widgets;
- presentation calls: `hud.*`, `fx.*`, `audio.*`, `view.*`, and a fixed `client` target
  (debris, shot, thrown, fire).

**Game code the client runs:**
- movement abilities' `step`;
- vehicles' `step`/`pose`/`camera`;
- `structures[].build`;
- block `paint`;
- and every listed game's module top level at page load.

**Where the client knows game vocabulary:**

| Where | What it decides |
|---|---|
| `render/viewmodel.ts` | Hold styles and their placement; the gun pose table (hip, sprint, slide, ADS by sight type, compact guns); reload, pump, bolt, lever and hammer motions; the flash; scope hiding; FOV narrowing; the bow's draw |
| `client/humanoid.ts`, `client/entities.ts` | Held kinds (`gun`, `melee`, `other`); rifle and pistol stances (by length); the sword chop; lever and hammer; the overarm throw |
| `runtime.ts` | Hold style from item kind; `gunFrame` (fire, aim and reload keys, ADS zoom, rumble); tracers, impacts and blood; `gunHud`; `throwFrame`/`throwHud`; aim assist (guns only) |
| `ui/hudkit.ts`, `ui/hud.ts` | Ammo panel, lethal counters, gun crosshair and reticles, scope overlay |
| `client/throwables.ts`, `client/guns.ts` | Quick-throw and cook; the warning marker; molotov flames; default sounds |
| `fx/effects.ts`, `audio/sfx.ts` | Explosion look; `gunshot`/`gun_reload`/`bounce`/`fire` voices |

## The design

### A game is three parts

```
src/games/callofblocky/
  meta.ts      id, title, tagline, accent: what the launcher lists (tiny, no imports)
  shared.ts    what both sides run or read: world options and structures, blocks and painters,
               movement tuning and abilities, vehicles, item stats (a gun's rpm, spread,
               magazine: what prediction needs), controls
  server.ts    rules: setup / start / update, bots, scoring, modes; imports shared
  client.ts    presentation: what each player sees and hears; imports shared
```

- `defineShared({...})` is today's `GameDefinition` minus `setup`/`start`/`update`, and minus
  anything only a screen needs (HUD theme, looks).
- `defineServer(shared, { setup, start, update })` is today's server logic, unchanged in
  substance.
- `defineClient(shared, { setup, frame, ... })` is new (below).

### Builds and loading

- **Client bundle.**
  - It contains the launcher, which lists each game's `meta`.
  - Joining a room dynamically imports that game's `client.ts`, with its `shared.ts` in the
    same chunk. So only the game you play loads, and nothing of `server.ts` ever does.
  - `sim.worker.ts`, `PageLink` and `WorkerLink` leave the production bundle.
- **Server bundle.** `serve.ts` imports each game's `server.ts` and `shared.ts`, and never
  `client.ts` or `@platform/client`.
- **Boundaries** (`check-boundaries.mjs`), checked on the import graph:
  - `client.ts` can't reach `server.ts` or `@platform` host modules;
  - `server.ts` can't reach `@platform/client`;
  - `shared.ts` imports neither side.
  - After `vite build`, a bundle check fails if any `server.ts` module or `host/` module
    appears in the client output.

### The client API (`@platform/client`)

Everything below is general: none of it names a kind of item, a pose or a game.

```ts
defineClient(shared, {
  setup(client) { ... },          // once, when joining: define looks, sounds, HUD widgets; listen
  frame(client, dt) { ... },      // every frame, after prediction, before rendering
});

interface Client {
  me: Me;                         // the local player, as predicted on this screen
  players: ClientPlayer[];        // everyone as shown (interpolated), with their figures
  view: ViewLayer;                // the first-person layer
  scene: SceneLayer;              // things placed in the world (at points, on players, on entities)
  hud: ClientHud;                 // today's widgets, bound locally; the server's HUD calls land here too
  fx: Effects; audio: ClientAudio; // local effects and sounds (voices defined here, no recording)
  input: ClientInput;             // read the controls for feel (never to act on the game)
  items: ClientItems;             // each item's look: icon, model (the server needs neither)
  on(event: string, fn): void;    // the game's own server->client messages, and local events
  send(name: string, data): void; // client->server messages (the server validates)
  time: number;
}

interface Me {
  position; velocity; look: { yaw; pitch }; onGround; crouching; sprinting; sliding;
  health; dead;
  held: { item: string; state: Record<string, number | boolean> } | null; // mag, reload, aim...: whatever the item's sim keeps
  abilities: Record<string, Record<string, number | boolean>>;
  events: ClientEvent[];          // this frame: shot, use, equip, reload, throw, land, hurt...
}

interface ViewLayer {
  fov: number;
  root: Node;
  model(src: ModelSource): ModelNode; // the held item's model, or anything else
  sprite(src: ImageSource): Node;
  arms: Record<'L' | 'R', { upper: Node; forearm: Node; fist: Node; grip: Vec3 }> | null; // the player's own
  clear(): void;
}
interface Node { position: Vec3; rotation: Quat; scale: Vec3; visible: boolean; depthTest: boolean; add(child: Node): void }
interface ModelNode extends Node { point(name: string): Vec3 | null; points: string[]; bounds: Box3 }
interface Figure { joint(name: string): Node; model: ModelNode | null } // a player's or entity's figure, joint by joint
```

Math helpers (`vec3`, `quat`, springs, easing, two-bone IK, "put this point there, pointing
that way") are plain functions in `@platform/client/math`. They are not engine features.

### Server <-> client messages

- `game.clients.send(to, name, data)` on the server arrives at `client.on(name, fn)` in that
  game's client code.
- `client.send(name, data)` arrives at `game.events.on('clientMessage', ...)` on the server,
  where the game validates it.
- This replaces the platform's fixed `client` presentation target (debris, shot, thrown, fire).
  Those become messages that kits send and handle.
- Today's `hud.*`, `fx.*` and `audio.*` calls from the server stay, as a convenience for
  server-driven UI (banners, scoreboards). They're delivered to the same client services the
  game's own client code uses.

### Kits (`@platform/client/kits`)

Today's behaviour, rebuilt only from the API above:

| Kit | From |
|---|---|
| `firstPerson.guns()`, `.melee()`, `.bow()`, `.blocks()`, `.items()`, `.throwables()` | `viewmodel.ts` styles, poses, motions, the flash, scope hiding, FOV |
| `figures.humanoid()` | `humanoid.ts` gait, stances, the chop, lever and hammer, the throw, death |
| `hud.guns()`, `hud.throwables()` | Ammo panel, crosshair and reticles, scope overlay, lethal counters, the fuse ring |
| `effects.gunfire()`, `effects.throwables()` | Tracers, impacts, blood, the molotov's flames, the warning marker, their sounds |
| `sounds.standard()` | The built-in voices (gunshot, reload, explosion, …) as ordinary definitions |

- A game's client code lists what it uses: `frame: kits.compose(firstPerson.guns(), figures.humanoid(), hud.guns())`.
- To change one, copy it into the game's folder and edit it. Call of Blocky's first-person
  code (where its guns sit, its recoil, its flash) lives in `callofblocky/client/`.

### What moves where

| Now | After |
|---|---|
| `setup`/`start`/`update` shipped to the browser | `server.ts`, on the server only |
| `world`, `blocks`, movement, abilities, vehicles | `shared.ts` (both sides; prediction and terrain need them) |
| Item stats | `shared.ts` (prediction reads rpm, spread, magazine) |
| Item looks (icon, model, `hold`) sent from the server | `client.items.look(id, {...})` in `client.ts` (built, phase 3a; Call of Blocky moved) |
| Sounds recorded on the host and replayed | Defined in `client.ts` (real Web Audio; no recording) (built, phase 3a; Call of Blocky moved) |
| HUD widgets defined on the host | Defined in `client.ts`; the server sends data to them |
| `hud.theme`, `player.model`, `firstPerson` fit | `client.ts` |
| View model styles and humanoid stances in the engine | Kits |
| `client` presentation target | Game messages |

### Development and tests without single-player

- **`npm run dev`** starts Vite and a local game server together, with cheats on. The page
  connects to it automatically.
- **The screenshot harness** loses `__game.context`. In its place, a development-only command
  (`__game.dev(js)`) runs a snippet in the room's server context and returns JSON (teleport,
  freeze bots, give items). It exists only when the server runs in development mode.
- **Headless tests** keep running the server in Node, as they do now. Client kits get unit
  tests by loading `client.ts` in Node against a fake view layer.

## Plan

Each phase ships with every game working. Every phase is checked with the full `test:headless`
suite, and with pixel diffs of every game's first- and third-person views against the previous
build. Kits must reproduce today's looks exactly until a game chooses otherwise.

1. **Split and build.**
   - Each game gets `meta`/`shared`/`server`/`client`, with `client.ts` for now only declaring
     what the runtime already reads.
   - Lazy per-game client chunks.
   - Boundary and bundle checks.
   - Single-player and in-page hosting leave production; `npm run dev` runs the local server;
     the harness moves to `__game.dev`.
   - **Done when:** no server code in `dist/`, and all games and tests unchanged.
2. **Client API and kits.**
   - `@platform/client` primitives.
   - Today's client behaviour is moved into kits.
   - The runtime core has no item-kind or style branches, with a check that fails on new ones.
   - Each game's `client.ts` lists the kits it uses.
   - **Done when:** pixel-identical, and the core check passes.
3. **Games own their look.**
   - Call of Blocky's first person, flash, HUD and figures move into its own client code, built
     from kits.
   - High Noon's revolver and lever gun become its own client code instead of platform options
     (`hands: 1`, `lever`, `hammer`), which then leave the platform.
   - Item looks and sounds move to the client.
4. **Later.**
   - The sim's item kinds (gun, throwable, bow) become server kits over simulation primitives
     (lag-compensated rays, projectiles, predicted state per item), under the same principle.
   - A sandbox for client code, if games from outside this repo are ever hosted.

## Decisions to make

1. **Item looks and sounds defined in `client.ts`.**
   - Recommended: yes. The server then never needs model urls or voices, and the record/replay
     machinery goes away.
   - Cost: kill-feed and HUD calls name items (`{ item: 'rifle' }`) instead of shipping icons.
   - **Done (phase 3a)** in the platform (`client.items.look`, `{ item }` icons, item sounds by
     name, `client.audio.define`) and in Call of Blocky. The record/replay machinery stays until
     the other games move their voices.
2. **Kits are listed explicitly per game.**
   - Recommended: yes, with no hidden defaults: a game shows what it uses.
   - Cost: every game's `client.ts` lists its kits, a few lines each.
   - **Done**: every game lists its kits (`standardKits()` went in REDESIGN-ITEMS 4b).
3. **Server-side `hud.*`/`fx.*`/`audio.*` stay as a convenience.**
   - Recommended: yes. Simple games keep working without client code for UI.
   - **Done**: they stay, and deliver to the same client services (`{ item }` icons and item
     sounds work through them).
4. **Phase 4 (simulation kinds as kits) is out of scope for now.**
   - Recommended: yes. It's the same principle, but a much larger change to gameplay code.

---

## Phase 2 in detail: the client API and the kits

This is the working design for phase 2, fixed before the kits are ported so they can be ported
in parallel against one API.

### Kits and the order things run

```ts
interface ClientKit {
  name: string;
  setup?(client: Client): void;              // once, when the screen starts showing the game (watching or playing)
  frame?(client: Client, dt: number): void;  // every frame, in the order listed
  late?(client: Client, dt: number): void;   // every frame, once the world's effects have moved on
  dispose?(): void;
}
defineClient(shared, { kits: [firstPerson.standard(), figures.humanoid(), hud.gunner(), effects.gunfire()], setup, frame });
```

Each frame runs in this order:
1. prediction and local mechanics (movement, the gun and throw controllers);
2. `client.me` and this frame's `client.events` are filled in;
3. each kit's `frame`, in order;
4. the game's own `frame`;
5. the world's effects (particles, tracers) move on by the frame's time;
6. each kit's `late`, then the game's (what's made here is drawn where it starts: a shot fired
   this frame, its tracer leaving the muzzle as the hand is drawn);
7. render.

### The client object

- **Math.** `@platform/client/math` exports the platform's math types (`Vec3`, `Quat`, `Mat4`,
  `Euler`; three.js's classes, re-exported under the platform's names) and helpers (springs,
  easing, two-bone IK, point-to-point placement). Kits use these, so the numbers come out exactly
  as before.
- **`Node`.** Something drawn or grouped: `position: Vec3`, `quaternion: Quat`,
  `scale: Vec3`, `visible`, `add(node)`, `remove(node)`, plus `renderOrder` and `depthTest` where
  it draws. It is structurally a three.js `Object3D` subset. Games never import three.js.
- **`client.view`: the first-person layer.**
  - `camera` (`fov`, `aspect`); `root: Node`; `node()` makes a group; `visible`.
  - `held: HeldItem | null`. The engine loads what's in hand: a sprite extruded to 3D, a box or
    glTF model, or a block. A `HeldItem` is:
    - `{ item: string; def: ItemDefinition | undefined; node: Node; form: 'model' | 'sprite' | 'block' | 'cross' }`;
    - `points: Record<string, Vec3>` (the model's markers, its own space);
    - `bounds`, `halfWidthAt(z)`;
    - `setGeometry(frame)` for a bow's draw frames.
  - `arms`:
    - `skin: { R: Node; L: Node } | null`: the player skin's blocky arms;
    - `hands: { R: Node; L: Node } | null`: the skin's blocky fists for two-handed holds;
    - `humanoid`: the player model's upper arm, forearm and fist per side, with their joint
      lengths and grip frames (today's `HumanoidArms`).

    The engine builds the meshes; kits place them.
  - `sprite(image: 'flash' | url, opts: { additive?, depthTest?, color? })` returns a `Node`.
  - Light (the probe at the eye) is applied by the engine to everything in the layer.
- **`client.me`: the local player, predicted.**
  - position, velocity, look, onGround, flying, crouching, sprinting, sliding, dead, vehicle,
    health, `bob` phase, `thirdPerson`;
  - `hand` (item, count, strength, drawing, charge);
  - `held` (item, def, and the item's local state: a gun's mag, reserve, reload progress,
    shells to load, aim, sprint blend, sight, action);
  - abilities.
- **`client.events`: this frame's events, local and from the server.**
  - Local: `shot`, `use`, `swing`, `kick`, `equip` (after the held item has loaded),
    `unequip`, `reload`, `throw`, `land` (with vertical speed).
  - From the server: `view.play`, `view.kick`, `view.visible`, `view.setSkin`, and the game's
    own `client.on` messages.
- **`client.figures`.** For each drawn player or entity: `{ id, player?, entity?, joints: Record<name, Node>, rig: 'humanoid' | 'box' | null, state: AnimState, held }`.
  A kit that poses a figure sets `figure.posed = true`, and the engine skips its own pose for it.
  - Humanoid figures: the kit takes the pose over.
  - Box-model figures keep the engine's animation in phase 2.
- **`client.hud`.**
  - `layer(name)` returns an `HTMLElement` in the HUD. The game's client code is trusted
    (bundled), so it can build DOM itself; server-sent markup stays sanitized.
  - `theme`; the widget API, usable locally.
- **Other services.**
  - `client.fx`: today's effects (burst, tracer, impact, explosion, shockwave, flash, shake, …).
  - `client.camera`: the world camera's extra `fovScale` (aim zoom) and shake.
  - `client.audio`: play, loop, define a voice.
  - `client.input`: keys, buttons, pad, device.
  - `client.items.get(id)`.
  - `client.world`: read-only raycasts and block queries.
  - `client.on` / `client.send`.

### Which kit takes what

| Kit | Ported from | Owns after |
|---|---|---|
| `firstPerson.standard()` | `render/viewmodel.ts` (styles, poses, motions, gun motion, springs, flash, scope hide, FOV, bob and sway); the hold-style choice in `runtime.ts` | Everything in the first-person layer |
| `figures.humanoid()` | `client/humanoid.ts` rig posing; the held-kind and stance choice in `client/entities.ts` | Humanoid figures' poses |
| `hud.gunner()`, `hud.throwables()` | `ui/hudkit.ts` ammo and lethal panels; `ui/hud.ts` crosshair, reticles and scope; `runtime.ts` `gunHud` / `throwHud` | Those HUD pieces |
| `effects.gunfire()`, `effects.throwables()` | `runtime.ts` tracers, impacts and blood; `client/throwables.ts` flight view, trail, warning marker and flames | Those effects and their sounds |
| `sounds.standard()` | The built-in voices in `audio/sfx.ts` | Their definitions |

Mechanics stay in the platform core: movement, the gun controller (local shots, spread, reload
timing, recoil turning the view), the throw controller (cook, throw), aim assist and prediction.
They report through `client.me` and `client.events`, and no longer draw anything.

**Done when:**
- Every game's `client.ts` lists these kits, and every game looks and sounds pixel-identical.
- A check fails on item-kind or style checks (`kind === 'gun'`, `'sword'`, `stance`, …) in the
  client presentation core (`render/`, `ui/`, `fx/`, `runtime.ts` outside the mechanics).

---

## Phase 3a: items' looks and sounds on the client

Built (decisions 1 to 3 above). Docs: PLATFORM.md, "Items' looks and sounds in client code".

- **`client.items.look(id, look)`**, in a game's client `setup`. An `ItemLook` is an item's
  presentation: `icon`, `hold`, `sounds`, `tracer`, `trail`, `drawIcon`, the shown `name`.
  - The screen's `Content` keeps the server's definitions and the looks apart, and its `items`
    are the two merged: each look field over the server's, `sounds` sound by sound.
  - So everything that reads an item gets the look: `client.item`, `client.items.get`,
    `me.held.def`, the held model, the hotbar, pickups, figures, `scene.item`, the kits.
  - The game's client code starts at the top of the first frame it's in the game, before the
    gun controller, the hotbar or the figures read an item. `ItemBase.icon` is optional; an item
    given no icon by either side shows a placeholder (the `$placeholder` atlas).
- **`{ item: id, view? }` icons** (`IconRef`), resolved on each screen (`looks.ts`
  `resolveIcon`): in feed lines, menu entries, result screens, `client.hud.icon`, and the
  throwables kit's panel.
- **Item sounds by name.** The simulation's own item sounds (others' shots, reloads, dry clicks,
  throws, a molotov breaking, melee swings and hits, bows, consumables, a pin pulled) carry
  `audio.play`'s `item: { id, sound, pitch? }`. Each screen plays the item's own sound as it has
  it, else the name the server gave.
- **Call of Blocky.**
  - `weapons.ts` has only what its weapons do.
  - `client/looks.ts` has their models, icons, first-person holds (`FP`, `FP_COMPACT`, `ADS`),
    tracers, trail and sounds, and the briefcase's model.
  - `client/sounds.ts` has its voices (`client.audio.define`).
  - `client.ts` lists its kits.
  - Its server reaches no weapon model file and defines no voice; `split.ts` checks both.
  - The fighters (`setModel`) and the dossier widget stay on the server.

## Phase 3b: every game's looks and voices on the client

Built. Each game's items' looks are in its `client/looks.ts` (or `client.ts` for Heart Hunt's one
heart), its voices in `client/sounds.ts`, and its `client.ts` lists the kits it uses (only
those: no gun HUD in Bed Wars, Starfighter only the sounds kit). Its server names items
(`{ item }` icons) and plays voices by name. High Noon's revolver (one-handed, a hammer) and
lever gun are its own client code: the hands, hammer and lever are options of the first-person
and figures kits, not the engine.

- **The server never defines voices.** `game.audio.define`, the recording of voices
  (`recordVoice`, `playRecorded`) and the `sound` content definition are gone; a game's voices are
  its client code (`client.audio.define`), played as written.
- **What stays on the server**, as the server decides it: players' models (`setModel`: Call of
  Blocky's fighters, High Noon's cowboys), props and entities it places, what a bow fires, HUD
  widgets (sanitized markup bound to data), texture atlases the server paints for skins and
  creatures, and each game's HUD theme (shared).
- **The `server-assets` Vite plugin stays.** It emits every file the server's code names by URL
  (a player's model, a prop), so the URL the server sends is on the site. The bundle check proves
  it (a small file the browser build inlines, like Sandbox's crate texture, is still emitted for
  the server's URL, though the screen draws its own copy).
- `tests/headless/split.ts` lists each game's client-only files (its looks, its voices, the model
  files only its client code reaches) and fails if server or shared code reaches one;
  `looks-games.ts`, `looks.ts` and the games' own tests check that no voice or look is sent and
  that every item has a look and every sound asked for a voice on the screen.
