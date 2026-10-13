import { defineServer, type Bot, type GameContext, type IconRef, type MenuHandle, type MenuOptions, type Pickup, type Player, type Vec3 } from '@platform';
import { guns, melee, navGrid, skipVote, throwables, type Guns, type NavGrid, type SkipVote } from '@platform/kits';
import { AmmoBags } from './ammo';
import { ATLAS, defineArt, OUTFITS, skinOrigin } from './art';
import { CaseRounds } from './briefcase';
import { makeBots, type Bots } from './bots';
import { DOSSIER, MATCHBAR, SKIPVOTE, streakPips } from './hud';
import { MAPS, mapById, type SpawnPoint } from './map';
import { fighterOf, hostile, match, teamFighters, type Fighter } from './match';
import { FFA_LIMIT, MODES, ROTATION, ROUNDS, TDM_LIMIT, TEAMS, type MatchPlan, type ModeId, type Team } from './modes';
import { COLORS, fighterModel, shared } from './shared';
import { NextVote, SCORES, VOTING } from './nextvote';
import { PlayOfTheGame, POTG_DELAY, POTG_KEEP } from './potg';
import { BLURBS, defineWeapons, feedIcon, LETHAL_BLURBS, LETHAL_COUNT, LETHALS, PRIMARIES, SIDEARMS, WEAPONS, weaponName, type Lethal, type Primary } from './weapons';
import { outfitId, setupProgression, type Progression } from './progression'; // [progression]
import { killcam, killcamHolds, killcamsOff } from './killcam';
import { DEFAULT_PERKS, hasPerk, PERK_TIERS, PERKS, perkDamage, SECOND_WIND, SLEIGHT, speedOf, streakCost, type PerkId } from './perks';
import { selfHarm, Streaks } from './streaks';
import { DEFAULT_KILLSTREAKS, isKillstreak, isStreak, isStreakWeapon, KILLSTREAK_IDS, KILLSTREAKS, PICKS, STREAKS, type KillstreakId } from './streaks/kinds';
import { Mortars } from './streaks/mortar';

/**
 * Call of Blocky: fast pulp shootouts against bots and people, on Jackrabbit Lane (a
 * Nuketown-style cul-de-sac), at Big Kahuna Burger (a burger joint, its parking lot and the motel
 * next door) and aboard Hijacked's superyacht (overboard is the end of you). Three modes (modes.ts):
 *
 * - **Free-for-all**: first to 25 kills (or the most when the clock runs out). The briefcase turns
 *   up on the street now and then: grab it for points and a radar sweep.
 * - **Team Deathmatch**: the Suits against the Shirts, first side to 75 kills. No friendly fire.
 * - **The Briefcase**: rounds of Search and Destroy (briefcase.ts): one life each, the attackers
 *   plant the case at A or B, the defenders stop them or crack it; first to four rounds.
 *
 * Bots fill the match (six fighters in a free-for-all, four a side in the team modes); people
 * joining take a bot's place. A public room goes round the modes and maps match by match
 * (`ROTATION`); in a room of one's own (`?room=`), M picks the mode and the map. Either way, V
 * votes to skip the match that's on: once more than half the people in it have, the next is on
 * (the platform's `skipVote` kit).
 *
 * Everyone carries a primary and a sidearm of their choosing (L), a katana and a lethal (G: two
 * Pineapple frags or a Mia firebomb), with a perk from each of three tiers (`perks.ts`) and three
 * killstreaks of six (`streaks/kinds.ts`), all picked in the same loadout. Whoever goes down drops
 * a bag of ammo: walk over it to top up your spare rounds (ammo.ts). The killstreaks, earned at
 * their count of kills in a row: the UAV (everyone on your radar), the Counter-UAV (their radar
 * jammed), the Adrenaline Shot (faster, and patched up) and the Mortar Team (shells on them) come
 * at once; the Hellstorm missile to steer down onto them and the Attack Chopper to fly and shoot
 * from are called in with 5 when you like (`streaks/`). The ones that hurt people are for the
 * free-for-all and Team Deathmatch.
 */

const TIME_LIMIT: Record<ModeId, number> = { ffa: 8 * 60, tdm: 10 * 60, case: Infinity };
/** Never more than this many fighters, people included. */
const MAX_FIGHTERS = 8;
const RESPAWN = 3;
/** How long the Adrenaline Shot lasts. */
const RUSH = 15;
/** How long a UAV's sweep lasts, and a Counter-UAV's jamming. */
const UAV = 25;
const JAM = 25;
/**
 * Seconds between the end of a match and the next: with people in it, its final scores, then the
 * vote on what's next (nextvote.ts); with nobody but bots, the scores alone. Between a match
 * skipped (a vote) and the next, a moment.
 */
const INTERMISSION = 12;
const SKIP_PAUSE = 4;
const BOT_NAMES = ['Lucky Lou', 'Dolly Dagger', 'Sal Nero', 'Candy Kane', 'Rocco', 'Velma', 'Big Tony', 'Honey', 'Duke', 'Jackie Rabbit', 'Frankie Two-Guns', 'Mona', 'Zed', 'Butch'];

let fighters = match.fighters;
/** A match has begun (`start`): newcomers go straight in. */
let running = false;
let startedAt = 0;
let overAt = 0;
/** How long this intermission lasts, and whether the vote on what's next is still to open in it. */
let intermission = INTERMISSION;
let voteNext = false;
/**
 * The intermission's timings (seconds after the match ended): when the Play of the Game starts
 * (-1: none to come), when it's over (0: it isn't playing), and when the vote opens.
 */
let potgAt = -1;
let potgUntil = 0;
let votesAt = SCORES;
/** The match's best play, shown once it's over (potg.ts). */
let potg: PlayOfTheGame;
let firstBlood = false;
let bots: Bots;
let rounds: CaseRounds;
/** The killstreaks you steer: the Hellstorm and the Attack Chopper (`streaks/`). */
let streaks: Streaks;
/** Ammo bags the fallen drop (ammo.ts). */
let ammo: AmmoBags;
/** The Mortar Team's shells (`streaks/mortar.ts`). */
let mortars: Mortars;
/** The gun kit (Sleight of Hand's reloads). */
let gunKit: Guns | null = null;
/** Each map's walking grid (built once its blocks have loaded, the first time a match is on it). */
let navs = new Map<string, NavGrid>();
/** The map's hotspots, where bots drift (the array the bots read: refilled for each map). */
const hotspots: Vec3[] = [];
let boardDirty = true;
/** The briefcase: on the street (a pickup), and when the next one turns up. */
let briefcase: Pickup | null = null;
let nextBriefcase = 0;
let boardAt = 0;
let lastSecond = -1;
/** What the next match plays; where the public rotation has got to; what a room of one's own has picked. */
let plan: MatchPlan = ROTATION[0];
let turn = 0;
/** The team the next fighter to join goes on (bots added to fill a side). */
let joining: Team | null = null;
/** Who a dead fighter watches in The Briefcase (their team's, until the round's out). */
const watching = new Map<string, Player>();
/** The match settings menu in a room of one's own, and whether anyone's opened it yet. */
let settings: MenuHandle | null = null;
let offered = false;
/** The vote to skip the match that's on (the platform's `skipVote` kit), and whether the match now over was skipped. */
let vote: SkipVote;
let skipped = false;
/** The vote on the next match's mode and map, once a match is played out (nextvote.ts). */
let next: NextVote;
/** [progression] XP, levels and unlocks (progression.ts). */
let xp: Progression;
/** A person's all-time numbers (`player.store`, `stats`). */
type AllTime = { games: number; wins: number; kills: number; deaths: number; best: number };

const fmt = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
const ordinal = (n: number) => `${n}${n % 10 === 1 && n % 100 !== 11 ? 'st' : n % 10 === 2 && n % 100 !== 12 ? 'nd' : n % 10 === 3 && n % 100 !== 13 ? 'rd' : 'th'}`;
const isCase = () => match.mode.id === 'case';
const planName = (m: MatchPlan) => `${MODES[m.mode].name} on ${mapById(m.map)?.name ?? m.map}`;

/** What a bot carries: mostly rifles and SMGs, now and then a shotgun or the machine gun, rarely a scope. */
const BOT_PRIMARIES: [Primary, number][] = [
  ['rifle', 0.24],
  ['famas', 0.1],
  ['smg', 0.14],
  ['tommy', 0.13],
  ['shotgun', 0.11],
  ['sawnoff', 0.06],
  ['lmg', 0.09],
  ['marksman', 0.07],
  ['sniper', 0.06],
];
function botPrimary(r: number): Primary {
  for (const [id, share] of BOT_PRIMARIES) if ((r -= share) < 0) return id;
  return 'rifle';
}

/** A bot's perks and killstreaks: any one from each tier, any three. */
function botChoice(game: GameContext): Fighter['choice'] {
  const pool = [...KILLSTREAK_IDS];
  const killstreaks: KillstreakId[] = [];
  while (killstreaks.length < PICKS) killstreaks.push(pool.splice(game.rng.int(0, pool.length - 1), 1)[0]);
  return { perks: PERK_TIERS.map((tier) => tier[game.rng.int(0, tier.length - 1)]), killstreaks: byCost(killstreaks) };
}

const byCost = (ids: KillstreakId[]) => [...ids].sort((a, b) => KILLSTREAKS[a].kills - KILLSTREAKS[b].kills);

function standings(): Fighter[] {
  return [...fighters.values()].sort((a, b) => b.score - a.score || b.kills - a.kills || a.deaths - b.deaths);
}

/** A name's colour in the kill feed: their side's in a team mode. */
function nameColor(p: Player, fallback: string): string {
  const t = fighterOf(p)?.team;
  return match.mode.teams && t !== null && t !== undefined ? TEAMS[t].color : fallback;
}

// -------------------------------------------------------------------------------------------------
// Fighters: joining, teams, spawning, loadouts
// -------------------------------------------------------------------------------------------------

function addFighter(game: GameContext, p: Player): Fighter {
  const taken = new Set([...fighters.values()].map((f) => f.outfit));
  const free = OUTFITS.map((_, i) => i).filter((i) => !taken.has(i));
  // [progression] People wear what they've unlocked (their last pick, else one nobody has on); bots anything.
  const outfit = !p.bot ? xp.outfitFor(p, taken) : free.length ? free[Math.floor(game.rng.next() * free.length)] : game.rng.int(0, OUTFITS.length - 1);
  const f: Fighter = {
    player: p,
    kills: 0,
    deaths: 0,
    score: 0,
    streak: 0,
    best: 0,
    headshots: 0,
    plants: 0,
    defuses: 0,
    primary: p.bot ? botPrimary(game.rng.next()) : 'rifle',
    sidearm: p.bot && game.rng.next() < 0.3 ? 'revolver' : 'pistol',
    lethal: p.bot && game.rng.next() < 0.35 ? 'molotov' : 'frag',
    outfit,
    team: null,
    diedAt: -1,
    spawnedAt: 0,
    lastKillAt: -99,
    multi: 0,
    uavUntil: 0,
    uavFor: 0,
    rushUntil: 0,
    streaks: [],
    choice: p.bot ? botChoice(game) : { perks: [...DEFAULT_PERKS], killstreaks: [...DEFAULT_KILLSTREAKS] },
    perks: [],
    killstreaks: [],
    jamUntil: 0,
    jamFor: 0,
    hurtAt: -99,
    firedAt: -99,
    menu: null,
    radar: '',
    heartbeat: 0,
    chose: false,
  };
  // Their fighter, and the skin behind it (the box figure, for a client still fetching the model).
  dress(p, outfit);
  fighters.set(p.id, f);
  if (match.mode.teams) setTeam(game, f, joining ?? smallerTeam(!p.bot));
  boardDirty = true;
  return f;
}

function dress(p: Player, outfit: number) {
  p.setSkin(skinOrigin(outfit), ATLAS);
  p.setModel(fighterModel(outfit));
}

/** The side with fewer on it (counting only people, for a person joining; then everyone). */
function smallerTeam(person: boolean): Team {
  const count = (t: Team, people: boolean) => teamFighters(t).filter((f) => !people || !f.player.bot).length;
  if (person && count(0, true) !== count(1, true)) return count(0, true) < count(1, true) ? 0 : 1;
  return count(0, false) <= count(1, false) ? 0 : 1;
}

/** Put a fighter on a side: its colour over their head, and one of its outfits. */
function setTeam(game: GameContext, f: Fighter, t: Team) {
  f.team = t;
  const p = f.player;
  // [progression] People wear only what they've unlocked (a side's wardrobe has something for
  // everyone: its level-1 outfits); bots anything.
  const all = TEAMS[t].outfits;
  const wardrobe = p.bot ? all : all.filter((o) => xp.has(p, outfitId(o)));
  const choices = wardrobe.length ? wardrobe : all;
  if (!choices.includes(f.outfit)) {
    const worn = new Set(teamFighters(t).filter((o) => o !== f).map((o) => o.outfit));
    const free = choices.filter((o) => !worn.has(o));
    f.outfit = free.length ? free[game.rng.int(0, free.length - 1)] : choices[game.rng.int(0, choices.length - 1)];
    dress(p, f.outfit);
  }
  p.color = TEAMS[t].color;
  if (!p.bot) p.hud.widget('matchbar', { mine: t });
  boardDirty = true;
}

/** New sides for a team match: people spread across them first, then the bots fill in. */
function formTeams(game: GameContext) {
  for (const f of fighters.values()) f.team = null;
  const all = [...fighters.values()];
  for (const f of [...all.filter((f) => !f.player.bot), ...all.filter((f) => f.player.bot)]) setTeam(game, f, smallerTeam(!f.player.bot));
}

/** Back to everyone for themselves. */
function clearTeams() {
  for (const f of fighters.values()) {
    f.team = null;
    f.player.color = null;
  }
}

/** The spawn point furthest from any enemy who could see it (and, in Team Deathmatch, near a friend). */
function pickSpawn(game: GameContext, me: Player): SpawnPoint {
  const map = match.map;
  const teams = match.mode.teams;
  const pool = teams ? [...map.spawns, ...map.teams[0], ...map.teams[1]] : map.spawns;
  const enemies = game.players.filter((p) => p !== me && p.alive && hostile(me, p));
  const friends = teams ? game.players.filter((p) => p !== me && p.alive && !hostile(me, p)) : [];
  let best = pool[0];
  let bestScore = -Infinity;
  for (const sp of pool) {
    let near = 60;
    let seen = false;
    for (const e of enemies) {
      const q = e.position;
      const d = Math.hypot(q.x - sp.x, q.y - sp.y, q.z - sp.z);
      near = Math.min(near, d);
      if (!seen && d < 55 && game.world.lineOfSight(e.eye, { x: sp.x, y: sp.y + 1.6, z: sp.z })) seen = true;
    }
    const friend = friends.some((p) => Math.hypot(p.position.x - sp.x, p.position.z - sp.z) < 22) ? 8 : 0;
    const score = near - (seen ? 40 : 0) + game.rng.next() * 6 + friend;
    if (score > bestScore) {
      bestScore = score;
      best = sp;
    }
  }
  return best;
}

/** Armed with their loadout, and their perks and killstreaks picked for it taken up. */
function arm(p: Player, f: Fighter) {
  f.perks = [...f.choice.perks];
  f.killstreaks = byCost(f.choice.killstreaks);
  const inv = p.inventory;
  inv.clear();
  inv.give(f.primary);
  inv.give(f.sidearm);
  inv.give('katana');
  // The lethal rides in the fourth slot: thrown with G, never switched to.
  inv.give(f.lethal, lethalCount(f));
  inv.select(0);
  p.speed = speedOf(f) * (f.rushUntil ? 1.2 : 1);
  gunKit?.setReloadSpeed(p, hasPerk(f, 'sleight') ? SLEIGHT : 1);
}

/** How many lethals a life (Warlord: one more). */
const lethalCount = (f: Fighter) => (LETHAL_COUNT[f.lethal] ?? 1) + (hasPerk(f, 'warlord') ? 1 : 0);

/** Revive a fighter at a spawn point, armed, protected for a moment. */
function spawnAt(game: GameContext, f: Fighter, sp: SpawnPoint) {
  const p = f.player;
  p.camera.orbit(null);
  watching.delete(p.id);
  p.freeze(false);
  p.revive();
  p.health = p.maxHealth;
  p.teleport({ x: sp.x, y: sp.y + 0.05, z: sp.z }, sp.yaw, 0);
  f.rushUntil = 0;
  arm(p, f);
  p.protect(1.5);
  f.diedAt = -1;
  f.spawnedAt = game.clock.now;
  if (p.bot) bots.reset(p);
  else p.audio.play('respawn');
}

/** A (re)spawn where the mode says: the safest spot, or in The Briefcase their side's end. */
function spawn(game: GameContext, f: Fighter) {
  if (isCase() && f.team !== null) {
    const pts = f.team === rounds.attackers ? match.map.bomb.attack : match.map.bomb.defend;
    spawnAt(game, f, pts[game.rng.int(0, pts.length - 1)]);
    // Between rounds (or before one starts), they wait with everyone else.
    if (rounds.phase === 'prep' || rounds.phase === 'post') f.player.freeze(true, { weapons: true });
    return;
  }
  spawnAt(game, f, pickSpawn(game, f.player));
}

/**
 * Whether a fighter may pick this weapon from the loadout (a primary, a sidearm or a lethal). All
 * of them, for now: progression hooks in here.
 */
function canPick(_f: Fighter, _item: string): boolean {
  return true;
}

/** Scavenger: an ammo bag gives back the lethals they've thrown. */
function scavenge(p: Player) {
  const f = fighters.get(p.id);
  if (!f || !hasPerk(f, 'scavenger')) return;
  const short = lethalCount(f) - p.inventory.count(f.lethal);
  if (short <= 0) return;
  p.inventory.give(f.lethal, short);
  if (!p.bot) p.hud.pop('+LETHAL', { color: COLORS.gold });
}

function loadoutMenu(game: GameContext, f: Fighter) {
  if (f.menu?.open) return;
  const p = f.player;
  // Just spawned (or waiting for the round): swap now; otherwise it's for the next life.
  const pick = (name: string) => {
    if (p.alive && (game.clock.now - f.spawnedAt < 5 || (isCase() && rounds.phase === 'prep'))) {
      arm(p, f);
      p.hud.toast(`${name} it is`);
    } else p.hud.toast(`${name} next life`);
  };
  const entries = () =>
    PRIMARIES.filter((id) => canPick(f, id)).map((id) =>
      xp.gate(p, id, {
        icon: feedIcon(id) ?? undefined,
        label: WEAPONS[id].name,
        note: BLURBS[id],
        active: f.primary === id,
        onSelect: () => {
          f.primary = id;
          f.chose = true;
          f.menu?.close();
          pick(WEAPONS[id].name);
        },
      }),
    ); // [progression] locked: greyed out, refused
  const sidearms = () =>
    SIDEARMS.filter((id) => canPick(f, id)).map((id) =>
      xp.gate(p, id, {
        icon: feedIcon(id) ?? undefined,
        label: WEAPONS[id].name,
        note: BLURBS[id],
        active: f.sidearm === id,
        onSelect: () => {
          f.sidearm = id;
          f.menu?.update({ sections: sections() });
          pick(WEAPONS[id].name);
        },
      }),
    ); // [progression]
  const lethals = () =>
    (Object.keys(LETHALS) as Lethal[])
      .filter((id) => canPick(f, id))
      .map((id) =>
        xp.gate(p, id, {
          icon: feedIcon(id) ?? undefined,
          label: LETHALS[id].name,
          note: LETHAL_BLURBS[id],
          active: f.lethal === id,
          onSelect: () => {
            f.lethal = id;
            f.menu?.update({ sections: sections() });
            pick(LETHALS[id].name);
          },
        }),
      ); // [progression]
  // A perk from each tier.
  const perks = (tier: number) =>
    PERK_TIERS[tier].map((id: PerkId) => ({
      label: PERKS[id].name,
      note: PERKS[id].blurb,
      active: f.choice.perks[tier] === id,
      onSelect: () => {
        f.choice.perks[tier] = id;
        f.menu?.update({ sections: sections() });
        pick(PERKS[id].name);
      },
    }));
  // Three killstreaks: a tap takes one, or puts one back.
  const killstreaks = () =>
    KILLSTREAK_IDS.map((id) => {
      const k = KILLSTREAKS[id];
      const mine = f.choice.killstreaks.includes(id);
      return {
        label: k.name,
        note: k.blurb,
        detail: `${k.kills} kills`,
        active: mine,
        onSelect: () => {
          if (!mine && f.choice.killstreaks.length >= PICKS) {
            p.hud.toast(`${PICKS} killstreaks at most: tap one of yours to put it back`);
            return;
          }
          f.choice.killstreaks = mine ? f.choice.killstreaks.filter((x) => x !== id) : byCost([...f.choice.killstreaks, id]);
          f.menu?.update({ sections: sections() });
          pick(`Killstreaks (${f.choice.killstreaks.map((x) => KILLSTREAKS[x].name).join(', ') || 'none'})`);
        },
      };
    });
  // [progression] Outfits (the locked greyed out), and the sections all together.
  const outfits = () => xp.outfits(p, f.outfit, (i) => ((f.outfit = i), f.menu?.update({ sections: sections() })));
  const sections = () => [
    { title: 'Primary', entries: entries() },
    { title: 'Sidearm', entries: sidearms() },
    { title: 'Lethal (G)', entries: lethals() },
    ...PERK_TIERS.map((_, t) => ({ title: `Perk ${t + 1}`, entries: perks(t) })),
    { title: `Killstreaks (pick ${PICKS})`, entries: killstreaks() },
    outfits(),
  ];
  f.menu = p.hud.menu({
    title: 'Pick your piece',
    subtitle: `Level ${xp.level(p)}, more unlocking as you go. Your primary, your sidearm, your lethal, a perk from each tier, ${PICKS} killstreaks and your look; the katana comes along regardless.`, // [progression]
    sections: sections(), // [progression]
    onClose: () => {
      f.menu = null;
    },
  });
}

/** Bots fill the match to the mode's size (in a team mode, each side to half of it); people take their places. */
function balanceBots(game: GameContext) {
  const size = match.mode.fighters;
  const used = new Set(game.players.map((p) => p.name));
  const add = (team: Team | null) => {
    const name = BOT_NAMES.find((n) => !used.has(n)) ?? `Goon ${game.players.length + 1}`;
    used.add(name);
    joining = team;
    game.bots.add(name);
    joining = null;
  };
  // The lowest scorers go first.
  const drop = (list: readonly Player[], n: number) => {
    const out = [...list].sort((a, b) => (fighters.get(a.id)?.score ?? 0) - (fighters.get(b.id)?.score ?? 0)).slice(0, n);
    for (const b of out) game.bots.remove(b);
  };
  if (!match.mode.teams) {
    const humans = game.players.filter((p) => !p.bot).length;
    const want = Math.max(0, Math.min(MAX_FIGHTERS - humans, size - humans));
    const have = game.bots.all;
    if (have.length < want) for (let i = have.length; i < want; i++) add(null);
    else if (have.length > want) drop(have, have.length - want);
    return;
  }
  for (const t of [0, 1] as Team[]) {
    const side = teamFighters(t);
    const people = side.filter((f) => !f.player.bot).length;
    const mine = side.filter((f) => f.player.bot).map((f) => f.player);
    const want = Math.max(0, Math.min(size / 2, MAX_FIGHTERS / 2) - people);
    if (mine.length < want) for (let i = mine.length; i < want; i++) add(t);
    else if (mine.length > want) drop(mine, mine.length - want);
  }
}

// -------------------------------------------------------------------------------------------------
// Kills
// -------------------------------------------------------------------------------------------------

/** What a kill was made with, for the feed: the weapon side on, or the case. */
const killIcon = (weapon: string): IconRef | null => (weapon === 'briefcase' ? { item: 'briefcase' } : feedIcon(weapon));
const killName = (weapon: string) => (weapon === 'briefcase' ? 'the case' : weaponName(weapon));

/**
 * Everything a death means, in one place: the victim's and the killer's numbers, points and
 * streaks, the kill feed and the banners, the mode's score (and The Briefcase's rounds), the end
 * of the match. Anything else that wants to hear of a kill (a kill cam, progression) hooks in at
 * the marked spots.
 */
function onDeath(game: GameContext, victim: Player, source: unknown, weapon: string | undefined, headshot: boolean, through = 0) {
  const v = fighters.get(victim.id);
  if (!v || match.phase !== 'playing') return;
  const now = game.clock.now;
  // Killed flying a streak: it's over.
  streaks.died(victim);
  v.deaths++;
  const stopped = v.streak;
  v.streak = 0;
  v.diedAt = now;
  v.uavUntil = 0;
  boardDirty = true;
  ammo.drop(victim.position);
  const killer = typeof source === 'object' && source !== null && (source as Player).kind === 'player' ? (source as Player) : null;
  const k = killer && killer !== victim ? fighters.get(killer.id) : undefined;
  const icon = weapon ? killIcon(weapon) : null;
  if (k && killer) {
    k.kills++;
    k.streak++;
    k.best = Math.max(k.best, k.streak);
    let points = 100;
    if (headshot) {
      k.headshots++;
      points += 50;
    }
    if (through > 0) {
      points += 50;
    }
    if (!firstBlood) {
      firstBlood = true;
      points += 50;
    }
    k.multi = now - k.lastKillAt < 4 ? k.multi + 1 : 1;
    k.lastKillAt = now;
    const multi = ['', '', 'DOUBLE KILL', 'TRIPLE KILL', 'MASSACRE'][Math.min(4, k.multi)];
    if (multi) points += 50 * (k.multi - 1);
    k.score += points;
    // What the killer sees: a big call-out for a multi-kill or a streak. [progression] The points and
    // why ("+100 KILL", "+50 HEADSHOT") are the XP ticker's (progression.ts).
    const big = multi || (k.streak === 5 ? 'ON A ROLL' : k.streak === 10 ? 'UNSTOPPABLE' : '');
    if (big) {
      killer.hud.pop(big, { big: true, color: COLORS.gold });
      killer.audio.play('streak');
    }
    // Their killstreaks, each at its count (Hardline: a kill sooner).
    for (const id of k.killstreaks) if (k.streak === streakCost(k, KILLSTREAKS[id].kills) && streakOn(id)) reward(game, k, id);
    game.hud.feed([
      { text: killer.name, color: nameColor(killer, killer.bot ? '#ffe7a3' : COLORS.gold) },
      ...(icon ? [{ icon }] : weapon ? [` ${killName(weapon)} `] : [' ✕ ']),
      ...(headshot ? ['⌖'] : []),
      ...(through > 0 ? ['▦'] : []),
      { text: victim.name, color: nameColor(victim, victim.bot ? '#ffd0d0' : COLORS.red) },
    ]);
    victim.hud.banner('KILLED BY', `${killer.name}${weapon ? ` · ${killName(weapon)}` : ''}${headshot ? ' · headshot' : ''}${through > 0 ? ' · through the wall' : ''}`, { color: COLORS.red, duration: RESPAWN - 0.3 });
    // KILLCAM hook (killcam.ts): the victim sees it again through the killer's eyes, then respawns.
    killcam(game, victim, killer, weapon, headshot, through, streaks.killcamView(victim, killer, weapon));
    // The Play of the Game (potg.ts): a kill counts toward a play, unless a killstreak made it.
    if (!isStreakWeapon(weapon)) potg.kill(killer, victim, { weapon, headshot, through: through > 0, stopped, color: nameColor(killer, killer.bot ? '#ffe7a3' : COLORS.gold), spawned: k.spawnedAt });
    // (Hook: whatever else counts a kill, progression say, hears of it here: `k` got `points`.)
    // Achievements (meta.ts), a person's.
    if (!killer.bot) {
      killer.achieve('made_your_bones');
      if (k.multi >= 3) killer.achieve('triple_feature');
      if (headshot && through > 0) killer.achieve('knock_knock');
      if (isStreak(weapon)) killer.achieve('death_from_above');
    }
    // The mode's score.
    if (match.mode.id === 'ffa' && k.kills >= FFA_LIMIT) endMatch(game, killer);
    if (match.mode.id === 'tdm' && k.team !== null) {
      match.score[k.team]++;
      if (match.score[k.team] >= TDM_LIMIT) endMatch(game, null, k.team);
    }
  } else {
    game.hud.feed([{ text: victim.name, color: nameColor(victim, COLORS.red) }, weapon && LETHALS[weapon] ? ` cooked their own ${LETHALS[weapon].name}` : weapon === 'briefcase' ? ' stood too close to the case' : ' took the easy way out']);
    victim.hud.banner('WIPED OUT', undefined, { color: COLORS.red, duration: RESPAWN - 0.3 });
  }
  if (isCase()) rounds.died(v);
}

/** Whether a killstreak works in this mode (the ones that hurt people: not in The Briefcase). */
const streakOn = (id: KillstreakId) => !KILLSTREAKS[id].lethal || streaks.on;

/** A killstreak earned: the ones that come at once go off now; the ones you call in wait for 5. */
function reward(game: GameContext, f: Fighter, id: KillstreakId) {
  const p = f.player;
  const now = game.clock.now;
  switch (id) {
    case 'uav':
      f.uavUntil = now + UAV;
      f.uavFor = UAV;
      p.hud.banner('UAV ONLINE', 'Everyone shows on your radar', { color: COLORS.gold, duration: 2 });
      p.audio.play('lock');
      return;
    case 'counter':
      f.jamUntil = now + JAM;
      f.jamFor = JAM;
      p.hud.banner('COUNTER-UAV', "Their radar's jammed", { color: COLORS.teal, duration: 2 });
      p.audio.play('lock');
      return;
    case 'rush':
      f.rushUntil = now + RUSH;
      p.speed = speedOf(f) * 1.2;
      p.heal(p.maxHealth);
      p.hud.banner('ADRENALINE SHOT', 'Faster and patched up, for fifteen seconds', { color: COLORS.pink, duration: 2 });
      p.audio.play('heal');
      return;
    case 'mortar':
      mortars.call(f);
      p.hud.banner('MORTAR TEAM', 'Shells inbound on them', { color: COLORS.red, duration: 2 });
      p.audio.play('lock');
      return;
    default:
      streaks.earn(f, id);
  }
}

/** Points for something done (a plant, a crack), with a pop-up. */
function award(f: Fighter, points: number, title: string) {
  f.score += points;
  boardDirty = true;
  f.player.hud.pop(title, { big: true, color: COLORS.gold, sub: `+${points}` });
  f.player.audio.play('streak');
  xp.earn(f.player, points, title); // [progression] the same, in XP (the ticker shows it)
}

/**
 * The match is over: `winner` took the free-for-all, or `team` the team match. (`cheat`: ended by
 * the `win` command, which earns no achievements.)
 */
function endMatch(game: GameContext, winner: Player | null, team?: Team, cheat = false) {
  if (match.phase === 'over') return;
  match.phase = 'over';
  overAt = game.clock.now;
  streaks.reset();
  mortars.reset();
  const table = standings();
  const teams = match.mode.teams;
  // A team match with no winner named (the clock ran out): the side ahead, if any.
  const won: Team | null = team ?? (teams && match.score[0] !== match.score[1] ? (match.score[0] > match.score[1] ? 0 : 1) : null);
  const top = winner ?? table[0]?.player ?? null;
  if (isCase()) rounds.end();
  // Played out: any vote to skip it goes.
  vote.reset();
  // [progression] Each fighter's place, and whether they won (their side, in a team mode).
  xp.matchOver(table.map((f, i) => ({ player: f.player, place: i + 1, won: teams ? f.team === won : f.player === top })));
  for (const f of fighters.values()) {
    const p = f.player;
    p.freeze(true);
    f.menu?.close();
    p.hud.progress(null);
    if (p.bot) continue;
    const place = table.indexOf(f) + 1;
    const mine = teams ? f.team === won : p === top;
    if (teams) p.hud.banner(won === null ? 'DRAW' : mine ? 'VICTORY' : 'DEFEAT', won === null ? `${TEAMS[0].name} ${match.score[0]} · ${TEAMS[1].name} ${match.score[1]}` : `${TEAMS[won].name} take ${match.map.name} · ${match.score[won]} to ${match.score[1 - won]}`, { color: mine ? COLORS.gold : COLORS.red, duration: 9 });
    else p.hud.banner(p === top ? 'YOU WIN' : 'GAME OVER', top ? `${top.name} takes ${match.map.name} · you came ${ordinal(place)}` : undefined, { color: p === top ? COLORS.gold : COLORS.red, duration: 9 });
    // All-time numbers, kept for their account (a guest's for the visit).
    const s = p.store.get<AllTime>('stats') ?? { games: 0, wins: 0, kills: 0, deaths: 0, best: 0 };
    s.games++;
    if (mine) s.wins++;
    s.kills += f.kills;
    s.deaths += f.deaths;
    s.best = Math.max(s.best, f.best);
    p.store.set('stats', s);
    p.hud.toast(`All time: ${s.wins} wins · ${s.kills} kills · best streak ${s.best}`);
    // Achievements (meta.ts): a match played out, and won.
    if (!cheat) {
      p.achieve('on_the_payroll');
      if (mine) p.achieve('top_billing');
    }
  }
  // What's next: the rotation's next match in a public room, the same again in one's own; or,
  // with people in it, what they vote for once they've seen the scores.
  plan = nextPlan(game);
  voteNext = next.people().length > 0;
  // With people in it, the match's best play first (potg.ts): the kill cams still to come give way to it.
  potgAt = voteNext && potg.any ? POTG_DELAY : -1;
  potgUntil = 0;
  votesAt = potgAt < 0 ? SCORES : POTG_DELAY + potg.estimate() + SCORES;
  intermission = voteNext ? votesAt + VOTING : INTERMISSION;
  if (potgAt >= 0) killcamsOff();
  settings?.close();
  game.audio.play('match_end');
  scoreboard(game, true);
}

// -------------------------------------------------------------------------------------------------
// The briefcase (free-for-all and Team Deathmatch): every so often it turns up on the street,
// glowing. Whoever grabs it gets points and a radar sweep. Nobody knows what's inside.
// -------------------------------------------------------------------------------------------------

const BRIEFCASE_EVERY = 50;
const BRIEFCASE_POINTS = 300;

function defineBriefcase(game: GameContext) {
  // (Its model is each screen's: `client/looks.ts`.)
  game.items.define('briefcase', {
    kind: 'misc',
    name: 'The Briefcase',
    onPickup: (g, _n, player) => {
      const f = fighters.get(player.id);
      if (!f || !player.alive) return false;
      f.score += BRIEFCASE_POINTS;
      if (g.clock.now + 20 > f.uavUntil) {
        f.uavUntil = g.clock.now + 20;
        f.uavFor = 20;
      }
      boardDirty = true;
      briefcase = null;
      bots.objective = null;
      g.hud.marker('briefcase', null);
      g.hud.feed([{ text: player.name, color: nameColor(player, COLORS.gold) }, ' has the briefcase']);
      player.hud.pop('THE BRIEFCASE', { big: true, color: COLORS.gold, sub: 'UAV online' }); // [progression] (its XP: the ticker)
      g.audio.play('streak', { at: player.position });
      g.fx.burst({ x: player.position.x, y: player.position.y + 1.2, z: player.position.z }, { color: '#ffcc00', count: 40, speed: 5, glow: 2, life: 0.8, gravity: 2 });
      nextBriefcase = g.clock.now + BRIEFCASE_EVERY;
      if (!player.bot) player.achieve('whats_in_the_case');
      return true;
    },
  });
}

/** Put the briefcase somewhere worth fighting over, away from everyone. */
function dropBriefcase(game: GameContext) {
  const spots = match.map.hotspots.length ? match.map.hotspots : match.map.spawns;
  let best = spots[0];
  let score = -Infinity;
  for (const s of spots) {
    const near = Math.min(60, ...game.players.filter((p) => p.alive).map((p) => Math.hypot(p.position.x - s.x, p.position.z - s.z)));
    const v = Math.min(near, 18) + game.rng.next() * 8;
    if (v > score) {
      score = v;
      best = s;
    }
  }
  const at = { x: best.x, y: best.y + 1, z: best.z };
  briefcase = game.items.spawnPickup('briefcase', at, { beam: '#ffcc00', despawn: 40 });
  bots.objective = { x: best.x, y: best.y, z: best.z };
  game.hud.marker('briefcase', at, { shape: 'diamond', color: COLORS.gold, label: 'THE BRIEFCASE', edge: true, pulse: true, size: 22 });
  game.hud.banner('THE BRIEFCASE', `Somebody left it ${match.map.id === 'jackrabbit' ? 'on the street' : 'lying around'}. Grab it.`, { color: COLORS.gold, duration: 2.5 });
  game.audio.play('lock');
}

function updateBriefcase(game: GameContext) {
  const now = game.clock.now;
  if (briefcase && !briefcase.alive) {
    // Nobody took it in time.
    briefcase = null;
    bots.objective = null;
    game.hud.marker('briefcase', null);
    nextBriefcase = now + BRIEFCASE_EVERY;
  }
  if (!briefcase && now >= nextBriefcase) dropBriefcase(game);
}

// -------------------------------------------------------------------------------------------------
// HUD
// -------------------------------------------------------------------------------------------------

function scoreboard(game: GameContext, show = false) {
  const left = Math.max(0, TIME_LIMIT[match.mode.id] - (game.clock.now - startedAt));
  const teams = match.mode.teams;
  const table = standings();
  const rows = (teams ? [...table].sort((a, b) => (a.team ?? 0) - (b.team ?? 0)) : table).map((f, i) => ({
    name: `${f.player.name}${f.player.bot ? ' ·bot' : ''}${isCase() && !f.player.alive && match.phase === 'playing' ? ' ✕' : ''}`,
    values: isCase() ? [f.score, f.kills, f.deaths, f.plants + f.defuses] : [f.score, f.kills, f.deaths, f.best],
    color: teams && f.team !== null ? TEAMS[f.team].color : i === 0 ? COLORS.gold : undefined,
    player: f.player,
  }));
  const where = match.map.name.toUpperCase();
  const coming = `Next: ${planName(next.open ? next.winner() : plan)}${next.open ? ' (voting)' : ''} in ${Math.max(0, Math.ceil(intermission - (game.clock.now - overAt)))}`;
  const sides = `${TEAMS[0].short} ${match.score[0]} · ${TEAMS[1].short} ${match.score[1]}`;
  const footer =
    match.phase === 'over'
      ? teams
        ? `${sides} · ${coming}`
        : coming
      : match.mode.id === 'ffa'
        ? `First to ${FFA_LIMIT} · ${fmt(left)} left`
        : match.mode.id === 'tdm'
          ? `${sides} · first to ${TDM_LIMIT} · ${fmt(left)} left`
          : `${sides} · round ${rounds.round} · first to ${ROUNDS}`;
  game.hud.scoreboard({
    title: match.phase === 'over' ? `FINAL SCORES · ${where}` : `${where} · ${match.mode.name.toUpperCase()}`,
    columns: isCase() ? ['Score', 'Kills', 'Deaths', 'Case'] : ['Score', 'Kills', 'Deaths', 'Streak'],
    rows,
    footer,
    show,
  });
}

/** The team modes' bar across the top (hud.ts): the sides, their scores, the clock, what's happening. */
function matchBar(game: GameContext) {
  const side = (t: Team) => {
    const info = TEAMS[t];
    const all = teamFighters(t);
    return {
      short: info.short,
      color: info.color,
      score: match.score[t],
      role: isCase() ? (t === rounds.attackers ? 'Attack' : 'Defend') : '',
      cards: Array.from({ length: ROUNDS }, (_, i) => (i < match.score[t] ? 'won' : '')),
      up: all.map((f) => (f.player.alive ? 'up' : 'down')),
    };
  };
  let clock: string;
  let note: string;
  let state: string;
  if (isCase()) {
    const r = rounds;
    clock = r.phase === 'post' ? '—' : fmt(Math.ceil(r.clock()));
    state = r.phase;
    note =
      r.phase === 'prep'
        ? `Round ${r.round} · get ready`
        : r.phase === 'live'
          ? `Round ${r.round} · plant at A or B`
          : r.phase === 'planted'
            ? `Case down at ${r.planted?.site.name ?? '?'}`
            : r.result
              ? `${TEAMS[r.result.winner].short} take round ${r.round}`
              : '';
  } else {
    clock = fmt(Math.max(0, TIME_LIMIT[match.mode.id] - (game.clock.now - startedAt)));
    state = 'live';
    note = `First to ${TDM_LIMIT}`;
  }
  game.hud.widget('matchbar', { mode: match.mode.id, rounds: isCase(), a: side(0), b: side(1), clock, note, state });
}

/** Each person's corner (the dossier widget, see hud.ts), their radar, their heartbeat. */
function personalHud(game: GameContext, f: Fighter, dt: number) {
  const p = f.player;
  const table = standings();
  const place = table.indexOf(f) + 1;
  const leader = table[0];
  const now = game.clock.now;
  const teams = match.mode.teams && f.team !== null;
  // Every tick: only what changed goes to their screen.
  p.hud.widget('dossier', {
    ffa: !teams,
    kills: f.kills,
    limit: FFA_LIMIT,
    place: ordinal(place),
    fighters: table.length,
    leading: leader === f,
    margin: f.kills - (table[1]?.kills ?? 0),
    leader: leader.player.name,
    leaderKills: leader.kills,
    score: f.score,
    teamName: teams ? TEAMS[f.team!].name : '',
    teamColor: teams ? TEAMS[f.team!].color : '',
    role: isCase() && teams ? (f.team === rounds.attackers ? 'Attacking' : 'Defending') : 'Team',
    carrier: isCase() && rounds.carrier === f ? 'Hold F at A or B' : '',
    ...streakCards(f),
    ready: streaks.ready(f),
    uav: Math.max(0, Math.ceil(f.uavUntil - now)),
    uavFor: f.uavFor,
    counter: Math.max(0, Math.ceil(f.jamUntil - now)),
    counterFor: f.jamFor,
    jammed: jammed(f, now),
    rush: Math.max(0, Math.ceil(f.rushUntil - now)),
    rushFor: RUSH,
  });
  // The radar: their side always (a team mode); enemies who just fired (unless they've Low
  // Profile), or all of them under a UAV (but those with Ghost). Jammed by the other side's
  // Counter-UAV, it shows nobody.
  const uav = f.uavUntil > now;
  const jam = jammed(f, now);
  const others = jam ? [] : [...fighters.values()].filter((e) => e !== f && e.player.alive);
  const friends = teams ? others.filter((e) => !hostile(p, e.player)) : [];
  const foes = others.filter((e) => hostile(p, e.player) && ((uav && !hasPerk(e, 'ghost')) || (now - e.firedAt < 1.6 && !hasPerk(e, 'lowprofile'))));
  const key = `${uav}|${jam}|${friends.map((b) => b.player.id).join(',')}|${foes.map((b) => b.player.id).join(',')}`;
  if (key !== f.radar) {
    f.radar = key;
    // Top right, under their dossier (its streak and what the streak's earned).
    p.hud.radar({
      at: 'top-right',
      center: p,
      range: 48,
      blips: [...friends.map((e) => ({ at: e.player, color: TEAMS[f.team!].color, size: 4 })), ...foes.map((e) => ({ at: e.player, color: uav ? COLORS.pink : COLORS.red, size: 5 }))],
    });
  }
  // Low on health: a heartbeat.
  if (p.alive && p.health < p.maxHealth * 0.3) {
    f.heartbeat -= dt;
    if (f.heartbeat <= 0) {
      f.heartbeat = 0.9;
      p.audio.play('heartbeat', { volume: 0.8 });
      p.fx.flash('rgba(190, 0, 0, 1)', 0.3, 0.85);
    }
  }
}

/** Whether an enemy's Counter-UAV has their radar jammed. */
const jammed = (f: Fighter, now: number) => [...fighters.values()].some((e) => e.jamUntil > now && hostile(e.player, f.player));

/**
 * The streak's cards on their dossier: one a kill up to their dearest killstreak (that works in
 * this mode), each killstreak's card marked; past it, the count over.
 */
function streakCards(f: Fighter) {
  const marks: Record<number, string> = {};
  for (const id of f.killstreaks) if (streakOn(id)) marks[streakCost(f, KILLSTREAKS[id].kills) - 1] = id;
  const length = Math.max(3, ...Object.keys(marks).map((i) => Number(i) + 1));
  return { pips: streakPips(f.streak, marks, length), pipsClass: length > 5 ? 'long' : '', extra: Math.max(0, f.streak - length) };
}

/** Down in The Briefcase: watch a teammate who's still up until the round's out. */
function spectate(f: Fighter) {
  const p = f.player;
  const now = watching.get(p.id);
  if (now?.alive) return;
  const mate = teamFighters(f.team ?? 0).find((o) => o !== f && o.player.alive)?.player ?? null;
  if (mate) {
    watching.set(p.id, mate);
    p.camera.orbit(mate, { distance: 4.5, min: 2, max: 9 });
  } else watching.delete(p.id);
}

// -------------------------------------------------------------------------------------------------
// Choosing the match: a public room goes round the rotation; a room of one's own picks (M); in
// either, the people in it can vote to skip the match that's on (V)
// -------------------------------------------------------------------------------------------------

/**
 * What's on after this match: in a public room the rotation's next (never this one again, which
 * a vote on what's next can bring round); in a room of one's own the same again (M picks another),
 * unless this one's being skipped, when it's the one after it in the rotation.
 */
function nextPlan(game: GameContext, skipping = false): MatchPlan {
  if (game.room === 'public') {
    let p = ROTATION[++turn % ROTATION.length];
    if (p.mode === match.mode.id && p.map === match.map.id) p = ROTATION[++turn % ROTATION.length];
    return p;
  }
  if (!skipping) return plan;
  const at = ROTATION.findIndex((m) => m.mode === match.mode.id && m.map === match.map.id);
  return ROTATION[(at + 1) % ROTATION.length];
}

/**
 * The vote to skip passed (the platform's `skipVote` kit): the match is over without being played out. Nobody wins
 * or places, and nothing goes on anyone's all-time numbers. Everyone stops where they are, and a
 * few seconds later the next match is on, the one that would have followed this (the
 * intermission's countdown, cut short).
 */
function skipMatch(game: GameContext) {
  if (match.phase === 'over') return;
  const was = planName({ mode: match.mode.id, map: match.map.id });
  match.phase = 'over';
  skipped = true;
  overAt = game.clock.now;
  intermission = SKIP_PAUSE;
  voteNext = false;
  potgAt = -1;
  if (isCase()) rounds.end();
  xp.matchOver([]); // [progression] no placing in a match skipped (what was earned in it is kept)
  for (const f of fighters.values()) {
    f.player.freeze(true);
    f.menu?.close();
    f.player.hud.progress(null);
  }
  plan = nextPlan(game, true);
  game.hud.banner('SKIPPED', `The vote's in · next up: ${planName(plan)}`, { color: COLORS.gold, duration: SKIP_PAUSE - 0.3 });
  game.hud.feed([`The vote passed: ${was} skipped`]);
  game.audio.play('match_end');
}

/** The menu's pictures: each mode's weapon, each map's own block. */
const MODE_ICONS: Record<ModeId, IconRef> = { ffa: { item: 'pistol', view: 'side' }, tdm: { item: 'rifle', view: 'side' }, case: { item: 'briefcase' } };
const MAP_ICONS: Record<string, IconRef> = { jackrabbit: { block: 'neon_cyan' }, kahuna: { block: 'thatch' }, hijacked: { block: 'porthole' } };

function matchMenu(game: GameContext, p: Player) {
  // Between matches, M brings back the vote on what's next.
  if (next.open) return next.offer(p);
  if (game.room === 'public') {
    // (`plan` is the match on now: the next is the rotation's after it.)
    p.hud.toast(`Public games go round the modes and maps · next: ${planName(ROTATION[(turn + 1) % ROTATION.length])} · V votes to skip this one`);
    return;
  }
  if (settings?.open) return;
  const pick: MatchPlan = { mode: match.mode.id, map: match.map.id };
  const sections = (): MenuOptions['sections'] => [
    { title: 'Mode', entries: Object.values(MODES).map((m) => ({ icon: MODE_ICONS[m.id], label: m.name, note: m.goal, active: pick.mode === m.id, onSelect: () => ((pick.mode = m.id), settings?.update({ sections: sections() })) })) },
    { title: 'Map', entries: MAPS.map((m) => ({ icon: MAP_ICONS[m.id], label: m.name, note: m.blurb, active: pick.map === m.id, onSelect: () => ((pick.map = m.id), settings?.update({ sections: sections() })) })) },
    {
      title: 'Go',
      entries: [
        {
          icon: { block: 'neon_yellow' },
          label: 'Start the match',
          note: planName(pick),
          onSelect: () => {
            plan = { ...pick };
            settings?.close();
            game.hud.feed([{ text: p.name, color: COLORS.gold }, ` started ${planName(plan)}`]);
            game.restart();
          },
        },
      ],
    },
  ];
  offered = true;
  settings = p.hud.menu({
    title: 'Your game',
    subtitle: 'Pick the mode and the map, then start: the match begins again with them. M brings this back.',
    sections: sections(),
    onClose: () => {
      settings = null;
    },
  });
}

// -------------------------------------------------------------------------------------------------
// The game
// -------------------------------------------------------------------------------------------------

export default defineServer(shared, {
  // Its kinds of item: lethals (first: a grenade being cooked takes the fire button), guns, the katana (and the bare fist).
  items: [throwables(), guns(), melee()],
  setup(game) {
    // A fresh game (a page can host one game after another): nothing carries over.
    match.fighters = fighters = new Map();
    match.phase = 'playing';
    match.mode = MODES.ffa;
    match.map = MAPS[0];
    running = false;
    briefcase = null;
    plan = ROTATION[0];
    turn = 0;
    offered = false;
    settings = null;
    skipped = false;
    watching.clear();
    defineArt(game);
    defineWeapons(game);
    defineBriefcase(game);
    ammo = new AmmoBags(game, scavenge);
    gunKit = guns.of(game);
    // [progression] XP, levels and unlocks: before the game's own listeners (the kill that ends a match still counts).
    xp = setupProgression(game);
    // (Its voices are each screen's, `client/sounds.ts`: played here by name.)
    game.hud.define('dossier', DOSSIER);
    game.hud.define('matchbar', MATCHBAR);
    game.hud.define('skipvote', SKIPVOTE);
    // Each map's walking grid (built once its blocks are here, kept up with holes and breaks), and
    // the bots on whichever the match is on.
    navs = new Map(MAPS.map((m) => [m.id, navGrid(game, { bounds: m.bounds })]));
    bots = makeBots(game, () => navs.get(match.map.id) ?? null, hotspots);
    bots.supplies = ammo;
    rounds = new CaseRounds(game, { spawnAt: (f, at) => spawnAt(game, f, at), award, endMatch: (t) => endMatch(game, null, t) });
    streaks = new Streaks(game, { bots, award });
    mortars = new Mortars(game, (p) => streaks.aloft(p));
    // An enemy's Counter-UAV scrambles bots too: they stop going after shots they hear.
    bots.scrambled = (b) => {
      const f = fighters.get(b.id);
      return !!f && jammed(f, game.clock.now);
    };
    bots.aloft = (p) => streaks.aloft(p);
    streaks.setup();
    // (Development: tests reach the match and the streaks.)
    if (import.meta.env.DEV) (globalThis as unknown as { __cob: unknown }).__cob = { match, streaks, bots, reward: (f: Fighter, id: KillstreakId) => reward(game, f, id) };
    vote = skipVote(game, {
      people: () => [...match.fighters.values()].map((f) => f.player),
      // Between The Briefcase's rounds it stays open: that's when people have a moment to vote.
      playing: () => match.phase === 'playing',
      match: () => ({ mode: match.mode.name, map: match.map.name }),
      color: (p) => nameColor(p, COLORS.gold),
      skip: () => skipMatch(game),
    });
    potg = new PlayOfTheGame(game);
    // Its plays are clipped from the history once they're over (and a kill cam reaches back 4 s).
    game.replay.keep(POTG_KEEP);
    next = new NextVote(game, { modeIcon: (id) => MODE_ICONS[id], mapIcon: (id) => MAP_ICONS[id] ?? { block: 'stone' }, name: planName });
    game.events.on('playerJoin', ({ player }) => {
      // Signed in for the first time since claiming their name: the all-time numbers kept by it are theirs.
      if (player.adopted) {
        const old = game.store.get<AllTime>(`stats:${player.adopted}`);
        if (old) player.store.set('stats', old);
        game.store.delete(`stats:${player.adopted}`);
      }
      const f = fighters.get(player.id) ?? addFighter(game, player);
      if (player.bot) bots.add(player as Bot, 0.3 + game.rng.next() * 0.5);
      if (running && match.phase === 'playing') spawn(game, f);
      if (!player.bot) {
        // (Between matches: the vote on what's next; the loadout comes with the next match.)
        if (running && match.phase === 'playing') loadoutMenu(game, f);
        next.offer(player);
        balanceBots(game);
        game.hud.feed([{ text: player.name, color: nameColor(player, COLORS.gold) }, ` rolled into ${match.map.name}`]);
        // One more to count in a vote to skip.
        vote.joined(player);
      }
    });
    game.events.on('playerReady', ({ player }) => {
      // A room of one's own: the first one in picks what to play.
      if (game.room !== 'public' && !offered) matchMenu(game, player);
    });
    game.events.on('playerLeave', ({ player }) => {
      const f = fighters.get(player.id);
      f?.menu?.close();
      fighters.delete(player.id);
      watching.delete(player.id);
      streaks.died(player);
      bots.remove(player);
      boardDirty = true;
      if (f && isCase()) rounds.left(f);
      if (!player.bot) balanceBots(game);
      // Their votes go, and the rest are counted again (last: a vote to skip may end the match).
      next.left(player);
      vote.left(player);
    });
    game.events.on('playerDeath', ({ player, source, weapon, headshot, through }) => onDeath(game, player, source, weapon, !!headshot, through ?? 0));
    game.events.on('shot', ({ player, weapon, from, dir }) => {
      const f = fighters.get(player.id);
      if (f) f.firedAt = game.clock.now;
      // Up at a chopper: its hits count against it.
      streaks.shot(player, weapon, from, dir);
    });
    // No friendly fire in a team mode (your own frag still hurts you); then the perks' say (perks.ts).
    game.events.on('damage', (hit) => {
      const by = hit.source;
      // A streak's blast spares its pilot.
      if (selfHarm(hit.weapon, hit.target, by)) return hit.cancel();
      const shooter = by && by !== 'world' && by.kind === 'player' ? by : null;
      if (hit.target.kind !== 'player') return;
      if (match.mode.teams && shooter && shooter !== hit.target && !hostile(shooter, hit.target)) return hit.cancel();
      hit.amount *= perkDamage(hit, fighterOf(hit.target), shooter ? fighterOf(shooter) : undefined);
    });
    // Second Wind counts from the last hit.
    game.events.on('playerDamage', ({ player }) => {
      const f = fighters.get(player.id);
      if (f) f.hurtAt = game.clock.now;
    });
    game.commands.register('bots', {
      usage: '<n>',
      help: 'Fill the match up to n fighters',
      cheat: true,
      run: ([n], g) => {
        const want = Math.max(0, Math.min(MAX_FIGHTERS, Number(n) || 0) - g.players.filter((p) => !p.bot).length);
        while (g.bots.all.length > want) g.bots.remove(g.bots.all[g.bots.all.length - 1]);
        const used = new Set(g.players.map((p) => p.name));
        while (g.bots.all.length < want) {
          const name = BOT_NAMES.find((x) => !used.has(x)) ?? `Goon ${g.bots.all.length}`;
          used.add(name);
          g.bots.add(name);
        }
        return `${g.players.length} fighters`;
      },
    });
    game.commands.register('streak', {
      usage: `<${KILLSTREAK_IDS.join('|')}>`,
      help: 'Earn a killstreak now (the Hellstorm and the chopper: call it in with 5)',
      cheat: true,
      run: ([id], g, p) => {
        const f = fighterOf(p);
        if (!f || !isKillstreak(id)) return `killstreaks: ${KILLSTREAK_IDS.join(', ')}`;
        if (!streakOn(id)) return `the ${KILLSTREAKS[id].name} is for the free-for-all and Team Deathmatch`;
        reward(g, f, id);
        return isStreak(id) ? `${STREAKS[id].name} ready: press 5` : `${KILLSTREAKS[id].name}`;
      },
      complete: () => [...KILLSTREAK_IDS],
    });
    // The vote to skip, typed (V does the same): everyone's, not a cheat.
    game.commands.register('skip', {
      help: 'Vote to skip this match (its mode and map); again to take your vote back',
      run: (_a, _g, p) => vote.toggle(p) ?? undefined,
    });
    game.commands.register('win', { help: 'End the match now', cheat: true, run: (_a, g, p) => endMatch(g, p, match.mode.teams ? (fighterOf(p)?.team ?? 0) : undefined, true) });
    game.commands.register('team', {
      usage: '<0|1>',
      help: 'Change sides (a team mode)',
      cheat: true,
      run: ([t], g, p) => {
        const f = fighterOf(p);
        if (!match.mode.teams || !f || (t !== '0' && t !== '1')) return 'a team mode, and 0 or 1';
        setTeam(g, f, Number(t) as Team);
        return TEAMS[Number(t)].name;
      },
    });
    game.commands.register('case', {
      usage: '[A|B]',
      help: 'The Briefcase: take the case (you attack), or plant it at A or B now',
      cheat: true,
      run: ([site], _g, p) => {
        const f = fighterOf(p);
        if (!isCase() || !f) return 'not in The Briefcase';
        if (site) return rounds.plantAt(site) ? `planted at ${site.toUpperCase()}` : 'no round on, or no such site';
        return rounds.give(f) ? 'you have the case' : 'only an attacker, while the round is on';
      },
    });
    game.commands.register('mode', {
      usage: '<ffa|tdm|case> [jackrabbit|kahuna|hijacked]',
      help: 'Start a match of this mode (on this map)',
      cheat: true,
      run: ([m, where], g) => {
        if (!m || !(m in MODES)) return `modes: ${Object.keys(MODES).join(', ')}`;
        if (where && !mapById(where)) return `maps: ${MAPS.map((x) => x.id).join(', ')}`;
        plan = { mode: m as ModeId, map: where ?? match.map.id };
        g.restart();
        return planName(plan);
      },
    });
  },

  start(game) {
    xp.matchStart(); // [progression]
    running = true;
    match.phase = 'playing';
    skipped = false;
    // A new match: no votes to skip it yet (they open a few seconds in), and none on what's next.
    vote.reset();
    next.close();
    voteNext = false;
    potg.reset();
    potgAt = -1;
    // The match planned: its mode, its map (the bots' grid and hotspots with it).
    match.mode = MODES[plan.mode];
    match.map = mapById(plan.map) ?? MAPS[0];
    match.score = [0, 0];
    hotspots.splice(0, hotspots.length, ...match.map.hotspots);
    // Newcomers come in there, and the home page looks at it.
    game.world.spawn = match.map.home;
    startedAt = game.clock.now;
    firstBlood = false;
    lastSecond = -1;
    boardDirty = true;
    briefcase = null;
    bots.objective = null;
    watching.clear();
    streaks.reset();
    ammo.clear();
    nextBriefcase = game.clock.now + 35;
    for (const f of fighters.values()) {
      Object.assign(f, { kills: 0, deaths: 0, score: 0, streak: 0, best: 0, headshots: 0, plants: 0, defuses: 0, diedAt: -1, uavUntil: 0, uavFor: 0, rushUntil: 0, jamUntil: 0, jamFor: 0, streaks: [], firedAt: -99, radar: '', multi: 0 });
    }
    for (const p of game.players) if (!fighters.has(p.id)) addFighter(game, p);
    if (match.mode.teams) formTeams(game);
    else clearTeams();
    balanceBots(game);
    bots.rules = match.mode.id === 'ffa' ? null : { hostile: (bot, other) => hostile(bot, other), goal: (bot, mind) => (isCase() ? rounds.goal(bot, mind) : null) };
    const where = match.map.name.toUpperCase();
    if (isCase()) {
      // The rounds put everyone where they start.
      matchBar(game);
      rounds.begin();
      game.hud.feed([`${match.mode.name} on ${match.map.name}: ${match.mode.goal}`]);
    } else {
      // Team Deathmatch starts each side at its end of the map; a free-for-all wherever's safest.
      const count = [0, 0];
      for (const f of fighters.values()) {
        if (match.mode.teams && f.team !== null) {
          const side = match.map.teams[f.team];
          spawnAt(game, f, side[count[f.team]++ % side.length]);
        } else spawn(game, f);
      }
      if (match.mode.teams) matchBar(game);
      game.hud.banner(where, match.mode.id === 'ffa' ? `Free-for-all · first to ${FFA_LIMIT}` : `${match.mode.name} · ${match.mode.goal}`, { color: COLORS.gold, duration: 3 });
      game.audio.play('match_start');
    }
    // Their own copy of the bar says which side is theirs.
    if (match.mode.teams) for (const f of fighters.values()) if (!f.player.bot && f.team !== null) f.player.hud.widget('matchbar', { mine: f.team });
    for (const f of fighters.values()) if (!f.player.bot && !f.chose) loadoutMenu(game, f);
  },

  update(game, dt) {
    const now = game.clock.now;
    const between = isCase() && (rounds.phase === 'prep' || rounds.phase === 'post');
    bots.update(dt, match.phase !== 'playing' || between);
    if (isCase() && match.phase === 'playing') rounds.driveBots(bots);
    // Killstreaks: calling them in (5), flying them, bots firing up at choppers.
    streaks.update(dt);
    mortars.update();
    // The vote to skip (V), people's only: a vote that carries it ends the match here.
    for (const p of game.players) {
      if (p.bot || !p.input.pressed('KeyV', { dead: true })) continue;
      const no = vote.toggle(p);
      if (no) p.hud.toast(no);
    }

    if (match.phase === 'over') {
      const since = now - overAt;
      // The Play of the Game, on everyone's screen (potg.ts): the scores and the vote wait for it.
      if (potgAt >= 0 && since >= potgAt) {
        potgAt = -1;
        const d = potg.show(next.people(), match.map.name);
        potgUntil = d > 0 ? since + d : 0;
        votesAt = potgUntil + SCORES;
        intermission = votesAt + VOTING;
        scoreboard(game, !potgUntil);
      }
      // It's over: the final scores come back up.
      if (potgUntil > 0 && since >= potgUntil) {
        potgUntil = 0;
        scoreboard(game, true);
      }
      // The scores seen: what's next is voted on (nextvote.ts), till the intermission's out.
      if (voteNext && since >= votesAt) {
        voteNext = false;
        next.begin(plan, intermission - since);
      }
      if (since > intermission) {
        if (next.open) plan = next.end();
        game.restart();
        return;
      }
      for (const p of next.people()) if (p.input.pressed('KeyM', { dead: true })) matchMenu(game, p);
      // (A match skipped has no final scores to show: its banner says what's next.)
      if (!skipped && Math.floor(now) !== lastSecond) {
        lastSecond = Math.floor(now);
        // (Not over the Play of the Game.)
        scoreboard(game, !potgUntil);
        next.tick();
      }
      return;
    }

    // Respawns (not in The Briefcase: the down watch a teammate), streak timers, the edge of the map.
    for (const f of fighters.values()) {
      const p = f.player;
      if (!p.bot && p.input.pressed('KeyM', { dead: true })) matchMenu(game, p);
      if (!p.alive) {
        if (f.diedAt < 0) f.diedAt = now;
        // KILLCAM hook (killcam.ts): the respawn (or the round's spectating) waits for the kill cam.
        if (isCase()) {
          if (!p.bot && now - f.diedAt >= RESPAWN && !killcamHolds(game, p)) spectate(f);
        } else if (now - f.diedAt >= RESPAWN && !killcamHolds(game, p)) spawn(game, f);
        if (!p.bot) personalHud(game, f, dt);
        continue;
      }
      if (f.rushUntil && now > f.rushUntil) {
        f.rushUntil = 0;
        p.speed = speedOf(f);
      }
      // Second Wind: health starts coming back sooner (the platform's own regeneration takes over at its delay).
      const since = now - f.hurtAt;
      if (hasPerk(f, 'secondwind') && since >= SECOND_WIND.delay && since < 4.5 && p.health < p.maxHealth) p.heal(SECOND_WIND.perSecond * dt);
      const q = p.position;
      // Fallen out of the map, or overboard (an achievement, a hidden one).
      if (q.y < (match.map.sea ?? match.map.bounds.min.y - 4)) {
        p.damage(1000, { source: 'world', knockback: 0 });
        if (match.map.sea !== undefined && !p.bot) p.achieve('sleeps_with_the_fishes');
      }
      if (!p.bot) {
        if (p.input.pressed('KeyL')) loadoutMenu(game, f);
        personalHud(game, f, dt);
      }
    }

    if (isCase()) rounds.update(dt);
    else updateBriefcase(game);
    potg.update();
    ammo.update();
    if (match.phase !== 'playing') return;
    // The clock.
    const left = TIME_LIMIT[match.mode.id] - (now - startedAt);
    if (left <= 0) {
      endMatch(game, null);
      return;
    }
    const second = Math.floor(now);
    if (second !== lastSecond) {
      lastSecond = second;
      if (match.mode.id === 'ffa') game.hud.objective(`${fmt(left)} · First to ${FFA_LIMIT}`);
      if (left <= 10.5 && left > 0) game.audio.play('countdown');
      boardDirty = true;
    }
    if (match.mode.teams) matchBar(game);
    if (boardDirty && now - boardAt > 0.25) {
      boardDirty = false;
      boardAt = now;
      scoreboard(game);
    }
  },
});
