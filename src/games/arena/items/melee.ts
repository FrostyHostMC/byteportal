import { math, type Entity, type GameContext, type ItemBody, type ItemHost, type ItemKind, type ItemKit, type ItemUse, type Player } from '@platform';
import type { MeleeItem, MeleeOwn } from '@platform/items';
import { bus } from '../run/bus';
import { downed, meleeMove } from './moves';
import { afterRoll, frontOf, legendHit, legendSwing, slamAt } from './combat';
import { throwSpear, spearOut, recallSpear } from './spear';
import { stagger, stunned } from './status';

/**
 * The Arena's melee weapons: its own copy of the platform's melee kit (`kind: 'melee'`, so the
 * first-person view's readiness dip and figures' swings work as ever), grown into an arsenal.
 * The fire button swings as before (held, again as soon as it's ready; harder while falling, a
 * jump attack's critical hit), and an item may also:
 *
 * - sweep an `arc`: everything in reach within that many degrees either side of the view (the
 *   greatsword, the battle axe), else the one under the crosshair (or, missing, the nearest just
 *   off it), and with `pierce` the next ones in line behind it (a spear's thrust);
 * - raise a `guard` on the right button (the gladius's shield): what strikes from the front is
 *   blocked, and just raised, parried (`combat.ts`); with it up, the fire button bashes;
 * - `slam`: held, the fire button charges an overhead blow that comes down on everything around
 *   (the warhammer); a tap is an ordinary swing;
 * - `backstab`: hit harder from behind, on a reeling or frozen monster, or straight after a roll
 *   (the daggers);
 * - `throw`: the right button throws it (the spear: `spear.ts`), and calls it back.
 *
 * Played on the host, for people and bots alike. Each weapon's sounds are its look's (`client/looks.ts`).
 */
export interface ArmsMelee extends MeleeItem {
  arc?: number;
  pierce?: number;
  guard?: Guard;
  slam?: Slam;
  backstab?: number;
  throw?: SpearThrow;
  /** Times walking speed while it's in hand (a greatsword's weight, the daggers' lightness). */
  weight?: number;
  /** How heavy its blows feel: the shake, the sparks. */
  heft?: 'light' | 'blade' | 'heavy';
  /** A legendary's trick (`combat.ts`, `legendHit`). */
  legend?: string;
}

export interface Guard {
  /** The share of a blocked blow that still lands (0: none), and how slow walking is behind it. */
  take: number;
  slow: number;
  /** Seconds after it's raised that a blow is parried; how long a parried monster reels. */
  parry: number;
  stagger: number;
  /** The shield bash with the guard up: damage, shove, seconds between. */
  bash: { damage: number; knockback: number; cooldown: number };
}

export interface Slam {
  /** Seconds to a full charge; under `min` it's a plain swing. */
  charge: number;
  min: number;
  /** Damage at the least charge and at full; how far round it reaches (least, full). */
  damage: [number, number];
  radius: [number, number];
  knockback: number;
  /** How long what it hits reels at full charge. */
  stagger: number;
}

export interface SpearThrow {
  damage: number;
  speed: number;
  /** How many it goes through. */
  pierce: number;
  /** Seconds before it comes back on its own once it's landed. */
  back: number;
}

/** A fighter's hands, as the kit keeps them. */
export interface Hand {
  cooldown: number;
  max: number;
  /** The guard up (since when, host time), and the bash's wait. */
  guard: boolean;
  raised: number;
  bash: number;
  /** A slam being charged (0..1), and whether the fire button's down for one. */
  charge: number;
  charging: boolean;
  chargeSound: boolean;
  /** The right button down to throw (a spear raised). */
  aiming: boolean;
}

const DEG = Math.PI / 180;
const FIST: ArmsMelee = { kind: 'melee', name: 'Fist', damage: 1, cooldown: 0.3, reach: 3, knockback: 0.6 };

const hands = new WeakMap<Player, Hand>();
export function handOf(p: Player): Hand {
  let h = hands.get(p);
  if (!h) hands.set(p, (h = { cooldown: 0, max: 1, guard: false, raised: -99, bash: 0, charge: 0, charging: false, chargeSound: false, aiming: false }));
  return h;
}

/** Guarding now (the gladius's shield up), and since when. */
export const guarding = (p: Player): Hand | null => {
  const h = hands.get(p);
  return h?.guard ? h : null;
};

/** Blessings that lengthen reach and widen slams (`blessings.ts` sets them). */
export const meleeMods = { reach: (_p: Player) => 0, slam: (_p: Player) => 1 };

/** The game's item host (for its bodies' boxes): kept by the kit when the game starts. */
let host: ItemHost | null = null;
export const armsHost = () => host;

export function melee(): ItemKit<ItemKind<ArmsMelee>> {
  return (h) => {
    host = h;
    return {
      kind: 'melee',
      stack: 1,
      upgrades: true,
      holds: true,
      step(use) {
        const p = use.player;
        const r = handOf(p);
        r.cooldown = Math.max(0, r.cooldown - use.dt);
        r.bash = Math.max(0, r.bash - use.dt);
        const c = use.controls;
        const weapon = use.held;
        const def = weapon?.def;
        // A spear in the air comes back at the right button, whatever's in hand (but a guard).
        if (c.active && c.buttonPressed(2) && !def?.guard && !def?.throw && spearOut(p)) recallSpear(use.game, p);
        if (!c.active || downed(p) || (!weapon && use.hand?.holds)) return lower(p, r);
        if (!def) {
          // A bare fist (or whatever's in hand that isn't a weapon of its own).
          lower(p, r);
          if (c.buttonPressed(0) || (c.button(0) && r.cooldown <= 0)) if (r.cooldown <= 0) strike(use, r, FIST, undefined, !use.hand);
          return;
        }
        const item = weapon.item;
        // The guard: up while the right button is.
        if (def.guard) {
          const up = c.button(2);
          if (up && !r.guard) r.raised = use.now;
          r.guard = up;
          if (up) {
            if (c.buttonPressed(0) && r.bash <= 0) bash(use, r, def, item);
            return;
          }
        } else r.guard = false;
        // The spear: raised on the right button, thrown when it's let go.
        if (def.throw) {
          if (c.button(2)) r.aiming = true;
          else if (r.aiming) {
            r.aiming = false;
            throwSpear(use, item, def.throw);
            return;
          }
        }
        // The warhammer: held, the fire button charges; let go, it slams (or, barely charged, swings).
        if (def.slam) {
          const s = def.slam;
          if (c.button(0) && (r.charging || r.cooldown <= 0)) {
            r.charging = true;
            r.charge = Math.min(1, r.charge + use.dt / s.charge);
            if (!r.chargeSound && r.charge >= s.min / s.charge) {
              r.chargeSound = true;
              p.audio.play('arena_charge', { item: { id: item, sound: 'draw' } });
            }
            return;
          }
          if (r.charging) {
            const k = r.charge;
            r.charging = false;
            r.charge = 0;
            r.chargeSound = false;
            if (k * s.charge >= s.min) return slam(use, r, def, item, (k * s.charge - s.min) / (s.charge - s.min));
            return strike(use, r, def, item, true);
          }
          return;
        }
        if (c.buttonPressed(0) || (c.button(0) && r.cooldown <= 0)) if (r.cooldown <= 0) strike(use, r, def, item, true);
      },
      move: meleeMove,
      own(v) {
        const r = handOf(v.player);
        return { strength: 1 - r.cooldown / r.max, guard: r.guard, charge: r.charge, aiming: r.aiming } satisfies MeleeOwn & Record<string, unknown>;
      },
      // Everyone's screens see a raised guard (their figures bring the shield up: `client/held.ts`).
      shown(v) {
        return handOf(v.player).guard ? { g: true } : null;
      },
      reset(p) {
        hands.delete(p);
      },
    };
  };
}

/** Nothing raised, nothing charging (empty-handed, or something else in hand). */
function lower(_p: Player, r: Hand) {
  r.guard = false;
  r.charging = false;
  r.charge = 0;
  r.chargeSound = false;
  r.aiming = false;
}

/** Every monster's box (the item host's bodies), with the eye's distance to it along the view. */
function monsters(): ItemBody[] {
  return host ? host.bodies().filter((b) => b.target.kind === 'entity') : [];
}

const _min = { x: 0, y: 0, z: 0 };
const _max = { x: 0, y: 0, z: 0 };

/**
 * Who a swing meets: with an `arc`, everything in reach and sight within it either side of the
 * view; else the first along the view (and with `pierce`, those behind it in line), or missing,
 * the nearest a little off it (a swing that just misses a spider's back still lands).
 */
export function swingTargets(game: GameContext, me: Player, reach: number, arc = 0, pierce = 1): Entity[] {
  const eye = me.eye;
  const look = me.look;
  const fx = -Math.sin(me.yaw);
  const fz = -Math.cos(me.yaw);
  const bodies = monsters();
  const seen = (b: ItemBody) => game.world.lineOfSight(eye, { x: b.feet.x, y: b.feet.y + b.height * 0.6, z: b.feet.z });
  const inArc = (b: ItemBody, degrees: number) => {
    const dx = b.feet.x - eye.x;
    const dz = b.feet.z - eye.z;
    const d = Math.hypot(dx, dz);
    if (d - b.width / 2 > reach) return Infinity;
    if (b.feet.y > eye.y + 1.2 || b.feet.y + b.height < eye.y - 2.8) return Infinity;
    if (d > b.width / 2 + 0.4 && (dx * fx + dz * fz) / d < Math.cos(degrees * DEG)) return Infinity;
    return d;
  };
  if (arc > 0) {
    return bodies
      .map((b) => ({ b, d: inArc(b, arc) }))
      .filter((x) => x.d < Infinity && seen(x.b))
      .sort((a, b) => a.d - b.d)
      .map((x) => x.b.target as Entity);
  }
  const line: { e: Entity; t: number }[] = [];
  for (const b of bodies) {
    const hw = b.width / 2 + 0.25;
    _min.x = b.feet.x - hw;
    _min.y = b.feet.y - 0.1;
    _min.z = b.feet.z - hw;
    _max.x = b.feet.x + hw;
    _max.y = b.feet.y + b.height + 0.1;
    _max.z = b.feet.z + hw;
    const t = math.rayBox(eye, look, _min, _max);
    if (t === null || t > reach || !seen(b)) continue;
    line.push({ e: b.target as Entity, t });
  }
  if (line.length) return line.sort((a, b) => a.t - b.t).slice(0, pierce).map((x) => x.e);
  // Just off the crosshair: the nearest within a narrow cone.
  let best: Entity | null = null;
  let bestD = Infinity;
  for (const b of bodies) {
    const d = inArc(b, 22);
    if (d < bestD && seen(b)) {
      bestD = d;
      best = b.target as Entity;
    }
  }
  return best ? [best] : [];
}

/**
 * A swing (or the fist's): whoever it meets is hit, harder from a fall, from behind with daggers.
 * `own`: the weapon's (or the bare fist's) own animation; else, something in hand just swings.
 */
function strike(use: ItemUse<ArmsMelee>, r: Hand, def: ArmsMelee, item: string | undefined, own: boolean) {
  const me = use.player;
  const game = use.game;
  r.cooldown = r.max = def.cooldown;
  use.swing(own ? 'use' : 'swing');
  me.audio.play(def.sounds?.use ?? 'swing', { pitch: 0.9 + Math.random() * 0.2, ...(item && { item: { id: item, sound: 'use' as const } }) });
  const reach = (def.reach ?? 3.3) + (item ? meleeMods.reach(me) : 0);
  const targets = swingTargets(game, me, reach, def.arc ?? 0, def.pierce ?? 1);
  if (def.arc) sweepTrail(game, me, reach, def.arc, def.heft === 'heavy' ? '#ffe2b0' : '#e8f4ff');
  if (def.legend && item) legendSwing(game, me, def, item);
  // A jump attack: a critical hit; with something heavy, it shakes the ground about it too.
  const jump = use.falling;
  let killed = false;
  let any = false;
  targets.forEach((target, n) => {
    const back = !!def.backstab && (stunned(target) || afterRoll(me) || !frontOf(target, me));
    const crit = jump || back;
    const mult = (jump ? 1.5 : 1) * (back ? def.backstab ?? 1 : 1) * (n > 0 && !def.arc ? 0.7 : 1);
    const amount = def.damage * mult;
    const kb = (def.knockback ?? 1) * (jump ? 1.3 : 1);
    if (!target.damage(amount, { source: me, knockback: kb, crit, weapon: item, cause: 'melee' })) return;
    any = true;
    if (!target.alive) killed = true;
    if (n === 0) {
      me.audio.play(def.sounds?.hit ?? (crit ? 'crit' : 'hit'), { at: target.position, pitch: crit ? 1.25 : 1, ...(item && { item: { id: item, sound: 'hit' as const, pitch: crit ? 1.25 : 1 } }) });
      if (back) burstAt(game, target, '#ff4a6a', 14);
    }
    if (back && !target.alive) bus.emit('feat', { player: me, name: 'backstab', text: 'Backstab!' });
    if (def.legend) legendHit(game, me, target, def, item ?? '', { crit, back, amount });
  });
  if (!any) return;
  use.hitMarker(killed ? 'kill' : jump);
  const heavy = def.heft === 'heavy';
  me.fx.shake(heavy ? 0.06 : jump ? 0.05 : def.heft === 'light' ? 0.015 : 0.025, heavy ? 0.18 : 0.12);
  if (jump && heavy && targets[0]) slamAt(game, me, targets[0].position, { radius: 2.6, damage: def.damage * 0.4, knockback: 1, weapon: item ?? 'fist', stagger: 0 }, false);
  // The old swords' sweep: whatever's close round the one hit takes half.
  if (def.sweep && !def.arc && targets[0]) {
    const tp = targets[0].position;
    const cam = me.eye;
    for (const e of game.entities.near(tp, 2.4)) {
      if (e === targets[0] || !e.alive) continue;
      const p = e.position;
      if (Math.hypot(p.x - cam.x, p.z - cam.z) > reach + 1) continue;
      e.damage(def.damage * 0.5, { source: me, knockback: 0.6, cause: 'melee', weapon: item });
    }
    game.fx.burst({ x: tp.x, y: tp.y + 1, z: tp.z }, { color: '#e8f4ff', count: 14, speed: 4, gravity: 2 });
  }
}

/** The shield bash, with the guard up: a shove that staggers the one in front. */
function bash(use: ItemUse<ArmsMelee>, r: Hand, def: ArmsMelee, item: string) {
  const g = def.guard!;
  const me = use.player;
  r.bash = g.bash.cooldown;
  use.swing('swing', 1.4);
  me.audio.play('arena_bash', { pitch: 0.95 + Math.random() * 0.1 });
  const [target] = swingTargets(use.game, me, 2.8, 35);
  if (!target) return;
  if (!target.damage(g.bash.damage, { source: me, knockback: g.bash.knockback, weapon: item, cause: 'melee' })) return;
  stagger(use.game, target, 0.9);
  use.game.audio.play('arena_block', { at: target.position, pitch: 0.8 });
  burstAt(use.game, target, '#ffe9a8', 10);
  use.hitMarker(target.alive ? false : 'kill');
  me.fx.shake(0.04, 0.12);
}

/** The warhammer comes down: everything round where it lands is hit, thrown and staggered. */
function slam(use: ItemUse<ArmsMelee>, r: Hand, def: ArmsMelee, item: string, k: number) {
  const s = def.slam!;
  const me = use.player;
  const game = use.game;
  // (Quick to raise again: the charge is the wait.)
  r.cooldown = r.max = def.cooldown * 0.7;
  me.viewModel.play('arena_slam');
  use.host.swing(me);
  // Where it lands: a little ahead, on the ground under it.
  const eye = me.eye;
  const fx = -Math.sin(me.yaw);
  const fz = -Math.cos(me.yaw);
  let at = { x: eye.x + fx * 1.6, y: me.position.y, z: eye.z + fz * 1.6 };
  if (!game.world.lineOfSight(eye, { x: at.x, y: at.y + 0.5, z: at.z })) at = { ...me.position };
  const fall = use.falling ? 1.3 : 1;
  const wide = meleeMods.slam(me);
  const hits = slamAt(game, me, at, {
    radius: (s.radius[0] + (s.radius[1] - s.radius[0]) * k) * fall * wide,
    damage: (s.damage[0] + (s.damage[1] - s.damage[0]) * k) * fall,
    knockback: s.knockback * (0.6 + 0.4 * k),
    stagger: s.stagger * k * wide,
    weapon: item,
  });
  me.fx.shake(0.12 + 0.12 * k, 0.35);
  if (hits.length) use.hitMarker(hits.some((e) => !e.alive) ? 'kill' : k >= 1);
  if (hits.length >= 3) bus.emit('feat', { player: me, name: 'slam', text: `Slam ×${hits.length}` });
  if (def.legend) legendHit(game, me, null, def, item, { crit: k >= 1, back: false, amount: 0, slam: at });
}

/** A swing's arc in the air: a fan of sparks along its edge, drawn by each screen from one word (`client/fx.ts`). */
function sweepTrail(game: GameContext, me: Player, reach: number, arc: number, color: string) {
  const eye = me.eye;
  game.clients.send('all', 'armory.sweep', { x: eye.x, y: eye.y - 0.35, z: eye.z, yaw: me.yaw, reach: reach * 0.75, arc: arc * DEG, color });
}

function burstAt(game: GameContext, e: Entity, color: string, count: number) {
  const q = e.position;
  game.fx.burst({ x: q.x, y: q.y + 1.2, z: q.z }, { color, count, speed: 3, size: 0.1, glow: 0.8, life: 0.4 });
}
