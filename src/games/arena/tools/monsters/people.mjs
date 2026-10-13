/**
 * The people-shaped monsters: the platform's characters (`src/platform/character/build.ts`, read
 * here as it is: Node strips its types, and a resolve hook finds its extensionless imports) with
 * what makes each a monster painted over them, on the humanoid rig. Design units are the
 * characters' (26 a metre; +x the figure's left, +z ahead, y up from the soles).
 */
import { registerHooks } from 'node:module';
import { Palette, Voxels } from '../voxel.mjs';
import { ball, bury, capsule, hash } from './shapes.mjs';

registerHooks({
  resolve(spec, ctx, next) {
    try {
      return next(spec, ctx);
    } catch (e) {
      if (spec.startsWith('.') && !/\.[a-z]+$/.test(spec)) return next(`${spec}.ts`, ctx);
      throw e;
    }
  },
});
const { characterVoxels, JOINT_PARENT } = await import('../../../../platform/character/build.ts');
const { PLAIN_LOOK } = await import('../../../../platform/character/look.ts');

const C = (i) => i + 0.5;
/** The parts of a person that hardly turn on each other (`figureGlb`'s `rigid`). */
const TRUNK = [['hips', 'spine', 'chest', 'neck', 'head']];

/** The rig's joints in order, parents first, the grips empties. */
function skeletonOf(joints) {
  return Object.entries(JOINT_PARENT).map(([name, parent]) => ({ name, parent, at: joints[name], ...(name.startsWith('grip') ? { bone: false } : {}) }));
}

/** A character to start from: its voxels, colours, joints (design units) and wear frame. */
function person(look) {
  const made = characterVoxels({ ...PLAIN_LOOK, ...look });
  return { ...made, skeleton: skeletonOf(made.joints) };
}

/** Inside a box lo..hi rounded by r (one number, or one per axis) on its edges. */
function inRound(p, lo, hi, r) {
  let d2 = 0;
  for (let a = 0; a < 3; a++) {
    const ra = Array.isArray(r) ? r[a] : r;
    if (p[a] < lo[a] || p[a] > hi[a]) return false;
    if (ra <= 0) continue;
    const q = Math.max(lo[a] + ra - p[a], 0, p[a] - (hi[a] - ra));
    d2 += (q / ra) ** 2;
  }
  return d2 <= 1.0001;
}

/** Fill a part: the cells whose centres lie in lo..hi and that `inside` accepts, coloured `colour` (or by a function of the cell). */
function fill(vox, part, lo, hi, colour, inside = null) {
  const f = typeof colour === 'function' ? colour : () => colour;
  vox.paint(part, lo.map(Math.floor), hi.map(Math.ceil), (i, j, k) => {
    const p = [C(i), C(j), C(k)];
    if (p.some((v, a) => v < lo[a] || v > hi[a])) return;
    if (inside && !inside(p)) return;
    return f(i, j, k);
  });
}

const DIRS6 = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];

/** A plate over a part: the empty cells a voxel out from its surface (across faces in `axes`) that `where` accepts. */
function coat(vox, part, colour, where = () => true, axes = 'xyz') {
  const cells = vox.parts.get(part);
  const add = new Map();
  for (const key of cells.keys()) {
    const i = (key % 1024) - 512, j = (Math.floor(key / 1024) % 1024) - 512, k = Math.floor(key / 1048576) - 512;
    for (const d of DIRS6) {
      if (!axes.includes('xyz'[d[0] ? 0 : d[1] ? 1 : 2])) continue;
      const q = [i + d[0], j + d[1], k + d[2]];
      if (vox.filled(q[0], q[1], q[2], part)) continue;
      const c = typeof colour === 'function' ? colour(...q) : colour;
      if (c && where(q.map(C))) add.set(q.join(), [q, c]);
    }
  }
  for (const [q, c] of add.values()) vox.set(part, q[0], q[1], q[2], c);
}

/**
 * Paint in a hand's posed space: the knight's shield arm is held out by the screens' pose (the
 * forearm forward, a quarter turn up from hanging), so what it holds is drawn as it will be seen
 * (x across, y up, z ahead, from the grip) and put back into the hanging hand's space.
 */
function heldOut(vox, part, grip, paint) {
  const set = (x, y, z, c) => vox.set(part, Math.floor(grip[0] + x), Math.floor(grip[1] - z), Math.floor(grip[2] + y), c);
  paint(set);
}

// ---------------------------------------------------------------------------------------------
// The knight: a revenant in full plate, red tabard, a great helm with embers in the visor's slit,
// a red kite shield held out before it and a longsword.

export function knight() {
  const look = { build: 'broad', skin: '#b8a08a', hair: 'bald', face: 'glow', eyes: '#ffb43a', top: 'tunic', topColor: '#8a1c1c', accent: '#d8b040', bottom: 'trousers', bottomColor: '#3a3a42', shoes: 'boots', shoeColor: '#3a3a40' };
  const { vox, palette: P, joints: J, skeleton, wear } = person(look);
  P.add('steel', 0xaab2bc, { rough: 0.32, metal: 0.85, vary: 0.03 });
  P.add('steelDark', 0x6a717c, { rough: 0.38, metal: 0.8, vary: 0.03 });
  P.add('steelEdge', 0xd8dee6, { rough: 0.25, metal: 0.9 });
  P.add('visor', 0x0d0d12, { rough: 0.6 });
  P.add('ember', 0xffb43a, { rough: 0.2, glow: 1 });
  P.add('plume', 0xb8161a, { rough: 0.9, vary: 0.08 });
  P.add('tabard', 0x8a1c1c, { rough: 0.85 });
  P.add('tabardDark', 0x5e1212, { rough: 0.85 });
  P.add('field', 0x9a1a1e, { rough: 0.55 });
  P.add('rim', 0xd8b040, { rough: 0.25, metal: 1 });
  P.add('wood', 0x5a3a22, { rough: 0.85 });
  P.add('leather', 0x3a2618, { rough: 0.6 });
  // The great helm, over a head cleared of its face (and a neck it hides): a flat-topped barrel, the visor's slit and
  // breaths, a gold crest and a red plume swept back.
  vox.parts.get('head').clear();
  vox.parts.get('neck').clear();
  fill(vox, 'head', [-7, 35.5, -7], [7, 49, 6], (i, j, k) => {
    const x = Math.abs(C(i));
    if (k >= 5 && (j === 42 || j === 41) && x < 5) return x > 1 && x < 3.2 && j === 42 ? 'ember' : 'visor';
    if (k >= 5 && j >= 37 && j <= 39 && x < 3 && (i + j) % 2 === 0) return 'visor';
    if (k >= 5 && Math.abs(C(i)) < 1 && j < 41) return 'steelEdge';
    if (j === 43 || j === 36) return 'steelDark';
    return 'steel';
  }, (p) => inRound(p, [-7, 35.5, -7], [7, 49, 6], [2, 1.5, 2]));
  fill(vox, 'head', [-1, 48, -6], [1, 50.5, 5], 'rim');
  for (let k = -9; k < 3; k++) {
    const t = (2 - k) / 11;
    const top = 50.5 + 2.4 * Math.sin(t * Math.PI * 0.9);
    fill(vox, 'head', [-1.5, top - 2.5 + t * 1.5, k], [1.5, top, k + 1], (i, j) => (hash(i, j, k, 5) < 0.2 ? 'tabardDark' : 'plume'));
  }
  // Breastplate and backplate over the tunic, the tabard down the front with a gold sun.
  for (const part of ['chest', 'spine']) coat(vox, part, 'steel', (p) => p[1] > 21.5);
  vox.recolour('chest', (i, j, k, c) => (c === 'steel' && j >= 32 && Math.abs(C(i)) > 5 ? 'steelDark' : undefined));
  for (const part of ['chest', 'spine']) {
    vox.recolour(part, (i, j, k, c) => {
      if (k < 3 || Math.abs(C(i)) > 3.6 || j > 31) return;
      const x = Math.abs(C(i)), y = j - 27;
      if (Math.hypot(x, y + 0.5) < 2.2 || (Math.hypot(x, y + 0.5) < 3.4 && (x < 0.7 || Math.abs(y + 0.5) < 0.7))) return 'rim';
      return x > 3 ? 'tabardDark' : 'tabard';
    });
  }
  // Pauldrons: layered plates over each shoulder.
  for (const [side, m] of [['L', 1], ['R', -1]]) {
    const a = `upperArm${side}`;
    const sx = m * (J[a][0] + 0.5);
    ball(vox, a, [sx, 31.5, 0], [5, 4.2, 4.8], (i, j) => (j % 2 === 0 ? 'steelDark' : 'steel'), (x, y) => y > 28.5 && (m > 0 ? x > sx - 3.5 : x < sx + 3.5));
    ball(vox, a, [sx, 33.2, 0], [3.6, 1.8, 3.4], 'steelEdge', (x, y) => y > 33);
    coat(vox, `lowerArm${side}`, 'steel', (p) => p[1] < 25);
    vox.recolour(`hand${side}`, () => 'steelDark');
    coat(vox, `upperLeg${side}`, 'steel', (p) => p[1] < 14);
    coat(vox, `lowerLeg${side}`, 'steel', (p) => p[1] > 4.5);
    const L = J[`lowerLeg${side}`];
    ball(vox, `lowerLeg${side}`, [L[0] + 0.5 * m, 11, L[2] + 2.2], [2.6, 2.2, 1.8], 'steelEdge');
    vox.recolour(`foot${side}`, (i, j) => (j === 0 ? 'visor' : 'steelDark'));
  }
  // Faulds: a skirt of plates from the belt to mid-thigh.
  for (let j = 14; j < 22; j++)
    for (let i = -9; i < 9; i++)
      for (let k = -7; k < 7; k++) {
        const t = (22 - j) / 8;
        const hw = 6.8 + t * 1.6, hd = 4.8 + t * 1.2;
        const x = Math.abs(C(i)), z = Math.abs(C(k));
        if (x > hw || z > hd || (x < hw - 1.5 && z < hd - 1.5)) continue;
        const part = j >= 18 ? 'hips' : C(i) > 0 ? 'upperLegL' : 'upperLegR';
        vox.set(part, i, j, k, j % 3 === 0 ? 'steelDark' : C(k) > 3.5 && x < 2.5 ? 'tabard' : 'steel');
      }
  // The kite shield, held out in the left hand.
  const grip = J.gripL;
  vox.recolour('handL', () => 'steelDark');
  heldOut(vox, 'handL', grip, (set) => {
    const half = (y) => (y > -2 ? 8.6 - Math.max(0, y - 9) * 1.2 : 1 + ((y + 15) / 13) * 7.6);
    for (let y = -15; y < 12; y++)
      for (let x = -14; x < 5; x++) {
        const cx = x + 0.5 + 4.6, cy = y + 0.5;
        const w = half(cy);
        if (Math.abs(cx) > w) continue;
        const edge = Math.abs(cx) > w - 1.3 || cy > 10.2 || (cy < -13.2);
        const cross = Math.abs(cx) < 1.2 || Math.abs(cy - 3) < 1.2;
        set(x, y, 4, edge ? 'rim' : cross ? 'rim' : 'field');
        set(x, y, 3, edge ? 'rim' : 'wood');
        if (!edge && Math.abs(cx) < w - 1.3 && hash(x, y, 1) < 0.05) set(x, y, 4, 'tabardDark');
      }
    // The boss in the middle of the cross, and the strap to the fist.
    for (let x = -7; x < -2; x++) for (let y = 1; y < 6; y++) if (Math.hypot(x + 0.5 + 4.6, y + 0.5 - 3) < 2.3) set(x, y, 5, 'steelEdge');
    for (let z = 0; z < 3; z++) for (let y = -1; y < 2; y++) set(-1, y, z, 'leather');
  });
  // The longsword in the right fist: the blade ahead, its flat upright.
  const g = J.gripR;
  const sword = (x, y, z, c) => vox.set('handR', Math.floor(g[0] + x), Math.floor(g[1] + y), Math.floor(g[2] + z), c);
  for (let z = -5; z < 3; z++) sword(0, 0, z, z < -3 ? 'rim' : 'leather');
  for (let y = -4; y < 4; y++) sword(0, y, 3, Math.abs(y + 0.5) > 3 ? 'rim' : 'steelDark');
  for (let z = 4; z < 27; z++) {
    const w = z > 23 ? 26.5 - z : 1.5;
    for (let y = -2; y < 2; y++) if (Math.abs(y + 0.5) < w) sword(0, y, z, y === 0 && z < 22 ? 'steelDark' : 'steelEdge');
  }
  return { vox, palette: P, skeleton, extras: { wear }, rigid: TRUNK };
}

/**
 * A hood up over the head: a shell round the skull, open at the face (which falls into shadow,
 * the eyes glowing out of it), a peak over the brow, and a mantle over the shoulders.
 */
function hood(vox, colour, { mantle = true, peak = true } = {}) {
  const head = vox.parts.get('head');
  for (const [key, c] of [...head]) {
    const k = Math.floor(key / 1048576) - 512;
    if (k >= 2 && c !== 'eye' && c !== 'white') head.set(key, 'shadow');
    else if (k < 2) head.delete(key);
  }
  fill(vox, 'head', [-8, 34.5, -8], [8, 50.5, 7], (i, j, k) => (j === 35 || k === 6 ? `${colour}Shade` : colour), (p) => {
    if (!inRound(p, [-8, 34.5, -8], [8, 50.5, 7], [3, 3, 3])) return false;
    if (inRound(p, [-6.6, 33, -6.6], [6.6, 49, 8], [2.4, 2.4, 2.4])) return false;
    return true;
  });
  if (peak) fill(vox, 'head', [-3, 47, 5], [3, 50, 8], colour, (p) => p[2] < 8 - (p[1] - 47) * 0.6 && p[1] > 46 + Math.abs(p[0]) * 0.8);
  if (mantle)
    fill(vox, 'chest', [-10, 29, -6], [10, 36, 6], (i, j) => (j === 29 ? `${colour}Shade` : colour), (p) => {
      if (!inRound(p, [-10, 25, -6], [10, 36, 6], [3, 4, 3])) return false;
      return !inRound(p, [-8.2, 20, -4.4], [8.2, 35, 4.4], [2, 2, 2]) || p[1] > 34.5;
    });
}

/** A robe from the waist to `bottom`, flaring as it falls; below the thighs' split it hangs from each thigh, so it swings as they stride. */
function robe(vox, colour, { bottom, flare = 3, trim = null, onHips = false, hem = null }) {
  for (let i = -16; i < 16; i++)
    for (let k = -16; k < 16; k++) {
      const x = C(i), z = C(k);
      const low = hem ? hem(i, k) : bottom;
      for (let j = low; j < 23; j++) {
        const t = (23 - j) / (23 - bottom);
        const hw = 7 + t * flare, hd = 4.8 + t * flare * 0.85;
        if (!inRound([x, C(j), z], [-hw, -50, -hd], [hw, 50, hd], [2, 0, 2])) continue;
        if (inRound([x, C(j), z], [-hw + 1.6, -50, -hd + 1.6], [hw - 1.6, 50, hd - 1.6], [1, 0, 1]) && j < 21) continue;
        const part = onHips || j >= 18 ? 'hips' : x > 0 ? 'upperLegL' : 'upperLegR';
        vox.set(part, i, j, k, trim && j < low + 2 ? trim : j === low + 2 ? `${colour}Shade` : colour);
      }
    }
}

// ---------------------------------------------------------------------------------------------
// The cultist: a hooded zealot in a crimson robe trimmed with gold, embers for eyes, a staff
// topped with a blood-red crystal (it glows hot when it chants).

export function cultist() {
  const look = { build: 'slim', skin: '#c9b6a6', hair: 'bald', face: 'glow', eyes: '#ff3a2a', top: 'tunic', topColor: '#6a0f16', bottom: 'trousers', bottomColor: '#2a0a0e', shoes: 'boots', shoeColor: '#1e1416' };
  const { vox, palette: P, joints: J, skeleton, wear } = person(look);
  P.add('cowl', 0x5e0d14, { rough: 0.9, vary: 0.05 });
  P.add('cowlShade', 0x400810, { rough: 0.9 });
  P.add('robe', 0x6e1018, { rough: 0.88, vary: 0.05 });
  P.add('robeShade', 0x4a0a10, { rough: 0.88 });
  P.add('trim', 0xd0a038, { rough: 0.3, metal: 1 });
  P.add('shadow', 0x120608, { rough: 0.9 });
  P.add('staff', 0x6a4426, { rough: 0.7 });
  P.add('crystal', 0xff2a3a, { rough: 0.1, glow: 1 });
  P.add('rope', 0xb08850, { rough: 0.9 });
  P.add('bone', 0xe6dcc6, { rough: 0.5 });
  hood(vox, 'cowl');
  // Under a robe to the ground, no shins or feet show.
  for (const side of ['L', 'R']) for (const part of [`lowerLeg${side}`, `foot${side}`]) vox.parts.get(part).clear();
  robe(vox, 'robe', { bottom: 1, flare: 3.2, trim: 'trim' });
  // A stole down the front, gold-edged, and a rope belt.
  for (const part of ['chest', 'spine', 'hips']) coat(vox, part, (i, j, k) => (k >= 3 && Math.abs(C(i)) < 3 ? (Math.abs(C(i)) > 2 ? 'trim' : 'robe') : null), (p) => p[1] < 34);
  for (let i = -8; i < 8; i++) for (let k = -6; k < 6; k++) if (Math.abs(Math.hypot(C(i) / 7.6, C(k) / 5.4) - 1) < 0.12) vox.set('hips', i, 21, k, 'rope');
  for (const j of [17, 18, 19, 20]) vox.set('hips', 3, j, 5, 'rope');
  // Sleeves wide at the cuff.
  for (const [side, m] of [['L', 1], ['R', -1]]) {
    const L = J[`lowerArm${side}`];
    fill(vox, `lowerArm${side}`, [L[0] - 3.2, 18.5, -3.2], [L[0] + 3.2, 21.5, 3.2], (i, j) => (j === 18 ? 'trim' : 'robe'), (p) => Math.hypot(p[0] - L[0], p[2]) < 3.3);
    void m;
  }
  // The staff, upright through the right fist, a crystal in a claw of bone at its head.
  const g = J.gripR;
  const at = (x, y, z, c) => vox.set('handR', Math.floor(g[0] + x), Math.floor(g[1] + y), Math.floor(g[2] + z), c);
  // (Through the front of the fist, ahead of the forearm.)
  for (let y = -8; y < 30; y++) for (const [x, z] of [[0, 2], [-1, 2], [0, 3], [-1, 3]]) at(x, y, z, y % 7 === 0 ? 'trim' : 'staff');
  for (const [x, z] of [[-2, 2], [1, 2], [-1, 1], [0, 4], [-2, 3], [1, 3]]) for (let y = 28; y < 33; y++) at(x + (y > 30 ? (x > 0 ? 1 : x < -1 ? -1 : 0) : 0), y, z, 'trim');
  ball(vox, 'handR', [g[0] - 0.5, g[1] + 35, g[2] + 3], [2.6, 3.8, 2.6], 'crystal');
  return { vox, palette: P, skeleton, extras: { wear }, rigid: TRUNK };
}

// ---------------------------------------------------------------------------------------------
// The imp: a little red devil, horned and winged, with a spade-tipped tail, a ball of fire
// cupped in its right hand.

export function imp() {
  const look = { build: 'slim', skin: '#c63a26', hair: 'bald', face: 'glow', eyes: '#ffe14a', top: 'tank', topColor: '#c63a26', bottom: 'shorts', bottomColor: '#2a1410', shoes: 'boots', shoeColor: '#1a0e0c' };
  const { vox, palette: P, joints: J, skeleton, wear } = person(look);
  P.add('horn', 0x2a1a14, { rough: 0.4 });
  P.add('hornTip', 0xe8d8b0, { rough: 0.4 });
  P.add('wing', 0x6a1410, { rough: 0.7, vary: 0.05 });
  P.add('wingBone', 0x3a0c08, { rough: 0.6 });
  P.add('fire', 0xffa020, { rough: 0.2, glow: 1 });
  P.add('fireCore', 0xfff0a0, { rough: 0.2, glow: 1 });
  P.add('fang', 0xf4ecd8, { rough: 0.4 });
  // The tank top is its own red skin: no clothes but a loincloth.
  for (const part of ['chest', 'spine']) vox.recolour(part, (i, j, k, c) => (c.startsWith('top') ? 'skin' : undefined));
  for (const s of ['L', 'R']) for (const p of [`upperArm${s}`, `lowerArm${s}`]) vox.recolour(p, (i, j, k, c) => (c.startsWith('top') ? 'skin' : undefined));
  // Horns sweeping out from the temples and curling up, long pointed ears, a fanged grin.
  for (const m of [1, -1]) {
    let p = [m * 4, 46.5, 1.5];
    for (let t = 0; t < 10; t++) {
      const a = t / 9;
      const q = [m * (4 + Math.sin(a * 2.2) * 6), 46.5 + a * a * 9 + a * 1.5, 1.5 - a * 4];
      capsule(vox, 'head', p, q, 2.3 - a * 1.5, 2.3 - Math.min(1, a + 0.11) * 1.5, a > 0.75 ? 'hornTip' : 'horn');
      p = q;
    }
    capsule(vox, 'head', [m * 6, 42, 0], [m * 11, 45.5, -2], 1.6, 0.4, 'skin');
    vox.set('head', m > 0 ? 2 : -3, 37, 4, 'fang');
  }
  for (let i = -3; i < 3; i++) vox.set('head', i, 38, 4, i === -3 || i === 2 ? 'skinShade' : 'mouth');
  // Bat wings from the shoulder blades, spread up and back: bones and a membrane between them.
  for (const m of [1, -1]) {
    const root = [m * 2.5, 31, -4];
    const tips = [[m * 20, 42, -9], [m * 22, 33, -10], [m * 18, 24, -9], [m * 11, 21, -7]];
    for (let n = 0; n < tips.length - 1; n++) {
      const a = tips[n], b = tips[n + 1];
      // The membrane: the triangle root, a, b, a voxel thick, its edge scalloped.
      for (let u = 0; u <= 1; u += 0.025)
        for (let v = 0; v <= 1 - u; v += 0.025) {
          const q = [0, 1, 2].map((x) => root[x] + (a[x] - root[x]) * u + (b[x] - root[x]) * v);
          if (u + v > 0.93 && Math.sin((v / (u + v + 1e-6)) * Math.PI) > 0.4) continue;
          vox.set('chest', Math.floor(q[0]), Math.floor(q[1]), Math.floor(q[2]), 'wing');
        }
    }
    for (const t of tips) capsule(vox, 'chest', root, t, 0.9, 0.5, 'wingBone');
  }
  // The tail: down and back from the seat, curling up, a spade at its tip.
  let p = [0, 18, -4];
  for (let t = 0; t < 12; t++) {
    const a = t / 11;
    const q = [Math.sin(a * 3) * 2.5, 18 - Math.sin(a * Math.PI) * 9 + a * 4, -4 - a * 13];
    capsule(vox, 'hips', p, q, 1.1, 1, 'skin');
    p = q;
  }
  fill(vox, 'hips', [p[0] - 3, p[1] - 1, p[2] - 4], [p[0] + 3, p[1] + 1, p[2] + 1], 'horn', (q) => Math.abs(q[0] - p[0]) < 3 - Math.abs(q[2] - p[2] + 1.5) * 0.9);
  // A ball of fire in the right fist.
  const g = J.gripR;
  ball(vox, 'handR', [g[0] - 0.5, g[1] - 1, g[2] + 4], [2.6, 2.6, 2.6], (i, j, k, d) => (d < 0.35 ? 'fireCore' : 'fire'));
  return { vox, palette: P, skeleton, extras: { wear }, rigid: TRUNK };
}

// ---------------------------------------------------------------------------------------------
// The minotaur: a bull-headed brute in a leather harness, a shaggy mane, horns sweeping forward,
// a gold ring through its nose, hooves, and a great double axe.

export function minotaur() {
  const look = { build: 'heavy', skin: '#6e4a30', hair: 'bald', face: 'glow', eyes: '#ff4a2a', top: 'tank', topColor: '#6e4a30', bottom: 'shorts', bottomColor: '#3a2416', shoes: 'boots', shoeColor: '#2a2420' };
  const { vox, palette: P, joints: J, skeleton, wear } = person(look);
  P.add('fur', 0x6e4a30, { rough: 0.95, vary: 0.07 });
  P.add('furDark', 0x4a301e, { rough: 0.95, vary: 0.07 });
  P.add('muzzle', 0x86604a, { rough: 0.6 });
  P.add('nostril', 0x1e120c, { rough: 0.6 });
  P.add('horn', 0xe8dcbc, { rough: 0.35 });
  P.add('hornTip', 0x3a2c22, { rough: 0.35 });
  P.add('ring', 0xe0b83a, { rough: 0.2, metal: 1 });
  P.add('strap', 0x3a2416, { rough: 0.5 });
  P.add('buckle', 0xc8ccd2, { rough: 0.25, metal: 1 });
  P.add('hoof', 0x26201c, { rough: 0.4 });
  P.add('iron', 0x8a929c, { rough: 0.3, metal: 0.9 });
  P.add('edge', 0xd8dee6, { rough: 0.2, metal: 1 });
  P.add('haft', 0x5a3a22, { rough: 0.7 });
  P.add('glowEye', 0xff4a2a, { rough: 0.2, glow: 1 });
  // Its hide: the tank top and arms are its own fur.
  for (const part of ['chest', 'spine', 'upperArmL', 'upperArmR', 'lowerArmL', 'lowerArmR']) vox.recolour(part, (i, j, k, c) => (c.startsWith('top') ? 'fur' : undefined));
  // The bull's head: a broad skull, a long muzzle, a ring through the nose, small burning eyes,
  // ears out to the sides and horns sweeping out and forward.
  vox.parts.get('head').clear();
  vox.parts.get('neck').clear();
  fill(vox, 'head', [-7, 35, -6], [7, 48, 6], (i, j, k) => (hash(i, j, k, 2) < 0.3 ? 'furDark' : 'fur'), (p) => inRound(p, [-7, 35, -6], [7, 48, 6], [2.5, 2.5, 2.5]));
  // The muzzle narrows toward the nose, two nostrils low on its end.
  fill(vox, 'head', [-4.5, 35.5, 4], [4.5, 43, 12], (i, j, k) => (k >= 11 && j === 38 && Math.abs(C(i)) > 1 && Math.abs(C(i)) < 2.6 ? 'nostril' : 'muzzle'), (p) => inRound(p, [-4.5 + (p[2] - 4) * 0.12, 35.5, 4], [4.5 - (p[2] - 4) * 0.12, 43 - (p[2] - 4) * 0.25, 12], [1.5, 1.5, 1.5]));
  for (const m of [1, -1]) {
    for (const [dx, dy] of [[0, 0], [0, 1]]) vox.set('head', (m > 0 ? 5 : -6) + dx, 44 + dy, 5, 'glowEye');
    vox.set('head', m > 0 ? 4 : -5, 46, 5, 'furDark');
    vox.set('head', m > 0 ? 5 : -6, 46, 5, 'furDark');
    capsule(vox, 'head', [m * 6.5, 44.5, 0], [m * 10.5, 43.5, -1.5], 1.4, 0.7, 'furDark');
    // A horn: out from the temple, curving forward and up.
    let p = [m * 5.5, 46.5, 1];
    for (let t = 0; t < 10; t++) {
      const a = t / 9;
      const q = [m * (5.5 + Math.sin(a * 2.1) * 8.5), 46.5 + a * a * 6, 1 + Math.max(0, a - 0.35) * 11];
      capsule(vox, 'head', p, q, 2.4 - a * 1.6, 2.4 - Math.min(1, a + 0.11) * 1.6, a > 0.82 ? 'hornTip' : 'horn');
      p = q;
    }
  }
  for (let i = -2; i < 2; i++) vox.set('head', i, 36, 12, 'ring');
  for (const i of [-3, 2]) vox.set('head', i, 37, 12, 'ring');
  // A shaggy mane over its neck and shoulders.
  coat(vox, 'chest', (i, j, k) => (hash(i, j, k, 8) < 0.5 ? 'furDark' : 'fur'), (p) => p[1] > 31 && (p[2] < 1 || Math.abs(p[0]) < 4.5));
  // A leather harness across its chest, a buckle where the straps cross.
  for (const part of ['chest', 'spine']) {
    vox.recolour(part, (i, j, k, c) => {
      if (c !== 'fur' && c !== 'furDark') return;
      const x = C(i), y = C(j) - 22;
      if (Math.abs(Math.abs(x) - (y - 1) * 0.55) < 0.9 && y > 0 && y < 12) return Math.abs(x) < 1.2 && y < 4 ? 'buckle' : 'strap';
    });
  }
  // Hooves, cloven.
  for (const side of ['L', 'R']) vox.recolour(`foot${side}`, (i, j, k) => (k === 3 && (i === 3 || i === -4) ? false : 'hoof'));
  // The labrys: a haft through the front of the right fist, two crescent blades at its head.
  const g = J.gripR;
  const at = (x, y, z, c) => vox.set('handR', Math.floor(g[0] + x), Math.floor(g[1] + y), Math.floor(g[2] + z), c);
  for (let y = -10; y < 16; y++) for (const [x, z] of [[0, 2], [-1, 2], [0, 3], [-1, 3]]) at(x, y, z, y === -10 || y === 15 ? 'iron' : 'haft');
  for (const side of [1, -1]) {
    for (let d = 1; d < 10; d++) {
      const half = 2 + d * 0.7 - Math.max(0, d - 7) * 1.6;
      for (let y = Math.round(10 - half); y < Math.round(10 + half); y++) for (const x of [0, -1]) at(x, y, side > 0 ? 3 + d : 2 - d, d > 7 ? 'edge' : 'iron');
    }
  }
  return { vox, palette: P, skeleton, extras: { wear }, rigid: TRUNK };
}

// ---------------------------------------------------------------------------------------------
// The wraith: a skull in a deep hood, a ragged shroud hanging from it to above the ground (no
// legs: it floats), long arms ending in bony claws, the rags' ends glowing ghost-green.

export function wraith() {
  const look = { build: 'slim', skin: '#d6e2d8', hair: 'bald', face: 'skull', eyes: '#8affd8', top: 'tunic', topColor: '#24303a', bottom: 'trousers', bottomColor: '#1a2028', shoes: 'flats', shoeColor: '#1a2028' };
  const { vox, palette: P, joints: J, skeleton, wear } = person(look);
  P.add('shroud', 0x5a706c, { rough: 0.95, vary: 0.06, glow: 0.22 });
  P.add('shroudShade', 0x3a4a48, { rough: 0.95, glow: 0.12 });
  P.add('shadow', 0x060a0c, { rough: 0.9 });
  P.add('wisp', 0x6affc8, { rough: 0.6, glow: 0.85 });
  P.add('wispDim', 0x3aa888, { rough: 0.6, glow: 0.5 });
  P.add('claw', 0xd6e2d8, { rough: 0.5 });
  // No legs: they're cleared, and the shroud hangs from the hips, ragged.
  for (const s of ['L', 'R']) for (const p of [`upperLeg${s}`, `lowerLeg${s}`, `foot${s}`]) vox.parts.get(p).clear();
  // Its skull keeps its face, set back in the hood's shadow.
  const head = vox.parts.get('head');
  hood(vox, 'shroud', { peak: true });
  for (const [key, c] of [...head]) if (c === 'shadow') head.delete(key);
  skullOf(vox, look);
  robe(vox, 'shroud', {
    bottom: 5,
    flare: 4.5,
    onHips: true,
    hem: (i, k) => (hash(i >> 1, 0, k >> 1, 9) < 0.5 ? 5 : 9),
  });
  vox.recolour('hips', (i, j, k, c) => {
    if (c !== 'shroud' && c !== 'shroudShade') return;
    let low = 99;
    for (let y = 0; y < 23; y++) if (vox.get('hips', i, y, k)) {
      low = y;
      break;
    }
    return j < low + 2 ? (j === low ? 'wisp' : 'wispDim') : undefined;
  });
  for (const part of ['chest', 'spine']) coat(vox, part, 'shroud', (p) => p[1] < 33);
  for (const part of ['hips', 'spine']) vox.recolour(part, (i, j, k, c) => (c === 'belt' || c === 'buckle' ? 'shroudShade' : undefined));
  // Long sleeves in tatters, the claws out of them.
  for (const [side] of [['L'], ['R']]) {
    for (const part of [`upperArm${side}`, `lowerArm${side}`]) {
      vox.recolour(part, () => 'shroud');
      coat(vox, part, (i, j, k) => (hash(i, j, k, 4) < 0.25 ? null : 'shroud'), (p) => p[1] > 17);
    }
    const h = J[`hand${side}`];
    vox.parts.get(`hand${side}`).clear();
    for (const dx of [-1.5, 0, 1.5]) capsule(vox, `hand${side}`, [h[0] + dx * 0.6, 19, h[2]], [h[0] + dx, 11, h[2] + 2.5], 0.75, 0.4, 'claw');
    vox.recolour(`lowerArm${side}`, (i, j, k, c) => (j <= 20 && hash(i, j, k, 2) < 0.5 ? 'wispDim' : undefined));
  }
  return { vox, palette: P, skeleton, extras: { wear }, rigid: TRUNK };
}

/** A skull's face (the platform's, with eyes that glow) put back on a head a hood has emptied. */
function skullOf(vox, look) {
  const { vox: v } = characterVoxels({ ...PLAIN_LOOK, ...look });
  for (const [key, c] of v.parts.get('head')) {
    const k = Math.floor(key / 1048576) - 512;
    if (k > -6) vox.parts.get('head').set(key, c);
  }
}

// ---------------------------------------------------------------------------------------------
// The golem: three metres of fitted stone on the humanoid rig, at half the people's resolution (13
// voxels a metre: it's built of blocks), its own proportions (a great chest, a small head sunk
// between its shoulders, arms to its knees ending in boulder fists, short thick legs), moss on its
// shoulders, amber runes and eyes that blaze before it pounds.

const GOLEM_JOINTS = {
  hips: [0, 15, 0],
  spine: [0, 17.5, 0],
  chest: [0, 21, 0],
  neck: [0, 31, 1.5],
  head: [0, 31.5, 2],
  upperArmL: [9.5, 30, 0],
  lowerArmL: [10.5, 22.5, 0.5],
  handL: [11, 15.5, 1],
  gripL: [11, 12, 1],
  upperLegL: [4, 14.5, 0],
  lowerLegL: [4.25, 8, 0.5],
  footL: [4.5, 3, 0.5],
};
for (const [k, v] of Object.entries(GOLEM_JOINTS)) if (k.endsWith('L')) GOLEM_JOINTS[`${k.slice(0, -1)}R`] = [-v[0], v[1], v[2]];

export function golem() {
  const vox = new Voxels();
  const P = new Palette();
  P.add('stone', 0x8c867a, { rough: 0.9, vary: 0.05 });
  P.add('stoneDark', 0x6c675e, { rough: 0.92, vary: 0.05 });
  P.add('stoneLight', 0xa29c8e, { rough: 0.9, vary: 0.05 });
  P.add('moss', 0x5c7c34, { rough: 0.95, vary: 0.08 });
  P.add('rune', 0xffa83a, { rough: 0.4, glow: 1 });
  P.add('eye', 0xffd24a, { rough: 0.2, glow: 1 });
  P.add('shadow', 0x2a2724, { rough: 0.95 });
  const J = GOLEM_JOINTS;
  // Stone in blocks of two voxels each way, each block its own shade; moss on what faces up.
  const stone = (i, j, k) => {
    const h = hash(i >> 1, j >> 1, k >> 1, 1);
    if (h < 0.1 && !vox.filled(i, j + 1, k)) return 'moss';
    return h < 0.42 ? 'stoneDark' : h < 0.8 ? 'stone' : 'stoneLight';
  };
  fill(vox, 'hips', [-6, 11, -4], [6, 17.5, 4], stone, (p) => inRound(p, [-6, 11, -4], [6, 17.5, 4], 1.5));
  fill(vox, 'spine', [-6.5, 16, -4.5], [6.5, 22, 4.5], stone, (p) => inRound(p, [-6.5, 15, -4.5], [6.5, 23, 4.5], 1.8));
  fill(vox, 'chest', [-9, 21, -5], [9, 32, 5.5], stone, (p) => inRound(p, [-9, 19, -5], [9, 32, 5.5], [2.5, 2, 2]));
  // A rune on its chest, and lines of it down the forearms.
  vox.recolour('chest', (i, j, k) => {
    if (k < 5) return;
    const x = Math.abs(C(i)), y = C(j) - 26.5;
    if ((Math.abs(x - 1.5) < 0.6 && Math.abs(y) < 2.6) || (Math.abs(y - 2) < 0.6 && x < 2) || (Math.abs(y + 0.5) < 0.6 && x < 3)) return 'rune';
  });
  // The head: small, sunk forward between the shoulders, a heavy brow over two blazing eyes.
  fill(vox, 'head', [-3, 29.5, -1], [3, 35, 6], stone, (p) => inRound(p, [-3, 29.5, -1], [3, 35, 6], 1.2));
  fill(vox, 'head', [-3.5, 33, 3], [3.5, 34.5, 6.5], 'stoneDark');
  for (const i of [1, -2]) vox.set('head', i, 32, 5, 'eye');
  for (const i of [-1, 0]) vox.set('head', i, 32, 5, 'shadow');
  // Arms: a boulder for a shoulder, thick limbs, huge fists.
  for (const [side, m] of [['L', 1], ['R', -1]]) {
    const u = J[`upperArm${side}`], l = J[`lowerArm${side}`], h = J[`hand${side}`];
    ball(vox, `upperArm${side}`, [u[0], u[1] + 0.5, u[2]], [4.2, 4, 4.2], stone);
    capsule(vox, `upperArm${side}`, u, l, 2.8, 2.6, stone);
    capsule(vox, `lowerArm${side}`, l, h, 2.7, 3.1, stone);
    vox.recolour(`lowerArm${side}`, (i, j, k) => (Math.abs(C(i) - l[0] - m * 0.5) < 0.7 && k >= 2 && j % 3 < 2 && j < 22 ? 'rune' : undefined));
    fill(vox, `hand${side}`, [h[0] - 3.5, h[1] - 6.5, h[2] - 3.5], [h[0] + 3.5, h[1] + 0.5, h[2] + 3.5], stone, (p) => inRound(p, [h[0] - 3.5, h[1] - 6.5, h[2] - 3.5], [h[0] + 3.5, h[1] + 0.5, h[2] + 3.5], 1.4));
    // Legs: thick, a broad foot.
    const ul = J[`upperLeg${side}`], ll = J[`lowerLeg${side}`], f = J[`foot${side}`];
    capsule(vox, `upperLeg${side}`, ul, ll, 3.3, 3, stone);
    capsule(vox, `lowerLeg${side}`, ll, [f[0], f[1] + 0.5, f[2]], 3, 3.3, stone);
    fill(vox, `foot${side}`, [f[0] - 3.5, 0, f[2] - 3.5], [f[0] + 3.5, f[1] + 1, f[2] + 5], stone, (p) => inRound(p, [f[0] - 3.5, -2, f[2] - 3.5], [f[0] + 3.5, f[1] + 1, f[2] + 5], [1.2, 0, 1.2]));
    bury(vox, `upperArm${side}`, 'chest');
  }
  // Moss hanging over the shoulders.
  for (const m of [1, -1]) for (let n = 0; n < 6; n++) {
    const i = Math.floor(m * (6 + n));
    const len = 1 + Math.floor(hash(i, 0, 0, 6) * 3);
    for (let j = 0; j < len; j++) vox.set(n < 3 ? 'chest' : `upperArm${m > 0 ? 'L' : 'R'}`, i, 31 - j, 5, 'moss');
  }
  return { vox, palette: P, skeleton: skeletonOf(J), rigid: TRUNK, scale: 13 };
}
