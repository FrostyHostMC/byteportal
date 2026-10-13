<p align="center">
  <a href="https://blockyard.gg"><img src="docs/media/banner.webp" alt="Blockyard: block games, played together" width="760"></a>
</p>

<p align="center">
  An open-source game platform for the browser: a Rust/WebAssembly voxel engine, a three.js renderer and an authoritative multiplayer server.<br>
  A game on top of it is a few small TypeScript files.
</p>

<p align="center">
  <a href="https://blockyard.gg"><b>▶ Play at blockyard.gg</b></a>
  &nbsp;·&nbsp;
  <a href="docs/PLATFORM.md">Write a game</a>
  &nbsp;·&nbsp;
  <a href="CONTRIBUTING.md">Contribute</a>
  &nbsp;·&nbsp;
  <a href="#run-it-locally">Run it locally</a>
</p>

<p align="center">
  <a href="https://github.com/Potrock/blockyard/actions/workflows/ci.yml"><img src="https://github.com/Potrock/blockyard/actions/workflows/ci.yml/badge.svg" alt="CI"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-green.svg" alt="MIT license"></a>
</p>

<p align="center">
  <a href="https://blockyard.gg"><img src="docs/media/hero.webp" alt="Call of Blocky, Blockfront II, Starfighter and Bed Wars in motion" width="100%"></a>
</p>

## What it is

- **Nine games, free in the browser, no download.** A Call of Duty-style shooter, a Battlefront II-style third-person war, Bed Wars, a co-op arena, a space dogfighter and more. Play alone with bots or with friends, in public matches or a room of your own.
- **A platform, not just a game.** The engine already has the world: endless procedural terrain, lighting, physics, entities, items, guns, vehicles, combat, audio, HUD and menus. A game only describes its rules and content, and imports nothing but `@platform`.
- **Multiplayer built in.** Every game runs on an authoritative game server. Each screen predicts its own movement, and shots are lag-compensated, so what you aim at is what you hit.
- **Shared across games.** Sign in with Discord and your progress, 73 achievements and cosmetics follow you from game to game. It also has gamepad support and rebindable keys.
- **No asset files.** Block textures, skins, item sprites and sounds are all generated in code, and so is the games' art.

## Games

<table>
  <tr>
    <td width="33%" align="center"><a href="https://blockyard.gg/?game=callofblocky"><img src="src/games/callofblocky/cover.webp" alt="Call of Blocky"></a><br><b>Call of Blocky</b></td>
    <td width="33%" align="center"><a href="https://blockyard.gg/?game=blockfront"><img src="src/games/blockfront/cover.webp" alt="Blockfront II"></a><br><b>Blockfront II</b></td>
    <td width="33%" align="center"><a href="https://blockyard.gg/?game=arena"><img src="src/games/arena/cover.webp" alt="Arena"></a><br><b>Arena</b></td>
  </tr>
  <tr>
    <td align="center"><a href="https://blockyard.gg/?game=starfighter"><img src="src/games/starfighter/cover.webp" alt="Starfighter"></a><br><b>Starfighter</b></td>
    <td align="center"><a href="https://blockyard.gg/?game=skyship"><img src="src/games/skyship/cover.webp" alt="Skyship"></a><br><b>Skyship</b></td>
    <td align="center"><a href="https://blockyard.gg/?game=bedwars"><img src="src/games/bedwars/cover.webp" alt="Bed Wars"></a><br><b>Bed Wars</b></td>
  </tr>
  <tr>
    <td align="center"><a href="https://blockyard.gg/?game=golf"><img src="src/games/golf/cover.webp" alt="Blockyard Links"></a><br><b>Blockyard Links</b></td>
    <td align="center"><a href="https://blockyard.gg/?game=obby"><img src="src/games/obby/cover.webp" alt="Sky Obby"></a><br><b>Sky Obby</b></td>
    <td align="center"><a href="https://blockyard.gg/?game=sandbox"><img src="src/games/sandbox/cover.webp" alt="Sandbox"></a><br><b>Sandbox</b></td>
  </tr>
  <tr>
    <td align="center"><a href="https://blockyard.gg/?game=heart-hunt"><img src="src/games/heart-hunt/cover.webp" alt="Heart Hunt"></a><br><b>Heart Hunt</b></td>
  </tr>
</table>

| Game | What it is |
| --- | --- |
| **[Call of Blocky](https://blockyard.gg/?game=callofblocky)** | A fast pulp shooter against bots and people. The modes are free-for-all, Team Deathmatch (the Suits against the Shirts) and The Briefcase (plant it or stop it). The maps are Jackrabbit Lane (a Nuketown-style cul-de-sac), Big Kahuna Burger, Hijacked (a yacht at sea), Nukeblock (a 1960s model town on a test range: two houses, a school bus and a lot of mannequins), and Rust (a desert oil yard with a drilling tower in the middle). You get rifles (the FAMAS among them), SMGs, shotguns, snipers, a machine gun, revolvers and a katana, plus frags and Molotovs. Bullets carve through walls. Killstreaks go up to a Hellstorm missile and an Attack Chopper you fly. There are also XP levels with unlocks, a killcam, and a Play of the Game at the end of every match. |
| **[Blockfront II](https://blockyard.gg/?game=blockfront)** | Third-person battles, the Rebels against the Empire, in Conquest (five command posts, 250 tickets) or Heroes vs Villains. Troopers, Heavies and Specialists carry blasters that overheat. Battle points buy a hero: Luke Skyblocker, Ben Kenoblock, Darth Voxel, Emperor Palpablock, Chewblocca or Boba Fetch. Heroes have sabers that deflect bolts, Force powers and a floaty Force jump. The maps are Mos Blockley Spaceport and Frostline Base. |
| **[Arena](https://blockyard.gg/?game=arena)** | Seven waves in a colosseum: zombies, skeleton archers, spiders, brutes, Sappers with powder kegs, Necromancers raising the dead, and Treasure Goblins to catch, then the Warden boss. Most waves roll a twist (a Blood Moon, a swarm, Sappers everywhere). Between waves, weapons drop and you choose one of three blessings (lifesteal, lightning, monsters that burst when slain…). Dodge-roll with Q, throw bombs with G. Online it's co-op, and more fighters bring more monsters. |
| **[Starfighter](https://blockyard.gg/?game=starfighter)** | A Star Fox-style dogfighter. Fly a block-built Vox-wing against waves of Bowties, then knock out a 200-block Star Demolisher's shield generators and bridge. Barrel rolls deflect lasers. Online, it's a squadron. |
| **[Skyship](https://blockyard.gg/?game=skyship)** | Crew an airship across the sky islands and light five beacons. The ship is a solid, moving prop: everyone walks its decks while one of you takes the helm. |
| **[Bed Wars](https://blockyard.gg/?game=bedwars)** | Hypixel-style Bed Wars on sky islands, against bots or up to three friends. Collect resources from your generator, shop, bridge across the void and break the other beds. The bots fortify, bridge and dig through defences. |
| **[Blockyard Links](https://blockyard.gg/?game=golf)** | Eighteen holes of parkland golf, par 72, with a cart to drive round them. Swing with the mouse: pull back for power, then swing up through the ball, and the stroke's line pushes, pulls, hooks or slices it. The ball flies with real drag, lift and wind, digs into soft turf and rolls down sloping greens into a real cup (lip-outs included). Everyone plays their own round on the same course. |
| **[Sky Obby](https://blockyard.gg/?game=obby)** | Ten stages of parkour in the sky, with lava, crumbling sand, launch pads, blinking platforms and cannons. Each player runs on their own clock, and best times go on a leaderboard. |
| **[Sandbox](https://blockyard.gg/?game=sandbox)** | Creative building in an endless world, which the server keeps. |
| **[Heart Hunt](https://blockyard.gg/?game=heart-hunt)** | A gentle hunt for ten hidden hearts. At about 70 lines, it's the [tutorial game](docs/PLATFORM.md#hello-game). |

Each game's controls are on the home page and in its pause menu (Escape), along with the settings and an invite link.

### Call of Blocky

<p>
  <img src="docs/media/cob-fp-street.webp" alt="First person: the Wolf drum-fed Tommy gun firing down Jackrabbit Lane, bullets chipping the burger truck" width="49%">
  <img src="docs/media/cob-fp-yacht.webp" alt="First person: the Marsellus machine gun firing up at an Attack Chopper from the yacht's sun deck on Hijacked" width="49%">
  <img src="docs/media/cob-hellstorm.webp" alt="The Hellstorm killstreak's nose camera, guided down onto the cul-de-sac with three targets boxed" width="49%">
  <img src="docs/media/cob-chopper.webp" alt="An Attack Chopper over Big Kahuna Burger" width="49%">
</p>

### Blockfront II

<p>
  <img src="docs/media/bf-duel.webp" alt="Luke Skyblocker and Darth Voxel duel at Mos Blockley Spaceport" width="49%">
  <img src="docs/media/bf-lightning.webp" alt="Force lightning crackles across the spaceport" width="49%">
  <img src="docs/media/bf-frostline.webp" alt="Luke Skyblocker against snowtroopers at Frostline Base" width="49%">
  <img src="docs/media/bf-spaceport.webp" alt="Fighters over Mos Blockley Spaceport" width="49%">
</p>

### Starfighter and Bed Wars

<p>
  <img src="docs/media/starfighter.webp" alt="A Vox-wing strafes the Star Demolisher" width="49%">
  <img src="docs/media/bedwars.webp" alt="A sword fight on a bridge over the void" width="49%">
</p>

## Make a game

A game is a folder with four parts: `meta` (what the launcher lists), `shared` (the world, blocks and movement, which the server and every screen read), `server` (the rules, which run only on the game server) and `client` (each player's screen). Here is a complete one: a ring wall, a sword and three rogues to beat.

```ts
// meta.ts: what the launcher lists
import { defineMeta } from '@platform';
export default defineMeta({ id: 'my-game', title: 'My Game' });

// shared.ts: what the server and every screen read (each screen generates the terrain and predicts its own movement)
import { defineShared, Blueprint } from '@platform';
import meta from './meta';

// A ring wall, stamped into the world during generation.
const ring = new Blueprint({ x: -12, y: 70, z: -12 }, { x: 25, y: 4, z: 25 });
ring.columns(0, 0, 12, (x, z, d) => d > 11 && ring.fill({ x, y: 70, z }, { x, y: 73, z }, 'stone_bricks'));

export const shared = defineShared({
  ...meta,
  world: {
    structures: [ring],
    terraform: [{ x: 0, z: 0, radius: 14, blend: 16, height: 69.5 }],
    spawn: { x: -6, y: 71, z: 0.5 },
    spawnYaw: -Math.PI / 2, // face +x
  },
  player: { health: 20, hotbar: 'items' },
});

// server.ts: the rules, which run only on the game server
import { defineServer, HeldModels, Models, Skins, Behaviors } from '@platform';
import { shared } from './shared';
let won = false;

export default defineServer(shared, {
  setup(game) {
    game.items.define('iron_sword', {
      kind: 'melee', name: 'Iron Sword', icon: 'iron_sword', damage: 6.5, cooldown: 0.42, hold: { model: HeldModels.ironSword },
    });
    // Built-in skins are just the player's; bring your own with game.items.atlas (see the docs).
    game.entities.define('rogue', {
      name: 'Rogue', model: Models.humanoid({ skin: Skins.player }), hitbox: { width: 0.6, height: 1.95 },
      health: 20, speed: 3.2, ai: Behaviors.melee({ damage: 3 }),
    });
  },
  start(game) {
    won = false;
    game.player.inventory.give('iron_sword');
    for (let i = 0; i < 3; i++) game.entities.spawn('rogue', { x: 8, y: 71, z: i * 2 - 2 });
  },
  update(game) {
    if (!won && game.entities.count('rogue') === 0) {
      won = true;
      game.hud.screen({ title: 'You win!', tone: 'victory', buttons: [{ label: 'Again', primary: true, onClick: () => game.restart() }] });
    }
  },
});

// client.ts: each player's screen
import { defineClient } from '@platform/client';
import { shared } from './shared';
export default defineClient(shared);
```

Then list it in `src/games/browser.ts` (its meta, and its client loaded on demand) and in `src/games/server.ts` (its server part), and open `?game=my-game`.

**[docs/PLATFORM.md](docs/PLATFORM.md) is the full guide.** It covers the world and custom blocks, players and multiplayer, items, guns, throwables, bots, vehicles, moving ships, glTF models, a game's own art and sound, saved data, achievements, cosmetics, the HUD, replays and headless testing. Ready-made systems such as survival building and shooter bots come as kits (`src/platform/kits`), which use the same public API as any game.

## Run it locally

You need Rust (stable) with the `wasm32-unknown-unknown` target, and Node 20 or newer (CI runs 24). `wasm-pack` comes in as a dev dependency.

```sh
rustup target add wasm32-unknown-unknown
npm install
npm run dev        # builds the wasm engine, then runs a local game server and Vite on http://localhost:5173
```

`npm run dev` runs a game server in development mode on port 8787 (`--server-port` changes it, `--port` changes Vite's), and the page connects to it. In development mode:

- Cheats are on: press `/` or T for the command bar (`/give pike`, `/spawn zombie 3`, `/tp ~ ~10 ~`, `/time noon`, `/help`).
- The development-only games and previews open by id (`?game=gallery`).
- `await __game.dev('game.players.length')` in the browser's console runs code in the game's room on the server. There, `game` is its `GameContext` and `me` is your own player.

See [Running and debugging](docs/PLATFORM.md#running-and-debugging).

### Scripts

| Script | What it does |
| --- | --- |
| `npm run dev` | The wasm engine, a development game server and Vite |
| `npm run build` | Release wasm build, type-check, the boundary check, a production bundle in `dist/` and the bundle check (no server code in it). Set `VITE_GAME_SERVER=wss://…` for the server the site plays on |
| `npm run preview` | Serve the production bundle |
| `npm run wasm` | Rebuild only the Rust engine (`engine/pkg`) |
| `npm run typecheck` | TypeScript and the boundary check (games, kits and each side of the client/server split keep to their imports) |
| `npm run test:engine` | Rust unit tests: generation, blueprints, meshing, lighting, culling, physics, entities, path-finding, textures |
| `npm run test:headless` | Games in Node with no browser (`tests/headless`). Every game runs 30 s, a bot beats the Arena, bots play out a Bed Wars match, and several players share a real server |
| `npm run server -- [games…]` | Host games (all by default, each at `ws://localhost:8787/<game>`). Options: `--port`, `--dev` (development mode), `--cheats`, `--seed 1234`, `--rooms 8` (rooms of your own at once, each in its own worker thread), `--room-size 16`, `--data dir` (worlds and players' data, in `data/<game>.sqlite`) and `--new` (fresh worlds) |
| `npm run build:server` / `npm start` | Bundle the game server (games included) into `dist-server/` / run it with plain Node |

URL parameters: `?game=<id>` picks a game, `?server=ws://host:port` picks the game server, and `&room=<code>` opens a room of your own on it.

## Controls

| Input | Action |
| --- | --- |
| WASD, Space | Move, jump |
| Shift / Ctrl | Sneak / sprint (a game can swap them: Call of Blocky sprints on Shift and crouches on C) |
| Left / right mouse | Attack or fire / use, place or aim |
| 1–9, mouse wheel | Hotbar |
| `/` or T | Command bar |
| Esc | Pause menu: how to play, settings, keys, achievements, invite, exit |
| F1 / F3 | Hide the HUD / debug overlay |

Each game adds its own controls, which are listed on the home page and in its pause menu. Every game also plays with a **gamepad**. Moving, jumping, crouching and sprinting can be **rebound** under Keyboard in the pause menu, and the bindings follow you from game to game.

## How it works

```
┌──────────── games (TypeScript, import only @platform) ──────┐
│ src/games/callofblocky · blockfront · arena · bedwars · …   │
│ each: meta · shared · server (rules) · client               │
├──────────── kits (optional, also only @platform) ───────────┤
│ src/platform/kits   building, items, shooter bots, nav grid │
│ src/platform/art    pixel-art painter for game atlases      │
└──────────────────────── GameContext ────────────────────────┘
┌──────────── platform simulation (TypeScript, headless) ─────┐
│ src/platform/api        public API: types, Blueprint,       │
│                         Models, Behaviors                   │
│ src/platform/sim        Sim: players, entities, items,      │
│                         combat, props, commands, rules      │
│ src/platform/net        protocol: inputs, frames, calls     │
│ src/platform/host       GameHost, rooms, accounts, the game │
│                         server; Node only                   │
├──────────── platform client (TypeScript + three.js) ────────┤
│ src/platform/runtime.ts the client: game loop, server link  │
│ client/                   camera, entity/pickup/prop views, │
│                           presenter (HUD/FX/audio calls)    │
│ render/                   WebGL2 pipeline, first-person arm │
│ audio/ fx/ ui/            synth SFX, effects, HUD, menus    │
│ world/ workers/           chunk streaming, worker pool      │
└─────────────── flat buffers / wasm-bindgen ─────────────────┘
┌──────────── engine (Rust → WebAssembly) ────────────────────┐
│ gen.rs      terrain, biomes, caves, blueprints, terraform   │
│ mesher.rs   lighting + greedy meshing                       │
│ world.rs    block store, edits, raycasts, AABB physics      │
│ entities.rs entity bodies, flow-field path-finding,         │
│             projectiles                                     │
│ cull.rs     frustum + cave culling, shadow camera           │
│ texgen.rs / entitytex.rs  procedural block + mob textures   │
└─────────────────────────────────────────────────────────────┘
```

**The simulation and the client are separate.** The `Sim` runs the game: the game's own code, players, entities, items, combat and block edits. It touches no DOM and no WebGL. Each tick it takes a `PlayerInput` from every player and produces a `SimFrame`. HUD, effects and sound calls become `PresentCall` messages. A `GameHost` runs the `Sim` on the game server, for one player or many over WebSockets. A game's rules never reach the browser, and game logic never competes with rendering. The page is only the client: camera, views, presentation, rendering and prediction of its own player. It loads each game's client code only when that game is picked. The same `GameHost` runs headless in Node for tests.

**The heavy work is Rust.** Terrain generation, lighting, meshing, physics, path-finding, projectiles, raycasting, visibility culling and shadow-camera math are compiled to WebAssembly. The simulation core is plain Rust with no wasm-bindgen types, so a native build generates identical worlds from the same seed.

<details>
<summary><b>Engine details: chunks, lighting, meshing, culling, entities, rendering, performance</b></summary>

**Threads.** Terrain generation and meshing run in a pool of Web Workers (hardware threads minus two). They share one `WebAssembly.Module` that is compiled once on the main thread. The main thread keeps its own wasm instance holding the authoritative block data and entity state. Physics, raycasts, edits, entity simulation and per-frame culling all use it synchronously.

**Chunks.** Columns are 16×16×256 and stored sparsely as 16³ sections. Generation is stateless: `(seed, cx, cz)` plus the game's blueprints fully determines a chunk. Trees that cross chunk borders are placed from a margin, so both chunks agree without talking to each other. Game structures (`Blueprint`s) are stamped by the workers during generation, so they cost nothing at runtime and survive chunk reloads.

**Lighting.** Sky light and block light are computed per mesh job with a BFS over the 3×3 column neighbourhood. Light 15 dies out within 15 steps, so that neighbourhood contains every source that can reach the centre column. The result is exact and seamless without any global light storage. An edit only remeshes the columns within light range, and all of them swap in the same frame.

**Meshing.** Opaque faces are greedy-merged when their smooth lighting and ambient occlusion are uniform. Other faces keep per-vertex AO and light, with the quad diagonal flipped to avoid AO anisotropy. There are three layers: opaque, cutout (leaves, plants, glass) and translucent (water). Each vertex packs into 8 bytes (`uvec2`), and texture coordinates are derived in the shader. One shared index buffer serves every mesh.

**Culling.** Meshes are stored section by section, so the visible part of a column is always one contiguous draw range. Each frame, wasm runs frustum culling per section plus a Minecraft-style cave-culling BFS through section connectivity graphs (computed by the mesher). The result drives three.js `drawRange` and `visible` directly. The shadow pass gets its own caster selection.

**Entities.** Up to 160 bodies and 320 projectiles live in flat buffers in wasm memory. Each tick Rust steps all of them at once: substepped AABB physics against the voxel world, auto-step, knockback, separation, line of sight, and ballistic projectiles with hit detection. A 97×28×97 flow field toward the player is rebuilt four times a second. It handles walls, steps and drops, and every chasing mob steers down it. TypeScript runs the behaviours (state machines on the public `Entity` API).

**Rendering (WebGL2 via three.js):**
- Physically based sky: Rayleigh, Mie and ozone single scattering with a multiple-scattering term, rendered into a small LUT that the sky, fog and reflections all sample.
- Sun and moon, rotating stars, a Milky Way band, and procedural clouds that cast moving shadows.
- Cascade-free stable shadow map (texel-snapped, rotated Poisson PCF) with normal-offset bias. Mobs, items and arrows cast shadows too.
- Smooth lighting and AO, normal maps and specular from generated material textures, and emissive blocks. Entities sample the voxel light field through a Rust light probe, so a zombie in a tunnel is dark and one next to a torch is lit.
- Waving leaves and grass. Foliage lets light through, and alpha-to-coverage keeps it sharp.
- Water: screen-space reflections, refraction with Beer-Lambert absorption, a sun glint, shoreline foam, a Snell's-window view from below, and caustics plus softened shadows on underwater floors.
- A first-person view with a skinned arm, real 3D held models with their own swings and poses, walk bob, look sway, a landing dip and recoil. Games can add their own held models, grips and keyframe animations.
- Movable block builds ("props", like the Starfighter ships and the Skyship): a Blueprint meshed once with the world's block textures, AO, shadows and glowing blocks, then moved freely every frame. glTF and GLB models (Blockbench, Blender) as props, animated figures and voxel characters, lit and shadowed like everything else.
- Destructible micro-voxel blocks that guns carve, explosions and craters, glowing laser bolts, a particle system, floating damage numbers and screen shake.
- HDR with MSAA, bloom (13-tap down / tent up), screen-space god rays, ACES tone mapping and underwater fog.

**Assets.** None. All the block textures, the player skin, the starter item sprites and the sound effects are generated procedurally: textures in Rust, sounds with WebAudio. Games bring their own art and sounds the same way. For example, the Arena paints its mobs and weapons in TypeScript (`src/games/arena/art/`) and synthesises its creature voices, and Starfighter builds its ships from blocks.

**Performance.** These numbers were measured on an Apple M2 Max at 1600×900 with the default settings (12 chunks, 4× MSAA, 3072² shadows).
- **Sandbox:** the main thread spends about 2 ms per frame, rendering about 600 draw calls and 0.7 M triangles. A worker job takes about 1.4 ms to generate a chunk and about 1.1 ms to light and mesh one. At 20 chunks (about 1,300 columns) the world streams in within about 5 s and stays at 60 fps.
- **Arena:** a full run holds 60 fps with 12+ mobs, arrows and fireballs in flight, at about 1–2 ms of CPU per frame.

The settings menu has shadow quality, resolution scale, MSAA and per-effect toggles for slower GPUs.

</details>

More: [the architecture section of the platform guide](docs/PLATFORM.md#architecture-and-the-road-to-multiplayer) and the design notes in [docs/](docs).

## Contributing

Games, fixes and platform features are all welcome: [CONTRIBUTING.md](CONTRIBUTING.md) says how to add a game and what gets merged. Before opening a PR, run `npm run build` and `npm run test:headless` (and `npm run test:engine` if you touched Rust); CI runs the same checks. New games are best started from [docs/PLATFORM.md](docs/PLATFORM.md). Keep a game to `@platform` imports, and the boundary check will tell you if it strays.

## License

MIT: see [LICENSE](LICENSE). Starfighter, Blockfront II and Call of Blocky are parodies, not affiliated with or endorsed by the owners of the films and games they riff on.
