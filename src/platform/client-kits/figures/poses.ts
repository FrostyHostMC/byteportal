import type { GunStance, HeldPose, HumanoidGait, HumanoidPoses } from '@platform';

type V3 = [number, number, number];
type Held = Required<HeldPose>;
type Stance = Required<Omit<GunStance, 'offHand'>> & { offHand: Held };

/** `HumanoidPoses` with everything filled in: how the figures kit poses a humanoid. */
export interface Poses {
  heldScale: number;
  rifle: Stance;
  pistol: Stance;
  pistolUnder: number;
  kick: { back: number; tip: number; decay: number };
  sprint: Held;
  reload: Held & { cycle: number; belt: V3 };
  lever: Held & { time: number };
  hammer: Held & { time: number };
  sword: Held & { swing: { time: number; windup: number; raise: Held; chop: Held } };
  death: { time: number; backward: number };
  gait: Required<HumanoidGait>;
}

/** The kit's own poses (Call of Blocky's fighters move by them). */
export const DEFAULT_POSES: Poses = {
  heldScale: 0.52,
  // Shouldered (a rifle) or held out in both hands (a pistol), the sights a little under the eye
  // (the face shows); up to the eye aiming down them. One-handed, the free hand hangs loose.
  rifle: { hip: [-0.13, -0.19, 0.27], ads: [-0.05, -0.05, 0.24], twist: -0.18, cheek: 0.12, offHand: { offset: [0.21, -0.56, 0.04], turn: [0, 0, 0] } },
  pistol: { hip: [-0.03, -0.15, 0.4], ads: [0, -0.04, 0.4], twist: -0.18, cheek: 0.12, offHand: { offset: [0.21, -0.56, 0.04], turn: [0, 0, 0] } },
  pistolUnder: 0.45,
  kick: { back: 0.05, tip: 0.14, decay: 22 },
  sprint: { offset: [-0.02, -0.32, 0.18], turn: [0.6, 0.75, 0.1] },
  reload: { offset: [-0.04, -0.2, 0.28], turn: [0.3, 0.35, -0.6], cycle: 1.1, belt: [0.12, -0.02, 0.12] },
  // A lever worked: the gun dips and its muzzle rocks up. A hammer cocked: tipped up, canted in.
  lever: { offset: [0, -0.035, 0.01], turn: [-0.2, 0, 0], time: 0.45 },
  hammer: { offset: [0, 0.01, 0], turn: [-0.12, 0, 0.3], time: 0.26 },
  sword: { offset: [-0.06, -0.3, 0.3], turn: [-0.95, 0.15, 0], swing: { time: 0.4, windup: 0.3, raise: { offset: [0.04, 0.35, -0.1], turn: [-1.1, 0, 0] }, chop: { offset: [0, -0.1, 0.2], turn: [1.9, 0, 0.5] } } },
  death: { time: 0.65, backward: 0.65 },
  gait: { run: [3.5, 7.5], stride: [1.15, 2.4], step: [0.22, 0.52], lift: [0.1, 0.22], bob: [0.02, 0.055], lean: [0.04, 0.18], armSwing: [0.45, 0.95], sway: 0.018, width: 0.1, crouch: 0.33 },
};

/** `d` with what `g` gives (left-out or undefined values keep `d`'s). */
function fill<T extends object>(d: T, g: Partial<T> | undefined): T {
  const out = { ...d };
  if (g) for (const k of Object.keys(g) as (keyof T)[]) if (g[k] !== undefined) out[k] = g[k] as T[keyof T];
  return out;
}

/** A stance given over one filled in (its free hand's pose part by part). */
const stance = (d: Stance, g: GunStance | undefined): Stance => ({ ...fill(d, g as Partial<Stance>), offHand: fill(d.offHand, g?.offHand) });

/**
 * `HumanoidPoses` over the kit's own; or, with `base`, over those (a model's `poses` over the
 * kit's options, an item's `hold.poses` over its figure's: `resolvePoses(item, figure)`).
 */
export function resolvePoses(p: HumanoidPoses = {}, base: Poses = DEFAULT_POSES): Poses {
  const D = base;
  const swing = p.sword?.swing;
  return {
    heldScale: p.heldScale ?? D.heldScale,
    rifle: stance(D.rifle, p.rifle),
    pistol: stance(D.pistol, p.pistol),
    pistolUnder: p.pistolUnder ?? D.pistolUnder,
    kick: fill(D.kick, p.kick),
    sprint: fill(D.sprint, p.sprint),
    reload: fill(D.reload, p.reload),
    lever: fill(D.lever, p.lever),
    hammer: fill(D.hammer, p.hammer),
    sword: {
      ...fill(D.sword, { offset: p.sword?.offset, turn: p.sword?.turn }),
      swing: { ...fill(D.sword.swing, { time: swing?.time, windup: swing?.windup }), raise: fill(D.sword.swing.raise, swing?.raise), chop: fill(D.sword.swing.chop, swing?.chop) },
    },
    death: fill(D.death, p.death),
    gait: fill(D.gait, p.gait),
  };
}
