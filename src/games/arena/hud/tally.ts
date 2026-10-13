import type { Player } from '@platform';

/** What a fighter did, over a run or a wave. */
export interface Tally {
  kills: number;
  damage: number;
  /** Gold earned (spending doesn't take it back). */
  gold: number;
  bosses: number;
  taken: number;
  /** The most kills in one chain (each within `CHAIN` of the last). */
  chain: number;
  /** Friends lifted, and times gone down (or out). */
  revives: number;
  downs: number;
}

const fresh = (): Tally => ({ kills: 0, damage: 0, gold: 0, bosses: 0, taken: 0, chain: 0, revives: 0, downs: 0 });

/** Kills this close together (seconds) are one chain. */
export const CHAIN = 2.5;

/**
 * Each fighter's tallies for the HUD (the wave-cleared cards, the end screen), by player id: the
 * run's and this wave's, kept when they leave so the end screen still names them. The HUD's server
 * part (`part.ts`) feeds it from the bus and the damage events.
 */
export class Tallies {
  private run = new Map<string, Tally>();
  private wave = new Map<string, Tally>();
  /** Everyone who fought this run (names kept after they leave), in the order they came. */
  readonly names = new Map<string, string>();
  /** Each fighter's chain going now: its length and when its last kill was. */
  private chains = new Map<string, { n: number; at: number }>();

  reset() {
    this.run.clear();
    this.wave.clear();
    this.names.clear();
    this.chains.clear();
  }

  /** A new wave: its tallies start again. */
  newWave() {
    this.wave.clear();
  }

  join(p: Player) {
    this.names.set(p.id, p.name);
  }

  of(id: string): Tally {
    return this.run.get(id) ?? fresh();
  }

  waveOf(id: string): Tally {
    return this.wave.get(id) ?? fresh();
  }

  private both(p: Player, fn: (t: Tally) => void) {
    this.names.set(p.id, p.name);
    for (const m of [this.run, this.wave]) {
      let t = m.get(p.id);
      if (!t) m.set(p.id, (t = fresh()));
      fn(t);
    }
  }

  /** A kill at `now` (seconds); the chain it makes. */
  kill(p: Player, now: number, boss: boolean): number {
    const c = this.chains.get(p.id);
    const n = c && now - c.at <= CHAIN ? c.n + 1 : 1;
    this.chains.set(p.id, { n, at: now });
    this.both(p, (t) => {
      t.kills++;
      if (boss) t.bosses++;
      t.chain = Math.max(t.chain, n);
    });
    return n;
  }

  damage(p: Player, n: number) {
    this.both(p, (t) => (t.damage += n));
  }

  gold(p: Player, n: number) {
    if (n > 0) this.both(p, (t) => (t.gold += n));
  }

  taken(p: Player, n: number) {
    this.both(p, (t) => (t.taken += n));
  }

  revived(by: Player) {
    this.both(by, (t) => t.revives++);
  }

  down(p: Player) {
    this.both(p, (t) => t.downs++);
  }

  /** This wave's best (most kills, then damage) of those who fought it, if anyone killed anything. */
  waveBest(): { id: string; kills: number } | null {
    let best: { id: string; kills: number; damage: number } | null = null;
    for (const [id, t] of this.wave) {
      if (t.kills > 0 && (!best || t.kills > best.kills || (t.kills === best.kills && t.damage > best.damage))) best = { id, kills: t.kills, damage: t.damage };
    }
    return best && { id: best.id, kills: best.kills };
  }

  /** The run's best of everyone (most kills, then damage). */
  runBest(): string | null {
    let best: { id: string; t: Tally } | null = null;
    for (const [id, t] of this.run) if (!best || t.kills > best.t.kills || (t.kills === best.t.kills && t.damage > best.t.damage)) best = { id, t };
    return best && best.t.kills > 0 ? best.id : null;
  }
}
