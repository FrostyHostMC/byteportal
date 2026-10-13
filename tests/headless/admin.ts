import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Accounts } from '../../src/platform/host/accounts';
import { GameLibrary } from '../../src/platform/host/library';
import { smokeTest } from '../../src/platform/host/packaged';
import { serve } from '../../src/platform/host/server';
import { decode, encode } from '../../src/platform/net/codec';
import type { ClientCommand, ServerWelcome } from '../../src/platform/net/protocol';
import { buildGame } from '../../src/platform/package/build';
import type { AdminView, DirectoryGame, MyGames } from '../../src/platform/package/link';
import { zipFolder } from '../../src/platform/package/zip';
import { check, roomWorker } from './_harness';

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function until(what: string, ok: () => boolean, ms = 20000) {
  for (const t0 = Date.now(); !ok(); await wait(50)) if (Date.now() - t0 > ms) throw new Error(`timed out: ${what}`);
}

/** A game of four files whose server code is `server` (its rules object). */
function tiny(root: string, id: string, server = '{}'): string {
  const dir = join(root, id);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'meta.ts'), `import { defineMeta } from '@platform';\nexport default defineMeta({ id: '${id}', title: 'Tiny ${id}', tagline: 'A tiny game' });\n`);
  writeFileSync(join(dir, 'shared.ts'), `import { defineShared } from '@platform';\nimport meta from './meta';\nexport const shared = defineShared({ ...meta, world: { terrain: 'void' } });\n`);
  writeFileSync(join(dir, 'server.ts'), `import { defineServer } from '@platform';\nimport { shared } from './shared';\nexport default defineServer(shared, ${server});\n`);
  writeFileSync(join(dir, 'client.ts'), `import { defineClient } from '@platform/client';\nimport { shared } from './shared';\nexport default defineClient(shared);\n`);
  return dir;
}

/**
 * Admin tooling and the community directory (docs/PROPOSAL-OPEN-UPLOADS.md, stage 1): the admin
 * (by Discord id) sees every game, reports and recent activity; approves, declines and takes games
 * off the home page; stops hosting anyone's game; bans an uploader (who then may neither upload nor
 * manage; their games stopped if asked); players report games, guests too. And the watchdog: a room
 * whose game gets stuck in a loop is stopped, its players told.
 */
export default async function admin() {
  const dir = mkdtempSync(join(tmpdir(), 'blockyard-admin-'));
  const wasm = readFileSync('engine/pkg/voxel_engine_bg.wasm');
  const accounts = Accounts.open(':memory:');
  const pat = accounts.fromDiscord({ id: '87198861512146944', username: 'pat' });
  const eve = accounts.fromDiscord({ id: '555', username: 'eve' });
  const fay = accounts.fromDiscord({ id: '666', username: 'fay' });
  const patToken = accounts.newUploadToken(pat.id);
  const eveToken = accounts.newUploadToken(eve.id);
  const fayToken = accounts.newUploadToken(fay.id);
  const publicUrl = 'http://players.example';
  const library = GameLibrary.open({ root: join(dir, 'games'), publicUrl, platform: 'test', taken: () => false, build: (folder, out, id) => buildGame(folder, { out, id }), smoke: (d) => smokeTest(d, wasm, { publicUrl, seconds: 1 }) });
  const srv = await serve({
    games: [],
    library,
    uploaders: ['555', '666'],
    admins: ['87198861512146944'],
    accounts,
    sites: ['https://blockyard.example'],
    port: 0,
    seed: 1,
    wasm,
    worker: (workerData) => roomWorker(workerData),
    stuckAfter: 3,
    log: () => {},
  });
  const base = `http://localhost:${srv.port}`;
  const api = (path: string, token: string | null, body?: unknown, method = body === undefined ? 'GET' : 'POST') =>
    fetch(`${base}${path}`, { method, body: body === undefined ? undefined : typeof body === 'string' || body instanceof Uint8Array ? (body as BodyInit) : JSON.stringify(body), headers: token ? { Authorization: `Bearer ${token}` } : {} }).then(async (r) => ({ status: r.status, body: (await r.json().catch(() => ({}))) as Record<string, unknown> }));
  try {
    // Eve and Fay upload; Eve puts hers in the directory and asks for the home page.
    check((await api('/g', eveToken, zipFolder(tiny(dir, 'eves-game')))).status === 201, "Eve's game up");
    check((await api('/g', fayToken, zipFolder(tiny(dir, 'fays-game')))).status === 201, "Fay's game up");
    check((await api('/g/eves-game/manage', eveToken, { listed: true, home: 'ask' })).status === 200, 'Eve asks for the home page');
    // Only the admin sees the admin view; Pat (an admin, not on the uploaders list) may upload too.
    check((await api('/admin', eveToken)).status === 403 && (await api('/admin', null)).status === 401, 'admins only');
    const mine = (await api('/g/mine', patToken)).body as unknown as MyGames;
    check(mine.admin && mine.uploader, `Pat is the admin: ${JSON.stringify({ admin: mine.admin, uploader: mine.uploader })}`);

    // Reports: signed in or a guest; a flood is turned away.
    check((await api('/g/fays-game/report', fayToken, { reason: '' })).status === 400, 'a report says what');
    check((await api('/g/fays-game/report', null, { reason: 'It shows something nasty' })).status === 201, 'a guest reports');
    check((await api('/g/nope/report', null, { reason: 'x' })).status === 404, 'no such game');
    for (let i = 0; i < 4; i++) await api('/g/eves-game/report', null, { reason: `spam ${i}` });
    check((await api('/g/eves-game/report', null, { reason: 'one too many' })).status === 429, 'five a while at most');

    // The admin's view: every game, waiting reports, activity.
    let view = (await api('/admin', patToken)).body as unknown as AdminView;
    const eves = view.games.find((g) => g.id === 'eves-game');
    check(view.games.length === 2 && eves?.home === 'asked' && eves.reports === 4, `every game: ${JSON.stringify(view.games.map((g) => [g.id, g.home, g.reports]))}`);
    check(view.reports.length === 5 && view.reports.some((r) => r.game === 'fays-game' && r.name === null), `reports: ${view.reports.length}`);
    check(view.activity.some((a) => a.game === 'eves-game' && a.by === 'eve' && a.text.includes('asked for the home page')), `activity: ${JSON.stringify(view.activity.slice(0, 3))}`);
    const resolved = await api(`/admin/reports/${view.reports.find((r) => r.game === 'fays-game')!.id}`, patToken, {});
    check(resolved.status === 200, 'a report resolved');
    view = (await api('/admin', patToken)).body as unknown as AdminView;
    check(view.reports.length === 4, 'one fewer waiting');

    // Approve Eve's for the home page; decline then take off; manage anyone's game.
    check((await api('/g/eves-game/manage', patToken, { home: 'approve' })).status === 200, 'approved');
    let games = ((await api('/games', null)).body as { games: { id: string }[] }).games;
    check(games.some((g) => g.id === 'eves-game'), 'on the home page');
    check((await api('/g/eves-game/manage', patToken, { home: 'remove' })).status === 200, 'taken off');
    games = ((await api('/games', null)).body as { games: { id: string }[] }).games;
    const directory = ((await api('/g/directory', null)).body as unknown as { games: DirectoryGame[] }).games;
    check(!games.some((g) => g.id === 'eves-game') && directory.some((g) => g.id === 'eves-game'), 'off the home page, back in the directory');
    check((await api('/g/eves-game/manage', eveToken, { home: 'ask' })).status === 200 && (await api('/g/eves-game/manage', patToken, { home: 'decline' })).status === 200 && library.record('eves-game')?.home === 'declined', 'asked again, declined');
    check((await api('/g/fays-game/manage', patToken, { listed: true })).status === 200 && library.record('fays-game')?.listed, "the admin manages Fay's game");

    // Ban Fay (stopping her games): she may neither upload nor manage.
    check((await api('/admin/bans', patToken, { account: 'Fay', banned: true, reason: 'nasty game', unhost: true })).body.stopped?.toString() === 'fays-game', 'banned, her game stopped');
    check(library.record('fays-game')?.current === null, 'not hosted');
    const fayUpload = await api('/g', fayToken, zipFolder(tiny(dir, 'fays-other')));
    check(fayUpload.status === 403 && String(fayUpload.body.error).includes('banned'), `she can't upload: ${String(fayUpload.body.error)}`);
    check((await api('/g/fays-game/manage', fayToken, { current: library.record('fays-game')!.versions[0].version })).status === 403, "nor manage hers");
    check((await api('/admin/bans', patToken, { account: pat.id, banned: true })).status === 400, "an admin can't be banned");
    view = (await api('/admin', patToken)).body as unknown as AdminView;
    check(view.bans.length === 1 && view.bans[0].name === 'fay' && view.bans[0].reason === 'nasty game', 'the bans');
    check((await api('/admin/bans', patToken, { account: 'fay', banned: false })).status === 200 && !accounts.banned(fay.id), 'unbanned');

    // The watchdog: a game stuck in a loop (once "Hang" joins) is stopped, its players told.
    check((await api('/g', patToken, zipFolder(tiny(dir, 'stuck', `{ update(game) { if (game.players.some((p) => p.name === 'Hang')) for (;;) {} } }`)))).status === 201, 'a game that gets stuck');
    const ws = new WebSocket(`ws://localhost:${srv.port}/stuck`);
    let closed: { code: number; reason: string } | null = null;
    ws.onmessage = (e) => {
      const m = decode<ServerWelcome | { t?: undefined }>(String(e.data));
      if (m.t === 'welcome') ws.send(encode({ t: 'start', name: 'Hang' } satisfies ClientCommand));
    };
    ws.onclose = (e) => (closed = { code: e.code, reason: e.reason });
    await until('the stuck room stopped', () => closed !== null, 20000);
    check((closed as { code: number; reason: string } | null)?.reason === 'The game stopped responding', `told: ${JSON.stringify(closed)}`);
    await until('the room gone', () => srv.rooms === 0, 15000);
    console.log('  admin: every game, reports (guests too, five a while), approve/decline/take off, manage anyone\'s, bans (their games stopped), activity; the watchdog stops a stuck room');
  } finally {
    await srv.close();
    rmSync(dir, { recursive: true, force: true });
  }
}
