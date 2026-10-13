import * as THREE from 'three';
import type { Vehicle, VehicleControls, VehicleDefinition } from '../api/types';
import type { PlayerInput } from '../net/protocol';
import type { PropState } from './props';

/** A player's vehicle on the host: its definition, its live state and its model. */
export class VehicleSim implements Vehicle {
  constructor(
    readonly name: string,
    readonly def: VehicleDefinition,
    readonly state: object,
    readonly prop: PropState | null,
    /** Steered from afar: the pilot's body stays where it was (`drive`'s `remote`). */
    readonly remote = false,
  ) {}

  /** Put the model where the state has it; returns where that is. */
  place(out = new THREE.Vector3()): THREE.Vector3 {
    const q = new THREE.Quaternion();
    this.def.pose(this.state, out, q);
    if (this.prop && !this.prop.removed) {
      this.prop.position.copy(out);
      this.prop.quaternion.copy(q);
    }
    return out;
  }
}

/** A `PlayerInput` as a vehicle reads it (a pilot's screen replaying its own inputs). */
export class InputControls implements VehicleControls {
  constructor(private i: PlayerInput) {}
  isDown(code: string) {
    return this.i.active && this.i.down.includes(code);
  }
  pressed(code: string) {
    return this.i.active && this.i.pressed.includes(code);
  }
  button(b: number) {
    return this.i.active && (this.i.buttons & (1 << b)) !== 0;
  }
  buttonPressed(b: number) {
    return this.i.active && (this.i.clicked & (1 << b)) !== 0;
  }
  get mouseX() {
    return this.i.active ? this.i.mouseX : 0;
  }
  get mouseY() {
    return this.i.active ? this.i.mouseY : 0;
  }
  get wheel() {
    return this.i.active ? this.i.wheel : 0;
  }
}

/** A deep copy of a vehicle's state (plain data), so replays never touch what came from the host. */
export function copyState<S>(s: S): S {
  return structuredClone(s);
}
