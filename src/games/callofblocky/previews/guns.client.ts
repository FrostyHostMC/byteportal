import { defineClient } from '@platform/client';
import { figures, firstPerson, sounds } from '@platform/client/kits';
import { shared } from './guns.shared';

/** The gun models on their pedestals (props the server places): an empty hand to walk round them with, and its swing. */
export default defineClient(shared, { kits: [...sounds.standard(), ...firstPerson.standard(), figures.humanoid()] });
