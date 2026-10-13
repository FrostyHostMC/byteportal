import type { ArenaPart } from '../part';
import { bus } from '../run/bus';
import { spawnMonster } from '../run/spawn';
import { knightGuard } from './knight';
import { golemCracks } from './golem';
import { empoweredHits } from './cultist';
import { impFire } from './imp';
import { minotaurDazed } from './minotaur';
import { AFFIXES, eliteHits, eliteLanded, eliteList, eliteNight, elitesTick, eliteSlain, makeElite, resetElites, rollElite, type Affix } from './elites';
import { MONSTERS } from './index';

/**
 * The bestiary's own business on the server: the hits its monsters change (a knight's shield, a
 * golem's armour, a dazed minotaur, a cultist's blessing, an imp's fire), and elites: rolled as
 * monsters come in (the bus's `spawned`), their affixes at work every tick, their last words when
 * they die. `/summon` brings any in (a cheat). (Each kind's `tip`, the first time it comes in a
 * run, is the HUD's to show.)
 */
export const bestiaryPart: ArenaPart = {
  name: 'bestiaryPart',
  setup(game) {
    resetElites();
    game.events.on('damage', (hit) => {
      knightGuard(game, hit);
      if (hit.cancelled) return;
      golemCracks(hit);
      minotaurDazed(hit);
      empoweredHits(game, hit);
      eliteHits(game, hit);
    });
    game.events.on('playerDamage', ({ player, amount, source, weapon }) => {
      if (weapon === 'imp_fire') impFire(game, player);
      eliteLanded(game, player, amount, source);
    });
    bus.on('spawned', ({ entity, type }) => rollElite(game, entity, type));
    bus.on('slain', ({ entity, by }) => eliteSlain(game, entity, by));
    bus.on('waveStart', ({ twist }) => eliteNight(twist === 'elite_night'));
    // A screen that's just arrived sees the elites already in.
    game.events.on('playerReady', ({ player }) => {
      for (const x of eliteList()) game.clients.send(player, 'bestiary.elite', x);
    });
    game.commands.register('summon', {
      usage: '<monster> [count] [affix]',
      help: 'Bring monsters in a few blocks ahead of you (an affix makes them elites)',
      cheat: true,
      complete: () => [...MONSTERS.map((m) => m.id), ...Object.keys(AFFIXES)],
      run: ([type, count, affix], g, p) => {
        if (!MONSTERS.some((m) => m.id === type)) return `Monsters: ${MONSTERS.map((m) => m.id).join(', ')}`;
        if (affix && !(affix in AFFIXES)) return `Affixes: ${Object.keys(AFFIXES).join(', ')}`;
        const n = Math.max(1, Math.min(12, Number(count) || 1));
        const q = p.position;
        const l = Math.hypot(p.look.x, p.look.z) || 1;
        for (let i = 0; i < n; i++) {
          const at = { x: q.x + (p.look.x / l) * 5 + (i - (n - 1) / 2) * 1.2, y: q.y + 0.1, z: q.z + (p.look.z / l) * 5 };
          const e = spawnMonster(g, type, g.world.fits(at) ? at : q, { data: { summoned: true } });
          if (affix) makeElite(g, e, affix as Affix);
        }
        return `${n} ${type}`;
      },
    });
  },
  start() {
    resetElites();
  },
  update(game) {
    elitesTick(game);
  },
};
