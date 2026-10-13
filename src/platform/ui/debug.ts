import { h } from './dom';

/** F3 overlay. */
export class DebugOverlay {
  readonly root: HTMLElement;
  visible = false;
  private fps = 0;
  private frames = 0;
  private acc = 0;
  private cpuMs = 0;
  private fpsEl: HTMLElement;

  constructor(parent: HTMLElement) {
    this.root = h('pre.debug');
    this.fpsEl = h('div.fps');
    parent.append(this.root, this.fpsEl);
    this.root.style.display = 'none';
  }

  toggle() {
    this.visible = !this.visible;
    this.root.style.display = this.visible ? '' : 'none';
  }

  tick(dt: number, cpuMs: number) {
    this.frames++;
    this.acc += dt;
    this.cpuMs = this.cpuMs * 0.95 + cpuMs * 0.05;
    if (this.acc >= 0.5) {
      this.fps = this.frames / this.acc;
      this.frames = 0;
      this.acc = 0;
      this.fpsEl.textContent = `${Math.round(this.fps)} fps`;
    }
  }

  get cpu(): number {
    return this.cpuMs;
  }

  get fpsValue(): number {
    return this.fps;
  }

  set(lines: string[]) {
    if (this.visible) this.root.textContent = lines.join('\n');
  }
}
