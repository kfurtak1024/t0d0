import { save } from "./storage";
import type { State } from "./types";

type Listener = () => void;

/**
 * Holds the current state, persists it, and keeps exactly one level of undo.
 *
 * One level is deliberate: undo exists to rescue a mis-tap (a delete, a
 * cleared day), not to provide a history the app has otherwise refused to keep.
 */
export class Store {
  #state: State;
  #undo: State | null = null;
  #listeners = new Set<Listener>();
  #onSaveFailed: (() => void) | null = null;

  constructor(initial: State) {
    this.#state = initial;
  }

  /** Called once when a write cannot reach storage. */
  onSaveFailed(handler: () => void): void {
    this.#onSaveFailed = handler;
  }

  #persist(): void {
    if (!save(this.#state)) this.#onSaveFailed?.();
  }

  get state(): State {
    return this.#state;
  }

  get canUndo(): boolean {
    return this.#undo !== null;
  }

  /**
   * Apply a transition. `undoable` transitions stash the previous state; the
   * rest (ticking, collapsing) are cheap to reverse by hand and would only
   * bury a real mistake under noise.
   */
  apply(next: State, { undoable = false }: { undoable?: boolean } = {}): void {
    if (next === this.#state) return;
    if (undoable) this.#undo = this.#state;
    this.#state = next;
    this.#persist();
    this.#emit();
  }

  /** Replace wholesale (import, another tab) without keeping the old state. */
  replace(next: State, { undoable = false }: { undoable?: boolean } = {}): void {
    if (undoable) this.#undo = this.#state;
    this.#state = next;
    this.#persist();
    this.#emit();
  }

  undo(): boolean {
    if (this.#undo === null) return false;
    this.#state = this.#undo;
    this.#undo = null;
    this.#persist();
    this.#emit();
    return true;
  }

  subscribe(listener: Listener): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  #emit(): void {
    for (const listener of this.#listeners) listener();
  }
}
