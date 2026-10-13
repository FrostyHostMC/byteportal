import { defineClient, type ClientKit } from '@platform/client';
import { figures, sounds } from '@platform/client/kits';
import { cameraKit } from './client/camera';
import { hudKit } from './client/hud';
import { defineLooks } from './client/looks';
import { posesKit } from './client/poses';
import { sceneKit } from './client/scene';
import { defineSounds } from './client/sounds';
import { IceView } from './client/state';
import { shared } from './shared';

/**
 * Block Ice on each player's screen: the standard voices, the figures kit (on the rig) and over it
 * the game's poses (`client/poses.ts`: skating, the stick, shots, checks, the goalies, big heads);
 * the rink, the goals, the puck and everyone's gear (`client/scene.ts`), the broadcast camera
 * (`client/camera.ts`), the announcer and the arena's noise (`client/hud.ts`). No first-person
 * view: the camera's in the stands.
 */
let view: IceView | null = null;
/** Each kit made afresh with each screen's start (a game switched to again starts clean). */
const resets: (() => void)[] = [];
const lazy = (make: (v: IceView) => ClientKit, name: string): ClientKit => {
  let kit: ClientKit | null = null;
  const get = () => kit ?? (view ? (kit = make(view)) : null);
  resets.push(() => {
    kit?.dispose?.();
    kit = null;
  });
  return {
    name,
    setup: (c) => get()?.setup?.(c),
    frame: (c, dt) => get()?.frame?.(c, dt),
    late: (c, dt) => get()?.late?.(c, dt),
    controls: (c, k, dt) => get()?.controls?.(c, k, dt),
    dispose: () => {
      kit?.dispose?.();
      kit = null;
    },
  };
};

const viewKit: ClientKit = {
  name: 'ice.view',
  setup(client) {
    for (const r of resets) r();
    view = new IceView(client);
  },
  frame(client, dt) {
    view?.frame(client, dt);
  },
  late() {
    view?.late();
  },
};

export default defineClient(shared, {
  kits: [
    viewKit,
    ...sounds.standard(),
    figures.humanoid(),
    lazy(posesKit, 'ice.poses'),
    lazy((v) => sceneKit(v, () => v.teams), 'ice.scene'),
    lazy(cameraKit, 'ice.camera'),
    lazy(hudKit, 'ice.hud'),
  ],
  setup(client) {
    defineLooks(client);
    defineSounds(client);
  },
});
