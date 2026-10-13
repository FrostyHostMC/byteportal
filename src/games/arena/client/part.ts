import type { Client, ClientKit } from '@platform/client';

/**
 * A part of the Arena on each screen (as `../part.ts` is on the server): its kits, run after the
 * platform's, and its `setup` (looks, voices, layers). Listed in `client/parts.ts`.
 */
export interface ClientPart {
  name: string;
  kits: ClientKit[];
  setup?(client: Client): void;
}
