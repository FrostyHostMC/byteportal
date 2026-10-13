// The sandbox machine's program (docs/PROPOSAL-OPEN-UPLOADS.md, stage 2), bundled by
// scripts/build-sandbox.mjs into dist-sandbox/sandbox.js. Run plain, it's the supervisor:
//
//   SANDBOX_TOKEN=… node dist-sandbox/sandbox.js [--port 8080] [--isolation full|permission|off]
//
// and with `--room --wasm <engine .wasm>` (the supervisor starts it so), one room's process. The
// supervisor's isolation defaults to `full`, which it checks it can do before starting.
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runRoomProcess } from './platform/sandbox/room-process';
import type { Isolation } from './platform/sandbox/protocol';

const args = process.argv.slice(2);
const flag = (name: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const script = fileURLToPath(import.meta.url);
// The app: the bundle's folder's parent (dist-sandbox/..), with the engine and the packages.
const app = resolve(dirname(script), '..');
const wasm = flag('wasm') ?? join(app, 'engine/pkg/voxel_engine_bg.wasm');

if (args.includes('--room')) {
  runRoomProcess(wasm);
} else {
  const token = process.env.SANDBOX_TOKEN;
  if (!token) throw new Error('SANDBOX_TOKEN is needed: the game server sends it');
  const { supervise } = await import('./platform/sandbox/supervisor');
  const supervisor = await supervise({
    port: Number(flag('port') ?? process.env.PORT ?? 8080),
    token,
    isolation: (flag('isolation') ?? process.env.SANDBOX_ISOLATION ?? 'full') as Isolation,
    roomCommand: { node: process.execPath, script, args: ['--wasm', wasm] },
    readable: [app, wasm],
    log: (line) => console.log(line),
  });
  const stop = () => void supervisor.close().then(() => process.exit(0));
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
}
