import type { HoleSpec } from './types';

/**
 * Blockyard Links: eighteen holes, par 72, about 6,900 yards. Written like a yardage book: yards
 * along the line of play and across it (right positive), greens by their size, tilt and where the
 * pin is. The front nine runs north and south in lanes 85 blocks apart; the back nine comes back
 * across the north of the property. `course.ts` builds the land from this.
 *
 * Headings: 0 north (-z), 90 east, 180 south. Tee positions are world blocks.
 */
export const HOLES: HoleSpec[] = [
  // 1 · The opener: a gentle par 4 bending right, bunkers left and right of the green.
  {
    name: 'First Light',
    par: 4,
    tee: [0, 20],
    heading: 0,
    yards: 395,
    bends: [[0.55, 8]],
    elevation: [
      [0, 1.5],
      [0.5, 0.5],
      [1, 1.5],
    ],
    fairway: { from: 100, widths: [[0.4, 38], [0.7, 34], [0.95, 30]] },
    green: { size: [15, 12], slope: { back: 2, right: -0.8 }, bumps: [[4, -3, 0.25, 5]], pin: [3, -2] },
    bunkers: [
      { at: [250, 18], size: [12, 5], turn: 10 },
      { green: [205, 1.5], size: [8, 4] },
      { green: [100, 1], size: [7, 3.5] },
    ],
    path: -1,
  },
  // 2 · Down off an elevated tee, a creek to decide before the green: go for it or lay up.
  {
    name: 'Mill Run',
    par: 5,
    tee: [85, -206],
    heading: 180,
    yards: 530,
    bends: [[0.6, -10]],
    elevation: [
      [0, 3],
      [0.35, 1],
      [0.7, 0],
      [1, 0.8],
    ],
    fairway: { from: 90, widths: [[0.3, 40], [0.55, 36], [0.75, 30], [0.95, 26]] },
    creek: { at: -48, width: 7, turn: 12 },
    green: { size: [14, 13], slope: { back: 1.5, right: 1.2 }, bumps: [[-5, 3, -0.3, 5], [6, -4, 0.35, 6]], pin: [-4, 4] },
    bunkers: [
      { at: [262, -18], size: [10, 5] },
      { green: [0, 1], size: [9, 3.5] },
      { green: [250, 1.5], size: [7, 4] },
    ],
    path: 1,
  },
  // 3 · A short par 3 down the hill, a pond short and right.
  {
    name: 'Kettle',
    par: 3,
    tee: [170, 95],
    heading: 0,
    yards: 165,
    elevation: [
      [0, 3.5],
      [1, 0.5],
    ],
    green: { size: [13, 11], slope: { back: 2.5, right: 0 }, bumps: [[0, 0, 0.35, 5]], pin: [-3, -2] },
    ponds: [{ green: [150, 2], size: [12, 7] }],
    bunkers: [{ green: [300, 1], size: [7, 3.5] }],
    path: -1,
    woods: 0.8,
  },
  // 4 · Uphill, doglegging left round a stand of trees, to a green that runs back to front.
  {
    name: 'The Climb',
    par: 4,
    tee: [255, 0],
    heading: 0,
    yards: 420,
    bends: [[0.5, -12]],
    elevation: [
      [0, 0.5],
      [0.5, 1.5],
      [1, 2.5],
    ],
    fairway: { from: 110, widths: [[0.35, 36], [0.6, 30], [0.9, 28]] },
    green: { size: [16, 11], turn: 20, slope: { back: 3, right: -1.5 }, bumps: [[5, 2, 0.3, 5]], pin: [5, 2] },
    bunkers: [
      { at: [245, -15], size: [11, 5], turn: -20 },
      { green: [180, 1], size: [9, 3.5] },
      { green: [90, 1.5], size: [6, 3.5] },
    ],
    trees: [{ at: [225, -32], count: 6, spread: 10 }],
    path: 1,
  },
  // 5 · A pond all down the left; the green tilts toward it.
  {
    name: 'Lakeside',
    par: 4,
    tee: [330, -245],
    heading: 180,
    yards: 360,
    elevation: [
      [0, 1],
      [1, 0],
    ],
    fairway: { from: 80, widths: [[0.3, 34], [0.8, 32]] },
    ponds: [{ at: [205, -25], size: [30, 9] }],
    green: { size: [13, 12], slope: { back: 1.2, right: 2 }, bumps: [[-3, -3, -0.25, 4]], pin: [2, 3] },
    bunkers: [
      { green: [90, 1], size: [8, 3.5] },
      { green: [220, 1], size: [7, 3.5] },
    ],
    path: 1,
  },
  // 6 · A long par 3 uphill to a wide green ringed with sand.
  {
    name: 'Sandtrap',
    par: 3,
    tee: [425, -40],
    heading: 0,
    yards: 195,
    elevation: [
      [0, 1],
      [1, 2],
    ],
    green: { size: [12, 14], slope: { back: 1.8, right: -1 }, bumps: [[0, -5, 0.3, 4]], pin: [-2, 5] },
    bunkers: [
      { green: [180, 1], size: [10, 4] },
      { green: [270, 1], size: [6, 3.5] },
      { green: [80, 1], size: [6, 3.5] },
    ],
    path: -1,
  },
  // 7 · The longest: a snaking par 5 over a brook, bunkers where the second shot lands.
  {
    name: 'Serpentine',
    par: 5,
    tee: [510, -160],
    heading: 180,
    yards: 560,
    bends: [
      [0.4, 10],
      [0.7, -12],
    ],
    elevation: [
      [0, 0],
      [0.4, 1.5],
      [0.8, 0.5],
      [1, 1],
    ],
    fairway: { from: 130, widths: [[0.35, 38], [0.55, 32], [0.75, 30], [0.95, 26]] },
    creek: { at: 105, width: 6, turn: -10 },
    green: { size: [15, 12], slope: { back: 1, right: 1.5 }, bumps: [[4, -3, -0.3, 5], [-4, 3, 0.3, 4]], pin: [-5, -3] },
    bunkers: [
      { at: [300, 16], size: [14, 5] },
      { at: [345, -17], size: [10, 4] },
      { green: [170, 2], size: [9, 4] },
      { green: [30, 1], size: [8, 3] },
    ],
    path: -1,
  },
  // 8 · Long and straight, water front right of a green that tilts toward it.
  {
    name: 'Long Pond',
    par: 4,
    tee: [595, 160],
    heading: 0,
    yards: 440,
    elevation: [
      [0, 0.5],
      [0.5, 0],
      [1, 0.5],
    ],
    fairway: { from: 110, widths: [[0.4, 36], [0.95, 30]] },
    ponds: [{ green: [125, 3], size: [14, 8] }],
    green: { size: [14, 12], slope: { back: 2.2, right: -2 }, bumps: [[3, 4, 0.3, 5]], pin: [0, -3] },
    bunkers: [
      { at: [255, -20], size: [12, 5] },
      { green: [260, 1], size: [8, 4] },
    ],
    path: -1,
  },
  // 9 · Bending right, up to a crowned green.
  {
    name: 'Turn',
    par: 4,
    tee: [680, -75],
    heading: 0,
    yards: 410,
    bends: [[0.5, 9]],
    elevation: [
      [0, 1],
      [0.5, 2],
      [1, 1.5],
    ],
    fairway: { from: 100, widths: [[0.4, 38], [0.9, 32]] },
    green: { size: [14, 13], slope: { back: 1.5, right: 1.5 }, bumps: [[0, 0, 0.3, 4]], pin: [4, -3] },
    bunkers: [
      { at: [240, -18], size: [11, 5] },
      { at: [255, 20], size: [9, 4] },
      { green: [200, 1], size: [8, 3.5] },
      { green: [150, 1], size: [6, 3] },
    ],
    path: 1,
  },
  // 10 · The back nine starts high, doglegging gently left.
  {
    name: 'Northfield',
    par: 4,
    tee: [700, -350],
    heading: 0,
    yards: 385,
    bends: [[0.55, -9]],
    elevation: [
      [0, 2],
      [0.5, 1],
      [1, 2],
    ],
    fairway: { from: 95, widths: [[0.4, 36], [0.9, 30]] },
    green: { size: [13, 12], slope: { back: 2.5, right: 1 }, bumps: [[-3, -3, -0.3, 4]], pin: [-3, 3] },
    bunkers: [
      { at: [230, 16], size: [10, 5] },
      { green: [160, 1], size: [8, 4] },
      { green: [220, 1], size: [7, 3.5] },
    ],
    path: -1,
  },
  // 11 · The island: a short par 3 to a green with water all round but the back.
  {
    name: 'The Island',
    par: 3,
    tee: [610, -560],
    heading: 180,
    yards: 150,
    elevation: [
      [0, 2.5],
      [1, 0.3],
    ],
    green: { size: [12, 12], slope: { back: 1, right: -1 }, pin: [1, 0], raise: 0.8 },
    ponds: [
      { green: [180, 0.2], size: [15, 10] },
      { green: [95, 0.4], size: [10, 6], turn: 20 },
      { green: [265, 0.4], size: [10, 6], turn: -20 },
    ],
    bunkers: [{ green: [0, 1], size: [8, 3] }],
    path: 1,
    woods: 0.5,
  },
  // 12 · A par 5 climbing to a plateau; a creek short of the green asks you to lay up or carry it.
  {
    name: 'High Meadow',
    par: 5,
    tee: [520, -470],
    heading: 0,
    yards: 515,
    bends: [
      [0.45, -8],
      [0.75, 14],
    ],
    elevation: [
      [0, 0],
      [0.4, 2],
      [0.7, 3],
      [1, 2],
    ],
    fairway: { from: 110, widths: [[0.3, 40], [0.55, 34], [0.8, 28], [0.95, 26]] },
    creek: { at: -72, width: 6, turn: 8 },
    green: { size: [12, 14], turn: -15, slope: { back: 2, right: -1.2 }, bumps: [[3, 3, 0.35, 5]], pin: [4, -4] },
    bunkers: [
      { at: [290, 18], size: [12, 5] },
      { green: [200, 1], size: [7, 3.5] },
      { green: [60, 1.5], size: [8, 3.5] },
    ],
    path: 1,
  },
  // 13 · A short par 4 you might drive, if you can find a way through the sand.
  {
    name: 'Pot Luck',
    par: 4,
    tee: [430, -760],
    heading: 180,
    yards: 345,
    bends: [[0.5, -10]],
    elevation: [
      [0, 2],
      [1, 0],
    ],
    fairway: { from: 80, widths: [[0.3, 32], [0.7, 28], [0.95, 24]] },
    green: { size: [11, 10], slope: { back: 2.6, right: 0.4 }, bumps: [[-4, -3, -0.25, 3]], pin: [3, 2] },
    bunkers: [
      { at: [200, -12], size: [9, 4] },
      { at: [215, 14], size: [9, 4] },
      { at: [255, -2], size: [6, 3] },
      { green: [180, 0.8], size: [9, 3.5] },
      { green: [270, 1], size: [6, 3] },
      { green: [90, 1], size: [6, 3] },
    ],
    path: -1,
  },
  // 14 · Water left of the landing area, then right to a green tilting away.
  {
    name: 'Heron',
    par: 4,
    tee: [345, -575],
    heading: 0,
    yards: 430,
    bends: [[0.5, 10]],
    elevation: [
      [0, 0],
      [0.5, -0.5],
      [1, 1],
    ],
    fairway: { from: 110, widths: [[0.4, 36], [0.9, 30]] },
    ponds: [{ at: [240, -23], size: [22, 9], turn: 5 }],
    green: { size: [15, 12], turn: 10, slope: { back: 1.5, right: -2 }, bumps: [[-4, 3, 0.3, 5]], pin: [-5, 3] },
    bunkers: [
      { green: [150, 1], size: [9, 4] },
      { green: [0, 1], size: [7, 3] },
    ],
    path: 1,
  },
  // 15 · A long par 3, the green guarded front and both sides.
  {
    name: 'Long Shot',
    par: 3,
    tee: [265, -815],
    heading: 180,
    yards: 210,
    elevation: [
      [0, 1],
      [1, 1.5],
    ],
    fairway: { from: 150, widths: [[0.8, 24], [1, 22]] },
    green: { size: [14, 12], slope: { back: 1.5, right: 1.5 }, bumps: [[4, -2, 0.3, 5]], pin: [3, -3] },
    bunkers: [
      { green: [180, 1], size: [10, 4] },
      { green: [90, 1], size: [7, 3.5] },
      { green: [270, 1], size: [7, 3.5] },
    ],
    path: -1,
  },
  // 16 · An S-shaped par 5 over the hill, a pond front left of the green.
  {
    name: 'Switchback',
    par: 5,
    tee: [175, -690],
    heading: 0,
    yards: 545,
    bends: [
      [0.35, -10],
      [0.7, 10],
    ],
    elevation: [
      [0, 1],
      [0.35, 3],
      [0.7, 2],
      [1, 3],
    ],
    fairway: { from: 120, widths: [[0.35, 38], [0.6, 30], [0.8, 32], [0.95, 26]] },
    ponds: [{ green: [215, 2], size: [12, 8] }],
    green: { size: [14, 13], slope: { back: 2, right: 1 }, bumps: [[-4, -4, 0.35, 5]], pin: [5, 3] },
    bunkers: [
      { at: [250, 20], size: [12, 5] },
      { at: [390, -16], size: [10, 4] },
      { green: [60, 1], size: [8, 3.5] },
    ],
    path: 1,
  },
  // 17 · Down from the hill, bending right.
  {
    name: 'Descent',
    par: 4,
    tee: [90, -990],
    heading: 180,
    yards: 400,
    bends: [[0.6, 8]],
    elevation: [
      [0, 3],
      [0.5, 1],
      [1, 1.5],
    ],
    fairway: { from: 100, widths: [[0.4, 36], [0.9, 30]] },
    green: { size: [14, 12], slope: { back: 2.2, right: -1.5 }, bumps: [[0, 3, 0.3, 4]], pin: [-3, -3] },
    bunkers: [
      { at: [235, -17], size: [11, 5] },
      { green: [200, 1], size: [8, 4] },
      { green: [100, 1.5], size: [7, 3] },
    ],
    path: -1,
  },
  // 18 · Home: a long par 4, water right of the approach, a two-tier green.
  {
    name: 'Homeward',
    par: 4,
    tee: [5, -780],
    heading: 180,
    yards: 450,
    bends: [[0.55, -8]],
    elevation: [
      [0, 2],
      [0.5, 0.5],
      [1, 2],
    ],
    fairway: { from: 110, widths: [[0.4, 38], [0.9, 30]] },
    ponds: [{ at: [-62, 24], size: [20, 8] }],
    green: { size: [16, 12], turn: -10, slope: { back: 2.5, right: 2 }, bumps: [[-4, 3, -0.3, 5], [5, -3, 0.3, 5]], pin: [4, -4] },
    bunkers: [
      { at: [260, -18], size: [12, 5] },
      { green: [220, 1], size: [8, 4] },
      { green: [300, 1], size: [7, 3] },
    ],
    path: -1,
  },
];
