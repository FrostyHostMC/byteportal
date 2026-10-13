import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Accounts } from '../../src/platform/host/accounts';
import { GameLibrary } from '../../src/platform/host/library';
import { smokeTest } from '../../src/platform/host/packaged';
import { CLOSE_FULL, serve } from '../../src/platform/host/server';
import { decode, encode } from '../../src/platform/net/codec';
import type { ClientCommand, ServerWelcome } from '../../src/platform/net/protocol';
import { buildGame } from '../../src/platform/package/build';
import type { MyGames } from '../../src/platform/package/link';
import { zipFolder } from '../../src/platform/package/zip';
import { check, games, roomWorker } from './_harness';

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function until(what: string, ok: () => boolean, ms = 20000) {
  for (const t0 = Date.now(); !ok(); await wait(50)) if (Date.now() - t0 > ms) throw new Error(`timed out: ${what}`);
}

/** A game of four files (its id in its meta), padded with `pad` bytes of picture. */
function tiny(root: string, id: string, pad = 0): string {
  const dir = join(root, id);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'meta.ts'), `import { defineMeta } from '@platform';\n${pad ? "import cover from './cover.png?url';\n" : ''}export default defineMeta({ id: '${id}', title: 'Tiny ${id}'${pad ? ', cover' : ''} });\n`);
  writeFileSync(join(dir, 'shared.ts'), `import { defineShared } from '@platform';\nimport meta from './meta';\nexport const shared = defineShared({ ...meta, world: { terrain: 'void' } });\n`);
  writeFileSync(join(dir, 'server.ts'), `import { defineServer } from '@platform';\nimport { shared } from './shared';\nexport default defineServer(shared, {});\n`);
  writeFileSync(join(dir, 'client.ts'), `import { defineClient } from '@platform/client';\nimport { shared } from './shared';\nexport default defineClient(shared);\n`);
  if (pad) writeFileSync(join(dir, 'cover.png'), Buffer.alloc(pad, id.length));
  return dir;
}

/** A socket to a game: welcomed, or turned away (and why). */
function join_(port: number, game: string) {
  const ws = new WebSocket(`ws://localhost:${port}/${game}`);
  const s = { welcome: null as ServerWelcome | null, closed: null as { code: number; reason: string } | null };
  ws.onmessage = (e) => {
    const m = decode<ServerWelcome | { t?: undefined }>(String(e.data));
    if (m.t === 'welcome') ((s.welcome = m), ws.send(encode({ t: 'start', name: 'P' } satisfies ClientCommand)));
  };
  ws.onclose = (e) => (s.closed = { code: e.code, reason: e.reason });
  return { s, close: () => ws.close() };
}

/**
 * Open uploads (docs/PROPOSAL-OPEN-UPLOADS.md, stage 4): with `UPLOADERS=*` anyone signed in may
 * upload, if their Discord account is a week old; they accept the upload terms first; within limits
 * (games they create, room on disk, uploads an hour), which deleting a game for good frees and
 * admins don't have; uploaded games' rooms are a pool of their own, never the built-in games' room.
 */
export default async function openUploads() {
  const dir = mkdtempSync(join(tmpdir(), 'blockyard-open-'));
  const wasm = readFileSync('engine/pkg/voxel_engine_bg.wasm');
  const accounts = Accounts.open(':memory:');
  // A Discord id is a snowflake: its creation time in its top bits. An old account, and one made today.
  const old = accounts.fromDiscord({ id: '87198861512146944', username: 'ollie' });
  const fresh = accounts.fromDiscord({ id: String((BigInt(Date.now() - 1420070400000) << 22n) | 1n), username: 'newbie' });
  const boss = accounts.fromDiscord({ id: '112164261760876544', username: 'boss' });
  const tok = (a: { id: string }) => accounts.newUploadToken(a.id);
  const [oldT, freshT, bossT] = [tok(old), tok(fresh), tok(boss)];
  const publicUrl = 'http://players.example';
  const library = GameLibrary.open({ root: join(dir, 'games'), publicUrl, platform: 'test', taken: () => false, build: (folder, out, id) => buildGame(folder, { out, id }), smoke: (d) => smokeTest(d, wasm, { publicUrl, seconds: 1 }) });
  const srv = await serve({
    games: [games.find((g) => g.id === 'heart-hunt')!],
    library,
    accounts,
    uploaders: ['*'],
    admins: ['112164261760876544'],
    uploadTerms: { version: 1, url: 'https://blockyard.example/upload-terms.html' },
    uploadLimits: { games: 2, bytes: 120 * 1024, perHour: 6, minAgeDays: 7 },
    limits: { uploadedRooms: 1 },
    port: 0,
    seed: 1,
    wasm,
    worker: roomWorker,
    log: () => {},
  });
  const base = `http://localhost:${srv.port}`;
  const up = (token: string, folder: string) => fetch(`${base}/g`, { method: 'POST', body: zipFolder(folder) as BodyInit, headers: { Authorization: `Bearer ${token}` } }).then(async (r) => ({ status: r.status, body: (await r.json()) as { error?: string; problems?: string[]; id?: string } }));
  const mine = (token: string) => fetch(`${base}/g/mine`, { headers: { Authorization: `Bearer ${token}` } }).then((r) => r.json() as Promise<MyGames>);
  const why = (r: { body: { error?: string; problems?: string[] } }) => `${r.body.error ?? ''} ${(r.body.problems ?? []).join(' ')}`;
  try {
    // Anyone signed in, but not a Discord account made today.
    const newbie = await up(freshT, tiny(dir, 'newbies'));
    check(newbie.status === 403 && why(newbie).includes('newer than 7 days'), `a new Discord account waits: ${why(newbie)}`);
    const n = await mine(freshT);
    check(n.open && !n.uploader && n.why?.includes('newer than'), 'its page says why');

    // The terms first.
    const unaccepted = await up(oldT, tiny(dir, 'ollie-one'));
    check(unaccepted.status === 403 && why(unaccepted).includes('upload terms'), `the terms first: ${why(unaccepted)}`);
    let m = await mine(oldT);
    check(m.uploader && m.terms?.accepted === false && m.terms.url.endsWith('/upload-terms.html'), 'its page asks');
    const accept = (version: number) => fetch(`${base}/uploads/terms`, { method: 'POST', body: JSON.stringify({ version }), headers: { Authorization: `Bearer ${oldT}` } });
    check((await accept(0)).status === 400, 'out-of-date terms refused');
    check((await accept(1)).ok && (await mine(oldT)).terms?.accepted === true, 'accepted');

    // Within the limits: two games, then a third is refused; a new version of one isn't a new game.
    check((await up(oldT, tiny(dir, 'ollie-one'))).status === 201, 'first game');
    check((await up(oldT, tiny(dir, 'ollie-two'))).status === 201, 'second game');
    const third = await up(oldT, tiny(dir, 'ollie-three'));
    check(third.status === 403 && why(third).includes('the most is 2'), `a third game: ${why(third)}`);
    writeFileSync(join(dir, 'ollie-one', 'client.ts'), `${readFileSync(join(dir, 'ollie-one', 'client.ts'), 'utf8')}\n// v2\n`);
    check((await up(oldT, join(dir, 'ollie-one'))).status === 201, 'a new version of a game is fine');
    m = await mine(oldT);
    check(m.limits?.usedGames === 2 && m.limits.games === 2 && m.limits.usedBytes > 0, `usage: ${JSON.stringify(m.limits)}`);
    // Deleting one for good makes room.
    check((await fetch(`${base}/g/ollie-two?forever=1`, { method: 'DELETE', headers: { Authorization: `Bearer ${oldT}` } })).ok && !library.record('ollie-two'), 'deleted for good');
    check((await up(oldT, tiny(dir, 'ollie-three'))).status === 201, 'and the third fits now');
    // Room on disk: a game with a big picture doesn't fit in 120 KB.
    const big = await up(oldT, tiny(dir, 'ollie-three', 100 * 1024));
    check(big.status === 403 && why(big).includes('of 120 KB'), `too big for the room left: ${why(big)}`);
    // An hour's uploads: six at most, counting every attempt past the gate (six so far: the seventh waits).
    const hourly = await up(oldT, tiny(dir, 'ollie-four'));
    check(hourly.status === 429 && why(hourly).includes('this hour'), `the hourly limit: ${why(hourly)}`);

    // The admin has no limits and no terms to accept.
    for (const id of ['boss-one', 'boss-two', 'boss-three']) check((await up(bossT, tiny(dir, id))).status === 201, `the admin: ${id}`);
    check((await mine(bossT)).limits === null, 'no limits shown for the admin');

    // A pool of one uploaded room: a second uploaded game waits; the built-in game doesn't.
    const a = join_(srv.port, 'ollie-one');
    await until('the first uploaded room', () => !!a.s.welcome);
    const b = join_(srv.port, 'boss-one');
    await until('the second turned away', () => b.s.closed !== null);
    check(b.s.closed?.code === CLOSE_FULL && b.s.closed.reason.includes('Uploaded games are full'), `the pool is full: ${JSON.stringify(b.s.closed)}`);
    const h = join_(srv.port, 'heart-hunt');
    await until('the built-in game', () => !!h.s.welcome || h.s.closed !== null);
    check(!!h.s.welcome, 'the built-in game still starts');
    a.close();
    h.close();
    console.log('  open uploads: anyone signed in (a week-old Discord account), terms first, games/room/hourly limits (deleting frees room), admins exempt, a pool for uploaded rooms');
  } finally {
    await srv.close();
    rmSync(dir, { recursive: true, force: true });
  }
}
