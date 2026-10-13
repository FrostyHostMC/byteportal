import { HeldModels } from '@platform';
import type { Client } from '@platform/client';
import bladeUrl from '../models/blade.glb?url';
import blockerUrl from '../models/blocker.glb?url';
import boardsUrl from '../models/boards.glb?url';
import gloveUrl from '../models/glove.glb?url';
import goalUrl from '../models/goal.glb?url';
import helmetBladesUrl from '../models/helmet_blades.glb?url';
import helmetJacksUrl from '../models/helmet_jacks.glb?url';
import helmetRhinosUrl from '../models/helmet_rhinos.glb?url';
import helmetYetisUrl from '../models/helmet_yetis.glb?url';
import lightUrl from '../models/light.glb?url';
import maskUrl from '../models/mask.glb?url';
import netUrl from '../models/net.glb?url';
import padUrl from '../models/pad.glb?url';
import puckUrl from '../models/puck.glb?url';
import rinkUrl from '../models/rink.glb?url';
import stickUrl from '../models/stick.glb?url';

/** How the arena's pieces and the gear look on this screen (`tools/models.mjs` builds them), for `client.scene.item`. */
export function defineLooks(client: Client) {
  for (const [id, url] of [
    ['ice_puck', puckUrl],
    ['ice_rink', rinkUrl],
    ['ice_boards', boardsUrl],
    ['ice_goal', goalUrl],
    ['ice_net', netUrl],
    ['ice_stick', stickUrl],
    ['ice_blade', bladeUrl],
    ['ice_mask', maskUrl],
    ['ice_pad', padUrl],
    ['ice_glove', gloveUrl],
    ['ice_blocker', blockerUrl],
    ['ice_light', lightUrl],
    ['ice_helmet_yetis', helmetYetisUrl],
    ['ice_helmet_blades', helmetBladesUrl],
    ['ice_helmet_rhinos', helmetRhinosUrl],
    ['ice_helmet_jacks', helmetJacksUrl],
  ] as const) {
    client.items.look(id, { icon: { gltf: url }, hold: { model: HeldModels.gltf(url) } });
  }
}
