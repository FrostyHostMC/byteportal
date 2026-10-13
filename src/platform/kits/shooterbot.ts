import type { Bot, GameContext, Player, Vec3 } from '@platform';
import { isGun, isMelee } from '@platform/items';
import type { Guns, Throwables } from './items';
import type { NavCell, NavGrid } from './navgrid';

/**
 * Bot fighters for a shooter. Each drives a real player through its keyboard and mouse
 * (`bot.controls`), so it moves, aims and fires by the same rules a person does: it looks around,
 * spots whoever's in view (through a hole in a wall too), reacts after a beat, swings its aim on
 * (never perfectly), fires (bursts from an automatic, a shot at the gun's pace from anything
 * else), strafes, holds the range its gun likes, reloads, switches guns, and otherwise roams the
 * walking grid (`navGrid`) toward where it last saw someone or heard a shot, or somewhere worth
 * being. How good each one is comes from its skill (0..1); the game says how its weapons are
 * fought with and adds its own rules through hooks (an objective, a pickup, a dodge, a grenade).
 *
 * Built only on the public API, so copy it into your game and change anything.
 *
 * ```ts
 * const nav = navGrid(game, { bounds: MAP.bounds });
 * const bots = shooterBots(game, { nav, hotspots: MAP.hotspots, weapons: { rifle: { range: 16 }, shotgun: { range: 4, ads: false, rush: true } } });
 * game.events.on('playerJoin', ({ player }) => player.bot && bots.add(player as Bot, game.rng.range(0.3, 0.8)));
 * // update: bots.update(dt, phase !== 'playing');   after a respawn: bots.reset(player);
 * ```
 */
export function shooterBots(game: GameContext, opts: ShooterBotOptions = {}): ShooterBots {
  return new Brains(game, opts);
}

/** A number that goes with skill: `[a skill-0 bot's, a skill-1 bot's]`, and in between for the rest. */
export type BySkill = [unskilled: number, skilled: number];

/** How a weapon is fought with (`ShooterBotOptions.weapons`). A gun's rate of fire, magazine and full-auto come from its item. */
export interface BotWeapon {
  /** The distance it likes to fight at, in blocks: it closes in from further, and backs off from much nearer. Default `moves.range`. */
  range?: number;
  /** Down the sights: always (true), never (false), or beyond this many blocks. Default 9 for a gun. */
  ads?: boolean | number;
  /** Only fire once it's down the sights (a scoped rifle; a slow gun that has to count). Default false. */
  steady?: boolean;
  /** Rush in with it, sprinting (and sliding, if `moves.slide`): a shotgun, an SMG, a blade. */
  rush?: boolean;
}

/** Aim and reactions, by skill. The defaults are Call of Blocky's (tuned so a bot is a good deal slower than a person). */
export interface BotAim {
  /** Seconds to react to someone it's just seen, before its aim moves at all; plus up to `reactionRandom` more. Default [0.83, 0.38]. */
  reaction: BySkill;
  reactionRandom: number;
  /** How far off its first swing of aim is, in blocks at the target. Default [3.1, 1.1]. */
  miss: BySkill;
  /** Its chance of going for the head. Default [0, 0.18]. */
  head: BySkill;
  /** How fast its aim settles on while it tracks (the error shrinks by e^-settle each second). Default [0.6, 2]. */
  settle: BySkill;
  /** How far a moving target drags its aim behind (seconds of the target's movement, a second). Default [0.3, 0.08]. */
  drag: BySkill;
  /** Shake in its aim, in blocks at the target, plus `hipShake` from the hip (`aimedShake` down the sights) and `moveShake` for each block a second the target moves. Default [0.4, 0]. */
  shake: BySkill;
  hipShake: number;
  aimedShake: number;
  moveShake: number;
  /** How fast it turns its aim, radians a second. Default [2.4, 8.4]. */
  turn: BySkill;
  /** How near its aim has to be to fire: within a body this wide (blocks) at the target, plus 0.02 radians. Default [0.95, 0.55]. */
  tolerance: BySkill;
  /** Time between shots from a gun that isn't automatic, as a multiple of the gun's own; plus up to `paceRandom` seconds. Default [1.85, 1.05]. */
  pace: BySkill;
  paceRandom: number;
}

/** What it sees and hears. */
export interface BotSenses {
  /** The furthest it sees anyone, in blocks. Default 90. */
  sight: number;
  /** How wide it sees: someone is noticed if the cosine of their angle off where it looks is at least this. Default 0.35 (about 70° each side). */
  view: number;
  /** It notices anyone this near, whichever way it faces. Default 5. */
  near: number;
  /** It hears a gunshot this far away (in blocks), and turns to it. Default 40. */
  hearing: number;
  /** Seconds it goes after a shot it heard, and after where it last saw someone. Default 4 and 6. */
  chaseHeard: number;
  chaseSeen: number;
}

/** How it moves: fighting, and roaming between fights. */
export interface BotMoves {
  /** The range it holds when its weapon doesn't say. Default 12. */
  range: number;
  /** It closes in beyond `range * keep[0]` and backs off inside `range * keep[1]`. Default [1.25, 0.6]. */
  keep: [closer: number, back: number];
  /** Seconds of each strafe (left, right or still), from and to. Default [0.35, 1.25]. */
  strafe: [number, number];
  /** Its chance, at each new strafe, of a hop (times its skill), and of crouching (while aiming). Default 0.18 and 0.2. */
  hop: number;
  crouch: number;
  /** Slides now and then when sprinting (`movement.slide`). Default true. */
  slide: boolean;
  /** Its chance of heading for one of the `hotspots` rather than anywhere at all when it wanders. Default 0.55. */
  hotspot: number;
  /** Seconds it keeps to a place it's wandering to, from and to. Default [8, 18]. */
  wander: [number, number];
  /** Seconds between plans (it plans its way again this often), from and to. Default [2, 3]. */
  replan: [number, number];
  /** How far its look sways from side to side as it walks, in radians. Default 0.25. */
  glance: number;
  /** Swap to another loaded gun when the one in hand runs dry with the target this near (else reload). Default 14. */
  swapWithin: number;
  /** Between fights: the hotbar slot it goes back to (null: stays with what it has), and it reloads below this much of a magazine. Default 0 and 0.5. */
  homeSlot: number | null;
  topUp: number;
  /** Its chance each tick of pressing reload when it tops up (a gun loaded a round at a time needs one press). Default 1. */
  topUpChance: number;
}

export interface ShooterBotOptions {
  /** The walking grid it roams on (`navGrid`), or a function giving it. Without one it fights where it stands and turns toward shots. */
  nav?: NavGrid | (() => NavGrid | null) | null;
  /** How each weapon is fought with, by item id. Anything left out is fought with the defaults. */
  weapons?: Record<string, BotWeapon>;
  /** Places worth drifting toward when there's nothing better to do (where fights happen). */
  hotspots?: Vec3[];
  aim?: Partial<BotAim>;
  senses?: Partial<BotSenses>;
  moves?: Partial<BotMoves>;
  /** Whether `other` is fair game (teams). Default: everyone else. */
  hostile?(bot: Bot, other: Player): boolean;
  /**
   * Somewhere to go when nobody's in sight, before its own ideas (a shot it heard, where it last
   * saw someone, wandering): an objective, a pickup when it's low, the nearest enemy. Asked each
   * time it plans (`moves.replan`); null for its own ideas.
   */
  goal?(bot: Bot, mind: BotMind): Vec3 | null;
  /** The weapon to fight with now (by item id), or null for the one in hand. It switches if that one's loaded. */
  weapon?(bot: Bot, mind: BotMind, distance: number): string | null;
  /** Each tick of a fight, after it has decided what to do: the game's own moves (a dodge roll when hit). */
  fight?(bot: Bot, mind: BotMind, distance: number): void;
  /**
   * Throw something (a grenade) at a point, the game's way; return whether it did. Asked now and
   * then when someone it was fighting has ducked out of sight not far off (`throwEvery` seconds
   * apart at most).
   */
  throw?(bot: Bot, at: Vec3, mind: BotMind): boolean;
  /** Seconds between throws at most. Default 10. */
  throwEvery?: number;
}

/** What a bot has in mind (for the hooks). */
export interface BotMind {
  readonly bot: Bot;
  /** 0..1. */
  readonly skill: number;
  /** Who it's fighting (in sight now), if anyone. */
  readonly target: Player | null;
  /** Where it last saw whoever it was fighting, and when (`game.clock.now`). */
  readonly lastSeen: Vec3 | null;
  readonly lastSeenAt: number;
  /** The last gunshot it heard: where the shooter was, and when. */
  readonly heard: { at: Vec3; t: number } | null;
  /** When it was last hit (-99 if not yet). */
  readonly hurtAt: number;
  /** Which way it's strafing: -1 left, 0 not, 1 right. */
  readonly strafe: number;
  /** Where it's going when it roams, and its way there. */
  readonly goal: Vec3 | null;
  readonly path: readonly NavCell[] | null;
}

export interface ShooterBots {
  /** A bot to drive, and how good it is (0..1). */
  add(bot: Bot, skill: number): void;
  remove(bot: Player): void;
  /** A fresh life or a new round: aim, plans and timers start over, facing the way it stands. */
  reset(bot: Player): void;
  /** Drive them all (each tick). `frozen`: hands off the controls (a countdown, between rounds). */
  update(dt: number, frozen?: boolean): void;
  /** What a bot has in mind. */
  mind(bot: Player): BotMind | null;
  /** A noise worth looking into (an explosion, a door) at `at`, made by `by`: bots in earshot go to see. Gunshots they hear by themselves. */
  hear(at: Vec3, by?: Player | null): void;
  /** Stop listening to the game's events (shots, hits). */
  dispose(): void;
}

interface Brain extends BotMind {
  target: Player | null;
  yaw: number;
  pitch: number;
  /** Seconds until it reacts to a new target. */
  react: number;
  /** Aim error (blocks at the target), settling while it tracks. */
  err: Vec3;
  head: boolean;
  /** How much of its target it can see: all of it, or only the head (over cover, through a hole). */
  seen: 'body' | 'head';
  lastSeen: Vec3 | null;
  lastSeenAt: number;
  heard: { at: Vec3; t: number } | null;
  hurtAt: number;
  path: NavCell[] | null;
  step: number;
  goal: Vec3 | null;
  replan: number;
  strafe: number;
  strafeT: number;
  crouchT: number;
  nextShot: number;
  /** Automatic fire comes in bursts: seconds left of this one, and of the pause after it. */
  burst: number;
  pause: number;
  stuckT: number;
  stuckAt: Vec3;
  wander: number;
  slideCool: number;
  thrownAt: number;
  /** The grid's `opened` when it last planned: a new way since, and it plans again. */
  opened: number;
}

const AIM: BotAim = {
  reaction: [0.83, 0.38],
  reactionRandom: 0.25,
  miss: [3.1, 1.1],
  head: [0, 0.18],
  settle: [0.6, 2],
  drag: [0.3, 0.08],
  shake: [0.4, 0],
  hipShake: 0.25,
  aimedShake: 0.05,
  moveShake: 0.04,
  turn: [2.4, 8.4],
  tolerance: [0.95, 0.55],
  pace: [1.85, 1.05],
  paceRandom: 0.15,
};

const SENSES: BotSenses = { sight: 90, view: 0.35, near: 5, hearing: 40, chaseHeard: 4, chaseSeen: 6 };

const MOVES: BotMoves = {
  range: 12,
  keep: [1.25, 0.6],
  strafe: [0.35, 1.25],
  hop: 0.18,
  crouch: 0.2,
  slide: true,
  hotspot: 0.55,
  wander: [8, 18],
  replan: [2, 3],
  glance: 0.25,
  swapWithin: 14,
  homeSlot: 0,
  topUp: 0.5,
  topUpChance: 1,
};

/** A skill-dependent number for a bot of skill `s`. */
const at = ([a, b]: BySkill, s: number) => a + (b - a) * s;

class Brains implements ShooterBots {
  private brains = new Map<string, Brain>();
  private aim: BotAim;
  private senses: BotSenses;
  private moves: BotMoves;
  private offs: (() => void)[] = [];

  constructor(
    private game: GameContext,
    private opts: ShooterBotOptions,
  ) {
    this.aim = { ...AIM, ...opts.aim };
    this.senses = { ...SENSES, ...opts.senses };
    this.moves = { ...MOVES, ...opts.moves };
    const ev = game.events;
    this.offs.push(
      ev.on('shot', ({ player, from }) => this.heardShot(player, from)),
      ev.on('playerDamage', ({ player, source }) => this.hurt(player, source)),
      ev.on('playerLeave', ({ player }) => this.remove(player)),
    );
  }

  dispose() {
    for (const off of this.offs) off();
    this.offs = [];
  }

  private nav(): NavGrid | null {
    const n = this.opts.nav;
    const grid = typeof n === 'function' ? n() : (n ?? null);
    return grid?.ready ? grid : null;
  }

  add(bot: Bot, skill: number) {
    this.brains.set(bot.id, {
      bot,
      skill,
      yaw: bot.yaw,
      pitch: 0,
      target: null,
      react: 0,
      err: { x: 0, y: 0, z: 0 },
      head: false,
      seen: 'body',
      lastSeen: null,
      lastSeenAt: -99,
      heard: null,
      hurtAt: -99,
      path: null,
      step: 0,
      goal: null,
      replan: 0,
      strafe: 0,
      strafeT: 0,
      crouchT: 0,
      nextShot: 0,
      burst: 0,
      pause: 0,
      stuckT: 0,
      stuckAt: bot.position,
      wander: 0,
      slideCool: 0,
      thrownAt: -99,
      opened: 0,
    });
  }

  remove(bot: Player) {
    this.brains.delete(bot.id);
  }

  mind(bot: Player): BotMind | null {
    return this.brains.get(bot.id) ?? null;
  }

  reset(bot: Player) {
    const b = this.brains.get(bot.id);
    if (!b) return;
    // Timers too: a restart starts the game's clock again from 0.
    Object.assign(b, { yaw: bot.yaw, pitch: 0, target: null, path: null, goal: null, lastSeen: null, lastSeenAt: -99, heard: null, hurtAt: -99, nextShot: 0, wander: 0, thrownAt: -99 });
    b.bot.controls.look(b.yaw, 0);
  }

  hear(at: Vec3, by: Player | null = null) {
    this.noise(at, at, by);
  }

  /** Someone fired: bots in earshot turn toward the shooter. */
  private heardShot(shooter: Player, from: Vec3) {
    this.noise(from, shooter.position, shooter);
  }

  /** A noise at `from`: bots in earshot (not whoever made it) go to see, at `at`. */
  private noise(from: Vec3, at: Vec3, by: Player | null) {
    const now = this.game.clock.now;
    for (const b of this.brains.values()) {
      if (b.bot === by || !b.bot.alive) continue;
      const p = b.bot.position;
      if (Math.hypot(p.x - from.x, p.z - from.z) < this.senses.hearing) b.heard = { at: { ...at }, t: now };
    }
  }

  /** Hit: it knows where from, even if it didn't hear the shot. */
  private hurt(bot: Player, by: unknown) {
    const b = this.brains.get(bot.id);
    if (!b) return;
    b.hurtAt = this.game.clock.now;
    const from = by as Player | null;
    if (!b.target && from && from.kind === 'player' && from !== bot) b.heard = { at: { ...from.position }, t: b.hurtAt };
  }

  update(dt: number, frozen = false) {
    for (const b of this.brains.values()) {
      if (frozen || !b.bot.alive) {
        b.bot.controls.release();
        b.target = null;
        continue;
      }
      this.think(b, dt);
    }
  }

  /**
   * A live grenade (`items.thrown`, as far as its blast reaches, and a step) or a fire (`items.fires`,
   * its flames and a step) covering `p`: the nearest, or null. Bots get out, and don't go in.
   */
  private danger(p: Vec3): { at: Vec3; reach: number } | null {
    let best: { at: Vec3; reach: number } | null = null;
    let near = Infinity;
    const check = (at: Vec3, reach: number) => {
      if (Math.abs(p.y - at.y) > 3) return;
      const d = Math.hypot(p.x - at.x, p.z - at.z);
      if (d < reach && d < near) {
        near = d;
        best = { at, reach };
      }
    };
    // Live grenades and fires, from the game's throwable kit (if it lists one).
    const lethals = this.game.items.kind<Throwables>('throwable');
    if (lethals) {
      for (const t of lethals.thrown()) check(t.position, t.radius + 1);
      for (const f of lethals.fires()) check(f.position, f.radius + 1);
    }
    return best;
  }

  /** A carried gun's rounds (through the game's gun kit), or null. */
  private ammo(bot: Bot, item: string): { magazine: number; reserve: number } | null {
    return this.game.items.kind<Guns>('gun')?.ammo(bot, item) ?? null;
  }

  private weapon(id: string): BotWeapon {
    return this.opts.weapons?.[id] ?? {};
  }

  /** Switch to `item` if it's on the hotbar and not in hand. */
  private switchTo(bot: Bot, item: string) {
    const i = bot.inventory.slots.findIndex((s) => s?.item === item);
    if (i >= 0 && i !== bot.inventory.selected) bot.controls.press(`Digit${i + 1}`);
  }

  private think(b: Brain, dt: number) {
    const { game, aim, senses, moves } = this;
    const bot = b.bot;
    const c = bot.controls;
    const now = game.clock.now;
    const eye = bot.eye;
    const pos = bot.position;
    const inv = bot.inventory;
    const held = inv.held?.item ?? '';
    const item = game.items.get(held);
    const gun = isGun(item) ? item : null;
    const melee = isMelee(item) ? item : null;
    const w = this.weapon(held);
    const ammo = this.ammo(bot, held);
    const s = b.skill;
    b.slideCool = Math.max(0, b.slideCool - dt);

    // ---- Who can it see? Anyone in front of it (or right next to it) with nothing in between.
    const look = bot.look;
    let best: Player | null = null;
    let bestScore = Infinity;
    let bestSeen: Brain['seen'] = 'body';
    for (const p of game.players) {
      if (p === bot || !p.alive || p.spectating || (this.opts.hostile && !this.opts.hostile(bot, p))) continue;
      const t = chest(p);
      const dx = t.x - eye.x;
      const dy = t.y - eye.y;
      const dz = t.z - eye.z;
      const d = Math.hypot(dx, dy, dz);
      if (d > senses.sight) continue;
      const facing = (dx * look.x + dy * look.y + dz * look.z) / d;
      const heardThem = b.heard && now - b.heard.t < 2 && Math.hypot(b.heard.at.x - p.position.x, b.heard.at.z - p.position.z) < 4;
      if (facing < senses.view && d > senses.near && !heardThem && p !== b.target) continue;
      // Its chest in view, or failing that its head (over cover, through a hole in a wall).
      let seen: Brain['seen'] = 'body';
      if (!game.world.lineOfSight(eye, t)) {
        if (!game.world.lineOfSight(eye, head(p))) continue;
        seen = 'head';
      }
      const score = d * (p === b.target ? 0.55 : 1) * (facing > 0.8 ? 0.8 : 1);
      if (score < bestScore) {
        bestScore = score;
        best = p;
        bestSeen = seen;
      }
    }
    b.seen = bestSeen;
    if (best !== b.target) {
      b.target = best;
      if (best) {
        // A beat to react (a person takes a third of a second or more to notice and react; bots
        // do too), and a first swing that's off by a body or two.
        b.react = at(aim.reaction, s) + Math.random() * aim.reactionRandom;
        const miss = at(aim.miss, s);
        b.err = { x: (Math.random() - 0.5) * miss * 2, y: (Math.random() - 0.3) * miss, z: (Math.random() - 0.5) * miss * 2 };
        b.head = Math.random() < at(aim.head, s);
        b.burst = 0;
        b.pause = 0;
      }
    }

    let moveX = 0;
    let moveZ = 0;
    let sprint = false;
    let wantJump = false;
    c.hold('KeyC', false);

    if (b.target) {
      const t = b.target;
      b.lastSeen = { ...t.position };
      b.lastSeenAt = now;
      b.react -= dt;
      // Aim: at the chest (or head, or what it can see), leading a little, off by the error, which settles.
      const aimAt = b.head || b.seen === 'head' ? head(t) : chest(t);
      const v = t.velocity;
      const dist = Math.hypot(aimAt.x - eye.x, aimAt.y - eye.y, aimAt.z - eye.z);
      // The right weapon for the range, if the game says.
      const want = this.opts.weapon?.(bot, b, dist);
      if (want && want !== held && (this.ammo(bot, want)?.magazine ?? 1) > 0) this.switchTo(bot, want);
      const lead = Math.min(0.12, dist / 300);
      // Still taking it in: the aim doesn't move yet. After that the error settles as it tracks,
      // but a target on the move drags the aim behind it.
      const reacting = b.react > 0;
      const settle = reacting ? 1 : Math.exp(-dt * at(aim.settle, s));
      const drag = reacting ? 0 : dt * at(aim.drag, s);
      b.err = { x: b.err.x * settle - v.x * drag, y: b.err.y * settle, z: b.err.z * settle - v.z * drag };
      const jitter = at(aim.shake, s) + (this.game.items.kind<Guns>('gun')?.aiming(bot) ? aim.aimedShake : aim.hipShake) + Math.hypot(v.x, v.z) * aim.moveShake;
      const px = aimAt.x + v.x * lead + b.err.x + (Math.random() - 0.5) * jitter;
      const py = aimAt.y + v.y * lead * 0.5 + b.err.y + (Math.random() - 0.5) * jitter;
      const pz = aimAt.z + v.z * lead + b.err.z + (Math.random() - 0.5) * jitter;
      const wantYaw = Math.atan2(-(px - eye.x), -(pz - eye.z));
      const wantPitch = Math.atan2(py - eye.y, Math.hypot(px - eye.x, pz - eye.z));
      const rate = reacting ? 0 : at(aim.turn, s) * dt;
      b.yaw += clampAngle(angleDiff(wantYaw, b.yaw), rate);
      b.pitch += Math.max(-rate, Math.min(rate, wantPitch - b.pitch));
      c.look(b.yaw, b.pitch);
      // Fire once it's on target (near enough: a body's width at that distance).
      const trueYaw = Math.atan2(-(aimAt.x - eye.x), -(aimAt.z - eye.z));
      const truePitch = Math.atan2(aimAt.y - eye.y, Math.hypot(aimAt.x - eye.x, aimAt.z - eye.z));
      const off = Math.hypot(angleDiff(trueYaw, b.yaw), truePitch - b.pitch);
      const onTarget = off < Math.atan2(at(aim.tolerance, s), dist) + 0.02;
      const ads = w.ads ?? 9;
      const wantAds = !!gun && (ads === true || (typeof ads === 'number' && dist > ads));
      c.button(2, wantAds);
      const loaded = ammo ? ammo.magazine > 0 : true;
      const ready = b.react <= 0 && onTarget && (!w.steady || !wantAds || !!this.game.items.kind<Guns>('gun')?.aiming(bot)) && loaded;
      if (gun?.auto) {
        // Bursts: short ones at range, longer up close, then a moment to re-aim.
        if (b.pause > 0) b.pause -= dt;
        else if (ready && b.burst <= 0) b.burst = dist > 10 ? 0.25 + Math.random() * 0.3 : 0.6 + Math.random() * 0.6;
        const firing = ready && b.pause <= 0 && b.burst > 0;
        if (firing) {
          b.burst -= dt;
          if (b.burst <= 0) b.pause = 0.2 + Math.random() * 0.25 + (1 - s) * 0.2;
        }
        c.button(0, firing);
      } else if (gun) {
        c.button(0, false);
        if (ready && now >= b.nextShot) {
          c.click(0);
          b.nextShot = now + (60 / gun.rpm) * at(aim.pace, s) + Math.random() * aim.paceRandom;
        }
      } else {
        // A blade (or a fist): swing when it's in reach.
        c.button(0, false);
        const reach = (melee?.reach ?? 3) * 0.9;
        if (ready && dist < reach && now >= b.nextShot) {
          c.click(0);
          b.nextShot = now + (melee?.cooldown ?? 0.6) * at(aim.pace, s) + Math.random() * aim.paceRandom;
        }
      }
      // Out of rounds mid-fight: another loaded gun is quicker than a reload, up close.
      if (ammo && ammo.magazine === 0) {
        const other = dist < moves.swapWithin ? inv.slots.find((st) => st && st.item !== held && (this.ammo(bot, st.item)?.magazine ?? 0) > 0) : null;
        if (other) this.switchTo(bot, other.item);
        else c.press('KeyR');
      }
      // Seen through a gap (a hole shot in a wall, a crack between crates): a step either way and
      // the line's gone, so it holds still and shoots through it. (A side with a wall right there
      // isn't a step it could take.)
      const tx = t.position.x - pos.x;
      const tz = t.position.z - pos.z;
      const td = Math.hypot(tx, tz) || 1;
      const lost = (side: number) => {
        const e = { x: eye.x - (tz / td) * 0.4 * side, y: eye.y, z: eye.z + (tx / td) * 0.4 * side };
        return !game.world.blockInfo(game.world.getBlock(e.x, e.y, e.z))?.solid && !game.world.lineOfSight(e, aimAt);
      };
      const peep = lost(1) && lost(-1);
      // Move: strafe side to side, closing to or backing off to the range the gun likes.
      b.strafeT -= dt;
      if (b.strafeT <= 0) {
        b.strafe = [-1, 0, 1][Math.floor(Math.random() * 3)];
        b.strafeT = moves.strafe[0] + Math.random() * (moves.strafe[1] - moves.strafe[0]);
        if (moves.hop > 0 && Math.random() < moves.hop * s && bot.onGround) wantJump = true;
        if (moves.crouch > 0 && Math.random() < moves.crouch && wantAds) b.crouchT = 0.6 + Math.random() * 0.8;
      }
      const range = w.range ?? moves.range;
      const close = peep ? 0 : td > range * moves.keep[0] ? 1 : td < range * moves.keep[1] ? -1 : 0;
      const strafe = peep ? 0 : b.strafe;
      moveX = (tx / td) * close + (-tz / td) * strafe;
      moveZ = (tz / td) * close + (tx / td) * strafe;
      if (peep) {
        // (Crouching or hopping would lose the line too.)
        b.crouchT = 0;
        wantJump = false;
      }
      if (b.crouchT > 0) {
        b.crouchT -= dt;
        c.hold('KeyC', true);
        moveX *= 0.3;
        moveZ *= 0.3;
      }
      // Rushing in (a shotgun, an SMG, a blade): sprinting, and a slide now and then.
      if (close > 0 && w.rush && td > 6) {
        sprint = !wantAds;
        if (moves.slide && sprint && b.slideCool <= 0 && Math.random() < dt * 0.8) {
          c.press('KeyC');
          b.slideCool = 3;
        }
      }
      // A live grenade or a fire where it stands: out of there, still shooting.
      const threat = this.danger(pos);
      if (threat) {
        const ax = pos.x - threat.at.x;
        const az = pos.z - threat.at.z;
        const ad = Math.hypot(ax, az) || 1;
        moveX = ax / ad;
        moveZ = az / ad;
        b.crouchT = 0;
      }
      b.path = null;
      this.opts.fight?.(bot, b, dist);
    } else {
      c.button(0, false);
      c.button(2, false);
      // Back to the main weapon, topped up.
      if (moves.homeSlot !== null && inv.selected !== moves.homeSlot && inv.slots[moves.homeSlot]) c.press(`Digit${moves.homeSlot + 1}`);
      if (ammo && gun && ammo.magazine < gun.magazine * moves.topUp && ammo.reserve > 0 && now - b.lastSeenAt > 1 && (moves.topUpChance >= 1 || Math.random() < moves.topUpChance)) c.press('KeyR');
      // Someone it was fighting ducked out of sight not far off: something to flush them out.
      const hook = this.opts.throw;
      if (hook && b.lastSeen && now - b.lastSeenAt < 2.5 && now - b.thrownAt > (this.opts.throwEvery ?? 10)) {
        const d = Math.hypot(b.lastSeen.x - pos.x, b.lastSeen.z - pos.z);
        if (d > 6 && d < 28 && Math.random() < dt * (0.35 + s * 0.4) && hook(bot, b.lastSeen, b)) b.thrownAt = now;
      }
      // Where to: the game's idea, a shot it heard, where it last saw someone, or somewhere worth being.
      const nav = this.nav();
      b.replan -= dt;
      // A live grenade or fire where it stands: away first (planned, round walls), and again
      // until it's out.
      const threat = this.danger(pos);
      if (nav && threat && (!b.goal || this.danger(b.goal))) {
        const ax = pos.x - threat.at.x;
        const az = pos.z - threat.at.z;
        const ad = Math.hypot(ax, az) || 1;
        const out = threat.reach - ad + 2;
        b.goal = { x: pos.x + (ax / ad) * out, y: pos.y, z: pos.z + (az / ad) * out };
        b.path = nav.path(pos, b.goal);
        b.step = 0;
        b.replan = 0.6;
      }
      if (nav && (!b.path || b.step >= b.path.length || b.replan <= 0)) {
        let goal = this.opts.goal?.(bot, b) ?? null;
        if (goal) {
          // The game's.
        } else if (b.heard && now - b.heard.t < senses.chaseHeard) goal = b.heard.at;
        else if (b.lastSeen && now - b.lastSeenAt < senses.chaseSeen) goal = b.lastSeen;
        else if (!b.goal || b.wander <= 0 || (b.path && b.step >= b.path.length)) {
          const hotspots = this.opts.hotspots ?? [];
          goal = Math.random() < moves.hotspot && hotspots.length ? hotspots[Math.floor(Math.random() * hotspots.length)] : (nav.random(Math.random)?.at ?? pos);
          b.wander = moves.wander[0] + Math.random() * (moves.wander[1] - moves.wander[0]);
        } else goal = b.goal;
        // Not into a live grenade or a fire: the near side of it, to wait it out.
        const there = goal && this.danger(goal);
        if (goal && there) {
          const ax = pos.x - there.at.x;
          const az = pos.z - there.at.z;
          const ad = Math.hypot(ax, az) || 1;
          goal = { x: there.at.x + (ax / ad) * (there.reach + 1), y: goal.y, z: there.at.z + (az / ad) * (there.reach + 1) };
        }
        b.goal = goal;
        b.path = nav.path(pos, goal);
        b.step = 0;
        b.opened = nav.opened;
        b.replan = moves.replan[0] + Math.random() * (moves.replan[1] - moves.replan[0]);
        if (!b.path) b.goal = null;
      }
      // A new way has opened since it planned (a hole blown through a wall, a block broken): it may be shorter.
      if (nav && b.path && b.goal && nav.opened !== b.opened) {
        b.opened = nav.opened;
        b.path = nav.path(pos, b.goal);
        b.step = 0;
      }
      b.wander -= dt;
      const path = b.path;
      if (nav && path && b.step < path.length) {
        // Skip waypoints already reached; head for the next. A hole is only as wide as it is, so
        // near one it goes cell by cell, lined up, looking straight through it.
        const lining = (i: number) => path[i].hole || !!path[i + 1]?.hole;
        let wp = path[b.step];
        while (b.step < path.length - 1 && Math.hypot(wp.at.x - pos.x, wp.at.z - pos.z) < (lining(b.step) ? 0.3 : 0.7) && Math.abs(wp.y - pos.y) < 1.2) wp = path[++b.step];
        if (b.step === path.length - 1 && Math.hypot(wp.at.x - pos.x, wp.at.z - pos.z) < 0.7) b.step++;
        const lined = b.step < path.length && lining(b.step);
        const ahead = lined ? wp : path[Math.min(path.length - 1, b.step + 2)];
        const dx = wp.at.x - pos.x;
        const dz = wp.at.z - pos.z;
        const d = Math.hypot(dx, dz) || 1;
        // (A grenade or a fire landed on the way since it planned: stop short, and plan again.)
        const blocked = !threat && this.danger(wp.at);
        moveX = blocked ? 0 : dx / d;
        moveZ = blocked ? 0 : dz / d;
        if (blocked) b.replan = Math.min(b.replan, 0.3);
        const prev = b.step > 0 ? path[b.step - 1] : null;
        if (wp.y > pos.y + 0.6 && (prev === null || nav.needsJump(prev, wp) || wp.y - pos.y > 0.9) && d < 1.6) wantJump = true;
        sprint = path.length - b.step > 5;
        // Look where it's going (a little ahead), glancing about.
        const lx = ahead.at.x - eye.x;
        const lz = ahead.at.z - eye.z;
        const wantYaw = Math.atan2(-lx, -lz) + (lined ? 0 : Math.sin(now * 0.9 + s * 10) * moves.glance);
        b.yaw += clampAngle(angleDiff(wantYaw, b.yaw), 5 * dt);
        b.pitch += (Math.atan2(ahead.y + 1.2 - eye.y, Math.hypot(lx, lz)) * 0.5 - b.pitch) * Math.min(1, dt * 4);
        c.look(b.yaw, b.pitch);
        if (moves.slide && sprint && b.slideCool <= 0 && Math.random() < dt * 0.15) {
          c.press('KeyC');
          b.slideCool = 4;
        }
      } else if (b.heard && now - b.heard.t < 3) {
        const h = b.heard.at;
        b.yaw += clampAngle(angleDiff(Math.atan2(-(h.x - pos.x), -(h.z - pos.z)), b.yaw), 6 * dt);
        c.look(b.yaw, b.pitch * 0.9);
      }
    }

    // Stuck against something: jump, and if that doesn't help, go somewhere else.
    const moving = Math.hypot(moveX, moveZ) > 0.1;
    if (moving) {
      b.stuckT += dt;
      if (b.stuckT > 0.5) {
        const moved = Math.hypot(pos.x - b.stuckAt.x, pos.z - b.stuckAt.z);
        if (moved < 0.35) {
          wantJump = true;
          if (b.stuckT > 1.6) {
            b.path = null;
            b.goal = null;
            b.strafe = -b.strafe;
          }
        } else {
          b.stuckT = 0;
          b.stuckAt = pos;
        }
      }
    } else {
      b.stuckT = 0;
      b.stuckAt = pos;
    }

    // The move as keys, relative to where it's looking.
    const f = -Math.sin(b.yaw) * moveX + -Math.cos(b.yaw) * moveZ;
    const r = Math.cos(b.yaw) * moveX - Math.sin(b.yaw) * moveZ;
    c.hold('KeyW', f > 0.38);
    c.hold('KeyS', f < -0.38);
    c.hold('KeyD', r > 0.38);
    c.hold('KeyA', r < -0.38);
    c.hold('ShiftLeft', sprint && f > 0.5);
    c.hold('Space', wantJump);
  }
}

function chest(p: Player): Vec3 {
  const q = p.position;
  return { x: q.x, y: q.y + (p.sliding ? 0.55 : p.crouching ? 0.85 : 1.1), z: q.z };
}

function head(p: Player): Vec3 {
  const q = p.position;
  return { x: q.x, y: q.y + (p.sliding ? 1.1 : p.crouching ? 1.45 : 1.75), z: q.z };
}

function angleDiff(a: number, b: number): number {
  let d = a - b;
  d -= Math.round(d / (Math.PI * 2)) * Math.PI * 2;
  return d;
}

function clampAngle(d: number, max: number): number {
  return Math.max(-max, Math.min(max, d));
}
