import { defineServer, math } from '@platform';
import { GUNS } from '../models';
import { FLOOR, shared } from './guns.shared';

/** Dev preview: the gun models on pedestals in a lit room, each slowly turning. */
export default defineServer(shared, {
  start(game) {
    GUNS.forEach((g, i) => {
      const model = game.props.gltf(g.url, { scale: 2 });
      const prop = game.props.spawn(model, { position: { x: i * 4 + 1, y: FLOOR + 1.6, z: 0 } });
      let a = 0;
      game.clock.every(1 / 30, () => {
        a += 0.02;
        prop.quaternion.setFromAxisAngle(new math.Vector3(0, 1, 0), a);
      });
      game.hud.marker(`gun${i}`, { x: i * 4 + 1, y: FLOOR + 3.2, z: 0 }, { label: g.name, shape: 'dot', size: 3 });
    });
  },
});
