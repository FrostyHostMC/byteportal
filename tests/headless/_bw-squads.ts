import { readFileSync } from 'node:fs';
import { GameHost } from '../../src/platform/host/game';
import { games } from './_harness';

type Bw = {
  match: { teams: { color: string; members: { body: unknown; kills: number }[]; bed: boolean; eliminated: boolean }[]; over: boolean; now: number };
  lobby: { size: number; startNow(): void };
  bots: Map<number, { status: string }>;
};

/**
 * Probe (not in the suite): how bot-filled matches play at each team size. One idle person in a
 * room of their own, the rest bots; for each size and seed, when the first bed goes, how many go
 * by sudden death (10 min), kills, and what a tick costs. `BW_SIZES=1,2,4 BW_SEEDS=1,2,3`.
 */
export default function bwSquads() {
  const sizes = (process.env.BW_SIZES ?? '1,2,4').split(',').map(Number);
  const seeds = (process.env.BW_SEEDS ?? '1,2,3').split(',').map(Number);
  const wasm = readFileSync('engine/pkg/voxel_engine_bg.wasm');
  const def = games.find((g) => g.id === 'bedwars')!;
  for (const size of sizes) {
    const rows: string[] = [];
    for (const seed of seeds) {
      const host = new GameHost(def, { engine: wasm, seed, remote: true, radius: 9, budget: Infinity, cheats: true, room: `probe${seed}` });
      const bw = (globalThis as unknown as { __bw: Bw }).__bw;
      const c = host.connect('Ann');
      host.command(c.id, { t: 'start' });
      for (let i = 0; i < 10; i++) host.step(1 / 30);
      bw.lobby.size = size;
      bw.lobby.startNow();
      host.step(1 / 30);
      // Where bots die: at their own bed, at another's, or out between.
      const where = { home: 0, enemyBed: 0, between: 0, void: 0 };
      const ctx = (host.sim as unknown as { ctx: { events: { on(e: string, f: (e: { entity: { position: { x: number; y: number; z: number }; data: { team?: string } } }) => void): void } } }).ctx;
      const beds = () => (bw.match as unknown as { teams: { color: string; base: { bed: { x: number; y: number; z: number }[] } }[] }).teams;
      ctx.events.on('entityDeath', (e) => {
        const p = e.entity.position;
        if (!e.entity.data.team) return;
        if (p.y < 60) return void where.void++;
        const near = beds().find((t) => Math.hypot(t.base.bed[0].x - p.x, t.base.bed[0].z - p.z) < 14);
        if (!near) where.between++;
        else if (near.color === e.entity.data.team) where.home++;
        else where.enemyBed++;
      });
      // The idle person spectates, high over the map (nothing touches a spectator), so their team
      // lasts and the match plays out between bots.
      const ann = host.sim.players[0].api;
      const centre = (bw.match as unknown as { map: { center: { x: number; y: number; z: number } } }).map.center;
      ann.teleport({ x: centre.x, y: centre.y + 60, z: centre.z }, 0, -1.2);
      ann.spectate(true);
      const modes = new Map<string, number>();
      let samples = 0;
      const ticks: number[] = [];
      const bedTimes: number[] = [];
      const seen = new Set<string>();
      const outAt: number[] = [];
      const gone = new Set<string>();
      // Up to sudden death (the beds all go then anyway).
      while (!bw.match.over && bw.match.now < 598) {
        const t0 = performance.now();
        host.step(1 / 30);
        ticks.push(performance.now() - t0);
        if (ticks.length % 150 === 0) {
          samples++;
          for (const b of bw.bots.values()) {
            const k = b.status.split(' ')[0].replace(/>.*/, '') + (b.status.includes('fight:-') ? '' : '+fight');
            modes.set(k, (modes.get(k) ?? 0) + 1);
          }
        }
        for (const t of bw.match.teams) {
          if (t.eliminated && !gone.has(t.color)) {
            gone.add(t.color);
            outAt.push(Math.round(bw.match.now));
          }
          if (!t.bed && !seen.has(t.color)) {
            seen.add(t.color);
            bedTimes.push(Math.round(bw.match.now));
          }
        }
      }
      const kills = bw.match.teams.reduce((n, t) => n + t.members.reduce((a, m) => a + m.kills, 0), 0);
      const avg = ticks.reduce((a, b) => a + b, 0) / ticks.length;
      ticks.sort((a, b) => a - b);
      rows.push(`seed ${seed}: out at ${outAt.join(', ') || '-'} · beds at ${bedTimes.join(', ') || 'none'} s · ${kills} kills · ${bw.match.over ? `over at ${Math.round(bw.match.now)} s` : 'to sudden death'} · tick ${avg.toFixed(2)} ms (p99 ${ticks[Math.floor(ticks.length * 0.99)].toFixed(2)})\n      bot deaths ${JSON.stringify(where)} · bots' time: ${[...modes].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${Math.round((100 * v) / samples / Math.max(1, bw.bots.size))}%`).join(', ')}`);
    }
    console.log(`  size ${size}:\n    ${rows.join('\n    ')}`);
  }
}
