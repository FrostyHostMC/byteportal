import type { SharedDefinition } from '../api/types';
import type { DevReply } from '../net/protocol';
import type { AutoQuality } from '../quality';
import type { Environment } from '../render/environment';
import type { Renderer } from '../render/pipeline';
import type { PlayerFrame } from '../sim/player';
import type { SimFrame } from '../sim/sim';
import { DebugOverlay } from '../ui/debug';
import type { WorkerPool } from '../workers/pool';
import type { ChunkManager } from '../world/chunks';

/** What the development tools read of the runtime (and the one thing they ask of it: `request`). */
export interface DevToolsParts {
  /** The game (its id and title). */
  def: SharedDefinition;
  renderer: Renderer;
  chunks: ChunkManager;
  env: Environment;
  pool: WorkerPool;
  /** Graphics lowered while frames are slow: how far. */
  quality: AutoQuality;
  /** The screen's mode (the title screen, playing, paused, …). */
  mode(): string;
  /** The world around the player is ready (the title screen said so). */
  ready(): boolean;
  /** Which player is this client's (null: watching the game, not in it yet). */
  player(): string | null;
  /** The newest frame from the host. */
  frame(): SimFrame | null;
  /** This client's player in a frame (watching the game before joining, a stand-in at the spawn). */
  mine(f: SimFrame | null): PlayerFrame | undefined;
  /** Where the first-person view looks. */
  look(): { yaw: number; pitch: number };
  /** Ask the host something; the answer comes in a later batch. */
  request(cmd: { t: 'dev'; js: string }): Promise<DevReply>;
}

/**
 * Development tools: the F3 overlay (frame rate, where the player is, the world's and the
 * renderer's numbers), what's on screen for automated browser tests (`__game.debugInfo()`), and
 * `__game.dev`, development code run in the game's room on its server.
 */
export class DevTools {
  /** The F3 overlay. */
  private overlay: DebugOverlay;

  constructor(ui: HTMLElement, private p: DevToolsParts) {
    this.overlay = new DebugOverlay(ui);
  }

  /** F3: the overlay on or off. */
  toggle() {
    this.overlay.toggle();
  }

  /** A frame drawn, and how long this screen's work on it took: the frame rate, and the overlay's lines while it's up. */
  tick(dt: number, cpu: number) {
    this.overlay.tick(dt, cpu);
    if (this.overlay.visible) this.show();
  }

  private show() {
    const { def, chunks, renderer: r, env, pool, quality } = this.p;
    const f = this.p.frame();
    const s = this.p.mine(f);
    if (!f || !s) return;
    const c = chunks.stats();
    const look = this.p.look();
    const yawDeg = ((((-look.yaw * 180) / Math.PI) % 360) + 360) % 360;
    const facing = ['north (-Z)', 'east (+X)', 'south (+Z)', 'west (-X)'][Math.round(yawDeg / 90) % 4];
    const rs = r.settings;
    const mem = (performance as Performance & { memory?: { usedJSHeapSize: number } }).memory;
    this.overlay.set([
      `Stonebyte · ${def.title}`,
      `${Math.round(this.overlay.fpsValue)} fps   cpu ${this.overlay.cpu.toFixed(2)} ms`,
      '',
      `XYZ      ${s.x.toFixed(2)} / ${s.y.toFixed(2)} / ${s.z.toFixed(2)}`,
      `Chunk    ${Math.floor(s.x / 16)}, ${Math.floor(s.z / 16)}   section ${Math.floor(s.y / 16)}`,
      `Facing   ${facing}   pitch ${((look.pitch * 180) / Math.PI).toFixed(1)}°`,
      `Motion   ${s.flying ? 'flying' : s.inWater ? 'swimming' : s.onGround ? 'grounded' : 'airborne'}   ${Math.hypot(s.vx, s.vz).toFixed(2)} m/s`,
      `Time     ${env.clock()}   game clock ${(f.clock ?? 0).toFixed(1)} s`,
      `Entities ${f.entities.length} alive   server ${f.players.length} playing`,
      '',
      `Columns  ${c.loaded} loaded · ${c.meshed} meshed · ${c.pending} pending upload`,
      `Workers  ${pool.size} · gen ${c.generating} (${c.genMs.toFixed(2)} ms) · mesh ${c.meshing} (${c.meshMs.toFixed(2)} ms)`,
      `Draws    ${r.stats.calls} (shadow ${r.stats.shadowCalls}) · ${(r.stats.triangles / 1e6).toFixed(2)}M tris`,
      `Culling  ${c.visibleSections} sections visible · cave culling ${chunks.occlusion ? 'on' : 'off'}`,
      `Render   ${Math.round(r.width * rs.renderScale)}x${Math.round(r.height * rs.renderScale)} · MSAA ${rs.msaa}x · shadows ${rs.shadowRes || 'off'}${quality.level ? ` · auto quality -${quality.level}` : ''}`,
      mem ? `JS heap  ${(mem.usedJSHeapSize / 1048576).toFixed(0)} MB` : '',
    ]);
  }

  /** What's on screen (`__game.debugInfo()`): the game, the mode, whether the world's ready, this player's state, chunk and render stats. */
  info() {
    const p = this.p;
    return {
      game: p.def.id,
      mode: p.mode(),
      ready: p.ready(),
      host: 'server',
      player: p.player(),
      state: p.mine(p.frame()) ?? null,
      health: p.mine(p.frame())?.health ?? 0,
      entities: p.frame()?.entities.length ?? 0,
      chunks: p.chunks.stats(),
      render: { ...p.renderer.stats },
      time: p.env.time,
      fps: this.overlay.fpsValue,
      cpu: this.overlay.cpu,
    };
  }

  /**
   * Development tools (`await __game.dev('game.players.length')`): run `js` in this game's room
   * on its server, a function body (or one expression) with `game` (the room's `GameContext`) and
   * `me` (this client's own `Player` there, null until it joins) in scope. Resolves with the
   * result as JSON (a promise it returns is awaited), or rejects with the error. Only a
   * development server (`npm run dev`) runs it; any other refuses.
   */
  dev(js: string): Promise<unknown> {
    if (!import.meta.env.DEV) return Promise.reject(new Error('__game.dev is for development builds'));
    const reply = this.p.request({ t: 'dev', js });
    const late = new Promise<never>((_, reject) => window.setTimeout(() => reject(new Error('__game.dev: no answer from the server in 10 s')), 10_000));
    return Promise.race([reply, late]).then((r) => {
      if (!r.ok) throw new Error(r.error);
      return r.value;
    });
  }
}
