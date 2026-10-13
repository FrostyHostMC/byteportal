#!/usr/bin/env node
// Games outside the platform's build (docs/PROPOSAL-UPLOADS.md):
//
//   npm run game -- build <folder> [--id other-id] [--out data/builds] [--no-smoke]
//   npm run game -- push <folder> [--server https://play.blockyard.gg] [--id other-id] [--token byu_…]
//   npm run game -- token <byu_…> [--server https://play.blockyard.gg]
//
// `build` packages the game in <folder> (src/games/<id>, or anywhere) the way a game server does
// for an upload: it checks the game's boundaries, bundles its server and client code with the
// platform left out, writes <out>/<id>/<version>/, then smoke-tests it (its server code in a room
// of its own with a player, for a few seconds of play).
//
// `push` uploads the folder (zipped) to a game server, which builds it, smoke-tests it and hosts it
// (not listed: open it by id). The server is --server, else BLOCKYARD_SERVER, else the local
// development one (http://localhost:8787). On a server that isn't one for development you need an
// upload token: make one at <server>/uploads (signed in, and on its list of uploaders), then save
// it with `token` (kept per server in ~/.config/blockyard/tokens.json: a token only ever goes to the
// server it's for) or pass it (--token, BLOCKYARD_TOKEN).
//
// Vite's SSR loader runs the TypeScript, as for the other scripts.
import { chmodSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'vite';

const args = process.argv.slice(2);
const flag = (name) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const valued = ['--id', '--out', '--server', '--token'];
const [command, folder] = args.filter((a, i) => !a.startsWith('--') && !valued.includes(args[i - 1]));
// Upload tokens, by the server each is for (one is never sent to another server):
// ~/.config/blockyard/tokens.json. (An older single `token` file is play.blockyard.gg's.)
const configDir = join(homedir(), '.config', 'blockyard');
const tokensFile = join(configDir, 'tokens.json');
const DEFAULT_SERVER = 'https://play.blockyard.gg';
const origin = (server) => new URL(server.replace(/^ws(s?):/, 'http$1:')).origin;
function savedTokens() {
  let tokens = {};
  try {
    tokens = JSON.parse(readFileSync(tokensFile, 'utf8'));
  } catch {
    try {
      tokens = { [DEFAULT_SERVER]: readFileSync(join(configDir, 'token'), 'utf8').trim() };
    } catch {
      // none saved
    }
  }
  return tokens;
}

const usage = () => {
  console.error('usage: npm run game -- build <folder> [--id other-id] [--out data/builds] [--no-smoke]');
  console.error('       npm run game -- push <folder> [--server https://play.blockyard.gg] [--id other-id] [--token byu_…]');
  console.error('       npm run game -- token <byu_…> [--server https://play.blockyard.gg]');
  process.exit(2);
};
if (!['build', 'push', 'token'].includes(command) || !folder) usage();

if (command === 'token') {
  if (!folder.startsWith('byu_')) {
    console.error("that isn't an upload token (they start byu_)");
    process.exit(2);
  }
  const server = origin(flag('server') ?? DEFAULT_SERVER);
  mkdirSync(configDir, { recursive: true });
  writeFileSync(tokensFile, `${JSON.stringify({ ...savedTokens(), [server]: folder }, null, 1)}\n`);
  chmodSync(tokensFile, 0o600);
  console.log(`saved for ${server} in ${tokensFile}`);
  process.exit(0);
}

const vite = await createServer({
  appType: 'custom',
  logLevel: 'warn',
  server: { middlewareMode: true, hmr: false, ws: false, watch: null },
  optimizeDeps: { noDiscovery: true, include: [] },
});
let code = 0;
try {
  if (command === 'push') code = await push();
  else code = await build();
} finally {
  await vite.close();
}
process.exit(code);

/** Upload the folder to a game server: it builds and hosts it. */
async function push() {
  const { zipFolder } = await vite.ssrLoadModule('/src/platform/package/zip.ts');
  const server = (flag('server') ?? process.env.BLOCKYARD_SERVER ?? 'http://localhost:8787').replace(/^ws(s?):/, 'http$1:').replace(/\/+$/, '');
  // The token for this server (none: fine for a development server).
  const token = flag('token') ?? process.env.BLOCKYARD_TOKEN ?? savedTokens()[origin(server)];
  const zip = zipFolder(folder);
  const id = flag('id');
  console.log(`uploading ${folder} (${(zip.length / 1024).toFixed(0)} KB) to ${server}…`);
  let res;
  try {
    res = await fetch(`${server}/g${id ? `?id=${encodeURIComponent(id)}` : ''}`, { method: 'POST', body: zip, headers: { 'Content-Type': 'application/zip', ...(token ? { Authorization: `Bearer ${token}` } : {}) } });
  } catch (err) {
    console.error(`couldn't reach ${server}: ${err.cause?.message ?? err.message}`);
    return 1;
  }
  const body = await res.json().catch(() => ({ error: `${res.status} ${res.statusText}` }));
  if (!res.ok) {
    console.error(`${body.error ?? res.status}${body.problems ? `:\n${body.problems.map((p) => `  ${p}`).join('\n')}` : ''}`);
    if (res.status === 401) console.error(`make an upload token at ${server}/uploads, then: npm run game -- token <it>${origin(server) === DEFAULT_SERVER ? '' : ` --server ${server}`}`);
    return 1;
  }
  console.log(`${body.id} is up: version ${body.version} (built and checked in ${(body.ms / 1000).toFixed(1)} s; ${body.summary})`);
  const local = /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(server);
  console.log(`  play it: ${body.play ?? (local ? `http://localhost:5173/?game=${body.id}${server === 'http://localhost:8787' ? '' : `&server=${server.replace(/^http/, 'ws')}`}` : `?game=${body.id}`)}${body.listed ? '' : ' (not listed: open it by its link)'}`);
  return 0;
}

/** Build the folder here, as a server would, and smoke-test it. */
async function build() {
  let code = 0;
  const { buildGame, BuildError } = await vite.ssrLoadModule('/src/platform/package/build.ts');
  const out = flag('out') ?? 'data/builds';
  let built;
  try {
    const t0 = performance.now();
    built = await buildGame(folder, { out, id: flag('id') });
    const kb = (n) => `${(n / 1024).toFixed(0)} KB`;
    const size = (f) => readFileSync(`${built.dir}/${f}`).length;
    console.log(`built ${built.id} ${built.version} in ${(performance.now() - t0).toFixed(0)} ms: server.js ${kb(size('server.js'))}, client.js ${kb(size('client.js'))}, ${built.manifest.assets.length} files`);
    console.log(`  server imports ${built.manifest.modules.server.join(', ')}`);
    console.log(`  client imports ${built.manifest.modules.client.join(', ')}`);
    console.log(`  in ${built.dir}`);
  } catch (err) {
    if (!(err instanceof BuildError)) throw err;
    console.error(`can't build ${folder}:\n${err.problems.map((p) => `  ${p}`).join('\n')}`);
    code = 1;
  }
  if (built && !args.includes('--no-smoke')) {
    const { smokeTest } = await vite.ssrLoadModule('/src/platform/host/packaged.ts');
    const result = await smokeTest(built.dir, readFileSync('engine/pkg/voxel_engine_bg.wasm'));
    if (result.ok) console.log(`smoke test passed: ${result.summary}`);
    else {
      console.error(`smoke test failed:\n${result.errors.map((e) => `  ${e}`).join('\n')}`);
      code = 1;
    }
  }
  return code;
}
