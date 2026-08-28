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

/** True only for a non-empty list with everything finished — 0/0 is not 100%. */
export function isComplete(tasks: Task[]): boolean {
  return tasks.length > 0 && tasks.every(isDone);
}

/**
 * Split the list into the work that carries the day and the work that fills it.
 *
 * A task is important if it is marked, or if it sits in a group that is —
 * finishing an important group means finishing its items, so they are the same
 * obligation. An empty important group contributes no tasks and so cannot block
 * the gate, which is the same rule that keeps empty groups out of the ring.
 */
export function partition(list: Node[]): { important: Task[]; rest: Task[] } {
  const important: Task[] = [];
  const rest: Task[] = [];
  for (const node of list) {
    if (node.kind === "group") {
      for (const task of node.items)
        (node.important || task.important ? important : rest).push(task);
    } else {
      (node.important ? important : rest).push(node);
    }
  }
  return { important, rest };
}

export interface DayScore {
  /** Progress over the work that carries the day. 1 when none is marked. */
  important: number;
  /** Progress over everything else. 1 when there is none. */
  rest: number;
  /** Whether anything is marked at all — the gate is vacuous without it. */
  hasImportant: boolean;
  /** Every marked thing finished. Vacuously true when nothing is marked. */
  cleared: boolean;
  /** The day is a success: the important work done, the rest past the bar. */
  succeeded: boolean;
  /** Nothing left anywhere. */
  complete: boolean;
  total: number;
}

/**
 * How the day is going, as one verdict.
 *
 * Two gates rather than one number: the important work has to be finished, and
 * then enough of the rest — `bar` as a fraction. That is why an almost-perfect
 * day with one important thing outstanding is not a success, and why a day with
 * nothing marked can still be one.
 *
 * An empty list is never a success, for the same reason 0/0 is not 100%.
 */
export function scoreDay(state: State, bar: number): DayScore {
  const { important, rest } = partition(state.list);
  const total = important.length + rest.length;
  // Vacuously complete when the set is empty, so a day with nothing marked is
  // gated on the rest alone rather than being stuck at zero forever.
  const importantProgress = important.length > 0 ? progress(important) : 1;
  const restProgress = rest.length > 0 ? progress(rest) : 1;
  const cleared = importantProgress >= 1;

  return {
    important: importantProgress,
    rest: restProgress,
    hasImportant: important.length > 0,
    cleared,
    succeeded: total > 0 && cleared && restProgress >= bar,
    /*
     * Asked directly rather than inferred from the two progress figures. It
     * keeps one definition of "done with the day" instead of two that could
     * drift, and `every(isDone)` cannot round the way a mean approaching 1
     * could.
     */
    complete: isComplete([...important, ...rest]),
    total,
  };
}

/**
 * The day's colour, as a rainbow with its landmarks pinned to the two gates:
 * red at nothing done, green the moment the important work lands, blue the
 * moment the rest clears the bar, violet at everything.
 *
 * Exported because the celebrations wear them too: a burst fires at the moment
 * the ring turns, so the two have to be the same colour by construction rather
 * than by the same three numbers being typed out twice.
 */
export const HUE = {
  red: 25,
  green: 150,
  blue: 260,
  violet: 320,
} as const;

const mix = (from: number, to: number, k: number): number =>
  from + (to - from) * Math.min(1, Math.max(0, k));

/**
 * Where the day sits on that rainbow.
 *
 * Green is a landmark only when there was important work to earn it with. With
 * nothing marked the sweep runs straight from red into blue and green is merely
 * a colour it passes through — otherwise a list with nothing important would
 * open on green, which reads as "you are safe" before a single tick.
 */
export function dayHue(score: DayScore, bar: number): number {
  if (score.total === 0) return HUE.red;
  if (score.complete) return HUE.violet;
  if (score.hasImportant && !score.cleared) return mix(HUE.red, HUE.green, score.important);

  const from = score.hasImportant ? HUE.green : HUE.red;
  /*
   * Neither divisor can be zero, and neither needs guarding:
   *
   * `rest < bar` cannot hold for a bar of 0, since progress is never negative.
   * And reaching the last line with a bar of 1 would need `rest >= 1` on a
   * non-empty list whose important work is already done — which is `complete`,
   * and returned violet several lines ago.
   */
  if (score.rest < bar) return mix(from, HUE.blue, score.rest / bar);
  return mix(HUE.blue, HUE.violet, (score.rest - bar) / (1 - bar));
}

export interface DaySummary {
  done: number;
  total: number;
  clearedGroups: string[];
  elapsedMs: number | null;
  /** The verdict the card reports before it clears anything. */
  score: DayScore;
}

export function summarise(state: State, now: number, bar: number): DaySummary {
  const tasks = allTasks(state.list);
  return {
    done: tasks.filter(isDone).length,
    total: tasks.length,
    score: scoreDay(state, bar),
    clearedGroups: state.list
      .filter((node) => node.kind === "group" && node.items.length > 0 && node.items.every(isDone))
      .map((node) => (node as { title: string }).title),
    elapsedMs: state.openedAt === null ? null : Math.max(0, now - state.openedAt),
  };
}
