import { describe, expect, it } from "vitest";
import {
  allTasks,
  dayGates,
  dayHue,
  hueMark,
  HUE,
  isComplete,
  isDone,
  outstandingImportant,
  partition,
  progress,
  scoreDay,
  stepsToBar,
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
  once: false,
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
  it("reports done, total, and what actually got finished", () => {
    const s = state([
      group("Morning", [task("a", 1), task("b", 1)]),
      group("Work", [task("c", 0)]),
      task("d", 1),
    ]);
    expect(summarise(s, 0.7)).toMatchObject({
      done: 3,
      total: 4,
      finished: ["a", "b", "d"],
    });
  });

  it("names nothing on a day with an empty group and no work", () => {
    expect(summarise(state([group("Empty", [])]), 0.7).finished).toEqual([]);
  });

  it("carries the day's verdict, so the card can report before it clears", () => {
    const s = state([key("ship", 1), task("a", 1), task("b", 1), task("c", 1), task("d", 0)]);
    expect(summarise(s, 0.7).score).toMatchObject({ cleared: true, succeeded: true });
    expect(summarise(s, 0.9).score).toMatchObject({ cleared: true, succeeded: false });
  });
});

describe("hueMark", () => {
  it("puts the rainbow's ends at the ends", () => {
    expect(hueMark(HUE.red)).toBe(0);
    expect(hueMark(HUE.violet)).toBe(1);
  });

  it("places the gates where their hues fall, not at even thirds", () => {
    // The rail is the hue axis, so the landmarks sit wherever their own hue is.
    expect(hueMark(HUE.green)).toBeCloseTo((150 - 25) / (320 - 25), 6);
    expect(hueMark(HUE.blue)).toBeCloseTo((260 - 25) / (320 - 25), 6);
    expect(hueMark(HUE.green)).toBeLessThan(hueMark(HUE.blue));
  });

  it("agrees with the ring: the day's hue is the day's place", () => {
    const s = state([key("ship", 1), task("a", 1), task("b", 0)]);
    const mark = hueMark(dayHue(scoreDay(s, 0.7), 0.7));
    expect(mark).toBeGreaterThan(hueMark(HUE.green));
    expect(mark).toBeLessThan(1);
  });
});

describe("outstandingImportant", () => {
  it("is the marked work still to do, in list order", () => {
    const s = state([
      keyGroup("Admin", [key("book it"), key("call", 1)]),
      key("bank", 1),
      key("post"),
      task("plants"),
    ]);
    expect(outstandingImportant(s.list).map((item) => item.text)).toEqual(["book it", "post"]);
  });

  it("counts a marked group's items even when they carry no mark of their own", () => {
    const s = state([keyGroup("Admin", [{ ...task("book it") }])]);
    expect(outstandingImportant(s.list)).toHaveLength(1);
  });

  it("is empty when nothing is marked", () => {
    expect(outstandingImportant(state([task("a"), task("b", 1)]).list)).toEqual([]);
  });
});

describe("stepsToBar", () => {
  it("is zero once the bar is cleared", () => {
    const s = state([task("a", 1), task("b", 1), task("c", 1), task("d", 0)]);
    expect(stepsToBar(s, 0.7)).toBe(0);
  });

  it("is zero when there is nothing but marked work", () => {
    // An empty set clears the bar vacuously, the way scoreDay reads it.
    expect(stepsToBar(state([key("ship"), key("call")]), 0.7)).toBe(0);
  });

  it("counts the whole items a plain list still owes", () => {
    const s = state([task("a", 1), task("b"), task("c"), task("d")]);
    // 1 of 4 done, the bar wants 3 of 4: two more.
    expect(stepsToBar(s, 0.75)).toBe(2);
  });

  /*
   * The reason this is not ceil(bar × n − sum): that arithmetic treats every
   * remaining task as worth a whole point. Here two are half-counted, so
   * finishing one of them does not move the mean by one.
   */
  it("does not count a part-counted item as a whole step", () => {
    const s = state([task("a", 1, 2), task("b", 1, 2), task("c"), task("d")]);
    // Progress is (0.5 + 0.5 + 0 + 0) / 4 = 0.25; the bar wants 0.75, so one
    // whole point is short. The naive ceil says 1; the halves only give 0.5.
    expect(stepsToBar(s, 0.75)).toBe(2);
  });

  it("takes the largest remaining contributions first, so it is the fewest", () => {
    const s = state([task("a", 3, 4), task("b"), task("c", 1, 2)]);
    // Remaining: 0.25, 1, 0.5. Progress is (0.75 + 0 + 0.5) / 3 ≈ 0.4167, and
    // the bar wants 0.8, so it is 1.15 short — the whole item plus the half.
    expect(stepsToBar(s, 0.8)).toBe(2);
  });

  it("never asks for more than there is left to finish", () => {
    const s = state([task("a"), task("b"), task("c")]);
    expect(stepsToBar(s, 1)).toBe(3);
  });

  it("is zero at a bar of nothing", () => {
    expect(stepsToBar(state([task("a"), task("b")]), 0)).toBe(0);
  });

  it("ignores marked work, which is the other gate's business", () => {
    const s = state([key("ship"), key("call"), task("a", 1), task("b")]);
    // The rest is a-done and b-undone: half, and the bar wants all of it.
    expect(stepsToBar(s, 1)).toBe(1);
  });
});

/**
 * Which gates a day has, and how full each one is.
 *
 * The rules are not obvious and they used to live in `src/ui/gates.ts`, where
 * coverage does not reach: the Important gate is *absent* rather than empty
 * when nothing is marked, only the second gate has a line short of everything,
 * and the fill is the mean the ring uses rather than done/total — so a
 * part-counted item moves the bar where it does not move the tally.
 */
describe("dayGates", () => {
  it("has nothing to report on an empty list", () => {
    expect(dayGates(state([]), 0.7)).toEqual([]);
  });

  /*
   * A gate at "0 of 0" claims an obligation nobody took on, which is why
   * `dayHue` does not draw its landmark there either.
   */
  it("drops the Important gate entirely when nothing is marked", () => {
    const gates = dayGates(state([task("a", 1), task("b")]), 0.7);
    expect(gates).toHaveLength(1);
    expect(gates[0]).toMatchObject({ key: "rest", name: "Everything", done: 1, total: 2 });
  });

  it("names the second gate for what it sits beside", () => {
    const gates = dayGates(state([key("m"), task("a")]), 0.7);
    expect(gates.map((gate) => gate.name)).toEqual(["Important", "Everything else"]);
  });

  /* The marked work has no bar to clear — it simply has to be done. */
  it("gives only the second gate a threshold", () => {
    const gates = dayGates(state([key("m"), task("a")]), 0.7);
    expect(gates[0]?.threshold).toBeNull();
    expect(gates[1]?.threshold).toBe(0.7);
  });

  it("fills to the mean, not to done over total", () => {
    // One whole item and one third of a [3], over two tasks: 2/3, not 1/2.
    const gates = dayGates(state([task("a", 1), task("b", 1, 3)]), 0.7);
    expect(gates[0]?.fill).toBeCloseTo(2 / 3, 6);
    expect(gates[0]?.done).toBe(1);
    expect(gates[0]?.total).toBe(2);
  });

  it("meets the Important gate only when all of it is done", () => {
    expect(dayGates(state([key("m"), task("a")]), 0.7)[0]?.met).toBe(false);
    expect(dayGates(state([key("m", 1), task("a")]), 0.7)[0]?.met).toBe(true);
  });

  it("meets the second gate at the bar the preference names", () => {
    const list = [key("m"), task("a", 1), task("b", 1), task("c")];
    expect(dayGates(state(list), 0.6)[1]?.met).toBe(true);
    expect(dayGates(state(list), 0.7)[1]?.met).toBe(false);
  });

  /* Vacuously met, the same way `scoreDay` reads an empty set. */
  it("meets a second gate that has nothing in it", () => {
    const gates = dayGates(state([key("m")]), 0.7);
    expect(gates[1]).toMatchObject({ total: 0, met: true, fill: 1 });
  });

  it("names the marked work still to do, and only that", () => {
    const gates = dayGates(state([key("m1"), key("m2", 1), task("a")]), 0.7);
    expect(gates[0]?.outstanding.map((row) => row.text)).toEqual(["m1"]);
    expect(gates[1]?.outstanding).toEqual([]);
  });

  it("counts a task in an important group as marked work", () => {
    const held = group("Work", [task("a"), task("b")]);
    held.important = true;
    for (const item of held.items) item.important = true;
    const gates = dayGates(state([held, task("c")]), 0.7);
    expect(gates[0]).toMatchObject({ key: "important", total: 2 });
    expect(gates[1]).toMatchObject({ key: "rest", total: 1 });
  });
});
