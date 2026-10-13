import { HeldModels } from '@platform';
import type { Client } from '@platform/client';
import ballUrl from '../models/ball.glb?url';

/** How the ball looks on this screen: a smooth white sphere (`tools/ball.mjs`), for `client.scene.item`. */
export function defineLooks(client: Client) {
  client.items.look('golf_ball', { icon: { gltf: ballUrl }, hold: { model: HeldModels.gltf(ballUrl) } });
}
