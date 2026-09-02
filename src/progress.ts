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
  /**
   * What actually got finished, named, in the order the list keeps them.
   *
   * The count above says how much; this says what. The closing card reports
   * both, because a number is not recognition — and the card's other list
   * names what is still outstanding, so naming only that made the one ritual
   * the app exists for a record of what you missed.
   */
  finished: string[];
  elapsedMs: number | null;
  /** The verdict the card reports before it clears anything. */
  score: DayScore;
}

export function summarise(state: State, now: number, bar: number): DaySummary {
  const tasks = allTasks(state.list);
  const finished = tasks.filter(isDone);
  return {
    done: finished.length,
    total: tasks.length,
    score: scoreDay(state, bar),
    finished: finished.map((task) => task.text),
    elapsedMs: state.openedAt === null ? null : Math.max(0, now - state.openedAt),
  };
}

/**
 * Where a hue sits on the day's rainbow, as a fraction from red to violet.
 *
 * The card draws the rainbow as a rail and puts a dot at `dayHue`'s answer, so
 * the dot and the day ring are the same colour in the same place by
 * construction rather than by two sets of numbers agreeing.
 *
 * The gates are landmarks *on* that rail, not divisions of it: with nothing
 * marked the sweep runs straight from red to blue, and green is a colour it
 * passes through rather than a place — so the card must not draw a green
 * landmark there, the same rule `dayHue` follows.
 */
export const hueMark = (hue: number): number => (hue - HUE.red) / (HUE.violet - HUE.red);

/**
 * One of the day's two gates, as both cards report it.
 *
 * The shape rather than the pixels: which gates exist at all, what each is
 * called, how full its bar is and where its threshold sits. It lives here
 * beside the scoring it is derived from, and out of `src/ui`, because every
 * one of those is decidable without a DOM and the rules are not obvious —
 * the Important gate is *absent* rather than empty when nothing is marked, and
 * only the second gate has a threshold short of everything.
 */
export interface Gate {
  /** Which gate this is, for a caller that needs to tell them apart. */
  key: "important" | "rest";
  name: string;
  done: number;
  total: number;
  /** How much of it is done, 0 to 1 — the mean the ring uses, not done/total. */
  fill: number;
  /**
   * Where this gate is cleared, as a fraction, or null when there is no line
   * short of finishing it. The marked work is not negotiable, so its gate has
   * no threshold; the rest clears at `prefs.successAt`.
   */
  threshold: number | null;
  /** Whether the gate is currently met. */
  met: boolean;
  /** Marked work still to do. Only ever non-empty on the Important gate. */
  outstanding: Task[];
}

/**
 * The gates this day actually has.
 *
 * Empty for an empty list — no obligations were taken on, so there is nothing
 * to report and neither card draws anything. The Important gate is dropped
 * entirely when nothing is marked, rather than shown at "0 of 0": that would
 * claim an obligation nobody made, and `dayHue` does not draw its landmark
 * there either.
 */
export function dayGates(state: State, bar: number): Gate[] {
  const { important, rest } = partition(state.list);
  if (important.length === 0 && rest.length === 0) return [];

  const restGate: Gate = {
    key: "rest",
    // It is only "everything else" when there is something else to be beside.
    name: important.length > 0 ? "Everything else" : "Everything",
    done: rest.filter(isDone).length,
    total: rest.length,
    fill: rest.length > 0 ? progress(rest) : 1,
    threshold: bar,
    // Vacuously met when there is nothing but marked work, the same way
    // `scoreDay` reads it.
    met: rest.length === 0 || progress(rest) >= bar,
    outstanding: [],
  };
  if (important.length === 0) return [restGate];

  return [
    {
      key: "important",
      name: "Important",
      done: important.filter(isDone).length,
      total: important.length,
      fill: progress(important),
      threshold: null,
      met: important.every(isDone),
      outstanding: important.filter((task) => !isDone(task)),
    },
    restGate,
  ];
}

/** Every marked thing still to do, in the order the list keeps them. */
export function outstandingImportant(list: Node[]): Task[] {
  return partition(list).important.filter((task) => !isDone(task));
}

const EPSILON = 1e-9;

/**
 * The fewest tasks that, finished, would carry the rest of the list over the bar.
 *
 * Not `ceil(bar × n − sum)`: that counts every remaining task as a whole point,
 * which a part-counted `[3]` item is not — it can name a number that does not
 * actually reach, and a card that says "one more" and is wrong is a card nobody
 * believes twice. Taking the largest remaining contributions first is the
 * fewest by construction, since no task can add more than one.
 *
 * Zero when the bar is already cleared, and zero when there is nothing but
 * marked work — an empty set clears it vacuously, the same way `scoreDay` reads
 * it.
 */
export function stepsToBar(state: State, bar: number): number {
  const { rest } = partition(state.list);
  if (rest.length === 0) return 0;

  const remaining = rest
    .map((task) => 1 - Math.min(1, task.count / task.target))
    .filter((left) => left > 0)
    .sort((a, b) => b - a);

  let short = bar * rest.length - (rest.length - remaining.reduce((sum, left) => sum + left, 0));
  let steps = 0;
  for (const left of remaining) {
    if (short <= EPSILON) break;
    short -= left;
    steps++;
  }
  return steps;
}
