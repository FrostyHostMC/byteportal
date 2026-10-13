# Redesign, part 2: item kinds as kits

Status: **in progress**. 4a (the mechanism and the host halves), 4b (the screen halves), 4c (open
item types), 4d (`runtime.ts` in parts: replays, other players' figures, rubble and the development
tools) and 4e (the litmus) are built.
Started 2026-09-26, following REDESIGN-CLIENT-SERVER.md's "Later": the user asked to continue the
refactor for the edges and overfits raised after phases 1 to 3.

## Why

After phases 1 to 3, a game owns how its items *look* and *sound*, but the platform still owns
what they *do*, and that is where the remaining overfit lives:

1. **The simulation has a closed set of item kinds.** `ItemDefinition` is the union melee | bow |
   gun | throwable | consumable | misc. `Combat.update` dispatches on it, and the inventory,
   stacking and auto-equip rules branch on it. A game can't make a new kind of item (a grapple, a
   paint gun, a shield) without changing the platform. Bed Wars' fire charge is a consumable
   whose `use` hand-rolls a projectile, because that's the only hook.
2. **The client runtime predicts guns and throwables itself.** About 370 of `runtime.ts`'s 2450
   lines are guns and throwables:
   - the gun controller, recoil, client-side bullets, aim assist and the `$gun` HUD binding;
   - the throw controller and local flights;
   - the replay's held gun, and the figures' aim and reload.
3. **The public API carries gun vocabulary in core places.** Examples:
   - `SharedDefinition.guns`;
   - `player.reloading`, `aiming` and `throw()`, and `inventory.ammo` / `setAmmo`;
   - `PlayerInput.shots` / `throws`, `PlayerFrame.hand.gun`;
   - the client's `shot` / `bullets` / `cook` / `thrown` events, and `Me.quick` / `cooking`;
   - `DamageCause` 'gun'.
4. **The presentation kits key on kinds.** The first-person kit picks its style from
   `def.kind`, the humanoid poses guns by kind, and the gunfire and gunner kits check
   `kind === 'gun'`. Kits may know about items (games choose them), but with open kinds they
   should key on what an item's kit publishes, not on a closed list.

## Principles

The same as part 1: mechanisms in the platform, policy in kits and games; code runs where it's
needed; defaults are kits a game lists; primitives, not features. Specifically:

- **The platform knows no item kinds.** An item names a `kind` string, and the game lists the
  **item kits** it uses: each kit makes one kind work. An item whose kind has no kit does
  nothing (like `misc` today).
- **The platform provides the mechanisms items need:**
  - the controls, with `consume`;
  - state per carried item, plain data, synced to the holder's screen;
  - actions a screen sends ahead of the host (client-authoritative, host-validated);
  - lag-compensated hitscan with penetration, carving, projectiles, damage, knockback;
  - what holding an item does to movement, predicted on both sides;
  - messages to screens, and events to the holder's client code.
- **Today's kinds become the platform's item kits:** `melee`, `bow`, `gun`, `throwable` and
  `consumable`. Their code moves out of `sim/combat.ts`, `sim/guns.ts`, `sim/throwables.ts`,
  `sim/throwing.ts`, `client/guns.ts`, `client/throwables.ts` and `runtime.ts`, unchanged in
  behaviour.
- **Identical play:**
  - every test passes;
  - pixel and voice checks match;
  - bots play the same;
  - a game changes only by listing its kits and naming helpers where it used core methods.

## The design

### An item kit has two halves, and shared maths

```
src/platform/items/<kind>/
  shared.ts   the item's type (GunItem), its options (GunRules), pure maths both sides run
  server.ts   the host half: an ItemKind (listed in the game's server definition)
  client.ts   the screen half: a ClientKit with a `kind` (listed in the game's client kits)
```

- A game imports the server halves from `@platform/items` (server code only), and the client
  halves from `@platform/client/items`.
- Options both halves must agree on (a gun's rules: reloading by itself, what aiming does to
  movement, rate slack, aim assist) live in the game's `shared.ts` and are passed to both halves.
  The platform keeps what isn't a gun's: hitboxes and rewind move to a core `hitscan` option,
  used by any kit that casts rays.
- A game that lists a kind's server half but not its client half still works: the host plays it
  from the controls, unpredicted (bots already work this way).

### The host half: `ItemKind`

```ts
interface ItemKind<D extends ItemBase = ItemBase, S extends object = object, P extends object = object> {
  readonly kind: string;
  /** Most in one slot (default 64; guns, melee and bows 1). */
  stack?: number;
  /** A carried item's state, per player per item: plain data. */
  state?(def: D): S;
  /** A player's state for this kind, whatever they carry (a throw's serial, a cooking timer). */
  player?(): P;
  /** Every step, for each player, in the order the game lists its kinds. */
  step?(use: ItemStep<D, S, P>): void;
  /** Their screen's actions for this kind this step (see `ClientKit.controls`), before `step`. */
  act?(use: ItemStep<D, S, P>, acts: unknown[][]): void;
  /** Held or put away (a gun comes up; a reload stops). */
  equip?(use: ItemStep<D, S, P>, held: boolean): void;
  /** What holding one does to movement: the same function runs on the holder's screen. */
  move?(def: D, state: S, controls: MoveControls): Partial<MoveMods>;
  /** What the holder's screen gets each frame (the held item's state, the kind's), and everyone's (for figures). */
  own?(use: ItemFrame<D, S, P>): object | null;
  shown?(use: ItemFrame<D, S, P>): object | null;
  /** Once a step for the whole game, after everyone's `step` (flights, fires). */
  update?(game: GameContext, dt: number): void;
}
```

`ItemStep` is today's `Fighter` made public. It has:
- the player (`Player`) and their body: eye, look, yaw, pitch, on the ground, falling, how fast
  they're moving, stance;
- `held` (the held item, if it's this kind: `{ id, def, state }`), and `carried()`;
- the controls: `isDown`, `pressed`, `button`, `buttonPressed`, `consume`, `active`, `locked`;
- `predicted`: whether their screen runs this kind's client half, so its actions arrive in
  `act`;
- primitives:
  - `hitscan(from, dir, range, { penetration })`: lag-compensated to what their screen showed;
  - `carve`, `pick` (a ray at bodies), `players`, `entities`, `projectile`;
  - `damage` (through `Player` / `Entity`);
  - `hitMarker`, `audio`, `fx`, `hud`;
- `show(name, data)`: an event for the holder's client code (today's `view('use')`);
- `broadcast(name, data)`: a message to every other screen (today's `$shot`, `$thrown`);
- `emit` (game events), `now`, `dt`, `game`.

The platform's `Combat` shrinks to choosing a slot (wheel, digits) and calling the kinds.
Stacking, the inventory and `onPickup` stay generic. Auto-equip and "a better one replaces a
worse one" use `rank`, which every kind has, so it no longer needs a kind.

### The screen half: a `ClientKit` with a kind

A client kit gains three optional hooks (useful beyond items):

- **`controls(client, c)`** runs before this frame's controls go to the host. It can read and
  `consume` the controls, turn the view (recoil), and `c.act(data)` to send an action for its
  kind with them. The gun fires here; the throwable cooks and throws here.
- **`move(held, controls)`** is what holding its kind does to movement, for prediction (the same
  function as the host half's).
- **`held(client)`** gives `client.me.held.state` for the held item, from the kit's predicted
  state (a gun's rounds, aim, spread).

A kit with a `kind` also receives the host's state for it: `client.me.items[kind]` (its own) and
the held item's `state` on each figure. The runtime keeps no gun or throwable state of its own.

### The wire

- `PlayerInput.shots` and `throws` become **`acts: Record<kind, unknown[][]>`**. `seen` stays;
  it's generic.
- `PlayerFrame.hand.gun` and `throws` become **`hand: { item, state }`** (the held item's
  `shown`) and **`items: Record<kind, object>`** (the holder's `own`, their frame only).
- `$shot`, `$thrown`, `$thrownEnd` and `$fire` become the kits' own messages, through the
  existing `game.clients.send` / `client.on` channel.

### The public API

- `ItemDefinition` becomes `ItemBase & { kind: string }`. The kind types (`GunItem`,
  `ThrowableItem`, …) move to their kits, with typed helpers:
  `game.items.define('rifle', gun({ … }))`.
- Gun and throw methods leave `Player` and `InventoryApi` for kit helpers:
  - `guns.of(player)` has `reloading`, `aiming`, `ammo(item)` and `setAmmo(item, …)`;
  - `throwables.throw(player, item, opts)`.
  - `freeze(…, { weapons })` stays; it means "the items are locked".
- `DamageCause` becomes a string; the kits use 'gun', 'melee', 'projectile', 'explosion' and
  'fire' as today.
- The client's item events become the kits' own events. `ClientEvent` gets a generic
  `{ t: string }` member, and each kit exports its event types (`GunEvent`, `ThrowEvent`). The
  presentation kits import those types from the item kits.
- `Me.hand.strength`, `drawing` and `charge`, and `Me.quick` / `cooking`, move to
  `me.items.melee`, `me.items.bow` and `me.items.throwable`.

## What 4a changed from the design above

Building it settled a few things the design left open:

- **A kit is a factory, started once per game.** A game lists `ItemKit`s (`(host) => ItemKind`),
  and the simulation starts each one's kind with that game's `ItemHost`. Whatever a kind keeps
  (grenades in flight, each player's cooldown) then belongs to that game alone, as `ThrowSim` did,
  even with several games in one process (headless tests). Game code reaches the running kind with
  `game.items.kind('gun')`, through typed helpers: `guns.of(game)` and `throwables.of(game)`.
- **Screen actions arrive inside `step`** (`use.acts`, null when their screen doesn't run the
  kind) rather than in a separate hook before it. The gun takes its shots after its timers
  (cooldown, rate tokens, the reload), as it always did.
- **`holds`** on a kind means it takes the mouse buttons when held (guns, bows, throwables,
  melee). The bare fist (the melee kit) swings only when the held item's kind doesn't hold. That
  way the order of the list matters only where a kind consumes a control from the kinds after it
  (a throwable being cooked takes the fire button from the gun).
- **`reset(player, whole)`**: `whole` when a new person takes a player's place, whose screen counts
  its actions from the start.
- **Validation is generic, with meaning checked by the kind.** The server's input check takes
  `acts` as plain data only: at most 8 kinds with names that aren't `Object.prototype`'s, 8
  actions each, 16 values each, finite numbers, short strings, booleans. The host merges them
  onto a null-prototype object, and each kit checks its own values (a gun's pitch and spread, a
  throw's numbers) and skips anything else.
- **Where frames carry kit state.** `PlayerFrame.hand` is `{ state }` (the held kind's `shown`)
  and `items` is the kinds' `own`. The client runtime reads them through small helpers until 4b
  moves the reading into the kits' client halves. `@platform/items` holds the types both sides
  read (`GunShown`, `ShotWire`, `MeleeOwn`, `BowOwn`, `ThrowOwn`).
- **New public primitives, each generic:**
  - `ItemHost`: `bodies`, `solid`, `blast`, `send` (to one screen, to everyone, or to everyone
    but one), `audio({ except })`, `emit`, `now`, `swing`, `guard`, and the `pvp` and `carves`
    flags;
  - `ItemUse.hitscan` with `rewind`;
  - `inventory.state(item)`;
  - a `margin` on `entities.raycast`, and `crit` / `weapon` on `ProjectileSpec`;
  - `math.rayBox`;
  - the `hitscan` option.
- **Checked:**
  - all 52 headless test files pass, including a new check of the server's `acts` validation;
  - the seeded bot matches' stats are identical to main (Call of Blocky, High Noon, Arena,
    Bed Wars);
  - the production build's bundle check passes;
  - in a browser against the real server, a rifle fires and spends its rounds, and a frag is
    thrown and taken.

## What 4b changed from the design above

- **The client halves are kits** in `@platform/client/kits` (`items.guns(options)`,
  `items.throwables()`), listed first in a game's kits.
  - The gun controller, client bullets, others' shots, the replay's gun and aim assist live in
    the gun's half.
  - The throw controller, the local flights and the throwable messages live in the throwable's.
  - `runtime.ts` has no gun or throwable code left: it runs the kits' hooks and assembles `me`.
- **`ClientKit` hooks:**
  - `kind`;
  - `controls(client, c, dt)`: the controls this frame, with `consume`, the view now (`yaw`,
    `pitch`, `turn`) and `act`;
  - `stick` (aim assist), `move`, `own` (`me.items[kind]`), `heldState` (`me.held.state`),
    `figureSignals` (figures' aim, sights and reload), and `handItem` (the grenade in the hand).
  - The names avoid members the first-person kit already had.
- **`ClientEvents` is an interface kits augment** (`declare module '@platform/client'`). The core
  declares only its own events: `use`, `swing`, `kick`, `land`, `equip`, `view.*`, `reset`,
  `replay.*`, `message`. The gun kit adds `shot`, `bullets`, `reload` and `empty`; the throwable
  kit adds `cook`, `toss`, `thrown`, `bounce`, `thrownEnd` and `fire`. `client.emit` is public, and
  an event a kit emits reaches the kits after it in the same pass.
- **`Me`:**
  - gained `hand.state` (the host's word), `items` (each kind's), `hotbar` and `walkSpeed`;
  - lost `quick`, `cooking` and the melee and bow fields, which moved to `items.throwable`,
    `items.melee` and `items.bow`.
- **New primitives:**
  - `client.world`: `trace` (a bullet's path on this screen), `blockColor`, `carvable` and
    `lineOfSight`;
  - `client.input`: `assist`, `sticksMoving` and `rumble`;
  - `client.hud.bind` (a widget's `$name`: the gun kit's `$gun`);
  - `figure.used()` and `figure.point(name)`.
- **Messages** are the kits' own names through `client.on`: `gun.shot`, `throwable.thrown`,
  `throwable.end`, `throwable.fire`. In a replay the gun kit tells the followed player's own
  shots from others'; the throwable kit clears its flights when a replay starts or ends, checking
  the replay's id as each message arrives.
- **Kit-owned options leave the shared definition.** `SharedDefinition.guns` went: High Noon's
  `GUN_RULES` is in its `shared.ts`, handed to both halves. `standardKits()` went too, since every
  game lists its kits.
- **Checked:**
  - all 52 headless test files pass, and the boundary and presentation checks pass;
  - Call of Blocky's first-person scenario matches main pixel for pixel, apart from a few pixels
    of anti-aliasing in the XP label's text. It covers the rifle at the hip and aimed, firing and
    its impacts, the SMG empty, low and reloading, the scope, a frag cooked and thrown, and a
    molotov burning;
  - High Noon's first-person shots are identical to main, and its figure shots are within the run
    to run noise;
  - in a browser, every live bot shot came from its figure's muzzle, and in the kill cam the
    followed killer's shots were their own hand's, down their sight.

## What 4c changed

- **The item kinds' types left the core API.** `MeleeItem`, `BowItem`, `GunItem`, `GunAction`,
  `GunOptions`, `AimAssist`, `ThrowableItem`, `ThrownInfo` and `ConsumableItem` are the kits'
  shared parts' (`@platform/items`), with guards: `isGun`, `isThrowable`, `isMelee`, `isBow`,
  `isConsumable`. `MiscItem` is gone: any kind no kit makes is one.
- **`ItemDefinition` is `ItemBase & { kind: string }`** (no index signature: an interface such as
  `GunItem` stays assignable to it). `items.define<D extends ItemDefinition>` takes a literal with
  any kind's fields; games type theirs with their kit's (`satisfies ConsumableItem`,
  `Record<string, GunItem | MeleeItem>`).
- **`ItemLook`** takes any kit's look fields: `tracer`, `trail` and `drawIcon` are the kits' types'
  now.
- **`DamageCause`** is the platform's own causes plus any string (the kits' `'gun'`, `'fire'`), and
  **`HoldStyle`** is open the same way.
- **The first-person kit's** kind-to-style map is an option (`firstPerson.standard({ styles })`,
  over `KIND_STYLES`).
- **The last core branch on a kind** went: the renderer's bow check. An item's `drawIcon` shows
  whenever its kit says it's drawn.
- **Left for later:** `HoldSpec.gun` (`GunHold`) and the gun sounds in `ItemSounds`. They're data
  the presentation kits read, not logic, but they're still gun vocabulary in the core types.

## What 4d changed

`runtime.ts` went from 2,215 lines to 1,786. Four parts left it for `src/platform/client/`,
each a class told only what it needs of the runtime (a `…Parts` interface, as `ClientHost` is for
the client API), with no change to what's drawn, played or sent, or in what order:
- **`replays.ts`, `ReplayView`**: the replay playing on this screen: starting and ending one, the
  live calls it hides, each frame's step and its events, its camera (the followed player's eyes, or
  its own), `client.me` through those eyes, and the `client.replay` service.
- **`avatars.ts`, `Avatars`**: other players as figures (their types, stable ids and hurt flashes)
  and their name tags; and `standIn`, this client's player at the spawn before it joins.
- **`debris.ts`, `Debris`**: rubble from damage and from blocks broken whole, the dust, the blasts
  it's flung from, and blocks' average colours (`client.world.blockColor`).
- **`devtools.ts`, `DevTools`**: the F3 overlay, `__game.debugInfo()` and `__game.dev`.

`window.__game` is as it was: the `debug*` hooks, `dev`, `controller` and the fields tests read stay
on the runtime (`__game.replay` is a getter now). The presentation check covers the first three.

Input and the modes stayed: `onKey`, `onPadButton`, the picker and the pause read and set the
runtime's mode and reach the command bar, the menus and the HUD's visibility, so a module of them
would take most of the runtime as its interface. Pad aim is a few lines. The settings, the pause and
the client wiring are glue.

## 4e: the litmus passed

Laser Tag (`src/games/lasertag`, a development game) has a kind of item of its own, the
`tagger`, written only in its folder against the public API, with no platform change:
- `tagger.shared.ts`: its type, state, rate and energy maths, and its movement;
- `tagger.server.ts`: the host half, an `ItemKit`;
- `client/tagger.ts`: the screen half, a `ClientKit` with a `kind`, plus an energy-bar kit.

What it does:
- A click fires on the player's screen at once: the beam from the eye as the camera's placed, and
  the shot sent as an action.
- The host takes the shot if the tagger could have fired it (its rate, its energy, a little slack),
  checks the action's values itself, and casts the shot lag-compensated.
- A tag is damage of the kit's own cause, `'tag'`.
- Everyone else's screen draws the beam from the shooter's figure's muzzle (`tagger.beam`,
  `figure.point`, `figure.used`).
- The heavy lance slows its holder, on the host and in prediction, through the kit's `move`.
- A bot fires from its trigger on the host.
- Its own client event (`'tagger.fired'`) joins `ClientEvents`.

`tests/headless/lasertag.ts` covers the host side. In a browser against the real server, three
clicks were three predicted shots, all taken, with the energy bar showing.

The API gap it met was one of wording, not mechanism: a bot's look is `bot.controls.look`, not
`teleport`'s view (a bot's controls own its look). That's as documented, so nothing changed.

## Plan

Each phase ships with every game working. Every phase is checked with:
- the full `test:headless` suite, plus the new tests;
- `check:boundaries`, with a check that core names no item kind;
- pixel diffs of Call of Blocky's and High Noon's views;
- the bot matches;
- a production build.

- **4a. The mechanism, and the host halves.**
  - `ItemKind`, the registry, generic item state, `acts`, `hand.state` / `items` in frames, and
    move mods through the kind.
  - The five kinds become server kits (the code moved, not rewritten).
  - Games list them. The `hitscan` option replaces `guns`' rewind and hitboxes.
  - The Player API helpers move.
  - The runtime is adapted just enough (it sends `acts`, and reads `hand.state` and `items`).
  - **Done when:** tests pass, the bots play the same, and `sim/combat.ts` names no kind.
- **4b. The screen halves.**
  - The gun controller, client bullets, aim assist, the `$gun` binding, the replay's gun and the
    figures' aim move to the gun's client half.
  - The throw controller, flights and messages move to the throwable's client half.
  - Melee and bow client state move to theirs.
  - The client events and `Me` open up.
  - **Done when:** `runtime.ts` names no kind, pixel and voice checks are identical, and the
    presentation kits read kit types.
- **4c. The presentation kits key on published state, not kinds.**
  - The first-person kit's styles come from the item's `hold.style` (defaulting by what the
    kit is told, not a closed kind switch).
  - The humanoid and gunner kits read the gun kit's state.
  - The core check grows to the kits' public types.
- **4d. `runtime.ts` in parts.**
  - Replay, avatars and figures, input and pad aim, settings and the pause, and the client
    wiring become modules.
  - The runtime is the frame loop and the glue.
- **4e. The litmus.** A small game with an item kind of its own, written only in its folder
  (predicted, with client-authoritative actions), and no platform changes. If it needs any, the
  API isn't done.

## Decisions (recommended, and taken unless the user says otherwise)

1. **Kinds are listed per game on both sides**, like kits: no hidden defaults. The cost is that
   every game with items lists its kinds, a few lines each.
2. **A kind's client half is optional.** Without it, the host plays the kind from the controls,
   with latency. That's simpler games' fallback, and it's how bots already work.
3. **Kit-owned options travel through shared code**, not `SharedDefinition` fields: a gun's
   rules are the gun kit's options.
4. **The Player helpers change game code** (`guns.of(p).ammo(…)` instead of
   `p.inventory.ammo(…)`). About twenty call sites across Call of Blocky, High Noon and the bot
   kit.
