import pistol from './pistol.glb?url';
import smg from './smg.glb?url';
import rifle from './rifle.glb?url';
import shotgun from './shotgun.glb?url';
import sniper from './sniper.glb?url';
import lmg from './lmg.glb?url';
import ammo from './ammo.glb?url';
import c4 from './c4.glb?url';

/** The weapon models (GLB, the barrel along +z, marker nodes `grip`, `grip2`, `muzzle`, `sight`, `mag`), by gun id. */
export const GUN_URLS: Record<string, string> = { pistol, smg, rifle, shotgun, sniper, lmg, ammo };

/** The C4 charge's model (the hostiles plant it). */
export const C4_URL = c4;
