import { Models, math, type Entity, type GameContext, type Player, type ProjectileSpec, type Vec3 } from '@platform';
import { map } from '../run/state';
import { spawnMonster } from '../run/spawn';
import { adds, angle, announce, brain, chill, drop, fighters, fromSky, lane, mark, near, own, pool, propModel, quicken, ring, root, stagger, standAt, strike, tether, type Ctx, type Move } from './fight';
import { monsterKind } from '../monsters';
import { MODEL } from './models';
import type { BossKind } from './registry';

/**
 * The Lich King (wave 20, the finale): a dead king floating over the sand with a staff of ice.
 * Phase one, he keeps his distance and casts: frost bolts that chill, a frost nova round himself
 * that freezes whoever it catches on the ground (jump it, or be elsewhere), lines of ice spikes
 * erupting along the floor toward you (step aside). Phase two (two thirds): he shields himself
 * behind phylacteries about the arena, each tethered to him, and raises the dead about the
 * fighters while they stand; shatter them all and his shield breaks, leaving him stunned (left
 * standing long enough, they crumble on their own, with no stun). Phase three (a third): soul
 * storms, orbs of souls raining onto marked circles across the whole arena while he channels,
 * holding still. Near the end he's enraged. He floats a block over the floor (higher in the
 * storm), and crowd him and he blinks away: a ring marks where he'll be, and where he was a patch
 * of frost lingers.
 */

const COLOR = '#7fe3ff';
const FROST_C = '#9fe8ff';
const SOUL_C = '#9b7bff';
const FROST: ProjectileSpec = { speed: 22, gravity: 0, damage: 3.5, knockback: 0.5, glow: FROST_C, weapon: 'frost' };
const NOVA = 7.5;
/** Spacing of the ice spikes along their lane, and how wide each one bites. */
const SPIKE_STEP = 1.35;
const SPIKE_R = 1.3;
/** Seconds between one spike and the next along the lane. */
const SPIKE_PACE = 0.05;
const STORM_R = 2.3;
/** How many raised dead may stand at once. */
const RAISED = 5;
/** How high he floats over the floor (blocks), and in the storm. */
const HOVER = 1;
const HOVER_STORM = 2;
/** Seconds his phylacteries hold out on their own before they crack and fall (without the reel a fighter's shattering wins). */
const WARD_TIME = 25;

/** The floor under him (where his spells strike the ground), his feet's height over it aside: an arch or a roof overhead doesn't count. */
const floorAt = (game: GameContext, p: Vec3): Vec3 => standAt(game, p, 8) ?? { x: p.x, y: game.world.surfaceY(Math.floor(p.x), Math.floor(p.z)) + 1, z: p.z };

/** How fast to rise or sink (a share of his speed) to float `want` blocks over the floor. */
function lift(game: GameContext, self: Entity, want: number): number {
  const p = self.position;
  const dy = floorAt(game, p).y + want - p.y;
  return Math.max(-1, Math.min(1, dy * 2));
}

/** His float's height now: higher while the soul storm rages. */
const floatHeight = (self: Entity) => ((self.data.boss as { mem: Record<string, unknown> } | undefined)?.mem.storm ? HOVER_STORM : HOVER);

const bolts: Move = {
  name: 'bolts',
  can: (c) => c.d > 3.5 && c.self.canSee(c.target),
  cooldown: [2.8, 3.6],
  weight: 1.3,
  windup: 0.6,
  start(c) {
    c.self.lookAt(c.target);
    c.self.animate('bolt_wind', { fade: 0.15 });
    c.self.glow(FROST_C);
    c.game.audio.play('frost_charge', { at: c.self.position });
  },
  act(c) {
    const { self, s, game } = c;
    self.glow(null);
    self.animate('bolt', { fade: 0.05 });
    const n = s.enraged ? 6 : 4;
    for (let i = 0; i < n; i++) game.clock.after(i * 0.14, () => self.alive && !bossBusy(self) && self.shoot(FROST, c.target, { lead: 0.6, spread: 0.045 }));
    game.audio.play('frost_bolt', { at: self.position });
  },
  recover: 0.4,
  end: (c) => {
    c.self.glow(null);
    c.self.animate('none', { fade: 0.3 });
  },
};

const nova: Move = {
  name: 'nova',
  can: (c) => c.d < NOVA - 1.5,
  cooldown: [6, 8],
  windup: 1,
  start(c) {
    c.self.animate('nova_wind', { fade: 0.2 });
    ring(c.game, floorAt(c.game, c.self.position), NOVA, c.s.t, FROST_C);
    c.game.audio.play('frost_charge', { at: c.self.position, pitch: 0.6 });
  },
  act(c) {
    const { game, self } = c;
    const p = floorAt(game, self.position);
    self.glow(null);
    self.animate('nova', { fade: 0.05 });
    const { hit } = strike(game, { source: self, at: p, r: NOVA, damage: [9, 4.5], grounded: true, cover: true, knockback: 6, lift: 2, cause: 'magic' });
    for (const f of hit) {
      if (root(game, f, 1.3)) {
        f.hud.pop('FROZEN', { color: FROST_C });
        const q = f.position;
        game.fx.burst({ x: q.x, y: q.y + 1, z: q.z }, { color: FROST_C, count: 20, speed: 2, size: 0.18, gravity: 4 });
      }
      chill(game, f, 0.6, 3);
    }
    game.fx.shockwave({ x: p.x, y: p.y + 0.1, z: p.z }, NOVA + 0.5, FROST_C);
    game.fx.burst({ x: p.x, y: p.y + 0.6, z: p.z }, { color: '#e8fbff', count: 70, speed: 9, size: 0.14, gravity: 2, life: 0.9, drag: 1.5 });
    game.fx.shake(0.3, 0.5);
    game.audio.play('frost_nova', { at: p, volume: 1.3 });
  },
  recover: 0.9,
  end: (c) => {
    c.self.glow(null);
    c.self.animate('none', { fade: 0.3 });
  },
};

/** A line of ice spikes bursting out of the floor toward its target, one after another. */
const spikes: Move = {
  name: 'spikes',
  can: (c) => c.d > 5 && c.d < 22 && c.self.canSee(c.target),
  cooldown: [5, 6.5],
  windup: 0.85,
  start(c) {
    const { game, self, target } = c;
    const p = floorAt(game, self.position);
    const q = target.position;
    const a = angle(p, q);
    // On past them a way; drawn at their floor's height (where it bites).
    const len = Math.min(24, Math.hypot(q.x - p.x, q.z - p.z) + 5);
    const to = { x: p.x + Math.cos(a) * len, y: q.y, z: p.z + Math.sin(a) * len };
    c.s.mem.spikes = { a, len };
    self.lookAt(target);
    self.animate('nova_wind', { fade: 0.2 });
    // (Marked until the last spike's up: they burst out one after another, from him outward.)
    lane(game, { x: p.x + Math.cos(a) * 1.5, y: q.y, z: p.z + Math.sin(a) * 1.5 }, to, SPIKE_R * 2, c.s.t + (len / SPIKE_STEP) * SPIKE_PACE, FROST_C);
    game.audio.play('frost_charge', { at: p, pitch: 0.8 });
  },
  act(c) {
    const { game, self } = c;
    self.glow(null);
    self.animate('nova', { fade: 0.05 });
    const { a, len } = c.s.mem.spikes as { a: number; len: number };
    const p = floorAt(game, self.position);
    const struck = new Set<string>();
    // Along the lane until a wall stops it (up a step, it rises from the step).
    const spots: Vec3[] = [];
    for (let d = 1.5; d <= len; d += SPIKE_STEP) {
      const x = p.x + Math.cos(a) * d;
      const z = p.z + Math.sin(a) * d;
      if (game.world.collisionHeight(Math.floor(x), Math.floor(p.y + 1.3), Math.floor(z)) > 0) break;
      spots.push({ x, y: p.y + game.world.collisionHeight(Math.floor(x), Math.floor(p.y + 0.2), Math.floor(z)), z });
    }
    spots.forEach((at, i) => {
      game.clock.after(i * SPIKE_PACE, () => {
        const spike = own(game, game.props.spawn(propModel(game, MODEL.ice_spike), { position: at }));
        spike.quaternion.setFromEuler(new math.Euler(game.rng.range(-0.15, 0.15), game.rng.range(0, Math.PI * 2), game.rng.range(-0.15, 0.15)));
        spike.play('rise');
        game.clock.after(1.3, () => drop(game, spike));
        if (i % 2 === 0) game.audio.play('ice_spike', { at, pitch: game.rng.range(0.9, 1.15) });
        game.fx.burst({ x: at.x, y: at.y + 0.3, z: at.z }, { color: '#e8fbff', count: 8, speed: 3, size: 0.12, gravity: 10 });
        for (const f of fighters(game)) {
          const q = f.position;
          if (struck.has(f.id) || Math.hypot(q.x - at.x, q.z - at.z) > SPIKE_R || Math.abs(q.y - at.y) > 2) continue;
          struck.add(f.id);
          if (f.damage(8, { source: self, knockback: 0, cause: 'magic', weapon: 'ice_spike' })) {
            f.impulse(0, 9, 0);
            chill(game, f, 0.6, 2);
          }
        }
      });
    });
  },
  recover: 0.6,
  end: (c) => {
    c.self.glow(null);
    c.self.animate('none', { fade: 0.3 });
  },
};

const raisedOf = (c: Ctx, type: string) => c.game.entities.all().filter((e) => e.alive && e.data.master === c.self.id && e.type === type).length;

/** The dead clawing up out of the sand about the fighters (a wraith among them), while his phylacteries shield him. */
const raise: Move = {
  name: 'raise',
  can: (c) => c.s.shield && raisedOf(c, 'zombie') < RAISED - 1,
  cooldown: [10, 12],
  windup: 1.1,
  start(c) {
    c.self.animate('summon', { fade: 0.25 });
    c.game.audio.play('lich_raise', { at: c.self.position });
  },
  act(c) {
    const { game, self } = c;
    self.glow(null);
    const m = map();
    const n = Math.min(RAISED - raisedOf(c, 'zombie'), adds(game, 2, 1));
    // A wraith rises too, while fewer than one for each fighter haunt the floor.
    const wraith = !!monsterKind('wraith') && raisedOf(c, 'wraith') < fighters(game).length;
    for (let i = 0; i < n + (wraith ? 1 : 0); i++) {
      const by = fighters(game)[i % Math.max(1, fighters(game).length)]?.position ?? m.center;
      const at = near(game, by, 6, m.center, m.radius);
      const type = i === n ? 'wraith' : 'zombie';
      const z = spawnMonster(game, type, { x: at.x, y: at.y + 0.05, z: at.z }, { data: { master: self.id, risen: true } });
      if (type === 'zombie') z.health = Math.min(z.health, 10);
      game.fx.burst({ x: at.x, y: at.y + 0.2, z: at.z }, { color: type === 'wraith' ? '#6affc8' : '#5fe87f', count: 26, speed: 2.4, gravity: -2, glow: 1 });
      game.fx.burst({ x: at.x, y: at.y + 0.1, z: at.z }, { color: '#c2a878', count: 14, speed: 2, gravity: 6 });
    }
    game.audio.play('spawn', { at: self.position, pitch: 0.6 });
  },
  recover: 0.8,
  end: (c) => {
    c.self.glow(null);
    c.self.animate('none', { fade: 0.3 });
  },
};

/** Crowded (struck again and again from close by), or stuck: he gathers frost, and blinks to a marked spot well away. */
const blink: Move = {
  name: 'blink',
  can: (c) => ((c.s.mem.pressure as number | undefined) ?? 0) >= 3 || ((c.s.mem.stuckT as number | undefined) ?? 0) > 1.5,
  cooldown: [12, 15],
  weight: 4,
  windup: 0.5,
  start(c) {
    const { game, self, target } = c;
    const m = map();
    // Away from whoever's on him, across the floor from them, somewhere he fits.
    const p = self.position;
    const q = target.position;
    const a = Math.atan2(p.z - q.z, p.x - q.x) + game.rng.range(-0.8, 0.8);
    const r = game.rng.range(7, 10);
    let to = near(game, { x: q.x + Math.cos(a) * r, y: floorAt(game, q).y, z: q.z + Math.sin(a) * r }, 2.5, m.center, m.radius);
    if (Math.hypot(to.x - m.center.x, to.z - m.center.z) > m.radius - 3) to = near(game, m.center, m.radius * 0.5, m.center, m.radius);
    c.s.aim = to;
    c.s.mem.pressure = 0;
    c.s.mem.stuckT = 0;
    self.animate('nova_wind', { fade: 0.15 });
    ring(game, to, 1.8, c.s.t, FROST_C);
    game.fx.burst({ x: p.x, y: p.y + 2.5, z: p.z }, { color: '#e8fbff', count: 30, speed: 2, size: 0.14, gravity: -1, life: 0.6 });
    game.audio.play('frost_charge', { at: p, pitch: 1.4 });
  },
  act(c) {
    const { game, self, s } = c;
    const from = floorAt(game, self.position);
    const to = s.aim!;
    game.fx.burst({ x: from.x, y: from.y + 2.5, z: from.z }, { color: FROST_C, count: 50, speed: 5, size: 0.16, gravity: 1, glow: 1.3, life: 0.8 });
    game.fx.shockwave({ x: from.x, y: from.y + 0.1, z: from.z }, 3, FROST_C);
    // Where he was, a patch of frost that slows whoever stays in it.
    pool(game, self, from, 2.6, 3.5, FROST_C, { damage: 0, every: 0.4, chill: [0.55, 1], weapon: 'frost' });
    self.teleport({ x: to.x, y: to.y + HOVER, z: to.z });
    game.fx.burst({ x: to.x, y: to.y + 2.5, z: to.z }, { color: FROST_C, count: 50, speed: 5, size: 0.16, gravity: 1, glow: 1.3, life: 0.8 });
    game.audio.play('lich_blink', { at: from });
    game.audio.play('lich_blink', { at: to, pitch: 1.2 });
    self.animate('none', { fade: 0.2 });
  },
  recover: 0.35,
};

/** The soul storm: he rises and channels, and souls rain onto marked circles all over the arena. */
const storm: Move = {
  name: 'storm',
  can: (c) => c.s.phase >= 3,
  cooldown: [20, 24],
  weight: 3,
  windup: 1.1,
  start(c) {
    c.self.animate('storm', { fade: 0.3, loop: true });
    c.game.audio.play('lich_roar', { at: c.self.position, volume: 1.4 });
    // (He rises as it begins: `hover`.)
    c.s.mem.storm = { t: 0, next: 0 };
  },
  act(c) {
    c.self.glow(null);
    c.game.audio.play('soul_storm', { volume: 1.2 });
  },
  during(c) {
    const { game, self, s, dt } = c;
    const st = s.mem.storm as { t: number; next: number };
    st.t += dt;
    if (st.t >= st.next) {
      st.next += s.enraged ? 0.24 : 0.3;
      const m = map();
      const fs = fighters(game);
      // Two in five of them on (or near) a fighter, the rest anywhere on the floor.
      const at = game.rng.chance(0.4) && fs.length ? near(game, game.rng.pick(fs).position, 3, m.center, m.radius) : near(game, m.center, m.radius - 2, m.center, m.radius);
      ring(game, at, STORM_R, 1.25, SOUL_C);
      fromSky(game, MODEL.soul_orb, at, 1.25, () => {
        strike(game, { source: self, at, r: STORM_R, damage: 7, knockback: 5, lift: 3, cause: 'magic' });
        game.fx.burst({ x: at.x, y: at.y + 0.4, z: at.z }, { color: SOUL_C, count: 26, speed: 5, size: 0.14, gravity: 3, glow: 1.4, life: 0.8 });
        game.fx.shockwave({ x: at.x, y: at.y + 0.1, z: at.z }, STORM_R + 0.4, SOUL_C);
        game.audio.play('soul_crash', { at, pitch: game.rng.range(0.85, 1.15) });
      }, { height: 30 });
    }
    return st.t > 9;
  },
  recover: 1.4,
  end: (c) => {
    c.s.mem.storm = undefined;
    c.self.glow(null);
    c.self.animate('none', { fade: 0.4 });
  },
};

/** The phylacteries shielding him, and their tethers. */
const wards = (c: Ctx) => c.game.entities.all('phylactery').filter((e) => e.alive && e.data.master === c.self.id);

/** He shields himself: phylacteries about the arena, each tethered to him. */
function shield(c: Ctx) {
  const { game, self, s } = c;
  const m = map();
  const n = Math.min(5, adds(game, 3, 1));
  const off = game.rng.range(0, Math.PI * 2);
  for (let i = 0; i < n; i++) {
    const a = off + (i / n) * Math.PI * 2;
    let at = { x: m.center.x + Math.cos(a) * m.radius * 0.62, y: m.center.y, z: m.center.z + Math.sin(a) * m.radius * 0.62 };
    at = near(game, at, 2, m.center, m.radius);
    const ph = spawnMonster(game, 'phylactery', { x: at.x, y: at.y + 0.05, z: at.z }, { data: { master: self.id } });
    tether(game, ph, self, 600, FROST_C, `teth:${ph.id}`);
    game.fx.burst({ x: at.x, y: at.y + 1.2, z: at.z }, { color: FROST_C, count: 40, speed: 4, size: 0.14, gravity: -1, glow: 1.4 });
  }
  s.shield = true;
  s.mem.wards = game.entities.all('phylactery').filter((e) => e.data.master === self.id).map((e) => e.id);
  s.mem.wardsUntil = game.clock.now + WARD_TIME;
  game.audio.play('shield_up', { at: self.position, volume: 1.3 });
}

/** His last phylactery's gone: the shield shatters and he reels, wide open. */
function shatter(c: Ctx) {
  const { game, self, s } = c;
  const p = self.position;
  s.shield = false;
  s.mem.wards = [];
  game.fx.burst({ x: p.x, y: p.y + 2.5, z: p.z }, { color: FROST_C, count: 90, speed: 9, size: 0.16, gravity: 6, glow: 1.4 });
  game.fx.shockwave({ x: p.x, y: p.y + 0.1, z: p.z }, 7, FROST_C);
  game.fx.flash(FROST_C, 0.25, 0.5);
  game.audio.play('shield_break', { at: p, volume: 1.5 });
  announce(game, 'The shield shatters!', 'He reels: strike now', FROST_C);
  stagger(self, game, 4);
  s.vulnerable = 4;
}

/**
 * He keeps his distance, floating side to side over the floor; close in and he drifts back (never
 * into a wall); far off or out of sight, he glides straight at his target (and blinks if he's stuck).
 */
function drift(c: Ctx) {
  const { self, target, d, game, dt } = c;
  const p = self.position;
  const up = lift(game, self, floatHeight(self));
  self.lookAt(target);
  const mem = c.s.mem as { side?: number; flip?: number; last?: Vec3; stuckT?: number; slowT?: number };
  const q = target.position;
  const l = Math.hypot(p.x - q.x, p.z - q.z) || 1;
  const nx = (p.x - q.x) / l;
  const nz = (p.z - q.z) / l;
  if (d > 15 || !self.canSee(target)) {
    // Making no headway toward them (a pillar, a wall between): that's a blink's cue.
    const moved = mem.last ? Math.hypot(p.x - mem.last.x, p.z - mem.last.z) : 1;
    mem.stuckT = moved < 0.5 * dt ? (mem.stuckT ?? 0) + dt : 0;
    mem.last = { ...p };
    self.fly(-nx, up, -nz);
    return;
  }
  mem.stuckT = 0;
  // Drifting into something (a pillar, a tomb): the other way.
  const slid = mem.last ? Math.hypot(p.x - mem.last.x, p.z - mem.last.z) : 1;
  mem.last = { ...p };
  mem.slowT = slid < 0.4 * dt ? (mem.slowT ?? 0) + dt : 0;
  mem.flip = (mem.flip ?? 0) - dt;
  if (mem.slowT > 0.6) {
    mem.side = -(mem.side ?? 1);
    mem.flip = game.rng.range(1.5, 3);
    mem.slowT = 0;
  } else if (mem.flip <= 0) {
    mem.side = game.rng.chance(0.5) ? 1 : -1;
    mem.flip = game.rng.range(1.5, 3);
  }
  // Backing off is a slow drift (a fighter who closes in can stay on him, and his nova answers that).
  const away = d < 6 ? 0.3 : d > 10 ? -1 : 0;
  const m = map();
  const ox = p.x - m.center.x;
  const oz = p.z - m.center.z;
  const r = Math.hypot(ox, oz) || 1;
  const inward = r > m.radius - 5 ? 1 : 0;
  const side = (mem.side ?? 1) * (d < 6 ? 0.3 : 0.6);
  self.fly(nx * away - nz * side - (ox / r) * inward, up, nz * away + nx * side - (oz / r) * inward);
}

/** Standing (well, floating) still: holding his height over the floor. */
function hang(self: Entity, game: GameContext) {
  self.fly(0, lift(game, self, floatHeight(self)), 0);
}

const lichAI = brain({
  moves: [bolts, nova, spikes, raise, storm, blink],
  tempo: (s) => (s.enraged ? 0.7 : 1),
  chase: drift,
  still: hang,
  phases: [
    {
      at: 0.66,
      pause: 2.2,
      enter(c) {
        roar(c.game, c.self);
        shield(c);
        announce(c.game, 'The Lich King shields himself', 'Shatter the phylacteries', FROST_C);
        c.s.cds.raise = 2.5;
      },
    },
    {
      at: 0.33,
      pause: 2,
      enter(c) {
        roar(c.game, c.self);
        announce(c.game, 'The soul storm', 'Keep moving, and strike him while he channels', SOUL_C);
        c.s.cds.storm = 0;
      },
    },
    {
      at: 0.14,
      pause: 1.4,
      enter(c) {
        roar(c.game, c.self);
        c.s.enraged = true;
        quicken(c.self, 1.3);
        announce(c.game, 'ENRAGED', 'The Lich King spends the last of himself', '#ff5a5a');
      },
    },
  ],
  always(c) {
    const { s, self, dt } = c;
    // Pressed hard up close (blows landing with a fighter on him): the cue to blink away.
    const mem = s.mem as { hp?: number; pressure?: number };
    if (self.health < (mem.hp ?? self.health) && c.d < 4.5) mem.pressure = (mem.pressure ?? 0) + 1;
    mem.pressure = Math.max(0, (mem.pressure ?? 0) - dt * 0.8);
    mem.hp = self.health;
    if (!s.shield) return;
    const left = wards(c);
    const was = s.mem.wards as number[];
    if (left.length < was.length) {
      // A phylactery shattered: its tether goes.
      for (const id of was) if (!left.some((e) => e.id === id)) mark(c.game, { k: 'clear', id: `teth:${id}` });
      s.mem.wards = left.map((e) => e.id);
      if (left.length) announce(c.game, `${left.length} ${left.length === 1 ? 'phylactery stands' : 'phylacteries stand'}`, undefined, FROST_C);
    }
    if (!left.length) shatter(c);
    else if (c.game.clock.now > (s.mem.wardsUntil as number)) {
      // Held out long enough: they crack and fall on their own, and his shield with them (no reel).
      for (const e of left) e.kill();
      for (const id of s.mem.wards as number[]) mark(c.game, { k: 'clear', id: `teth:${id}` });
      s.shield = false;
      s.mem.wards = [];
      c.game.audio.play('shield_break', { at: self.position, volume: 1.1 });
      announce(c.game, 'The phylacteries crumble', 'His shield is down', FROST_C);
    } else if (!s.move) self.glow(Math.sin(self.age * 5) > 0 ? FROST_C : null);
  },
});

/** Whether he's out of the fight for now (his entrance, his throes). */
const bossBusy = (e: Entity) => {
  const s = e.data.boss as { held?: boolean; dying?: unknown } | undefined;
  return !!(s?.held || s?.dying);
};

/** His roar: staff raised, a burst of frost and souls that throws back whoever's close. */
function roar(game: GameContext, e: Entity) {
  const p = floorAt(game, e.position);
  e.animate('roar', { fade: 0.2 });
  game.audio.play('lich_roar', { at: p, volume: 1.6 });
  game.fx.shake(0.3, 1.3);
  game.fx.shockwave({ x: p.x, y: p.y + 0.1, z: p.z }, 9, FROST_C);
  game.fx.burst({ x: p.x, y: p.y + 3, z: p.z }, { color: SOUL_C, count: 50, speed: 6, size: 0.16, gravity: -1.5, glow: 1.4, life: 1.2 });
  game.fx.burst({ x: p.x, y: p.y + 0.5, z: p.z }, { color: '#e8fbff', count: 60, speed: 8, size: 0.14, gravity: 2, life: 1, drag: 1.5 });
  strike(game, { source: e, at: p, r: 5.5, damage: 0.5, knockback: 10, lift: 4, cause: 'shockwave' });
}

/** Struck by a frost bolt: chilled. */
function frostbit(game: GameContext, p: Player) {
  chill(game, p, 0.6, 2);
  p.fx.flash(FROST_C, 0.2, 0.4);
  const q: Vec3 = p.position;
  game.fx.burst({ x: q.x, y: q.y + 1.2, z: q.z }, { color: FROST_C, count: 10, speed: 2, size: 0.12, gravity: 3 });
}

export const lich: BossKind = {
  id: 'lich',
  name: 'The Lich King',
  title: 'Lord of the Frozen Dead',
  color: COLOR,
  height: 5,
  bounty: 600,
  define: () => ({
    name: 'The Lich King',
    model: Models.gltf(MODEL.lich, { clips: { idle: 'idle', walk: 'walk' }, head: 'skull' }),
    hitbox: { width: 1.6, height: 4.6 },
    health: 2000,
    speed: 3,
    knockbackResistance: 1,
    boss: true,
    ai: lichAI,
    sounds: { ambient: 'lich_whisper', hurt: 'lich_hurt' },
    bloodColor: FROST_C,
  }),
  spawned(game, e) {
    const p = e.position;
    game.fx.burst({ x: p.x, y: p.y + 2, z: p.z }, { color: '#e8fbff', count: 90, speed: 7, size: 0.16, gravity: 1, life: 1.6, drag: 1.5 });
    game.fx.burst({ x: p.x, y: p.y + 2.5, z: p.z }, { color: SOUL_C, count: 40, speed: 4, size: 0.14, gravity: -2, glow: 1.4, life: 1.4 });
    game.audio.play('lich_whisper', { at: p, volume: 1.4 });
  },
  roar,
  throes(game, e) {
    e.animate('death', { fade: 0.2 });
    game.audio.play('lich_death', { at: e.position, volume: 1.6 });
    // His tethers go with him.
    for (const ph of game.entities.all('phylactery')) if (ph.data.master === e.id) mark(game, { k: 'clear', id: `teth:${ph.id}` });
  },
  hits: { frost: frostbit },
};
