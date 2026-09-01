import { isDone, outstandingImportant, partition, stepsToBar } from "../progress";
import type { State, Task } from "../types";

/** How many rows of marked work a card names before it stops listing them. */
const NAMED = 4;

/**
 * The day's two gates, as both cards report them.
 *
 * The numbers are shared because they are the same numbers — the day succeeds
 * on every marked thing being finished and the rest clearing the bar, whether
 * you are asking mid-morning or at the end. The *words* are not shared: the
 * caller supplies the note under the second gate, because one card is looking
 * forward ("one more clears the bar") and the other is reporting a day that is
 * over ("short of the bar"), and flattening that into one voice would make one
 * of them wrong.
 *
 * The Important gate is absent, not empty, when nothing is marked: a gate
 * showing "0 of 0" claims an obligation that was never taken on, and `dayHue`
 * does not draw its landmark either.
 */
export function dayGates(
  state: State,
  bar: number,
  note: (steps: number) => string,
): HTMLElement[] {
  const { important, rest } = partition(state.list);
  if (important.length === 0 && rest.length === 0) return [];

  const left = outstandingImportant(state.list);
  const steps = stepsToBar(state, bar);

  const restGate = gate(
    important.length > 0 ? "Everything else" : "Everything",
    tally(rest),
    rest.length === 0 ? "nothing here but marked work" : note(steps),
    [],
  );

  if (important.length === 0) return [restGate];
  return [gate("Important", tally(important), left.length === 0 ? "all done" : "", left), restGate];
}

const tally = (tasks: Task[]): string =>
  `${String(tasks.filter(isDone).length)} of ${String(tasks.length)}`;

function gate(name: string, count: string, note: string, items: Task[]): HTMLElement {
  const box = document.createElement("div");
  box.className = "gate";

  const head = document.createElement("div");
  head.className = "ghead-row";
  const title = document.createElement("span");
  title.className = "gname";
  title.textContent = name;
  const number = document.createElement("span");
  number.className = "gtally";
  number.textContent = count;
  head.append(title, number);
  box.append(head);

  if (items.length > 0) {
    const list = document.createElement("ul");
    list.className = "gitems";
    for (const task of items.slice(0, NAMED)) {
      const row = document.createElement("li");
      const pip = document.createElement("span");
      pip.className = "pip";
      pip.setAttribute("aria-hidden", "true");
      row.append(pip, document.createTextNode(task.text));
      list.append(row);
    }
    if (items.length > NAMED) {
      const more = document.createElement("li");
      more.className = "gmore";
      more.textContent = `and ${String(items.length - NAMED)} more`;
      list.append(more);
    }
    box.append(list);
  }

  if (note !== "") {
    const line = document.createElement("p");
    line.className = "gnote";
    line.textContent = note;
    box.append(line);
  }
  return box;
}
