import type { ArenaPart } from './part';
import { mapsPart } from './maps/part';
import { bestiaryPart } from './monsters/part';
import { bossesPart } from './bosses/part';
import { armoryPart } from './items/part';
import { runPart } from './run/part';
import { hudPart } from './hud/part';
import { usePart } from './run/use';

/** The Arena's parts, in the order the server calls them (`part.ts`). */
export const PARTS: readonly ArenaPart[] = [usePart, mapsPart, bestiaryPart, bossesPart, armoryPart, runPart, hudPart];
