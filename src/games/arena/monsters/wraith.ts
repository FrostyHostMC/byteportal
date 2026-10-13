import { CHARACTER_STYLE, Models, type Behavior, type Entity, type GameContext, type Player, type Vec3 } from '@platform';
import { MONSTER_MODELS } from './models';
import type { MonsterKind } from './registry';
import { flat, held, inPit, show } from './util';

/**
 * The Wraith: a hooded skull in a ragged shroud, floating. Every few seconds it blinks: fading
 * out in a cold glow and coming back beside or behind you a moment later. Close enough, it raises its claws and
 * drains you, a ghost-light tether pulling your life into it: get out of reach, break its line of
 * sight, or hit it hard enough and the tether snaps.
 */

interface WraithState {
  _blink?: number;
  _fade?: number;
  _dcd?: number;
  _tell?: number;
  _drain?: number;
  _tick?: number;
  _hp?: number;
  _taken?: number;
  _stun?: number;
  _strafe?: number;
}

const GHOST = '#6affc8';
const DRAIN_RANGE = 6.5;
/** What its drain takes each tick (a third of a second), and the damage to it that breaks the tether. */
const DRAIN = 1.3;
const BREAK = 8;

/** Where to come back: beside or behind them, a few blocks off, somewhere it fits. */
function blinkSpot(game: GameContext, self: Entity, target: Player): Vec3 | null {
  const p = target.position;
  const look = target.look;
  const back = Math.atan2(-look.x, -look.z);
  for (let n = 0; n < 8; n++) {
    const a = back + game.rng.range(-1.3, 1.3) * (n < 5 ? 1 : 2.4);
    // (Out of a blade's reach, inside its drain's.)
    const r = game.rng.range(4.5, 5.8);
    const at = { x: p.x + Math.sin(a) * r, y: p.y + 0.05, z: p.z + Math.cos(a) * r };
    if (inPit(game, at) && flat(at, self.position) > 2) return at;
  }
  return null;
}

function endDrain(game: GameContext, self: Entity, s: WraithState) {
  if (s._drain === undefined) return;
  s._drain = undefined;
  self.glow(null);
  self.animate('none');
  show(game, 'tether', { id: self.id, player: null });
}

const wraithAI: Behavior = (self, game, dt) => {
  const s = self.data as WraithState;
  if (
    held(self, () => {
      const had = s._fade !== undefined || s._tell !== undefined || s._drain !== undefined;
      if (s._drain !== undefined) show(game, 'tether', { id: self.id, player: null });
      s._fade = s._tell = s._drain = undefined;
      return had;
    })
  )
    return;
  s._blink = (s._blink ?? game.rng.range(1.5, 3)) - dt;
  s._dcd = (s._dcd ?? game.rng.range(1.5, 3)) - dt;
  const lost = Math.max(0, (s._hp ?? self.health) - self.health);
  s._hp = self.health;
  const target = self.nearestPlayer();
  const e = self.position;
  if (!target) {
    endDrain(game, self, s);
    self.stop();
    return;
  }
  if ((s._stun ?? 0) > 0) {
    s._stun! -= dt;
    self.stop();
    return;
  }
  const d = self.distanceTo(target);
  // Fading out: in a moment, gone and back elsewhere.
  if (s._fade !== undefined) {
    self.stop();
    s._fade -= dt;
    if (s._fade > 0) return;
    s._fade = undefined;
    self.glow(null);
    self.animate('none');
    const to = blinkSpot(game, self, target);
    if (!to) return;
    game.fx.burst({ x: e.x, y: e.y + 1.1, z: e.z }, { color: GHOST, count: 26, speed: 2.5, gravity: -2, glow: 1, life: 0.6, drag: 2 });
    self.teleport(to);
    game.fx.burst({ x: to.x, y: to.y + 1.1, z: to.z }, { color: GHOST, count: 30, speed: 3.5, gravity: -1, glow: 1, life: 0.5, drag: 2 });
    game.audio.play('blink', { at: to });
    s._blink = game.rng.range(4.5, 6.5);
    s._dcd = Math.min(s._dcd, 0.6);
    return;
  }
  // Draining: the tether holds while it's near, sees them, and isn't hit too hard.
  if (s._drain !== undefined) {
    self.stop();
    self.lookAt(target);
    s._taken = (s._taken ?? 0) + lost;
    if (d > DRAIN_RANGE + 2 || !self.canSee(target) || (s._taken ?? 0) >= BREAK) {
      game.audio.play('drain_break', { at: e });
      game.fx.burst({ x: e.x, y: e.y + 1.4, z: e.z }, { color: GHOST, count: 18, speed: 3, glow: 1, life: 0.4 });
      endDrain(game, self, s);
      s._stun = (s._taken ?? 0) >= BREAK ? 0.9 : 0;
      s._dcd = 4;
      return;
    }
    s._drain -= dt;
    s._tick = (s._tick ?? 0) - dt;
    if (s._tick <= 0) {
      s._tick = 0.3;
      if (target.damage(DRAIN, { source: self, knockback: 0, cause: 'drain' })) self.heal(1);
    }
    if (s._drain <= 0) {
      endDrain(game, self, s);
      s._dcd = game.rng.range(4, 6);
    }
    return;
  }
  // Raising its claws: the drain in a moment (hit it now and it never starts).
  if (s._tell !== undefined) {
    self.stop();
    self.lookAt(target);
    s._tell -= dt;
    if (lost >= 5 || d > DRAIN_RANGE + 1) {
      s._tell = undefined;
      self.glow(null);
      self.animate('none');
      s._dcd = 2;
      return;
    }
    if (s._tell > 0) return;
    s._tell = undefined;
    s._drain = 2.4;
    s._tick = 0.15;
    s._taken = 0;
    game.audio.play('drain', { at: e });
    show(game, 'tether', { id: self.id, player: target.id, color: GHOST });
    return;
  }
  // It blinks whenever it can: in from afar, or round behind you, or away from a blade.
  if (s._blink <= 0 && self.canSee(target)) {
    s._fade = 0.45;
    self.animate('cast');
    self.glow(GHOST);
    game.audio.play('wraith_fade', { at: e });
    return;
  }
  if (d <= DRAIN_RANGE && s._dcd <= 0 && self.canSee(target)) {
    s._tell = 0.55;
    self.stop();
    self.animate('raise');
    self.glow(GHOST);
    game.audio.play('wraith', { at: e, pitch: 1.3, volume: 1.1 });
    return;
  }
  // Drifting in to reach, then circling.
  self.lookAt(target);
  if (d > 4.5) self.moveTo(target);
  else {
    const p = target.position;
    const l = Math.hypot(e.x - p.x, e.z - p.z) || 1;
    const sd = (s._strafe ??= game.rng.chance(0.5) ? 1 : -1);
    self.moveDirection(((p.z - e.z) / l) * sd, (-(p.x - e.x) / l) * sd);
  }
};

const LOOK = Models.gltf(MONSTER_MODELS.wraith, { rig: 'humanoid', ...CHARACTER_STYLE });

export const wraith: MonsterKind = {
  id: 'wraith',
  cost: 2.5,
  from: 8,
  weight: 0.7,
  max: 3,
  role: 'special',
  tip: 'It blinks behind you and drains your life: break its line of sight, or hit it hard',
  color: '#6affc8',
  define: () => ({
    name: 'Wraith',
    model: LOOK,
    hitbox: { width: 0.7, height: 2 },
    health: 28,
    speed: 3.6,
    knockbackResistance: 0.4,
    ai: wraithAI,
    drops: [
      { item: 'heart', chance: 0.2 },
      { item: 'health_potion', chance: 0.15 },
    ],
    sounds: { ambient: 'wraith', hurt: 'wraith_hurt' },
    bloodColor: GHOST,
  }),
  slain(game, e) {
    show(game, 'tether', { id: e.id, player: null });
    const q = e.position;
    game.fx.burst({ x: q.x, y: q.y + 1.2, z: q.z }, { color: GHOST, count: 40, speed: 3, gravity: -3, glow: 1, life: 0.9, drag: 1.5 });
  },
};
