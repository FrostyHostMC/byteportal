import type { GameContext, Player, Vec3 } from '@platform';
import type { ArenaPart } from '../part';

/**
 * Things a fighter uses with E (or holds E on): the shop, a trap's lever, the mystery chest, a
 * fallen friend to revive. Each part adds its own (`addUsable`); this part shows each fighter a
 * prompt on the nearest one they're facing within reach, and runs it when they press E (or once
 * they've held it `hold` seconds, a bar filling).
 */
export interface Usable {
  id: string;
  /** Where it is (its middle), or null while it's not there (a revive once they're up). */
  at: () => Vec3 | null;
  /** How close they must be (blocks, default 2.5). */
  reach?: number;
  /** The prompt for this fighter ("Buy the trap · 50 gold"), or null: not for them right now. */
  label(p: Player): string | null;
  /** Hold E this long to use it (a revive); default: a press. */
  hold?: number;
  use(game: GameContext, p: Player): void;
}

export const USE_KEY = 'KeyE';

const usables = new Map<string, Usable>();
/** Each fighter's hold in progress: on what, and for how long. */
const holding = new Map<string, { id: string; t: number }>();
/** What each fighter's prompt says now (only changes go out). */
const shown = new Map<string, string>();
/** Fighters who can't use anything for now (downed). */
const barred = new Set<string>();

export const addUsable = (u: Usable) => void usables.set(u.id, u);
export const removeUsable = (id: string) => void usables.delete(id);

/** Keep a fighter from using anything (on the ground, downed), or let them again. */
export function bar(p: Player, on: boolean) {
  if (on) barred.add(p.id);
  else barred.delete(p.id);
}

/** What a fighter is holding E on, and for how long so far (a revive under way), or null. */
export const holdOf = (p: Player): { id: string; t: number } | null => holding.get(p.id) ?? null;

/** The nearest usable a fighter is close to and facing, with its prompt. */
function nearest(p: Player): { u: Usable; label: string; at: Vec3 } | null {
  let best: { u: Usable; label: string; at: Vec3 } | null = null;
  let bestD = Infinity;
  const e = p.eye;
  for (const u of usables.values()) {
    const at = u.at();
    if (!at) continue;
    const dx = at.x - e.x;
    const dy = at.y - e.y;
    const dz = at.z - e.z;
    const d = Math.hypot(dx, dy, dz);
    if (d > (u.reach ?? 2.5) + 0.8) continue;
    // Facing it, roughly (or right on top of it).
    const facing = d < 1.2 || (dx * p.look.x + dy * p.look.y + dz * p.look.z) / d > 0.55;
    if (!facing || d >= bestD) continue;
    const label = u.label(p);
    if (!label) continue;
    best = { u, label, at };
    bestD = d;
  }
  return best;
}

export const usePart: ArenaPart = {
  name: 'use',
  start() {
    holding.clear();
    barred.clear();
  },
  update(game, dt) {
    for (const p of game.players) {
      const n = p.alive && !p.spectating && !barred.has(p.id) ? nearest(p) : null;
      const text = n ? `E · ${n.label}` : '';
      if (shown.get(p.id) !== text) {
        shown.set(p.id, text);
        p.hud.marker('arena.use', n ? n.at : null, n ? { label: text, shape: 'dot', color: '#ffd36b', size: 10 } : undefined);
      }
      const h = holding.get(p.id);
      if (!n) {
        if (h) p.hud.progress(null);
        holding.delete(p.id);
        continue;
      }
      if (!n.u.hold) {
        if (p.input.pressed(USE_KEY)) n.u.use(game, p);
        continue;
      }
      if (!p.input.isDown(USE_KEY)) {
        if (h) p.hud.progress(null);
        holding.delete(p.id);
        continue;
      }
      const t = (h?.id === n.u.id ? h.t : 0) + dt;
      if (t >= n.u.hold) {
        holding.delete(p.id);
        p.hud.progress(null);
        n.u.use(game, p);
      } else {
        holding.set(p.id, { id: n.u.id, t });
        p.hud.progress(t / n.u.hold, { color: '#ffd36b' });
      }
    }
  },
};

/** A fresh game: nothing to use (parts add theirs again in `setup`/`start`). */
export function resetUsables() {
  usables.clear();
  holding.clear();
  shown.clear();
  barred.clear();
}
