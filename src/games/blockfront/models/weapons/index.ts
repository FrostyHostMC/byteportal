import rebelRifle from './rebel_rifle.glb?url';
import rebelHeavy from './rebel_heavy.glb?url';
import rebelSniper from './rebel_sniper.glb?url';
import rebelPistol from './rebel_pistol.glb?url';
import impRifle from './imp_rifle.glb?url';
import impHeavy from './imp_heavy.glb?url';
import impSniper from './imp_sniper.glb?url';
import impPistol from './imp_pistol.glb?url';
import detonator from './detonator.glb?url';
import heroBowcaster from './hero_bowcaster.glb?url';
import heroEe3 from './hero_ee3.glb?url';
import saberLuke from './saber_luke.glb?url';
import saberBen from './saber_ben.glb?url';
import saberVader from './saber_vader.glb?url';
import saberEmperor from './saber_emperor.glb?url';

/**
 * The weapons' models (GLB), by item id, built by `tools/weapons/build.mjs` (its header has the
 * conventions): the blasters (Call of Blocky's gun conventions: `grip`, `grip2`, `muzzle`, `sight`,
 * `mag` marker nodes, the barrel along +z), the thermal detonator, the heroes' guns (the
 * Wookiee's bowcaster, the bounty hunter's carbine) and sabers (the blade along +z, glowing).
 */
export const WEAPON_MODELS: Record<string, string> = {
  rebel_rifle: rebelRifle,
  rebel_heavy: rebelHeavy,
  rebel_sniper: rebelSniper,
  rebel_pistol: rebelPistol,
  imp_rifle: impRifle,
  imp_heavy: impHeavy,
  imp_sniper: impSniper,
  imp_pistol: impPistol,
  detonator,
  hero_bowcaster: heroBowcaster,
  hero_ee3: heroEe3,
  saber_luke: saberLuke,
  saber_ben: saberBen,
  saber_vader: saberVader,
  saber_emperor: saberEmperor,
};
