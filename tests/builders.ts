import type { Group, State, Task } from "../src/types";

/**
 * The one place a test spells out every field of the model.
 *
 * Each test file used to write its own task and state by hand, and they had
 * already drifted: three different signatures for `task`, and the e2e seed
 * leaving out `important` and `once` for `normalize()` to fill in. A field
 * added to the model has to be added here and nowhere else, which is the point.
 * Files keep their own shorthand — progress tests read best as `task("a", 1)` —
 * as one-line wrappers over these.
 *
 * Ids default to the text, so a list built here reads as its own shape.
 */
export const task = (text: string, fields: Partial<Omit<Task, "kind" | "text">> = {}): Task => ({
  kind: "task",
  id: text,
  text,
  target: 1,
  count: 0,
  important: false,
  once: false,
  ...fields,
});

export const group = (
  title: string,
  items: Task[] = [],
  fields: Partial<Omit<Group, "kind" | "title" | "items">> = {},
): Group => ({
  kind: "group",
  id: title,
  title,
  collapsed: false,
  important: false,
  items,
  ...fields,
});

export const state = (list: State["list"] = [], openedAt: number | null = null): State => ({
  v: 1,
  openedAt,
  list,
});
