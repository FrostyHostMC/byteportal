/**
 * The Bone Colossus: a hunched giant skeleton 6.5 blocks tall, a bull's skull with great curved
 * horns and ember eyes, a soul fire burning in its ribcage (whose front halves open like doors,
 * `ribL` / `ribR`), long arms ending in clawed hands that hang to its knees, shackles and broken
 * chains on its wrists, rusted pauldrons. Voxels of 1/12 block; written 3.5 times smaller and drawn
 * at scale 3.5, so its walk takes a stride of about five blocks.
 */
import { Figure, hash } from './kit.mjs';

export function colossus() {
  const f = new Figure('colossus', { voxel: 1 / 12, scale: 3.5 });
  const C = (n, hex, o) => f.colour(n, hex, o);
  C('bone', 0xe3d6b4, { rough: 0.85, vary: 0.05 });
  C('boneLight', 0xf1e8cf, { rough: 0.85, vary: 0.04 });
  C('boneDark', 0xb9a782, { rough: 0.9, vary: 0.04 });
  C('boneShade', 0x8a7a5c, { rough: 0.9, vary: 0.03 });
  C('crack', 0x4a3c2a, { rough: 0.95, vary: 0 });
  C('teeth', 0xf6f0dc, { rough: 0.6, vary: 0.02 });
  C('socket', 0x1a120c, { rough: 1, vary: 0 });
  C('horn', 0xc4b08a, { rough: 0.6, vary: 0.04 });
  C('hornDark', 0x6a5640, { rough: 0.55, vary: 0.04 });
  C('hornTip', 0x2a2018, { rough: 0.4, vary: 0 });
  C('iron', 0x4a4542, { rough: 0.38, metal: 0.75, vary: 0.04 });
  C('ironDark', 0x2a2624, { rough: 0.45, metal: 0.6, vary: 0.02 });
  C('rust', 0x7c4a2a, { rough: 0.85, metal: 0.2, vary: 0.05 });
  C('wood', 0x5a3e24, { rough: 0.85, vary: 0.04 });
  C('feather', 0xe8e2d4, { rough: 0.9, vary: 0.02 });
  C('featherRed', 0x9a2a22, { rough: 0.9, vary: 0.02 });
  C('ember', 0xffa53a, { rough: 0.5, glow: 1, vary: 0 });
  C('emberHot', 0xfff0a0, { rough: 0.5, glow: 1, vary: 0 });
  C('emberDeep', 0xff5a14, { rough: 0.5, glow: 0.9, vary: 0 });

  // Bones (pivots in voxels: x its left, y up, z ahead).
  f.bone('pelvis', null, [0, 26, -2]);
  f.bone('spine', 'pelvis', [0, 30, -4]);
  f.bone('chest', 'spine', [0, 38, -4]);
  f.bone('ribL', 'chest', [11, 46, -1]);
  f.bone('ribR', 'chest', [-11, 46, -1]);
  f.bone('neck', 'chest', [0, 55, 1]);
  f.bone('skull', 'neck', [0, 59, 7]);
  f.bone('jaw', 'skull', [0, 57, 7]);
  for (const [s, L] of [[1, 'L'], [-1, 'R']]) {
    f.bone(`arm${L}`, 'chest', [s * 18, 53, -2]);
    f.bone(`fore${L}`, `arm${L}`, [s * 22, 35, 0]);
    f.bone(`hand${L}`, `fore${L}`, [s * 23, 18, 4]);
  }
  for (const [s, L] of [[1, 'L'], [-1, 'R']]) {
    f.bone(`thigh${L}`, 'pelvis', [s * 9, 26, -2]);
    f.bone(`shin${L}`, `thigh${L}`, [s * 11, 14, 1]);
    f.bone(`foot${L}`, `shin${L}`, [s * 11, 4, -2]);
  }

  // Bone with a little life in it: darker toward its ends and in seams, lighter on its crown.
  const boneAt = (i, j, k, t = 0.5) => {
    const h = hash(i, j, k, 3);
    if (h < 0.015) return 'boneShade';
    if (h > 0.96) return 'boneLight';
    return t < 0.1 || t > 0.9 ? 'boneDark' : 'bone';
  };

  // --- Pelvis: a broad bowl, its wings flared up at the sides.
  f.ball('pelvis', [0, 25, -2], [10, 4.5, 6], (i, j, k) => boneAt(i, j, k));
  f.carve('pelvis', [-7, 26, -6], [7, 31, 3], (i, j, k) => Math.hypot((i + 0.5) / 7, (k + 2.5) / 4.5) < 1);
  for (const s of [1, -1]) f.ball('pelvis', [s * 8.5, 28, -3], [3, 5, 4.5], (i, j, k) => boneAt(i, j, k));
  f.ball('pelvis', [0, 22, 2], [3, 2.5, 2], 'boneDark');

  // --- Spine: vertebrae up from the pelvis to the ribcage's back, ridged behind.
  for (let y = 27; y < 40; y += 3) {
    f.box('spine', [-2.5, y, -7], [2.5, y + 2, -2], (i, j, k) => boneAt(i, j, k));
    f.box('spine', [-1.5, y + 2, -6.5], [1.5, y + 3, -2.5], 'boneShade');
    f.box('spine', [-1, y, -10], [1, y + 2, -7], 'boneDark');
  }

  // --- Chest: the ribcage. Its back half (the spine through it, the ribs from it) is the chest's;
  // the front halves of the ribs and the breastbone are the doors' (`ribL`, `ribR`).
  const cage = { c: [0, 46, 1], r: [13, 10.5, 10] };
  const ribRows = [38, 41, 44, 47, 50, 53];
  for (const y0 of ribRows) {
    // A rib: a band round the cage's skin, two voxels deep, falling as it goes from the spine to the
    // breastbone (three and a half voxels lower at the front than at the back).
    const fall = 3.5;
    const yAt = (z) => y0 + 1 - ((z - (cage.c[2] - cage.r[2])) / (2 * cage.r[2])) * fall;
    f.each('chest', [-cage.r[0] - 2, y0 - fall - 1, cage.c[2] - cage.r[2] - 2], [cage.r[0] + 2, y0 + 2, cage.c[2] + cage.r[2] + 2], (i, j, k) => {
      const yc = yAt(k + 0.5);
      if (Math.abs(j + 0.5 - yc) > 1) return undefined;
      const fy = 1 - ((yc - cage.c[1]) / cage.r[1]) ** 2;
      if (fy <= 0) return undefined;
      const rx = cage.r[0] * Math.sqrt(fy), rz = cage.r[2] * Math.sqrt(fy);
      const d = Math.hypot((i + 0.5) / rx, (k + 0.5 - cage.c[2]) / rz);
      if (d > 1 || d < 1 - 2.2 / Math.min(rx, rz)) return undefined;
      const part = k + 0.5 > cage.c[2] - 1 ? (i >= 0 ? 'ribL' : 'ribR') : 'chest';
      f.vox.set(part, i, j, k, boneAt(i, j, k));
      return undefined;
    });
  }
  // The breastbone, down the front (each half on its door).
  for (const [s, part] of [[1, 'ribL'], [-1, 'ribR']]) f.box(part, [s > 0 ? 0 : -2, 37, 9], [s > 0 ? 2 : 0, 54, 12], (i, j, k) => (j % 3 === 0 ? 'boneDark' : boneAt(i, j, k)));
  // The spine up through the back of the cage, and the shoulders' yoke over its top.
  f.box('chest', [-2.5, 36, -10], [2.5, 56, -5], (i, j, k) => (j % 3 === 0 ? 'boneShade' : boneAt(i, j, k)));
  for (let y = 37; y < 56; y += 3) f.box('chest', [-1, y, -13], [1, y + 2, -10], 'boneDark');
  f.rod('chest', [-16, 54, -3], [16, 54, -3], 2.2, 2.2, (i, j, k, t) => boneAt(i, j, k, t));
  for (const s of [1, -1]) {
    // Shoulder blades on its back.
    f.ball('chest', [s * 9, 50, -9], [5, 6, 1.6], (i, j, k) => boneAt(i, j, k));
    // Collarbones to the breastbone.
    f.rod('chest', [s * 15, 54, -1], [s * 2, 53, 9], 1.6, 1.4, (i, j, k, t) => boneAt(i, j, k, t));
  }
  // Spears and arrows in its back: it's fought in this arena before.
  for (const [a, b, r] of [[[6, 49, -9], [12, 58, -22], 0.75], [[-4, 44, -9], [-10, 47.5, -23], 0.7]]) {
    f.rod('chest', a, b, r, r, (i, j, k, t) => (t > 0.94 ? 'ironDark' : 'wood'));
  }
  for (const [a, b] of [[[-8, 52, -8], [-10.5, 55.5, -15]], [[10, 42, -7], [14.5, 41.5, -13]], [[2, 39, -10], [3, 36, -16]]]) {
    f.rod('chest', a, b, 0.45, 0.45, 'wood');
    f.ball('chest', b, [1.1, 1.1, 1.1], (i, j, k) => ((i + j + k) % 2 ? 'feather' : 'featherRed'));
  }
  // The soul fire inside: a hot heart in a fiery cloud, seen between the ribs.
  f.ball('chest', [0, 46, 1], [7, 6.5, 6], (i, j, k, u) => (u < 0.5 ? 'emberHot' : 'ember'));

  // --- Neck: thick vertebrae curving forward and down to the skull.
  f.path('neck', [[0, 55, -4], [0, 57, 0], [0, 58, 4]], 3, 2.6, (i, j, k) => (j % 2 ? 'boneDark' : 'bone'));

  // --- Skull: a bull's: a rounded cranium, a long snout, heavy brows over deep sockets with an
  // ember burning in each, cracks glowing across its crown.
  f.ball('skull', [0, 62, 8], [6, 5.5, 6], (i, j, k) => boneAt(i, j, k));
  f.ball('skull', [0, 59.6, 14.5], [4.3, 3.7, 6], (i, j, k) => boneAt(i, j, k));
  f.ball('skull', [0, 60.6, 18.6], [3.4, 2.6, 2.2], 'boneLight');
  for (const s of [1, -1]) {
    f.ball('skull', [s * 3.5, 63.6, 12.6], [2.8, 1.4, 2.4], 'boneLight');
    f.ball('skull', [s * 5, 59.5, 11.5], [2.2, 2, 3], 'bone');
    f.ball('skull', [s * 3.4, 61.4, 14], [2.2, 1.8, 2.2], 'socket');
    f.ball('skull', [s * 3.4, 61.4, 14.4], [1.3, 1.1, 1], 'emberHot');
    f.carve('skull', [s * 3.4 - 2.5, 59, 15], [s * 3.4 + 2.5, 64, 22], (i, j) => Math.hypot(i + 0.5 - s * 3.4, (j + 0.5 - 61.4) * 1.15) < 1.9);
  }
  // Nostrils at the muzzle's end.
  for (const x of [1, -2]) f.carve('skull', [x, 59.5, 19.5], [x + 1, 61.5, 22]);
  // Glowing cracks across the crown.
  for (const [i, j, k] of [[0, 67, 9], [1, 67, 8], [1, 67, 7], [2, 66, 6], [-1, 67, 10], [-2, 67, 11], [-2, 66, 12], [3, 66, 5]]) {
    const top = [0, 1, 2].map((d) => j - d).find((y) => f.has('skull', i, y, k));
    if (top !== undefined) f.vox.set('skull', i, top, k, 'emberDeep');
  }
  // Teeth along the snout's lower edge.
  for (let i = -4; i < 4; i++) for (let k = 12; k < 21; k++) if (f.has('skull', i, 56, k) && !f.has('skull', i, 55, k) && (i + k) % 2 === 0) f.vox.set('skull', i, 55, k, 'teeth');
  // Horns: out from the sides of its head, then up and forward, darkening to black tips.
  for (const s of [1, -1]) {
    const pts = [[s * 5, 64, 8], [s * 9, 65.5, 8], [s * 13, 67, 9], [s * 16, 70, 11], [s * 17, 74, 13.5], [s * 16, 77.5, 16.5], [s * 14, 79, 19]];
    pts.forEach((p, n) => {
      if (n === pts.length - 1) return;
      const r0 = 2.8 - n * 0.36, r1 = 2.8 - (n + 1) * 0.36;
      f.rod('skull', p, pts[n + 1], r0, r1, (i, j, k) => (n >= 5 ? 'hornTip' : n >= 3 ? (hash(i, j, k, 5) < 0.3 ? 'hornDark' : 'horn') : (j + k) % 4 === 0 ? 'hornDark' : 'horn'));
    });
  }

  // --- Jaw: a heavy lower jaw, hinged at the back, its teeth jutting up.
  f.box('jaw', [-5, 52.5, 6], [5, 56, 19], (i, j, k) => {
    const x = (i + 0.5) / 5, z = (k + 0.5 - 6) / 13;
    if (x * x > 1 - z * z * 0.6) return undefined;
    if (j >= 55 && Math.abs(i + 0.5) < 3.5 && k > 8) return undefined;
    return boneAt(i, j, k);
  });
  for (let i = -4; i < 4; i++) for (let k = 9; k < 19; k++) if (f.has('jaw', i, 54, k) && !f.has('jaw', i, 55, k) && (i + k) % 2 === 1) f.vox.set('jaw', i, 55, k, 'teeth');
  // Tusks jutting up either side.
  for (const s of [1, -1]) f.rod('jaw', [s * 3.6, 55, 16.5], [s * 4.2, 59, 17.5], 0.9, 0.4, 'teeth');

  for (const [s, L] of [[1, 'L'], [-1, 'R']]) {
    // --- Shoulders: a rusted pauldron each, studded and spiked.
    f.ball(`arm${L}`, [s * 18.5, 55, -2], [6.5, 4.5, 6.5], (i, j, k, u) => (j < 54 ? undefined : u > 0.85 && hash(i, j, k, 2) < 0.25 ? 'rust' : (i + k) % 5 === 0 && u > 0.8 ? 'ironDark' : 'iron'));
    f.box(`arm${L}`, [s * 18.5 - 6.5, 53, -8.5], [s * 18.5 + 6.5, 54, 4.5], (i, j, k) => (Math.hypot(i + 0.5 - s * 18.5, k + 0.5 + 2) < 6.5 ? 'ironDark' : undefined));
    for (const [dx, dz] of [[0, -2], [s * 3, 1], [-s * 3, -4]]) f.rod(`arm${L}`, [s * 18.5 + dx, 58, dz], [s * 18.5 + dx * 1.2, 62.5, dz], 1.3, 0.3, 'ironDark');
    // Upper arm: a heavy bone, knobbed at the elbow.
    f.rod(`arm${L}`, [s * 18, 52, -2], [s * 22, 37, 0], 3, 2.6, (i, j, k, t) => boneAt(i, j, k, t));
    f.ball(`arm${L}`, [s * 22, 36, 0], [3.4, 3, 3.4], (i, j, k) => boneAt(i, j, k));
    // Forearm: two bones side by side to the wrist, a shackle round it, a broken chain hanging.
    f.rod(`fore${L}`, [s * 21.5, 34, -1], [s * 22, 20, 3], 1.9, 1.6, (i, j, k, t) => boneAt(i, j, k, t));
    f.rod(`fore${L}`, [s * 23, 34, 1.5], [s * 24, 20, 5.5], 1.7, 1.5, (i, j, k, t) => boneAt(i, j, k, t));
    f.each(`fore${L}`, [s * 23 - 6, 21, -3], [s * 23 + 6, 25, 10], (i, j, k) => {
      const d = Math.hypot(i + 0.5 - s * 23, (k + 0.5 - 3.5) * 1.1);
      return d < 4.6 && d > 2.4 ? (j === 23 ? 'ironDark' : hash(i, j, k, 7) < 0.2 ? 'rust' : 'iron') : undefined;
    });
    // The chain: links hanging from the shackle, each a quarter turn from the last.
    for (let n = 0; n < 4; n++) {
      const c = [s * 26.5, 19 - n * 2.4, 3.5];
      const across = n % 2 === 0;
      f.each(`fore${L}`, [c[0] - 2, c[1] - 2, c[2] - 2], [c[0] + 2, c[1] + 2, c[2] + 2], (i, j, k) => {
        const x = i + 0.5 - c[0], y = j + 0.5 - c[1], z = k + 0.5 - c[2];
        const w = across ? x : z, d = across ? z : x;
        if (Math.abs(d) > 0.5 || Math.abs(w) > 1.5 || Math.abs(y) > 1.5) return undefined;
        return Math.abs(w) < 0.6 && Math.abs(y) < 0.6 ? undefined : n % 2 ? 'ironDark' : 'iron';
      });
    }
    // Hand: a broad palm and four long clawed fingers curled forward, a thumb on the inside.
    f.box(`hand${L}`, [s * 23 - 3, 12, 2], [s * 23 + 3, 18.5, 8], (i, j, k) => (hash(i, j, k, 4) < 0.1 ? 'boneShade' : 'bone'));
    for (let n = 0; n < 4; n++) {
      const x = s * (23 - 2.2 + n * 1.45);
      const pts = [[x, 13, 7], [x, 9, 9.5], [x, 6, 10.5], [x, 3.5, 9.5]];
      f.path(`hand${L}`, pts, 1.1, 0.8, (i, j, k) => (j < 5 ? 'hornTip' : j < 7 ? 'hornDark' : boneAt(i, j, k, 0.5)));
    }
    f.path(`hand${L}`, [[s * 20, 15, 6], [s * 18.5, 12, 9], [s * 18.5, 9.5, 10.5]], 1.1, 0.8, (i, j, k) => (j < 11 ? 'hornDark' : 'bone'));

    // --- Legs: a thick thighbone, a knee like a boulder, twin shin bones, a clawed foot.
    f.rod(`thigh${L}`, [s * 9, 25, -2], [s * 11, 15.5, 1], 3.2, 2.8, (i, j, k, t) => boneAt(i, j, k, t));
    f.ball(`thigh${L}`, [s * 9, 26, -2], [3.6, 3.4, 3.6], (i, j, k) => boneAt(i, j, k));
    f.ball(`shin${L}`, [s * 11, 14, 1.5], [3.6, 3.2, 3.8], (i, j, k) => boneAt(i, j, k));
    f.rod(`shin${L}`, [s * 10.2, 13, 0], [s * 10.5, 5, -2], 2, 1.8, (i, j, k, t) => boneAt(i, j, k, t));
    f.rod(`shin${L}`, [s * 12.4, 13, 1], [s * 12.4, 5, -1], 1.6, 1.5, (i, j, k, t) => boneAt(i, j, k, t));
    f.box(`foot${L}`, [s * 11 - 3.5, 0, -5], [s * 11 + 3.5, 5, 3], (i, j, k) => (j === 4 && (k + 5) % 3 === 0 ? 'boneShade' : boneAt(i, j, k)));
    f.ball(`foot${L}`, [s * 11, 2.5, -5], [3, 2.5, 2], 'boneDark');
    for (let n = 0; n < 3; n++) {
      const x = s * (11 - 2.4 + n * 2.4);
      f.path(`foot${L}`, [[x, 2, 3], [x, 2.2, 7.5], [x, 1, 10]], 1.15, 0.8, (i, j, k) => (k >= 9 ? 'hornTip' : 'bone'));
    }
  }

  clips(f);
  return f;
}

/** Its clips: idle, walk, its moves' wind-ups and blows, the roar, a stagger, its death. */
function clips(f) {
  // Breathing: the cage swells, the head sways, the arms hang heavy.
  f.clip('idle', [0, 0.8, 1.6, 2.4, 3.2].map((t, n) => {
    const b = Math.sin((n / 4) * Math.PI * 2);
    return {
      t,
      turn: { chest: [-0.03 * b, 0.02 * b, 0], skull: [0.04 * b, 0.1 * Math.sin((n / 4) * Math.PI * 4), 0], jaw: [0.05 + 0.04 * b, 0, 0], ribL: [0, 0.04 * b, 0], ribR: [0, -0.04 * b, 0], armL: [0.04 * b, 0, 0.05], armR: [0.04 * b, 0, -0.05], foreL: [-0.12, 0, 0], foreR: [-0.12, 0, 0] },
      move: { pelvis: [0, -0.4 - 0.3 * b, 0] },
    };
  }));
  // The walk: a heavy, rolling stride, the knuckles swinging opposite the feet.
  f.clip('walk', [0, 0.25, 0.5, 0.75, 1].map((t, n) => {
    const a = Math.cos((n / 4) * Math.PI * 2);
    const lift = (x) => Math.max(0, x);
    const sL = Math.sin((n / 4) * Math.PI * 2);
    return {
      t,
      turn: {
        pelvis: [0, 0.12 * a, 0.05 * a],
        chest: [0.06, -0.16 * a, -0.04 * a],
        skull: [0.05, 0.1 * a, 0],
        thighL: [-0.42 * a, 0, 0],
        shinL: [0.65 * lift(sL), 0, 0],
        footL: [0.3 * a - 0.2 * lift(sL), 0, 0],
        thighR: [0.42 * a, 0, 0],
        shinR: [0.65 * lift(-sL), 0, 0],
        footR: [-0.3 * a - 0.2 * lift(-sL), 0, 0],
        armL: [0.38 * a, 0, 0.06],
        armR: [-0.38 * a, 0, -0.06],
        foreL: [-0.25 - 0.15 * a, 0, 0],
        foreR: [-0.25 + 0.15 * a, 0, 0],
      },
      move: { pelvis: [0, -1.2 + 1.2 * Math.abs(sL), 0] },
    };
  }));
  // The sweep's wind-up: twisted to its right, the right arm out and back; then the blow, across.
  const swWind = { chest: [-0.05, -0.45, 0], armR: [0, -0.55, -1.35], foreR: [-0.5, 0, 0], armL: [0.3, 0, 0.3], skull: [0, 0.3, 0] };
  f.clip('sweep_wind', [
    { t: 0, turn: {} },
    { t: 0.35, turn: swWind },
    { t: 3, turn: { ...swWind, armR: [0, -0.6, -1.4] } },
  ]);
  f.clip('sweep', [
    { t: 0, turn: swWind },
    { t: 0.16, turn: { chest: [0.1, 0.35, 0], armR: [0, 1.5, -1.3], foreR: [-0.2, 0, 0], armL: [0.2, 0, 0.3], skull: [0, -0.2, 0] } },
    { t: 0.3, turn: { chest: [0.12, 0.6, 0], armR: [0, 2.3, -1.15], foreR: [-0.35, 0, 0], armL: [0.1, 0, 0.2], skull: [0, -0.35, 0] } },
    { t: 0.85, turn: {} },
  ]);
  // The stomp: the right foot high, leaning back for balance; then down with all its weight.
  const stWind = { thighR: [-1.15, 0, -0.1], shinR: [1.25, 0, 0], footR: [-0.2, 0, 0], chest: [-0.15, 0, 0.06], pelvis: [0, 0, -0.06], armL: [0, 0, 0.55], armR: [0, 0, -0.75], skull: [-0.2, 0, 0] };
  f.clip('stomp_wind', [
    { t: 0, turn: {}, move: {} },
    { t: 0.45, turn: stWind, move: { pelvis: [0, 0.5, 0] } },
    { t: 3, turn: { ...stWind, thighR: [-1.2, 0, -0.1] }, move: { pelvis: [0, 0.6, 0] } },
  ]);
  f.clip('stomp', [
    { t: 0, turn: stWind, move: { pelvis: [0, 0.5, 0] } },
    { t: 0.1, turn: { thighR: [0.1, 0, 0], shinR: [0.1, 0, 0], chest: [0.3, 0, 0], skull: [0.3, 0, 0], armL: [-0.3, 0, 0.3], armR: [-0.3, 0, -0.3], jaw: [0.4, 0, 0] }, move: { pelvis: [0, -2, 1] } },
    { t: 0.35, turn: { thighR: [0.05, 0, 0], chest: [0.25, 0, 0], skull: [0.2, 0, 0], jaw: [0.3, 0, 0] }, move: { pelvis: [0, -1.5, 0.5] } },
    { t: 0.9, turn: {}, move: {} },
  ]);
  // Calling down the bones: both arms to the sky, head back, jaw wide.
  const rain = { armL: [-0.25, 0, 2.6], armR: [-0.25, 0, -2.6], foreL: [-0.4, 0, 0], foreR: [-0.4, 0, 0], chest: [-0.3, 0, 0], skull: [-0.55, 0, 0], jaw: [0.65, 0, 0] };
  f.clip('rain', [
    { t: 0, turn: {} },
    { t: 0.35, turn: rain },
    { t: 0.6, turn: { ...rain, armL: [-0.2, 0, 2.75], armR: [-0.2, 0, -2.75] } },
    { t: 3, turn: rain },
  ]);
  // The roar: arms flung wide, trembling, then slammed down.
  const roar = { chest: [-0.35, 0, 0], skull: [-0.6, 0, 0], jaw: [0.75, 0, 0], armL: [-0.4, 0, 1.55], armR: [-0.4, 0, -1.55], foreL: [-0.7, 0, 0], foreR: [-0.7, 0, 0], ribL: [0, 0.2, 0], ribR: [0, -0.2, 0] };
  const shake = (n) => ({ ...roar, skull: [-0.6 + (n % 2 ? 0.06 : -0.06), (n % 2 ? 0.05 : -0.05), 0], jaw: [0.75 + (n % 2 ? 0.08 : 0), 0, 0] });
  f.clip('roar', [
    { t: 0, turn: {} },
    { t: 0.3, turn: roar },
    ...[1, 2, 3, 4, 5, 6, 7].map((n) => ({ t: 0.3 + n * 0.14, turn: shake(n) })),
    { t: 1.55, turn: { chest: [0.35, 0, 0], skull: [0.25, 0, 0], jaw: [0.35, 0, 0], armL: [-0.6, 0, 0.3], armR: [-0.6, 0, -0.3], foreL: [-0.2, 0, 0], foreR: [-0.2, 0, 0] } },
    { t: 2.2, turn: {} },
  ]);
  // Its ribcage thrown open: the soul fire bare, thralls climbing out.
  const ribs = { ribL: [0, 1.05, 0], ribR: [0, -1.05, 0], chest: [-0.22, 0, 0], skull: [-0.25, 0, 0], jaw: [0.45, 0, 0], armL: [0, 0, 0.7], armR: [0, 0, -0.7], foreL: [-0.6, 0, 0], foreR: [-0.6, 0, 0] };
  f.clip('rib_open', [
    { t: 0, turn: {} },
    { t: 0.45, turn: ribs },
    { t: 1.2, turn: { ...ribs, ribL: [0, 1.15, 0], ribR: [0, -1.15, 0] } },
    { t: 3, turn: ribs },
  ]);
  // The charge: head down, pawing; then a bull's gallop.
  const chWind = { chest: [0.5, 0, 0], neck: [0.3, 0, 0], skull: [0.55, 0, 0], armL: [0.75, 0, 0.15], armR: [0.75, 0, -0.15], thighL: [-0.45, 0, 0], shinL: [0.6, 0, 0], thighR: [0.1, 0, 0], shinR: [0.3, 0, 0], footL: [-0.15, 0, 0] };
  f.clip('charge_wind', [
    { t: 0, turn: {}, move: {} },
    { t: 0.3, turn: chWind, move: { pelvis: [0, -1.5, 0] } },
    { t: 0.55, turn: { ...chWind, thighR: [-0.3, 0, 0], shinR: [0.8, 0, 0] }, move: { pelvis: [0, -1.5, 0] } },
    { t: 0.8, turn: chWind, move: { pelvis: [0, -1.5, 0] } },
    { t: 1.05, turn: { ...chWind, thighR: [-0.3, 0, 0], shinR: [0.8, 0, 0] }, move: { pelvis: [0, -1.5, 0] } },
    { t: 3, turn: chWind, move: { pelvis: [0, -1.5, 0] } },
  ]);
  f.clip('charge', [0, 0.125, 0.25, 0.375, 0.5].map((t, n) => {
    const a = Math.cos((n / 4) * Math.PI * 2);
    return {
      t,
      turn: { chest: [0.55, 0, 0.04 * a], neck: [0.3, 0, 0], skull: [0.5, 0, 0], armL: [0.85 + 0.15 * a, 0, 0.15], armR: [0.85 - 0.15 * a, 0, -0.15], thighL: [-0.75 * a, 0, 0], shinL: [0.5 + 0.4 * a, 0, 0], thighR: [0.75 * a, 0, 0], shinR: [0.5 - 0.4 * a, 0, 0] },
      move: { pelvis: [0, -1 + Math.abs(Math.sin((n / 4) * Math.PI * 2)), 0] },
    };
  }));
  // Reeling: thrown back, arms flailing, then gathering itself.
  f.clip('stagger', [
    { t: 0, turn: {}, move: {} },
    { t: 0.15, turn: { chest: [-0.45, 0.15, 0.1], skull: [-0.45, -0.2, 0], jaw: [0.5, 0, 0], armL: [-0.3, 0, 0.7], armR: [0.2, 0, -0.9], thighL: [-0.25, 0, 0], shinL: [0.4, 0, 0] }, move: { pelvis: [0, -0.8, -2] } },
    { t: 0.6, turn: { chest: [-0.3, -0.1, -0.08], skull: [-0.2, 0.25, 0], jaw: [0.4, 0, 0], armL: [0.2, 0, 0.5], armR: [-0.2, 0, -0.6], thighL: [-0.2, 0, 0], shinL: [0.35, 0, 0] }, move: { pelvis: [0, -1, -1.5] } },
    { t: 1.2, turn: { chest: [0.2, 0, 0], skull: [0.3, 0, 0], armL: [-0.2, 0, 0.2], armR: [-0.2, 0, -0.2] }, move: { pelvis: [0, -1, 0] } },
    { t: 1.8, turn: {}, move: {} },
  ]);
  // Its death: thrown back, then down onto its knees, then slumped forward onto its hands.
  f.clip('death', [
    { t: 0, turn: {}, move: {} },
    { t: 0.35, turn: { chest: [-0.45, 0, 0], skull: [-0.6, 0, 0], jaw: [0.8, 0, 0], armL: [-0.5, 0, 1.4], armR: [-0.5, 0, -1.4], foreL: [-0.6, 0, 0], foreR: [-0.6, 0, 0], ribL: [0, 0.4, 0], ribR: [0, -0.4, 0] }, move: { pelvis: [0, 0, -1] } },
    { t: 1.1, turn: { chest: [-0.2, 0.1, 0], skull: [-0.3, 0.2, 0], jaw: [0.6, 0, 0], armL: [-0.2, 0, 0.8], armR: [-0.3, 0, -0.9], thighL: [-1.25, 0, 0.05], shinL: [1.9, 0, 0], footL: [-0.6, 0, 0], thighR: [-1.25, 0, -0.05], shinR: [1.9, 0, 0], footR: [-0.6, 0, 0], ribL: [0, 0.5, 0], ribR: [0, -0.5, 0] }, move: { pelvis: [0, -9, 2] } },
    { t: 1.9, turn: { chest: [0.7, 0, 0.05], skull: [0.5, 0, 0], jaw: [0.5, 0, 0], armL: [-0.9, 0, 0.25], armR: [-0.9, 0, -0.25], foreL: [-0.3, 0, 0], foreR: [-0.3, 0, 0], thighL: [-1.35, 0, 0.05], shinL: [2.05, 0, 0], footL: [-0.6, 0, 0], thighR: [-1.35, 0, -0.05], shinR: [2.05, 0, 0], footR: [-0.6, 0, 0], ribL: [0, 0.6, 0], ribR: [0, -0.6, 0] }, move: { pelvis: [0, -10.5, 3] } },
    { t: 2.8, turn: { chest: [1.05, 0.1, 0.1], skull: [0.7, 0.3, 0.2], jaw: [0.7, 0, 0], armL: [-1.3, 0, 0.35], armR: [-1.2, 0, -0.4], foreL: [-0.2, 0, 0], foreR: [-0.2, 0, 0], thighL: [-1.45, 0, 0.05], shinL: [2.15, 0, 0], footL: [-0.6, 0, 0], thighR: [-1.45, 0, -0.05], shinR: [2.15, 0, 0], footR: [-0.6, 0, 0], ribL: [0, 0.9, 0], ribR: [0, -0.9, 0] }, move: { pelvis: [0, -11.5, 4] } },
  ], { hold: 2 });
}
