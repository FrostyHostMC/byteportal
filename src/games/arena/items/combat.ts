import { math, type DamageEvent, type Entity, type GameContext, type Player, type Vec3 } from '@platform';
import { bus } from '../run/bus';
import { ARMOR_CAP } from './armor';
import { guarding, type ArmsMelee } from './melee';
import { wave } from './missiles';
import { bleed, burn, frozen, isBoss, stagger, thaw } from './status';

/**
 * The arsenal's part in every hit: the gladius's guard (a blow from the front blocked, or just
 * raised, parried: the attacker reels, an arrow flies back), a frozen monster shattering, the
 * legendaries' tricks (`legendHit`), the warhammer's slam (`slamAt`). The `damage` listener is
 * `combatDamage`, run first of the Arena's own (`blessings.ts`, `listen`).
 */

const DEG = Math.PI / 180;
/** How wide the guard covers, either side of the view. */
const GUARD_ARC = 100;

/** When each fighter last rolled (host time): the daggers strike from the shadows just after. */
const rolled = new WeakMap<Player, number>();
let clockNow = 0;
export function noteRoll(game: GameContext, p: Player) {
  rolled.set(p, game.clock.now);
}
/** Called each tick (the part's update), so the checks below needn't be handed the game. */
export const tickCombat = (game: GameContext) => void (clockNow = game.clock.now);
export const afterRoll = (p: Player): boolean => clockNow - (rolled.get(p) ?? -99) < 1.1;

/**
 * Is `who` in front of `e`? A monster faces whoever it's after (the nearest fighter), so one
 * chasing you always faces you, and one after a friend of yours may show you its back.
 */
export function frontOf(e: Entity, who: Player): boolean {
  const t = e.nearestPlayer();
  if (!t || t === who) return true;
  const q = e.position;
  const fx = t.position.x - q.x;
  const fz = t.position.z - q.z;
  const wx = who.position.x - q.x;
  const wz = who.position.z - q.z;
  const l = Math.hypot(fx, fz) * Math.hypot(wx, wz);
  return l < 1e-6 || (fx * wx + fz * wz) / l > Math.cos(110 * DEG);
}

/** Is `from` in front of them (within the guard's reach either side of their view)? */
function facing(p: Player, from: Vec3): boolean {
  const dx = from.x - p.position.x;
  const dz = from.z - p.position.z;
  const l = Math.hypot(dx, dz);
  if (l < 0.2) return true;
  return (dx * -Math.sin(p.yaw) + dz * -Math.cos(p.yaw)) / l > Math.cos(GUARD_ARC * DEG);
}

/** What the held weapon is, if it's one of the arsenal's melee weapons. */
const heldMelee = (game: GameContext, p: Player): ArmsMelee | null => {
  const h = p.inventory.held;
  const d = h && game.items.get(h.item);
  return d && d.kind === 'melee' ? (d as ArmsMelee) : null;
};

/** Blessings that change the guard and the parry (`blessings.ts` sets them). */
export const guardMods = { take: (_p: Player) => 1, parry: (_p: Player) => 1, parried: (_g: GameContext, _p: Player) => {} };

/** The arsenal's part in a hit (the first `damage` listener of the Arena's). */
export function combatDamage(game: GameContext, hit: DamageEvent) {
  const { target, source } = hit;
  if (target.kind === 'player') {
    const p = target;
    // Armour does no more past the Arena's cap, whatever gave the points (the platform takes its
    // 4% a point off after this).
    if (p.armor > ARMOR_CAP) hit.amount *= (1 - 0.04 * ARMOR_CAP) / (1 - 0.04 * Math.min(20, p.armor));
    const h = guarding(p);
    const def = h && heldMelee(game, p);
    if (!h || !def?.guard || !source || source === 'world' || source.kind !== 'entity') return;
    if (hit.cause !== 'melee' && hit.cause !== 'projectile') return;
    if (!facing(p, source.position)) return;
    if (game.clock.now - h.raised <= def.guard.parry * guardMods.parry(p)) {
      hit.cancel();
      return parry(game, p, source, hit, def);
    }
    hit.amount *= def.guard.take * guardMods.take(p);
    hit.knockback *= 0.3;
    blocked(game, p, hit.amount <= 0.01);
    return;
  }
  // A fighter's blow on a frozen monster shatters the ice: half again as hard, and it thaws.
  if (source && source !== 'world' && source.kind === 'player' && frozen(target) && (hit.cause === 'melee' || hit.cause === 'slam' || hit.cause === 'explosion')) {
    hit.amount *= 1.5;
    const q = target.position;
    game.fx.burst({ x: q.x, y: q.y + 1, z: q.z }, { color: '#e6f8ff', count: 30, speed: 4.5, size: 0.14, gravity: 10, glow: 0.5, life: 0.7 });
    game.audio.play('arena_shatter', { at: q });
    thaw(target);
    bus.emit('feat', { player: source, name: 'shatter', text: 'Shattered!' });
  }
  // The Sunbow's arrows set them burning.
  if (source && source !== 'world' && source.kind === 'player' && hit.weapon === 'bow_legendary' && hit.cause === 'projectile') burn(game, target, source, 3, 3, 'bow_legendary');
}

/** A blow parried: the attacker reels, an arrow or a bolt flies back where it came from. */
function parry(game: GameContext, p: Player, from: Entity, hit: DamageEvent, def: ArmsMelee) {
  const eye = p.eye;
  const q = from.position;
  const at = { x: eye.x - Math.sin(p.yaw) * 0.7, y: eye.y - 0.3, z: eye.z - Math.cos(p.yaw) * 0.7 };
  game.fx.burst(at, { color: '#fff3c4', count: 26, speed: 5, size: 0.1, glow: 1.5, life: 0.35 });
  game.fx.shockwave({ x: at.x, y: at.y, z: at.z }, 1.2, '#ffe9a8');
  game.audio.play('arena_parry', { at });
  p.fx.shake(0.05, 0.15);
  p.fx.flash('#fff6d0', 0.18, 0.12);
  p.viewModel.kick(0.6);
  if (hit.cause === 'projectile') {
    // Back along the way it came, at the chest of whoever loosed it, twice as hard.
    const to = { x: q.x, y: q.y + 1.2, z: q.z };
    const dir = new math.Vector3(to.x - at.x, to.y - at.y, to.z - at.z).normalize();
    game.entities.projectile({ glow: '#ffd36b', speed: 34, gravity: 2, damage: Math.max(4, hit.amount * 2), knockback: 0.8, weapon: 'parry' }, at, dir, p);
    p.hud.pop('Reflected!', { color: '#ffd36b' });
  } else {
    stagger(game, from, def.guard!.stagger);
    const l = Math.hypot(q.x - p.position.x, q.z - p.position.z) || 1;
    from.impulse(((q.x - p.position.x) / l) * 5, 2.5, ((q.z - p.position.z) / l) * 5);
  }
  // (The announcer calls it out, from the feat.)
  bus.emit('feat', { player: p, name: 'parry', text: 'Parry!' });
  guardMods.parried(game, p);
  // Aegis: a parry lets loose a burst that staggers everything about you.
  if (def.legend === 'aegis') {
    const c = p.position;
    game.fx.shockwave({ x: c.x, y: c.y + 0.3, z: c.z }, 4.5, '#ffd36b');
    game.audio.play('arena_aegis', { at: c });
    for (const e of game.entities.near(c, 4.5)) {
      if (!e.alive) continue;
      e.damage(8, { source: p, knockback: 1.6, weapon: 'gladius_legendary', cause: 'melee', from: c });
      stagger(game, e, 1.2);
    }
  }
}

/** A blow taken on the shield. */
function blocked(game: GameContext, p: Player, whole: boolean) {
  const eye = p.eye;
  const at = { x: eye.x - Math.sin(p.yaw) * 0.6, y: eye.y - 0.4, z: eye.z - Math.cos(p.yaw) * 0.6 };
  game.fx.burst(at, { color: '#ffd9a0', count: 10, speed: 3, size: 0.08, glow: 1, life: 0.3 });
  game.audio.play('arena_block', { at, pitch: whole ? 1.1 : 1 });
  p.viewModel.kick(0.35);
  p.fx.shake(0.03, 0.1);
}

export interface SlamOpts {
  radius: number;
  damage: number;
  knockback: number;
  weapon: string;
  /** How long what's hit reels (0: not at all). */
  stagger: number;
}

/**
 * A blow on the ground at `at`: everything round it (on the ground near it) hit, harder nearer,
 * thrown and staggered. Its cause is `'slam'`: it comes down on them from above, so a shield held
 * in front (the Knight's) doesn't turn it.
 */
export function slamAt(game: GameContext, by: Player, at: Vec3, o: SlamOpts, effects = true): Entity[] {
  const hit: Entity[] = [];
  for (const e of game.entities.near(at, o.radius + 1.5)) {
    if (!e.alive) continue;
    const q = e.position;
    const d = Math.hypot(q.x - at.x, q.z - at.z);
    if (d > o.radius + 0.4 || Math.abs(q.y - at.y) > 2.2) continue;
    const f = 1 - 0.5 * Math.min(1, d / (o.radius + 0.4));
    if (!e.damage(o.damage * f, { source: by, knockback: o.knockback * f, weapon: o.weapon, cause: 'slam', from: at })) continue;
    if (o.stagger > 0) stagger(game, e, o.stagger * f);
    hit.push(e);
  }
  if (effects) {
    game.fx.shockwave({ x: at.x, y: at.y + 0.15, z: at.z }, o.radius, '#e8d2a0');
    game.fx.burst({ x: at.x, y: at.y + 0.2, z: at.z }, { color: '#c8b088', count: 30, speed: 5, size: 0.12, gravity: 9, life: 0.7, drag: 1.5 });
    game.fx.burst({ x: at.x, y: at.y + 0.3, z: at.z }, { color: '#fff0c0', count: 12, speed: 3, size: 0.1, glow: 1.2, life: 0.3 });
    game.audio.play('arena_slam', { at, pitch: 1.1 - Math.min(0.3, o.radius / 20) });
  }
  return hit;
}

/** A legendary's trick on a hit (or, for a slam, `slam` where it landed). */
export function legendHit(game: GameContext, me: Player, target: Entity | null, def: ArmsMelee, item: string, o: { crit: boolean; back: boolean; amount: number; slam?: Vec3 }) {
  switch (def.legend) {
    // Earthshaker: the ground shakes again a moment after a slam, further out.
    case 'earthshaker': {
      const at = o.slam;
      if (!at) return;
      game.clock.after(0.45, () => slamAt(game, me, at, { radius: 6, damage: 9, knockback: 1.2, weapon: item, stagger: 0.8 }));
      return;
    }
    // Nightfang: a crit bleeds; a crit that kills mends a heart.
    case 'nightfang':
      if (!target || !o.crit) return;
      if (target.alive) bleed(target, me, 4, 3);
      else me.heal(2);
      return;
    // Headsman: anything but a boss under a quarter of its health is cleaved through.
    case 'headsman':
      if (target?.alive && !isBoss(target) && target.health < target.maxHealth / 4) {
        const q = target.position;
        game.fx.burst({ x: q.x, y: q.y + 1.2, z: q.z }, { color: '#ff3030', count: 30, speed: 5, size: 0.14, life: 0.5 });
        game.audio.play('arena_execute', { at: q });
        bus.emit('feat', { player: me, name: 'execute', text: 'Beheaded!' });
        target.damage(target.health + 50, { source: me, knockback: 1.5, weapon: item, cause: 'melee', crit: true });
      }
      return;
    // Starfall: a jump attack calls a star down on whatever it hit.
    case 'starfall': {
      if (!target || !o.crit || o.back) return;
      const q = { ...target.position };
      game.clock.after(0.12, () => {
        const bolt = game.props.bolt({ color: '#bfe0ff', length: 14, width: 0.6, intensity: 8, flicker: 0.3 });
        bolt.position.set(q.x, q.y + 14, q.z);
        bolt.quaternion.setFromUnitVectors(new math.Vector3(0, 0, -1), new math.Vector3(0, -1, 0));
        game.clock.after(0.2, () => bolt.remove());
        slamAt(game, me, q, { radius: 3, damage: 10, knockback: 1, weapon: item, stagger: 0.5 }, false);
        game.fx.shockwave({ x: q.x, y: q.y + 0.1, z: q.z }, 3, '#bfe0ff');
        game.fx.burst({ x: q.x, y: q.y + 0.5, z: q.z }, { color: '#e0f0ff', count: 30, speed: 5, glow: 1.5, life: 0.4 });
        game.audio.play('arena_starfall', { at: q });
      });
      return;
    }
    // Impaler: its thrusts stagger.
    case 'impaler':
      if (target?.alive) stagger(game, target, 0.4);
      return;
  }
}

/** A legendary's trick on every swing, hit or miss: the Sunderer's wave of steel. */
export function legendSwing(game: GameContext, me: Player, def: ArmsMelee, item: string) {
  if (def.legend === 'sunderer') wave(game, me, item);
}
