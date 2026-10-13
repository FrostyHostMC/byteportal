import { defineClient } from '@platform/client';
import { figures, firstPerson } from '@platform/client/kits';
import { shared } from './shipyard.shared';

/** The ships full size, seen as a builder: the block in hand, and anyone else about. */
export default defineClient(shared, { kits: [...firstPerson.standard(), figures.humanoid()] });
