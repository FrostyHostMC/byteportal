import { AutoQuality } from '../../src/platform/quality';
import type { Settings } from '../../src/platform/settings';
import { check } from './_harness';

const MAX: Settings = { renderDistance: 12, shadows: 'ultra', msaa: true, bloom: true, godrays: true, ssr: true, clouds: true, renderScale: 1, fov: 75, sensitivity: 1, stickSensitivity: 1, invertY: false,
  touchSensitivity: 1, vibration: true, aimAssist: true, viewBobbing: true, dayMinutes: 20, occlusion: true, autoQuality: true, keys: {}, volume: 1, music: 0.7 };

/** Play `seconds` of frames, each lasting what `ms(level)` says; returns the levels it went through. */
function run(q: AutoQuality, seconds: number, ms: (level: number) => number): number[] {
  const levels = [q.level];
  for (let t = 0; t < seconds; ) {
    const f = ms(q.level);
    t += f / 1000;
    if (q.frame(f)) levels.push(q.level);
  }
  return levels;
}

/**
 * Auto quality: down a notch at a time while frames are slow (two when far too slow), up again
 * when there's room (waiting longer after a try that was too much), and notches that buy nothing
 * are undone (a browser capped at 30 fps isn't the graphics' fault). The player's settings are
 * the most it shows; at the bottom a retina screen is drawn at one pixel per point.
 */
export default function quality() {
  // A slow graphics chip: 50 ms a frame (20 fps) at full settings, each notch 15% cheaper. It settles
  // where frames make about 45 fps or better, and stays there.
  const gpu = new AutoQuality();
  gpu.reset();
  const cost = (l: number) => 50 * 0.85 ** l;
  const went = run(gpu, 60, cost);
  check(cost(gpu.level) <= 22 && cost(gpu.level - 1) > 17.5, `a slow chip settles where it keeps up: level ${gpu.level} (${cost(gpu.level).toFixed(1)} ms), via ${went.join(' → ')}`);
  check(went[1] === 2, `far too slow at first: two notches at once (${went[1]})`);
  const settled = gpu.level;
  run(gpu, 120, cost);
  check(gpu.level >= settled - 1 && gpu.level <= settled + 1, `and stays about there (${gpu.level})`);

  // What the notches do: never above the player's own settings; everything off and one pixel per point at the bottom.
  const top = gpu.apply(MAX, 2);
  gpu.reset(AutoQuality.notches);
  const bottom = gpu.apply(MAX, 2);
  check(bottom.dpr === 1 && !bottom.settings.msaa && !bottom.settings.bloom && !bottom.settings.ssr && !bottom.settings.godrays && bottom.settings.shadows === 'off' && bottom.settings.renderScale <= 0.6, `the bottom notch: ${JSON.stringify({ ...bottom.settings, dpr: bottom.dpr })}`);
  gpu.reset();
  check(JSON.stringify(gpu.apply(MAX, 2)) === JSON.stringify({ settings: MAX, dpr: 2 }) && top.settings.renderScale <= 1, 'at the top it is the player’s settings');
  const low = { ...MAX, msaa: false, renderScale: 0.5, shadows: 'low' as const };
  gpu.reset(3);
  const lowLook = gpu.apply(low, 1);
  check(lowLook.settings.renderScale === 0.5 && lowLook.settings.shadows === 'low', 'notches never raise what the player set lower');
  gpu.enabled = false;
  check(JSON.stringify(gpu.apply(MAX, 2).settings) === JSON.stringify(MAX), 'switched off: the settings as they are');

  // A browser capped at 30 fps: the frame time doesn't move whatever the level. It tries a few
  // notches, sees they bought nothing, puts them back and leaves the picture alone.
  const capped = new AutoQuality();
  capped.reset();
  const cappedWent = run(capped, 90, () => 33.4);
  check(capped.level === 0 && Math.max(...cappedWent) > 0, `capped at 30: tried ${Math.max(...cappedWent)} notches, back to ${capped.level} (${cappedWent.join(' → ')})`);

  // A machine with room to spare starting low (last time's level, or a heavy scene that passed):
  // it climbs back to the player's settings.
  const room = new AutoQuality();
  room.reset(6);
  run(room, 120, () => 12);
  check(room.level === 0, `room to spare: back up to the top (${room.level})`);

  // A try up that's too much goes back down, and the next try waits longer.
  const edge = new AutoQuality();
  edge.reset(4);
  const edgeWent = run(edge, 300, (l) => (l >= 4 ? 16 : 26));
  const ups = edgeWent.filter((l, i) => i > 0 && l < edgeWent[i - 1]).length;
  check(edge.level === 4 && ups >= 2 && ups <= 6, `on the edge: ${ups} tries up in five minutes, back at ${edge.level}`);
  console.log(`  settles at ${settled} on a slow chip · capped browser left alone · climbs back with room · ${ups} tries up in 5 min on the edge`);
}
