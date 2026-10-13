import {
  defineServer,
  Models,
  Skins,
  type Bot,
  type Behavior,
  type Entity,
  type GameContext,
  type MenuHandle,
  type Player,
  type ProjectileSpec,
  type Vec3,
} from '@platform';
import { building, guns, interactions, type Building, type Interactions } from '@platform/kits';
import { BASE, shared } from './shared';
import { C4_URL } from './models';
import { COVER } from './site';
import { WEAPONS } from './weapons';

/**
 * Siege Night: a team of operators holds a VIP (a man in a suit, kept in a command post) through five nights until extraction.
 * By day: fortify (walls from the materials you buy), restock at the quartermaster's, patch the
 * breaches. By night the hostiles come for the VIP: gunmen who take cover behind your walls and bash through them, demolitions crews who plant C4
 * (stronger materials take longer; bullets chip walls too, so you can shoot yourself a firing port).
 * Someone who goes down can be revived by a teammate holding E over them. Bots fill the six seats
 * people don't take: by day they raise a wall ring with four gates, by night they hold the gates,
 * shoot, and pull the downed back up.
 */
const NIGHTS = 5;
const SEATS = 6;
const DAY_SECONDS = 30; // between nights (the very first day is a little longer, to set up)
/** A night that's gone on this long (the last wave all out) ends: the hostiles pull back at first light, if the VIP still stands. */
const NIGHT_MAX = 150;
const VIP_HP = 200;
const FIELD_RADIUS = 46; // where the hostiles come onto the field: past the ruins, so they have to work in across it
const WALL_RADIUS = 9;
const START_GOLD = 80;
const REVIVE_SECONDS = 3;
const VIP: Vec3 = { x: 0.5, y: BASE + 1.2, z: 0.5 };
const CALLSIGNS = ['Ghost', 'Viper', 'Reaper', 'Hawk', 'Jester', 'Cobra', 'Bishop', 'Raven'];
/** The operators' look: tactical shades, a patrol cap, an olive field jacket, trousers and boots; build, skin, hair and beard differ from one to the next. */
const hash = (s: string) => [...s].reduce((n, c) => (n * 31 + c.charCodeAt(0)) >>> 0, 7);
const NAME_COLOURS = ['#ff6b5e', '#ffb347', '#ffe066', '#5ed0ff', '#8ee06a', '#e8e8e8', '#d58cff', '#ff8fb1'];
function operatorModel(name: string) {
  const h = hash(name);
  const pick = <T,>(list: readonly T[], shift: number) => list[((h >>> shift) + shift) % list.length];
  return Models.character({
    build: pick(['broad', 'slim', 'broad', 'heavy'] as const, 0),
    skin: pick(['#e0b08c', '#c68a64', '#8d5a3b', '#f0c9a6', '#a9714b', '#6f4428'], 3),
    hair: pick(['buzz', 'crew', 'short', 'slick'] as const, 6),
    hairColor: pick(['#1b1410', '#3a2a1a', '#6b4a2a', '#141414'], 9),
    facialHair: pick(['stubble', 'none', 'beard', 'goatee', 'none'] as const, 12),
    face: 'shades',
    top: 'tunic',
    topColor: '#59603f',
    accent: '#2f3626',
    bottom: 'trousers',
    bottomColor: '#4b4a3a',
    shoes: 'boots',
    shoeColor: '#1a1a1c',
    hat: 'cap',
  });
}

const GUN_IDS = ['lmg', 'sniper', 'rifle', 'shotgun', 'smg', 'pistol']; // best first
const ARMOR_PRICES = [50, 90, 140];
const MAX_TURRETS = 6;

/** Building materials: the item, the block it places, and the seconds the hostiles need to chew through one. */
const MATERIALS: Record<string, { block: string; name: string; chew: number }> = {
  planks: { block: 'oak_planks', name: 'Planks', chew: 1.5 },
  cobble: { block: 'cobblestone', name: 'Cobblestone', chew: 3 },
  brick: { block: 'bricks', name: 'Bricks', chew: 4.5 },
  ironblock: { block: 'iron_block', name: 'Iron Plate', chew: 8 },
};
/** What the hostiles can't bash through: the ground itself. */
const GROUND = new Set(['gravel', 'andesite', 'deepslate', 'bedrock']);
/** Seconds for a hostile to bash through a block of each kind (3 for anything not listed). */
const BASH: Record<string, number> = {
  ...Object.fromEntries(Object.values(MATERIALS).map((m) => [m.block, m.chew])),
  spruce_planks: 1.5,
  oak_log: 2,
  bookshelf: 1.5,
  sandstone: 3,
  stone_bricks: 5,
  gray_concrete: 6,
  light_gray_concrete: 6,
  black_concrete: 5,
  white_concrete: 5,
  red_concrete: 5,
  green_concrete: 5,
  orange_concrete: 4.5,
};

/** Gold for each kill (a planted charge shot before it blows pays too). */
const BOUNTY: Record<string, number> = { rifleman: 8, assaulter: 7, heavy: 18, demo: 12, charge: 5 };
type Look = NonNullable<Parameters<typeof Models.character>[0]>;

type Phase = 'day' | 'night' | 'over';

let phase: Phase = 'day';
let night = 0; // the night just past or in progress (0 before the first)
let dayLeft = 0;
let vipHp = VIP_HP;
let toSpawn = 0;
let spawnTimer = 0;
let boardTimer = 0;
let midDrop = false;
let nightT = 0;
let waveQueue: string[] = [];
let ambT = 0;
let build: Building;
let talk: Interactions;
const placed = new Set<string>(); // blocks the players put down: the only ones they may take down (or the hostiles chew)
const key = (x: number, y: number, z: number) => `${x},${y},${z}`;

// What each player has and has done (people and bots alike).
const gold = new Map<string, number>();
const armorLevel = new Map<string, number>();
const kills = new Map<string, number>();
const revives = new Map<string, number>();
const menus = new Map<string, MenuHandle>();
const botClock = new Map<string, { build: number; shop: number; fire: number; reload: number; ammo: number; react: number; err: Vec3; errT: number; target: number; burst: number }>();
/** The fallen: their marker in the world and how far along a revive is. */
const downed = new Map<string, { player: Player; body: Entity; progress: number }>();
/** Bots holding a revive this tick (a person holds E). */
const botReviving = new Set<string>();

export const vipHealth = () => vipHp;
export const goldOf = (p: Player) => gold.get(p.id) ?? 0;
export const earn = (p: Player, n: number) => gold.set(p.id, goldOf(p) + n);
const bump = (m: Map<string, number>, p: Player) => m.set(p.id, (m.get(p.id) ?? 0) + 1);

const isBot = (p: Player): p is Bot => p.bot;
const standing = (p: Player) => p.alive && !p.spectating;
const ENEMY_TYPES = ['rifleman', 'assaulter', 'heavy', 'demo'];
/** Anything bots and turrets shoot at: the hostiles, and a planted charge. */
const isThreat = (e: Entity) => e.alive && (ENEMY_TYPES.includes(e.type) || e.type === 'charge');
const enemies = (game: GameContext) => ENEMY_TYPES.reduce((n, t) => n + game.entities.count(t), 0);
const zombieCount = (n: number) => 5 + n * 4;

/** The night's hostiles in the order they come: a breach crew (two to four demolitions men) in the first two thirds, heavy gunners from night 3, the rest rifle teams. */
export function planWave(game: GameContext, n: number): string[] {
  const total = zombieCount(n);
  const demos = n >= 5 ? 4 : n >= 3 ? 3 : 2;
  const heavies = n >= 3 ? Math.round(total * 0.12) : 0;
  const rest: string[] = [];
  for (let i = 0; i < total - demos; i++) rest.push(i < heavies ? 'heavy' : game.rng.next() < 0.4 ? 'assaulter' : 'rifleman');
  for (let i = rest.length - 1; i > 0; i--) {
    const j = Math.floor(game.rng.next() * (i + 1));
    [rest[i], rest[j]] = [rest[j], rest[i]];
  }
  const early = Math.max(demos + 1, Math.floor(total * 0.7));
  for (let k = 0; k < demos; k++) rest.splice(Math.floor(game.rng.next() * Math.min(early, rest.length + 1)), 0, 'demo');
  return rest;
}
const dist2 = (a: { x: number; z: number }, b: { x: number; z: number }) => Math.hypot(a.x - b.x, a.z - b.z);

// The wall ring: columns round the VIP, with a two-wide gate at each compass point.
const WALL: { x: number; z: number }[] = [];
for (let i = 0; i < 60; i++) {
  if (i % 15 < 2) continue;
  const a = (i / 60) * Math.PI * 2;
  const c = { x: Math.round(Math.cos(a) * WALL_RADIUS), z: Math.round(Math.sin(a) * WALL_RADIUS) };
  if (!WALL.some((w) => w.x === c.x && w.z === c.z)) WALL.push(c);
}
/** Just inside each gate: where a bot stands to hold it. */
const GATES: Vec3[] = [
  { x: 6.5, y: VIP.y, z: 0.5 },
  { x: 0.5, y: VIP.y, z: 6.5 },
  { x: -5.5, y: VIP.y, z: 0.5 },
  { x: 0.5, y: VIP.y, z: -5.5 },
];
/** What the bots build with: better stuff as the operation goes on. */
const wallBlock = () => (night < 2 ? 'oak_planks' : night < 4 ? 'cobblestone' : 'bricks');

/** How well the bots shoot: a slow hand, a beat before the first shot, a wobble that grows with range, short bursts, and not much past 22 blocks. */
const BOT_AIM = { turn: 2.1, react: [0.6, 1.2], wobble: 0.9, perBlock: 0.11, burst: [2, 3], pause: [0.5, 1.1], range: 18 };
/** What a bot's bullets do, against the hostiles: a person's aim and nerve are worth more than theirs. */
const BOT_DAMAGE = 0.65;

/** Where a gunman aims at the VIP: his chest, wherever he's standing. */
const vipAim = (_from: Vec3): Vec3 => VIP;

/** Where the ammo crates land: round the command post, inside the wall ring. */
const CRATES: Vec3[] = [
  { x: 7, y: BASE + 1.3, z: 4.5 },
  { x: -7, y: BASE + 1.3, z: -5.5 },
  { x: 4, y: BASE + 1.3, z: -7.5 },
  { x: -4, y: BASE + 1.3, z: 7.5 },
];
function dropCrates(game: GameContext) {
  for (const at of CRATES) game.items.spawnPickup('ammo_crate', at, { beam: '#ffb347', despawn: 100 });
  game.hud.toast('Ammo crates dropped by the command post');
}

const BOLT: ProjectileSpec = { speed: 40, damage: 18, glow: '#ffd166' };

/** What the hostiles remember between ticks. */
interface Foe {
  cd?: number;
  lx?: number;
  lz?: number;
  stuck?: number;
  detour?: number;
  detours?: number;
  shots?: number;
  plants?: number;
  cover?: Vec3;
  state?: string;
  t?: number;
  wall?: Vec3;
  wallT?: number;
  dside?: number;
  strafe?: number;
  side?: number;
  flee?: number;
  reload?: number;
  fuse?: number;
}

/** How far through each wall block the hostiles have bashed (0..1), shared: two of them break one twice as fast. */
const bashed = new Map<string, number>();

/** Held up by a wall of the team's making: bash through it (tougher material, longer). Held up by anything else: step round it. */
function pushThrough(self: Entity, game: GameContext, d: Foe, goal: Vec3, dt: number) {
  const p = self.position;
  const len = Math.hypot(goal.x - p.x, goal.z - p.z) || 1;
  if ((d.detour ?? 0) > 0) {
    d.detour = (d.detour ?? 0) - dt;
    self.moveDirection((-(goal.z - p.z) / len) * (d.dside ?? 1), ((goal.x - p.x) / len) * (d.dside ?? 1));
    return;
  }
  if (Math.hypot(p.x - (d.lx ?? p.x), p.z - (d.lz ?? p.z)) < 0.03) d.stuck = (d.stuck ?? 0) + dt;
  else d.stuck = 0;
  d.lx = p.x;
  d.lz = p.z;
  if ((d.stuck ?? 0) < 0.5) return;
  const ax = Math.floor(p.x + ((goal.x - p.x) / len) * 1.1);
  const az = Math.floor(p.z + ((goal.z - p.z) / len) * 1.1);
  for (const y of [Math.floor(p.y), Math.floor(p.y) + 1]) {
    const name = game.world.blockName(game.world.getBlock(ax, y, az));
    const info = game.world.blockInfo(name);
    if (GROUND.has(name) || !info || !info.solid || info.plant) continue; // air, the ground itself, plants
    const k = key(ax, y, az);
    const done = (bashed.get(k) ?? 0) + dt / (BASH[name] ?? 3);
    if (done >= 1) {
      game.world.breakBlock(ax, y, az, { by: self });
      placed.delete(k);
      bashed.delete(k);
    } else bashed.set(k, done);
    return;
  }
  // Nothing of ours in the way, and still stuck: sidestep for a moment; boxed in again and again (a corner of the ruins), clamber over it.
  if ((d.stuck ?? 0) > 1.5) {
    d.detours = (d.detours ?? 0) + 1;
    if (d.detours >= 3) {
      self.teleport({ x: p.x + ((goal.x - p.x) / len) * 3.5, y: p.y + 2, z: p.z + ((goal.z - p.z) / len) * 3.5 });
      [d.detours, d.stuck] = [0, 0];
    } else [d.detour, d.dside, d.stuck] = [1.2, game.rng.next() < 0.5 ? -1 : 1, 0];
  }
}
// -------------------------------------------------------------------------------------------------
// How the hostiles fight: fire and manoeuvre, cover to cover, and C4 for the walls
// -------------------------------------------------------------------------------------------------

/** The two teams bound by turns: while one is up and moving, the other holds and fires. */
let boundTeam = 0;
let boundT = 0;
/** Where the last C4 blew a hole in the wall: for a while the squads push for it. */
let breach: { x: number; z: number; until: number } | null = null;
let radioAt = -99;

const teamOf = (e: Entity) => e.id & 1;

/** A callout over the radio: up as a line for everyone, and spoken in a war voice on their screens (not over each other). */
function radio(game: GameContext, who: string, line: string, at: Vec3) {
  if (game.clock.now - radioAt < 1.2) return;
  radioAt = game.clock.now;
  game.hud.feed([{ text: `${who}: `, color: '#ff8a7a' }, { text: `"${line}"`, color: '#ffd9d0' }]);
  game.clients.send('all', 'radio', { who, line, x: at.x, y: at.y, z: at.z });
}

/** The next cover for a unit moving up: nearer the VIP than it is, on its own side of the approach, not too far to run. */
function nextCover(self: Entity): Vec3 | null {
  const p = self.position;
  const here = dist2(p, VIP);
  if (here < 20) return null;
  const lane = ((self.id % 5) - 2) * 0.3; // each unit takes its own side of the approach: they flank
  const bearing = Math.atan2(p.z - VIP.z, p.x - VIP.x) + lane;
  let best: Vec3 | null = null;
  let bestScore = Infinity;
  for (const c of COVER) {
    const toVip = dist2(c, VIP);
    const run = dist2(c, p);
    if (toVip > here - 4 || toVip < 18 || run > 18) continue;
    const off = Math.abs(Math.atan2(Math.sin(Math.atan2(c.z - VIP.z, c.x - VIP.x) - bearing), Math.cos(Math.atan2(c.z - VIP.z, c.x - VIP.x) - bearing)));
    const score = toVip + run * 0.5 + off * 18;
    if (score < bestScore) [bestScore, best] = [score, { x: c.x, y: p.y, z: c.z }];
  }
  return best;
}

/** Move up toward a goal: cover to cover while it's far, through the breach if there's a fresh one, straight in when near. */
function advance(self: Entity, game: GameContext, d: Foe, goal: Vec3, dt: number) {
  let to = goal;
  const fresh = breach && game.clock.now < breach.until;
  if (fresh) to = { x: breach!.x, y: self.position.y, z: breach!.z };
  else if (dist2(self.position, VIP) >= 20) {
    if (d.cover && dist2(self.position, d.cover) < 2.5) d.cover = undefined;
    d.cover ??= nextCover(self) ?? undefined;
    if (d.cover) to = d.cover;
  }
  self.moveTo(to);
  pushThrough(self, game, d, to, dt);
}

/**
 * A gunman fights in fire teams. Sees nothing to shoot: moves up from cover to cover. Has a target
 * (an operator, or the VIP): the team that's down holds and fires in bursts from where it
 * is while the other team moves up, and they swap every few seconds; a wounded one holds in cover
 * and keeps firing. Walls are cover for everyone: bullets stop at blocks.
 */
function gunman(o: { range: number; damage: number; cooldown: number; spread: number; vipDamage: number }): Behavior {
  const bullet: ProjectileSpec = { speed: 75, damage: o.damage, glow: '#ffcf70' };
  return (self, game, dt) => {
    const d = self.data as Foe;
    d.cd = Math.max(0, (d.cd ?? 0) - dt);
    d.strafe = (d.strafe ?? 0) - dt;
    const near = self.nearestPlayer();
    const seen = near && self.distanceTo(near) < o.range && self.canSee(near) ? near : null;
    const aim = vipAim(self.position);
    const atVip = !seen && self.distanceTo(VIP) < o.range && self.canSee(aim);
    const engaged = !!(seen || atVip);
    const hurt = self.health < self.maxHealth * 0.45;
    if (engaged && (teamOf(self) !== boundTeam || hurt)) {
      // Down and firing: bursts from here, a little sidestepping.
      const t: Vec3 = seen ? seen.position : aim;
      const p = self.position;
      self.lookAt(t);
      if (d.strafe <= 0) [d.strafe, d.side] = [1 + game.rng.next() * 1.5, game.rng.next() < 0.5 ? -1 : 1];
      const len = Math.hypot(t.x - p.x, t.z - p.z) || 1;
      self.moveDirection((-(t.z - p.z) / len) * (d.side ?? 1) * 0.3, ((t.x - p.x) / len) * (d.side ?? 1) * 0.3);
      if (d.cd <= 0) {
        self.animate('attack');
        self.shoot(bullet, seen ?? aim, { spread: o.spread, lead: !!seen });
        if (!seen) vipHp = Math.max(0, vipHp - o.vipDamage);
        d.shots = (d.shots ?? 0) + 1;
        d.cd = o.cooldown + (d.shots % 3 === 0 ? 0.7 : 0);
      }
      return;
    }
    // Up and moving (no shooting on the run, bar a snap shot at someone in the face).
    if (seen && d.cd <= 0 && self.distanceTo(seen) < 7) {
      self.shoot(bullet, seen, { spread: o.spread * 1.6 });
      d.cd = o.cooldown * 1.5;
    }
    advance(self, game, d, VIP, dt);
  };
}

const PERIMETER = 14;
/**
 * The wall to breach: from outside, the perimeter wall nearest to them (the middle of a side is a
 * gate, so it slides along to the wall beside it); from inside, the nearest wall the team put up, or else the
 * command post's.
 */
function nearestWall(p: Vec3): Vec3 | null {
  if (Math.max(Math.abs(p.x), Math.abs(p.z)) >= PERIMETER - 1) {
    let x = Math.max(-PERIMETER, Math.min(PERIMETER, p.x));
    let z = Math.max(-PERIMETER, Math.min(PERIMETER, p.z));
    if (Math.abs(p.x) > Math.abs(p.z)) x = Math.sign(p.x) * PERIMETER;
    else z = Math.sign(p.z) * PERIMETER;
    if (Math.abs(x) === PERIMETER && Math.abs(z) < 4) z = (z < 0 ? -1 : 1) * 4;
    if (Math.abs(z) === PERIMETER && Math.abs(x) < 4) x = (x < 0 ? -1 : 1) * 4;
    return { x: x + 0.5, y: BASE + 1, z: z + 0.5 };
  }
  let best: Vec3 | null = null;
  let bd = Infinity;
  for (const k of placed) {
    const [x, y, z] = k.split(',').map(Number);
    const toVip = Math.hypot(x + 0.5 - VIP.x, z + 0.5 - VIP.z);
    if (toVip < 6 || toVip > 12) continue;
    const dd = Math.hypot(x + 0.5 - p.x, z + 0.5 - p.z);
    if (dd < bd) [bd, best] = [dd, { x: x + 0.5, y, z: z + 0.5 }];
  }
  return best ?? { x: Math.max(-5, Math.min(5, p.x)) + 0.5, y: BASE + 1, z: Math.sign(p.z || 1) * 4 + 0.5 };
}
/**
 * Demolitions: the breaching team. Works up cover to cover to the nearest wall the team built,
 * creeps up on it, plants a C4 charge ("C4 set"), and backs off clear. The charge blows four
 * seconds later ("Fire in the hole") and the squads push for the hole. It's a long wait for the
 * next charge: shooting the C4 before it goes defuses it.
 */
/** A demolitions man's pistol, for after the charge is placed: he fights from cover like the rest. */
const sidearm = gunman({ range: 14, damage: 4, cooldown: 0.9, spread: 0.12, vipDamage: 0.5 });

const demolitionsAI: Behavior = (self, game, dt) => {
  const d = self.data as Foe;
  const p = self.position;
  if (d.state === 'plant') {
    self.stop();
    d.t = (d.t ?? 0) - dt;
    if (d.t > 0) return;
    game.entities.spawn('charge', { x: p.x, y: p.y, z: p.z }, { data: { fuse: 4.5, c4: 1 } });
    radio(game, 'Demolitions', 'C4 set.', p);
    [d.state, d.t, d.plants] = ['flee', 4.4, 1];
    return;
  }
  if (d.state === 'flee') {
    d.t = (d.t ?? 0) - dt;
    const len = Math.hypot(p.x - VIP.x, p.z - VIP.z) || 1;
    self.moveDirection((p.x - VIP.x) / len, (p.z - VIP.z) / len);
    if (d.t <= 0) d.state = undefined;
    return;
  }
  if (d.plants) return sidearm(self, game, dt); // the charge is placed: from here on he fights with his pistol
  d.wallT = (d.wallT ?? 0) - dt;
  if (d.wallT <= 0) {
    d.wall = nearestWall(p) ?? undefined;
    d.wallT = 1;
  }
  const wall = d.wall;
  if (wall && Math.hypot(wall.x - p.x, wall.z - p.z) < 20) {
    // Close enough to go straight in: up to the wall, on the side it's come from.
    const len = Math.hypot(p.x - wall.x, p.z - wall.z) || 1;
    const stand = { x: wall.x + ((p.x - wall.x) / len) * 1.4, y: p.y, z: wall.z + ((p.z - wall.z) / len) * 1.4 };
    self.moveTo(stand);
    pushThrough(self, game, d, stand, dt);
    if (Math.hypot(wall.x - p.x, wall.z - p.z) < 2.6) [d.state, d.t] = ['plant', 1.2];
    return;
  }
  advance(self, game, d, wall ?? VIP, dt);
  // No wall to breach (nothing built): the VIP's own base will do.
  if (!wall && self.distanceTo(VIP) < 4.5) [d.state, d.t] = ['plant', 1.2];
};
/** A C4 charge: a four-second fuse (a satchel's, two), then a crater, and a breach the squads push for. Shooting it defuses it. */
const chargeAI: Behavior = (self, game, dt) => {
  const d = self.data as Foe & { c4?: number; warned?: number };
  d.fuse = (d.fuse ?? 2) - dt;
  d.cd = (d.cd ?? 0) - dt;
  if (d.cd <= 0 && d.fuse > 0) {
    game.audio.play('case_beep', { at: self.position, volume: 0.7 });
    d.cd = 0.5;
  }
  if (d.c4 && d.fuse <= 1 && !d.warned) {
    d.warned = 1;
    radio(game, 'Demolitions', 'Fire in the hole!', self.position);
  }
  if (d.fuse > 0) return;
  const p = self.position;
  game.world.explode(p, d.c4 ? 3.4 : 3, { damage: [70, 10], reach: d.c4 ? 6 : 5.5, knockback: 1.2, by: self });
  if (d.c4) breach = { x: p.x, z: p.z, until: game.clock.now + 25 };
  if (dist2(p, VIP) < 7) vipHp = Math.max(0, vipHp - 25);
  for (const q of game.players) {
    const dd = dist2(q.position, p);
    if (!q.bot && dd < 24) q.fx.shake(Math.max(0.2, 0.9 - dd / 28), 0.6); // the ground jumps
  }
  self.remove();
};
/** An automated turret: shoots the nearest hostiles it can see. */
const turretAI: Behavior = (self, game, dt) => {
  const d = self.data as { cd?: number };
  d.cd = Math.max(0, (d.cd ?? 0) - dt);
  if (d.cd > 0) return;
  let best: Entity | null = null;
  let bestD = 20;
  for (const e of game.entities.near(self.position, 20)) {
    if (!isThreat(e)) continue;
    const dist = self.distanceTo(e);
    if (dist < bestD && self.canSee(e)) [best, bestD] = [e, dist];
  }
  if (!best) return;
  self.lookAt(best);
  self.shoot(BOLT, best, { lead: true });
  d.cd = 0.7;
};

// -------------------------------------------------------------------------------------------------
// The quartermaster
// -------------------------------------------------------------------------------------------------

interface Ware {
  id: string;
  name: string;
  note: string;
  icon: { item: string } | { block: string };
  price: (p: Player) => number;
  /** Whether they can buy it now (not already maxed, room for it). */
  ok: (game: GameContext, p: Player) => boolean;
  give: (game: GameContext, p: Player) => void;
  /** Whether a bot wants it (and which seat it is). */
  bot?: (p: Player, index: number) => boolean;
}

const levelOf = (p: Player) => armorLevel.get(p.id) ?? 0;
const hasGun = (p: Player, id: string) => p.inventory.count(id) > 0;
/** Put the best gun they carry (or this one) in their hands. */
function equip(p: Player, id?: string) {
  const want = id ?? GUN_IDS.find((g) => hasGun(p, g));
  if (!want) return;
  for (let i = 0; i < 9; i++) {
    p.inventory.select(i);
    if (p.inventory.held?.item === want) return;
  }
  p.inventory.select(0);
}
/** Every gun they carry back to a full magazine and a full reserve (through the gun kit: giving a gun again would drop a spare on the floor). */
function refill(game: GameContext, p: Player) {
  const kit = guns.of(game);
  for (const id of GUN_IDS) if (hasGun(p, id)) kit?.setAmmo(p, id, { magazine: WEAPONS[id].magazine, reserve: WEAPONS[id].reserve });
}

const gunWare = (id: string, price: number, note: string, bot?: Ware['bot']): Ware => ({
  id,
  name: WEAPONS[id].name,
  note,
  icon: { item: id },
  price: () => price,
  ok: (_g, p) => !hasGun(p, id),
  give: (_g, p) => {
    p.inventory.give(id);
    equip(p, id);
  },
  bot,
});

const materialWare = (id: string, count: number, price: number, note: string): Ware => ({
  id,
  name: `${MATERIALS[id].name} ×${count}`,
  note,
  icon: { block: MATERIALS[id].block },
  price: () => price,
  ok: () => true,
  give: (_g, p) => void p.inventory.give(id, count),
});

const WARES: Ware[] = [
  { ...gunWare('smg', 70, 'Fast and light: 950 rounds a minute', (p, i) => i < 3 && !hasGun(p, 'rifle')) },
  gunWare('shotgun', 90, 'Devastating up close; chips walls open', (_p, i) => i === 3),
  gunWare('rifle', 130, 'The all-rounder: accurate, hits hard, shoots through thin cover', () => true),
  gunWare('sniper', 170, 'One-shot kills at range; punches through two blocks of wall'),
  gunWare('lmg', 220, '100-round belt; slow to reload, hard to stop'),
  {
    id: 'ammo',
    name: 'Ammo resupply',
    note: 'Refills every gun you carry',
    icon: { item: 'rifle' },
    price: () => 25,
    ok: (_g, p) => GUN_IDS.some((g) => hasGun(p, g)),
    give: (g, p) => refill(g, p),
  },
  materialWare('cobble', 24, 30, 'Stone walls: hostiles need twice as long to chew through'),
  materialWare('brick', 24, 50, 'Brick walls: three times as tough as planks'),
  materialWare('ironblock', 12, 90, 'Iron plate: the toughest, over five times a plank (and shot-proof)'),
  materialWare('planks', 32, 15, 'Cheap and quick to put up'),
  {
    id: 'armor',
    name: 'Body armour',
    note: 'Take 20% less damage per level (3 levels)',
    icon: { item: 'iron_chestplate' },
    price: (p) => ARMOR_PRICES[levelOf(p)] ?? 0,
    ok: (_g, p) => levelOf(p) < ARMOR_PRICES.length,
    give: (_g, p) => {
      armorLevel.set(p.id, levelOf(p) + 1);
      p.armor = levelOf(p) * 5;
    },
    bot: () => true,
  },
  {
    id: 'turret',
    name: 'Sentry turret',
    note: `Shoots the hostiles on its own, set down where you stand (up to ${MAX_TURRETS})`,
    icon: { item: 'rifle' },
    price: () => 100,
    ok: (g) => g.entities.count('turret') < MAX_TURRETS,
    give: (g, p) => {
      const at = { x: p.position.x - Math.sin(p.yaw) * 1.5, y: p.position.y + 0.1, z: p.position.z - Math.cos(p.yaw) * 1.5 };
      g.entities.spawn('turret', at);
    },
    bot: (_p, index) => index < 4,
  },
  {
    id: 'repair',
    name: 'Medic for the VIP',
    note: 'Patches the VIP up: +50 health',
    icon: { block: 'red_wool' },
    price: () => 40,
    ok: () => vipHp < VIP_HP,
    give: () => void (vipHp = Math.min(VIP_HP, vipHp + 50)),
    bot: () => vipHp < VIP_HP * 0.6,
  },
];

/** Buy a ware if they can: pays and gives it. Returns whether it went through. */
export function purchase(game: GameContext, p: Player, id: string): boolean {
  const w = WARES.find((x) => x.id === id);
  if (!w || !w.ok(game, p)) return false;
  const price = w.price(p);
  if (goldOf(p) < price) return false;
  earn(p, -price);
  w.give(game, p);
  return true;
}

function menuContents(game: GameContext, p: Player) {
  return {
    title: 'Quartermaster',
    subtitle: `${goldOf(p)} gold`,
    sections: [
      {
        entries: WARES.map((w) => {
          const ok = w.ok(game, p);
          return {
            icon: w.icon,
            label: w.name,
            detail: ok ? `${w.price(p)} gold` : 'Have it',
            note: w.note,
            disabled: !ok || goldOf(p) < w.price(p),
            onSelect: () => {
              if (purchase(game, p, w.id)) {
                game.audio.play('pickup', { at: p.position, volume: 0.5 });
                menus.get(p.id)?.update(menuContents(game, p));
              }
            },
          };
        }),
      },
    ],
  };
}

function openShop(game: GameContext, p: Player) {
  menus.get(p.id)?.close();
  const menu = p.hud.menu({ ...menuContents(game, p), onClose: () => menus.get(p.id) === menu && menus.delete(p.id) });
  menus.set(p.id, menu);
}

// -------------------------------------------------------------------------------------------------
// Operators: people and bots
// -------------------------------------------------------------------------------------------------

/** A sidearm and some planks, a little gold; whatever they had before is gone. */
function giveKit(p: Player) {
  p.inventory.clear();
  p.inventory.give('pistol');
  p.inventory.give('planks', 32);
  p.inventory.select(0);
  p.armor = 0;
  armorLevel.delete(p.id);
  gold.set(p.id, START_GOLD);
  p.setModel(operatorModel(p.name));
  p.color = NAME_COLOURS[hash(p.name) % NAME_COLOURS.length];
}

/** Bots fill the team to six; people take their places. */
function balanceBots(game: GameContext) {
  const people = game.players.filter((p) => !p.bot).length;
  const bots = game.players.filter(isBot);
  const want = Math.max(0, SEATS - people);
  const used = new Set(game.players.map((p) => p.name));
  for (let i = bots.length; i < want; i++) {
    const name = CALLSIGNS.find((n) => !used.has(n)) ?? `Bot ${i + 1}`;
    used.add(name);
    game.bots.add(name);
  }
  for (const b of bots.slice(want)) game.bots.remove(b);
}

/** Walk toward a point (flat), jumping when held up. */
function walkTo(bot: Bot, at: Vec3, within: number) {
  const dist = dist2(at, bot.position);
  bot.controls.lookAt({ x: at.x, y: bot.eye.y, z: at.z });
  bot.controls.hold('KeyW', dist > within);
  bot.controls.hold('Space', dist > within && bot.velocity.x ** 2 + bot.velocity.z ** 2 < 0.2);
  return dist;
}

/** Turn toward a point at a limited rate (radians a second), as a person's hand does, not in one snap. */
function aimAt(bot: Bot, at: Vec3, dt: number, rate: number) {
  const e = bot.eye;
  const dx = at.x - e.x;
  const dy = at.y - e.y;
  const dz = at.z - e.z;
  const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));
  const step = rate * dt;
  const c = bot.controls;
  c.look(c.yaw + Math.max(-step, Math.min(step, wrap(Math.atan2(-dx, -dz) - c.yaw))), c.pitch + Math.max(-step, Math.min(step, Math.atan2(dy, Math.hypot(dx, dz)) - c.pitch)));
}

/** The first spot of the wall (in this bot's share of the ring) that has a gap in it. */
function gapFor(game: GameContext, index: number, count: number): { x: number; z: number } | null {
  const air = game.world.blockId('air');
  for (let k = 0; k < WALL.length; k++) {
    if (Math.floor((k * count) / WALL.length) !== index) continue;
    const c = WALL[k];
    if (game.world.getBlock(c.x, BASE + 1, c.z) === air || game.world.getBlock(c.x, BASE + 2, c.z) === air) return c;
  }
  return null;
}

/** By day a bot builds and shops; by night it revives the fallen, holds a gate and shoots what comes. */
function driveBot(game: GameContext, bot: Bot, index: number, count: number, dt: number) {
  const c = bot.controls;
  if (!standing(bot) || phase === 'over') return c.release();
  const clock = botClock.get(bot.id) ?? { build: 0, shop: 0, fire: 0, reload: 0, ammo: 0, react: 0, err: { x: 0, y: 0, z: 0 }, errT: 0, target: -1, burst: 0 };
  botClock.set(bot.id, clock);
  clock.build -= dt;
  clock.shop -= dt;
  clock.fire -= dt;
  clock.reload -= dt;
  clock.ammo -= dt;

  // Spend what it has (every couple of seconds), and keep the best gun in hand.
  if (clock.shop <= 0) {
    clock.shop = 2;
    for (const w of WARES) if (w.bot?.(bot, index) && purchase(game, bot, w.id)) break;
    if (clock.ammo <= 0 && goldOf(bot) >= 60 && purchase(game, bot, 'ammo')) clock.ammo = 25;
    const best = GUN_IDS.find((g) => hasGun(bot, g));
    if (best && bot.inventory.held?.item !== best) equip(bot, best);
  }

  if (phase === 'night') {
    // The nearest hostiles to the VIP that it can shoot at.
    let target: Entity | null = null;
    let best = Infinity;
    for (const e of game.entities.near(bot.position, 30)) {
      if (!isThreat(e)) continue;
      const toVip = dist2(e.position, VIP);
      if (toVip < 24 && toVip < best && game.world.lineOfSight(bot.eye, { x: e.position.x, y: e.position.y + 1.1, z: e.position.z })) [best, target] = [toVip, e];
    }
    // A teammate down with nobody hostile on them: the nearest bot goes to pull them up, the rest keep fighting.
    let mate: { body: Entity } | null = null;
    let md = Infinity;
    for (const d of downed.values()) {
      const dd = dist2(d.body.position, bot.position);
      if (dd < md) [md, mate] = [dd, d];
    }
    if (mate) {
      const body = mate.body.position;
      const covered = game.entities.near(body, 7).some(isThreat);
      const closest = game.players.every((p) => p === bot || !p.bot || !standing(p) || dist2(p.position, body) >= md);
      if (!covered && closest) {
        c.button(0, false);
        walkTo(bot, body, 1.6);
        if (md < 2.2) botReviving.add(bot.id);
        return;
      }
    }
    if (target) {
      const dist = dist2(target.position, bot.position);
      // A new target: a beat before the first shot. Then a wobble in the aim that grows with the range, new every third of a second.
      if (clock.target !== target.id) [clock.target, clock.react, clock.burst] = [target.id, game.rng.range(BOT_AIM.react[0], BOT_AIM.react[1]), Math.round(game.rng.range(BOT_AIM.burst[0], BOT_AIM.burst[1]))];
      clock.react -= dt;
      clock.errT -= dt;
      if (clock.errT <= 0) {
        const r = (BOT_AIM.wobble + dist * BOT_AIM.perBlock) * (0.8 + 0.5 * ((hash(bot.name) % 100) / 100));
        clock.errT = 0.35;
        clock.err = { x: game.rng.range(-r, r), y: game.rng.range(-r * 0.6, r * 0.6), z: game.rng.range(-r, r) };
      }
      aimAt(bot, { x: target.position.x + clock.err.x, y: target.position.y + 1.1 + clock.err.y, z: target.position.z + clock.err.z }, dt, BOT_AIM.turn);
      c.hold('KeyW', dist > 14);
      c.hold('KeyS', dist < 4.5);
      c.hold('Space', false);
      if (clock.react <= 0 && dist < BOT_AIM.range && clock.fire <= 0) {
        c.click(0);
        clock.fire = 0.12;
        if (--clock.burst <= 0) {
          clock.burst = Math.round(game.rng.range(BOT_AIM.burst[0], BOT_AIM.burst[1]));
          clock.fire = game.rng.range(BOT_AIM.pause[0], BOT_AIM.pause[1]);
        }
      }
      return;
    }
    c.button(0, false);
    c.hold('KeyS', false);
    if (clock.reload <= 0) {
      clock.reload = 4;
      c.press('KeyR');
    }
    walkTo(bot, GATES[index % GATES.length], 1.5);
    return;
  }

  // Day: patch the wall.
  c.button(0, false);
  c.hold('KeyS', false);
  const gap = gapFor(game, index, count);
  if (!gap) {
    walkTo(bot, GATES[index % GATES.length], 1.5);
    return;
  }
  const dist = walkTo(bot, { x: gap.x + 0.5, y: bot.eye.y, z: gap.z + 0.5 }, 4);
  if (dist <= 5 && clock.build <= 0) {
    clock.build = 3 + game.rng.next() * 1.5; // a block every few seconds: a wall takes days to go up
    for (const y of [BASE + 1, BASE + 2]) if (build.placeBlock(gap.x, y, gap.z, wallBlock(), bot)) break;
  }
}

// -------------------------------------------------------------------------------------------------
// Going down, and getting back up
// -------------------------------------------------------------------------------------------------

function goDown(game: GameContext, p: Player) {
  if (downed.has(p.id)) return;
  const body = game.entities.spawn('downed', { x: p.position.x, y: p.position.y, z: p.position.z });
  body.glow('#ff3b30');
  downed.set(p.id, { player: p, body, progress: 0 });
  p.spectate(true);
  if (!p.bot) p.hud.toast('You are down: a teammate can revive you');
}

function standUp(p: Player, at: Vec3, health: number) {
  p.spectate(false);
  p.revive();
  p.teleport(at);
  p.health = Math.min(p.maxHealth, health);
}

/** Teammates holding E (or a bot's revive) over the fallen bring them back. */
function updateRevives(game: GameContext, dt: number) {
  const holding = new Set<string>();
  for (const [id, d] of downed) {
    if (!d.body.alive) {
      downed.delete(id);
      continue;
    }
    let reviver: Player | null = null;
    for (const p of game.players) {
      if (p === d.player || !standing(p) || dist2(p.position, d.body.position) > 2.6) continue;
      if (p.bot ? botReviving.has(p.id) : p.input.isDown('KeyF')) {
        reviver = p;
        break;
      }
    }
    if (!reviver) {
      d.progress = Math.max(0, d.progress - dt * 2);
      continue;
    }
    holding.add(reviver.id);
    d.progress += dt / REVIVE_SECONDS;
    if (!reviver.bot) reviver.hud.progress(Math.min(1, d.progress));
    if (d.progress < 1) continue;
    standUp(d.player, d.body.position, 50);
    d.body.remove();
    downed.delete(id);
    earn(reviver, 15);
    bump(revives, reviver);
    if (!reviver.bot) {
      reviver.hud.progress(null);
      if ((revives.get(reviver.id) ?? 0) >= 3) reviver.achieve('medic');
    }
    game.audio.play('pickup', { at: d.player.position, volume: 0.7 });
    game.hud.toast(`${reviver.name} revived ${d.player.name}`);
  }
  for (const p of game.players) if (!p.bot && !holding.has(p.id)) p.hud.progress(null);
}

// -------------------------------------------------------------------------------------------------
// The days and nights
// -------------------------------------------------------------------------------------------------

function dawn(game: GameContext) {
  game.players.forEach((p) => !p.bot && p.achieve('first_night'));
  if (night >= NIGHTS) {
    phase = 'over';
    game.players.forEach((p) => !p.bot && p.achieve('all_nights'));
    game.fx.fireworks(VIP, 4);
    game.audio.play('victory');
    game.hud.screen({
      title: 'Extraction complete',
      tone: 'victory',
      buttons: [
        { label: 'Run it again', primary: true, onClick: () => game.restart() },
        { label: 'Switch game', onClick: () => game.exit() },
      ],
    });
    return;
  }
  phase = 'day';
  dayLeft = DAY_SECONDS;
  game.env.time = 0.5;
  vipHp = Math.min(VIP_HP, vipHp + 30);
  const bonus = 40 + night * 15;
  for (const d of downed.values()) {
    d.body.remove();
    standUp(d.player, { x: 4.5, y: BASE + 1.05, z: 4.5 }, d.player.maxHealth);
  }
  downed.clear();
  for (const p of game.players) {
    p.heal(p.maxHealth);
    p.inventory.give('planks', 16);
    refill(game, p);
    earn(p, bonus);
  }
  game.hud.banner(`Day ${night + 1}`, `+${bonus} gold · restock, fortify and patch the walls`);
}

function nightfall(game: GameContext) {
  night++;
  phase = 'night';
  toSpawn = zombieCount(night);
  waveQueue = planWave(game, night);
  spawnTimer = 0;
  game.env.time = 0.03;
  for (const p of game.players) {
    menus.get(p.id)?.close();
    equip(p); // weapon in hand, not building blocks
  }
  midDrop = false;
  nightT = 0;
  game.audio.play('siren');
  dropCrates(game);
  game.hud.banner(`Night ${night}`, 'Protect the VIP');
}

function lose(game: GameContext, why: string) {
  phase = 'over';
  game.entities.clear();
  downed.clear();
  for (const p of game.players) p.spectating && p.spectate(false);
  game.audio.play('defeat');
  game.hud.screen({
    title: why,
    tone: 'defeat',
    buttons: [
      { label: 'Try again', primary: true, onClick: () => game.restart() },
      { label: 'Switch game', onClick: () => game.exit() },
    ],
  });
}

export default defineServer(shared, {
  items: [guns()],
  setup(game) {
    for (const [id, def] of Object.entries(WEAPONS)) game.items.define(id, def);
    for (const [id, m] of Object.entries(MATERIALS)) game.items.define(id, { kind: 'misc', name: m.name, icon: { block: m.block } });
    // A can of ammo, dropped in the night: walking into it refills every gun you carry.
    game.items.define('ammo_crate', {
      kind: 'misc',
      name: 'Ammo crate',
      onPickup(g, _count, player) {
        refill(g, player);
        g.audio.play('pickup', { at: player.position, volume: 0.6 });
        if (!player.bot) player.hud.toast('Ammo restocked');
        return true;
      },
    });

    const body = Models.humanoid({ skin: Skins.player });
    // The hostiles dress in black and grey, against the operators' olive.
    const foe = (id: string, name: string, look: Look, def: { health: number; speed: number; ai: Behavior; held?: string; scale?: number }) =>
      game.entities.define(id, {
        name,
        model: Models.character(look, { scale: def.scale }),
        hitbox: { width: 0.6 * (def.scale ?? 1), height: 1.95 * (def.scale ?? 1) },
        health: def.health,
        speed: def.speed,
        ai: def.ai,
        held: def.held,
        drops: [],
      });
    foe('rifleman', 'Rifleman', { build: 'broad', skin: '#b88a64', hair: 'buzz', hairColor: '#2a1d14', facialHair: 'stubble', face: 'shades', top: 'tunic', topColor: '#4a4d3a', accent: '#2f3226', bottom: 'trousers', bottomColor: '#3c3f2e', shoes: 'boots', shoeColor: '#17181a', hat: 'cap', ragged: true }, { health: 60, speed: 2.8, ai: gunman({ range: 20, damage: 6, cooldown: 0.9, spread: 0.07, vipDamage: 2 }), held: 'rifle' });
    foe('assaulter', 'Assaulter', { build: 'slim', skin: '#d2a47e', hair: 'buzz', hairColor: '#1b1410', facialHair: 'beard', face: 'shades', top: 'hoodie', topColor: '#26282b', accent: '#6b1a1a', bottom: 'trousers', bottomColor: '#2d2f33', shoes: 'boots', shoeColor: '#111111', hat: 'cap', ragged: true }, { health: 55, speed: 3.4, ai: gunman({ range: 14, damage: 5, cooldown: 0.45, spread: 0.1, vipDamage: 1.5 }), held: 'smg' });
    foe('heavy', 'Heavy Gunner', { build: 'heavy', skin: '#9c6f4e', facialHair: 'beard', hair: 'crew', hairColor: '#1a1410', face: 'shades', top: 'tunic', topColor: '#3a3c33', accent: '#25271f', bottom: 'trousers', bottomColor: '#2c2e26', shoes: 'boots', shoeColor: '#111111', hat: 'cap', ragged: true }, { health: 220, speed: 2.0, scale: 1.15, ai: gunman({ range: 12, damage: 5, cooldown: 0.3, spread: 0.12, vipDamage: 2 }), held: 'lmg' });
    foe('demo', 'Demolitions', { build: 'slim', skin: '#c79a76', hair: 'short', hairColor: '#3a2a1a', facialHair: 'stubble', face: 'specs', top: 'tunic', topColor: '#6b6244', accent: '#4a432c', bottom: 'trousers', bottomColor: '#4a4538', shoes: 'boots', shoeColor: '#222222', hat: 'cap', ragged: true }, { health: 55, speed: 3.6, ai: demolitionsAI, held: 'pistol' });
    game.entities.define('charge', { name: 'C4', model: Models.gltf(C4_URL), hitbox: { width: 0.7, height: 0.45 }, health: 12, speed: 0, ai: chargeAI, drops: [] });
    game.entities.define('turret', { name: 'Sentry', model: body, hitbox: { width: 0.5, height: 1.2 }, health: 1, speed: 0, invulnerable: true, ai: turretAI });
    game.entities.define('merchant', { name: 'Quartermaster', model: body, hitbox: { width: 0.6, height: 1.95 }, health: 1, speed: 0, invulnerable: true });
    // The VIP: a man in a suit, kept in the command post. (He can't be hurt as an entity; the hostiles wear his health down by what they hit.)
    game.entities.define('vip', { name: 'VIP', model: Models.character({ build: 'slim', skin: '#e0b08c', hair: 'slick', hairColor: '#2a2a2a', face: 'plain', top: 'suit', topColor: '#262b3a', accent: '#8a1c1c', bottom: 'trousers', bottomColor: '#1d2030', shoes: 'shoes', shoeColor: '#111111' }), hitbox: { width: 0.6, height: 1.9 }, health: 1, speed: 0, invulnerable: true });
    game.entities.define('downed', { name: 'Downed', model: body, hitbox: { width: 0.6, height: 1.0 }, health: 1, speed: 0, invulnerable: true });

    // The team's bots hit softer than a person does.
    game.events.on('damage', (hit) => {
      const by = hit.source;
      if (by && by !== 'world' && by.kind === 'player' && by.bot && hit.cause === 'gun') hit.amount *= BOT_DAMAGE;
    });
    talk = interactions(game, { merchant: (_keeper, player) => openShop(game, player) });
    build = building(game, {
      blockOf: (item) => MATERIALS[item]?.block ?? null,
      canBreak: (at) => placed.has(key(at.x, at.y, at.z)),
      canPlace: (at) => Math.hypot(at.x, at.z) < FIELD_RADIUS - 4,
    });
    game.events.on('blockPlace', ({ x, y, z, by }) => by !== 'world' && by.kind === 'player' && placed.add(key(x, y, z)));
    game.events.on('entityDeath', ({ entity, killer }) => {
      if (!(entity.type in BOUNTY)) return;
      if (!killer || killer === 'world' || killer.kind !== 'player') return;
      earn(killer, BOUNTY[entity.type]);
      if (entity.type !== 'charge') bump(kills, killer);
    });
    game.events.on('playerJoin', ({ player }) => {
      giveKit(player);
      if (!player.bot) balanceBots(game);
    });
    game.events.on('playerLeave', ({ player }) => {
      menus.delete(player.id);
      botClock.delete(player.id);
      const d = downed.get(player.id);
      if (d) {
        d.body.remove();
        downed.delete(player.id);
      }
      balanceBots(game);
    });
    game.events.on('playerDeath', ({ player }) => {
      if (phase !== 'night') return;
      goDown(game, player);
      if (!game.players.some((p) => p.alive)) lose(game, 'The team is down');
    });
    game.commands.register('shop', { help: 'Open the quartermaster', run: (_args, g, p) => openShop(g, p) });

    // A small leaderboard in the top-right corner: kills, revives and gold, you picked out, the downed in red.
    game.hud.define('squad', {
      at: 'top-right',
      html: `<div class="board"><div class="row head"><span class="n">Operators</span><span>K</span><span>R</span><span>$</span></div><div class="row {{cls}}" data-each="rows"><span class="n">{{name}}</span><span>{{kills}}</span><span>{{revives}}</span><span>{{gold}}</span></div></div>`,
      css: `:scope { margin: 10px 12px 0 0 }
            .board { min-width: 150px; padding: 5px 8px; border-radius: 8px; background: rgba(10, 13, 20, 0.5); color: #dfe3ea; font: 600 11px var(--sans) }
            .row { display: grid; grid-template-columns: 1fr 26px 26px 34px; gap: 4px; line-height: 1.5; text-align: right }
            .row .n { text-align: left; overflow: hidden; text-overflow: ellipsis; white-space: nowrap }
            .head { color: #8f98a6; font-size: 10px; letter-spacing: 0.04em; text-transform: uppercase }
            .me { color: #ffd166 } .down { color: #ff6b5e; opacity: 0.8 }`,
    });
    game.hud.define('siege', {
      at: 'top',
      html: `<div class="pill"><b>{{label}}</b><span>{{left}}</span><span class="hp">VIP {{vip}}</span><span class="gold">{{gold}} gold</span></div>`,
      css: `.pill { display: flex; align-items: center; gap: 14px; padding: 6px 16px; border-radius: 999px;
                    background: rgba(10, 13, 20, 0.55); color: #f2f4f8; font: 600 15px var(--sans) }
            .hp { color: #ff8a8a } .gold { color: #ffd166 }`,
    });
  },

  start(game) {
    phase = 'day';
    night = 0;
    dayLeft = DAY_SECONDS + 15;
    vipHp = VIP_HP;
    toSpawn = 0;
    boardTimer = 0;
    placed.clear();
    bashed.clear();
    [boundT, boundTeam, breach, radioAt, waveQueue, ambT] = [0, 0, null, -99, [], 0];
    menus.clear();
    botClock.clear();
    downed.clear();
    kills.clear();
    revives.clear();
    game.env.time = 0.5;
    for (const p of game.players) giveKit(p);
    balanceBots(game);
    game.entities.spawn('merchant', { x: -6.5, y: BASE + 1.05, z: 2.5 }, { yaw: Math.PI / 2 });
    game.entities.spawn('vip', { x: VIP.x, y: BASE + 1.05, z: VIP.z }, { yaw: Math.PI });
    game.hud.banner('Siege Night', 'Fortify the base, then protect the VIP');
  },

  update(game, dt) {
    talk.update(); // first, so right-clicking the quartermaster wins over placing a block
    ambT -= dt;
    if (ambT <= 0) {
      ambT = phase === 'night' ? 2 + game.rng.next() * 4 : 12 + game.rng.next() * 12;
      const a = game.rng.next() * Math.PI * 2;
      const r = 45 + game.rng.next() * 30;
      game.audio.play(game.rng.next() < 0.6 ? 'distant_boom' : 'distant_crackle', { at: { x: Math.cos(a) * r, y: BASE + 2, z: Math.sin(a) * r }, volume: 0.6 + game.rng.next() * 0.4 });
    }
    boundT -= dt;
    if (boundT <= 0) [boundT, boundTeam] = [3.5 + game.rng.next() * 2.5, boundTeam ^ 1];
    build.update(dt);
    botReviving.clear();
    const bots = game.players.filter(isBot);
    bots.forEach((b, i) => driveBot(game, b, i, bots.length, dt));
    if (phase === 'over') return;
    updateRevives(game, dt);

    if (vipHp <= 0) return lose(game, 'The VIP is down');

    let left = '';
    if (phase === 'day') {
      dayLeft -= dt;
      left = `Nightfall in ${Math.max(0, Math.ceil(dayLeft))}s`;
      if (dayLeft <= 0) nightfall(game);
    } else {
      spawnTimer -= dt;
      const alive = enemies(game);
      if (toSpawn > 0 && spawnTimer <= 0 && alive < 14) {
        const a = game.rng.range(0, Math.PI * 2);
        const type = waveQueue.shift() ?? 'rifleman';
        const sx = Math.cos(a) * FIELD_RADIUS;
        const sz = Math.sin(a) * FIELD_RADIUS;
        const unit = game.entities.spawn(type, { x: sx, y: game.world.surfaceY(sx, sz) + 1.05, z: sz });
        if (type === 'heavy') unit.armor = 8;
        toSpawn--;
        spawnTimer = 0.8;
      }
      if (!midDrop && toSpawn <= zombieCount(night) / 2) {
        midDrop = true;
        dropCrates(game);
      }
      nightT += dt;
      if (toSpawn === 0 && nightT > NIGHT_MAX && enemies(game) > 0) {
        for (const e of game.entities.all()) if (ENEMY_TYPES.includes(e.type) || e.type === 'charge') e.remove();
        game.hud.toast('The hostiles are pulling back.');
      }
      const remaining = toSpawn + enemies(game);
      left = `${remaining} hostiles`;
      if (remaining === 0) dawn(game);
    }
    const label = phase === 'day' ? `Day ${night + 1}` : `Night ${night}`;
    for (const p of game.players) if (!p.bot) p.hud.widget('siege', { label, left, vip: Math.ceil(vipHp), gold: goldOf(p) });

    // The scoreboard, kept up in the corner.
    boardTimer -= dt;
    if (boardTimer <= 0) {
      boardTimer = 0.5;
      const rows = game.players.map((p) => ({ id: p.id, name: p.name, kills: kills.get(p.id) ?? 0, revives: revives.get(p.id) ?? 0, gold: goldOf(p), down: !standing(p) }));
      for (const viewer of game.players) {
        if (viewer.bot) continue;
        viewer.hud.widget('squad', { rows: rows.map((r) => ({ ...r, cls: r.id === viewer.id ? (r.down ? 'me down' : 'me') : r.down ? 'down' : '' })) });
      }
    }
  },
});
