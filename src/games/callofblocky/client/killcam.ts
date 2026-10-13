import type { Client, ClientKit, IconRef } from '@platform/client';

/** What the server sends with the kill cam (`killcam.ts`, `KillcamData`). */
interface Data {
  killer: string;
  color: string;
  weapon: string | null;
  icon: IconRef | null;
  headshot: boolean;
  through: boolean;
}

/** Seconds into the kill cam before a click or Space skips it (the trigger still held from the fight doesn't). */
const ARM = 0.35;

const CSS = /* css */ `
.cob-kc { position: absolute; inset: 0; pointer-events: none; opacity: 0; transition: opacity 160ms ease; }
.cob-kc.on { opacity: 1; }
.cob-kc-bar { position: absolute; left: 0; right: 0; height: 0; background: #0b0b0d; transition: height 260ms cubic-bezier(.2,.8,.2,1); }
.cob-kc-bar.top { top: 0; }
.cob-kc-bar.bottom { bottom: 0; }
.cob-kc.on .cob-kc-bar { height: 7.5vh; }
.cob-kc-vignette { position: absolute; inset: 0; background: radial-gradient(ellipse at center, rgba(0,0,0,0) 55%, rgba(20,0,4,0.45) 100%); }
.cob-kc-stamp {
  position: absolute; top: 2.2vh; left: 50%; transform: translate(-50%, -30px) rotate(-3deg);
  display: flex; align-items: center; gap: 14px;
  padding: 6px 22px 8px; background: #e63946; border: 3px solid #111; box-shadow: 5px 5px 0 #111;
  font: 700 38px/1 var(--pixel); letter-spacing: 0.12em; color: #fdf1d6;
  -webkit-text-stroke: 2px #111; paint-order: stroke fill; text-shadow: 3px 3px 0 #111;
  transition: transform 300ms cubic-bezier(.2,1.4,.4,1);
}
.cob-kc.on .cob-kc-stamp { transform: translate(-50%, 0) rotate(-3deg); }
.cob-kc-rec { width: 14px; height: 14px; border-radius: 50%; background: #fdf1d6; border: 2px solid #111; animation: cob-kc-blink 0.9s steps(2, jump-none) infinite; }
@keyframes cob-kc-blink { 50% { background: #111; } }
.cob-kc-card {
  position: absolute; left: 32px; bottom: calc(7.5vh + 26px); transform: translate(0, 40px) rotate(-1deg);
  min-width: 340px; padding: 10px 18px 12px; background: #fdf1d6; color: #111;
  border: 3px solid #111; box-shadow: 6px 6px 0 #111; border-radius: 3px;
  transition: transform 320ms cubic-bezier(.2,1.3,.4,1);
}
.cob-kc.on .cob-kc-card { transform: translate(0, 0) rotate(-1deg); }
.cob-kc-by { font: 700 12px var(--pixel); letter-spacing: 0.18em; opacity: 0.7; }
.cob-kc-who { display: flex; align-items: center; gap: 12px; margin-top: 2px; }
.cob-kc-name {
  font: 700 30px/1.1 var(--pixel); letter-spacing: 0.04em; text-transform: uppercase;
  -webkit-text-stroke: 1.5px #111; paint-order: stroke fill; text-shadow: 2px 2px 0 #111;
}
.cob-kc-icon { height: 38px; width: auto; max-width: 120px; image-rendering: pixelated; filter: drop-shadow(2px 2px 0 rgba(0,0,0,0.35)); }
.cob-kc-icon:not([src]) { display: none; }
.cob-kc-how { margin-top: 4px; font: 600 14px var(--sans); letter-spacing: 0.06em; text-transform: uppercase; }
.cob-kc-tag { display: inline-block; margin-left: 8px; padding: 1px 7px; background: #111; color: #ffcc00; font: 700 11px var(--pixel); letter-spacing: 0.12em; transform: rotate(-2deg); }
.cob-kc-time { margin-top: 9px; height: 7px; background: rgba(0,0,0,0.12); border: 2px solid #111; }
.cob-kc-fill { height: 100%; width: 0; background: #e63946; }
.cob-kc-skip {
  position: absolute; right: 28px; bottom: calc(7.5vh + 26px);
  padding: 7px 14px; background: #111; color: #fdf1d6; border: 2px solid #fdf1d6; box-shadow: 4px 4px 0 rgba(0,0,0,0.5);
  font: 700 14px var(--pixel); letter-spacing: 0.1em;
}
.cob-kc-skip b { color: #ffcc00; }
`;

const el = (cls: string, text?: string) => {
  const e = document.createElement('div');
  e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
};

/**
 * The kill cam on screen (the server plays it: `killcam.ts`, `game.replay`): letterbox bars, a
 * KILLCAM stamp, who did it with what, the time left, and a way to skip it (click or Space; a
 * controller's trigger or A). The live HUD steps aside by itself while a replay plays, and the
 * first-person view shows the killer's hands and gun (the platform's kits, fed their state).
 */
export function killcam(): ClientKit {
  let unstyle: (() => void) | null = null;
  let root: HTMLElement;
  let card: HTMLElement;
  let fill: HTMLElement;
  let skip: HTMLElement;
  let on = false;
  /** The skip keys as they were last frame (a press, not a hold, skips). */
  let held = true;

  const show = (client: Client, d: Data | null) => {
    on = true;
    held = true;
    const who = el('cob-kc-who');
    if (d?.icon) {
      const img = client.hud.icon(d.icon);
      img.className = 'cob-kc-icon';
      who.append(img);
    }
    const name = el('cob-kc-name', d?.killer ?? 'Somebody');
    name.style.color = d?.color ?? '#ffcc00';
    who.append(name);
    const how = el('cob-kc-how', d?.weapon ?? '');
    if (d?.headshot) how.append(el('cob-kc-tag', 'HEADSHOT'));
    if (d?.through) how.append(el('cob-kc-tag', 'THROUGH THE WALL'));
    fill = el('cob-kc-fill');
    const time = el('cob-kc-time');
    time.append(fill);
    card.replaceChildren(el('cob-kc-by', 'KILLED BY'), who, how, time);
    skip.innerHTML = client.input.device === 'pad' ? 'SKIP <b>A</b>' : 'SKIP <b>CLICK</b> / <b>SPACE</b>';
    root.classList.add('on');
  };

  const hide = () => {
    on = false;
    root.classList.remove('on');
  };

  return {
    name: 'callofblocky.killcam',
    setup(client) {
      unstyle = client.hud.style(CSS);
      root = el('cob-kc');
      const stamp = el('cob-kc-stamp');
      stamp.append(el('cob-kc-rec'), document.createTextNode('KILLCAM'));
      card = el('cob-kc-card');
      skip = el('cob-kc-skip');
      root.append(el('cob-kc-vignette'), el('cob-kc-bar top'), el('cob-kc-bar bottom'), stamp, card, skip);
      client.hud.layer('callofblocky.killcam').append(root);
    },
    frame(client) {
      for (const e of client.events) {
        if (e.t === 'replay.start' && e.label === 'killcam') show(client, e.data as Data | null);
        else if ((e.t === 'replay.end' && e.label === 'killcam') || e.t === 'reset') hide();
      }
      const r = client.replay;
      // (Whatever ended it: gone with it.)
      if (on && !r.playing) hide();
      if (!on) return;
      fill.style.width = `${Math.min(100, (r.time / Math.max(0.01, r.duration)) * 100).toFixed(1)}%`;
      // A fresh click or Space (a controller's trigger or A) skips it.
      const down = client.input.button(0) || client.input.isDown('Space');
      if (down && !held && r.time > ARM && r.skippable) r.skip();
      held = down;
    },
    dispose() {
      unstyle?.();
    },
  };
}
