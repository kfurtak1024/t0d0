import { describe, expect, it } from "vitest";
import {
  allTasks,
  dayHue,
  isComplete,
  isDone,
  partition,
  progress,
  scoreDay,
  summarise,
} from "../src/progress";
import type { Group, State, Task } from "../src/types";

const task = (text: string, count = 0, target = 1): Task => ({
  kind: "task",
  id: text,
  text,
  target,
  count,
  important: false,
});

const key = (text: string, count = 0, target = 1): Task => ({
  ...task(text, count, target),
  important: true,
});

const group = (title: string, items: Task[], collapsed = false): Group => ({
  kind: "group",
  id: title,
  title,
  collapsed,
  important: false,
  items,
});

const keyGroup = (title: string, items: Task[]): Group => ({
  ...group(title, items),
  important: true,
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

describe("partition", () => {
  it("counts a marked task as important wherever it sits", () => {
    const { important, rest } = partition([key("a"), task("b"), group("G", [key("c"), task("d")])]);
    expect(important.map((t) => t.text)).toEqual(["a", "c"]);
    expect(rest.map((t) => t.text)).toEqual(["b", "d"]);
  });

  it("pulls in every item of an important group", () => {
    // Finishing an important group means finishing its items, so they are the
    // same obligation and belong on the same side of the split.
    const { important, rest } = partition([keyGroup("G", [task("a"), task("b")]), task("c")]);
    expect(important.map((t) => t.text)).toEqual(["a", "b"]);
    expect(rest.map((t) => t.text)).toEqual(["c"]);
  });

  it("gets nothing from an empty important group, so it cannot block", () => {
    const { important } = partition([keyGroup("G", [])]);
    expect(important).toEqual([]);
  });
});

describe("scoreDay", () => {
  const BAR = 0.7;

  it("is never a success on an empty list", () => {
    const score = scoreDay(state([]), BAR);
    expect(score).toMatchObject({ succeeded: false, complete: false, total: 0 });
  });

  it("refuses success while an important item is outstanding, however high the rest", () => {
    const score = scoreDay(state([key("ship"), task("a", 1), task("b", 1), task("c", 1)]), BAR);
    expect(score.rest).toBe(1);
    expect(score.cleared).toBe(false);
    expect(score.succeeded).toBe(false);
  });

  it("succeeds once the important work lands and the rest clears the bar", () => {
    const list = [key("ship", 1), task("a", 1), task("b", 1), task("c", 1), task("d", 0)];
    const score = scoreDay(state(list), BAR);
    expect(score).toMatchObject({ cleared: true, succeeded: true, complete: false });
    expect(score.rest).toBeCloseTo(0.75, 6);
  });

  it("holds back when the rest is short of the bar", () => {
    const score = scoreDay(state([key("ship", 1), task("a", 1), task("b", 0)]), BAR);
    expect(score.cleared).toBe(true);
    expect(score.succeeded).toBe(false);
  });

  it("is gated on the rest alone when nothing is marked", () => {
    // 3 of 4 is 75%, over the bar.
    const score = scoreDay(state([task("a", 1), task("b", 1), task("c", 1), task("d", 0)]), BAR);
    expect(score.hasImportant).toBe(false);
    expect(score.cleared).toBe(true);
    expect(score.succeeded).toBe(true);
  });

  it("succeeds on important work alone when there is no rest", () => {
    const score = scoreDay(state([key("ship", 1)]), BAR);
    expect(score).toMatchObject({ succeeded: true, complete: true });
  });

  it("counts a whole important group as the thing to finish", () => {
    const partial = scoreDay(state([keyGroup("G", [task("a", 1), task("b", 0)])]), BAR);
    expect(partial.cleared).toBe(false);

    const whole = scoreDay(state([keyGroup("G", [task("a", 1), task("b", 1)])]), BAR);
    expect(whole.cleared).toBe(true);
  });

  it("only calls it complete when nothing is left anywhere", () => {
    expect(scoreDay(state([key("a", 1), task("b", 1)]), BAR).complete).toBe(true);
    expect(scoreDay(state([key("a", 1), task("b", 0)]), BAR).complete).toBe(false);
  });
});

describe("dayHue", () => {
  const BAR = 0.7;
  const RED = 25;
  const GREEN = 150;
  const BLUE = 260;
  const VIOLET = 320;
  const hue = (list: State["list"], bar = BAR): number => dayHue(scoreDay(state(list), bar), bar);

  it("opens on red and ends on violet", () => {
    expect(hue([])).toBeCloseTo(RED, 6);
    expect(hue([key("a"), task("b")])).toBeCloseTo(RED, 6);
    expect(hue([key("a", 1), task("b", 1)])).toBeCloseTo(VIOLET, 6);
  });

  it("lands exactly on green the moment the important work is done", () => {
    expect(hue([key("a", 1), task("b"), task("c"), task("d")])).toBeCloseTo(GREEN, 6);
  });

  it("lands exactly on blue the moment the rest clears the bar", () => {
    // 7 of 10 ordinary items done, bar at 70%.
    const rest = Array.from({ length: 10 }, (_, i) => task(`t${String(i)}`, i < 7 ? 1 : 0));
    expect(hue([key("a", 1), ...rest])).toBeCloseTo(BLUE, 6);
  });

  it("runs straight from red to blue when nothing is marked", () => {
    // Green is only a landmark when there was important work to earn it with;
    // a list with nothing marked must not open on green.
    expect(hue([task("a"), task("b")])).toBeCloseTo(RED, 6);
    const rest = Array.from({ length: 10 }, (_, i) => task(`t${String(i)}`, i < 7 ? 1 : 0));
    expect(hue(rest)).toBeCloseTo(BLUE, 6);
  });

  it("moves monotonically as work lands", () => {
    const at = (done: number): number =>
      hue([
        key("a", done > 0 ? 1 : 0),
        ...Array.from({ length: 4 }, (_, i) => task(`t${String(i)}`, i < done ? 1 : 0)),
      ]);
    const steps = [0, 1, 2, 3, 4].map(at);
    for (let i = 1; i < steps.length; i++) {
      expect(steps[i] as number).toBeGreaterThan(steps[i - 1] as number);
    }
  });

  it("stays in range at the extreme bars", () => {
    // A bar of 100% leaves no room above it, and a bar of 0% none below.
    expect(hue([key("a", 1), task("b", 0)], 1)).toBeCloseTo(GREEN, 6);
    expect(hue([key("a", 1), task("b", 0)], 0)).toBeCloseTo(BLUE, 6);
    expect(hue([key("a", 1), task("b", 1), task("c", 0)], 0)).toBeGreaterThan(BLUE);
  });
});

describe("summarise", () => {
  it("reports done, total, and which groups cleared", () => {
    const s = state([
      group("Morning", [task("a", 1), task("b", 1)]),
      group("Work", [task("c", 0)]),
      task("d", 1),
    ]);
    expect(summarise(s, 0, 0.7)).toMatchObject({
      done: 3,
      total: 4,
      clearedGroups: ["Morning"],
      elapsedMs: null,
    });
  });

  it("does not count an empty group as cleared", () => {
    expect(summarise(state([group("Empty", [])]), 0, 0.7).clearedGroups).toEqual([]);
  });

  it("reports elapsed time once the day has opened", () => {
    expect(summarise(state([task("a")], 1000), 61_000, 0.7).elapsedMs).toBe(60_000);
  });

  it("carries the day's verdict, so the card can report before it clears", () => {
    const s = state([key("ship", 1), task("a", 1), task("b", 1), task("c", 1), task("d", 0)]);
    expect(summarise(s, 0, 0.7).score).toMatchObject({ cleared: true, succeeded: true });
    expect(summarise(s, 0, 0.9).score).toMatchObject({ cleared: true, succeeded: false });
  });
});
