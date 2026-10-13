import type { Client } from '@platform/client';
import { defineArmorySounds } from './armory';
import { defineCreatureSounds } from './creatures';
import { defineBestiarySounds } from './bestiary';
import { defineHudSounds } from './hud';
import { defineMapSounds } from './maps';
import { defineBossSounds } from './bosses';

/**
 * The Arena's voices, synthesised on each screen (`client.audio.define`: nothing is recorded or
 * sent); the server plays them by name. Each part keeps its own in its own file here.
 */
export function defineSounds(client: Client) {
  defineCreatureSounds(client);
  defineArmorySounds(client);
  defineBestiarySounds(client);
  defineHudSounds(client);
  defineMapSounds(client);
  defineBossSounds(client);
}
