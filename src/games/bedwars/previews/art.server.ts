import { defineServer, Models } from '@platform';
import { BEDWARS_ATLAS, Skin, Sprite, botSword, paintBedwarsAtlas } from '../art';
import { shared } from './art.shared';

/** Dev preview: the Bed Wars skins (standing in a row) and item sprites (in the hotbar). */
export default defineServer(shared, {
  setup(game) {
    const a = paintBedwarsAtlas();
    game.items.atlas(BEDWARS_ATLAS, { width: a.width, height: a.height, pixels: a.albedo, emissive: a.emissive });
    for (const [name, skin] of Object.entries(Skin)) {
      game.entities.define(name, {
        name,
        model: Models.humanoid({ skin: [skin[0], skin[1]], atlas: BEDWARS_ATLAS, extras: name === 'shopkeeper' ? [] : [botSword(skin)] }),
        hitbox: { width: 0.6, height: 1.9 },
        health: 20,
        speed: 0,
      });
    }
    // Each sprite as an item of its name (its icon is each screen's: `SPRITE_LOOKS`).
    for (const id of Object.keys(Sprite)) game.items.define(id, { kind: 'misc', name: id });
  },
  start(game) {
    game.player.freeze(true);
    Object.keys(Skin).forEach((name, i) => game.entities.spawn(name, { x: -5 + i * 2.5, y: 65, z: 2.5 }, { yaw: 0 }));
    for (const id of Object.keys(Sprite).slice(0, 9)) game.player.inventory.give(id);
  },
});
