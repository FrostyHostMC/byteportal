import type { Vec3 } from '@platform';
import type { ThrowableItem } from '@platform/items';
import type { Client, ClientKit, Node } from '@platform/client';
import { thrownOn } from '../items/throwable';
import type { ClientThrown } from '../items/thrower';
import { Color, Vec3 as V3 } from '@platform/client/math';

/** Something thrown as it's drawn: its model (null until the item's model is here), spun about an axis. */
interface Drawn {
  node: Node | null;
  axis: V3;
  spin: number;
  angle: number;
  /** Ours: where the hand was as it left it (drawn from there onto its path over the first moment). */
  from: V3 | null;
  lastHit: number;
}

/** A fire burning: flames on the ground round it for its while. */
interface Fire {
  at: Vec3;
  radius: number;
  left: number;
  color: [number, number, number];
  /** Spots on the ground where flames rise (worked out once, from the blocks). */
  spots: Vec3[];
  crackle: number;
}

/** Where the hand throws from, in the camera's own space. */
const HAND = { x: 0.28, y: -0.12, z: -0.5 };
/** A live one's warning shows this much further out than its harm reaches. */
const WARN = 2.5;

const X = new V3(1, 0, 0);
const tmp = new V3();

/**
 * Throwables in the world, from the throwable kit's (`thrownOn`) and the events that come with it: each drawn
 * spinning as it flies (ours leaving the hand, the rest from where the server said), trailing
 * what it trails, knocking as it bounces, and with a warning marker when one that can hurt is
 * near; and the fires they start, flames and smoke rising from the ground round them, crackling
 * (the flames' colour is the server's word). Sounds: the throw, the pin, the knock (the item's own
 * `sounds`, else the standard voices).
 */
export function throwables(): ClientKit {
  const drawn = new Map<string, Drawn>();
  const fires = new Map<number, Fire>();

  const drop = (client: Client, key: string) => {
    const d = drawn.get(key);
    if (d?.node) client.scene.remove(d.node);
    client.hud.marker(`$throw:${key}`, null);
    drawn.delete(key);
  };

  const clear = (client: Client) => {
    for (const key of [...drawn.keys()]) drop(client, key);
    fires.clear();
  };

  /** A new one's look: its model in the world, a random spin; ours from the hand. */
  const add = (client: Client, key: string, mine: boolean) => {
    const axis = new V3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).normalize();
    const hand = mine ? client.camera.toWorld(HAND) : null;
    drawn.set(key, { node: null, axis: axis.lengthSq() > 0 ? axis : X.clone(), spin: 8 + Math.random() * 6, angle: 0, from: hand && new V3(hand.x, hand.y, hand.z), lastHit: -Infinity });
  };

  /** The item's model, at about three fifths of its size (they're made big, for the hand), a sprite smaller, spun about its middle. */
  const make = (client: Client, item: string): Node | null => {
    const look = client.scene.item(item);
    if (!look) return null;
    const k = look.form === 'model' ? 0.6 : 0.35;
    look.node.scale.setScalar(k);
    look.node.position.set(look.center.x, look.center.y, look.center.z).multiplyScalar(-k);
    if (look.form !== 'model') look.node.position.set(-0.5 * k, -0.5 * k, 0);
    const group = client.scene.node();
    group.add(look.node as never);
    client.scene.add(group);
    return group;
  };

  const draw = (client: Client, t: ClientThrown, d: Drawn, dt: number) => {
    if (!d.node) d.node = make(client, t.item);
    const o = d.node;
    if (!o) return;
    if (!t.resting) d.angle += d.spin * dt * (t.grounded ? 0.5 : 1);
    o.quaternion.setFromAxisAngle(d.axis, d.angle);
    const p = t.position;
    o.position.set(p.x, p.y, p.z);
    // Ours leaves the hand: drawn from it onto its path over the first moment.
    if (d.from && t.age < 0.15) o.position.lerp(tmp.copy(d.from), 1 - t.age / 0.15);
  };

  /** A fire where one broke: where the flames can stand, the ground in reach of its middle, found by looking down. */
  const fire = (client: Client, id: number, at: Vec3, radius: number, duration: number, color: string) => {
    const c = new Color(color);
    const spots: Vec3[] = [];
    for (let i = 0; i < 40; i++) {
      const a = (i * 2.399963) % (Math.PI * 2);
      const r = radius * Math.sqrt((i + 0.5) / 40);
      const x = at.x + Math.cos(a) * r;
      const z = at.z + Math.sin(a) * r;
      const top = at.y + 1.2;
      const h = client.world.raycast({ x, y: top, z }, { x: 0, y: -1, z: 0 }, 3);
      if (h && h.normal.y > 0.5) spots.push({ x, y: top - h.distance + 0.02, z });
    }
    if (!spots.length) spots.push({ ...at });
    fires.set(id, { at, radius, left: duration, color: [c.r, c.g, c.b], spots, crackle: 0 });
  };

  /** Flames and smoke rising from its spots; fewer as it dies down. */
  const burn = (client: Client, f: Fire, dt: number) => {
    const fade = Math.min(1, f.left / 1.5);
    const n = Math.max(1, Math.round(f.spots.length * 0.2 * fade * Math.min(2, dt * 60)));
    for (let i = 0; i < n; i++) {
      const s = f.spots[Math.floor(Math.random() * f.spots.length)];
      const at = { x: s.x + (Math.random() - 0.5) * 0.3, y: s.y + 0.1, z: s.z + (Math.random() - 0.5) * 0.3 };
      const [r, g, b] = f.color;
      // Tongues of flame, yellower at the root; now and then a wisp of smoke off the top.
      client.fx.burst(at, { color: `rgb(${Math.round(Math.min(1, r * 1.1) * 255)}, ${Math.round(g * (0.8 + Math.random() * 0.5) * 255)}, ${Math.round(b * 255)})`, count: 2, speed: 0.45, size: 0.1 + Math.random() * 0.12, glow: 2.2, life: 0.4 + Math.random() * 0.35, gravity: -5, drag: 1.5 });
      if (Math.random() < 0.08) client.fx.burst({ x: at.x, y: at.y + 1, z: at.z }, { color: '#5a534d', count: 1, speed: 0.3, size: 0.26, life: 1.2, gravity: -2.5, drag: 1 });
    }
    f.crackle -= dt;
    if (f.crackle <= 0) {
      f.crackle = 0.35 + Math.random() * 0.4;
      client.audio.play('fire', { at: f.at, volume: 0.35 * fade });
    }
  };

  return {
    name: 'effects.throwables',
    frame(client, dt) {
      const item = (id: string) => client.item(id) as ThrowableItem | undefined;
      for (const e of client.events) {
        if (e.t === 'reset') clear(client);
        else if (e.t === 'cook') {
          const sound = item(e.item)?.sounds?.draw;
          if (sound) client.audio.play(sound, { volume: 0.8 });
        } else if (e.t === 'thrown') {
          if (e.mine) client.audio.play(item(e.item)?.sounds?.use ?? 'whoosh', { volume: 0.8 });
          add(client, e.key, e.mine);
        } else if (e.t === 'bounce') {
          // A knock as it bounces (not a clatter of them as it rolls).
          const d = drawn.get(e.key);
          if (e.speed < 1.5 || (d && client.time - d.lastHit < 0.12)) continue;
          if (d) d.lastHit = client.time;
          client.audio.play(item(e.item)?.sounds?.hit ?? 'bounce', { at: e.at, volume: Math.min(1, 0.25 + e.speed / 10) });
        } else if (e.t === 'thrownEnd') drop(client, e.key);
        else if (e.t === 'fire') fire(client, e.id, e.at, e.radius, e.duration, e.color);
      }
      const running = client.running;
      const cam = client.camera.position;
      for (const t of thrownOn(client)) {
        let d = drawn.get(t.key);
        if (!d) {
          add(client, t.key, t.mine);
          d = drawn.get(t.key)!;
        }
        draw(client, t, d, dt);
        // A trail (a lit rag's flame).
        const trail = item(t.item)?.trail;
        const p = t.position;
        if (trail && running) client.fx.burst(p, { color: trail, count: 2, speed: 0.4, size: 0.1, glow: 2, life: 0.35, gravity: -2 });
        const id = `$throw:${t.key}`;
        const reach = t.reach + WARN;
        if (reach > WARN && Math.hypot(p.x - cam.x, p.y - cam.y, p.z - cam.z) < reach) client.hud.marker(id, { x: p.x, y: p.y + 0.15, z: p.z }, { shape: 'ring', color: '#ff3b30', label: '⚠', pulse: true, edge: true, size: 30 });
        else client.hud.marker(id, null);
      }
      for (const [id, f] of [...fires]) {
        if (running) f.left -= dt;
        if (f.left <= 0) {
          fires.delete(id);
          continue;
        }
        burn(client, f, dt);
      }
    },
    dispose() {
      drawn.clear();
      fires.clear();
    },
  };
}
