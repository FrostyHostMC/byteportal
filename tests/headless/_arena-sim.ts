import { readFileSync } from 'node:fs';
import type { Entity, GameContext, Player, Vec3 } from '@platform';
import { GameHost } from '../../src/platform/host/game';
import type { HostEvent, PlayerInput } from '../../src/platform/net/protocol';
import { BLESSINGS, blessingsOf, type BlessingId } from '../../src/games/arena/blessings';
import { ARMOR, armorOf, type ArmorId } from '../../src/games/arena/items';
import { WARES } from '../../src/games/arena/items/catalog';
import { forgeNext } from '../../src/games/arena/items/forge';
import { baseOf } from '../../src/games/arena/items/rarity';
import { bus } from '../../src/games/arena/run/bus';
import { choose, type ClassId } from '../../src/games/arena/run/classes';
import { isDowned } from '../../src/games/arena/run/downed';
import { bossKind, bossWidth } from '../../src/games/arena/bosses';
import type { BossState } from '../../src/games/arena/bosses/fight';
import { MARK_MSG, type Mark } from '../../src/games/arena/bosses/messages';
import { MAPS, mapById, inBox } from '../../src/games/arena/maps';
import { finalWave } from '../../src/games/arena/run/director';
import { gold } from '../../src/games/arena/run/gold';
import { FEATHER_PRICE, purchase, shopOpen } from '../../src/games/arena/run/shop';
import { map, setMap, state } from '../../src/games/arena/run/state';
import { games } from './_harness';

/**
 * Probe: how far the run goes for a player who plays it properly. A bot per fighter that picks a
 * class, fights with its kit (blades held, a bow drawn and loosed at range, the staff kept at a
 * distance, the gladius's guard raised against a blow it sees coming), drinks a potion when low,
 * throws bombs into knots of monsters (and at a boss, to stagger it), dodge-rolls (or jumps, or
 * steps out) what it can read coming (wind-ups and fuses in the monsters' own state, warning
 * rings, charge lines, storm marks, a boss's telegraphs on the ground and its chain) a beat after
 * it shows (a person's reaction), walks round lava, frost and a boss's pools, breaks a Lich's
 * phylacteries and a Broodmother's eggs first, revives a friend, and between waves takes a
 * blessing, picks up its reward and shops (potions, armour, the forge, bombs, a feather). At normal
 * health. Solo and two together, over seeds, per class, on each map. Prints each run's wave
 * reached, where and to what it died, damage by source per wave, gold earned and spent, each
 * wave's time and each boss's fight.
 * `RUNS=solo|duo|all SEEDS=3 CLASSES=gladiator,hunter MAPS=colosseum,forge node scripts/headless.mjs tests/headless/_arena-sim.ts`
 */

const CLASS_LIST: ClassId[] = ['gladiator', 'hunter', 'berserker', 'pyromancer'];
/**
 * How well the bot plays (`SKILL`): `skilled` (the default) is held to a good player's limits:
 * it reacts to a tell a beat after it shows (`react`, seconds), turns at most `turn` radians a
 * second, its aim wanders up to `aim` off, it notices most tells in front of it and fewer behind
 * (`notice`), times its rolls give or take `roll` seconds, raises the gladius's guard for some
 * blows (`guard`), throws a bomb at some knots (`bombs`), drinks at `drink` of its health.
 * `average` is a fair player's; `expert` has no limits at all.
 */
const SKILLS = {
  expert: { react: [0, 0], turn: Infinity, aim: 0, notice: { front: 1, behind: 1 }, roll: 0, guard: 1, bombs: 1, drink: 0.4 },
  skilled: { react: [0.18, 0.32], turn: 8, aim: 0.05, notice: { front: 0.92, behind: 0.45 }, roll: 0.08, guard: 0.9, bombs: 1, drink: 0.4 },
  average: { react: [0.3, 0.5], turn: 5, aim: 0.09, notice: { front: 0.75, behind: 0.25 }, roll: 0.2, guard: 0.6, bombs: 0.5, drink: 0.3 },
  novice: { react: [0.5, 0.8], turn: 3.5, aim: 0.14, notice: { front: 0.5, behind: 0.1 }, roll: 0.35, guard: 0.3, bombs: 0.25, drink: 0.25 },
};
const SKILL = SKILLS[(process.env.SKILL ?? 'skilled') as keyof typeof SKILLS] ?? SKILLS.skilled;
const REACT = SKILL.react;
const MAX_TIME = 3600;
/** A ranking of the blessings for the bot (higher first), by class. */
const PREFER: Partial<Record<BlessingId, number>> = { ironskin: 10, stout: 9.5, vampire: 9, secondwind: 8.5, bloodlust: 7.5, executioner: 7, berserk: 7, giant: 6, volatile: 6, embers: 6, storm: 5.5, thorns: 5, fleet: 4, momentum: 3 };
const PREFER_CLASS: Record<ClassId, Partial<Record<BlessingId, number>>> = {
  gladiator: { riposte: 8.8, bulwark: 8 },
  hunter: { hawkeye: 8, assassin: 8 },
  berserker: { tremor: 7, berserk: 8.5 },
  pyromancer: { arcane: 9.2, wildfire: 8.6, bombardier: 8, berserk: 1, giant: 1 },
};
/** Monsters that shoot or cast from where they stand: gone after wherever they are. */
const SHOOTERS = new Set(['skeleton', 'imp', 'necromancer', 'cultist']);
/** Each class's main weapon (the forge's), and what it holds at range. */
const MAIN: Record<ClassId, string> = { gladiator: 'gladius', hunter: 'daggers', berserker: 'battle_axe', pyromancer: 'fire_staff' };

interface WaveLog {
  wave: number;
  name: string;
  boss: string | null;
  twist: string | null;
  start: number;
  end?: number;
  taken: Record<string, number>;
  /** Before armour; the lowest any fighter's health got (a share of their most); what the fighters dealt. */
  raw: number;
  low: number;
  dealt: number;
  /** A boss's: how long it lasted. */
  bossLife?: number;
  downs: number;
  falls: number;
  goldStart: number;
  earned: number;
  spent: number;
  potions: number;
  rolls: number;
  bombs: number;
}

/** One fighter: a client of the host, its player, its bot's memory. */
interface Fighter {
  id: string;
  name: string;
  cls: ClassId;
  p: Player;
  seq: number;
  blessMenu: { id: number; entries: { label: string; cb: number }[] } | null;
  shopped: boolean;
  bought: string[];
  react: number;
  seen: Map<string, number>;
  bowDraw: number;
  bombCd: number;
  potionCd: number;
  stuck: number;
  lastPos: Vec3;
  strafe: number;
  strafeFlip: number;
  readyAt: number;
  diedTo: string | null;
  diedWave: number;
  /** Drinking until then (hands off the hotbar). */
  quaff: number;
  /** The reward it's walking to, since when, and those it gave up on. */
  lootKey: string;
  lootSince: number;
  skip: Set<string>;
  /** Where it's actually looking, and its aim's wander; which tells it noticed. */
  aimYaw: number;
  aimPitch: number;
  aimErr: [number, number];
  noticed: Map<string, boolean>;
  /** When (seconds before it lands) it'll roll from each tell; whether it guards each blow. */
  when: Map<string, number>;
  guardRoll: Map<string, boolean>;
  /** Its path (cells), when it was found, and to which cell. */
  path: number[] | null;
  pathAt: number;
  pathGoal: number;
  /** Stuck on something: when it last hopped, and a sidestep round it (seconds left, which way). */
  hopAt: number;
  side: number;
  sideDir: number;
}

const flat = (a: Vec3, b: Vec3) => Math.hypot(a.x - b.x, a.z - b.z);

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A threat the bot can read: where it'll land, how far it reaches, how long till it does. */
interface Threat {
  key: string;
  at: Vec3;
  reach: number;
  left: number;
  /** A line (a charge): its heading and length. */
  line?: { dir: number; length: number; width: number };
  /** A lane from `at` to `to` (a boss's charge, ice spikes): `width` either side of it. */
  seg?: { to: Vec3; width: number };
  /** Only within this arc round `at` (a sweep: angles round y from +x toward +z). */
  arc?: [number, number];
  /** How to get out: roll (any), jump (a ground slam), or just move. */
  jump?: boolean;
  /** It's after this fighter in particular (a wind-up at them, a chain), or everyone in reach. */
  only?: Player;
  /** Lasting ground (a boss's pool): walk out of it, no roll. */
  lasting?: boolean;
}

function simulate(seed: number, classes: ClassId[], mapId: string) {
  Math.random = mulberry32(seed ^ 0x5bd1e995);
  // (The fight starts on whatever map is current: this one.)
  setMap(mapById(mapId)!);
  const def = games.find((g) => g.id === 'arena')!;
  const host = new GameHost(def, { engine: readFileSync('engine/pkg/voxel_engine_bg.wasm'), seed, remote: true, radius: 6, budget: Infinity, player: { id: 'p1', name: 'Player' } });
  const game = host.sim.ctx as GameContext;
  const sim = host.sim as unknown as { players: { api: { id: string }; viewSeq: number }[]; items: { frame(): { x: number; y: number; z: number; item: string }[] } };
  const rand = mulberry32(seed * 7 + 3);

  // What happens, wave by wave.
  const waves: WaveLog[] = [];
  const cur = () => waves.at(-1);
  const deaths: { wave: number; who: string; to: string; at: string }[] = [];
  /** Where on the map (blocks from its middle), and what's at its feet there. */
  const where = (q: Vec3) => {
    const c = map().center;
    const at = (y: number) => game.world.blockName(game.world.getBlock(Math.floor(q.x), Math.floor(y), Math.floor(q.z)));
    return `(${(q.x - c.x).toFixed(0)},${(q.y - c.y).toFixed(0)},${(q.z - c.z).toFixed(0)} ${at(q.y + 0.1)}/${at(q.y - 0.5)})`;
  };
  let earnedTotal = 0;
  const earnedBy: Record<number, number> = {};
  bus.on('waveStart', ({ wave, name, boss, twist }) => {
    waves.push({ wave, name, boss, twist, start: game.clock.now, taken: {}, raw: 0, low: 1, dealt: 0, downs: 0, falls: 0, goldStart: fighters.reduce((a, f) => a + gold(f.p), 0), earned: 0, spent: 0, potions: 0, rolls: 0, bombs: 0 });
  });
  bus.on('waveCleared', () => {
    const w = cur();
    if (w) w.end = game.clock.now;
  });
  bus.on('gold', ({ delta, why }) => {
    const w = cur();
    if (delta > 0 && why !== 'start') {
      earnedTotal += delta;
      if (w) w.earned += delta;
      earnedBy[state.wave] = earnedTotal;
    }
    if (delta < 0 && w) w.spent -= delta;
  });
  bus.on('downed', () => void (cur() && cur()!.downs++));
  bus.on('fell', () => void (cur() && cur()!.falls++));
  const lastHit = new Map<string, string>();
  // (A blow counts for no more than a fighter's whole health: one who bleeds out is finished off
  // with an outsize blow, credited to whoever downed them, which would swamp the tallies.)
  game.events.on('playerDamage', ({ player, amount: dealt, source }) => {
    const amount = Math.min(dealt, player.maxHealth);
    const k = source && source !== 'world' && source.kind === 'entity' ? source.type + (source.data.elite ? `(${source.data.elite})` : '') : source === 'world' ? 'world' : 'other';
    lastHit.set(player.id, k);
    if (process.env.DEBUG_DMG && k.startsWith(process.env.DEBUG_DMG)) console.log(`    [${game.clock.now.toFixed(2)}] w${state.wave} ${k} -> ${player.name} ${amount.toFixed(1)} health ${player.health.toFixed(1)} alive ${player.alive} downed ${isDowned(player)}`);
    const w = cur();
    if (w && state.phase === 'fighting') w.taken[k] = (w.taken[k] ?? 0) + amount;
  });
  // What came at them before armour (last of the damage listeners, so after the game's own).
  game.events.on('damage', (hit) => {
    const w = cur();
    if (w && hit.target.kind === 'player' && !hit.cancelled && state.phase === 'fighting') w.raw += hit.amount;
  });
  // Each monster's life (by kind): how long it lasted, and what it did to the fighters.
  const born = new Map<number, number>();
  const kinds: Record<string, { n: number; life: number; dealt: number }> = {};
  const kindOf = (type: string) => (kinds[type] ??= { n: 0, life: 0, dealt: 0 });
  bus.on('spawned', ({ entity }) => void born.set(entity.id, game.clock.now));
  game.events.on('entityDamage', ({ amount, source }) => {
    const w = cur();
    if (w && source && source !== 'world' && source.kind === 'player') w.dealt += amount;
  });
  bus.on('slain', ({ entity, type }) => {
    const b = born.get(entity.id);
    if (b === undefined) return;
    // (Its fight: from the end of its entrance to the blow that beat it, before its throes.)
    if (bossKind(type) && cur()) cur()!.bossLife = game.clock.now - b - 5.4 - 2.8;
    const k = kindOf(type);
    k.n++;
    k.life += game.clock.now - b;
  });
  game.events.on('playerDamage', ({ player, amount, source }) => {
    if (source && source !== 'world' && source.kind === 'entity') kindOf(source.type).dealt += Math.min(amount, player.maxHealth);
  });
  game.events.on('playerDeath', ({ player }) => {
    const f = fighters.find((x) => x.p === player);
    deaths.push({ wave: state.wave, who: f?.cls ?? player.name, to: lastHit.get(player.id) ?? '?', at: where(player.position) });
  });
  game.events.on('ability', ({ name }) => void (name === 'roll' && cur() && cur()!.rolls++));

  // The rings and marks the screens are told of (what a person sees coming), from the batches:
  // the bestiary's rings, storm marks, a boss's telegraphs (and its pools, lasting till cleared).
  const rings: { at: Vec3; radius: number; until: number; harmless: boolean }[] = [];
  const marks = new Map<string, { at: Vec3; until: number }>();
  const tells: { key: string; m: Mark; until: number; jump: boolean }[] = [];
  const pools = new Map<string, { at: Vec3; r: number; until: number }>();
  let tellSeq = 0;
  /** A boss's moves that a jump clears (the shockwaves along the ground), and when each boss's present move began. */
  const GROUNDED = new Set(['stomp', 'slam', 'nova', 'twin']);
  const moveSeen = new Map<number, { move: string; at: number }>();
  /** Since when each monster's been off the floor (in a gate's pen), by id. */
  const outSince = new Map<number, number>();
  const bosses = () => game.entities.all().filter((e) => bossKind(e.type) && e.alive);
  const bossOf = (e: Entity) => (bossKind(e.type) ? (e.data.boss as BossState | undefined) : undefined);
  /** A tell's mark from a boss's screen message. */
  function told(m: Mark) {
    const now = game.clock.now;
    if (m.k === 'pool') pools.set(m.id, { at: { x: m.at[0], y: m.at[1], z: m.at[2] }, r: m.r, until: now + m.t });
    else if (m.k === 'clear') pools.delete(m.id);
    else if (m.k === 'ring' || m.k === 'sweep' || m.k === 'lane') {
      // Jumpable: a shockwave out of a boss's feet.
      const at = { x: m.at[0], y: m.at[1], z: m.at[2] };
      const jump = bosses().some((e) => GROUNDED.has(bossOf(e)?.move?.name ?? '') && flat(e.position, at) < 1.5);
      tells.push({ key: `tell${++tellSeq}`, m, until: now + m.t, jump });
    }
  }

  const fighters: Fighter[] = [];
  classes.forEach((cls, i) => {
    const name = `${cls}${i}`;
    const c = host.connect(name);
    host.command(c.id, { t: 'start', name });
    const p = game.players.find((q) => q.name === name)!;
    // Every class open to it (as to a seasoned player), whatever its level.
    p.store.set('arena', { xp: 1e7, best: {}, wins: 0 });
    fighters.push({ id: c.id, name, cls, p, seq: 0, blessMenu: null, shopped: false, bought: [], react: REACT[0] + rand() * (REACT[1] - REACT[0]), seen: new Map(), bowDraw: 0, bombCd: 0, potionCd: 0, stuck: 0, lastPos: { ...p.position }, strafe: 1, strafeFlip: 0, readyAt: 0, diedTo: null, diedWave: 0, quaff: 0, lootKey: '', lootSince: 0, skip: new Set(), aimYaw: p.yaw, aimPitch: 0, aimErr: [0, 0], noticed: new Map(), when: new Map(), guardRoll: new Map(), hopAt: -9, side: 0, sideDir: 1, path: null, pathAt: -9, pathGoal: -1 });
  });

  const monsters = () => game.entities.all().filter((e) => !e.data.scenery);
  /** What's coming that can be read: each monster's tell in its own state, rings, storm marks. */
  function threats(): Threat[] {
    const out: Threat[] = [];
    const now = game.clock.now;
    // (What's landed is forgotten.)
    if (tells.length > 64) tells.splice(0, tells.length, ...tells.filter((t) => t.until > now));
    if (rings.length > 64) rings.splice(0, rings.length, ...rings.filter((r) => r.until > now));
    for (const e of monsters()) {
      const d = e.data as Record<string, unknown>;
      const q = e.position;
      const num = (k: string) => (typeof d[k] === 'number' ? (d[k] as number) : undefined);
      // A blow wound up (the platform's melee, the knight's, the golem's fist, the minotaur's axe, the imp's throw).
      const wind = num('_wind') ?? num('_tell');
      if (wind !== undefined && e.type !== 'imp' && e.type !== 'wraith') out.push({ key: `${e.id}:blow`, at: q, reach: e.type === 'golem' ? 4 : e.type === 'brute' || e.type === 'minotaur' ? 3.6 : 3, left: wind });
      if (num('_fuse') !== undefined) out.push({ key: `${e.id}:fuse`, at: q, reach: 4.2, left: num('_fuse')! });
      if (num('_pound') !== undefined) out.push({ key: `${e.id}:pound`, at: q, reach: 5.8, left: num('_pound')!, jump: true });
      if (num('_paw') !== undefined && typeof d._dir === 'number') out.push({ key: `${e.id}:charge`, at: q, reach: 0, left: num('_paw')!, line: { dir: d._dir as number, length: 20, width: 2.2 } });
      // A boss's chain whirled at a fighter: roll as it's cast.
      const s = bossOf(e);
      if (s) {
        const seen = moveSeen.get(e.id);
        if (!s.move || s.step !== 'windup') moveSeen.delete(e.id);
        else if (!seen || seen.move !== s.move.name) moveSeen.set(e.id, { move: s.move.name, at: now });
        if (s.move?.name === 'chain' && s.step === 'windup')
          for (const id of (s.mem.chained as string[] | undefined) ?? []) {
            const p = game.players.find((x) => x.id === id);
            if (p) out.push({ key: `${e.id}:chain:${moveSeen.get(e.id)!.at.toFixed(2)}:${id}`, at: q, reach: 0, left: s.t + 0.25, only: p });
          }
      }
    }
    for (const r of rings) if (!r.harmless && r.until > now) out.push({ key: `ring:${r.at.x.toFixed(1)}:${r.at.z.toFixed(1)}`, at: r.at, reach: r.radius + 0.6, left: r.until - now });
    for (const [k, m] of marks) if (m.until > now) out.push({ key: k, at: m.at, reach: 3, left: m.until - now });
    for (const t of tells) {
      if (t.until <= now) continue;
      const m = t.m;
      if (m.k !== 'ring' && m.k !== 'sweep' && m.k !== 'lane') continue;
      const at = { x: m.at[0], y: m.at[1], z: m.at[2] };
      if (m.k === 'ring') out.push({ key: t.key, at, reach: m.r + 0.6, left: t.until - now, jump: t.jump });
      else if (m.k === 'sweep') out.push({ key: t.key, at, reach: m.r + 0.6, left: t.until - now, arc: [m.a0, m.a1], jump: t.jump });
      else out.push({ key: t.key, at, reach: 0, left: t.until - now, seg: { to: { x: m.to[0], y: m.to[1], z: m.to[2] }, width: m.w / 2 + 0.6 } });
    }
    for (const [id, pl] of pools) if (pl.until > now) out.push({ key: `pool:${id}`, at: pl.at, reach: pl.r + 0.5, left: 99, lasting: true });
    // The soonest first.
    return out.sort((a, b) => a.left - b.left);
  }
  /** Ground to keep off: a boss's pools; lava and frost (the map's). */
  /** In a boss's pool. */
  function inPool(q: Vec3): boolean {
    const now = game.clock.now;
    for (const pl of pools.values()) if (pl.until > now && flat(q, pl.at) < pl.r + 0.4 && Math.abs(q.y - pl.at.y) < 2) return true;
    return false;
  }
  /** Standing in the map's lava or frost, feet at `q` (as the maps' hazards judge it: a bridge over the river is no hazard). */
  function inHazard(q: Vec3, pad = 0): boolean {
    for (const h of map().hazards ?? []) for (const b of h.zone) if (inBox(b, { x: q.x, y: q.y + 0.3, z: q.z }, pad)) return true;
    return false;
  }
  // The ground it can walk (what a person sees at a glance: a way round a headstone, up a step,
  // not over a tomb): each column's floor nearest the map's own (blocks a body fits over), on a
  // grid over the map; lava and frost left out. A path over it, A* (a step up of a block at most).
  // (Made once the map's ground has loaded round the fighters: the first time it's wanted, until then remade.)
  let navMade: { x0: number; z0: number; n: number; h: Float32Array; bad: Uint8Array } | null = null;
  const makeNav = () => {
    const m = map();
    // (Out past the floor to the gates' pens too: a fighter who follows a monster in must find the way out.)
    const R = Math.ceil(m.radius + 14);
    const x0 = Math.floor(m.center.x) - R, z0 = Math.floor(m.center.z) - R, n = 2 * R + 1;
    const h = new Float32Array(n * n).fill(NaN);
    /** Lava, frost, water: never walked into. */
    const bad = new Uint8Array(n * n);
    const base = m.center.y;
    for (let i = 0; i < n; i++)
      for (let j = 0; j < n; j++) {
        const x = x0 + i, z = z0 + j;
        let best = NaN;
        for (let y = Math.floor(base) - 5; y <= Math.floor(base) + 8; y++) {
          const below = game.world.collisionHeight(x, y - 1, z);
          if (below <= 0 || below > 1) continue;
          const top = y - 1 + below;
          // (Blocks only: a portcullis down now may be up when it matters.)
          if (game.world.collisionHeight(x, y, z) > 0 || game.world.collisionHeight(x, y + 1, z) > 0) continue;
          if (Number.isNaN(best) || Math.abs(top - base) < Math.abs(best - base)) best = top;
        }
        if (!Number.isNaN(best) && (inHazard({ x: x + 0.5, y: best, z: z + 0.5 }) || liquid({ x: x + 0.5, y: best + 0.1, z: z + 0.5 }))) {
          best = NaN;
          bad[i * n + j] = 1;
        }
        h[i * n + j] = best;
      }
    if (process.env.DEBUG) {
      let rows = '';
      for (let j = 0; j < n; j++) {
        let row = '';
        for (let i = 0; i < n; i++) {
          const v = h[i * n + j];
          row += Number.isNaN(v) ? '#' : v - base > 0.6 ? String(Math.min(9, Math.round(v - base))) : v - base < -0.6 ? '_' : '.';
        }
        rows += row + '\n';
      }
      console.log(rows);
    }
    return { x0, z0, n, h, bad };
  };
  const navGrid = () => {
    if (navMade) return navMade;
    const g = makeNav();
    let open = 0;
    for (const v of g.h) if (!Number.isNaN(v)) open++;
    if (open > g.h.length * 0.2) navMade = g;
    return g;
  };
  const cellOf = (q: Vec3) => {
    const nav = navGrid();
    const i = Math.floor(q.x) - nav.x0, j = Math.floor(q.z) - nav.z0;
    return i < 0 || j < 0 || i >= nav.n || j >= nav.n ? -1 : i * nav.n + j;
  };
  /** Whether a body steps from cell a to neighbouring cell b (up a block at most, down a few). */
  const step = (a: number, b: number) => {
    const nav = navGrid();
    const ha = nav.h[a], hb = nav.h[b];
    return !Number.isNaN(hb) && hb - ha <= 1.05 && ha - hb <= 4;
  };
  const NB = [[1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1], [1, 1, 1.414], [1, -1, 1.414], [-1, 1, 1.414], [-1, -1, 1.414]];
  /** A path of cells from `from` to `to` (or to as near to it as it can get), A*. */
  function findPath(from: number, to: number): number[] {
    const n = navGrid().n;
    const N = n * n;
    const g = new Float32Array(N).fill(Infinity);
    const prev = new Int32Array(N).fill(-1);
    const shut = new Uint8Array(N);
    const ti = Math.floor(to / n), tj = to % n;
    const hOf = (c: number) => Math.hypot(Math.floor(c / n) - ti, (c % n) - tj);
    const open: [number, number][] = [[hOf(from), from]];
    g[from] = 0;
    let best = from;
    let bestH = hOf(from);
    let steps = 0;
    while (open.length && steps++ < 6000) {
      // (A small grid: a sorted pop is quick enough.)
      let k = 0;
      for (let i = 1; i < open.length; i++) if (open[i][0] < open[k][0]) k = i;
      const [, c] = open[k];
      open[k] = open[open.length - 1];
      open.pop();
      if (shut[c]) continue;
      shut[c] = 1;
      const hc = hOf(c);
      if (hc < bestH) [best, bestH] = [c, hc];
      if (c === to) break;
      const ci = Math.floor(c / n), cj = c % n;
      for (const [di, dj, w] of NB) {
        const i = ci + di, j = cj + dj;
        if (i < 0 || j < 0 || i >= n || j >= n) continue;
        const d = i * n + j;
        if (shut[d] || !step(c, d)) continue;
        // (Cutting a corner only where both sides are open.)
        if (di && dj && (!step(c, ci * n + j) || !step(c, i * n + cj))) continue;
        const ng = g[c] + w;
        if (ng < g[d]) {
          g[d] = ng;
          prev[d] = c;
          open.push([ng + hOf(d), d]);
        }
      }
    }
    const path: number[] = [];
    for (let c = best; c !== -1; c = prev[c]) path.push(c);
    return path.reverse();
  }
  /** Straight from cell a to cell b over walkable ground (a line of cells, each a step from the last). */
  function straight(a: number, b: number): boolean {
    const n = navGrid().n;
    const ai = Math.floor(a / n) + 0.5, aj = (a % n) + 0.5, bi = Math.floor(b / n) + 0.5, bj = (b % n) + 0.5;
    const len = Math.hypot(bi - ai, bj - aj);
    let last = a;
    for (let t = 0.35; t < len; t += 0.35) {
      const c = Math.floor(ai + ((bi - ai) * t) / len) * n + Math.floor(aj + ((bj - aj) * t) / len);
      if (c !== last && !step(last, c)) return false;
      // (A body's width: the cells either side of the line too.)
      last = c;
    }
    return true;
  }
  /** Which way to walk toward `goal` round what's in the way (and whether to hop up a step): a path, re-found every so often. */
  function route(f: Fighter, goal: Vec3): { dx: number; dz: number; hop: boolean } {
    const me = f.p.position;
    const nav = navGrid();
    const direct = { dx: goal.x - me.x, dz: goal.z - me.z, hop: false };
    const a = cellOf(me), b = cellOf(goal);
    if (a < 0 || b < 0 || Number.isNaN(nav.h[a])) return direct;
    const now = game.clock.now;
    if (!f.path || now > f.pathAt + 0.4 || f.pathGoal !== b) {
      f.path = a === b || straight(a, b) ? [a, b] : findPath(a, b);
      f.pathAt = now;
      f.pathGoal = b;
    }
    const path = f.path;
    // Where it is on the path, then the furthest cell ahead it can walk straight to.
    let at = path.indexOf(a);
    if (at < 0) {
      f.path = null;
      return direct;
    }
    let to = Math.min(at + 1, path.length - 1);
    for (let k = Math.min(path.length - 1, at + 8); k > at + 1; k--)
      if (straight(a, path[k])) {
        to = k;
        break;
      }
    const c = path[to];
    const n = nav.n;
    const way = c === b ? direct : { dx: nav.x0 + Math.floor(c / n) + 0.5 - me.x, dz: nav.z0 + (c % n) + 0.5 - me.z, hop: false };
    // Up a step (out of an open grave, onto a dais): hop as it walks into it.
    const l = Math.hypot(way.dx, way.dz) || 1;
    const ahead = cellOf({ x: me.x + (way.dx / l) * 0.8, y: me.y, z: me.z + (way.dz / l) * 0.8 });
    way.hop = ahead >= 0 && nav.h[ahead] - me.y > 0.4;
    return way;
  }

  /** Lava or water where a body's feet are. */
  const liquid = (q: Vec3) => !!game.world.blockInfo(game.world.getBlock(Math.floor(q.x), Math.floor(q.y), Math.floor(q.z)))?.liquid;
  /** Over lava, frost or water (a cell of it), or in it (not a boss's pool: that's walked out of like any tell). */
  const wet = (q: Vec3) => {
    const c = cellOf(q);
    return c >= 0 && navGrid().bad[c] === 1;
  };
  function hazardAt(q: Vec3): boolean {
    return inHazard(q, 0.2) || wet(q) || liquid({ x: q.x, y: q.y - 0.3, z: q.z }) || liquid(q);
  }
  /** The nearest walkable ground (a cell's middle) within a few blocks. */
  function nearestGround(q: Vec3): Vec3 | null {
    const nav = navGrid();
    const ci = Math.floor(q.x) - nav.x0, cj = Math.floor(q.z) - nav.z0;
    let best: Vec3 | null = null;
    let bestD = Infinity;
    for (let di = -6; di <= 6; di++)
      for (let dj = -6; dj <= 6; dj++) {
        const i = ci + di, j = cj + dj;
        if (i < 0 || j < 0 || i >= nav.n || j >= nav.n || Number.isNaN(nav.h[i * nav.n + j])) continue;
        const p = { x: nav.x0 + i + 0.5, y: nav.h[i * nav.n + j], z: nav.z0 + j + 0.5 };
        const d = flat(p, q);
        if (d < bestD) [best, bestD] = [p, d];
      }
    return best;
  }
  /** The way (dx, dz) turned aside as little as it needs to keep off bad ground a step or two ahead. */
  function steer(me: Vec3, dx: number, dz: number): [number, number] {
    const l = Math.hypot(dx, dz);
    if (l < 0.01) return [dx, dz];
    const ux = dx / l, uz = dz / l;
    const clear = (a: number) => {
      const c = Math.cos(a), s = Math.sin(a);
      const vx = ux * c - uz * s, vz = ux * s + uz * c;
      // (Close by, and tight to it: a way between the river and a pocket is a way.)
      return [0.6, 1.2].every((k) => {
        const q = { x: me.x + vx * k, y: me.y, z: me.z + vz * k };
        return !inPool(q) && !wet(q);
      })
        ? [vx, vz]
        : null;
    };
    for (const a of [0, 0.6, -0.6, 1.2, -1.2, 1.8, -1.8, Math.PI]) {
      const v = clear(a);
      if (v) return v as [number, number];
    }
    return [dx, dz];
  }
  /** Whether a fighter at `q` is in a threat's way. */
  const inWay = (t: Threat, q: Vec3, p?: Player) => {
    if (t.only && p && t.only !== p) return false;
    if (t.only && !t.line && !t.seg && !t.reach) return true;
    if (t.seg) {
      const sx = t.seg.to.x - t.at.x, sz = t.seg.to.z - t.at.z;
      const len = Math.hypot(sx, sz) || 1;
      const dx = q.x - t.at.x, dz = q.z - t.at.z;
      const along = (dx * sx + dz * sz) / len;
      const across = Math.abs(dx * sz - dz * sx) / len;
      return along > -1 && along < len + 1 && across < t.seg.width;
    }
    if (t.arc && flat(q, t.at) > 1.2) {
      let a = Math.atan2(q.z - t.at.z, q.x - t.at.x) - t.arc[0];
      a = ((a % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
      if (a > t.arc[1] - t.arc[0] + 0.15) return false;
    }
    if (t.line) {
      const dx = q.x - t.at.x, dz = q.z - t.at.z;
      const along = dx * Math.sin(t.line.dir) + dz * Math.cos(t.line.dir);
      const across = Math.abs(dx * Math.cos(t.line.dir) - dz * Math.sin(t.line.dir));
      return along > -1 && along < t.line.length && across < t.line.width;
    }
    return flat(q, t.at) < t.reach && Math.abs(q.y - t.at.y) < 2.5;
  };
  /** Which way out of a threat (a unit vector on the ground). */
  const away = (t: Threat, q: Vec3): [number, number] => {
    if (t.seg || (t.only && !t.reach)) {
      // Sideways off the lane (or across the chain's throw), toward whichever side it's nearer.
      const to = t.seg?.to ?? q;
      const sx = to.x - t.at.x, sz = to.z - t.at.z;
      const len = Math.hypot(sx, sz) || 1;
      const side = (q.x - t.at.x) * sz - (q.z - t.at.z) * sx >= 0 ? 1 : -1;
      return [(sz / len) * side, (-sx / len) * side];
    }
    if (t.line) {
      // Sideways off the line, toward whichever side it's nearer.
      const dx = q.x - t.at.x, dz = q.z - t.at.z;
      const side = dx * Math.cos(t.line.dir) - dz * Math.sin(t.line.dir) >= 0 ? 1 : -1;
      return [Math.cos(t.line.dir) * side, -Math.sin(t.line.dir) * side];
    }
    const dx = q.x - t.at.x, dz = q.z - t.at.z;
    const l = Math.hypot(dx, dz) || 1;
    return [dx / l, dz / l];
  };

  /** Keys for moving the way (dx, dz) with the view at `yaw` (yaw 0 looks toward -z). */
  function keysFor(dx: number, dz: number, yaw: number): string[] {
    const l = Math.hypot(dx, dz);
    if (l < 0.01) return [];
    const fx = -Math.sin(yaw), fz = -Math.cos(yaw);
    const rx = Math.cos(yaw), rz = -Math.sin(yaw);
    const f = (dx * fx + dz * fz) / l, r = (dx * rx + dz * rz) / l;
    const out: string[] = [];
    if (f > 0.38) out.push('KeyW');
    if (f < -0.38) out.push('KeyS');
    if (r > 0.38) out.push('KeyD');
    if (r < -0.38) out.push('KeyA');
    return out;
  }

  /** The bot's controls for one fighter this step. */
  function pilot(f: Fighter, dt: number): Partial<PlayerInput> {
    const p = f.p;
    const now = game.clock.now;
    const me = p.position;
    const eye = p.eye;
    const inv = p.inventory;
    const has = (item: string) => inv.count(item) > 0;
    const slotOf = (pred: (item: string) => boolean) => inv.slots.findIndex((s) => !!s && pred(s.item));
    const down: string[] = [];
    const pressed: string[] = [];
    let buttons = 0;
    let yaw = p.yaw;
    let pitch = 0;
    const look = (q: Vec3, h = 1.2) => {
      yaw = Math.atan2(-(q.x - eye.x), -(q.z - eye.z));
      pitch = Math.atan2(q.y + h - eye.y, Math.hypot(q.x - eye.x, q.z - eye.z));
    };
    /** The controls as they go out: the view turned toward where it wants to look (as fast as a person can), moving the way it wants. */
    const finish = (mx: number, mz: number): Partial<PlayerInput> => {
      let outYaw = yaw;
      let outPitch = pitch;
      if (SKILL.turn < Infinity) {
        const max = SKILL.turn * dt;
        const dy = Math.atan2(Math.sin(yaw - f.aimYaw), Math.cos(yaw - f.aimYaw));
        f.aimYaw += Math.max(-max, Math.min(max, dy));
        f.aimPitch += Math.max(-max, Math.min(max, pitch - f.aimPitch));
        const AIM = SKILL.aim;
        f.aimErr = [Math.max(-AIM, Math.min(AIM, f.aimErr[0] + (rand() - 0.5) * AIM * 0.4)), Math.max(-AIM, Math.min(AIM, f.aimErr[1] + (rand() - 0.5) * AIM * 0.3))];
        outYaw = f.aimYaw + f.aimErr[0];
        outPitch = f.aimPitch + f.aimErr[1];
      } else [f.aimYaw, f.aimPitch] = [yaw, pitch];
      down.push(...keysFor(mx, mz, outYaw));
      unstick(f, down, pressed, dt);
      // (A jump is Space held: the platform's walk reads it down, not pressed.)
      if (pressed.includes('Space')) down.push('Space');
      return { down, pressed, yaw: outYaw, pitch: outPitch, buttons };
    };
    f.bombCd = Math.max(0, f.bombCd - dt);
    f.potionCd = Math.max(0, f.potionCd - dt);
    if (!p.alive || p.frozen || state.phase === 'countdown') return { yaw: f.aimYaw, pitch: f.aimPitch };

    // Between waves: the blessing, the reward on the dais, the shop, then ready.
    if (state.phase === 'intermission') {
      if (f.blessMenu) {
        const pick = [...f.blessMenu.entries].sort((a, b) => score(f, b.label) - score(f, a.label))[0];
        if (pick) host.command(f.id, { t: 'message', msg: { t: 'callback', player: p.id, id: pick.cb } });
        f.blessMenu = null;
      }
      // The shop first (its time is short), then the reward on the dais (given up on if it can't
      // be reached in a few seconds), then ready.
      const c = map().center;
      const loot = sim.items.frame().filter((x) => flat(x, c) < 4 && x.item !== 'coin' && x.item !== 'coin_pile' && !f.skip.has(`${x.x.toFixed(1)},${x.z.toFixed(1)}`));
      let goal: Vec3 | null = null;
      const m = shopOpen() ? game.entities.all('merchant')[0] : undefined;
      if (!f.shopped && m) {
        if (flat(m.position, me) < 2.8) {
          shop(f);
          f.shopped = true;
        } else goal = m.position;
      } else if (loot.length) {
        const l = loot.sort((a, b) => flat(a, me) - flat(b, me))[0];
        const key = `${l.x.toFixed(1)},${l.z.toFixed(1)}`;
        if (f.lootKey !== key) {
          f.lootKey = key;
          f.lootSince = now;
        }
        if (now - f.lootSince > 4) f.skip.add(key);
        goal = { x: l.x, y: l.y, z: l.z };
      } else if (!f.readyAt) {
        f.readyAt = now;
        pressed.push('KeyN');
      }
      if (process.env.DEBUG && Math.floor(now) !== Math.floor(now - 1 / 30)) console.log(`    [${now.toFixed(0)}] ${f.name} at ${me.x.toFixed(1)},${me.z.toFixed(1)} loot ${loot.map((l) => l.item).join(',')} shop ${shopOpen()} merchants ${game.entities.all('merchant').length} goal ${goal ? `${goal.x.toFixed(1)},${goal.z.toFixed(1)}` : '-'} gold ${gold(p)} bought ${f.bought.join(',')}`);
      if (goal) look(goal, 0);
      if (!goal) return finish(0, 0);
      const r = route(f, goal);
      if (r.hop && p.onGround) pressed.push('Space');
      return finish(r.dx, r.dz);
    }
    if (state.phase !== 'fighting') return { yaw: f.aimYaw, pitch: f.aimPitch };
    f.shopped = false;
    f.readyAt = 0;
    f.skip.clear();
    const downedNow = isDowned(p);

    // Hurt: a potion (not while down, nor drinking).
    if (!downedNow && p.health < p.maxHealth * SKILL.drink && has('health_potion') && f.potionCd === 0) {
      pressed.push('KeyR');
      f.potionCd = 1.2;
      f.quaff = now + 0.95;
      const w = cur();
      if (w) w.potions++;
    }

    const all = monsters();
    // Knocked into lava (or the frozen pool): swim up and out to the nearest bank, now (sprinting:
    // swimming at the bank with Space alone leaves a body just short of its top).
    if (!downedNow && hazardAt(me)) {
      const out = nearestGround(me);
      if (out) {
        look(out, 0);
        down.push('Space', 'ControlLeft');
        return finish(out.x - me.x, out.z - me.z);
      }
    }
    // A friend down nearby: get them up (if it's not too hot about them).
    const friend = fighters.find((o) => o !== f && o.p.alive && isDowned(o.p));
    if (friend && !downedNow) {
      const q = friend.p.position;
      const hot = all.filter((e) => flat(e.position, q) < 3.5).length;
      if (hot <= 2) {
        look(q, 0.3);
        if (flat(q, me) > 1.6) {
          const r = route(f, q);
          if (r.hop && p.onGround) pressed.push('Space');
          return finish(r.dx, r.dz);
        }
        down.push('KeyE');
        return finish(0, 0);
      }
    }

    // What's coming that it can see: dodge the first it's in the way of, once it's had time to react.
    let dodge: [number, number] | null = null;
    let dodgeNow = false;
    let jumpNow = false;
    for (const t of threats()) {
      if (!inWay(t, me, p)) continue;
      const first = f.seen.get(t.key) ?? now;
      f.seen.set(t.key, first);
      if (!t.lasting && !noticed(f, t, me)) continue;
      if (now - first < f.react) continue;
      dodge = away(t, me);
      // (Out of a pool on foot: nothing's about to land.)
      if (t.lasting) break;
      // Roll (or jump a ground slam) as it's about to land: rolling is untouchable for a moment
      // (timed as well as a person times it).
      let when = f.when.get(t.key);
      if (when === undefined) f.when.set(t.key, (when = 0.28 + (rand() * 2 - 1) * SKILL.roll));
      if (t.left < when) {
        if (t.jump && rand() < 0.5) jumpNow = true;
        else dodgeNow = true;
      }
      break;
    }

    // Who to fight: one at its rite or draining, then the nearest (a ranged class prefers those at range).
    const ranged = f.cls === 'pyromancer' || f.cls === 'hunter';
    const priority = (e: Entity) => {
      const d = e.distanceTo(p);
      const da = e.data as Record<string, unknown>;
      let s = d;
      // A boss nothing lands on (coming in, roaring, shielded, beaten) is left be; its wards and
      // eggs come first.
      const b = bossOf(e);
      if (b && (b.held || b.transition > 0 || b.shield || b.dying)) s += 60;
      if (e.type === 'phylactery') s -= 14;
      // Not into the gates' pens after them while there's anything on the floor (more come in there).
      if (flat(e.position, map().center) > map().radius + 1) s += 30;
      if (e.type === 'egg_sac') s -= 6;
      if (da._rite !== undefined) s -= 12;
      if (da._drain !== undefined || da._chant !== undefined) s -= 8;
      if (e.type === 'cultist' || e.type === 'necromancer') s -= 4;
      if (e.type === 'goblin') s -= 3;
      if (e.type === 'sapper' && da._fuse === undefined && !ranged) s += 3;
      return s;
    };
    const target = all.length ? [...all].sort((a, b) => priority(a) - priority(b))[0] : null;
    /** Half its girth: a boss is reached at its side, not its middle. */
    const half = target ? (bossKind(target.type) ? bossWidth(target.type) / 2 : target.type === 'egg_sac' ? 0.55 : 0.4) : 0;
    const tb = target && bossOf(target);

    // Weapons: the class's melee by default, the bow or staff at range.
    const melee = slotOf((it) => game.items.get(it)?.kind === 'melee');
    const bow = slotOf((it) => baseOf(it) === 'bow' || baseOf(it) === 'crossbow');
    const staff = slotOf((it) => game.items.get(it)?.kind === 'staff');
    let want = melee;
    let range = 2.4 + half;
    if (target) {
      const d = target.distanceTo(p);
      if (staff >= 0) {
        want = staff;
        range = 9 + half;
      } else if (bow >= 0 && has('arrow') && d > 6 + half) {
        want = bow;
        range = 14 + half;
      }
    }
    // (Not while it drinks: switching away spills the potion.)
    if (want >= 0 && inv.selected !== want && now > f.quaff) inv.select(want);
    const holding = inv.slots[inv.selected]?.item ?? '';
    const kind = game.items.get(holding)?.kind;

    /** A bomb thrown this step: the view stays on its lob. */
    let lobbed = false;
    // A bomb at a boss's feet as it winds up or stands spent (it staggers, open to more).
    if (tb && !tb.shield && !tb.held && !tb.dying && (tb.step === 'windup' || tb.step === 'recover') && f.bombCd === 0 && has('bomb') && !downedNow) {
      const d = flat(target!.position, me);
      if (d > 3.5 + half && d < 11 + half && rand() < SKILL.bombs) {
        look(target!.position, 0);
        pitch = Math.min(0.6, 0.05 + (d - 4) * 0.03);
        pressed.push('KeyG');
        lobbed = true;
        const w = cur();
        if (w) w.bombs++;
      }
      f.bombCd = 5;
    }
    // A bomb into a knot of them.
    if (target && f.bombCd === 0 && has('bomb') && !downedNow) {
      const knot = all.filter((e) => flat(e.position, target.position) < 3).length;
      const d = flat(target.position, me);
      // (A fair player misses some chances: then it's a while before it thinks of it again.)
      if (knot >= 3 && d > 3.5 && d < 11 && rand() >= SKILL.bombs) f.bombCd = 2;
      else if (knot >= 3 && d > 3.5 && d < 11) {
        look(target.position, 0);
        pitch = Math.min(0.6, 0.05 + (d - 4) * 0.03);
        pressed.push('KeyG');
        lobbed = true;
        f.bombCd = 2.5;
        const w = cur();
        if (w) w.bombs++;
      }
    }

    // Moving: out of what's coming; else to the target, keeping the weapon's distance, strafing.
    let mx = 0;
    let mz = 0;
    f.strafeFlip -= dt;
    if (f.strafeFlip <= 0) {
      f.strafe = rand() < 0.5 ? 1 : -1;
      f.strafeFlip = 1 + rand() * 2;
    }
    if (target) {
      const q = target.position;
      const big = bossKind(target.type)?.height;
      if (!lobbed) look(q, big ? Math.min(2.4, big * 0.4) : target.type === 'spider' || target.type.startsWith('slime') || target.type === 'spiderling' ? 0.4 : target.type === 'bat' ? 0.3 : target.type === 'golem' ? 2 : 1.2);
      const d = flat(q, me);
      const dx = (q.x - me.x) / (d || 1), dz = (q.z - me.z) / (d || 1);
      // One still in a gate's pen: wait for it at the floor's edge (more come in there), unless it's
      // been there a good while (stuck: then go in and get it), or it shoots from there.
      const c = map().center;
      const out = flat(q, c) - (map().radius + 1);
      if (out > 0) outSince.set(target.id, outSince.get(target.id) ?? now);
      else outSince.delete(target.id);
      const wait = out > 0 && !SHOOTERS.has(target.type) && now - outSince.get(target.id)! < 25;
      const goal = wait ? { x: c.x + ((q.x - c.x) * (map().radius - 3)) / (out + map().radius + 1), y: q.y, z: c.z + ((q.z - c.z) * (map().radius - 3)) / (out + map().radius + 1) } : q;
      if (wait && flat(goal, me) > 1.5) {
        const r = route(f, goal);
        [mx, mz] = [r.dx, r.dz];
        if (r.hop && p.onGround) pressed.push('Space');
      } else if (!wait && d > range) {
        const r = route(f, q);
        [mx, mz] = [r.dx, r.dz];
        if (r.hop && p.onGround) pressed.push('Space');
        const l = Math.hypot(mx, mz) || 1;
        [mx, mz] = [mx / l, mz / l];
      }
      else if (d < range * 0.6 && kind !== 'melee') [mx, mz] = [-dx, -dz];
      // Sideways a little either way, so arrows and fire miss.
      mx += -dz * f.strafe * 0.45;
      mz += dx * f.strafe * 0.45;
      // Attack: blades held; the bow drawn and loosed; the staff held.
      const inReach = kind === 'melee' ? d - half < 3 && Math.abs(q.y - me.y) < 2.5 : d < range + 2;
      if (inReach && !downedNow) {
        if (kind === 'bow' || kind === 'gun') {
          f.bowDraw += dt;
          if (f.bowDraw < 0.95) buttons |= 1;
          else f.bowDraw = 0;
        } else buttons |= 1;
      }
      // The gladius's guard against a blow it sees coming at it from in front.
      if (f.cls === 'gladiator' && kind === 'melee' && game.items.get(holding)?.name?.startsWith('Gladius')) {
        const blow = threats().find((t) => !t.line && !t.seg && !t.lasting && !t.jump && t.reach <= 4 && t.reach > 0 && inWay(t, me, p) && t.left < 0.35 && now - (f.seen.get(t.key) ?? now) >= f.react && noticed(f, t, me));
        if (blow && (f.guardRoll.get(blow.key) ?? (f.guardRoll.set(blow.key, rand() < SKILL.guard), f.guardRoll.get(blow.key)))) {
          buttons = 4;
          dodge = null;
          dodgeNow = false;
        }
      }
    } else {
      // Nothing to fight yet: the middle.
      const c = map().center;
      if (flat(c, me) > 3) {
        const r = route(f, c);
        [mx, mz] = [r.dx, r.dz];
        if (r.hop && p.onGround) pressed.push('Space');
      }
    }
    if (process.env.DEBUG && Math.floor(now / 2) !== Math.floor((now - dt) / 2) && target) {
      const q = target.position;
      console.log(`    [${now.toFixed(0)}] w${state.wave} ${f.name} at ${me.x.toFixed(1)},${me.y.toFixed(1)},${me.z.toFixed(1)} hp ${p.health.toFixed(0)} -> ${target.type} at ${q.x.toFixed(1)},${q.y.toFixed(1)},${q.z.toFixed(1)} d ${flat(q, me).toFixed(1)} path ${f.path?.length ?? '-'} cell ${(() => { const c = cellOf(me); const n = navGrid().n; return c < 0 ? '-' : [0, 1, -1, n, -n].map((k) => navGrid().h[c + k]).join('/'); })()} pressed ${pressed.join('+')} ground ${p.onGround} move ${mx.toFixed(2)},${mz.toFixed(2)} left ${all.length}${now - (cur()?.start ?? now) > 240 ? ` data ${JSON.stringify(target.data, (_k, v) => (typeof v === 'number' ? Math.round(v * 10) / 10 : v)).slice(0, 300)} sees ${target.canSee(p)} los ${game.world.lineOfSight(eye, { x: q.x, y: q.y + 1, z: q.z })}` : ''}`);
    }
    if (dodge) [mx, mz] = dodge;
    // Round lava, frost and pools; sidestepping a while once it's stuck on something.
    [mx, mz] = steer(me, mx, mz);
    if (f.side > 0) {
      f.side -= dt;
      [mx, mz] = [mx * 0.3 - mz * f.sideDir, mz * 0.3 + mx * f.sideDir];
    }
    if (dodgeNow && !downedNow && (p.abilities.roll as { cool?: number } | undefined)?.cool === 0) pressed.push('KeyQ');
    if (jumpNow) pressed.push('Space');
    return finish(mx, mz);
  }

  /** Whether it noticed a tell (decided once, when it first shows): most in front of it, fewer behind. */
  function noticed(f: Fighter, t: Threat, me: Vec3): boolean {
    const NOTICE = SKILL.notice;
    let n = f.noticed.get(t.key);
    if (n === undefined) {
      const toward = Math.atan2(-(t.at.x - me.x), -(t.at.z - me.z));
      const off = Math.abs(Math.atan2(Math.sin(toward - f.aimYaw), Math.cos(toward - f.aimYaw)));
      n = t.line || t.reach > 5 ? rand() < NOTICE.front : rand() < (off < 1.2 ? NOTICE.front : NOTICE.behind);
      f.noticed.set(t.key, n);
    }
    return n;
  }

  /** Walking into a wall: hop. */
  function unstick(f: Fighter, down: string[], pressed: string[], dt: number) {
    const q = f.p.position;
    const moved = flat(q, f.lastPos);
    f.lastPos = { ...q };
    if (down.length && moved < 0.02) f.stuck += dt;
    else f.stuck = 0;
    if (f.stuck > 0.3) {
      pressed.push('Space');
      f.stuck = 0;
      // Stuck again soon after: round it, one way or the other, for a moment.
      if (game.clock.now - f.hopAt < 1.2) {
        f.side = 0.9;
        f.sideDir = rand() < 0.5 ? 1 : -1;
      }
      f.hopAt = game.clock.now;
    }
  }

  /** A blessing's worth to this bot, by its label in the menu (its name, maybe with a number). */
  function score(f: Fighter, label: string): number {
    const id = (Object.keys(BLESSINGS) as BlessingId[]).find((k) => label.startsWith(BLESSINGS[k].name));
    if (!id) return 0;
    return PREFER_CLASS[f.cls][id] ?? PREFER[id] ?? 4;
  }

  /** At the merchant's: what a sensible fighter buys with what it has, in order. */
  function shop(f: Fighter) {
    const p = f.p;
    const buy = (id: string) => {
      if (purchase(game, p, id)) f.bought.push(id);
    };
    const potions = () => p.inventory.count('health_potion');
    const cleared = state.wave;
    // A potion in hand first.
    if (potions() < 1) buy('health_potion');
    // Armour: the best it can afford that's on sale and better than what it wears.
    for (const a of ['plate_armor', 'mail_armor', 'leather_armor'] as ArmorId[]) {
      const w = WARES.find((x) => x.item === a)!;
      if ((w.from ?? 0) <= cleared && armorOf(p) < ARMOR[a].points && gold(p) >= w.price + 40) {
        buy(a);
        break;
      }
    }
    // The forge: its main weapon up a rarity.
    const main = p.inventory.slots.find((s) => s && baseOf(s.item) === MAIN[f.cls])?.item;
    const next = main && forgeNext(main);
    if (next && gold(p) >= next.price + 20) buy(`forge:${main}`);
    // More potions, up to three; bombs; a feather once it's rich (alone).
    while (potions() < 3 && gold(p) >= 40 + 60) {
      const before = potions();
      buy('health_potion');
      if (potions() === before) break;
    }
    if (p.inventory.count('bomb') < 4 && gold(p) >= 30 + 80) buy('bomb');
    if (f.cls === 'hunter' && p.inventory.count('arrow') < 24 && gold(p) >= 15) buy('arrow');
    if (fighters.length === 1 && p.inventory.count('phoenix_feather') === 0 && gold(p) >= FEATHER_PRICE + 150) buy('phoenix_feather');
  }

  // The run: step by step, each fighter's controls twice a step (as a screen sends them).
  const viewSeq = (p: Player) => sim.players.find((q) => q.api.id === p.id)?.viewSeq ?? -1;
  const dt = 1 / 30;
  let t = 0;
  let chosen = false;
  while (t < MAX_TIME) {
    if (state.phase === 'countdown' && !chosen) {
      chosen = true;
      for (const f of fighters) choose(game, f.p, f.cls);
    }
    for (const f of fighters) {
      const input = pilot(f, dt);
      for (let j = 0; j < 2; j++) {
        f.seq++;
        host.command(f.id, { t: 'input', input: { active: true, down: input.down ?? [], pressed: j === 0 ? (input.pressed ?? []) : [], buttons: input.buttons ?? 0, clicked: j === 0 ? (input.buttons ?? 0) : 0, mouseX: 0, mouseY: 0, wheel: 0, yaw: input.yaw ?? 0, pitch: input.pitch ?? 0, viewSeq: viewSeq(f.p) }, seq: f.seq, dt: dt / 2 });
      }
    }
    const out = host.step(dt);
    t += dt;
    const w = cur();
    if (w && state.phase === 'fighting') for (const f of fighters) if (f.p.alive && !isDowned(f.p)) w.low = Math.min(w.low, f.p.health / f.p.maxHealth);
    for (const [id, batch] of out) {
      const f = fighters.find((x) => x.id === id);
      for (const e of batch.events as HostEvent[]) {
        if (e.t !== 'call') continue;
        const call = e.call;
        if (f && call.target === 'hud' && call.method === 'menu' && (call.args[1] as { title?: string })?.title === 'Choose a blessing') {
          const sections = (call.args[1] as { sections: { entries: { label: string; onSelect?: { $cb: number } }[] }[] }).sections;
          f.blessMenu = { id: call.args[0] as number, entries: sections[0].entries.flatMap((x) => (x.onSelect ? [{ label: x.label, cb: x.onSelect.$cb }] : [])) };
        }
        if (id === fighters[0].id && call.target === 'message' && call.method === MARK_MSG) told(call.args[0] as Mark);
        if (id === fighters[0].id && call.target === 'message' && call.method === 'bestiary.ring') {
          const r = call.args[0] as { x: number; y: number; z: number; radius: number; time: number; color: string };
          // (A cultist's rite ring marks where imps will come, not a blow.)
          rings.push({ at: { x: r.x, y: r.y, z: r.z }, radius: r.radius, until: game.clock.now + r.time, harmless: r.color === '#ff2a3a' });
        }
        if (id === fighters[0].id && call.target === 'hud' && call.method === 'marker' && String(call.args[0]).startsWith('arena.strike:')) {
          const at = call.args[1] as Vec3 | null;
          if (at && typeof at === 'object' && 'x' in at) marks.set(String(call.args[0]), { at: { x: at.x, y: at.y, z: at.z }, until: game.clock.now + 1.4 });
          else marks.delete(String(call.args[0]));
        }
      }
    }
    if (state.phase === 'victory' || state.phase === 'defeat') break;
  }
  const won = state.phase === 'victory';
  // Out of time: what was left, and where (a boss's state with it), and where the fighters were.
  const stuck =
    state.phase === 'victory' || state.phase === 'defeat'
      ? ''
      : [
          ...monsters().map((e) => {
            const b = bossOf(e);
            return `${e.type}${where(e.position)}${b ? `[${b.shield ? 'shielded ' : ''}${Math.round((100 * e.health) / e.maxHealth)}%]` : ''}`;
          }),
          ...fighters.map((f) => `${f.name}${where(f.p.position)}`),
        ].join(' ');
  const result = { seed, classes, map: mapId, stuck, won, wave: state.wave, time: t, waves, deaths, earnedBy, kinds, armour: fighters.map((f) => f.p.armor), bought: fighters.map((f) => f.bought), blessings: fighters.map((f) => blessingsOf(f.p)), final: { gold: fighters.map((f) => gold(f.p)), armor: fighters.map((f) => armorOf(f.p)), weapons: fighters.map((f) => f.p.inventory.slots.flatMap((s) => (s && game.items.get(s.item)?.kind !== 'misc' ? [s.item] : [])).join(' ')) } };
  host.dispose?.();
  return result;
}

export default function arenaSim() {
  const which = process.env.RUNS ?? 'all';
  const seeds = Array.from({ length: Number(process.env.SEEDS ?? 3) }, (_, i) => 101 + i * 37);
  const classes = (process.env.CLASSES?.split(',') as ClassId[] | undefined) ?? CLASS_LIST;
  const maps = process.env.MAPS?.split(',') ?? MAPS.map((m) => m.id);
  const runs: ReturnType<typeof simulate>[] = [];
  const t0 = performance.now();
  for (const m of maps)
    for (const cls of classes) {
      for (const seed of seeds) {
        if (which === 'solo' || which === 'all') runs.push(simulate(seed, [cls], m));
        if (which === 'duo' || which === 'all') runs.push(simulate(seed + 1, [cls, cls], m));
      }
    }
  const bosses = ['colossus', 'warden', 'broodmother', 'lich'];
  console.log(`  ${process.env.SKILL ?? 'skilled'}: ${runs.length} runs in ${((performance.now() - t0) / 1000).toFixed(0)} s (final wave ${finalWave()}; bosses in the game: ${bosses.filter((b) => bossKind(b)).join(', ') || 'none'}; stand-ins for ${bosses.filter((b) => !bossKind(b)).join(', ')})`);
  // Across the runs: each kind's average life and what it did to fighters (per one slain).
  const all: Record<string, { n: number; life: number; dealt: number }> = {};
  for (const r of runs) for (const [k, v] of Object.entries(r.kinds)) {
    const a = (all[k] ??= { n: 0, life: 0, dealt: 0 });
    a.n += v.n;
    a.life += v.life;
    a.dealt += v.dealt;
  }
  console.log(`  by kind (slain, average seconds alive, damage to fighters per one): ${Object.entries(all).sort((a, b) => b[1].dealt / Math.max(1, b[1].n) - a[1].dealt / Math.max(1, a[1].n)).map(([k, v]) => `${k} ${v.n} ${(v.life / Math.max(1, v.n)).toFixed(1)}s ${(v.dealt / Math.max(1, v.n)).toFixed(1)}`).join('; ')}`);
  const lost = runs.filter((r) => !r.won);
  console.log(`  won ${runs.length - lost.length} of ${runs.length}; lost at ${lost.map((r) => `${r.map} ${r.classes.length > 1 ? 'duo' : 'solo'} ${r.classes[0]} w${r.wave}`).join(', ') || '-'}`);
  for (const r of runs) {
    const party = r.classes.length > 1 ? `duo ${r.classes[0]}` : `solo ${r.classes[0]}`;
    console.log(`\n  == ${party}, seed ${r.seed}, ${r.map}: ${r.won ? 'VICTORY' : `fell on wave ${r.wave}`} after ${(r.time / 60).toFixed(1)} min; deaths ${r.deaths.map((d) => `w${d.wave} ${d.to} ${d.at}`).join(', ') || 'none'}${r.stuck ? `; out of time with ${r.stuck}` : ''}`);
    console.log(`     gold earned by wave 5/10/15: ${[5, 10, 15].map((n) => r.earnedBy[n] ?? '-').join(' / ')}; bought: ${r.bought.map((b) => b.join(' ')).join(' | ')}`);
    console.log(`     blessings: ${r.blessings.map((b) => b.join(' ')).join(' | ')}; final: ${r.final.weapons.join(' | ')}, armour worn ${r.final.armor.join('/')} (all told ${r.armour.join('/')} points), gold ${r.final.gold.join('/')}`);
    for (const w of r.waves) {
      const top = Object.entries(w.taken).sort((a, b) => b[1] - a[1]).slice(0, 4).map(([k, v]) => `${k} ${v.toFixed(0)}`).join(', ');
      console.log(`     w${String(w.wave).padStart(2)} ${(w.boss ? `[${w.boss}] ` : '') + w.name}${w.twist ? ` · ${w.twist}` : ''}: ${w.end ? `${(w.end - w.start).toFixed(0)} s` : 'lost'}; took ${Object.values(w.taken).reduce((a, b) => a + b, 0).toFixed(0)} of ${w.raw.toFixed(0)} before armour (${top}), lowest ${(w.low * 100).toFixed(0)}%; dealt ${w.dealt.toFixed(0)}${w.bossLife !== undefined ? `, the boss fought ${w.bossLife.toFixed(0)} s` : ''}; downs ${w.downs}, falls ${w.falls}; potions ${w.potions}, rolls ${w.rolls}, bombs ${w.bombs}; gold +${w.earned} -${w.spent}`);
    }
  }
}
