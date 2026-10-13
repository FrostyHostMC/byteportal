import { defineClient } from '@platform/client';
import { figures, firstPerson } from '@platform/client/kits';
import { shared } from './shared';

/**
 * Sandbox on each player's screen: the first-person view (the block in hand, placed and broken)
 * and other builders' figures (with the blocks they hold). Building's sounds are the engine's own;
 * nobody swings, fires or throws, so it needs no other voices, HUD or effects.
 */
export default defineClient(shared, { kits: [...firstPerson.standard(), figures.humanoid()] });
