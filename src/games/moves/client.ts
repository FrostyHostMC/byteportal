import { defineClient } from '@platform/client';
import { figures, firstPerson, sounds } from '@platform/client/kits';
import { shared } from './shared';

/**
 * The movement lab on each screen: the standard voices (the moves' whooshes and swishes, which the
 * server plays), the first-person view (an empty hand), and the figures (your own, watched from
 * behind with the wheel). Nothing to hold, fire or throw.
 */
export default defineClient(shared, { kits: [...sounds.standard(), ...firstPerson.standard(), figures.humanoid()] });
