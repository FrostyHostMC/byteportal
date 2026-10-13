import { readFileSync } from 'node:fs';
import { everyone } from '../../src/games/blockice/match';
import blockice, { matchNow } from '../../src/games/blockice/server';
import { GameHost } from '../../src/platform/host/game';

const wasm = readFileSync('engine/pkg/voxel_engine_bg.wasm');

/** A bots' game of Block Ice, start to finish (a probe: the numbers). */
export default function iceSim() {
  for (const seed of [7, 8, 9, 10]) {
    const host = new GameHost(blockice, { engine: wasm, seed, remote: true, radius: 3, budget: Infinity });
    (host as unknown as { sim: { start(): void } }).sim.start();
    let over = false;
    let maxP = 0;
    const phases = new Map<string, number>();
    let held = 0, loose = 0;
    for (let i = 0; i < 30 * 60 * 12 && !over; i++) {
      host.step(1 / 30);
      const m = matchNow();
      phases.set(m.phase, (phases.get(m.phase) ?? 0) + 1);
      if (m.puck.mode === 'held') held++;
      else if (m.puck.mode === 'loose') loose++;
      maxP = Math.max(maxP, m.period);
      if (m.phase === 'over') over = true;
    }
    const m = matchNow();
    const [a, b] = m.teams;
    console.log(`seed ${seed}: ${a.def.abbr} ${a.score} - ${b.score} ${b.def.abbr}, shots ${a.shots}-${b.shots}, periods ${maxP}, over ${over}, phases ${JSON.stringify(Object.fromEntries(phases))}, held ${held} loose ${loose}`);
    if (process.env.BOX) for (const s of everyone(m)) console.log(`   ${s.team.def.abbr} ${s.player.name.padEnd(28)} G${s.g} A${s.a} SOG${s.sog} H${s.hits} STL${s.stl} SV${s.saves}`);
  }
}
