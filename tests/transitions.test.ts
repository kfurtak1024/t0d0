import { describe, expect, it } from "vitest";
import { allTasks, isDone } from "../src/progress";
import * as T from "../src/transitions";
import type { Group, State, Task } from "../src/types";

const NOW = 1_000_000;

const empty = (): State => ({ v: 1, openedAt: null, list: [] });

const build = (inputs: string[]): State => {
  let state = empty();
  let dest: string | null = null;
  for (const input of inputs) {
    const result = T.add(state, input, dest, NOW);
    state = result.state;
    dest = result.destId;
  }
  return state;
};

const texts = (state: State): string[] => allTasks(state.list).map((t) => t.text);
const groupOf = (state: State, title: string): Group =>
  state.list.find((n): n is Group => n.kind === "group" && n.title === title)!;
const taskOf = (state: State, text: string): Task =>
  allTasks(state.list).find((t) => t.text === text)!;

describe("add", () => {
  it("appends a root task when nothing is aimed", () => {
    const state = build(["shopping"]);
    expect(state.list).toHaveLength(1);
    expect(state.list[0]).toMatchObject({ kind: "task", text: "shopping" });
  });

  it("aims at a group the moment it is created, so typing top-to-bottom works", () => {
    const state = build(["# Morning", "eat breakfast", "walk the dog"]);
    expect(state.list).toHaveLength(1);
    expect(groupOf(state, "Morning").items.map((t) => t.text)).toEqual([
      "eat breakfast",
      "walk the dog",
    ]);
  });

  it("re-aims when a second group is created", () => {
    const state = build(["# Morning", "a", "# Work", "b"]);
    expect(groupOf(state, "Morning").items).toHaveLength(1);
    expect(groupOf(state, "Work").items).toHaveLength(1);
  });

  it("expands a collapsed destination so the new item is visible", () => {
    let state = build(["# Morning"]);
    state = T.toggleCollapse(state, groupOf(state, "Morning").id);
    expect(groupOf(state, "Morning").collapsed).toBe(true);

    state = T.add(state, "a", groupOf(state, "Morning").id, NOW).state;
    expect(groupOf(state, "Morning").collapsed).toBe(false);
  });

  it("falls back to the root when the aimed group is gone", () => {
    const state = T.add(empty(), "orphan", "missing-id", NOW).state;
    expect(state.list[0]).toMatchObject({ kind: "task", text: "orphan" });
  });

  it("opens the day on the first item and never moves it afterwards", () => {
    const first = T.add(empty(), "a", null, 500).state;
    expect(first.openedAt).toBe(500);
    expect(T.add(first, "b", null, 900).state.openedAt).toBe(500);
  });

  it("returns the state untouched for input that parses to nothing", () => {
    const before = build(["a"]);
    const result = T.add(before, "   ", null, NOW);
    expect(result.added).toBeNull();
    expect(result.state).toBe(before);
  });
});

describe("bump", () => {
  it("counts up and stops at the target", () => {
    let state = build(["make calls [3]"]);
    const id = taskOf(state, "make calls").id;
    for (let i = 0; i < 5; i++) state = T.bump(state, id, 1, NOW);
    expect(taskOf(state, "make calls").count).toBe(3);
    expect(isDone(taskOf(state, "make calls"))).toBe(true);
  });

  it("counts back down and stops at zero", () => {
    let state = build(["a"]);
    const id = taskOf(state, "a").id;
    state = T.bump(state, id, -1, NOW);
    expect(taskOf(state, "a").count).toBe(0);
  });

  it("opens the day on the first tick", () => {
    const state = build(["a"]);
    const reopened: State = { ...state, openedAt: null };
    expect(T.bump(reopened, taskOf(state, "a").id, 1, 777).openedAt).toBe(777);
  });
});

describe("retitle", () => {
  it("re-parses the quantity so [n] stays editable", () => {
    let state = build(["make calls [3]"]);
    const id = taskOf(state, "make calls").id;
    state = T.retitle(state, id, "make calls [5]", false);
    expect(taskOf(state, "make calls").target).toBe(5);
  });

  it("clamps the count when the target shrinks below it", () => {
    let state = build(["make calls [5]"]);
    const id = taskOf(state, "make calls").id;
    state = T.bump(state, id, 4, NOW);
    state = T.retitle(state, id, "make calls [2]", false);
    expect(taskOf(state, "make calls")).toMatchObject({ target: 2, count: 2 });
  });

  it("refuses to blank a title", () => {
    const state = build(["# Morning"]);
    expect(T.retitle(state, groupOf(state, "Morning").id, "   ", true)).toBe(state);
  });

  it("strips a leading hash from an edited group title", () => {
    let state = build(["# Morning"]);
    state = T.retitle(state, groupOf(state, "Morning").id, "# Evening", true);
    expect(groupOf(state, "Evening")).toBeDefined();
  });
});

describe("remove", () => {
  it("removes a root task", () => {
    let state = build(["a", "b"]);
    state = T.remove(state, taskOf(state, "a").id);
    expect(texts(state)).toEqual(["b"]);
  });

  it("removes a task from inside its group", () => {
    let state = build(["# Morning", "a", "b"]);
    state = T.remove(state, taskOf(state, "a").id);
    expect(groupOf(state, "Morning").items.map((t) => t.text)).toEqual(["b"]);
  });

  it("takes a group's items with it rather than orphaning them", () => {
    let state = build(["# Morning", "a", "b"]);
    state = T.remove(state, groupOf(state, "Morning").id);
    expect(state.list).toEqual([]);
  });
});

describe("move", () => {
  it("pulls a root task into the group above it", () => {
    let state = build(["# Morning", "a"]);
    // Put a task at the root beneath the group.
    state = T.add(state, "loose", null, NOW).state;
    const id = taskOf(state, "loose").id;

    expect(T.canMove(state, id, "in")).toBe(true);
    state = T.move(state, id, "in");
    expect(groupOf(state, "Morning").items.map((t) => t.text)).toEqual(["a", "loose"]);
  });

  it("pushes a task back out, directly beneath its old group", () => {
    let state = build(["# Morning", "a"]);
    const id = taskOf(state, "a").id;

    expect(T.canMove(state, id, "out")).toBe(true);
    state = T.move(state, id, "out");
    expect(groupOf(state, "Morning").items).toEqual([]);
    expect(state.list[1]).toMatchObject({ kind: "task", text: "a" });
  });

  it("refuses to move in when no group precedes the task", () => {
    const state = build(["a", "# Later"]);
    expect(T.canMove(state, taskOf(state, "a").id, "in")).toBe(false);
    expect(T.move(state, taskOf(state, "a").id, "in")).toBe(state);
  });

  it("refuses to move out of nothing", () => {
    const state = build(["a"]);
    expect(T.canMove(state, taskOf(state, "a").id, "out")).toBe(false);
  });

  it("refuses to move a task that is already grouped further in", () => {
    const state = build(["# Morning", "a"]);
    expect(T.canMove(state, taskOf(state, "a").id, "in")).toBe(false);
  });
});

describe("clearTicks", () => {
  it("zeroes every count, keeps the list, and closes the day", () => {
    let state = build(["# Morning", "a", "make calls [3]"]);
    for (const task of allTasks(state.list)) state = T.bump(state, task.id, 2, NOW);
    expect(allTasks(state.list).some((t) => t.count > 0)).toBe(true);

    state = T.clearTicks(state);
    expect(allTasks(state.list).every((t) => t.count === 0)).toBe(true);
    expect(texts(state)).toEqual(["a", "make calls"]);
    expect(state.openedAt).toBeNull();
  });

  it("leaves group structure and collapsed state alone", () => {
    let state = build(["# Morning", "a"]);
    state = T.toggleCollapse(state, groupOf(state, "Morning").id);
    state = T.clearTicks(state);
    expect(groupOf(state, "Morning").collapsed).toBe(true);
  });
});

describe("eraseAll", () => {
  it("empties the list and closes the day", () => {
    const state = build(["# Morning", "a", "b", "# Work", "c"]);
    const erased = T.eraseAll(state);
    expect(erased.list).toEqual([]);
    expect(erased.openedAt).toBeNull();
    expect(erased.v).toBe(1);
  });

  it("leaves the state it was given alone", () => {
    const state = build(["a"]);
    T.eraseAll(state);
    expect(state.list).toHaveLength(1);
  });

  it("is safe on an already empty list", () => {
    expect(T.eraseAll(empty()).list).toEqual([]);
  });
});

describe("purity", () => {
  it("never mutates the state it is given", () => {
    const before = build(["# Morning", "a"]);
    const snapshot = JSON.stringify(before);

    T.bump(before, taskOf(before, "a").id, 1, NOW);
    T.remove(before, taskOf(before, "a").id);
    T.clearTicks(before);
    T.toggleCollapse(before, groupOf(before, "Morning").id);

    expect(JSON.stringify(before)).toBe(snapshot);
  });
});
