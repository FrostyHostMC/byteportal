import type { Client, ClientKit, IconRef } from '@platform/client';

/** What the server sends with the Play of the Game (`potg.ts`, `PotgData`). */
interface Data {
  name: string;
  color: string;
  bot: boolean;
  chapter: string;
  title: string;
  weapon: string | null;
  icon: IconRef | null;
  where: string;
  kills: { t: number; headshot: boolean; through: boolean; victim: string }[];
  hold: number;
}

/**
 * The title sequence's beats (seconds into the replay; its first frame stands still for `hold`):
 * the slam on black, then the freeze-frame and the name, then the chapter card, then the cut.
 */
const REVEAL = 0.55;
const CARD = 1.2;
/** How long before the hold's out the cut comes (a flash, a slash, and into their eyes). */
const CUT = 0.32;
/** Seconds into it before a click or Space skips it (a trigger still held doesn't). */
const ARM = 0.6;
/** Where the freeze-frame puts them on screen (fractions across and down): the arrow points there. */
const AT_X = 0.68;
const AT_Y = 0.4;
/** The portrait's field of view (degrees, vertical): long, like a telephoto close-up. */
const FOV = 42;

const TITLE_FONT = `'Anton', Impact, 'Haettenschweiler', 'Arial Narrow Bold', sans-serif`;

const CSS = /* css */ `
.pg { position: absolute; inset: 0; pointer-events: none; display: none; overflow: hidden; }
.pg.on { display: block; }

/* The freeze-frame: drained to a dusty, contrasty print, with grain, halftone at the edges and focus lines on them. */
.pg-freeze { position: absolute; inset: 0; opacity: 0; transition: opacity 120ms linear;
  backdrop-filter: grayscale(0.7) sepia(0.5) contrast(1.3) brightness(1.04) saturate(1.3);
  -webkit-backdrop-filter: grayscale(0.7) sepia(0.5) contrast(1.3) brightness(1.04) saturate(1.3);
  background: radial-gradient(ellipse at ${AT_X * 100}% ${AT_Y * 100}%, rgba(255,210,120,0.08) 0 30%, rgba(40,6,0,0.55) 100%); }
.pg.s2:not(.s5) .pg-freeze { opacity: 1; }
.pg-dots { position: absolute; inset: 0; opacity: 0; mix-blend-mode: multiply;
  background: radial-gradient(circle, rgba(20,8,4,0.55) 32%, transparent 36%) 0 0 / 9px 9px;
  -webkit-mask: radial-gradient(ellipse at ${AT_X * 100}% ${AT_Y * 100}%, transparent 35%, #000 80%);
  mask: radial-gradient(ellipse at ${AT_X * 100}% ${AT_Y * 100}%, transparent 35%, #000 80%); }
.pg.s2:not(.s5) .pg-dots { opacity: 0.8; }
.pg-lines { position: absolute; left: -50%; top: -50%; width: 200%; height: 200%; opacity: 0;
  background: repeating-conic-gradient(from 0deg at ${25 + AT_X * 50}% ${25 + AT_Y * 50}%, rgba(255,246,220,0) 0deg 4deg, rgba(255,246,220,0.55) 4deg 4.6deg, rgba(255,246,220,0) 4.6deg 7.3deg);
  -webkit-mask: radial-gradient(ellipse at ${25 + AT_X * 50}% ${25 + AT_Y * 50}%, transparent 17%, #000 34%);
  mask: radial-gradient(ellipse at ${25 + AT_X * 50}% ${25 + AT_Y * 50}%, transparent 17%, #000 34%);
  animation: pg-jitter 0.18s steps(1) infinite; }
.pg.s2:not(.s5) .pg-lines { opacity: 1; transition: opacity 200ms ease 80ms; }
@keyframes pg-jitter { 0% { transform: rotate(0deg); } 33% { transform: rotate(1.3deg); } 66% { transform: rotate(-0.9deg); } }
.pg-grain { position: absolute; inset: -20px; opacity: 0; mix-blend-mode: overlay;
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='160' height='160'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E");
  animation: pg-grain 0.3s steps(3) infinite; }
.pg.on:not(.s5) .pg-grain { opacity: 0.5; }
.pg.s5 .pg-grain { opacity: 0.18; }
@keyframes pg-grain { 0% { transform: translate(0, 0); } 33% { transform: translate(-7px, 5px); } 66% { transform: translate(6px, -4px); } }

/* Letterbox: wide for the titles, narrower once it plays. */
.pg-bar { position: absolute; left: 0; right: 0; height: 0; background: #0b0b0d; transition: height 260ms cubic-bezier(.2,.8,.2,1); z-index: 3; }
.pg-bar.top { top: 0; }
.pg-bar.bottom { bottom: 0; }
.pg.on .pg-bar { height: 10vh; }
.pg.s5 .pg-bar { height: 7.5vh; }

/* The slam: on black, bands tear across, and the words land. */
.pg-black { position: absolute; inset: 0; background: #0b0b0d; opacity: 1; z-index: 2; }
.pg.s2 .pg-black { opacity: 0; transition: opacity 180ms ease-out; }
.pg-slash { position: absolute; left: -30%; right: -30%; top: 50%; height: 0; z-index: 4; transform: rotate(-12deg); }
.pg-slash i { position: absolute; left: 0; right: 0; transform: translateX(-120%); }
.pg-slash i:nth-child(1) { top: -34vh; height: 22vh; background: #ffcc00; }
.pg-slash i:nth-child(2) { top: -12vh; height: 26vh; background: #e63946; }
.pg-slash i:nth-child(3) { top: 14vh; height: 16vh; background: #fdf1d6; }
.pg.s1 .pg-slash i { animation: pg-tear 420ms cubic-bezier(.6,0,.3,1) both; }
.pg.s1 .pg-slash i:nth-child(2) { animation-delay: 40ms; }
.pg.s1 .pg-slash i:nth-child(3) { animation-delay: 80ms; }
.pg.s4 .pg-slash i { animation: pg-tear 300ms cubic-bezier(.7,0,.3,1) both; }
.pg.s4 .pg-slash i:nth-child(2) { animation-delay: 30ms; }
.pg.s4 .pg-slash i:nth-child(3) { animation-delay: 60ms; }
@keyframes pg-tear { 0% { transform: translateX(-120%) skewX(-30deg); } 100% { transform: translateX(120%) skewX(-30deg); } }

.pg-slam { position: absolute; left: 50%; top: 50%; z-index: 5; white-space: nowrap; opacity: 0;
  font: 400 min(17vw, 21vh)/0.88 ${TITLE_FONT}; letter-spacing: 0.01em; color: #ffcc00; text-transform: uppercase;
  -webkit-text-stroke: 0.05em #111; paint-order: stroke fill; text-shadow: 0.06em 0.06em 0 #e63946, 0.1em 0.1em 0 #111;
  transform: translate(-50%, -50%) rotate(-6deg) scale(3); filter: blur(6px); }
.pg-slam small { display: block; font-size: 0.38em; letter-spacing: 0.3em; color: #fdf1d6; text-shadow: 0.08em 0.08em 0 #111; }
.pg.s1 .pg-slam { opacity: 1; transform: translate(-50%, -50%) rotate(-6deg) scale(1); filter: blur(0); transition: transform 170ms cubic-bezier(.5,0,.8,.4) 110ms, filter 170ms ease 110ms, opacity 60ms linear 110ms; }
.pg.s2 .pg-slam { opacity: 0; transform: translate(-50%, -50%) rotate(-6deg) scale(0.5); transition: transform 220ms cubic-bezier(.4,0,.2,1), opacity 180ms ease; }

/* The stamp it leaves in the corner. */
.pg-stamp { position: absolute; left: 3vw; top: calc(10vh + 2.2vh); z-index: 5; display: flex; align-items: center; gap: 12px;
  padding: 6px 18px 7px; background: #e63946; border: 3px solid #111; box-shadow: 5px 5px 0 #111;
  font: 400 clamp(20px, 3.2vh, 34px)/1 ${TITLE_FONT}; letter-spacing: 0.1em; color: #fdf1d6;
  -webkit-text-stroke: 1.5px #111; paint-order: stroke fill; text-shadow: 2px 2px 0 #111;
  transform: translateX(-140%) rotate(-3deg); }
.pg.s2 .pg-stamp { transform: translateX(0) rotate(-3deg); transition: transform 320ms cubic-bezier(.2,1.4,.4,1) 60ms; }
.pg-rec { width: 13px; height: 13px; border-radius: 50%; background: #fdf1d6; border: 2px solid #111; animation: pg-blink 0.9s steps(2, jump-none) infinite; }
@keyframes pg-blink { 50% { background: #111; } }

/* The name, on a band slashed across the frame. */
.pg-band { position: absolute; left: -6vw; top: 58vh; width: 56vw; z-index: 5; transform: translateX(-120%) rotate(-6deg); transform-origin: left center; }
.pg.s2 .pg-band { transform: translateX(0) rotate(-6deg); transition: transform 380ms cubic-bezier(.15,1.35,.35,1) 140ms; }
.pg.s4 .pg-band { transform: translateX(200%) rotate(-6deg); transition: transform 260ms cubic-bezier(.7,0,.9,.4); }
.pg-band::before { content: ''; position: absolute; inset: -1.6vh -2vw; background: #e63946; transform: translate(1.4vw, 1.4vh); border: 3px solid #111; }
.pg-band-in { position: relative; padding: 1.2vh 3vw 1.4vh 9vw; background: #0b0b0d; border-top: 0.9vh solid #ffcc00; border-bottom: 0.9vh solid #ffcc00; }
.pg-name { font: 400 15vh/1 ${TITLE_FONT}; color: #ffcc00; text-transform: uppercase; white-space: nowrap; letter-spacing: 0.02em;
  transform: skewX(-8deg); -webkit-text-stroke: 0.035em #111; paint-order: stroke fill; text-shadow: 0.05em 0.05em 0 #e63946; }
.pg-name span { display: inline-block; opacity: 0; transform: translateY(-0.6em) scale(1.6); }
.pg.s2 .pg-name span { opacity: 1; transform: none; transition: transform 160ms cubic-bezier(.3,1.6,.5,1), opacity 60ms linear; }
.pg-sub { margin-top: 0.4vh; font: 600 2.6vh/1 'Barlow Condensed', 'Arial Narrow', sans-serif; letter-spacing: 0.42em; color: #fdf1d6; text-transform: uppercase; opacity: 0.85; }

/* The arrow at them (a freeze-frame's introduction). */
.pg-arrow { position: absolute; inset: 0; width: 100%; height: 100%; z-index: 4; overflow: visible; }
.pg-arrow path { fill: none; stroke: #ffcc00; stroke-width: 7; stroke-linecap: round; stroke-linejoin: round; stroke-dasharray: 1; stroke-dashoffset: 1; filter: drop-shadow(3px 3px 0 #111); }
.pg.s3:not(.s4) .pg-arrow path { stroke-dashoffset: 0; transition: stroke-dashoffset 260ms cubic-bezier(.3,0,.2,1); }
.pg.s4 .pg-arrow path { opacity: 0; transition: opacity 100ms linear; }

/* The chapter card, typed out. */
.pg-card { position: absolute; left: 3vw; top: calc(10vh + 10.5vh); z-index: 5; max-width: 40vw; padding: 1.6vh 1.8vw 1.8vh; background: #0b0b0d; border: 2px solid #fdf1d6;
  color: #fdf1d6; opacity: 0; transform: translateY(-12px); }
.pg.s3 .pg-card { opacity: 1; transform: none; transition: opacity 120ms linear, transform 200ms ease-out; }
.pg.s4 .pg-card { opacity: 0; transition: opacity 120ms linear; }
.pg-chapter { font: 600 2.3vh/1 'Barlow Condensed', 'Arial Narrow', sans-serif; letter-spacing: 0.5em; opacity: 0.8; min-height: 1em; }
.pg-title { margin-top: 0.9vh; font: 400 5.4vh/1 ${TITLE_FONT}; letter-spacing: 0.04em; color: #fdf1d6; min-height: 1em; white-space: nowrap; }
.pg-title::after, .pg-chapter.typing::after { content: '▌'; color: #e63946; margin-left: 2px; animation: pg-blink 0.5s steps(2, jump-none) infinite; }
.pg-title.done::after { content: none; }
.pg-with { display: flex; align-items: center; gap: 10px; margin-top: 1.1vh; font: 600 2vh/1 'Barlow Condensed', 'Arial Narrow', sans-serif; letter-spacing: 0.2em; color: #ffcc00; opacity: 0; }
.pg-with.on { opacity: 1; transition: opacity 200ms ease; }
.pg-with img { height: 3.6vh; width: auto; image-rendering: pixelated; filter: drop-shadow(1px 1px 0 #000) brightness(1.1); }

/* The cut: a white flash as it goes into their eyes. */
.pg-flash { position: absolute; inset: 0; background: #fff; opacity: 0; z-index: 6; }
.pg.s5 .pg-flash { animation: pg-flash 420ms ease-out both; }
@keyframes pg-flash { 0% { opacity: 0.95; } 100% { opacity: 0; } }

/* Playing: whose it is, the kills as they come, the time left. */
.pg-tag { position: absolute; left: 32px; bottom: calc(7.5vh + 26px); z-index: 5; min-width: 320px; padding: 9px 16px 11px; background: #fdf1d6; color: #111;
  border: 3px solid #111; box-shadow: 6px 6px 0 #111; border-radius: 3px; transform: translate(-130%, 0) rotate(-1deg); }
.pg.s5 .pg-tag { transform: translate(0, 0) rotate(-1deg); transition: transform 320ms cubic-bezier(.2,1.3,.4,1) 120ms; }
.pg-tag-by { font: 700 12px var(--pixel); letter-spacing: 0.18em; opacity: 0.7; }
.pg-tag-who { display: flex; align-items: center; gap: 12px; margin-top: 2px; }
.pg-tag-name { font: 400 32px/1.05 ${TITLE_FONT}; letter-spacing: 0.04em; text-transform: uppercase; -webkit-text-stroke: 1.5px #111; paint-order: stroke fill; text-shadow: 2px 2px 0 #111; }
.pg-tag-who img { height: 34px; width: auto; max-width: 110px; image-rendering: pixelated; filter: drop-shadow(2px 2px 0 rgba(0,0,0,0.35)); }
.pg-tag-title { margin-top: 3px; font: 600 15px 'Barlow Condensed', var(--sans); letter-spacing: 0.22em; }
.pg-pips { display: flex; gap: 6px; margin-top: 8px; }
.pg-pips i { width: 16px; height: 16px; border: 2.5px solid #111; background: transparent; transform: rotate(45deg); }
.pg-pips i.hit { background: #e63946; animation: pg-pip 260ms cubic-bezier(.3,1.8,.5,1); }
@keyframes pg-pip { 0% { transform: rotate(45deg) scale(2.2); } 100% { transform: rotate(45deg) scale(1); } }
.pg-time { margin-top: 9px; height: 7px; background: rgba(0,0,0,0.12); border: 2px solid #111; }
.pg-fill { height: 100%; width: 0; background: #e63946; }

.pg-pop { position: absolute; right: 7vw; top: 38vh; z-index: 5; text-align: right; pointer-events: none; }
.pg-pop-word { font: 400 11vh/0.95 ${TITLE_FONT}; color: #ffcc00; letter-spacing: 0.02em; transform: rotate(-6deg);
  -webkit-text-stroke: 0.04em #111; paint-order: stroke fill; text-shadow: 0.05em 0.05em 0 #e63946, 0.09em 0.09em 0 #111; }
.pg-pop-sub { margin-top: 0.8vh; font: 700 2.2vh var(--pixel); letter-spacing: 0.16em; color: #fdf1d6; text-shadow: 2px 2px 0 #111; transform: rotate(-6deg); }
.pg-pop.go { animation: pg-pop 1.3s cubic-bezier(.2,1.2,.4,1) both; }
@keyframes pg-pop { 0% { opacity: 0; transform: scale(2.4); } 12% { opacity: 1; transform: scale(1); } 80% { opacity: 1; transform: scale(1); } 100% { opacity: 0; transform: translateX(6vw); } }

.pg-skip { position: absolute; right: 28px; bottom: calc(7.5vh + 26px); z-index: 5; padding: 7px 14px; background: #111; color: #fdf1d6;
  border: 2px solid #fdf1d6; box-shadow: 4px 4px 0 rgba(0,0,0,0.5); font: 700 14px var(--pixel); letter-spacing: 0.1em; opacity: 0; }
.pg.s2 .pg-skip { opacity: 1; transition: opacity 300ms ease 600ms; }
.pg-skip b { color: #ffcc00; }
`;

const el = (cls: string, text?: string) => {
  const e = document.createElement('div');
  e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
};

/** What each kill in it is called, by how many so far. */
const COUNT = ['', 'ONE DOWN', 'DOUBLE', 'TRIPLE', 'QUAD', 'MASSACRE'];

const ease = (k: number) => 1 - (1 - k) ** 3;

/**
 * The Play of the Game on screen (the server picks it and plays it: `potg.ts`, `game.replay`). Its
 * first frame stands still (`hold`) for a title sequence, pulp-cinema and fighting-game at once:
 * - on black, colour bands tear across and PLAY OF THE GAME slams down;
 * - the black falls away to a freeze-frame of them, shot from in front and low (the camera's this
 *   screen's: `client.camera.take`), drained to an old print with focus lines round them, their name
 *   slammed onto a band across the frame and an arrow at them;
 * - a chapter card types itself out: CHAPTER THREE, TRIPLE FEATURE, where, and with what;
 * - a white flash, and it plays through their eyes, each kill called out as it lands.
 * Skipped with a click or Space (a controller's trigger or A), as the kill cam is.
 */
export function potg(): ClientKit {
  let unstyle: (() => void) | null = null;
  let root: HTMLElement;
  let name: HTMLElement;
  let sub: HTMLElement;
  let chapter: HTMLElement;
  let title: HTMLElement;
  let withLine: HTMLElement;
  let arrow: SVGPathElement;
  let tag: HTMLElement;
  let pips: HTMLElement[] = [];
  let fill: HTMLElement;
  let pop: HTMLElement;
  let skip: HTMLElement;
  let data: Data | null = null;
  let on = false;
  let taken = false;
  let held = true;
  /** How far each beat has got: stages reached, letters typed, kills called. */
  let stage = 0;
  let typed = -1;
  let called = 0;

  const stages = ['s1', 's2', 's3', 's4', 's5'];

  const show = (client: Client, d: Data | null) => {
    on = true;
    held = true;
    data = d;
    stage = 0;
    typed = -1;
    called = 0;
    root.classList.remove(...stages);
    const who = (d?.name ?? 'Somebody').toUpperCase();
    // The name as letters that land one after another; long names smaller, to fit the band.
    name.replaceChildren(
      ...[...who].map((ch, i) => {
        const s = document.createElement('span');
        s.textContent = ch === ' ' ? ' ' : ch;
        s.style.transitionDelay = `${180 + i * 28}ms`;
        return s;
      }),
    );
    name.style.fontSize = `min(15vh, ${(88 / Math.max(5, who.length)).toFixed(2)}vw)`;
    sub.textContent = d?.bot ? `A HIRED GUN · ${d.where}` : (d?.where ?? '');
    chapter.textContent = '';
    title.textContent = '';
    title.classList.remove('done');
    withLine.replaceChildren();
    withLine.classList.remove('on');
    if (d?.icon) {
      const img = client.hud.icon(d.icon);
      withLine.append(img);
    }
    if (d?.weapon) withLine.append(document.createTextNode(`WITH ${d.weapon.toUpperCase()}`));
    // The card that stays up while it plays.
    const whoTag = el('pg-tag-who');
    const tagName = el('pg-tag-name', d?.name ?? 'Somebody');
    tagName.style.color = d?.color ?? '#ffcc00';
    whoTag.append(tagName);
    if (d?.icon) whoTag.append(client.hud.icon(d.icon));
    const row = el('pg-pips');
    pips = (d?.kills ?? []).map(() => document.createElement('i'));
    row.append(...pips);
    fill = el('pg-fill');
    const time = el('pg-time');
    time.append(fill);
    tag.replaceChildren(el('pg-tag-by', 'STARRING'), whoTag, el('pg-tag-title', `${d?.chapter ?? ''} · ${d?.title ?? ''}`), row, time);
    pop.className = 'pg-pop';
    skip.innerHTML = client.input.device === 'pad' ? 'SKIP <b>A</b>' : 'SKIP <b>CLICK</b> / <b>SPACE</b>';
    // The arrow: from the band's end up to them.
    const w = window.innerWidth;
    const h = window.innerHeight;
    const tx = (AT_X - 0.1) * w;
    const ty = (AT_Y - 0.1) * h;
    const fx = 0.47 * w;
    const fy = 0.5 * h;
    const head = 22;
    const ang = Math.atan2(ty - fy, tx - fx);
    const hx = (a: number) => (tx - Math.cos(ang + a) * head).toFixed(1);
    const hy = (a: number) => (ty - Math.sin(ang + a) * head).toFixed(1);
    arrow.setAttribute('d', `M${fx.toFixed(1)} ${fy.toFixed(1)} Q${(fx + 0.01 * w).toFixed(1)} ${(ty + 0.02 * h).toFixed(1)} ${tx.toFixed(1)} ${ty.toFixed(1)} M${hx(0.5)} ${hy(0.5)} L${tx.toFixed(1)} ${ty.toFixed(1)} L${hx(-0.5)} ${hy(-0.5)}`);
    root.classList.add('on');
  };

  const hide = (client: Client) => {
    if (taken) client.camera.release(0);
    taken = false;
    on = false;
    data = null;
    root.classList.remove('on', ...stages);
  };

  /** The freeze-frame's camera: in front of them and a little low, easing in and round as the title holds. */
  const portrait = (client: Client, t: number, hold: number) => {
    const me = client.me;
    const p = me.position;
    const yaw = me.look.yaw;
    const k = ease(Math.min(1, t / hold));
    // Which way they face, and round from it (the camera swings in toward their face).
    const turn = 0.5 - 0.3 * k;
    const fx = -Math.sin(yaw + turn);
    const fz = -Math.cos(yaw + turn);
    const top = p.y + (me.crouching || me.sliding ? 1.05 : 1.45);
    const head = { x: p.x, y: top, z: p.z };
    let dist = 3.4 - 0.8 * k;
    // (A wall behind the camera: it comes in to stay on their side of it.)
    const out = { x: fx, y: -0.12, z: fz };
    const len = Math.hypot(out.x, out.y, out.z);
    const dir = { x: out.x / len, y: out.y / len, z: out.z / len };
    const hit = client.world.raycast(head, dir, dist + 0.4);
    if (hit) dist = Math.max(0.9, hit.distance - 0.4);
    const cam = { x: head.x + dir.x * dist, y: head.y + dir.y * dist, z: head.z + dir.z * dist };
    // Look off to one side and a little down, so they stand right of centre (at AT_X, AT_Y).
    const tanV = Math.tan(((FOV / 2) * Math.PI) / 180);
    const aspect = window.innerWidth / Math.max(1, window.innerHeight);
    const side = (AT_X - 0.5) * 2 * tanV * aspect * dist;
    const drop = (0.5 - AT_Y) * 2 * tanV * dist;
    // The camera's right, looking back at them.
    const rx = dir.z;
    const rz = -dir.x;
    const target = { x: head.x - rx * side, y: head.y - drop, z: head.z - rz * side };
    client.camera.take({ position: cam, target, fov: FOV });
    taken = true;
  };

  return {
    name: 'callofblocky.potg',
    setup(client) {
      unstyle = client.hud.style(CSS);
      define(client);
      root = el('pg');
      const slash = el('pg-slash');
      slash.append(document.createElement('i'), document.createElement('i'), document.createElement('i'));
      const slam = el('pg-slam');
      slam.innerHTML = 'PLAY OF<br>THE GAME';
      const stamp = el('pg-stamp');
      stamp.append(el('pg-rec'), document.createTextNode('PLAY OF THE GAME'));
      const band = el('pg-band');
      const bandIn = el('pg-band-in');
      name = el('pg-name');
      sub = el('pg-sub');
      bandIn.append(name, sub);
      band.append(bandIn);
      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      svg.setAttribute('class', 'pg-arrow');
      arrow = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      arrow.setAttribute('pathLength', '1');
      svg.append(arrow);
      const card = el('pg-card');
      chapter = el('pg-chapter');
      title = el('pg-title');
      withLine = el('pg-with');
      card.append(chapter, title, withLine);
      tag = el('pg-tag');
      pop = el('pg-pop');
      skip = el('pg-skip');
      root.append(el('pg-freeze'), el('pg-dots'), el('pg-lines'), el('pg-grain'), el('pg-black'), svg, band, card, slam, stamp, slash, tag, pop, skip, el('pg-flash'), el('pg-bar top'), el('pg-bar bottom'));
      client.hud.layer('callofblocky.potg').append(root);
    },
    frame(client) {
      for (const e of client.events) {
        if (e.t === 'replay.start' && e.label === 'potg') show(client, e.data as Data | null);
        else if ((e.t === 'replay.end' && e.label === 'potg') || e.t === 'reset') hide(client);
      }
      const r = client.replay;
      if (on && (!r.playing || r.label !== 'potg')) hide(client);
      if (!on) return;
      const t = r.time;
      const hold = r.hold || data?.hold || 0;
      // The beats, each once.
      const due = [0, REVEAL, CARD, hold - CUT, hold].filter((at) => t >= at).length;
      while (stage < due) {
        root.classList.add(stages[stage]);
        stage++;
        if (stage === 1) {
          client.audio.play('potg_whoosh');
          client.audio.play('potg_slam');
        } else if (stage === 2) {
          client.fx.shake(0.35, 0.3);
          client.audio.play('potg_riff');
        } else if (stage === 4) client.audio.play('potg_whoosh');
        else if (stage === 5) client.audio.play('potg_cut');
      }
      // The freeze-frame's camera, till the cut: then their own eyes, under the flash.
      if (stage < 5) portrait(client, t, hold);
      else if (taken) {
        client.camera.release(0);
        taken = false;
      }
      // The chapter card, typed: its chapter, then its title, then what with.
      if (stage >= 3 && data) {
        const n = Math.floor((t - CARD) / 0.045);
        if (n !== typed) {
          const a = data.chapter;
          const b = data.title;
          chapter.textContent = a.slice(0, n);
          chapter.classList.toggle('typing', n < a.length);
          title.textContent = n > a.length + 2 ? b.slice(0, n - a.length - 3) : '';
          title.classList.toggle('done', n >= a.length + 3 + b.length);
          if (n >= a.length + 3 + b.length + 2) withLine.classList.add('on');
          if (n > typed && n <= a.length + b.length + 3 && n % 2 === 0) client.audio.play('potg_type');
          typed = n;
        }
      }
      // Playing: each kill called out as it lands, and the time left.
      if (stage >= 5 && data) {
        const into = t - hold;
        while (called < data.kills.length && into >= data.kills[called].t) {
          const k = data.kills[called];
          called++;
          pips[called - 1]?.classList.add('hit');
          const word = el('pg-pop-word', COUNT[Math.min(COUNT.length - 1, called)]);
          const how = [k.headshot ? 'HEADSHOT' : '', k.through ? 'THROUGH THE WALL' : ''].filter(Boolean).join(' · ');
          pop.replaceChildren(word, el('pg-pop-sub', how || k.victim.toUpperCase()));
          pop.className = 'pg-pop';
          void pop.offsetWidth;
          pop.className = 'pg-pop go';
          client.audio.play('potg_hit');
        }
        const play = Math.max(0.01, r.duration - hold);
        fill.style.width = `${Math.min(100, (into / play) * 100).toFixed(1)}%`;
      }
      // A fresh click or Space (a controller's trigger or A) skips it.
      const down = client.input.button(0) || client.input.isDown('Space');
      if (down && !held && t > ARM && r.skippable) r.skip();
      held = down;
    },
    dispose() {
      unstyle?.();
    },
  };
}

/** Its sounds: a whoosh and a slam, a surf guitar tearing down the neck, keys typing, the cut, and a hit for each kill. */
function define(client: Client) {
  const a = client.audio;
  a.define('potg_whoosh', (s) => {
    s.noise({ duration: 0.34, filter: 'bandpass', from: 380, to: 3600, q: 1.4, volume: 0.5, attack: 0.12 });
  }, { reverb: 0.2 });
  a.define('potg_slam', (s) => {
    s.tone({ wave: 'sine', from: 110, to: 32, duration: 0.7, volume: 1, delay: 0.13 });
    s.tone({ wave: 'square', from: 180, to: 50, duration: 0.14, volume: 0.25, delay: 0.13, lowpass: 900 });
    s.noise({ duration: 0.45, delay: 0.13, filter: 'lowpass', from: 4200, to: 180, volume: 0.8 });
    s.noise({ duration: 0.9, delay: 0.16, filter: 'highpass', from: 7000, to: 3000, volume: 0.18 });
  }, { reverb: 0.5 });
  // The surf guitar: fast-picked notes sliding down the neck, an octave and more.
  a.define('potg_riff', (s) => {
    const picks = 26;
    for (let i = 0; i < picks; i++) {
      const f = 659.25 * 2 ** (-(i * 19) / (picks - 1) / 12);
      const delay = i * 0.034;
      s.tone({ wave: 'sawtooth', from: f, to: f * 0.985, duration: 0.05, volume: 0.13, delay, lowpass: 2800, attack: 0.003, drive: 0.35 });
      s.tone({ wave: 'square', from: f / 2, to: f / 2, duration: 0.05, volume: 0.04, delay, lowpass: 900, attack: 0.003 });
    }
    // Landing: a low E, rung out.
    s.tone({ wave: 'sawtooth', from: 82.4, to: 81.6, duration: 1.2, volume: 0.2, delay: picks * 0.034, lowpass: 1600, drive: 0.4, vibrato: { rate: 7, depth: 0.012 } });
    s.tone({ wave: 'sine', from: 60, to: 40, duration: 0.3, volume: 0.6, delay: picks * 0.034 });
  }, { reverb: 0.6 });
  a.define('potg_type', (s) => {
    s.noise({ duration: 0.03, filter: 'bandpass', from: 2600, to: 1800, q: 4, volume: 0.28 });
    s.tone({ wave: 'square', from: 900, to: 500, duration: 0.02, volume: 0.05, lowpass: 3000 });
  }, { reverb: 0 });
  a.define('potg_cut', (s) => {
    s.noise({ duration: 0.25, filter: 'highpass', from: 2000, to: 9000, volume: 0.3, attack: 0.2 });
    s.tone({ wave: 'sine', from: 90, to: 36, duration: 0.45, volume: 0.8, delay: 0.2 });
    s.noise({ duration: 0.3, delay: 0.2, filter: 'lowpass', from: 3000, to: 200, volume: 0.45 });
  }, { reverb: 0.4 });
  a.define('potg_hit', (s) => {
    s.tone({ wave: 'triangle', from: 150, to: 60, duration: 0.3, volume: 0.55 });
    s.noise({ duration: 0.12, filter: 'bandpass', from: 1800, to: 900, q: 2, volume: 0.3 });
  }, { reverb: 0.3 });
}
