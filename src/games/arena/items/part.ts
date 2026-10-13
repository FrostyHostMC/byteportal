import type { GameContext } from '@platform';
import { WEAPON_MODELS } from '../models/weapons';
import type { ArenaPart } from '../part';
import { setBoltModel } from './crossbow';
import { noteRoll, tickCombat } from './combat';
import { shedArmor } from './armor';
import { forge, forgePrice } from './forge';
import { clearMissiles, updateMissiles } from './missiles';
import { resetPotions, updatePotions } from './potions';
import { RARE_BASES, RARITIES, variant, type Rarity } from './rarity';
import { clearSpears, spearModels, updateSpears } from './spear';
import { clearStatuses, freeze, frozen, updateStatuses } from './status';

/**
 * The armory's own business each fight: what weapons leave in the world and on monsters (statuses,
 * missiles, spears in the air), the dodge roll noted (the daggers' ambush), potions drunk with R,
 * Winter's Heart's shattering, and the commands to arm and forge (cheats, for trying things out).
 */
export const armoryPart: ArenaPart = {
  name: 'armory',
  setup(game) {
    clear();
    // What flies and sticks in the sand: the spears (each rarity's) and the crossbow's bolts.
    spearModels(game, Object.fromEntries(RARITIES.map((r) => [variant('spear', r), WEAPON_MODELS[variant('spear', r)]])));
    setBoltModel(game.props.gltf(WEAPON_MODELS.bolt, { radius: 1 }));
    game.events.on('ability', ({ player, name }) => {
      if (name === 'roll') noteRoll(game, player);
    });
    // Winter's Heart: a frozen monster slain by its bearer shatters, freezing those about it.
    game.events.on('entityDeath', ({ entity, killer }) => {
      if (!killer || killer === 'world' || killer.kind !== 'player' || !frozen(entity) || !killer.inventory.count('frost_staff_legendary')) return;
      const q = { ...entity.position };
      game.fx.burst({ x: q.x, y: q.y + 1, z: q.z }, { color: '#cfefff', count: 40, speed: 6, size: 0.16, gravity: 8, glow: 0.6, life: 0.7 });
      game.fx.shockwave({ x: q.x, y: q.y + 0.2, z: q.z }, 3.5, '#9fe6ff');
      game.audio.play('arena_shatter', { at: q, pitch: 0.8 });
      for (const e of game.entities.near(q, 3.5)) if (e.alive && e !== entity) freeze(game, e, 1.6);
    });
    game.commands.register('arm', {
      usage: '<weapon> [rarity]',
      help: 'Give yourself a weapon of the arsenal',
      cheat: true,
      complete: () => [...RARE_BASES],
      run: ([base, rarity], _g, p) => {
        const r = (rarity ?? 'common') as Rarity;
        if (!RARE_BASES.includes(base as never) || !RARITIES.includes(r)) return `Weapons: ${RARE_BASES.join(', ')}; rarities: ${RARITIES.join(', ')}`;
        const id = variant(base, r);
        p.inventory.give(id);
        const at = p.inventory.slots.findIndex((s) => s?.item === id);
        if (at >= 0) p.inventory.select(at);
        if (base === 'crossbow' || base === 'bow') p.inventory.give('arrow', 32);
      },
    });
    game.commands.register('forge', {
      help: 'Forge the weapon in hand up a rarity (free)',
      cheat: true,
      run: (_args, g, p) => {
        const id = p.inventory.held?.item;
        if (!id || forgePrice(id) === null) return 'Nothing to forge in hand';
        forge(g, p, id);
      },
    });
  },
  start() {
    clear();
  },
  update(game: GameContext, dt: number) {
    tickCombat(game);
    updateStatuses(game, dt);
    updateMissiles(game, dt);
    updateSpears(game, dt);
    updatePotions(game, dt);
  },
  arm(_game, p) {
    shedArmor(p);
  },
};

function clear() {
  clearStatuses();
  clearMissiles();
  clearSpears();
  resetPotions();
}
