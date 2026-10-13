/**
 * The Lich King: a dead king five blocks tall, floating over the floor in tattered robes of night
 * blue trimmed with frost and glowing runes; a skull with burning blue eyes under a crown of ice,
 * a high collar, steel pauldrons spiked with ice, a tattered cape; skeletal hands, a soul flame in
 * the left, in the right a staff crowned with a frost orb in an iron claw. No legs: the robe's hem
 * hangs over a cold mist. Voxels of 1/16 block, drawn at its own size. The whole figure hangs from
 * `float` (its bob), the robe sways from the waist (`robe`), the cape from the shoulders.
 */
import { Figure, hash } from './kit.mjs';

export function lich() {
  const f = new Figure('lich', { voxel: 1 / 16 });
  const C = (n, hex, o) => f.colour(n, hex, o);
  C('robe', 0x1b2036, { rough: 0.85, vary: 0.05 });
  C('robeDark', 0x10131f, { rough: 0.9, vary: 0.04 });
  C('robeLight', 0x2c3452, { rough: 0.85, vary: 0.04 });
  C('trim', 0x6fb6d8, { rough: 0.5, metal: 0.3, vary: 0.03 });
  C('rune', 0x9fe8ff, { rough: 0.4, glow: 0.8, vary: 0 });
  C('plate', 0x8a98ac, { rough: 0.28, metal: 0.85, vary: 0.04 });
  C('plateDark', 0x4a5468, { rough: 0.32, metal: 0.8, vary: 0.03 });
  C('gold', 0xc9a94a, { rough: 0.3, metal: 0.9, vary: 0.03 });
  C('bone', 0xddd3b8, { rough: 0.8, vary: 0.05 });
  C('boneDark', 0xa89c80, { rough: 0.85, vary: 0.04 });
  C('socket', 0x0c1018, { rough: 1, vary: 0 });
  C('eye', 0x9ff0ff, { rough: 0.3, glow: 1, vary: 0 });
  C('ice', 0xa8ecff, { rough: 0.1, glow: 0.45, vary: 0.04 });
  C('iceDeep', 0x5ab8e8, { rough: 0.1, glow: 0.35, vary: 0.03 });
  C('iceWhite', 0xf0fcff, { rough: 0.1, glow: 0.7, vary: 0 });
  C('mist', 0xcdf6ff, { rough: 0.6, glow: 0.6, vary: 0.03 });
  C('soul', 0xb08cff, { rough: 0.3, glow: 1, vary: 0 });
  C('soulHot', 0xf0e8ff, { rough: 0.3, glow: 1, vary: 0 });
  C('wood', 0x2a2230, { rough: 0.7, vary: 0.04 });
  C('iron', 0x2c2f36, { rough: 0.35, metal: 0.8, vary: 0.03 });

  f.bone('float', null, [0, 40, 0]);
  f.bone('robe', 'float', [0, 41, 0]);
  f.bone('chest', 'float', [0, 41, 0]);
  f.bone('cape', 'chest', [0, 56, -5]);
  f.bone('neck', 'chest', [0, 58, 0]);
  f.bone('skull', 'neck', [0, 60, 1]);
  f.bone('jaw', 'skull', [0, 60, 2]);
  for (const [s, L] of [[1, 'L'], [-1, 'R']]) {
    f.bone(`arm${L}`, 'chest', [s * 9, 55, 0]);
    f.bone(`fore${L}`, `arm${L}`, [s * 11.5, 44, 1]);
    f.bone(`hand${L}`, `fore${L}`, [s * 12.5, 33, 4]);
  }
  f.bone('staff', 'handR', [-12.5, 31, 5.5]);

  // --- The robe: flaring from the waist to a tattered hem over a glowing mist, frost trim, runes.
  const rOf = (y) => 6.2 + (41 - y) * 0.2;
  f.each('robe', [-14, 9, -13], [14, 42, 14], (i, j, k) => {
    const y = j + 0.5;
    const r = rOf(y);
    const x = (i + 0.5) / r, z = (k + 0.5) / (r * 0.86);
    const d = Math.hypot(x, z);
    if (d > 1 || d < 1 - 2.4 / r) return undefined;
    // Tatters: strips torn away toward the hem.
    const a = Math.atan2(k + 0.5, i + 0.5);
    const strip = Math.floor((a + Math.PI) * 5.5);
    const tear = 10 + hash(strip, 0, 0, 7) * 9;
    if (y < tear) return undefined;
    if (y < tear + 2.5 && y > 13 && y < 17) return 'trim';
    if (Math.abs(i + 0.5) < 1.6 && k > 0) return y % 4 < 1 ? 'rune' : 'trim';
    if (y > 14 && y < 16.5) return 'trim';
    if (y < 16 && hash(i, j, k, 9) < 0.07) return 'rune';
    return hash(i, j, k, 2) < 0.2 ? 'robeDark' : y > 34 ? 'robeLight' : 'robe';
  });
  // The cold mist inside the hem.
  f.ball('robe', [0, 15, 0], [8, 4, 7], (i, j, k, u) => (u > 0.5 && hash(i, j, k, 3) < 0.6 ? 'mist' : undefined));
  // The belt and its skull buckle.
  f.each('robe', [-8, 38, -7], [8, 41, 8], (i, j, k) => {
    const d = Math.hypot((i + 0.5) / 7.2, (k + 0.5) / 6.3);
    return d < 1 && d > 0.8 ? (j === 39 ? 'gold' : 'iron') : undefined;
  });
  f.ball('robe', [0, 39.5, 6.5], [2.2, 2.2, 1.4], (i, j, k) => (j === 39 && (i === -2 || i === 1) ? 'socket' : 'bone'));

  // --- The chest: robes over a steel breastplate, ice-spiked pauldrons, a high collar, runes.
  f.ball('chest', [0, 49, 0], [7.5, 9, 6], (i, j, k, u) => {
    if (j < 41) return undefined;
    if (k > 2 && Math.abs(i + 0.5) < 5 && j > 44 && j < 55) return u > 0.85 && Math.abs(i + 0.5) < 1 ? 'gold' : 'plate';
    return hash(i, j, k, 4) < 0.15 ? 'robeDark' : 'robe';
  });
  for (let j = 45; j < 55; j += 3) f.box('chest', [-0.5, j, 5], [0.5, j + 1, 7], 'rune');
  for (const s of [1, -1]) {
    f.ball('chest', [s * 9, 56, 0], [5, 3.6, 5], (i, j, k, u) => (j < 54 ? undefined : u > 0.8 && (i + k) % 4 === 0 ? 'plateDark' : 'plate'));
    f.box('chest', [s * 9 - 5, 53, -5], [s * 9 + 5, 54, 5], (i, j, k) => (Math.hypot(i + 0.5 - s * 9, k + 0.5) < 5 ? 'plateDark' : undefined));
    // Ice crystals jutting from each pauldron.
    for (const [dx, dz, h] of [[0, 0, 7], [s * 2.5, -2, 5], [s * 2.8, 2.2, 4.5]]) f.rod('chest', [s * 9 + dx, 58, dz], [s * 9 + dx * 1.6 + s * 1.5, 58 + h, dz * 1.3], 1.3, 0.3, (i, j, k, t) => (t > 0.7 ? 'iceWhite' : 'ice'));
    // The collar: a tall flared shell behind the head.
    f.each('chest', [s > 0 ? 0 : -9, 56, -8], [s > 0 ? 9 : 0, 72, -2], (i, j, k) => {
      const y = j + 0.5 - 56;
      const x = Math.abs(i + 0.5);
      const reach = 3.5 + y * 0.32;
      const back = -3 - y * 0.18;
      if (x > reach || x < reach - 1.6 || k + 0.5 > back + 1 || k + 0.5 < back - 1.2) return undefined;
      return y > 13 ? 'ice' : x > reach - 0.6 ? 'trim' : 'robeDark';
    });
  }
  // The cape: from the shoulders down the back, torn at its foot.
  f.each('cape', [-9, 13, -9], [9, 56, -4], (i, j, k) => {
    const y = j + 0.5;
    const w = 7 + (56 - y) * 0.06;
    const z = -6.2 - (56 - y) * 0.06;
    if (Math.abs(i + 0.5) > w || Math.abs(k + 0.5 - z) > 0.6) return undefined;
    const tear = 13 + hash(Math.floor((i + 9) / 2), 1, 0, 5) * 10;
    if (y < tear) return undefined;
    return y < tear + 2 ? 'robeDark' : Math.abs(i + 0.5) > w - 1 ? 'trim' : 'robe';
  });

  // --- The skull: deep sockets burning blue, a jaw, a crown of ice.
  f.rod('neck', [0, 56, -1], [0, 60, 0.5], 1.6, 1.4, (i, j) => (j % 2 ? 'boneDark' : 'bone'));
  f.ball('skull', [0, 63.5, 1.5], [4.8, 5.2, 5.2], (i, j, k) => (hash(i, j, k, 6) < 0.06 ? 'boneDark' : 'bone'));
  f.box('skull', [-3.5, 59.5, 2], [3.5, 62, 6.5], 'bone');
  for (const s of [1, -1]) {
    f.ball('skull', [s * 2, 63.5, 5.6], [1.6, 1.5, 1.3], 'socket');
    f.ball('skull', [s * 2, 63.5, 5.4], [1.15, 1.05, 1], 'eye');
  }
  f.box('skull', [-0.5, 60.5, 6], [0.5, 62, 7], 'socket');
  for (let i = -3; i < 3; i++) f.vox.set('skull', i, 59, 6, i % 2 ? 'boneDark' : 'bone');
  f.box('jaw', [-3, 56.5, 1], [3, 59, 6], (i, j, k) => (j === 58 && k === 5 && i % 2 ? undefined : 'bone'));
  // The crown: a steel band, ice spikes rising from it, the front one tallest.
  f.each('skull', [-6, 66, -5], [6, 68.5, 8], (i, j, k) => {
    const d = Math.hypot((i + 0.5) / 5.2, (k + 0.5 - 1.5) / 5.4);
    return d < 1.02 && d > 0.75 ? (j === 66 ? 'gold' : 'plate') : undefined;
  });
  for (let n = 0; n < 7; n++) {
    const a = Math.PI / 2 + ((n - 3) / 3.6) * Math.PI * 0.8;
    const h = n === 3 ? 13 : 6 + (3 - Math.abs(n - 3)) * 1.6;
    const bx = Math.cos(a) * 4.8, bz = 1.5 + Math.sin(a) * 4.8;
    f.rod('skull', [bx, 67.5, bz], [bx * 1.25, 67.5 + h, bz + (bz - 1.5) * 0.25], 1.15, 0.25, (i, j, k, t) => (t > 0.65 ? 'iceWhite' : hash(i, j, k, 2) < 0.3 ? 'iceDeep' : 'ice'));
  }

  // --- The arms: wide sleeves, bony forearms, long-fingered hands.
  for (const [s, L] of [[1, 'L'], [-1, 'R']]) {
    f.rod(`arm${L}`, [s * 9, 55, 0], [s * 11.5, 44, 1], 3.4, 3, (i, j, k) => (hash(i, j, k, 1) < 0.15 ? 'robeDark' : 'robe'));
    // A bell sleeve from the elbow, the bones of the forearm out of it.
    f.each(`fore${L}`, [s * 12 - 6, 35, -5], [s * 12 + 6, 45, 8], (i, j, k) => {
      const y = j + 0.5;
      const t = (44 - y) / 9;
      const cx = s * (11.5 + t * 0.8), cz = 1 + t * 2.5;
      const r = 2.8 + t * 2.4;
      const d = Math.hypot(i + 0.5 - cx, k + 0.5 - cz);
      if (d > r || (d < r - 1.3 && y < 43)) return undefined;
      return y < 37 ? 'trim' : 'robe';
    });
    f.rod(`fore${L}`, [s * 11.8, 40, 2], [s * 12.4, 33.5, 3.8], 1, 0.9, 'bone');
    f.rod(`fore${L}`, [s * 12.9, 40, 2.6], [s * 13.2, 33.5, 4.6], 0.8, 0.8, 'boneDark');
    f.box(`hand${L}`, [s * 12.5 - 1.5, 30.5, 3], [s * 12.5 + 1.5, 33.5, 6.5], 'bone');
    for (let n = 0; n < 4; n++) {
      const x = s * (12.5 - 1.2 + n * 0.8);
      f.path(`hand${L}`, [[x, 30.5, 5.5], [x, 27.5, 7], [x * 0.98, 25.5, 6.5]], 0.55, 0.4, 'bone');
    }
  }
  // A soul flame over the left hand.
  f.ball('handL', [12.5, 36, 8], [1.8, 2.6, 1.8], (i, j, k, u) => (u < 0.5 ? 'soulHot' : 'soul'));
  f.rod('handL', [12.5, 37, 8], [12.5, 40.5, 8.5], 1.1, 0.2, 'soul');
  // --- The staff: dark wood bound in iron, an iron claw at its head clutching a frost orb.
  f.rod('staff', [-12.5, 4, 5.5], [-12.5, 80, 5.5], 1, 1, (i, j) => (j % 9 === 0 ? 'iron' : 'wood'));
  f.rod('staff', [-12.5, 4, 5.5], [-12.5, 2, 5.5], 1, 0.3, 'iron');
  for (let n = 0; n < 4; n++) {
    const a = (n / 4) * Math.PI * 2 + 0.4;
    f.path('staff', [[-12.5, 78, 5.5], [-12.5 + Math.cos(a) * 3.2, 82, 5.5 + Math.sin(a) * 3.2], [-12.5 + Math.cos(a) * 2.4, 88, 5.5 + Math.sin(a) * 2.4], [-12.5 + Math.cos(a) * 0.8, 90.5, 5.5 + Math.sin(a) * 0.8]], 0.7, 0.35, 'iron');
  }
  f.ball('staff', [-12.5, 85, 5.5], 2.8, (i, j, k, u) => (u < 0.5 ? 'iceWhite' : 'ice'));
  f.rod('staff', [-12.5, 87, 5.5], [-12.5, 95, 5.5], 1, 0.2, 'iceWhite');

  clips(f);
  return f;
}

/** Its clips: idle, its glide, its spells' wind-ups and casts, the storm, a roar, a stagger, its death. */
function clips(f) {
  f.clip('idle', [0, 0.75, 1.5, 2.25, 3].map((t, n) => {
    const b = Math.sin((n / 4) * Math.PI * 2);
    const c = Math.cos((n / 4) * Math.PI * 2);
    return {
      t,
      turn: { robe: [0.04 * c, 0, 0.03 * b], cape: [0.06 + 0.04 * b, 0, 0], chest: [0.02 * b, 0, 0], skull: [0.04 * c, 0.06 * b, 0], armL: [-0.15, 0, 0.12 + 0.04 * b], foreL: [-0.6, 0, 0], armR: [-0.1, 0, -0.08], foreR: [-0.25, 0, 0] },
      move: { float: [0, 1.4 * b, 0] },
    };
  }));
  f.clip('walk', [0, 0.25, 0.5, 0.75, 1].map((t, n) => {
    const b = Math.sin((n / 4) * Math.PI * 2);
    return {
      t,
      turn: { chest: [0.12, 0, 0], robe: [0.24 + 0.05 * b, 0, 0.04 * b], cape: [0.35 + 0.08 * b, 0, 0], skull: [-0.05, 0, 0], armL: [0.15, 0, 0.15], foreL: [-0.6, 0, 0], armR: [0.05, 0, -0.08], foreR: [-0.25, 0, 0] },
      move: { float: [0, 0.6 * b, 0] },
    };
  }));
  // The bolt: the staff drawn back, glowing; then thrust at its mark.
  const boltWind = { chest: [0, -0.3, 0], armR: [0.25, -0.2, -0.1], foreR: [-0.5, 0, 0], staff: [-0.1, 0, 0], armL: [-0.7, 0.3, 0.1], foreL: [-0.4, 0, 0], skull: [0, 0.2, 0] };
  f.clip('bolt_wind', [{ t: 0, turn: {} }, { t: 0.25, turn: boltWind }, { t: 3, turn: boltWind }]);
  f.clip('bolt', [{ t: 0, turn: boltWind }, { t: 0.08, turn: { chest: [0.08, 0.2, 0], armR: [-0.55, 0.1, -0.1], foreR: [-0.3, 0, 0], staff: [2.2, 0, 0], armL: [-0.2, 0, 0.3], skull: [0.05, -0.1, 0] } }, { t: 0.55, turn: {} }]);
  // The nova: the staff raised high in both hands, then driven down.
  const novaWind = { armR: [-2.65, 0, 0.25], foreR: [-0.3, 0, 0], staff: [0.1, 0, 0], armL: [-2.5, 0, -0.35], foreL: [-0.4, 0, 0], chest: [-0.15, 0, 0], skull: [-0.3, 0, 0], jaw: [0.3, 0, 0], robe: [0, 0, 0] };
  f.clip('nova_wind', [{ t: 0, turn: {}, move: {} }, { t: 0.35, turn: novaWind, move: { float: [0, 3, 0] } }, { t: 3, turn: novaWind, move: { float: [0, 3.5, 0] } }]);
  f.clip('nova', [
    { t: 0, turn: novaWind, move: { float: [0, 3, 0] }, scale: { robe: [1, 1, 1] } },
    { t: 0.08, turn: { armR: [-0.9, 0, 0.1], foreR: [-0.2, 0, 0], staff: [-0.2, 0, 0], armL: [-0.8, 0, -0.1], chest: [0.35, 0, 0], skull: [0.2, 0, 0], jaw: [0.2, 0, 0] }, move: { float: [0, -3, 0] }, scale: { robe: [1.18, 0.92, 1.18] } },
    { t: 0.6, turn: {}, move: {}, scale: { robe: [1, 1, 1] } },
  ]);
  // Raising the dead: both arms up and out, palms to the sky.
  const raise = { armL: [-0.3, 0, 2.15], armR: [-0.3, 0, -2.15], foreL: [-0.5, 0, 0], foreR: [-0.5, 0, 0], staff: [0.3, 0, 2.2], skull: [-0.35, 0, 0], jaw: [0.35, 0, 0], chest: [-0.12, 0, 0] };
  f.clip('summon', [{ t: 0, turn: {}, move: {} }, { t: 0.4, turn: raise, move: { float: [0, 2, 0] } }, { t: 3, turn: raise, move: { float: [0, 2.5, 0] } }]);
  // The storm: risen high, arms flung wide, robes and cape whipping.
  f.clip('storm', [0, 0.3, 0.6, 0.9, 1.2].map((t, n) => {
    const b = n % 2 ? 1 : -1;
    return {
      t,
      turn: { armL: [-0.15, 0, 1.45 + 0.05 * b], armR: [-0.15, 0, -1.45 - 0.05 * b], foreL: [-0.2, 0, 0], foreR: [-0.2, 0, 0], staff: [0.15, 0, 1.6], skull: [-0.45, 0.05 * b, 0], jaw: [0.5 + 0.1 * b, 0, 0], chest: [-0.15, 0, 0], robe: [0.12 * b, 0, 0.06 * b], cape: [0.3 + 0.15 * b, 0, 0.05 * b] },
      move: { float: [0, 6 + 0.4 * b, 0] },
    };
  }));
  // The roar: flung wide, head back, jaw open.
  const roar = { armL: [-0.6, 0, 1.4], armR: [-0.6, 0, -1.4], foreL: [-0.5, 0, 0], foreR: [-0.5, 0, 0], staff: [0.5, 0, 1.5], skull: [-0.5, 0, 0], jaw: [0.7, 0, 0], chest: [-0.3, 0, 0], cape: [0.3, 0, 0] };
  f.clip('roar', [
    { t: 0, turn: {}, move: {} },
    { t: 0.35, turn: roar, move: { float: [0, 3, 0] } },
    ...[1, 2, 3, 4, 5].map((n) => ({ t: 0.35 + n * 0.16, turn: { ...roar, skull: [-0.5 + (n % 2 ? 0.05 : -0.05), 0, 0], jaw: [0.7 + (n % 2 ? 0.1 : 0), 0, 0] }, move: { float: [0, 3, 0] } })),
    { t: 2.1, turn: {}, move: {} },
  ]);
  f.clip('stagger', [
    { t: 0, turn: {}, move: {} },
    { t: 0.15, turn: { chest: [-0.45, 0.15, 0], skull: [-0.4, 0, 0], jaw: [0.5, 0, 0], armL: [-0.3, 0, 0.9], armR: [-0.5, 0, -0.8], staff: [0.3, 0, 0.7], robe: [-0.2, 0, 0] }, move: { float: [0, -2, -2] } },
    { t: 0.7, turn: { chest: [0.3, 0, 0], skull: [0.25, 0, 0], armL: [0.1, 0, 0.3], armR: [0.1, 0, -0.3] }, move: { float: [0, -3, 0] } },
    { t: 1.4, turn: {}, move: {} },
  ]);
  // Its death: thrown back screaming, then collapsing into a heap of empty robes.
  f.clip('death', [
    { t: 0, turn: {}, move: {}, scale: { robe: [1, 1, 1] } },
    { t: 0.4, turn: roar, move: { float: [0, 4, 0] }, scale: { robe: [1, 1, 1] } },
    { t: 1.3, turn: { chest: [0.4, 0, 0.1], skull: [0.5, 0.2, 0], jaw: [0.6, 0, 0], armL: [0.2, 0, 0.6], armR: [0.3, 0, -0.5], staff: [0.5, 0, -0.4] }, move: { float: [0, -12, 0] }, scale: { robe: [1.15, 0.7, 1.15] } },
    { t: 2.8, turn: { chest: [1, 0, 0.2], skull: [0.7, 0.3, 0.2], jaw: [0.7, 0, 0], armL: [0.6, 0, 0.9], armR: [0.6, 0, -0.9], staff: [1.2, 0, -0.6], cape: [-0.5, 0, 0] }, move: { float: [0, -24, 0] }, scale: { robe: [1.35, 0.32, 1.35] } },
  ], { hold: 2 });
}
