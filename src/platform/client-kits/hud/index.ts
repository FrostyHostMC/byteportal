import type { ClientKit } from '@platform/client';
import { gunner } from './gunner';
import { throwables } from './throwables';

export { gunner, throwables };

/** The HUD pieces the platform's games have always had: the held gun's (`gunner`), then the throwables' (`throwables`). */
export function standard(): ClientKit[] {
  return [gunner(), throwables()];
}
