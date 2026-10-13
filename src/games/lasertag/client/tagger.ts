import type { Client, ClientKit } from '@platform/client';
import { canFire, freshTagger, isTagger, lookDir, spend, stepTagger, taggerMove, type BeamWire, type TaggerItem, type TaggerShown, type TaggerState } from '../tagger.shared';

declare module '@platform/client' {
  interface ClientEvents {
    /** Our tagger fired (its sound, the hand's kick). */
    'tagger.fired': { item: string };
  }
}

/** A held tagger as client code sees it (`client.me.held.state`). */
export interface TaggerView {
  energy: number;
  color: string;
}

/**
 * The tagger's screen half (a `ClientKit` with its `kind`): it fires the moment the button's
 * clicked, if the tagger could (its rate, its energy, predicted here as the host plays them), draws
 * the beam at once from where this screen's eye is, and sends the shot with the controls. Other
 * players' beams come from the host (`tagger.beam`), drawn from their figure's muzzle. The host's
 * word on the energy is taken once nothing's happened here for a moment.
 */
export function taggers(): ClientKit {
  /** Each tagger carried, as this screen has it. */
  const own = new Map<string, TaggerState>();
  /** Seconds since we fired (the host's word waits for quiet). */
  let quiet = 99;
  /** This frame's shots, drawn once the camera's placed. */
  let shots: { def: TaggerItem; yaw: number; pitch: number }[] = [];
  return {
    name: 'lasertag.taggers',
    kind: 'tagger',
    setup(client) {
      client.audio.define('tag_zap', (s) => {
        s.tone({ wave: 'sawtooth', from: 1800 * s.pitch, to: 300 * s.pitch, duration: 0.16, volume: 0.25, lowpass: 5000 });
        s.noise({ duration: 0.06, filter: 'highpass', from: 4000, volume: 0.12 });
      });
      client.on('tagger.beam', (data) => {
        const [by, x0, y0, z0, x1, y1, z1, color] = data as BeamWire;
        // From their tagger's muzzle as their figure's drawn, else their eyes.
        const fig = client.figures.all.find((f) => f.player === by);
        const m = fig?.point('muzzle');
        const from = m ? { x: m.x, y: m.y, z: m.z } : { x: x0, y: y0, z: z0 };
        fig?.used();
        client.fx.tracer(from, { x: x1, y: y1, z: z1 }, color);
        client.audio.play('tag_zap', { at: from, volume: 0.7 });
      });
    },
    controls(client, c, dt) {
      quiet += dt;
      for (const [id, st] of own) {
        const d = client.item(id);
        if (isTagger(d)) stepTagger(d, st, dt);
      }
      const item = client.me.hand.item;
      const def = item ? client.item(item) : undefined;
      if (!item || !isTagger(def)) return;
      let st = own.get(item);
      if (!st) own.set(item, (st = freshTagger()));
      // The host's word, once it's quiet here (its count of shots at once).
      const host = client.me.hand.state as TaggerShown | null;
      if (host) {
        st.serial = Math.max(st.serial, host.serial);
        if (quiet > 0.6) st.energy = host.energy;
      }
      if (!c.clicked(0) || !canFire(def, st)) return;
      st.serial++;
      spend(def, st);
      quiet = 0;
      c.act([st.serial, c.yaw, c.pitch]);
      shots.push({ def, yaw: c.yaw, pitch: c.pitch });
      client.emit({ t: 'tagger.fired', item });
    },
    frame(client) {
      for (const e of client.events) if (e.t === 'tagger.fired') client.audio.play('tag_zap');
    },
    late(client) {
      // Our beams, from the eye as it's placed now to where they land on this screen.
      const eye = client.camera.position;
      for (const s of shots) {
        const end = client.world.trace(eye, lookDir(s.yaw, s.pitch), s.def.range);
        const from = client.view.worldPoint('muzzle') ?? eye;
        client.fx.tracer(from, end.point, s.def.color);
        if (end.body) client.fx.flare(end.point, 0.35);
      }
      shots = [];
    },
    move: (def) => (isTagger(def) ? taggerMove(def) : null),
    heldState(_client, item, def) {
      const st = own.get(item);
      return isTagger(def) && st ? ({ energy: st.energy, color: def.color } satisfies TaggerView) : null;
    },
    figureSignals: () => ({ aim: 1 }),
  };
}

/** The held tagger's energy, over the hotbar: a bar in its beam's colour. */
export function energyBar(): ClientKit {
  let bar: HTMLElement | null = null;
  let fill: HTMLElement | null = null;
  return {
    name: 'lasertag.energy',
    setup(client) {
      const layer = client.hud.layer('lasertag-energy');
      client.hud.style(`.lt-energy { position: absolute; left: 50%; bottom: 74px; width: 180px; height: 6px; margin-left: -90px;
        border-radius: 3px; background: rgba(0, 0, 0, 0.45); overflow: hidden }
        .lt-energy > div { height: 100%; transition: width 60ms linear }`);
      bar = document.createElement('div');
      bar.className = 'lt-energy';
      fill = document.createElement('div');
      bar.append(fill);
      layer.append(bar);
    },
    frame(client: Client) {
      const held = client.me.held?.state as TaggerView | undefined;
      if (!bar || !fill) return;
      bar.style.display = held && !client.me.dead ? '' : 'none';
      if (!held) return;
      fill.style.width = `${Math.round(held.energy * 100)}%`;
      fill.style.background = held.color;
    },
  };
}
