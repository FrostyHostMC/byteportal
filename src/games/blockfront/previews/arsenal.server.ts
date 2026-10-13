import { defineServer, math } from '@platform';
import { WEAPON_MODELS } from '../models';
import { COLUMN, FLOOR, ROWS, shared } from './arsenal.shared';

/**
 * Dev preview: the weapon models at twice their size, in rows, side on: from +z each shows its
 * right side with its muzzle to the right (as the kill feed draws it), from -z its left side.
 */
export default defineServer(shared, {
  start(game) {
    const up = new math.Vector3(0, 1, 0);
    ROWS.forEach((row, r) =>
      row.ids.forEach((id, c) => {
        const model = game.props.gltf(WEAPON_MODELS[id], { scale: 2 });
        const at = { x: c * COLUMN + 1.8, y: FLOOR + row.y, z: 0 };
        const prop = game.props.spawn(model, { position: at });
        prop.quaternion.setFromAxisAngle(up, Math.PI / 2);
        game.hud.marker(`w${r}${c}`, { x: at.x + 1.2, y: at.y + 1.6, z: 0 }, { label: id, shape: 'dot', size: 2 });
      }),
    );
  },
});
