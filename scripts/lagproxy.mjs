#!/usr/bin/env node
// A bad network, for testing: a WebSocket relay to a game server that adds lag and jitter each
// way (messages stay in order).
//
//   node scripts/lagproxy.mjs 8797 ws://localhost:8787 40 30   # 40 ms, plus up to 30 ms more, each way
//   then open http://localhost:5173/?server=ws://localhost:8797/sandbox
import { WebSocketServer, WebSocket } from 'ws';
const [port = '8797', target = 'ws://localhost:8796', delay = '40', jitter = '30'] = process.argv.slice(2);
const D = Number(delay), J = Number(jitter);
const wss = new WebSocketServer({ port: Number(port), perMessageDeflate: false });
// A close code that can be sent on (1005 and 1006 only describe a close; they can't be sent).
const sendable = (c) => c === 1000 || (c >= 1001 && c <= 1014 && c !== 1004 && c !== 1005 && c !== 1006) || (c >= 3000 && c <= 4999);
wss.on('connection', (client, req) => {
  const up = new WebSocket(target + req.url);
  const early = [];
  // Each way, one queue drained by one timer, so messages leave in the order they came. (A timer
  // per message reorders them: Node files timers by their whole-millisecond delay, and two sent
  // close together with fractional delays can fire the wrong way round. Frames are patches on the
  // one before, so a swapped pair corrupts the client's frame: once, a patch arriving before the
  // first whole frame left `players` a patch, not a list.)
  const pipe = (from, to, ready) => {
    const queue = [];
    let timer = null;
    const drain = () => {
      timer = null;
      const now = Date.now();
      while (queue.length && queue[0].at <= now) {
        const { data, binary } = queue.shift();
        if (ready()) to.send(data, { binary });
        else early.push(() => to.send(data, { binary }));
      }
      if (queue.length) timer = setTimeout(drain, queue[0].at - now);
    };
    from.on('message', (data, binary) => {
      const at = Math.max(queue.at(-1)?.at ?? 0, Date.now() + D + Math.random() * J);
      queue.push({ at, data, binary });
      timer ??= setTimeout(drain, at - Date.now());
    });
  };
  pipe(client, up, () => up.readyState === 1);
  pipe(up, client, () => client.readyState === 1);
  up.on('open', () => { for (const f of early.splice(0)) f(); });
  up.on('close', (c, r) => client.close(sendable(c) ? c : 1000, r));
  client.on('close', () => up.close());
  up.on('error', () => client.close());
  client.on('error', () => up.close());
});
console.log(`lag proxy on ${port} → ${target}, ${D} ± ${J} ms each way`);
