import type { Slot } from './weapons';

/**
 * The trooper classes: what each carries into the fight and how much it takes. Every class has a
 * blaster pistol and thermal detonators (G) besides its own blaster. Plain data both sides read
 * (the spawn menu names them on each screen).
 */

export type ClassId = 'trooper' | 'heavy' | 'specialist';

export interface ClassInfo {
  id: ClassId;
  name: string;
  /** One line for the spawn menu. */
  blurb: string;
  health: number;
  /** Times walking and sprinting speed. */
  speed: number;
  primary: Slot;
  detonators: number;
  /** Which of each side's trooper models it wears (`models/index.ts`: `TROOPERS[team][model]`). */
  model: number;
}

export const CLASSES: Record<ClassId, ClassInfo> = {
  trooper: { id: 'trooper', name: 'Trooper', blurb: 'Blaster rifle · two thermal detonators · all-rounder', health: 100, speed: 1, primary: 'rifle', detonators: 2, model: 0 },
  heavy: { id: 'heavy', name: 'Heavy', blurb: 'Rotary repeater · tougher, slower · holds a post', health: 140, speed: 0.92, primary: 'heavy', detonators: 1, model: 1 },
  specialist: { id: 'specialist', name: 'Specialist', blurb: 'Cycler rifle · one to the head · the long view', health: 100, speed: 1.03, primary: 'sniper', detonators: 1, model: 2 },
};

export const CLASS_IDS = Object.keys(CLASSES) as ClassId[];
