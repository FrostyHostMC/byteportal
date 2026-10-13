/**
 * The Broodmother: a spider queen nearly six blocks across her legs, a purple-black carapace with
 * pale ridges, a crown of bone spikes, eight red eyes, fangs dripping green; a bloated abdomen with
 * a glowing green mark on its back and clusters of eggs glowing through its flanks. Eight legs of
 * three segments (`leg{1-4}{L|R}{a,b,c}`), fangs (`fangL`, `fangR`) and an abdomen that lifts to
 * spit and drops to lay. Voxels of 1/12 block; written twice as small and drawn at scale 2.
 */
import { Figure, hash } from './kit.mjs';

/** The legs: where each pair joins the body (z), and which way it reaches (radians from +x toward +z). */
const LEGS = [
  [15, 0.75],
  [10, 0.28],
  [5, -0.22],
  [0, -0.72],
];

export function broodmother() {
  const f = new Figure('broodmother', { voxel: 1 / 12, scale: 2 });
  const C = (n, hex, o) => f.colour(n, hex, o);
  C('chitin', 0x2e2238, { rough: 0.32, metal: 0.15, vary: 0.04 });
  C('chitinLight', 0x4c3a5c, { rough: 0.3, metal: 0.15, vary: 0.04 });
  C('ridge', 0x7e6a94, { rough: 0.35, metal: 0.15, vary: 0.03 });
  C('belly', 0x40303c, { rough: 0.6, vary: 0.04 });
  C('band', 0x5e6a34, { rough: 0.55, vary: 0.03 });
  C('hair', 0x140e18, { rough: 0.9, vary: 0 });
  C('crown', 0xe6dcc8, { rough: 0.6, vary: 0.03 });
  C('crownTip', 0x8a6a9a, { rough: 0.5, vary: 0 });
  C('fang', 0xe8e0c8, { rough: 0.45, vary: 0.02 });
  C('eye', 0xff2a1a, { rough: 0.2, glow: 1, vary: 0 });
  C('eyeDim', 0xc81a14, { rough: 0.2, glow: 0.7, vary: 0 });
  C('mark', 0x9cff4a, { rough: 0.4, glow: 1, vary: 0 });
  C('egg', 0xa8d878, { rough: 0.3, glow: 0.45, vary: 0.04 });
  C('venom', 0x7fff3a, { rough: 0.3, glow: 1, vary: 0 });

  f.bone('body', null, [0, 20, 8]);
  f.bone('head', 'body', [0, 20, 16]);
  f.bone('fangL', 'head', [2.5, 16.5, 22]);
  f.bone('fangR', 'head', [-2.5, 16.5, 22]);
  f.bone('abdomen', 'body', [0, 22, -2]);
  const legPts = [];
  LEGS.forEach(([z, a], n) => {
    for (const [s, L] of [[1, 'L'], [-1, 'R']]) {
      const ox = s * Math.cos(a), oz = Math.sin(a);
      const A = [s * 8.5, 20, z];
      const K = [A[0] + ox * 10, 33 - n * 0.8, A[2] + oz * 10];
      const N = [A[0] + ox * 22, 9, A[2] + oz * 22];
      const F = [A[0] + ox * 27.5, 0.6, A[2] + oz * 27.5];
      const id = `leg${n + 1}${L}`;
      f.bone(`${id}a`, 'body', A);
      f.bone(`${id}b`, `${id}a`, K);
      f.bone(`${id}c`, `${id}b`, N);
      legPts.push({ id, A, K, N, F, s });
    }
  });

  // --- The body: a domed carapace with pale ridges radiating from its middle.
  f.ball('body', [0, 20, 8], [10, 6.5, 11], (i, j, k) => {
    if (j < 17) return 'belly';
    const a = Math.atan2(k + 0.5 - 8, i + 0.5);
    if (j > 22 && Math.abs(Math.sin(a * 4)) < 0.16) return 'ridge';
    return j > 23 ? 'chitinLight' : 'chitin';
  });
  // --- The head: eight eyes, a crown of bone spikes.
  f.ball('head', [0, 19.5, 19.5], [7, 6, 5.5], (i, j, k) => (j < 16 ? 'belly' : 'chitin'));
  for (const s of [1, -1]) {
    f.ball('head', [s * 2.6, 21.6, 23.6], [1.7, 1.7, 1.2], 'eye');
    f.ball('head', [s * 5.2, 22.4, 22], [1, 1, 1], 'eyeDim');
    f.ball('head', [s * 4, 24, 21.4], [0.9, 0.9, 0.9], 'eyeDim');
    f.ball('head', [s * 1.3, 24.6, 22.4], [0.9, 0.9, 0.9], 'eye');
  }
  [[0, 30.5, 15], [2.8, 29, 15], [-2.8, 29, 15], [5.2, 27, 14.5], [-5.2, 27, 14.5]].forEach(([x, y, z]) =>
    f.path('head', [[x * 0.7, 24, 17.5], [x * 0.9, (24 + y) / 2, 17], [x, y, z]], 1.2, 0.3, (i, j, k, t) => (t > 0.7 ? 'crownTip' : 'crown')),
  );
  // Pedipalps: short feelers at the front.
  for (const s of [1, -1]) f.path('head', [[s * 5, 17, 21], [s * 8, 14, 25], [s * 7.5, 9.5, 27]], 1.1, 0.7, (i, j) => (j === 13 ? 'band' : 'chitin'));
  // --- The fangs: thick and hairy, curving to bone-white points with venom at the tips.
  for (const [s, part] of [[1, 'fangL'], [-1, 'fangR']]) {
    f.rod(part, [s * 2.5, 17, 22], [s * 2.6, 11.5, 24.5], 2.2, 1.7, (i, j, k) => (hash(i, j, k, 3) < 0.15 ? 'hair' : 'chitin'));
    f.path(part, [[s * 2.6, 11.5, 24.5], [s * 2, 8.5, 25], [s * 0.8, 6.8, 23.6]], 1.2, 0.45, (i, j) => (j < 7.5 ? 'venom' : 'fang'));
  }

  // --- The abdomen: bloated, a glowing mark down its back, eggs glowing through its flanks, spines.
  const ab = [0, 26, -15], ar = [15, 13, 17];
  // The mark: a row of glowing diamonds down her back, smaller toward her tail, and spots either side.
  const diamonds = [[-6, 3.2], [-11.5, 2.7], [-16.5, 2.3], [-21, 1.8], [-25, 1.3]];
  f.ball('abdomen', ab, ar, (i, j, k, u) => {
    const x = i + 0.5, y = j + 0.5 - ab[1], z = k + 0.5;
    if (y < -6) return 'belly';
    if (u > 0.84 && y > 3 && diamonds.some(([dz, r]) => Math.abs(x) + Math.abs(z - dz) < r)) return 'mark';
    if (u > 0.86 && y > 0 && y < 8 && Math.abs(Math.abs(x) - 9) < 1.2 && [-9, -15, -21].some((dz) => Math.abs(z - dz) < 1.2)) return 'mark';
    if (u > 0.9 && y > 4) return hash(i, j, k, 8) < 0.12 ? 'ridge' : 'chitinLight';
    return 'chitin';
  });
  for (const s of [1, -1]) {
    // Clusters of eggs on the flanks.
    for (let n = 0; n < 7; n++) {
      const a = 0.4 + n * 0.32;
      const c = [s * (ar[0] - 1.2) * Math.cos(0.35 * Math.sin(a * 3)), ab[1] - 2 + Math.sin(a * 2.3) * 4, ab[2] + Math.cos(a) * 9];
      f.ball('abdomen', c, 1.4 + (n % 3) * 0.4, (i, j, k, u) => (u > 0.75 ? 'egg' : 'mark'));
    }
  }
  // Spines in rows along its back, and the spinnerets at its tail.
  for (let z = -26; z <= -4; z += 4)
    for (const x of [-6, 0, 6]) {
      const y = ab[1] + ar[1] * Math.sqrt(Math.max(0, 1 - (x / ar[0]) ** 2 - ((z - ab[2]) / ar[2]) ** 2));
      f.rod('abdomen', [x, y - 1, z], [x * 1.15, y + 2.5, z - 1], 0.9, 0.3, 'hair');
    }
  f.ball('abdomen', [0, 21, -31], [3, 3, 2.5], 'belly');
  f.ball('abdomen', [0, 20.5, -33], [1.5, 1.5, 1.2], 'band');

  // --- The legs: banded at the joints, bristling, tapering to points.
  for (const { id, A, K, N, F } of legPts) {
    const col = (i, j, k, t) => (t > 0.86 ? 'band' : hash(i, j, k, 5) < 0.06 ? 'hair' : 'chitin');
    f.rod(`${id}a`, A, K, 2.3, 1.8, col);
    f.ball(`${id}a`, K, 2.1, 'band');
    f.rod(`${id}b`, K, N, 1.8, 1.35, col);
    f.ball(`${id}b`, N, 1.5, 'band');
    f.rod(`${id}c`, N, F, 1.3, 0.55, (i, j, k, t) => (t > 0.8 ? 'hair' : 'chitin'));
    // Bristles along the upper segment.
    for (let t = 0.2; t < 0.9; t += 0.18) {
      const p = [A[0] + (K[0] - A[0]) * t, A[1] + (K[1] - A[1]) * t, A[2] + (K[2] - A[2]) * t];
      f.rod(`${id}a`, p, [p[0] * 1.06, p[1] + 2.4, p[2] + 0.5], 0.5, 0.25, 'hair');
    }
  }

  clips(f, legPts);
  return f;
}

/** Her clips: idle, walk, run, her moves' wind-ups and blows, a rear, a stagger, her death. */
function clips(f, legs) {
  // Turn a leg: lift its foot (up), swing it ahead (fwd), fold it (fold): in its side's terms.
  const leg = (id, s, up = 0, fwd = 0, fold = 0) => ({
    [`${id}a`]: [0, -s * fwd, s * up],
    [`${id}b`]: [0, 0, -s * fold],
    [`${id}c`]: [0, 0, -s * fold * 0.6],
  });
  const legsAll = (fn) => Object.assign({}, ...legs.map((l, n) => leg(l.id, l.s, ...fn(l, n))));
  // The walk: alternating sets of four (1L 2R 3L 4R, then the others), each lifting and reaching ahead.
  const gait = (len, lift, reach, bob) =>
    [0, 0.125, 0.25, 0.375, 0.5, 0.625, 0.75, 0.875, 1].map((t) => ({
      t: t * len,
      turn: {
        ...legsAll((l, n) => {
          const off = (Math.floor(n / 2) + (l.s > 0 ? 0 : 1)) % 2 ? 0.5 : 0;
          const p = (t + off) * Math.PI * 2;
          return [lift * Math.max(0, Math.sin(p)), -reach * Math.cos(p), 0.25 * lift * Math.max(0, Math.sin(p))];
        }),
        abdomen: [0.04 * Math.sin(t * Math.PI * 4), 0.05 * Math.sin(t * Math.PI * 2), 0],
        head: [0, 0.06 * Math.sin(t * Math.PI * 2), 0],
      },
      move: { body: [0, 0.6 * Math.abs(Math.sin(t * Math.PI * 2)) * bob, 0] },
    }));
  f.clip('walk', gait(1, 0.38, 0.22, 1));
  f.clip('run', gait(1, 0.5, 0.3, 1.5));
  // Idle: a breathing abdomen, legs shifting, fangs working.
  f.clip('idle', [0, 0.8, 1.6, 2.4].map((t, n) => ({
    t,
    turn: {
      abdomen: [0.04 * Math.sin((n / 3) * Math.PI * 2), 0, 0],
      fangL: [0, 0, n === 1 ? 0.15 : 0],
      fangR: [0, 0, n === 2 ? -0.15 : 0],
      head: [0, n === 1 ? 0.1 : n === 2 ? -0.08 : 0, 0],
      ...leg('leg1L', 1, n === 1 ? 0.18 : 0, n === 1 ? 0.1 : 0),
      ...leg('leg2R', -1, n === 2 ? 0.14 : 0, 0),
    },
    scale: { abdomen: [1 + 0.02 * Math.sin((n / 3) * Math.PI * 2), 1 + 0.02 * Math.sin((n / 3) * Math.PI * 2), 1] },
  })));
  // The bite: reared back, fangs spread, forelegs up; then a lunge with the fangs snapping shut.
  const biteWind = { body: [-0.22, 0, 0], head: [-0.15, 0, 0], fangL: [0, 0, 0.45], fangR: [0, 0, -0.45], ...leg('leg1L', 1, 0.55, 0.2), ...leg('leg1R', -1, 0.55, 0.2), ...leg('leg3L', 1, 0, 0, 0), ...leg('leg4L', 1, -0.1), ...leg('leg4R', -1, -0.1) };
  f.clip('bite_wind', [{ t: 0, turn: {}, move: {} }, { t: 0.25, turn: biteWind, move: { body: [0, 1.5, -1] } }, { t: 3, turn: biteWind, move: { body: [0, 1.5, -1] } }]);
  f.clip('bite', [
    { t: 0, turn: biteWind, move: { body: [0, 1.5, -1] } },
    { t: 0.08, turn: { body: [0.18, 0, 0], head: [0.25, 0, 0], fangL: [0, 0, -0.3], fangR: [0, 0, 0.3], ...leg('leg1L', 1, 0.1, 0.35), ...leg('leg1R', -1, 0.1, 0.35) }, move: { body: [0, -1.5, 4] } },
    { t: 0.5, turn: {}, move: {} },
  ]);
  // Rearing up (her roar): forelegs high and thrashing, fangs wide, the rear legs braced.
  const rear = (n) => ({
    body: [-0.55, 0, 0],
    head: [-0.2, 0, 0],
    abdomen: [0.35, 0, 0],
    fangL: [0, 0, 0.5 + (n % 2) * 0.1],
    fangR: [0, 0, -0.5 - (n % 2) * 0.1],
    ...leg('leg1L', 1, 1 + (n % 2) * 0.2, 0.5, 0.3),
    ...leg('leg1R', -1, 1.2 - (n % 2) * 0.2, 0.5, 0.3),
    ...leg('leg2L', 1, 0.55, 0.2),
    ...leg('leg2R', -1, 0.55, 0.2),
    'leg3La': [0.55, 0, 0],
    'leg3Ra': [0.55, 0, 0],
    'leg4La': [0.55, 0, 0],
    'leg4Ra': [0.55, 0, 0],
  });
  f.clip('rear', [
    { t: 0, turn: {}, move: {} },
    { t: 0.35, turn: rear(0), move: { body: [0, 4, -3] } },
    ...[1, 2, 3, 4, 5].map((n) => ({ t: 0.35 + n * 0.17, turn: rear(n), move: { body: [0, 4, -3] } })),
    { t: 1.6, turn: { body: [0.1, 0, 0], ...leg('leg1L', 1, 0.1, 0.2), ...leg('leg1R', -1, 0.1, 0.2) }, move: { body: [0, -1, 1] } },
    { t: 2.1, turn: {}, move: {} },
  ]);
  // The leap: crouched low, then stretched out in the air, then the landing.
  const crouch = { body: [0.1, 0, 0], abdomen: [-0.1, 0, 0], ...legsAll(() => [-0.12, 0, -0.2]) };
  f.clip('leap_wind', [{ t: 0, turn: {}, move: {} }, { t: 0.3, turn: crouch, move: { body: [0, -4, 0] } }, { t: 3, turn: crouch, move: { body: [0, -4.5, 0] } }]);
  const flying = { body: [-0.15, 0, 0], abdomen: [-0.15, 0, 0], ...legsAll((l, n) => (n < 2 ? [0.35, 0.45, 0.2] : n < 4 ? [0.2, 0.15, 0] : [0.15, -0.35, -0.15])) };
  f.clip('leap', [{ t: 0, turn: crouch, move: { body: [0, -4, 0] } }, { t: 0.15, turn: flying, move: { body: [0, 1, 0] } }, { t: 3, turn: flying, move: { body: [0, 1, 0] } }]);
  f.clip('land', [
    { t: 0, turn: flying, move: { body: [0, 1, 0] } },
    { t: 0.08, turn: { body: [0.15, 0, 0], abdomen: [-0.2, 0, 0], ...legsAll(() => [-0.25, 0, -0.1]) }, move: { body: [0, -5.5, 0] } },
    { t: 0.6, turn: {}, move: {} },
  ]);
  // Spitting: the abdomen raised over her back, then thrust; laying: the abdomen to the floor, throbbing.
  const spitWind = { abdomen: [0.55, 0, 0], body: [-0.12, 0, 0], fangL: [0, 0, 0.3], fangR: [0, 0, -0.3] };
  f.clip('spit_wind', [{ t: 0, turn: {} }, { t: 0.3, turn: spitWind }, { t: 3, turn: { ...spitWind, abdomen: [0.6, 0, 0] } }]);
  f.clip('spit', [{ t: 0, turn: spitWind }, { t: 0.07, turn: { ...spitWind, abdomen: [0.8, 0, 0], body: [0.05, 0, 0] } }, { t: 0.45, turn: {} }]);
  f.clip('lay', [
    { t: 0, turn: {}, move: {}, scale: {} },
    ...[0.3, 0.6, 0.9, 1.2, 1.5, 1.8, 2.1, 2.4, 2.7, 3].map((t, n) => ({ t, turn: { abdomen: [-0.32, 0, 0], body: [0.06, 0, 0] }, move: { body: [0, -2, 0] }, scale: { abdomen: n % 2 ? [1.08, 1.06, 1.04] : [1, 1, 1] } })),
  ]);
  // Reeling: thrown up and back, legs flailing.
  f.clip('stagger', [
    { t: 0, turn: {}, move: {} },
    { t: 0.12, turn: { body: [-0.3, 0, 0.15], abdomen: [0.2, 0, 0], ...legsAll((l, n) => [0.4 * (n % 2 ? 1 : 0.6), 0.2, 0.3]) }, move: { body: [0, 2, -2] } },
    { t: 0.6, turn: { body: [-0.1, 0, -0.1], ...legsAll((l, n) => [0.2 * (n % 2 ? 0.5 : 1), -0.1, 0.1]) }, move: { body: [0, 0.5, -1] } },
    { t: 1.3, turn: {}, move: {} },
  ]);
  // Her death: down on her belly, her legs curling in over her.
  const curled = (k) => ({ body: [0.1 * k, 0, 0], abdomen: [-0.2 * k, 0, 0], head: [0.3 * k, 0, 0], fangL: [0, 0, -0.3 * k], fangR: [0, 0, 0.3 * k], ...legsAll((l, n) => [0.9 * k + (n % 3) * 0.05, 0.1 * k, 1.5 * k]) });
  f.clip('death', [
    { t: 0, turn: {}, move: {} },
    { t: 0.3, turn: rear(1), move: { body: [0, 3, -2] } },
    { t: 1, turn: curled(0.3), move: { body: [0, -3, 0] } },
    { t: 1.6, turn: curled(0.6), move: { body: [0, -9, 0] } },
    { t: 2.8, turn: curled(1), move: { body: [0, -11, 0] } },
  ], { hold: 2 });
}
