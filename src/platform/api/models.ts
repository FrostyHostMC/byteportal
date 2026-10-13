import { characterUrl, type CharacterLook } from '../character/look';
import type { GltfSpec, HeldModelSpec, HumanoidJoint, ModelPart, ModelSpec } from './types';

/**
 * How the platform's characters hold things and fit first person (Call of Blocky's and Blockfront's
 * fighters' numbers: things held bigger, to read against the big heads).
 */
export const CHARACTER_STYLE: Pick<GltfSpec, 'firstPerson' | 'poses'> = {
  firstPerson: { scale: 1.0, hands: 0.62 },
  poses: { heldScale: 0.68, pistolUnder: 0.6, gait: { width: 0.15 }, rifle: { hip: [-0.13, -0.22, 0.32], ads: [-0.05, -0.12, 0.36] } },
};

/** Origins of the built-in skins in the `builtin` entity atlas. Games bring their own (`items.atlas`). */
export const Skins = {
  /** The default player: tunic, sash, bracers. Also the first-person arm. */
  player: [0, 0] as [number, number],
};

type Build = 'normal' | 'thin' | 'large';

const add = (a: [number, number], b: [number, number]): [number, number] => [a[0] + b[0], a[1] + b[1]];

/**
 * Box-model builders. Sizes are in texels (16 per block) and follow the Minecraft skin UV
 * layout, so any 64x64 humanoid skin painted in that layout works.
 */
export const Models = {
  /**
   * Two legs, body, two arms and a head. `normal` = the standard 64x64 skin (8x8 head, 4-wide
   * limbs), `thin` = 2-wide limbs, `large` = 10x10 head and 14-wide body (big mobs, bosses).
   * `extras` adds parts of your own (hats, crowns, gear): UVs are relative to the skin origin,
   * and `parent: 'head'` makes a part follow the head. `skeleton` puts it on the humanoid rig
   * (see `ModelSpec.skeleton`), as players' bodies are.
   */
  humanoid(opts: { skin: [number, number]; atlas?: string; scale?: number; build?: Build; extras?: ModelPart[]; skeleton?: boolean }): ModelSpec {
    const o = opts.skin;
    const build = opts.build ?? 'normal';
    let parts: ModelPart[];
    if (build === 'large') {
      parts = [
        { name: 'legR', size: [6, 12, 6], uv: add(o, [0, 42]), pivot: [-3.5, 12, 0], offset: [-3, -12, -3] },
        { name: 'legL', size: [6, 12, 6], uv: add(o, [0, 42]), pivot: [3.5, 12, 0], offset: [-3, -12, -3], mirror: true },
        { name: 'body', size: [14, 14, 8], uv: add(o, [0, 20]), pivot: [0, 12, 0], offset: [-7, 0, -4] },
        { name: 'head', size: [10, 10, 10], uv: add(o, [0, 0]), pivot: [0, 26, 0], offset: [-5, 0, -5] },
        { name: 'armR', size: [5, 15, 5], uv: add(o, [44, 20]), pivot: [-9.5, 24, 0], offset: [-2.5, -13, -2.5] },
        { name: 'armL', size: [5, 15, 5], uv: add(o, [44, 20]), pivot: [9.5, 24, 0], offset: [-2.5, -13, -2.5], mirror: true },
      ];
    } else {
      const limb = build === 'thin' ? 2 : 4;
      const h = limb / 2;
      const armX = build === 'thin' ? 5 : 6;
      parts = [
        { name: 'legR', size: [limb, 12, limb], uv: add(o, [0, 16]), pivot: [-2, 12, 0], offset: [-h, -12, -h] },
        { name: 'legL', size: [limb, 12, limb], uv: add(o, [0, 16]), pivot: [2, 12, 0], offset: [-h, -12, -h], mirror: true },
        { name: 'body', size: [8, 12, 4], uv: add(o, [16, 16]), pivot: [0, 12, 0], offset: [-4, 0, -2] },
        { name: 'head', size: [8, 8, 8], uv: add(o, [0, 0]), pivot: [0, 24, 0], offset: [-4, 0, -4] },
        { name: 'armR', size: [limb, 12, limb], uv: add(o, [40, 16]), pivot: [-armX, 22, 0], offset: [-h, -10, -h] },
        { name: 'armL', size: [limb, 12, limb], uv: add(o, [40, 16]), pivot: [armX, 22, 0], offset: [-h, -10, -h], mirror: true },
      ];
    }
    for (const e of opts.extras ?? []) parts.push({ ...e, uv: add(o, e.uv) });
    return { rig: 'humanoid', parts, atlas: opts.atlas ?? 'builtin', scale: opts.scale ?? 1, ...(opts.skeleton ? { skeleton: true } : {}) };
  },

  /**
   * A glTF or GLB model (a Blockbench or Blender export): `Models.gltf(zombie, { clips: { idle:
   * 'idle', walk: 'walk', attack: 'attack' } })`, where `zombie` is the file's address (import it
   * with `?url`). The figure plays `walk` (or `run` when it hurries) as it moves, `idle` when it
   * doesn't and `attack` when it swings, turns its `head` node to look, and holds items at its
   * `hand` node. It faces +z, as glTF models should (`yaw` turns one that doesn't). A model on
   * the humanoid rig (`rig: 'humanoid'`, docs/HUMANOID.md) is animated in code instead, as its
   * `poses` say, its skeleton named its own way if `joints` says how.
   */
  gltf(url: string, opts: Omit<GltfSpec, 'url'> & { scale?: number } = {}): ModelSpec {
    const { scale, ...rest } = opts;
    return { rig: 'gltf', parts: [], atlas: '', scale: scale ?? 1, gltf: { url, ...rest } };
  },

  /**
   * A person, built from a look on each screen: the platform's characters (players' avatars are
   * ones), micro-voxel figures on the humanoid rig in Call of Blocky's and Blockfront's style, so
   * whatever players wear fits them. Everything in the look is optional: `Models.character({ build:
   * 'heavy', skin: '#7a9a5a', face: 'glow', eyes: '#ff3020', top: 'tee', ragged: true })` is a zombie.
   */
  character(look: CharacterLook = {}, opts: { scale?: number } = {}): ModelSpec {
    return Models.gltf(characterUrl(look), { rig: 'humanoid', ...CHARACTER_STYLE, scale: opts.scale });
  },

  /** Eight legs (the Minecraft spider layout: head, thorax, abdomen, 16x2x2 legs). */
  spider(opts: { skin: [number, number]; atlas?: string; scale?: number }): ModelSpec {
    const o = opts.skin;
    const parts: ModelPart[] = [
      { name: 'thorax', size: [6, 6, 6], uv: add(o, [0, 0]), pivot: [0, 9, 0], offset: [-3, -3, -3] },
      { name: 'abdomen', size: [10, 8, 12], uv: add(o, [0, 12]), pivot: [0, 9, -3], offset: [-5, -4, -12] },
      { name: 'head', size: [8, 8, 8], uv: add(o, [32, 4]), pivot: [0, 9, 3], offset: [-4, -4, 0] },
    ];
    const zs = [1.5, 0.5, -0.5, -1.5];
    const yaws = [0.7, 0.3, -0.3, -0.7];
    zs.forEach((z, i) => {
      parts.push({ name: `legR${i}`, size: [16, 2, 2], uv: add(o, [18, 0]), pivot: [-3, 9, z], offset: [-15, -1, -1], rotation: [0, -yaws[i], -0.6] });
      parts.push({ name: `legL${i}`, size: [16, 2, 2], uv: add(o, [18, 0]), pivot: [3, 9, z], offset: [-1, -1, -1], rotation: [0, yaws[i], 0.6], mirror: true });
    });
    return { rig: 'spider', parts, atlas: opts.atlas ?? 'builtin', scale: opts.scale ?? 1 };
  },
};

/**
 * Joint maps for skeletons named other ways (`GltfSpec.joints`): `Models.gltf(url, { rig:
 * 'humanoid', joints: HumanoidJoints.mixamo() })`.
 */
export const HumanoidJoints = {
  /**
   * A Mixamo character (as exported to glTF: `mixamorig:Hips`, `mixamorig:LeftArm` …; some files
   * say `mixamorig1:` or the like). The chest is `Spine2`; the shoulder bones ride along with it.
   */
  mixamo(prefix = 'mixamorig:'): Partial<Record<HumanoidJoint, string>> {
    const side = (s: 'Left' | 'Right') => ({ upperArm: `${prefix}${s}Arm`, lowerArm: `${prefix}${s}ForeArm`, hand: `${prefix}${s}Hand`, upperLeg: `${prefix}${s}UpLeg`, lowerLeg: `${prefix}${s}Leg`, foot: `${prefix}${s}Foot` });
    const L = side('Left');
    const R = side('Right');
    return {
      hips: `${prefix}Hips`,
      spine: `${prefix}Spine`,
      chest: `${prefix}Spine2`,
      neck: `${prefix}Neck`,
      head: `${prefix}Head`,
      upperArmL: L.upperArm,
      lowerArmL: L.lowerArm,
      handL: L.hand,
      upperArmR: R.upperArm,
      lowerArmR: R.lowerArm,
      handR: R.hand,
      upperLegL: L.upperLeg,
      lowerLegL: L.lowerLeg,
      footL: L.foot,
      upperLegR: R.upperLeg,
      lowerLegR: R.lowerLeg,
      footR: R.foot,
    };
  },
};

const sword = (tier: number): HeldModelSpec => {
  const o: [number, number] = [64 * tier, 96];
  return {
    parts: [
      { size: [3, 3, 2], uv: add(o, [40, 16]), offset: [-1.5, -1.5, -3] },
      { size: [2, 2, 6], uv: add(o, [40, 6]), offset: [-1, -1, -1] },
      { size: [10, 2, 2], uv: add(o, [40, 0]), offset: [-5, -1, 5] },
      { size: [4, 1, 15], uv: add(o, [0, 0]), offset: [-2, -0.5, 7] },
      { size: [2, 1, 2], uv: add(o, [0, 18]), offset: [-1, -0.5, 22] },
      { size: [1, 1, 2], uv: add(o, [10, 18]), offset: [-0.5, -0.5, 24] },
    ],
    grip: [0, 0, 2],
  };
};

/**
 * Built-in 3D held items, in the `builtin` atlas. An item uses one by naming it:
 * `hold: { model: HeldModels.ironSword }`. Without a model, an item is held as its extruded sprite.
 */
export const HeldModels = {
  /**
   * A glTF or GLB model held in the hand (a Blockbench item, say), in first person and by others:
   * `hold: { model: HeldModels.gltf(swordUrl, { grip: [0, 0, 2] }) }`. It should run along +z to
   * its tip with its handle near the origin; `rotation` (degrees about X, Y, Z) and `scale` fix
   * one that doesn't. `grip` is the point in the fist, in pixels (a sixteenth of a block), and
   * `grip2` the other hand's: each over the empty node the file marks (`grip`, `grip2`), in first
   * person and in figures' hands alike.
   */
  gltf(url: string, opts: { grip?: [number, number, number]; grip2?: [number, number, number]; rotation?: [number, number, number]; scale?: number } = {}): HeldModelSpec {
    return { parts: [], grip: opts.grip, grip2: opts.grip2, gltf: { url, rotation: opts.rotation, scale: opts.scale } };
  },
  woodenSword: sword(0),
  stoneSword: sword(1),
  ironSword: sword(2),
  diamondSword: sword(3),
  /** Upright along +z: a glass bottle with glowing red brew and a cork. */
  healthPotion: {
    parts: [
      { size: [6, 6, 5], uv: [0, 120], offset: [-3, -3, 0] },
      { size: [4, 4, 1], uv: [24, 120], offset: [-2, -2, 5] },
      { size: [2, 2, 3], uv: [36, 120], offset: [-1, -1, 6] },
      { size: [3, 3, 1], uv: [48, 120], offset: [-1.5, -1.5, 9] },
      { size: [2, 2, 2], uv: [24, 126], offset: [-1, -1, 9.6] },
    ],
    // Held up on the palm: the fist sits under the bottle.
    grip: [0, 0, -2.2],
  } as HeldModelSpec,
};
