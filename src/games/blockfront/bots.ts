import type { Bot, GameContext, Player, Vec3 } from '@platform';
import { shooterBots, throwables, type BotMind, type BotWeapon, type NavGrid, type ShooterBots } from '@platform/kits';
import type { Conquest } from './conquest';
import { fighterOf, hostile, type Post } from './match';
import { DETONATOR } from './weapons';

/**
 * Bot troopers: the platform's shooter bots (`shooterBots`), told how each blaster is fought with,
 * who's on whose side, and where the fight is: each bot picks a post worth going for (the other
 * side's or nobody's, or one of its own under threat), keeps to it a while, and once there holds
 * it, wandering its ground. Out of sight of anyone, they lob thermal detonators after whoever
 * ducked away. Heroes fight their own way (`heroes.botFight`).
 */
const BLASTERS: Record<string, BotWeapon> = {
  rebel_rifle: { range: 18 },
  imp_rifle: { range: 18 },
  rebel_heavy: { range: 12 },
  imp_heavy: { range: 12 },
  rebel_sniper: { range: 40, ads: true, steady: true },
  imp_sniper: { range: 40, ads: true, steady: true },
  rebel_pistol: { range: 12 },
  imp_pistol: { range: 12 },
};

const LOB = (40 * Math.PI) / 180;
const CLEAR = 5;
/** Seconds a bot keeps to the post it picked before picking again. */
const STICK: [number, number] = [18, 35];

export interface Bots extends ShooterBots {
  /** A bot's gone: forget the post it was after. */
  forget(bot: { id: string }): void;
}

export interface BotHooks {
  /** A hero bot's own moves in a fight. */
  fight(bot: Bot, mind: BotMind, distance: number): void;
  /** Weapons the heroes carry, fought with. */
  weapons: Record<string, BotWeapon>;
  /** Somewhere a bot should be before any post (a hurt hero falling back), or null. */
  goal?(bot: Bot): Vec3 | null;
  /** Someone a bot leaves alone for now (a hero falling back lets the far ones be). */
  ignore?(bot: Bot, other: Player): boolean;
  /** Each step, once the bots have been driven: last word on their controls (a hero backing off, guard up). */
  after?(bots: ShooterBots): void;
}

export function makeBots(game: GameContext, nav: () => NavGrid | null, hotspots: Vec3[], conquest: Conquest, hooks: BotHooks): Bots {
  /** Each bot's post, and until when. */
  const aims = new Map<string, { post: string; until: number }>();

  const pick = (bot: Bot): Post | null => {
    const f = fighterOf(bot);
    if (!f) return null;
    const now = game.clock.now;
    const kept = aims.get(bot.id);
    const goals = conquest.objectives(f.team);
    if (kept && kept.until > now) {
      const p = goals.find((g) => g.spec.id === kept.post);
      if (p) return p;
    }
    if (!goals.length) return null;
    // Nearer ones more often; the ones under threat most.
    const at = bot.position;
    let best: Post | null = null;
    let bestScore = -Infinity;
    for (const g of goals) {
      const d = Math.hypot(g.spec.at.x - at.x, g.spec.at.z - at.z);
      const threat = g.owner === f.team ? 25 : 0;
      const score = -d + threat + game.rng.next() * 45;
      if (score > bestScore) {
        bestScore = score;
        best = g;
      }
    }
    if (best) aims.set(bot.id, { post: best.spec.id, until: now + game.rng.range(STICK[0], STICK[1]) });
    return best;
  };

  const bots = shooterBots(game, {
    nav,
    hotspots,
    weapons: { ...BLASTERS, ...hooks.weapons },
    hostile: (bot, other) => hostile(bot, other) && !hooks.ignore?.(bot, other),
    goal: (bot, _mind: BotMind) => {
      const own = hooks.goal?.(bot);
      if (own) return own;
      const post = pick(bot);
      if (!post) return null;
      const a = post.spec.at;
      const r = post.spec.radius * 0.7;
      // There already: somewhere else inside it, to hold it without standing in one spot.
      const angle = game.rng.range(0, Math.PI * 2);
      const d = conquest.inside(post, bot) ? game.rng.range(0, r) : game.rng.range(0, r * 0.5);
      return { x: a.x + Math.cos(angle) * d, y: a.y, z: a.z + Math.sin(angle) * d };
    },
    fight: (bot, mind, distance) => hooks.fight(bot, mind, distance),
    throw: (bot, at) => {
      if (bot.inventory.count('detonator') <= 0) return false;
      const eye = bot.eye;
      const dx = at.x - eye.x;
      const dz = at.z - eye.z;
      const flat = Math.hypot(dx, dz) || 1;
      const rise = flat * Math.tan(LOB) - (at.y - eye.y);
      const speed = DETONATOR.speed ?? 20;
      if (!(rise > 0) || (DETONATOR.physics?.gravity ?? 24) * flat * flat > 2 * Math.cos(LOB) ** 2 * rise * speed * speed) return false;
      const dir = { x: (dx / flat) * Math.cos(LOB), y: Math.sin(LOB), z: (dz / flat) * Math.cos(LOB) };
      if (game.world.raycast(eye, dir, CLEAR)) return false;
      if (game.players.some((p) => p !== bot && p.alive && Math.hypot(p.position.x - bot.position.x, p.position.z - bot.position.z) < 2)) return false;
      return throwables.of(game)?.throw(bot, 'detonator', { at, cook: 0.4 }) ?? false;
    },
  });
  const drive = bots.update.bind(bots);
  return Object.assign(bots, {
    update(dt: number, frozen?: boolean) {
      drive(dt, frozen);
      if (!frozen) hooks.after?.(bots);
    },
    forget(bot: { id: string }) {
      aims.delete(bot.id);
    },
  });
}
