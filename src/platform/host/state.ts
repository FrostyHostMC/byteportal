import type { PresentCall } from '../net/protocol';
import { mergeData, type PlainData } from '../ui/markup';

/**
 * Which presentation calls set something that stays on screen (an objective, a stat, a marker)
 * rather than happening once (a banner, a sound): their key, or null. Calls with the same key
 * replace each other.
 */
function keyOf(c: PresentCall): string | null {
  if (c.target === 'hud') {
    switch (c.method) {
      case 'objective':
      case 'crosshair':
      case 'radar':
      case 'progress':
      case 'highlight':
      case 'scoreboard':
        return c.method;
      case 'bossBar':
      case 'hideBossBar':
        return 'bossBar';
      case 'stat':
      case 'meter':
      case 'marker':
        return `${c.method}:${String(c.args[0])}`;
      // A game's widget: up with its data, changed by patches, or down.
      case 'widget':
      case 'widgetSet':
      case 'widgetRemove':
        return `widget:${String(c.args[0])}`;
    }
  }
  if (c.target === 'view' && (c.method === 'visible' || c.method === 'setSkin')) return `view.${c.method}`;
  // A sound loop's volume and pitch (an engine): setting it the same again changes nothing.
  if (c.target === 'audio' && c.method === 'loopSet') return `loopSet:${String(c.args[0])}`;
  return null;
}

interface Kept {
  call: PresentCall;
  json: string;
}

/**
 * What the presentation calls have put on each player's screen, kept by key. It drops a call that
 * would change nothing (games often set their objective or markers every tick), and tells a player
 * who joins late what everyone already sees.
 */
export class PresentState {
  private everyone = new Map<string, Kept>();
  private personal = new Map<string, Map<string, Kept>>();

  /** Whether the call needs sending (false: the screen already shows exactly this). */
  admit(c: PresentCall): boolean {
    if (c.target === 'message' && c.method === '$reset') {
      // A restart clears every screen.
      this.everyone.clear();
      this.personal.clear();
      return true;
    }
    const key = keyOf(c);
    if (key === null) return true;
    if (c.method === 'widgetSet') {
      // A change the host worked out already: kept merged in, for screens that catch up later.
      this.patch(key, c);
      return true;
    }
    const json = c.method + JSON.stringify(c.args);
    // A widget put up whole always goes: the game's side only sends one when it means the screen
    // to build it afresh (it was down there, or the screen may have lost it).
    const always = c.method === 'widget';
    if (c.to === null) {
      // After a personal call with this key, the screens differ: send the next one to everyone.
      const same = !always && this.everyone.get(key)?.json === json && !this.personal.has(key);
      this.everyone.set(key, { call: c, json });
      this.personal.delete(key);
      return !same;
    }
    let mine = this.personal.get(key);
    if (!mine) this.personal.set(key, (mine = new Map()));
    const same = !always && mine.get(c.to)?.json === json;
    mine.set(c.to, { call: c, json });
    return !same;
  }

  /** The calls that bring a new client's screen up to date: what everyone sees, then their own. */
  snapshot(player: string): PresentCall[] {
    const out = [...this.everyone.values()].map((k) => k.call);
    for (const mine of this.personal.values()) {
      const k = mine.get(player);
      if (k) out.push(k.call);
    }
    return out;
  }

  /**
   * A widget patch merged into what's kept: everyone's widget and each player's own for one for
   * everyone; for one player, theirs (their own copy of everyone's, if that's what they had).
   */
  private patch(key: string, c: PresentCall) {
    const change = c.args[1] as PlainData;
    const merged = (k: Kept, to: string | null): Kept => {
      if (k.call.method !== 'widget') return k;
      const call: PresentCall = { ...k.call, to, args: [k.call.args[0], mergeData(structuredClone(k.call.args[1] as PlainData), change)] };
      return { call, json: call.method + JSON.stringify(call.args) };
    };
    const all = this.everyone.get(key);
    const mine = this.personal.get(key);
    if (c.to === null) {
      if (all) this.everyone.set(key, merged(all, null));
      if (mine) for (const [p, k] of mine) mine.set(p, merged(k, p));
      return;
    }
    const base = mine?.get(c.to) ?? all;
    if (!base) return;
    if (mine) mine.set(c.to, merged(base, c.to));
    else this.personal.set(key, new Map([[c.to, merged(base, c.to)]]));
  }

  /** A player left for good. */
  forget(player: string) {
    for (const mine of this.personal.values()) mine.delete(player);
  }
}
