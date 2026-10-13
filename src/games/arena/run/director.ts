import { math, type GameContext, type Vec3 } from '@platform';
import { along } from '../maps';
import { MONSTERS, monsterKind } from '../monsters';
import { BOSSES, bossKind } from '../bosses';
import { bus } from './bus';
import { DIFFICULTY } from './difficulty';
import { eliteTuning } from '../monsters/elites';
import { POTION as POTIONS } from '../items/potions';
import { spawnMonster } from './spawn';
import { map, runs, state } from './state';

/**
 * The director: what each wave brings, its twist, and bringing it in. A wave is a scripted roster
 * (always these), plus a budget it fills from whatever kinds may come by then (`MonsterKind.cost`,
 * `from`, `weight`), plus maybe a boss (`bosses/`) with its escort. The run is `WAVES` (twenty, a
 * boss every fifth); past them the endless waves are made up as they come (`waveSpec`), the budget
 * growing and the bosses coming round again. The server starts waves and calls `tick`; everything
 * else hears of it on the bus.
 */
export interface WaveSpec {
  /** Its name on the banner (a boss wave's is its boss's). */
  name?: string;
  /** Always brings these (types and counts, before party size). */
  roster?: Record<string, number>;
  /** And this much more, filled from the kinds that may come by now (a zombie costs 1). */
  budget?: number;
  /** A boss wave's boss (a `BossKind` id); it comes in first. */
  boss?: string;
  /** Dropped on the dais once it's cleared, one set for each fighter. */
  reward?: { item: string; count?: number }[];
  /** No twist this wave (boss waves never have one). */
  calm?: boolean;
}

const POTION = { item: 'health_potion' };
const bombs = (count: number) => ({ item: 'bomb_bundle', count });
const arrows = (count: number) => ({ item: 'arrow_bundle', count });

/**
 * The run: gentle at first (the dead, then bones and powder), a boss every fifth wave, each third
 * of the run bringing in new kinds (knights, imps, bats and a minotaur after the Colossus; wraiths,
 * slimes, the cult and golems after the Warden; everything at once after the Broodmother), and a
 * finale. A roster names kinds as many as it likes (a kind's `max` holds only for the budget).
 * Kinds that aren't in the game yet are made up from the budget (`compose`).
 */
export const WAVES: WaveSpec[] = [
  { name: 'The Dead Rise', roster: { zombie: 6 }, calm: true, reward: [POTION] },
  { name: 'Rattling Bones', roster: { zombie: 4, skeleton: 3 }, budget: 2, reward: [arrows(2), bombs(1)] },
  { name: 'Powder and Bone', roster: { sapper: 3, zombie: 3, skeleton: 2 }, budget: 3, reward: [POTION, bombs(2)] },
  { name: 'Crawlers', roster: { spider: 6, zombie: 3, sapper: 1 }, budget: 4, reward: [arrows(2), POTION] },
  { boss: 'colossus', name: 'Bone Colossus', roster: { skeleton: 3, zombie: 2 }, reward: [POTION, bombs(2), arrows(2)] },
  { name: 'Dark Rites', roster: { necromancer: 2, zombie: 4, skeleton: 3 }, budget: 7, reward: [POTION, bombs(2)] },
  { name: 'The Iron Line', roster: { knight: 3, skeleton: 3, sapper: 2 }, budget: 6, reward: [arrows(3), POTION] },
  { name: 'Hellfire', roster: { imp: 5, spider: 3, sapper: 2, bat: 1 }, budget: 8, reward: [bombs(3), POTION] },
  { name: 'Horns and Hide', roster: { minotaur: 1, brute: 1, zombie: 6, sapper: 2 }, budget: 8, reward: [POTION, arrows(2)] },
  { boss: 'warden', name: 'The Warden', roster: { skeleton: 2, sapper: 2, knight: 2 }, reward: [{ item: 'health_potion', count: 2 }, bombs(3)] },
  { name: 'Wraiths', roster: { wraith: 3, necromancer: 1, skeleton: 3 }, budget: 20, reward: [POTION, arrows(3)] },
  { name: 'Slime Time', roster: { slime: 3, imp: 3, spider: 3 }, budget: 18, reward: [bombs(3), POTION] },
  { name: 'The Cult', roster: { cultist: 2, knight: 2, zombie: 6 }, budget: 24, reward: [POTION, arrows(3)] },
  { name: 'Stone and Fire', roster: { golem: 1, imp: 4, brute: 1, bat: 1 }, budget: 22, reward: [{ item: 'health_potion', count: 2 }, bombs(2)] },
  { boss: 'broodmother', name: 'The Broodmother', roster: { spider: 5, sapper: 2 }, reward: [{ item: 'health_potion', count: 2 }, bombs(3), arrows(3)] },
  { name: 'The Horde', roster: { zombie: 14, spider: 6, skeleton: 4, sapper: 3 }, budget: 20, reward: [POTION, bombs(3)] },
  { name: 'Night Terrors', roster: { wraith: 3, imp: 4, necromancer: 2, bat: 2 }, budget: 28, reward: [POTION, arrows(3)] },
  { name: 'The Siege', roster: { golem: 2, knight: 4, sapper: 4, minotaur: 1 }, budget: 25, reward: [{ item: 'health_potion', count: 2 }, bombs(3)] },
  { name: 'The Gauntlet', roster: { brute: 2, cultist: 2, wraith: 2, golem: 1, slime: 2, minotaur: 1 }, budget: 31, reward: [{ item: 'health_potion', count: 2 }, bombs(3), arrows(3)] },
  { boss: 'lich', name: 'The Lich King', roster: { skeleton: 4, wraith: 2, necromancer: 1 } },
];

/** The run's last wave: win it and the arena is yours (then the endless waves, for a best). */
export const finalWave = () => WAVES.length;

/** The endless waves' names, in turn. */
const ENDLESS_NAMES = ['No Rest', 'Blood on the Sand', 'They Keep Coming', 'The Long Night', 'Deeper Still', 'Bone Tide', 'The Abyss Stares Back', 'Last Light'];
/** The bosses that come round again every fifth endless wave, in turn. */
const BOSS_ROUND = ['colossus', 'warden', 'broodmother', 'lich'];

/** What wave `n` brings: one of the run's, or (past it) an endless one, its budget growing. */
export function waveSpec(n: number): WaveSpec {
  if (n <= WAVES.length) return WAVES[n - 1];
  const k = n - WAVES.length;
  const reward = [POTION, bombs(2), arrows(2)];
  if (n % 5 === 0) return { boss: BOSS_ROUND[(n / 5 - 1) % BOSS_ROUND.length], roster: { brute: 1, wraith: 2, knight: 2 }, budget: 14 + 3 * k, reward };
  return { name: ENDLESS_NAMES[(k - 1) % ENDLESS_NAMES.length], budget: 56 + 5 * k, reward };
}

/**
 * The boss that comes for `id`: that one, once it's in the game. Until then the finale's is the
 * first there is, and any other boss wave is fought without one, a crowd standing in (`STAND_IN`).
 */
const bossFor = (id: string) => bossKind(id) ?? (id === 'lich' ? BOSSES[0] : undefined);
/** A boss wave without its boss: this much more budget, and a brute. */
const BOSS_STAND_IN = 14;

/** Wave `n`'s name, for banners and the end screen (a boss wave's is its boss's). */
export const waveName = (n: number) => {
  const w = waveSpec(n);
  const boss = w.boss ? bossFor(w.boss) : undefined;
  return boss?.name ?? w.name ?? `Wave ${n}`;
};

/** A wave's twist: from the second wave on, most waves roll one, never the same twice running. */
export const TWISTS = {
  blood_moon: { name: 'Blood Moon', text: 'They’re quicker tonight, and drop more hearts', color: '#ff5a5a', from: 2 },
  treasure: { name: 'Treasure Hunt', text: 'Goblins in the arena: catch them!', color: '#ffd23a', from: 2 },
  powder: { name: 'Powder Keg', text: 'Sappers everywhere: stand back', color: '#ffb03a', from: 3 },
  swarm: { name: 'The Swarm', text: 'Here come the spiders', color: '#a6e36a', from: 3 },
  gold_rush: { name: 'Gold Rush', text: 'Every coin counts double', color: '#ffd23a', from: 3 },
  frenzy: { name: 'Frenzy', text: 'They pour in twice as fast, but frailer', color: '#ff7ab8', from: 4 },
  storm: { name: 'Thunderstorm', text: 'Lightning strikes the sand: mind the marks', color: '#9fd4ff', from: 5 },
  elite_night: { name: 'Elite Night', text: 'Thrice the champions tonight, each with a power of its own', color: '#ffb347', from: 6 },
  glass: { name: 'Glass Cannon', text: 'Every blow lands twice as hard: theirs and yours', color: '#cfe9ff', from: 7 },
} as const;
export type Twist = keyof typeof TWISTS;
const TWIST_CHANCE = 0.6;
/** Otherwise, a lone Treasure Goblin turns up this often in a wave. */
const GOBLIN_CHANCE = 0.35;

/** At most this many monsters in the arena at once (more as the run goes on, more in a Frenzy, up to the most: `DIFFICULTY`); the rest wait their turn. */
export function maxAlive(n: number): number {
  let m = 0;
  for (const [from, k] of DIFFICULTY.alive) if (n >= from) m = k;
  return Math.min(DIFFICULTY.most, m + (state.twist === 'frenzy' ? 4 : 0));
}
/** The ordinary monsters' growth by wave `n` (its steps from `DIFFICULTY.grow.from`, counting that one). */
export const grown = (n: number) => Math.max(0, n - DIFFICULTY.grow.from + 1);

/** Monsters per wave grow with the party: half as many again for each extra fighter. */
export const crowd = (game: GameContext) => 1 + 0.5 * Math.max(0, game.players.length - 1);

/** What a kind that isn't in the game yet stands for in a roster: this much budget each, filled from those that are. */
const STAND_IN = 2;

function rollTwist(game: GameContext, n: number, w: WaveSpec): Twist | null {
  if (w.calm || w.boss || n === finalWave() || !game.rng.chance(TWIST_CHANCE)) return null;
  const pool = (Object.keys(TWISTS) as Twist[]).filter((t) => t !== state.lastTwist && TWISTS[t].from <= n);
  return pool.length ? game.rng.pick(pool) : null;
}

/** Fill `budget` from the kinds that may come by wave `n`, weighted, keeping to each kind's `max`. */
function fill(game: GameContext, n: number, budget: number, counts: Record<string, number>) {
  const pool = MONSTERS.filter((m) => (m.weight ?? 1) > 0 && m.cost > 0 && m.from <= n);
  let left = budget;
  for (let guard = 0; guard < 400 && left > 0; guard++) {
    const can = pool.filter((m) => m.cost <= left + 0.5 && (m.max === undefined || (counts[m.id] ?? 0) < m.max));
    if (!can.length) break;
    const total = can.reduce((a, m) => a + (m.weight ?? 1), 0);
    let r = game.rng.next() * total;
    const pick = can.find((m) => (r -= m.weight ?? 1) <= 0) ?? can[can.length - 1];
    counts[pick.id] = (counts[pick.id] ?? 0) + 1;
    left -= pick.cost;
  }
}

/**
 * What wave `n` brings, by type (before party size): its roster (a kind not in the game yet adds
 * to the budget instead), its boss's escort, the budget filled, and its twist's changes.
 */
function compose(game: GameContext, n: number, w: WaveSpec, twist: Twist | null): Record<string, number> {
  const counts: Record<string, number> = {};
  const boss = w.boss ? bossFor(w.boss) : undefined;
  let budget = (w.budget ?? 0) + (w.boss && !boss ? BOSS_STAND_IN : 0);
  const roster = { ...w.roster, ...boss?.escort, ...(w.boss && !boss ? { brute: 1 } : {}) };
  for (const [type, count] of Object.entries(roster)) {
    if (monsterKind(type)) counts[type] = (counts[type] ?? 0) + count;
    else budget += STAND_IN * count;
  }
  if (budget > 0) fill(game, n, budget, counts);
  if (twist === 'powder') {
    // Half the dead are Sappers now, and one more besides.
    const turned = Math.ceil((counts.zombie ?? 0) / 2);
    counts.zombie = (counts.zombie ?? 0) - turned;
    counts.sapper = (counts.sapper ?? 0) + turned + 1;
  }
  if (twist === 'swarm') counts.spider = (counts.spider ?? 0) + 4 + Math.floor(n / 4);
  if (twist === 'frenzy') for (const t of Object.keys(counts)) if (!monsterKind(t)?.single) counts[t] = Math.ceil(counts[t] * 1.3);
  // More of them, from early on (a boss's wave is its own fight; one that comes singly stays one).
  if (n >= DIFFICULTY.more.from && !w.boss) for (const t of Object.keys(counts)) if (!monsterKind(t)?.single) counts[t] = Math.round(counts[t] * DIFFICULTY.more.by);
  return counts;
}

/** Wave `n` begins (with a twist of its own, or `force`d): what it brings is queued (the boss first, goblins partway), and everyone told. */
export function startWave(game: GameContext, n: number, force?: Twist) {
  const w = waveSpec(n);
  state.wave = n;
  state.phase = 'fighting';
  const twist = force ?? rollTwist(game, n, w);
  state.twist = twist;
  if (twist) state.lastTwist = twist;
  const boss = w.boss ? bossFor(w.boss) : undefined;
  state.boss = boss?.id ?? null;
  const counts = compose(game, n, w, twist);
  const queue: string[] = [];
  for (const [type, count] of Object.entries(counts)) {
    const k = monsterKind(type)?.single ? count : Math.round(count * crowd(game));
    for (let i = 0; i < k; i++) queue.push(type);
  }
  // Everything arrives shuffled; goblins turn up partway through, when the pit's busy.
  const rest = queue.sort(() => game.rng.next() - 0.5);
  const lone = n > 1 && n !== finalWave() && !boss && game.rng.chance(GOBLIN_CHANCE) ? 1 : 0;
  const goblins = twist === 'treasure' ? 2 : twist === 'gold_rush' ? Math.max(1, lone) : lone;
  for (let i = 0; i < goblins; i++) rest.splice(Math.floor(rest.length * (0.3 + 0.4 * game.rng.next())), 0, 'goblin');
  state.queue = boss ? [boss.id, ...rest] : rest;
  state.spawnTimer = 1.2;
  storm.next = game.clock.now + 4;
  still.clear();
  for (const r of runs.values()) r.hurt = false;

  // (Its banners are the HUD's, from the bus.)
  // Dusk falls as the fight goes on; a Blood Moon brings the night, a storm the dark.
  game.env.time = twist === 'blood_moon' ? 0.82 : twist === 'storm' ? 0.78 : dusk(n);
  bus.emit('waveStart', { wave: n, name: waveName(n), twist, boss: boss?.id ?? null, final: n === finalWave(), endless: state.endless });
}

/** The map's time of day as the fight goes on (wave `n`): the endless waves are fought by night. */
export const dusk = (n: number) => map().time + (map().dusk ?? 0) * Math.min(1, (n - 1) / Math.max(1, finalWave() - 1)) + (n > finalWave() ? 0.05 : 0);

/** Bring in the next of the wave's monsters, at a gate (a boss a little way in). */
function spawnNext(game: GameContext) {
  const type = state.queue.shift();
  if (!type) return;
  const m = map();
  const boss = bossKind(type);
  const g = game.rng.pick(boss ? (m.bossGates ?? m.gates) : m.gates);
  const spread = g.spread ?? 1.5;
  const pos = along(g, boss ? 0 : game.rng.range(-1.5, 1.5), game.rng.range(-spread, spread));
  // Past the run's last wave the bosses come back without ceremony, and tougher each time round (the bosses' `quick` and `might`).
  const again = boss && state.endless ? { quick: true, might: 1.4 + 0.2 * Math.floor((state.wave - WAVES.length - 1) / 20) } : undefined;
  const e = spawnMonster(game, type, pos, { yaw: g.yaw, data: again });
  game.fx.burst({ x: pos.x, y: pos.y + 1, z: pos.z }, { color: boss ? boss.color : type === 'goblin' ? '#ffd23a' : '#8fd6ff', count: 24, speed: 2.5, gravity: -1 });
  game.audio.play(boss ? 'boss' : 'spawn', { at: pos, volume: boss ? 1.4 : 0.8 });
  if (boss) game.fx.shake(0.2, 1.2);
  return e;
}

/** Monsters in the arena (not the merchant or anything else that's only scenery: `data.scenery`). */
export function monstersAlive(game: GameContext): number {
  let n = 0;
  for (const e of game.entities.all()) if (!e.data.scenery) n++;
  return n;
}

/** Bring them in while there's room, one every so often; the twist's weather. Whether the wave's all down. */
export function tick(game: GameContext, dt: number): { left: number; cleared: boolean } {
  let alive = monstersAlive(game);
  const frenzy = state.twist === 'frenzy';
  state.spawnTimer -= dt;
  if (state.queue.length > 0 && alive < maxAlive(state.wave) && state.spawnTimer <= 0) {
    if (spawnNext(game)) alive++;
    state.spawnTimer = state.boss ? 2.5 : frenzy ? DIFFICULTY.spawnEvery / 2 : DIFFICULTY.spawnEvery;
  }
  if (state.twist === 'storm') thunder(game);
  if (!state.queue.length && alive <= STRAGGLERS) stragglers(game);
  const left = alive + state.queue.length;
  return { left, cleared: state.queue.length === 0 && alive === 0 };
}

/** A wave down to its last few: any that hasn't moved in a long while is stuck where nobody can reach it (wedged in a wall), and comes back in through a gate. */
const STRAGGLERS = 3;
const STUCK = 20;
/** Where each of the last few was, and since when (by id); when they were last looked at. */
const still = new Map<number, { at: Vec3; since: number }>();
let lookedAt = 0;

function stragglers(game: GameContext) {
  const now = game.clock.now;
  if (now - lookedAt < 2) return;
  lookedAt = now;
  for (const e of game.entities.all()) {
    if (e.data.scenery || bossKind(e.type)) continue;
    const q = e.position;
    const was = still.get(e.id);
    if (!was || Math.hypot(q.x - was.at.x, q.y - was.at.y, q.z - was.at.z) > 1.5) {
      still.set(e.id, { at: { ...q }, since: now });
      continue;
    }
    if (now - was.since < STUCK) continue;
    const g = game.rng.pick(map().gates);
    e.teleport(along(g, 1, game.rng.range(-1, 1)));
    still.delete(e.id);
  }
}

/** The Thunderstorm: when the next bolt's marked, and where the marked one falls (null: none marked). */
const storm = { next: 0, at: null as Vec3 | null, strikes: 0 };
/** Seconds between a strike's mark and its bolt: time to see it and get out; how far it reaches a fighter. */
const STRIKE_WARNING = 1.4;
const STRIKE_REACH = 2.6;
const FWD = new math.Vector3(0, 0, -1);
const DOWN = new math.Vector3(0, -1, 0);
const UP = new math.Vector3(0, 1, 0);

/** A storm's strikes: a ring marked on the sand near someone (or in a knot of monsters), then the bolt. */
function thunder(game: GameContext) {
  const now = game.clock.now;
  if (storm.at || now < storm.next) return;
  const fighters = game.players.filter((p) => p.alive && !p.spectating);
  const monsters = game.entities.all().filter((e) => !e.data.scenery);
  const near: Vec3 | undefined = game.rng.chance(0.5) && monsters.length ? game.rng.pick(monsters).position : fighters.length ? game.rng.pick(fighters).position : undefined;
  if (!near) return;
  const at = { x: near.x + game.rng.range(-2.5, 2.5), y: near.y, z: near.z + game.rng.range(-2.5, 2.5) };
  storm.at = at;
  // The mark: the air crackling in a thin column over the spot, sparks round its edge, a warning on screen.
  const id = `arena.strike:${storm.strikes++}`;
  const crackle = game.props.bolt({ color: '#9fd4ff', length: 7, width: 0.14, intensity: 1.6, flicker: 0.9 });
  crackle.position.set(at.x, at.y, at.z);
  crackle.quaternion.setFromUnitVectors(FWD, UP);
  sparks(game, at);
  game.clock.after(STRIKE_WARNING / 2, () => sparks(game, at));
  game.hud.marker(id, { x: at.x, y: at.y + 0.3, z: at.z }, { shape: 'ring', color: '#9fd4ff', size: { world: 5.2 }, pulse: true });
  game.audio.play('thunder', { at, volume: 0.35, pitch: 1.6 });
  game.clock.after(STRIKE_WARNING, () => {
    crackle.remove();
    game.hud.marker(id, null);
    storm.at = null;
    storm.next = game.clock.now + game.rng.range(2.2, 4);
    if (state.twist !== 'storm' || state.phase !== 'fighting') return;
    strike(game, at);
  });
}

/** Sparks round the edge of a strike's mark (blocks across: `STRIKE_REACH` for fighters). */
function sparks(game: GameContext, at: Vec3) {
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    game.fx.burst({ x: at.x + Math.cos(a) * STRIKE_REACH, y: at.y + 0.15, z: at.z + Math.sin(a) * STRIKE_REACH }, { color: '#cfe9ff', count: 3, speed: 0.8, gravity: -1, glow: 1, life: 0.7 });
  }
}

/** A bolt from the sky: monsters in reach badly burnt, fighters still on the mark hurt. */
function strike(game: GameContext, at: Vec3) {
  const bolt = game.props.bolt({ color: '#cfe9ff', length: 22, width: 0.6, intensity: 8, flicker: 0.6 });
  bolt.position.set(at.x, at.y + 22, at.z);
  bolt.quaternion.setFromUnitVectors(FWD, DOWN);
  game.clock.after(0.25, () => bolt.remove());
  game.fx.burst({ x: at.x, y: at.y + 0.2, z: at.z }, { color: '#cfe9ff', count: 40, speed: 6, glow: 1, life: 0.5 });
  game.fx.shockwave({ x: at.x, y: at.y + 0.1, z: at.z }, 3.5, '#9fd4ff');
  game.fx.flash('#cfe9ff', 0.25, 0.15);
  game.audio.play('thunder', { at });
  for (const e of game.entities.near(at, 3.2)) if (e.alive && !e.data.scenery) e.damage(14, { source: 'world', knockback: 1, weapon: 'lightning', cause: 'fire' });
  for (const p of game.players) {
    const q = p.position;
    if (p.alive && Math.hypot(q.x - at.x, q.z - at.z) < STRIKE_REACH && Math.abs(q.y - at.y) < 2) p.damage(5, { source: 'world', knockback: 1, from: at });
  }
}

/** What the twists do once the monsters are in (in `setup`); and the difficulty's say on the champions and the potions. */
export function directorListen(game: GameContext) {
  Object.assign(eliteTuning, DIFFICULTY.elites);
  POTIONS.heal = DIFFICULTY.potionHeal;
  bus.on('spawned', ({ entity, type }) => {
    if (entity.data.scenery) return;
    // How hard each is (`DIFFICULTY`): every boss, every monster; and the ordinary ones tougher
    // and harder hitting as the run goes on (below), though not in a boss's wave, whose fight is
    // tuned as it is (its escort, what it raises).
    const { monster, boss, grow } = DIFFICULTY;
    if (bossKind(type)) {
      if (state.wave < boss.from) return;
      entity.data.tough = boss.tough;
      entity.data.hits = boss.hits;
      return;
    }
    const n = !state.boss && monsterKind(type) ? grown(state.wave) : 0;
    entity.data.tough = monster.tough * (1 + grow.tough * n);
    entity.data.hits = monster.hits * (1 + grow.hits * n);
    if (type === 'goblin') return;
    if (state.twist === 'blood_moon') {
      entity.data.speed = 1.25;
      entity.setSpeed(1.25);
    }
    // A Frenzy's monsters come quick and frail. (Elite Night's champions are the bestiary's: `monsters/`.)
    if (state.twist === 'frenzy') entity.health = Math.ceil(entity.maxHealth * 0.65);
  });
  bus.on('slain', ({ by, type, at }) => {
    // Under a Blood Moon, hearts fall more often.
    if (state.twist === 'blood_moon' && by && type !== 'goblin' && game.rng.chance(0.15)) {
      game.items.spawnPickup('heart', { x: at.x, y: at.y + 0.5, z: at.z }, { despawn: 30 });
    }
  });
  // A monster: blows land on it as if it had more health, and its own (its shots, its blasts) land harder.
  game.events.on('damage', (hit) => {
    const t = hit.target;
    const s = hit.source;
    if (t.kind === 'entity' && typeof t.data.tough === 'number') hit.amount /= t.data.tough;
    if (t.kind === 'player' && s && s !== 'world' && s.kind === 'entity' && typeof s.data.hits === 'number') hit.amount *= s.data.hits;
  });
  // Glass Cannon: every blow between fighters and monsters lands twice as hard.
  game.events.on('damage', (hit) => {
    if (state.twist !== 'glass' || state.phase !== 'fighting' || hit.cause === 'world') return;
    const s = hit.source;
    const fromPlayer = s && s !== 'world' && s.kind === 'player';
    if ((hit.target.kind === 'entity' && fromPlayer) || (hit.target.kind === 'player' && !fromPlayer)) hit.amount *= 2;
  });
}

/** A fresh fight: no storm brewing (its timers went with the restart). */
export function resetDirector() {
  storm.at = null;
  storm.next = 0;
  still.clear();
  lookedAt = 0;
}
