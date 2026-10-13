import { HeldModels } from '@platform';
import type { Client } from '@platform/client';
import { FX_BEAMS, fxItem, type FxBeam } from '../fxitems';
import blue from '../models/fx_blue.glb?url';
import crimson from '../models/fx_crimson.glb?url';
import dark from '../models/fx_dark.glb?url';
import green from '../models/fx_green.glb?url';
import lightning from '../models/fx_lightning.glb?url';
import red from '../models/fx_red.glb?url';
import white from '../models/fx_white.glb?url';

const BEAM_MODELS: Record<FxBeam, string> = { lightning, green, blue, red, crimson, white, dark };

/** The effect items' looks: each a glowing beam model (`fxitems.ts`), for `client.scene.item`. */
export function defineHeroLooks(client: Client) {
  for (const b of FX_BEAMS) client.items.look(fxItem(b), { icon: { gltf: BEAM_MODELS[b] }, hold: { model: HeldModels.gltf(BEAM_MODELS[b]) } });
}
