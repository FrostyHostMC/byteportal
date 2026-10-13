/** A kept world: its seed, and for games that keep their world (`world.persist`), its edits. */
export interface SavedWorld {
  game: string;
  seed: number;
  /** The engine's exported edits; null until first saved. */
  edits: Uint8Array | null;
  /**
   * The game's own blocks' keys when the edits were saved, in id order (from the first game block
   * id): loaded with other definitions, the edits are translated by name. Absent: none.
   */
  blocks?: string[] | null;
  /** Time of day. */
  time: number;
}

/** Where a player left off in a kept world. */
export interface SavedPlayer {
  x: number;
  y: number;
  z: number;
  yaw: number;
  pitch: number;
  flying: boolean;
  /** Creative building's block hotbar: ids, and the game's own blocks by key (their ids can move). */
  hotbar?: (number | string)[];
}

/**
 * What a host keeps across restarts: the world, where its players left off (by account, `#<id>`;
 * by name, from before accounts), and the game's own key-value data (`game.store`). A server
 * keeps it in SQLite (`SqliteStore`); tests use `MemoryStore`, and sandboxed rooms a relay of the
 * server's (`RelayStore`).
 */
export interface Store {
  world(): SavedWorld | null;
  saveWorld(w: SavedWorld): void;
  player(name: string): SavedPlayer | null;
  savePlayer(name: string, p: SavedPlayer): void;
  /** Forget where a player left off (their account is gone). */
  forgetPlayer(name: string): void;
  /** Where every player left off, by name (what a sandboxed room starts from). */
  players?(): Record<string, SavedPlayer>;
  /** Everything the game has put in `game.store`. */
  data(): Map<string, unknown>;
  /** A change to `game.store` (`undefined`: deleted). */
  put(key: string, value: unknown): void;
  /** Write out anything pending. */
  flush(): void;
  close(): void;
}

/**
 * A store in memory, starting from `initial` and telling `onPut` about each change to the
 * game's data (a sandboxed room's: the relay passes them back to the server, which keeps them).
 */
export class MemoryStore implements Store {
  private kept: SavedWorld | null = null;
  private places = new Map<string, SavedPlayer>();
  private values: Map<string, unknown>;

  constructor(
    initial: Record<string, unknown> = {},
    private onPut?: (key: string, value: unknown) => void,
  ) {
    this.values = new Map(Object.entries(initial));
  }

  world() {
    return this.kept;
  }

  saveWorld(w: SavedWorld) {
    this.kept = { ...w, edits: w.edits && w.edits.slice() };
  }

  player(name: string) {
    return this.places.get(name) ?? null;
  }

  savePlayer(name: string, p: SavedPlayer) {
    this.places.set(name, { ...p });
  }

  forgetPlayer(name: string) {
    this.places.delete(name);
  }

  players(): Record<string, SavedPlayer> {
    return Object.fromEntries(this.places);
  }

  data() {
    return this.values;
  }

  put(key: string, value: unknown) {
    this.onPut?.(key, value);
  }

  flush() {}

  close() {}
}
