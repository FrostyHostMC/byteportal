import { check, games, launch } from './_harness';

/** Every game sets up, starts and runs 30 seconds with a player walking and clicking, in Node. */
export default function smoke() {
  for (const def of games) {
    const t0 = performance.now();
    const h = launch(def.id, { seed: 77 });
    let tick = 0;
    h.run(30, { pilot: () => ({ down: ['KeyW'], clicked: tick++ % 20 === 0 ? 1 : 0 }) });
    const me = h.me.state;
    check(Number.isFinite(me.x + me.y + me.z), `${def.id}: player position is not finite`);
    check(h.calls.length > 0, `${def.id}: made no presentation calls`);
    const ms = performance.now() - t0;
    console.log(`  ${def.id.padEnd(12)} 30 s simulated in ${ms.toFixed(0).padStart(5)} ms · ${h.ctx.entities.count()} entities · ${h.calls.length} calls`);
  }
}
