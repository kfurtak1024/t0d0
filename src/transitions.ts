import { parse, parseTitle } from "./parse";
import { allTasks, isDone } from "./progress";
import { SCHEMA_VERSION } from "./types";
import type { Group, Node, State, Task } from "./types";

/**
 * Every state change lives here as a pure `State -> State` function, so the
 * rules can be tested without a DOM. Nothing in this file touches storage,
 * rendering, or the clock beyond the `now` it is handed.
 */

const clone = (state: State): State => structuredClone(state);

/**
 * What a first run starts from: nothing.
 *
 * Deliberately not a demo list. Sample items are someone else's day sitting in
 * the one place this app promises is yours, and the first thing a new user has
 * to do is delete them. The empty state says what to type instead.
 */
export const blank = (): State => ({ v: SCHEMA_VERSION, openedAt: null, list: [] });

export const findGroup = (state: State, id: string): Group | undefined =>
  state.list.find((node): node is Group => node.kind === "group" && node.id === id);

export const findTask = (state: State, id: string): Task | undefined =>
  allTasks(state.list).find((task) => task.id === id);

/** The group a task sits in, or undefined when it lives at the root. */
export const ownerOf = (state: State, id: string): Group | undefined =>
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

/** Re-parse edited text so `[n]` and the `!` mark stay editable after creation. */
export function retitle(state: State, id: string, value: string, isGroup: boolean): State {
  const next = clone(state);

  if (isGroup) {
    const group = findGroup(next, id);
    const head = parseTitle(value);
    if (!group || !head) return state;
    group.title = head.title;
    group.important = head.important;
    return next;
  }

  const task = findTask(next, id);
  const parsed = parse(value);
  if (!task || parsed?.kind !== "task") return state;
  task.text = parsed.text;
  task.target = parsed.target;
  task.important = parsed.important;
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

/** Fold a group shut, no-op when it already is — auto-collapse leans on this. */
export function collapse(state: State, id: string): State {
  const before = findGroup(state, id);
  if (!before || before.collapsed) return state;
  return toggleCollapse(state, id);
}

export type ReorderDirection = "up" | "down";

/**
 * How far a single step is allowed to reach.
 *
 * `list` treats the list as one sequence, so a step crosses group boundaries.
 * `level` keeps a row among its own siblings: an item in a group moves within
 * that group and stops at its ends; an item at the root moves past whole groups
 * rather than into them.
 *
 * Both exist because the two ways of asking mean different things. Dragging is
 * direct manipulation — the pointer is over a place, and that is where the row
 * goes, nesting included. "Move up" is a command about the row you are looking
 * at, and a command that quietly changed an item's nesting would be doing more
 * than it said. Changing level has its own commands: Tab / Shift-Tab, and the
 * menu's "Into" / "Out of".
 */
export type ReorderScope = "list" | "level";

/** Whether the row has a neighbouring position to take, within `scope`. */
export function canReorder(
  state: State,
  id: string,
  dir: ReorderDirection,
  scope: ReorderScope = "list",
): boolean {
  const owner = ownerOf(state, id);
  if (owner) {
    if (scope === "list") {
      // A grouped task can always step at least as far as the root beside it.
      return true;
    }
    const index = owner.items.findIndex((task) => task.id === id);
    if (index < 0) return false;
    return dir === "up" ? index > 0 : index < owner.items.length - 1;
  }

  const index = state.list.findIndex((node) => node.id === id);
  if (index < 0) return false;
  return dir === "up" ? index > 0 : index < state.list.length - 1;
}

/**
 * Move a row one step through the list as it reads on screen.
 *
 * Within `list` scope that step crosses group boundaries deliberately: a task at
 * the top of a group steps out above it, and a task that walks into a group
 * enters at the near end. So every position is reachable by repeating one key.
 *
 * Either way each step is its own inverse, which is what makes holding the key
 * down feel like dragging rather than like guessing.
 */
export function reorder(
  state: State,
  id: string,
  dir: ReorderDirection,
  scope: ReorderScope = "list",
): State {
  if (!canReorder(state, id, dir, scope)) return state;
  const next = clone(state);
  const step = dir === "up" ? -1 : 1;

  const owner = ownerOf(next, id);
  if (owner) {
    const index = owner.items.findIndex((task) => task.id === id);
    const task = owner.items[index];
    if (!task) return state;

    const neighbour = owner.items[index + step];
    if (neighbour) {
      owner.items[index] = neighbour;
      owner.items[index + step] = task;
      return next;
    }

    // Off the end of the group. Staying at this level means staying put.
    if (scope === "level") return state;

    // Otherwise land at the root on the near side of the group.
    owner.items.splice(index, 1);
    const at = next.list.findIndex((node) => node.id === owner.id);
    next.list.splice(dir === "up" ? at : at + 1, 0, task);
    return next;
  }

  const index = next.list.findIndex((node) => node.id === id);
  const node = next.list[index];
  const neighbour = next.list[index + step];
  if (!node || !neighbour) return state;

  // A group moves as one block; only a task can be swallowed by another group,
  // and only when the step is allowed to change what level the task is on.
  if (scope === "list" && node.kind === "task" && neighbour.kind === "group") {
    next.list.splice(index, 1);
    if (dir === "up") neighbour.items.push(node);
    else neighbour.items.unshift(node);
    // Entering a folded group would look like the item vanishing.
    neighbour.collapsed = false;
    return next;
  }

  next.list[index] = neighbour;
  next.list[index + step] = node;
  return next;
}

/**
 * A row with nothing left to do today: a ticked task, or a group whose items are
 * all done. An empty group is not finished, it is simply empty — the same rule
 * that keeps it out of the progress ring.
 */
export const isFinished = (node: Node): boolean =>
  node.kind === "task" ? isDone(node) : node.items.length > 0 && node.items.every(isDone);

/** The row `id` names, if it is one of the list's own — never a nested task. */
export const findRow = (state: State, id: string): Node | undefined =>
  state.list.find((node) => node.id === id);

/**
 * Drop a finished row to the foot of the unfinished list.
 *
 * It stops above the run of finished rows already resting at the bottom, so the
 * pile stays in the order it was earned rather than each new arrival burying the
 * last. Everything above it is still work, which is the point: what is left fits
 * on one screen for longer.
 *
 * A ticked task and a finished group travel the same way — the list does not
 * care which kind of row is done with. Nested tasks stay put: a group is one
 * block, and shuffling inside it would move rows nobody was looking at.
 *
 * Built out of the same single step everything else uses — one level-scoped
 * `reorder` at a time — rather than computing a destination index. A second idea
 * of where a row belongs is exactly what that step exists to avoid.
 */
export function sink(state: State, id: string): State {
  let next = state;
  for (;;) {
    const index = next.list.findIndex((node) => node.id === id);
    const below = index < 0 ? undefined : next.list[index + 1];
    if (!below || isFinished(below)) return next;

    const stepped = reorder(next, id, "down", "level");
    // reorder declines in place rather than throwing, and a decline it is not
    // our business to predict would spin here forever.
    if (stepped === next) return next;
    next = stepped;
  }
}

export type MoveDirection = "in" | "out";

/** The nearest group above a root task — the one it would move into. */
export function groupAbove(state: State, id: string): Group | undefined {
  const index = state.list.findIndex((node) => node.id === id);
  if (index < 0 || state.list[index]?.kind !== "task") return undefined;
  for (let i = index - 1; i >= 0; i--) {
    const candidate = state.list[i];
    if (candidate?.kind === "group") return candidate;
  }
  return undefined;
}

/** Whether Tab / Shift-Tab has anywhere to put this task. */
export function canMove(state: State, id: string, dir: MoveDirection): boolean {
  const owner = ownerOf(state, id);
  // Only tasks nest, so a group can never answer yes — the ⋯ menu asks about
  // rows of both kinds, where Tab only ever reached a task.
  if (dir === "out") return owner !== undefined;
  if (owner) return false;
  return groupAbove(state, id) !== undefined;
}

/** Move a task into the group above it, or back out to the root beneath its group. */
export function move(state: State, id: string, dir: MoveDirection): State {
  if (!canMove(state, id, dir)) return state;
  const next = clone(state);

  if (dir === "in") {
    const index = next.list.findIndex((node) => node.id === id);
    const task = next.list[index];
    if (index < 0 || task?.kind !== "task") return state;

    const group = groupAbove(next, id);
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

/** End of day: zero every count, unfold every group, keep the curated list, forget the start time. */
export function clearTicks(state: State): State {
  const next = clone(state);
  for (const task of allTasks(next.list)) task.count = 0;
  // Folds were earned by yesterday's ticks, and those are gone. Leaving them
  // shut would open tomorrow on a list that hides most of itself, and the first
  // thing anyone did would be to click every chevron.
  for (const node of next.list) if (node.kind === "group") node.collapsed = false;
  next.openedAt = null;
  return next;
}

/** Start over completely. Undoable, but deliberately hard to reach. */
export function eraseAll(state: State): State {
  return { v: state.v, openedAt: null, list: [] };
}
