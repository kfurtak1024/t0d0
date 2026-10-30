import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { isDone } from "../../src/progress";
import * as T from "../../src/transitions";
import type { State } from "../../src/types";
import { NOW, rows, shape, groupOf, taskOf } from "./shared";

/*
 * The tidy: where a finished row sinks to, how it rises, and where the pile begins.
 */

describe("sink", () => {
  const done = (state: State, ...texts: string[]): State =>
    texts.reduce((acc, text) => T.bump(acc, taskOf(acc, text).id, 1, NOW), state);

  it("drops a finished group past the work that is left", () => {
    let state = rows("# Morning", "  a", "b", "# Work", "  c", "d");
    state = done(state, "a");
    expect(shape(T.sink(state, "Morning"))).toEqual([
      "b",
      "# Work",
      "  c",
      "d",
      "# Morning",
      "  a",
    ]);
  });

  it("stops above the finished rows already at the bottom", () => {
    let state = rows("# Morning", "  a", "b", "# Work", "  c", "d");
    state = done(state, "a", "c", "d");
    // Work sank when it finished; Morning lands on top of it, not under it.
    state = T.sink(state, "Work");
    expect(shape(T.sink(state, "Morning"))).toEqual([
      "b",
      "# Morning",
      "  a",
      "# Work",
      "  c",
      "d",
    ]);
  });

  it("leaves a group with nowhere to go exactly where it is", () => {
    const state = done(rows("a", "# Morning", "  b"), "b");
    expect(T.sink(state, "Morning")).toBe(state);
    expect(T.sink(state, "nope")).toBe(state);
  });

  it("moves a group as one block, taking its items with it", () => {
    const state = done(rows("# Morning", "  a", "  b", "c"), "a", "b");
    expect(shape(T.sink(state, "Morning"))).toEqual(["c", "# Morning", "  a", "  b"]);
  });

  it("drops a ticked root item past the work that is left", () => {
    const state = done(rows("a", "b", "# Work", "  c", "d"), "a");
    expect(shape(T.sink(state, "a"))).toEqual(["b", "# Work", "  c", "d", "a"]);
  });

  it("stacks root items and groups in the one pile, in the order they finished", () => {
    let state = done(rows("a", "b", "c"), "b");
    state = T.sink(state, "b");
    expect(shape(state)).toEqual(["a", "c", "b"]);

    // `a` finishes second, so it comes to rest on top of `b`, not under it.
    state = T.sink(done(state, "a"), "a");
    expect(shape(state)).toEqual(["c", "a", "b"]);
  });

  it("drops a ticked nested task to the foot of its own group", () => {
    const state = done(rows("# Morning", "  a", "  b", "  c"), "a");
    expect(shape(T.sink(state, "a"))).toEqual(["# Morning", "  b", "  c", "  a"]);
  });

  it("stops at the group's edge rather than escaping into the list", () => {
    // The group is still one block as far as the list is concerned; only the
    // order inside it has changed.
    const state = done(rows("# Morning", "  a", "  b", "c"), "a");
    expect(shape(T.sink(state, "a"))).toEqual(["# Morning", "  b", "  a", "c"]);
  });

  it("stacks a group's finished items in the order they were ticked", () => {
    let state = done(rows("# Morning", "  a", "  b", "  c"), "b");
    state = T.sink(state, "b");
    expect(shape(state)).toEqual(["# Morning", "  a", "  c", "  b"]);

    // `a` finishes second, so it comes to rest on top of `b`, not under it.
    state = T.sink(done(state, "a"), "a");
    expect(shape(state)).toEqual(["# Morning", "  c", "  a", "  b"]);
  });

  it("never mutates the state it is given", () => {
    const state = done(rows("# Morning", "  a", "b"), "a");
    const snapshot = JSON.stringify(state);
    T.sink(state, "Morning");
    expect(JSON.stringify(state)).toBe(snapshot);
  });
});

describe("rise", () => {
  const done = (state: State, ...items: string[]): State => {
    let next = state;
    for (const text of items) next = T.bump(next, taskOf(next, text).id, 1, NOW);
    return next;
  };

  it("brings a row back above the finished pile", () => {
    let state = done(rows("a", "f1", "f2"), "f1", "f2");
    const id = taskOf(state, "f2").id;

    state = T.bump(state, id, -1, NOW);
    state = T.rise(state, id);
    expect(shape(state)).toEqual(["a", "f2", "f1"]);
  });

  it("climbs past every finished row, not just one", () => {
    let state = done(rows("a", "f1", "f2", "f3"), "f1", "f2", "f3");
    const id = taskOf(state, "f3").id;

    state = T.bump(state, id, -1, NOW);
    state = T.rise(state, id);
    expect(shape(state)).toEqual(["a", "f3", "f1", "f2"]);
  });

  it("stops under the last of the work rather than climbing to the top", () => {
    let state = done(rows("a", "b", "f1", "c"), "f1");
    const id = taskOf(state, "f1").id;
    state = T.bump(state, id, -1, NOW);
    // b is still work, so putting f1 back must not lift it over b.
    expect(T.rise(state, id)).toBe(state);
  });

  it("leaves the top row alone", () => {
    const state = rows("a", "b");
    expect(T.rise(state, taskOf(state, "a").id)).toBe(state);
  });

  /*
   * The rule is "back above the finished pile", not "back where it came from".
   * A row that sank past *work* keeps its new place: remembering the old one
   * would be a second idea of where a row belongs, which is exactly what
   * `reorder` exists to prevent.
   */
  it("does not restore a place it lost to unfinished work", () => {
    let state = done(rows("a", "b", "c", "d"), "b");
    const id = taskOf(state, "b").id;
    state = T.sink(state, id);
    expect(shape(state)).toEqual(["a", "c", "d", "b"]);

    state = T.bump(state, id, -1, NOW);
    expect(T.rise(state, id)).toBe(state);
  });

  it("moves a group as one block, the same way sink does", () => {
    let state = done(rows("a", "f1", "# Morning", "  x"), "f1", "x");
    const groupId = groupOf(state, "Morning").id;
    expect(shape(state)).toEqual(["a", "f1", "# Morning", "  x"]);

    state = T.bump(state, taskOf(state, "x").id, -1, NOW);
    state = T.rise(state, groupId);
    expect(shape(state)).toEqual(["a", "# Morning", "  x", "f1"]);
  });

  it("brings a nested row back above its group's own finished run", () => {
    let state = done(rows("# Morning", "  a", "  f1", "  f2"), "f1", "f2");
    const id = taskOf(state, "f2").id;

    state = T.bump(state, id, -1, NOW);
    state = T.rise(state, id);
    expect(shape(state)).toEqual(["# Morning", "  a", "  f2", "  f1"]);
  });

  it("stops at the group's edge climbing, as sink does falling", () => {
    // Everything left in the group is finished, so the row goes to its top and
    // no further — it does not climb out into the list.
    let state = done(rows("x", "# Morning", "  f1", "  f2"), "f1", "f2");
    const id = taskOf(state, "f2").id;

    state = T.bump(state, id, -1, NOW);
    state = T.rise(state, id);
    expect(shape(state)).toEqual(["x", "# Morning", "  f2", "  f1"]);
  });
});

describe("rowsToTidy", () => {
  const done = (state: State, ...items: string[]): State => {
    let next = state;
    for (const text of items) next = T.bump(next, taskOf(next, text).id, 1, NOW);
    return next;
  };

  it("sends a root task down as itself", () => {
    const state = done(rows("a", "b"), "a");
    const id = taskOf(state, "a").id;
    expect(T.rowsToTidy(state, id)).toEqual([id]);
  });

  it("sends a nested task down inside its group while the group is part done", () => {
    // One item finishing is not the group finishing — but the item has still
    // finished, and a finished row gets out of the way of the work around it.
    const state = done(rows("# Morning", "  x", "  y"), "x");
    expect(T.rowsToTidy(state, taskOf(state, "x").id)).toEqual([taskOf(state, "x").id]);
  });

  it("sends the group down as well, once its last item lands", () => {
    const state = done(rows("# Morning", "  x", "  y"), "x", "y");
    expect(T.rowsToTidy(state, taskOf(state, "y").id)).toEqual([
      taskOf(state, "y").id,
      groupOf(state, "Morning").id,
    ]);
  });
});

describe("tidyAll", () => {
  const done = (state: State, ...items: string[]): State => {
    let next = state;
    for (const text of items) next = T.bump(next, taskOf(next, text).id, 1, NOW);
    return next;
  };

  /*
   * The rule the whole batch exists for: the queue is tick order, and a row
   * travels past whatever was still work at its own tick. Ticked b then c, b
   * goes right to the foot and c settles on it — as the same two spread out
   * would. Ticked the other way round, c is the one at the foot.
   */
  it("stacks a batch in the order it was ticked, later on top", () => {
    const state = done(rows("a", "b", "c", "d"), "b", "c");
    const b = taskOf(state, "b").id;
    const c = taskOf(state, "c").id;

    expect(shape(T.tidyAll(state, [b, c]))).toEqual(["a", "d", "c", "b"]);
    expect(shape(T.tidyAll(state, [c, b]))).toEqual(["a", "d", "b", "c"]);
  });

  it("skips a row that is no longer finished", () => {
    // Ticked, queued, then unticked before the batch ran.
    let state = done(rows("a", "b", "c"), "b");
    const id = taskOf(state, "b").id;
    state = T.bump(state, id, -1, NOW);
    expect(T.tidyAll(state, [id])).toBe(state);
  });

  it("skips an id that has left the list", () => {
    const state = done(rows("a", "b"), "b");
    expect(T.tidyAll(state, ["gone"])).toBe(state);
  });

  it("folds a finished group shut on its way down", () => {
    const state = done(rows("a", "# Morning", "  x", "b"), "x");
    const id = groupOf(state, "Morning").id;

    const next = T.tidyAll(state, [id]);
    expect(shape(next)).toEqual(["a", "b", "# Morning", "  x"]);
    expect(groupOf(next, "Morning").collapsed).toBe(true);
  });

  it("leaves the list alone when nothing queued can travel", () => {
    const state = rows("a", "b");
    expect(T.tidyAll(state, [])).toBe(state);
  });

  it("settles a nested row inside its group", () => {
    const state = done(rows("a", "# Morning", "  x", "  y"), "x");
    const id = taskOf(state, "x").id;

    expect(shape(T.tidyAll(state, [id]))).toEqual(["a", "# Morning", "  y", "  x"]);
  });

  // The same rule one level down: tick order, inside the group.
  it("stacks a group's rows in the order they were ticked", () => {
    const state = done(rows("# Morning", "  a", "  b", "  c", "  d"), "b", "c");
    const b = taskOf(state, "b").id;
    const c = taskOf(state, "c").id;

    expect(shape(T.tidyAll(state, [b, c]))).toEqual(["# Morning", "  a", "  d", "  c", "  b"]);
    expect(shape(T.tidyAll(state, [c, b]))).toEqual(["# Morning", "  a", "  d", "  b", "  c"]);
  });

  /*
   * A finished group and its own items can be queued by the same tick. Nothing
   * visible turns on which goes first — a queued group means every sibling is
   * finished, so the items have nowhere left to sink — but the batch still has
   * to survive being handed both, which it did not when a nested id read as
   * position -1 and was dropped from the queue outright.
   */
  it("takes a group and its items in the same batch", () => {
    const state = done(rows("a", "# Morning", "  x", "  y", "b"), "x", "y");
    const ids = [groupOf(state, "Morning").id, taskOf(state, "y").id];

    expect(shape(T.tidyAll(state, ids))).toEqual(["a", "b", "# Morning", "  x", "  y"]);
    expect(shape(T.tidyAll(state, [...ids].reverse()))).toEqual([
      "a",
      "b",
      "# Morning",
      "  x",
      "  y",
    ]);
  });

  it("skips a nested id that has left the list", () => {
    const state = done(rows("# Morning", "  x", "  y"), "x");
    expect(T.tidyAll(state, ["gone"])).toBe(state);
  });

  /*
   * The claim itself rather than an example of it. A batch is only ticks that
   * happened to land inside one tidy delay, so how fast they came must not
   * decide where anything ends up: over any list, with a pile already earned,
   * ticking a run of rows and tidying once has to equal tidying after each.
   * Whole states are compared, so a fold that differs fails as well as an order.
   */
  it("lands a batch exactly where the same ticks spread out would", () => {
    // Root tasks and groups of 0-3 items; names are the ids, so failures read.
    const anyList = fc.array(fc.oneof(fc.constant(-1), fc.integer({ min: 0, max: 3 })), {
      minLength: 1,
      maxLength: 7,
    });
    const picks = fc.array(fc.nat({ max: 30 }), { maxLength: 6 });

    fc.assert(
      fc.property(anyList, picks, picks, (spec, earlier, now) => {
        let n = 0;
        const lines = spec.flatMap((size, g) =>
          size < 0
            ? [`t${String(n++)}`]
            : [`# G${String(g)}`, ...Array.from({ length: size }, () => `  t${String(n++)}`)],
        );
        if (n === 0) return;
        const pick = (state: State, at: number[]): string[] => [
          ...new Set(
            at.map((i) => `t${String(i % n)}`).filter((name) => !isDone(taskOf(state, name))),
          ),
        ];
        const tick = (state: State, name: string): [State, string[]] => {
          const next = T.bump(state, name, 1, NOW);
          return [next, T.rowsToTidy(next, name)];
        };

        // A pile already earned, one tidy at a time.
        let start = rows(...lines);
        for (const name of pick(start, earlier)) {
          const [ticked, ids] = tick(start, name);
          start = T.tidyAll(ticked, ids);
        }

        let spread = start;
        let batched = start;
        const queue: string[] = [];
        for (const name of pick(start, now)) {
          const [one, ids] = tick(spread, name);
          spread = T.tidyAll(one, ids);
          const [many, more] = tick(batched, name);
          batched = many;
          queue.push(...more);
        }
        expect(T.tidyAll(batched, queue)).toEqual(spread);
      }),
      { numRuns: 500 },
    );
  });
});

describe("isFinished", () => {
  const row = (state: State, id: string) => T.findRow(state, id)!;

  it("is a ticked task, or a group with every item ticked", () => {
    let state = rows("a", "b", "# Morning", "  c", "# Work", "  d", "  e");
    state = T.bump(state, "a", 1, NOW);
    state = T.bump(state, "c", 1, NOW);
    state = T.bump(state, "d", 1, NOW);

    expect(T.isFinished(row(state, "a"))).toBe(true);
    expect(T.isFinished(row(state, "b"))).toBe(false);
    expect(T.isFinished(row(state, "Morning"))).toBe(true);
    // Half a group is not a finished group.
    expect(T.isFinished(row(state, "Work"))).toBe(false);
  });

  it("says no to an empty group, which is not finished but unstarted", () => {
    expect(T.isFinished(row(rows("# Later"), "Later"))).toBe(false);
  });
});

/**
 * Where the pile of finished rows begins.
 *
 * Positional on purpose. A row is finished for the length of the tidy's delay
 * before `sink` moves it — that pause is the reward playing out — so a split
 * that asked "is this row done?" would drop it into the pile the instant it was
 * ticked, over the top of the thing the delay exists to protect.
 */
describe("pileFrom", () => {
  /** Tick every row named, so the state reads as a day part-way through. */
  const ticked = (state: State, ...names: string[]): State => {
    let next = state;
    for (const name of names) {
      const task = T.findTask(next, name);
      if (task) next = T.bump(next, task.id, task.target, NOW);
    }
    return next;
  };

  it("is the length when nothing is resting at the foot", () => {
    expect(T.pileFrom([])).toBe(0);
    expect(T.pileFrom(rows("a", "b").list)).toBe(2);
  });

  it("finds the start of the trailing run", () => {
    expect(T.pileFrom(ticked(rows("a", "b", "c"), "b", "c").list)).toBe(1);
    expect(T.pileFrom(ticked(rows("a", "b"), "a", "b").list)).toBe(0);
  });

  /* Finished rows further up are not the pile — only the run at the foot is. */
  it("ignores finished rows that still have work below them", () => {
    expect(T.pileFrom(ticked(rows("a", "b", "c"), "a", "c").list)).toBe(2);
    expect(T.pileFrom(ticked(rows("a", "b"), "a").list)).toBe(2);
  });

  it("counts a finished group as part of the pile", () => {
    expect(T.pileFrom(ticked(rows("a", "# Morning", "  m1"), "m1").list)).toBe(1);
  });

  /* An empty group is not finished, it is simply empty — so it is not pile. */
  it("does not count an empty group as finished", () => {
    expect(T.pileFrom(rows("a", "# Later").list)).toBe(2);
  });

  it("agrees with what sink actually does", () => {
    // Tick a middle row, sink it, and the pile should now start where it rests.
    const day = ticked(rows("a", "b", "c"), "b");
    const after = T.sink(day, "b");
    expect(shape(after)).toEqual(["a", "c", "b"]);
    expect(T.pileFrom(after.list)).toBe(2);
  });
});

/**
 * Whether a row has settled into the pile, where its place is fixed.
 *
 * The pile is in the order the rows were finished in, which nobody arranged —
 * so nothing down there may be reordered or re-nested. Read through the owning
 * group, so a task inside a finished group is settled with it, while a finished
 * task inside an unfinished group is not: its group is still up in the work and
 * travels as one block.
 */
describe("inPile", () => {
  const ticked = (state: State, ...names: string[]): State => {
    let next = state;
    for (const name of names) {
      const task = T.findTask(next, name);
      if (task) next = T.bump(next, task.id, task.target, NOW);
    }
    return next;
  };

  it("settles the rows resting at the foot, and nothing above them", () => {
    const day = ticked(rows("a", "b", "c"), "b", "c");
    const from = T.pileFrom(day.list);
    expect(T.inPile(day, "a", from)).toBe(false);
    expect(T.inPile(day, "b", from)).toBe(true);
    expect(T.inPile(day, "c", from)).toBe(true);
  });

  it("settles a task inside a finished group along with it", () => {
    const day = ticked(rows("a", "# Morning", "  m1"), "m1");
    const from = T.pileFrom(day.list);
    expect(T.inPile(day, "Morning", from)).toBe(true);
    expect(T.inPile(day, "m1", from)).toBe(true);
  });

  /* Its group is still work, so it moves with the work. */
  it("leaves a finished task inside an unfinished group alone", () => {
    const day = ticked(rows("# Errands", "  e1", "  e2"), "e1");
    const from = T.pileFrom(day.list);
    expect(T.inPile(day, "e1", from)).toBe(false);
  });

  it("settles nothing when there is no pile", () => {
    const day = rows("a", "b");
    expect(T.inPile(day, "a", T.pileFrom(day.list))).toBe(false);
  });

  it("says no about a row that is not there", () => {
    expect(T.inPile(rows("a"), "ghost", 0)).toBe(false);
  });
});
