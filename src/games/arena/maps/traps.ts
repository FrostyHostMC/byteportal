import type { Entity, GameContext, Player, Prop, Vec3 } from '@platform';
import { bus } from '../run/bus';
import { gold, spend } from '../run/gold';
import { inFight, map } from '../run/state';
import { addUsable } from '../run/use';
import { bell, fallingIcicle, hammerHead, leverHandle, leverStand, scythe, spikes } from './models';
import { TRAP_MSG, type TrapMessage } from './messages';
import { place, turn } from './props';
import { FLOOR, inBox, type Box, type TrapSpec, type ArenaMap } from './registry';

/**
 * The traps (`TrapSpec`): a lever each, pulled with E for gold, which sets the trap going for a
 * while and leaves it cooling down after. Traps hurt monsters only, and their kills are the
 * puller's (`weapon: 'trap'`, so the run's gold and the crowd count them); three or more in one go
 * is a feat for the announcer. Each screen shows them working from the message `TRAP_MSG` (the
 * fire and frost, `client/maps/traps.ts`); what moves (spikes, blades, the hammer, the bell, the
 * icicles) moves here, as props.
 */

/** The weapon the kills are credited to. */
export const TRAP_WEAPON = 'trap';

/** How long the warning (a rattle, a hiss) runs before a trap bites. */
const WARN = 0.35;

interface Running {
  spec: TrapSpec;
  /** Who pulled it last (its kills are theirs), and when (the match's clock). */
  by: Player | null;
  at: number;
  /** It's going until then; it can be pulled again from `ready`. */
  until: number;
  ready: number;
  /** Seconds into this pull, and the kills it's made. */
  t: number;
  kills: number;
  /** Who it's hit lately (entity id → when it may again). */
  hit: Map<number, number>;
  /** Its props: the lever's handle, and its moving parts. */
  handle: Prop | null;
  parts: Prop[];
  /** The kind's own going state (the hammer's beat, the icicles' next fall…). */
  beat: number;
  falling: { prop: Prop; at: Vec3; lands: number }[];
}

const running = new Map<string, Running>();

/** Every trap of every map, by id. */
let all = new Map<string, { spec: TrapSpec; map: ArenaMap }>();

const now = (game: GameContext) => game.clock.now;

/**
 * Note every map's traps and give each its lever (a usable while its map's the one being fought
 * on). Once a game.
 */
export function setupTraps(game: GameContext, maps: readonly ArenaMap[]) {
  all = new Map(maps.flatMap((m) => (m.traps ?? []).map((spec) => [spec.id, { spec, map: m }] as const)));
  running.clear();
  for (const { spec, map: m } of all.values()) {
    addUsable({
      id: `trap:${spec.id}`,
      at: () => (map() === m ? { x: spec.lever.at.x, y: spec.lever.at.y + 0.9, z: spec.lever.at.z } : null),
      reach: 2.4,
      label: (p) => label(game, spec, p),
      use: (g, p) => pull(g, spec, p),
    });
  }
  game.commands.register('trap', {
    usage: '<trap>',
    help: 'Set a trap off, free',
    cheat: true,
    complete: () => (map().traps ?? []).map((t) => t.id),
    run: ([id], g, p) => {
      const spec = (map().traps ?? []).find((t) => t.id === id);
      if (!spec) return `Traps here: ${(map().traps ?? []).map((t) => t.id).join(', ')}`;
      const r = running.get(spec.id);
      if (r) r.ready = 0;
      pull(g, spec, p, true);
    },
  });
}

/** What a lever's prompt says to this fighter. */
function label(game: GameContext, spec: TrapSpec, p: Player): string | null {
  if (!inFight()) return null;
  const r = running.get(spec.id);
  const t = now(game);
  if (r && t < r.until) return `${spec.name} · running`;
  if (r && t < r.ready) return `${spec.name} · ready in ${Math.ceil(r.ready - t)}s`;
  return gold(p) >= spec.price ? `${spec.name} · ${spec.price} gold` : `${spec.name} · needs ${spec.price} gold`;
}

function pull(game: GameContext, spec: TrapSpec, p: Player, free = false) {
  const r = running.get(spec.id);
  const t = now(game);
  if (!inFight() || !r || t < r.ready) return;
  if (!free && !spend(game, p, spec.price)) {
    p.audio.play('trap_deny');
    p.hud.toast(`${spec.name} needs ${spec.price} gold`);
    return;
  }
  Object.assign(r, { by: p, at: t, until: t + WARN + spec.time, ready: t + spec.cooldown, t: 0, kills: 0, beat: 0 });
  r.hit.clear();
  game.audio.play('trap_lever', { at: spec.lever.at });
  game.audio.play(WARN_SOUND[spec.kind], { at: middle(spec) });
  game.clients.send('all', TRAP_MSG, { id: spec.id, time: WARN + spec.time } satisfies TrapMessage);
  game.hud.feed([{ text: p.name, color: '#ffd36b' }, ` sets off the ${spec.name}`], { color: '#ffb36b' });
}

/** The sound each kind warns with, as it's pulled. */
const WARN_SOUND: Record<TrapSpec['kind'], string> = {
  spikes: 'trap_rattle',
  jets: 'trap_ignite',
  pendulum: 'trap_chain',
  bell: 'trap_chain',
  crusher: 'trap_hiss',
  sluice: 'trap_gong',
  icicles: 'trap_crack',
};

/** Where a trap is, roughly: the middle of its zone, its bell, its first jet. */
function middle(spec: TrapSpec): Vec3 {
  if (spec.kind === 'bell') return spec.bell;
  if (spec.kind === 'jets') return spec.jets[0].at;
  if (spec.kind === 'pendulum') return spec.blades[0].pivot;
  if (spec.kind === 'sluice') return spec.channel[0];
  const b = spec.zone[0];
  return { x: (b.min.x + b.max.x + 1) / 2, y: b.max.y + 1, z: (b.min.z + b.max.z + 1) / 2 };
}

// -------------------------------------------------------------------------------------------------
// Each fight
// -------------------------------------------------------------------------------------------------

const SPIKE_REST = -1.95;
const SPIKE_UP = -0.15;
const SPIKE_HALF = -0.95;
/** A pendulum's blades hang swung up to this side at rest (radians), and swing this far either way. */
const BLADE_REST = -1.35;
const BLADE_SWING = 1.25;
const BLADE_PERIOD = 2.1;
/** The hammer: up at rest, `drop` blocks lower at the end of its fall. */
const HAMMER_BEAT = 1.7;
/** A lever's handle leans this far back when it's ready, as far forward once it's pulled. */
const HANDLE = 0.6;

/** A fight begins: the current map's levers and moving parts, all at rest. */
export function startTraps(game: GameContext) {
  running.clear();
  for (const spec of map().traps ?? []) {
    place(game, leverStand(), spec.lever.at, spec.lever.face);
    const handle = place(game, leverHandle(), { x: spec.lever.at.x, y: spec.lever.at.y + 0.3, z: spec.lever.at.z }, spec.lever.face);
    turn(handle, spec.lever.face, -HANDLE);
    const r: Running = { spec, by: null, at: -99, until: -99, ready: 0, t: 0, kills: 0, hit: new Map(), handle, parts: [], beat: 0, falling: [] };
    running.set(spec.id, r);
    if (spec.kind === 'spikes')
      for (const b of spec.zone) r.parts.push(place(game, spikes(b.max.x - b.min.x + 1, b.max.z - b.min.z + 1), { x: b.min.x, y: b.min.y + SPIKE_REST, z: b.min.z }, 0));
    if (spec.kind === 'pendulum')
      for (const blade of spec.blades) {
        const p = place(game, scythe(blade.length), blade.pivot, blade.axis === 'x' ? 0 : Math.PI / 2);
        turn(p, blade.axis === 'x' ? 0 : Math.PI / 2, BLADE_REST);
        r.parts.push(p);
      }
    if (spec.kind === 'bell') r.parts.push(place(game, bell(), spec.bell, 0));
    if (spec.kind === 'crusher') {
      const h = spec.head;
      r.parts.push(place(game, hammerHead(h.max.x - h.min.x + 1, h.max.y - h.min.y + 1), { x: (h.min.x + h.max.x + 1) / 2, y: h.min.y, z: (h.min.z + h.max.z + 1) / 2 }, 0));
    }
  }
}

/** Every tick: the levers' handles, and each trap that's going. */
export function updateTraps(game: GameContext, dt: number) {
  const t = now(game);
  for (const r of running.values()) {
    // The handle: pulled forward while it's going, creeping back as it cools down (in steps: a
    // still handle sends nothing).
    if (r.handle) {
      const back = r.ready > r.until ? Math.min(1, Math.max(0, (t - r.until) / (r.ready - r.until))) : 1;
      const tilt = t < r.until ? HANDLE : HANDLE - 2 * HANDLE * Math.round(back * 8) / 8;
      turn(r.handle, r.spec.lever.face, tilt);
    }
    if (t >= r.until) {
      if (r.t > 0) finish(game, r);
      continue;
    }
    r.t += dt;
    if (r.t < WARN) continue;
    const s = r.t - WARN;
    tick(game, r, s, dt);
  }
}

/** It's stopped: its parts back to rest, and a feat if it did well. */
function finish(game: GameContext, r: Running) {
  const spec = r.spec;
  r.t = 0;
  if (spec.kind === 'spikes') {
    for (const p of r.parts) p.position.y = spec.zone[0].min.y + SPIKE_REST;
    game.audio.play('trap_spikes_down', { at: middle(spec) });
  }
  if (spec.kind === 'pendulum') r.parts.forEach((p, i) => turn(p, spec.blades[i].axis === 'x' ? 0 : Math.PI / 2, BLADE_REST));
  if (spec.kind === 'crusher') r.parts[0].position.y = spec.head.min.y;
  if (spec.kind === 'sluice') drain(game, spec.channel);
  for (const f of r.falling) f.prop.remove();
  r.falling = [];
  if (r.kills >= 3 && r.by) bus.emit('feat', { player: r.by, name: 'trap', text: `${spec.name}: ${r.kills} slain` });
}

/** Monsters standing over a zone (feet in it, or just above it). */
function standingIn(game: GameContext, zone: Box[]): Entity[] {
  const out: Entity[] = [];
  for (const b of zone) {
    const mid = { x: (b.min.x + b.max.x + 1) / 2, y: b.max.y + 1, z: (b.min.z + b.max.z + 1) / 2 };
    const reach = Math.hypot(b.max.x - b.min.x + 1, b.max.z - b.min.z + 1) / 2 + 1;
    for (const e of game.entities.near(mid, reach)) {
      const p = e.position;
      if (p.x >= b.min.x && p.x < b.max.x + 1 && p.z >= b.min.z && p.z < b.max.z + 1 && p.y >= b.min.y + 0.5 && p.y < b.max.y + 3) out.push(e);
    }
  }
  return out;
}

/** Hurt a monster for the trap (once per `every` seconds at most), counting a kill. */
function hurt(game: GameContext, r: Running, e: Entity, amount: number, opts: { every?: number; knockback?: number; from?: Vec3; cause?: string } = {}): boolean {
  if (!e.alive) return false;
  const t = now(game);
  if ((r.hit.get(e.id) ?? 0) > t) return false;
  r.hit.set(e.id, t + (opts.every ?? 0.45));
  const landed = e.damage(amount, { source: r.by ?? undefined, weapon: TRAP_WEAPON, cause: opts.cause ?? 'trap', knockback: opts.knockback ?? 0.3, from: opts.from });
  if (landed && !e.alive) r.kills++;
  return landed;
}

/** A trap at work, `s` seconds after it bit. */
function tick(game: GameContext, r: Running, s: number, dt: number) {
  const spec = r.spec;
  switch (spec.kind) {
    case 'spikes': {
      // Stab and half draw back, twice a second; each stab hurts.
      const phase = (s % 0.5) / 0.5;
      const y = phase < 0.16 ? SPIKE_HALF + (SPIKE_UP - SPIKE_HALF) * (phase / 0.16) : phase < 0.6 ? SPIKE_UP : SPIKE_UP + (SPIKE_HALF - SPIKE_UP) * ((phase - 0.6) / 0.4);
      const first = s < 0.5 && phase < 0.16;
      for (const p of r.parts) p.position.y = spec.zone[0].min.y + (first ? SPIKE_REST + (SPIKE_UP - SPIKE_REST) * (phase / 0.16) : y);
      // (`beat`: the stabs made so far.)
      const stab = Math.floor(s / 0.5);
      if (stab >= r.beat && phase >= 0.12) {
        r.beat = stab + 1;
        game.audio.play('trap_spikes', { at: middle(spec), volume: stab === 0 ? 1 : 0.55 });
        for (const e of standingIn(game, spec.zone)) {
          if (hurt(game, r, e, 9, { every: 0.4, knockback: 0.15 })) {
            e.impulse(0, 4, 0);
            const q = e.position;
            game.fx.burst({ x: q.x, y: q.y + 0.4, z: q.z }, { color: '#9c1a12', count: 10, speed: 2.5, gravity: 14, size: 0.12 });
          }
        }
      }
      break;
    }
    case 'jets': {
      // The flames are each screen's; here, who's in them.
      for (const j of spec.jets) {
        const end = { x: j.at.x + j.dir.x * j.length, y: j.at.y + j.dir.y * j.length, z: j.at.z + j.dir.z * j.length };
        const mid = { x: (j.at.x + end.x) / 2, y: (j.at.y + end.y) / 2, z: (j.at.z + end.z) / 2 };
        for (const e of game.entities.near(mid, j.length / 2 + 1.5)) {
          const along = along3(e.position, j.at, j.dir, j.length);
          if (along.d > 1.1 + along.u * 0.9) continue;
          if (spec.element === 'frost') {
            if (hurt(game, r, e, 2.5, { every: 0.3, knockback: 0, cause: 'frost' })) chill(game, e);
          } else hurt(game, r, e, 4, { every: 0.3, knockback: 0.1, cause: 'fire' });
        }
      }
      break;
    }
    case 'pendulum': {
      const a = Math.sin((s / BLADE_PERIOD) * Math.PI * 2 - Math.PI / 2) * BLADE_SWING;
      const swing = s < 0.5 ? BLADE_REST + (a - BLADE_REST) * Math.min(1, s / 0.5) : a;
      spec.blades.forEach((b, i) => {
        const face = b.axis === 'x' ? 0 : Math.PI / 2;
        turn(r.parts[i], face, swing);
        // The blade's edge: `length` down the pole, swung about the axis (tipping toward -z, or -x).
        const out = -Math.sin(swing) * b.length;
        const edge = { x: b.pivot.x + (b.axis === 'z' ? out : 0), y: b.pivot.y - Math.cos(swing) * b.length, z: b.pivot.z + (b.axis === 'x' ? out : 0) };
        if (Math.abs(swing) < 0.95) {
          for (const e of game.entities.near(edge, 2.2)) {
            const q = e.position;
            const dy = edge.y - (q.y + 0.9);
            if (Math.abs(dy) > 1.6) continue;
            if (hurt(game, r, e, 16, { every: 0.7, knockback: 1.6, from: b.pivot })) game.fx.burst({ x: q.x, y: q.y + 1, z: q.z }, { color: '#9c1a12', count: 16, speed: 4, gravity: 12, size: 0.13 });
          }
        }
        // A whoosh at the bottom of each swing (`beat`: the swings so far).
        const pass = Math.floor(s / (BLADE_PERIOD / 2) + 0.5);
        if (i === 0 && pass >= r.beat && s > 0.3) {
          r.beat = pass + 1;
          game.audio.play('trap_blade', { at: edge });
        }
      });
      break;
    }
    case 'bell': {
      // Three tolls, two seconds apart: the bell swings, and each strike's a holy blast.
      const toll = Math.floor(s / 2);
      const k = s - toll * 2;
      turn(r.parts[0], 0, Math.sin(k * Math.PI * 1.5) * 0.35 * Math.exp(-k));
      if (toll >= r.beat && toll < 3 && k > 0.05) {
        r.beat = toll + 1;
        game.audio.play('trap_bell', { at: spec.bell, volume: 1.6 });
        const ground = { x: spec.bell.x, y: FLOOR + 1.2, z: spec.bell.z };
        game.fx.shockwave(ground, spec.reach, '#ffe9a6');
        game.fx.burst({ x: spec.bell.x, y: spec.bell.y - 1.5, z: spec.bell.z }, { color: '#ffe9a6', count: 40, speed: 6, gravity: 0, glow: 1, life: 0.9, drag: 2 });
        for (const e of game.entities.near(ground, spec.reach)) hurt(game, r, e, 14, { every: 1, knockback: 1.4, from: ground, cause: 'holy' });
      }
      break;
    }
    case 'crusher': {
      // Up, a breath at the top, then down hard; a moment on the anvil; back up.
      const h = spec.head;
      const k = (s % HAMMER_BEAT) / HAMMER_BEAT;
      let y: number;
      if (k < 0.08) y = h.min.y - spec.drop * (k / 0.08) ** 2;
      else if (k < 0.3) y = h.min.y - spec.drop;
      else y = h.min.y - spec.drop * (1 - (k - 0.3) / 0.7);
      r.parts[0].position.y = y;
      const slam = Math.floor(s / HAMMER_BEAT);
      if (slam >= r.beat && k >= 0.08) {
        r.beat = slam + 1;
        const at = middle(spec);
        game.audio.play('trap_slam', { at, volume: 1.4 });
        game.fx.shake(0.12, 0.3);
        game.fx.burst({ x: at.x, y: h.min.y - spec.drop + 0.3, z: at.z }, { color: '#8a8178', count: 40, speed: 5, gravity: 4, size: 0.2, life: 1, drag: 2 });
        game.fx.burst({ x: at.x, y: h.min.y - spec.drop + 0.3, z: at.z }, { color: '#ff9a3a', count: 16, speed: 6, gravity: 10, glow: 1, size: 0.08 });
        for (const e of standingIn(game, spec.zone)) hurt(game, r, e, 45, { every: 0.5, knockback: 0.4 });
      }
      break;
    }
    case 'sluice': {
      // Lava runs down the channel a cell at a time, then fills it while it's open.
      const cells = spec.channel;
      const n = Math.min(cells.length, Math.floor((s / 1.4) * cells.length) + 1);
      while (r.beat < n) {
        const c = cells[r.beat++];
        game.world.setBlock(c.x, c.y, c.z, 'lava');
        if (r.beat % 4 === 0) game.audio.play('trap_pour', { at: c, volume: 0.6 });
      }
      for (const e of game.entities.near(middle(spec), 30)) {
        const q = e.position;
        const at = { x: Math.floor(q.x), y: Math.floor(q.y + 0.3), z: Math.floor(q.z) };
        if (game.world.blockName(game.world.getBlock(at.x, at.y, at.z)) !== 'lava') continue;
        if (hurt(game, r, e, 6, { every: 0.4, knockback: 0, cause: 'fire' })) game.fx.burst({ x: q.x, y: q.y + 0.6, z: q.z }, { color: '#ff7a1a', count: 8, speed: 2, gravity: -3, glow: 1, size: 0.1 });
      }
      break;
    }
    case 'icicles': {
      // One breaks off every so often, over a monster in the zone when there is one.
      r.beat -= dt;
      if (r.beat <= 0) {
        r.beat = 0.2;
        const under = standingIn(game, spec.zone);
        const b = spec.zone[Math.floor(game.rng.next() * spec.zone.length)];
        const target = under.length && game.rng.chance(0.65) ? under[Math.floor(game.rng.next() * under.length)].position : null;
        const x = target ? target.x + game.rng.range(-0.6, 0.6) : game.rng.range(b.min.x, b.max.x + 1);
        const z = target ? target.z + game.rng.range(-0.6, 0.6) : game.rng.range(b.min.z, b.max.z + 1);
        const from = { x, y: spec.vault, z };
        const prop = place(game, fallingIcicle(), from, game.rng.range(0, Math.PI * 2));
        const speed = 24;
        prop.launch(from, { x: 0, y: -speed, z: 0 });
        r.falling.push({ prop, at: { x, y: b.min.y + 1, z }, lands: now(game) + (spec.vault - (b.min.y + 1)) / speed });
      }
      const t = now(game);
      r.falling = r.falling.filter((f) => {
        if (t < f.lands) return true;
        f.prop.remove();
        game.audio.play('trap_icicle', { at: f.at, volume: 0.8 });
        game.fx.burst({ x: f.at.x, y: f.at.y + 0.2, z: f.at.z }, { color: '#d9f2ff', count: 18, speed: 3.5, gravity: 12, size: 0.1, glow: 0.3 });
        for (const e of game.entities.near(f.at, 1.6)) if (hurt(game, r, e, 11, { every: 0.25, knockback: 0.3, from: f.at, cause: 'frost' })) chill(game, e);
        return false;
      });
      break;
    }
  }
}

/** Where `p` is along a jet: how far across from its line (`d`), and how far along it (0..1). */
function along3(p: Vec3, a: Vec3, dir: Vec3, len: number): { d: number; u: number } {
  const q = { x: p.x - a.x, y: p.y + 0.9 - a.y, z: p.z - a.z };
  const t = Math.max(0, Math.min(len, q.x * dir.x + q.y * dir.y + q.z * dir.z));
  const d = Math.hypot(q.x - dir.x * t, (q.y - dir.y * t) * 0.6, q.z - dir.z * t);
  return { d, u: t / len };
}

/** Slowed by the cold for a couple of seconds (back to its own pace after). */
export function chill(game: GameContext, e: Entity) {
  const until = now(game) + 2.2;
  const was = e.data._chilled as number | undefined;
  e.data._chilled = until;
  e.setSpeed(0.45 * ((e.data.speed as number | undefined) ?? 1));
  e.glow('#9fdcff');
  if (was !== undefined && was > now(game)) return;
  const check = () => {
    if (!e.alive) return;
    const left = (e.data._chilled as number) - now(game);
    if (left > 0) return void game.clock.after(left, check);
    delete e.data._chilled;
    e.setSpeed((e.data.speed as number | undefined) ?? 1);
    e.glow(null);
  };
  game.clock.after(2.25, check);
}

/** The lava runs back out of a channel, last cell first. */
function drain(game: GameContext, cells: Vec3[]) {
  cells.forEach((c, i) => game.clock.after(((cells.length - i) / cells.length) * 0.8, () => game.world.setBlock(c.x, c.y, c.z, 'air')));
}

/** Whether `p` is in one of the boxes (a hazard's, say). */
export const inZone = (zone: Box[], p: Vec3) => zone.some((b) => inBox(b, p));
