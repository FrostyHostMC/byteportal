#!/usr/bin/env node
/**
 * The Arena's monsters as micro-voxel figures, written as binary glTF 2.0 to
 * `src/games/arena/monsters/models/<id>.glb`, with `index.ts` listing their addresses.
 * Dependency-free (Node 22+): `node src/games/arena/tools/monsters/build.mjs [ids...]` (with ids,
 * only those are rebuilt and index.ts is left alone). Every file is read back and checked.
 *
 * - People-shaped monsters (`people.mjs`: the knight, the cultist, the imp, the wraith, the
 *   minotaur, the golem)
 *   are the platform's characters (`src/platform/character/build.ts`, read here as it is) with
 *   their armour, robes, horns and wings painted on, on the humanoid rig (docs/HUMANOID.md): the
 *   platform walks them, swings their arms and raises them, and the Arena's screens pose what's
 *   their own (the knight's shield arm). The golem is drawn whole, on the same rig.
 * - Beasts (`beasts.mjs`: the spider, the slimes, the bat) are on bones of their own, with clips
 *   (`idle`, `walk`, `attack`, and their own, played by name).
 * - Voxels are 26 a metre, as the platform's people. One mesh, one material, one draw call each;
 *   a monster stays about 10,000 triangles (under 11,000) and 200 KB.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readGlb } from '../voxel.mjs';
import { figureGlb } from './glb.mjs';
import { bat, slime, spider } from './beasts.mjs';
import { cultist, golem, imp, knight, minotaur, wraith } from './people.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, '../../monsters/models');
const SCALE = 26;
const MAX_TRIS = 11000;
const MAX_BYTES = 200 * 1024;

/** Every model: its id, its name, and what makes it. */
const MODELS = [
  { id: 'spider', name: 'Spider', make: spider },
  { id: 'slime', name: 'Slime', make: () => slime('big') },
  { id: 'slime_small', name: 'Small Slime', make: () => slime('small') },
  { id: 'slime_tiny', name: 'Tiny Slime', make: () => slime('tiny') },
  { id: 'bat', name: 'Bat', make: bat },
  { id: 'knight', name: 'Knight', make: knight },
  { id: 'cultist', name: 'Cultist', make: cultist },
  { id: 'imp', name: 'Imp', make: imp },
  { id: 'wraith', name: 'Wraith', make: wraith },
  { id: 'golem', name: 'Golem', make: golem },
  { id: 'minotaur', name: 'Minotaur', make: minotaur },
];

function check(buf, m) {
  const fail = (msg) => {
    throw new Error(`${m.id}.glb: ${msg}`);
  };
  const { json, read } = readGlb(buf);
  const prim = json.meshes[0].primitives[0];
  const I = read(json.accessors[prim.indices]);
  const JO = read(json.accessors[prim.attributes.JOINTS_0]);
  for (let t = 0; t < I.length; t += 3) if (JO[I[t] * 4] !== JO[I[t + 1] * 4] || JO[I[t] * 4] !== JO[I[t + 2] * 4]) fail('a triangle across two bones');
  const tris = I.length / 3;
  if (tris > MAX_TRIS) fail(`${tris} triangles (budget ${MAX_TRIS})`);
  if (buf.length > MAX_BYTES) fail(`${buf.length} bytes (budget ${MAX_BYTES})`);
  for (const a of json.animations ?? []) for (const c of a.channels) if (json.nodes[c.target.node] === undefined) fail(`clip ${a.name}: no node`);
  return { tris, clips: (json.animations ?? []).map((a) => a.name) };
}

const only = process.argv.slice(2).filter((a) => !a.startsWith('--'));
mkdirSync(OUT, { recursive: true });
for (const m of MODELS) {
  if (only.length && !only.includes(m.id)) continue;
  const made = m.make();
  const { bytes, stats } = figureGlb({ id: m.id, title: m.name, scale: SCALE, generator: 'Arena src/games/arena/tools/monsters/build.mjs', ...made });
  const file = join(OUT, `${m.id}.glb`);
  writeFileSync(file, bytes);
  const v = check(readFileSync(file), m);
  console.log(`${m.id}.glb  ${m.name}: ${stats.voxels} voxels, ${stats.faces} faces as ${stats.quads} quads, ${v.tris} tris (${stats.hidden} hidden), ${stats.tiles} tiles in ${stats.atlas}, ${(bytes.length / 1024).toFixed(1)} KB${v.clips.length ? `, clips ${v.clips.join(' ')}` : ''}`);
}
if (!only.length) {
  const lines = [
    ...MODELS.map((m) => `import ${m.id} from './${m.id}.glb?url';`),
    '',
    '/** The monsters\' models (GLB), written by `src/games/arena/tools/monsters/build.mjs` (see its header). */',
    `export const MONSTER_MODELS = { ${MODELS.map((m) => m.id).join(', ')} };`,
    '',
  ];
  writeFileSync(join(OUT, 'index.ts'), lines.join('\n'));
}
