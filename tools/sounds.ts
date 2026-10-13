/**
 * Development: Blockfront's sounds on a board (`/tools/sounds.html`), to hear each one (here, or
 * off at a distance to one side, through the game's acoustics) and short scenes of them together
 * (a burst of fire, a saber duel, a far firefight), in each version there is (`sounds-lib.ts`).
 *
 * For checks by script: `await __sounds.wav(version, what, seconds, { dist, side })` renders a
 * scene (or a sound, by name) offline and returns a 16-bit WAV as base64.
 */
import { GROUPS, SCENES, VERSIONS, playLive, renderWav } from './sounds-lib';

const $ = (id: string) => document.getElementById(id) as HTMLSelectElement;
for (const v of VERSIONS) $('bank').append(new Option(v.name, v.name));
const version = () => VERSIONS.find((v) => v.name === $('bank').value) ?? VERSIONS[0];
const play = (what: string) => playLive(version(), what, Number($('dist').value), Number($('side').value));

const main = document.getElementById('main')!;
function group(title: string, note?: string) {
  const sec = document.createElement('section');
  sec.innerHTML = `<h2>${title}</h2><div class="row"></div>${note ? `<p class="note">${note}</p>` : ''}`;
  main.append(sec);
  return sec.querySelector('.row')!;
}
function button(row: Element, label: string, what: string, title = '') {
  const b = document.createElement('button');
  b.textContent = label;
  b.title = title;
  b.onclick = () => play(what);
  row.append(b);
}
const scenes = group('Scenes', 'Played together as they would in a match. “before” hums its blades as one-shots, as the first cut did.');
for (const [name, sc] of Object.entries(SCENES)) button(scenes, name, name, sc.note);
for (const [title, names] of Object.entries(GROUPS)) {
  const row = group(title);
  for (const n of names) button(row, n, n);
}

(window as unknown as { __sounds: unknown }).__sounds = {
  versions: VERSIONS.map((v) => v.name),
  scenes: Object.keys(SCENES),
  groups: GROUPS,
  wav: (versionName: string, what: string, seconds?: number, o?: { dist?: number; side?: number }) => renderWav(VERSIONS.find((x) => x.name === versionName) ?? VERSIONS[0], what, seconds, o),
};
