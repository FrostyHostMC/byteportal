import { Course } from './course';
import { HOLES } from './holes';

export { Course, type Ground, type Hole } from './course';
export { Surf, SURF_NAMES, type Tree } from './types';

/** Blockyard Links, built once: every screen and the server work it out the same. */
export const course = new Course(HOLES);
