import { defineServer, type Bot, type GameContext, type IconRef, type MenuHandle, type MenuOptions, type Player, type Vec3 } from '@platform';
import { guns, melee, navGrid, skipVote, throwables, type NavGrid, type SkipVote } from '@platform/kits';
import { makeBots, type Bots } from './bots';
import { CLASSES, CLASS_IDS, type ClassId } from './classes';
import { Conquest, type PostNews } from './conquest';
import { HEROES, HERO_IDS, type HeroId } from './heroes/defs';
import { HERO_GUNS, isHeroGun } from './heroes/guns';
import { FORCE } from './heroes/powers';
import { DEFLECTED, heroItems, setupHeroes, type Heroes } from './heroes/rules';
import { BOARD_COLUMNS, CONQUEST, SKIPVOTE, STATUS } from './hud';
import { MAPS, mapById, type SpawnPoint } from './map';
import { fighterOf, hostile, match, teamFighters, type Fighter, type Post } from './match';
import { MODES, ROTATION, type MatchPlan, type ModeId } from './modes';
import { COLORS, shared, trooperModel } from './shared';
import { setupHits } from './hits'; // hits
import { setupSkies, updateSkies } from './skies'; // skies
import { other, TEAMS, type Team } from './teams';
import { BLASTERS, COOL_AFTER, COOL_FULL, defineWeapons, feedIcon, weaponFor, weaponName } from './weapons';
import { INTRO_HOLD, introOn, joinIntro, setupCinema, showEnd, startIntro, tickEnd } from './cinema'; // cinema

/**
 * Blockfront II: the Rebels against the Empire over the command posts of a desert spaceport.
 *
 * - **Conquest** (conquest.ts): each side starts with reinforcements (tickets). Every death costs
 *   one; holding fewer posts than the other side bleeds more. Out of tickets, a side loses; when
 *   the clock runs out, the side with more wins.
 * - **Troopers** (classes.ts): Trooper, Heavy or Specialist, each with their side's blasters
 *   (weapons.ts: they overheat rather than run dry) and thermal detonators. They spawn at a post
 *   their side holds: the one they pick, or wherever the fight is.
 * - **Heroes** (heroes/): battle points (kills, captures) buy a turn as one of the side's heroes,
 *   one of each at a time, two a side at most: sabers, blocking, the Force.
 * - **Third person**: seen from over the shoulder (V: through the eyes instead).
 * - **Framing** (cinema.ts, its calls marked `cinema`): an opening fly-over over the map, everyone
 *   held meanwhile, and an end screen in place of the plain scoreboard.
 *
 * Bots fill each side to its size (people take their places), fight for the posts, and become
 * heroes too once they've earned it.
 */

/** Most fighters a side, people included (a mode says how many it fills to: `Mode.side`). */
/** A person's all-time numbers (`player.store`, `stats`). */
type AllTime = { games: number; wins: number; kills: number; deaths: number; heroes: number };
const MAX_SIDE = 16;
const RESPAWN = 5;
const INTERMISSION = 15;
/** Between a match skipped (a vote) and the next: a moment for the banner. */
const SKIP_PAUSE = 4;
/** The vote to skip's key (V is the camera's), and how long into a match it opens: the fly-over, then a moment. */
const SKIP_KEY = 'KeyN';
const SKIP_OPENS = 5;
/** Heroes a side may have in play at once. */
const HEROES_A_SIDE = 2;
/** Battle points. */
const BP = { kill: 100, headshot: 25, hero: 250, capture: 200, neutralise: 80 };
/** How long after spawning a pick in the menu still changes what they carry now. */
const REARM = 4;
/** Achievements (meta.ts): the kills that are the Force's, the saber's, and all-time kills for `galactic_veteran`. */
const FORCE_KILLS = new Set<string>([FORCE.push, FORCE.pull, FORCE.leap, FORCE.choke, FORCE.lightning, FORCE.chain, FORCE.aura]);
const saberKill = (weapon: string | undefined) => !!weapon && (weapon.startsWith('saber_') || weapon === FORCE.rush || weapon === FORCE.throw);
const VETERAN = 100;
/** Seconds of protection spawning at their side's base. */
const BASE_PROTECT = 3;
/** The third-person camera: over the right shoulder, a few blocks back. */
const SHOULDER = { distance: 3.3, shoulder: { right: 0.65, up: 0.5 } };

const BOT_NAMES: [string[], string[]] = [
  ['Sgt. Varno', 'Cpl. Jex', 'Lt. Dray', 'Pvt. Kallis', 'Tamsin', 'Oro Brask', 'Hollis', 'Keet', 'Marn Vosk', 'Pell', 'Sgt. Idrin', 'Coyle', 'Zara Venn', 'Pvt. Olan', 'Dex Farro', 'Nima'],
  ['TK-421', 'TK-327', 'TK-117', 'TK-808', 'TK-512', 'TK-930', 'TK-246', 'TK-661', 'TK-775', 'TK-139', 'TK-904', 'TK-358', 'TK-213', 'TK-487', 'TK-622', 'TK-091'],
];

let fighters = match.fighters;
let running = false;
let startedAt = 0;
let overAt = 0;
/** How long this intermission lasts (a skip's is short). */
let intermission = INTERMISSION;
/** The vote to skip the match that's on (the platform's `skipVote` kit), and whether the match now over was skipped. */
let vote: SkipVote;
let skipped = false;
let lastSecond = -1;
let boardDirty = true;
let boardAt = 0;
/** Fighters a side a command asked for (null: the mode's). */
let sideOverride: number | null = null;
/** What the next match plays; where the public rotation has got to; the match menu in a room of one's own. */
let plan: MatchPlan = ROTATION[0];
let turn = 0;
let settings: MenuHandle | null = null;
let offered = false;
let joining: Team | null = null;
let conquest: Conquest;
let heroes: Heroes;
let bots: Bots;
let navs = new Map<string, NavGrid>();
/** The map's hotspots, where bots drift (the array the bots read: refilled for each map). */
const hotspots: Vec3[] = [];
/** When each player last fired (their blasters cool after), and the cooling not yet a whole shot. */
const lastShot = new Map<string, number>();
const coolant = new Map<string, number>();
/** What each post's marker shows now (only changes go out). */
const markers = new Map<string, string>();
/** Each side's been warned its reinforcements are low. */
const warned: [boolean, boolean] = [false, false];
const LOW_TICKETS = 0.2;
/** People told a hero's theirs to take. */
const heroTold = new Set<string>();

const heroMode = () => match.mode.heroes;
const sideSize = () => Math.min(MAX_SIDE, sideOverride ?? match.mode.side);
const planName = (m: MatchPlan) => `${MODES[m.mode].name} on ${mapById(m.map)?.name ?? m.map}`;
const fmt = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
const teamColor = (t: Team | null) => (t === null ? '#e9edf2' : TEAMS[t].color);

// -------------------------------------------------------------------------------------------------
// Fighters: joining, sides, what they carry, where they spawn
// -------------------------------------------------------------------------------------------------

function addFighter(game: GameContext, p: Player): Fighter {
  const team = joining ?? smallerSide(!p.bot);
  const f: Fighter = {
    player: p,
    team,
    cls: p.bot ? botClass(game.rng.next()) : 'trooper',
    hero: null,
    wantHero: null,
    lastHero: null,
    spawnAt: null,
    bp: 0,
    earned: 0, // cinema
    heroesPlayed: [], // cinema
    score: 0,
    kills: 0,
    deaths: 0,
    captures: 0,
    diedAt: -1,
    spawnedAt: 0,
    firedAt: -99,
    menu: null,
    radar: '',
    thirdPerson: true,
  };
  fighters.set(p.id, f);
  p.color = TEAMS[team].color;
  dress(f);
  boardDirty = true;
  return f;
}

/** What a bot fights as: mostly troopers, some heavies, a few specialists. */
const botClass = (r: number): ClassId => (r < 0.55 ? 'trooper' : r < 0.82 ? 'heavy' : 'specialist');

/** The side with fewer on it (counting only people, for a person joining; then everyone). */
function smallerSide(person: boolean): Team {
  const count = (t: Team, people: boolean) => teamFighters(t).filter((f) => !people || !f.player.bot).length;
  if (person && count(0, true) !== count(1, true)) return count(0, true) < count(1, true) ? 0 : 1;
  return count(0, false) <= count(1, false) ? 0 : 1;
}

/** Which of a class's looks someone wears: the same every life, from their name. */
function looks(name: string): number {
  let h = 7;
  for (let i = 0; i < name.length; i++) h = (Math.imul(h, 31) + name.charCodeAt(i)) | 0;
  return Math.abs(h);
}

/** Their trooper's model (a hero's is the hero module's). */
function dress(f: Fighter) {
  f.player.setModel(trooperModel(f.team, CLASSES[f.cls].model, looks(f.player.name)));
}

/** A trooper's kit: their class's blaster, a pistol, detonators; its health and pace. */
function arm(f: Fighter) {
  const p = f.player;
  const c = CLASSES[f.cls];
  const inv = p.inventory;
  inv.clear();
  inv.give(weaponFor(f.team, c.primary));
  inv.give(weaponFor(f.team, 'pistol'));
  inv.give('detonator', c.detonators);
  inv.select(0);
  p.maxHealth = c.health;
  p.health = c.health;
  p.speed = c.speed;
}

/** Their camera: over the shoulder, or through their eyes. */
function camera(f: Fighter) {
  const p = f.player;
  if (p.bot) return;
  if (f.thirdPerson) p.camera.orbit(p, { distance: SHOULDER.distance, min: SHOULDER.distance, max: SHOULDER.distance, shoulder: SHOULDER.shoulder, wheel: false });
  else p.camera.orbit(null);
}

/** Heroes of a side in play now. */
const heroesUp = (t: Team) => teamFighters(t).filter((f) => f.hero && f.player.alive).length;

/** Why a fighter can't be this hero now (null: they can). */
function heroRefusal(f: Fighter, id: HeroId): string | null {
  const h = HEROES[id];
  if (h.team !== f.team) return 'the other side';
  // Heroes vs Villains: any of their side's, as many of each as like.
  if (heroMode()) return null;
  if ([...fighters.values()].some((o) => o !== f && o.hero === id && o.player.alive)) return 'in play';
  if (f.hero !== id && heroesUp(f.team) >= HEROES_A_SIDE) return `${HEROES_A_SIDE} heroes out`;
  if (f.hero !== id && f.bp < h.cost) return `${h.cost} BP`;
  return null;
}

/** The middle of the post their side holds nearest them (where a hurt hero falls back to). */
function nearestHeld(p: Player): Vec3 | null {
  const f = fighterOf(p);
  if (!f) return null;
  let best: Vec3 | null = null;
  let bestD = Infinity;
  for (const post of conquest.held(f.team)) {
    const d = Math.hypot(post.spec.at.x - p.position.x, post.spec.at.z - p.position.z);
    if (d < bestD) {
      bestD = d;
      best = { ...post.spec.at };
    }
  }
  return best;
}

/** Where a side may spawn: posts it holds that the other side isn't taking. */
const spawnable = (t: Team): Post[] => conquest.held(t).filter((p) => p.spec.locked || (!p.contested && p.count[other(t)] === 0));

/** The post a fighter spawns at: their pick if it's still theirs to spawn at, else the front. */
function spawnPost(f: Fighter): Post {
  const ok = spawnable(f.team);
  const picked = f.spawnAt ? ok.find((p) => p.spec.id === f.spawnAt) : undefined;
  if (picked) return picked;
  const front = conquest.front(f.team);
  if (front && ok.includes(front)) return front;
  return ok[f.team === 0 ? 0 : ok.length - 1] ?? match.posts[f.team === 0 ? 0 : match.posts.length - 1];
}

/** A spawn point at a post out of any enemy's sight (and away from them), a little at random. */
function spawnPoint(game: GameContext, f: Fighter, post: Post): SpawnPoint {
  const enemies = game.players.filter((p) => p.alive && hostile(f.player, p));
  let best = post.spec.spawns[0];
  let bestScore = -Infinity;
  for (const sp of post.spec.spawns) {
    let near = 50;
    let seen = false;
    for (const e of enemies) {
      const d = Math.hypot(e.position.x - sp.x, e.position.z - sp.z);
      near = Math.min(near, d);
      if (!seen && d < 50 && game.world.lineOfSight(e.eye, { x: sp.x, y: sp.y + 1.6, z: sp.z })) seen = true;
    }
    const score = near - (seen ? 35 : 0) + game.rng.next() * 8;
    if (score > bestScore) {
      bestScore = score;
      best = sp;
    }
  }
  return best;
}

/** Into the fight: at a post, as a trooper of their class or the hero they picked (paid for now). */
function spawn(game: GameContext, f: Fighter) {
  const p = f.player;
  const post = spawnPost(f);
  const sp = spawnPoint(game, f, post);
  const hero = heroMode() ? heroFor(f) : f.wantHero && !heroRefusal(f, f.wantHero) ? f.wantHero : null;
  if (f.wantHero && !hero && !p.bot) p.hud.toast(`${HEROES[f.wantHero].name} isn't free: back to ${CLASSES[f.cls].name}`);
  f.wantHero = null;
  p.freeze(false);
  p.revive();
  p.teleport({ x: sp.x, y: sp.y + 0.05, z: sp.z }, sp.yaw, 0);
  if (hero) becomeHero(game, f, hero);
  else {
    f.hero = null;
    dress(f);
    arm(f);
  }
  p.health = p.maxHealth;
  // Longer at their base: a side pushed back to it isn't cut down coming out of the door.
  p.protect(post.spec.locked ? BASE_PROTECT : 1.5);
  f.diedAt = -1;
  f.spawnedAt = game.clock.now;
  f.menu?.close();
  camera(f);
  if (p.bot) bots.reset(p);
  else p.audio.play('respawn');
}

/** Heroes vs Villains: the hero they come back as (their pick, the last they were, or one of their side's at random). */
function heroFor(f: Fighter): HeroId {
  const mine = HERO_IDS.filter((id) => HEROES[id].team === f.team);
  const pick = [f.wantHero, f.lastHero].find((id) => id && mine.includes(id));
  return pick ?? mine[Math.floor(Math.random() * mine.length)];
}

/** (`cheat`: the `hero` command's, which earns no achievement.) */
function becomeHero(game: GameContext, f: Fighter, id: HeroId, cheat = false) {
  const h = HEROES[id];
  if (f.hero !== id && !heroMode()) f.bp -= h.cost;
  f.hero = id;
  f.lastHero = id;
  if (!f.heroesPlayed.includes(id)) f.heroesPlayed.push(id); // cinema
  heroes.become(f.player, id);
  boardDirty = true;
  // (In Heroes vs Villains everyone's a hero all the time: no fanfare.)
  if (heroMode()) return;
  game.hud.feed([{ text: f.player.name, color: TEAMS[f.team].color }, ` is ${h.name}`]);
  game.hud.banner(h.name.toUpperCase(), `${h.title} · for the ${TEAMS[f.team].name}`, { color: h.blade, duration: 2.2 });
  game.audio.play('hero_arrives');
  // An achievement (meta.ts): a hero paid for with battle points.
  if (!cheat && !f.player.bot) f.player.achieve('chosen_one');
}

/** The deployment menu (H, and on every death): class, hero, where to spawn. */
function spawnMenu(game: GameContext, f: Fighter) {
  const p = f.player;
  if (p.bot) return;
  const fresh = () => p.alive && game.clock.now - f.spawnedAt < REARM;
  const refresh = () => f.menu?.update({ subtitle: subtitle(), sections: sections() });
  const subtitle = () => {
    const wait = Math.max(0, Math.ceil(RESPAWN - (game.clock.now - f.diedAt)));
    const next = heroMode() ? HEROES[f.wantHero ?? f.lastHero ?? heroFor(f)].name : f.wantHero ? HEROES[f.wantHero].name : CLASSES[f.cls].name;
    return p.alive ? `${f.bp} battle points · picks change what you carry for a few seconds after spawning, else next life` : `Deploying as ${next} in ${wait} · ${f.bp} battle points`;
  };
  const sections = (): MenuOptions['sections'] => {
    const all = allSections();
    return heroMode() ? all.filter((s) => s.title === 'Heroes' || s.title === 'Go') : all;
  };
  const wait = () => Math.max(0, Math.ceil(RESPAWN - (game.clock.now - f.diedAt)));
  const allSections = (): MenuOptions['sections'] => [
    {
      title: 'Class',
      entries: CLASS_IDS.map((id) => ({
        icon: { item: weaponFor(f.team, CLASSES[id].primary), view: 'side' } as IconRef,
        label: CLASSES[id].name,
        note: CLASSES[id].blurb,
        active: f.cls === id && !f.wantHero && !f.hero,
        onSelect: () => {
          f.cls = id;
          f.wantHero = null;
          if (fresh() && !f.hero) {
            dress(f);
            arm(f);
            p.hud.toast(`${CLASSES[id].name} it is`);
          }
          refresh();
        },
      })),
    },
    {
      title: 'Heroes',
      entries: HERO_IDS.filter((id) => HEROES[id].team === f.team).map((id) => {
        const why = heroRefusal(f, id);
        return {
          icon: { item: HEROES[id].weapon, view: 'side' } as IconRef,
          label: HEROES[id].name,
          note: `${HEROES[id].title} · ${HEROES[id].powers.map((w) => w.name).join(' · ')}`,
          detail: why ?? (heroMode() ? '' : `${HEROES[id].cost} BP`),
          disabled: why !== null,
          active: f.wantHero === id || f.hero === id,
          onSelect: () => {
            if (heroRefusal(f, id)) return;
            f.wantHero = id;
            if (fresh() && !f.hero) {
              f.wantHero = null;
              becomeHero(game, f, id);
              f.menu?.close();
              return;
            }
            refresh();
          },
        };
      }),
    },
    {
      title: 'Deploy at',
      entries: [
        { icon: { block: 'glowstone' }, label: 'Where the fight is', note: 'The post of ours nearest the enemy', active: f.spawnAt === null, onSelect: () => ((f.spawnAt = null), refresh()) },
        ...conquest.held(f.team).map((post) => ({
          icon: { block: f.team === 0 ? 'orange_concrete' : 'light_blue_concrete' },
          label: `${post.spec.id} · ${post.spec.name}`,
          note: post.spec.locked ? 'Our base' : post.contested || post.count[other(f.team)] ? 'Under attack: not now' : 'Ours',
          disabled: !spawnable(f.team).includes(post),
          active: f.spawnAt === post.spec.id,
          onSelect: () => ((f.spawnAt = post.spec.id), refresh()),
        })),
      ],
    },
    {
      title: 'Go',
      entries: [
        {
          icon: { block: 'glowstone' },
          label: p.alive ? 'Back to the fight' : wait() > 0 ? `Deploy in ${wait()}` : 'Deploy',
          note: p.alive ? 'Your picks stand for your next life' : 'The moment you can',
          onSelect: () => {
            f.menu?.close();
            // Dead and the wait's over: in now (otherwise the respawn takes them when it's up).
            if (!p.alive && wait() === 0 && match.phase === 'playing') spawn(game, f);
          },
        },
        // The vote to skip (N out of the menu): here too, since the dead spend their wait in it.
        {
          icon: { block: MAP_ICONS[match.map.id] ?? 'sandstone' },
          label: vote.voted(p) ? 'Take back your vote to skip' : 'Vote to skip this match',
          note: `${match.mode.name} on ${match.map.name} · N`,
          onSelect: () => {
            const no = vote.toggle(p);
            if (no) p.hud.toast(no);
            refresh();
          },
        },
      ],
    },
  ];
  if (f.menu?.open) {
    refresh();
    return;
  }
  f.menu = p.hud.menu({
    title: TEAMS[f.team].name.toUpperCase(),
    subtitle: subtitle(),
    sections: sections(),
    onClose: () => {
      f.menu = null;
    },
  });
}

/** Bots fill each side to its size; people take their places. */
function balanceBots(game: GameContext) {
  const used = new Set(game.players.map((p) => p.name));
  for (const t of [0, 1] as Team[]) {
    const mine = teamFighters(t);
    const people = mine.filter((f) => !f.player.bot).length;
    const theirs = mine.filter((f) => f.player.bot).map((f) => f.player);
    const want = Math.max(0, sideSize() - people);
    if (theirs.length < want)
      for (let i = theirs.length; i < want; i++) {
        const name = BOT_NAMES[t].find((n) => !used.has(n)) ?? `${t ? 'TK' : 'Pvt.'} ${game.players.length + 100}`;
        used.add(name);
        joining = t;
        game.bots.add(name);
        joining = null;
      }
    else if (theirs.length > want) {
      const out = [...theirs].sort((a, b) => (fighters.get(a.id)?.score ?? 0) - (fighters.get(b.id)?.score ?? 0)).slice(0, theirs.length - want);
      for (const b of out) game.bots.remove(b);
    }
  }
}

// -------------------------------------------------------------------------------------------------
// Deaths, points, the posts changing hands
// -------------------------------------------------------------------------------------------------

const killIcon = (weapon: string): IconRef | null => feedIcon(weapon) ?? (weapon.startsWith('saber_') || isHeroGun(weapon) ? { item: weapon, view: 'side' } : null);

function earn(f: Fighter, points: number) {
  f.bp += points;
  f.earned += points; // cinema
  f.score += points;
  boardDirty = true;
}

function onDeath(game: GameContext, victim: Player, source: unknown, weapon: string | undefined, headshot: boolean) {
  const v = fighters.get(victim.id);
  if (!v || match.phase !== 'playing') return;
  v.deaths++;
  v.diedAt = game.clock.now;
  conquest.died(v.team);
  const wasHero = v.hero;
  if (wasHero) {
    heroes.end(victim);
    v.hero = null;
    if (!heroMode()) game.hud.feed([{ text: `${HEROES[wasHero].name} has fallen`, color: HEROES[wasHero].blade }]);
  }
  boardDirty = true;
  const killer = typeof source === 'object' && source !== null && (source as Player).kind === 'player' ? (source as Player) : null;
  const k = killer && killer !== victim ? fighters.get(killer.id) : undefined;
  const icon = weapon ? killIcon(weapon) : null;
  if (k && killer) {
    k.kills++;
    earn(k, BP.kill + (headshot ? BP.headshot : 0) + (wasHero ? BP.hero : 0));
    if (!killer.bot) killer.hud.pop(wasHero ? 'HERO DOWN' : headshot ? 'HEADSHOT' : 'KILL', { sub: `+${BP.kill + (headshot ? BP.headshot : 0) + (wasHero ? BP.hero : 0)}`, color: COLORS.yellow });
    game.hud.feed([
      { text: killer.name, color: TEAMS[k.team].color },
      ...(icon ? [{ icon }] : weapon ? [` ${weaponName(weapon)} `] : [' ✕ ']),
      ...(headshot ? ['⌖'] : []),
      { text: victim.name, color: TEAMS[v.team].color },
    ]);
    victim.hud.banner('KILLED BY', `${killer.name}${weapon ? ` · ${k.hero && weapon.startsWith('saber_') ? 'a saber' : (HERO_GUNS[weapon]?.name ?? weaponName(weapon))}` : ''}`, { color: COLORS.red, duration: RESPAWN - 0.5 });
    // Achievements (meta.ts), a person's.
    if (!killer.bot) {
      killer.achieve('dont_get_cocky');
      if (wasHero && !k.hero) killer.achieve('giant_killer');
      if (saberKill(weapon)) killer.achieve('elegant_weapon');
      if (weapon && FORCE_KILLS.has(weapon)) killer.achieve('use_the_force');
      if (weapon === DEFLECTED) killer.achieve('return_to_sender');
      if ((killer.store.get<AllTime>('stats')?.kills ?? 0) + k.kills >= VETERAN) killer.achieve('galactic_veteran');
    }
    // The death cam: a moment on the ground, then round whoever did it until they deploy again.
    if (!victim.bot) game.clock.after(0.9, () => !victim.alive && killer.alive && victim.camera.orbit(killer, { distance: 6, min: 6, max: 6, wheel: false }));
  } else {
    game.hud.feed([{ text: victim.name, color: TEAMS[v.team].color }, weapon === 'detonator' ? ' held the detonator too long' : ' fell']);
  }
  if (!victim.bot) game.clock.after(1.2, () => !victim.alive && fighters.has(victim.id) && spawnMenu(game, v));
}

function onPost(game: GameContext, n: PostNews) {
  const t = TEAMS[n.team];
  const where = `${n.post.spec.id} · ${n.post.spec.name}`;
  if (n.t === 'captured') {
    for (const f of n.by) {
      f.captures++;
      earn(f, BP.capture);
      if (f.player.bot) continue;
      f.player.hud.pop('POST CAPTURED', { sub: `+${BP.capture}`, color: t.color });
      f.player.achieve('high_ground');
    }
    game.hud.feed([{ text: t.short, color: t.color }, ` took ${where}`]);
    for (const f of fighters.values()) {
      if (f.player.bot) continue;
      f.player.audio.play(f.team === n.team ? 'post_gained' : 'post_lost');
      if (f.team !== n.team) f.player.hud.banner('POST LOST', where, { color: COLORS.red, duration: 1.8 });
    }
  } else {
    for (const f of n.by) {
      earn(f, BP.neutralise);
      if (!f.player.bot) f.player.hud.pop('NEUTRALISED', { sub: `+${BP.neutralise}`, color: t.color });
    }
    game.hud.feed([{ text: t.short, color: t.color }, ` neutralised ${where}`]);
  }
  boardDirty = true;
}

/** The match is over, `winner` taking it. (`cheat`: ended by the `win` command, which earns no achievements.) */
function endMatch(game: GameContext, winner: Team, cheat = false) {
  if (match.phase === 'over') return;
  match.phase = 'over';
  overAt = game.clock.now;
  intermission = INTERMISSION;
  vote.reset();
  const alltime = new Map<string, string>(); // cinema
  for (const f of fighters.values()) {
    const p = f.player;
    p.freeze(true, { weapons: true });
    f.menu?.close();
    p.hud.progress(null);
    if (p.bot) continue;
    const won = f.team === winner;
    p.audio.play(won ? 'victory' : 'defeat');
    // All-time numbers, kept for their account (a guest's for the visit).
    const s = p.store.get<AllTime>('stats') ?? { games: 0, wins: 0, kills: 0, deaths: 0, heroes: 0 };
    s.games++;
    if (won) s.wins++;
    s.kills += f.kills;
    s.deaths += f.deaths;
    p.store.set('stats', s);
    alltime.set(p.id, `All time · ${s.wins} ${s.wins === 1 ? 'win' : 'wins'} in ${s.games} · ${s.kills} kills`);
    // Achievements (meta.ts): a match played out, and won.
    if (!cheat) {
      p.achieve('reporting_for_duty');
      if (won) p.achieve('medal_ceremony');
    }
  }
  // What's next: the rotation's next match in a public room; the same again in one's own.
  if (game.room === 'public') plan = ROTATION[++turn % ROTATION.length];
  scoreboard(game);
  // cinema: the end screen (the result, the top three, their own match, what's next).
  showEnd(winner, { mode: MODES[plan.mode].name, map: mapById(plan.map)?.name ?? plan.map }, INTERMISSION, alltime);
}

/**
 * The vote to skip passed: the match is over without being played out. Nobody wins, nothing goes
 * on anyone's all-time numbers, and no achievements. Everyone stops where they are, and a few
 * seconds later the next match is on: the rotation's next in a public room, and in one's own the
 * rotation's after this one (the same again would be no skip).
 */
function skipMatch(game: GameContext) {
  if (match.phase === 'over') return;
  const was = planName({ mode: match.mode.id, map: match.map.id });
  match.phase = 'over';
  skipped = true;
  overAt = game.clock.now;
  intermission = SKIP_PAUSE;
  for (const f of fighters.values()) {
    f.player.freeze(true, { weapons: true });
    f.menu?.close();
    f.player.hud.progress(null);
  }
  if (game.room === 'public') plan = ROTATION[++turn % ROTATION.length];
  else {
    const at = ROTATION.findIndex((m) => m.mode === match.mode.id && m.map === match.map.id);
    plan = ROTATION[(at + 1) % ROTATION.length];
  }
  game.hud.banner('SKIPPED', `The vote's in · next up: ${planName(plan)}`, { color: COLORS.yellow, duration: SKIP_PAUSE - 0.3 });
  game.hud.feed([`The vote passed: ${was} skipped`]);
}

// -------------------------------------------------------------------------------------------------
// Blasters cool while the trigger rests
// -------------------------------------------------------------------------------------------------

function cool(game: GameContext, dt: number) {
  const g = guns.of(game);
  if (!g) return;
  const now = game.clock.now;
  for (const f of fighters.values()) {
    const p = f.player;
    if (!p.alive || now - (lastShot.get(p.id) ?? -99) < COOL_AFTER) continue;
    const held = g.held(p);
    for (const stack of p.inventory.slots) {
      const def = stack && (BLASTERS[stack.item] ?? HERO_GUNS[stack.item]);
      if (!stack || !def) continue;
      if (held?.item === stack.item && g.reloading(p)) continue;
      const a = g.ammo(p, stack.item);
      if (!a || a.magazine >= def.magazine) continue;
      const key = `${p.id}:${stack.item}`;
      const acc = (coolant.get(key) ?? 0) + (def.magazine / COOL_FULL) * dt;
      const whole = Math.floor(acc);
      coolant.set(key, acc - whole);
      if (whole > 0) g.setAmmo(p, stack.item, { magazine: Math.min(def.magazine, a.magazine + whole) });
    }
  }
}

// -------------------------------------------------------------------------------------------------
// HUD
// -------------------------------------------------------------------------------------------------

function scoreboard(game: GameContext, show = false) {
  const left = Math.max(0, Math.min(match.mode.time, match.mode.time - (game.clock.now - startedAt))); // cinema: full during the fly-over
  const rows = [...fighters.values()]
    .sort((a, b) => a.team - b.team || b.score - a.score)
    .map((f) => ({
      name: `${f.hero ? `${HEROES[f.hero].name} · ` : ''}${f.player.name}${f.player.bot ? ' ·bot' : ''}`,
      values: [f.score, f.kills, f.deaths, f.captures],
      color: TEAMS[f.team].color,
      player: f.player,
    }));
  const sides = `${TEAMS[0].short} ${match.tickets[0]} · ${TEAMS[1].short} ${match.tickets[1]}`;
  game.hud.scoreboard({
    title: `${match.map.name.toUpperCase()} · ${match.mode.name.toUpperCase()}`,
    columns: [...BOARD_COLUMNS],
    rows,
    footer: match.phase === 'over' ? `${sides} · next: ${planName(plan)} in ${Math.max(0, Math.ceil(intermission - (game.clock.now - overAt)))}` : `${sides} · ${fmt(left)} left`,
    show,
  });
}

function conquestBar(game: GameContext) {
  const left = Math.max(0, Math.min(match.mode.time, match.mode.time - (game.clock.now - startedAt))); // cinema: full during the fly-over
  const sideOf = (t: Team) => ({ short: TEAMS[t].short, color: TEAMS[t].color, tickets: match.tickets[t], pct: Math.round((match.tickets[t] / match.mode.tickets) * 100) / 100 });
  game.hud.widget('conquest', {
    a: sideOf(0),
    b: sideOf(1),
    posts: (match.mode.posts ? match.posts : []).map((p) => ({
      id: p.spec.id,
      own: p.owner === null ? 'none' : TEAMS[p.owner].id,
      state: p.contested ? 'contested' : p.moving !== null ? 'moving' : '',
      fill: Math.round(Math.abs(p.control) * 20) / 20,
      lean: p.control > 0 ? 'rebels' : p.control < 0 ? 'empire' : 'none',
      by: p.moving === null ? 'none' : TEAMS[p.moving].id,
    })),
    clock: fmt(left),
  });
  // The posts' markers in the world, in their holder's colour.
  for (const p of match.mode.posts ? match.posts : []) {
    const key = `${p.owner}|${p.contested}|${p.moving}`;
    if (markers.get(p.spec.id) === key) continue;
    markers.set(p.spec.id, key);
    const a = p.spec.at;
    game.hud.marker(`post_${p.spec.id}`, { x: a.x, y: a.y + 3.2, z: a.z }, { shape: 'diamond', label: p.spec.id, color: teamColor(p.owner), size: 18, pulse: p.contested || p.moving !== null });
  }
}

function personalHud(game: GameContext, f: Fighter) {
  const p = f.player;
  const cheapest = Math.min(...HERO_IDS.filter((id) => HEROES[id].team === f.team).map((id) => HEROES[id].cost));
  const ready = !f.hero && HERO_IDS.some((id) => HEROES[id].team === f.team && !heroRefusal(f, id));
  p.hud.widget('status', {
    color: TEAMS[f.team].color,
    side: TEAMS[f.team].short,
    role: f.hero ? HEROES[f.hero].name : CLASSES[f.cls].name,
    bp: f.bp,
    hero: !!f.hero,
    heroReady: ready,
    heroCost: cheapest,
  });
  // A hero's theirs to take: a chime, once.
  if (ready && !heroTold.has(p.id)) p.audio.play('ui_hero_ready');
  if (ready) heroTold.add(p.id);
  else heroTold.delete(p.id);
  // Taking a post: how far it's come (0 the other side's, a half nobody's, 1 ours).
  const post = p.alive && match.mode.posts ? conquest.postOf(p) : null;
  if (post && !post.spec.locked && (post.moving !== null || post.contested || post.owner !== f.team)) {
    const mine = f.team === 0 ? post.control : -post.control;
    p.hud.progress(Math.round(((mine + 1) / 2) * 50) / 50, { color: post.contested ? '#ffffff' : TEAMS[f.team].color });
  } else p.hud.progress(null);
  // The radar: their side always; the other side for a moment after firing.
  const now = game.clock.now;
  const others = [...fighters.values()].filter((e) => e !== f && e.player.alive);
  const friends = others.filter((e) => e.team === f.team);
  const foes = others.filter((e) => e.team !== f.team && now - e.firedAt < 1.6);
  const key = `${friends.map((b) => b.player.id).join(',')}|${foes.map((b) => b.player.id).join(',')}`;
  if (key !== f.radar) {
    f.radar = key;
    p.hud.radar({
      center: p,
      range: 60,
      blips: [...friends.map((e) => ({ at: e.player, color: TEAMS[f.team].color, size: e.hero ? 6 : 4 })), ...foes.map((e) => ({ at: e.player, color: COLORS.red, size: e.hero ? 7 : 5 }))],
    });
  }
}

// -------------------------------------------------------------------------------------------------
// Choosing the match: a public room goes round the rotation; a room of one's own picks (M)
// -------------------------------------------------------------------------------------------------

const MAP_ICONS: Record<string, string> = { spaceport: 'sandstone', frostline: 'snow_block' };
const MODE_ICONS: Record<ModeId, IconRef> = { conquest: { item: 'imp_rifle', view: 'side' }, hvv: { item: 'saber_vader', view: 'side' } };

function matchMenu(game: GameContext, p: Player) {
  if (game.room === 'public') {
    p.hud.toast(`Public games go round the modes · next: ${planName(plan)} · N votes to skip this one`);
    return;
  }
  if (settings?.open) return;
  const pick: MatchPlan = { mode: match.mode.id, map: match.map.id };
  const sections = (): MenuOptions['sections'] => [
    { title: 'Mode', entries: Object.values(MODES).map((m) => ({ icon: MODE_ICONS[m.id], label: m.name, note: m.goal, active: pick.mode === m.id, onSelect: () => ((pick.mode = m.id), settings?.update({ sections: sections() })) })) },
    { title: 'Map', entries: MAPS.map((m) => ({ icon: { block: MAP_ICONS[m.id] ?? 'sandstone' }, label: m.name, note: m.blurb, active: pick.map === m.id, onSelect: () => ((pick.map = m.id), settings?.update({ sections: sections() })) })) },
    {
      title: 'Go',
      entries: [
        {
          icon: { block: 'glowstone' },
          label: 'Start the match',
          note: planName(pick),
          onSelect: () => {
            plan = { ...pick };
            settings?.close();
            game.hud.feed([{ text: p.name, color: COLORS.yellow }, ` started ${planName(plan)}`]);
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
      const f = fighters.get(p.id);
      if (f && running && match.phase === 'playing') spawnMenu(game, f);
    },
  });
}

// -------------------------------------------------------------------------------------------------
// The game
// -------------------------------------------------------------------------------------------------

export default defineServer(shared, {
  // Its kinds of item: thermal detonators (first: one being cooked takes the fire button), blasters, sabers
  // (the heroes', `heroes/saber.ts`).
  items: [throwables(), guns(), melee({ fist: false }), ...heroItems()],
  setup(game) {
    match.fighters = fighters = new Map();
    match.phase = 'playing';
    match.map = MAPS[0];
    running = false;
    sideOverride = null;
    plan = ROTATION[0];
    turn = 0;
    settings = null;
    offered = false;
    lastShot.clear();
    coolant.clear();
    markers.clear();
    conquest = new Conquest(game);
    defineWeapons(game);
    setupSkies(game); // skies
    setupHits(game); // hits
    // (A hurt hero falls back to the nearest post their side holds.)
    heroes = setupHeroes(game, { teamOf: (p) => fighterOf(p)?.team ?? null, hostile, retreat: (p) => nearestHeld(p) });
    heroes.define();
    game.hud.define('conquest', CONQUEST);
    setupCinema(game); // cinema: the end screen
    game.hud.define('status', STATUS);
    game.hud.define('skipvote', SKIPVOTE);
    vote = skipVote(game, {
      people: () => [...fighters.values()].map((f) => f.player),
      playing: () => match.phase === 'playing',
      match: () => ({ mode: match.mode.name, map: match.map.name }),
      color: (p) => teamColor(fighterOf(p)?.team ?? null),
      skip: () => skipMatch(game),
      opens: INTRO_HOLD + SKIP_OPENS,
    });
    navs = new Map(MAPS.map((m) => [m.id, navGrid(game, { bounds: m.bounds })]));
    bots = makeBots(game, () => navs.get(match.map.id) ?? null, hotspots, conquest, heroes.botHooks);

    game.events.on('playerJoin', ({ player }) => {
      // Signed in for the first time since claiming their name: the numbers kept by it are theirs.
      if (player.adopted) {
        const old = game.store.get<AllTime>(`stats:${player.adopted}`);
        if (old) player.store.set('stats', old);
        game.store.delete(`stats:${player.adopted}`);
      }
      const f = fighters.get(player.id) ?? addFighter(game, player);
      if (player.bot) bots.add(player as Bot, 0.25 + game.rng.next() * 0.5);
      if (running && match.phase === 'playing') spawn(game, f);
      if (!player.bot) {
        balanceBots(game);
        game.hud.feed([{ text: player.name, color: TEAMS[f.team].color }, ` joined the ${TEAMS[f.team].name}`]);
        // One more to count in a vote to skip.
        vote.joined(player);
      }
    });
    game.events.on('playerReady', ({ player }) => {
      const f = fighters.get(player.id);
      // A room of one's own: the first one in picks what to play; anyone else, what they fight as.
      if (game.room !== 'public' && !offered) matchMenu(game, player);
      else if (f && running) {
        spawnMenu(game, f);
        if (match.phase === 'playing') joinIntro(game, f); // cinema: their own fly-over
      }
    });
    game.events.on('playerLeave', ({ player }) => {
      const f = fighters.get(player.id);
      f?.menu?.close();
      if (f?.hero) heroes.end(player);
      fighters.delete(player.id);
      lastShot.delete(player.id);
      bots.remove(player);
      bots.forget(player);
      boardDirty = true;
      if (!player.bot) balanceBots(game);
      // Their vote goes, and the rest are counted again (last: a vote to skip may end the match).
      vote.left(player);
    });
    game.events.on('playerDeath', ({ player, source, weapon, headshot }) => onDeath(game, player, source, weapon, !!headshot));
    game.events.on('shot', ({ player }) => {
      lastShot.set(player.id, game.clock.now);
      const f = fighters.get(player.id);
      if (f) f.firedAt = game.clock.now;
    });
    // No friendly fire (your own detonator still hurts you).
    game.events.on('damage', (hit) => {
      const by = hit.source;
      if (!by || by === 'world' || by.kind !== 'player' || hit.target.kind !== 'player' || by === hit.target) return;
      if (!hostile(by, hit.target)) hit.cancel();
    });

    game.commands.register('bots', {
      usage: '<n>',
      help: 'Fill each side up to n fighters',
      cheat: true,
      run: ([n], g) => {
        sideOverride = Math.max(0, Math.min(MAX_SIDE, Number(n) || 0));
        balanceBots(g);
        return `${sideSize()} a side`;
      },
    });
    game.commands.register('bp', {
      usage: '<n>',
      help: 'Give yourself battle points',
      cheat: true,
      run: ([n], _g, p) => {
        const f = fighterOf(p);
        if (!f) return 'not fighting';
        f.bp += Number(n) || 1000;
        return `${f.bp} BP`;
      },
    });
    game.commands.register('hero', {
      usage: `<${HERO_IDS.join('|')}>`,
      help: 'Become a hero now',
      cheat: true,
      complete: () => HERO_IDS,
      run: ([id], g, p) => {
        const f = fighterOf(p);
        if (!f || !HERO_IDS.includes(id as HeroId)) return `heroes: ${HERO_IDS.join(', ')}`;
        const h = HEROES[id as HeroId];
        if (h.team !== f.team) setSide(g, f, h.team);
        f.bp = Math.max(f.bp, h.cost);
        becomeHero(g, f, id as HeroId, true);
        return h.name;
      },
    });
    game.commands.register('team', {
      usage: '<0|1>',
      help: 'Change sides',
      cheat: true,
      run: ([t], g, p) => {
        const f = fighterOf(p);
        if (!f || (t !== '0' && t !== '1')) return '0 (Rebels) or 1 (Empire)';
        setSide(g, f, Number(t) as Team);
        return TEAMS[f.team].name;
      },
    });
    game.commands.register('tickets', {
      usage: '<rebels> <empire>',
      help: 'Set the tickets',
      cheat: true,
      run: ([a, b]) => {
        match.tickets = [Number(a) || 0, Number(b ?? a) || 0];
        return match.tickets.join(' · ');
      },
    });
    game.commands.register('mode', {
      usage: `<${Object.keys(MODES).join('|')}> [map]`,
      help: 'Start a match of this mode (on this map)',
      cheat: true,
      complete: () => Object.keys(MODES),
      run: ([m, where], g) => {
        if (!m || !(m in MODES)) return `modes: ${Object.keys(MODES).join(', ')}`;
        if (where && !mapById(where)) return `maps: ${MAPS.map((x) => x.id).join(', ')}`;
        plan = { mode: m as ModeId, map: where ?? match.map.id };
        g.restart();
        return planName(plan);
      },
    });
    // The vote to skip, typed (N does the same): everyone's, not a cheat.
    game.commands.register('skip', {
      help: 'Vote to skip this match (its mode and map); again to take your vote back',
      run: (_a, _g, p) => vote.toggle(p) ?? undefined,
    });
    game.commands.register('win', { help: 'End the match now', cheat: true, run: (_a, g, p) => endMatch(g, fighterOf(p)?.team ?? 0, true) });
  },

  start(game) {
    running = true;
    match.phase = 'playing';
    match.mode = MODES[plan.mode];
    match.map = mapById(plan.map) ?? MAPS[0];
    hotspots.splice(0, hotspots.length, ...match.map.hotspots);
    game.world.spawn = match.map.home;
    // Each map its own time of day (the maps share one world).
    game.env.time = match.map.time;
    conquest.begin(match.map.posts, match.mode.tickets);
    // Without posts to fight over, their markers go.
    for (const p of match.map.posts) game.hud.marker(`post_${p.id}`, null);
    startedAt = game.clock.now;
    lastSecond = -1;
    skipped = false;
    intermission = INTERMISSION;
    // A new match: no votes to skip it yet (they open once the fly-over's done and a moment's gone).
    vote.reset();
    boardDirty = true;
    // (A restart puts the match's clock back to 0: times kept from the last match mean nothing now.)
    boardAt = 0;
    for (const b of game.bots.all) bots.forget(b);
    markers.clear();
    lastShot.clear();
    coolant.clear();
    warned[0] = warned[1] = false;
    for (const f of fighters.values()) {
      if (f.hero) heroes.end(f.player);
      Object.assign(f, { hero: null, wantHero: null, lastHero: null, spawnAt: null, bp: 0, earned: 0, heroesPlayed: [], score: 0, kills: 0, deaths: 0, captures: 0, diedAt: -1, firedAt: -99, radar: '' });
    }
    for (const p of game.players) if (!fighters.has(p.id)) addFighter(game, p);
    balanceBots(game);
    for (const f of fighters.values()) spawn(game, f);
    conquestBar(game);
    // cinema: the opening fly-over (its title card in place of a banner), everyone held till it's
    // done, and the clock from then.
    startIntro(game);
    startedAt += INTRO_HOLD;
    game.audio.play('match_start');
  },

  update(game, dt) {
    const now = game.clock.now;
    heroes.update(dt);
    updateSkies(game, dt); // skies
    const intro = introOn(game); // cinema
    bots.update(dt, match.phase !== 'playing' || intro);
    // The vote to skip (N), people's only, the dead's too: a vote that carries it ends the match here.
    for (const p of game.players) {
      if (p.bot || !p.input.pressed(SKIP_KEY, { dead: true })) continue;
      const no = vote.toggle(p);
      if (no) p.hud.toast(no);
    }
    if (match.phase === 'over') {
      if (now - overAt > intermission) game.restart();
      // (A match skipped has no end screen: its banner says what's next.)
      else if (!skipped && Math.floor(now) !== lastSecond) {
        lastSecond = Math.floor(now);
        scoreboard(game);
        tickEnd(intermission - (now - overAt)); // cinema
      }
      return;
    }
    // cinema: the posts (and the tickets they bleed) wait while the fly-over holds everyone.
    if (!intro) for (const n of conquest.update(dt)) onPost(game, n);
    cool(game, dt);
    for (const f of fighters.values()) {
      const p = f.player;
      if (!p.bot) {
        if (p.input.pressed('KeyH')) spawnMenu(game, f);
        if (p.input.pressed('KeyM')) matchMenu(game, p);
        if (p.input.pressed('KeyV')) {
          f.thirdPerson = !f.thirdPerson;
          camera(f);
        }
      }
      if (!p.alive) {
        if (f.diedAt < 0) f.diedAt = now;
        if (now - f.diedAt >= RESPAWN) {
          // Bots who've earned a hero take one now and then: on a side with people, only while
          // a hero's place is left over for them too.
          const people = teamFighters(f.team).some((o) => !o.player.bot);
          if (p.bot && !f.wantHero && !heroMode() && heroesUp(f.team) < (people ? HEROES_A_SIDE - 1 : HEROES_A_SIDE) && game.rng.next() < 0.65) {
            const free = HERO_IDS.filter((id) => HEROES[id].team === f.team && !heroRefusal(f, id));
            if (free.length) f.wantHero = free[game.rng.int(0, free.length - 1)];
          }
          spawn(game, f);
        } else if (!p.bot && Math.floor(now) !== lastSecond && f.menu?.open) spawnMenu(game, f);
        if (!p.bot) personalHud(game, f);
        continue;
      }
      if (p.position.y < match.map.bounds.min.y - 6) p.damage(1000, { source: 'world', knockback: 0 });
      if (!p.bot) personalHud(game, f);
    }
    for (const t of [0, 1] as Team[]) {
      if (warned[t] || match.tickets[t] > match.mode.tickets * LOW_TICKETS) continue;
      warned[t] = true;
      for (const f of teamFighters(t))
        if (!f.player.bot) {
          f.player.hud.banner('REINFORCEMENTS LOW', `${match.tickets[t]} left`, { color: COLORS.red, duration: 2.5 });
          f.player.audio.play('low_tickets');
        }
      for (const f of teamFighters(other(t))) if (!f.player.bot) f.player.hud.feed([{ text: TEAMS[t].short, color: TEAMS[t].color }, ' are running out of reinforcements']);
    }
    const loser = conquest.loser();
    if (loser !== null) {
      endMatch(game, other(loser));
      return;
    }
    const left = match.mode.time - (now - startedAt);
    if (left <= 0) {
      endMatch(game, match.tickets[0] >= match.tickets[1] ? 0 : 1);
      return;
    }
    if (Math.floor(now) !== lastSecond) {
      lastSecond = Math.floor(now);
      boardDirty = true;
    }
    conquestBar(game);
    if (boardDirty && now - boardAt > 0.3) {
      boardDirty = false;
      boardAt = now;
      scoreboard(game);
    }
  },
});

/** Change a fighter's side (a command): their colour, their kit, and a fresh spawn at their side's post. */
function setSide(game: GameContext, f: Fighter, t: Team) {
  if (f.team === t) return;
  if (f.hero) heroes.end(f.player);
  f.hero = null;
  f.team = t;
  f.player.color = TEAMS[t].color;
  f.spawnAt = null;
  if (f.player.alive) spawn(game, f);
  boardDirty = true;
}
