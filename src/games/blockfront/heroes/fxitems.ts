import type { ItemDefinition } from '@platform';

/**
 * Items no one carries: the heroes' effect models (glowing beams, `tools/fx.mjs`), defined so each
 * screen can make meshes of them (`client.scene.item`) for lightning, blade trails and the like.
 * Their looks (the models) are the screens' (`client/looks.ts`).
 */
export const FX_BEAMS = ['lightning', 'green', 'blue', 'red', 'crimson', 'white', 'dark'] as const;
export type FxBeam = (typeof FX_BEAMS)[number];

/** The item a beam is. */
export const fxItem = (beam: FxBeam) => `bfh_fx_${beam}`;

export const FX_ITEMS: Record<string, ItemDefinition> = Object.fromEntries(FX_BEAMS.map((b) => [fxItem(b), { kind: 'misc', name: `(effect: ${b})` }]));
