import type { HumanoidPoses } from '@platform';
import type { ClientKit } from '@platform/client';
import type { firstPerson } from '@platform/client/kits';
import { humanoid } from './figures/humanoid';
import { heroFx } from './fx';
import { heroHud } from './hud';
import { heroJumps } from './jumps';
import { defineHeroLooks } from './looks';
import { defineHeroSounds } from './sounds';
import { OwnSaber } from './predict';
import { HeroScene, heroState } from './state';

/**
 * The heroes on each screen, as client kits for `client.ts` (in place of `figures.humanoid()`):
 * what the server says heroes do, kept (`state.ts`); everyone's figures posed, heroes' sabers and
 * gestures and their victims included (`figures/`, the platform's kit copied and grown); the
 * effects (`fx.ts`; their jumps' dust and voices, `jumps.ts`); the hero HUD (`hud.ts`); and their
 * looks and voices (`looks.ts`, `sounds.ts`).
 * Our own saber runs ahead of the server (`predict.ts`); given the game's first-person kit, our
 * first-person arm swings with it too.
 */
export function heroKits(opts: { poses?: HumanoidPoses; firstPerson?: firstPerson.FirstPersonKit } = {}): ClientKit[] {
  const scene = new HeroScene();
  return [
    {
      name: 'blockfront.heroes.looks',
      setup(client) {
        defineHeroLooks(client);
        defineHeroSounds(client);
      },
    },
    heroState(scene, new OwnSaber(opts.firstPerson ?? null)),
    humanoid({ ...opts, scene }),
    heroFx(scene),
    heroJumps(scene),
    heroHud(scene),
  ];
}
