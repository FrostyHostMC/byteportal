import { defineClient } from '@platform/client';
import { figures, firstPerson, sounds } from '@platform/client/kits';
import { shared } from './map.shared';

/** Dev preview: the kits it uses (blocks in hand; anyone else looking round, as a figure). */
export default defineClient(shared, { kits: [...sounds.standard(), ...firstPerson.standard(), figures.humanoid()] });
