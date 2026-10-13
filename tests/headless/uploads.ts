import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Worker } from 'node:worker_threads';
import { Accounts } from '../../src/platform/host/accounts';
import { GameLibrary, smokeInThread } from '../../src/platform/host/library';
import type { SmokeWorkerData } from '../../src/platform/host/room-worker';
import { CLOSE_UNKNOWN, serve } from '../../src/platform/host/server';
import { decode, encode } from '../../src/platform/net/codec';
import type { ClientCommand, ServerWelcome } from '../../src/platform/net/protocol';
import { buildGame } from '../../src/platform/package/build';
import type { DirectoryGame, MyGames, PackageEntry } from '../../src/platform/package/link';
import { zipFolder } from '../../src/platform/package/zip';

import { check, roomWorker } from './_harness';

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
const SITE = 'https://blockyard.example';

/** A player's socket: its welcome, and how many batches it has had. */
function player(port: number, path: string) {
  const ws = new WebSocket(`ws://localhost:${port}/${path}`);
  const state = { welcome: null as ServerWelcome | null, batches: 0, closed: null as number | null };
  ws.onmessage = (e) => {
    const m = decode<ServerWelcome | { t?: undefined }>(String(e.data));
    if (m.t === 'welcome') {
      state.welcome = m;
      ws.send(encode({ t: 'start', name: 'Player' } satisfies ClientCommand));
    } else state.batches++;
  };
  ws.onclose = (e) => (state.closed = e.code);
  return { state, close: () => ws.close() };
}

async function until(what: string, ok: () => boolean, ms = 30000) {
  for (const t0 = Date.now(); !ok(); await wait(50)) if (Date.now() - t0 > ms) throw new Error(`timed out: ${what}`);
}

/**
 * Uploads (docs/PROPOSAL-UPLOADS.md, phase 2), on a server that isn't for development: only its
 * uploaders, with upload tokens, may upload; a game is built, smoke-tested in a thread of its own
 * and hosted, not listed; ids are first come, first served; a new version is current for new rooms
 * while a running room keeps its own (and its screens load that one's code); owners list, roll back,
 * add owners and stop hosting; the library outlasts the server.
 */
export default async function uploads() {
  const dir = mkdtempSync(join(tmpdir(), 'blockyard-uploads-'));
  const wasm = readFileSync('engine/pkg/voxel_engine_bg.wasm');
  const accounts = Accounts.open(':memory:');
  const ann = accounts.fromDiscord({ id: '111', username: 'ann' });
  const bob = accounts.fromDiscord({ id: '222', username: 'bob' });
  const cy = accounts.fromDiscord({ id: '333', username: 'cy' });
  const annToken = accounts.newUploadToken(ann.id);
  const bobToken = accounts.newUploadToken(bob.id);
  const cyToken = accounts.newUploadToken(cy.id);
  // Dee is an admin (by Discord id), not on the list of uploaders.
  const dee = accounts.fromDiscord({ id: '444', username: 'dee' });
  const deeToken = accounts.newUploadToken(dee.id);
  const publicUrl = 'http://players.example';
  const startWorker = (workerData: unknown) => roomWorker(workerData);
  const libraryAt = join(dir, 'games');
  const open = () =>
    GameLibrary.open({ root: libraryAt, publicUrl, platform: 'test', taken: (id) => id === 'obby', build: (folder, out, id) => buildGame(folder, { out, id }), smoke: smokeInThread(startWorker as (d: SmokeWorkerData) => Worker, wasm, publicUrl) });
  const library = open();
  const logs: string[] = [];
  // Ann by her account's id, Bob by his Discord id; Cy isn't an uploader.
  const srv = await serve({ games: [], library, uploaders: [ann.id, '222'], admins: ['444'], accounts, sites: [SITE], port: 0, seed: 1, wasm, worker: startWorker, idleStop: 0.3, log: (l) => logs.push(l) });
  const base = `http://localhost:${srv.port}`;
  const post = (path: string, body: Uint8Array | string, token?: string) =>
    fetch(`${base}${path}`, { method: 'POST', body: body as BodyInit, headers: token ? { Authorization: `Bearer ${token}` } : {} }).then(async (r) => ({ status: r.status, body: (await r.json()) as Record<string, unknown> }));
  try {
    const obby = zipFolder('src/games/obby');
    // Who may: nobody without a token, nobody with a bad one, an account that isn't an uploader.
    check((await post('/g', obby)).status === 401, 'no token: 401');
    check((await post('/g', obby, 'byu_nope')).status === 401, 'a bad token: 401');
    const cyTry = await post('/g', obby, cyToken);
    check(cyTry.status === 403, `not an uploader: ${cyTry.status} ${String(cyTry.body.error)}`);
    // Not a built-in game's id.
    const taken = await post('/g', obby, annToken);
    check(taken.status === 409, `the id of a game built in: ${taken.status}`);

    // Ann uploads Sky Obby as "sky": built, smoke-tested in a thread, hosted, not listed.
    const first = await post('/g?id=sky', obby, annToken);
    check(first.status === 201 && first.body.id === 'sky' && typeof first.body.version === 'string' && first.body.play === `${SITE}/?game=sky`, `uploaded: ${JSON.stringify(first.body)}`);
    const v1 = String(first.body.version);
    const entry1 = (await (await fetch(`${base}/g/sky`)).json()) as PackageEntry;
    check(entry1.version === v1 && entry1.meta.title === 'Sky Obby' && entry1.client === `${publicUrl}/g/sky/${v1}/client.js`, `GET /g/sky: ${entry1.version}`);
    const listed0 = (await (await fetch(`${base}/games`)).json()) as { games: { id: string }[] };
    check(!listed0.games.some((g) => g.id === 'sky'), 'not listed yet');
    // Bob may not take Ann's id.
    const bobTry = await post('/g?id=sky', obby, bobToken);
    check(bobTry.status === 403, `someone else's game: ${bobTry.status}`);

    // Refused, with why: not a zip; a game breaking its boundaries; a game that fails its smoke test.
    const junk = await post('/g?id=junk', 'not a zip at all', annToken);
    check(junk.status === 400 && String((junk.body.problems as string[])[0]).includes('zip'), `junk: ${JSON.stringify(junk.body)}`);
    const bad = join(dir, 'bad');
    cpSync('src/games/obby', bad, { recursive: true });
    writeFileSync(join(bad, 'client.ts'), `import { melee } from '@platform/kits';\n${readFileSync(join(bad, 'client.ts'), 'utf8')}\nconsole.log(melee);\n`);
    const boundary = await post('/g?id=bad', zipFolder(bad), annToken);
    check(boundary.status === 400 && (boundary.body.problems as string[]).some((p) => p.includes("may not import '@platform/kits'")), `boundaries: ${JSON.stringify(boundary.body.problems)}`);
    const crash = join(dir, 'crash');
    cpSync('src/games/obby', crash, { recursive: true });
    writeFileSync(join(crash, 'server.ts'), readFileSync(join(crash, 'server.ts'), 'utf8').replace('  update(game, dt) {', "  update(game, dt) { if (Math.random() < 0.05) throw new Error('kaboom');"));
    const smoke = await post('/g?id=crash', zipFolder(crash), annToken);
    check(smoke.status === 400 && (smoke.body.problems as string[]).some((p) => p.includes('kaboom')), `the smoke test: ${JSON.stringify(smoke.body.problems)?.slice(0, 200)}`);
    check(!library.record('bad') && !library.record('crash'), 'nothing kept of refused uploads');

    // A player in sky: the room runs v1, and says so.
    const a = player(srv.port, 'sky');
    await until('a plays sky', () => a.state.batches > 20);
    check(a.state.welcome?.package?.version === v1 && a.state.welcome.package.client === entry1.client, `welcomed with v1: ${JSON.stringify(a.state.welcome?.package)}`);

    // Version 2: current for new rooms, but the running room keeps v1 (and so do its new players).
    const two = join(dir, 'two');
    cpSync('src/games/obby', two, { recursive: true });
    writeFileSync(join(two, 'meta.ts'), readFileSync(join(two, 'meta.ts'), 'utf8').replace("title: 'Sky Obby'", "title: 'Sky Obby II'"));
    const second = await post('/g?id=sky', zipFolder(two), annToken);
    const v2 = String(second.body.version);
    check(second.status === 201 && v2 !== v1, `version 2: ${v2}`);
    const entry2 = (await (await fetch(`${base}/g/sky`)).json()) as PackageEntry;
    check(entry2.version === v2 && entry2.meta.title === 'Sky Obby II', `current is v2: ${entry2.version} ${entry2.meta.title}`);
    const b = player(srv.port, 'sky');
    await until('b in', () => !!b.state.welcome);
    check(b.state.welcome?.package?.version === v1, `joining the running room: still v1 (${b.state.welcome?.package?.version})`);
    check((await fetch(`${base}/g/sky/${v1}/client.js`)).ok, "v1's code is still served");
    a.close();
    b.close();
    await until('the room stops', () => srv.rooms === 0);
    const c = player(srv.port, 'sky');
    await until('c in', () => !!c.state.welcome);
    check(c.state.welcome?.package?.version === v2, `a new run: v2 (${c.state.welcome?.package?.version})`);
    c.close();

    // Managing: owners only.
    const manage = (token: string, change?: unknown) =>
      fetch(`${base}/g/sky/manage`, { method: change ? 'POST' : 'GET', body: change ? JSON.stringify(change) : undefined, headers: { Authorization: `Bearer ${token}` } }).then(async (r) => ({ status: r.status, body: (await r.json()) as { record?: { versions: { version: string }[]; listed: boolean; owners: string[]; current: string } } }));
    check((await manage(bobToken)).status === 403, "Bob can't manage Ann's game");
    const rec = await manage(annToken);
    check(rec.status === 200 && rec.body.record?.versions.length === 2 && rec.body.record.owners.join() === ann.id, `her record: ${JSON.stringify(rec.body.record?.versions.map((v) => v.version))}`);
    // In the directory (anyone may find it there), but on the home page only once an admin approves.
    check((await manage(annToken, { listed: true })).body.record?.listed === true, 'in the directory');
    const directory = (await (await fetch(`${base}/g/directory`)).json()) as { games: DirectoryGame[] };
    check(directory.games.length === 1 && directory.games[0].id === 'sky' && directory.games[0].by[0] === 'ann' && directory.games[0].entry.version === v2, `the directory: ${JSON.stringify(directory.games.map((g) => g.id))}`);
    const notYet = (await (await fetch(`${base}/games`)).json()) as { games: { id: string }[] };
    check(!notYet.games.some((g) => g.id === 'sky'), 'not on the home page unapproved');
    check((await manage(annToken, { home: 'approve' })).status === 400, "an owner can't approve her own");
    check((await manage(annToken, { home: 'ask' })).body.record && library.record('sky')?.home === 'asked', 'asked for the home page');
    check((await manage(deeToken, { home: 'approve' })).status === 200 && library.record('sky')?.home === 'approved', 'the admin approves');
    check(!((await (await fetch(`${base}/g/directory`)).json()) as { games: DirectoryGame[] }).games.length, 'on the home page now, so not in the directory');
    const listed = (await (await fetch(`${base}/games`)).json()) as { games: { id: string; title: string; packaged?: PackageEntry }[] };
    const sky = listed.games.find((g) => g.id === 'sky');
    check(sky?.packaged?.version === v2 && sky.title === 'Sky Obby II' && sky.packaged.meta.title === 'Sky Obby II' && sky.packaged.client.endsWith(`/g/sky/${v2}/client.js`), `on /games, with what a screen loads: ${JSON.stringify({ ...sky, packaged: sky?.packaged?.version })}`);
    // Her games, as her page shows them; nobody else's.
    const mine = (await (await fetch(`${base}/g/mine`, { headers: { Authorization: `Bearer ${annToken}` } })).json()) as MyGames;
    check(mine.uploader && mine.games.length === 1 && mine.games[0].id === 'sky' && mine.games[0].versions[0].version === v2 && mine.games[0].versions[0].by === 'ann' && mine.games[0].owners[0].name === 'ann', `her games: ${JSON.stringify(mine.games.map((g) => [g.id, g.versions.length]))}`);
    const cys = (await (await fetch(`${base}/g/mine`, { headers: { Authorization: `Bearer ${cyToken}` } })).json()) as MyGames;
    check(!cys.uploader && !cys.admin && cys.games.length === 0, "Cy's: none, and not an uploader");
    // The site's pages may ask with her sign-in.
    const pre = await fetch(`${base}/g/mine`, { headers: { Origin: SITE, Cookie: `session=${accounts.startSession(ann.id)}` } });
    check(pre.ok && pre.headers.get('access-control-allow-origin') === SITE && pre.headers.get('access-control-allow-credentials') === 'true', 'credentialed CORS for the site');
    check((await manage(annToken, { current: v1 })).body.record?.current === v1, 'back to v1');
    check(((await (await fetch(`${base}/g/sky`)).json()) as PackageEntry).version === v1, 'GET /g/sky says v1');
    check((await manage(annToken, { current: 'ffffffffffff' })).status === 400, 'no such version');
    check((await manage(annToken, { addOwner: 'nobody-here' })).status === 400, 'no such account');
    check((await manage(annToken, { addOwner: 'Bob' })).body.record?.owners.includes(bob.id) === true, 'Bob added (by name)');
    const bobs = await post('/g?id=sky', zipFolder(two), bobToken);
    check(bobs.status === 201 && bobs.body.version === v2, `now Bob may upload it (the same folder: the same version, ${String(bobs.body.version)})`);

    // Upload tokens from the server's own page, signed in.
    const page = await fetch(`${base}/uploads`);
    check(page.ok && (await page.text()).includes('Make a token'), 'the token page');
    const cookieOf = (account: string) => `session=${accounts.startSession(account)}`;
    const made = await fetch(`${base}/uploads/token`, { method: 'POST', headers: { Cookie: cookieOf(ann.id), Origin: publicUrl } });
    const madeBody = (await made.json()) as { token?: string };
    check(made.ok && madeBody.token?.startsWith('byu_') && accounts.uploadToken(madeBody.token)?.id === ann.id, 'a token for Ann');
    check((await fetch(`${base}/uploads/token`, { method: 'POST', headers: { Cookie: cookieOf(cy.id), Origin: publicUrl } })).status === 403, 'none for Cy');
    check((await fetch(`${base}/uploads/token`, { method: 'POST', headers: { Cookie: cookieOf(ann.id), Origin: 'https://elsewhere.example' } })).status === 401, 'not from another site');
    check(accounts.revokeUploadTokens(ann.id) === 2 && !accounts.uploadToken(annToken), 'revoked');

    // Stopping hosting it: gone for screens and sockets; its record stays (Bob still owns it).
    const gone = await fetch(`${base}/g/sky`, { method: 'DELETE', headers: { Authorization: `Bearer ${bobToken}` } });
    check(gone.ok && (await fetch(`${base}/g/sky`)).status === 404, 'not hosted');
    const d = player(srv.port, 'sky');
    await until('turned away', () => d.state.closed !== null);
    check(d.state.closed === CLOSE_UNKNOWN, `no such game now: ${d.state.closed}`);

    // The library outlasts the server: opened again, it has sky's record and versions.
    const again = open();
    check(again.record('sky')?.versions.length === 2 && again.record('sky')?.current === null, `kept: ${again.record('sky')?.versions.length} versions`);
    console.log(`  uploads: tokens and uploaders, ids first come first served, refused with why (zip, boundaries, smoke test), versions pinned per room (${v1} then ${v2}), listed, rolled back, owners, token page, stopped hosting, kept on disk`);
  } catch (err) {
    console.log(logs.slice(-15).join('\n'));
    throw err;
  } finally {
    await srv.close();
    rmSync(dir, { recursive: true, force: true });
  }
}
