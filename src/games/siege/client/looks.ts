import { HeldModels, type GunHold, type ItemLook } from '@platform';
import type { Client } from '@platform/client';
import { GUN_URLS } from '../models';

/**
 * How the weapons look and sound on each screen (`client.items.look`): each gun's model and icon,
 * how it sits in first person (close and low at the right, the forearms dropping away under it),
 * its tracer, and which of the game's voices (`./sounds`) it plays. The server's `weapons.ts` has
 * only what they do.
 */
const FP: GunHold = {
  fist: [0.22, -0.31, -0.44],
  barrel: [-0.3, 0.04, -1],
  roll: -0.12,
  forearm: { hip: [0.35, -0.8, 0.45] },
  forearm2: { hip: [-0.35, -0.85, 0.35] },
  ads: 0.4,
};
const COMPACT: GunHold = { ...FP, fist: [0.12, -0.27, -0.4] };

const gun = (id: string, look: ItemLook, hold: GunHold = FP): ItemLook => ({
  icon: { gltf: GUN_URLS[id] },
  hold: { style: 'gun', model: HeldModels.gltf(GUN_URLS[id]), gun: hold },
  ...look,
});

export const LOOKS: Record<string, ItemLook> = {
  pistol: gun('pistol', { sounds: { use: 'shot_pistol', reload: 'reload_pistol' } }, COMPACT),
  smg: gun('smg', { tracer: '#ffb36b', sounds: { use: 'shot_smg', reload: 'reload_mag' } }, COMPACT),
  rifle: gun('rifle', { sounds: { use: 'shot_rifle', reload: 'reload_mag' } }),
  shotgun: gun('shotgun', { tracer: '#ffb36b', sounds: { use: 'shot_shotgun', reload: 'reload_shell', cycle: 'pump' } }),
  sniper: gun('sniper', { tracer: '#fff1a8', sounds: { use: 'shot_sniper', reload: 'reload_mag', cycle: 'bolt' } }),
  lmg: gun('lmg', { tracer: '#ffb347', sounds: { use: 'shot_lmg', reload: 'reload_belt' } }),
};

export function defineLooks(client: Client) {
  for (const [id, look] of Object.entries(LOOKS)) client.items.look(id, look);
  // Dropped in the night: an ammo can.
  client.items.look('ammo_crate', { icon: { gltf: GUN_URLS.ammo } });
}
