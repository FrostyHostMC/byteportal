/**
 * Voxel platform: the API for a game's code on each player's screen (`src/games/<id>/client.ts`).
 * It never runs on the server, and a game's server code never reaches the browser.
 *
 * ```ts
 * import { defineClient } from '@platform/client';
 * import { shared } from './shared';
 * export default defineClient(shared, { ... });
 * ```
 */
import type { GameMeta, SharedDefinition } from './types';
import type { ClientDefinition, ClientGame } from './client/core';

export type { Node, ClientKit, ClientDefinition, ClientGame, Client, ClientServices, ClientCamera, ClientFx, ClientAudio, ClientItems, ClientInput, ClientWorld, ClientTrace, ClientScene, ClientReplay, Me, MeHeld, ClientEvent, ClientEvents, KitControls, FigureSignals } from './client/core';
export type { ItemLook, ItemIcon, IconRef, ItemSounds, HoldSpec, GunHold, SynthVoice, SynthKit, LoopKit, LoopVoice, ClientLoop, Acoustics } from './types';
export type { ViewLayer, ViewCamera, ViewSpriteOptions, HeldItem, ViewArms, HumanoidViewArms, ViewArm } from './client/view';
export type { ClientFigures, Figure, FigureBone, FigureHeld, FigureNode, FigureRig, FigureState, HeldPoint } from './client/figures';
export type { ClientHud, HudPlace, HudCrosshair } from './client/hud';

/** The game on each player's screen (`client.ts`). */
export function defineClient(shared: SharedDefinition, client: ClientDefinition = {}): ClientGame {
  return { shared, client };
}

/**
 * A game in the browser's catalog (`src/games/browser.ts`): what the launcher shows, and how to
 * load the rest when someone picks it (a chunk of its own: its client and shared code).
 */
export interface GameEntry {
  readonly meta: GameMeta;
  load(): Promise<ClientGame>;
}
