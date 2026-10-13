import { math, type Entity, type GameContext, type ItemBase, type ItemKind, type ItemKit, type ItemUse, type Player, type Vec3 } from '@platform';
import { bus } from '../run/bus';
import { swingTargets } from './melee';
import { launch } from './missiles';
import { downed } from './moves';
import { burn, chill, stagger } from './status';

/**
 * Staffs and wands (`kind: 'staff'`): the fire button casts the spell, held, again as soon as it's
 * ready. Fire: a fireball that bursts where it lands, setting what's round it burning (Emberheart,
 * the legendary, leaves the ground alight). Frost: a quick stream of shards, each a stack of frost
 * on what it hits, four freezing it solid (Winter's Heart: the frozen shatter when slain, freezing
 * those about them: `blessings.ts` hears the death). Storm: lightning to what's under the
 * crosshair that leaps on to the next nearest, and the next (Tempest: twice as many). Played on the
 * host; how they look and sound is each screen's (`client/looks.ts`).
 */
export interface StaffItem extends ItemBase {
  kind: 'staff';
  spell: 'fire' | 'frost' | 'storm';
  damage: number;
  /** Seconds between casts. */
  cooldown: number;
  /** Fire: the burst's reach; storm: how far a bolt leaps. */
  radius?: number;
  /** Storm: how many it leaps to after the first. */
  chain?: number;
  /** Fire: burning damage a second, for how long. */
  burn?: [number, number];
  legend?: string;
}

/** Blessings that hasten spells, lengthen the frost, add leaps (`blessings.ts` sets them). */
export const spellMods = {
  pace: (_p: Player) => 1,
  chain: (_p: Player) => 0,
  fire: (_p: Player) => 1,
  chillTime: (_p: Player) => 3,
};

const FIREBALL_SPEED = 26;

export function staffs(): ItemKit<ItemKind<StaffItem>> {
  return () => {
    const ready = new WeakMap<Player, { cd: number; max: number }>();
    const of = (p: Player) => {
      let r = ready.get(p);
      if (!r) ready.set(p, (r = { cd: 0, max: 1 }));
      return r;
    };
    return {
      kind: 'staff',
      stack: 1,
      upgrades: true,
      holds: true,
      step(use) {
        const r = of(use.player);
        r.cd = Math.max(0, r.cd - use.dt);
        const held = use.held;
        const c = use.controls;
        if (!held || !c.active || r.cd > 0 || downed(use.player)) return;
        if (!c.buttonPressed(0) && !c.button(0)) return;
        r.cd = r.max = held.def.cooldown * spellMods.pace(use.player);
        cast(use, held.item, held.def);
      },
      own(v) {
        const r = of(v.player);
        return { ready: 1 - r.cd / r.max };
      },
      reset(p) {
        ready.delete(p);
      },
    };
  };
}

/** Where a spell leaves the staff: ahead of the eye, a little right and down (where the head is held). */
function tip(p: Player): Vec3 {
  const e = p.eye;
  const l = p.look;
  return { x: e.x + l.x * 0.7 + Math.cos(p.yaw) * 0.22, y: e.y - 0.18 + l.y * 0.7, z: e.z + l.z * 0.7 - Math.sin(p.yaw) * 0.22 };
}

function cast(use: ItemUse<StaffItem>, item: string, def: StaffItem) {
  const p = use.player;
  const game = use.game;
  use.swing('use');
  p.audio.play('arena_cast', { item: { id: item, sound: 'use' } });
  if (def.spell === 'fire') fireball(game, p, item, def);
  else if (def.spell === 'frost') shard(game, p, item, def);
  else lightning(use, item, def);
}

function fireball(game: GameContext, p: Player, item: string, def: StaffItem) {
  const from = tip(p);
  const radius = def.radius ?? 2.6;
  const [dps, secs] = def.burn ?? [3, 3];
  const boost = spellMods.fire(p);
  launch(
    game,
    p,
    {
      look: { streak: { color: '#ff5a0a', length: 0.7, width: 0.7, intensity: 2.2, flicker: 0.35 } },
      speed: FIREBALL_SPEED,
      life: 1.4,
      radius: 0.35,
      pierce: 1,
      damage: def.damage * 0.5 * boost,
      knockback: 0.4,
      weapon: item,
      trail: { color: '#ffb347', every: 0.04, size: 0.16 },
      end: (g, _m, at) => {
        // The burst: hurt and set alight whatever's round it (the one it struck was hit on the way in).
        g.fx.burst(at, { color: '#ff8a2a', count: 36, speed: 5, size: 0.2, glow: 1.6, life: 0.5, gravity: -1 });
        g.fx.burst(at, { color: '#3a2a20', count: 12, speed: 2, size: 0.3, life: 1, gravity: -2, drag: 2 });
        g.fx.shockwave(at, radius, '#ff8a2a');
        g.audio.play('arena_fireburst', { at });
        for (const e of g.entities.near(at, radius + 0.8)) {
          if (!e.alive) continue;
          const q = e.position;
          const d = Math.hypot(q.x - at.x, q.y + 0.9 - at.y, q.z - at.z);
          if (d > radius + 0.6) continue;
          e.damage(def.damage * (1 - 0.4 * Math.min(1, d / radius)) * boost, { source: p, knockback: 0.7, weapon: item, cause: 'explosion', from: at });
          burn(g, e, p, dps * boost, secs, item);
        }
        if (def.legend === 'emberheart') firePool(g, p, at, item);
      },
    },
    from,
    p.look,
  );
}

/** Emberheart: the ground where a fireball burst burns for a while, setting alight whatever walks in (its flames each screen's: `client/fx.ts`). */
const POOL = { radius: 2.4, time: 4 };
function firePool(game: GameContext, p: Player, at: Vec3, item: string) {
  const ground = { x: at.x, y: Math.floor(at.y - 0.5) + 1, z: at.z };
  const hit = game.world.raycast({ x: at.x, y: at.y + 0.2, z: at.z }, { x: 0, y: -1, z: 0 }, 4);
  if (hit) ground.y = hit.point.y;
  game.clients.send('all', 'armory.pool', { x: ground.x, y: ground.y, z: ground.z, radius: POOL.radius, time: POOL.time });
  let n = 0;
  const tick = () => {
    if (n++ >= POOL.time / 0.4) return;
    for (const e of game.entities.near(ground, POOL.radius)) if (e.alive && Math.abs(e.position.y - ground.y) < 1.5) burn(game, e, p, 3, 2, item);
    game.clock.after(0.4, tick);
  };
  tick();
}

function shard(game: GameContext, p: Player, item: string, def: StaffItem) {
  const from = tip(p);
  // A little spray, so a stream of them reads as a stream.
  const l = p.look;
  const j = 0.025;
  const dir = new math.Vector3(l.x + (Math.random() - 0.5) * j, l.y + (Math.random() - 0.5) * j, l.z + (Math.random() - 0.5) * j).normalize();
  launch(
    game,
    p,
    {
      look: { streak: { color: '#a8e4ff', length: 0.7, width: 0.16, intensity: 3.5 } },
      speed: 40,
      life: 0.7,
      radius: 0.3,
      pierce: 1,
      damage: def.damage,
      knockback: 0.15,
      weapon: item,
      trail: { color: '#dff6ff', every: 0.05, size: 0.08, end: '#e6f8ff' },
      hit: (g, _m, e) => chill(g, e, 1, spellMods.chillTime(p)),
    },
    from,
    dir,
  );
}

/** Lightning: to what's under the crosshair (or just off it), then leaping on. */
function lightning(use: ItemUse<StaffItem>, item: string, def: StaffItem) {
  const p = use.player;
  const game = use.game;
  const from = tip(p);
  const range = 22;
  let first: Entity | null = game.entities.raycast(p.eye, p.look, range, { margin: 0.5 })?.entity ?? null;
  first ??= swingTargets(game, p, range, 9)[0] ?? null;
  if (!first) {
    // Nothing to strike: it cracks out to where they look.
    const hit = game.world.raycast(p.eye, p.look, range);
    const end = hit ? hit.point : { x: p.eye.x + p.look.x * range, y: p.eye.y + p.look.y * range, z: p.eye.z + p.look.z * range };
    arc(game, from, end, '#cfe9ff', 0.1);
    game.fx.burst(end, { color: '#cfe9ff', count: 8, speed: 2, glow: 1.5, life: 0.25 });
    return;
  }
  const leaps = (def.chain ?? 3) * (def.legend === 'tempest' ? 2 : 1) + spellMods.chain(p);
  const reach = def.radius ?? 6;
  const struck: Entity[] = [first];
  let at: Vec3 = from;
  let amount = def.damage;
  let killed = false;
  for (let n = 0; n <= leaps; n++) {
    const e = struck[n];
    if (!e) break;
    const q = e.position;
    const to = { x: q.x, y: q.y + 1.1, z: q.z };
    arc(game, at, to, n === 0 ? '#e6f4ff' : '#9fd4ff', n === 0 ? 0.1 : 0.2);
    e.damage(amount, { source: p, knockback: 0.3, weapon: item, cause: 'lightning' });
    if (!e.alive) killed = true;
    else stagger(game, e, 0.25);
    game.fx.burst(to, { color: '#cfe9ff', count: 10, speed: 3, size: 0.08, glow: 1.6, life: 0.25 });
    at = to;
    amount *= 0.82;
    // The next: the nearest not yet struck, in reach and in sight.
    let next: Entity | null = null;
    let best = reach;
    for (const o of game.entities.near(q, reach)) {
      if (!o.alive || struck.includes(o)) continue;
      const d = Math.hypot(o.position.x - q.x, o.position.y - q.y, o.position.z - q.z);
      if (d < best && game.world.lineOfSight(to, { x: o.position.x, y: o.position.y + 1.1, z: o.position.z })) {
        best = d;
        next = o;
      }
    }
    if (next) struck.push(next);
  }
  game.audio.play('arena_zap', { at: first.position, pitch: 0.9 + Math.random() * 0.2 });
  if (struck.length >= 4) bus.emit('feat', { player: p, name: 'chain', text: `Chain ×${struck.length}` });
  use.hitMarker(killed ? 'kill' : struck.length > 2);
  p.fx.shake(0.02, 0.08);
}

const FWD = new math.Vector3(0, 0, -1);
const _d = new math.Vector3();

/** A crackling bolt from `a` to `b`, gone in a blink: two jagged halves. */
function arc(game: GameContext, a: Vec3, b: Vec3, color: string, width: number) {
  const mid = { x: (a.x + b.x) / 2 + (Math.random() - 0.5) * 0.6, y: (a.y + b.y) / 2 + (Math.random() - 0.5) * 0.6, z: (a.z + b.z) / 2 + (Math.random() - 0.5) * 0.6 };
  for (const [s, e] of [
    [a, mid],
    [mid, b],
  ] as const) {
    const len = Math.hypot(e.x - s.x, e.y - s.y, e.z - s.z);
    if (len < 0.05) continue;
    const bolt = game.props.bolt({ color, length: len, width, intensity: 7, flicker: 0.5 });
    bolt.position.set(s.x, s.y, s.z);
    bolt.quaternion.setFromUnitVectors(FWD, _d.set(e.x - s.x, e.y - s.y, e.z - s.z).normalize());
    game.clock.after(0.16, () => bolt.remove());
  }
}

