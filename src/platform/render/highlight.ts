import * as THREE from 'three';

const STAGES = 10;
const SIZE = 16;

/**
 * Crack overlays for block breaking, like Minecraft's `destroy_stage_0..9`: dark cracks that
 * branch out from the middle of each face as the block gets closer to breaking.
 */
function crackStages(): THREE.DataTexture[] {
  // Random walks out from the centre; each pixel remembers when it cracked (0..1).
  const when = new Float32Array(SIZE * SIZE).fill(2);
  let seed = 1337;
  const rnd = () => ((seed = (Math.imul(seed, 1103515245) + 12345) >>> 0) / 4294967296);
  const branches = 7;
  for (let b = 0; b < branches; b++) {
    let x = 7.5 + (rnd() - 0.5) * 2;
    let y = 7.5 + (rnd() - 0.5) * 2;
    let a = (b / branches) * Math.PI * 2 + rnd() * 0.6;
    const start = b < 3 ? 0 : 0.25 + rnd() * 0.35;
    const steps = 9 + Math.floor(rnd() * 6);
    for (let i = 0; i < steps; i++) {
      const t = start + (1 - start) * (i / steps);
      const ix = Math.floor(x);
      const iy = Math.floor(y);
      if (ix >= 0 && iy >= 0 && ix < SIZE && iy < SIZE) when[iy * SIZE + ix] = Math.min(when[iy * SIZE + ix], t);
      a += (rnd() - 0.5) * 1.1;
      x += Math.cos(a);
      y += Math.sin(a);
      // Side twigs late in the break.
      if (rnd() < 0.2) {
        const tx = Math.floor(x + Math.cos(a + 1.6));
        const ty = Math.floor(y + Math.sin(a + 1.6));
        if (tx >= 0 && ty >= 0 && tx < SIZE && ty < SIZE) when[ty * SIZE + tx] = Math.min(when[ty * SIZE + tx], Math.min(1, t + 0.2));
      }
    }
  }
  const out: THREE.DataTexture[] = [];
  for (let s = 0; s < STAGES; s++) {
    const shown = (s + 1) / STAGES;
    const px = new Uint8Array(SIZE * SIZE * 4);
    for (let i = 0; i < SIZE * SIZE; i++) {
      const on = when[i] <= shown;
      px[i * 4 + 3] = on ? (when[i] < shown - 0.3 ? 210 : 170) : 0;
    }
    const tex = new THREE.DataTexture(px, SIZE, SIZE, THREE.RGBAFormat);
    tex.magFilter = THREE.NearestFilter;
    tex.minFilter = THREE.NearestFilter;
    tex.flipY = false;
    tex.needsUpdate = true;
    out.push(tex);
  }
  return out;
}

/** Outline and crack geometry for a set of boxes (1/16 of a block, cell-local), centred on the cell. */
function boxGeometry(boxes: number[][]): { edges: THREE.BufferGeometry; crack: THREE.BufferGeometry } {
  const lines: number[] = [];
  const pos: number[] = [];
  const uv: number[] = [];
  const index: number[] = [];
  for (const [x0, y0, z0, x1, y1, z1] of boxes) {
    // A hair bigger than the box, so the outline isn't buried in its faces.
    const g = new THREE.BoxGeometry((x1 - x0) / 16 + 0.004, (y1 - y0) / 16 + 0.004, (z1 - z0) / 16 + 0.004);
    g.translate((x0 + x1) / 32 - 0.5, (y0 + y1) / 32 - 0.5, (z0 + z1) / 32 - 0.5);
    lines.push(...(new THREE.EdgesGeometry(g).getAttribute('position').array as Float32Array));
    const base = pos.length / 3;
    pos.push(...(g.getAttribute('position').array as Float32Array));
    uv.push(...(g.getAttribute('uv').array as Float32Array));
    for (const i of g.getIndex()!.array) index.push(base + i);
  }
  const edges = new THREE.BufferGeometry();
  edges.setAttribute('position', new THREE.Float32BufferAttribute(lines, 3));
  const crack = new THREE.BufferGeometry();
  crack.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  crack.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  crack.setIndex(index);
  return { edges, crack };
}

/** The block the player is aiming at: a thin outline, with break cracks while it's being mined. */
export class BlockHighlight {
  readonly object = new THREE.Group();
  private edges: THREE.LineSegments;
  private crack: THREE.Mesh;
  private crackMat: THREE.MeshBasicMaterial;
  private stages = crackStages();
  private cube: { edges: THREE.BufferGeometry; crack: THREE.BufferGeometry };
  /** Outlines of block models, by their boxes. */
  private shapes = new Map<string, { edges: THREE.BufferGeometry; crack: THREE.BufferGeometry }>();

  constructor() {
    this.cube = { edges: new THREE.EdgesGeometry(new THREE.BoxGeometry(1.004, 1.004, 1.004)), crack: new THREE.BoxGeometry(1.002, 1.002, 1.002) };
    const edges = (this.edges = new THREE.LineSegments(
      this.cube.edges,
      new THREE.LineBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.55, depthWrite: false }),
    ));
    edges.renderOrder = 10;
    this.crackMat = new THREE.MeshBasicMaterial({
      color: 0x000000,
      map: this.stages[0],
      transparent: true,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -1,
    });
    this.crack = new THREE.Mesh(this.cube.crack, this.crackMat);
    this.crack.renderOrder = 9;
    this.object.add(edges, this.crack);
    this.object.visible = false;
  }

  /**
   * Show it on block (x, y, z), or hide it with null. `shape`: `'cross'` for a plant (drawn
   * smaller), or a block model's boxes (1/16 of a block) to outline them.
   */
  set(at: { x: number; y: number; z: number } | null, shape: 'cross' | number[][] | null = null, progress?: number) {
    this.object.visible = !!at;
    if (!at) return;
    const cross = shape === 'cross';
    const s = cross ? 0.72 : 1;
    let geo = this.cube;
    if (Array.isArray(shape)) {
      const key = shape.join(';');
      geo = this.shapes.get(key) ?? this.shapes.set(key, boxGeometry(shape)).get(key)!;
    }
    this.edges.geometry = geo.edges;
    this.crack.geometry = geo.crack;
    this.object.position.set(Math.floor(at.x) + 0.5, Math.floor(at.y) + (cross ? 0.45 : 0.5), Math.floor(at.z) + 0.5);
    this.object.scale.set(s, cross ? 0.9 : 1, s);
    // The scene it lives in doesn't update matrices by itself.
    this.object.updateMatrixWorld(true);
    const cracking = progress !== undefined && progress > 0;
    this.crack.visible = cracking;
    if (cracking) this.crackMat.map = this.stages[Math.min(STAGES - 1, Math.floor(progress * STAGES))];
  }
}
