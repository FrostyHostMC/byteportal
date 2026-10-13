#!/usr/bin/env node
// Deploys the website to Vercel: builds it here (Vercel's builders have no Rust for the engine),
// pointed at the game server (GAME_SERVER, default the Fly app at play.blockyard.gg: under the
// site's own domain, so its sign-in cookie goes with the site's requests), and uploads the result as a
// prebuilt static site to the Vercel project this repo is linked to (`vercel link`, or
// VERCEL_ORG_ID and VERCEL_PROJECT_ID in CI): `blockyard` in Patrick Blais' projects.
// CI deploys each push to main this way (.github/workflows/ci.yml).
//
//   npm run deploy:site                   production
//   npm run deploy:site -- --preview      a preview URL instead
//   npm run deploy:site -- --if-changed   production, unless the live site is this same build
//   npm run deploy:site -- --build-only   only build .vercel/output
//   npm run deploy:site -- --deploy-only  only upload the .vercel/output already built
//
// Every response carries the build's hash (x-blockyard-build), which is how --if-changed tells.
import { execSync } from 'node:child_process';
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { buildHash } from './build-hash.mjs';

const server = process.env.GAME_SERVER ?? 'wss://play.blockyard.gg';
/** The site's home, and the older addresses that send visitors there (sign-in works only under it). */
const home = 'blockyard.gg';
const moved = ['www.blockyard.gg', 'blockyard.potrock.xyz'];
const flag = (name) => process.argv.includes(name);
const preview = flag('--preview');
const run = (cmd, env = {}) => execSync(cmd, { stdio: 'inherit', env: { ...process.env, ...env } });
const out = '.vercel/output';

if (!flag('--deploy-only')) {
  run('npm run build', { VITE_GAME_SERVER: server });
  rmSync(out, { recursive: true, force: true });
  mkdirSync(out, { recursive: true });
  cpSync('dist', `${out}/static`, { recursive: true });
  // The old addresses redirect home, keeping the path and query (an invite link still lands in its
  // room). Hashed assets never change: cache them for good. The page itself is always checked.
  const redirects = moved.map((host) => ({ src: '/(.*)', has: [{ type: 'host', value: host }], status: 308, headers: { Location: `https://${home}/$1` } }));
  // Assets for any origin too: an uploaded game's screen is a sandboxed frame (an opaque origin) that
  // loads the platform's code from here. Its page, frame.html, gets a content security policy: it
  // reaches only this site, the game server and Google's fonts, and only this site may frame it.
  const routes = [
    ...redirects,
    { src: '/assets/(.*)', headers: { 'cache-control': 'public, max-age=31536000, immutable', 'access-control-allow-origin': '*' }, continue: true },
    { src: '/frame.html', headers: { 'content-security-policy': framePolicy(), 'cache-control': 'no-cache' }, continue: true },
  ];
  writeFileSync(`${out}/config.json`, JSON.stringify({ version: 3, routes }, null, 2));
  const build = buildHash([`${out}/static`, `${out}/config.json`]);
  routes.push({ src: '/(.*)', headers: { 'x-blockyard-build': build }, continue: true });
  writeFileSync(`${out}/config.json`, JSON.stringify({ version: 3, routes }, null, 2));
  console.log(`Built the site: ${build}`);
}

/** The content security policy of an uploaded game's frame (frame.html): where it may reach. */
function framePolicy() {
  const site = `https://${home}`;
  const play = new URL(server.replace(/^ws/, 'http')).origin;
  const socket = new URL(server).origin;
  return [
    "default-src 'none'",
    `script-src ${site} ${play} 'wasm-unsafe-eval'`,
    `worker-src ${site} ${play} data: blob:`,
    `connect-src ${site} ${play} ${socket} data: blob:`,
    `img-src ${site} ${play} data: blob:`,
    `media-src ${site} ${play} data: blob:`,
    `style-src ${site} 'unsafe-inline' https://fonts.googleapis.com`,
    `font-src ${site} https://fonts.gstatic.com data:`,
    "base-uri 'none'",
    "form-action 'none'",
    `frame-ancestors ${site}`,
  ].join('; ');
}

if (!flag('--build-only')) {
  const { routes } = JSON.parse(readFileSync(`${out}/config.json`, 'utf8'));
  const build = routes.find((r) => r.headers?.['x-blockyard-build'])?.headers['x-blockyard-build'];
  const live = await fetch(`https://${home}/`, { method: 'HEAD' }).then((r) => r.headers.get('x-blockyard-build'), () => null);
  if (!preview && flag('--if-changed') && live === build) {
    console.log(`The site at ${home} is already this build (${build}): nothing to deploy.`);
  } else {
    console.log(`Deploying the site: ${live ?? 'unknown'} -> ${build}`);
    run(`vercel deploy --prebuilt${preview ? '' : ' --prod'}`);
  }
}
