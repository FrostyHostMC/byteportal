import { BONES, buildCharacter } from '../../src/platform/character/build';
import { PLAIN_LOOK, STYLES, characterLook, characterUrl, type CharacterLook } from '../../src/platform/character/look';
import { check } from './_harness';

/**
 * The platform's characters: every style of every part builds a figure on the rig inside the
 * fighters' budgets (triangles, height, every bone dressed), quickly; a look's model address
 * round-trips.
 */
export default function characters() {
  const looks: CharacterLook[] = [{}];
  for (const [field, options] of Object.entries(STYLES)) for (const v of options) looks.push({ [field]: v });
  for (const build of STYLES.build) looks.push({ build, curvy: true, top: 'suit', bottom: 'skirt', hair: 'long', face: 'lipstick' });
  looks.push({ ragged: true, face: 'glow', eyes: '#ff3020', skin: '#7a9a5a' });
  looks.push({ hatHair: true, hair: 'afro' }, { hatHair: true, hair: 'pomp' });
  let worst = 0;
  let most = 0;
  const t0 = performance.now();
  for (const look of looks) {
    const t = performance.now();
    const m = buildCharacter(look);
    worst = Math.max(worst, performance.now() - t);
    const tris = m.index.length / 3;
    most = Math.max(most, tris);
    let lo = Infinity;
    let hi = -Infinity;
    for (let i = 1; i < m.position.length; i += 3) (lo = Math.min(lo, m.position[i])), (hi = Math.max(hi, m.position[i]));
    const bones = new Set(m.bone);
    const what = JSON.stringify(look);
    check(tris > 2000 && tris <= 25000, `${what}: ${tris} triangles`);
    check(Math.abs(lo) < 1e-6 && hi > 1.7 && hi < 2.3, `${what}: ${lo.toFixed(2)}..${hi.toFixed(2)} m tall`);
    check(bones.size === BONES.length, `${what}: every bone has a part (${bones.size} of ${BONES.length})`);
    check(m.atlas.height <= 256 && m.atlas.albedo.length === m.atlas.width * m.atlas.height * 4, `${what}: its atlas`);
    check(m.joints.head[1] > 1.3 && m.joints.gripR[1] < m.joints.handR[1], `${what}: its joints`);
  }
  const each = (performance.now() - t0) / looks.length;
  check(each < 150, `${looks.length} characters built in ${each.toFixed(1)} ms each`);
  const look: CharacterLook = { build: 'heavy', hair: 'afro', hairColor: '#E0709E', top: 'aloha', accent: '#ff5c8a' };
  const url = characterUrl(look);
  const back = characterLook(url)!;
  check(url.startsWith('character:') && back.build === 'heavy' && back.hair === 'afro' && back.hairColor === '#e0709e' && back.top === 'aloha' && back.bottom === PLAIN_LOOK.bottom, `a look's address round-trips: ${url}`);
  check(characterUrl({}) === 'character:' && characterUrl({ hair: 'nonsense' as 'bald', skin: 'red' }) === 'character:', 'the plain look, and nonsense left out');
  check(characterLook('/models/x.glb') === null, "a file's address isn't a character's");
  console.log(`  characters: ${looks.length} looks, at most ${most} triangles, ${each.toFixed(1)} ms each (slowest ${worst.toFixed(1)} ms)`);
}
