import { readFileSync } from 'node:fs';
import { WebSocket } from 'ws';
import { Accounts } from '../../src/platform/host/accounts';
import { serve } from '../../src/platform/host/server';
import { decode, encode } from '../../src/platform/net/codec';
import type { ClientCommand, ServerWelcome } from '../../src/platform/net/protocol';
import { check, games } from './_harness';

const SITE = 'https://blockyard.example';
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Who a socket (from `origin`, with `query`) plays as: the name the server logs for it. */
async function playsAs(port: number, query: string, origin: string, logs: string[]): Promise<string> {
  const before = logs.length;
  const ws = new WebSocket(`ws://localhost:${port}/heart-hunt${query}`, { origin });
  ws.on('message', (data) => {
    const m = decode<ServerWelcome | { t?: undefined }>(String(data));
    if (m.t === 'welcome') ws.send(encode({ t: 'start', name: 'Typed' } satisfies ClientCommand));
  });
  for (const t0 = Date.now(); Date.now() - t0 < 10000; await wait(50)) {
    const line = logs.slice(before).find((l) => l.includes(' plays as '));
    if (line) {
      ws.close();
      return line.replace(/^.* plays as /, '');
    }
  }
  ws.close();
  throw new Error('timed out: never played');
}

/**
 * Room tickets (docs/PROPOSAL-OPEN-UPLOADS.md, stage 3): an uploaded game's screen, in a sandboxed
 * frame, has no cookie (its `Origin` is `null`); the page around it, signed in, asks for a ticket,
 * which lets one connection to that game play as the player. Only the site's pages, signed in, get
 * tickets; a ticket works once, for its game only; without one the frame is a guest.
 */
export default async function tickets() {
  const accounts = Accounts.open(':memory:');
  const ann = accounts.fromDiscord({ id: '1', username: 'ann' });
  const cookie = `session=${accounts.startSession(ann.id)}`;
  const logs: string[] = [];
  const def = games.find((g) => g.id === 'heart-hunt')!;
  const srv = await serve({ games: [def, games.find((g) => g.id === 'obby')!], accounts, sites: [SITE], port: 0, seed: 1, wasm: readFileSync('engine/pkg/voxel_engine_bg.wasm'), log: (l) => logs.push(l) });
  const base = `http://localhost:${srv.port}`;
  const ask = (headers: Record<string, string>, game = 'heart-hunt') => fetch(`${base}/tickets`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify({ game }) });
  try {
    // Only the site's pages, signed in.
    check((await ask({ Origin: SITE })).status === 401, 'not signed in: none');
    check((await ask({ Origin: 'null', Cookie: cookie })).status === 401, 'a sandboxed frame (Origin: null) gets none, even with the cookie');
    check((await ask({ Origin: 'https://elsewhere.example', Cookie: cookie })).status === 401, 'another site gets none');
    check((await ask({ Origin: SITE, Cookie: cookie }, 'nope')).status === 404, 'no such game');
    const r = await ask({ Origin: SITE, Cookie: cookie });
    check(r.ok && r.headers.get('access-control-allow-origin') === SITE && r.headers.get('access-control-allow-credentials') === 'true', 'the site gets one (credentialed CORS)');
    const { ticket } = (await r.json()) as { ticket: string };

    // The frame (Origin: null) with the ticket plays as Ann; without one, or a second time, as a guest.
    check((await playsAs(srv.port, '', 'null', logs)).includes('(a guest)'), 'no ticket: a guest');
    const asAnn = await playsAs(srv.port, `?ticket=${ticket}`, 'null', logs);
    check(asAnn.startsWith('ann (') && asAnn.includes(ann.id), `with the ticket: ${asAnn}`);
    check((await playsAs(srv.port, `?ticket=${ticket}`, 'null', logs)).includes('(a guest)'), 'used once only');
    // A ticket for another game doesn't work here.
    const other = ((await (await ask({ Origin: SITE, Cookie: cookie }, 'obby')).json()) as { ticket: string }).ticket;
    check((await playsAs(srv.port, `?ticket=${other}`, 'null', logs)).includes('(a guest)'), "another game's ticket: a guest");
    check((await playsAs(srv.port, '?ticket=made-up', 'null', logs)).includes('(a guest)'), 'a made-up ticket: a guest');
    console.log('  tickets: the site signed in only (not a frame, not elsewhere), once, its game only; a guest otherwise');
  } finally {
    await srv.close();
  }
}
