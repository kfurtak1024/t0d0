import { parse } from "./parse";
import { allTasks } from "./progress";
import { LIMITS } from "./types";
import type { Group, Node, State, Task } from "./types";

/**
 * Every state change lives here as a pure `State -> State` function, so the
 * rules can be tested without a DOM. Nothing in this file touches storage,
 * rendering, or the clock beyond the `now` it is handed.
 */

const clone = (state: State): State => structuredClone(state);

export const findGroup = (state: State, id: string): Group | undefined =>
  state.list.find((node): node is Group => node.kind === "group" && node.id === id);

export const findTask = (state: State, id: string): Task | undefined =>
  allTasks(state.list).find((task) => task.id === id);

/** The group a task sits in, or undefined when it lives at the root. */
const ownerOf = (state: State, id: string): Group | undefined =>
  state.list.find(
    (node): node is Group => node.kind === "group" && node.items.some((task) => task.id === id),
  );

/** Mark the day as begun on the first sign of activity. */
const open = (state: State, now: number): void => {
  state.openedAt ??= now;
};

export interface AddResult {
  state: State;
  /** Where the next item should land — creating a group aims at it. */
  destId: string | null;
  added: Node | null;
}

export function add(state: State, input: string, destId: string | null, now: number): AddResult {
  const node = parse(input);
  if (!node) return { state, destId, added: null };

  const next = clone(state);
  open(next, now);

  if (node.kind === "group") {
    next.list.push(node);
    return { state: next, destId: node.id, added: node };
  }

  const target = destId === null ? undefined : findGroup(next, destId);
  if (target) {
    target.items.push(node);
    target.collapsed = false;
  } else {
    next.list.push(node);
  }
  return { state: next, destId, added: node };
}

export function bump(state: State, id: string, delta: number, now: number): State {
  const next = clone(state);
  const task = findTask(next, id);
  if (!task) return state;
  task.count = Math.max(0, Math.min(task.target, task.count + delta));
  open(next, now);
  return next;
}

/** Re-parse edited text so `[n]` stays editable after creation. */
export function retitle(state: State, id: string, value: string, isGroup: boolean): State {
  const next = clone(state);

  if (isGroup) {
    const group = findGroup(next, id);
    const title = value.trim().replace(/^#\s*/, "").slice(0, LIMITS.text);
    if (!group || !title) return state;
    group.title = title;
    return next;
  }

  const task = findTask(next, id);
  const parsed = parse(value);
  if (!task || parsed?.kind !== "task") return state;
  task.text = parsed.text;
  task.target = parsed.target;
  task.count = Math.min(task.count, task.target);
  return next;
}

/** Deleting a group takes its items with it; undo is the safety net. */
export function remove(state: State, id: string): State {
  const next = clone(state);
  const owner = ownerOf(next, id);
  if (owner) {
    owner.items = owner.items.filter((task) => task.id !== id);
  } else {
    next.list = next.list.filter((node) => node.id !== id);
  }
  return next;
}

export function toggleCollapse(state: State, id: string): State {
  const next = clone(state);
  const group = findGroup(next, id);
  if (!group) return state;
  group.collapsed = !group.collapsed;
  return next;
}

export type MoveDirection = "in" | "out";

/** Whether Tab / Shift-Tab has anywhere to put this task. */
export function canMove(state: State, id: string, dir: MoveDirection): boolean {
  const owner = ownerOf(state, id);
  if (dir === "out") return owner !== undefined;
  if (owner) return false;
  const index = state.list.findIndex((node) => node.id === id);
  if (index < 0) return false;
  return state.list.slice(0, index).some((node) => node.kind === "group");
}

/** Move a task into the group above it, or back out to the root beneath its group. */
export function move(state: State, id: string, dir: MoveDirection): State {
  if (!canMove(state, id, dir)) return state;
  const next = clone(state);

  if (dir === "in") {
    const index = next.list.findIndex((node) => node.id === id);
    const task = next.list[index];
    if (index < 0 || task?.kind !== "task") return state;

    let group: Group | undefined;
    for (let i = index - 1; i >= 0; i--) {
      const candidate = next.list[i];
      if (candidate?.kind === "group") {
        group = candidate;
        break;
      }
    }
    if (!group) return state;

    next.list.splice(index, 1);
    group.items.push(task);
    group.collapsed = false;
    return next;
  }

  const owner = ownerOf(next, id);
  const task = owner?.items.find((item) => item.id === id);
  if (!owner || !task) return state;
  owner.items = owner.items.filter((item) => item.id !== id);
  const at = next.list.findIndex((node) => node.id === owner.id);
  next.list.splice(at + 1, 0, task);
  return next;
}

/** End of day: zero every count, keep the curated list, forget the start time. */
export function clearTicks(state: State): State {
  const next = clone(state);
  for (const task of allTasks(next.list)) task.count = 0;
  next.openedAt = null;
  return next;
}

/** Start over completely. Undoable, but deliberately hard to reach. */
export function eraseAll(state: State): State {
  return { v: state.v, openedAt: null, list: [] };
}
