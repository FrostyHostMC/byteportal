import { readFileSync } from 'node:fs';
import { GameHost } from '../../src/platform/host/game';
import type { HostEvent } from '../../src/platform/net/protocol';
import { check, games } from './_harness';

type Member = { player: { name: string } | null; body: unknown; out: boolean };
type Team = { color: string; members: Member[]; bed: boolean; eliminated: boolean };
type Entry = { label: string; detail?: string; active?: boolean; disabled?: boolean; onSelect?: { $cb: number } };
type Menu = { title?: string; subtitle?: string; sections?: { title?: string; entries: Entry[] }[] };
type Bw = { match: { teams: Team[]; lobby: boolean; size: number; over: boolean; map: { id: string; center: { x: number; y: number; z: number }; lobby: { feet: number; spawn: { x: number; y: number; z: number }; pads: { color: string; x: number; z: number }[] } } } };

const wasm = readFileSync('engine/pkg/voxel_engine_bg.wasm');

/**
 * Bed Wars' lobby deciding the match: a public one sizes the teams to fit everyone and fills the
 * rest with bots when its countdown runs out; a room of one's own waits till everyone's ready, and
 * plays with the size and bots its people chose (no bots: the teams nobody's on are out from the start).
 */
export default function bedwarsLobby() {
  publicLobby();
  ownRoom();
}

function open(room?: string) {
  const def = games.find((g) => g.id === 'bedwars')!;
  const host = new GameHost(def, { engine: wasm, seed: 4, remote: true, radius: 4, budget: Infinity, cheats: true, room });
  const bw = (globalThis as unknown as { __bw: Bw }).__bw;
  const events = new Map<string, HostEvent[]>();
  const step = (n = 1) => {
    for (let i = 0; i < n; i++) for (const [id, b] of host.step(1 / 30)) events.set(id, [...(events.get(id) ?? []), ...b.events]);
  };
  const join = (name: string) => {
    const c = host.connect(name);
    host.command(c.id, { t: 'start' });
    return c.id;
  };
  const menu = (id: string): (Menu & { id: number }) | null => {
    let m = null as (Menu & { id: number }) | null;
    for (const e of events.get(id) ?? []) {
      if (e.t !== 'call' || e.call.target !== 'hud') continue;
      const [mid, o] = e.call.args as [number, Menu];
      if (e.call.method === 'menu') m = o.title === 'Bed Wars lobby' ? { ...o, id: mid } : m;
      else if (e.call.method === 'menuUpdate' && m?.id === mid) m = { ...m, ...o };
      else if (e.call.method === 'menuClose' && m?.id === mid) m = null;
    }
    return m;
  };
  const entry = (id: string, label: string) => menu(id)?.sections?.flatMap((s) => s.entries).find((e) => e.label === label);
  const click = (id: string, label: string) => {
    const e = entry(id, label);
    check(e?.onSelect, `${label} is on the lobby menu: ${JSON.stringify(menu(id)?.sections?.map((s) => s.entries.map((x) => x.label)))}`);
    host.command(id, { t: 'message', msg: { t: 'callback', player: id, id: e!.onSelect!.$cb } });
    step(2);
  };
  const seats = () => bw.match.teams.map((t) => `${t.color}:${t.members.map((m) => m.player?.name ?? (m.body ? 'bot' : '-')).join(',')}`).join(' ');
  const calls = (id: string, method: string) => (events.get(id) ?? []).flatMap((e) => (e.t === 'call' && e.call.method === method ? [e.call.args] : []));
  return { host, bw, step, join, menu, entry, click, seats, calls };
}

function publicLobby() {
  const { bw, step, join, seats, host } = open();
  const lobbyMap = bw.match.map.id;
  const names = ['Ann', 'Bob', 'Cat', 'Dan', 'Eve'];
  for (const n of names) join(n);
  step(30 * 25);
  check(bw.match.lobby, 'still counting down after 25 s');
  step(30 * 7);
  check(!bw.match.lobby, 'the match starts once the 30 s are out');
  const humans = bw.match.teams.map((t) => t.members.filter((m) => m.player).length);
  const bots = bw.match.teams.reduce((n, t) => n + t.members.filter((m) => !m.player && m.body).length, 0);
  check(bw.match.size === 2 && humans.join() === '2,1,1,1' && bots === 3, `five people: two a team, spread out, bots in the rest: ${seats()}`);
  // The match is on the next map, far from the lobby's: its own lobby box goes as its chunks load.
  const map = bw.match.map;
  check(map.id !== lobbyMap, `on to the next map: ${lobbyMap} -> ${map.id}`);
  const ann = host.sim.players.find((p) => p.name === 'Ann')!.api;
  ann.teleport({ x: map.center.x, y: map.center.y + 20, z: map.center.z });
  step(30 * 2);
  const floor = map.lobby.spawn;
  const left = host.sim.ctx.world.getBlock(Math.floor(floor.x), floor.y - 1, Math.floor(floor.z));
  check(left === 0, `no lobby box over the match: ${left}`);
  console.log(`  public: five people, nobody picking, 30 s: ${seats()}`);
}

function ownRoom() {
  const { bw, step, join, click, entry, seats, calls, host } = open('abcd1234');
  const ann = join('Ann');
  const bob = join('Bob');
  step(30 * 40);
  check(bw.match.lobby, 'a room of one’s own waits for people to be ready');
  // Ann gets ready; Bob changes the bots, and Ann has to say so again.
  click(ann, 'Ready');
  check(entry(ann, 'Ready!')?.active, 'Ann is ready');
  click(bob, 'No bots');
  check(entry(ann, 'No bots')?.active && !entry(ann, 'Ready!'), 'Bob’s setting shows on Ann’s menu, and she’s not ready any more');
  click(bob, 'Solos');
  // Solos: Ann takes Red, and Red is full for Bob, on the menu and on its pad.
  click(ann, 'Red');
  check(entry(bob, 'Red')?.disabled && entry(bob, 'Red')?.detail === 'Full', `Red full on Bob's menu: ${JSON.stringify(entry(bob, 'Red'))}`);
  const lobby = bw.match.map.lobby;
  const red = lobby.pads.find((d) => d.color === 'red')!;
  host.sim.players.find((p) => p.name === 'Bob')!.api.teleport({ x: red.x + 0.5, y: lobby.feet, z: red.z + 0.5 });
  step(10);
  check(!entry(ann, 'Red')?.detail?.includes('Bob') && (calls(bob, 'toast').filter((a) => a[0] === 'Red is full').length === 1), 'the pad turns Bob away, once');
  click(ann, 'Ready');
  click(bob, 'Ready');
  step(30 * 6);
  check(!bw.match.lobby, 'everyone ready: it starts');
  check(seats() === 'red:Ann blue:Bob green:- yellow:-', `solos, no bots: ${seats()}`);
  const [, , green, yellow] = bw.match.teams;
  check(green.eliminated && yellow.eliminated && !green.bed && !yellow.bed, 'the empty teams are out from the start');
  const played = seats();
  // Bob's bed goes, then Bob: Ann wins.
  host.command(ann, { t: 'exec', id: 1, line: 'bw bed blue' });
  step(3);
  const pb = host.sim.players.find((p) => p.name === 'Bob')!;
  pb.api.damage(1000, { source: 'world', knockback: 0 });
  step(70);
  const title = (id: string) => (calls(id, 'screen').at(-1)?.[1] as { title?: string } | undefined)?.title;
  check(bw.match.over && title(ann) === 'VICTORY!' && title(bob) === 'GAME OVER', `Ann wins: ${title(ann)}, Bob: ${title(bob)}`);
  check(host.sim.players.find((p) => p.name === 'Ann')!.api.frozen, 'everyone stays put for the results');
  // Back in the lobby, the room keeps its settings.
  step(30 * 13);
  check(bw.match.lobby && entry(ann, 'No bots')?.active && entry(ann, 'Solos')?.active, 'back in the lobby, the settings kept');
  console.log(`  own room: waits for ready, settings unready everyone, solos with no bots: ${played}`);
}
