import { parseAvatar } from '../avatar';
import { plainData } from '../ui/markup';
import { MESSAGE_MAX, MESSAGE_NAME, type ClientCommand, type ClientMessage, type PlayerInput } from './protocol';

/**
 * A client's command as a server should take it: checked field by field, numbers finite and in
 * range, lists short, text trimmed. Anything malformed is null (the server drops it). A browser
 * never sends such a thing; this is for everything else that can open a socket.
 */
export function sanitizeCommand(raw: unknown): ClientCommand | null {
  if (!isObject(raw) || typeof raw.t !== 'string') return null;
  switch (raw.t) {
    case 'input': {
      const input = sanitizeInput(raw.input);
      if (!input) return null;
      if (raw.seq === undefined && raw.dt === undefined) return { t: 'input', input };
      const seq = int(raw.seq, 0, Number.MAX_SAFE_INTEGER);
      const dt = num(raw.dt, 0, 0.1);
      return seq === null || dt === null ? null : { t: 'input', input, seq, dt };
    }
    case 'message': {
      const msg = sanitizeMessage(raw.msg);
      return msg ? { t: 'message', msg } : null;
    }
    case 'start': {
      // An avatar's code, if it is one (anything else is left out).
      const avatar = parseAvatar(raw.avatar as string) ? (raw.avatar as string) : undefined;
      if (raw.name === undefined) return avatar ? { t: 'start', avatar } : { t: 'start' };
      if (typeof raw.name !== 'string') return null;
      // Printable and short: it's shown over their head and keys their saved place.
      const name = raw.name.replace(/[^\p{L}\p{N} _.-]/gu, '').trim().slice(0, 20);
      return { t: 'start', name: name || 'Player', ...(avatar ? { avatar } : {}) };
    }
    case 'restart':
      return { t: 'restart' };
    case 'env': {
      const time = raw.time === undefined ? undefined : num(raw.time, 0, 1);
      const dayLength = raw.dayLength === undefined ? undefined : num(raw.dayLength, 10, 24 * 3600);
      return time === null || dayLength === null ? null : { t: 'env', time: time ?? undefined, dayLength: dayLength ?? undefined };
    }
    case 'radius': {
      const columns = int(raw.columns, 2, 12);
      return columns === null ? null : { t: 'radius', columns };
    }
    case 'exec':
    case 'complete': {
      const id = int(raw.id, 0, Number.MAX_SAFE_INTEGER);
      if (id === null || typeof raw.line !== 'string' || raw.line.length > 200) return null;
      return { t: raw.t, id, line: raw.line };
    }
    case 'dev': {
      // (Only a development server runs it; any other answers that it won't.)
      const id = int(raw.id, 0, Number.MAX_SAFE_INTEGER);
      if (id === null || typeof raw.js !== 'string') return null;
      return { t: 'dev', id, js: raw.js };
    }
    default:
      return null;
  }
}

function sanitizeInput(raw: unknown): PlayerInput | null {
  if (!isObject(raw)) return null;
  const keys = (v: unknown) => (Array.isArray(v) && v.length <= 32 && v.every((k) => typeof k === 'string' && k.length <= 24) ? (v as string[]) : null);
  const down = keys(raw.down);
  const pressed = keys(raw.pressed);
  const buttons = int(raw.buttons, 0, 31);
  const clicked = int(raw.clicked, 0, 31);
  const mouseX = num(raw.mouseX, -1e5, 1e5);
  const mouseY = num(raw.mouseY, -1e5, 1e5);
  const wheel = int(raw.wheel, -100, 100);
  const yaw = num(raw.yaw, -1e6, 1e6);
  const pitch = num(raw.pitch, -Math.PI / 2, Math.PI / 2);
  const viewSeq = int(raw.viewSeq, -1, Number.MAX_SAFE_INTEGER);
  if (typeof raw.active !== 'boolean' || !down || !pressed || buttons === null || clicked === null || mouseX === null || mouseY === null || wheel === null || yaw === null || pitch === null || viewSeq === null) return null;
  const out: PlayerInput = { active: raw.active, down, pressed, buttons, clicked, mouseX, mouseY, wheel, yaw, pitch, viewSeq };
  if (raw.dead === true && !raw.active) out.dead = true;
  if (raw.move !== undefined) {
    if (!Array.isArray(raw.move) || raw.move.length !== 2) return null;
    const x = num(raw.move[0], -1, 1);
    const z = num(raw.move[1], -1, 1);
    if (x === null || z === null) return null;
    out.move = [x, z];
  }
  if (raw.seen !== undefined) {
    const seen = num(raw.seen, 0, 1e9);
    if (seen === null) return null;
    out.seen = seen;
  }
  if (raw.acts !== undefined) {
    // Item kits' actions (see `PlayerInput.acts`): a few kinds, a few actions each an input, each a
    // short list of plain values. What each value means is the kind's to check (its host half).
    if (!isObject(raw.acts)) return null;
    const kinds = Object.keys(raw.acts);
    if (kinds.length > 8) return null;
    const acts: Record<string, unknown[][]> = {};
    for (const k of kinds) {
      const list = raw.acts[k];
      // (Not a name every object has: `constructor`, `toString`.)
      if (!/^[A-Za-z][A-Za-z0-9_-]{0,31}$/.test(k) || k in Object.prototype || !Array.isArray(list) || list.length > 8) return null;
      const out: unknown[][] = [];
      for (const a of list) {
        if (!Array.isArray(a) || a.length > 16 || !a.every(plainValue)) return null;
        out.push([...a]);
      }
      acts[k] = out;
    }
    out.acts = acts;
  }
  return out;
}

/** A value an item kit's action may carry: a finite number, a short string, a boolean or null. */
function plainValue(v: unknown): boolean {
  return v === null || typeof v === 'boolean' || (typeof v === 'number' && Number.isFinite(v) && Math.abs(v) <= 1e9) || (typeof v === 'string' && v.length <= 64);
}

function sanitizeMessage(raw: unknown): ClientMessage | null {
  if (!isObject(raw)) return null;
  // The player is whoever's socket it came on; the host fills it in.
  if (raw.t === 'callback') {
    const id = int(raw.id, 0, Number.MAX_SAFE_INTEGER);
    return id === null ? null : { t: 'callback', player: '', id };
  }
  if (raw.t === 'menuClosed') {
    const menu = int(raw.menu, 0, Number.MAX_SAFE_INTEGER);
    return menu === null ? null : { t: 'menuClosed', player: '', menu };
  }
  if (raw.t === 'creativePick') {
    const block = int(raw.block, 0, 254);
    return block === null ? null : { t: 'creativePick', player: '', block };
  }
  // A widget's button: names as the game writes them, a value no longer than an attribute's.
  const name = (v: unknown) => (typeof v === 'string' && /^[\w-]{1,40}$/.test(v) ? v : null);
  if (raw.t === 'widgetAction') {
    const widget = name(raw.widget);
    const action = name(raw.action);
    if (!widget || !action || (raw.value !== undefined && typeof raw.value !== 'string')) return null;
    return { t: 'widgetAction', player: '', widget, action, value: String(raw.value ?? '').slice(0, 200) };
  }
  if (raw.t === 'widgetClosed') {
    const widget = name(raw.widget);
    return widget ? { t: 'widgetClosed', player: '', widget } : null;
  }
  if (raw.t === 'game') return sanitizeGameMessage(raw.name, raw.data);
  if (raw.t === 'replaySkip') {
    const id = int(raw.id, 0, Number.MAX_SAFE_INTEGER);
    return id === null ? null : { t: 'replaySkip', player: '', id };
  }
  return null;
}

/**
 * A message from a game's client code (`client.send(name, data)`): a name as games write them
 * (never the platform's `$` ones), and plain data (strings, finite numbers, booleans, null, lists
 * and records, not too deep) of at most `MESSAGE_MAX.client` as JSON. The game checks what it says.
 */
export function sanitizeGameMessage(name: unknown, data: unknown): ClientMessage | null {
  if (typeof name !== 'string' || !MESSAGE_NAME.test(name)) return null;
  const clean = data === undefined ? null : plainData(data);
  if (clean === undefined) return null;
  const json = JSON.stringify(clean);
  if (json.length > MESSAGE_MAX.client) return null;
  return { t: 'game', player: '', name, data: clean };
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

function num(v: unknown, min: number, max: number): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : null;
}

function int(v: unknown, min: number, max: number): number | null {
  return typeof v === 'number' && Number.isInteger(v) && v >= min && v <= max ? v : null;
}
