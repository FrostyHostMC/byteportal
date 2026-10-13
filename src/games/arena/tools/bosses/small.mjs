/**
 * The bosses' minions and props: a spiderling, an egg sac, a phylactery; a bone out of the sky,
 * a soul orb (the soul storm's), an ice spike that rises out of the floor (`rise`), the Warden's
 * soul cage. Voxels of 1/16 block (the spiderling 1/24), drawn at their own size.
 */
import { Figure, hash } from './kit.mjs';

/** A spiderling: a little purple-black spider with a glowing green-spotted abdomen. */
export function spiderling() {
  const f = new Figure('spiderling', { voxel: 1 / 24 });
  f.colour('chitin', 0x2a1f30, { rough: 0.45, vary: 0.04 });
  f.colour('chitinLight', 0x4a3a52, { rough: 0.45, vary: 0.04 });
  f.colour('band', 0x7fae38, { rough: 0.6, vary: 0.03 });
  f.colour('spot', 0x9cff4a, { rough: 0.5, glow: 0.9, vary: 0 });
  f.colour('eye', 0xff3a2a, { rough: 0.3, glow: 1, vary: 0 });
  f.colour('fang', 0xd8d0b0, { rough: 0.5, vary: 0 });
  f.bone('body', null, [0, 7, 1]);
  f.bone('abdomen', 'body', [0, 8, -2]);
  f.ball('body', [0, 7, 2.5], [3.6, 2.6, 4], (i, j, k) => (j >= 8 && (i + k) % 3 === 0 ? 'chitinLight' : 'chitin'));
  f.ball('abdomen', [0, 9, -5], [4.6, 4, 5.2], (i, j, k) => (j >= 10 && hash(i, j, k, 2) < 0.18 ? 'spot' : j >= 11 && Math.abs(i + 0.5) < 1 ? 'band' : 'chitin'));
  for (const s of [1, -1]) {
    f.box('body', [s > 0 ? 0 : -2, 7, 6], [s > 0 ? 2 : 0, 9, 7], 'eye');
    f.box('body', [s > 0 ? 0 : -1, 4, 5], [s > 0 ? 1 : 0, 6, 7], 'fang');
  }
  const legs = [3.5, 1.5, -0.5, -2.5];
  legs.forEach((z, n) => {
    for (const [s, L] of [[1, 'L'], [-1, 'R']]) {
      const name = `leg${n}${L}`;
      f.bone(name, 'body', [s * 3, 7, z]);
      const fz = z + (n - 1.5) * 2.2;
      f.path(name, [[s * 3, 7, z], [s * 8, 11, fz], [s * 12, 0.5, fz + (n - 1.5) * 1.5]], 1, 0.6, (i, j) => (j === 10 || j === 11 ? 'band' : 'chitin'));
    }
  });
  const walk = [0, 0.25, 0.5, 0.75, 1].map((t, n) => {
    const a = Math.sin((n / 4) * Math.PI * 2);
    const turn = {};
    legs.forEach((_, l) => {
      const ph = l % 2 ? -a : a;
      turn[`leg${l}L`] = [0, 0.45 * ph, 0.25 * Math.max(0, ph)];
      turn[`leg${l}R`] = [0, 0.45 * ph, -0.25 * Math.max(0, -ph)];
    });
    turn.abdomen = [0.08 * a, 0, 0];
    return { t: t * 0.5, turn };
  });
  f.clip('walk', walk);
  f.clip('idle', [0, 0.6, 1.2].map((t, n) => ({ t, turn: { abdomen: [n === 1 ? -0.08 : 0, 0, 0], leg0L: [0, n === 1 ? 0.15 : 0, 0], leg0R: [0, n === 1 ? -0.15 : 0, 0] } })));
  return f;
}

/** An egg sac: a pale, veined sac glowing green inside, webbed to the floor. It throbs (`pulse`). */
export function eggSac() {
  const f = new Figure('egg_sac', { voxel: 1 / 16 });
  f.colour('sac', 0xd8e8b8, { rough: 0.4, vary: 0.04 });
  f.colour('sacDark', 0xa8c080, { rough: 0.45, vary: 0.04 });
  f.colour('vein', 0x5a8a30, { rough: 0.5, vary: 0.03 });
  f.colour('glow', 0x9cff4a, { rough: 0.5, glow: 0.85, vary: 0 });
  f.colour('web', 0xf2f2ea, { rough: 0.9, vary: 0.02 });
  f.bone('sac', null, [0, 0, 0]);
  f.ball('sac', [0, 10, 0], [7.5, 9.5, 7.5], (i, j, k, u) => {
    const h = hash(i, j, k, 6);
    if (u > 0.86 && Math.abs(Math.sin((i + 0.5) * 0.9 + (j + 0.5) * 0.35) * 3 - (k + 0.5) * 0.3) < 0.5) return 'vein';
    if (u > 0.86 && h < 0.08) return 'glow';
    return j < 5 ? 'sacDark' : 'sac';
  });
  f.ball('sac', [0, 18.5, 0], [3, 2.5, 3], 'sacDark');
  // Webbing from its sides to the floor.
  for (let n = 0; n < 6; n++) {
    const a = (n / 6) * Math.PI * 2;
    f.rod('sac', [Math.cos(a) * 6.5, 6, Math.sin(a) * 6.5], [Math.cos(a) * 10.5, 0.5, Math.sin(a) * 10.5], 0.6, 0.6, 'web');
  }
  f.clip('pulse', [
    { t: 0, scale: { sac: [1, 1, 1] } },
    { t: 0.35, scale: { sac: [1.07, 0.95, 1.07] } },
    { t: 0.9, scale: { sac: [1, 1, 1] } },
  ]);
  return f;
}

/** A phylactery: a soul in an ice-blue crystal, floating and turning over a pedestal of iron and bone. */
export function phylactery() {
  const f = new Figure('phylactery', { voxel: 1 / 16 });
  f.colour('iron', 0x3a3e46, { rough: 0.35, metal: 0.8, vary: 0.04 });
  f.colour('ironDark', 0x22252b, { rough: 0.4, metal: 0.7, vary: 0.02 });
  f.colour('bone', 0xd8ccae, { rough: 0.85, vary: 0.04 });
  f.colour('socket', 0x161a20, { rough: 1, vary: 0 });
  f.colour('crystal', 0x8fe3ff, { rough: 0.15, glow: 0.55, vary: 0.04 });
  f.colour('crystalEdge', 0xd8f8ff, { rough: 0.1, glow: 0.8, vary: 0 });
  f.colour('soul', 0xffffff, { rough: 0.2, glow: 1, vary: 0 });
  f.bone('base', null, [0, 0, 0]);
  f.bone('crystal', 'base', [0, 23, 0]);
  // The pedestal: a stepped iron base with skulls round it.
  f.box('base', [-6, 0, -6], [6, 2, 6], 'ironDark');
  f.box('base', [-4.5, 2, -4.5], [4.5, 8, 4.5], (i, j, k) => (j === 7 ? 'ironDark' : 'iron'));
  f.box('base', [-5.5, 8, -5.5], [5.5, 10, 5.5], 'ironDark');
  for (let n = 0; n < 4; n++) {
    const a = (n / 4) * Math.PI * 2 + Math.PI / 4;
    const c = [Math.cos(a) * 5, 5, Math.sin(a) * 5];
    f.ball('base', c, 1.9, (i, j, k) => (j === 5 && hash(i, j, k, 1) < 0.5 ? 'socket' : 'bone'));
    // Prongs up from the pedestal's corners, curling in toward the crystal.
    f.path('base', [[Math.cos(a) * 4.5, 10, Math.sin(a) * 4.5], [Math.cos(a) * 6.5, 16, Math.sin(a) * 6.5], [Math.cos(a) * 6, 24, Math.sin(a) * 6], [Math.cos(a) * 3.5, 30, Math.sin(a) * 3.5]], 0.9, 0.6, 'iron');
  }
  // The crystal: a long double point, a white soul in its heart.
  f.each('crystal', [-5, 10, -5], [5, 36, 5], (i, j, k) => {
    const x = Math.abs(i + 0.5), y = Math.abs(j + 0.5 - 23), z = Math.abs(k + 0.5);
    const d = x / 4.5 + y / 12.5 + z / 4.5;
    if (d > 1) return undefined;
    if (d < 0.32) return 'soul';
    return d > 0.88 && (x < 0.6 || z < 0.6) ? 'crystalEdge' : 'crystal';
  });
  f.clip('idle', [0, 1, 2, 3, 4].map((t, n) => ({ t, turn: { crystal: [0, (n * Math.PI) / 2, 0] }, move: { crystal: [0, n % 2 ? 1 : -0.5, 0] } })));
  return f;
}

/** A great bone out of the sky (the Colossus's rain): a thighbone with knobbed ends, chipped. */
export function bone() {
  const f = new Figure('bone', { voxel: 1 / 16 });
  f.colour('bone', 0xe3d6b4, { rough: 0.85, vary: 0.05 });
  f.colour('boneDark', 0xb9a782, { rough: 0.9, vary: 0.04 });
  f.colour('crack', 0x5a4a34, { rough: 0.95, vary: 0 });
  f.bone('bone', null, [0, 0, 0]);
  f.rod('bone', [-11, 0, 0], [11, 0, 0], 2.4, 2.1, (i, j, k) => (hash(i, j, k, 1) < 0.05 ? 'crack' : 'bone'));
  for (const s of [1, -1]) for (const d of [1.8, -1.8]) f.ball('bone', [s * 12.5, d, 0], 3, (i, j, k) => (hash(i, j, k, 2) < 0.1 ? 'boneDark' : 'bone'));
  return f;
}

/** A soul orb (the Lich King's storm): a glowing violet skull with a tail of soul fire. */
export function soulOrb() {
  const f = new Figure('soul_orb', { voxel: 1 / 16 });
  f.colour('soul', 0xb08cff, { rough: 0.3, glow: 0.9, vary: 0.03 });
  f.colour('soulHot', 0xf0e8ff, { rough: 0.3, glow: 1, vary: 0 });
  f.colour('soulDeep', 0x6a3ad8, { rough: 0.3, glow: 0.7, vary: 0 });
  f.colour('socket', 0x1a0c33, { rough: 1, vary: 0 });
  f.bone('orb', null, [0, 0, 0]);
  f.ball('orb', [0, 0, 0], [5, 5, 5.5], (i, j, k, u) => (u < 0.6 ? 'soulHot' : 'soul'));
  f.box('orb', [-3.5, -6, 0], [3.5, -3, 5], 'soul');
  for (const x of [-3, 1]) f.box('orb', [x, 0, 4], [x + 2, 2, 6], 'socket');
  // The tail, up behind it as it falls.
  for (let y = 4; y < 16; y++) {
    const r = 4.5 * (1 - (y - 4) / 12);
    f.each('orb', [-r - 1, y, -r - 1], [r + 1, y + 1, r + 1], (i, j, k) => (Math.hypot(i + 0.5, k + 0.5) < r && hash(i, j, k, 3) < 0.75 - (y - 4) * 0.04 ? (y > 11 ? 'soulDeep' : 'soul') : undefined));
  }
  return f;
}

/** An ice spike: three shards bursting out of the floor (`rise`: up from nothing, a little past, back). */
export function iceSpike() {
  const f = new Figure('ice_spike', { voxel: 1 / 16 });
  f.colour('ice', 0xa8ecff, { rough: 0.1, glow: 0.35, vary: 0.04 });
  f.colour('iceDeep', 0x5ab8e8, { rough: 0.1, glow: 0.3, vary: 0.04 });
  f.colour('iceWhite', 0xf0fcff, { rough: 0.1, glow: 0.5, vary: 0 });
  f.bone('spike', null, [0, 0, 0]);
  const shard = (base, tip, r) => f.rod('spike', base, tip, r, 0.3, (i, j, k, t) => (t > 0.8 ? 'iceWhite' : hash(i, j, k, 4) < 0.25 ? 'iceDeep' : 'ice'));
  shard([0, 0, 0], [1, 28, 0.5], 3.2);
  shard([3, 0, 1], [6.5, 15, 3], 2);
  shard([-2.5, 0, -2], [-6, 12, -4], 1.8);
  shard([-1, 0, 3], [-2, 9, 6.5], 1.4);
  f.clip('rise', [
    { t: 0, scale: { spike: [0.6, 0.02, 0.6] } },
    { t: 0.09, scale: { spike: [1.05, 1.18, 1.05] } },
    { t: 0.17, scale: { spike: [1, 1, 1] } },
    { t: 3, scale: { spike: [1, 1, 1] } },
  ]);
  return f;
}

/** The Warden's soul cage: bars of violet soul-light between iron rings, a spiked dome on top. */
export function soulCage() {
  const f = new Figure('soul_cage', { voxel: 1 / 16 });
  f.colour('bar', 0xc79bff, { rough: 0.3, glow: 0.9, vary: 0.02 });
  f.colour('iron', 0x2c2632, { rough: 0.35, metal: 0.8, vary: 0.03 });
  f.colour('rivet', 0x6a5a80, { rough: 0.3, metal: 0.8, vary: 0 });
  f.bone('cage', null, [0, 0, 0]);
  const R = 10;
  for (const y of [0, 16, 31]) f.each('cage', [-R - 2, y, -R - 2], [R + 2, y + 2, R + 2], (i, j, k) => {
    const d = Math.hypot(i + 0.5, k + 0.5);
    return d > R - 1.2 && d < R + 1 ? (Math.round(Math.atan2(k + 0.5, i + 0.5) * 6) % 3 === 0 ? 'rivet' : 'iron') : undefined;
  });
  for (let n = 0; n < 10; n++) {
    const a = (n / 10) * Math.PI * 2;
    f.rod('cage', [Math.cos(a) * R, 1, Math.sin(a) * R], [Math.cos(a) * R, 31, Math.sin(a) * R], 0.75, 0.75, 'bar');
  }
  // The dome: ribs over the top, a spike.
  for (let n = 0; n < 5; n++) {
    const a = (n / 5) * Math.PI * 2;
    f.path('cage', [[Math.cos(a) * R, 32, Math.sin(a) * R], [Math.cos(a) * R * 0.7, 37, Math.sin(a) * R * 0.7], [0, 40, 0]], 0.8, 0.8, 'iron');
  }
  f.rod('cage', [0, 40, 0], [0, 45, 0], 1.2, 0.3, 'bar');
  return f;
}
