import pistol from './pistol.glb?url';
import smg from './smg.glb?url';
import rifle from './rifle.glb?url';
import famas from './famas.glb?url';
import shotgun from './shotgun.glb?url';
import sniper from './sniper.glb?url';
import tommy from './tommy.glb?url';
import lmg from './lmg.glb?url';
import marksman from './marksman.glb?url';
import sawnoff from './sawnoff.glb?url';
import revolver from './revolver.glb?url';
import katana from './katana.glb?url';
import briefcase from './briefcase.glb?url';
import ammo from './ammo.glb?url';
import frag from './frag.glb?url';
import molotov from './molotov.glb?url';

/**
 * The weapon models (GLB, written by `src/games/callofblocky/tools/guns/build.mjs`; see its header for the conventions:
 * blocks as units, the barrel along +z, marker nodes `grip`, `grip2`, `muzzle`, `sight`, `mag`), the briefcase, and
 * the ammo can the fallen drop (standing up along +z), and the lethals (the frag and the molotov: +y up, the origin
 * the middle of the body, a `grip` marker only).
 */
export interface GunModel {
  id: string;
  name: string;
  url: string;
}

export const GUNS: GunModel[] = [
  { id: 'pistol', name: 'Lucky 45', url: pistol },
  { id: 'smg', name: 'Mac-10', url: smg },
  { id: 'rifle', name: 'Big Kahuna', url: rifle },
  { id: 'famas', name: 'FAMAS', url: famas },
  { id: 'shotgun', name: 'Pump Shotgun', url: shotgun },
  { id: 'sniper', name: 'Sniper', url: sniper },
  { id: 'tommy', name: 'The Wolf', url: tommy },
  { id: 'lmg', name: 'Marsellus', url: lmg },
  { id: 'marksman', name: 'Ezekiel', url: marksman },
  { id: 'sawnoff', name: 'Rock Salt', url: sawnoff },
  { id: 'revolver', name: 'Bad Mother', url: revolver },
  { id: 'katana', name: 'Katana', url: katana },
  { id: 'briefcase', name: 'The Briefcase', url: briefcase },
  { id: 'ammo', name: 'Ammo', url: ammo },
  { id: 'frag', name: 'The Pineapple', url: frag },
  { id: 'molotov', name: 'The Mia', url: molotov },
];
