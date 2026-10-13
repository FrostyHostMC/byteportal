import type { IconRef, ItemDefinition, ItemIcon, ItemLook, SpriteRef } from './api/types';

/**
 * Items' looks on a screen (`client.items.look`): the server defines what an item does, the game's
 * client code how it looks and sounds, and the screen reads the two as one definition.
 */

/** The atlas of the placeholder icon (the entity graphics paint it): for an item given an icon by neither side. */
export const PLACEHOLDER_ATLAS = '$placeholder';
/** What an item given an icon by neither its server nor its look shows: a grey tag with a question mark. */
export const PLACEHOLDER_ICON: SpriteRef = { atlas: PLACEHOLDER_ATLAS, x: 0, y: 0 };

/**
 * An item as a screen has it: the server's definition with the look's fields over it (`sounds`
 * sound by sound), and an icon always (the placeholder, when neither gives one).
 */
export function lookOver(def: ItemDefinition, look: ItemLook | undefined): ItemDefinition {
  const out = { ...def } as ItemDefinition & Record<string, unknown>;
  if (look) {
    for (const [k, v] of Object.entries(look)) {
      if (v === undefined) continue;
      out[k] = k === 'sounds' ? { ...def.sounds, ...(v as object) } : v;
    }
  }
  out.icon ??= PLACEHOLDER_ICON;
  return out;
}

/**
 * An icon as an item's kind of icon: `{ item }` becomes that item's icon as this screen has it
 * (its `view` over a model's picture); null while the item isn't here (yet).
 */
export function resolveIcon(ref: IconRef, item: (id: string) => ItemDefinition | undefined): ItemIcon | null {
  if (typeof ref !== 'object' || !('item' in ref)) return ref;
  const def = item(ref.item);
  if (!def) return null;
  const icon = def.icon ?? PLACEHOLDER_ICON;
  return ref.view && typeof icon === 'object' && 'gltf' in icon ? { gltf: icon.gltf, view: ref.view } : icon;
}
