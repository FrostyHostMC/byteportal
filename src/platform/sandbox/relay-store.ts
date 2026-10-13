import type { SavedPlayer, SavedWorld, Store } from '../host/store';
import type { StoreOp, StoreSnapshot } from './protocol';

/**
 * A sandboxed room's store: it starts from the game server's copy (`StoreSnapshot`), reads from
 * that, and sends every change back for the game server to keep (`StoreOp`). The room has no
 * database of its own. A room that doesn't keep its world (a copy, a room of a player's own) saves
 * only the game's data, as `PrivateStore` does.
 */
export class RelayStore implements Store {
  private kept: SavedWorld | null;
  private places: Map<string, SavedPlayer>;
  private values: Map<string, unknown>;

  constructor(
    private snapshot: StoreSnapshot,
    private send: (change: StoreOp) => void,
  ) {
    this.kept = snapshot.keeps ? snapshot.world : null;
    this.places = new Map(snapshot.keeps ? Object.entries(snapshot.players) : []);
    this.values = new Map(snapshot.data);
  }

  world(): SavedWorld | null {
    return this.kept;
  }

  saveWorld(w: SavedWorld) {
    if (!this.snapshot.keeps) return;
    this.kept = w;
    this.send({ op: 'saveWorld', world: w });
  }

  player(name: string): SavedPlayer | null {
    return this.places.get(name) ?? null;
  }

  savePlayer(name: string, p: SavedPlayer) {
    if (!this.snapshot.keeps) return;
    this.places.set(name, p);
    this.send({ op: 'savePlayer', name, player: p });
  }

  forgetPlayer(name: string) {
    if (!this.snapshot.keeps) return;
    this.places.delete(name);
    this.send({ op: 'forgetPlayer', name });
  }

  data(): Map<string, unknown> {
    return this.values;
  }

  put(key: string, value: unknown) {
    if (value === undefined) this.values.delete(key);
    else this.values.set(key, value);
    this.send({ op: 'put', key, value });
  }

  flush() {
    this.send({ op: 'flush' });
  }

  close() {}
}
