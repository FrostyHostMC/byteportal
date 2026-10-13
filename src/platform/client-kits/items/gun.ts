import type { Vec3 } from '@platform';
import type { Client, ClientKit } from '@platform/client';
import { assistOf, gun as gunOf, gunMove, resolveGunRules, spreadDeg, type Assist, type Gun, type GunOwn, type GunShown, type ShotWire, type GunItem, type GunOptions, isGun } from '@platform/items';
import { GunController, type FiredShot } from './gunner';

/**
 * One bullet of a shot, as this screen has it: where it ended and what it hit there (a block, with
 * its face and colour; someone; or nothing, at its range), and the walls it went through first.
 */
export interface ClientBullet {
  end: Vec3;
  hit: 'block' | 'body' | null;
  /** The face of the block it hit. */
  normal: Vec3 | null;
  /** The block's colour (linear RGB), for chips of it. */
  color: [number, number, number] | null;
  /** It took a bite out of the block (a world whose blocks carve): the pit is its mark. */
  carved: boolean;
  /**
   * The walls it went through on the way (wall-banging): where it went in and came out, each
   * face, the wall's colour, and whether each side was carved.
   */
  walls: { entry: Vec3; normal: Vec3; exit: Vec3; out: Vec3; color: [number, number, number]; carvedIn: boolean; carvedOut: boolean }[];
}

declare module '@platform/client' {
  interface ClientEvents {
    /** Our gun fired (its first-person kit kicks it): `power` scales the kick. */
    shot: { item: string; power: number };
    /** A reload started on this screen. */
    reload: { item: string };
    /** The trigger on an empty gun. */
    empty: { item: string };
    /**
     * A shot's bullets: ours as this screen fired them (`mine`: the tracers leave our own hand's
     * muzzle), or someone else's as the server had them (from `from`, their figure's muzzle).
     */
    bullets: { item: string; by: string | null; mine: boolean; from: Vec3 | null; bullets: ClientBullet[] };
  }
}

/** How a held gun shows on this screen (`client.me.held.state`, for a gun). */
export interface GunView {
  /** Down the sights, 0..1; carried for sprinting, 0..1; in a slide, 0 or 1. */
  aim: number;
  sprint: number;
  slide: number;
  /** How far through a reload, 0..1 (-1: not reloading); rounds still to load one at a time. */
  reload: number;
  shells: number;
  sight: 'iron' | 'dot' | 'holo' | 'scope';
  action: GunItem['action'];
  /** How much aiming all the way zooms the view. */
  zoom: number;
  /** The rounds in it and spare; the spread now (degrees, standing as they are: the crosshair's); the sight's colour. */
  mag: number;
  reserve: number;
  spread: number;
  color: string;
}

/**
 * Guns on this screen: the gun kit's client half (`kind: 'gun'`). It fires the held gun the moment
 * the trigger's pulled (at the gun's rate, with its rounds), aims, reloads and kicks the view by
 * the rules the host plays (`options`, the same as the host half's), and sends each shot to the
 * host with the controls. It gives the other kits what happened (`shot`, `reload`, `empty`, and
 * each shot's `bullets`: ours from where this screen's bullets land, everyone else's from the
 * host's word), the held gun's state (`client.me.held`, and `$gun` for widgets), what a gun does to
 * a figure (aimed, down the sights, reloading), and aim assist on a controller.
 */
export function guns(options: GunOptions = {}): ClientKit {
  const rules = resolveGunRules(options);
  const ctl = new GunController(rules);
  /** This frame's own shots, for their bullets once the camera's placed. */
  let ownShots: FiredShot[] = [];
  /** A replay's followed player's shots this frame (their bullets go out once the hand's placed). */
  let replayShots: ShotWire[] = [];
  /** Sprinting, blended, in a replay (its gun comes down as ours does). */
  let replaySprint = 0;
  /** Aim assist: the shape for the gun in hand, and who it was on last frame. */
  let assist: { gun: Gun; shape: Assist } | null = null;
  let assistOn: { id: string; yaw: number; pitch: number } | null = null;

  /** The gun in hand (the hotbar's), if it's one. */
  const heldGun = (client: Client): { item: string; def: GunItem } | null => {
    const item = client.me.hand.item;
    const def = item ? client.item(item) : undefined;
    return item && isGun(def) ? { item, def } : null;
  };
  /** The body's movement, for the spread: a fraction of walking speed, in the air, crouched. */
  const bodyOf = (client: Client, sprinting: boolean) => {
    const me = client.me;
    return { moving: Math.hypot(me.velocity.x, me.velocity.z) / Math.max(1, me.walkSpeed), air: !me.onGround, crouch: me.crouching, sprinting, dead: me.dead };
  };
  /** Whether a bullet from `gun` that hit `block` at `at` (its face `normal`) carves it (then the pit is its mark). */
  const carves = (client: Client, gun: GunItem, block: number, at: Vec3, normal: Vec3 | null) => gun.carve !== false && client.world.carvable(block, at, normal);
  /** A wall a bullet went through, for the kits: where, its colour, and whether each side was carved. */
  const wallOf = (client: Client, gun: GunItem, entry: Vec3, normal: Vec3, exit: Vec3, out: Vec3, block: number): ClientBullet['walls'][number] => ({
    entry,
    normal,
    exit,
    out,
    color: client.world.blockColor(block),
    carvedIn: carves(client, gun, block, entry, normal),
    carvedOut: carves(client, gun, block, exit, out),
  });
  /** A shot's bullets as the host had them: where each ended, what it hit, the walls it went through. */
  const bulletsOf = (client: Client, w: ShotWire): ClientBullet[] => {
    const def = client.item(w.item);
    const gun = isGun(def) ? def : null;
    const v = (p: number[], i: number) => ({ x: p[i], y: p[i + 1], z: p[i + 2] });
    return w.ends.map(([x, y, z, kind], i): ClientBullet => {
      const at = { x, y, z };
      const block = w.blocks[i];
      const normal = w.normals[i] ? v(w.normals[i]!, 0) : null;
      const hit = kind === 1 && block >= 0 ? 'block' : kind === 2 ? 'body' : null;
      return {
        end: at,
        hit,
        normal,
        color: hit === 'block' ? client.world.blockColor(block) : null,
        carved: hit === 'block' && !!gun && carves(client, gun, block, at, normal),
        walls: gun ? (w.walls?.[i] ?? []).map((p) => wallOf(client, gun, v(p, 0), v(p, 3), v(p, 6), v(p, 9), p[12])) : [],
      };
    });
  };

  /** Someone's shot, as the host had it: from their gun's muzzle as their figure's drawn (their figure kicks); or, in a replay, the followed player's own. */
  const heard = (client: Client, w: ShotWire) => {
    const r = client.replay;
    if (r.playing && r.follow !== null && w.by === r.follow) {
      // Their own: their hand kicks now, the bullets go once it's placed.
      client.emit({ t: 'shot', item: w.item, power: 1 });
      replayShots.push(w);
      return;
    }
    const fig = client.figures.all.find((f) => f.player === w.by);
    if (!fig) return;
    const muzzle = fig.point('muzzle');
    const root = fig.root.position;
    const from = muzzle ? { x: muzzle.x, y: muzzle.y, z: muzzle.z } : { x: root.x, y: root.y + 1.45, z: root.z };
    fig.used();
    client.emit({ t: 'bullets', item: w.item, by: w.by, mine: false, from, bullets: bulletsOf(client, w) });
  };

  return {
    name: 'items.guns',
    kind: 'gun',
    setup(client) {
      client.on('gun.shot', (data) => heard(client, data as ShotWire));
    },
    controls(client, c, dt) {
      const me = client.me;
      const held = heldGun(client);
      // The host's word on the gun in hand (its rounds, a reload), and a death: guns come back full.
      if (me.dead) ctl.reset();
      // How fast they reload (the host's word: a perk, say), so this screen reloads as fast.
      ctl.reloadSpeed = (me.items?.gun as GunOwn | undefined)?.reloadSpeed ?? 1;
      ctl.hold(held?.item ?? null, held?.def, held ? (me.hand.state as GunShown | null) : null);
      ctl.reconcile(held ? (me.hand.state as GunShown | null) : null);
      if (!ctl.state) return;
      // The hand's on the gun: nothing else takes the fire button.
      const shots = ctl.update(
        dt,
        { active: c.active, trigger: c.button(0), triggerPressed: c.clicked(0), aim: c.button(2), reload: c.pressed('KeyR') },
        bodyOf(client, me.sprinting),
        c.yaw,
        c.pitch,
        (dPitch, dYaw) => c.turn(dPitch, dYaw),
        (e) => client.emit({ t: e, item: ctl.item! }),
      );
      c.consume(0);
      c.consume(2);
      const kick = ctl.g?.recoil.up ?? 1;
      if (shots.length && client.input.device === 'pad') client.input.rumble(Math.min(1, kick / 5), 0.3 + Math.min(0.5, kick / 6), 55 + kick * 18);
      for (const s of shots) {
        c.act([s.serial, s.yaw, s.pitch, s.spread]);
        // (The first-person kit kicks the gun and zooms the view; the effects kit sounds each shot.)
        client.emit({ t: 'shot', item: ctl.item!, power: 1 });
      }
      ownShots.push(...shots);
    },
    frame(client, dt) {
      for (const e of client.events) if (e.t === 'reset') ctl.reset();
      // In a replay, the followed player's sprint, blended (their gun comes down as ours does).
      if (!client.replay.playing) replaySprint = 0;
      else replaySprint += ((client.me.sprinting ? 1 : 0) - replaySprint) * Math.min(1, dt * 10);
      // The gun in hand for widgets (`$gun`): as this screen fires and reloads it.
      const st = ctl.state;
      const def = ctl.def;
      const me = client.me;
      const r2 = (v: number) => Math.round(v * 100) / 100;
      client.hud.bind(
        'gun',
        st && def && !me.dead && !me.inVehicle ? { item: ctl.item, name: def.name, mag: st.mag, size: def.magazine, reserve: st.reserve, reloading: st.reload >= 0, reload: r2(Math.max(0, ctl.reloadProgress)), aim: r2(st.aim) } : null,
      );
    },
    late(client) {
      // Our own shots this frame: where each bullet lands on this screen, from the eye as the
      // camera's placed now (what they aimed at is what they hit).
      const shots = ownShots;
      ownShots = [];
      const def = ctl.def;
      const g = ctl.g;
      const item = ctl.item;
      if (shots.length && def && g && item) {
        const eye = client.camera.position;
        for (const shot of shots) {
          const bullets = shot.dirs.map((d): ClientBullet => {
            const end = client.world.trace(eye, d, g.range, { penetration: g.penetration });
            const block = end.block >= 0;
            return {
              end: end.point,
              hit: block ? 'block' : end.body ? 'body' : null,
              normal: end.normal,
              color: block ? client.world.blockColor(end.block) : null,
              carved: block && carves(client, def, end.block, end.point, end.normal),
              walls: end.walls.map((p) => wallOf(client, def, p.entry, p.normal, p.exit, p.out, p.block)),
            };
          });
          client.emit({ t: 'bullets', item, by: client.me.id, mine: true, from: null, bullets });
        }
      }
      // A replay's followed player's shots: from their hand as it's drawn (ours, as far as the kits know).
      const theirs = replayShots;
      replayShots = [];
      for (const w of theirs) client.emit({ t: 'bullets', item: w.item, by: w.by, mine: true, from: null, bullets: bulletsOf(client, w) });
    },
    move: (def, controls) => (isGun(def) ? gunMove(def, controls.buttons, rules) : null),
    heldState(client, item, def) {
      if (!isGun(def)) return null;
      const g = gunOf(def);
      if (client.replay.playing) {
        // The followed player's gun as the replay's frame has it (its rounds, reload, how far it's aimed).
        const h = client.me.hand.state as GunShown | null;
        if (!h) return null;
        const shells = def.shells ? Math.max(0, Math.min(def.magazine - h.mag, h.reserve)) : 0;
        const reload = h.reload < 0 ? -1 : Math.max(0, Math.min(def.shells ? 0.999 : 1, 1 - h.reload / Math.max(0.01, def.reload)));
        const me = client.me;
        const spread = spreadDeg(g, { aim: h.aim, moving: Math.hypot(me.velocity.x, me.velocity.z) / Math.max(1, me.walkSpeed), air: !me.onGround, crouch: me.crouching, bloom: 0 });
        return { aim: h.aim, sprint: replaySprint, slide: me.sliding ? 1 : 0, reload, shells, sight: g.aim.sight, action: def.action, zoom: g.aim.zoom, mag: h.mag, reserve: h.reserve, spread, color: g.aim.color } satisfies GunView;
      }
      const st = ctl.state;
      if (!st || ctl.item !== item) return null;
      const me = client.me;
      // The spread now, standing as they are, not sprinting: what the crosshair opens to.
      const spread = ctl.spread(bodyOf(client, false));
      return {
        aim: st.aim,
        sprint: ctl.sprint,
        slide: me.sliding ? 1 : 0,
        reload: ctl.reloadProgress,
        shells: def.shells ? ctl.shellsToLoad : 0,
        sight: g.aim.sight,
        action: def.action,
        zoom: g.aim.zoom,
        mag: st.mag,
        reserve: st.reserve,
        spread,
        color: g.aim.color,
      } satisfies GunView;
    },
    figureSignals(state) {
      // A gun is shouldered where they look, down its sights as far as they're aimed, and reloaded.
      const s = state as GunShown | null;
      return { aim: 1, sights: s?.aim ?? 0, reloading: (s?.reload ?? -1) >= 0 };
    },
    stick(client) {
      // Aim assist (a controller, holding a gun, the setting on): over a player in sight near the
      // crosshair the stick turns slower, and while the sticks are moving the view turns a little
      // with them as they (or we) move. Its strength and shape are the gun's `aim.assist` over the
      // game's rules' `assist`.
      const g = ctl.g;
      if (g && assist?.gun !== g) assist = { gun: g, shape: assistOf(g, rules) };
      const a = assist?.shape;
      const strength = g && a && client.input.assist && !client.me.thirdPerson ? a.strength : 0;
      if (strength <= 0 || !a || !g) {
        assistOn = null;
        return null;
      }
      const c = client.camera.position;
      const look = client.me.look;
      const cp = Math.cos(look.pitch);
      const fx = -Math.sin(look.yaw) * cp;
      const fy = Math.sin(look.pitch);
      const fz = -Math.cos(look.yaw) * cp;
      let best: { id: string; yaw: number; pitch: number } | null = null;
      let bestOff = Infinity;
      for (const f of client.figures.all) {
        if (!f.player || f.player === client.me.id || f.state.dying > 0) continue;
        // Their chest, as they stand, crouch or slide.
        const p = f.root.position;
        const t = { x: p.x, y: p.y + (f.state.posture >= 1.5 ? 0.55 : f.state.posture >= 0.5 ? 0.95 : 1.25), z: p.z };
        const dx = t.x - c.x;
        const dy = t.y - c.y;
        const dz = t.z - c.z;
        const d = Math.hypot(dx, dy, dz);
        if (d < 0.8 || d > g.range) continue;
        const off = Math.acos(Math.max(-1, Math.min(1, (dx * fx + dy * fy + dz * fz) / d)));
        // About a block round them, a little more far off.
        const cone = Math.atan2(a.radius, d) + a.angle;
        if (off > cone || off / cone >= bestOff) continue;
        if (!client.world.lineOfSight(c, t)) continue;
        bestOff = off / cone;
        best = { id: f.player, yaw: Math.atan2(-dx, -dz), pitch: Math.atan2(dy, Math.hypot(dx, dz)) };
      }
      const was = assistOn;
      assistOn = best;
      if (!best) return null;
      const aiming = (ctl.state?.aim ?? 0) > 0.5;
      const slow = 1 - strength * (aiming ? a.slow.aim : a.slow.hip) * (1 - 0.4 * bestOff);
      if (!was || was.id !== best.id || !client.input.sticksMoving) return { slow };
      let turn = best.yaw - was.yaw;
      turn -= Math.round(turn / (2 * Math.PI)) * 2 * Math.PI;
      const tilt = best.pitch - was.pitch;
      // A jump (a respawn, a teleport) isn't followed.
      if (Math.abs(turn) > 0.15 || Math.abs(tilt) > 0.15) return { slow };
      const k = strength * (aiming ? a.follow.aim : a.follow.hip);
      return { slow, yaw: turn * k, pitch: tilt * k };
    },
  };
}
