/**
 * The beasts: monsters that aren't people (a spider, slimes, a bat), each painted as voxel parts on
 * bones of its own, with the clips it moves by (`idle`, `walk`, `attack` and its own), in voxels at
 * 26 a metre as the platform's people are. Each returns { vox, palette, skeleton, clips }, and
 * `rigid`, its trunk's parts (see `figureGlb`).
 */
import { Palette, Voxels } from '../voxel.mjs';
import { clip } from './glb.mjs';
import { ball, bury, capsule, hash } from './shapes.mjs';

const smooth = (t) => t * t * (3 - 2 * t);
const lerp = (a, b, t) => a + (b - a) * t;
/** Keys at `n` even steps through a loop, from `fn(t)` (t 0..1, the last the first again). */
const keys = (n, fn) => Array.from({ length: n + 1 }, (_, i) => [i / n, fn((i % n) / n)]);

// ---------------------------------------------------------------------------------------------
// The spider: a big hunting spider, dark and banded, red-eyed, its abdomen marked with chevrons.

const LEG_Z = [7, 4, 0.5, -3];
/** Each pair's splay from straight out (radians, toward the front). */
const LEG_SPLAY = [0.95, 0.35, -0.3, -0.85];

export function spider() {
  const P = new Palette();
  P.add('chitin', 0x3a2f28, { rough: 0.5, vary: 0.07 });
  P.add('chitinDark', 0x241c18, { rough: 0.55 });
  P.add('fur', 0x4a3a2c, { rough: 0.95 });
  P.add('band', 0xb8622c, { rough: 0.6 });
  P.add('mark', 0xc8401f, { rough: 0.55 });
  P.add('markPale', 0xe0a050, { rough: 0.55 });
  P.add('eye', 0xff2a14, { rough: 0.2, glow: 1 });
  P.add('eyeSmall', 0xff7a3a, { rough: 0.2, glow: 0.7 });
  P.add('fang', 0xe9dcc0, { rough: 0.3 });
  const vox = new Voxels();
  const skeleton = [
    { name: 'body', parent: null, at: [0, 12, 3] },
    { name: 'abdomen', parent: 'body', at: [0, 13, -3] },
    { name: 'head', parent: 'body', at: [0, 12, 8] },
  ];
  const furry = (base) => (i, j, k) => (hash(i, j, k, 3) < 0.16 ? 'fur' : base);
  // Thorax and head.
  ball(vox, 'body', [0, 12, 3], [6.5, 4.6, 7], 'chitin');
  ball(vox, 'body', [0, 14.5, 3], [4, 2.4, 5], (i, j, k) => (Math.abs(i + 0.5) < 1 && j >= 16 ? 'band' : undefined));
  ball(vox, 'head', [0, 12.4, 11], [4.6, 3.9, 4.2], furry('chitinDark'));
  // Eyes: two big ones forward, two pairs smaller above and beside.
  for (const s of [1, -1]) {
    const x = s > 0 ? 1 : -2;
    for (const [dx, j] of [[0, 14], [s, 14], [0, 13], [s, 13]]) vox.set('head', x + dx, j, 15, 'eye');
    vox.set('head', s > 0 ? 3 : -4, 15, 14, 'eyeSmall');
    vox.set('head', s > 0 ? 1 : -2, 16, 14, 'eyeSmall');
    vox.set('head', s > 0 ? 4 : -5, 13, 13, 'eyeSmall');
    // Chelicerae and fangs.
    capsule(vox, 'head', [s * 1.6, 10.5, 13.5], [s * 1.4, 8, 15], 1.5, 1.2, 'chitinDark');
    capsule(vox, 'head', [s * 1.4, 8.4, 15], [s * 0.9, 5.6, 15.6], 0.9, 0.5, 'fang');
    // Pedipalps.
    capsule(vox, 'head', [s * 3.2, 11, 13], [s * 4.4, 8, 17], 1, 0.8, (i, j, k, t) => (t > 0.75 ? 'band' : 'chitin'));
  }
  // Abdomen: big and round, chevrons down its back.
  ball(vox, 'abdomen', [0, 15.5, -11.5], [8.5, 7.6, 11], (i, j, k) => {
    const x = Math.abs(i + 0.5);
    const z = -k;
    if (j >= 17) {
      const v = (z - 6 - x * 0.6) % 5;
      if (z > 6 && z < 21 && x < 6.5 - (z - 6) * 0.25 && v >= 0 && v < 1.6) return x < 1.5 ? 'markPale' : 'mark';
      if (x < 1 && z <= 6 && z > 3) return 'mark';
    }
    return hash(i, j, k, 7) < 0.07 ? 'fur' : 'chitin';
  });
  ball(vox, 'abdomen', [0, 13, -3.5], [2.5, 2.2, 2.5], 'chitinDark');
  // Legs: from the thorax's sides up to a high knee and down to the ground, banded at the joints.
  LEG_Z.forEach((z, n) => {
    for (const [side, s] of [['L', 1], ['R', -1]]) {
      const a = LEG_SPLAY[n];
      const out = [Math.cos(a) * s, 0, Math.sin(a)];
      const hip = [s * 5, 11.5, z];
      const reach = n === 0 ? 1.12 : n === 3 ? 1.05 : 1;
      const knee = [hip[0] + out[0] * 8 * reach, 21 + (n === 0 ? 1 : 0), hip[2] + out[2] * 8 * reach];
      const foot = [hip[0] + out[0] * 19 * reach, 0.6, hip[2] + out[2] * 19 * reach];
      const leg = `leg${side}${n}`;
      const shin = `shin${side}${n}`;
      skeleton.push({ name: leg, parent: 'body', at: hip }, { name: shin, parent: leg, at: knee });
      capsule(vox, leg, hip, knee, 1.45, 1.2, (i, j, k, t) => (t > 0.86 ? 'band' : 'chitin'));
      capsule(vox, shin, knee, foot, 1.15, 0.55, (i, j, k, t) => (t < 0.12 || (t > 0.55 && t < 0.63) ? 'band' : t > 0.9 ? 'chitinDark' : 'chitin'));
      bury(vox, leg, 'body');
      bury(vox, shin, leg);
    }
  });
  bury(vox, 'head', 'body');
  bury(vox, 'abdomen', 'body');

  // Clips. Legs in two sets of four (left 0 and 2 with right 1 and 3, and the others), each leg
  // reaching forward lifted, then pushing back along the ground.
  const legs = [];
  LEG_Z.forEach((_, n) => legs.push(['L', 1, n], ['R', -1, n]));
  const step = (side, s, n) => (side === 'L' ? n % 2 : (n + 1) % 2) * 0.5;
  const walk = { body: { move: keys(8, (t) => [0, -0.6 * Math.abs(Math.sin(t * Math.PI * 2)), 0]) }, abdomen: { turn: keys(8, (t) => [0.05 * Math.sin(t * Math.PI * 4), 0.06 * Math.sin(t * Math.PI * 2), 0]) } };
  for (const [side, s, n] of legs) {
    const yaw = (u) => {
      // Forward (−s about y) while it swings, back along the ground.
      const sw = u < 0.5 ? smooth(u / 0.5) : 1 - (u - 0.5) / 0.5;
      return -s * lerp(-0.3, 0.3, sw);
    };
    const lift = (u) => (u < 0.5 ? Math.sin((u / 0.5) * Math.PI) : 0);
    walk[`leg${side}${n}`] = { turn: keys(8, (t) => { const u = (t + step(side, s, n)) % 1; return [0, yaw(u), s * 0.4 * lift(u)]; }) };
    walk[`shin${side}${n}`] = { turn: keys(8, (t) => { const u = (t + step(side, s, n)) % 1; return [0, 0, -s * 0.25 * lift(u)]; }) };
  }
  const idle = { body: { move: keys(4, (t) => [0, -0.5 * Math.sin(t * Math.PI) ** 2, 0]) }, abdomen: { size: keys(4, (t) => 1 + 0.035 * Math.sin(t * Math.PI) ** 2) }, head: { turn: keys(4, (t) => [0, 0.08 * Math.sin(t * Math.PI * 2), 0]) } };
  for (const [side, s, n] of legs) if (n === 0) idle[`leg${side}${n}`] = { turn: keys(4, (t) => [0, 0, s * 0.08 * Math.sin(t * Math.PI) ** 2]) };
  // The bite: rearing up, the front legs raised, then down with the fangs.
  const rear = (t) => (t < 0.35 ? smooth(t / 0.35) : t < 0.55 ? 1 - smooth((t - 0.35) / 0.2) * 1.4 : -0.4 * (1 - smooth((t - 0.55) / 0.45)));
  const at = [0, 0.15, 0.3, 0.42, 0.5, 0.6, 0.8, 1];
  const attack = {
    body: { turn: at.map((t) => [t, [-0.38 * rear(t), 0, 0]]) },
    head: { turn: at.map((t) => [t, [0.35 * Math.max(0, -rear(t)) - 0.1 * Math.max(0, rear(t)), 0, 0]]) },
  };
  for (const [side, s, n] of legs) if (n < 2) attack[`leg${side}${n}`] = { turn: at.map((t) => [t, [0, -s * 0.35 * Math.max(0, rear(t)) * (n ? 0.5 : 1), s * (n ? 0.5 : 0.95) * Math.max(0, rear(t))]]) };
  const clips = [clip('idle', 1.8, idle), clip('walk', 1, walk), clip('attack', 0.55, attack)];
  return { vox, palette: P, skeleton, clips, rigid: [['body', 'head', 'abdomen']] };
}

// ---------------------------------------------------------------------------------------------
// Slimes: a wobbling block of green jelly with big eyes, gulped things showing in it (a skull, a
// sword). Three sizes: the big one splits into two small ones, each of those into two tiny ones.

const SLIMES = {
  big: { w: 14, h: 12, r: 7, eye: 3, junk: true },
  small: { w: 8, h: 7, r: 4, eye: 2, junk: false },
  tiny: { w: 4.5, h: 4, r: 2.2, eye: 1, junk: false },
};

export function slime(size) {
  const o = SLIMES[size];
  const P = new Palette();
  P.add('jelly', 0x6fd64a, { rough: 0.12, vary: 0.04, glow: 0.3 });
  P.add('jellyLight', 0xa6f07a, { rough: 0.1, glow: 0.4 });
  P.add('jellyDark', 0x3f9a2e, { rough: 0.15, glow: 0.2 });
  P.add('eye', 0x101410, { rough: 0.2 });
  P.add('glint', 0xffffff, { rough: 0.1, glow: 0.6 });
  P.add('mouth', 0x24581c, { rough: 0.3 });
  P.add('bone', 0xd8d0b4, { rough: 0.5 });
  P.add('steel', 0xb8c0c8, { rough: 0.25, metal: 0.8 });
  P.add('hilt', 0x6a4424, { rough: 0.6 });
  const vox = new Voxels();
  const { w, h, r } = o;
  const skeleton = [{ name: 'body', parent: null, at: [0, 0, 0] }];
  for (let i = -Math.ceil(w); i < Math.ceil(w); i++)
    for (let j = 0; j < Math.ceil(h * 2); j++)
      for (let k = -Math.ceil(w); k < Math.ceil(w); k++) {
        const p = [i + 0.5, j + 0.5, k + 0.5];
        // A rounded block, slumped: wider at the bottom than the top.
        const sl = 1 + 0.12 * (1 - p[1] / (h * 2));
        const q = [p[0] / sl, p[1], p[2] / sl];
        let d2 = 0;
        const lo = [-w, 0, -w], hi = [w, h * 2, w];
        for (let a = 0; a < 3; a++) {
          const e = Math.max(lo[a] + r - q[a], 0, q[a] - (hi[a] - r));
          d2 += (e / r) ** 2;
        }
        if (d2 > 1) continue;
        const top = !(j + 1 < h * 2 && (() => {
          const qq = [p[0] / sl, p[1] + 1, p[2] / sl];
          let dd = 0;
          for (let a = 0; a < 3; a++) dd += (Math.max(lo[a] + r - qq[a], 0, qq[a] - (hi[a] - r)) / r) ** 2;
          return dd <= 1;
        })());
        vox.set('body', i, j, k, top && hash(i >> 1, 0, k >> 1, 2) < 0.55 ? 'jellyLight' : j < 2 ? 'jellyDark' : 'jelly');
      }
  // The face on the front: two big eyes with glints, a little mouth.
  const front = (i, j) => {
    for (let k = Math.ceil(w) + 2; k > -w; k--) if (vox.filled(i, j, k, 'body')) return k;
    return null;
  };
  const eyeY = Math.round(h * 1.15), e = o.eye;
  for (const m of [1, -1]) {
    const cx = m > 0 ? Math.round(w * 0.35) : -Math.round(w * 0.35) - e;
    for (let di = 0; di < e; di++)
      for (let dj = 0; dj < e + (e > 1 ? 1 : 0); dj++) {
        const k = front(cx + di, eyeY + dj);
        if (k !== null) vox.set('body', cx + di, eyeY + dj, k, di === e - 1 && dj === e - (e > 1 ? 0 : 1) && e > 1 ? 'glint' : 'eye');
      }
  }
  const mw = Math.max(1, Math.round(w * 0.25));
  for (let i = -mw; i < mw; i++) {
    const k = front(i, eyeY - Math.max(2, e));
    if (k !== null) vox.set('body', i, eyeY - Math.max(2, e), k, 'mouth');
  }
  // What it's swallowed, showing through its side: a skull, and a sword stuck in its top.
  if (o.junk) {
    for (const [i, j, k] of [[-14, 8, -2], [-14, 8, -3], [-14, 9, -1], [-14, 9, -4], [-14, 10, -1], [-14, 10, -2], [-14, 10, -3], [-14, 10, -4], [-14, 11, -2], [-14, 11, -3], [-14, 7, -2], [-14, 7, -3]]) if (vox.filled(i, j, k, 'body')) vox.set('body', i, j, k, 'bone');
    for (let j = 18; j < 30; j++) vox.set('body', 3, j, -4, j > 25 ? 'hilt' : 'steel');
    for (const i of [1, 2, 4, 5]) vox.set('body', i, 25, -4, 'hilt');
  }
  // Clips: a wobble standing, stretched as it flies, a hop (a squash, then up), a slam.
  const idle = { body: { size: keys(4, (t) => { const q = Math.sin(t * Math.PI * 2); return [1 + 0.05 * q, 1 - 0.06 * q, 1 + 0.05 * q]; }) } };
  const walk = { body: { size: keys(4, (t) => { const q = Math.sin(t * Math.PI * 2); return [0.92 + 0.03 * q, 1.1 - 0.04 * q, 0.92 + 0.03 * q]; }) } };
  const hop = { body: { size: [[0, [1, 1, 1]], [0.35, [1.22, 0.68, 1.22]], [0.55, [0.84, 1.22, 0.84]], [1, [1, 1, 1]]] } };
  const attack = { body: { size: [[0, [1, 1, 1]], [0.3, [0.85, 1.25, 0.85]], [0.55, [1.3, 0.62, 1.3]], [1, [1, 1, 1]]] } };
  return { vox, palette: P, skeleton, clips: [clip('idle', 1.1, idle), clip('walk', 1, walk), clip('hop', 0.45, hop), clip('attack', 0.5, attack)] };
}

// ---------------------------------------------------------------------------------------------
// The bat: a big cave bat, furred body, ears like knives, red eyes, leathery wings that never stop
// beating. Its feet are where it flies from: the body hangs a little above them.

export function bat() {
  const P = new Palette();
  P.add('fur', 0x3a2c30, { rough: 0.95, vary: 0.08 });
  P.add('furDark', 0x241a1e, { rough: 0.95 });
  P.add('wing', 0x4a2a36, { rough: 0.7, vary: 0.05 });
  P.add('wingBone', 0x2a161e, { rough: 0.6 });
  P.add('ear', 0x6a3a4a, { rough: 0.7 });
  P.add('nose', 0x8a5a66, { rough: 0.6 });
  P.add('eye', 0xff3030, { rough: 0.2, glow: 1 });
  P.add('fang', 0xf2ead8, { rough: 0.4 });
  const vox = new Voxels();
  const skeleton = [
    { name: 'body', parent: null, at: [0, 9, 0] },
    { name: 'head', parent: 'body', at: [0, 10, 3] },
    { name: 'wingL', parent: 'body', at: [2, 10, 1] },
    { name: 'tipL', parent: 'wingL', at: [10, 11, 2] },
    { name: 'wingR', parent: 'body', at: [-2, 10, 1] },
    { name: 'tipR', parent: 'wingR', at: [-10, 11, 2] },
  ];
  /** A flat triangle a voxel thick, its cells coloured by `colour(u, v)` (u along a→b, v along a→c). */
  const tri = (part, a, b, c, colour) => {
    for (let u = 0; u <= 1; u += 0.02)
      for (let v = 0; v <= 1 - u; v += 0.02) {
        const q = [0, 1, 2].map((x) => a[x] + (b[x] - a[x]) * u + (c[x] - a[x]) * v);
        const col = colour(u, v);
        if (col) vox.set(part, Math.floor(q[0]), Math.floor(q[1]), Math.floor(q[2]), col);
      }
  };
  ball(vox, 'body', [0, 9, 0], [3.4, 3.2, 4.4], (i, j, k) => (hash(i, j, k, 1) < 0.25 ? 'furDark' : 'fur'));
  ball(vox, 'head', [0, 10.6, 4.2], [2.8, 2.6, 2.6], 'fur');
  ball(vox, 'head', [0, 10, 6.4], [1.3, 1, 0.9], 'nose');
  for (const m of [1, -1]) {
    // Ears: tall and pointed.
    tri('head', [m * 0.6, 12, 4], [m * 3.2, 12, 3.6], [m * 2.6, 17, 3], (u, v) => (u + v > 0.9 ? 'furDark' : 'ear'));
    vox.set('head', m > 0 ? 1 : -2, 11, 6, 'eye');
    vox.set('head', m > 0 ? 0 : -1, 8, 6, 'fang');
    vox.set('body', m > 0 ? 1 : -2, 5, -2, 'furDark');
  }
  // Wings: an arm bone to the wrist and three fingers spread from it, the membrane between them
  // scalloped back from the fingers' tips; the inner panel on the arm, the rest on the hand.
  for (const [side, m] of [['L', 1], ['R', -1]]) {
    const X = (p) => [p[0] * m, p[1], p[2]];
    const shoulder = X([2, 10, 1]), wrist = X([10, 11, 2]), hip = X([2, 9.5, -4]);
    const fingers = [X([20, 11.5, 1]), X([18, 11, -5]), X([12, 10.5, -8.5])];
    const arm = `wing${side}`, hand = `tip${side}`;
    tri(arm, shoulder, wrist, hip, (u, v) => (v > 0.9 - u * 0.2 ? null : 'wing'));
    tri(arm, wrist, fingers[2], hip, (u, v) => (u + v > 0.92 && v > 0.1 && u > 0.1 ? null : 'wing'));
    for (let n = 0; n < 2; n++) tri(hand, wrist, fingers[n], fingers[n + 1], (u, v) => (u > 0.08 && v > 0.08 && u + v > 0.86 ? null : 'wing'));
    capsule(vox, arm, shoulder, wrist, 0.7, 0.6, 'wingBone');
    for (const f of fingers) capsule(vox, hand, wrist, f, 0.5, 0.3, 'wingBone');
  }
  // The beat: wings down hard, up softly; the body bobbing against them.
  const beat = (t) => Math.cos(t * Math.PI * 2);
  const flap = (scale) => ({
    body: { move: keys(8, (t) => [0, 0.8 * beat(t) * scale, 0]) },
    wingL: { turn: keys(8, (t) => [0, 0, 0.75 * beat(t)]) },
    tipL: { turn: keys(8, (t) => [0, 0, 0.55 * beat(t - 0.08)]) },
    wingR: { turn: keys(8, (t) => [0, 0, -0.75 * beat(t)]) },
    tipR: { turn: keys(8, (t) => [0, 0, -0.55 * beat(t - 0.08)]) },
  });
  const attack = { head: { turn: [[0, [0, 0, 0]], [0.4, [-0.5, 0, 0]], [0.6, [0.5, 0, 0]], [1, [0, 0, 0]]] }, body: { turn: [[0, [0, 0, 0]], [0.5, [0.4, 0, 0]], [1, [0, 0, 0]]] } };
  return { vox, palette: P, skeleton, clips: [clip('idle', 0.32, flap(1)), clip('walk', 1, flap(1)), clip('attack', 0.35, attack)] };
}
