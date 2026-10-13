import { readFileSync } from 'node:fs';
import { deflateRawSync } from 'node:zlib';
import type { Player } from '../../src/platform';
import { ReplayPlayback } from '../../src/platform/client/replay';
import { GameHost } from '../../src/platform/host/game';
import { encode } from '../../src/platform/net/codec';
import { FrameReader } from '../../src/platform/net/delta';
import type { HostEvent, ReplayWire } from '../../src/platform/net/protocol';
import type { SimFrame } from '../../src/platform/sim/sim';
import { check, games, launch } from './_harness';

const wasm = readFileSync('engine/pkg/voxel_engine_bg.wasm');
const cob = () => games.find((g) => g.id === 'callofblocky')!;
const DT = 1 / 30;

/**
 * Replays (`game.replay`): the room's rolling history stays bounded (seconds and bytes); `show`
 * sends the window asked for to that player alone, and its frames read back exactly as they went
 * out (the client's playback too); what it costs to send; Call of Blocky's kill cam in a bot
 * match (it comes on a death by someone, and ends in a respawn), skipping it, and a player who
 * leaves while theirs plays. Clips: a stretch kept past the history, and shown later after a
 * freeze-frame (`hold`).
 */
export default function replay() {
  history();
  clips();
  killcam();
  skipping();
  leaving();
}

/** Replays playing in a room. */
const playing = (host: GameHost) => host.replays.count;

/** A room of Call of Blocky on a server's clock: people who join, and each step's batches kept. */
function room(seed: number) {
  const host = new GameHost(cob(), { engine: wasm, seed, remote: true, radius: 5, budget: Infinity, player: { id: 'p1', name: 'Player' } });
  const game = host.sim.ctx;
  const events = new Map<string, HostEvent[]>();
  /** Each step's frame as it went out, by host time. */
  const sent = new Map<number, SimFrame>();
  const step = (n = 1) => {
    for (let i = 0; i < n; i++) {
      for (const [id, b] of host.step(DT)) {
        const list = events.get(id) ?? [];
        list.push(...b.events);
        events.set(id, list);
        for (const e of b.events) if (e.t === 'error') throw new Error(`the game threw: ${e.text}`);
      }
      sent.set(host.sim.time, host.frames.current!);
    }
  };
  const join = (name: string) => {
    const c = host.connect(name);
    host.command(c.id, { t: 'start' });
    return c.id;
  };
  const player = (id: string) => game.players.find((p) => p.id === id)!;
  const replays = (id: string) => (events.get(id) ?? []).filter((e): e is Extract<HostEvent, { t: 'replay' }> => e.t === 'replay');
  return { host, game, events, sent, step, join, player, replays };
}

function history() {
  const r = room(11);
  const ann = r.join('Ann');
  const bob = r.join('Bob');
  // (Nobody gets them meanwhile: their kill cams would take these replays' places.)
  r.step(2);
  for (const id of [ann, bob]) r.player(id).protect(1e6);
  // (Call of Blocky keeps 16 s, for its Play of the Game: 8 here, the platform's default.)
  check(Math.abs(r.game.replay.seconds - r.host.replays.history.seconds) < 1e-9 && r.host.replays.history.keep === 16, `Call of Blocky keeps 16 s: ${r.host.replays.history.keep}`);
  r.game.replay.keep(8);
  const t0 = performance.now();
  r.step(30 * 20);
  const ms = (performance.now() - t0) / (30 * 20);
  const h = r.host.replays.history;
  // Bounded: 8 seconds, and a step's worth either side.
  check(h.seconds <= 8 + 1e-6 && h.seconds > 7.9, `the history keeps 8 s: ${h.seconds.toFixed(2)} s`);
  check(h.length <= 8 * 30 + 2, `about 8 s of steps: ${h.length}`);
  const perSecond = h.bytes / h.seconds;
  console.log(`  history: ${h.length} steps over ${h.seconds.toFixed(2)} s, ${(h.bytes / 1024).toFixed(1)} KB (${(perSecond / 1024).toFixed(1)} KB/s, ${r.game.players.length} fighters); a step ${ms.toFixed(2)} ms with it`);

  // Show Ann the last 5 seconds through Bob's eyes: to her alone.
  r.events.clear();
  const annP = r.player(ann);
  const bobP = r.player(bob);
  let ended: { skipped: boolean } | null = null;
  const t1 = performance.now();
  const shown = r.game.replay.show(annP, { from: 5, seconds: 5, follow: bobP, label: 'test', data: { note: 'hi' }, onEnd: (e) => (ended = e) });
  const build = performance.now() - t1;
  check(shown && shown.playing, 'the replay is playing');
  check(Math.abs(shown.duration - 5) < DT * 1.5, `5 s long: ${shown.duration.toFixed(3)}`);
  r.step();
  const got = r.replays(ann);
  check(got.length === 1, `Ann got the replay (${got.length})`);
  check(r.replays(bob).length === 0, 'Bob got nothing');
  const wire = got[0].replay;
  check(wire.follow === bob && wire.label === 'test' && (wire.data as { note: string }).note === 'hi', 'through Bob, with its label and data');
  const newest = [...r.sent.keys()].filter((t) => t < r.host.sim.time - 1e-9).pop()!;
  const first = wire.steps[0].t;
  const last = wire.steps[wire.steps.length - 1].t;
  check(Math.abs(first - (newest - 5)) < DT * 1.01 && Math.abs(last - newest) < 1e-6, `the window: ${first.toFixed(3)}..${last.toFixed(3)}, asked ${(newest - 5).toFixed(3)}..${newest.toFixed(3)}`);
  check(wire.steps.length >= 149 && wire.steps.length <= 152, `a step every 1/30 s: ${wire.steps.length}`);

  // The frames read back as they went out: every player where they were, looking where they looked.
  const reader = new FrameReader<SimFrame>();
  let compared = 0;
  for (const st of wire.steps) {
    const f = reader.read(st.f);
    const was = r.sent.get(st.t);
    check(was, `a frame went out at ${st.t}`);
    check(f.players.length === was.players.length, 'the same players');
    for (const p of was.players) {
      const q = f.players.find((x) => x.id === p.id)!;
      check(q && q.x === p.x && q.y === p.y && q.z === p.z && q.view.yaw === p.view.yaw && q.view.pitch === p.view.pitch && q.dead === p.dead, `${p.name} at ${st.t.toFixed(3)} as recorded`);
      check(JSON.stringify(q.hotbar) === JSON.stringify(p.hotbar) && JSON.stringify(q.hand) === JSON.stringify(p.hand), `${p.name}'s hands as recorded`);
      compared++;
    }
  }
  const calls = wire.steps.reduce((n, s) => n + (s.e?.filter((e) => e.t === 'call').length ?? 0), 0);
  const shots = wire.steps.reduce((n, s) => n + (s.e?.filter((e) => e.t === 'call' && e.call.method === 'gun.shot').length ?? 0), 0);
  check(calls > 0, 'what was shown came along');
  // The item kinds' messages come too (the gun kit's shot is how a replay's eyes hear their own gun).
  check(shots > 0, 'the shots came along (gun.shot)');
  check(wire.steps.every((s) => (s.e ?? []).every((e) => e.t !== 'call' || e.call.target !== 'hud')), 'no HUD calls in a replay');

  // The client's playback: its frames at each step's time are the step's, and it ends when it should.
  const play = new ReplayPlayback(wire);
  check(Math.abs(play.duration - 5) < DT * 1.5, 'the playback lasts as long');
  let events = play.advance(0).length;
  let steps = 0;
  while (!play.done) {
    events += play.advance(1 / 60).length;
    const f = play.sample();
    const p = f.players.find((x) => x.id === bob)!;
    check(Number.isFinite(p.x) && Number.isFinite(p.view.yaw), 'a blended frame');
    steps++;
  }
  check(steps >= 299 && steps <= 301, `played for 5 s at 60 frames a second: ${steps}`);
  check(events === wire.steps.reduce((n, s) => n + (s.e?.length ?? 0), 0), `every step's events handed over once: ${events}`);
  const end = play.sample().players.find((x) => x.id === bob)!;
  const lastSent = r.sent.get(last)!.players.find((x) => x.id === bob)!;
  check(Math.abs(end.x - (lastSent.x + lastSent.vx * lastSent.lead)) < 1e-6 && Math.abs(end.z - (lastSent.z + lastSent.vz * lastSent.lead)) < 1e-6, 'it ends where the last frame has Bob');

  // What it costs to send: as JSON, and as the socket's deflate squeezes it.
  const json = encode({ events: [got[0]], time: 0 });
  const deflated = deflateRawSync(Buffer.from(json), { level: 3, memLevel: 7, windowBits: 13 }).length;
  console.log(`  a 5 s replay: built in ${build.toFixed(1)} ms, ${wire.steps.length} steps, ${compared} player frames matched, ${calls} calls (${shots} shots); ${(json.length / 1024).toFixed(1)} KB as JSON, ${(deflated / 1024).toFixed(1)} KB deflated (first frame ${(encode(wire.steps[0].f).length / 1024).toFixed(1)} KB)`);

  // It ends on the server's clock, and Ann's screen hears.
  r.events.clear();
  r.step(Math.ceil(5 / DT) + 2);
  check(ended !== null && !(ended as { skipped: boolean }).skipped, 'onEnd ran, not skipped');
  check(!shown.playing && playing(r.host) === 0, 'nothing playing now');
  check((r.events.get(ann) ?? []).some((e) => e.t === 'replayEnd' && e.id === wire.id), 'Ann heard it end');
  check(!(r.events.get(bob) ?? []).some((e) => e.t === 'replayEnd'), 'Bob heard nothing');

  // Bots have no screen; with nothing kept there's nothing to show.
  const bot = r.game.players.find((p) => p.bot)!;
  check(r.game.replay.show(bot, { from: 2 }) === null, 'no replay for a bot');
  // A byte budget holds too.
  h.maxBytes = 40 * 1024;
  r.step(3);
  check(h.bytes <= 40 * 1024, `held to its bytes: ${h.bytes}`);
  check(h.seconds < 8, `fewer seconds then: ${h.seconds.toFixed(2)}`);
  r.game.replay.keep(0);
  r.step(2);
  check(h.length === 0 && r.game.replay.seconds === 0 && r.game.replay.show(annP, { from: 1 }) === null, 'keep(0) keeps nothing');
  // What keeping it costs a step (the frame is rounded and patched for the socket either way).
  const time = (n: number) => {
    const t = performance.now();
    r.step(n);
    return (performance.now() - t) / n;
  };
  const off = time(150);
  r.game.replay.keep(8);
  h.maxBytes = 4 * 1024 * 1024;
  const on = time(150);
  check(Math.abs(r.game.replay.seconds - 149 / 30) < 1e-6, `recording again: ${r.game.replay.seconds.toFixed(3)} s`);
  console.log(`  a step: ${off.toFixed(3)} ms keeping nothing, ${on.toFixed(3)} ms keeping 8 s`);
  r.host.dispose();
}

/**
 * A clip (`game.replay.clip`): kept as it was when taken, however far the history moves on, and
 * shown to two players at once; its `hold` stands its first frame still before it plays (on the
 * server's clock and the screen's), with nothing it shows handed over till it moves.
 */
function clips() {
  const r = room(12);
  const ann = r.join('Ann');
  const bob = r.join('Bob');
  r.step(2);
  for (const id of [ann, bob]) r.player(id).protect(1e6);
  r.game.replay.keep(4);
  r.step(30 * 5);
  const at = r.game.clock.now;
  const clip = r.game.replay.clip({ from: { at: at - 3 }, seconds: 2 });
  check(clip && Math.abs(clip.seconds - 2) < DT * 1.01 && Math.abs(clip.from - (at - 3)) < DT * 1.01, `a clip of 2 s: ${clip?.from.toFixed(2)}..${clip?.to.toFixed(2)}`);
  check(r.game.replay.clip({ from: { at: at - 3 }, seconds: 0 }) === null, 'nothing in no time');
  // The history moves on well past it.
  r.step(30 * 6);
  check(r.host.replays.history.seconds <= 4 + 1e-6 && r.game.clock.now - clip.from > 8, 'the history has let it go');
  r.events.clear();
  const annP = r.player(ann);
  const bobP = r.player(bob);
  const a = r.game.replay.show(annP, { clip, follow: bobP, hold: 1.5, label: 'clip' });
  const b = r.game.replay.show(bobP, { clip, follow: bobP, hold: 1.5, label: 'clip' });
  check(a && b && Math.abs(a.duration - (1.5 + clip.seconds)) < 1e-6, `held 1.5 s, then 2 s: ${a?.duration.toFixed(3)}`);
  check(Math.abs(a.from - clip.from) < 1e-6 && Math.abs(a.to - clip.to) < 1e-6, 'the stretch the clip holds');
  r.step();
  const wa = r.replays(ann)[0]?.replay;
  const wb = r.replays(bob)[0]?.replay;
  check(wa && wb && wa.hold === 1.5 && wa.steps.length === wb.steps.length && wa.steps.length >= 60, `both got it, ${wa?.steps.length} steps`);
  check(Math.abs(wa.steps[0].t - wa.steps[wa.steps.length - 1].t + clip.seconds) < 1e-6, 'all of it');
  // On the screen: the first frame stands still for the hold, nothing handed over, then it plays.
  const play = new ReplayPlayback(wa);
  const first = JSON.stringify(play.sample());
  check(Math.abs(play.duration - (1.5 + clip.seconds)) < 1e-6 && play.hold === 1.5, 'the playback knows its hold');
  let early = 0;
  for (let i = 0; i < 89; i++) early += play.advance(1 / 60).length;
  check(play.holding && early === 0 && JSON.stringify(play.sample()) === first && Math.abs(play.time - 89 / 60) < 1e-9, `still at ${play.time.toFixed(3)} s: the first frame, nothing shown`);
  let events = 0;
  let frames = 0;
  while (!play.done) {
    events += play.advance(1 / 60).length;
    frames++;
  }
  check(!play.holding && events === wa.steps.reduce((n, s) => n + (s.e?.length ?? 0), 0), `then it plays, everything shown once (${events})`);
  check(Math.abs(frames - (1 + clip.seconds * 60)) <= 1, `for its 2 s: ${frames} frames`);
  // The server ends it on its clock, hold and all.
  r.step(Math.round((1.5 + clip.seconds) * 30) - 3);
  check(a.playing, 'still playing just before its end');
  r.step(4);
  check(!a.playing && !b.playing && playing(r.host) === 0, 'over at its end');
  console.log(`  a clip: ${clip.seconds.toFixed(2)} s kept, shown ${((r.game.clock.now - clip.to) | 0)} s later to two players after a 1.5 s hold`);
  r.host.dispose();
}

/** The local player in a Call of Blocky bot match, killed by a bot: the kill cam, then the respawn. */
function killcam() {
  const h = launch('callofblocky', { seed: 4, radius: 5 });
  const g = h.ctx;
  const me = g.player;
  // Let the match get going (the bots move about, shoot), then die to one of them.
  h.run(6, { dt: DT });
  const out = deathBy(h, 'rifle');
  const { replay: wire, at, killer } = out;
  check(wire.follow === killer.id, `through the killer's eyes (${killer.name})`);
  check(wire.label === 'killcam', 'labelled killcam');
  check(Math.abs(at - 0.5) < 0.07, `it starts half a second after the death: ${at.toFixed(2)} s`);
  const len = wire.steps[wire.steps.length - 1].t - wire.steps[0].t;
  check(Math.abs(len - 4) < 0.07, `4 s of the past: ${len.toFixed(2)}`);
  // It covers the death: the victim alive at its start, dead by its end.
  const reader = new FrameReader<SimFrame>();
  const frames = wire.steps.map((s) => reader.read(s.f));
  const mine = (f: SimFrame) => f.players.find((p) => p.id === me.id)!;
  check(!mine(frames[0]).dead && mine(frames[frames.length - 1]).dead, 'from before the death to after it');
  const data = wire.data as { killer: string; weapon: string };
  check(data.killer === killer.name && data.weapon === 'Big Kahuna', `the killer and their weapon: ${JSON.stringify(data)}`);
  // It plays out, and they respawn with it: 4.5 s after the death (the kill cam's end).
  const death = out.deathTime;
  let respawned = -1;
  let ended = -1;
  for (let i = 0; i < 30 * 8 && respawned < 0; i++) {
    const b = h.step(DT);
    if (ended < 0 && b.events.some((e) => e.t === 'replayEnd' && e.id === wire.id)) ended = h.time - death;
    if (me.alive) respawned = h.time - death;
  }
  check(ended > 0 && Math.abs(ended - 4.5) < 0.07, `the kill cam ended 4.5 s after the death: ${ended.toFixed(2)}`);
  check(respawned > 0 && Math.abs(respawned - 4.5) < 0.07, `respawned as it ended: ${respawned.toFixed(2)} s after the death`);
  console.log(`  kill cam: ${killer.name} killed the player; it showed ${len.toFixed(1)} s of their eyes from ${at.toFixed(2)} s, ${wire.steps.length} steps, ${(encode(wire).length / 1024).toFixed(1)} KB (${(deflateRawSync(Buffer.from(encode(wire)), { level: 3, memLevel: 7, windowBits: 13 }).length / 1024).toFixed(1)} KB deflated); respawned at ${respawned.toFixed(2)} s (was 3 s)`);

  // A natural death in the match: bots shoot it out with the idle player until one gets them.
  let natural: ReplayWire | null = null;
  let by = '';
  g.events.on('playerDeath', (e) => {
    if (e.player === me && (e.source as Player | undefined)?.kind === 'player') by = (e.source as Player).id;
  });
  for (let i = 0; i < 30 * 90 && !natural; i++) {
    const b = h.step(DT);
    for (const e of b.events) if (e.t === 'replay') natural = e.replay;
  }
  if (natural) {
    const n = natural as ReplayWire;
    check(n.follow === by, 'a bot that got them: through its eyes');
    const shots = n.steps.flatMap((s) => s.e ?? []).filter((e) => e.t === 'call' && e.call.method === 'gun.shot' && (e.call.args[0] as { by: string }).by === by).length;
    console.log(`  a death in the match: through ${g.players.find((p) => p.id === by)?.name ?? by}'s eyes, their ${shots} shots in it`);
  } else console.log('  (no bot killed the idle player in 90 s)');
}

/** Kill the local player by a bot (with `weapon`), and step until their kill cam arrives. */
function deathBy(h: ReturnType<typeof launch>, weapon: string) {
  const g = h.ctx;
  const me = g.player;
  const killer = g.players.find((p) => p.bot && p.alive)!;
  check(me.alive && killer, 'someone alive to do it');
  me.damage(1000, { source: killer, weapon, knockback: 0 });
  check(!me.alive, 'the player died');
  const deathTime = h.time;
  let wire: ReplayWire | null = null;
  for (let i = 0; i < 60 && !wire; i++) {
    const b = h.step(DT);
    for (const e of b.events) if (e.t === 'replay') wire = e.replay;
  }
  check(wire, 'a kill cam came');
  return { replay: wire as ReplayWire, at: h.time - deathTime, killer, deathTime };
}

/** Skipping the kill cam: early, the respawn waits for the usual 3 s; after them, it's at once. */
function skipping() {
  const h = launch('callofblocky', { seed: 6, radius: 5 });
  const me = h.ctx.player;
  h.run(3, { dt: DT });
  // Skipped a second in: respawned at the old 3 s.
  let d = deathBy(h, 'smg');
  h.run(0.5, { dt: DT });
  h.send({ t: 'replaySkip', player: '', id: d.replay.id });
  check(playing(h.host) === 0, 'skipped: nothing playing');
  const until = (fn: () => boolean) => {
    for (let i = 0; i < 30 * 8 && !fn(); i++) h.step(DT);
    return h.time - d.deathTime;
  };
  let t = until(() => me.alive);
  check(Math.abs(t - 3) < 0.07, `skipped early: respawned at ${t.toFixed(2)} s (the usual 3)`);
  // Skipped 3.3 s after the death: respawned then.
  h.run(2, { dt: DT });
  d = deathBy(h, 'shotgun');
  h.run(3.3 - (h.time - d.deathTime), { dt: DT });
  h.send({ t: 'replaySkip', player: '', id: d.replay.id });
  t = until(() => me.alive);
  check(Math.abs(t - 3.3) < 0.07, `skipped late: respawned at once, ${t.toFixed(2)} s after the death`);
  // A skip for a replay that isn't playing (or someone else's) changes nothing.
  h.run(2, { dt: DT });
  d = deathBy(h, 'rifle');
  h.send({ t: 'replaySkip', player: '', id: d.replay.id + 100 });
  check(playing(h.host) === 1, 'a wrong id skips nothing');
  t = until(() => me.alive);
  check(Math.abs(t - 4.5) < 0.07, `played out: ${t.toFixed(2)} s`);
  console.log('  skipping: at 1 s respawned at 3 s, at 3.3 s respawned at once');
}

/** A player who leaves while their kill cam plays: it goes with them, and the game carries on. */
function leaving() {
  const r = room(13);
  const ann = r.join('Ann');
  const bob = r.join('Bob');
  r.step(60);
  const annP = r.player(ann);
  // (Bob kept out of harm's way: a bot's kill would give him a kill cam of his own.)
  r.player(bob).protect(9999);
  annP.damage(1000, { source: r.player(bob), weapon: 'rifle', knockback: 0 });
  r.step(20);
  const got = r.replays(ann);
  check(got.length === 1 && got[0].replay.follow === bob, "Ann's kill cam, through Bob's eyes");
  check(r.replays(bob).length === 0, 'Bob got none');
  check(playing(r.host) === 1, 'one playing');
  r.step(30);
  r.host.disconnect(ann);
  check(playing(r.host) === 0, 'gone with her');
  r.step(30 * 6);
  check(!(r.events.get(bob) ?? []).some((e) => e.t === 'replay' || e.t === 'replayEnd'), 'Bob never heard of it');
  check(r.game.players.every((p) => p.id !== ann), 'Ann is gone');
  // Bob is killed by a bot: his own kill cam works on.
  const bot = r.game.players.find((p) => p.bot && p.alive)!;
  r.player(bob).protect(0);
  r.player(bob).damage(1000, { source: bot, weapon: 'smg', knockback: 0 });
  r.step(20);
  check(r.replays(bob).length === 1, 'Bob gets his');
  r.step(30 * 5);
  check(r.player(bob).alive, 'and respawns');
  console.log('  leaving mid-replay: fine');
  r.host.dispose();
}
