import { readFileSync } from 'node:fs';
import type { IconRef, ItemLook, SynthVoice } from '../../src/platform';
import type { Client } from '../../src/platform/api/client';
import { soundOf } from '../../src/platform/client/present';
import { sounds } from '../../src/platform/client-kits';
import { Content } from '../../src/platform/content';
import { GameHost } from '../../src/platform/host/game';
import { PLACEHOLDER_ICON, resolveIcon } from '../../src/platform/looks';
import type { HostBatch, HostEvent, PlayerInput } from '../../src/platform/net/protocol';
import bedwarsClient from '../../src/games/bedwars/client';
import { BLOCK_ITEMS } from '../../src/games/bedwars/shared';
import { check, games } from './_harness';

type Vec = { x: number; y: number; z: number };
type Member = { seat: number; player: { name: string } | null; body: unknown; wallet: Record<string, number>; out: boolean };
type Team = { color: string; members: Member[]; bed: boolean; eliminated: boolean; base: { spawn: Vec; bed: Vec[]; shop: Vec; shopYaw: number } };
type Lobby = { spawn: Vec; feet: number; pads: { color: string; x: number; z: number }[] };
type Entry = { label: string; note?: string; detail?: string; active?: boolean; disabled?: boolean; onSelect?: { $cb: number }; icon?: IconRef };
type Menu = { title?: string; subtitle?: string; sections?: { title?: string; entries: Entry[] }[] };

/** The fields of an item that are its look (`ItemLook`): Bed Wars' server gives none. */
const LOOK_FIELDS = ['icon', 'hold', 'sounds', 'tracer', 'trail', 'drawIcon'] as const;
/** The engine's own sounds (`audio/sfx.ts`): every screen has them without a definition. */
const ENGINE_SOUNDS = ['hit', 'hurt', 'pickup', 'heal', 'wave', 'victory', 'defeat', 'spawn', 'click', 'countdown', 'lock', 'alarm'];

/**
 * Bed Wars with people: the lobby (a team picked from its menu or by standing on its pad), teams of
 * two with bots in the places left, a wallet each, no friendly fire, PvP, takeovers and leaving,
 * beds, the end per player, and back to the lobby.
 */
export default function bedwarsMultiplayer() {
  const def = games.find((g) => g.id === 'bedwars')!;
  const host = new GameHost(def, { engine: readFileSync('engine/pkg/voxel_engine_bg.wasm'), seed: 3, remote: true, radius: 6, budget: Infinity, cheats: true, player: { id: 'p1', name: 'Player' } });
  const bw = (globalThis as unknown as { __bw: { match: { teams: Team[]; lobby: boolean; size: number; map: { lobby: Lobby } } } }).__bw;
  const teams = () => bw.match.teams;
  const seats = () => teams().map((t) => `${t.color}:${t.members.map((m) => m.player?.name ?? (m.body ? 'bot' : '-')).join(',')}`).join(' ');
  let last = new Map<string, HostBatch>();
  const events = new Map<string, HostEvent[]>();
  const step = (n = 1) => {
    for (let i = 0; i < n; i++) {
      last = host.step(1 / 30);
      for (const [id, b] of last) events.set(id, [...(events.get(id) ?? []), ...b.events]);
    }
  };
  const calls = (id: string, method: string) => (events.get(id) ?? []).flatMap((e) => (e.t === 'call' && e.call.method === method ? [e.call.args] : []));
  const feed = () => calls('p1', 'feed').map((a) => String(a[0]));
  /** The menu titled so as this screen has it now (null: not up), from what it was sent. */
  const menu = (id: string, title: string): (Menu & { id: number }) | null => {
    let m = null as (Menu & { id: number }) | null;
    for (const e of events.get(id) ?? []) {
      if (e.t !== 'call' || e.call.target !== 'hud') continue;
      const [mid, o] = e.call.args as [number, Menu];
      if (e.call.method === 'menu') m = o.title === title ? { ...o, id: mid } : m;
      else if (e.call.method === 'menuUpdate' && m?.id === mid) m = { ...m, ...o };
      else if (e.call.method === 'menuClose' && m?.id === mid) m = null;
    }
    return m;
  };
  const entry = (id: string, title: string, label: string) => menu(id, title)?.sections?.flatMap((s) => s.entries).find((e) => e.label === label);
  const click = (id: string, title: string, label: string) => {
    const e = entry(id, title, label);
    check(e?.onSelect, `${label} is on ${title}: ${JSON.stringify(menu(id, title)?.sections?.map((s) => s.entries.map((x) => x.label)))}`);
    host.command(id, { t: 'message', msg: { t: 'callback', player: id, id: e!.onSelect!.$cb } });
    step(2);
  };
  const LOBBY = 'Bed Wars lobby';

  // Ann and Bob come in: the lobby, high over the map, the menu up.
  const ann = host.connect('Ann');
  const annFirst = ann.batch.events;
  const bob = host.connect('Bob');
  host.command(ann.id, { t: 'start' });
  host.command(bob.id, { t: 'start' });
  step(10);
  const [pa, pb] = host.sim.players;
  const lobby = bw.match.map.lobby;
  check(bw.match.lobby && Math.abs(pa.api.position.y - lobby.feet) < 1 && Math.abs(pb.api.position.y - lobby.feet) < 1, `both in the lobby: ${JSON.stringify(pa.api.position)} (floor ${lobby.feet})`);
  check(menu(ann.id, LOBBY) && menu(bob.id, LOBBY), 'each has the lobby menu');
  // Nobody's hurt in the lobby.
  pb.api.damage(5, { source: pa.api, knockback: 0 });
  check(pb.api.health === pb.api.maxHealth, `no damage in the lobby: ${pb.api.health}`);

  // Ann picks Red from the menu; Bob walks onto Red's pad.
  click(ann.id, LOBBY, 'Red');
  const red = lobby.pads.find((d) => d.color === 'red')!;
  pb.api.teleport({ x: red.x + 0.5, y: lobby.feet, z: red.z + 0.5 });
  step(3);
  check(entry(ann.id, LOBBY, 'Red')?.note === 'Ann, Bob', `both on Red, as Ann's menu has it: ${entry(ann.id, LOBBY, 'Red')?.note}`);
  const frame = () => last.get(ann.id)!.frame!;
  const fp = (id: string) => frame().players.find((p) => p.id === id)!;
  check(fp(bob.id).color === '#ff5b5b', `Bob in red on the pad: ${fp(bob.id).color}`);
  // The map vote: with no votes a public room moves on to the next map; Ann's vote keeps Skyhold.
  check(menu(ann.id, LOBBY)!.subtitle?.includes('Next map: Sunscar Canyon'), `next in turn: ${menu(ann.id, LOBBY)!.subtitle}`);
  click(ann.id, LOBBY, 'Skyhold');
  check(menu(bob.id, LOBBY)!.subtitle?.includes('Next map: Skyhold') && entry(bob.id, LOBBY, 'Skyhold')?.note, `Ann's vote shows on Bob's menu: ${menu(bob.id, LOBBY)!.subtitle}`);
  // A public lobby counts down on its own; both ready, it starts in five.
  check(/Starting in \d+s/.test(menu(ann.id, LOBBY)!.subtitle ?? ''), `the countdown: ${menu(ann.id, LOBBY)!.subtitle}`);
  click(ann.id, LOBBY, 'Ready');
  click(bob.id, LOBBY, 'Ready');
  step(30 * 6);
  check(!bw.match.lobby && bw.match.size === 2, `the match is on, two a team: lobby ${bw.match.lobby}, size ${bw.match.size}`);
  check(seats() === 'red:Ann,Bob blue:bot,bot green:bot,bot yellow:bot,bot', `seats: ${seats()}`);
  check(!menu(ann.id, LOBBY), 'the lobby menu went');
  check(fp(ann.id).uniform?.topColor === '#c23a30' && fp(bob.id).uniform?.topColor === '#c23a30', 'both in red kit');

  // Wallets are each person's own.
  host.command(ann.id, { t: 'exec', id: 1, line: 'bw rich' });
  step(10);
  const [ma, mb] = teams()[0].members;
  check(ma.wallet.iron >= 64 && mb.wallet.iron === 0, `Ann's wallet only: Ann ${ma.wallet.iron}, Bob ${mb.wallet.iron}`);
  check(calls(ann.id, 'stat').some((a) => a[0] === 'iron' && Number(a[2]) >= 64) && !calls(bob.id, 'stat').some((a) => a[0] === 'iron' && Number(a[2]) >= 64), 'each sees their own wallet');

  // The shop: Ann right-clicks the red shopkeeper.
  const keeper = teams()[0].base;
  const facing = { x: -Math.sin(keeper.shopYaw), z: -Math.cos(keeper.shopYaw) };
  pa.api.teleport({ x: keeper.shop.x + facing.x * 2.5, y: keeper.shop.y, z: keeper.shop.z + facing.z * 2.5 }, keeper.shopYaw + Math.PI, -0.15);
  step(2);
  const use = (clicked: number): PlayerInput => ({ active: true, down: [], pressed: [], buttons: clicked, clicked, mouseX: 0, mouseY: 0, wheel: 0, yaw: keeper.shopYaw + Math.PI, pitch: -0.15, viewSeq: pa.viewSeq });
  host.command(ann.id, { t: 'input', input: use(4) });
  step(1);
  host.command(ann.id, { t: 'input', input: use(0) });
  step(2);
  const shop = menu(ann.id, 'Item Shop');
  check(shop, `Ann's shop opened: ${JSON.stringify(calls(ann.id, 'menu')).slice(0, 200)}`);
  // She buys wool: her first purchase.
  click(ann.id, 'Item Shop', 'Wool ×16');
  check(pa.api.inventory.count('wool_red') === 16 && pa.api.achieved('retail_therapy'), 'bought wool: Retail Therapy');
  // Sharpened Swords is the team's: Bob's sword gets its edge too.
  click(ann.id, 'Item Shop', 'Sharpened Swords');
  step(10);
  check(pb.api.inventory.count('wooden_sword_sharp') === 1 && !pb.api.inventory.count('wooden_sword'), `Bob's sword sharpened by Ann's upgrade: ${pb.api.inventory.slots.map((x) => x?.item).join(' ')}`);

  // No friendly fire: Ann swings at Bob and he's fine.
  const s = keeper.spawn;
  const swing = (clicked: number): PlayerInput => ({ active: true, down: [], pressed: [], buttons: clicked, clicked, mouseX: 0, mouseY: 0, wheel: 0, yaw: 0, pitch: -0.25, viewSeq: pa.viewSeq });
  const duel = (victim: typeof pb, rounds: number) => {
    let lowest = victim.api.health;
    for (let i = 0; i < rounds && victim.api.alive; i++) {
      // They keep stepping back in (a knockback sends them out of reach).
      pa.api.teleport({ x: s.x, y: s.y, z: s.z }, 0, 0);
      victim.api.teleport({ x: s.x, y: s.y, z: s.z - 1.6 }, Math.PI, 0);
      host.command(ann.id, { t: 'input', input: swing(1) });
      step(1);
      lowest = Math.min(lowest, victim.api.health);
      host.command(ann.id, { t: 'input', input: swing(0) });
      step(16);
    }
    return lowest;
  };
  check(duel(pb, 6) === pb.api.maxHealth, 'Ann can’t hurt her teammate');

  // Cat joins mid-match: she takes a bot's place on a team with nobody on it (blue, the first).
  const cat = host.connect('Cat');
  host.command(cat.id, { t: 'start' });
  step(4);
  const pc = host.sim.players[2];
  check(seats().startsWith('red:Ann,Bob blue:Cat,bot'), `Cat took over from a bot on blue: ${seats()}`);
  check(feed().some((f) => f.includes('Cat takes over Blue 1')), `the feed tells: ${feed().slice(-3).join(' | ')}`);

  // PvP: Ann swings at Cat till she's down (Bob out of the way). What Cat carries, she keeps.
  pb.api.teleport(keeper.shop);
  pc.api.inventory.give('wool_blue', 16);
  pc.api.inventory.give('bow');
  const hp0 = pc.api.health;
  const lowest = duel(pc, 40);
  check(lowest < hp0 && !pc.api.alive, `Ann's sword took Cat down: ${hp0} -> ${lowest}`);
  check(pa.api.achieved('first_blood') && !pa.api.achieved('final_kill') && !pc.api.achieved('first_blood'), 'First Blood for Ann (not a final kill: blue’s bed stands)');
  step(2);
  check(feed().some((f) => /Cat was (slain|knocked into the void) by Ann/.test(f)), `kill credit in the feed: ${feed().slice(-3).join(' | ')}`);
  check(calls(cat.id, 'banner').some((a) => a[0] === 'YOU DIED!') && !calls(ann.id, 'banner').some((a) => a[0] === 'YOU DIED!'), 'only Cat is told she died');
  // While she waits she spectates: flying free where she fell, unseen, untouchable.
  step(30 * 2);
  const fell = { ...pc.api.position };
  check(pc.api.spectating && !pc.api.frozen, `Cat spectates while she waits: spectating ${pc.api.spectating}, frozen ${pc.api.frozen}`);
  const flyUp: PlayerInput = { active: true, down: ['Space'], pressed: [], buttons: 0, clicked: 0, mouseX: 0, mouseY: 0, wheel: 0, yaw: 0, pitch: 0, viewSeq: pc.viewSeq };
  host.command(cat.id, { t: 'input', input: flyUp });
  step(20);
  host.command(cat.id, { t: 'input', input: { ...flyUp, down: [] } });
  check(pc.api.position.y > fell.y + 2, `she flies up: ${fell.y.toFixed(1)} -> ${pc.api.position.y.toFixed(1)}`);
  check(last.get(ann.id)!.frame!.players.find((p) => p.id === cat.id)?.spectating === true, "Ann's screen knows she's spectating");
  step(30 * 4);
  const catInv = pc.api.inventory;
  check(pc.api.alive && !pc.api.spectating && catInv.count('wooden_sword') === 1 && catInv.count('wool_blue') === 16 && catInv.count('bow') === 1, `Cat respawned with what she carried: ${catInv.slots.map((x) => x && `${x.item}x${x.count}`).join(' ')}`);

  // Bob leaves: a bot plays his place.
  host.disconnect(bob.id);
  step(4);
  check(seats().startsWith('red:Ann,bot blue:Cat,bot'), `a bot plays for Bob: ${seats()}`);
  check(feed().some((f) => f.includes('Bob left')), 'the feed tells');

  // Ann breaks Cat's bed: Cat hears it one way, Ann the other.
  const blueBed = teams()[1].base.bed[0];
  host.sim.breakBlockAt(blueBed.x, blueBed.y, blueBed.z, pa.api);
  step(2);
  check(!teams()[1].bed, 'blue bed broken');
  check(pa.api.achieved('rude_awakening') && pa.api.achieved('early_riser'), 'Rude Awakening, and (inside two minutes) Early Riser');
  check(calls(cat.id, 'banner').some((a) => a[0] === 'BED DESTROYED!') && calls(ann.id, 'banner').some((a) => a[0] === 'BED DESTRUCTION'), 'bed news, each their way');

  // The end: Ann's team wins.
  host.command(ann.id, { t: 'exec', id: 2, line: 'bw win' });
  step(70);
  const title = (id: string) => (calls(id, 'screen').at(-1)?.[1] as { title?: string } | undefined)?.title;
  check(title(ann.id) === 'VICTORY!' && title(cat.id) === 'GAME OVER', `result screens: Ann ${title(ann.id)}, Cat ${title(cat.id)}`);
  check(!pa.api.achieved('first_win'), 'a win by the cheat earns no achievement');
  const popped = calls(ann.id, 'achievement').map((a) => (a[0] as { title: string }).title);
  check(popped.join() === 'Retail Therapy,First Blood,Rude Awakening,Early Riser', `Ann's achievements popped up: ${popped.join(', ')}`);

  // Then everyone's back in the lobby.
  step(30 * 12);
  check(bw.match.lobby && menu(ann.id, LOBBY) && menu(cat.id, LOBBY), 'back in the lobby, the menu up');
  check(Math.abs(pa.api.position.y - bw.match.map.lobby.feet) < 1 && !pa.api.inventory.slots.some(Boolean), 'in the box, empty-handed');
  const errors = (events.get(ann.id) ?? []).filter((e) => e.t === 'error');
  check(!errors.length, `the game threw: ${errors.map((e) => (e.t === 'error' ? e.text.slice(0, 300) : '')).join(' | ')}`);
  console.log(`  lobby, picks and pads, doubles with bots, wallets, team upgrade, no friendly fire, PvP, takeover, leaving, beds, results and back · feed: ${feed().slice(-4).join(' | ')}`);
  looks([...annFirst, ...(events.get(ann.id) ?? [])], shop!.sections as { title: string; entries: { label: string; icon?: IconRef }[] }[]);
}

/**
 * How Ann's screen draws and plays Bed Wars (its client code: `client/looks.ts`, `client/sounds.ts`):
 * the server sent no voices and no item looks; every item has its look, the shop's offers of items
 * name them and show them as the screen has them, and every sound the server asked for is one the
 * screen has.
 */
function looks(seen: HostEvent[], sections: { title: string; entries: { label: string; icon?: IconRef }[] }[]) {
  const content = seen.flatMap((e) => (e.t === 'content' ? [e.def] : []));
  check(!content.some((d) => (d.kind as string) === 'sound'), `the server defines no voices: ${content.flatMap((d) => ((d.kind as string) === 'sound' ? [(d as { name?: string }).name] : []))}`);
  const served = [...new Map(content.flatMap((d) => (d.kind === 'item' ? [[d.name, d] as const] : []))).values()];
  const lookish = served.filter((d) => LOOK_FIELDS.some((k) => k in d.def));
  check(served.length >= 25 && !lookish.length, `nor any item's look (${served.length} items): ${lookish.map((d) => `${d.name}: ${Object.keys(d.def)}`).join('; ')}`);
  check(served.find((d) => d.name === 'bow')?.def.kind === 'bow' && (served.find((d) => d.name === 'bow')!.def as { projectile?: string }).projectile === 'arrow', 'the bow shoots arrows the server draws');

  // The screen: the server's definitions, then the game's client code (after the standard voices, as its kits run first).
  const screen = new Content();
  for (const d of content) screen.apply(d);
  const voices = new Map<string, SynthVoice>();
  const client = {
    audio: { play() {}, define: (n: string, v: SynthVoice) => voices.set(n, v) },
    items: { look: (id: string, l: ItemLook) => screen.lookItem(id, l), get: (id: string) => screen.items.get(id) },
  } as unknown as Client;
  for (const k of sounds.standard()) k.setup?.(client);
  bedwarsClient.client.setup!(client);
  const item = (id: string) => screen.items.get(id);
  const bare = served.filter((d) => item(d.name)?.icon === PLACEHOLDER_ICON);
  check(!bare.length, `items with no look on the screen: ${bare.map((d) => d.name).join(', ')}`);
  for (const [id, block] of Object.entries(BLOCK_ITEMS)) check(JSON.stringify(item(id)?.icon) === JSON.stringify({ block }), `${id} looks like the ${block} it places: ${JSON.stringify(item(id)?.icon)}`);
  check(item('iron_sword_sharp')?.hold?.model === item('iron_sword')?.hold?.model && item('iron_sword')?.hold?.model, 'a sharpened sword looks like its plain one, held as its model');
  check((item('bow') as { drawIcon?: string }).drawIcon === 'bow_pulling', 'the bow draws');

  // The shop: its items by name, drawn as the screen has them; armour and the team upgrades as sprites of their own.
  const entries = sections.flatMap((s) => s.entries.map((e) => ({ ...e, section: s.title })));
  const byName = entries.filter((e) => typeof e.icon === 'object' && 'item' in e.icon);
  check(entries.filter((e) => e.section !== 'Team upgrades' && !e.label.includes('Armor')).every((e) => byName.includes(e)), `the shop names its items: ${JSON.stringify(entries.map((e) => [e.label, e.icon]))}`);
  for (const e of entries) {
    const drawn = resolveIcon(e.icon!, item);
    check(drawn && drawn !== PLACEHOLDER_ICON, `the shop's ${e.label} is drawn: ${JSON.stringify(e.icon)}`);
  }

  // Every sound asked for is one the screen has.
  const asked = seen.flatMap((e) => (e.t === 'call' && e.call.target === 'audio' && e.call.method === 'play' ? [e.call] : []));
  const heard = new Set(asked.flatMap((c) => soundOf(c.args[0] as string, c.args[1] as never, item)?.[0] ?? []));
  const missing = [...heard].filter((n) => !voices.has(n) && !ENGINE_SOUNDS.includes(n));
  check(heard.has('bed_break') && !missing.length, `sounds the screen doesn't have: ${missing.join(', ')} (heard ${[...heard].join(', ')})`);
  check(['bed_break', 'buy', 'eat', 'final_kill', 'fireball'].every((n) => voices.has(n)), `the game's own voices on the screen: ${[...voices.keys()].join(', ')}`);
  console.log(`  on Ann's screen: ${served.length} items, each with its look; ${voices.size} voices; the shop's ${byName.length} items by name (of ${entries.length} offers); ${heard.size} sounds asked for, all there`);
}
