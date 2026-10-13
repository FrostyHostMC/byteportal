import { defineShared, math } from '@platform';
import { buildDestroyer } from './destroyer';
import { voxwingVehicle } from './flight';
import { DESTROYER_CENTER, PLAYER_START, SEED } from './layout';
import meta from './meta';

/** The Star Demolisher: its blocks are the world's (every screen builds them), its weak points the server's. */
export const destroyer = buildDestroyer(DESTROYER_CENTER);
// South of the stern, looking north at its engines (the films' opening shot).
export const START = new math.Vector3(PLAYER_START.x, PLAYER_START.y, PLAYER_START.z);

/** The battle's world, the pilots (no body of their own: they fly), and the Vox-wing each pilot's screen flies too. */
export const shared = defineShared({
  ...meta,
  world: {
    seed: SEED,
    structures: [destroyer.blueprint],
    spawn: { x: START.x, y: START.y, z: START.z },
    spawnYaw: 0,
    time: 0.4,
    freezeTime: true,
    viewDistance: 18,
  },
  player: { controller: 'none', health: false },
  vehicles: { voxwing: voxwingVehicle },
});
