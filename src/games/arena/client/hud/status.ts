import type { Client, ClientKit } from '@platform/client';
import { MSG, type GoldMsg, type MeMsg, type PartyMsg, type RunMsg } from '../../hud/messages';
import css from './status.css?raw';
import { clock, el, hidden, hud, num, project, replay } from './store';

/**
 * The Arena's standing HUD on each screen, drawn from what the server part says (`store.ts`):
 *
 * - the wave (top middle): its number and name, the enemies left as a bar, its twist as a chip
 *   (a boss has its bar under it); between waves the time to the next and what it is; before the
 *   first, the countdown;
 * - gold and the crowd (bottom right): the fighter's gold, rolling up to what it is with "+12"s
 *   popping beside it (a bonus saying what it's for; gold found further off rising where it was,
 *   when that's in sight), and the crowd's hype as a meter that glows and shakes while the
 *   Crowd's Favour is on, counting it down;
 * - bottom left, over the health: the party (in co-op: each friend's name, class and health, or
 *   down and bleeding out, or sitting the wave out) over the blessings (an icon each in its
 *   rarity's colour, the newest arriving with a flash);
 * - the hotbar's weapons marked in their rarity's colour (the theme draws it: `hud.css`).
 */
export function status(): ClientKit {
  let unstyle: (() => void) | null = null;
  let layer: HTMLElement;
  let draw: ((dt: number) => void) | null = null;
  return {
    name: 'arena.hud.status',
    setup(client) {
      unstyle = client.hud.style(css);
      // The end screen's veil first, under everything of the Arena's (and the widgets).
      client.hud.layer('arena.endveil', 'panels').append(el('div.ar-endveil'));
      layer = client.hud.layer('arena.status', 'panels');
      draw = build(client, layer);
    },
    frame(_client, dt) {
      draw?.(dt);
    },
    dispose() {
      unstyle?.();
    },
  };
}

function build(client: Client, layer: HTMLElement): (dt: number) => void {
  // The wave.
  const kicker = el('div.ar-wave-k');
  const big = el('span.ar-wave-big');
  const of = el('span.ar-wave-of');
  const name = el('div.ar-wave-name');
  const fill = el('i');
  const left = el('span.ar-wave-left');
  const bar = el('div.ar-wave-bar', el('div.ar-wave-track', fill), left);
  const chips = el('div.ar-chips');
  const hint = el('div.ar-wave-hint');
  const wave = el('div.ar-wave', kicker, el('div.ar-wave-n', el('i.ar-orn'), big, of, el('i.ar-orn.r')), name, bar, el('div.ar-wave-foot', chips, hint));

  // Gold and the crowd.
  const goldN = el('span.ar-gold-n', '0');
  const twice = el('span.ar-gold-x2', '×2');
  const pops = el('div.ar-gold-pops');
  const gold = el('div.ar-gold', el('i.ar-coin'), goldN, twice, pops);
  const hypeFill = el('i');
  const hypeLabel = el('span.ar-hype-label', 'The crowd');
  const hypeTime = el('span.ar-hype-time');
  const hype = el('div.ar-hype', el('div.ar-hype-head', el('i.ar-laurel'), hypeLabel, hypeTime), el('div.ar-hype-track', hypeFill));
  const purse = el('div.ar-purse', gold, hype);

  const party = el('div.ar-party');
  const bless = el('div.ar-bless');
  const world = el('div.ar-world');
  const shade = el('div.ar-shade');
  // The party over the blessings, bottom left, over the health.
  layer.append(shade, wave, purse, el('div.ar-left', party, bless), world);

  let runKey = '';
  /** The phase and wave last shown: a new one arrives with a flourish. */
  let shownAt = '';
  let partyKey = '';
  let blessKey = '';
  let shownGold = 0;
  let goldTarget = 0;
  let hypeKey = '';
  let favourOn = false;
  let hotbarKey = '';
  /** "+12"s by the counter: the one adding up now, and when it fades. */
  let pop: { el: HTMLElement; n: number; until: number } | null = null;
  /** Gold popped where it was picked up, rising and fading. */
  const floaters: { el: HTMLElement; at: { x: number; y: number; z: number }; t: number }[] = [];

  client.on(MSG.gold, (d) => {
    const g = d as GoldMsg;
    if (typeof g?.d !== 'number' || g.d === 0) return;
    goldTarget = Math.max(0, goldTarget + g.d);
    if (g.d < 0) {
      // Spent: the counter drops at once, no pop.
      shownGold = goldTarget;
      goldN.textContent = num(shownGold);
      return;
    }
    const now = client.time;
    // A bonus says what it's for, on its own line; coins add up in one.
    const label = g.why ? WHY[g.why] : undefined;
    if (!label && pop && now < pop.until - 0.6) {
      pop.n += g.d;
      pop.el.textContent = `+${num(pop.n)}`;
      replay(pop.el, 'bump');
    } else {
      const e = el('span.ar-gold-pop', `+${num(g.d)}`, label ? el('small', label) : null);
      pops.prepend(e);
      while (pops.children.length > 3) pops.lastChild!.remove();
      pop = { el: e, n: g.d, until: now };
    }
    pop.until = now + 1.6;
    replay(gold, 'got');
    client.audio.play('ar_coin', { volume: 0.5, pitch: 0.95 + Math.min(0.3, g.d / 200) });
    // Gold found further off (not coins pulled in at their feet) rises where it was.
    const cam = client.camera.position;
    if (g.at && Math.hypot(g.at[0] - cam.x, g.at[1] - cam.y, g.at[2] - cam.z) > 3.5) {
      const f = el('div.ar-float', `+${num(g.d)}`);
      world.append(f);
      floaters.push({ el: f, at: { x: g.at[0], y: g.at[1] + 1.2, z: g.at[2] }, t: 0 });
    }
  });

  const showRun = (r: RunMsg) => {
    const key = JSON.stringify([r.phase, r.wave, r.of, r.name, r.left, r.total, r.next, r.twist?.name, r.boss?.name, r.upcoming?.name, r.mapName, r.ready, r.endless, r.time, r.kills]);
    if (key === runKey) return;
    runKey = key;
    const on = r.phase === 'countdown' || r.phase === 'fighting' || r.phase === 'intermission';
    wave.classList.toggle('on', on);
    shade.classList.toggle('on', on);
    wave.dataset.phase = r.phase;
    if (!on) return;
    const endless = r.endless || r.wave > r.of;
    if (r.phase === 'countdown') {
      kicker.textContent = 'The games begin';
      big.textContent = r.next > 9 ? clock(r.next) : r.next > 0 ? String(r.next) : '';
      of.textContent = '';
      name.textContent = r.mapName;
      hint.textContent = r.next > 3 ? `Choose your class · survive ${r.of} waves` : `Survive ${r.of} waves`;
    } else if (r.phase === 'intermission') {
      kicker.textContent = r.upcoming?.boss ? 'Boss wave in' : 'Next wave in';
      big.textContent = clock(r.next);
      of.textContent = '';
      name.textContent = r.upcoming ? `Wave ${r.upcoming.wave} · ${r.upcoming.name}` : '';
      hint.textContent = `The merchant · B blessing · N ready${r.ready && r.ready.of > 1 ? ` (${r.ready.n}/${r.ready.of})` : ''}`;
    } else {
      kicker.textContent = endless ? 'Endless' : r.wave === r.of ? 'Final wave' : r.boss ? 'Boss wave' : 'Wave';
      big.textContent = String(r.wave);
      of.textContent = endless ? '' : `/ ${r.of}`;
      name.textContent = r.name;
      // The run so far: its time and its dead.
      hint.textContent = `${clock(r.time)} · ${r.kills} slain`;
    }
    wave.classList.toggle('boss', r.phase === 'fighting' && !!r.boss);
    wave.classList.toggle('soon', (r.phase === 'intermission' || r.phase === 'countdown') && r.next > 0 && r.next <= 3);
    const fighting = r.phase === 'fighting';
    bar.style.display = fighting ? '' : 'none';
    fill.style.width = `${r.total > 0 ? (r.left / r.total) * 100 : 0}%`;
    left.textContent = `${r.left} left`;
    // The twist as a chip (a boss is named by its own bar, under this).
    chips.replaceChildren(...(fighting && r.twist ? [chip(r.twist.name, r.twist.color)] : []));
    // A new wave (or the break before one) arrives with a flourish.
    if (`${r.phase}${r.wave}` !== shownAt) {
      shownAt = `${r.phase}${r.wave}`;
      replay(wave, 'arrive');
    }
  };

  const showParty = (p: PartyMsg | null) => {
    const others = p && p.list.length > 1 ? p.list.filter((f) => f.id !== client.me.id) : [];
    const key = JSON.stringify(others);
    if (key === partyKey) return;
    partyKey = key;
    party.replaceChildren(
      ...others.map((f) => {
        const hp = el('i');
        hp.style.width = `${f.hp * 100}%`;
        const state = f.state === 'down' ? `Down${f.bleed > 0 ? ` ${Math.ceil(f.bleed)}s` : ''}` : f.state === 'out' ? 'Out' : f.cls;
        return el(
          `div.ar-mate.${f.state}`,
          el('div.ar-mate-top', el('span.ar-mate-name', f.name), el('span.ar-mate-state', state), el('span.ar-mate-n', f.state === 'up' ? String(Math.round(f.hp * f.max)) : '')),
          el('div.ar-mate-hp', hp),
        );
      }),
    );
  };

  const showMe = (m: MeMsg | null) => {
    if (!m) return;
    const key = m.bless.map((b) => `${b.name}${b.n}`).join('|');
    if (key === blessKey) return;
    const fresh = blessKey !== '' || m.bless.length === 1;
    blessKey = key;
    bless.replaceChildren(
      ...m.bless.map((b, i) => {
        const tile = el('div.ar-blessing', client.hud.icon(b.icon), b.n > 1 ? el('span.ar-bless-n', ROMAN[b.n] ?? String(b.n)) : null);
        tile.style.setProperty('--c', b.color);
        tile.title = `${b.name}: ${b.text}`;
        // (The newest arrives with a flash; the announcer names it.)
        if (fresh && i === m.bless.length - 1) tile.classList.add('new');
        return tile;
      }),
    );
  };

  return (dt) => {
    const off = hidden(client);
    layer.style.visibility = off ? 'hidden' : '';
    if (client.events.some((e) => e.t === 'reset')) {
      runKey = shownAt = partyKey = blessKey = hypeKey = '';
      favourOn = false;
      goldTarget = shownGold = 0;
      pops.replaceChildren();
      world.replaceChildren();
      floaters.length = 0;
    }
    if (hud.run) showRun(hud.run);
    showParty(hud.party);
    showMe(hud.me);
    const ended = !!hud.ended || hud.run?.phase === 'victory' || hud.run?.phase === 'defeat';
    purse.classList.toggle('on', !!hud.run && !ended && hud.run.phase !== 'intro' && hud.run.phase !== 'waiting');

    // Gold rolls up to what it is (the server's word wins over what's been popped).
    if (hud.me && Math.abs(hud.me.gold - goldTarget) > 0 && (!pop || client.time > pop.until)) goldTarget = hud.me.gold;
    if (shownGold !== goldTarget) {
      const step = Math.max(1, Math.abs(goldTarget - shownGold) * Math.min(1, dt * 9));
      shownGold = shownGold < goldTarget ? Math.min(goldTarget, shownGold + step) : Math.max(goldTarget, shownGold - step);
      goldN.textContent = num(shownGold);
    }
    if (pop && client.time > pop.until) {
      pop.el.classList.add('out');
      const gone = pop.el;
      window.setTimeout(() => gone.remove(), 400);
      pop = null;
    }

    // The hotbar's weapons in their rarities: each slot marked for the theme to colour.
    const slots = client.me.hotbar?.slots ?? [];
    const hk2 = slots.map((s) => s?.item ?? '').join('|');
    if (hk2 !== hotbarKey) {
      hotbarKey = hk2;
      document.querySelectorAll<HTMLElement>('.hotbar .slot').forEach((el, i) => {
        const r = RARE.exec(slots[i]?.item ?? '')?.[1];
        if (r) el.dataset.rarity = r;
        else delete el.dataset.rarity;
      });
    }

    // The crowd.
    const h = hud.hype;
    const hk = `${h.v}|${h.f}`;
    if (hk !== hypeKey) {
      const favourNow = h.f > 0;
      hypeKey = hk;
      hypeFill.style.width = `${(favourNow ? 1 : h.v) * 100}%`;
      hype.classList.toggle('favour', favourNow);
      gold.classList.toggle('favour', favourNow);
      hypeLabel.textContent = favourNow ? "Crowd's favour" : 'The crowd';
      hypeTime.textContent = favourNow ? `${h.f}s` : h.v >= 0.75 ? 'Roaring' : '';
      hype.classList.toggle('hot', !favourNow && h.v >= 0.75);
      if (favourNow && !favourOn) replay(hype, 'boil');
      favourOn = favourNow;
    }

    // Gold where it was picked up: rising, fading, kept on the screen's edge if it's off it.
    for (let i = floaters.length - 1; i >= 0; i--) {
      const f = floaters[i];
      f.t += dt;
      const s = project(client, { x: f.at.x, y: f.at.y + f.t * 0.9, z: f.at.z });
      if (f.t > 1.1 || !s.ahead) {
        f.el.remove();
        floaters.splice(i, 1);
        continue;
      }
      f.el.style.transform = `translate(${Math.min(0.96, Math.max(0.04, s.x)) * window.innerWidth}px, ${Math.min(0.9, Math.max(0.06, s.y)) * window.innerHeight}px) translate(-50%, -50%)`;
      f.el.style.opacity = String(Math.min(1, (1.1 - f.t) * 3));
    }
  };
}

/** A blessing taken more than once: II, III, IV. */
const ROMAN = ['', 'I', 'II', 'III', 'IV', 'V'];

/** A weapon's rarity, by its id (`items/rarity.ts`: `gladius_epic`; a common one is its plain id). */
const RARE = /_(rare|epic|legendary)$/;

/** What a gold bonus was for, by the run's word (`gold`'s `why`). */
const WHY: Record<string, string> = { wave: 'wave bonus', boss: 'boss bounty', goblin: "goblin's loot", gift: "emperor's gift", start: 'purse', sold: 'sold' };

function chip(text: string, color: string): HTMLElement {
  const c = el('span.ar-chip', text);
  c.style.setProperty('--c', color);
  return c;
}
