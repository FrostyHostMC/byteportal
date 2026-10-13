import type { ArenaPart } from '../part';
import { bus } from '../run/bus';
import { inFight, map } from '../run/state';
import { chooseMap, runEnded, setupChoice, updateChoice } from './choice';
import { opened, startGates, updateGates } from './gates';
import { startHazards, updateHazards } from './hazards';
import { MAPS } from './index';
import { introduce, setupIntro, startIntro } from './intro';
import { CHEER_MSG, type CheerMessage } from './messages';
import { place, resetModels } from './props';
import { setupTraps, startTraps, updateTraps } from './traps';

/** When the crowd last cheered for a feat (petals, not every moment). */
let cheered = -99;

/**
 * The maps' own business in a fight: which map it's on (`choice.ts`: the rotation, the vote, the
 * pick), its set pieces, portcullises (`gates.ts`), traps (`traps.ts`) and hazards
 * (`hazards.ts`), and the fly-over each screen's shown as a fight begins or as someone joins one
 * (`intro.ts`).
 */
export const mapsPart: ArenaPart = {
  name: 'maps',
  setup(game) {
    resetModels();
    setupIntro();
    setupTraps(game, MAPS);
    setupChoice(game);
    bus.on('spawned', ({ entity }) => opened(game, entity.position));
    bus.on('runStart', () => {
      for (const p of game.players) introduce(game, p, true);
    });
    bus.on('runEnd', () => runEnded(game));
    // The crowd throws petals: a shower for the Crowd's Favour, a handful for a feat.
    cheered = -99;
    bus.on('hype', ({ favour }) => {
      if (favour && map().crowd) game.clients.send('all', CHEER_MSG, { big: true } satisfies CheerMessage);
    });
    bus.on('feat', () => {
      if (!map().crowd || game.clock.total - cheered < 4) return;
      cheered = game.clock.total;
      game.clients.send('all', CHEER_MSG, { big: false } satisfies CheerMessage);
    });
    game.events.on('playerReady', ({ player }) => {
      if (inFight()) introduce(game, player, false);
    });
  },
  start(game) {
    chooseMap(game);
    for (const d of map().decor ?? []) place(game, d.model, d.at, d.face);
    startGates(game);
    startTraps(game);
    startHazards();
    startIntro();
  },
  update(game, dt) {
    updateChoice(game);
    updateGates(game, dt);
    updateTraps(game, dt);
    updateHazards(game, dt);
  },
};
