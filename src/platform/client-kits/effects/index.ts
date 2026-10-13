import type { ClientKit } from '@platform/client';
import { gunfire } from './gunfire';
import { throwables } from './throwables';

export { gunfire, throwables };

/** The world effects the platform's games have always had: gunfire, then throwables and their fires. */
export function standard(): ClientKit[] {
  return [gunfire(), throwables()];
}
