import { Blueprint, defineShared } from '@platform';
import meta from './arsenal.meta';

export const FLOOR = 64;
/** The display's rows (each a height over the floor and the models on it) and its columns' width. */
export const ROWS: { y: number; ids: string[] }[] = [
  { y: 7.2, ids: ['imp_rifle', 'imp_heavy', 'imp_sniper', 'imp_pistol', 'hero_ee3'] },
  { y: 4.6, ids: ['rebel_rifle', 'rebel_heavy', 'rebel_sniper', 'rebel_pistol', 'hero_bowcaster'] },
  { y: 2.0, ids: ['saber_luke', 'saber_ben', 'saber_vader', 'saber_emperor', 'detonator'] },
];
export const COLUMN = 6.5;

/** A grey court open to the sun round the display: light walls either side of it, a pillar each side to stand on, level with the middle row. */
function hall(): Blueprint {
  const [x0, x1, z0, z1] = [-6, 34, -16, 16];
  const bp = new Blueprint({ x: x0, y: FLOOR - 1, z: z0 }, { x: x1 - x0 + 1, y: 14, z: z1 - z0 + 1 });
  bp.fill({ x: x0, y: FLOOR - 1, z: z0 }, { x: x1, y: FLOOR - 1, z: z1 }, 'gray_concrete');
  for (const z of [z0, z1]) bp.fill({ x: x0, y: FLOOR, z }, { x: x1, y: FLOOR + 11, z }, 'light_gray_concrete');
  for (const z of [12, -12]) bp.fill({ x: 16, y: FLOOR, z }, { x: 16, y: FLOOR + 3, z }, 'gray_concrete');
  return bp;
}

/** Dev preview: Blockfront's weapon models in rows, side on, in a lit hall in the void (the server hangs them there). */
export const shared = defineShared({
  ...meta,
  world: { terrain: 'void', structures: [hall()], spawn: { x: 16, y: FLOOR + 4, z: 12 }, spawnYaw: 0, time: 0.5, freezeTime: true },
  player: { health: false, fly: true, hotbar: 'items' },
});
