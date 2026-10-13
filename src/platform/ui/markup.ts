/**
 * The page-free half of a game's own HUD: widget markup read into a tree of allowed elements (no
 * scripts, event attributes, links or frames), CSS kept to the widget it belongs to (or, for a
 * game's HUD theme, to the HUD), the small template language that fills a widget in from data,
 * and that data's changes. Nothing here touches the DOM: the simulation checks a widget here when
 * the game defines it, and each player's screen reads it again before building it (a screen takes
 * nothing a server sends on trust). Markup is never handed to the browser's HTML parser: screens
 * build it element by element from this tree.
 */

import type { WidgetAnchor } from '../api/types';

// -------------------------------------------------------------------------------------------------
// Markup
// -------------------------------------------------------------------------------------------------

/** An element as a widget's markup has it, attributes checked (values may hold `{{…}}` bindings). */
export interface MarkupElement {
  tag: string;
  attrs: Record<string, string>;
  children: MarkupNode[];
}

/** An element or text (with its `{{…}}` bindings still in it). */
export type MarkupNode = MarkupElement | string;

export interface ParsedMarkup {
  nodes: MarkupNode[];
  /** The names in its `data-action` attributes (what its buttons can ask the game for). */
  actions: string[];
  /** What was left out (`<script>`, `onclick`…), to tell the game's author. */
  dropped: string[];
}

/** Elements a widget can use: text, boxes, lists, tables, buttons, pictures. */
const ALLOWED = new Set([
  'div', 'span', 'p', 'b', 'strong', 'i', 'em', 'u', 's', 'small', 'sub', 'sup', 'mark', 'br', 'hr', 'wbr',
  'ul', 'ol', 'li', 'dl', 'dt', 'dd', 'table', 'thead', 'tbody', 'tfoot', 'tr', 'th', 'td', 'caption', 'colgroup', 'col',
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'header', 'footer', 'section', 'article', 'aside', 'nav', 'figure', 'figcaption',
  'button', 'img', 'label', 'progress', 'meter', 'abbr', 'code', 'pre', 'kbd', 'q', 'blockquote', 'time',
]);

/** Left out with everything in them: code, frames, forms' fields, media, other kinds of markup. */
const DROPPED = new Set([
  'script', 'style', 'template', 'iframe', 'frame', 'frameset', 'object', 'embed', 'applet', 'noscript', 'noembed', 'noframes',
  'textarea', 'title', 'xmp', 'plaintext', 'svg', 'math', 'select', 'option', 'optgroup', 'datalist', 'input', 'video', 'audio',
  'source', 'track', 'canvas', 'dialog', 'link', 'meta', 'base', 'portal', 'slot', 'head', 'param', 'picture', 'map', 'area', 'output',
]);

/** Their content isn't markup: skipped to the closing tag. */
const RAW_TEXT = new Set(['script', 'style', 'textarea', 'title', 'xmp', 'iframe', 'noembed', 'noframes', 'noscript', 'plaintext']);

const VOID = new Set(['br', 'hr', 'wbr', 'img', 'col', 'input', 'meta', 'link', 'base', 'area', 'source', 'track', 'embed', 'param']);

/** Attributes any element can have (plus `data-*` and `aria-*`). No `id` or `name`: they'd clash with the page's own. */
const GLOBAL_ATTRS = new Set(['class', 'title', 'style', 'hidden', 'role', 'lang', 'dir']);

const TAG_ATTRS: Record<string, string[]> = {
  img: ['src', 'alt', 'width', 'height'],
  td: ['colspan', 'rowspan'],
  th: ['colspan', 'rowspan'],
  col: ['span'],
  colgroup: ['span'],
  progress: ['value', 'max'],
  meter: ['value', 'min', 'max', 'low', 'high', 'optimum'],
  button: ['disabled'],
  ol: ['start', 'reversed'],
  li: ['value'],
  time: ['datetime'],
};

const ENTITIES: Record<string, string> = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: '\u00a0', middot: '·', bull: '•', times: '×', divide: '÷',
  hellip: '…', mdash: '—', ndash: '–', copy: '©', reg: '®', trade: '™', deg: '°', plusmn: '±', rarr: '→', larr: '←',
  uarr: '↑', darr: '↓', hearts: '♥', star: '☆', starf: '★', check: '✓', cross: '✗', laquo: '«', raquo: '»',
};

function decodeEntities(s: string): string {
  if (!s.includes('&')) return s;
  return s.replace(/&(#x[0-9a-f]{1,6}|#\d{1,7}|[a-z]{2,8});/gi, (m, e: string) => {
    if (e[0] === '#') {
      const code = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return code > 0 && code <= 0x10ffff && !(code >= 0xd800 && code <= 0xdfff) ? String.fromCodePoint(code) : '\ufffd';
    }
    return ENTITIES[e.toLowerCase()] ?? m;
  });
}

/** Most elements, and how deep, one widget's markup builds. */
const MAX_NODES = 4000;
const MAX_DEPTH = 40;
export const MAX_MARKUP = 64 * 1024;

/**
 * Read a widget's markup: allowed elements and attributes only, everything else left out (and
 * named in `dropped`). An element that isn't allowed but is harmless (`<a>`, `<font>`, a custom
 * element) goes and its content stays; code, frames and other kinds of markup go with their
 * content. `style` and `src` are checked here when fixed, and again when a binding fills them.
 */
export function parseMarkup(html: string): ParsedMarkup {
  const dropped = new Set<string>();
  const actions = new Set<string>();
  const root: MarkupElement = { tag: '#root', attrs: {}, children: [] };
  const stack: MarkupElement[] = [root];
  let count = 0;
  const src = html.length > MAX_MARKUP ? (dropped.add(`everything past ${MAX_MARKUP} characters`), html.slice(0, MAX_MARKUP)) : html;
  let i = 0;
  const text = (t: string) => {
    if (!t) return;
    const top = stack[stack.length - 1];
    const last = top.children[top.children.length - 1];
    if (typeof last === 'string') top.children[top.children.length - 1] = last + decodeEntities(t);
    else if (count++ < MAX_NODES) top.children.push(decodeEntities(t));
  };
  while (i < src.length) {
    const lt = src.indexOf('<', i);
    if (lt < 0) {
      text(src.slice(i));
      break;
    }
    text(src.slice(i, lt));
    i = lt;
    if (src.startsWith('<!--', i)) {
      const end = src.indexOf('-->', i + 4);
      i = end < 0 ? src.length : end + 3;
      continue;
    }
    const next = src[i + 1] ?? '';
    if (next === '!' || next === '?') {
      // A doctype or processing instruction: nothing to show.
      const end = src.indexOf('>', i);
      i = end < 0 ? src.length : end + 1;
      continue;
    }
    if (next === '/') {
      const m = /^<\/([a-zA-Z][a-zA-Z0-9-]*)[^>]*>?/.exec(src.slice(i));
      if (!m) {
        text('<');
        i++;
        continue;
      }
      i += m[0].length;
      const tag = m[1].toLowerCase();
      for (let d = stack.length - 1; d > 0; d--) {
        if (stack[d].tag === tag) {
          stack.length = d;
          break;
        }
      }
      continue;
    }
    const open = readTag(src, i);
    if (!open) {
      text('<');
      i++;
      continue;
    }
    i = open.end;
    const tag = open.tag;
    if (RAW_TEXT.has(tag) && !open.selfClosing) {
      // Its content is code or text for something else: skip past its closing tag.
      const close = new RegExp(`</${tag}(?=[\\s/>])`, 'i').exec(src.slice(i));
      const gt = close ? src.indexOf('>', i + close.index) : -1;
      i = gt < 0 ? src.length : gt + 1;
    }
    if (DROPPED.has(tag)) {
      dropped.add(`<${tag}>`);
      if (!RAW_TEXT.has(tag) && !VOID.has(tag) && !open.selfClosing) i = skipElement(src, i, tag);
      continue;
    }
    if (!ALLOWED.has(tag)) {
      // Harmless but not allowed: its content stays, in its place.
      dropped.add(`<${tag}>`);
      continue;
    }
    const attrs: Record<string, string> = {};
    for (const [name, value] of open.attrs) {
      const kept = keepAttr(tag, name, value);
      if (kept === null) {
        dropped.add(name.startsWith('on') ? 'event attributes (on…)' : name);
        continue;
      }
      if (name === 'data-action') actions.add(kept);
      attrs[name] = kept;
    }
    if (stack.length > MAX_DEPTH || count++ >= MAX_NODES) {
      dropped.add('elements past the limit');
      continue;
    }
    const el: MarkupElement = { tag, attrs, children: [] };
    stack[stack.length - 1].children.push(el);
    if (!VOID.has(tag) && !open.selfClosing) stack.push(el);
  }
  return { nodes: root.children, actions: [...actions], dropped: [...dropped] };
}

/** A start tag at `i`: its name, attributes (names lower-cased, values decoded), and where it ends. */
function readTag(src: string, i: number): { tag: string; attrs: [string, string][]; selfClosing: boolean; end: number } | null {
  const m = /^<([a-zA-Z][a-zA-Z0-9-]*)/.exec(src.slice(i, i + 64));
  if (!m) return null;
  const tag = m[1].toLowerCase();
  let j = i + m[0].length;
  const attrs: [string, string][] = [];
  const seen = new Set<string>();
  while (j < src.length) {
    while (j < src.length && /[\s/]/.test(src[j]) && !(src[j] === '/' && src[j + 1] === '>')) j++;
    if (j >= src.length) break;
    if (src[j] === '>') return { tag, attrs, selfClosing: false, end: j + 1 };
    if (src[j] === '/' && src[j + 1] === '>') return { tag, attrs, selfClosing: true, end: j + 2 };
    const n = /^[^\s"'>/=]+/.exec(src.slice(j));
    if (!n) {
      j++;
      continue;
    }
    const name = n[0].toLowerCase();
    j += n[0].length;
    while (j < src.length && /\s/.test(src[j])) j++;
    let value = '';
    if (src[j] === '=') {
      j++;
      while (j < src.length && /\s/.test(src[j])) j++;
      const q = src[j];
      if (q === '"' || q === "'") {
        const end = src.indexOf(q, j + 1);
        value = src.slice(j + 1, end < 0 ? src.length : end);
        j = end < 0 ? src.length : end + 1;
      } else {
        const v = /^[^\s>]*/.exec(src.slice(j))![0];
        value = v;
        j += v.length;
      }
    }
    // The first of a repeated attribute counts, as in HTML.
    if (!seen.has(name)) {
      seen.add(name);
      attrs.push([name, decodeEntities(value)]);
    }
  }
  return { tag, attrs, selfClosing: false, end: src.length };
}

/** Past the end of an element left out with its content (nested ones of the same kind counted). */
function skipElement(src: string, i: number, tag: string): number {
  const re = new RegExp(`<(/?)${tag}(?=[\\s/>])[^>]*>`, 'gi');
  re.lastIndex = i;
  let depth = 1;
  for (let m = re.exec(src); m; m = re.exec(src)) {
    depth += m[1] ? -1 : m[0].endsWith('/>') ? 0 : 1;
    if (depth === 0) return m.index + m[0].length;
  }
  return src.length;
}

/** An attribute's value if the element may have it (checked), else null. */
function keepAttr(tag: string, name: string, value: string): string | null {
  const allowed = GLOBAL_ATTRS.has(name) || TAG_ATTRS[tag]?.includes(name) || /^data-[a-z0-9_.-]+$/.test(name) || /^aria-[a-z]+$/.test(name);
  if (!allowed) return null;
  if (value.length > 2000) return null;
  if (name === 'data-action') return /^[\w-]{1,40}$/.test(value) ? value : null;
  const bound = value.includes('{{');
  if (name === 'style' && !bound) return cleanStyle(value);
  if (name === 'src' && !bound) return safeUrl(value) ? value : null;
  return value;
}

// -------------------------------------------------------------------------------------------------
// Template: `{{path}}` in text and attributes, `data-if="cond"`, `data-each="path"`
// -------------------------------------------------------------------------------------------------

/**
 * A name to look up: `score`, `me.kills`, `rows.0.name`; `.` the list item, `$i` its index from 0,
 * `$n` from 1. Any other name starting with `$` (`$gun.mag`, `$ability.dash.cool`, `$health`) is
 * the screen's own state, filled in by the player's screen itself rather than sent by the game.
 */
export type Path = string[];

/** A piece of text or an attribute: fixed text, or a value from the data. */
export type TemplatePart = string | { path: Path };

const PATH = /^(?:\.|\$[A-Za-z]\w*|[A-Za-z_][\w]*)(?:\.[\w]+)*$/;

/** Whether a path reads the screen's own state (`$gun.mag`), not the widget's data. */
export const isLocal = (path: Path) => path[0][0] === '$' && path[0] !== '$i' && path[0] !== '$n';

export function parsePath(s: string): Path | null {
  const t = s.trim();
  if (!PATH.test(t)) return null;
  return t === '.' ? ['.'] : t.split('.');
}

/** Text with `{{…}}` in it, as parts. A binding that isn't a name shows nothing. */
export function parseTemplate(s: string): TemplatePart[] {
  const out: TemplatePart[] = [];
  let i = 0;
  while (i < s.length) {
    const a = s.indexOf('{{', i);
    if (a < 0) break;
    const b = s.indexOf('}}', a + 2);
    if (b < 0) break;
    if (a > i) out.push(s.slice(i, a));
    const path = parsePath(s.slice(a + 2, b));
    if (path) out.push({ path });
    i = b + 2;
  }
  if (i < s.length) out.push(s.slice(i));
  return out;
}

type Operand = { path: Path } | { value: PlainValue };

/** A `data-if`: a value (true unless false, 0, empty, null or missing), or a comparison with another; `!` in front turns it round. */
export interface Condition {
  not: boolean;
  left: Operand;
  op?: '==' | '!=' | '>' | '>=' | '<' | '<=';
  right?: Operand;
}

function operand(s: string): Operand | null {
  const t = s.trim();
  if (/^-?\d+(\.\d+)?$/.test(t)) return { value: Number(t) };
  if (/^'[^']*'$|^"[^"]*"$/.test(t)) return { value: t.slice(1, -1) };
  if (t === 'true' || t === 'false') return { value: t === 'true' };
  if (t === 'null') return { value: null };
  const path = parsePath(t);
  return path ? { path } : null;
}

export function parseCondition(src: string): Condition | null {
  let s = src.trim();
  let not = false;
  if (s.startsWith('!') && !s.startsWith('!=')) {
    not = true;
    s = s.slice(1);
  }
  const m = /^(.*?)\s*(==|!=|>=|<=|>|<)\s*(.*)$/.exec(s);
  if (!m) {
    const left = operand(s);
    return left ? { not, left } : null;
  }
  const left = operand(m[1]);
  const right = operand(m[3]);
  return left && right ? { not, left, op: m[2] as Condition['op'], right } : null;
}

/**
 * Where a template looks names up: a list item's fields first, then the lists around it, then the
 * widget's data. `$` names (`$gun.mag`) look in `local`, the screen's own state (the outermost
 * scope's), which the screen keeps up to date itself: its gun, its movement abilities, its health.
 */
export interface Scope {
  data: PlainData;
  item?: PlainValue;
  index?: number;
  up?: Scope;
  local?: PlainData;
}

const own = (o: object, k: string) => Object.prototype.hasOwnProperty.call(o, k);
const isRecord = (v: unknown): v is Record<string, PlainValue> => typeof v === 'object' && v !== null && !Array.isArray(v);

export function lookup(path: Path, scope: Scope): PlainValue | undefined {
  const [head, ...rest] = path;
  let v: PlainValue | undefined;
  if (head === '.') v = scope.item;
  else if (head === '$i') v = scope.index;
  else if (head === '$n') v = scope.index === undefined ? undefined : scope.index + 1;
  else if (head[0] === '$') {
    let root = scope;
    while (root.up) root = root.up;
    v = root.local && own(root.local, head) ? root.local[head] : undefined;
  } else {
    for (let s: Scope | undefined = scope; s; s = s.up) {
      if (isRecord(s.item) && own(s.item, head)) {
        v = s.item[head];
        break;
      }
      if (!s.up) v = own(s.data, head) ? s.data[head] : undefined;
    }
  }
  for (const k of rest) {
    if (Array.isArray(v)) v = /^\d+$/.test(k) ? v[Number(k)] : k === 'length' ? v.length : undefined;
    else v = isRecord(v) && own(v, k) ? v[k] : undefined;
  }
  return v;
}

/** How a value reads in text: numbers and strings as they are, nothing for missing, lists or objects. */
export function show(v: PlainValue | undefined): string {
  if (v === undefined || v === null) return '';
  if (typeof v === 'string') return v;
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  return '';
}

export function fill(parts: TemplatePart[], scope: Scope): string {
  let s = '';
  for (const p of parts) s += typeof p === 'string' ? p : show(lookup(p.path, scope));
  return s;
}

const truthy = (v: PlainValue | undefined) => !(v === undefined || v === null || v === false || v === 0 || v === '' || (Array.isArray(v) && v.length === 0));

export function test(c: Condition, scope: Scope): boolean {
  const get = (o: Operand) => ('path' in o ? lookup(o.path, scope) : o.value);
  const a = get(c.left);
  let r: boolean;
  if (!c.op || !c.right) r = truthy(a);
  else {
    const b = get(c.right);
    const numeric = typeof a === 'number' && typeof b === 'number';
    switch (c.op) {
      case '==':
        r = numeric ? a === b : show(a) === show(b);
        break;
      case '!=':
        r = numeric ? a !== b : show(a) !== show(b);
        break;
      default: {
        const x = Number(a);
        const y = Number(b);
        r = c.op === '>' ? x > y : c.op === '>=' ? x >= y : c.op === '<' ? x < y : x <= y;
      }
    }
  }
  return c.not ? !r : r;
}

// -------------------------------------------------------------------------------------------------
// URLs and CSS
// -------------------------------------------------------------------------------------------------

/**
 * A picture's address a widget or theme may use: an image in the page itself (`data:image/…`), a
 * file on this site (`/art/x.png`, `art/x.png`), or a fragment (`#id`). Nothing from elsewhere:
 * a game on a server can't make players' screens fetch from anywhere it likes.
 */
export function safeUrl(u: string): boolean {
  const s = u.trim();
  if (/^data:image\/(png|gif|jpeg|webp|avif|svg\+xml)[;,]/i.test(s)) return true;
  if (s.startsWith('//') || s.includes('\\')) return false;
  if (s.startsWith('#')) return /^#[\w-]*$/.test(s);
  // A scheme (anything: before the first / ? #) is another site or worse.
  return !/^[^/?#]*:/.test(s) && /^[\w./%?=&#~+-]*$/.test(s);
}

/** Functions a CSS value may call: maths, colours, gradients, transforms, filters, shapes. */
const FUNCTIONS = new Set([
  'var', 'calc', 'min', 'max', 'clamp', 'round', 'mod', 'rem', 'abs', 'sign', 'sin', 'cos', 'tan', 'asin', 'acos', 'atan', 'atan2', 'pow', 'sqrt', 'hypot', 'log', 'exp',
  'rgb', 'rgba', 'hsl', 'hsla', 'hwb', 'lab', 'lch', 'oklab', 'oklch', 'color', 'color-mix', 'light-dark',
  'linear-gradient', 'radial-gradient', 'conic-gradient', 'repeating-linear-gradient', 'repeating-radial-gradient', 'repeating-conic-gradient',
  'translate', 'translatex', 'translatey', 'translatez', 'translate3d', 'rotate', 'rotatex', 'rotatey', 'rotatez', 'rotate3d',
  'scale', 'scalex', 'scaley', 'scalez', 'scale3d', 'skew', 'skewx', 'skewy', 'matrix', 'matrix3d', 'perspective',
  'cubic-bezier', 'steps', 'linear', 'blur', 'brightness', 'contrast', 'drop-shadow', 'grayscale', 'hue-rotate', 'invert', 'opacity', 'saturate', 'sepia',
  'repeat', 'minmax', 'fit-content', 'inset', 'circle', 'ellipse', 'polygon', 'rect', 'xywh', 'path', 'counter', 'counters', 'attr', 'env',
]);

/** Properties never allowed (old browsers ran code from them). */
const BAD_PROPS = new Set(['behavior', '-ms-behavior', '-moz-binding']);

/**
 * Walk CSS text outside strings and escapes: `visit(i, depth)` for each character that counts, with
 * how deep in brackets it is. False if a string or bracket is left open or closes too soon.
 */
function walk(s: string, visit?: (i: number, depth: number) => boolean | void): boolean {
  let depth = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === '\\') {
      i++;
      continue;
    }
    if (c === '"' || c === "'") {
      const end = closeString(s, i);
      if (end < 0) return false;
      i = end;
      continue;
    }
    if (c === '(' || c === '[') depth++;
    else if (c === ')' || c === ']') {
      if (--depth < 0) return false;
    }
    if (visit?.(i, depth) === false) return false;
  }
  return depth === 0;
}

function closeString(s: string, i: number): number {
  const q = s[i];
  for (let j = i + 1; j < s.length; j++) {
    if (s[j] === '\\') j++;
    else if (s[j] === q) return j;
    else if (s[j] === '\n') return -1;
  }
  return -1;
}

/** Split at `sep` where it isn't in brackets or strings. */
function splitTop(s: string, sep: string): string[] {
  const out: string[] = [];
  let from = 0;
  walk(s, (i, depth) => {
    if (depth === 0 && s[i] === sep) {
      out.push(s.slice(from, i));
      from = i + 1;
    }
  });
  out.push(s.slice(from));
  return out;
}

function stripComments(css: string): string {
  let out = '';
  for (let i = 0; i < css.length; i++) {
    const c = css[i];
    if (c === '\\') {
      out += css.slice(i, i + 2);
      i++;
    } else if (c === '"' || c === "'") {
      const end = closeString(css, i);
      const stop = end < 0 ? css.length : end + 1;
      out += css.slice(i, stop);
      i = stop - 1;
    } else if (c === '/' && css[i + 1] === '*') {
      const end = css.indexOf('*/', i + 2);
      i = end < 0 ? css.length : end + 1;
      out += ' ';
    } else out += c;
  }
  return out;
}

/** Whether a CSS value is safe: allowed functions only, `url()` only to `safeUrl` places, no escapes outside strings. */
export function safeValue(v: string): boolean {
  const bare = v.replace(/"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'/g, '""');
  // An escape outside a string could spell a function name (`u\72l(`): none allowed.
  if (v.length > 4000 || /[<{}@\\]/.test(bare) || /expression|javascript:/i.test(v)) return false;
  let ok = true;
  const balanced = walk(v, (i, depth) => {
    const c = v[i];
    // (A `;` inside brackets is part of a value: a data URL's `;base64`.)
    if (c === ';' && depth === 0) return (ok = false);
    if (c === '(') {
      const name = /(-?[a-zA-Z][\w-]*)$/.exec(v.slice(Math.max(0, i - 40), i))?.[1].toLowerCase() ?? '';
      if (!name) return;
      if (name === 'url') {
        const close = v.indexOf(')', i);
        const arg = v.slice(i + 1, close < 0 ? v.length : close).trim().replace(/^(["'])(.*)\1$/s, '$2');
        if (!safeUrl(arg)) ok = false;
        return ok;
      }
      if (!FUNCTIONS.has(name.replace(/^-(webkit|moz|ms|o)-/, ''))) ok = false;
      return ok;
    }
  });
  return ok && balanced;
}

/** A declaration block's declarations that are safe, as `prop: value;` text (keyframe names renamed). */
function cleanDeclarations(body: string, renames?: Map<string, string>): string {
  const out: string[] = [];
  for (const decl of splitTop(body, ';')) {
    const colon = decl.indexOf(':');
    if (colon < 0) continue;
    const prop = decl.slice(0, colon).trim().toLowerCase();
    let value = decl.slice(colon + 1).trim();
    if (!/^(--[\w-]+|-?[a-z][a-z-]*)$/.test(prop) || BAD_PROPS.has(prop) || !value) continue;
    const important = /!\s*important\s*$/i.test(value);
    if (important) value = value.replace(/!\s*important\s*$/i, '').trim();
    if (!safeValue(value)) continue;
    if (renames?.size && (prop === 'animation' || prop === 'animation-name')) {
      value = value.replace(/(^|[\s,])(-?[a-zA-Z_][\w-]*)(?=$|[\s,])/g, (m, pre: string, name: string) => (renames.has(name) ? pre + renames.get(name) : m));
    }
    out.push(`${prop}: ${value}${important ? ' !important' : ''};`);
  }
  return out.join(' ');
}

/** A style attribute's safe declarations. */
export function cleanStyle(style: string): string {
  return cleanDeclarations(stripComments(style));
}

/** How CSS is kept to where it belongs: one widget, or the HUD (a game's theme). */
export type CssScope = { widget: string } | { theme: true };

/** Where a game's HUD theme reaches: the platform's HUD, the game's widgets, menus and result screens. */
const THEME_PARTS = ['.hud', '.gamehud', '.menu-screen', '.result-screen', '.widget-screen'].flatMap((p) => [p, `${p} *`]).join(', ');

/** The class on a widget's own element (`:scope` in its CSS). */
export const widgetClass = (name: string) => `gw-${name}`;

export const WIDGET_NAME = /^[a-zA-Z][\w-]{0,39}$/;

/**
 * One selector made to match only inside the scope: `sel` becomes `:is(sel)` required to be the
 * widget or in it (for a theme: in the HUD, and one class stronger, so a theme's rule beats the
 * platform's own written the same way). A pseudo-element stays outside. Null: it's malformed.
 */
function scopeSelector(sel: string, scope: CssScope): string | null {
  let s = sel.trim();
  if (!s || s.length > 600 || /[{};<@&]/.test(s) || !walk(s)) return null;
  if ('widget' in scope) s = s.replace(/:scope(?![\w-])/gi, `.${widgetClass(scope.widget)}`);
  // A pseudo-element (`::before`, or the old `:after`) goes after the scope test.
  let cut = -1;
  walk(s, (i, depth) => {
    if (depth !== 0 || s[i] !== ':') return;
    if (s[i + 1] === ':' || (s[i - 1] !== ':' && /^:(before|after|first-line|first-letter)(?![\w-])/i.test(s.slice(i)))) {
      cut = i;
      return false;
    }
  });
  let base = cut < 0 ? s : s.slice(0, cut).trim();
  const pseudo = cut < 0 ? '' : s.slice(cut);
  if (pseudo && !/^::?[\w-]+(\([^)]*\))?(:[\w-]+(\([^)]*\))?)*$/.test(pseudo)) return null;
  if (!base) base = '*';
  if ('widget' in scope) {
    const c = `.${widgetClass(scope.widget)}`;
    return `:is(${base}):where(${c}, ${c} *)${pseudo}`;
  }
  return `.hud-themed :is(${base}):where(${THEME_PARTS})${pseudo}`;
}

interface CssRule {
  /** An at-rule's name (lower case), or '' for a style rule. */
  at: string;
  prelude: string;
  /** The block's content, or null (`@import …;`). */
  block: string | null;
}

/** Top-level rules of a stylesheet (comments already out). */
function readRules(css: string): CssRule[] {
  const rules: CssRule[] = [];
  let i = 0;
  while (i < css.length) {
    while (i < css.length && /[\s;}]/.test(css[i])) i++;
    if (i >= css.length) break;
    const at = css[i] === '@' ? (/^@([\w-]+)/.exec(css.slice(i))?.[1] ?? '').toLowerCase() : '';
    if (css[i] === '@') i += at.length + 1;
    // The prelude runs to a `{` or `;` outside brackets and strings.
    let j = i;
    let depth = 0;
    let stop = -1;
    for (; j < css.length; j++) {
      const c = css[j];
      if (c === '\\') {
        j++;
        continue;
      }
      if (c === '"' || c === "'") {
        const end = closeString(css, j);
        if (end < 0) {
          j = css.length;
          break;
        }
        j = end;
        continue;
      }
      if (c === '(' || c === '[') depth++;
      else if ((c === ')' || c === ']') && depth > 0) depth--;
      else if (depth === 0 && (c === '{' || c === ';')) {
        stop = j;
        break;
      }
    }
    if (stop < 0) break;
    const prelude = css.slice(i, stop).trim();
    if (css[stop] === ';') {
      rules.push({ at, prelude, block: null });
      i = stop + 1;
      continue;
    }
    const end = blockEnd(css, stop);
    rules.push({ at, prelude, block: css.slice(stop + 1, end) });
    i = end + 1;
  }
  return rules;
}

/** The `}` that closes the block opened at `open` (or the end). */
function blockEnd(css: string, open: number): number {
  let depth = 0;
  for (let j = open; j < css.length; j++) {
    const c = css[j];
    if (c === '\\') {
      j++;
      continue;
    }
    if (c === '"' || c === "'") {
      const end = closeString(css, j);
      if (end < 0) return css.length;
      j = end;
      continue;
    }
    if (c === '{') depth++;
    else if (c === '}' && --depth === 0) return j;
  }
  return css.length;
}

export const MAX_CSS = 64 * 1024;

/**
 * A game's CSS made safe and kept to its place: every selector can only match inside the widget
 * (or, for a theme, the HUD), and only style rules, `@media`, `@supports`, `@container` and
 * `@keyframes` stay (renamed to the widget's own, so they can't replace the platform's).
 * `@import`, `@font-face` and the like go, as do values that load from elsewhere or run code.
 */
export function scopeCss(css: string, scope: CssScope): string {
  const text = stripComments(css.length > MAX_CSS ? css.slice(0, MAX_CSS) : css);
  const prefix = 'widget' in scope ? `${widgetClass(scope.widget)}-` : 'hud-theme-';
  // Keyframes it defines, renamed wherever it uses them.
  const renames = new Map<string, string>();
  const collect = (rules: CssRule[], depth: number) => {
    for (const r of rules) {
      if ((r.at === 'keyframes' || r.at === '-webkit-keyframes') && /^-?[a-zA-Z_][\w-]*$/.test(r.prelude)) renames.set(r.prelude, prefix + r.prelude);
      else if (r.block && depth < 4 && (r.at === 'media' || r.at === 'supports' || r.at === 'container')) collect(readRules(r.block), depth + 1);
    }
  };
  const top = readRules(text);
  collect(top, 0);
  const emit = (rules: CssRule[], depth: number): string[] => {
    const out: string[] = [];
    for (const r of rules) {
      if (r.block === null) continue;
      if (r.at === '') {
        // Nested rules (CSS nesting) aren't kept: only a flat block of declarations.
        if (r.block.includes('{')) continue;
        const sels = splitTop(r.prelude, ',').map((s) => scopeSelector(s, scope)).filter((s): s is string => s !== null);
        const body = cleanDeclarations(r.block, renames);
        if (sels.length && body) out.push(`${sels.join(', ')} { ${body} }`);
      } else if (r.at === 'media' || r.at === 'supports' || r.at === 'container') {
        if (depth >= 4 || !/^[\w\s():,.<>=/%-]*$/.test(r.prelude)) continue;
        const inner = emit(readRules(r.block), depth + 1);
        if (inner.length) out.push(`@${r.at} ${r.prelude} {\n${inner.join('\n')}\n}`);
      } else if ((r.at === 'keyframes' || r.at === '-webkit-keyframes') && renames.has(r.prelude)) {
        const frames: string[] = [];
        for (const k of readRules(r.block)) {
          if (k.at || k.block === null || !/^(from|to|\d+(\.\d+)?%)(\s*,\s*(from|to|\d+(\.\d+)?%))*$/i.test(k.prelude)) continue;
          frames.push(`${k.prelude} { ${cleanDeclarations(k.block)} }`);
        }
        out.push(`@keyframes ${renames.get(r.prelude)} {\n${frames.join('\n')}\n}`);
      }
    }
    return out;
  };
  return emit(top, 0).join('\n');
}

// -------------------------------------------------------------------------------------------------
// Widget data
// -------------------------------------------------------------------------------------------------

/** A widget's data as it crosses and is kept: text, numbers, flags, lists and records of them. */
export type PlainValue = string | number | boolean | null | PlainValue[] | { [key: string]: PlainValue };
export type PlainData = { [key: string]: PlainValue };

export const WIDGET_ANCHORS: readonly WidgetAnchor[] = ['top-left', 'top', 'top-right', 'left', 'center', 'right', 'bottom-left', 'bottom', 'bottom-right'];

/** A widget as it's sent to screens: the data of its definition (its actions stay with the game). */
export interface WidgetWire {
  html: string;
  css?: string;
  at?: WidgetAnchor;
  modal?: boolean;
}

/** Data a game passed (anything), as plain data: a record, or empty. */
export const plainRecord = (v: unknown): PlainData => {
  const p = plainData(v);
  return isRecord(p) ? p : {};
};

/**
 * A copy with only what can cross to a screen: strings, finite numbers, booleans, null, lists
 * and plain records (functions and `undefined` left out, other numbers null), not too deep.
 */
export function plainData(v: unknown, depth = 0): PlainValue | undefined {
  if (v === null) return null;
  switch (typeof v) {
    case 'string':
      return v;
    case 'number':
      return Number.isFinite(v) ? v : null;
    case 'boolean':
      return v;
    case 'object': {
      if (depth > 8) return undefined;
      if (Array.isArray(v)) return v.map((x) => plainData(x, depth + 1) ?? null);
      const out: { [k: string]: PlainValue } = {};
      for (const [k, x] of Object.entries(v as object)) {
        if (k === '__proto__') continue;
        const c = plainData(x, depth + 1);
        if (c !== undefined) out[k] = c;
      }
      return out;
    }
    default:
      return undefined;
  }
}

function same(a: PlainValue | undefined, b: PlainValue | undefined): boolean {
  if (a === b) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
    return a.every((x, i) => same(x, b[i]));
  }
  const ka = Object.keys(a);
  if (ka.length !== Object.keys(b).length) return false;
  return ka.every((k) => own(b, k) && same(a[k], b[k]));
}

/**
 * What `next` changes in `cur`: its fields that differ (records compared field by field, so only
 * the changed ones go; lists and everything else whole), or null if nothing does.
 */
export function diffData(cur: PlainData, next: PlainData): PlainData | null {
  let out: PlainData | null = null;
  for (const [k, v] of Object.entries(next)) {
    const was = own(cur, k) ? cur[k] : undefined;
    if (same(was, v)) continue;
    if (isRecord(was) && isRecord(v)) {
      const d = diffData(was, v);
      if (d) (out ??= {})[k] = d;
    } else (out ??= {})[k] = v;
  }
  return out;
}

/** Apply a change to data, in place: records merge field by field; anything else is replaced. */
export function mergeData(into: PlainData, patch: PlainData): PlainData {
  for (const [k, v] of Object.entries(patch)) {
    if (k === '__proto__') continue;
    const was = own(into, k) ? into[k] : undefined;
    if (isRecord(was) && isRecord(v)) mergeData(was, v);
    else into[k] = isRecord(v) ? mergeData({}, v) : Array.isArray(v) ? (plainData(v) as PlainValue[]) : v;
  }
  return into;
}
