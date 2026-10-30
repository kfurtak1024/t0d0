import { allTasks } from "../../src/progress";
import * as T from "../../src/transitions";
import type { Group, State, Task } from "../../src/types";
import { group, task } from "../builders";

/*
 * Helpers every transitions file shares: a list said as its shape, and read
 * back as one.
 */

export const NOW = 1_000_000;

export const empty = (): State => ({ v: 1, openedAt: null, list: [] });

export const build = (inputs: string[]): State => {
  let state = empty();
  let dest: string | null = null;
  for (const input of inputs) {
    const result = T.add(state, input, dest, NOW);
    state = result.state;
    dest = result.destId;
  }
  return state;
};

export const texts = (state: State): string[] => allTasks(state.list).map((t) => t.text);

/*
 * Reordering is about arrangement, so these two say the arrangement out loud:
 * "# X" is a group, two leading spaces mean nested. `shape` is the inverse of
 * `rows`, which makes a move test read as before-and-after pictures.
 */
export const rows = (...spec: string[]): State => {
  const state = empty();
  for (const row of spec) {
    if (row.startsWith("# ")) {
      state.list.push(group(row.slice(2)));
      continue;
    }
    const item = task(row.trim());
    const last = state.list[state.list.length - 1];
    if (row.startsWith("  ") && last?.kind === "group") last.items.push(item);
    else state.list.push(item);
  }
  return state;
};

export const shape = (state: State): string[] =>
  state.list.flatMap((node) =>
    node.kind === "group"
      ? [`# ${node.title}`, ...node.items.map((task) => `  ${task.text}`)]
      : [node.text],
  );
export const groupOf = (state: State, title: string): Group =>
  state.list.find((n): n is Group => n.kind === "group" && n.title === title)!;
export const taskOf = (state: State, text: string): Task =>
  allTasks(state.list).find((t) => t.text === text)!;
