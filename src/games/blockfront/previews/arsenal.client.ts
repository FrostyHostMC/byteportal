import { defineClient } from '@platform/client';
import { figures, firstPerson, sounds } from '@platform/client/kits';
import { shared } from './arsenal.shared';

/** The arsenal on display (props the server hangs): an empty hand to fly round them with. */
export default defineClient(shared, { kits: [...sounds.standard(), ...firstPerson.standard(), figures.humanoid()] });
