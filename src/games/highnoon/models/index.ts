import stranger from './cowboys/stranger.glb?url';
import sheriff from './cowboys/sheriff.glb?url';
import outlaw from './cowboys/outlaw.glb?url';
import gambler from './cowboys/gambler.glb?url';
import rancher from './cowboys/rancher.glb?url';
import bandita from './cowboys/bandita.glb?url';

/**
 * The gunslingers (GLB, written by `src/games/highnoon/tools/build.mjs`: the platform's humanoid
 * rig, rigid parts, clips `tip_hat`, `victory` and `standoff`). `look` is their colours for the
 * HUD's little portraits (the wanted poster, the outfit picker): the same as the tool's palette.
 */
export interface Cowboy {
  id: string;
  name: string;
  url: string;
  look: { hat: string; shirt: string; pants: string; skin: string };
}

export const COWBOYS: Cowboy[] = [
  { id: 'stranger', name: 'The Stranger', url: stranger, look: { hat: '#6d6660', shirt: '#8f6a3e', pants: '#5b4431', skin: '#b77a52' } },
  { id: 'sheriff', name: 'The Sheriff', url: sheriff, look: { hat: '#b58a57', shirt: '#232125', pants: '#55524e', skin: '#e0ac86' } },
  { id: 'outlaw', name: 'The Outlaw', url: outlaw, look: { hat: '#1c1b1d', shirt: '#232125', pants: '#1f1f22', skin: '#e0ac86' } },
  { id: 'gambler', name: 'The Gambler', url: gambler, look: { hat: '#1c1b1d', shirt: '#5e1c24', pants: '#1f1f22', skin: '#e0ac86' } },
  { id: 'rancher', name: 'The Rancher', url: rancher, look: { hat: '#d8bd7a', shirt: '#4d6b8f', pants: '#34465e', skin: '#7a4b31' } },
  { id: 'bandita', name: 'La Bandita', url: bandita, look: { hat: '#e6ddcc', shirt: '#3f5a36', pants: '#5b4431', skin: '#b77a52' } },
];
