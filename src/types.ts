/** A single thing to do. `target` is 1 for a plain checkbox, >1 for `make calls [3]`. */
export interface Task {
  kind: "task";
  id: string;
  text: string;
  target: number;
  count: number;
}

/** A heading with tasks under it. Groups never nest — that is the whole point. */
export interface Group {
  kind: "group";
  id: string;
  title: string;
  collapsed: boolean;
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
