import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Accounts } from '../../src/platform/host/accounts';
import { ErrorLog } from '../../src/platform/host/errors';
import { GameLibrary } from '../../src/platform/host/library';
import { smokeTest } from '../../src/platform/host/packaged';
import { serve } from '../../src/platform/host/server';
import { decode, encode } from '../../src/platform/net/codec';
import type { ClientCommand, ServerWelcome } from '../../src/platform/net/protocol';
import { buildGame } from '../../src/platform/package/build';
import type { ErrorIssueView } from '../../src/platform/package/link';
import { check, roomWorker } from './_harness';

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function until(what: string, ok: () => boolean, ms = 20000) {
  for (const t0 = Date.now(); !ok(); await wait(50)) if (Date.now() - t0 > ms) throw new Error(`timed out: ${what}`);
}

/**
 * Error tracking (host/errors.ts): reports alike grouped as one issue (numbers and ids aside),
 * counted, resolved and back again when they recur; a screen's stack put back into an uploaded
 * game's own files from its source map; a room's errors kept as its game's; screens' reports taken
 * from any page, a few a minute; an uploaded game's owners see its errors, the admin every one.
 */
export default async function errors() {
  const dir = mkdtempSync(join(tmpdir(), 'blockyard-errors-'));
  const wasm = readFileSync('engine/pkg/voxel_engine_bg.wasm');
  const publicUrl = 'http://players.example';
  try {
    const library = GameLibrary.open({ root: join(dir, 'games'), publicUrl, platform: 'test', taken: () => false, build: (folder, out, id) => buildGame(folder, { out, id }), smoke: (d) => smokeTest(d, wasm, { publicUrl, seconds: 1 }) });
    const log = ErrorLog.open(join(dir, 'errors.sqlite'), { library });

    // Grouped: the same error with other numbers is one issue; another is another.
    const a = await log.record({ source: 'frame', message: 'TypeError: cannot read x of chunk 41', stack: 'TypeError\n    at mesh (http://site.example/a.js:1:200)', game: 'golf' });
    const b = await log.record({ source: 'frame', message: 'TypeError: cannot read x of chunk 9007', stack: 'TypeError\n    at mesh (http://site.example/a.js:1:200)', game: 'golf' });
    const c = await log.record({ source: 'frame', message: 'RangeError: too far', game: 'golf' });
    check(a === b && a !== c, 'alike grouped, others apart');
    let golf = log.issues({ game: 'golf' });
    check(golf.length === 2 && golf.find((i) => i.id === a)?.count === 2, `counted: ${golf.map((i) => i.count)}`);
    log.resolve(a);
    check(log.issues({ game: 'golf' }).length === 1 && log.counts().get('golf') === 1, 'resolved');
    await log.record({ source: 'frame', message: 'TypeError: cannot read x of chunk 3', stack: 'TypeError\n    at mesh (http://site.example/a.js:1:200)', game: 'golf' });
    golf = log.issues({ game: 'golf' });
    check(golf.some((i) => i.id === a && !i.resolved && i.count === 3), 'back again when it recurs');

    // A screen's stack in an uploaded game's own files (its client code's source map).
    const up = await library.install('src/games/obby', 'local', 'obby-err');
    check(up.ok, 'an uploaded game');
    const v = library.current('obby-err')!;
    const client = readFileSync(join(v.dir, 'client.js'), 'utf8').split('\n');
    const line = client.findIndex((l) => l.includes('defineSounds')) + 1;
    const column = client[line - 1].indexOf('defineSounds') + 1;
    const mapped = await log.symbolicate(`TypeError: x\n    at defineSounds (${publicUrl}/g/obby-err/${v.version}/client.js:${line}:${column})`);
    check(/client\/sounds\.ts:\d+:\d+|client\.ts:\d+:\d+/.test(mapped) && !mapped.includes('client.js:'), `in its own files: ${mapped.split('\n')[1]}`);
    log.close();

    // On a server: a room's error, kept as its game's; screens' reports; who sees what.
    const accounts = Accounts.open(':memory:');
    const owner = accounts.fromDiscord({ id: '1', username: 'owner' });
    const other = accounts.fromDiscord({ id: '2', username: 'other' });
    const boss = accounts.fromDiscord({ id: '3', username: 'boss' });
    const [ownerT, otherT, bossT] = [owner, other, boss].map((x) => accounts.newUploadToken(x.id));
    const slog = ErrorLog.open(join(dir, 'server-errors.sqlite'), { library });
    const srv = await serve({ games: [], library, errors: slog, accounts, uploaders: ['1', '2'], admins: ['3'], port: 0, seed: 1, wasm, worker: roomWorker, log: () => {} });
    const base = `http://localhost:${srv.port}`;
    try {
      // A game that throws once a player is in (after its smoke test).
      const g = join(dir, 'oops');
      mkdirSync(g, { recursive: true });
      writeFileSync(join(g, 'meta.ts'), `import { defineMeta } from '@platform';\nexport default defineMeta({ id: 'oops', title: 'Oops' });\n`);
      writeFileSync(join(g, 'shared.ts'), `import { defineShared } from '@platform';\nimport meta from './meta';\nexport const shared = defineShared({ ...meta, world: { terrain: 'void' } });\n`);
      writeFileSync(join(g, 'server.ts'), `import { defineServer } from '@platform';\nimport { shared } from './shared';\nexport default defineServer(shared, { update(game) { if (game.players.some((p) => p.name === 'Boom')) throw new Error('kaboom in update'); } });\n`);
      writeFileSync(join(g, 'client.ts'), `import { defineClient } from '@platform/client';\nimport { shared } from './shared';\nexport default defineClient(shared);\n`);
      check((await library.install(g, owner.id)).ok, 'the game that throws, uploaded by its owner');
      const ws = new WebSocket(`ws://localhost:${srv.port}/oops`);
      ws.onmessage = (e) => {
        const m = decode<ServerWelcome | { t?: undefined }>(String(e.data));
        if (m.t === 'welcome') ws.send(encode({ t: 'start', name: 'Boom' } satisfies ClientCommand));
      };
      await until('the room error kept', () => slog.issues({ game: 'oops' }).some((i) => i.source === 'room' && i.message.includes('kaboom')));
      ws.close();
      const roomIssue = slog.issues({ game: 'oops' }).find((i) => i.source === 'room')!;
      check(roomIssue.count >= 1 && /server\.ts:\d+:\d+/.test(roomIssue.stack) && !roomIssue.stack.includes('/Users/') && !roomIssue.stack.includes('/var/'), `a room's error, in the game's own file and no paths of the server's: ${roomIssue.stack.split('\n').slice(0, 3).join(' | ')}`);

      // A screen's report (a frame's: Origin null, no sign-in), and the limit.
      const report = (body: unknown) => fetch(`${base}/errors`, { method: 'POST', body: JSON.stringify(body), headers: { 'Content-Type': 'text/plain', Origin: 'null' } });
      const sent = await report({ source: 'frame', message: 'ReferenceError: hud is not defined', stack: 'ReferenceError\n    at x (blockyard://oops/client.ts:3:1)', game: 'oops', url: 'https://blockyard.example/frame.html?game=oops' });
      check(sent.status === 204 && sent.headers.get('access-control-allow-origin') === '*', 'a frame may report');
      await until('the report kept', () => slog.issues({ game: 'oops' }).some((i) => i.source === 'frame'));
      // The site's page going wrong while the game's on show isn't the game's doing: the admin's only.
      await report({ source: 'page', message: 'TypeError: the shelf fell over', game: 'oops' });
      await until('the page report kept', () => slog.issues({ game: 'oops' }).some((i) => i.source === 'page'));
      let limited = 0;
      for (let i = 0; i < 31; i++) if ((await report({ source: 'page', message: `spam ${i}` })).status === 429) limited++;
      check(limited >= 1, `a few a minute: ${limited} turned away`);

      // Who sees what: the owner their game's; not someone else; the admin everything.
      const as = (token: string, path: string) => fetch(`${base}${path}`, { headers: { Authorization: `Bearer ${token}` } });
      const mine = (await (await as(ownerT, '/g/oops/errors')).json()) as { issues: ErrorIssueView[] };
      check(mine.issues.length === 2 && mine.issues.some((i) => i.source === 'room') && mine.issues.some((i) => i.source === 'frame'), `the owner sees theirs: ${mine.issues.map((i) => i.source)}`);
      check((await as(otherT, '/g/oops/errors')).status === 403, "someone else doesn't");
      const all = (await (await as(bossT, '/admin/errors')).json()) as { issues: ErrorIssueView[] };
      check(all.issues.length >= 3 && all.issues.some((i) => i.message.startsWith('spam')), `the admin sees all: ${all.issues.length}`);
      const myGames = (await (await as(ownerT, '/g/mine')).json()) as { games: { id: string; errors: number }[] };
      check(myGames.games.find((x) => x.id === 'oops')?.errors === 2, 'Your games counts them');
      const fix = await fetch(`${base}/g/oops/errors/${roomIssue.id}`, { method: 'POST', headers: { Authorization: `Bearer ${ownerT}` } });
      check(fix.ok && slog.issues({ game: 'oops', own: true }).length === 1, 'the owner resolves one');
      console.log('  errors: grouped, counted, resolved and back; screens\' stacks in the game\'s own files; a room\'s error kept; reports from any page, limited; owners see theirs, the admin all');
    } finally {
      await srv.close();
      slog.close();
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
