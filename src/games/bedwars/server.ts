import { defineServer, Models, type Actor, type Entity, type GameContext, type Player, type Vec3 } from '@platform';
import { bows, building, consumables, interactions, melee, type Building, type Interactions } from '@platform/kits';
import { BEDWARS_ATLAS, paintBedwarsAtlas } from './art';
import { Bot } from './bots';
import { Fireballs } from './fireballs';
import { defineItems } from './items';
import { Lobby, type Plan } from './lobby';
import { Nav } from './nav';
import { BOT_LOOKS, SHOPKEEPER, UNIFORMS } from './people';
import { BLOCK_ITEMS, shared } from './shared';
import { Shop } from './shop';
import {
  armorPoints,
  CURRENCIES,
  CURRENCY_NAME,
  emptyWallet,
  Match,
  mineTime,
  Pile,
  PICK_ITEMS,
  RESPAWN_SECONDS,
  SUDDEN_DEATH_AT,
  SWORD_ITEMS,
  swordItem,
  TEAM_STYLE,
  type Member,
  type Team,
} from './state';
import { MAPS, type PlacedMap } from './world';

// Match state, created in setup.
let match: Match;
let nav: Nav;
/** Each map's route planner (made the first time it's played). */
const navs = new Map<string, Nav>();
let shop: Shop;
let fireballs: Fireballs;
let lobby: Lobby;
/** Survival building (mining and placing, under Bed Wars' rules) and the shopkeepers. */
let build: Building;
let talk: Interactions;
const bots = new Map<number, Bot>();
/** HUD timers and the diamond / emerald countdowns. */
const hud = { refresh: 0, diamondIn: 30, emeraldIn: 60 };
/** Per team: when it may next be warned of an enemy at its bed. */
const alarms = new Map<Team, number>();
/** Blocks to take away once their chunks are loaded (a lobby box, a bed on an island nobody's near yet). */
let clearing: Vec3[] = [];

/** Take these blocks away: now where the world's loaded, the rest as it loads. */
function clear(game: GameContext, cells: Vec3[]) {
  for (const c of cells) {
    const id = game.world.getBlock(c.x, c.y, c.z);
    if (id < 0) clearing.push(c);
    else if (id > 0) game.world.setBlock(c.x, c.y, c.z, 'air');
  }
}
let nextBotSkill = 0;

/** A player's all-time numbers, kept by name in `game.store` (the server's database). */
interface AllTime {
  games: number;
  wins: number;
  kills: number;
  finals: number;
  beds: number;
}
/** Players whose match has been counted (once each, when it ends for them). */
const recorded = new Set<Player>();

/** Count this match into a player's all-time numbers (once; kept for their account), and return them. */
function record(p: Player, me: Member, won: boolean): AllTime {
  const r: AllTime = { games: 0, wins: 0, kills: 0, finals: 0, beds: 0, ...p.store.get<AllTime>('stats') };
  if (!recorded.has(p)) {
    recorded.add(p);
    r.games++;
    if (won) r.wins++;
    r.kills += me.kills;
    r.finals += me.finals;
    r.beds += me.beds;
    p.store.set('stats', r);
  }
  return r;
}

/** Wins, all time, for Bed Wars Veteran. */
const VETERAN_WINS = 10;
/** A bed broken this soon into the match (seconds) is Early Riser. */
const EARLY_BED = 120;
/** Seconds of results before everyone's back in the lobby. */
const RESULTS = 12;

const BOT_SKILL = [0.8, 0.95, 0.88];

/** Pathfinding bounds: every structure, plus room to bridge around them. */
function navBounds(map: PlacedMap) {
  let x0 = Infinity;
  let x1 = -Infinity;
  let z0 = Infinity;
  let z1 = -Infinity;
  for (const bp of map.blueprints) {
    x0 = Math.min(x0, bp.origin.x);
    z0 = Math.min(z0, bp.origin.z);
    x1 = Math.max(x1, bp.origin.x + bp.size.x - 1);
    z1 = Math.max(z1, bp.origin.z + bp.size.z - 1);
  }
  return { x0: x0 - 16, x1: x1 + 16, z0: z0 - 16, z1: z1 + 16, y0: map.voidY + 4, y1: Math.min(250, map.center.y + 30) };
}

function navFor(game: GameContext, map: PlacedMap): Nav {
  let n = navs.get(map.id);
  if (!n) navs.set(map.id, (n = new Nav(game, navBounds(map), (x, y, z) => match.isPlaced(x, y, z))));
  return n;
}

const clock = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

// ---------------------------------------------------------------------------------------------
// Deaths, respawns, beds
// ---------------------------------------------------------------------------------------------

/** Who gets the kill: whoever dealt the blow, else whoever hit them last (knocked into the void). */
function killerOf(victim: Member, source: unknown): Member | null {
  const direct = match.memberOfActor(source as Actor | undefined);
  if (direct && direct.team !== victim.team) return direct;
  const lh = victim.lastHit;
  return lh && match.now - lh.at < 10 ? lh.by : null;
}

/** Someone as the feed names them: the player's name, or the bot's team (and place, on bigger teams). */
const who = (m: Member) => m.player?.name ?? (match.size > 1 ? `${m.team.name} ${m.seat + 1}` : m.team.name);

/** Still in it: alive, or coming back. */
const standing = (m: Member) => !m.out && (!!m.player?.alive || !!m.body?.alive || m.respawnAt !== null);

function announceDeath(game: GameContext, victim: Member, killer: Member | null, fell: boolean) {
  const final = !victim.team.bed;
  const v = who(victim);
  let text: string;
  if (killer) text = fell ? `${v} was knocked into the void by ${who(killer)}` : `${v} was slain by ${who(killer)}`;
  else text = fell ? `${v} fell into the void` : `${v} died`;
  game.hud.feed(final ? `${text}. FINAL KILL!` : text, { color: final ? '#ffd84a' : undefined });
  if (killer) {
    killer.kills++;
    if (final) killer.finals++;
    // The killer takes their resources.
    const loot = victim.wallet;
    const got: string[] = [];
    for (const c of CURRENCIES) {
      if (loot[c] > 0) {
        killer.wallet[c] += loot[c];
        got.push(`+${loot[c]} ${CURRENCY_NAME[c][loot[c] === 1 ? 0 : 1]}`);
      }
    }
    const p = killer.player;
    if (p) {
      if (got.length) p.hud.feed(got.join('  '), { color: '#9fe88a' });
      p.audio.play(final ? 'final_kill' : 'crit', { volume: 0.7 });
      p.achieve('first_blood');
      if (final) p.achieve('final_kill');
      if (fell) p.achieve('into_the_void');
    }
  }
  victim.wallet = emptyWallet();
  victim.lastHit = null;
}

/** Someone died: back in a few seconds while the bed stands, else out for good (and maybe the team with them). */
function died(game: GameContext, m: Member, killer: Member | null, fell: boolean) {
  announceDeath(game, m, killer, fell);
  if (m.team.bed) {
    m.respawnAt = match.now + RESPAWN_SECONDS;
  } else {
    m.out = true;
    m.respawnAt = null;
    checkTeam(game, m.team);
    // Out, but the team fights on without them.
    if (m.player && !m.team.eliminated && !match.over) m.player.hud.banner('YOU ARE OUT', 'Your team fights on without you', { duration: 3, color: '#ff5b5b' });
  }
}

/** A team with no bed and nobody left standing is out. */
function checkTeam(game: GameContext, t: Team) {
  if (!t.eliminated && !t.bed && !t.members.some(standing)) eliminate(game, t);
}

function eliminate(game: GameContext, t: Team) {
  if (t.eliminated) return;
  t.eliminated = true;
  for (const m of t.members) {
    m.respawnAt = null;
    m.out = true;
  }
  game.audio.play('final_kill');
  const names = t.members.filter((m) => m.player).map((m) => m.player!.name);
  game.hud.feed(`TEAM ELIMINATED › ${t.name}${names.length ? ` (${names.join(', ')})` : ''} is out of the game`, { color: t.css });
  const alive = match.alive();
  // Over when one team is left, or when nobody's left playing to watch it end.
  if (alive.length <= 1 || !alive.some((x) => x.members.some((m) => m.player))) {
    finish(game, alive.length === 1 ? alive[0] : null);
    return;
  }
  for (const m of t.members) {
    const p = m.player;
    if (!p) continue;
    shop.close(p);
    p.hud.screen({
      title: 'ELIMINATED',
      subtitle: 'Your team is out. Watch the others fight it out.',
      tone: 'defeat',
      stats: stats(m, record(p, m, false)),
      buttons: [
        { label: 'Watch', primary: true, onClick: () => {} },
        { label: 'Exit', onClick: () => game.exit() },
      ],
    });
  }
}

function destroyBed(game: GameContext, owner: Team, by: Member | null, quiet = false) {
  if (!owner.bed) return;
  owner.bed = false;
  clear(game, owner.base.bed);
  if (quiet) return;
  const c = owner.base.bed[0];
  game.fx.burst({ x: c.x + 0.5, y: c.y + 0.6, z: c.z + 0.5 }, { color: owner.css, count: 40, speed: 5, size: 0.14 });
  game.audio.play('bed_break');
  if (by) by.beds++;
  if (by?.player) {
    by.player.achieve('rude_awakening');
    if (match.now < EARLY_BED) by.player.achieve('early_riser');
  }
  const how = by ? ` by ${who(by)}` : match.suddenDeath ? ' by sudden death' : '';
  // Its owners hear it their way; everyone else sees whose bed went.
  for (const p of game.players) {
    if (match.memberOf(p)?.team === owner) {
      p.hud.banner('BED DESTROYED!', 'You will no longer respawn', { duration: 3, color: '#ff5b5b' });
      p.audio.play('alarm', { volume: 0.6 });
    } else {
      p.hud.banner('BED DESTRUCTION', `${owner.name} bed was destroyed${how}`, { duration: 2.6, color: owner.css });
    }
  }
  game.hud.feed(`BED DESTRUCTION › ${owner.name} bed was destroyed${how}`, { color: owner.css });
  // Anyone waiting to respawn is now out.
  for (const m of owner.members) {
    if (m.respawnAt !== null) {
      m.respawnAt = null;
      m.out = true;
    }
  }
  checkTeam(game, owner);
}

/**
 * Watch, flying free (the platform's spectating: nobody sees them, nothing touches them): from
 * where they are, or from up over the middle when that's nowhere to watch from (fallen into the
 * void, just joined). A respawn (`revive`) ends it.
 */
function spectate(p: Player, here = false) {
  const c = match.map.center;
  if (!here || p.position.y < match.map.voidY + 8) p.teleport({ x: c.x, y: c.y + 26, z: c.z + 34 }, 0, -0.55);
  else p.teleport({ x: p.position.x, y: p.position.y + 1.5, z: p.position.z });
  p.freeze(false);
  p.spectate(true);
  p.hud.toast('Spectating: fly with WASD, Space and Shift up and down, Ctrl for speed');
}

/** Dress a player in their team's colours. */
function wear(p: Player, t: Team) {
  p.setUniform(UNIFORMS[t.color]);
  p.color = t.css;
}

/**
 * Put a member's player on their island with their gear. After a death they keep everything they
 * carried; their sword, pickaxe and shears are handed back if they're missing (someone who took
 * the place over while it waited to respawn arrives with nothing).
 */
function placePlayer(m: Member, afterDeath: boolean) {
  const p = m.player!;
  const t = m.team;
  m.respawnAt = null;
  p.revive();
  p.freeze(false);
  p.teleport(t.base.spawn, t.base.spawnYaw, 0);
  const inv = p.inventory;
  if (!afterDeath) inv.clear();
  const gear = [swordItem(t, m.sword), m.pick ? PICK_ITEMS[m.pick] : '', m.shears ? 'shears' : ''];
  for (const item of gear) if (item && !inv.count(item)) inv.give(item);
  if (!afterDeath) inv.select(0);
  applyGear();
  if (afterDeath) {
    p.audio.play('spawn');
    p.hud.banner('RESPAWNED', '', { duration: 1.2, color: t.css });
  }
}

/**
 * Someone joined mid-match: they take over a place from a bot (or an empty one), on the team with
 * the fewest people, and carry on with its bed, gear and wallet. With no place left, they watch.
 */
function seat(game: GameContext, p: Player) {
  if (match.memberOf(p)) return;
  const people = (t: Team) => t.members.filter((m) => m.player).length;
  const open = match.teams
    .filter((t) => !t.eliminated)
    .sort((a, b) => people(a) - people(b))
    .flatMap((t) => t.members.filter((m) => !m.player && !m.out));
  const m = open[0];
  if (!m) {
    spectate(p);
    p.hud.banner('WATCHING', 'Every place is taken: you play next match', { duration: 3 });
    return;
  }
  const t = m.team;
  m.player = p;
  wear(p, t);
  const bot = m.body;
  if (bot) {
    bots.delete(bot.id);
    bot.remove();
    m.body = null;
  }
  if (m.respawnAt === null) placePlayer(m, false);
  else spectate(p);
  p.hud.banner(`${t.name.toUpperCase()} TEAM`, t.bed ? 'Protect your bed · Destroy the others' : 'Your bed is gone: this life is your last', { duration: 3, color: t.css });
  game.hud.feed(`${p.name} takes over ${who({ ...m, player: null })}`, { color: t.css });
}

/** A player left: a bot carries on in their place. */
function unseat(game: GameContext, p: Player) {
  const m = match.memberOf(p);
  if (!m) return;
  m.player = null;
  shop.close(p);
  if (match.over || m.team.eliminated || m.out) return;
  game.hud.feed(`${p.name} left: a bot plays for ${m.team.name}`, { color: m.team.css });
  // Waiting to respawn: the bot comes in then instead.
  if (m.respawnAt === null) spawnBot(game, m, true);
}

function spawnBot(game: GameContext, m: Member, firstLife: boolean) {
  const t = m.team;
  const s = t.base.spawn;
  const e = game.entities.spawn(`bot_${t.color}`, s, { yaw: t.base.spawnYaw, data: { team: t.color, seat: m.seat } });
  m.body = e;
  e.held = swordItem(t, m.sword);
  m.respawnAt = null;
  const skill = BOT_SKILL[nextBotSkill++ % BOT_SKILL.length];
  bots.set(e.id, new Bot(match, nav, build, fireballs, m, e, skill, firstLife));
}

/** Armour and swords as the gear and the team's upgrades have them (anyone's purchase, a bot's too). */
function applyGear() {
  for (const m of match.members()) {
    const t = m.team;
    const p = m.player;
    if (p) {
      p.armor = armorPoints(m);
      // Sharpened Swords: the swords they carry get their edge.
      if (t.sharp) {
        for (const s of SWORD_ITEMS) {
          const n = p.inventory.count(s);
          if (n) {
            p.inventory.take(s, n);
            p.inventory.give(`${s}_sharp`, n);
          }
        }
      }
    }
    if (m.body?.alive) {
      m.body.armor = armorPoints(m);
      m.body.held = swordItem(t, m.sword);
    }
  }
}

// ---------------------------------------------------------------------------------------------
// The lobby, and the start of a match
// ---------------------------------------------------------------------------------------------

/** The lobby's done: everyone to their team's island on the chosen map, bots in the places left. */
function begin(game: GameContext, plan: Plan) {
  lobby.close();
  match.map = plan.map;
  match.begin(plan.size);
  nav = navFor(game, plan.map);
  const map = plan.map;
  // Generators: iron and gold on every island, diamonds on the small ones, emeralds in the middle.
  match.piles = [
    ...match.teams.flatMap((t) => [new Pile('iron', t.base.generator, 48), new Pile('gold', t.base.generator, 12)]),
    ...map.diamonds.map((d) => new Pile('diamond', d, 4, '#6fe8ff')),
    ...map.emeralds.map((e) => new Pile('emerald', e, 3, '#4dff91')),
  ];
  Object.assign(hud, { refresh: 0, diamondIn: match.diamondEvery, emeraldIn: match.emeraldEvery });

  for (const [p, color] of plan.teams) {
    const t = match.teams.find((x) => x.color === color)!;
    const m = t.members.find((x) => !x.player)!;
    m.player = p;
    wear(p, t);
  }
  for (const t of match.teams) {
    const humans = t.members.some((m) => m.player);
    t.members.forEach((m, i) => {
      if (m.player) return;
      const bot = plan.bots === 'fill' || (plan.bots === 'teams' && !humans && i === 0);
      if (!bot) m.out = true;
    });
    game.entities.spawn('shopkeeper', t.base.shop, { yaw: t.base.shopYaw });
    // Nobody at all on a team: it's out before it starts.
    if (t.members.every((m) => m.out)) {
      destroyBed(game, t, null, true);
      t.eliminated = true;
    }
  }
  for (const t of match.teams) {
    for (const m of t.members) {
      if (m.player) placePlayer(m, false);
      else if (!m.out) spawnBot(game, m, true);
    }
  }
  // The lobby box goes: the match is under it. The home page looks on from where spectators do.
  const box: Vec3[] = [];
  map.lobby.blueprint.forEach((x, y, z) => box.push({ x, y, z }));
  clear(game, box);
  game.world.spawn = { x: map.center.x, y: map.center.y + 26, z: map.center.z + 34, yaw: 0 };

  // Iron and gold at every island.
  game.clock.every(1.2, () => {
    for (const p of match.piles) if (p.item === 'iron') p.add(game, 1);
  });
  game.clock.every(7, () => {
    for (const p of match.piles) if (p.item === 'gold') p.add(game, 1);
  });

  for (const m of match.members()) {
    const p = m.player;
    if (!p) continue;
    const mates = m.team.members.filter((x) => x !== m).map(who);
    p.hud.banner(`${m.team.name.toUpperCase()} TEAM`, mates.length ? `With ${mates.join(', ')} · Protect your bed` : 'Protect your bed · Destroy the others', { duration: 3.2, color: m.team.css });
  }
  game.hud.feed(`${map.name} · ${['', 'Solos', 'Doubles', 'Threes', 'Fours'][plan.size]}`, { color: '#ff5b5b' });
  game.audio.play('wave');
  refreshHud(game);
}

// ---------------------------------------------------------------------------------------------
// End of the match
// ---------------------------------------------------------------------------------------------

const stats = (m: Member, all: AllTime): [string, string][] => [
  ['Kills', String(m.kills)],
  ['Final kills', String(m.finals)],
  ['Beds broken', String(m.beds)],
  ['Time', clock(match.now)],
  ['All-time wins', `${all.wins} of ${all.games}`],
  ['All-time kills', String(all.kills)],
];

/** A team as the result screen names it: its people, or its colour. */
const teamName = (t: Team) => {
  const names = t.members.filter((m) => m.player).map((m) => m.player!.name);
  return names.length ? `${t.name} (${names.join(', ')})` : t.name;
};

/**
 * The match is over: `winner` is the last team standing (null: no one's left playing). `cheat`:
 * ended by the `bw` command, which earns no achievements. After the results, back to the lobby.
 */
function finish(game: GameContext, winner: Team | null, cheat = false) {
  if (match.over) return;
  match.over = true;
  shop.closeAll();
  if (winner?.members.some((m) => m.player)) game.fx.fireworks(winner.base.spawn, 6);
  for (const p of game.players) {
    // Everyone stops where they are for the results (the void no longer kills: nobody walks into it).
    p.freeze(true, { weapons: true });
    const me = match.memberOf(p);
    const won = !!me && me.team === winner;
    const all = me ? record(p, me, won) : null;
    if (won && all && !cheat) {
      p.achieve('first_win');
      if (me.team.bed) p.achieve('sweet_dreams');
      if (all.wins >= VETERAN_WINS) p.achieve('veteran');
    }
    p.audio.play(won ? 'victory' : 'defeat');
    game.clock.after(won ? 1.8 : 1.4, () =>
      p.hud.screen({
        title: won ? 'VICTORY!' : 'GAME OVER',
        subtitle: `${won ? 'Your team is the last one standing' : winner ? `${teamName(winner)} wins` : 'Your team has been eliminated'} · Back to the lobby shortly`,
        tone: won ? 'victory' : 'defeat',
        stats: me && all ? stats(me, all) : [['Time', clock(match.now)]],
        buttons: [
          { label: 'OK', primary: true, onClick: () => {} },
          { label: 'Exit', onClick: () => game.exit() },
        ],
      }),
    );
  }
  game.clock.after(RESULTS, () => game.restart());
}

// ---------------------------------------------------------------------------------------------
// HUD
// ---------------------------------------------------------------------------------------------

function nextEvent(): string {
  const t = match.now;
  const events: [number, string][] = [
    [240, 'Diamond II'],
    [360, 'Emerald II'],
    [480, 'Diamond III'],
    [SUDDEN_DEATH_AT, 'Sudden death'],
  ];
  const next = events.find(([at]) => at > t);
  return next ? `${next[1]} in ${clock(next[0] - t)}` : 'Sudden death!';
}

function refreshHud(game: GameContext) {
  applyGear();
  // Everyone's scoreboard, with their own team marked, and their own wallet.
  for (const p of game.players) {
    const mine = match.memberOf(p);
    if (mine && !p.alive && mine.respawnAt !== null) {
      p.hud.objective(`Respawning in ${Math.ceil(mine.respawnAt - match.now)}…`);
    } else {
      const status = match.teams
        .map((t) => `${t.name.toUpperCase()} ${t.eliminated ? '✘' : t.bed ? '✔' : t.members.filter(standing).length}${t === mine?.team ? ' (you)' : ''}`)
        .join('   ');
      p.hud.objective(`${status}   ·   ${nextEvent()}`);
    }
    const w = mine?.wallet ?? emptyWallet();
    p.hud.stat('iron', 'Iron', w.iron);
    p.hud.stat('gold', 'Gold', w.gold);
    p.hud.stat('diamond', 'Diamonds', w.diamond);
    p.hud.stat('emerald', 'Emeralds', w.emerald);
  }
  // Generator holograms.
  match.map.diamonds.forEach((d, i) => {
    game.hud.marker(`dia${i}`, { x: d.x, y: d.y + 2.4, z: d.z }, { shape: 'dot', color: '#6fe8ff', size: 5, label: `Diamond ${'I'.repeat(match.diamondTier)} · ${Math.ceil(hud.diamondIn)}s` });
  });
  match.map.emeralds.forEach((d, i) => {
    game.hud.marker(`em${i}`, { x: d.x, y: d.y + 2.4, z: d.z }, { shape: 'dot', color: '#4dff91', size: 5, label: `Emerald ${'I'.repeat(match.emeraldTier)} · ${Math.ceil(hud.emeraldIn)}s` });
  });
}

// ---------------------------------------------------------------------------------------------
// The game
// ---------------------------------------------------------------------------------------------

export default defineServer(shared, {
  // Its kinds of item: bows, swords and pickaxes (and the bare fist), golden apples and fire charges.
  items: [bows(), melee(), consumables()],
  setup(game) {
    // The game's atlas goes to every screen: the skins, the bots' sword, and the item sprites the
    // screens' looks name. (Its items' looks and its voices are each screen's, `client/`; named and
    // played by name here.)
    const art = paintBedwarsAtlas();
    game.items.atlas(BEDWARS_ATLAS, { width: art.width, height: art.height, pixels: art.albedo, emissive: art.emissive });
    match = new Match(game, MAPS[0]);
    nav = navFor(game, MAPS[0]);
    build = building(game, {
      canBreak: (at, block, by) => match.canBreak(at, block, by),
      canPlace: (at, block, by) => match.canPlace(at, block, by),
      blockOf: (item) => BLOCK_ITEMS[item] ?? null,
      breakTime: (block, held) => {
        const item = held?.item ?? '';
        return mineTime(block, Math.max(0, PICK_ITEMS.indexOf(item)), item === 'shears');
      },
    });
    talk = interactions(game, { shopkeeper: (_keeper, player) => shop.show(player) });
    fireballs = new Fireballs(match);
    shop = new Shop(match, () => applyGear());
    lobby = new Lobby(game, match, (plan) => begin(game, plan));
    defineItems(game, match, fireballs);
    if (import.meta.env.DEV) (globalThis as unknown as { __bw: unknown }).__bw = { match, bots, lobby, navs };

    // Every team has bots, playing the places nobody else is.
    for (const color of Object.keys(UNIFORMS) as (keyof typeof UNIFORMS)[]) {
      game.entities.define(`bot_${color}`, {
        name: TEAM_STYLE[color].name,
        model: Models.character({ ...BOT_LOOKS[color], ...UNIFORMS[color] }),
        held: SWORD_ITEMS[0],
        hitbox: { width: 0.6, height: 1.8 },
        health: 20,
        speed: 4.3,
        sounds: { hurt: 'hurt', death: 'mob_death' },
        ai: (self, _g, dt) => bots.get(self.id)?.update(dt),
      });
    }
    game.entities.define('shopkeeper', {
      name: 'Item Shop',
      model: Models.character(SHOPKEEPER),
      hitbox: { width: 0.6, height: 1.9 },
      health: 100,
      speed: 0,
      knockbackResistance: 1,
      invulnerable: true,
      ai: (self) => {
        const p = self.nearestPlayer();
        self.lookAt(p && self.distanceTo(p) < 7 ? p : null);
      },
    });

    // Blocks placed during the match are the only ones that can be broken.
    game.events.on('blockPlace', (e) => match.markPlaced(e.x, e.y, e.z, true));
    game.events.on('blockBreak', (e) => {
      match.markPlaced(e.x, e.y, e.z, false);
      const owner = match.bedAt(e);
      if (owner) destroyBed(game, owner, match.memberOfActor(e.by));
    });

    // Nobody's hurt in the lobby, and nobody hurts their own team.
    game.events.on('damage', (e) => {
      if (match.lobby) return e.cancel();
      const src = e.source;
      if (!src || src === 'world' || src === e.target) return;
      const a = match.teamOf(src);
      if (a && a === match.teamOf(e.target)) e.cancel();
    });

    // Kill credit, and bots turning on whoever hits them.
    game.events.on('entityDamage', (e) => {
      const victim = match.memberOfActor(e.entity);
      const by = match.memberOfActor(e.source ?? null);
      if (!victim || !by || by.team === victim.team) return;
      victim.lastHit = { by, at: match.now };
      const bot = bots.get(e.entity.id);
      const src = e.source;
      if (bot && src && src !== 'world') bot.provoke(src.kind === 'player' ? { kind: 'player', team: by.team, p: src } : { kind: 'bot', team: by.team, e: src as Entity });
    });
    game.events.on('playerDamage', (e) => {
      const victim = match.memberOf(e.player);
      const by = match.memberOfActor(e.source ?? null);
      if (victim && by && by.team !== victim.team) victim.lastHit = { by, at: match.now };
    });
    game.events.on('entityDeath', (e) => {
      const m = match.memberOfActor(e.entity);
      if (!m || m.body !== e.entity) return;
      bots.delete(e.entity.id);
      m.body = null;
      if (match.over) return;
      died(game, m, killerOf(m, e.killer), e.entity.position.y < match.map.voidY + 1);
    });
    game.events.on('playerDeath', (e) => {
      const p = e.player;
      const m = match.memberOf(p);
      if (!m || match.over || match.lobby) return;
      shop.close(p);
      const bed = m.team.bed;
      died(game, m, killerOf(m, e.source), p.position.y < match.map.voidY + 1);
      if (bed) p.hud.banner('YOU DIED!', `Respawning in ${RESPAWN_SECONDS} seconds`, { duration: 2, color: '#ff5b5b' });
      game.clock.after(1.2, () => {
        if (!p.alive && !match.over && match.memberOf(p) === m) spectate(p, true);
      });
    });

    // Players coming and going: into the lobby, or mid-match taking over from bots (and handing back to them).
    game.events.on('playerJoin', (e) => {
      // Signed in for the first time since claiming their name: the numbers kept by it are theirs.
      const was = e.player.adopted;
      if (was) {
        const old = game.store.get<AllTime>(`stats:${was}`);
        if (old) e.player.store.set('stats', old);
        game.store.delete(`stats:${was}`);
      }
      if (e.player.bot) return;
      if (match.lobby) lobby.enter(e.player);
      else if (match.over) spectate(e.player);
      else seat(game, e.player);
    });
    game.events.on('playerLeave', (e) => {
      if (match.lobby) lobby.leave(e.player);
      else unseat(game, e.player);
    });

    game.commands.register('bw', {
      help: 'Bed Wars tools',
      cheat: true,
      usage: 'start | rich | bed <team> | win | lose | time <seconds>',
      run(args, g, player) {
        const [cmd, arg] = args;
        if (cmd === 'start') {
          if (!match.lobby) throw new Error('The match is already on');
          lobby.startNow();
          return 'Starting';
        }
        if (match.lobby) throw new Error('No match yet: try /bw start');
        const mine = match.memberOf(player) ?? match.player;
        if (cmd === 'rich') {
          const w = mine.wallet;
          Object.assign(w, { iron: w.iron + 64, gold: w.gold + 32, diamond: w.diamond + 8, emerald: w.emerald + 8 });
          return 'Wallet filled';
        }
        if (cmd === 'bed') {
          const t = match.teams.find((x) => x.color === arg);
          if (!t) throw new Error('Which team? red, blue, green or yellow');
          destroyBed(g, t, null);
          return `${t.name} bed destroyed`;
        }
        if (cmd === 'win' || cmd === 'lose') {
          finish(g, cmd === 'win' ? mine.team : (match.teams.find((t) => t !== mine.team) ?? null), true);
          return '';
        }
        if (cmd === 'time') {
          match.startedAt -= Number(arg) || 60;
          return `Match clock at ${clock(match.now)}`;
        }
        throw new Error('Try: start, rich, bed <team>, win, lose, time <seconds>');
      },
      complete: (args) => (args.length <= 1 ? ['start', 'rich', 'bed', 'win', 'lose', 'time'] : args[0] === 'bed' ? ['red', 'blue', 'green', 'yellow'] : []),
    });
  },

  start(game) {
    bots.clear();
    fireballs.clear();
    shop.closeAll();
    alarms.clear();
    recorded.clear();
    clearing = [];
    nextBotSkill = 0;
    // To the lobby over the map just played (or the first).
    match.toLobby(match.map);
    // The home page looks in on the lobby.
    game.world.spawn = { ...match.map.lobby.spawn, yaw: match.map.lobby.yaw };
    lobby.open();
  },

  update(game, dt) {
    // Talking to a shopkeeper takes the right-click before building can.
    talk.update();
    build.update(dt);
    if (match.lobby) {
      lobby.update();
      return;
    }
    if (match.over) return;
    const now = match.now;
    if (clearing.length) {
      const left = clearing;
      clearing = [];
      clear(game, left);
    }
    for (const p of match.piles) p.sync();

    // Diamond and emerald generators, and the match timeline.
    hud.diamondIn -= dt;
    hud.emeraldIn -= dt;
    if (hud.diamondIn <= 0) {
      hud.diamondIn = match.diamondEvery;
      for (const p of match.piles) if (p.item === 'diamond') p.add(game, 1);
    }
    if (hud.emeraldIn <= 0) {
      hud.emeraldIn = match.emeraldEvery;
      for (const p of match.piles) if (p.item === 'emerald') p.add(game, 1);
    }
    const tier = (kind: 'diamond' | 'emerald', level: number, every: number) => {
      if (kind === 'diamond' && match.diamondTier < level) {
        match.diamondTier = level;
        match.diamondEvery = every;
      } else if (kind === 'emerald' && match.emeraldTier < level) {
        match.emeraldTier = level;
        match.emeraldEvery = every;
      } else return;
      game.hud.banner(`${kind === 'diamond' ? 'Diamond' : 'Emerald'} Generators ${'I'.repeat(level)}`, 'They now spawn faster', { duration: 2.2, color: kind === 'diamond' ? '#6fe8ff' : '#4dff91' });
      game.audio.play('wave', { volume: 0.6 });
    };
    if (now > 240) tier('diamond', 2, 22);
    if (now > 360) tier('emerald', 2, 45);
    if (now > 480) tier('diamond', 3, 15);
    if (now > SUDDEN_DEATH_AT && !match.suddenDeath) {
      match.suddenDeath = true;
      game.hud.banner('SUDDEN DEATH', 'Every bed is gone', { duration: 3, color: '#ff5b5b' });
      for (const t of match.teams) destroyBed(game, t, null);
    }
    if (match.over) return;

    // The void.
    const voidY = match.map.voidY;
    for (const m of match.members()) {
      if (m.player?.alive && m.player.position.y < voidY) m.player.damage(1000, { source: 'world', knockback: 0 });
      if (m.body?.alive && m.body.position.y < voidY) m.body.kill();
    }

    // Respawns.
    for (const m of match.members()) {
      if (m.respawnAt === null || now < m.respawnAt || m.out || m.team.eliminated) continue;
      if (m.player) placePlayer(m, true);
      else spawnBot(game, m, false);
    }

    // Heal pools.
    for (const t of match.teams) {
      if (!t.heal) continue;
      const home = t.base.spawn;
      for (const m of t.members) {
        const body = m.player?.alive ? m.player : m.body?.alive ? m.body : null;
        if (body && Math.hypot(body.position.x - home.x, body.position.z - home.z) < 14) body.heal(0.8 * dt);
      }
    }

    fireballs.update(dt);
    shop.refresh();

    // Nametags over the bots near each player, with their health.
    for (const p of game.players) {
      const eye = p.position;
      for (const m of match.members()) {
        const b = m.body;
        const q = b?.position;
        const show = b?.alive && q && Math.hypot(q.x - eye.x, q.y - eye.y, q.z - eye.z) < 40;
        p.hud.marker(`tag-${m.team.color}-${m.seat}`, show ? { x: q.x, y: q.y + 2.25, z: q.z } : null, { shape: 'dot', size: 3, color: m.team.css, label: show ? `${who(m)}  ${Math.ceil(b.health)}♥` : '' });
      }
    }

    // Warn a team's players when an enemy is at their bed.
    for (const t of match.teams) {
      const people = t.members.flatMap((m) => (m.player ? [m.player] : []));
      if (!people.length || !t.bed || (alarms.get(t) ?? 0) > now) continue;
      const bed = t.base.bed[0];
      const near = (q: Vec3) => Math.hypot(q.x - bed.x, q.z - bed.z) < 9 && Math.abs(q.y - bed.y) < 4;
      const enemy = match.members().find((o) => o.team !== t && ((o.body?.alive && near(o.body.position)) || (o.player?.alive && near(o.player.position))));
      if (enemy) {
        for (const p of people) {
          p.hud.toast(`${who(enemy)} is at your bed!`);
          p.audio.play('alarm', { volume: 0.35 });
        }
        alarms.set(t, now + 12);
      }
    }

    hud.refresh -= dt;
    if (hud.refresh <= 0) {
      hud.refresh = 0.25;
      refreshHud(game);
    }
  },
});
