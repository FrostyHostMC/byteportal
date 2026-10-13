# Design: accounts, achievements and cosmetics

Status: **approved** (2026-09-26); phases 1 (accounts), 2 (achievements) and 3 (avatars and cosmetics) built. How the platform works now is in PLATFORM.md.

(Since the evening of 2026-09-26 the site is at blockyard.gg and the server at play.blockyard.gg: the same design under the new domain. The addresses below are the ones it was designed with.)

Decided (2026-09-26): the look travels too: a player's avatar (a body made of choices) is theirs in
every game that doesn't dress its players, and everything worn follows the same joints on every kind
of body (the humanoid rig). Later the same day: **no Minecraft-style people**. Avatars (and the
default, and every game's own people and monsters) are the platform's characters, micro-voxel figures
in Call of Blocky's and Blockfront's style built on each screen from a look (`Models.character`), so
what's worn fits the fighters and everyone alike; a team game dresses players in its kit over their
own (`player.setUniform`). The server's address is `play.blockyard.potrock.xyz`; guests' progress lasts
the visit only; cosmetics are on in every game unless it opts out of slots; and **achievements
belong to their game**: each game's are its own, shown by game on the profile, with no platform-wide
points or account level made from them (so no level rewards either).

## Why

Blockyard should get better for everyone each time a game is added, not just by one more title
in the list. Today nothing carries between games: a player is a name typed on the home page,
their progress lives inside one game, and what they earn in one game means nothing in the next.

The cross-game value comes in three layers, each resting on the one before:

1. **Who you are, everywhere.** One account (Sign in with Discord), one name, one profile.
2. **What you've done, on your profile.** Achievements that each game declares for itself and
   the platform keeps and shows, game by game.
3. **What you wear, everywhere.** Cosmetics that games grant and every game shows: a hat earned
   in Call of Blocky is worn in Bed Wars. Each new game adds things to earn that show up in all
   the others. That is the flywheel.

The code already works this way: guns, vehicles, abilities and replays each began in one game and
became platform features every game gets. This design does the same for players.

Decided (2026-09-26): Sign in with Discord; curated games at launch (games reach the platform
through review, in this repo), self-serve uploads later. Assumed until said otherwise: a general
audience of 13 and over (Discord's own minimum), and cosmetics that are earned, never sold.

## What's there now (facts; survey at 86f0f74)

- **Identity is a typed name.** `start { name }` (net/validate.ts: letters, digits, `_ .-`, 20
  characters) becomes the player's name; a name already playing becomes "Ann 2"
  (host/game.ts `join`). Nothing checks it.
- **Per-player data is keyed by that name.** The server's SQLite file per game keeps each player's
  place by name (`players` table), and games key `game.store` by name, as PLATFORM.md tells them
  to: Call of Blocky's XP and outfit are `xp:<name>`, its all-time numbers `stats:<name>`
  (callofblocky/progression.ts, server.ts). **Anyone who types "Pat" gets Pat's level and
  unlocks.**
- **The server** (host/server.ts) is one Node process on one Fly machine: plain HTTP routes
  (`/health`, `/games`, CORS `*`) beside the WebSocket; each room in a worker thread; a SQLite file
  per game on the `/data` volume. A connection names its room in the path (`/bedwars/k3x9f2`).
  The site is static, on Vercel, at another address (blockyard.potrock.xyz); the server is
  voxel-games.fly.dev.
- **Figures** come in three kinds:
  - the box humanoid on a skin atlas (`Models.humanoid`: Arena, Bed Wars, Sandbox, Skyship, Obby,
    Heart Hunt). Its parts are `head`, `body`, `armL/R`, `legL/R`; `extras` with a `parent` hang
    parts on them (the Warden's crown), but the parts aren't named in the scene, so client code
    can't find the head.
  - glTF on the humanoid rig (Call of Blocky, High Noon, Blockfront). Its joints are named (`head`,
    `chest`, `handL/R`…, docs/HUMANOID.md); client code sees them as `Figure.rig.joints`.
  - none: Starfighter (`controller: 'none'`) draws ships (props), not players; its pilots' labels
    are server markers on the ships.
- **Held items** are the only thing attached to figures today (`Figure.hand`, a mount in the right
  fist or on the chest). There is no general "attach to a joint" API.
- **Name tags** are the runtime's (`hud.marker('$name:<id>')`): one label, one colour for dot and
  text, no second line.
- **Looks reach other screens as a whole model**: Call of Blocky's outfits are `setModel` with
  another glTF, so the wire carries a model, never "what they're wearing".

## Principles

- **Guests first.** Anyone can still play at once with a typed name. Signing in is what keeps
  progress; nothing but saving needs it.
- **The login never reaches game code.** Not the server's (a game gets a player's account id and
  name, never a token) and not the browser's (the session is an HttpOnly cookie on the server's
  address, which no page script can read). This holds for curated games now and is what makes
  self-serve games possible later.
- **Cross-game things are data, declared in `meta.ts`.** Achievements and cosmetics are lists the
  launcher and the profile read without loading a game. Games say what exists and when it's
  earned; the platform keeps, shows and draws it. No game ships code that runs in another game.
- **Earned on the server only.** A game grants from its server code; a client never can.
- **A game can grant only its own.** Its achievements and cosmetics are namespaced by its id.

## The design

### Accounts: Sign in with Discord

**Where it lives.** The game server, not the site: it's already a long-running process with a
database on a volume, the WebSocket needs to know who's connecting, and the site stays static.

**Its address.** The server gets a name under the site's own domain,
`play.blockyard.potrock.xyz` (a CNAME to Fly, plus `fly certs add`). Pages on
blockyard.potrock.xyz and the server are then the same *site* (both potrock.xyz), so the
server's cookie goes with the WebSocket handshake and with `fetch(..., { credentials:
'include' })`, and no third-party cookie rules get in the way. voxel-games.fly.dev keeps working
for guests.

**The flow** (OAuth2 authorization code, scope `identify` only: no email, no friends list):

1. "Sign in with Discord" on the home page goes to `GET /auth/discord?back=<page>`. The server
   makes a random `state`, keeps it in a short-lived cookie, and redirects to Discord's authorize
   page.
2. Discord sends the player back to `GET /auth/discord/callback?code&state`. The server checks the
   state, trades the code for a token (with the client secret), reads `GET /users/@me` (id,
   username, global name, avatar), and then forgets Discord's token: we never call Discord again.
3. It finds or makes the account for that Discord id, starts a session, and sets
   `__Host-session=<random 32 bytes>` (HttpOnly, Secure, SameSite=Lax, 90 days; the database keeps
   only its hash), then redirects back to the page.
4. `GET /me` (CORS: the site's origin only, with credentials) answers `{ id, name, avatar }`
   or 401. `POST /auth/logout` ends the session. `DELETE /me` deletes the account and everything
   kept for it.

**The WebSocket.** On the upgrade the server reads the cookie, looks up the session, and checks
the `Origin` header against the site's addresses (a page elsewhere can't open a connection as the
player). The room hears `connect(client, who)`, where `who` is `{ account: { id, name, avatar } }`
or `{ guest: true }`. A signed-in player's `start` name is ignored: they play as their account's
name.

**Names.** An account's name is unique across the platform (ignoring case), starts as their
Discord display name (made unique with a number), and can be changed (once a day) from the
profile. A name an account holds can't be typed by a guest: they get "Pat (guest)". Guest names
otherwise work as now.

**Game API.**

```ts
player.account // { id: string; name: string; avatar: string | null } | null (a guest)
player.store   // this player's own data, kept for their account (for a guest: this visit only)
player.store.get<T>(key) / set(key, value) / delete(key)
```

`player.store` is what games use for per-player data from now on (PLATFORM.md stops suggesting
`stats:${player.name}`). It lives in the game's own SQLite file, keyed by account id. A guest's
lasts until they leave; the platform tells them what they'd keep by signing in.

**Moving today's data.** The first account to claim a name adopts what was kept under it (the
name is theirs from then on, so nobody else can). Games move their own keys on that player's
first join (Call of Blocky: `xp:<name>` and `stats:<name>` into `player.store`); the platform says
when (`player.adopted`: the name they claimed, once). Call of Blocky, Bed Wars, Sky Obby (best
times) and Blockfront are the games with per-player data today.

**Where it's kept.** `/data/accounts.sqlite`, owned by the server's main thread: `accounts`
(id, discord id, name, avatar, created, seen), `sessions` (hash, account, expires), and the
achievements and cosmetics below. Rooms, in their threads, ask and tell the main thread by message.

### Achievements

Each game's are its own (decided 2026-09-26): no points adding up across games, no account level.
Declared in the game's meta, so the profile can list every game's without loading any:

```ts
export default defineMeta({
  id: 'callofblocky',
  achievements: {
    first_blood: { title: 'First Blood', description: 'Take down another player' },
    untouchable: { title: 'Untouchable', description: 'Win a match without going down' },
    quiet_room: { title: 'Quiet Room', description: '...', hidden: true },
  },
});
```

The server grants them: `player.achieve('first_blood')`. That's all a game writes. The platform
keeps it (once) and shows the toast on that player's screen. A guest sees the toast with "Sign in
to keep this"; it isn't kept. The profile shows each game's: done, to do (hidden ones only once
done), and when.

### Cosmetics

**Slots.** First: `hat` (on the head), `back` (between the shoulders), `title` (a second line on
the name tag) and `tag` (the name tag's colour). Later, on their own merits: `trail`, `emote`,
effects on a game's own things (a ship's paint in Starfighter).

**A cosmetic is data.** Declared in a game's meta (its own) or the platform's (everyone's
defaults):

```ts
cosmetics: {
  gold_fedora: { name: 'Gold Fedora', slot: 'hat', model: fedoraGlb, icon: fedoraPng, how: 'Win 10 matches' },
  pulp_title: { name: 'Pulp Hero', slot: 'title', text: 'Pulp Hero', how: 'Reach level 20' },
},
```

A hat or back item is a small GLB (or voxel parts) placed on a joint with an offset, inside a size
budget (a hat fits a box 0.8 blocks around the head) so it can't hide a head in a shooter, and
never changes a hitbox. Reviewing a game includes its cosmetics: the look, the size, and that no
game grants something that passes for another game's.

**Earning.** `player.grant('gold_fedora')` from the game's server code (its own ids only), or
`reward: 'gold_fedora'` on an achievement. The platform keeps what each account owns and what it
has on (one per slot).

**Wearing.** The **locker**, on the home page and in the pause menu, shows what you own by slot,
and which games you earned each in. What you have on is part of your player on every screen: a new
`look` field on the player in frames (cosmetic ids, sent only when it changes, like `skin`), which
the client resolves from the catalog every screen already has (the metas).

**Drawing.** A platform client kit, on by default in walking games:

- Figures get named attach points on both kinds of body: `head` and `back` (the rig's `head` and
  `chest`; the box humanoid's `head` and `body`, which means naming its pivots). This is a general
  `Figure.attach(point, node)` that games can use too, not something only cosmetics can do.
- Hats and back items go on those points; `title` and `tag` go into the name tag, which gains a
  second line and a colour of its own.
- Your own hat is hidden in first person, as your head is.
- Games choose: `meta.cosmetics.wear` lists the slots they show (default: all four for a walking
  game with the platform's figures). A game with its own bodies can read `player.look` and draw
  its own way, which is how Starfighter's ships would get paint.

### The home page and profile

A corner of the home page shows who you are: "Sign in with Discord" for a guest, or your Discord
avatar and name, with a menu (sign out, delete the account). The name box is your account's name
once you're signed in, and changing it there renames you. Phase 2 adds the **profile** (your
achievements by game, done and to do) and phase 3 the locker.

## Security and privacy

- Scope `identify` only. Kept: the Discord id, username, display name and avatar hash. Discord's
  token is used once and dropped.
- The session is a random token in an HttpOnly, Secure, SameSite=Lax cookie with a `__Host-`
  prefix; the database keeps its SHA-256. Signing out deletes it, and sessions expire.
- The OAuth `state` is checked; `back` only returns to the site's own addresses.
- WebSocket upgrades check `Origin`; `/me` and the locker answer only the site's origin.
- Games never see a token. `player.account` is an id, a name and an avatar URL.
- `DELETE /me` removes the account, its sessions, achievements and cosmetics, and its
  `player.store` data in every game.
- A short privacy note on the site says what's kept and how to delete it.

## Operations

- **Discord application**: made by Pat in the Discord developer portal, with redirects
  `https://play.blockyard.potrock.xyz/auth/discord/callback` and
  `http://localhost:8787/auth/discord/callback`. Its id and secret go in Fly secrets
  (`DISCORD_CLIENT_ID`, `DISCORD_CLIENT_SECRET`), set by Pat so the secret never passes through
  this repo or a chat.
- **Domain**: a `play.blockyard` CNAME at Namecheap to `voxel-games.fly.dev`, and
  `fly certs add play.blockyard.potrock.xyz`. The site builds with
  `VITE_GAME_SERVER=wss://play.blockyard.potrock.xyz`.
- **Backups**: accounts can't be regenerated the way a world can. Keep Fly's volume snapshots
  (daily), and add continuous backups of the SQLite files (Litestream to object storage on Fly).
- **Scale**: one machine owns the accounts file. That's fine far beyond launch; more machines
  later means moving accounts to a shared database first.
- **Development**: `npm run dev` adds `GET /auth/dev?name=Ann` (development servers only), which
  signs in as a made-up account, so tests and screenshots never need Discord. Real Discord works
  locally once the localhost redirect is set.
- **Deploying** changes the protocol (`look`, the room's `who`), so the server and the site go
  out together.

## Plan

1. **Accounts** (the foundation):
   - server: auth routes, sessions, `accounts.sqlite`, the WebSocket's `who`, `Origin` checks, name
     rules, `/auth/dev`;
   - API: `player.account`, `player.store`, `player.adopted`;
   - home page: sign in, the account corner, the name from the account;
   - Call of Blocky, Bed Wars, Sky Obby and Blockfront: per-player data into `player.store`,
     adopting what was under the name;
   - tests: guests and accounts, names held, sessions, adoption, a room in a worker seeing `who`;
   - PLATFORM.md.
2. **Achievements**: `meta.achievements`, `player.achieve`, the toast, the profile (by game).
   Every listed game gets its first five to ten achievements, which proves the API on every kind
   of game.
3. **Cosmetics**:
   - the catalog in metas, `grant`/`reward`, owning and wearing;
   - `look` on the wire;
   - `Figure.attach` on both bodies, the cosmetics kit, the name tag's second line;
   - the locker;
   - the first set: a few platform defaults, and two or three per game.
4. **Friends and parties** (outline only for now): friends by name, who's playing what, "join",
   and parties that move from game to game together (switching games in place and rooms of one's
   own already exist).

Alongside, for launch: an `author` in meta (credit on the card and the game's page), a guide to
submitting a game, and per-game numbers for their authors.

## Decisions (2026-09-26)

1. **The server's address**: `play.blockyard.potrock.xyz`.
2. **Guests' progress**: kept only for the visit.
3. **Cosmetics in competitive games**: on by default; games opt out of slots.
4. **Achievements**: scoped to their game; no platform-wide points or level.
