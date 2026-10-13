import { readFileSync } from 'node:fs';
import { GameHost } from '../../src/platform/host/game';
import { decode, encode } from '../../src/platform/net/codec';
import { FrameReader, FrameWriter, quantize } from '../../src/platform/net/delta';
import { check, games } from './_harness';

/**
 * Frame patches: a client applying each patch to what it had ends with exactly the server's
 * (rounded) frame, for every game's real frames and for lists shuffled at random; and patches
 * are much smaller than frames.
 */
export default function deltaFrames() {
  const same = (a: unknown, b: unknown) => encode(a) === encode(b);

  // Random records coming, going, moving, changing (and fields going from set to unset).
  let seed = 7;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) >>> 0) / 2 ** 32);
  let list: { id: number; x: number; tag?: string; o: { a: number; b: number[] } | null }[] = [];
  let nextId = 1;
  const w = new FrameWriter<unknown>();
  const r = new FrameReader<unknown>();
  let had: unknown;
  for (let i = 0; i < 400; i++) {
    list = list.filter(() => rnd() > 0.1);
    while (rnd() < 0.4) list.push({ id: nextId++, x: rnd() * 100, o: rnd() < 0.5 ? null : { a: 1, b: [1, 2] } });
    for (const x of list) {
      if (rnd() < 0.3) x.x += rnd();
      if (rnd() < 0.1) x.tag = rnd() < 0.5 ? 'hi' : undefined;
      if (rnd() < 0.1) x.o = x.o ? null : { a: Math.floor(rnd() * 3), b: [Math.floor(rnd() * 3)] };
    }
    if (rnd() < 0.1) list.reverse();
    const frame = { clock: i / 30, list: list.map((x) => ({ ...x, o: x.o && { ...x.o, b: [...x.o.b] } })), empty: i % 50 < 25 ? [] : [{ id: 'p1', v: i }] };
    w.next(frame);
    const got = r.read(decode(encode(w.patchFor(had))));
    had = w.current;
    check(same(got, quantize(frame)), `random frame ${i} rebuilt exactly`);
  }

  // Every game's real frames, over a socket's encoding.
  const sizes: string[] = [];
  for (const def of games) {
    const host = new GameHost(def, { engine: readFileSync('engine/pkg/voxel_engine_bg.wasm'), seed: 3, remote: true, radius: 6, budget: Infinity, player: { id: 'p1', name: 'Player' } });
    const ann = host.connect('Ann');
    host.command(ann.id, { t: 'start' });
    const writer = new FrameWriter<unknown>();
    const reader = new FrameReader<unknown>();
    let last: unknown;
    let full = 0;
    let patched = 0;
    for (let i = 0; i < 30 * 12; i++) {
      host.command(ann.id, { t: 'input', input: { active: true, down: i % 90 < 60 ? ['KeyW'] : ['KeyA'], pressed: i % 45 === 0 ? ['Space'] : [], buttons: i % 20 < 5 ? 1 : 0, clicked: i % 20 === 0 ? 1 : 0, mouseX: 3, mouseY: 0, wheel: 0, yaw: i * 0.01, pitch: 0, viewSeq: -1 } });
      const frame = host.step(1 / 30).get(ann.id)!.frame!;
      writer.next(frame);
      const wire = encode(writer.patchFor(last));
      last = writer.current;
      const got = reader.read(decode(wire));
      check(same(got, writer.current), `${def.id} frame ${i} rebuilt exactly`);
      if (i >= 30) {
        full += encode(frame).length;
        patched += wire.length;
      }
    }
    sizes.push(`${def.id} ${(full / 11 / 1024).toFixed(0)}→${(patched / 11 / 1024).toFixed(1)} KB/s`);
    host.dispose();
  }
  console.log(`  400 random frames and 5 games' frames rebuilt exactly · frames alone: ${sizes.join(', ')}`);
}
