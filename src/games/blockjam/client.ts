import { defineClient, type ClientKit } from '@platform/client';
import { figures, sounds } from '@platform/client/kits';
import { cameraKit } from './client/camera';
import { hudKit } from './client/hud';
import { defineLooks } from './client/looks';
import { posesKit } from './client/poses';
import { sceneKit } from './client/scene';
import { defineSounds } from './client/sounds';
import { JamView } from './client/state';
import { shared } from './shared';

/**
 * Block Jam on each player's screen: the standard voices, the figures kit (running, jumping) and
 * over it the game's poses (`client/poses.ts`: dribbles, jump shots, dunks, big heads); the arena's
 * pieces and the ball (`client/scene.ts`), the broadcast camera (`client/camera.ts`), the
 * announcer and the crowd (`client/hud.ts`). No first-person view: the camera's in the stands.
 */
let view: JamView | null = null;
/** Each kit made afresh with each screen's start (a game switched to again starts clean). */
const resets: (() => void)[] = [];
const lazy = (make: (v: JamView) => ClientKit, name: string): ClientKit => {
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
  name: 'jam.view',
  setup(client) {
    for (const r of resets) r();
    view = new JamView(client);
  },
  frame(client, dt) {
    view?.frame(client, dt);
  },
  late() {
    view?.late();
  },
};

export default defineClient(shared, {
  kits: [viewKit, ...sounds.standard(), figures.humanoid(), lazy(posesKit, 'jam.poses'), lazy(sceneKit, 'jam.scene'), lazy(cameraKit, 'jam.camera'), lazy(hudKit, 'jam.hud')],
  setup(client) {
    defineLooks(client);
    defineSounds(client);
  },
});
