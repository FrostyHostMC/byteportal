/**
 * The heroes' effect models: glowing beams the screens stretch into lightning arcs, blade trails
 * and the like (`client/fx.ts`, through `client.scene.item`). Each is one glowing unit cube: from
 * -0.5 to 0.5 across (x, y) and 0 to 1 along +z, so a node scaled (w, w, length) and turned to
 * point along a segment draws it. Written to `heroes/models/fx_<name>.glb`.
 *
 *   node src/games/blockfront/tools/heroes/fx.mjs
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Palette, Voxels, faces, atlas, quadCorners, png, writeGlb, DIRS } from '../voxel.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, '../../heroes/models');

/**
 * The beams, by name: their colour (sRGB). They glow fully (the emissive map at its brightest), so
 * a bright colour blooms out pale: the blades' colours are the sabers' own deep glow colours (as
 * `tools/weapons/build.mjs` has them), which come out on screen near each hero's `blade`.
 */
const BEAMS = {
  lightning: 0x8f7cff,
  green: 0x0c8418,
  blue: 0x1664d4,
  red: 0xa00808,
  crimson: 0xa80a24,
  white: 0xffffff,
  dark: 0x7a1cff,
};

function beam(name, rgb) {
  const P = new Palette();
  P.add('core', rgb, { rough: 1, metal: 0, glow: 1, vary: 0 });
  const vox = new Voxels();
  vox.set('body', 0, 0, 0, 'core');
  const { faces: list } = faces(vox, P);
  const A = atlas(list, P, { width: 8 });
  const off = [-0.5, -0.5, 0];
  const pos = [], nor = [], uv = [], idx = [];
  list.forEach((f, fi) => {
    const base = pos.length / 3;
    const n = DIRS[f.dir].n;
    quadCorners(f).forEach((c, ci) => {
      pos.push(...c.map((v, a) => v + off[a]));
      nor.push(...n);
      uv.push(Math.round(A.uvs[fi][ci][0] * 65535), Math.round(A.uvs[fi][ci][1] * 65535));
    });
    idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
  });
  const id = `fx_${name}`;
  return writeGlb({
    generator: 'Blockfront II src/games/blockfront/tools/heroes/fx.mjs',
    nodes: [{ name: id, children: [1] }, { name: `${id}_body` }],
    sceneName: id,
    meshName: `${id}_body`,
    meshNode: 1,
    attributes: {
      POSITION: { values: pos, componentType: 5126, type: 'VEC3', minmax: true },
      NORMAL: { values: nor, componentType: 5126, type: 'VEC3' },
      TEXCOORD_0: { values: uv, componentType: 5123, type: 'VEC2', normalized: true },
    },
    indices: idx,
    material: { name: `${id}_atlas`, albedo: png(A.albedo), mr: png(A.mr), glow: png(A.glow, { grey: true }) },
  });
}

mkdirSync(OUT, { recursive: true });
for (const [name, rgb] of Object.entries(BEAMS)) {
  const bytes = beam(name, rgb);
  writeFileSync(join(OUT, `fx_${name}.glb`), bytes);
  console.log(`fx_${name}.glb  ${bytes.length} bytes`);
}
