import { readFileSync } from 'node:fs';
import { defineGame, type IconRef, type ItemDefinition, type ItemLook, type SynthVoice } from '../../src/platform';
import type { GunItem } from '../../src/platform/items';
import type { Client } from '../../src/platform/api/client';
import { ClientRuntime } from '../../src/platform/client/api/client';
import { Presenter, soundOf } from '../../src/platform/client/present';
import { Content } from '../../src/platform/content';
import { GameHost } from '../../src/platform/host/game';
import { PLACEHOLDER_ICON, resolveIcon } from '../../src/platform/looks';
import { decode, encode } from '../../src/platform/net/codec';
import type { ContentDef, HostBatch, PresentCall } from '../../src/platform/net/protocol';
import { sounds } from '../../src/platform/client-kits';
import cob from '../../src/games/callofblocky/client';
import { LOOKS } from '../../src/games/callofblocky/client/looks';
import cobServer from '../../src/games/callofblocky/server';
import { LETHALS, PRIMARIES, SIDEARMS, WEAPONS } from '../../src/games/callofblocky/weapons';
import { check } from './_harness';
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

const wasm = readFileSync('engine/pkg/voxel_engine_bg.wasm');

/** The fields of an item that are its look (`ItemLook`): the server's definitions of a game that moved them have none. */
const LOOK_FIELDS = ['icon', 'hold', 'sounds', 'tracer', 'trail', 'drawIcon'] as const;
/** The engine's own sounds (`audio/sfx.ts`): every screen has them without a definition. */
const ENGINE_SOUNDS = ['hit', 'hurt', 'pickup', 'heal', 'wave', 'victory', 'defeat', 'spawn', 'click', 'countdown', 'lock', 'alarm'];

/**
 * Items' looks and sounds on the client (docs/REDESIGN-CLIENT-SERVER.md, phase 3): a game's client
 * code gives each item its look (`client.items.look`), which goes over the server's definition
 * wherever a screen reads the item; the server names items (`{ item }` icons in feeds and menus,
 * `audio.play`'s `item`) and each screen shows and plays them as it has them; voices defined in
 * client code. Call of Blocky does all of it: its server has no model files and no voices.
 */
export default function looks() {
  merging();
  clientApi();
  serverNames();
  callOfBlocky();
}

// -------------------------------------------------------------------------------------------------
// Looks over definitions
// -------------------------------------------------------------------------------------------------

const RIFLE: GunItem = { kind: 'gun', name: 'Rifle', rpm: 600, damage: 20, magazine: 30, reload: 2, sounds: { empty: 'click_dry' } };

function merging() {
  // The server's side: what it forwards is its own definition, never a look.
  const server = new Content();
  const sent: ContentDef[] = [];
  server.forward = (d) => sent.push(d);
  server.defineItem('rifle', RIFLE);
  server.defineItem('frag', { kind: 'throwable', name: 'Frag' });
  const wired = sent.map((d) => decode<ContentDef>(encode(d)));
  check(wired.every((d) => d.kind === 'item' && !('icon' in d.def)), `the server sends definitions without icons: ${JSON.stringify(wired)}`);

  // A screen: the definition comes, then the look (and for the frag, the look first).
  const screen = new Content();
  const rifleLook: ItemLook = { name: 'Big Kahuna', icon: { gltf: '/rifle.glb' }, hold: { style: 'gun', gun: { ads: 0.4 } }, tracer: '#f0f', sounds: { use: 'bang' } };
  screen.lookItem('frag', { icon: { gltf: '/frag.glb' }, trail: '#fa0', sounds: { draw: 'pin' } });
  for (const d of wired) screen.apply(d);
  check(JSON.stringify(screen.items.get('rifle')!.icon) === JSON.stringify(PLACEHOLDER_ICON), `an item given no icon by either side shows the placeholder: ${JSON.stringify(screen.items.get('rifle')!.icon)}`);
  screen.lookItem('rifle', rifleLook);
  const rifle = screen.items.get('rifle') as GunItem;
  check(rifle.rpm === 600 && rifle.magazine === 30 && rifle.kind === 'gun', 'what the item does stays the server’s');
  check(rifle.name === 'Big Kahuna' && (rifle.icon as { gltf: string }).gltf === '/rifle.glb' && rifle.hold?.gun?.ads === 0.4 && rifle.tracer === '#f0f', `the look goes over it: ${JSON.stringify(rifle)}`);
  check(rifle.sounds?.use === 'bang' && rifle.sounds?.empty === 'click_dry', `sounds sound by sound: ${JSON.stringify(rifle.sounds)}`);
  const frag = screen.items.get('frag') as ItemDefinition & { trail?: string };
  check(frag.trail === '#fa0' && frag.sounds?.draw === 'pin' && (frag.icon as { gltf: string }).gltf === '/frag.glb', 'a look given before the item comes is waiting for it');
  // The server defines it again (a restart): the look stays.
  screen.apply({ kind: 'item', name: 'rifle', def: { ...RIFLE, rpm: 700 } as ItemDefinition });
  const again = screen.items.get('rifle') as GunItem;
  check(again.rpm === 700 && again.tracer === '#f0f' && again.hold?.gun?.ads === 0.4, 'a definition sent again takes the look again');
  // A server that still gives the look itself (a game that hasn't moved): as it was.
  screen.apply({ kind: 'item', name: 'sword', def: { kind: 'melee', name: 'Sword', icon: 'iron_sword', damage: 5, cooldown: 0.5, sounds: { use: 'swing' } } as ItemDefinition });
  check(screen.items.get('sword')!.icon === 'iron_sword' && screen.items.get('sword')!.sounds?.use === 'swing', "a server's own look is kept");

  // `{ item }` icons: the item's as this screen has it; a model's picture from the side on asking.
  const item = (id: string) => screen.items.get(id);
  check(JSON.stringify(resolveIcon({ item: 'rifle', view: 'side' }, item)) === '{"gltf":"/rifle.glb","view":"side"}', `a gun side on: ${JSON.stringify(resolveIcon({ item: 'rifle', view: 'side' }, item))}`);
  check(JSON.stringify(resolveIcon({ item: 'frag' }, item)) === '{"gltf":"/frag.glb"}', 'a lethal as it is');
  check(resolveIcon({ item: 'sword', view: 'side' }, item) === 'iron_sword', 'a sprite is a sprite from any side');
  check(resolveIcon({ item: 'nothing' }, item) === null, 'an item not here (yet): nothing to draw (the HUD tries again)');
  check(resolveIcon('heart', item) === 'heart' && JSON.stringify(resolveIcon({ block: 'stone' }, item)) === '{"block":"stone"}', 'any other icon is itself');
  console.log('  merging: looks over definitions (before or after them, again on a redefinition), sounds by sound, the placeholder; { item } icons resolved');
}

// -------------------------------------------------------------------------------------------------
// The client API
// -------------------------------------------------------------------------------------------------

function clientApi() {
  const content = new Content();
  content.apply({ kind: 'item', name: 'rifle', def: RIFLE });
  const defined: string[] = [];
  const shared = defineGame({ id: 'looks', title: 'Looks', world: { terrain: 'flat' } });
  const def = {
    kits: [{ name: 'kit', setup: (c: Client) => void c.audio.define('bang', () => defined.push('kit')) }],
    setup(c: Client) {
      c.items.look('rifle', { icon: 'iron_sword', sounds: { use: 'bang' } });
      c.audio.define('bang', () => defined.push('game'));
    },
  };
  const voices = new Map<string, SynthVoice>();
  const client = new ClientRuntime(shared, def, {
    services: {
      audio: { play: () => {}, define: (n: string, v: SynthVoice) => voices.set(n, v) },
      items: { look: (id: string, l: ItemLook) => content.lookItem(id, l), get: (id: string) => content.items.get(id) },
    } as never,
    item: (id) => content.items.get(id),
    send: () => {},
    running: () => true,
  });
  client.setup({} as never);
  check(client.item('rifle')?.icon === 'iron_sword' && client.items.get('rifle')?.sounds?.use === 'bang', `client.item and client.items.get have the look: ${JSON.stringify(client.item('rifle'))}`);
  voices.get('bang')!({} as never);
  check(defined.join() === 'game', `the game's own voice goes over a kit's of the same name (its setup runs after theirs): ${defined}`);
  console.log("  client API: client.items.look in setup, read back through client.item; the game's voices over its kits'");
}

// -------------------------------------------------------------------------------------------------
// The server names items; screens show and play them as they have them
// -------------------------------------------------------------------------------------------------

function serverNames() {
  // The item's own sound as the screen has it, at the pitch given for it; else the name given; none, nothing.
  const screen = new Content();
  screen.apply({ kind: 'item', name: 'rifle', def: RIFLE });
  screen.apply({ kind: 'item', name: 'katana', def: { kind: 'melee', name: 'Katana', damage: 100, cooldown: 1 } as ItemDefinition });
  screen.lookItem('rifle', { sounds: { use: 'bang', reload: 'mag' } });
  screen.lookItem('katana', { sounds: { hit: 'slice' } });
  const item = (id: string) => screen.items.get(id);
  const play = (name: string, opts?: Parameters<typeof soundOf>[1]) => JSON.stringify(soundOf(name, opts, item));
  check(play('gunshot', { at: { x: 1, y: 2, z: 3 }, item: { id: 'rifle', sound: 'use' } }) === '["bang",{"at":{"x":1,"y":2,"z":3}}]', `a shot: the gun's own (${play('gunshot', { item: { id: 'rifle', sound: 'use' } })})`);
  check(play('gun_empty', { item: { id: 'rifle', sound: 'empty' } }) === '["click_dry",{}]', "the server's own sound where the look has none");
  check(play('crit', { pitch: 1, item: { id: 'katana', sound: 'hit', pitch: 1.25 } }) === '["slice",{"pitch":1.25}]', 'a crit with its own hit sound: pitched up');
  check(play('crit', { pitch: 1, item: { id: 'sword', sound: 'hit', pitch: 1.25 } }) === '["crit",{"pitch":1}]', "an item the screen doesn't have: the name given, as given");
  check(play('', { item: { id: 'rifle', sound: 'draw' } }) === 'null', 'no sound of its own and none given: nothing');

  // Over the wire: a feed line and a menu name items, the sounds carry them; a server-defined voice still goes.
  let game: Parameters<NonNullable<Parameters<typeof defineGame>[0]['setup']>>[0] | null = null;
  const def = defineGame({
    id: 'names',
    title: 'Names',
    world: { terrain: 'flat', flatHeight: 8, seed: 5 },
    setup(g) {
      game = g;
      g.items.define('rifle', RIFLE);
    },
  });
  const host = new GameHost(def, { engine: wasm, seed: 5, remote: true, radius: 2, budget: Infinity });
  const ann = host.connect('Ann');
  host.command(ann.id, { t: 'start' });
  const seen: PresentCall[] = [];
  const played: [string, unknown][] = [];
  const presenter = new Presenter(null, {
    hud: { feed: (parts: unknown) => seen.push({ to: null, target: 'hud', method: 'feed', args: [parts] }), menu: (o: unknown) => (seen.push({ to: null, target: 'hud', method: 'menu', args: [o] }), { update() {}, close() {}, open: true }) } as never,
    fx: {} as never,
    sfx: { play: (n: string, o: unknown) => played.push([n, o]) } as never,
    view: () => {},
    send: () => {},
    message: () => {},
    item,
  });
  const take = (b: HostBatch) => {
    for (const e of decode<HostBatch>(encode(b)).events) {
      if (e.t === 'joined') presenter.player = e.player;
      else if (e.t === 'call') presenter.apply(e.call);
    }
  };
  take(ann.batch);
  take(host.step(1 / 30).get(ann.id)!);
  const g = game!;
  g.hud.feed(['Ann ', { icon: { item: 'rifle', view: 'side' } }, ' Bob']);
  g.players[0].hud.menu({ title: 'Pick', sections: [{ entries: [{ icon: { item: 'rifle' }, label: 'Rifle' }] }] });
  g.audio.play('gunshot', { at: { x: 0, y: 9, z: 0 }, item: { id: 'rifle', sound: 'use' } });
  const out = host.step(1 / 30).get(ann.id)!;
  check(!JSON.stringify(out).includes('.glb'), 'no model file named on the wire');
  take(out);
  const feed = seen.find((c) => c.method === 'feed')!.args[0] as { icon?: IconRef }[];
  const menu = seen.find((c) => c.method === 'menu')!.args[0] as { sections: { entries: { icon: IconRef }[] }[] };
  check(JSON.stringify(feed[1]) === '{"icon":{"item":"rifle","view":"side"}}' && JSON.stringify(menu.sections[0].entries[0].icon) === '{"item":"rifle"}', `the screen's HUD is handed the names: ${JSON.stringify(feed)}, ${JSON.stringify(menu.sections)}`);
  screen.lookItem('rifle', { icon: { gltf: '/rifle.glb' }, sounds: { use: 'bang' } });
  check(JSON.stringify(resolveIcon(feed[1].icon!, item)) === '{"gltf":"/rifle.glb","view":"side"}', 'and draws the rifle as it has it');
  check(JSON.stringify(played.at(-1)) === '["bang",{"at":{"x":0,"y":9,"z":0}}]', `the sound played is the rifle's own on this screen: ${JSON.stringify(played.at(-1))}`);
  console.log("  server names: { item } icons in a feed and a menu, the item's own sounds (at their pitch), across the wire; server voices still sent");
}

// -------------------------------------------------------------------------------------------------
// Call of Blocky: its server has what the weapons do, its screens how they look and sound
// -------------------------------------------------------------------------------------------------

function callOfBlocky() {
  // The server's definitions: gameplay only.
  for (const [id, def] of [...Object.entries(WEAPONS), ...Object.entries(LETHALS)]) {
    const has = LOOK_FIELDS.filter((k) => k in def);
    check(!has.length, `the server's ${id} has look fields: ${has.join(', ')}`);
  }

  // A match with bots, as Ann's screen gets it over the wire.
  const host = new GameHost(cobServer, { engine: wasm, seed: 3, remote: true, radius: 5, budget: Infinity });
  const ann = host.connect('Ann');
  host.command(ann.id, { t: 'start' });
  const batches: HostBatch[] = [decode<HostBatch>(encode(ann.batch))];
  const calls = () => batches.flatMap((b) => b.events.flatMap((e) => (e.t === 'call' ? [e.call] : [])));
  const kills = () => calls().filter((c) => c.method === 'feed' && (c.args[0] as { icon?: unknown }[]).some((p) => typeof p === 'object' && p && 'icon' in p));
  for (let i = 0; i < 30 * 90 && kills().length < 3; i++) batches.push(decode<HostBatch>(encode(host.step(1 / 30).get(ann.id)!)));
  const content = batches.flatMap((b) => b.events.flatMap((e) => (e.t === 'content' ? [e.def] : [])));
  check(!content.some((d) => (d.kind as string) === 'sound'), `the server defines no voices: ${content.filter((d) => (d.kind as string) === 'sound').map((d) => (d as { name: string }).name)}`);
  const items = content.filter((d) => d.kind === 'item') as Extract<ContentDef, { kind: 'item' }>[];
  check(items.length >= 9 && items.every((d) => !LOOK_FIELDS.some((k) => k in d.def)), `nor any item's look: ${items.map((d) => `${d.name}: ${Object.keys(d.def)}`).join('; ')}`);
  const hud = calls().filter((c) => c.target === 'hud');
  check(!JSON.stringify(hud).includes('.glb'), 'no model file in its HUD calls');

  // Ann's screen: the definitions, then the game's client code (after the standard voices, as its kits run first).
  const screen = new Content();
  for (const d of content) screen.apply(d);
  const voices = new Map<string, SynthVoice>();
  const client = {
    audio: { play() {}, define: (n: string, v: SynthVoice) => voices.set(n, v) },
    items: { look: (id: string, l: ItemLook) => screen.lookItem(id, l), get: (id: string) => screen.items.get(id) },
  } as unknown as Client;
  for (const k of sounds.standard()) k.setup?.(client);
  const standard = new Set(voices.keys());
  cob.client.setup!(client);
  const own = [...voices.keys()].filter((n) => !standard.has(n));
  check(own.length >= 20 && own.every((n) => voiceRuns(voices.get(n)!)), `its voices, on the screen (${own.length}): ${own.join(', ')}`);
  const item = (id: string) => screen.items.get(id);

  // Each weapon as it was: its model, icon and hold, its tracer, trail and sounds.
  for (const id of Object.keys(LOOKS)) {
    const d = item(id)!;
    check(d && typeof d.icon === 'object' && 'gltf' in d.icon && d.icon.gltf.includes('.glb'), `${id}'s icon is a picture of its model: ${JSON.stringify(d?.icon)}`);
    // (The briefcase and the ammo can are only picked up.)
    if (id !== 'briefcase' && id !== 'ammo') check(d.hold?.model?.gltf?.url === (d.icon as { gltf: string }).gltf, `${id} is held as its model`);
    for (const s of Object.values(d.sounds ?? {})) check(voices.has(s!) || ENGINE_SOUNDS.includes(s!), `${id}'s ${s} is a voice on the screen`);
  }
  const gun = (id: string) => item(id) as GunItem;
  check(gun('rifle').hold?.gun?.ads === 0.4 && JSON.stringify(gun('rifle').hold?.gun?.fist) === '[0.22,-0.31,-0.44]' && gun('rifle').rpm === 640, 'the rifle: its first-person fit (FP, ADS 0.4), its rate of fire');
  check(JSON.stringify(gun('smg').hold?.gun?.fist) === '[0.12,-0.27,-0.4]' && gun('smg').tracer === '#ff9ec8' && gun('sniper').hold?.gun?.ads === undefined, 'the SMG compact with a pink tracer; the sniper at the platform’s scope distance');
  check(JSON.stringify(item('katana')!.hold?.model?.gltf?.rotation) === '[0,0,90]' && (item('molotov') as { trail?: string }).trail === '#ffb347' && JSON.stringify(item('frag')!.hold?.model?.grip) === '[0,0,-2]', 'the katana on its side, the molotov’s trail, the frag in the fist');

  // The kill feed and the loadout menu name weapons; the screen draws them.
  const feedIcons = kills().flatMap((c) => (c.args[0] as { icon?: IconRef }[]).flatMap((p) => (typeof p === 'object' && p?.icon ? [p.icon] : [])));
  check(feedIcons.length >= 1 && feedIcons.every((i) => typeof i === 'object' && 'item' in i), `the kill feed names weapons: ${JSON.stringify(feedIcons)}`);
  for (const i of feedIcons) {
    const drawn = resolveIcon(i, item) as { gltf: string; view?: string };
    const id = (i as { item: string }).item;
    check(drawn.gltf === (item(id)!.icon as { gltf: string }).gltf && drawn.view === (WEAPONS[id] ? 'side' : undefined), `${id} in the feed: ${JSON.stringify(drawn)}`);
  }
  const menu = calls().find((c) => c.method === 'menu' && c.to === ann.player)!;
  const sections = (menu?.args[1] as { sections: { title: string; entries: { label: string; icon: IconRef }[] }[] }).sections;
  const entries = sections.filter((s) => ['Primary', 'Sidearm', 'Lethal (G)'].includes(s.title)).flatMap((s) => s.entries);
  check(entries.length === PRIMARIES.length + SIDEARMS.length + Object.keys(LETHALS).length && entries.every((e) => typeof e.icon === 'object' && 'item' in e.icon), `the loadout menu names its weapons: ${JSON.stringify(entries.map((e) => e.icon))}`);
  // Its outfits (progression.ts) by name too, each drawn as its fighter.
  const outfits = sections.find((s) => s.title === 'Outfit')?.entries ?? [];
  check(outfits.length === 10 && outfits.every((e) => typeof e.icon === 'object' && 'item' in e.icon && ((resolveIcon(e.icon, item) as { gltf?: string }).gltf ?? '').includes('.glb')), `the outfits, named and drawn: ${JSON.stringify(outfits.map((e) => e.icon))}`);
  check(JSON.stringify(resolveIcon(entries[0].icon, item)) === JSON.stringify({ gltf: (item('rifle')!.icon as { gltf: string }).gltf, view: 'side' }), 'the rifle in the menu, side on');

  // Every sound the server asks for is one the screen has: the weapons' own through their looks.
  const asked = calls().filter((c) => c.target === 'audio' && c.method === 'play');
  const heard = asked.map((c) => soundOf(c.args[0] as string, c.args[1] as never, item)).filter((s) => s !== null);
  const names = new Set(heard.map((s) => s[0]));
  const missing = [...names].filter((n) => !voices.has(n) && !ENGINE_SOUNDS.includes(n));
  check(!missing.length, `sounds the screen doesn't have: ${missing.join(', ')}`);
  const shots = asked.filter((c) => (c.args[1] as { item?: { sound: string } } | undefined)?.item?.sound === 'use' && c.args[0] === 'gunshot');
  check(shots.length > 10, `others' shots name their gun (${shots.length})`);
  const shotVoices = new Set(shots.map((c) => soundOf(c.args[0] as string, c.args[1] as never, item)![0]));
  check([...shotVoices].every((v) => v.startsWith('shot_')), `and play its own shot: ${[...shotVoices].join(', ')}`);
  console.log(`  Call of Blocky: gameplay-only definitions, no voices or model files from its server; ${Object.keys(LOOKS).length} looks and ${own.length} voices on the screen; ${feedIcons.length} kill-feed and ${entries.length} menu icons by name; ${asked.length} sounds asked for, all on the screen (shots: ${[...shotVoices].join(', ')})`);
}
