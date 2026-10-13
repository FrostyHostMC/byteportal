import { math, type ItemBase, type ItemKind, type ItemKit, type Player, type PropModel } from '@platform';
import { launch, type Missile } from './missiles';
import { crossbowMove, downed, type CrossbowShown } from './moves';

/**
 * The crossbow: a click looses a bolt (an arrow from the quiver) that flies flat and fast and goes
 * through several monsters, each taking a little less; then it's spanned again, slowly, by itself
 * (`reload` seconds, only while it's in hand). The right button aims (a little zoom, slower feet).
 * Hailstorm, the legendary, looses three at once.
 *
 * Its kind is `gun`, as far as the screens go (the Arena lists none of the platform's guns): in
 * first person it's held in the gun pose, shouldered to aim, its spanning shown as a reload (the
 * hand to the string and back), and other players' figures shoulder it, from its client half
 * (`client/armory.ts`) reading what the host shows of it (`shown`).
 */
export interface CrossbowItem extends ItemBase {
  kind: 'gun';
  /** What each bolt takes from the quiver. */
  ammo: string;
  damage: number;
  reload: number;
  speed: number;
  /** How many it goes through. */
  pierce: number;
  /** Bolts at once (fanned a little). */
  bolts?: number;
  /** The view's zoom aiming. */
  zoom?: number;
}

/** A carried crossbow: spanned, or how far it is through spanning (-1: not). */
interface Span {
  loaded: boolean;
  reload: number;
}

/** Blessings that span it faster (`blessings.ts` sets it). */
export const crossbowMods = { reload: (_p: Player) => 1, pierce: (_p: Player) => 0 };

let boltModel: PropModel | null = null;
/** The bolt's model, as a prop (in `setup`). */
export const setBoltModel = (m: PropModel) => void (boltModel = m);

const DEG = Math.PI / 180;

export function crossbows(): ItemKit<ItemKind<CrossbowItem, Span>> {
  return () => {
    const aiming = new WeakMap<Player, boolean>();
    return {
      kind: 'gun',
      stack: 1,
      upgrades: true,
      holds: true,
      state: () => ({ loaded: true, reload: -1 }),
      step(use) {
        const held = use.held;
        const p = use.player;
        const c = use.controls;
        aiming.set(p, !!held && c.active && c.button(2));
        if (!held?.state) return;
        const s = held.state;
        const def = held.def;
        const inv = p.inventory;
        if (s.reload >= 0) {
          s.reload += use.dt / (def.reload * crossbowMods.reload(p));
          if (s.reload >= 1) {
            s.reload = -1;
            s.loaded = true;
            use.game.audio.play('arena_xbow_ready', { at: p.eye, item: { id: held.item, sound: 'cycle' } });
          }
        }
        if (!s.loaded && s.reload < 0 && inv.count(def.ammo) > 0) {
          s.reload = 0;
          use.game.audio.play('arena_xbow_crank', { at: p.eye, item: { id: held.item, sound: 'reload' } });
        }
        if (!c.active || !c.buttonPressed(0) || downed(p)) return;
        if (!s.loaded) {
          if (s.reload < 0) p.hud.toast('No arrows');
          return;
        }
        if (!inv.take(def.ammo, 1)) return;
        s.loaded = false;
        loose(p, held.item, def, use.game);
        p.viewModel.kick(1.4);
        use.host.swing(p);
        use.game.audio.play('arena_xbow_shot', { at: p.eye, item: { id: held.item, sound: 'use' } });
      },
      move: crossbowMove,
      shown(v, _item, state) {
        if (!state) return null;
        return { r: Math.round(state.reload * 50) / 50, l: state.loaded, a: aiming.get(v.player) ?? false } satisfies CrossbowShown;
      },
      reset(p) {
        aiming.delete(p);
      },
    };
  };
}

/** The bolt (or three) away from the stock, along the view. */
function loose(p: Player, item: string, def: CrossbowItem, game: Parameters<typeof launch>[0]) {
  if (!boltModel) return;
  const eye = p.eye;
  const n = def.bolts ?? 1;
  const look = new math.Vector3(p.look.x, p.look.y, p.look.z);
  const up = new math.Vector3(0, 1, 0);
  for (let i = 0; i < n; i++) {
    const turn = n > 1 ? (i - (n - 1) / 2) * 7 * DEG : 0;
    const dir = look.clone().applyAxisAngle(up, turn);
    const from = { x: eye.x + dir.x * 0.6 + Math.cos(p.yaw) * 0.1, y: eye.y - 0.12 + dir.y * 0.6, z: eye.z + dir.z * 0.6 - Math.sin(p.yaw) * 0.1 };
    launch(
      game,
      p,
      {
        look: { model: boltModel },
        speed: def.speed,
        life: 1.2,
        radius: 0.2,
        pierce: def.pierce + crossbowMods.pierce(p),
        damage: def.damage,
        knockback: 0.5,
        weapon: item,
        stick: 4,
        // Each it goes through takes a little off the next.
        hit: (g, m: Missile, e) => {
          m.damage *= 0.85;
          g.audio.play('arena_bolt_hit', { at: e.position });
          const q = e.position;
          g.fx.burst({ x: q.x, y: q.y + 1.1, z: q.z }, { color: '#fff0c0', count: 6, speed: 2, size: 0.06, glow: 1, life: 0.2 });
        },
        end: (g, _m, at, wall) => {
          if (wall) g.audio.play('arena_bolt_wall', { at });
        },
      },
      from,
      dir,
    );
  }
}
