# Arena II: design

The Arena is a co-op horde game: survive wave after wave of monsters in a gladiator's arena, get
stronger between waves, and kill the bosses. The aim of this push is Call of Blocky and Blockfront
quality: real maps, a full run of 20 waves with four bosses, an economy, more weapons and
monsters, and the polish (models, HUD, sound, intro, end screen, hit feel) to match.

## Pillars

1. **Readable danger.** Everything that hurts is telegraphed: a glow, a raised arm, a ring on the
   ground, a sound. A watchful player can dodge-roll (Q), block or jump out of anything. Damage
   should feel fair, not like dice.
2. **Power growth you can feel.** Each wave you get stronger: gold, better weapons with rarities,
   blessings, armour. By wave 15 you're carving through crowds that would have killed you at wave 3.
3. **Chaos you cause.** Bombs, kegs, traps, chain reactions, lightning. The best moments are a dozen
   monsters going up at once because of something you did.
4. **Variety every run.** Different maps, twists, elites, blessings, chest rolls and classes, so no
   two runs are alike.
5. **Spectacle.** It's an arena: a crowd that roars at your big plays, bosses with entrances, a
   finale.

## The run

- **20 waves.** Bosses on waves **5 (Bone Colossus, `colossus`)**, **10 (The Warden, `warden`)**,
  **15 (The Broodmother, `broodmother`)** and **20 (The Lich King, `lich`, the finale)**. Winning
  wave 20 is victory; then "Keep fighting" goes on into **endless** waves (21+), the budget
  growing, the bosses returning as elites every fifth wave, for a best-wave record.
- **Between waves (about 20 s):** the shop opens on the map's `shop` spot (buy weapons, armour,
  potions, bombs, arrows, forge upgrades); pick a blessing; grab the wave's reward.
- **Gold:** monsters drop coins (value from their cost); a wave-clear bonus; the crowd's favour
  doubles it. Spend it at the shop, on trap levers, at the **mystery chest** (a random weapon of a
  random rarity, CoD-zombies style; it moves between the map's `chests` spots).
- **Down, not out (co-op):** at 0 health with friends standing you're downed (crawling, bleeding
  out over 20 s); a friend holds E for 3 s to revive you at a third of your health. Bled out, you
  sit out the wave as now. Solo: a Phoenix Feather (shop) revives you once.
- **The crowd's hype:** kills fill it, style fills it faster (multikills, blast kills, parries,
  trap kills, kills on low health, boss hits); it drains slowly. Full: **the Crowd's Favour**:
  10 s of double gold and the emperor throws gifts into the arena, with a roar.
- **Classes** (picked when the run starts; unlocked by level): Gladiator (gladius and shield),
  Hunter (bow and daggers), Berserker (battle axe, more health), Pyromancer (fire staff and bombs).
- **Progression:** XP for waves, kills and bosses; levels 1-30 in `player.store`; unlocks classes and
  cosmetics; best wave per map. The end screen shows it.
- **Twists** (most waves after the first, never boss waves): Blood Moon, Powder Keg, The Swarm,
  Treasure Hunt, and more (Gold Rush, Elite Night, Frenzy…).
- **Elites** from wave 6: some monsters come as champions with an affix (fiery, frozen, vampiric,
  shielded, hasted, explosive, splitting…), a gold name, a glow, more health and more gold.

## Architecture (the foundation)

The game is split into parts, each in its own folder, so they can be built side by side:

| Where | What |
| --- | --- |
| `server.ts` | The fight's flow: phases, waves cleared, falling, victory and defeat. Calls each part. |
| `part.ts`, `parts.ts` | `ArenaPart`: `setup`, `start`, `update`, `arm` (a fighter armed). The server calls every part, in order. |
| `client/part.ts`, `client/parts.ts` | `ClientPart`: kits and `setup`, on each screen. |
| `run/bus.ts` | The Arena's own events (`runStart`, `waveStart`, `waveCleared`, `spawned`, `slain`, `fell`, `rejoined`, `runEnd`, `gold`, `hype`, `feat`). **Parts talk through the bus, not by calling each other.** Add events here when you need them (and say so). |
| `run/state.ts` | The fight as it stands (`state`, `map()`, `runs`). |
| `run/director.ts` | The waves: `WaveSpec` (a roster, a budget filled from the registry, a boss), twists, spawning. |
| `run/spawn.ts` | `spawnMonster`: everything that brings a monster in goes through it (hooks, the bus). |
| `run/gold.ts` | Each fighter's gold: `gold`, `addGold`, `spend` (tells the bus). |
| `run/use.ts` | E to use: `addUsable({ id, at, label, use, hold? })`. The shop, levers, the chest, revives. |
| `maps/` | `ArenaMap` (`registry.ts`): blocks, center, radius, gates, boss gates, lookout, time, intro, shop, chests. `MAPS` in `index.ts`. Maps stand at their own `origin` in one void world, all on the ground at `FLOOR` (70). |
| `monsters/` | `MonsterKind` (`registry.ts`): definition, cost, from, weight, max, role, hooks. `MONSTERS` in `index.ts`. AI in `ai.ts`. |
| `bosses/` | `BossKind`: name, title, colour, definition, escort, hooks. `BOSSES` in `index.ts`. |
| `items/` | The items (`index.ts`), what's for sale (`catalog.ts`). |
| `blessings.ts`, `abilities.ts` | Blessings; the dodge roll. |
| `hud/` | What the screens are told about the HUD. |
| `tools/voxel.mjs` | The micro-voxel glTF toolkit (as CoB's and Blockfront's): build models with `tools/<what>/build.mjs`, write GLBs next to the code that uses them (`?url` imports). |

Everything places things relative to `map()` (never the old Colosseum constants).

## Who owns what

Six builders work at once, each on a branch in their own worktree. **Stay inside your files.** If
you must touch a shared file (`server.ts`, `meta.ts`, `run/bus.ts`, `items/index.ts`,
`client/looks.ts`, `client/sounds/index.ts`, the platform), keep the change small and say so in
your report. Platform changes must be generic (no Arena words in `src/platform`), small, documented
in `docs/PLATFORM.md`, and must not break other games.

| Builder | Owns | Builds |
| --- | --- | --- |
| **maps** | `maps/**`, `client/maps.ts`, `client/sounds/maps.ts` | The Colosseum remade properly (crowd in the stands, the emperor's box, braziers, banners, lifts or portcullises for the gates, decoration) and **three new maps** (ideas: a moonlit Necropolis, a volcanic Forge, a frozen Sanctum), each with its own layout, cover, height and hazards (not just a circle). **Traps** players trigger with gold at a lever (spike floors, fire jets, a crusher, a blade sweep) that kill monsters and credit the puller. Set `shop`, `chests`, `gates`, `bossGates`, `lookout`, `intro` on every map. **Map choice:** the public rotation, a vote at the end of a run (like CoB's `nextvote.ts`), a pick in your own room. **Intro fly-over** per map (`client.camera.take`, like Blockfront's `client/intro.ts`), per-map ambience and weather. Prove monsters can path from every gate to the center on every map (a headless probe). |
| **bestiary** | `monsters/**` (not the existing kinds' tuning without reason), `client/bestiary.ts`, `client/sounds/bestiary.ts`, `tools/monsters/**` | **New monsters**, each with a mechanic you play around: `knight` (a shield in front: flank it, bomb it), `wraith` (blinks, drains), `slime` that splits into `slime_small`, `imp` (quick, throws fire), `golem` (slow, armoured, ground pound), `cultist` (empowers others, or sacrifices itself to summon), and more if they're good (`bat` swarms if flying works). **Elites and affixes** (from wave 6). **Voxel glTF models** for the non-humanoids (a proper voxel spider to replace the box one, the slime, the golem, …); humanoids use `Models.character`. Their voices. Register each in `MONSTERS` with honest cost, `from` and weight. |
| **bosses** | `bosses/**`, `client/bosses.ts`, `client/sounds/bosses.ts`, `tools/bosses/**` | **Four bosses** with phases and telegraphed attacks: `colossus` (wave 5: a giant skeleton, sweeps, bone rain on marked circles, skeletons from its ribcage), `warden` (wave 10: the existing one, made better), `broodmother` (wave 15: a giant spider queen, web shots that slow, egg sacs that hatch, leaps), `lich` (wave 20, the finale: a floating caster in phases: frost and bolts, raising the dead with phylacteries to break, a soul storm, an enrage). **Entrances:** a short cinematic (camera on the boss, its name card), then the fight. Big deaths and a loot shower. Voxel glTF models (the colossus, the broodmother, the lich). Their voices and stings. |
| **armory** | `items/**` (incl. `catalog.ts`), `client/armory.ts`, `client/looks.ts`, `client/sounds/armory.ts`, `blessings.ts`, `tools/weapons/**` | **New weapons**: `gladius` (sword and shield: right mouse blocks, a well-timed block parries: stagger the attacker, reflect arrows), `warhammer` (charged ground slam), `spear` (thrown, comes back or is picked up), `crossbow` (piercing bolts), `daggers` (fast, crit from behind), `greatsword` (wide sweeps), `fire_staff`, `frost_staff`, `storm_wand` (magic: fire, slow, chain lightning). **Rarities** (common, rare, epic, legendary: better stats, a coloured glow, legendaries with an effect); export `variant(base, rarity)` and `rarityOf(id)` from `items/rarity.ts` for the shop and the chest. **Forge upgrades** (a weapon to its next rarity, for gold: give the run the price). Voxel held models for all the weapons (and, if there's time, voxel remakes of the old swords), first-person poses, sounds. **Blessings**: more of them (about 25), rarities, some that stack, synergies with the new weapons. Prices in `catalog.ts`. |
| **run** | `server.ts`, `run/**` (director, gold, use, new files), `client/run.ts`, `client/sounds/run.ts`, `meta.ts` | **The run**: 20 waves (+ endless) in `WAVES` (rosters and budgets that use the new monsters and bosses by id; unknown ids are skipped, so you needn't wait for them), new twists. **Gold** (coins that drop and are pulled to you, kill and wave values), **the shop** (at the map's `shop`: a merchant, `addUsable`, a menu, from `catalog.ts`), **the mystery chest**, **downed and revives**, **the crowd's hype** and the Crowd's Favour, **classes**, **XP, levels and unlocks**, best waves, more achievements. Keep the Arena tests passing (update them when the rules change on purpose). |
| **hud** | `hud/**`, `client/hud.ts`, `client/sounds/hud.ts`, any CSS, the `hud.theme` in `shared.ts` | **The Arena's look and feel**: a theme (fonts, colours, panels in the spirit of Blockfront's modern HUD, an arena's bronze, gold and blood), widgets (wave and enemies left, gold with pick-up pops, the hype meter, combo and multikill callouts, blessings, the boss bar's look, low-health vignette), the **announcer** (wave starts, boss incoming, multikills, the crowd's favour), a **wave-cleared card** and an **end-of-run screen** (stats, XP and level, best wave) as good as CoB's and Blockfront's. **Music**: drums that build through a wave and a boss theme, calmer between waves (`client.audio.defineLoop`). **The crowd**: an ambience that roars at kills and big plays. **Hit feel**: hit-stop, chunky gore, damage numbers, kill sounds, shake. Server side (`hud/part.ts`) listens to the bus and sends each screen what it needs (changes only). |

Ids the builders share (so rosters, loadouts and catalogs line up): bosses `colossus`, `warden`,
`broodmother`, `lich`; monsters `knight`, `wraith`, `slime`, `slime_small`, `imp`, `golem`,
`cultist` (and `bat` if it flies); weapons `gladius`, `warhammer`, `spear`, `crossbow`, `daggers`,
`greatsword`, `fire_staff`, `frost_staff`, `storm_wand`. If you rename or drop one, say so.

## The bar

- **Looks:** voxel models in the CoB/Blockfront style (`tools/voxel.mjs`, `Models.character` for
  people); nothing blocky-placeholder. Check everything on screen in a real browser.
- **Sound:** every new thing makes a sound; voices synthesised like the rest (`client.audio.define`).
- **Feel:** telegraphs before damage, feedback on every hit, satisfying deaths.
- **Performance:** the server runs four rooms on a small machine (shared-cpu-2x). Keep an Arena room
  around 3 ms a tick with a full wave (at most about 14 monsters alive; avoid raycasts every tick
  for every monster; no allocation storms). Throttle effects sent from the server (an ambient burst
  every frame for every monster is too many). Models: a monster under ~10k triangles, a boss under
  ~30k. 60 fps on a laptop.
- **Writing:** match the code around you: comments in plain sentences that say what and why, names
  that read, no dead code. The platform docs in `docs/PLATFORM.md` stay true.
- **Tests:** `npm run typecheck`, `npm run check:boundaries`, `tests/headless/arena*.ts`, and a
  probe of your own (`tests/headless/_arena-<part>.ts`) proving your part works.

## Working

- Your worktree: `.claude/worktrees/ar-<part>` on branch `ar-<part>`, from `arena2`. Commit there,
  often, with messages like the repo's ("Arena: …"). Don't merge other branches in, don't push,
  don't deploy: the lead merges.
- Your dev server: `node --disable-warning=ExperimentalWarning scripts/dev.mjs --port <web> --server-port <game>`
  (the ports in your brief), `http://localhost:<web>/?game=arena`. The game server only loads new
  server code into a room that starts afresh: restart the dev server after server changes.
  Screenshots: headless Chrome over CDP (`__game.dev("js")` runs code on the server with `game`
  and `me`; see the `visual-checks` notes in your brief).
- When you're done, report: what you built, what's left, every shared or platform file you touched
  and why, the ids you defined, and how you checked it (with screenshot paths).
