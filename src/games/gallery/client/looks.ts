import { HeldModels, type ItemLook } from '@platform';
import type { Client } from '@platform/client';
import blockySword from '../models/blocky_sword.gltf?url';
import cards from '../models/card_and_token.gltf?url';

/**
 * How the gallery's glTF items look on each screen (`client.items.look`): held as their models,
 * their icons pictures of them. The server's definitions have only what they do (the cards are
 * also on show as a prop, which the server places).
 */
export const LOOKS: Record<string, ItemLook> = {
  blocky_sword: { icon: { gltf: blockySword }, hold: { model: HeldModels.gltf(blockySword, { grip: [0, 0, 2] }) } },
  cards: { icon: { gltf: cards }, hold: { model: HeldModels.gltf(cards, { scale: 0.3, grip: [0, -1, 0] }) } },
};

/** Each item's look on this screen (in `setup`, before anything's shown). */
export function defineLooks(client: Client) {
  for (const [id, look] of Object.entries(LOOKS)) client.items.look(id, look);
}
