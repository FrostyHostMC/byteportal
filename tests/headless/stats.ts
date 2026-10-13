import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { Accounts } from '../../src/platform/host/accounts';
import { GameLibrary } from '../../src/platform/host/library';
import { smokeTest } from '../../src/platform/host/packaged';
import { serve } from '../../src/platform/host/server';
import { SqliteStore } from '../../src/platform/host/sqlite';
import { Stats } from '../../src/platform/host/stats';
import { decode, encode } from '../../src/platform/net/codec';
import type { ClientCommand, ServerWelcome } from '../../src/platform/net/protocol';
import { buildGame } from '../../src/platform/package/build';
import type { AdminView, MyGames } from '../../src/platform/package/link';
import { check, roomWorker } from './_harness';

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function until(what: string, ok: () => boolean, ms = 20000) {
  for (const t0 = Date.now(); !ok(); await wait(50)) if (Date.now() - t0 > ms) throw new Error(`timed out: ${what}`);
}

const DAY = 86400;
const now = () => Math.floor(Date.now() / 1000);

/**
 * Stats (host/stats.ts): each play of a game kept with its account (a guest's with none), counted
 * over the last day, week and month and ever, with who came back on another day; plays older than
 * 90 days kept only as their days' totals; a deleted account's plays still counted but no longer
 * theirs. On a server: a play from a player's start until they leave, shown to the game's owners
 * in Your games and to the admin for every game. And what's kept is tidied: expired sign-ins, old
 * resolved reports (a deleted reporter's no longer theirs), the library's activity past 90 days,
 * and where players left off by name (from before accounts) once unclaimed for 90 days.
 */
export default async function stats() {
  const dir = mkdtempSync(join(tmpdir(), 'blockyard-stats-'));
  try {
    // Counting, from plays put in the past directly.
    const file = join(dir, 'stats.sqlite');
    const st = Stats.open(file);
    const raw = new DatabaseSync(file);
    const play = (game: string, account: string | null, daysAgo: number, minutes: number) =>
      raw.prepare('INSERT INTO plays (game, account, started, seconds) VALUES (?, ?, ?, ?)').run(game, account, now() - Math.round(daysAgo * DAY), minutes * 60);
    play('golf', 'ann', 0.1, 10);
    play('golf', 'ann', 3, 20); // Ann comes back on another day.
    play('golf', 'bob', 0.2, 5);
    play('golf', null, 0.3, 4); // A guest.
    play('golf', 'cat', 20, 30);
    play('golf', 'dan', 200, 60); // Long ago: only its day's totals are kept.
    play('kart', 'ann', 1.5, 7);
    st.prune();
    check((raw.prepare('SELECT COUNT(*) AS n FROM plays').get() as { n: number }).n === 6, 'plays past 90 days become days');
    const g = st.game('golf');
    check(g.day.plays === 3 && g.day.players === 2 && g.day.guests === 1 && g.day.minutes === 19, `the last 24 hours: ${JSON.stringify(g.day)}`);
    check(g.week.plays === 4 && g.week.players === 2 && g.month.plays === 5 && g.month.players === 3, `week ${JSON.stringify(g.week)}, month ${JSON.stringify(g.month)}`);
    check(g.all.plays === 6 && g.all.minutes === 129 && !!g.all.since, `ever, the old day's included: ${JSON.stringify(g.all)}`);
    check(g.returning !== null && Math.abs(g.returning - 1 / 3) < 1e-9, `one of three came back: ${g.returning}`);
    check(g.days.length === 30 && g.days[29].day === new Date().toISOString().slice(0, 10) && g.days.reduce((n, d) => n + d.plays, 0) === 5, `each of 30 days: ${g.days.map((d) => d.plays).join('')}`);
    const rows = st.overview();
    check(rows[0].game === 'golf' && rows[0].week.plays === 4 && rows[0].plays === 6 && rows[1].game === 'kart' && rows[1].week.plays === 1, `every game: ${JSON.stringify(rows)}`);
    // Ann deletes her account: her plays still count, as a player's, but aren't hers.
    st.forgetAccount('ann');
    check(st.game('golf').month.players === 3 && (raw.prepare("SELECT COUNT(*) AS n FROM plays WHERE account = 'ann'").get() as { n: number }).n === 0, 'a deleted account: counted, not named');
    // A play live: started, counted so far, ended.
    const live = st.start('kart', null);
    st.end(live);
    check(st.game('kart').day.guests === 1, 'a live play counted');
    st.forget('kart');
    check(st.game('kart').all.plays === 0, 'a game deleted for good: its stats go');
    raw.close();
    st.close();

    // Tidying accounts: expired sign-ins go; a deleted reporter's reports stay, not theirs; old resolved reports go.
    const accounts = Accounts.open(':memory:');
    const rita = accounts.fromDiscord({ id: '5', username: 'rita' });
    const kept = accounts.startSession(rita.id);
    const gone = accounts.startSession(rita.id);
    (accounts as unknown as { db: DatabaseSync }).db.prepare('UPDATE sessions SET expires = 1 WHERE rowid = (SELECT MAX(rowid) FROM sessions)').run();
    const old = accounts.report('golf', null, rita.id, 'old news');
    accounts.resolveReport(old, 'boss');
    (accounts as unknown as { db: DatabaseSync }).db.prepare(`UPDATE reports SET resolved = datetime('now', '-200 days') WHERE id = ?`).run(old);
    accounts.report('golf', null, rita.id, 'it crashes');
    accounts.tidy();
    const sessions = (accounts as unknown as { db: DatabaseSync }).db.prepare('SELECT COUNT(*) AS n FROM sessions').get() as { n: number };
    check(sessions.n === 1 && !!accounts.session(kept) && !accounts.session(gone), `expired sign-ins go: ${sessions.n} left`);
    check(accounts.reports(true).length === 1, 'old resolved reports go');
    accounts.delete(rita.id);
    const left = accounts.reports(true);
    check(left.length === 1 && left[0].account === null && left[0].reason === 'it crashes', `a deleted reporter's report stays, as a guest's: ${JSON.stringify(left)}`);
    accounts.close();

    // Where players left off by name (from before accounts): gone once unclaimed for 90 days.
    const dbFile = join(dir, 'world.sqlite');
    const s1 = SqliteStore.open(dbFile, 'golf');
    const place = { x: 1, y: 2, z: 3, yaw: 0, pitch: 0, flying: false };
    s1.savePlayer('Oldie', place);
    s1.savePlayer('Recent', place);
    s1.savePlayer('#acct', place);
    s1.close();
    const w = new DatabaseSync(dbFile);
    w.prepare(`UPDATE players SET seen = datetime('now', '-100 days') WHERE name IN ('Oldie', '#acct')`).run();
    w.close();
    const s2 = SqliteStore.open(dbFile, 'golf');
    check(!s2.player('Oldie') && !!s2.player('Recent') && !!s2.player('#acct'), 'unclaimed names go; recent ones and accounts stay');
    s2.close();

    // The library's activity: what's older than 90 days goes.
    const wasm = readFileSync('engine/pkg/voxel_engine_bg.wasm');
    const publicUrl = 'http://players.example';
    const library = GameLibrary.open({ root: join(dir, 'games'), publicUrl, platform: 'test', taken: () => false, build: (folder, out, id) => buildGame(folder, { out, id }), smoke: (d) => smokeTest(d, wasm, { publicUrl, seconds: 1 }) });
    writeFileSync(join(dir, 'games', 'activity.jsonl'), `${JSON.stringify({ at: new Date(Date.now() - 100 * DAY * 1000).toISOString(), by: 'x', text: 'ancient' })}\n${JSON.stringify({ at: new Date(Date.now() - 10 * DAY * 1000).toISOString(), by: 'x', text: 'recent' })}\n`);
    library.note('y', 'now');
    const activity = library.activity().map((a) => a.text);
    check(activity.join() === 'now,recent', `activity past 90 days goes: ${activity}`);

    // On a server: a play from start to leaving, in Your games and the admin's view.
    const acc = Accounts.open(':memory:');
    const owner = acc.fromDiscord({ id: '1', username: 'owner' });
    const boss = acc.fromDiscord({ id: '3', username: 'boss' });
    const [ownerT, bossT] = [owner, boss].map((x) => acc.newUploadToken(x.id));
    const sst = Stats.open(join(dir, 'server-stats.sqlite'));
    const srv = await serve({ games: [], library, stats: sst, accounts: acc, uploaders: ['1'], admins: ['3'], port: 0, seed: 1, wasm, worker: roomWorker, log: () => {} });
    try {
      check((await library.install('src/games/obby', owner.id, 'obby-stats')).ok, 'an uploaded game');
      const ws = new WebSocket(`ws://localhost:${srv.port}/obby-stats`);
      let welcomed = false;
      ws.onmessage = (e) => {
        const m = decode<ServerWelcome | { t?: undefined }>(String(e.data));
        if (m.t === 'welcome' && !welcomed) {
          welcomed = true;
          ws.send(encode({ t: 'start', name: 'Visitor' } satisfies ClientCommand));
          ws.send(encode({ t: 'start', name: 'Visitor' } satisfies ClientCommand)); // (one play, however many starts)
        }
      };
      await until('the play begun', () => sst.game('obby-stats').day.plays === 1);
      ws.close();
      await until('the play over', () => sst.game('obby-stats').day.guests === 1);
      const as = (token: string, path: string) => fetch(`http://localhost:${srv.port}${path}`, { headers: { Authorization: `Bearer ${token}` } });
      const mine = (await (await as(ownerT, '/g/mine')).json()) as MyGames;
      const shown = mine.games.find((x) => x.id === 'obby-stats')?.stats;
      check(shown?.day.plays === 1 && shown.day.guests === 1 && shown.days.length === 30, `the owner sees it: ${JSON.stringify(shown?.day)}`);
      const admin = (await (await as(bossT, '/admin')).json()) as AdminView;
      check(admin.stats.some((r) => r.game === 'obby-stats' && r.week.plays === 1 && r.title === 'Sky Obby'), `the admin sees every game's: ${JSON.stringify(admin.stats)}`);
      console.log('  stats: plays/players/guests/minutes by day, week, month and ever, who came back, days rolled up past 90, deleted accounts unnamed; one play per visit on a server, shown to owners and the admin; tidying: sign-ins, reports, activity, names');
    } finally {
      await srv.close();
      sst.close();
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
