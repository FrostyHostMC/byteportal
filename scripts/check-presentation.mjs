// Keeps game vocabulary out of the client's presentation core: the engine draws what client code
// and kits tell it to, and never decides a look by an item's kind or a game's words for things.
// Kits (src/platform/client-kits/) and the mechanics (the gun and throw controllers, prediction)
// may name guns and throwables; the files listed here may not.
//
//   node scripts/check-presentation.mjs
//
// In each file (comments aside) it fails on `kind ===` / `kind !==`, on a quoted string that is
// one of LITERALS, and on any identifier or string with one of WORDS in it (split at camelCase,
// snake_case, kebab-case and dots). A file that doesn't exist (yet) is skipped.
import { existsSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

/** The HUD's and effects' files: besides WORDS, they may not say HUD_WORDS either. */
const HUD_FILES = [
  'src/platform/ui/hudkit.ts',
  'src/platform/ui/hud.ts',
  'src/platform/client/api/hud.ts',
  'src/platform/client/api/scene.ts',
  'src/platform/fx/effects.ts',
  'src/platform/audio/sfx.ts',
  'src/platform/client/present.ts',
  'src/platform/client/debris.ts',
];
const FILES = [
  // First person.
  'src/platform/render/viewmodel.ts',
  'src/platform/render/viewarms.ts',
  'src/platform/client/api/view.ts',
  // Figures.
  'src/platform/client/humanoid.ts',
  'src/platform/client/entities.ts',
  'src/platform/client/figures.ts',
  'src/platform/client/avatars.ts',
  // HUD and effects.
  ...HUD_FILES,
  // Replays.
  'src/platform/client/replay.ts',
  'src/platform/client/replays.ts',
];
const LITERALS = ['gun', 'sword', 'bow', 'throw', 'axe', 'polearm', 'melee', 'throwable', 'rifle', 'pistol'];
const WORDS = ['stylename', 'stance', 'ads', 'pump', 'bolt', 'lever', 'hammer', 'scope', 'rifle', 'pistol'];
/** Names that contain a word and mean something else (CSS kept to the HUD: `scopeCss`). */
const ALLOWED = ['scopeCss'];
const HUD_WORDS = ['gun', 'guns', 'ammo', 'lethal', 'lethals', 'throwable', 'throwables', 'grenade', 'molotov', 'reticle', 'magazine', 'muzzle', 'bullet', 'bullets', 'rifle', 'sniper', 'pistol', 'shotgun', 'reload', 'reloading'];

/** The file without its comments: code, and strings as they are. */
function strip(src) {
  let out = '';
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    const n = src[i + 1];
    if (c === '/' && n === '/') {
      while (i < src.length && src[i] !== '\n') i++;
      continue;
    }
    if (c === '/' && n === '*') {
      const end = src.indexOf('*/', i + 2);
      const stop = end < 0 ? src.length : end + 2;
      // (Its lines kept, so line numbers stay the file's.)
      out += ' ' + '\n'.repeat((src.slice(i, stop).match(/\n/g) ?? []).length);
      i = stop;
      continue;
    }
    if (c === "'" || c === '"' || c === '`') {
      let j = i + 1;
      while (j < src.length && src[j] !== c) j += src[j] === '\\' ? 2 : 1;
      out += src.slice(i, j + 1);
      i = j + 1;
      continue;
    }
    out += c;
    i++;
  }
  return out;
}

/** An identifier's or string's words: `muzzleFlash` -> muzzle, flash; `gun_reload` -> gun, reload. */
const words = (s) =>
  s
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean)
    .map((w) => w.toLowerCase());

const problems = [];
for (const rel of FILES) {
  const file = join(root, rel);
  if (!existsSync(file)) continue;
  const code = strip(readFileSync(file, 'utf8'));
  const banned = HUD_FILES.includes(rel) ? [...WORDS, ...HUD_WORDS] : WORDS;
  const lines = code.split('\n');
  lines.forEach((line, i) => {
    const at = `${rel}:${i + 1}`;
    if (/\bkind\s*[!=]==/.test(line)) problems.push(`${at}: decides by an item's kind`);
    for (const m of line.matchAll(/(['"`])((?:\\.|(?!\1).)*)\1/g)) {
      if (LITERALS.includes(m[2])) problems.push(`${at}: names '${m[2]}'`);
    }
    for (const m of line.matchAll(/[A-Za-z_$][\w$]*|(['"`])((?:\\.|(?!\1).)*)\1/g)) {
      const text = m[2] ?? m[0];
      if (ALLOWED.includes(text)) continue;
      for (const w of words(text)) if (banned.includes(w)) problems.push(`${at}: '${w}' (in ${m[0].slice(0, 60)})`);
    }
  });
}

if (problems.length) {
  console.error(`Presentation check failed: the client's presentation core names game vocabulary (that belongs in a kit):\n  ${[...new Set(problems)].join('\n  ')}`);
  process.exit(1);
}
console.log(`Presentation OK: ${FILES.filter((f) => existsSync(join(root, f))).length} files of the client's presentation core name no item kinds or game words.`);
