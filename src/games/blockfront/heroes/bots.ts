import type { Bot, GameContext, Player, Vec3 } from '@platform';
import type { BotMind, ShooterBots } from '@platform/kits';
import { HERO_ABILITY, coolOf, type HeroMove } from './abilities';
import { HEROES, usesSaber, type HeroId, type PowerId } from './defs';
import type { Powers } from './powers';
import type { Sabers } from './saber';
import { GUARD, POWERS, SABER } from './tuning';

export interface HeroBotRules {
  heroOf(p: Player): HeroId | null;
  hostile(a: Player, b: Player): boolean;
  powers: Powers;
  sabers(): Sabers | null;
  /** Where a hurt hero falls back to (the nearest post their side holds), if anywhere. */
  retreat(p: Player): Vec3 | null;
}

/**
 * Falling back: below `below` of their health a hero bot heads for the nearest post their side
 * holds, leaving alone whoever's further than `leaveBeyond`, until they're back over `until` or
 * `most` seconds have passed.
 */
const FALL_BACK = { below: 0.25, until: 0.5, most: 30, leaveBeyond: 5 };

/** What a hero bot has in mind, beyond the shooter bot's. */
interface Plan {
  /** Guard up until (host time), and not again before. */
  guardUntil: number;
  guardAgain: number;
  /** Lightning held until. */
  zapUntil: number;
  /** When it last thought about a power, and the next time it may. */
  nextPower: number;
  /** Climbing on the jetpack until (Space held). */
  climbUntil: number;
  /** Falling back until (host time; 0: not). */
  back: number;
}

const DEG = Math.PI / 180;

/**
 * Hero bots: the shooter bots' fighting (`shooterBots`: they see, chase and rush in with the blade
 * as a `rush` weapon), plus a hero's own moves each tick of a fight:
 *
 * - in reach, the saber: held down, the combo keeps coming;
 * - shot at from further off, the guard up (while the meter holds), turning the bolts;
 * - the powers where they pay: a push into a crowd, a pull or a choke on someone keeping their
 *   distance (a sniper), a rush or a leap to close in, the saber thrown down a line, lightning on
 *   whoever's in front, chain lightning into a group, the aura or a rage in the thick of it, the
 *   stance under fire.
 */
export function heroBots(game: GameContext, rules: HeroBotRules) {
  const plans = new Map<string, Plan>();
  const plan = (b: Bot) => {
    let p = plans.get(b.id);
    if (!p) plans.set(b.id, (p = { guardUntil: 0, guardAgain: 0, zapUntil: 0, nextPower: 0, back: 0, climbUntil: 0 }));
    return p;
  };

  /** Enemies within `range` of the bot, in front of it (within `arc` degrees each side, level). */
  const around = (bot: Bot, range: number, arc = 180) => {
    const cos = Math.cos(arc * DEG);
    const fx = -Math.sin(bot.yaw);
    const fz = -Math.cos(bot.yaw);
    return game.players.filter((t) => {
      if (t === bot || !t.alive || !rules.hostile(bot, t)) return false;
      const dx = t.position.x - bot.position.x;
      const dz = t.position.z - bot.position.z;
      const d = Math.hypot(dx, dz);
      return d <= range && (d < 1 || (dx * fx + dz * fz) / d >= cos) && Math.abs(t.position.y - bot.position.y) < 4;
    });
  };

  /** A hero bot falling back now (hurt): it starts below `FALL_BACK.below`, ends back over `until` or after `most`. */
  const fallingBack = (bot: Bot): boolean => {
    const pl = plan(bot);
    if (!rules.heroOf(bot) || !bot.alive) return (pl.back = 0), false;
    const now = game.clock.now;
    const f = bot.health / bot.maxHealth;
    if (pl.back === 0 && f < FALL_BACK.below && rules.retreat(bot)) pl.back = now + FALL_BACK.most;
    if (pl.back && (f > FALL_BACK.until || now > pl.back)) pl.back = 0;
    return pl.back > 0;
  };

  /** Whether to use this power now, against `target` at `d`. */
  const worth = (bot: Bot, power: PowerId, target: Player, d: number, hurtLately: boolean): boolean => {
    // Falling back: nothing that takes it into the fight.
    if (plan(bot).back && (power === 'rush' || power === 'leap' || power === 'pull')) return false;
    switch (power) {
      case 'push':
        return around(bot, POWERS.push.range * 0.8, POWERS.push.arc).length >= 2 || (d < 4 && hurtLately);
      case 'rush':
        return d > 4.5 && d < 9;
      case 'leap':
        return d > 9 && d < 16;
      case 'pull':
        return d > 6 && d < POWERS.pull.range;
      case 'soresu':
        return hurtLately && d > 6 && bot.health < bot.maxHealth * 0.8;
      case 'throw':
        return d > 4.5 && d < POWERS.throw.range - 1;
      case 'choke':
        return d > 3.5 && d < POWERS.choke.range;
      case 'rage':
        return around(bot, 9).length >= 2 || (d < 5 && rules.heroOf(target) !== null);
      case 'lightning':
        return d < POWERS.lightning.range - 1;
      case 'chain':
        return d < POWERS.chain.range - 2 && d > 4;
      case 'aura':
        return around(bot, POWERS.aura.radius - 0.5).length >= 2 || (d < 3.5 && bot.health < bot.maxHealth * 0.6);
      case 'scatter':
        return around(bot, 12, 25).length >= 2 || d < 8;
      case 'charge':
        return (d > 3.5 && d < 10) || around(bot, 8, 30).length >= 2;
      case 'roar':
        return around(bot, POWERS.roar.radius - 0.5).length >= 2 || (hurtLately && bot.health < bot.maxHealth * 0.5);
      case 'rocket':
        return d > 5 && d < POWERS.rocket.range - 5;
      case 'flame':
        return d < POWERS.flame.range - 1;
      case 'jetpack':
        return d > 11 || (hurtLately && bot.health < bot.maxHealth * 0.6);
    }
  };

  return {
    fight(bot: Bot, mind: BotMind) {
      const id = rules.heroOf(bot);
      const target = mind.target;
      if (!id || !target || !bot.alive) return;
      const c = bot.controls;
      const now = game.clock.now;
      const pl = plan(bot);
      const s = rules.sabers()?.of(bot);
      const m = bot.abilities[HERO_ABILITY] as HeroMove;
      const hurtLately = now - mind.hurtAt < 0.9;
      const d = Math.hypot(target.position.x - bot.position.x, target.position.z - bot.position.z);
      // In reach and facing them: the saber, held (the combo keeps coming).
      const facing = (() => {
        const dx = target.position.x - bot.position.x;
        const dz = target.position.z - bot.position.z;
        return (dx * -Math.sin(bot.yaw) + dz * -Math.cos(bot.yaw)) / (d || 1) > Math.cos(50 * DEG);
      })();
      const inReach = d < SABER.reach - 0.2 && facing;
      const saber = usesSaber(id);
      // A held power under way (lightning, fire): keep holding while there's someone in front, and it lasts.
      const held = HEROES[id].powers.find((p) => p.hold);
      if (held && pl.zapUntil > now) {
        const range = held.id === 'flame' ? POWERS.flame.range : POWERS.lightning.range;
        c.hold(held.key, d < range && facing);
        if (saber) {
          c.button(0, false);
          c.button(2, false);
        }
        return;
      }
      if (held) c.hold(held.key, false);
      // A saber: shot at while closing in, the guard up (it holds while the meter does), down again
      // to strike. (A hero with a blaster just shoots: the shooter bots' way.)
      if (saber) {
        if (!inReach && hurtLately && d > 4 && m.g > 0 && m.m > GUARD.meter * 0.25 && now > pl.guardAgain) {
          pl.guardUntil = now + 1 + Math.random() * 1.2 * (0.5 + mind.skill);
          pl.guardAgain = pl.guardUntil + 0.3 + Math.random() * 0.6 * (1 - mind.skill);
        }
        const guard = pl.guardUntil > now && m.g > 0 && m.m > GUARD.meter * 0.12 && d > 3.5;
        c.button(2, guard);
        c.button(0, inReach && !guard && (s?.stagger ?? 0) === 0);
      }
      // A power, now and then (more often the better the bot), when one's ready and worth it.
      if (now < pl.nextPower || rules.powers.held(bot)) return;
      pl.nextPower = now + 0.25 + (1 - mind.skill) * 0.6 + Math.random() * 0.4;
      const ready = HEROES[id].powers.filter((_, slot) => coolOf(m, slot) === 0);
      for (const p of ready.sort(() => Math.random() - 0.5)) {
        if (!worth(bot, p.id, target, d, hurtLately)) continue;
        if (p.id === 'leap') c.look(bot.yaw, Math.min(0.5, bot.pitch + 0.25));
        // Up on the jetpack: climb a moment, then hover and shoot down.
        if (p.id === 'jetpack') pl.climbUntil = now + 0.6 + Math.random() * 0.6;
        if (p.hold) {
          pl.zapUntil = now + 1.2 + Math.random() * 1.6;
          c.hold(p.key, true);
        } else c.press(p.key);
        pl.nextPower = now + 1.2;
        break;
      }
    },
    /** Somewhere to be before any post: falling back, the nearest post their side holds (somewhere in it). */
    goal(bot: Bot): Vec3 | null {
      if (!fallingBack(bot)) return null;
      const at = rules.retreat(bot);
      if (!at) return null;
      const a = game.rng.range(0, Math.PI * 2);
      const r = game.rng.range(0, 3);
      return { x: at.x + Math.cos(a) * r, y: at.y, z: at.z + Math.sin(a) * r };
    },
    /** Falling back, it lets be whoever isn't right on it. */
    ignore(bot: Bot, other: Player): boolean {
      if (!plan(bot).back) return false;
      return Math.hypot(other.position.x - bot.position.x, other.position.z - bot.position.z) > FALL_BACK.leaveBeyond;
    },
    /**
     * Once the bots are driven: a hero falling back that's being shot turns to face whoever's
     * shooting, guard up, and backs off toward the post (the keys worked out again for that).
     */
    after(brains: ShooterBots) {
      const now = game.clock.now;
      for (const bot of game.bots.all) {
        // Climbing on the jetpack (the shooter bots let go of Space by now).
        if (plan(bot).climbUntil > now) bot.controls.hold('Space', true);
        if (!fallingBack(bot)) continue;
        const mind = brains.mind(bot);
        const m = bot.abilities[HERO_ABILITY] as HeroMove;
        if (!mind || now - mind.hurtAt > 1 || m.g <= 0 || m.m < GUARD.meter * 0.15) continue;
        const from = mind.target?.position ?? (mind.heard && now - mind.heard.t < 2 ? mind.heard.at : null);
        const to = rules.retreat(bot);
        if (!from || !to) continue;
        const c = bot.controls;
        const yaw = Math.atan2(-(from.x - bot.position.x), -(from.z - bot.position.z));
        c.look(yaw, 0);
        c.button(0, false);
        c.button(2, true);
        const dx = to.x - bot.position.x;
        const dz = to.z - bot.position.z;
        const d = Math.hypot(dx, dz) || 1;
        const f = (-Math.sin(yaw) * dx + -Math.cos(yaw) * dz) / d;
        const r = (Math.cos(yaw) * dx - Math.sin(yaw) * dz) / d;
        const there = d < 3;
        c.hold('KeyW', !there && f > 0.38);
        c.hold('KeyS', !there && f < -0.38);
        c.hold('KeyD', !there && r > 0.38);
        c.hold('KeyA', !there && r < -0.38);
        c.hold('ShiftLeft', false);
      }
    },
    /** Each step: lightning let go once it's had its while (out of a fight too). */
    update() {
      const now = game.clock.now;
      for (const [id, pl] of plans) {
        if (pl.zapUntil === 0 || pl.zapUntil > now) continue;
        pl.zapUntil = 0;
        const bot = game.bots.all.find((b) => b.id === id);
        const hero = bot && rules.heroOf(bot);
        const key = hero && HEROES[hero].powers.find((p) => p.hold)?.key;
        if (bot && key) bot.controls.hold(key, false);
      }
    },
    forget(bot: Player) {
      plans.delete(bot.id);
    },
  };
}
