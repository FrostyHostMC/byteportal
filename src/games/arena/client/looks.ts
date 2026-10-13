import { HeldModels, type BladeSpec, type HoldSpec, type ItemLook, type ItemSounds } from '@platform';
import type { Client } from '@platform/client';
import { BOMB_MODEL, Sprite } from '../art';
import { RARITIES, RARITY, shieldOf, variant, type Rarity } from '../items/rarity';
import { WEAPON_MODELS } from '../models/weapons';

/**
 * How the Arena's weapons and pickups look on each screen (`client.items.look`): their icons, the
 * arsenal's voxel models in each rarity, the starter swords and the potion too (`models/weapons`,
 * built by `tools/weapons/build.mjs`),
 * how each is held in first person (the pose, its own swing: `client/armory.ts` defines the
 * Arena's), the voices each plays (`client/sounds/armory.ts`), and a rarer blade's glow: a thin
 * edge of light in its rarity's colour that leaves a fading arc as it's swung. The server's
 * `items/` has only what they do.
 */

/** A rarer blade's edge of light (none for a common one). */
function edge(rarity: Rarity, start = 0.2): BladeSpec | undefined {
  if (rarity === 'common') return undefined;
  return { color: RARITY[rarity].color, start, width: rarity === 'legendary' ? 0.07 : 0.05, glow: rarity === 'legendary' ? 3 : 2.2 };
}

/** One of the arsenal's voxel weapons: its model as its icon and in the hand. */
function voxel(id: string, hold: Partial<HoldSpec>, sounds: ItemSounds, more: Partial<ItemLook> = {}): ItemLook {
  const url = WEAPON_MODELS[id];
  return { icon: { gltf: url }, hold: { model: HeldModels.gltf(url), ...hold }, sounds, ...more };
}

const BLADE: ItemSounds = { use: 'arena_swing', hit: 'arena_hit_blade' };
const LIGHT: ItemSounds = { use: 'arena_swing_light', hit: 'arena_hit_light' };
const HEAVY: ItemSounds = { use: 'arena_swing_heavy', hit: 'arena_hit_heavy' };
const THRUST: ItemSounds = { use: 'arena_thrust', hit: 'arena_hit_pierce' };

/** Each of the arsenal's weapons in a rarity. */
const ARSENAL: Record<string, (r: Rarity, id: string) => ItemLook> = {
  gladius: (r, id) => voxel(id, { style: 'sword', use: 'arena_slash', blade: edge(r, 0.22) }, BLADE),
  daggers: (r, id) => voxel(id, { style: 'sword', use: 'arena_stab', scale: 1.15, blade: edge(r, 0.3) }, LIGHT),
  greatsword: (r, id) => voxel(id, { style: 'sword', use: 'arena_sweep', scale: 0.8, blade: edge(r, 0.28) }, HEAVY),
  warhammer: (_r, id) => voxel(id, { style: 'axe', use: 'arena_hammer', scale: 0.95 }, { ...HEAVY, hit: 'arena_hit_blunt', draw: 'arena_charge' }),
  spear: (r, id) => voxel(id, { style: 'polearm', scale: 0.9, blade: edge(r, 0.8) }, THRUST),
  crossbow: (_r, id) =>
    voxel(id, { style: 'gun', gun: { fist: [0.2, -0.27, -0.5], barrel: [-0.18, 0.04, -1], roll: -0.08, ads: 0.36, kick: 0.12, rise: 9 } }, { use: 'arena_xbow_shot', reload: 'arena_xbow_crank', cycle: 'arena_xbow_ready' }),
  fire_staff: (_r, id) => voxel(id, { style: 'sword', use: 'arena_cast', scale: 0.62 }, { use: 'arena_cast_fire' }),
  frost_staff: (_r, id) => voxel(id, { style: 'sword', use: 'arena_cast_quick', scale: 0.62 }, { use: 'arena_cast_frost' }),
  storm_wand: (_r, id) => voxel(id, { style: 'sword', use: 'arena_flick', scale: 1.1 }, { use: 'arena_cast_storm' }),
  battle_axe: (_r, id) => voxel(id, { style: 'axe', use: 'hew', scale: 0.95 }, HEAVY),
  pike: (r, id) => voxel(id, { style: 'polearm', scale: 0.85, blade: edge(r, 0.8) }, THRUST),
  diamond_sword: (r, id) => voxel(id, { style: 'sword', use: 'arena_slash', blade: edge(r, 0.22) }, BLADE),
  // The bow, drawn, shows its other model (its string back, an arrow on it); both share one atlas.
  bow: (r, id) => voxel(id, { style: 'bow' }, {}, { drawIcon: { gltf: WEAPON_MODELS[variant('bow_drawn', r)] } }),
};

export const LOOKS: Record<string, ItemLook> = {
  wooden_sword: voxel('wooden_sword', { style: 'sword', use: 'arena_slash' }, BLADE),
  stone_sword: voxel('stone_sword', { style: 'sword', use: 'arena_slash' }, BLADE),
  iron_sword: voxel('iron_sword', { style: 'sword', use: 'arena_slash' }, BLADE),
  ...Object.fromEntries(Object.entries(ARSENAL).flatMap(([base, look]) => RARITIES.map((r) => [variant(base, r), look(r, variant(base, r))]))),
  // The gladius's shield (never carried: the first-person view holds it with the gladius).
  ...Object.fromEntries(RARITIES.map((r) => [shieldOf(r), { icon: { gltf: WEAPON_MODELS[shieldOf(r)] }, hold: { model: HeldModels.gltf(WEAPON_MODELS[shieldOf(r)]) } }])),
  crossbow_bolt: { icon: { gltf: WEAPON_MODELS.bolt }, hold: { model: HeldModels.gltf(WEAPON_MODELS.bolt) } },
  arrow: { icon: 'arrow' },
  health_potion: voxel('health_potion', { style: 'item' }, {}),
  heart: { icon: 'heart' },
  arrow_bundle: { icon: Sprite.arrow_bundle },
  bomb: { icon: Sprite.bomb, hold: { style: 'throw', model: BOMB_MODEL, scale: 0.42 }, trail: '#ffb34a' },
  bomb_bundle: { icon: Sprite.bomb },
  leather_armor: { icon: { gltf: WEAPON_MODELS.leather_armor } },
  mail_armor: { icon: { gltf: WEAPON_MODELS.mail_armor } },
  plate_armor: { icon: { gltf: WEAPON_MODELS.plate_armor } },
};

/** Each item's look on this screen (in `setup`, before anything's shown). */
export function defineLooks(client: Client) {
  for (const [id, look] of Object.entries(LOOKS)) client.items.look(id, look);
}
