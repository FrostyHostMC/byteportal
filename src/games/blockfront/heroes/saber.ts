import type { ItemBase, ItemKind, ItemKit, ItemUse, Player } from '@platform';
import { heroOfSaber, type HeroId } from './defs';
import { GUARD, SABER, SWING_PITCH, swingLength } from './tuning';
import { MSG, p3, type Guard as GuardMsg, type Swing } from './wire';

/** A hero's lightsaber: `kind: 'saber'` (the `sabers()` kit makes it work). */
export interface SaberItem extends ItemBase {
  kind: 'saber';
}

/** What the saber needs to know of the game (`Sabers.configure`, from `rules.ts`). */
export interface SaberRules {
  hostile(a: Player, b: Player): boolean;
  /** A hero (who takes less from a saber). */
  hero(p: Player): boolean;
  /** Times the damage their swings do (Focused Rage), and times how long each takes. */
  damage(p: Player): number;
  pace(p: Player): number;
  /** Their hands are busy (the saber thrown, a choke, lightning, a stance): no swinging. */
  busy(p: Player): boolean;
  /** Their guard can't go up (the saber thrown, a choke, lightning). */
  unguarded(p: Player): boolean;
  /** Someone was cut (after the damage landed): effects, points. */
  cut(by: Player, target: Player, amount: number, item: string): void;
  send(name: string, data: unknown): void;
}

/** One hero's saber as it's being used. */
export interface SaberState {
  /** The combo's swing under way (0..2), or -1; seconds into it, and how long it takes. */
  n: number;
  t: number;
  len: number;
  /** Its blade has crossed (the hit is done). */
  struck: boolean;
  /** Which swing of the combo comes next, and until when (host time) it still follows on. */
  next: number;
  followUntil: number;
  /** When they last pressed to swing (host time; -99: not waiting). */
  asked: number;
  /** The guard is up; the meter; seconds since it last took anything or was up; seconds of a broken guard left. */
  guard: boolean;
  meter: number;
  quiet: number;
  broken: number;
  /** Seconds staggered (parried, guard broken): no swinging or guarding. */
  stagger: number;
}

/** The running saber kind: its hooks and what the heroes' rules ask of it. */
export interface Sabers extends ItemKind<SaberItem> {
  configure(rules: SaberRules): void;
  /** Their saber's state (null: they've never held one). */
  of(p: Player): SaberState | null;
  /** They're guarding now (RMB, the guard up). */
  guarding(p: Player): boolean;
  /** Something hit the guard: the meter takes `cost`; empty, the guard breaks. */
  drain(p: Player, cost: number): void;
  /** Staggered (parried): no swinging or guarding for a moment; any swing is cut short. */
  stagger(p: Player, seconds: number): void;
  /** Back to fresh (a new hero): a full meter, nothing under way. */
  fresh(p: Player): void;
}

const fresh = (): SaberState => ({ n: -1, t: 0, len: 0, struck: false, next: 0, followUntil: -99, asked: -99, guard: false, meter: GUARD.meter, quiet: 99, broken: 0, stagger: 0 });

const DEG = Math.PI / 180;

/**
 * Lightsabers (`kind: 'saber'`), played on the host from the controls (people's and bots' alike):
 *
 * - **LMB: a combo of three swings**, each a slash a different way (`SABER.swings`); a press during
 *   one (or held) chains the next straight after it, and each cleaves everyone in a wide arc ahead
 *   as its blade crosses. Two cuts kill a trooper; heroes take far less.
 * - **RMB: the guard.** It stops what comes from the front (the heroes' `damage` listener,
 *   `rules.ts`, decides what: bolts deflected, swings parried) and costs the meter; empty, it breaks
 *   for a moment. It refills while the guard is down. (Slowing them is the movement ability's.)
 *
 * Every screen hears each swing and the guard going up or down (`wire.ts`): the figures swing and
 * guard (`client/figures`), the blade trails and hums (`client/fx.ts`).
 */
export function sabers(): ItemKit<Sabers> {
  return (host) => {
    const states = new Map<string, SaberState>();
    let rules: SaberRules | null = null;
    const of = (p: Player) => {
      let s = states.get(p.id);
      if (!s) states.set(p.id, (s = fresh()));
      return s;
    };
    const setGuard = (p: Player, s: SaberState, on: boolean, extra?: Partial<GuardMsg>) => {
      if (s.guard === on && !extra) return;
      s.guard = on;
      rules?.send(MSG.guard, { p: p.id, on, ...extra } satisfies GuardMsg);
    };

    const kind: Sabers = {
      kind: 'saber',
      stack: 1,
      holds: true,
      configure(r) {
        rules = r;
      },
      of: (p) => states.get(p.id) ?? null,
      guarding: (p) => states.get(p.id)?.guard ?? false,
      drain(p, cost) {
        const s = of(p);
        s.quiet = 0;
        s.meter = Math.max(0, s.meter - cost);
        if (s.meter > 0 || s.broken > 0) return;
        // Empty: the guard breaks, and they reel.
        s.broken = GUARD.broken;
        s.stagger = Math.max(s.stagger, 0.5);
        setGuard(p, s, false, { broke: true });
        host.audio().play('bfh_guard_break', { at: p.eye });
      },
      stagger(p, seconds) {
        const s = of(p);
        s.stagger = Math.max(s.stagger, seconds);
        s.n = -1;
        setGuard(p, s, false, { st: seconds });
      },
      fresh(p) {
        states.set(p.id, fresh());
      },
      step(use) {
        const p = use.player;
        const s = of(p);
        const dt = use.dt;
        s.stagger = Math.max(0, s.stagger - dt);
        s.broken = Math.max(0, s.broken - dt);
        s.quiet += dt;
        if (!s.guard && s.quiet > GUARD.refillAfter) s.meter = Math.min(GUARD.meter, s.meter + GUARD.refill * dt);
        const held = use.held;
        if (!held || !p.alive || !rules) {
          if (s.guard) setGuard(p, s, false);
          s.n = -1;
          return;
        }
        const c = use.controls;
        const now = use.now;
        // A swing under way: its blade crosses (the cut), then it ends.
        if (s.n >= 0) {
          s.t += dt;
          if (!s.struck && s.t >= s.len * SABER.strike) {
            s.struck = true;
            strike(use, s, held.item, rules);
          }
          if (s.t >= s.len) {
            s.n = -1;
            s.followUntil = now + SABER.follow;
          }
        }
        // The guard: RMB, unless it's broken, they reel, their hands are busy, or they're mid-swing.
        const busy = rules.busy(p);
        const guardUp = c.active && c.button(2) && s.broken === 0 && s.stagger === 0 && s.n < 0 && !rules.unguarded(p);
        if (guardUp !== s.guard) setGuard(p, s, guardUp);
        if (guardUp) s.quiet = 0;
        // LMB: a swing now, or as soon as the one under way ends (the next of the combo, if it
        // follows on in time); held, they keep coming.
        if (c.active && c.buttonPressed(0)) s.asked = now;
        const wants = now - s.asked <= SABER.buffer || (c.active && c.button(0));
        if (wants && s.n < 0 && !guardUp && !busy && s.stagger === 0) {
          if (now > s.followUntil) s.next = 0;
          begin(use, s, s.next, rules);
        }
      },
      reset(p) {
        states.delete(p.id);
      },
      clear() {
        states.clear();
      },
    };
    return kind;
  };
}

/** A swing of the combo begins: its length (quicker in a rage), the sound, every screen told. */
function begin(use: ItemUse<SaberItem>, s: SaberState, n: number, rules: SaberRules) {
  const p = use.player;
  s.n = n;
  s.t = 0;
  s.len = swingLength(n, rules.pace(p));
  s.struck = false;
  s.asked = -99;
  s.next = (n + 1) % 3;
  // Their figure swings for everyone; their own screen swings their first-person arm and plays the
  // whoosh itself, the moment they press (it predicts their swings: `client/predict.ts`).
  use.host.swing(p);
  use.host.audio({ except: p }).play('bfh_saber_swing', { at: p.eye, pitch: SWING_PITCH[n] * (0.96 + Math.random() * 0.08) });
  rules.send(MSG.swing, { p: p.id, n, d: Math.round(s.len * 1000) / 1000 } satisfies Swing);
}

/** The blade crosses: everyone hostile in the arc ahead, in reach and in sight, is cut. */
function strike(use: ItemUse<SaberItem>, s: SaberState, item: string, rules: SaberRules) {
  const me = use.player;
  const game = use.game;
  const eye = me.eye;
  const yaw = me.yaw;
  const fx = -Math.sin(yaw);
  const fz = -Math.cos(yaw);
  const cos = Math.cos(SABER.arc * DEG);
  const base = SABER.damage * (s.n === 2 ? SABER.finisher : 1) * rules.damage(me);
  let hits = 0;
  let killed = false;
  for (const t of game.players) {
    if (t === me || !t.alive || !rules.hostile(me, t)) continue;
    const dx = t.position.x - eye.x;
    const dz = t.position.z - eye.z;
    const d = Math.hypot(dx, dz);
    if (d > SABER.reach + 0.35) continue;
    const dy = t.position.y - me.position.y;
    if (Math.abs(dy) > SABER.height) continue;
    if (d > SABER.close && (dx * fx + dz * fz) / d < cos) continue;
    const chest = { x: t.position.x, y: t.position.y + 1.2, z: t.position.z };
    if (!game.world.lineOfSight(eye, chest)) continue;
    const amount = base * (rules.hero(t) ? SABER.heroes : 1);
    const before = t.health;
    if (!t.damage(amount, { source: me, knockback: SABER.knockback, weapon: item, cause: 'melee', from: me.position })) continue;
    if (t.health < before) {
      hits++;
      if (!t.alive) killed = true;
      rules.cut(me, t, before - t.health, item);
    }
  }
  if (hits) {
    use.hitMarker(killed ? 'kill' : true);
    me.fx.shake(0.03, 0.12);
  }
}

/** The hero whose saber a player holds (for the rules). */
export const heroHolding = (p: Player): HeroId | null => heroOfSaber(p.inventory.held?.item);

/** Where a hero's blade is, near enough (for sparks): ahead of the chest, a little to the right. */
export function bladePoint(p: Player): { x: number; y: number; z: number } {
  const fx = -Math.sin(p.yaw);
  const fz = -Math.cos(p.yaw);
  return { x: p.position.x + fx * 0.55 - fz * 0.12, y: p.position.y + 1.3, z: p.position.z + fz * 0.55 + fx * 0.12 };
}

export { p3 };
