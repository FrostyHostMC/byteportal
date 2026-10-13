import type { Entity, GameContext, Player } from '@platform';
import { isBossType } from '../bosses/ids';
import { SHOWS } from './moves';

/**
 * What the arsenal does to a monster over time, kept by monster: burning (the fire staff, the
 * Sunbow), chilled (frost: slower with each stack) and frozen solid (four stacks), staggered (a
 * parry, a slam, a shield bash). Ticked by the armory part (`updateStatuses`).
 *
 * A frozen or staggered monster stands still and can't attack: its speed goes to nothing, and
 * the timers the platform's behaviours and the Arena's own wait on (`_cd`, a wind-up's `_wind`, an
 * archer's `_draw`) are held off for as long as it lasts. `data.stunned` says how long is left,
 * for any AI that keeps time its own way. A monster's speed is `data.speed` (its own, a Blood
 * Moon's) times what its statuses leave of it. Bosses shrug most of it off: no freezing, staggers
 * a third as long.
 */
interface Status {
  e: Entity;
  burn: number;
  burnDps: number;
  burnBy: Player | null;
  burnWeapon: string;
  /** Seconds to its next burn tick. */
  burnTick: number;
  /** Frost stacks (0..4) and seconds till they thaw. */
  chill: number;
  chillLeft: number;
  frozen: number;
  stun: number;
  /** The stagger under way is a long one (it shows stars). */
  reel: boolean;
  /** Bleeding (Nightfang): per second, for how long. */
  bleed: number;
  bleedDps: number;
  bleedBy: Player | null;
  bleedTick: number;
  /** The speed it was last given, its glow, and what the screens were last told it shows (`SHOWS`). */
  speed: number;
  glow: string | null;
  shown: number;
}

/** Each stack of frost takes this much off a monster's speed; this many freeze it. */
export const CHILL_STEP = 0.16;
export const FREEZE_AT = 4;
const CHILL_TIME = 3;
/** Burning and bleeding hurt this often (seconds: each tick is a hit, its number, its sound). */
const TICK = 1;
/** A stagger this long or longer shows stars (a lightning bolt's twitch doesn't). */
const REEL = 0.6;
const FREEZE_TIME = 1.8;

const statuses = new Map<number, Status>();

const fresh = (e: Entity): Status => ({ e, burn: 0, burnDps: 0, burnBy: null, burnWeapon: 'fire', burnTick: 0, chill: 0, chillLeft: 0, frozen: 0, stun: 0, reel: false, bleed: 0, bleedDps: 0, bleedBy: null, bleedTick: 0, speed: 1, glow: null, shown: 0 });

function of(e: Entity): Status {
  let s = statuses.get(e.id);
  if (!s) statuses.set(e.id, (s = fresh(e)));
  return s;
}

export const isBoss = (e: Entity): boolean => isBossType(e.type);

/** Frozen solid, or reeling: it can't move or strike. */
export const stunned = (e: Entity): boolean => {
  const s = statuses.get(e.id);
  return !!s && (s.frozen > 0 || s.stun > 0);
};
export const frozen = (e: Entity): boolean => (statuses.get(e.id)?.frozen ?? 0) > 0;
export const burning = (e: Entity): boolean => (statuses.get(e.id)?.burn ?? 0) > 0;
export const chillOf = (e: Entity): number => statuses.get(e.id)?.chill ?? 0;

/** Set alight (again from now, at the hotter of the two fires). */
export function burn(game: GameContext, e: Entity, by: Player | null, dps: number, seconds: number, weapon = 'fire') {
  if (!e.alive) return;
  const s = of(e);
  const was = s.burn > 0;
  s.burn = Math.max(s.burn, seconds);
  s.burnDps = Math.max(was ? s.burnDps : 0, dps);
  s.burnBy = by ?? s.burnBy;
  s.burnWeapon = weapon;
  if (!was) {
    s.burnTick = TICK;
    game.audio.play('arena_ignite', { at: e.position, volume: 0.7 });
  }
}

/** A cut that bleeds (`dps` for `seconds`, from `by`). */
export function bleed(e: Entity, by: Player, dps: number, seconds: number) {
  const s = of(e);
  if (s.bleed <= 0) s.bleedTick = TICK;
  s.bleedDps = Math.max(s.bleed > 0 ? s.bleedDps : 0, dps);
  s.bleed = Math.max(s.bleed, seconds);
  s.bleedBy = by;
}

/** `stacks` more frost, lasting `seconds` (longer with Glacier); at `FREEZE_AT` it freezes solid. */
export function chill(game: GameContext, e: Entity, stacks = 1, seconds = CHILL_TIME) {
  if (!e.alive) return;
  const s = of(e);
  if (s.frozen > 0) return;
  const boss = isBoss(e);
  s.chill = Math.min(boss ? 2 : FREEZE_AT, s.chill + stacks);
  s.chillLeft = seconds;
  if (!boss && s.chill >= FREEZE_AT) freeze(game, e, FREEZE_TIME * (seconds / CHILL_TIME));
  settle(e, s);
}

/** Frozen solid for a moment (not a boss). */
export function freeze(game: GameContext, e: Entity, seconds: number) {
  if (!e.alive || isBoss(e)) return;
  const s = of(e);
  s.frozen = Math.max(s.frozen, seconds);
  s.chill = 0;
  hold(e, s.frozen);
  const q = e.position;
  game.fx.burst({ x: q.x, y: q.y + 1, z: q.z }, { color: '#cfefff', count: 24, speed: 2.4, size: 0.16, gravity: 4, glow: 0.6, life: 0.6 });
  game.audio.play('arena_freeze', { at: q });
  settle(e, s);
}

/** Reeling for a moment (a parry, a slam, a bash): bosses a third as long. */
export function stagger(game: GameContext, e: Entity, seconds: number) {
  if (!e.alive) return;
  const s = of(e);
  const t = isBoss(e) ? seconds / 3 : seconds;
  // Dazed: heard when it begins (a long one), not every time it's renewed.
  if (s.stun <= 0 && t >= REEL) game.audio.play('arena_daze', { at: e.position });
  if (t >= REEL) s.reel = true;
  s.stun = Math.max(s.stun, t);
  hold(e, s.stun);
  e.animate('none');
  settle(e, s);
}

/** Thawed and steady again at once (a shattering blow ends a freeze). */
export function thaw(e: Entity) {
  const s = statuses.get(e.id);
  if (!s) return;
  s.frozen = 0;
  s.chill = 0;
  settle(e, s);
}

/** Its attacks held off for `t` seconds: the timers the behaviours wait on, a wind-up or a draw undone. */
function hold(e: Entity, t: number) {
  const d = e.data as { _cd?: number; _wind?: number; _draw?: number; _cast?: number; _fuse?: number; stunned?: number };
  d._cd = Math.max(d._cd ?? 0, t + 0.25);
  d._wind = undefined;
  d._draw = undefined;
  d.stunned = t;
}

/** Its speed and glow as its statuses leave them. */
function settle(e: Entity, s: Status) {
  if (!e.alive) return;
  const base = (e.data.speed as number | undefined) ?? 1;
  const mult = s.frozen > 0 || s.stun > 0 ? 0 : 1 - CHILL_STEP * s.chill;
  const speed = base * mult;
  if (speed !== s.speed) {
    s.speed = speed;
    e.setSpeed(speed);
    if (mult === 0) e.stop();
  }
  const glow = s.frozen > 0 ? '#8fdcff' : s.chill > 0 ? '#bfeaff' : null;
  if (glow !== s.glow) {
    s.glow = glow;
    e.glow(glow);
  }
}

/** Every tick: burning hurts (each half second), frost thaws, staggers wear off, the effects show (throttled). */
export function updateStatuses(game: GameContext, dt: number) {
  for (const [id, s] of statuses) {
    const e = s.e;
    if (!e.alive) {
      tell(game, s);
      statuses.delete(id);
      continue;
    }
    const q = e.position;
    if (s.burn > 0 && e.alive) {
      s.burn -= dt;
      s.burnTick -= dt;
      if (s.burnTick <= 0) {
        s.burnTick += TICK;
        e.damage(s.burnDps * TICK, { source: s.burnBy ?? undefined, knockback: 0, weapon: s.burnWeapon, cause: 'fire' });
      }
    }
    if (s.bleed > 0 && e.alive) {
      s.bleed -= dt;
      s.bleedTick -= dt;
      if (s.bleedTick <= 0) {
        s.bleedTick += TICK;
        e.damage(s.bleedDps * TICK, { source: s.bleedBy ?? undefined, knockback: 0, weapon: 'bleed', cause: 'bleed' });
      }
    }
    if (!e.alive) continue;
    let changed = false;
    if (s.chill > 0 && s.frozen <= 0) {
      s.chillLeft -= dt;
      if (s.chillLeft <= 0) {
        s.chill = 0;
        changed = true;
      }
    }
    if (s.frozen > 0) {
      s.frozen -= dt;
      (e.data as { stunned?: number }).stunned = Math.max(0, s.frozen);
      (e.data as { _cd?: number })._cd = Math.max(((e.data as { _cd?: number })._cd ?? 0), s.frozen + 0.25);
      if (s.frozen <= 0) {
        changed = true;
        game.fx.burst({ x: q.x, y: q.y + 1, z: q.z }, { color: '#dff6ff', count: 14, speed: 2, size: 0.12, gravity: 8, life: 0.5 });
      }
    }
    if (s.stun > 0) {
      s.stun -= dt;
      (e.data as { stunned?: number }).stunned = Math.max(0, s.stun);
      (e.data as { _cd?: number })._cd = Math.max(((e.data as { _cd?: number })._cd ?? 0), s.stun + 0.25);
      if (s.stun <= 0) {
        changed = true;
        s.reel = false;
      }
    }
    if (changed) settle(e, s);
    tell(game, s);
    if (s.burn <= 0 && s.bleed <= 0 && s.chill <= 0 && s.frozen <= 0 && s.stun <= 0) {
      (e.data as { stunned?: number }).stunned = 0;
      statuses.delete(id);
    }
  }
}

/** The screens are told what a monster shows (`SHOWS`) once as it starts and once as it stops, never streamed. */
function tell(game: GameContext, s: Status) {
  const alive = s.e.alive;
  const now = alive ? (s.burn > 0 ? SHOWS.burn : 0) | (s.bleed > 0 ? SHOWS.bleed : 0) | (s.stun > 0 && s.reel ? SHOWS.stun : 0) : 0;
  if (now === s.shown) return;
  s.shown = now;
  game.clients.send('all', 'armory.status', { id: s.e.id, f: now });
}

/** A fresh fight: no monster is under anything. */
export function clearStatuses() {
  statuses.clear();
}
