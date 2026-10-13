import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import type { CosmeticDef } from '../api/types';
import { buildCharacter } from '../character/build';
import { characterUrl, type CharacterLook } from '../character/look';
import { characterScene } from '../client/character';
import { HumanoidRig, wearAnchor } from '../client/humanoid';
import { cosmeticLook } from '../render/cosmetics';

/** A figure made for the view, and how to let it go. */
interface Shown {
  key: string;
  holder: THREE.Group;
  dispose(): void;
}

/**
 * Pictures of a character as the game builds it (the locker's, the home page's face): one small
 * WebGL renderer of its own, drawing a figure in what it wears (its hat and back item hung where a
 * game hangs them) and copying the picture onto the canvas asked for. The figure's kept till the
 * look changes, so a turning preview only draws.
 */
export class CharacterView {
  private renderer: THREE.WebGLRenderer | null = null;
  private failed = false;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(20, 1, 0.1, 50);
  private shown: Shown | null = null;

  constructor() {
    const sky = new THREE.HemisphereLight(0xeef4ff, 0x4a4038, 1.1);
    const sun = new THREE.DirectionalLight(0xfff2e0, 3.4);
    sun.position.set(-1.6, 2.6, 2.2);
    const fill = new THREE.DirectionalLight(0xc4d8ff, 0.7);
    fill.position.set(2, 0.6, 1.5);
    const rim = new THREE.DirectionalLight(0xffffff, 1.6);
    rim.position.set(1.2, 1.6, -2.6);
    this.scene.add(sky, sun, fill, rim);
  }

  private gl(): THREE.WebGLRenderer | null {
    if (this.renderer || this.failed) return this.renderer;
    try {
      this.renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
      this.renderer.setClearColor(0x000000, 0);
      this.renderer.setPixelRatio(1);
      // A room's light to shine in (gold and buckles are metal: without one they'd be black).
      const pmrem = new THREE.PMREMGenerator(this.renderer);
      this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
      this.scene.environmentIntensity = 0.5;
      pmrem.dispose();
    } catch {
      this.failed = true;
    }
    return this.renderer;
  }

  /** The figure for a look in what it wears (built again only when either changes). */
  private dress(look: CharacterLook, wear: readonly CosmeticDef[]): THREE.Group {
    const hat = wear.find((w) => w.slot === 'hat' && w.model);
    const back = wear.find((w) => w.slot === 'back' && w.model);
    const full: CharacterLook = { ...look, ...(hat ? { hatHair: true } : {}) };
    const key = `${characterUrl(full)}|${JSON.stringify(hat?.model ?? null)}|${JSON.stringify(back?.model ?? null)}`;
    if (this.shown?.key === key) return this.shown.holder;
    this.shown?.dispose();
    const { root, mesh } = characterScene(buildCharacter(full));
    const rig = new HumanoidRig(root);
    const frame = rig.wearFrame();
    const worn: THREE.Mesh[] = [];
    for (const [def, point] of [[hat, 'hat'], [back, 'back']] as const) {
      if (!def?.model) continue;
      const l = cosmeticLook(def.model);
      // (Its glowing boxes glow their own colour.)
      const glow = (l.emissive as THREE.DataTexture).image.data as Uint8Array;
      const albedo = (l.albedo as THREE.DataTexture).image.data as Uint8Array;
      const lit = new Uint8Array(glow.length);
      for (let i = 0; i < glow.length; i += 4) if (glow[i]) lit.set([albedo[i], albedo[i + 1], albedo[i + 2], 255], i);
      const emissive = new THREE.DataTexture(lit, 16, 16);
      emissive.colorSpace = THREE.SRGBColorSpace;
      emissive.needsUpdate = true;
      const m = new THREE.Mesh(l.geometry, new THREE.MeshStandardMaterial({ map: l.albedo, emissiveMap: emissive, emissive: 0xffffff, roughness: 0.8 }));
      const anchor = point === 'hat' ? wearAnchor(rig, 'head', frame.top, frame.headWidth, false, root) : wearAnchor(rig, 'chest', frame.back, frame.bodyWidth, true, root);
      anchor.add(m);
      worn.push(m);
    }
    const holder = new THREE.Group();
    holder.add(root);
    this.scene.add(holder);
    this.shown = {
      key,
      holder,
      dispose: () => {
        holder.removeFromParent();
        mesh.geometry.dispose();
        for (const m of [mesh, ...worn]) {
          const mat = m.material as THREE.MeshStandardMaterial;
          for (const t of new Set([mat.map, mat.emissiveMap, mat.roughnessMap, mat.metalnessMap])) t?.dispose();
          mat.dispose();
        }
        for (const m of worn) m.geometry.dispose();
      },
    };
    return holder;
  }

  /**
   * Draw a look in what it wears onto `canvas` (its pixel size): the whole figure turned `yaw`
   * (radians; 0 faces us), or (`face`) a portrait of the head.
   */
  draw(canvas: HTMLCanvasElement, look: CharacterLook, wear: readonly CosmeticDef[], opts: { yaw?: number; face?: boolean } = {}) {
    const r = this.gl();
    const ctx = canvas.getContext('2d');
    if (!r || !ctx) return;
    const holder = this.dress(look, wear);
    holder.rotation.y = opts.yaw ?? 0;
    const w = canvas.width;
    const h = canvas.height;
    r.setSize(w, h, false);
    const cam = this.camera;
    cam.aspect = w / h;
    // Framed: the head and a hat on it, or the whole figure from its soles to a tall hat.
    const [centre, half] = opts.face ? [1.64, 0.46] : [1.04, 1.12];
    const d = half / Math.tan((cam.fov * Math.PI) / 360);
    cam.position.set(0, centre + d * (opts.face ? 0.08 : 0.12), d);
    cam.lookAt(0, centre, 0);
    cam.updateProjectionMatrix();
    r.render(this.scene, cam);
    ctx.clearRect(0, 0, w, h);
    ctx.drawImage(r.domElement, 0, 0);
  }

  /** Let the figure go (the locker closed); the renderer stays for next time. */
  release() {
    this.shown?.dispose();
    this.shown = null;
  }
}

/** The page's one view (a renderer's a WebGL context: one will do). */
let view: CharacterView | null = null;
export function characterView(): CharacterView {
  return (view ??= new CharacterView());
}
