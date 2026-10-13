import type { ItemKind, ItemKit, ItemUse } from '@platform';
import { canFire, freshTagger, isTagger, lookDir, spend, stepTagger, taggerMove, type BeamWire, type TaggerItem, type TaggerShown, type TaggerState } from './tagger.shared';

/**
 * The tagger's host half (an `ItemKit` of the game's own: `items: [taggers()]`). A player's screen
 * fires at once and sends each shot with its controls (`use.acts`: `[serial, yaw, pitch]`); the
 * host takes a shot if the tagger could have fired it (its rate, its energy, a little slack for
 * the screen's clock), casts it where the target was on that screen (`hitscan` with `rewind`),
 * and tags whoever it meets: damage of the game's own cause, `'tag'`. A bot (no screen) fires
 * here, from the trigger.
 */
export function taggers(): ItemKit<ItemKind<TaggerItem, TaggerState>> {
  return () => ({
    kind: 'tagger',
    stack: 1,
    holds: true,
    state: () => freshTagger(),
    step(use) {
      const held = use.held;
      if (!held?.state) return;
      const st = held.state;
      stepTagger(held.def, st, use.dt);
      if (!use.controls.active) return;
      if (use.acts) {
        for (const a of use.acts) {
          const [serial, yaw, pitch] = a as number[];
          if (a.length !== 3 || !Number.isSafeInteger(serial) || serial <= st.serial || ![yaw, pitch].every((v) => typeof v === 'number' && Number.isFinite(v))) continue;
          // Held to the tagger's rate and energy (a screen can't fire faster than it could have).
          if (!canFire(held.def, st, 0.05)) continue;
          fire(use, held.item, held.def, st, serial, yaw, Math.max(-Math.PI / 2, Math.min(Math.PI / 2, pitch)), true);
        }
      } else if (use.controls.buttonPressed(0) && canFire(held.def, st)) {
        fire(use, held.item, held.def, st, st.serial + 1, use.player.yaw, use.player.pitch, false);
      }
    },
    move: (def) => (isTagger(def) ? taggerMove(def) : null),
    shown: (_v, _item, st) => (st ? ({ energy: Math.round(st.energy * 100) / 100, serial: st.serial } satisfies TaggerShown) : null),
  });
}

/** One shot: the beam, and a tag if it meets someone. */
function fire(use: ItemUse<TaggerItem, TaggerState>, item: string, def: TaggerItem, st: TaggerState, serial: number, yaw: number, pitch: number, fromScreen: boolean) {
  const me = use.player;
  st.serial = serial;
  spend(def, st);
  const eye = me.eye;
  const hit = use.hitscan(eye, lookDir(yaw, pitch), def.range, { rewind: fromScreen });
  // Everyone else draws the beam (the shooter's screen drew it already).
  use.host.send('tagger.beam', [me.id, eye.x, eye.y, eye.z, hit.point.x, hit.point.y, hit.point.z, def.color] satisfies BeamWire, { except: me });
  use.swing('use', 0.4);
  const target = hit.target;
  if (target?.kind !== 'player' || !target.alive || target === me) return;
  if (target.damage(def.damage, { source: me, weapon: item, cause: 'tag', headshot: hit.head })) use.hitMarker(target.alive ? hit.head : 'kill');
}
