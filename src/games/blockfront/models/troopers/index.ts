import rebel_trooper from './rebel_trooper.glb?url';
import rebel_trooper_b from './rebel_trooper_b.glb?url';
import rebel_trooper_c from './rebel_trooper_c.glb?url';
import rebel_trooper_d from './rebel_trooper_d.glb?url';
import rebel_heavy from './rebel_heavy.glb?url';
import rebel_heavy_b from './rebel_heavy_b.glb?url';
import rebel_heavy_c from './rebel_heavy_c.glb?url';
import rebel_heavy_d from './rebel_heavy_d.glb?url';
import rebel_specialist from './rebel_specialist.glb?url';
import rebel_specialist_b from './rebel_specialist_b.glb?url';
import rebel_specialist_c from './rebel_specialist_c.glb?url';
import rebel_specialist_d from './rebel_specialist_d.glb?url';
import imp_trooper from './imp_trooper.glb?url';
import imp_heavy from './imp_heavy.glb?url';
import imp_specialist from './imp_specialist.glb?url';
import luke from './luke.glb?url';
import ben from './ben.glb?url';
import chewie from './chewie.glb?url';
import vader from './vader.glb?url';
import emperor from './emperor.glb?url';
import boba from './boba.glb?url';

/**
 * The troopers' and heroes' models (GLB on the platform's humanoid rig, docs/HUMANOID.md), written by
 * `src/games/blockfront/tools/troopers/build.mjs` (see its header).
 */
export interface TrooperModel {
  id: string;
  name: string;
  url: string;
}

/** For each side, one per class (`ClassInfo.model`: trooper, heavy, specialist): its first variant. */
export const TROOPERS: [TrooperModel[], TrooperModel[]] = [
  [
    { id: 'rebel_trooper', name: 'Rebel Trooper', url: rebel_trooper },
    { id: 'rebel_heavy', name: 'Rebel Heavy', url: rebel_heavy },
    { id: 'rebel_specialist', name: 'Rebel Specialist', url: rebel_specialist },
  ],
  [
    { id: 'imp_trooper', name: 'Stormtrooper', url: imp_trooper },
    { id: 'imp_heavy', name: 'Heavy Stormtrooper', url: imp_heavy },
    { id: 'imp_specialist', name: 'Scout Trooper', url: imp_specialist },
  ],
];

/**
 * Every variant of each side's classes (`[team][class]`, the first `TROOPERS`'): the Rebels are
 * several people a class (faces, skins, hair, headgear; one kit and silhouette a class), the
 * Empire's troopers one each.
 */
export const TROOPER_VARIANTS: [TrooperModel[][], TrooperModel[][]] = [
  [
    [
      { id: 'rebel_trooper', name: 'Rebel Trooper', url: rebel_trooper },
      { id: 'rebel_trooper_b', name: 'Rebel Trooper', url: rebel_trooper_b },
      { id: 'rebel_trooper_c', name: 'Rebel Trooper', url: rebel_trooper_c },
      { id: 'rebel_trooper_d', name: 'Rebel Trooper', url: rebel_trooper_d },
    ],
    [
      { id: 'rebel_heavy', name: 'Rebel Heavy', url: rebel_heavy },
      { id: 'rebel_heavy_b', name: 'Rebel Heavy', url: rebel_heavy_b },
      { id: 'rebel_heavy_c', name: 'Rebel Heavy', url: rebel_heavy_c },
      { id: 'rebel_heavy_d', name: 'Rebel Heavy', url: rebel_heavy_d },
    ],
    [
      { id: 'rebel_specialist', name: 'Rebel Specialist', url: rebel_specialist },
      { id: 'rebel_specialist_b', name: 'Rebel Specialist', url: rebel_specialist_b },
      { id: 'rebel_specialist_c', name: 'Rebel Specialist', url: rebel_specialist_c },
      { id: 'rebel_specialist_d', name: 'Rebel Specialist', url: rebel_specialist_d },
    ],
  ],
  [
    [
      { id: 'imp_trooper', name: 'Stormtrooper', url: imp_trooper },
    ],
    [
      { id: 'imp_heavy', name: 'Heavy Stormtrooper', url: imp_heavy },
    ],
    [
      { id: 'imp_specialist', name: 'Scout Trooper', url: imp_specialist },
    ],
  ],
];

/** The heroes' models, by hero id. */
export const HERO_MODELS: Record<'luke' | 'ben' | 'chewie' | 'vader' | 'emperor' | 'boba', string> = {
  luke,
  ben,
  chewie,
  vader,
  emperor,
  boba,
};
