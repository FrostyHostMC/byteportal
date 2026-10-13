import { readFileSync } from 'node:fs';
import type { EntityDefinition, ItemLook, SynthVoice } from '../../src/platform';
import type { Client } from '../../src/platform/api/client';
import { soundOf } from '../../src/platform/client/present';
import { sounds } from '../../src/platform/client-kits';
import { Content } from '../../src/platform/content';
import { GameHost } from '../../src/platform/host/game';
import { PLACEHOLDER_ICON } from '../../src/platform/looks';
import type { HostEvent } from '../../src/platform/net/protocol';
import arenaClient from '../../src/games/arena/client';
import { gold } from '../../src/games/arena/run/gold';
import { isDowned } from '../../src/games/arena/run/downed';
import { blessingsOf } from '../../src/games/arena/blessings';
import { check, games } from './_harness';

/** The fields of an item that are its look (`ItemLook`): the Arena's server gives none. */
const LOOK_FIELDS = ['icon', 'hold', 'sounds', 'tracer', 'trail', 'drawIcon'] as const;
/** The engine's own sounds (`audio/sfx.ts`): every screen has them without a definition. */
const ENGINE_SOUNDS = ['hit', 'hurt', 'pickup', 'heal', 'wave', 'victory', 'defeat', 'spawn', 'click', 'countdown', 'lock', 'alarm'];

/**
 * Arena together: everyone's armed with their class's kit (at the start, in the countdown,
 * mid-fight, with gold to catch up), waves grow with the party, a fighter at the end of their
 * health goes down while friends stand and is back up when the wave's won, rewards for each, the
 * fight is lost only when nobody's left standing, and the last one out leaves it ready for the next.
 */
export default function arenaMultiplayer() {
  const def = games.find((g) => g.id === 'arena')!;
  const host = new GameHost(def, { engine: readFileSync('engine/pkg/voxel_engine_bg.wasm'), seed: 5, remote: true, radius: 6, budget: Infinity, player: { id: 'p1', name: 'Player' } });
  const game = host.sim.ctx;
  const events = new Map<string, HostEvent[]>();
  const step = (n = 1) => {
    for (let i = 0; i < n; i++) for (const [id, b] of host.step(1 / 30)) events.set(id, [...(events.get(id) ?? []), ...b.events]);
  };
  const calls = (id: string, method: string) => (events.get(id) ?? []).flatMap((e) => (e.t === 'call' && e.call.method === method ? [e.call.args.map(String)] : []));
  const menus = (id: string) => (events.get(id) ?? []).flatMap((e) => (e.t === 'call' && e.call.method === 'menu' ? [(e.call.args[1] as { title: string }).title] : []));
  /** The game's messages to someone's screen (the HUD's: `hud/messages.ts`), and the end screen (`arena-end`) put up there. */
  const msgs = <T>(id: string, name: string) => (events.get(id) ?? []).flatMap((e) => (e.t === 'call' && e.call.target === 'message' && e.call.method === name ? [e.call.args[0] as T] : []));
  const ends = (id: string) => (events.get(id) ?? []).flatMap((e) => (e.t === 'call' && e.call.method === 'widget' && e.call.args[0] === 'arena-end' ? [e.call.args[1] as { word?: string; headline?: string }] : []));
  const player = (name: string) => game.players.find((p) => p.name === name)!;
  const pickups = () => (host.sim as unknown as { items: { pickups: unknown[] } }).items.pickups.length;
  const join = (name: string) => {
    const c = host.connect(name);
    // (What the screen got on joining too: the game's definitions.)
    events.set(c.id, [...c.batch.events]);
    host.command(c.id, { t: 'start' });
    return c.id;
  };

  const ann = join('Ann');
  const bob = join('Bob');
  step(15);
  const armed = (n: string) => ['stone_sword', 'gladius'].some((w) => player(n).inventory.count(w) === 1);
  check(armed('Ann') && armed('Bob'), 'both start with a Gladiator\'s blade');
  // The map's fly-over first, then the class pick (no screen here says it's done: its length).
  check(!menus(ann).includes('Choose your class'), 'not asked their class over the fly-over');
  step(30 * 7);
  check(menus(ann).includes('Choose your class'), 'then asked their class');
  // Cat arrives during the countdown.
  const cat = join('Cat');
  step(5);
  check(armed('Cat'), 'joined in the countdown: armed');

  // Wave 1 with three: 6 zombies, half as many again for each extra fighter.
  let zombies = 0;
  let cleared = -1;
  let downed = false;
  for (let i = 0; i < 30 * 60 && cleared < 0; i++) {
    step(1);
    for (const e of game.entities.all()) {
      if (e.data.scenery) continue;
      if (e.type === 'zombie') zombies++;
      e.remove();
    }
    // Bob takes a killing blow partway through: with Ann and Cat standing, he goes down instead.
    if (zombies >= 3 && !downed) {
      player('Bob').damage(1000);
      downed = isDowned(player('Bob'));
    }
    if (msgs(ann, 'ar.wave').length) cleared = pickups();
  }
  check(zombies === 12, `wave 1 for three: ${zombies} zombies`);
  check(downed && !msgs<{ k: string }>(bob, 'ar.call').some((c) => c.k === 'out'), 'Bob went down (not out)');
  check(!ends(ann).length, 'one down is not the end');
  check(player('Bob').alive && !isDowned(player('Bob')) && Math.hypot(player('Bob').position.x, player('Bob').position.z) < 3, `Bob back on his feet when the wave is won: ${JSON.stringify(player('Bob').position)}`);
  check(cleared === 3, `a reward each: ${cleared} pickups`);
  // The first wave is everyone's; not a scratch on Ann or Cat, but Bob fell.
  check(['Ann', 'Bob', 'Cat'].every((n) => player(n).achieved('first_wave')), 'the first wave cleared: all three');
  check(player('Ann').achieved('untouched') && player('Cat').achieved('untouched') && !player('Bob').achieved('untouched'), 'untouched: Ann and Cat, not Bob');
  check(!player('Ann').achieved('first_blood'), 'no kills, no First Blood');
  // Each takes only their own: standing on the dais, Ann gets one potion, not three.
  const potions = (n: string) => player(n).inventory.count('health_potion');
  const had = potions('Ann');
  for (const n of ['Bob', 'Cat']) player(n).teleport({ x: 20, y: 72, z: 0 });
  player('Ann').teleport({ x: 0.5, y: 72, z: 0.5 });
  step(60);
  check(potions('Ann') === had + 1 && pickups() === 2, `Ann took her own reward only: ${potions('Ann') - had} potion, ${pickups()} left`);
  for (const n of ['Bob', 'Cat']) player(n).teleport({ x: 0.5, y: 72, z: 0.5 });
  step(60);
  check(pickups() === 0 && potions('Bob') === had + 1 && potions('Cat') === had + 1, 'and the others theirs');
  check(['Ann', 'Bob', 'Cat'].every((n) => gold(player(n)) > 0), `the wave's gold for each: ${['Ann', 'Bob', 'Cat'].map((n) => gold(player(n))).join(', ')}`);

  // Dan joins mid-fight in wave 2: his class's kit, and gold for the wave he missed.
  step(30 * 22);
  const dan = join('Dan');
  step(5);
  const d = player('Dan').inventory;
  check(armed('Dan') && gold(player('Dan')) > 0, `late arrival caught up: ${d.slots.filter(Boolean).map((s) => `${s!.item}x${s!.count}`).join(' ')}, ${gold(player('Dan'))} gold`);
  // (After his own, shorter fly-over.)
  check(!menus(dan).includes('Choose your class'), 'not over his fly-over');
  step(30 * 4);
  check(menus(dan).includes('Choose your class'), 'then he may choose a class');
  // He keeps what he has (closes it): only now is he told where he's come in.
  const joined = () => msgs<{ k: string; q?: string }>(dan, 'ar.call').some((c) => c.k === 'wave' && c.q === 'Joining the fight');
  check(!joined(), 'not told over his fly-over or his class pick');
  const classMenu = (events.get(dan) ?? []).flatMap((e) => (e.t === 'call' && e.call.method === 'menu' ? [e.call.args[0] as number] : [])).at(-1)!;
  host.command(dan, { t: 'message', msg: { t: 'menuClosed', player: '', menu: classMenu } });
  step(2);
  check(joined(), 'told where he came in once his class is set');
  check(calls(ann, 'feed').some((a) => a[0] === 'Dan joins the fight'), 'the others hear Dan joined');

  const looked = looks(events.get(ann) ?? []);

  // Nobody standing: the fight's lost. Leavers count: Dan goes first, then Ann and Bob go down, and
  // with Cat the last on her feet, she can't: she falls, and they bleed out.
  host.disconnect(dan);
  // (The monsters cleared away first, and a moment for anyone just hit to be hurt again.)
  const clear = () => {
    for (const e of game.entities.all()) if (!e.data.scenery) e.remove();
  };
  clear();
  step(20);
  clear();
  // (Again until it lands: a blow inside someone's moment after a hit, a trap's or a burn's, is ignored.)
  for (let i = 0; i < 30 && !['Ann', 'Bob'].every((n) => isDowned(player(n))); i++) {
    for (const n of ['Ann', 'Bob']) if (!isDowned(player(n))) player(n).damage(1000);
    step(1);
  }
  step(10);
  check(isDowned(player('Ann')) && isDowned(player('Bob')) && !ends(ann).length, `Cat still standing (${['Ann', 'Bob', 'Cat'].map((n) => `${n}: ${player(n).alive} ${player(n).health} ${isDowned(player(n))} ${blessingsOf(player(n))}`).join('; ')})`);
  player('Cat').damage(1000);
  step(90);
  const screen = ends(ann)[0];
  check(screen?.word === 'Defeated' && screen.headline?.startsWith('Your party fell on wave 2'), `lost with everyone down: ${JSON.stringify(screen)?.slice(0, 120)}`);

  // Everyone leaves; the next person begins a fresh fight.
  for (const id of [ann, bob, cat]) host.disconnect(id);
  step(5);
  const eve = join('Eve');
  step(30 * 2);
  check(player('Eve').alive && armed('Eve') && gold(player('Eve')) === 0, 'a fresh start for the next arrival');
  check(msgs<{ phase: string }>(eve, 'ar.run').some((r) => r.phase === 'countdown'), 'the countdown begins again');
  host.dispose();
  return `3 armed (1 in the countdown) · wave 1 for three: ${zombies} zombies · Bob went down and got up · ${cleared} rewards, one each · Dan caught up · lost with nobody standing · fresh for Eve · ${looked}`;
}

/**
 * How Ann's screen draws and plays the Arena (its client code: `client/looks.ts`, `client/sounds.ts`):
 * the server sent no voices and no item looks; every item has its look, the pike and the axe held as
 * their models, and every sound the server asked for, and every monster's, is one the screen has.
 */
function looks(seen: HostEvent[]): string {
  const content = seen.flatMap((e) => (e.t === 'content' ? [e.def] : []));
  check(!content.some((d) => (d.kind as string) === 'sound'), `the server defines no voices: ${content.flatMap((d) => ((d.kind as string) === 'sound' ? [(d as { name?: string }).name] : []))}`);
  const served = [...new Map(content.flatMap((d) => (d.kind === 'item' ? [[d.name, d] as const] : []))).values()];
  const lookish = served.filter((d) => LOOK_FIELDS.some((k) => k in d.def));
  check(served.length >= 10 && !lookish.length, `nor any item's look (${served.length} items): ${lookish.map((d) => `${d.name}: ${Object.keys(d.def)}`).join('; ')}`);
  check((served.find((d) => d.name === 'bow')?.def as { projectile?: string } | undefined)?.projectile === 'arrow', 'the bow shoots arrows the server draws');

  // The screen: the server's definitions, then the game's client code (after the standard voices, as its kits run first).
  const screen = new Content();
  for (const d of content) screen.apply(d);
  const voices = new Map<string, SynthVoice>();
  const client = {
    audio: { play() {}, define: (n: string, v: SynthVoice) => voices.set(n, v), defineLoop() {} },
    items: { look: (id: string, l: ItemLook) => screen.lookItem(id, l), get: (id: string) => screen.items.get(id) },
  } as unknown as Client;
  for (const k of sounds.standard()) k.setup?.(client);
  arenaClient.client.setup!(client);
  const item = (id: string) => screen.items.get(id);
  const bare = served.filter((d) => item(d.name)?.icon === PLACEHOLDER_ICON);
  check(!bare.length, `items with no look on the screen: ${bare.map((d) => d.name).join(', ')}`);
  check(item('pike')?.hold?.style === 'polearm' && !!item('pike')?.hold?.model?.gltf && item('battle_axe')?.hold?.style === 'axe', 'the pike and the axe held two-handed, as their models');
  check(!!(item('bow') as { drawIcon?: { gltf?: string } }).drawIcon?.gltf, 'the bow draws (its drawn model)');

  // Every sound asked for, and every monster's, is one the screen has.
  const asked = seen.flatMap((e) => (e.t === 'call' && e.call.target === 'audio' && e.call.method === 'play' ? [e.call] : []));
  const heard = new Set(asked.flatMap((c) => soundOf(c.args[0] as string, c.args[1] as never, item)?.[0] ?? []));
  const mobs = content.flatMap((d) => (d.kind === 'entity' ? Object.values((d.def as EntityDefinition).sounds ?? {}) : []));
  const missing = [...heard, ...mobs].filter((n) => !voices.has(n) && !ENGINE_SOUNDS.includes(n));
  check(mobs.length >= 10 && !missing.length, `sounds the screen doesn't have: ${missing.join(', ')}`);
  check(['zombie', 'skeleton', 'spider', 'brute', 'slam', 'boss'].every((n) => voices.has(n)), `the game's own voices on the screen: ${[...voices.keys()].join(', ')}`);
  return `on a screen: ${served.length} items with their looks, ${voices.size} voices, ${heard.size} sounds asked for and ${new Set(mobs).size} monsters' all there`;
}
