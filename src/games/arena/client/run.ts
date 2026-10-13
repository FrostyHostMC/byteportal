import type { Client, ClientKit, Node } from '@platform/client';
import { Quat, Vec3 } from '@platform/client/math';
import { RUN_MODELS } from '../models/run';
import type { ClientPart } from './part';
import { defineRunSounds } from './sounds/run';

/**
 * The run on each screen: the looks of what it hands out (the coins, the Phoenix Feather, the
 * chest's skull), the mystery chest's show (weapons spinning up out of it, slowing to the one it
 * gives), and being downed (the screen bleeding at its edges, the time left, who's reviving you, a
 * heartbeat). The shop and the classes are the server's menus.
 */
export const runClient: ClientPart = {
  name: 'runClient',
  kits: [chestShow(), downedScreen()],
  setup(client) {
    defineRunSounds(client);
    client.items.look('coin', { icon: { gltf: RUN_MODELS.coin } });
    client.items.look('coin_pile', { icon: { gltf: RUN_MODELS.coinPile } });
    client.items.look('phoenix_feather', { icon: { gltf: RUN_MODELS.feather } });
    client.items.look('chest_skull', { icon: { gltf: RUN_MODELS.skull } });
  },
};

/** What the server sends as a roll begins (`run/chest.ts`). */
interface ChestRoll {
  at: [number, number, number];
  yaw: number;
  spin: string[];
  final: string;
  color: string;
  time: number;
}

const X = new Vec3(1, 0, 0);
const Y = new Vec3(0, 1, 0);
const STAND = new Quat().setFromAxisAngle(X, -Math.PI / 2);

/**
 * The mystery chest's show: the weapons it might give rising out of it one after another, quick
 * then slower, turning, until the last is the one it gives (the server puts that one there as the
 * show ends). A skull, it grins, grows and goes.
 */
function chestShow(): ClientKit {
  let roll: (ChestRoll & { start: number }) | null = null;
  let group: Node | null = null;
  let shown: { id: string; node: Node } | null = null;
  /** The moments (seconds into the show) each of its items comes up: quick, slowing to the last. */
  let times: number[] = [];

  const swap = (client: Client, id: string) => {
    if (shown?.id === id || !group) return;
    if (shown) group.remove(shown.node);
    shown = null;
    const made = client.scene.item(id);
    if (!made) return;
    // Stood up as a pickup is (held things lie along their length), about the same size.
    made.node.position.set(-made.center.x, -made.center.y, -made.center.z);
    const holder = client.scene.node();
    holder.add(made.node);
    if (made.form === 'model') holder.quaternion.copy(STAND);
    const inner = client.scene.node();
    inner.add(holder);
    inner.scale.setScalar(0.85);
    group.add(inner);
    shown = { id, node: inner };
    client.audio.play('chest_tick', { at: roll ? { x: roll.at[0], y: roll.at[1], z: roll.at[2] } : undefined, volume: 0.5 });
  };

  const end = (client: Client) => {
    if (group) client.scene.remove(group);
    group = null;
    shown = null;
    roll = null;
  };

  return {
    name: 'arena.chest',
    setup(client) {
      client.on('arena.chest', (data) => {
        const r = data as ChestRoll;
        end(client);
        roll = { ...r, start: client.time };
        group = client.scene.node();
        client.scene.add(group);
        // The last item comes up at 80% of the show; the ones before at shrinking intervals.
        const n = r.spin.length;
        times = r.spin.map((_, i) => r.time * 0.8 * Math.pow(i / n, 0.55));
      });
    },
    frame(client) {
      if (!roll || !group) return;
      const t = client.time - roll.start;
      const skull = roll.final === 'chest_skull';
      if (t > roll.time + (skull ? 1.2 : 0)) return end(client);
      let k = 0;
      while (k + 1 < times.length && times[k + 1] <= t) k++;
      const id = t >= roll.time * 0.8 ? roll.final : roll.spin[k];
      swap(client, id);
      // Rising out of the chest as it spins, then hanging there turning slowly.
      const rise = Math.min(1, t / (roll.time * 0.8));
      const ease = 1 - (1 - rise) * (1 - rise);
      group.position.set(roll.at[0], roll.at[1] + 0.35 + ease * 1.15 + Math.sin(t * 3) * 0.04, roll.at[2]);
      const turn = roll.yaw + (t < roll.time * 0.8 ? t * 9 : roll.time * 7.2 + (t - roll.time * 0.8) * 1.5);
      group.quaternion.setFromAxisAngle(Y, turn);
      if (skull && t > roll.time * 0.8) group.scale.setScalar(1 + Math.max(0, t - roll.time) * 1.5);
      else group.scale.setScalar(1);
      // Sparks of its colour as it settles.
      if (t >= roll.time * 0.8 && Math.random() < 0.35) {
        client.fx.burst({ x: roll.at[0], y: roll.at[1] + 1.1, z: roll.at[2] }, { color: roll.color, count: 3, speed: 1.5, glow: 1, life: 0.5 });
      }
    },
    dispose() {
      roll = null;
      group = null;
      shown = null;
    },
  };
}

/** What the server says of this player while they're down (`run/downed.ts`), or null once they're up. */
interface Downed {
  bleed: number;
  max: number;
  reviver: string | null;
  progress: number;
}

/**
 * Downed, on their own screen: the edges bleeding red (deeper as the time runs out), DOWNED, the
 * seconds left and a draining bar, what to do, and who's reviving them with their progress; a
 * heartbeat slowing as they fade.
 */
function downedScreen(): ClientKit {
  let unstyle: (() => void) | null = null;
  let root: HTMLElement;
  let left: HTMLElement;
  let bar: HTMLElement;
  let hint: HTMLElement;
  let down: Downed | null = null;
  /** When the server last said, and when the next beat is. */
  let said = 0;
  let beat = 0;

  return {
    name: 'arena.downed',
    setup(client) {
      unstyle = client.hud.style(CSS);
      root = document.createElement('div');
      root.className = 'ar-downed';
      root.innerHTML = `<div class="ar-downed-edge"></div><div class="ar-downed-card"><div class="ar-downed-title">DOWNED</div><div class="ar-downed-left"></div><div class="ar-downed-bar"><i></i></div><div class="ar-downed-hint"></div></div>`;
      left = root.querySelector('.ar-downed-left')!;
      bar = root.querySelector('.ar-downed-bar i')!;
      hint = root.querySelector('.ar-downed-hint')!;
      client.hud.layer('arena.downed', 'lens').append(root);
      client.on('arena.downed', (data) => {
        down = data as Downed | null;
        said = client.time;
        root.classList.toggle('on', !!down);
      });
    },
    frame(client) {
      if (!down) return;
      // Between the server's words, the bleeding runs on here (it waits while someone revives).
      const bleed = down.reviver ? down.bleed : Math.max(0, down.bleed - (client.time - said));
      const k = bleed / down.max;
      root.style.setProperty('--k', k.toFixed(3));
      root.classList.toggle('reviving', !!down.reviver);
      left.textContent = down.reviver ? `${down.reviver} is reviving you` : `Bleeding out · ${Math.ceil(bleed)}s`;
      bar.style.width = `${((down.reviver ? down.progress : k) * 100).toFixed(1)}%`;
      hint.textContent = down.reviver ? 'Hold on…' : 'Crawl to a friend: they hold E on you to revive you';
      if (client.time >= beat && !client.replay.playing) {
        beat = client.time + 0.7 + (1 - k) * 0.6;
        client.audio.play('heartbeat', { volume: 0.35 + (1 - k) * 0.3 });
      }
    },
    dispose() {
      unstyle?.();
    },
  };
}

const CSS = `
.ar-downed { position: absolute; inset: 0; pointer-events: none; opacity: 0; transition: opacity 300ms ease; --k: 1; }
.ar-downed.on { opacity: 1; }
.ar-downed-edge {
  position: absolute; inset: 0;
  background: radial-gradient(ellipse at center, rgba(60, 0, 0, calc(0.15 + (1 - var(--k)) * 0.25)) 30%, rgba(120, 0, 0, calc(0.5 + (1 - var(--k)) * 0.3)) 72%, rgba(30, 0, 0, 0.85) 100%);
  animation: ar-downed-pulse 1.1s ease-in-out infinite;
}
.ar-downed.reviving .ar-downed-edge { background: radial-gradient(ellipse at center, transparent 40%, rgba(40, 90, 30, 0.45) 80%, rgba(10, 30, 10, 0.75) 100%); animation: none; }
@keyframes ar-downed-pulse { 50% { opacity: 0.75; } }
.ar-downed-card { position: absolute; left: 50%; top: 62%; transform: translateX(-50%); text-align: center; color: #fff; text-shadow: 0 2px 6px #000c; }
.ar-downed-title { font-family: var(--pixel); font-size: 44px; letter-spacing: 0.12em; color: #ff4d4d; }
.ar-downed.reviving .ar-downed-title { color: #9dff8a; }
.ar-downed-left { font-family: var(--sans); font-size: 18px; font-weight: 700; margin-top: 4px; }
.ar-downed-bar { width: 260px; height: 8px; margin: 10px auto 8px; background: #0008; border: 1px solid #fff4; border-radius: 4px; overflow: hidden; }
.ar-downed-bar i { display: block; height: 100%; background: linear-gradient(90deg, #8a0f12, #ff4d4d); }
.ar-downed.reviving .ar-downed-bar i { background: linear-gradient(90deg, #2f7a22, #9dff8a); }
.ar-downed-hint { font-family: var(--sans); font-size: 14px; opacity: 0.85; }
`;
