#!/usr/bin/env node
/**
 * The bosses' models, built as micro-voxel figures (`kit.mjs` on the Arena's `../voxel.mjs`) and
 * written as GLB to `src/games/arena/bosses/models/<id>.glb`, with `index.ts` listing them (`MODEL`).
 * Dependency-free (Node 22+): `node src/games/arena/tools/bosses/build.mjs [ids...]` (with ids, only
 * those are rebuilt). Every file is read back and checked: one mesh on its bones, every vertex on
 * one, the triangle budget (a boss under 30,000, a minion or prop far under), the clips.
 *
 * - The bosses: the Bone Colossus, the Broodmother, the Lich King (the Warden is a character).
 * - Their minions: a spiderling, an egg sac, a phylactery.
 * - Props they throw about: a bone out of the sky, a soul orb (the soul storm's), an ice spike
 *   (rising out of the floor, `rise`), the Warden's soul cage.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { colossus } from './colossus.mjs';
import { broodmother } from './broodmother.mjs';
import { lich } from './lich.mjs';
import { spiderling, eggSac, phylactery, bone, soulOrb, iceSpike, soulCage } from './small.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, '../../bosses/models');

/** Each model: how to make it, and its triangle budget. */
const MODELS = [
  ['colossus', colossus, 30000],
  ['broodmother', broodmother, 30000],
  ['lich', lich, 30000],
  ['spiderling', spiderling, 4000],
  ['egg_sac', eggSac, 4000],
  ['phylactery', phylactery, 6000],
  ['bone', bone, 3000],
  ['soul_orb', soulOrb, 3000],
  ['ice_spike', iceSpike, 3000],
  ['soul_cage', soulCage, 5000],
];

const only = process.argv.slice(2).filter((a) => !a.startsWith('--'));
mkdirSync(OUT, { recursive: true });
for (const [id, make, maxTris] of MODELS) {
  if (only.length && !only.includes(id)) continue;
  console.log(make().write(join(OUT, `${id}.glb`), { maxTris }));
}
const lines = [
  ...MODELS.map(([id]) => `import ${id} from './${id}.glb?url';`),
  '',
  '/** The bosses\' models (GLB), written by `src/games/arena/tools/bosses/build.mjs` (see its header). */',
  `export const MODEL = { ${MODELS.map(([id]) => id).join(', ')} };`,
  '',
];
writeFileSync(join(OUT, 'index.ts'), lines.join('\n'));
