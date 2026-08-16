import type { Node, State, Task } from "./types";

/** Every task in the list, flattened out of its groups. */
export const allTasks = (list: Node[]): Task[] =>
  list.flatMap((node) => (node.kind === "group" ? node.items : [node]));

export const isDone = (task: Task): boolean => task.count >= task.target;

/**
 * Progress as the mean of each task's own completion.
 *
 * Deliberately not `sum(count) / sum(target)`: that lets a single `[20]` item
 * swamp four ordinary ones, which reads wrong on a list where every line is
 * "a thing I meant to do today".
 */
export function progress(tasks: Task[]): number {
  if (tasks.length === 0) return 0;
  const total = tasks.reduce((sum, task) => sum + Math.min(1, task.count / task.target), 0);
  return total / tasks.length;
}

export const overallProgress = (state: State): number => progress(allTasks(state.list));

/** True only for a non-empty list with everything finished — 0/0 is not 100%. */
export function isComplete(tasks: Task[]): boolean {
  return tasks.length > 0 && tasks.every(isDone);
}

export interface DaySummary {
  done: number;
  total: number;
  clearedGroups: string[];
  elapsedMs: number | null;
}

export function summarise(state: State, now: number): DaySummary {
  const tasks = allTasks(state.list);
  return {
    done: tasks.filter(isDone).length,
    total: tasks.length,
    clearedGroups: state.list
      .filter((node) => node.kind === "group" && node.items.length > 0 && node.items.every(isDone))
      .map((node) => (node as { title: string }).title),
    elapsedMs: state.openedAt === null ? null : Math.max(0, now - state.openedAt),
  };
}
