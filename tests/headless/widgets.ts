import { readFileSync } from 'node:fs';
import type { GameDefinition, Player } from '../../src/platform/api/types';
import { Presenter } from '../../src/platform/client/present';
import { GameHost } from '../../src/platform/host/game';
import { decode, encode } from '../../src/platform/net/codec';
import type { HostBatch, PresentCall } from '../../src/platform/net/protocol';
import { sanitizeCommand } from '../../src/platform/net/validate';
import { cleanStyle, diffData, mergeData, parseMarkup, safeUrl, scopeCss, type MarkupNode, type PlainData } from '../../src/platform/ui/markup';
import { compileWidget, WidgetView } from '../../src/platform/ui/widgets';
import { check } from './_harness';

const wasm = readFileSync('engine/pkg/voxel_engine_bg.wasm');

/**
 * HUD widgets of a game's own: definitions and data reach the right screens, only changes go
 * out, players who join late see what's up, buttons call back as the player who pressed them;
 * and the markup and CSS a game (or a server) sends can't run code or reach past the widget.
 */
export default function widgets() {
  hosting();
  menus();
  joining();
  copies();
  markup();
  css();
  building();
  bound();
}

// -------------------------------------------------------------------------------------------------
// The host: who gets what
// -------------------------------------------------------------------------------------------------

function hosting() {
  const pressed: string[] = [];
  const closed: string[] = [];
  const def: GameDefinition = {
    id: 'widgets-test',
    title: 'Widgets',
    world: { terrain: 'flat', flatHeight: 8, seed: 5 },
    setup(game) {
      game.hud.define('score', {
        at: 'top',
        html: `<div class="score">{{red}} : {{blue}} <span data-if="overtime">OT</span><ol><li data-each="top">{{name}} {{kills}}</li></ol></div>`,
        css: `.score { font-weight: bold }`,
      });
      game.hud.define('shop', {
        modal: true,
        html: `<div><button data-action="buy" data-value="{{item}}">Buy {{item}}</button><button data-action="nothing">x</button></div>`,
        actions: { buy: (p: Player, v: string) => pressed.push(`${p.name}:${v}`) },
        onClose: (p: Player) => closed.push(p.name),
      });
    },
  };
  const host = new GameHost(def, { engine: wasm, seed: 5, remote: true, radius: 2, budget: Infinity, player: { id: 'p1', name: 'Ann' } });
  const ann = host.connect('Ann');
  const bob = host.connect('Bob');
  // Definitions are content: in the catch-up, and nothing a game defines twice goes twice.
  const defs = (b: HostBatch) => b.events.filter((e) => e.t === 'content' && e.def.kind === 'widget');
  check(defs(ann.batch).length === 2 && defs(bob.batch).length === 2, `both players get both definitions: ${defs(ann.batch).length}, ${defs(bob.batch).length}`);
  host.command(ann.id, { t: 'start' });
  host.command(bob.id, { t: 'start' });
  let last = new Map<string, HostBatch>();
  const step = () => (last = host.step(1 / 30));
  const calls = (id: string, method?: string) => last.get(id)!.events.flatMap((e) => (e.t === 'call' && e.call.target === 'hud' && e.call.method.startsWith('widget') && (!method || e.call.method === method) ? [e.call] : []));
  step();
  const g = host.sim.ctx;
  const pb = host.sim.players[1].api;

  g.hud.define('score', { at: 'top', html: `<div class="score">{{red}} : {{blue}} <span data-if="overtime">OT</span><ol><li data-each="top">{{name}} {{kills}}</li></ol></div>`, css: `.score { font-weight: bold }` });
  step();
  check(defs(last.get(ann.id)!).length === 0, 'the same definition again sends nothing');

  // Everyone's: up for both, then only what changed, as a patch.
  const score = g.hud.widget('score', { red: 0, blue: 0, overtime: false, top: [{ name: 'Ann', kills: 0 }] });
  step();
  const up = calls(ann.id, 'widget');
  check(up.length === 1 && calls(bob.id, 'widget').length === 1, 'the widget went up on both screens');
  check(JSON.stringify(up[0].args) === JSON.stringify(['score', { red: 0, blue: 0, overtime: false, top: [{ name: 'Ann', kills: 0 }] }]), `with its data: ${JSON.stringify(up[0].args)}`);
  for (let i = 0; i < 5; i++) {
    g.hud.widget('score', { red: 0, blue: 0, overtime: false, top: [{ name: 'Ann', kills: 0 }] });
    step();
    check(calls(ann.id).length === 0, 'setting what it shows already sends nothing (every tick is fine)');
  }
  score.set({ red: 1 });
  step();
  const patch = calls(bob.id, 'widgetSet');
  check(patch.length === 1 && JSON.stringify(patch[0].args) === '["score",{"red":1}]', `only the change goes: ${JSON.stringify(patch[0]?.args)}`);
  check(score.shown && (score.data as { red: number }).red === 1, 'the handle knows what it shows');

  // One player's: only theirs.
  const mine = pb.hud.widget('shop', { item: 'sword' });
  step();
  check(calls(bob.id, 'widget').length === 1 && calls(ann.id).length === 0, "Bob's shop went to Bob only");
  mine.set({ item: 'bow' });
  step();
  check(JSON.stringify(calls(bob.id, 'widgetSet')[0]?.args) === '["shop",{"item":"bow"}]' && calls(ann.id).length === 0, "Bob's change went to Bob only");

  // Records change field by field; lists go whole.
  score.set({ top: [{ name: 'Ann', kills: 1 }], extra: { a: 1, b: 2 } });
  step();
  score.set({ extra: { a: 1, b: 3 } });
  step();
  check(JSON.stringify(calls(ann.id, 'widgetSet')[0]?.args) === '["score",{"extra":{"b":3}}]', `a record's changed field only: ${JSON.stringify(calls(ann.id, 'widgetSet')[0]?.args)}`);

  // A player who joins late sees what's up now, not the history, and not someone else's.
  const cat = host.connect('Cat');
  const caught = cat.batch.events.flatMap((e) => (e.t === 'call' && e.call.method.startsWith('widget') ? [e.call] : []));
  check(caught.length === 1 && caught[0].method === 'widget', `the late joiner gets one full call: ${caught.map((c) => c.method)}`);
  const seen = caught[0].args[1] as { red: number; top: { kills: number }[]; extra: { b: number } };
  check(seen.red === 1 && seen.top[0].kills === 1 && seen.extra.b === 3, `with the current data: ${JSON.stringify(seen)}`);
  check(!cat.batch.events.some((e) => e.t === 'call' && e.call.args[0] === 'shop'), "not Bob's shop");
  // …and a player's own change to everyone's widget stays theirs, in a catch-up too.
  const bobScore = pb.hud.widget('score');
  bobScore.set({ blue: 7 });
  step();
  check(calls(bob.id, 'widgetSet').length === 1 && calls(ann.id).length === 0, "Bob's own blue went to Bob only");
  check((bobScore.data as { red: number; blue: number }).red === 1 && (score.data as { blue: number }).blue === 0, 'his copy started from everyone’s');
  host.disconnect(bob.id);
  const bob2 = host.connect('Bob');
  check(!bob2.batch.events.some((e) => e.t === 'call' && e.call.method === 'widget' && (e.call.args[1] as { blue: number }).blue === 7), 'a new Bob starts from everyone’s');
  host.command(bob2.id, { t: 'start' });
  step();
  const pb2 = host.sim.players.find((p) => p.id === bob2.player)!.api;

  // Buttons: as the player who pressed them, only on a widget on their screen, only its actions.
  const shop = pb2.hud.widget('shop', { item: 'axe' });
  step();
  const press = (id: string, action: string, value: string, widget = 'shop') => host.command(id, { t: 'message', msg: { t: 'widgetAction', player: 'someone-else', widget, action, value } });
  press(bob2.id, 'buy', 'axe');
  press(ann.id, 'buy', 'free-stuff');
  press(bob2.id, 'launch', 'x');
  press(bob2.id, 'buy', 'x', 'score');
  check(pressed.join() === 'Bob:axe', `only Bob's own press counted, as Bob: ${pressed.join()}`);
  // A modal closed by the player: down (for later catch-ups too), and the game hears.
  host.command(bob2.id, { t: 'message', msg: { t: 'widgetClosed', player: '', widget: 'shop' } });
  step();
  check(closed.join() === 'Bob' && !shop.shown, `the game heard Bob closed it, and it's down: ${closed}`);
  press(bob2.id, 'buy', 'axe');
  check(pressed.length === 1, 'no buying from a closed shop');

  // A restart takes widgets down (they stay defined); setting one puts it back.
  host.command(ann.id, { t: 'restart' });
  step();
  check(!score.shown, 'down after a restart');
  const dan = host.connect('Dan');
  check(!dan.batch.events.some((e) => e.t === 'call' && e.call.method === 'widget'), 'nothing to catch up on after a restart');
  check(defs(dan.batch).length === 2, 'the definitions are still there');
  score.set({ red: 2 });
  step();
  check(calls(ann.id, 'widget').length === 1, 'set after a restart puts it up again, whole');

  // The first player's place, left and taken again by someone who watched first: their screen is
  // new, so the widget comes whole, not as a change to what the last one there had.
  host.sim.local.api.hud.widget('shop', { item: 'sword' });
  step();
  host.disconnect(ann.id);
  const eve = host.connect();
  host.command(eve.id, { t: 'start', name: 'Eve' });
  check(host.sim.local.name === 'Eve', `Eve took the first place: ${host.sim.local.name}`);
  host.sim.local.api.hud.widget('shop', { item: 'sword' });
  step();
  check(calls(eve.id, 'widget').length === 1 && calls(eve.id, 'widgetSet').length === 0, `Eve gets the shop whole: ${calls(eve.id).map((c) => c.method)}`);

  // Everything crosses a socket as it is.
  for (const b of last.values()) decode<HostBatch>(encode(b));
  const call: PresentCall = { to: null, target: 'hud', method: 'widgetSet', args: ['score', { a: [1, 'x', null], b: { c: true } }] };
  check(JSON.stringify(decode(encode(call))) === JSON.stringify(call), 'a patch crosses the wire unchanged');

  // What a server takes from a socket.
  const ok = sanitizeCommand({ t: 'message', msg: { t: 'widgetAction', player: 'p9', widget: 'shop', action: 'buy', value: 'x'.repeat(500) } });
  check(ok?.t === 'message' && ok.msg.t === 'widgetAction' && ok.msg.player === '' && ok.msg.value.length === 200, 'an action: the player comes from the socket, the value is cut short');
  check(sanitizeCommand({ t: 'message', msg: { t: 'widgetAction', widget: 'shop<script>', action: 'buy', value: '' } }) === null, 'a malformed widget name is dropped');
  check(sanitizeCommand({ t: 'message', msg: { t: 'widgetAction', widget: 'shop', action: 'buy', value: { evil: 1 } } }) === null, 'a value that isn’t text is dropped');
  console.log(`  hosting: definitions once, patches only (${JSON.stringify(patch[0].args[1])}), late joiners caught up, buttons as their presser`);
}

// -------------------------------------------------------------------------------------------------
// A player's screen: what reaches it, in order
// -------------------------------------------------------------------------------------------------

/**
 * A server's client as far as presentation goes: the real `Presenter` over a stand-in HUD that
 * notes each call it makes, fed a batch's events in order the way the runtime is (`joined` tells it
 * who it is; a call for anyone else is dropped).
 */
function screenOf() {
  const shown: string[] = [];
  const hud = new Proxy({} as Record<string | symbol, unknown>, {
    get: (t, k) => (k in t ? t[k] : (...args: unknown[]) => void shown.push(`${String(k)}:${typeof args[0] === 'string' ? args[0] : ''}`)),
    set: (t, k, v) => ((t[k] = v), true),
  });
  const presenter = new Presenter(null, { hud: hud as never, fx: {} as never, sfx: {} as never, view: {} as never, send: () => {}, message: () => {} });
  return {
    shown,
    take(b: HostBatch) {
      for (const e of decode<HostBatch>(encode(b)).events) {
        if (e.t === 'joined') presenter.player = e.player;
        else if (e.t === 'call') presenter.apply(e.call);
      }
    },
    count: (what: string) => shown.filter((s) => s === what).length,
  };
}

/**
 * A modal widget, another widget and a toast put up as a player joins (`playerJoin`) on a server,
 * where their browser watched first and joins when they press Play: all of it reaches their screen
 * (the bug: it came before the screen knew who it was, so it was dropped, and the host thought it
 * was up, so the same again sent nothing). The modal goes again as they enter play; the game hears
 * `playerReady` after `playerJoin` (and after `start`, for the first); the same widget again sends
 * nothing, and after they close it, it goes whole.
 */
function joining() {
  const heard: string[] = [];
  const def: GameDefinition = {
    id: 'joining-test',
    title: 'Joining',
    world: { terrain: 'flat', flatHeight: 8, seed: 5 },
    setup(game) {
      game.hud.define('picker', { modal: true, html: `<div>{{title}} <button data-action="pick" data-value="a">A</button></div>`, actions: { pick: () => {} } });
      game.hud.define('badge', { html: `<b>{{name}}</b>` });
      game.events.on('playerJoin', ({ player }) => {
        heard.push(`join ${player.name}`);
        player.hud.widget('picker', { title: 'Choose' });
        player.hud.widget('badge', { name: player.name });
        player.hud.toast(`Welcome, ${player.name}`);
      });
      game.events.on('playerReady', ({ player }) => heard.push(`ready ${player.name}`));
    },
    start: () => void heard.push('start'),
  };
  const host = new GameHost(def, { engine: wasm, seed: 5, remote: true, radius: 2, budget: Infinity, player: { id: 'p1', name: 'Ann' } });
  const screens = new Map<string, ReturnType<typeof screenOf>>();
  const ids = new Map<string, string>();
  for (const name of ['Ann', 'Bob']) {
    // Watching first (the title screen), then Play: `start` with their name.
    const c = host.connect();
    const screen = screenOf();
    screens.set(name, screen);
    ids.set(name, c.id);
    screen.take(c.batch);
    host.command(c.id, { t: 'start', name });
    screen.take(host.step(1 / 30).get(c.id)!);
    check(screen.count('widget:picker') >= 1, `${name}'s modal, put up as they joined, reached their screen: ${screen.shown.join(' ')}`);
    check(screen.count('widget:badge') === 1 && screen.count('toast:Welcome, ' + name) === 1, `${name}'s badge and toast reached their screen too: ${screen.shown.join(' ')}`);
    check(!screen.shown.some((s) => s.includes('Welcome, ' + (name === 'Ann' ? 'Bob' : 'Ann'))), "nobody else's toast");
  }
  check(heard.join(', ') === 'join Ann, start, ready Ann, join Bob, ready Bob', `playerReady after playerJoin (and start): ${heard.join(', ')}`);
  const bob = host.sim.players.find((p) => p.name === 'Bob')!;
  const bobScreen = screens.get('Bob')!;
  const bobId = ids.get('Bob')!;
  const before = bobScreen.shown.length;
  bob.api.hud.widget('picker', { title: 'Choose' });
  bobScreen.take(host.step(1 / 30).get(bobId)!);
  check(bobScreen.shown.length === before, `the same widget again sends nothing: ${bobScreen.shown.slice(before).join(' ')}`);
  host.command(bobId, { t: 'message', msg: { t: 'widgetClosed', player: '', widget: 'picker' } });
  bob.api.hud.widget('picker', { title: 'Choose' });
  bobScreen.take(host.step(1 / 30).get(bobId)!);
  check(bobScreen.shown.slice(before).join(' ') === 'widgetRemove:picker widget:picker', `closed, then put up again: whole: ${bobScreen.shown.slice(before).join(' ')}`);

  // Single-player: the one player is there from the start; Play is `start`, and they're ready then.
  const solo: string[] = [];
  const one = new GameHost({ ...def, setup: (game) => game.events.on('playerReady', ({ player }) => solo.push(player.name)), start: () => void solo.push('start') }, { engine: wasm, seed: 5, radius: 2, budget: Infinity });
  one.handle({ t: 'start' });
  check(solo.join() === 'start,Player', `single-player: ready once play starts: ${solo}`);
  console.log(`  joining: a modal, a widget and a toast from playerJoin reach the joining screen; heard ${heard.join(', ')}`);
}

/**
 * Everyone's widget and a player's own: everyone's changes reach a player's own copy, and a player
 * who took everyone's down gets it back (whole) the next time the game puts it up for everyone
 * (the bug: once they had a copy of their own, `game.hud.widget` never reached them again).
 */
function copies() {
  const def: GameDefinition = {
    id: 'copies-test',
    title: 'Copies',
    world: { terrain: 'flat', flatHeight: 8, seed: 5 },
    setup: (game) => game.hud.define('card', { html: `<b>{{title}}</b> <i>{{mine}}</i>` }),
  };
  const host = new GameHost(def, { engine: wasm, seed: 5, remote: true, radius: 2, budget: Infinity, player: { id: 'p1', name: 'Ann' } });
  const conns = ['Ann', 'Bob'].map((name) => {
    const c = host.connect();
    const screen = screenOf();
    screen.take(c.batch);
    host.command(c.id, { t: 'start', name });
    return { id: c.id, screen };
  });
  const step = () => {
    const out = host.step(1 / 30);
    for (const c of conns) c.screen.take(out.get(c.id)!);
    return out;
  };
  step();
  const g = host.sim.ctx;
  const bob = host.sim.players.find((p) => p.name === 'Bob')!.api;
  const [annScreen, bobScreen] = conns.map((c) => c.screen);
  const since = (s: ReturnType<typeof screenOf>, n: number) => s.shown.slice(n).join(' ');
  const mark = () => [annScreen.shown.length, bobScreen.shown.length];

  g.hud.widget('card', { title: 'Round 1' });
  step();
  bob.hud.widget('card', { mine: 'Bob' });
  step();
  let [a, b] = mark();
  g.hud.widget('card', { title: 'Round 2' });
  step();
  const bobs = bob.hud.widget('card');
  check(since(bobScreen, b) === 'widgetSet:card' && (bobs.data as { title: string; mine: string }).title === 'Round 2' && (bobs.data as { mine: string }).mine === 'Bob', `everyone's change reached Bob's own copy (his own field kept): ${since(bobScreen, b)} ${JSON.stringify(bobs.data)}`);

  // Bob takes it down on his screen; everyone's next call puts it back there, as everyone has it.
  bobs.remove();
  step();
  [a, b] = mark();
  g.hud.widget('card', { title: 'Round 3' });
  const out = step();
  const back = out.get(conns[1].id)!.events.find((e) => e.t === 'call' && e.call.method === 'widget');
  // (Everyone's patch goes to his screen too, which has nothing up to patch; then his whole one.)
  check(since(bobScreen, b).endsWith('widget:card') && back?.t === 'call' && (back.call.args[1] as { title: string }).title === 'Round 3', `everyone's widget came back up on Bob's screen, whole: ${since(bobScreen, b)}`);
  check(since(annScreen, a) === 'widgetSet:card', `Ann (who never took it down) just got the change: ${since(annScreen, a)}`);
  check(bobs.shown && (bobs.data as { title: string }).title === 'Round 3', "Bob's handle says it's up again");

  // His own call after taking it down starts from everyone's.
  bobs.remove();
  bob.hud.widget('card', { mine: 'again' });
  const again = step().get(conns[1].id)!.events.filter((e) => e.t === 'call' && e.call.method === 'widget');
  const data = again[0]?.t === 'call' ? (again[0].call.args[1] as { title: string; mine: string }) : null;
  check(data?.title === 'Round 3' && data.mine === 'again', `his own copy starts from everyone's: ${JSON.stringify(data)}`);

  // Everyone's taken down: off every screen, his own copy too.
  [a, b] = mark();
  g.hud.widget('card').remove();
  step();
  check(since(annScreen, a) === 'widgetRemove:card' && since(bobScreen, b) === 'widgetRemove:card' && !bobs.shown, `everyone's remove takes it off every screen: ${since(annScreen, a)} / ${since(bobScreen, b)}`);
  console.log("  copies: everyone's changes reach own copies, and everyone's widget comes back where a player took it down");
}

// -------------------------------------------------------------------------------------------------
// Markup
// -------------------------------------------------------------------------------------------------

const html = (nodes: MarkupNode[]): string =>
  nodes.map((n) => (typeof n === 'string' ? n : `<${n.tag}${Object.entries(n.attrs).map(([k, v]) => ` ${k}="${v}"`).join('')}>${html(n.children)}</${n.tag}>`)).join('');

function markup() {
  const nasty = [
    '<div class="a" onclick="alert(1)" onmouseover=alert(2) id="ui" name="x">hi</div>',
    '<script>alert(1)</script><SCRIPT src=x></SCRIPT >',
    '<img src="javascript:alert(1)"><img src="https://evil.example/t.png"><img src="//evil.example/t.png"><img src="art/ok.png"><img src="data:image/png;base64,AAAA">',
    '<a href="javascript:alert(1)">link</a>',
    '<iframe src="x"></iframe><object data="x"></object><embed src="x"><svg><script>alert(1)</script><a xlink:href="javascript:1">s</a></svg>',
    '<style>body { display: none }</style><link rel="stylesheet" href="x">',
    '<form action="x"><input name="password"><button formaction="javascript:1">go</button></form>',
    '<div style="background: url(https://evil.example/x.png); color: red; width: expression(alert(1))">s</div>',
    '<button data-action="buy()" data-value="{{x}}">b</button><button data-action="buy">c</button>',
    '<!-- <script>alert(1)</script> --><div contenteditable autofocus tabindex="1" popover>d</div>',
    '<noscript><img src=x onerror=alert(1)></noscript><template><img src=x onerror=alert(1)></template>',
    '<textarea><img src=x onerror=alert(1)></textarea><title><script>alert(1)</script></title>',
  ].join('');
  const parsed = parseMarkup(nasty);
  const out = html(parsed.nodes);
  for (const bad of ['script', 'onclick', 'onmouseover', 'onerror', 'javascript', 'evil.example', 'iframe', 'object', 'embed', 'svg', 'xlink', '<style', '<link', '<input', 'formaction', 'expression', 'contenteditable', 'autofocus', 'tabindex', 'popover', 'id="ui"', 'name=', 'href', 'alert']) {
    check(!out.toLowerCase().includes(bad), `"${bad}" is left out of: ${out}`);
  }
  for (const good of ['class="a"', '>hi<', 'src="art/ok.png"', 'src="data:image/png;base64,AAAA"', '>link<', 'color: red;', 'data-action="buy"', '>go<']) {
    check(out.includes(good), `"${good}" stays: ${out}`);
  }
  check(parsed.actions.join() === 'buy', `a malformed action name is dropped: ${parsed.actions}`);
  check(parsed.dropped.includes('<script>') && parsed.dropped.includes('event attributes (on…)'), `what went is named: ${parsed.dropped.join(', ')}`);
  // Entities come out as text, never markup.
  const text = parseMarkup('&lt;img src=x onerror=alert(1)&gt; &amp; &#x3C;b&#62;').nodes[0];
  check(text === '<img src=x onerror=alert(1)> & <b>', `entities are text: ${JSON.stringify(text)}`);
  check(JSON.stringify(diffData({ a: 1, r: { x: 1, y: 2 }, l: [1] }, { a: 1, r: { x: 1, y: 3 }, l: [1], n: null })) === '{"r":{"y":3},"n":null}', 'a diff: changed fields only, records field by field');
  check(diffData({ l: [1, 2] }, { l: [1, 2] }) === null, 'no change, no diff');
  check(safeUrl('/art/x.png') && safeUrl('#glow') && !safeUrl('JaVaScRiPt:alert(1)') && !safeUrl(' javascript:x') && !safeUrl('http://x/y') && !safeUrl('\\\\evil/x') && !safeUrl('data:text/html,<script>'), 'addresses: this site and pictures only');
  check(cleanStyle('color: red; background: url(http://evil/x); --w: 50%; behavior: url(x.htc); -moz-binding: url(x)') === 'color: red; --w: 50%;', `a style's bad declarations go: ${cleanStyle('color: red; background: url(http://evil/x); --w: 50%')}`);
  console.log(`  markup: ${parsed.dropped.length} kinds of thing left out`);
}

// -------------------------------------------------------------------------------------------------
// CSS: kept to its widget (or, for a theme, the HUD)
// -------------------------------------------------------------------------------------------------

function css() {
  const sheet = `
    @import url(https://evil.example/x.css);
    @font-face { font-family: Inter; src: url(https://evil.example/f.woff) }
    @property --x { syntax: '<length>'; inherits: false; initial-value: 0px }
    body, #ui, .menu-card, :root { display: none }
    .row:hover > b::before { content: '★'; color: var(--c, gold) }
    :scope { position: absolute; animation: pulse 1s infinite }
    :scope ~ .stat, .stat:not(:scope) { display: none }
    .x { background: url("https://evil.example/p.png") } .y { background: url(data:image/png;base64,AAAA) }
    .z { width: expression(alert(1)); color: u\\72l(x) } .w { color: \\72 ed }
    @media (max-width: 600px) { .row { font-size: 10px } }
    @keyframes pulse { from { opacity: 1 } 50% { opacity: .4 } }
    .nest { color: red; .inner { color: blue } }
    .a), body, :is(.b { color: red } .after { color: red }
  `;
  const out = scopeCss(sheet, { widget: 'kills' });
  // (A bracket left open swallows the rest of the sheet, as it does in a browser.)
  for (const bad of ['@import', '@font-face', '@property', 'evil.example', 'expression', 'u\\72l', '\\72', 'blue', ':is(.b', '.after']) check(!out.includes(bad), `"${bad}" is left out of:\n${out}`);
  // Every selector left matches only the widget or inside it.
  const rules = out.split('\n').filter((l) => l.includes('{') && !l.startsWith('@') && !/^(from|to|\d)/.test(l));
  for (const r of rules) {
    for (const sel of r.slice(0, r.indexOf('{')).split(/,(?![^(]*\))/)) {
      check(/:where\(\.gw-kills, \.gw-kills \*\)(::?[\w-]+)?\s*$/.test(sel.trim()), `a selector kept to the widget: ${sel}`);
    }
  }
  check(out.includes(':is(.gw-kills):where(') && out.includes('animation: gw-kills-pulse 1s infinite') && out.includes('@keyframes gw-kills-pulse'), `:scope is the widget, its keyframes are its own:\n${out}`);
  check(out.includes('::before') && out.includes("content: '★'") && out.includes('url(data:image/png;base64,AAAA)') && out.includes('@media (max-width: 600px)'), `the rest stays:\n${out}`);
  // A theme: the HUD's parts only, one class stronger.
  const theme = scopeCss('.stat { color: red } .result-screen, .hotbar .slot::after { color: blue }', { theme: true });
  check(theme.startsWith('.hud-themed :is(.stat):where(.hud, .hud *, .gamehud, .gamehud *') && theme.includes('.hud-themed :is(.hotbar .slot):where(') && theme.includes(')::after'), `a theme's rules are kept to the HUD:\n${theme}`);
  console.log(`  css: ${rules.length} rules kept, each inside the widget`);
}

// -------------------------------------------------------------------------------------------------
// A screen building a widget (on a small stand-in for the page)
// -------------------------------------------------------------------------------------------------

class FakeNode {
  childNodes: FakeNode[] = [];
  parentNode: FakeNode | null = null;
  constructor(
    readonly nodeName: string,
    public data = '',
  ) {}
  appendChild(n: FakeNode) {
    if (n.nodeName === '#fragment') {
      for (const c of [...n.childNodes]) this.appendChild(c);
      return n;
    }
    n.parentNode?.removeChild(n);
    n.parentNode = this;
    this.childNodes.push(n);
    return n;
  }
  insertBefore(n: FakeNode, ref: FakeNode | null) {
    if (n.nodeName === '#fragment') {
      for (const c of [...n.childNodes]) this.insertBefore(c, ref);
      return n;
    }
    n.parentNode?.removeChild(n);
    n.parentNode = this;
    const i = ref ? this.childNodes.indexOf(ref) : -1;
    this.childNodes.splice(i < 0 ? this.childNodes.length : i, 0, n);
    return n;
  }
  removeChild(n: FakeNode) {
    this.childNodes.splice(this.childNodes.indexOf(n), 1);
    n.parentNode = null;
    return n;
  }
  get textContent(): string {
    return this.nodeName === '#text' ? this.data : this.childNodes.map((c) => c.textContent).join('');
  }
}

class FakeElement extends FakeNode {
  attrs = new Map<string, string>();
  className = '';
  listeners: Record<string, (e: { stopPropagation(): void }) => void> = {};
  get hidden() {
    return this.attrs.has('hidden');
  }
  set hidden(v: boolean) {
    if (v) this.attrs.set('hidden', '');
    else this.attrs.delete('hidden');
  }
  setAttribute(k: string, v: string) {
    this.attrs.set(k, v);
  }
  getAttribute(k: string) {
    return this.attrs.get(k) ?? null;
  }
  removeAttribute(k: string) {
    this.attrs.delete(k);
  }
  addEventListener(type: string, fn: (e: { stopPropagation(): void }) => void) {
    this.listeners[type] = fn;
  }
  click() {
    this.listeners.click?.({ stopPropagation() {} });
  }
  all(tag: string): FakeElement[] {
    return this.childNodes.flatMap((c) => (c instanceof FakeElement ? [...(c.nodeName === tag ? [c] : []), ...c.all(tag)] : []));
  }
}

function building() {
  const g = globalThis as unknown as { document?: unknown };
  const had = g.document;
  g.document = {
    createElement: (tag: string) => new FakeElement(tag),
    createTextNode: (t: string) => new FakeNode('#text', t),
    createComment: (t: string) => new FakeNode('#comment', t),
    createDocumentFragment: () => new FakeNode('#fragment'),
  };
  try {
    const def = compileWidget('board', {
      html: `<table><tr data-each="rows" class="row {{cls}}" data-if="name != ''"><td>{{$n}}</td><td>{{name}}</td><td style="--w: {{w}}">{{kills}}/{{limit}}</td></tr></table>
             <p data-if="!rows.length">Nobody yet</p><p data-if="leader == me">You lead</p>
             <button data-action="pick" data-value="{{choice}}" disabled="{{locked}}">Pick</button><img src="{{pic}}">`,
    })!;
    const acts: string[] = [];
    const data = { rows: [] as unknown[], limit: 25, leader: 'Ann', me: 'Bob', choice: 'rifle', locked: false, pic: 'art/a.png' };
    const view = new WidgetView(def, mergeData({}, data as never), (a, v) => acts.push(`${a}:${v}`));
    const root = view.root as unknown as FakeElement;
    const p = root.all('p');
    check(!p[0].hidden && p[1].hidden && root.all('tr').length === 0, 'no rows: "Nobody yet", and not "You lead"');
    const set = (patch: object) => {
      mergeData(view.data, patch as never);
      view.update();
    };
    set({ rows: [{ name: 'Ann', kills: 3, w: '30%', cls: 'gold' }, { name: '<img src=x onerror=alert(1)>', kills: 1, w: 'url(https://evil.example/x)' }], leader: 'Bob' });
    const rows = root.all('tr');
    check(rows.length === 2 && rows[0].textContent === '1Ann3/25' && rows[0].getAttribute('class') === 'row gold', `one row per item, numbered: ${rows.map((r) => r.textContent)}`);
    check(rows[1].all('td')[1].textContent === '<img src=x onerror=alert(1)>' && rows[1].all('td')[1].childNodes.every((c) => c.nodeName === '#text'), 'markup in data is only ever text');
    check(rows[0].all('td')[2].getAttribute('style') === '--w: 30%;' && rows[1].all('td')[2].getAttribute('style') === '', `a bound style is checked as it's filled: ${rows[1].all('td')[2].getAttribute('style')}`);
    check(p[0].hidden && !p[1].hidden, 'conditions follow the data');
    set({ rows: [{ name: 'Cat', kills: 9, w: '90%' }] });
    check(root.all('tr').length === 1 && root.all('tr')[0] === rows[0] && root.all('tr')[0].textContent === '1Cat9/25', 'a shorter list: the first row kept and refilled, the rest gone');
    const button = root.all('button')[0];
    check(button.getAttribute('disabled') === null, 'disabled="{{locked}}" is off while locked is false');
    button.click();
    set({ choice: 'smg', locked: true, pic: 'javascript:alert(1)' });
    button.click();
    check(acts.join() === 'pick:rifle,pick:smg', `a button's action, with its value as it is now: ${acts}`);
    check(button.getAttribute('disabled') === 'true' && root.all('img')[0].getAttribute('src') === '', 'on again; a bound address that turns bad is emptied');
    console.log(`  building: a ${rows.length}-row list, conditions, bindings and a button on a stand-in page`);
  } finally {
    g.document = had;
  }
}

/**
 * Widgets bound to the screen's own state (`$gun`, `$ability`, `$health`): the screen fills them
 * in itself, so a shot or a reload shows the frame it happens. They're read like data (text only,
 * styles checked as they're filled), in lists and conditions too, beside the game's own data; a
 * widget that binds none isn't refreshed for them.
 */
function bound() {
  const g = globalThis as unknown as { document?: unknown };
  const had = g.document;
  g.document = {
    createElement: (tag: string) => new FakeElement(tag),
    createTextNode: (t: string) => new FakeNode('#text', t),
    createComment: (t: string) => new FakeNode('#comment', t),
    createDocumentFragment: () => new FakeNode('#fragment'),
  };
  try {
    const def = compileWidget('ammo', {
      html: `<div data-if="$gun"><b>{{$gun.mag}}/{{$gun.size}}</b><span data-if="$gun.reloading">loading</span>
             <s data-each="rounds"><u data-if="$i < $gun.mag">|</u></s><em style="--n: {{$gun.name}}">{{$gun.name}}</em></div>
             <p>{{label}} {{$ability.dash.cool}} {{$health}}</p><i data-each="$gun.marks">{{.}}</i>`,
    })!;
    check(def.local, 'a widget binding $gun is refreshed with the screen');
    check(!compileWidget('plain', { html: `<b data-each="rows">{{$n}} {{name}}</b>` })!.local, 'one binding only its data (and $i / $n) is not');
    const local: PlainData = {};
    const view = new WidgetView(def, mergeData({}, { rounds: [1, 1, 1], label: 'dash' }), () => {}, local);
    const root = view.root as unknown as FakeElement;
    const div = root.all('div')[0];
    check(div.hidden && root.all('p')[0].textContent.trim() === 'dash', `no gun held: hidden; the game's data still shows: "${root.all('p')[0].textContent}"`);
    const set = (state: PlainData) => {
      for (const k of Object.keys(local)) delete local[k];
      Object.assign(local, state);
      view.update();
    };
    set({ $gun: { mag: 2, size: 3, reloading: false, name: '<img src=x onerror=alert(1)>', marks: ['a', 'b'] }, $ability: { dash: { cool: 0.5 } }, $health: 17 });
    const loaded = () => root.all('u').filter((u) => !u.hidden).length;
    check(!div.hidden && root.all('b')[0].textContent === '2/3' && root.all('span')[0].hidden && loaded() === 2, `a gun with 2 of 3: "${root.all('b')[0].textContent}", ${loaded()} rounds shown`);
    check(root.all('p')[0].textContent.trim() === 'dash 0.5 17' && root.all('i').map((i) => i.textContent).join() === 'a,b', `abilities, health and a list from the screen's state: "${root.all('p')[0].textContent}"`);
    const em = root.all('em')[0];
    check(em.textContent === '<img src=x onerror=alert(1)>' && em.childNodes.every((c) => c.nodeName === '#text'), "the screen's state is only ever text");
    set({ $gun: { mag: 0, size: 3, reloading: true, name: 'url(https://evil.example/x)' }, $health: 17 });
    check(!root.all('span')[0].hidden && loaded() === 0 && root.all('b')[0].textContent === '0/3', 'fired dry and reloading: shown at once');
    check(em.getAttribute('style') === '', `a style bound to it is checked as it's filled: "${em.getAttribute('style')}"`);
    set({});
    check(div.hidden, 'the gun put away: hidden again');
    console.log(`  bound: $gun, $ability and $health filled in by the screen, in text, lists, conditions and styles`);
  } finally {
    g.document = had;
  }
}

// -------------------------------------------------------------------------------------------------
// Menus and screens: only their own player presses their buttons
// -------------------------------------------------------------------------------------------------

function menus() {
  const picked: string[] = [];
  const closed: string[] = [];
  const def: GameDefinition = {
    id: 'menus-test',
    title: 'Menus',
    world: { terrain: 'flat', flatHeight: 8, seed: 5 },
    setup(game) {
      game.events.on('playerJoin', ({ player }) => {
        player.hud.menu({
          title: 'Pick',
          sections: [{ entries: [{ label: 'One', onSelect: () => picked.push(player.name) }] }],
          onClose: () => closed.push(player.name),
        });
      });
    },
  };
  const host = new GameHost(def, { engine: wasm, seed: 5, remote: true, radius: 2, budget: Infinity, player: { id: 'p1', name: 'Ann' } });
  const ann = host.connect('Ann');
  const bob = host.connect('Bob');
  host.command(ann.id, { t: 'start', name: 'Ann' });
  host.command(bob.id, { t: 'start', name: 'Bob' });
  let menu: { id: number; cb: number } | null = null;
  for (let i = 0; i < 5 && !menu; i++) {
    const batch = host.step(1 / 30).get(ann.id)!;
    for (const e of batch.events) {
      if (e.t !== 'call' || e.call.method !== 'menu') continue;
      const [id, o] = e.call.args as [number, { sections: { entries: { onSelect: { $cb: number } }[] }[] }];
      menu = { id, cb: o.sections[0].entries[0].onSelect.$cb };
    }
  }
  check(menu, "Ann's menu reached her screen");
  const send = (who: string, msg: object) => {
    host.command(who, { t: 'message', msg: msg as never });
    host.step(1 / 30);
  };
  // Bob can see Ann's menu's numbers (they're small integers); pressing or closing it does nothing.
  send(bob.id, { t: 'callback', player: bob.id, id: menu.cb });
  send(bob.id, { t: 'menuClosed', player: bob.id, menu: menu.id });
  check(picked.length === 0 && closed.length === 0, `another player can't press or close Ann's menu: picked ${picked}, closed ${closed}`);
  send(ann.id, { t: 'callback', player: ann.id, id: menu.cb });
  send(ann.id, { t: 'menuClosed', player: ann.id, menu: menu.id });
  check(picked.join() === 'Ann' && closed.join() === 'Ann', `Ann's own press and close work: picked ${picked}, closed ${closed}`);
}
