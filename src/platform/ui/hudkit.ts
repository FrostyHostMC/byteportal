import * as THREE from 'three';
import { h } from './dom';
import { mergeData, plainRecord, scopeCss, WIDGET_ANCHORS, type PlainData, type WidgetWire } from './markup';
import { compileWidget, WidgetView, type CompiledWidget } from './widgets';
import type { FeedPart, HudApi, HudTheme, IconRef, MarkerOptions, MenuEntry, MenuHandle, MenuOptions, ScreenOptions, Vec3, WidgetAnchor } from '../api/types';
import type { AnchorRef, RadarWire } from '../net/protocol';

interface Marker {
  el: HTMLElement;
  label: HTMLElement;
  at: AnchorRef;
  pos: THREE.Vector3;
  opts: MarkerOptions;
}

/**
 * Where something a marker or radar blip follows is drawn now (with `offset` in a prop's own
 * space, else the world's), into `out`; false if it isn't drawn. `heading`: which way a prop or
 * player faces (radians, 0 toward -z).
 */
export interface Locator {
  at(a: AnchorRef, offset: Vec3 | undefined, out: THREE.Vector3): boolean;
  heading(a: AnchorRef): number | null;
}

const isSpot = (a: AnchorRef): a is { x: number; y: number; z: number } => 'x' in a;

interface FloatingNumber {
  el: HTMLElement;
  pos: THREE.Vector3;
  age: number;
  vy: number;
}

/** `Scoreboard` on the wire: rows name their player by id. */
export interface ScoreboardWire {
  title?: string;
  columns: string[];
  rows: { name: string; values: (string | number)[]; color?: string; player?: string }[];
  footer?: string;
  show?: boolean;
}

/** A hit from somewhere: an arrow at the screen's edge pointing to it, fading. */
interface HurtArrow {
  el: HTMLElement;
  from: THREE.Vector3;
  age: number;
}

/** A game's widget up on this screen: its elements, and the screen it's in if it's modal. */
interface ShownWidget {
  view: WidgetView;
  screen: HTMLElement | null;
}

/**
 * Game-facing HUD widgets layered over the base HUD. (Markers and the radar take anchors as they
 * come over the wire, and place what they follow every frame with `locate`.) The game's own
 * widgets (`hud.define`) arrive as definitions, then as data: `widget`, `widgetSet`, `widgetRemove`.
 */
/** An achievement earned, as the host says it (see `Sim.achieve`). */
interface AchievementPop {
  id: string;
  /** The card's first line (default: "Achievement unlocked"). */
  kicker?: string;
  title: string;
  description: string;
  /** Kept for their account (false: a guest's, for the visit). */
  kept: boolean;
  /** How many of the game's they have now: "3 of 8". */
  count?: string;
}

/** A trophy, for the achievement card. */
const TROPHY = '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M7 3h10v2h3v3a4 4 0 0 1-4 4h-.4A5 5 0 0 1 13 14.9V17h3v2H8v-2h3v-2.1A5 5 0 0 1 8.4 12H8a4 4 0 0 1-4-4V5h3V3zm0 4H6v1a2 2 0 0 0 1 1.7V7zm10 0v2.7A2 2 0 0 0 18 8V7h-1zM6 20h12v2H6v-2z"/></svg>';

export class GameHud implements Omit<HudApi, 'marker' | 'radar' | 'scoreboard' | 'define' | 'widget'> {
  readonly root: HTMLElement;
  private hearts: HTMLElement;
  private heartEls: HTMLElement[] = [];
  private bannerEl: HTMLElement;
  private bannerTimer = 0;
  private objectiveEl: HTMLElement;
  private statsEl: HTMLElement;
  private statEls = new Map<string, HTMLElement>();
  private boss: HTMLElement;
  private bossFill: HTMLElement;
  private bossName: HTMLElement;
  private toastEl: HTMLElement;
  private toastTimer = 0;
  /** Achievements earned (`player.achieve`), shown one after another. */
  private achievementEl: HTMLElement;
  private popQueue: AchievementPop[] = [];
  /** The game's achievements the player has (`achievements`, and each one since). */
  private earned = new Set<string>();
  /** They changed (the pause menu lists them). */
  onAchievements: ((earned: ReadonlySet<string>, kept: boolean) => void) | null = null;
  private achievementTimer = 0;
  private flashEl: HTMLElement;
  private hitEl: HTMLElement;
  private numbers: FloatingNumber[] = [];
  private tmp = new THREE.Vector3();
  private lastHealth = -1;
  private lastMax = -1;
  /** Called when a modal screen opens / closes (the runtime releases / re-grabs the mouse). */
  onScreen: ((open: boolean) => void) | null = null;
  /** Shows / hides the base HUD's crosshair. */
  onCrosshair: ((visible: boolean) => void) | null = null;
  private metersEl: HTMLElement;
  private feedEl: HTMLElement;
  private progressEl: HTMLElement;
  private meterEls = new Map<string, HTMLElement>();
  private markersEl: HTMLElement;
  private markers = new Map<string, Marker>();
  private radarCanvas: HTMLCanvasElement;
  /** The widget place the radar sits in (null: its own corner). */
  private radarAt: WidgetAnchor | null = null;
  private radarData: RadarWire | null = null;
  /** The radar follows something: redrawn every frame. */
  private radarLive = false;
  /** Places what markers and radar blips follow (the runtime sets it). */
  locate: Locator = {
    at: (a, offset, out) => {
      if (!isSpot(a)) return false;
      out.set(a.x + (offset?.x ?? 0), a.y + (offset?.y ?? 0), a.z + (offset?.z ?? 0));
      return true;
    },
    heading: () => null,
  };
  private radarPos = new THREE.Vector3();
  private radarCenter = new THREE.Vector3();
  private screens: HTMLElement[] = [];
  private popEl: HTMLElement;
  private popTimer = 0;
  private boardEl: HTMLElement;
  private board: ScoreboardWire | null = null;
  private boardHeld = false;
  /** Whose screen this is (their scoreboard row is highlighted). */
  player: string | null = null;
  private hurts: HurtArrow[] = [];
  private healthStyle: 'hearts' | 'bar' | 'none' = 'hearts';
  private barEl: HTMLElement;
  private barFill: HTMLElement;
  private barLag: HTMLElement;
  private barText: HTMLElement;
  /** Client code's own layers with the panels (see `layer`), by name. */
  private layers = new Map<string, HTMLElement>();
  /** An open menu's key listener, removed when it closes, however it closes. */
  private unhooks = new Map<HTMLElement, () => void>();
  /** Each open menu's close (B on a controller backs out of the top one). */
  private menuClosers = new Map<HTMLElement, () => void>();
  /** The game's widgets: a layer of its own (its stacking kept inside), a place for each anchor, their CSS. */
  private widgetLayer: HTMLElement;
  private widgetSheet: HTMLStyleElement;
  private widgetSlots = new Map<WidgetAnchor, HTMLElement>();
  private widgetDefs = new Map<string, CompiledWidget>();
  private widgetsUp = new Map<string, ShownWidget>();
  /**
   * This screen's own state, for widgets' `$` names (`{{$gun.mag}}`, `{{$ability.dash.cool}}`):
   * one record every widget reads, changed in place (`setLocal`).
   */
  private local: PlainData = {};
  private localKey = '';
  /** A button in a widget was pressed; a modal widget was closed by the player (the presenter tells the host). */
  onWidgetAction: ((widget: string, action: string, value: string) => void) | null = null;
  onWidgetClosed: ((widget: string) => void) | null = null;

  constructor(parent: HTMLElement, private iconFor: (ref: IconRef) => string) {
    this.hearts = h('div.hearts');
    this.bannerEl = h('div.banner');
    this.objectiveEl = h('div.objective');
    this.statsEl = h('div.stats');
    this.bossName = h('div.boss-name');
    this.bossFill = h('div.boss-fill');
    this.boss = h('div.bossbar', {}, this.bossName, h('div.boss-track', {}, this.bossFill));
    this.toastEl = h('div.game-toast');
    this.achievementEl = h('div.achievement');
    this.flashEl = h('div.screen-flash');
    this.hitEl = h('div.hitmarker');
    this.metersEl = h('div.meters');
    this.feedEl = h('div.feed');
    this.progressEl = h('div.progress-ring');
    this.markersEl = h('div.markers');
    this.radarCanvas = h('canvas.radar', { width: 150, height: 150 }) as HTMLCanvasElement;
    this.radarCanvas.style.display = 'none';
    this.popEl = h('div.hud-pop');
    this.boardEl = h('div.scoreboard');
    this.boardEl.style.display = 'none';
    this.barFill = h('div.healthbar-fill');
    this.barLag = h('div.healthbar-lag');
    this.barText = h('span.healthbar-text');
    this.barEl = h('div.healthbar', {}, h('div.healthbar-track', {}, this.barLag, this.barFill), this.barText);
    this.barEl.style.display = 'none';
    this.widgetSheet = h('style') as HTMLStyleElement;
    this.widgetLayer = h('div.gw-layer', {}, this.widgetSheet);
    this.root = h(
      'div.gamehud',
      {},
      this.flashEl,
      this.markersEl,
      this.hitEl,
      this.hearts,
      this.bannerEl,
      this.objectiveEl,
      this.statsEl,
      this.boss,
      this.toastEl,
      this.achievementEl,
      this.feedEl,
      this.progressEl,
      this.metersEl,
      this.radarCanvas,
      this.popEl,
      this.barEl,
      this.widgetLayer,
      this.boardEl,
    );
    parent.append(this.root);
    this.boss.style.display = 'none';
  }

  setVisible(v: boolean) {
    this.root.style.display = v ? '' : 'none';
  }

  /** How the player's own health shows (the game's `hud.health`). */
  setHealthStyle(style: 'hearts' | 'bar' | 'none') {
    this.healthStyle = style;
    this.hearts.style.display = style === 'hearts' && this.lastMax > 0 ? '' : 'none';
    this.barEl.style.display = style === 'bar' && this.lastMax > 0 ? '' : 'none';
  }

  /** Hearts (or a bar): health in half-hearts. Hidden when max is 0 (damage disabled). */
  setHealth(health: number, max: number) {
    if (this.healthStyle !== 'hearts') return this.setHealthBar(health, max);
    const hp = Math.max(0, Math.ceil(health));
    if (hp === this.lastHealth && max === this.lastMax) return;
    const damaged = hp < this.lastHealth;
    this.lastHealth = hp;
    if (max > 40) {
      // Too many hearts to draw: compact counter.
      this.lastMax = max;
      this.heartEls = [];
      this.hearts.replaceChildren(h('span.heart.full'), h('span.heart-count', {}, `${hp} / ${max}`));
      this.hearts.style.display = '';
      return;
    }
    if (max !== this.lastMax) {
      this.lastMax = max;
      this.hearts.replaceChildren();
      this.heartEls = [];
      for (let i = 0; i < Math.ceil(max / 2); i++) {
        const el = h('span.heart');
        this.heartEls.push(el);
        this.hearts.append(el);
      }
      this.hearts.style.display = max > 0 ? '' : 'none';
    }
    this.heartEls.forEach((el, i) => {
      const v = hp - i * 2;
      el.className = `heart ${v >= 2 ? 'full' : v === 1 ? 'half' : 'empty'}`;
    });
    this.hearts.classList.toggle('low', hp <= 6 && max > 0);
    if (damaged) {
      this.hearts.classList.remove('shake');
      void this.hearts.offsetWidth;
      this.hearts.classList.add('shake');
    }
  }

  /** The health bar: the fill drops at once, a lighter trail follows it down; the number beside it. */
  private setHealthBar(health: number, max: number) {
    const hp = Math.max(0, Math.ceil(health));
    if (hp === this.lastHealth && max === this.lastMax) return;
    const damaged = hp < this.lastHealth;
    this.lastHealth = hp;
    this.lastMax = max;
    this.hearts.style.display = 'none';
    this.barEl.style.display = this.healthStyle === 'bar' && max > 0 ? '' : 'none';
    if (max <= 0) return;
    const f = `${Math.max(0, Math.min(1, hp / max)) * 100}%`;
    this.barFill.style.width = f;
    this.barLag.style.width = f;
    this.barText.textContent = String(hp);
    this.barEl.classList.toggle('low', hp <= max * 0.3);
    if (damaged) {
      this.barEl.classList.remove('hit');
      void this.barEl.offsetWidth;
      this.barEl.classList.add('hit');
    }
  }

  /**
   * A layer for client code's own panels, made the first time it's named: over the platform's
   * panels, under the game's widgets and the scoreboard. Layers stack in the order they're made.
   */
  layer(name: string): HTMLElement {
    let el = this.layers.get(name);
    if (el) return el;
    el = h('div.hud-layer');
    el.dataset.layer = name;
    this.root.insertBefore(el, this.widgetLayer);
    this.layers.set(name, el);
    return el;
  }

  /**
   * An icon as an image: `{ item }` is that item's icon as this screen has it (its look). A picture
   * of a model that hasn't loaded yet (or of an item not here yet) fills in once it has (it's
   * blank until then, never a broken image).
   */
  icon(spec: string, ref: IconRef): HTMLImageElement {
    const src = this.iconFor(ref);
    const img = h(spec, { alt: '' }) as HTMLImageElement;
    if (src) {
      img.src = src;
      return img;
    }
    img.style.visibility = 'hidden';
    let tries = 0;
    const retry = window.setInterval(() => {
      const s = this.iconFor(ref);
      if (s || ++tries > 60 || !img.isConnected) {
        window.clearInterval(retry);
        if (s) {
          img.src = s;
          img.style.visibility = '';
        }
      }
    }, 250);
    return img;
  }

  /** A short pop-up under the crosshair ("+100", "Headshot!"). */
  pop(text: string, opts: { color?: string; big?: boolean; sub?: string } = {}) {
    this.popEl.replaceChildren(h('div.hud-pop-text', { style: opts.color ? { color: opts.color } : {} }, text));
    if (opts.sub) this.popEl.append(h('div.hud-pop-sub', {}, opts.sub));
    this.popEl.className = `hud-pop${opts.big ? ' big' : ''}`;
    void this.popEl.offsetWidth;
    this.popEl.classList.add('show');
    window.clearTimeout(this.popTimer);
    this.popTimer = window.setTimeout(() => this.popEl.classList.remove('show'), opts.big ? 1800 : 1100);
  }

  /** The scoreboard: shown while Tab is held (see `holdScoreboard`), or kept up (`show`). */
  scoreboard(b: ScoreboardWire | null) {
    this.board = b;
    this.renderBoard();
  }

  /** Tab went down or up. */
  holdScoreboard(held: boolean) {
    if (held === this.boardHeld) return;
    this.boardHeld = held;
    this.renderBoard();
  }

  private renderBoard() {
    const b = this.board;
    const show = !!b && (this.boardHeld || !!b.show);
    this.boardEl.style.display = show ? '' : 'none';
    if (!b || !show) return;
    const head = h('tr', {}, h('th.sb-rank', {}, '#'), h('th.sb-name', {}, 'Name'), ...b.columns.map((c) => h('th', {}, c)));
    const rows = b.rows.map((r, i) =>
      h(
        `tr${r.player && r.player === this.player ? '.me' : ''}`,
        {},
        h('td.sb-rank', {}, String(i + 1)),
        h('td.sb-name', { style: r.color ? { color: r.color } : {} }, r.name),
        ...r.values.map((v) => h('td', {}, String(v))),
      ),
    );
    this.boardEl.replaceChildren(h('table.sb-table', {}, h('thead', {}, head), h('tbody', {}, ...rows)));
    if (b.title) this.boardEl.prepend(h('div.sb-title', {}, b.title));
    if (b.footer) this.boardEl.append(h('div.sb-footer', {}, b.footer));
  }

  /** Hit from `from` (a world point): an arrow on the screen's edge pointing to it. */
  hurtFrom(from: Vec3) {
    const el = h('div.hurt-arrow');
    this.root.append(el);
    this.hurts.push({ el, from: new THREE.Vector3(from.x, from.y, from.z), age: 0 });
    while (this.hurts.length > 6) this.hurts.shift()!.el.remove();
  }

  banner(title: string, subtitle?: string, opts: { duration?: number; color?: string } = {}) {
    this.bannerEl.replaceChildren(h('div.banner-title', { style: opts.color ? { color: opts.color } : {} }, title));
    if (subtitle) this.bannerEl.append(h('div.banner-sub', {}, subtitle));
    this.bannerEl.classList.remove('show');
    void this.bannerEl.offsetWidth;
    this.bannerEl.classList.add('show');
    window.clearTimeout(this.bannerTimer);
    this.bannerTimer = window.setTimeout(() => this.bannerEl.classList.remove('show'), (opts.duration ?? 2.2) * 1000);
  }

  objective(text: string | null) {
    this.objectiveEl.textContent = text ?? '';
    // Explicitly: the stylesheet hides an empty pill by default.
    this.objectiveEl.style.display = text ? 'block' : 'none';
  }

  stat(id: string, label: string, value: string | number | null) {
    let el = this.statEls.get(id);
    if (value === null) {
      el?.remove();
      this.statEls.delete(id);
      return;
    }
    if (!el) {
      el = h('div.stat', {}, h('span.stat-label'), h('span.stat-value'));
      this.statEls.set(id, el);
      this.statsEl.append(el);
    }
    (el.firstChild as HTMLElement).textContent = label;
    (el.lastChild as HTMLElement).textContent = String(value);
  }

  bossBar(name: string, fraction: number, color?: string) {
    this.boss.style.display = '';
    this.bossName.textContent = name;
    this.bossFill.style.width = `${Math.max(0, Math.min(1, fraction)) * 100}%`;
    if (color) this.bossFill.style.background = color;
  }

  hideBossBar() {
    this.boss.style.display = 'none';
  }

  meter(id: string, label: string, value: number | null, opts: { color?: string; text?: string } = {}) {
    let el = this.meterEls.get(id);
    if (value === null) {
      el?.remove();
      this.meterEls.delete(id);
      return;
    }
    if (!el) {
      el = h('div.meter', {}, h('span.meter-label'), h('div.meter-track', {}, h('div.meter-fill')), h('span.meter-text'));
      this.meterEls.set(id, el);
      this.metersEl.append(el);
    }
    const [lab, track, text] = el.children as unknown as HTMLElement[];
    lab.textContent = label;
    const fill = track.firstElementChild as HTMLElement;
    fill.style.width = `${Math.max(0, Math.min(1, value)) * 100}%`;
    if (opts.color) fill.style.background = opts.color;
    text.textContent = opts.text ?? '';
    el.classList.toggle('low', value < 0.25);
  }

  marker(id: string, at: AnchorRef | null, opts: MarkerOptions = {}) {
    let m = this.markers.get(id);
    if (!at) {
      m?.el.remove();
      this.markers.delete(id);
      return;
    }
    if (!m) {
      const label = h('span.marker-label');
      const el = h('div.marker', {}, h('div.marker-shape'), label);
      this.markersEl.append(el);
      m = { el, label, at, pos: new THREE.Vector3(), opts };
      this.markers.set(id, m);
    }
    m.at = at;
    m.opts = opts;
    const cls = `marker ${opts.shape ?? 'box'}${opts.pulse ? ' pulse' : ''}${opts.bar !== undefined ? ' has-bar' : ''}`;
    if (m.el.className !== cls) m.el.className = cls;
    m.el.style.setProperty('--c', opts.color ?? '#ff5a4f');
    const text = `${opts.label ?? ''}\u0000${opts.sub ?? ''}`;
    if (m.label.dataset.text !== text) {
      m.label.dataset.text = text;
      m.label.replaceChildren(opts.label ?? '', ...(opts.sub ? [h('span.marker-sub', {}, opts.sub)] : []));
    }
    if (opts.bar !== undefined) {
      let bar = m.el.querySelector('.marker-bar') as HTMLElement | null;
      if (!bar) m.el.append((bar = h('div.marker-bar', {}, h('div.marker-bar-fill'))));
      (bar.firstElementChild as HTMLElement).style.width = `${Math.max(0, Math.min(1, opts.bar)) * 100}%`;
      bar.classList.toggle('low', opts.bar < 0.35);
    }
  }

  crosshair(visible: boolean) {
    this.onCrosshair?.(visible);
  }

  radar(data: RadarWire | null) {
    this.radarCanvas.style.display = data ? '' : 'none';
    if (data) this.placeRadar(data.at && (WIDGET_ANCHORS as readonly string[]).includes(data.at) ? (data.at as WidgetAnchor) : null);
    this.radarData = data;
    this.radarLive = !!data && (!isSpot(data.center) || data.blips.some((b) => 'at' in b && !isSpot(b.at)));
    if (data) this.drawRadar(data);
  }

  /** In a widget place, after the widgets there (`order` keeps it last as more come); or back in its corner. */
  private placeRadar(at: WidgetAnchor | null) {
    if (at === this.radarAt) return;
    this.radarAt = at;
    this.radarCanvas.classList.toggle('in-slot', at !== null);
    if (at) this.widgetSlot(at).append(this.radarCanvas);
    else this.root.insertBefore(this.radarCanvas, this.popEl);
  }

  private drawRadar(d: RadarWire) {
    const c = this.radarCanvas.getContext('2d');
    if (!c) return;
    const center = this.radarCenter;
    if (!this.locate.at(d.center, undefined, center)) return;
    const heading = d.heading ?? this.locate.heading(d.center) ?? 0;
    const W = this.radarCanvas.width;
    const R = W / 2 - 4;
    c.clearRect(0, 0, W, W);
    c.save();
    c.translate(W / 2, W / 2);
    c.beginPath();
    c.arc(0, 0, R, 0, Math.PI * 2);
    c.fillStyle = 'rgba(6, 14, 20, 0.62)';
    c.fill();
    c.strokeStyle = 'rgba(140, 220, 255, 0.35)';
    c.lineWidth = 1.5;
    c.stroke();
    c.strokeStyle = 'rgba(140, 220, 255, 0.14)';
    for (const f of [0.33, 0.66]) {
      c.beginPath();
      c.arc(0, 0, R * f, 0, Math.PI * 2);
      c.stroke();
    }
    c.beginPath();
    c.moveTo(0, -R);
    c.lineTo(0, R);
    c.moveTo(-R, 0);
    c.lineTo(R, 0);
    c.stroke();
    // Blips, rotated so the heading points up.
    const sin = Math.sin(heading);
    const cos = Math.cos(heading);
    const k = R / d.range;
    const at = this.radarPos;
    for (const b of d.blips) {
      if ('at' in b) {
        if (!this.locate.at(b.at, undefined, at)) continue;
      } else at.set(b.x, b.y ?? center.y, b.z);
      const dx = at.x - center.x;
      const dz = at.z - center.z;
      const right = dx * cos - dz * sin;
      const ahead = -dx * sin - dz * cos;
      let x = right * k;
      let y = -ahead * k;
      const len = Math.hypot(x, y);
      const out = len > R - 3;
      if (out) {
        x *= (R - 3) / len;
        y *= (R - 3) / len;
      }
      const s = (b.size ?? 3) * (out ? 0.7 : 1);
      c.fillStyle = b.color;
      c.globalAlpha = out ? 0.6 : 1;
      c.fillRect(x - s / 2, y - s / 2, s, s);
      if ((!('x' in b) || b.y !== undefined) && !out) {
        // Above / below: a tick.
        const dy = at.y - center.y;
        if (Math.abs(dy) > 8) c.fillRect(x - 0.5, dy > 0 ? y - s / 2 - 4 : y + s / 2, 1, 4);
      }
    }
    c.globalAlpha = 1;
    // You: an arrow at the centre.
    c.fillStyle = '#e8f6ff';
    c.beginPath();
    c.moveTo(0, -6);
    c.lineTo(4, 5);
    c.lineTo(0, 3);
    c.lineTo(-4, 5);
    c.closePath();
    c.fill();
    c.restore();
  }

  /** Project markers; off-screen ones with `edge` ride the screen edge as arrows. */
  private placeMarkers(camera: THREE.Camera, width: number, height: number) {
    const cam = camera as THREE.PerspectiveCamera;
    const focal = height / 2 / Math.tan(((cam.fov ?? 70) * Math.PI) / 360);
    for (const m of this.markers.values()) {
      if (!this.locate.at(m.at, m.opts.offset, m.pos)) {
        m.el.style.display = 'none';
        continue;
      }
      const v = this.tmp.copy(m.pos).applyMatrix4(camera.matrixWorldInverse);
      const dist = v.length();
      const behind = v.z > -0.1;
      this.tmp.copy(m.pos).project(camera);
      let x = this.tmp.x;
      let y = this.tmp.y;
      if (behind) {
        x = -x;
        y = -y;
      }
      const off = behind || Math.abs(x) > 1 || Math.abs(y) > 1;
      const size = m.opts.size ?? 26;
      let px = typeof size === 'number' ? size : Math.max(size.min ?? 18, Math.min(size.max ?? 160, (size.world / Math.max(1, dist)) * focal));
      if (off) {
        if (!m.opts.edge) {
          m.el.style.display = 'none';
          continue;
        }
        // Push the direction out to an inset rectangle.
        const s = 1 / Math.max(Math.abs(x) / 0.92, Math.abs(y) / 0.88, 1e-4);
        x *= s;
        y *= s;
        px = 22;
      }
      m.el.style.display = '';
      m.el.classList.toggle('offscreen', off);
      const sx = (x * 0.5 + 0.5) * width;
      const sy = (-y * 0.5 + 0.5) * height;
      m.el.style.transform = `translate(${sx}px, ${sy}px)`;
      m.el.style.setProperty('--s', `${px}px`);
      m.el.style.setProperty('--a', `${Math.atan2(-y, x)}rad`);
    }
  }

  /**
   * One of the game's achievements, earned (the platform's, from `player.achieve`): a card at the
   * top of the screen for a few seconds; several wait their turn.
   */
  achievement(a: AchievementPop) {
    this.earned.add(a.id);
    this.onAchievements?.(this.earned, a.kept);
    this.popQueue.push(a);
    if (this.popQueue.length === 1) this.nextAchievement();
  }

  /**
   * A cosmetic given to the player (`player.grant`): the same card as an achievement's, saying it's
   * in their locker (or, a guest's, that signing in keeps such things).
   */
  cosmetic(c: { id: string; name: string; slot: string; kept: boolean }) {
    const where = c.slot === 'hat' ? 'A hat' : c.slot === 'back' ? 'For your back' : c.slot === 'title' ? 'A title' : 'A name tag';
    this.popQueue.push({ id: `cosmetic:${c.id}`, title: c.name, description: c.kept ? `${where}, in your locker on the home page` : `${where}: sign in to keep things like this`, kept: true, kicker: 'New to wear' });
    if (this.popQueue.length === 1) this.nextAchievement();
  }

  /** Which of the game's achievements the player has (as they joined), and whether they're kept (signed in). */
  achievements(ids: string[], kept: boolean) {
    this.earned = new Set(ids);
    this.onAchievements?.(this.earned, kept);
  }

  private nextAchievement() {
    const a = this.popQueue[0];
    if (!a) return;
    const icon = h('div.achievement-icon');
    icon.innerHTML = TROPHY;
    this.achievementEl.replaceChildren(
      icon,
      h(
        'div.achievement-text',
        {},
        h('div.achievement-kicker', {}, `${a.kicker ?? 'Achievement unlocked'}${a.count ? ` · ${a.count}` : ''}`),
        h('div.achievement-title', {}, a.title),
        h('div.achievement-desc', {}, a.description),
        a.kept ? null : h('div.achievement-note', {}, 'Playing as a guest: sign in on the home page to keep it'),
      ),
    );
    this.achievementEl.classList.remove('show');
    void this.achievementEl.offsetWidth;
    this.achievementEl.classList.add('show');
    window.clearTimeout(this.achievementTimer);
    this.achievementTimer = window.setTimeout(() => {
      this.achievementEl.classList.remove('show');
      this.achievementTimer = window.setTimeout(() => {
        this.popQueue.shift();
        this.nextAchievement();
      }, 400);
    }, 4200);
  }

  toast(text: string) {
    this.toastEl.textContent = text;
    this.toastEl.classList.add('show');
    window.clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => this.toastEl.classList.remove('show'), 1800);
  }

  feed(text: string | FeedPart[], opts: { color?: string } = {}) {
    const parts = typeof text === 'string' ? [text] : text;
    const line = h(
      'div.feed-line',
      {},
      ...parts.map((p) =>
        typeof p === 'string'
          ? h('span', {}, p)
          : 'icon' in p
            ? this.icon(`img.feed-icon${typeof p.icon === 'object' && ('gltf' in p.icon || 'item' in p.icon) && p.icon.view === 'side' ? '.wide' : ''}`, p.icon)
            : h('span', { style: p.color ? { color: p.color } : {} }, p.text),
      ),
    );
    if (opts.color) line.style.color = opts.color;
    this.feedEl.append(line);
    while (this.feedEl.childElementCount > 6) this.feedEl.firstElementChild!.remove();
    window.setTimeout(() => line.classList.add('fade'), 6000);
    window.setTimeout(() => line.remove(), 6600);
  }

  /** Set by the runtime: draws `highlight` in the world. */
  onHighlight: ((at: Vec3 | null, progress?: number) => void) | null = null;

  highlight(at: Vec3 | null, opts: { progress?: number } = {}) {
    this.onHighlight?.(at, opts.progress);
  }

  progress(fraction: number | null, opts: { color?: string } = {}) {
    const el = this.progressEl;
    el.style.display = fraction === null ? 'none' : 'block';
    if (fraction === null) return;
    el.style.setProperty('--p', `${Math.round(Math.min(1, Math.max(0, fraction)) * 100)}%`);
    if (opts.color) el.style.setProperty('--c', opts.color);
    else el.style.removeProperty('--c');
  }

  screen(opts: ScreenOptions): () => void {
    const buttons = h('div.result-buttons');
    let closed = false;
    const close = () => {
      if (closed) return;
      closed = true;
      el.classList.add('closing');
      window.setTimeout(() => el.remove(), 250);
      this.screens = this.screens.filter((s) => s !== el);
      if (this.screens.length === 0) this.onScreen?.(false);
    };
    for (const b of opts.buttons) {
      buttons.append(h(`button.btn${b.primary ? '.primary' : ''}`, { onclick: () => { close(); b.onClick(); } }, b.label));
    }
    const stats = opts.stats?.length
      ? h('div.result-stats', {}, ...opts.stats.map(([k, v]) => h('div.result-stat', {}, h('span', {}, k), h('b', {}, v))))
      : null;
    const icon = opts.icon ? this.icon('img.result-icon', opts.icon) : null;
    const el = h(
      `div.screen.result-screen.${opts.tone ?? 'neutral'}`,
      {},
      h('div.result-card', {}, icon, h('h1.result-title', {}, opts.title), opts.subtitle ? h('div.result-sub', {}, opts.subtitle) : null, stats, buttons),
    );
    this.root.parentElement!.append(el);
    this.screens.push(el);
    this.onScreen?.(true);
    return close;
  }

  menu(opts: MenuOptions): MenuHandle {
    let current = { ...opts };
    let open = true;
    const body = h('div.menu-body');
    const title = h('h2.menu-title');
    const sub = h('div.menu-sub');
    const closeBtn = h('button.menu-close', { title: 'Close (Esc)' }, '×');
    const card = h('div.menu-card', {}, h('div.menu-head', {}, h('div', {}, title, sub), closeBtn), body);
    const el = h('div.screen.menu-screen', {}, card);
    // (Each entry keeps its place as `data-pad-key`: redrawn, a controller's highlight stays on it.)
    const entry = (e: MenuEntry, key: string) => {
      const icon = e.icon ? this.icon('img.menu-icon', e.icon) : h('span.menu-icon');
      const b = h(
        `button.menu-entry${e.disabled ? '.disabled' : ''}${e.active ? '.active' : ''}`,
        {
          'data-pad-key': key,
          onclick: () => {
            if (!e.disabled) e.onSelect?.();
          },
        },
        icon,
        h('span.menu-text', {}, h('span.menu-label', {}, e.label), e.note ? h('span.menu-note', {}, e.note) : null),
        e.detail ? h('span.menu-detail', {}, e.detail) : null,
      );
      return b;
    };
    const head = () => {
      title.textContent = current.title;
      sub.textContent = current.subtitle ?? '';
      sub.style.display = current.subtitle ? '' : 'none';
    };
    const render = () => {
      head();
      body.replaceChildren(
        ...current.sections.map((sec, si) =>
          h('div.menu-section', {}, sec.title ? h('div.menu-section-title', {}, sec.title) : null, h('div.menu-grid', {}, ...sec.entries.map((e, ei) => entry(e, `${si}:${ei}`)))),
        ),
      );
    };
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key === 'Escape' || ev.code === 'KeyE') {
        ev.stopPropagation();
        close();
      }
    };
    const close = () => {
      if (!open) return;
      this.menuClosers.delete(el);
      this.unhooks.get(el)?.();
      el.classList.add('closing');
      window.setTimeout(() => el.remove(), 150);
      this.screens = this.screens.filter((x) => x !== el);
      if (this.screens.length === 0) this.onScreen?.(false);
      current.onClose?.();
    };
    closeBtn.onclick = close;
    this.menuClosers.set(el, close);
    el.onclick = (ev) => {
      if (ev.target === el) close();
    };
    render();
    window.addEventListener('keydown', onKey, true);
    this.unhooks.set(el, () => {
      open = false;
      window.removeEventListener('keydown', onKey, true);
      this.unhooks.delete(el);
    });
    this.root.parentElement!.append(el);
    this.screens.push(el);
    this.onScreen?.(true);
    return {
      update: (o) => {
        current = { ...current, ...o };
        // (A new title or subtitle alone, a countdown say, leaves the entries as they are.)
        if (open) (o.sections ? render : head)();
      },
      close,
      get open() {
        return open;
      },
    };
  }

  /** Back out of the top menu (a controller's B), if a menu is on top. */
  back(): boolean {
    const top = this.screens[this.screens.length - 1];
    const close = top && this.menuClosers.get(top);
    if (!close) return false;
    close();
    return true;
  }

  closeScreens() {
    for (const unhook of [...this.unhooks.values()]) unhook();
    this.menuClosers.clear();
    for (const [name, up] of this.widgetsUp) if (up.screen) this.widgetsUp.delete(name);
    for (const s of this.screens) s.remove();
    if (this.screens.length) this.onScreen?.(false);
    this.screens = [];
  }

  get screenOpen(): boolean {
    return this.screens.length > 0;
  }

  flash(color: string, strength: number, duration: number) {
    const el = this.flashEl;
    el.style.transition = 'none';
    el.style.background = color;
    el.style.opacity = String(strength);
    void el.offsetWidth;
    el.style.transition = `opacity ${duration}s ease-out`;
    el.style.opacity = '0';
  }

  /** A hit landed (`true`: a critical or head hit; `'kill'`: it killed). */
  hitMarker(mark: boolean | 'kill') {
    this.hitEl.classList.remove('show', 'crit', 'kill');
    void this.hitEl.offsetWidth;
    this.hitEl.classList.add('show');
    if (mark === 'kill') this.hitEl.classList.add('kill');
    else if (mark) this.hitEl.classList.add('crit');
  }

  damageNumber(pos: THREE.Vector3, amount: number, crit: boolean, color?: string) {
    const el = h('div.dmg-number', { style: { color: color ?? (crit ? '#ffd54a' : '#ffffff') } }, (Math.round(amount * 10) / 10).toString());
    if (crit) el.classList.add('crit');
    this.root.append(el);
    this.numbers.push({ el, pos: pos.clone().add(new THREE.Vector3((Math.random() - 0.5) * 0.4, 0, (Math.random() - 0.5) * 0.4)), age: 0, vy: 1.6 });
  }

  /** Per frame: project floating numbers and markers. */
  update(dt: number, camera: THREE.Camera, width: number, height: number) {
    if (this.markers.size) this.placeMarkers(camera, width, height);
    if (this.hurts.length) {
      // Each arrow points from the screen's middle toward where the hit came from, seen from above.
      const fwd = this.tmp.set(0, 0, -1).applyQuaternion(camera.quaternion);
      const yaw = Math.atan2(-fwd.x, -fwd.z);
      for (let i = this.hurts.length - 1; i >= 0; i--) {
        const a = this.hurts[i];
        a.age += dt;
        if (a.age > 1.6) {
          a.el.remove();
          this.hurts.splice(i, 1);
          continue;
        }
        const dx = a.from.x - camera.position.x;
        const dz = a.from.z - camera.position.z;
        const ang = Math.atan2(-dx, -dz) - yaw;
        a.el.style.transform = `translate(-50%, -50%) rotate(${-ang}rad) translateY(calc(-1 * min(22vh, 180px)))`;
        a.el.style.opacity = String(Math.min(1, (1.6 - a.age) / 0.6));
      }
    }
    if (this.radarLive && this.radarData) this.drawRadar(this.radarData);
    for (let i = this.numbers.length - 1; i >= 0; i--) {
      const n = this.numbers[i];
      n.age += dt;
      n.pos.y += n.vy * dt;
      n.vy *= 0.94;
      const life = 0.9;
      if (n.age > life) {
        n.el.remove();
        this.numbers.splice(i, 1);
        continue;
      }
      this.tmp.copy(n.pos).project(camera);
      if (this.tmp.z > 1) {
        n.el.style.display = 'none';
        continue;
      }
      n.el.style.display = '';
      const x = (this.tmp.x * 0.5 + 0.5) * width;
      const y = (-this.tmp.y * 0.5 + 0.5) * height;
      const a = 1 - Math.max(0, (n.age - life * 0.6) / (life * 0.4));
      n.el.style.transform = `translate(${x}px, ${y}px) translate(-50%, -50%) scale(${1 + Math.max(0, 0.25 - n.age) * 1.5})`;
      n.el.style.opacity = String(a);
    }
  }

  clear() {
    this.objective(null);
    for (const id of [...this.statEls.keys()]) this.stat(id, '', null);
    for (const id of [...this.meterEls.keys()]) this.meter(id, '', null);
    for (const id of [...this.markers.keys()]) this.marker(id, null);
    this.radar(null);
    this.crosshair(true);
    this.hideBossBar();
    this.bannerEl.classList.remove('show');
    this.feedEl.replaceChildren();
    this.progress(null);
    this.highlight(null);
    for (const n of this.numbers) n.el.remove();
    this.numbers = [];
    this.scoreboard(null);
    for (const a of this.hurts) a.el.remove();
    this.hurts = [];
    this.popEl.classList.remove('show');
    for (const name of [...this.widgetsUp.keys()]) this.widgetRemove(name);
    this.closeScreens();
  }

  // -----------------------------------------------------------------------------------------------
  // The game's own widgets
  // -----------------------------------------------------------------------------------------------

  /** A widget's definition (new, or changed: redrawn where it's up, with what it showed). */
  defineWidget(name: string, wire: WidgetWire) {
    const def = compileWidget(name, wire);
    if (!def) return;
    this.widgetDefs.set(name, def);
    this.widgetSheet.textContent = [...this.widgetDefs.values()].map((d) => d.css).join('\n');
    const up = this.widgetsUp.get(name);
    if (up) this.widget(name, up.view.data);
  }

  /**
   * Up on this screen (again, from scratch), filled in from `data`. A modal one that's up already
   * is filled in again inside its own screen, so the screen (and the mouse it freed) stays.
   */
  widget(name: string, data: unknown) {
    const def = this.widgetDefs.get(name);
    if (!def) return;
    const view = new WidgetView(def, mergeData({}, plainRecord(data)), (action, value) => this.onWidgetAction?.(name, action, value), this.local);
    const was = this.widgetsUp.get(name);
    if (def.modal && was?.screen) {
      was.view.root.replaceWith(view.root);
      was.view = view;
      return;
    }
    this.widgetRemove(name);
    const screen = def.modal ? this.widgetScreen(name, view) : null;
    if (!screen) this.widgetSlot(def.at).append(view.root);
    this.widgetsUp.set(name, { view, screen });
  }

  /** Whether a widget that's up reads this screen's own state (then it's worth working out each frame). */
  get wantsLocal(): boolean {
    for (const up of this.widgetsUp.values()) if (up.view.def.local) return true;
    return false;
  }

  /**
   * This screen's own state changed (its gun, abilities, health, as it predicts them): widgets
   * that bind it (`{{$gun.mag}}`) show it at once, with no round trip to the host.
   */
  setLocal(state: PlainData) {
    const key = JSON.stringify(state);
    if (key === this.localKey) return;
    this.localKey = key;
    for (const k of Object.keys(this.local)) delete this.local[k];
    Object.assign(this.local, state);
    for (const up of this.widgetsUp.values()) if (up.view.def.local) up.view.update();
  }

  /** What it shows changes: merged in, and only what reads differently is touched. */
  widgetSet(name: string, patch: unknown) {
    const up = this.widgetsUp.get(name);
    if (!up) return;
    mergeData(up.view.data, plainRecord(patch));
    up.view.update();
  }

  widgetRemove(name: string) {
    const up = this.widgetsUp.get(name);
    if (!up) return;
    this.widgetsUp.delete(name);
    if (up.screen) this.dropScreen(up.screen);
    else up.view.root.remove();
  }

  /** The place for widgets at one anchor (they stack there). */
  private widgetSlot(at: WidgetAnchor): HTMLElement {
    let slot = this.widgetSlots.get(at);
    if (!slot) {
      slot = h(`div.gw-slot.gw-${at}`);
      this.widgetSlots.set(at, slot);
      this.widgetLayer.append(slot);
    }
    return slot;
  }

  /**
   * A modal widget: in a screen of its own, like a menu. It frees the mouse, a controller moves
   * between its buttons, and Esc, B or a click outside closes it (the host hears).
   */
  private widgetScreen(name: string, view: WidgetView): HTMLElement {
    const el = h('div.screen.widget-screen', {}, view.root);
    const close = () => {
      if (this.widgetsUp.get(name)?.screen !== el) return;
      this.widgetRemove(name);
      this.onWidgetClosed?.(name);
    };
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key !== 'Escape') return;
      ev.stopPropagation();
      close();
    };
    el.onclick = (ev) => {
      if (ev.target === el) close();
    };
    window.addEventListener('keydown', onKey, true);
    this.unhooks.set(el, () => {
      window.removeEventListener('keydown', onKey, true);
      this.unhooks.delete(el);
    });
    this.menuClosers.set(el, close);
    this.root.parentElement!.append(el);
    this.screens.push(el);
    this.onScreen?.(true);
    return el;
  }

  private dropScreen(el: HTMLElement) {
    this.menuClosers.delete(el);
    this.unhooks.get(el)?.();
    el.remove();
    this.screens = this.screens.filter((x) => x !== el);
    if (this.screens.length === 0) this.onScreen?.(false);
  }
}

/**
 * A game's HUD theme (`hud.theme`): fonts and colours as CSS variables on the HUD, menus and
 * result screens, the fonts fetched from Google Fonts, and the game's own stylesheet, kept to
 * the HUD (see `scopeCss`).
 */
export function applyTheme(ui: HTMLElement, theme: HudTheme | undefined): () => void {
  if (!theme) return () => {};
  const links: HTMLLinkElement[] = [];
  if (theme.fonts?.length) {
    // 'Barlow:300;500' names its weights (400 and 700 if it doesn't).
    const families = theme.fonts
      .map((f) => {
        const [name, weights] = f.split(':');
        return `family=${encodeURIComponent(name.trim()).replace(/%20/g, '+')}:wght@${/^\d{3}(;\d{3})*$/.test(weights ?? '') ? weights : '400;700'}`;
      })
      .join('&');
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = `https://fonts.googleapis.com/css2?${families}&display=swap`;
    document.head.append(link);
    links.push(link);
  }
  const c = theme.colors ?? {};
  const vars: Record<string, string | undefined> = {
    '--hud-display': theme.display,
    '--hud-text': theme.text,
    '--hud-accent': c.accent,
    '--hud-ink': c.ink,
    '--hud-paper': c.paper,
    '--hud-fg': c.text,
    '--hud-danger': c.danger,
    '--hud-good': c.good,
  };
  for (const [k, v] of Object.entries(vars)) if (v) ui.style.setProperty(k, v);
  ui.classList.add('hud-themed');
  // After the platform's stylesheet, so the game's rules win where they're as specific.
  let sheet: HTMLStyleElement | null = null;
  if (theme.css) {
    sheet = document.createElement('style');
    sheet.dataset.hudTheme = '';
    sheet.textContent = scopeCss(theme.css, { theme: true });
    document.head.append(sheet);
  }
  return () => {
    for (const k of Object.keys(vars)) ui.style.removeProperty(k);
    ui.classList.remove('hud-themed');
    for (const l of links) l.remove();
    sheet?.remove();
  };
}
