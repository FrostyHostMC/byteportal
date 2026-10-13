import { HeldModels, type GunHold, type ItemLook, type ItemPoses } from '@platform';
import type { Client } from '@platform/client';
import { HEROES, SABER_HEROES, saberOf } from '../heroes/defs';
import { WEAPON_MODELS } from '../models';
import { TEAMS } from '../teams';

/**
 * How Blockfront's weapons look and sound on each screen (`client.items.look`): their models and
 * icons, how each sits in first person, their bolts' colours (their side's) and their voices
 * (`./sounds`). The server's `weapons.ts` has only what they do.
 */

const url = (id: string) => WEAPON_MODELS[id] ?? '';

const FP: GunHold = {
  fist: [0.22, -0.31, -0.44],
  barrel: [-0.3, 0.04, -1],
  roll: -0.12,
  forearm: { hip: [0.35, -0.8, 0.45] },
  forearm2: { hip: [-0.35, -0.85, 0.35] },
  ads: 0.4,
};
const FP_COMPACT: GunHold = { ...FP, fist: [0.12, -0.27, -0.4] };

/** A blaster; a pistol (`compact`) held as one by the figures too, whatever its length. */
const blaster = (id: string, team: 0 | 1, sound: string, compact = false): ItemLook => ({
  icon: { gltf: url(id) },
  hold: { style: 'gun', model: HeldModels.gltf(url(id)), gun: compact ? FP_COMPACT : FP, ...(compact ? { stance: 'pistol' as const } : {}) },
  tracer: TEAMS[team].bolt,
  sounds: { use: `${sound}_${TEAMS[team].id}`, reload: `vent_${sound.slice(sound.lastIndexOf('_') + 1)}`, empty: 'overheat' },
});

/**
 * How a hero holds a saber, over the figures' sword (the katana's, across the chest, hidden from the
 * camera over the shoulder): both hands low at the right hip, the blade raised almost upright and
 * out to the right, over the shoulder the camera looks past; the swing lifts and chops from there.
 */
const SABER: ItemPoses = { sword: { offset: [-0.3, -0.3, 0.22], turn: [-1.35, -0.8, 0] } };

export const LOOKS: Record<string, ItemLook> = {
  rebel_rifle: blaster('rebel_rifle', 0, 'blaster_rifle'),
  rebel_heavy: blaster('rebel_heavy', 0, 'blaster_heavy'),
  rebel_sniper: blaster('rebel_sniper', 0, 'blaster_sniper'),
  rebel_pistol: blaster('rebel_pistol', 0, 'blaster_pistol', true),
  imp_rifle: blaster('imp_rifle', 1, 'blaster_rifle'),
  imp_heavy: blaster('imp_heavy', 1, 'blaster_heavy'),
  imp_sniper: blaster('imp_sniper', 1, 'blaster_sniper'),
  imp_pistol: blaster('imp_pistol', 1, 'blaster_pistol', true),
  detonator: {
    icon: { gltf: url('detonator') },
    hold: { style: 'throw', model: HeldModels.gltf(url('detonator'), { rotation: [90, 180, 0], grip: [0, 0, -2] }) },
    trail: '#ff3b30',
    sounds: { draw: 'detonator_arm', use: 'toss', hit: 'clink' },
  },
  // The heroes' guns (their gameplay is the heroes' server code): the Wookiee's bowcaster, the bounty hunter's carbine.
  hero_bowcaster: {
    icon: { gltf: url('hero_bowcaster') },
    hold: { style: 'gun', model: HeldModels.gltf(url('hero_bowcaster')), gun: FP },
    tracer: '#5dff6a',
    // (Its twang-boom: heroes/client/sounds.ts.)
    sounds: { use: 'bfh_bowcaster', reload: 'bowcaster_recock', empty: 'overheat' },
  },
  hero_ee3: {
    icon: { gltf: url('hero_ee3') },
    hold: { style: 'gun', model: HeldModels.gltf(url('hero_ee3')), gun: FP },
    tracer: TEAMS[1].bolt,
    sounds: { use: 'blaster_ee3', reload: 'vent_ee3', empty: 'overheat' },
  },
  ...Object.fromEntries(
    SABER_HEROES.map((id) => [
      saberOf(id),
      {
        icon: { gltf: url(saberOf(id)) },
        // Rolled a quarter turn, as Call of Blocky's katana: the hilt's switches face the holder in first person.
        // The blade's light over the model's own: a white-hot core in a halo of the hero's colour.
        hold: { style: 'sword', model: HeldModels.gltf(url(saberOf(id)), { rotation: [0, 0, 90] }), poses: SABER, blade: { color: HEROES[id].blade } },
        sounds: { use: 'saber_swing', hit: 'saber_hit' },
        name: `${HEROES[id].name}'s saber`,
      } satisfies ItemLook,
    ]),
  ),
};

export function defineLooks(client: Client) {
  for (const [id, look] of Object.entries(LOOKS)) client.items.look(id, look);
}
