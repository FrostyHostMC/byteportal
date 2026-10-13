import { HeldModels, type ItemLook } from '@platform';
import type { Client } from '@platform/client';
import revolverUrl from '../models/revolver.glb?url';
import rifleUrl from '../models/rifle.glb?url';

/**
 * How Dry Gulch's guns look and sound on each screen (`client.items.look`): their models and
 * icons, how each is held, their tracers, and which of the game's voices (`./sounds`) each plays.
 * The server's `weapons.ts` has only what they do (the Peacemaker's hammer and the Yellowboy's
 * lever are actions the gun controller works, so they stay there); it names them (`{ item }`
 * icons in the kill feed) and each screen shows them as it has them here.
 *
 * - The Peacemaker is held in one hand (`hold.gun.hands: 1`): in first person the free hand comes
 *   up only to push rounds into the gate, and a figure's free hand hovers by its belt (the game's
 *   `pistol.offHand`, in `shared.ts`).
 * - Each gun has its own reload on a figure (`hold.poses`): the Peacemaker tipped up to show its
 *   gate, a round each 0.42 s; the Yellowboy rolled to show the gate in its side, each 0.55 s
 *   (each the gun's `reload`, a round at a time).
 */
export const LOOKS: Record<string, ItemLook> = {
  revolver: {
    icon: { gltf: revolverUrl },
    hold: {
      style: 'gun',
      stance: 'pistol',
      model: HeldModels.gltf(revolverUrl),
      scale: 1.2,
      gun: {
        hands: 1,
        // Out at the right, level, a little in toward the middle: a gunslinger's hip shot.
        fist: [0.2, -0.21, -0.5],
        barrel: [-0.05, 0.03, -1],
        roll: 0,
        ads: 0.46,
        // Sprinting: the gun held low by the thigh, muzzle down.
        sprint: { yaw: 0.15, pitch: -1.05, roll: 0.1, move: [0.04, -0.12, 0.1] },
        slide: { roll: 0.25, move: [0, -0.03, 0.02] },
        // One arm out from the right shoulder, bent at the elbow: the forearm drops away under the
        // gun to the screen's lower right, the elbow and upper arm below the screen.
        forearm: { hip: [0.3, -0.62, 0.72], ads: [0.22, -0.5, 0.84] },
        arm: { bend: 0.7, reach: [0.5, 0.62] },
        kick: 0.05,
        rise: 13,
      },
      poses: { reload: { offset: [-0.06, -0.16, 0.32], turn: [-0.75, 0.35, 0.9], cycle: 0.42 } },
    },
    tracer: '#ffe2a0',
    sounds: { use: 'shot_revolver', reload: 'load_round', empty: 'dry_fire' },
  },
  rifle: {
    icon: { gltf: rifleUrl },
    hold: {
      style: 'gun',
      stance: 'rifle',
      model: HeldModels.gltf(rifleUrl),
      gun: {
        fist: [0.22, -0.24, -0.5],
        barrel: [-0.08, 0.04, -1],
        roll: -0.12,
        ads: 0.62,
        kick: 0.09,
        rise: 9,
        // Aimed, both forearms drop away under the gun, bent at the elbows (straight, they'd run back
        // at the eye and fill the bottom of the screen).
        forearm: { ads: [0.3, -0.8, 0.5] },
        forearm2: { ads: [-0.35, -0.85, 0.4] },
        arm: { bend: [0.5, 0.7], scale: 0.85 },
      },
      poses: { reload: { offset: [-0.04, -0.18, 0.3], turn: [0.25, 0.3, 0.75], cycle: 0.55 } },
    },
    tracer: '#fff1c4',
    sounds: { use: 'shot_rifle', reload: 'load_round', empty: 'dry_fire', cycle: 'lever' },
  },
};

/** Each gun's look on this screen (in `setup`, before anything's shown). */
export function defineLooks(client: Client) {
  for (const [id, look] of Object.entries(LOOKS)) client.items.look(id, look);
}
