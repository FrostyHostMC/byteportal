import { HeldModels } from '@platform';
import type { Client } from '@platform/client';
import ballUrl from '../models/ball.glb?url';
import courtUrl from '../models/court.glb?url';
import hoopUrl from '../models/hoop.glb?url';
import netUrl from '../models/net.glb?url';
import shadowUrl from '../models/shadow.glb?url';

/** How the arena's pieces look on this screen (`tools/models.mjs` builds them), for `client.scene.item`. */
export function defineLooks(client: Client) {
  for (const [id, url] of [
    ['jam_ball', ballUrl],
    ['jam_hoop', hoopUrl],
    ['jam_net', netUrl],
    ['jam_court', courtUrl],
    ['jam_shadow', shadowUrl],
  ] as const) {
    client.items.look(id, { icon: { gltf: url }, hold: { model: HeldModels.gltf(url) } });
  }
}
