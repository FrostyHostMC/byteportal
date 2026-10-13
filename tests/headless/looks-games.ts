import { readFileSync } from 'node:fs';
import type { ClientGame } from '../../src/platform/api/client';
import type { Client } from '../../src/platform/api/client';
import type { GameDefinition, ItemLook, SynthVoice } from '../../src/platform';
import { soundOf } from '../../src/platform/client/present';
import { Content } from '../../src/platform/content';
import { GameHost } from '../../src/platform/host/game';
import { PLACEHOLDER_ICON, resolveIcon } from '../../src/platform/looks';
import { decode, encode } from '../../src/platform/net/codec';
import type { ContentDef, HostBatch, PresentCall } from '../../src/platform/net/protocol';
import starfighter from '../../src/games/starfighter/server';
import starfighterClient from '../../src/games/starfighter/client';
import skyship from '../../src/games/skyship/server';
import skyshipClient from '../../src/games/skyship/client';
import { beaconPad, ISLES } from '../../src/games/skyship/world';
import obby from '../../src/games/obby/server';
import obbyClient from '../../src/games/obby/client';
import heartHunt from '../../src/games/heart-hunt/server';
import heartHuntClient from '../../src/games/heart-hunt/client';
import sandbox from '../../src/games/sandbox/server';
import sandboxClient from '../../src/games/sandbox/client';
import gallery from '../../src/games/gallery/server';
import galleryClient from '../../src/games/gallery/client';
import moves from '../../src/games/moves/server';
import movesClient from '../../src/games/moves/client';
import { check } from './_harness';

const wasm = readFileSync('engine/pkg/voxel_engine_bg.wasm');

/** The fields of an item that are its look (`ItemLook`). */
const LOOK_FIELDS = ['icon', 'hold', 'sounds', 'tracer', 'trail', 'drawIcon'] as const;
/** The engine's own sounds (`audio/sfx.ts`): every screen has them without a definition. */
const ENGINE_SOUNDS = ['hit', 'hurt', 'pickup', 'heal', 'wave', 'victory', 'defeat', 'spawn', 'click', 'countdown', 'lock', 'alarm'];

interface Case {
  server: GameDefinition;
  client: ClientGame;
  /** The kits its client code lists, in order. */
  kits: string[];
  /** Its own voices, defined in its client code. */
  voices: string[];
  /** Its items, each given a look by its client code. */
  items: string[];
  /** Seconds to play (the first `after` into it, a development snippet with `game` and `me`). */
  seconds: number;
  dev?: string[];
  /** Sounds the play should have asked for. */
  heard: string[];
}

const ON_SCREEN = ['sounds.voices', 'firstPerson', 'figures.humanoid'];

const CASES: Record<string, Case> = {
  // The battle: TIEs arrive, fire and howl past; a fighter's blown up near the pilot.
  starfighter: {
    server: starfighter,
    client: starfighterClient,
    kits: ['sounds.voices'],
    voices: ['laser', 'laser_enemy', 'torpedo', 'capital_horn', 'flyby'],
    items: [],
    seconds: 20,
    dev: ['const e = globalThis.__sf?.enemies.find((x) => x.alive); if (e) e.hit(1e6, e.pos); return true;'],
    heard: ['wave', 'laser_enemy'],
  },
  // A beacon lit (its bell).
  skyship: {
    server: skyship,
    client: skyshipClient,
    kits: ON_SCREEN,
    voices: ['bell', 'thud'],
    items: [],
    seconds: 3,
    dev: [`me.teleport(${JSON.stringify(beaconPad(ISLES[0]))}, 0, 0); return true;`],
    heard: ['bell'],
  },
  // The blinking platforms, the cannons; a fall (back at the checkpoint).
  obby: {
    server: obby,
    client: obbyClient,
    kits: ON_SCREEN,
    voices: ['checkpoint', 'boing', 'crumble', 'respawn', 'cannon', 'blink'],
    items: [],
    seconds: 8,
    dev: ['me.teleport({ x: me.position.x, y: -40, z: me.position.z }); return true;'],
    heard: ['blink', 'respawn'],
  },
  // All ten hearts found at once: the win screen names the heart.
  'heart-hunt': {
    server: heartHunt,
    client: heartHuntClient,
    kits: ON_SCREEN,
    voices: [],
    items: ['heart'],
    seconds: 4,
    dev: ["game.items.clearPickups(); for (let i = 0; i < 10; i++) game.items.spawnPickup('heart', { x: me.position.x, y: me.position.y + 0.5, z: me.position.z }); return true;"],
    heard: ['pickup', 'victory'],
  },
  sandbox: { server: sandbox, client: sandboxClient, kits: ['firstPerson', 'figures.humanoid'], voices: [], items: [], seconds: 1, heard: [] },
  gallery: { server: gallery, client: galleryClient, kits: ON_SCREEN, voices: [], items: ['blocky_sword', 'cards'], seconds: 2, heard: [] },
  moves: { server: moves, client: movesClient, kits: ON_SCREEN, voices: [], items: [], seconds: 1, heard: [] },
};

/**
 * The games past Call of Blocky, moved to client code the same way (docs/REDESIGN-CLIENT-SERVER.md,
 * phase 3): each server defines no voice and no item's look, and names no model file in its HUD
 * calls; each game's client code lists the kits it uses, defines its voices and gives its items
 * their looks; and every sound a round of play asks for is one its screens have.
 */
export default function looksGames() {
  for (const [id, c] of Object.entries(CASES)) game(id, c);
}

function game(id: string, c: Case) {
  // A round, as Ann's screen gets it over the wire.
  const host = new GameHost(c.server, { engine: wasm, seed: 7, remote: true, radius: 3, budget: Infinity, dev: true });
  const ann = host.connect('Ann');
  host.command(ann.id, { t: 'start', name: 'Ann' });
  const batches: HostBatch[] = [decode<HostBatch>(encode(ann.batch))];
  const step = (seconds: number) => {
    for (let i = 0; i < seconds * 30; i++) batches.push(decode<HostBatch>(encode(host.step(1 / 30).get(ann.id)!)));
  };
  step(1);
  (c.dev ?? []).forEach((js, i) => {
    host.command(ann.id, { t: 'dev', id: i + 1, js });
    step(0.1);
  });
  step(c.seconds);
  const events = batches.flatMap((b) => b.events);
  const replies = events.flatMap((e) => (e.t === 'reply' ? [e.value as { ok: boolean; error?: string }] : []));
  check(replies.every((r) => r.ok), `${id}: its setup snippets ran: ${JSON.stringify(replies)}`);
  const content = events.flatMap((e) => (e.t === 'content' ? [e.def] : [])) as ContentDef[];
  const calls = events.flatMap((e) => (e.t === 'call' ? [e.call] : [])) as PresentCall[];

  // The server: no voices, no looks, no model files in what it shows.
  check(!content.some((d) => (d.kind as string) === 'sound'), `${id}: the server defines voices: ${content.filter((d) => (d.kind as string) === 'sound').map((d) => (d as { name: string }).name)}`);
  const items = content.filter((d) => d.kind === 'item') as Extract<ContentDef, { kind: 'item' }>[];
  for (const d of items) check(!LOOK_FIELDS.some((k) => k in d.def), `${id}: the server's ${d.name} has look fields: ${Object.keys(d.def)}`);
  check(!/\.(glb|gltf)\b/.test(JSON.stringify(items)) && !/\.(glb|gltf)\b/.test(JSON.stringify(calls.filter((x) => x.target === 'hud'))), `${id}: a model file in its items or HUD calls`);

  // The screen: the definitions, then the client code (the voices kit first, as its kits' setup runs before the game's).
  const kits = (c.client.client.kits ?? []).map((k) => k.name);
  check(kits.join() === c.kits.join(), `${id}: its kits are ${kits.join(', ')}, not ${c.kits.join(', ')}`);
  const screen = new Content();
  for (const d of content) screen.apply(d);
  const voices = new Map<string, SynthVoice>();
  const client = {
    audio: { play() {}, define: (n: string, v: SynthVoice) => voices.set(n, v) },
    items: { look: (i: string, l: ItemLook) => screen.lookItem(i, l), get: (i: string) => screen.items.get(i) },
  } as unknown as Client;
  for (const k of c.client.client.kits ?? []) if (k.name === 'sounds.voices') k.setup?.(client);
  c.client.client.setup?.(client);
  const missing = c.voices.filter((v) => !voices.has(v));
  check(!missing.length, `${id}: its client code doesn't define ${missing.join(', ')}`);
  const item = (i: string) => screen.items.get(i);
  for (const i of c.items) {
    const d = item(i);
    check(!!d && JSON.stringify(d.icon) !== JSON.stringify(PLACEHOLDER_ICON), `${id}: ${i} has a look on the screen: ${JSON.stringify(d?.icon)}`);
  }

  // Every sound asked for is one the screen has; the ones the play should bring, brought.
  const asked = calls.filter((x) => x.target === 'audio' && x.method === 'play');
  const heard = new Set(asked.map((x) => soundOf(x.args[0] as string, x.args[1] as never, item)).flatMap((s) => (s ? [s[0]] : [])));
  const unvoiced = [...heard].filter((n) => !voices.has(n) && !ENGINE_SOUNDS.includes(n));
  check(!unvoiced.length, `${id}: sounds asked for that its screens don't have: ${unvoiced.join(', ')}`);
  const absent = c.heard.filter((n) => !heard.has(n));
  check(!absent.length, `${id}: the round never asked for ${absent.join(', ')} (it asked for ${[...heard].join(', ')})`);

  // Icons it names: drawn from the screen's look.
  const named = calls.filter((x) => x.target === 'hud').flatMap((x) => JSON.stringify(x.args).match(/\{"item":"[^"]+"[^}]*\}/g) ?? []);
  for (const n of named) check(resolveIcon(JSON.parse(n), item) !== null, `${id}: ${n} names an item the screen doesn't have`);

  console.log(`  ${id}: kits ${kits.join(', ') || '(none)'}; ${voices.size} voices on the screen (${c.voices.length} its own), ${c.items.length} looks; ${heard.size} sounds asked for, all voiced${named.length ? `; icons by name: ${[...new Set(named)].join(', ')}` : ''}`);
}
