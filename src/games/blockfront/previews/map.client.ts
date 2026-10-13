import { defineClient } from '@platform/client';
import { figures, firstPerson, sounds } from '@platform/client/kits';
import { shared } from './map.shared';

/** Mos Blockley to fly round: an empty hand, and its swing. */
export default defineClient(shared, { kits: [...sounds.standard(), ...firstPerson.standard(), figures.humanoid()] });
