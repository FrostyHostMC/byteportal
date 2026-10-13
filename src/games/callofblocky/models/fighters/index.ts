import hitman from './hitman.glb?url';
import partner from './partner.glb?url';
import bride from './bride.glb?url';
import wife from './wife.glb?url';
import bowler from './bowler.glb?url';
import crooner from './crooner.glb?url';
import boxer from './boxer.glb?url';
import kahuna from './kahuna.glb?url';
import waitress from './waitress.glb?url';
import boss from './boss.glb?url';

/**
 * The fighters (GLB, written by `src/games/callofblocky/tools/fighters/build.mjs`; see its header and docs/HUMANOID.md
 * for the rig: hips > spine > chest > neck > head, the arms and legs, `gripR` / `gripL`).
 */
export interface FighterModel {
  id: string;
  name: string;
  url: string;
}

export const FIGHTERS: FighterModel[] = [
  { id: 'hitman', name: 'The Hitman', url: hitman },
  { id: 'partner', name: 'The Partner', url: partner },
  { id: 'bride', name: 'The Bride', url: bride },
  { id: 'wife', name: 'The Wife', url: wife },
  { id: 'bowler', name: 'The Bowler', url: bowler },
  { id: 'crooner', name: 'The Crooner', url: crooner },
  { id: 'boxer', name: 'The Boxer', url: boxer },
  { id: 'kahuna', name: 'The Kahuna', url: kahuna },
  { id: 'waitress', name: 'The Waitress', url: waitress },
  { id: 'boss', name: 'The Boss', url: boss },
];
