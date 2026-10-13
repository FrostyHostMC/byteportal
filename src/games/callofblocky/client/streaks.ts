import type { ClientKit } from '@platform/client';

/**
 * What a pilot sees flying a killstreak (the server says when: `cob.streak`, `streaks/index.ts`):
 *
 * - The Hellstorm: the missile's camera feed, grey and grainy, scan lines, a box on the middle,
 *   its height over the map and whether it's boosting (the camera widens when it is).
 * - The attack chopper: the gunner's sight, the time it has left and its hull (`cob.hull`), and,
 *   zoomed down the gun (the camera narrows), a grey thermal look.
 *
 * The boxes on the people below are the server's markers; the camera is the vehicle's own.
 */

interface On {
  kind: 'hellstorm' | 'chopper';
  /** Seconds it lasts at most. */
  life: number;
  /** The map's floor (heights are shown over it). */
  floor: number;
}

const CSS = /* css */ `
.cob-sk { position: absolute; inset: 0; pointer-events: none; display: none; font-family: var(--pixel); color: #f2f7f0; }
.cob-sk.on { display: block; }
.cob-sk-filter { position: absolute; inset: 0; }
.cob-sk.hellstorm .cob-sk-filter, .cob-sk.chopper.zoom .cob-sk-filter { backdrop-filter: grayscale(1) contrast(1.35) brightness(1.18); -webkit-backdrop-filter: grayscale(1) contrast(1.35) brightness(1.18); }
.cob-sk-scan { position: absolute; inset: 0; background:
  repeating-linear-gradient(0deg, rgba(0,0,0,0.16) 0 1px, transparent 1px 3px),
  radial-gradient(ellipse at center, rgba(0,0,0,0) 50%, rgba(0,0,0,0.55) 100%); }
.cob-sk.chopper:not(.zoom) .cob-sk-scan { background: radial-gradient(ellipse at center, rgba(0,0,0,0) 60%, rgba(0,0,0,0.35) 100%); }
.cob-sk-tint { position: absolute; inset: 0; background: rgba(120, 255, 170, 0.07); mix-blend-mode: screen; }
.cob-sk.chopper:not(.zoom) .cob-sk-tint { display: none; }
.cob-sk-box { position: absolute; left: 50%; top: 50%; width: 110px; height: 110px; transform: translate(-50%, -50%); }
.cob-sk-box i { position: absolute; width: 22px; height: 22px; border: 3px solid #f2f7f0; filter: drop-shadow(0 0 2px rgba(0,0,0,0.8)); }
.cob-sk-box i:nth-child(1) { left: 0; top: 0; border-right: 0; border-bottom: 0; }
.cob-sk-box i:nth-child(2) { right: 0; top: 0; border-left: 0; border-bottom: 0; }
.cob-sk-box i:nth-child(3) { left: 0; bottom: 0; border-right: 0; border-top: 0; }
.cob-sk-box i:nth-child(4) { right: 0; bottom: 0; border-left: 0; border-top: 0; }
.cob-sk-dot { position: absolute; left: 50%; top: 50%; width: 6px; height: 6px; transform: translate(-50%, -50%); background: #ff5b5b; box-shadow: 0 0 6px #ff5b5b; }
.cob-sk.chopper .cob-sk-box { display: none; }
.cob-sk-sight { position: absolute; left: 50%; top: 50%; width: 64px; height: 64px; transform: translate(-50%, -50%); border: 2px solid rgba(242,247,240,0.9); border-radius: 50%; box-shadow: 0 0 0 1px rgba(0,0,0,0.5); display: none; }
.cob-sk-sight::before, .cob-sk-sight::after { content: ''; position: absolute; background: #f2f7f0; box-shadow: 0 0 0 1px rgba(0,0,0,0.45); }
.cob-sk-sight::before { left: 50%; top: -18px; bottom: -18px; width: 2px; transform: translateX(-50%); clip-path: polygon(0 0, 100% 0, 100% 24%, 0 24%, 0 76%, 100% 76%, 100% 100%, 0 100%); }
.cob-sk-sight::after { top: 50%; left: -18px; right: -18px; height: 2px; transform: translateY(-50%); clip-path: polygon(0 0, 24% 0, 24% 100%, 0 100%, 0 0, 76% 0, 100% 0, 100% 100%, 76% 100%); }
.cob-sk.chopper .cob-sk-sight { display: block; }
.cob-sk.chopper.zoom .cob-sk-sight { width: 120px; height: 120px; }
.cob-sk-top { position: absolute; left: 50%; top: 66px; transform: translateX(-50%); display: flex; flex-direction: column; align-items: center; gap: 10px; }
.cob-sk-tag { display: flex; align-items: center; gap: 12px; padding: 5px 16px 7px; background: #111; border: 3px solid #f2f7f0; box-shadow: 5px 5px 0 rgba(0,0,0,0.6); font-size: 26px; letter-spacing: 0.1em; transform: rotate(-2deg); white-space: nowrap; }
.cob-sk-tag b { color: #ffcc00; font-weight: 700; }
.cob-sk-rec { width: 13px; height: 13px; border-radius: 50%; background: #ff3b3b; animation: cob-sk-blink 0.8s steps(2, jump-none) infinite; }
@keyframes cob-sk-blink { 50% { opacity: 0.15; } }
.cob-sk-read { position: absolute; left: calc(50% + 78px); top: calc(50% - 56px); font-size: 18px; letter-spacing: 0.08em; text-shadow: 2px 2px 0 rgba(0,0,0,0.7); }
.cob-sk-read b { font-size: 30px; color: #ffcc00; }
.cob-sk-state { margin-top: 2px; font-size: 20px; }
.cob-sk-state.boost { color: #ff8c1a; animation: cob-sk-blink 0.35s steps(2, jump-none) infinite; }
.cob-sk-bars { display: none; gap: 10px; }
.cob-sk.chopper .cob-sk-bars { display: flex; }
.cob-sk.chopper .cob-sk-read { display: none; }
.cob-sk-bar { display: flex; align-items: center; gap: 10px; padding: 5px 10px; background: #111; border: 2px solid #f2f7f0; box-shadow: 4px 4px 0 rgba(0,0,0,0.5); font-size: 16px; letter-spacing: 0.1em; }
.cob-sk-bar span { width: 130px; height: 10px; background: rgba(255,255,255,0.15); overflow: hidden; }
.cob-sk-bar span i { display: block; height: 100%; width: 100%; background: #ffcc00; transition: width 250ms linear; }
.cob-sk-bar.hull span i { background: #58e06b; }
.cob-sk-bar.hull.low span i { background: #e63946; }
.cob-sk-bar em { font-style: normal; min-width: 34px; text-align: right; }
.cob-sk-help { position: absolute; left: 50%; bottom: 112px; transform: translateX(-50%); padding: 6px 16px; background: rgba(17,17,17,0.85); border: 2px solid #f2f7f0; font: 600 13px var(--sans); letter-spacing: 0.12em; text-transform: uppercase; white-space: nowrap; }
.cob-sk-help b { color: #ffcc00; font-family: var(--pixel); font-size: 15px; font-weight: 700; }
`;

const el = (cls: string, text?: string) => {
  const e = document.createElement('div');
  e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
};

export function streakCam(): ClientKit {
  let unstyle: (() => void) | null = null;
  let root: HTMLElement;
  /** The picture's look (grey, scan lines), straight over the world: the HUD over it keeps its colours. */
  let lens: HTMLElement;
  let name: HTMLElement;
  let alt: HTMLElement;
  let state: HTMLElement;
  let time: HTMLElement;
  let timeText: HTMLElement;
  let hullBar: HTMLElement;
  let hullRow: HTMLElement;
  let help: HTMLElement;
  let on: On | null = null;
  let since = 0;
  let hull = 1;
  let shown = '';

  const bar = (label: string, cls: string) => {
    const row = el(`cob-sk-bar ${cls}`);
    const track = document.createElement('span');
    const fill = document.createElement('i');
    track.append(fill);
    const num = document.createElement('em');
    row.append(document.createTextNode(label), track, num);
    return { row, fill, num };
  };

  return {
    name: 'callofblocky.streaks',
    setup(client) {
      unstyle = client.hud.style(CSS);
      root = el('cob-sk');
      const box = el('cob-sk-box');
      box.append(...[0, 1, 2, 3].map(() => document.createElement('i')));
      const tag = el('cob-sk-tag');
      name = document.createElement('span');
      tag.append(el('cob-sk-rec'), name);
      const read = el('cob-sk-read');
      alt = document.createElement('div');
      state = el('cob-sk-state');
      read.append(alt, state);
      const bars = el('cob-sk-bars');
      const t = bar('TIME', 'time');
      const h = bar('HULL', 'hull');
      time = t.fill;
      timeText = t.num;
      hullBar = h.fill;
      hullRow = h.row;
      bars.append(t.row, h.row);
      const top = el('cob-sk-top');
      top.append(tag, bars);
      help = el('cob-sk-help');
      lens = el('cob-sk');
      lens.append(el('cob-sk-filter'), el('cob-sk-tint'), el('cob-sk-scan'));
      root.append(box, el('cob-sk-dot'), el('cob-sk-sight'), top, read, help);
      client.hud.layer('callofblocky.streaks.lens', 'lens').append(lens);
      client.hud.layer('callofblocky.streaks', 'middle').append(root);
      client.on('cob.streak', (d) => {
        on = (d as On | null) ?? null;
        since = client.time;
        hull = 1;
        shown = '';
      });
      client.on('cob.hull', (v) => {
        hull = typeof v === 'number' ? v : hull;
      });
    },
    frame(client) {
      // (A kill cam, or nothing flying: nothing to show.)
      if (!on || !client.me.inVehicle || client.replay.playing) {
        root.classList.remove('on');
        lens.classList.remove('on');
        return;
      }
      const pad = client.input.device === 'pad';
      const zoom = on.kind === 'chopper' && client.camera.fov < 40;
      const key = `${on.kind}|${zoom}|${pad}`;
      if (key !== shown) {
        shown = key;
        root.className = lens.className = `cob-sk on ${on.kind}${zoom ? ' zoom' : ''}`;
        name.innerHTML = on.kind === 'hellstorm' ? '<b>HELLSTORM</b> FEED' : '<b>ATTACK CHOPPER</b>';
        help.innerHTML =
          on.kind === 'hellstorm'
            ? pad
              ? '<b>RS</b> steer · <b>RT</b> boost'
              : '<b>Mouse</b> steer · <b>Click</b> / <b>Space</b> boost'
            : pad
              ? '<b>LS</b> fly · <b>RS</b> aim · <b>RT</b> fire · <b>LT</b> zoom'
              : '<b>WASD</b> fly · <b>Space</b> / <b>C</b> up, down · <b>Click</b> fire · <b>Right-click</b> zoom';
      }
      if (on.kind === 'hellstorm') {
        const boosting = client.camera.fov > 66;
        alt.innerHTML = `ALT <b>${Math.max(0, Math.round(client.camera.position.y - on.floor))}</b>`;
        state.textContent = boosting ? 'BOOST' : 'GUIDED';
        state.className = `cob-sk-state${boosting ? ' boost' : ''}`;
      } else {
        const left = Math.max(0, on.life - (client.time - since));
        time.style.width = `${((left / on.life) * 100).toFixed(1)}%`;
        timeText.textContent = `${Math.ceil(left)}s`;
        hullBar.style.width = `${(hull * 100).toFixed(1)}%`;
        hullRow.classList.toggle('low', hull < 0.35);
      }
    },
    dispose() {
      unstyle?.();
    },
  };
}
