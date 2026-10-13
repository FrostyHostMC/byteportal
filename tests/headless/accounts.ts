import { readFileSync } from 'node:fs';
import { WebSocket } from 'ws';
import { normalAvatar } from '../../src/platform/avatar';
import { Accounts } from '../../src/platform/host/accounts';
import { serve } from '../../src/platform/host/server';
import { MemoryStore } from '../../src/platform/host/store';
import { decode, encode } from '../../src/platform/net/codec';
import { FrameReader } from '../../src/platform/net/delta';
import type { ClientCommand, ServerWelcome, WireBatch } from '../../src/platform/net/protocol';
import type { SimFrame } from '../../src/platform/sim/sim';
import { check, games, roomWorker } from './_harness';

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
const SITE = 'https://blockyard.example';
const LOCAL = 'http://localhost:5173';

async function until(what: string, ok: () => boolean, ms = 10000) {
  for (const t0 = Date.now(); !ok(); await wait(20)) if (Date.now() - t0 > ms) throw new Error(`timed out: ${what}`);
}

/** A socket from a page at `origin`, with `cookie`, pressing Play as `name` (at once, or on `play()` if `hold`). */
function player(port: number, name: string, origin: string, cookie?: string, hold = false, avatar?: string) {
  const ws = new WebSocket(`ws://localhost:${port}/heart-hunt`, { origin, headers: cookie ? { Cookie: cookie } : {} });
  const frames = new FrameReader<SimFrame>();
  let frame: SimFrame | null = null;
  /** The achievements that popped up on this screen. */
  const pops: { title: string; kept: boolean; count?: string }[] = [];
  let closed: { code: number; reason: string } | null = null;
  let welcomed = false;
  const play = () => ws.send(encode({ t: 'start', name, ...(avatar ? { avatar } : {}) } satisfies ClientCommand));
  ws.on('message', (data) => {
    const m = decode<ServerWelcome | WireBatch>(String(data));
    if ('t' in m && m.t === 'welcome') {
      welcomed = true;
      if (!hold) play();
    }
    else {
      const b = m as WireBatch;
      for (const e of b.events) if (e.t === 'call' && e.call.target === 'hud' && e.call.method === 'achievement') pops.push(e.call.args[0] as (typeof pops)[number]);
      if (b.f !== undefined) frame = frames.read(b.f);
    }
  });
  ws.on('close', (code, reason) => (closed = { code, reason: String(reason) }));
  return {
    pops,
    /** A player as this screen last saw them. */
    who: (n: string) => (frame as SimFrame | null)?.players.find((p) => p.name === n),
    send: (c: ClientCommand) => ws.send(encode(c)),
    play,
    welcomed: () => welcomed,
    names: () => (frame as SimFrame | null)?.players.map((p) => p.name) ?? [],
    get closed() {
      return closed;
    },
    close: () => ws.close(),
  };
}

/**
 * Accounts on a game server: signing in with Discord (Discord's side stood in for), sessions in a
 * cookie, `/me` for the site's pages only, playing as the account's name over the WebSocket
 * (only from the site), guests kept off account names, renaming, signing out, and deleting an
 * account with what the game kept for it.
 */
export default async function accounts() {
  const accounts = Accounts.open(':memory:');
  const store = new MemoryStore();
  const logs: string[] = [];
  // Discord, stood in for: its token and who the user is.
  const realFetch = globalThis.fetch;
  const asked: string[] = [];
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    if (url.startsWith('https://cdn.discordapp.com/avatars/80351110224678912/')) return new Response(new Uint8Array([137, 80, 78, 71]), { headers: { 'Content-Type': 'image/png' } });
    if (!url.startsWith('https://discord.com/')) return realFetch(input, init);
    asked.push(url);
    if (url.endsWith('/api/oauth2/token')) {
      const body = new URLSearchParams(String(init?.body));
      if (body.get('code') !== 'good-code') return new Response('bad code', { status: 400 });
      return Response.json({ access_token: 'discord-token', token_type: 'Bearer' });
    }
    if (url.endsWith('/api/users/@me')) return Response.json({ id: '80351110224678912', username: 'nelly', global_name: 'Nelly', avatar: '8342729096ea3675442027381ff50dfe' });
    return new Response('?', { status: 404 });
  }) as typeof fetch;
  const srv = await serve({
    games: games.filter((g) => g.id === 'heart-hunt'),
    port: 0,
    seed: 1,
    wasm: readFileSync('engine/pkg/voxel_engine_bg.wasm'),
    store: () => store,
    accounts,
    discord: { id: 'app-id', secret: 'app-secret' },
    sites: [SITE],
    dev: true,
    log: (l) => logs.push(l),
  });
  const base = `http://localhost:${srv.port}`;
  const get = (path: string, o: { cookie?: string; origin?: string; method?: string; body?: unknown } = {}) =>
    realFetch(`${base}${path}`, {
      method: o.method ?? 'GET',
      redirect: 'manual',
      headers: { ...(o.cookie ? { Cookie: o.cookie } : {}), ...(o.origin ? { Origin: o.origin } : {}), ...(o.body ? { 'Content-Type': 'application/json' } : {}) },
      body: o.body ? JSON.stringify(o.body) : undefined,
    });
  const session = (r: Response) => r.headers.getSetCookie().find((c) => c.startsWith('session='))?.split(';')[0];
  try {
    check((await get('/me', { origin: SITE })).status === 401, 'nobody signed in');

    // Signing in with Discord: off to Discord with our state, back with a code, a session.
    const go = await get(`/auth/discord?back=${encodeURIComponent(`${SITE}/?game=heart-hunt`)}`);
    const to = new URL(go.headers.get('location') ?? '');
    const oauth = go.headers.getSetCookie().find((c) => c.startsWith('oauth='))?.split(';')[0] ?? '';
    check(go.status === 302 && to.origin === 'https://discord.com' && to.searchParams.get('scope') === 'identify' && to.searchParams.get('client_id') === 'app-id', `off to Discord: ${to.href}`);
    check(to.searchParams.get('redirect_uri') === `${base}/auth/discord/callback`, `and back here: ${to.searchParams.get('redirect_uri')}`);
    const state = to.searchParams.get('state')!;
    const forged = await get(`/auth/discord/callback?code=good-code&state=not-ours`, { cookie: oauth });
    check(forged.status === 302 && new URL(forged.headers.get('location')!).searchParams.get('signin') === 'failed' && !session(forged), 'a state not ours: no sign-in');
    const back = await get(`/auth/discord/callback?code=good-code&state=${state}`, { cookie: oauth });
    const nelly = session(back);
    check(back.status === 302 && back.headers.get('location') === `${SITE}/?game=heart-hunt` && !!nelly, `back to the page, signed in: ${back.headers.get('location')}`);
    check(/HttpOnly/.test(back.headers.getSetCookie().join()) && /SameSite=Lax/.test(back.headers.getSetCookie().join()), 'the session cookie is HttpOnly, SameSite=Lax');
    check(asked.length === 2, `Discord asked twice (token, user): ${asked.length}`);
    const me = await get('/me', { cookie: nelly, origin: SITE });
    const meBody = (await me.json()) as { name: string; avatar: string };
    check(me.status === 200 && meBody.name === 'Nelly' && meBody.avatar.includes('8342729096ea3675442027381ff50dfe'), `who's signed in: ${JSON.stringify(meBody)}`);
    check(me.headers.get('access-control-allow-origin') === SITE && me.headers.get('access-control-allow-credentials') === 'true', 'the site may read it');
    const elsewhere = await get('/me', { cookie: nelly, origin: 'https://evil.example' });
    check(elsewhere.status === 401 && elsewhere.headers.get('access-control-allow-origin') === null, 'another site may not');
    check((await get('/me', { cookie: nelly, origin: LOCAL })).status === 200, 'a localhost page may, on a development server');

    // Playing: as the account's name, whatever's typed; a guest can't take it; a page elsewhere
    // doesn't get to be her.
    const n = player(srv.port, 'Mallory', SITE, nelly);
    await until('Nelly in the game', () => n.names().includes('Nelly'));
    const host = srv.host('heart-hunt')!;
    check(host.sim.players.find((p) => p.name === 'Nelly')?.account?.name === 'Nelly', 'she plays as her account');
    // Her avatar, as games see it: by way of this server, so no game learns her Discord id.
    const avatar = host.sim.players.find((p) => p.name === 'Nelly')!.account!.avatar!;
    check(avatar.startsWith(`${base}/avatars/`) && !avatar.includes('80351110224678912'), `her avatar by way of the server: ${avatar}`);
    const pic = await realFetch(avatar);
    check(pic.ok && pic.headers.get('content-type') === 'image/png' && (await pic.arrayBuffer()).byteLength === 4, 'which gives the picture');
    check((await realFetch(`${base}/avatars/nobody`)).status === 404, 'and nobody else’s');
    check(!logs.some((l) => /connected from|\d+\.\d+\.\d+\.\d+|::1|::ffff/.test(l)), `no addresses in the log: ${logs.find((l) => /connected/.test(l))}`);
    const g = player(srv.port, 'nelly', SITE);
    await until('the guest in', () => n.names().includes('nelly (guest)'));
    const e = player(srv.port, 'Eve', 'https://evil.example', nelly);
    await until('Eve in', () => n.names().includes('Eve'));
    check(!host.sim.players.find((p) => p.name === 'Eve')?.account, `from another site, the cookie counts for nothing: ${n.names()}`);
    host.sim.players.find((p) => p.name === 'Nelly')!.api.store.set('hearts', 7);
    const nellyId = accounts.session(nelly!.split('=')[1])!.id;
    check(store.data().get(`$player:${nellyId}:hearts`) === 7, 'her own data is kept by account');

    // Renaming: once a day, and not to a name an account holds.
    // Watching as Nelly, she renames herself on the home page, then presses Play.
    const watching = player(srv.port, 'x', SITE, nelly, true);
    await until('watching', () => watching.welcomed());
    const dev = await get('/auth/dev?name=Zed');
    const zed = session(dev);
    check(dev.status === 200 && !!zed, 'a development sign-in');
    const renamed = await get('/me/name', { cookie: nelly, origin: SITE, method: 'POST', body: { name: 'Nell!' } });
    check(renamed.status === 200 && ((await renamed.json()) as { name: string }).name === 'Nell', 'renamed (cleaned like a typed name)');
    watching.play();
    await until('Nell in, by her new name', () => n.names().includes('Nell'));
    watching.close();
    const taken = await get('/me/name', { cookie: nelly, origin: SITE, method: 'POST', body: { name: 'zed' } });
    check(taken.status === 409, `a name an account holds is taken: ${taken.status}`);
    const again = await get('/me/name', { cookie: nelly, origin: SITE, method: 'POST', body: { name: 'Nellie' } });
    check(again.status === 409 && ((await again.json()) as { error: string }).error.includes('once a day'), 'once a day');
    const pre = await get('/me/name', { origin: SITE, method: 'OPTIONS' });
    check(pre.status === 204 && pre.headers.get('access-control-allow-methods')?.includes('POST') === true, 'the preflight is answered');

    // Signing out ends the session.
    check((await get('/auth/logout', { cookie: nelly, origin: SITE, method: 'POST' })).status === 204, 'signed out');
    check((await get('/me', { cookie: nelly, origin: SITE })).status === 401, 'the session is over');

    // Deleting an account: its connection closes, and the game forgets what it kept for it.
    const z = player(srv.port, 'x', SITE, zed);
    await until('Zed in', () => n.names().includes('Zed'));
    const zedId = accounts.session(zed!.split('=')[1])!.id;
    host.sim.players.find((p) => p.name === 'Zed')!.api.store.set('hearts', 3);
    check(store.data().get(`$player:${zedId}:hearts`) === 3, "Zed's data kept");
    check((await get('/me', { cookie: zed, origin: SITE, method: 'DELETE' })).status === 204, 'deleted');
    await until('his connection closes', () => z.closed?.code === 4003);
    check(store.data().get(`$player:${zedId}:hearts`) === undefined && accounts.get(zedId) === null, 'and everything kept for him is gone');
    check(!accounts.nameHeld('Zed'), 'his name is free again');
    for (const c of [n, g, e]) c.close();
    console.log('  Discord sign-in (stood in for) · sessions · /me for the site only · playing as the account from the site only · guests off account names · renaming · signing out · deleting');
  } catch (err) {
    console.log(logs.slice(-20).join('\n'));
    throw err;
  } finally {
    globalThis.fetch = realFetch;
    await srv.close();
  }
  await inWorker();
  await achievements();
  await looks();
}

/**
 * Looks: an account's avatar and what it wears (`/me/look`: only what it owns, or the platform's
 * free things, one to a slot), shown to everyone in a game that doesn't dress its players (a game
 * that does keeps its own skin), a guest's avatar from Play, and a game's cosmetics given
 * (`player.grant`, an achievement's `reward`), kept for the account and then wearable.
 */
async function looks() {
  const accounts = Accounts.open(':memory:');
  const base = games.find((g) => g.id === 'heart-hunt')!;
  const hat = { boxes: [{ from: [-4, 0, -4], to: [4, 2, 4], color: '#ffcc00' }] } as const;
  const def = {
    ...base,
    cosmetics: { t_crown: { name: 'Crown', slot: 'hat' as const, model: { boxes: hat.boxes.map((b) => ({ ...b, from: [...b.from] as [number, number, number], to: [...b.to] as [number, number, number] })) } } },
    achievements: { ...base.achievements, t_win: { title: 'Win', description: 'Win', reward: 't_crown' } },
  };
  const dressed = { ...games.find((g) => g.id === 'obby')!, player: { ...games.find((g) => g.id === 'obby')!.player, skin: [0, 0] as [number, number] } };
  const srv = await serve({ games: [def, dressed], port: 0, seed: 1, wasm: readFileSync('engine/pkg/voxel_engine_bg.wasm'), accounts, sites: [SITE], dev: true, cheats: true });
  const base$ = `http://localhost:${srv.port}`;
  const post = (path: string, cookie: string, body: unknown) => fetch(`${base$}${path}`, { method: 'POST', headers: { Cookie: cookie, Origin: SITE, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  try {
    const cookie = (await fetch(`${base$}/auth/dev?name=Ann`)).headers.getSetCookie()[0].split(';')[0];
    const annId = accounts.session(cookie.split('=')[1])!.id;
    const fresh = (await (await fetch(`${base$}/me/look`, { headers: { Cookie: cookie, Origin: SITE } })).json()) as { avatar: string | null; wear: string[] };
    check(fresh.avatar === null && fresh.wear.length === 0, `nothing chosen yet: ${JSON.stringify(fresh)}`);
    // (The first avatars' codes are kept as today's.)
    const code = normalAvatar('a3632182f1')!;
    const set = (await (await post('/me/look', cookie, { avatar: 'a3632182f1', wear: ['blockyard:cap', 'heart-hunt:t_crown', 'blockyard:beanie', 'blockyard:tag_sky'] })).json()) as { avatar: string; wear: string[] };
    check(code.startsWith('b') && set.avatar === code && set.wear.join() === 'blockyard:beanie,blockyard:tag_sky', `only what's hers, a hat at a time: ${JSON.stringify(set)}`);
    check((await post('/me/look', cookie, { avatar: 'not-an-avatar' })).status === 400, 'a made-up avatar is turned down');

    // Everyone sees her look.
    const ann = player(srv.port, 'x', SITE, cookie);
    const gus = player(srv.port, 'Gus', SITE, undefined, false, 'b1a2030405060708');
    const bad = player(srv.port, 'Bad', SITE, undefined, false, 'zzz');
    await until('all three in', () => !!gus.who('Ann') && !!gus.who('Bad') && !!ann.who('Gus'));
    const a = gus.who('Ann')!;
    check(a.avatar === code && a.skin === null && a.wear?.join() === 'blockyard:beanie,blockyard:tag_sky', `her avatar and what she wears, on another screen: ${JSON.stringify({ avatar: a.avatar, wear: a.wear })}`);
    check(ann.who('Gus')?.avatar === normalAvatar('b1a2030405060708') && !ann.who('Gus')?.wear, `a guest's avatar from Play (and nothing worn): ${ann.who('Gus')?.avatar}`);
    check(ann.who('Bad')?.avatar === undefined, `no avatar for a code that isn't one: ${JSON.stringify(ann.who('Bad')?.avatar)}`);

    // Given in play: an achievement's reward, then hers to wear.
    const host = srv.host(def.id)!;
    host.sim.players.find((p) => p.name === 'Ann')!.api.achieve('t_win');
    await until('the crown is hers', () => !!accounts.owned(annId)['heart-hunt:t_crown']);
    const worn = (await (await post('/me/look', cookie, { wear: ['heart-hunt:t_crown'] })).json()) as { wear: string[] };
    check(worn.wear.join() === 'heart-hunt:t_crown', `now wearable: ${JSON.stringify(worn)}`);
    check(!host.sim.players.find((p) => p.name === 'Gus')!.api.grant('t_crown'), "a guest's isn't kept");
    for (const c of [ann, gus, bad]) c.close();

    // A game that dresses its players keeps its own skin for them.
    const inObby = new WebSocket(`ws://localhost:${srv.port}/obby`, { origin: SITE, headers: { Cookie: cookie } });
    const frames = new FrameReader<SimFrame>();
    let seen: SimFrame | null = null;
    inObby.on('message', (d) => {
      const m = decode<ServerWelcome | WireBatch>(String(d));
      if ('t' in m && m.t === 'welcome') inObby.send(encode({ t: 'start', name: 'x' } satisfies ClientCommand));
      else if ((m as WireBatch).f !== undefined) seen = frames.read((m as WireBatch).f);
    });
    await until('Ann in the obby', () => !!(seen as SimFrame | null)?.players.some((p) => p.name === 'Ann'));
    const inO = (seen as SimFrame | null)!.players.find((p) => p.name === 'Ann')!;
    check(inO.skin === null && inO.avatar === code && inO.wear?.join() === 'heart-hunt:t_crown', `who she is and her crown go with her (her screen's the game's to dress): ${JSON.stringify({ avatar: inO.avatar, wear: inO.wear })}`);
    inObby.close();
    console.log('  looks: /me/look keeps what she may wear, everyone sees her avatar and what she wears, a guest\'s avatar from Play, a reward given and then worn, a dressing game keeps its skin');
  } finally {
    await srv.close();
  }
}

/**
 * Achievements: a game's own (its meta), awarded on the server (`player.achieve`), popping up on the
 * player's screen, kept once for a signed-in player's account (and theirs again when they come
 * back), a guest's for the visit; `/me/achievements` lists them; an id the game doesn't have is a
 * mistake, reported; deleting the account takes them too.
 */
async function achievements() {
  const accounts = Accounts.open(':memory:');
  const base = games.find((g) => g.id === 'heart-hunt')!;
  const def = { ...base, achievements: { ...base.achievements, t_found: { title: 'Found One', description: 'Find a heart' }, t_secret: { title: 'Secret', description: 'Shh', hidden: true } } };
  const all = Object.keys(def.achievements).length;
  const logs: string[] = [];
  const srv = await serve({ games: [def], port: 0, seed: 1, wasm: readFileSync('engine/pkg/voxel_engine_bg.wasm'), accounts, sites: [SITE], dev: true, cheats: true, log: (l) => logs.push(l) });
  const base$ = `http://localhost:${srv.port}`;
  try {
    const cookie = (await fetch(`${base$}/auth/dev?name=Ann`)).headers.getSetCookie()[0].split(';')[0];
    const annId = accounts.session(cookie.split('=')[1])!.id;
    let a = player(srv.port, 'x', SITE, cookie);
    await until('Ann in', () => a.names().includes('Ann'));
    const host = srv.host(def.id)!;
    const ann = () => host.sim.players.find((p) => p.name === 'Ann')!.api;
    check(ann().achieve('t_found') && !ann().achieve('t_found') && ann().achieved('t_found'), 'earned once, then had');
    await until('it pops up', () => a.pops.length === 1);
    check(a.pops[0].title === 'Found One' && a.pops[0].kept && a.pops[0].count === `1 of ${all}`, `her screen: ${JSON.stringify(a.pops)}`);
    check(accounts.achievedIn(annId, def.id).join() === 't_found', 'kept for her account');
    const listed = (await (await fetch(`${base$}/me/achievements`, { headers: { Cookie: cookie, Origin: SITE } })).json()) as { achievements: Record<string, Record<string, string>> };
    check(!!listed.achievements[def.id]?.t_found, `/me/achievements: ${JSON.stringify(listed)}`);
    // A cheat (development servers) earns one too.
    a.send({ t: 'exec', id: 1, line: 'achieve t_secret' });
    await until('the cheat', () => a.pops.length === 2);
    check(ann().achieved('t_secret') && a.pops[1].count === `2 of ${all}`, 'the /achieve cheat');
    // Not one of the game's: reported, nothing earned.
    check(!ann().achieve('nope') && logs.some((l) => l.includes(`"nope" isn't one of`)), 'an id the game lacks is reported');

    // A guest: it pops up, for the visit only.
    const g = player(srv.port, 'Gus', SITE);
    await until('Gus in', () => a.names().includes('Gus'));
    const gus = host.sim.players.find((p) => p.name === 'Gus')!.api;
    check(gus.achieve('t_found'), "a guest's first");
    await until("the guest's pops up", () => g.pops.length === 1);
    check(!g.pops[0].kept, 'marked as not kept');
    check(Object.keys(accounts.achievements(annId)).length === 1, 'nothing kept for a guest');

    // Ann comes back: she has hers.
    a.close();
    await until('Ann gone', () => !host.sim.players.some((p) => p.name === 'Ann' && !p.vacant));
    a = player(srv.port, 'x', SITE, cookie);
    // Her new socket welcomed and her place taken again (the vacant one is listed while she's away).
    await until('Ann back', () => a.welcomed() && host.sim.players.some((p) => p.name === 'Ann' && !p.vacant) && g.names().includes('Ann'));
    check(ann().achieved('t_found') && ann().achieved('t_secret') && !ann().achieve('t_found'), 'back again, she has them');

    // Deleting her account takes them.
    await fetch(`${base$}/me`, { method: 'DELETE', headers: { Cookie: cookie, Origin: SITE } });
    check(Object.keys(accounts.achievements(annId)).length === 0, 'deleted with the account');
    a.close();
    g.close();
    console.log(`  achievements: once, popping up (${all} in all), kept for an account and back when she is, a guest's for the visit, /me/achievements, the cheat, mistakes reported, deleted with the account`);
  } catch (err) {
    console.log(logs.slice(-20).join('\n'));
    throw err;
  } finally {
    await srv.close();
  }
}

/** A room in a worker thread (as on a real server) hears who's signed in too. */
async function inWorker() {
  const srv = await serve({
    games: games.filter((g) => g.id === 'heart-hunt'),
    port: 0,
    seed: 1,
    wasm: readFileSync('engine/pkg/voxel_engine_bg.wasm'),
    worker: (workerData) => roomWorker(workerData),
    accounts: Accounts.open(':memory:'),
    sites: [SITE],
    dev: true,
  });
  try {
    const r = await fetch(`http://localhost:${srv.port}/auth/dev?name=Tess`);
    const cookie = r.headers.getSetCookie()[0].split(';')[0];
    const t = player(srv.port, 'typed', SITE, cookie);
    await until('Tess in, in a worker', () => t.names().includes('Tess'), 20000);
    t.close();
    console.log('  a room in a worker thread plays her as her account');
  } finally {
    await srv.close();
  }
}
