/**
 * A single thing to do. `target` is 1 for a plain checkbox, >1 for `make calls [3]`.
 *
 * `important` is a mark and nothing more: it changes how the row reads, never
 * where it sits. Ordering stays the list's own business.
 *
 * `once` is the other kind of mark: a thing that is not part of the standing
 * list. The list persists and `clearTicks` only zeroes counts, so an errand
 * added today comes back tomorrow looking like work nobody has done yet — the
 * mark is what lets the closer take it away instead. A flag rather than a
 * third `kind` because a one-off task is the same shape as any other; only its
 * fate at the end of the day differs.
 */
export interface Task {
  kind: "task";
  id: string;
  text: string;
  target: number;
  count: number;
  important: boolean;
  once: boolean;
}

/** A heading with tasks under it. Groups never nest — that is the whole point. */
export interface Group {
  kind: "group";
  id: string;
  title: string;
  collapsed: boolean;
  important: boolean;
  items: Task[];
}

/** One ordered array of these is the list. Position is the ordering. */
export type Node = Task | Group;

export interface State {
  v: 1;
  /** The only timestamp in the app: set on first activity, cleared when the day ends. */
  openedAt: number | null;
  list: Node[];
}

export const SCHEMA_VERSION = 1 as const;

export const LIMITS = {
  text: 200,
  target: 99,
} as const;
