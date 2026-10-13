# Contributing to Blockyard

Blockyard is a platform for multiplayer block games in the browser, and the best thing you can bring to it is a game. The engine, the multiplayer server, accounts, lobbies, achievements and hosting are already there: a game is a folder of a few small TypeScript files that only describe its rules and content. Build one (with an AI agent or without), open a pull request, and once it's merged it's live at [blockyard.gg](https://blockyard.gg) for anyone to play.

Fixes and improvements to the platform itself are just as welcome.

## Add a game

1. **Run it locally.** You need Rust (stable) with the `wasm32-unknown-unknown` target, and Node 20 or newer.

   ```sh
   rustup target add wasm32-unknown-unknown
   npm install
   npm run dev        # the engine, a local game server and the site on http://localhost:5173
   ```

   Development mode has cheats (`/` opens the command bar) and `await __game.dev('…')` in the console, which runs code in your game's room on the server. See [Running and debugging](docs/PLATFORM.md#running-and-debugging).

2. **Make your game** in `src/games/<your-id>/`: `meta.ts` (what the home page lists), `shared.ts` (the world, blocks and movement every screen shares), `server.ts` (the rules) and `client.ts` (each player's screen). [Make a game](README.md#make-a-game) shows the shape and [docs/PLATFORM.md](docs/PLATFORM.md) is the full guide. The smallest complete game is `src/games/heart-hunt/`; Arena, Bed Wars and Call of Blocky show bigger ones.
   - List it in `src/games/browser.ts` and `src/games/server.ts`, then open `?game=<your-id>`.
   - Import only from `@platform` and `@platform/client`, never the engine's insides. The boundary check enforces it.
   - Give it a cover: `cover.webp` in its folder (16:9, an in-game shot) as `meta.cover`, for the home page.
   - A match game? Let bots fill the empty places, so it's fun with one player too.

3. **Check it.**

   ```sh
   npm run build          # type-check, the boundary check, a production bundle
   npm run test:headless  # every game (yours included) runs 30 s in Node, plus the multiplayer tests
   npm run test:engine    # only if you touched the Rust engine
   ```

   A headless test of your own (`tests/headless/<your-id>.ts`: see the others) that plays your game's main loop is a big help.

4. **Open a pull request**, one game per PR, with a line on what it is, how to play and a screenshot or clip. CI builds and tests every pull request.

### Building with an AI agent

That's how the platform and its games were made. Point your agent at `docs/PLATFORM.md`, at the game here closest to yours, and at this file. Ask it to keep to the public API, to run `npm run build` and `npm run test:headless` before it's done, and to check the game in the browser with `npm run dev`.

### When the platform can't do what your game needs

Extend the platform rather than working around it: new features go behind the public API (`src/platform/api`) with sensible defaults, so the next game gets them too. The engine never learns game-specific words (item kinds, style names, a game's vocabulary). Say in the PR what you added and why.

## What gets merged

Games are curated while the platform is young (self-serve publishing is on the way):

- **It works and it's fun.** It runs without errors, multiplayer works, and it keeps up on an ordinary laptop.
- **Original names.** Parody is welcome (see Starfighter's Vox-wing and Star Demolisher); real trademarks aren't, in names, text or code.
- **Assets you can share.** Your own, generated in the repo (as the built-in models are), or under a license compatible with MIT. Say where they came from.
- **Match the code around it.** TypeScript, strict; comments that say why, in full sentences; names that say what. The Rust engine (`engine/`) has its tests in `npm run test:engine`.

## Bugs and ideas

Open an [issue](https://github.com/Potrock/blockyard/issues) with what happened, the game (`?game=…`) and your browser. Ideas for games and platform features are welcome there too.

## License

Blockyard is [MIT licensed](LICENSE). By contributing, you agree that your contribution is released under the same license.
