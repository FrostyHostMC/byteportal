import type { ClientKit } from '@platform/client';
import { course, SURF_NAMES } from '../course';
import { mph } from '../course/wind';
import { yards, yawOf } from '../scale';
import type { GolfState } from './state';

/**
 * The golfer's own panel, top left: the hole (its number, name, par and length), the stroke and
 * how the round stands against par, the wind (an arrow turned to where you look), and how far the
 * pin is from you. Along the bottom, what E would do here. Holding Tab, the card for the round.
 */
export function panelKit(st: GolfState): ClientKit {
  let el: HTMLElement;
  let hint: HTMLElement;
  let card: HTMLElement;
  let unstyle: (() => void) | null = null;
  let cardKey = '';
  const q = (s: string) => el.querySelector(s) as HTMLElement;

  return {
    name: 'golf.panel',
    setup(client) {
      unstyle = client.hud.style(CSS);
      const layer = client.hud.layer('golf.panel', 'panels');
      el = document.createElement('div');
      el.className = 'gp';
      el.innerHTML = `
        <div class="gp-hole"><span class="gp-num"></span><span class="gp-name"></span></div>
        <div class="gp-par"></div>
        <div class="gp-row"><span class="gp-stroke"></span><span class="gp-score"></span></div>
        <div class="gp-row"><span class="gp-wind"><i class="gp-arrow">↑</i><b class="gp-mph"></b></span><span class="gp-pin"></span></div>`;
      hint = document.createElement('div');
      hint.className = 'gp-hint';
      card = document.createElement('div');
      card.className = 'gp-card';
      layer.append(el, hint, card);
    },
    frame(client) {
      const r = st.round;
      el.classList.toggle('on', !!r);
      if (!r) return;
      const hi = Math.min(r.hole, 17);
      const h = course.holes[hi];
      const pin = h.green.pin;
      q('.gp-num').textContent = r.mode === 'done' ? 'F' : String(hi + 1);
      q('.gp-name').textContent = r.mode === 'done' ? 'Round complete' : h.name;
      q('.gp-par').textContent = `Par ${h.par} · ${h.yards} yds`;
      q('.gp-stroke').textContent = r.mode === 'done' ? `${r.total} strokes` : r.mode === 'holed' ? `Holed in ${r.card[hi] ?? r.strokes}` : `Stroke ${r.strokes + 1}`;
      const thru = r.card.filter((s) => s !== null).length;
      q('.gp-score').textContent = thru ? (r.toPar === 0 ? 'E' : r.toPar > 0 ? `+${r.toPar}` : `${r.toPar}`) : '';
      q('.gp-score').className = `gp-score ${r.toPar < 0 ? 'under' : r.toPar > 0 ? 'over' : ''}`;
      // The wind, turned to where you're looking (up: at your back).
      const look = client.me.look.yaw;
      const wy = yawOf(r.wind.x, r.wind.z);
      (q('.gp-arrow') as HTMLElement).style.transform = `rotate(${(-(wy - look) * 180) / Math.PI}deg)`;
      q('.gp-mph').textContent = `${mph(r.wind)} mph`;
      const me = client.me.position;
      q('.gp-pin').textContent = r.mode === 'done' ? '' : `Pin ${Math.round(yards(Math.hypot(pin.x - me.x, pin.z - me.z)))} yds`;

      // What E does here.
      let text = '';
      const b = r.ball;
      const c = r.cart;
      if (r.mode === 'walk' && b) {
        const d = Math.hypot(me.x - b.x, me.z - b.z);
        if (d < 3.2) text = '<b>E</b> step up to your ball';
        else if (c && Math.hypot(me.x - c.x, me.z - c.z) < 12) text = '<b>E</b> drive the cart · <b>F</b> caddie: to my ball';
        else text = `Your ball: ${Math.round(yards(d))} yds (${SURF_NAMES[r.lie ?? 1]}) · <b>C</b> call your cart · <b>F</b> caddie: take me there`;
      } else if (r.mode === 'drive' && b) {
        const d = Math.hypot(me.x - b.x, me.z - b.z);
        text = d < 9 ? '<b>E</b> out, and up to your ball' : `<b>W A S D</b> drive · <b>Space</b> brake · <b>E</b> get out · ball ${Math.round(yards(d))} yds`;
      }
      // Where your cart's parked, while you're on foot.
      const cartFar = c && r.mode === 'walk' ? Math.hypot(me.x - c.x, me.z - c.z) : 0;
      if (c && r.mode === 'walk' && cartFar > 2.5 && cartFar < 90) client.hud.marker('golf:cart', { x: c.x, y: c.y + 2.6, z: c.z }, { shape: 'box', color: '#9be26b', size: 10, label: cartFar < 12 ? 'Cart · E' : 'Cart' });
      else client.hud.marker('golf:cart', null);
      hint.innerHTML = text;
      hint.classList.toggle('on', !!text);

      // The card, while Tab is held.
      const show = client.input.isDown('Tab');
      card.classList.toggle('on', show);
      if (show) {
        const key = r.card.join(',') + r.hole;
        if (key !== cardKey) {
          cardKey = key;
          card.innerHTML = cardHtml(r.card, r.hole);
        }
      }
    },
    dispose() {
      unstyle?.();
    },
  };
}

function cardHtml(scores: (number | null)[], current: number): string {
  const nine = (from: number) => {
    const holes = course.holes.slice(from, from + 9);
    const par = holes.reduce((a, h) => a + h.par, 0);
    const done = scores.slice(from, from + 9);
    const sum = done.reduce<number>((a, s) => a + (s ?? 0), 0);
    const cell = (s: number | null, p: number, i: number) => {
      const cls = s === null ? (i === current ? 'now' : '') : s <= p - 2 ? 'eagle' : s === p - 1 ? 'birdie' : s === p ? 'par' : s === p + 1 ? 'bogey' : 'double';
      return `<td class="${cls}"><span>${s ?? ''}</span></td>`;
    };
    return `
      <tr class="n"><th>Hole</th>${holes.map((h) => `<td>${h.index + 1}</td>`).join('')}<th>${from ? 'In' : 'Out'}</th></tr>
      <tr class="p"><th>Par</th>${holes.map((h) => `<td>${h.par}</td>`).join('')}<th>${par}</th></tr>
      <tr class="s"><th>Score</th>${holes.map((h, i) => cell(done[i], h.par, from + i)).join('')}<th>${done.some((s) => s !== null) ? sum : ''}</th></tr>`;
  };
  return `<table>${nine(0)}${nine(9)}</table>`;
}

const CSS = `
.gp { position: absolute; left: 18px; top: 16px; min-width: 210px; padding: 10px 14px 11px; border-radius: 6px; background: linear-gradient(160deg, #0d1a10dd, #173022cc); border: 1px solid #9be26b33; color: #f3f7ef; font: 600 14px/1.35 var(--sans); box-shadow: 0 4px 18px #0007; display: none; }
.gp.on { display: block; }
.gp-hole { display: flex; align-items: baseline; gap: 10px; }
.gp-num { font: 700 38px/1 var(--pixel); color: #9be26b; }
.gp-name { font: 700 19px/1 var(--pixel); letter-spacing: 0.08em; text-transform: uppercase; }
.gp-par { opacity: 0.8; font-size: 13px; margin: 2px 0 6px; letter-spacing: 0.04em; }
.gp-row { display: flex; justify-content: space-between; gap: 18px; }
.gp-score { font-weight: 700; }
.gp-score.under { color: #ff6b5a; }
.gp-score.over { color: #cfd6ff; }
.gp-wind { display: inline-flex; align-items: center; gap: 6px; }
.gp-arrow { display: inline-block; font-style: normal; font-size: 18px; line-height: 1; color: #6fc2ff; }
.gp-hint { position: absolute; left: 50%; bottom: 70px; transform: translateX(-50%); padding: 7px 14px; border-radius: 999px; background: #0d1a10cc; color: #f3f7ef; font: 600 14px/1 var(--sans); white-space: nowrap; display: none; }
.gp-hint.on { display: block; }
.gp-hint b { color: #9be26b; font-family: var(--pixel); letter-spacing: 0.06em; }
.gp-card { position: absolute; left: 50%; bottom: 150px; transform: translateX(-50%); padding: 10px 12px; border-radius: 6px; background: #f6f1e2f2; color: #1d2a1f; display: none; box-shadow: 0 6px 24px #000a; }
.gp-card.on { display: block; }
.gp-card table { border-collapse: collapse; font: 600 13px/1 var(--sans); }
.gp-card th, .gp-card td { padding: 5px 6px; text-align: center; min-width: 24px; border-bottom: 1px solid #1d2a1f22; }
body.touch-mode :is(.gp, .gp-hint, .gp-card) { zoom: var(--hud-zoom, 1); }
body.touch-playing .gp { left: calc((env(safe-area-inset-left, 0px) + 62px * var(--touch-zoom, 1)) / var(--hud-zoom, 1)); }
body.touch-playing .gp-hint { bottom: calc(66px / var(--hud-zoom, 1)); }
.gp-card th { text-align: left; font-family: var(--pixel); letter-spacing: 0.06em; }
.gp-card tr.n td { color: #2f6b2a; font-weight: 700; }
.gp-card tr.p td { opacity: 0.7; }
.gp-card td span { display: inline-block; width: 20px; height: 20px; line-height: 20px; }
.gp-card td.birdie span { border: 2px solid #d8322c; border-radius: 50%; line-height: 16px; }
.gp-card td.eagle span { border: 2px solid #d8322c; border-radius: 50%; box-shadow: 0 0 0 2px #f6f1e2, 0 0 0 4px #d8322c; line-height: 16px; }
.gp-card td.bogey span { border: 2px solid #2d4f9e; line-height: 16px; }
.gp-card td.double span { border: 2px solid #2d4f9e; box-shadow: 0 0 0 2px #f6f1e2, 0 0 0 4px #2d4f9e; line-height: 16px; }
.gp-card td.now { background: #9be26b44; }
`;
