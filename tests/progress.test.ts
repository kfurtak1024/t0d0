import { describe, expect, it } from "vitest";
import { allTasks, isComplete, isDone, progress, summarise } from "../src/progress";
import type { Group, State, Task } from "../src/types";

const task = (text: string, count = 0, target = 1): Task => ({
  kind: "task",
  id: text,
  text,
  target,
  count,
});

const group = (title: string, items: Task[], collapsed = false): Group => ({
  kind: "group",
  id: title,
  title,
  collapsed,
  items,
});

const state = (list: State["list"], openedAt: number | null = null): State => ({
  v: 1,
  openedAt,
  list,
});

describe("progress", () => {
  it("is zero for an empty list", () => {
    expect(progress([])).toBe(0);
  });

  it("counts each task equally regardless of its quantity", () => {
    // Were this sum(count)/sum(target), the [20] item would drown the other one.
    expect(progress([task("a", 1, 1), task("b", 0, 20)])).toBeCloseTo(0.5);
  });

  it("registers partial progress on a counted task", () => {
    expect(progress([task("calls", 1, 3)])).toBeCloseTo(1 / 3);
  });

  it("never exceeds 1 if a count somehow overshoots", () => {
    expect(progress([task("a", 9, 1)])).toBe(1);
  });
});

describe("isComplete", () => {
  it("is false for an empty list — 0/0 is not 100%", () => {
    expect(isComplete([])).toBe(false);
  });

  it("is true only when every task reaches its target", () => {
    expect(isComplete([task("a", 1), task("b", 2, 3)])).toBe(false);
    expect(isComplete([task("a", 1), task("b", 3, 3)])).toBe(true);
  });
});

describe("allTasks", () => {
  it("flattens groups while keeping list order", () => {
    const list = [group("Morning", [task("a"), task("b")]), task("c")];
    expect(allTasks(list).map((t) => t.text)).toEqual(["a", "b", "c"]);
  });

  it("ignores empty groups", () => {
    expect(allTasks([group("Empty", []), task("a")])).toHaveLength(1);
  });
});

describe("isDone", () => {
  it("is derived from count and target, never stored", () => {
    expect(isDone(task("a", 0))).toBe(false);
    expect(isDone(task("a", 1))).toBe(true);
    expect(isDone(task("a", 2, 3))).toBe(false);
    expect(isDone(task("a", 3, 3))).toBe(true);
  });
});

describe("summarise", () => {
  it("reports done, total, and which groups cleared", () => {
    const s = state([
      group("Morning", [task("a", 1), task("b", 1)]),
      group("Work", [task("c", 0)]),
      task("d", 1),
    ]);
    expect(summarise(s, 0)).toMatchObject({
      done: 3,
      total: 4,
      clearedGroups: ["Morning"],
      elapsedMs: null,
    });
  });

  it("does not count an empty group as cleared", () => {
    expect(summarise(state([group("Empty", [])]), 0).clearedGroups).toEqual([]);
  });

  it("reports elapsed time once the day has opened", () => {
    expect(summarise(state([task("a")], 1000), 61_000).elapsedMs).toBe(60_000);
  });
});
