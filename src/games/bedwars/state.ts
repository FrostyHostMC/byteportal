import type { Actor, Entity, GameContext, Pickup, Player, Vec3 } from '@platform';
import type { TeamBase, TeamColor } from './map';
import type { PlacedMap } from './world';

export const TEAM_STYLE: Record<TeamColor, { name: string; css: string; wool: string }> = {
  red: { name: 'Red', css: '#ff5b5b', wool: 'red_wool' },
  blue: { name: 'Blue', css: '#5d8dff', wool: 'blue_wool' },
  green: { name: 'Green', css: '#58e06b', wool: 'green_wool' },
  yellow: { name: 'Yellow', css: '#ffd84a', wool: 'yellow_wool' },
};

export type Currency = 'iron' | 'gold' | 'diamond' | 'emerald';
export type Wallet = Record<Currency, number>;
export const CURRENCIES: Currency[] = ['iron', 'gold', 'diamond', 'emerald'];
export const CURRENCY_NAME: Record<Currency, [string, string]> = {
  iron: ['Iron', 'Iron'],
  gold: ['Gold', 'Gold'],
  diamond: ['Diamond', 'Diamonds'],
  emerald: ['Emerald', 'Emeralds'],
};

/** Armour points per tier (leather, iron, diamond); each Reinforced Armor level adds 1.5. */
export const ARMOR = [4, 10, 14];
/** Sword damage per tier (wood, stone, iron, diamond). */
export const SWORD = [4, 5, 6, 7];
export const SWORD_ITEMS = ['wooden_sword', 'stone_sword', 'iron_sword', 'diamond_sword'];
/** The sword item a team's member gets at this tier: the sharpened kind once the team has the upgrade. */
export const swordItem = (t: Team, tier: number) => SWORD_ITEMS[tier] + (t.sharp ? '_sharp' : '');
export const ALL_SWORDS = SWORD_ITEMS.flatMap((s) => [s, `${s}_sharp`]);
export const PICK_ITEMS = ['', 'wooden_pickaxe', 'iron_pickaxe', 'diamond_pickaxe'];

export const RESPAWN_SECONDS = 5;
export const SUDDEN_DEATH_AT = 10 * 60;

/**
 * One place on a team: a person, or a bot while nobody's in it. What's theirs alone goes with the
 * place (a person taking over from a bot carries on with its wallet and gear): the wallet, the
 * gear they bought, the score and when they come back.
 */
export interface Member {
  team: Team;
  /** Which place on the team (0 first): the bot's name. */
  seat: number;
  /** The person playing it, or null: a bot plays it (if there's a `body`), or nobody does. */
  player: Player | null;
  /** The bot's body while it is alive. */
  body: Entity | null;
  /** When they come back after dying (null: alive, or gone for good). */
  respawnAt: number | null;
  /** Died with the bed gone: out for good. */
  out: boolean;
  wallet: Wallet;
  /** Permanent gear (kept through deaths). */
  armor: number;
  pick: number;
  shears: boolean;
  sword: number;
  /** Fireballs a bot is carrying. */
  fireballs: number;
  kills: number;
  finals: number;
  beds: number;
  /** Last enemy to hit them (kill credit for void deaths). */
  lastHit: { by: Member; at: number } | null;
}

export interface Team {
  color: TeamColor;
  name: string;
  css: string;
  wool: string;
  base: TeamBase;
  members: Member[];
  bed: boolean;
  eliminated: boolean;
  /** Team upgrades. */
  sharp: boolean;
  prot: number;
  heal: boolean;
}

export const emptyWallet = (): Wallet => ({ iron: 0, gold: 0, diamond: 0, emerald: 0 });

export function armorPoints(m: Member): number {
  return Math.min(20, ARMOR[m.armor] + m.team.prot * 1.5);
}

export function swordDamage(m: Member, tier = m.sword): number {
  return SWORD[tier] + (m.team.sharp ? 1 : 0);
}

/**
 * Seconds to mine a block. `pick` is the pickaxe tier in hand (0 = none); shears cut wool fast.
 * Only blocks placed during the match (and beds) can be broken at all (see `Match.canBreak`).
 */
export function mineTime(block: string, pick: number, shears: boolean): number {
  if (block.endsWith('_bed')) return 0.55;
  if (block.endsWith('_wool')) return shears ? 0.12 : 0.6;
  if (block === 'oak_planks') return [2.2, 1.3, 0.8, 0.55][pick];
  if (block === 'end_stone') return [9, 1.6, 0.9, 0.55][pick];
  if (block === 'obsidian') return [40, 30, 16, 6][pick];
  return [5, 1.4, 0.9, 0.6][pick];
}

/** Resources piling up at a generator: one pickup whose count grows, so a pile stays one object. */
export class Pile {
  count = 0;
  private pickup: Pickup | null = null;
  constructor(
    readonly item: Currency,
    readonly at: Vec3,
    readonly cap: number,
    private beam?: string,
  ) {}

  add(game: GameContext, n: number) {
    const next = Math.min(this.cap, this.count + n);
    if (next === this.count) return;
    this.count = next;
    this.pickup?.remove();
    this.pickup = game.items.spawnPickup(this.item, { x: this.at.x, y: this.at.y + 0.35, z: this.at.z }, { count: this.count, beam: this.beam, despawn: 1e9 });
  }

  /** Notice the player walking off with it. */
  sync() {
    if (this.pickup && !this.pickup.alive) {
      this.pickup = null;
      this.count = 0;
    }
  }

  take(): number {
    const n = this.count;
    this.count = 0;
    this.pickup?.remove();
    this.pickup = null;
    return n;
  }

  reset() {
    this.pickup?.remove();
    this.pickup = null;
    this.count = 0;
  }
}

const key = (x: number, y: number, z: number) => `${x},${y},${z}`;

function newMember(team: Team, seat: number): Member {
  return { team, seat, player: null, body: null, respawnAt: null, out: false, wallet: emptyWallet(), armor: 0, pick: 0, shears: false, sword: 0, fireballs: 0, kills: 0, finals: 0, beds: 0, lastHit: null };
}

function newTeam(base: TeamBase, size: number): Team {
  const t: Team = { color: base.color, ...TEAM_STYLE[base.color], base, members: [], bed: true, eliminated: false, sharp: false, prot: 0, heal: false };
  for (let seat = 0; seat < size; seat++) t.members.push(newMember(t, seat));
  return t;
}

/** Everything about the match in progress that the game, the shop and the bots share. */
export class Match {
  map: PlacedMap;
  teams: Team[];
  /** Places on each team this match. */
  size = 1;
  /** Waiting in the lobby: no match on yet. */
  lobby = true;
  /** Blocks placed during the match: the only ones (besides beds) that can be broken. */
  readonly placed = new Set<string>();
  piles: Pile[] = [];
  startedAt = 0;
  over = false;
  suddenDeath = false;
  /** Seconds each diamond / emerald generator waits between drops (they speed up). */
  diamondEvery = 30;
  emeraldEvery = 60;
  diamondTier = 1;
  emeraldTier = 1;

  constructor(
    readonly game: GameContext,
    map: PlacedMap,
  ) {
    this.map = map;
    this.teams = map.teams.map((b) => newTeam(b, 1));
  }

  get now(): number {
    return this.game.clock.now - this.startedAt;
  }

  /** Back to the lobby over `map`: no match, nobody on any team. */
  toLobby(map: PlacedMap) {
    for (const p of this.piles) p.reset();
    this.piles = [];
    this.map = map;
    this.teams = map.teams.map((b) => newTeam(b, 1));
    this.lobby = true;
    this.over = false;
    this.placed.clear();
  }

  /** A new match on the lobby's map, `size` places a team, all empty till they're filled. */
  begin(size: number) {
    this.size = size;
    this.teams = this.map.teams.map((b) => newTeam(b, size));
    this.placed.clear();
    this.startedAt = this.game.clock.now;
    this.lobby = false;
    this.over = false;
    this.suddenDeath = false;
    this.diamondEvery = 30;
    this.emeraldEvery = 60;
    this.diamondTier = 1;
    this.emeraldTier = 1;
  }

  /** Every place on every team. */
  members(): Member[] {
    return this.teams.flatMap((t) => t.members);
  }

  /** The place a player is playing, or null (in the lobby, or watching). */
  memberOf(p: Player): Member | null {
    for (const t of this.teams) for (const m of t.members) if (m.player === p) return m;
    return null;
  }

  /** The first player's place (single-player shorthand, and handy in tests). */
  get player(): Member {
    return this.memberOf(this.game.player) ?? this.teams[0].members[0];
  }

  /** The place of whoever did something: a player's, or a bot's. */
  memberOfActor(by: Actor | undefined | null): Member | null {
    if (!by || by === 'world') return null;
    if (by.kind === 'player') return this.memberOf(by);
    for (const t of this.teams) for (const m of t.members) if (m.body === by) return m;
    return null;
  }

  /** The team of whoever did something (a bot that's since died still says whose it was). */
  teamOf(by: Actor | undefined | null): Team | null {
    const m = this.memberOfActor(by);
    if (m) return m.team;
    if (!by || by === 'world' || by.kind === 'player') return null;
    return this.teams.find((t) => t.color === (by as Entity).data.team) ?? null;
  }

  /** The team whose bed occupies this block, if any. */
  bedAt(at: Vec3): Team | null {
    return this.teams.find((t) => t.base.bed.some((b) => b.x === at.x && b.y === at.y && b.z === at.z)) ?? null;
  }

  isPlaced(x: number, y: number, z: number): boolean {
    return this.placed.has(key(x, y, z));
  }

  markPlaced(x: number, y: number, z: number, on: boolean) {
    if (on) this.placed.add(key(x, y, z));
    else this.placed.delete(key(x, y, z));
  }

  canBreak(at: Vec3, block: string, by: Actor): boolean {
    if (this.lobby || this.over) return false;
    if (block.endsWith('_bed')) {
      const owner = this.bedAt(at);
      if (!owner) return false;
      // Explosions don't take beds; nobody breaks their own.
      return by !== 'world' && this.teamOf(by) !== owner;
    }
    if (!this.isPlaced(at.x, at.y, at.z)) return false;
    // Fireballs only get through wool and wood.
    if (by === 'world') return block.endsWith('_wool') || block === 'oak_planks';
    return true;
  }

  canPlace(at: Vec3, _block: string, _by: Actor): boolean {
    if (this.lobby || this.over) return false;
    const m = this.map;
    if (at.y > m.center.y + 24 || at.y < m.voidY + 6) return false;
    // Keep shopkeepers and generators clear.
    const near = (p: Vec3, r: number) => Math.abs(at.x + 0.5 - p.x) < r && Math.abs(at.z + 0.5 - p.z) < r && at.y >= Math.floor(p.y) - 1 && at.y <= Math.floor(p.y) + 2;
    for (const t of this.teams) {
      if (near(t.base.shop, 1.6) || near(t.base.generator, 1.2)) return false;
    }
    for (const g of [...m.diamonds, ...m.emeralds]) if (near(g, 1.2)) return false;
    return true;
  }

  /** Teams still in it (not eliminated). */
  alive(): Team[] {
    return this.teams.filter((t) => !t.eliminated);
  }
}
