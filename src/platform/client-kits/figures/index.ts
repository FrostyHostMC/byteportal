import type { ClientKit } from '@platform/client';
import { humanoid } from './humanoid';

export { humanoid, type HumanoidOptions } from './humanoid';
export { DEFAULT_POSES, resolvePoses, type Poses } from './poses';
export { gunHands, gunPoints, heldInfo, inFist, type HeldInfo } from './held';

/** Players' and creatures' figures as the platform has always posed them: `humanoid()`. */
export function standard(): ClientKit[] {
  return [humanoid()];
}
