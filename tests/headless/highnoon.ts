import type { IconRef, ItemLook, SynthVoice } from '../../src/platform';
import type { GunItem } from '../../src/platform/items';
import type { Client } from '../../src/platform/api/client';
import { soundOf } from '../../src/platform/client/present';
import { sounds } from '../../src/platform/client-kits';
import { Content } from '../../src/platform/content';
import { resolveIcon } from '../../src/platform/looks';
import type { ContentDef, HostBatch, PresentCall } from '../../src/platform/net/protocol';
import hn from '../../src/games/highnoon/client';
import { LOOKS } from '../../src/games/highnoon/client/looks';
import { matchState } from '../../src/games/highnoon/server';
import { WEAPONS } from '../../src/games/highnoon/weapons';
import { guns } from '../../src/platform/kits';
import { check, launch } from './_harness';
import type { SynthKit } from '../../src/platform/api/types';

/** A voice runs (it makes its layers without throwing), with a kit that records nothing. */
const voiceRuns = (voice: SynthVoice): boolean => {
  const kit = { pitch: 1, tone: () => {}, noise: () => {} } as unknown as SynthKit;
  try {
    voice(kit);
    return true;
  } catch {
    return false;
  }
};

/** The fields of an item that are its look (`ItemLook`): the server's guns have none. */
const LOOK_FIELDS = ['icon', 'hold', 'sounds', 'tracer', 'trail', 'drawIcon'] as const;
/** The engine's own sounds (`audio/sfx.ts`): every screen has them without a definition. */
const ENGINE_SOUNDS = ['hit', 'hurt', 'pickup', 'heal', 'wave', 'victory', 'defeat', 'spawn', 'click', 'countdown', 'lock', 'alarm'];

/**
 * High Noon (a dev game: `launch` finds those too) with the local player standing idle at their
 * mark: five bots fill Dry Gulch, wait out the standoff, draw, and shoot it out round after round
 * with the Peacemaker and the Yellowboy until one of them takes three rounds and the town. Nothing
 * may land during a standoff (the game's `damage` listener cancels it), the round and match
 * structure has to run, and the widgets have to go up.
 */
export default function highNoon() {
  const t0 = performance.now();
  const warnings: string[] = [];
  const warn = console.warn;
  console.warn = (...a: unknown[]) => (warnings.push(a.join(' ')), warn(...a));
  const h = launch('highnoon', { seed: 5, radius: 5 });
  // What the screen is sent (definitions), kept for the looks below.
  const content: ContentDef[] = [];
  const step = h.step.bind(h);
  h.step = (dt, input) => {
    const b: HostBatch = step(dt, input);
    for (const e of b.events) if (e.t === 'content') content.push(e.def);
    return b;
  };
  const g = h.ctx;
  check(g.players.length === 6, `expected 6 gunslingers (1 person + 5 bots), got ${g.players.length}`);
  let shots = 0;
  let deaths = 0;
  let heads = 0;
  let early = 0;
  let rolls = 0;
  const byWeapon = new Map<string, number>();
  g.events.on('shot', () => shots++);
  g.events.on('ability', ({ name }) => name === 'roll' && rolls++);
  g.events.on('playerDeath', (e) => {
    deaths++;
    if (e.headshot) heads++;
    if (e.weapon) byWeapon.set(e.weapon, (byWeapon.get(e.weapon) ?? 0) + 1);
  });
  let deadEyes = 0;
  // Added after the game's own listener: it sees what's left of each hit (a cancelled one never reaches it).
  g.events.on('damage', (hit) => {
    if (hit.amount >= 500) deadEyes++;
  });
  // The standoff: a shot now doesn't land (the house rules cancel it).
  check(matchState().phase === 'standoff', `a round should open with a standoff, not ${matchState().phase}`);
  // Rooted to the mark, hands off the guns (a weapons-locked freeze): 1 doesn't draw the Peacemaker.
  const me = g.player;
  h.step(1 / 60, { down: ['Digit1'], pressed: ['Digit1'] });
  check(me.frozen && me.inventory.selected === 2 && guns.of(g)!.ammo(me, 'revolver')?.magazine === 6, `no drawing in the standoff: frozen ${me.frozen}, slot ${me.inventory.selected}`);
  // Their outfit picker went up as they came into play (`playerReady`).
  check(h.find('hud', 'widget').some((c) => c.args[0] === 'outfits' && c.to === me.id), 'the outfit picker should be up on their screen');
  const [, a, b] = g.players;
  check(!a.damage(30, { source: b, cause: 'gun', part: 'body', weapon: 'revolver' }), 'a hit landed in the standoff');
  check(a.health === a.maxHealth, 'the standoff hit hurt');
  // A hit that lands outside a fight (the standoff, between rounds) would be a bug in the house rules.
  g.events.on('playerDamage', () => {
    if (matchState().phase !== 'fight') early++;
  });
  const simulated = h.run(600, {
    pilot: () => null,
    until: (hh) => hh.find('hud', 'banner').some((c) => c.args[0] === 'THE TOWN IS YOURS' || c.args[0] === 'RIDE ON, STRANGER'),
  });
  console.warn = warn;
  const wall = (performance.now() - t0) / 1000;
  const rounds = h.find('hud', 'feed').filter((c) => /takes round|Nobody walks away/.test(JSON.stringify(c.args[0]))).length;
  const won = h.find('hud', 'banner').some((c) => c.args[0] === 'RIDE ON, STRANGER' || c.args[0] === 'THE TOWN IS YOURS');
  const widgets = new Set(h.find('hud', 'widget').map((c) => String(c.args[0])));
  const weapons = [...byWeapon].map(([w, n]) => `${w} ${n}`).join(', ');
  console.log(
    `  ${simulated.toFixed(0)} s in ${wall.toFixed(1)} s: ${rounds} rounds, ${shots} shots, ${deaths} deaths (${heads} headshots; ${weapons}), ${rolls} rolls, ${deadEyes} dead-eyes; widgets ${[...widgets].join(', ')}`,
  );
  check(
    warnings.every((w) => !w.includes('hud.define')),
    `a widget lost markup or styles: ${warnings.join(' | ')}`,
  );
  check(shots > 30, `bots hardly fired (${shots} shots)`);
  check(deaths >= 5, `bots should kill each other (${deaths} deaths)`);
  check(rounds >= 3, `rounds should end (${rounds})`);
  check(won, 'the match should end with someone taking the town');
  check(early === 0, `${early} hits landed during a standoff`);
  for (const w of ['cylinder', 'wanted', 'duel', 'roundbar', 'outfits']) check(widgets.has(w), `the ${w} widget never went up`);
  looks(content, h.calls);
}

/**
 * The guns' looks and the game's voices are each screen's (`client/`): the server defines what the
 * guns do (the hammer and the lever are actions it keeps), names them in the kill feed, and plays
 * the voices by name; a screen, with the game's client code, has everything it's asked to show
 * and play.
 */
function looks(content: ContentDef[], calls: PresentCall[]) {
  for (const [id, def] of Object.entries(WEAPONS)) {
    const has = LOOK_FIELDS.filter((k) => k in def);
    check(!has.length, `the server's ${id} has look fields: ${has.join(', ')}`);
  }
  check(!content.some((d) => (d.kind as string) === 'sound'), `the server defines no voices: ${content.filter((d) => (d.kind as string) === 'sound').map((d) => (d as { name: string }).name)}`);
  const items = content.filter((d) => d.kind === 'item') as Extract<ContentDef, { kind: 'item' }>[];
  check(items.length === 2 && items.every((d) => !LOOK_FIELDS.some((k) => k in d.def)), `nor any gun's look: ${items.map((d) => `${d.name}: ${Object.keys(d.def)}`).join('; ')}`);
  check(!JSON.stringify(calls.filter((c) => c.target === 'hud')).includes('.glb'), 'no model file in its HUD calls');

  // A screen: the definitions, then the game's client code (after the standard voices, as its kits run first).
  const screen = new Content();
  for (const d of content) screen.apply(d);
  const voices = new Map<string, SynthVoice>();
  const client = {
    audio: { play() {}, define: (n: string, v: SynthVoice) => voices.set(n, v) },
    items: { look: (id: string, l: ItemLook) => screen.lookItem(id, l), get: (id: string) => screen.items.get(id) },
  } as unknown as Client;
  for (const k of sounds.standard()) k.setup?.(client);
  const standard = new Set(voices.keys());
  hn.client.setup!(client);
  const own = [...voices.keys()].filter((n) => !standard.has(n));
  check(own.length === 13 && own.every((n) => voiceRuns(voices.get(n)!)), `its voices, on the screen (${own.length}): ${own.join(', ')}`);
  const gun = (id: string) => screen.items.get(id) as GunItem;
  for (const id of Object.keys(LOOKS)) {
    const d = gun(id);
    check(typeof d.icon === 'object' && 'gltf' in d.icon && d.icon.gltf.includes('.glb') && d.hold?.model?.gltf?.url === d.icon.gltf, `${id} shows and is held as its model: ${JSON.stringify(d.icon)}`);
    for (const s of Object.values(d.sounds ?? {})) check(voices.has(s!) || ENGINE_SOUNDS.includes(s!), `${id}'s ${s} is a voice on the screen`);
  }
  const [revolver, rifle] = [gun('revolver'), gun('rifle')];
  check(
    revolver.action === 'hammer' && revolver.reload === 0.42 && revolver.hold?.gun?.hands === 1 && revolver.hold.stance === 'pistol' && revolver.hold.poses?.reload?.cycle === 0.42 && revolver.tracer === '#ffe2a0',
    `the Peacemaker: the server's hammer and reload, the screen's one-handed hold, pistol stance, reload pose and tracer: ${JSON.stringify(revolver)}`,
  );
  check(
    rifle.action === 'lever' && rifle.reload === 0.55 && rifle.hold?.gun?.hands === undefined && rifle.hold?.stance === 'rifle' && rifle.hold.poses?.reload?.cycle === 0.55 && rifle.sounds?.cycle === 'lever',
    `the Yellowboy: the server's lever and reload, the screen's hold, reload pose and lever sound: ${JSON.stringify(rifle)}`,
  );

  // The kill feed names the guns (side on); the screen draws them.
  const feedIcons = calls
    .filter((c) => c.target === 'hud' && c.method === 'feed')
    .flatMap((c) => (c.args[0] as { icon?: IconRef }[]).flatMap((p) => (typeof p === 'object' && p?.icon ? [p.icon] : [])));
  check(feedIcons.length >= 5 && feedIcons.every((i) => typeof i === 'object' && 'item' in i && i.view === 'side'), `the kill feed names guns, side on: ${JSON.stringify(feedIcons.slice(0, 4))}`);
  for (const i of feedIcons) {
    const drawn = resolveIcon(i, (id) => screen.items.get(id)) as { gltf: string; view?: string };
    check(drawn.gltf === (gun((i as { item: string }).item).icon as { gltf: string }).gltf && drawn.view === 'side', `a gun in the feed: ${JSON.stringify(drawn)}`);
  }

  // Every sound the server asks for is one the screen has: the guns' own through their looks.
  const asked = calls.filter((c) => c.target === 'audio' && c.method === 'play');
  const heard = asked.map((c) => soundOf(c.args[0] as string, c.args[1] as never, (id) => screen.items.get(id))).filter((s) => s !== null);
  const missing = [...new Set(heard.map((s) => s[0]))].filter((n) => !voices.has(n) && !ENGINE_SOUNDS.includes(n) && !standard.has(n));
  check(!missing.length, `sounds the screen doesn't have: ${missing.join(', ')}`);
  const shots = new Set(asked.filter((c) => (c.args[1] as { item?: { sound: string } } | undefined)?.item?.sound === 'use').map((c) => soundOf(c.args[0] as string, c.args[1] as never, (id) => screen.items.get(id))![0]));
  check(shots.has('shot_revolver') && shots.has('shot_rifle'), `others' shots play their gun's own: ${[...shots].join(', ')}`);
  console.log(`  looks: gameplay-only guns and no voices from the server; ${Object.keys(LOOKS).length} looks and ${own.length} voices on the screen; ${feedIcons.length} kill-feed icons by name; ${asked.length} sounds asked for, all on the screen`);
}
