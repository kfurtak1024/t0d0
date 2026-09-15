import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { allTasks, isDone, progress } from "../src/progress";
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

/*
 * Reordering is about arrangement, so these two say the arrangement out loud:
 * "# X" is a group, two leading spaces mean nested. `shape` is the inverse of
 * `rows`, which makes a move test read as before-and-after pictures.
 */
const rows = (...spec: string[]): State => {
  const state = empty();
  for (const row of spec) {
    if (row.startsWith("# ")) {
      const title = row.slice(2);
      state.list.push({
        kind: "group",
        id: title,
        title,
        collapsed: false,
        important: false,
        items: [],
      });
      continue;
    }
    const text = row.trim();
    const task: Task = {
      kind: "task",
      id: text,
      text,
      target: 1,
      count: 0,
      important: false,
      once: false,
    };
    const last = state.list[state.list.length - 1];
    if (row.startsWith("  ") && last?.kind === "group") last.items.push(task);
    else state.list.push(task);
  }
  return state;
};

const shape = (state: State): string[] =>
  state.list.flatMap((node) =>
    node.kind === "group"
      ? [`# ${node.title}`, ...node.items.map((task) => `  ${task.text}`)]
      : [node.text],
  );
const groupOf = (state: State, title: string): Group =>
  state.list.find((n): n is Group => n.kind === "group" && n.title === title)!;
const taskOf = (state: State, text: string): Task =>
  allTasks(state.list).find((t) => t.text === text)!;

describe("add", () => {
  it("carries the importance mark through to the stored row", () => {
    const state = build(["# Morning!", "call the bank!", "water plants"]);
    expect(taskOf(state, "call the bank").important).toBe(true);
    expect(taskOf(state, "water plants").important).toBe(false);
    // The group reads itself from its items, and one of them is not marked.
    expect(groupOf(state, "Morning").important).toBe(false);
  });

  /*
   * The top, wherever it lands. What you just typed is the freshest thing you
   * have to do, and it goes where you can see it rather than at the end of a
   * list running off the screen behind the composer.
   */
  it("lands a new group at the top of the list", () => {
    let state = rows("a", "b");
    state = T.add(state, "# Morning", null, NOW).state;
    expect(shape(state)).toEqual(["# Morning", "a", "b"]);
  });

  it("lands a new root task at the top too", () => {
    const state = T.add(rows("a", "b"), "shopping", null, NOW).state;
    expect(shape(state)).toEqual(["shopping", "a", "b"]);
  });

  it("lands a new item at the top of the group it is aimed at", () => {
    const state = rows("# Morning", "  a", "  b");
    const next = T.add(state, "eat breakfast", "Morning", NOW).state;
    expect(shape(next)).toEqual(["# Morning", "  eat breakfast", "  a", "  b"]);
  });

  /*
   * The defect the top fixes rather than merely dodges. A row pushed onto the
   * end landed *under* the finished pile, which left an unfinished row at the
   * foot of the list — and `pileFrom` stops at the first row that is not
   * finished, so the whole pile jumped back above the ending the moment you
   * added anything.
   */
  it("never lands under the finished pile", () => {
    let state = rows("a", "b");
    state = T.bump(state, taskOf(state, "a").id, 1, NOW);
    state = T.sink(state, taskOf(state, "a").id);
    expect(T.pileFrom(state.list)).toBe(1);

    state = T.add(state, "shopping", null, NOW).state;
    expect(shape(state)).toEqual(["shopping", "b", "a"]);
    expect(T.pileFrom(state.list)).toBe(2);
  });

  it("still aims the composer at the group it just made", () => {
    const result = T.add(rows("a"), "# Morning", null, NOW);

    expect(result.destId).toBe(groupOf(result.state, "Morning").id);
    // And the next item lands inside it, not beside it.
    const next = T.add(result.state, "eat breakfast", result.destId, NOW).state;
    expect(shape(next)).toEqual(["# Morning", "  eat breakfast", "a"]);
  });

  /*
   * The cost of landing at the top, stated out loud: typing a list in the order
   * you would read it builds it in the reverse of that order.
   */
  it("aims at a group the moment it is created, so a typed list comes out reversed", () => {
    const state = build(["# Morning", "eat breakfast", "walk the dog"]);
    expect(state.list).toHaveLength(1);
    expect(groupOf(state, "Morning").items.map((t) => t.text)).toEqual([
      "walk the dog",
      "eat breakfast",
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

  it("sets and clears the mark on a task, the same way the composer does", () => {
    let state = build(["call the bank"]);
    const id = taskOf(state, "call the bank").id;
    state = T.retitle(state, id, "call the bank!", false);
    expect(taskOf(state, "call the bank").important).toBe(true);
    state = T.retitle(state, id, "call the bank", false);
    expect(taskOf(state, "call the bank").important).toBe(false);
  });

  it("sets and clears the mark on a group", () => {
    let state = build(["# Morning"]);
    const id = groupOf(state, "Morning").id;
    state = T.retitle(state, id, "Morning!", true);
    expect(groupOf(state, "Morning").important).toBe(true);
    state = T.retitle(state, id, "Morning", true);
    expect(groupOf(state, "Morning").important).toBe(false);
  });

  it("keeps the mark and the quantity independent", () => {
    let state = build(["make calls [3]"]);
    const id = taskOf(state, "make calls").id;
    state = T.retitle(state, id, "make calls! [5]", false);
    expect(taskOf(state, "make calls")).toMatchObject({ target: 5, important: true });
  });
});

describe("the mark is only a mark", () => {
  it("buys no place in the order", () => {
    // Position is the ordering, and nothing about `important` may second-guess
    // it. A marked row lands where it was typed, steps like any other, and
    // still sinks out of the way once it is finished.
    let state = rows("a", "b", "c");
    const id = taskOf(state, "b").id;
    state = T.toggleImportant(state, id);
    expect(texts(state)).toEqual(["a", "b", "c"]);

    state = T.reorder(state, id, "up", "level");
    expect(texts(state)).toEqual(["b", "a", "c"]);

    state = T.bump(state, id, 1, NOW);
    expect(T.isFinished(taskOf(state, "b"))).toBe(true);
    state = T.sink(state, id);
    expect(texts(state)).toEqual(["a", "c", "b"]);
  });

  it("leaves progress alone", () => {
    const state = build(["a!", "b"]);
    expect(progress(allTasks(state.list))).toBe(0);
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
   * The rule the whole batch exists for. A row stops above the finished ones
   * already below it, so the upper of two must not be sent first — it would
   * stop dead on a sibling that has not travelled yet and stay stranded up in
   * the work. Ordering top-most first here gives ["a", "b", "d", "c"].
   */
  it("sends the bottom-most row first, so a batch lands where it was earned", () => {
    const state = done(rows("a", "b", "c", "d"), "b", "c");
    const ids = [taskOf(state, "b").id, taskOf(state, "c").id];

    expect(shape(T.tidyAll(state, ids))).toEqual(["a", "d", "b", "c"]);
    // Order of the queue must not matter; position is what decides.
    expect(shape(T.tidyAll(state, [...ids].reverse()))).toEqual(["a", "d", "b", "c"]);
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

  /*
   * The bottom-most-first rule, one level down. Two ticks in one breath inside a
   * group have to land where the same two ticks spread over a minute would, and
   * sending the upper one first strands it on a sibling that has not travelled.
   */
  it("sends the bottom-most of a group's rows first", () => {
    const state = done(rows("# Morning", "  a", "  b", "  c", "  d"), "b", "c");
    const ids = [taskOf(state, "b").id, taskOf(state, "c").id];

    expect(shape(T.tidyAll(state, ids))).toEqual(["# Morning", "  a", "  d", "  b", "  c"]);
    // Order of the queue must not matter; position is what decides.
    expect(shape(T.tidyAll(state, [...ids].reverse()))).toEqual([
      "# Morning",
      "  a",
      "  d",
      "  b",
      "  c",
    ]);
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
});

describe("toggleImportant", () => {
  it("marks and unmarks a root task", () => {
    let state = build(["shopping"]);
    const id = taskOf(state, "shopping").id;
    state = T.toggleImportant(state, id);
    expect(taskOf(state, "shopping").important).toBe(true);
    state = T.toggleImportant(state, id);
    expect(taskOf(state, "shopping").important).toBe(false);
  });

  it("reaches a task inside a group", () => {
    // Two items, so marking one leaves the group alone — one marked item is not
    // the whole group being marked.
    let state = build(["# Morning", "a", "b"]);
    state = T.toggleImportant(state, taskOf(state, "a").id);
    expect(taskOf(state, "a").important).toBe(true);
    expect(groupOf(state, "Morning").important).toBe(false);
  });

  it("marks a group", () => {
    let state = build(["# Morning"]);
    state = T.toggleImportant(state, groupOf(state, "Morning").id);
    expect(groupOf(state, "Morning").important).toBe(true);
  });

  it("agrees with what the composer's ! would have made", () => {
    // Three routes to one field — the menu must not become a fourth meaning.
    const plain = build(["shopping"]);
    const toggled = T.toggleImportant(plain, taskOf(plain, "shopping").id);
    expect(taskOf(toggled, "shopping").important).toBe(true);
    expect(taskOf(build(["shopping!"]), "shopping").important).toBe(true);
  });

  it("leaves the list alone for an id it does not know", () => {
    const state = build(["a"]);
    expect(T.toggleImportant(state, "nope")).toBe(state);
  });
});

/*
 * A group's mark and its items' marks are one statement made two ways, so the
 * two are kept in step: setting the group sets them, clearing it clears them,
 * and changing an item's own mark re-reads the group from what is left.
 */
describe("a group and its items", () => {
  it("marks every item when the group is marked", () => {
    let state = build(["# Morning", "a", "b"]);
    state = T.toggleImportant(state, groupOf(state, "Morning").id);

    expect(groupOf(state, "Morning").important).toBe(true);
    expect(taskOf(state, "a").important).toBe(true);
    expect(taskOf(state, "b").important).toBe(true);
  });

  /*
   * The reason clearing has to reach the items: left marked, they would re-read
   * the group as important on the next change and it could never be told "no".
   */
  it("unmarks every item when the group is unmarked", () => {
    let state = build(["# Morning", "a!", "b!"]);
    expect(groupOf(state, "Morning").important).toBe(true);

    state = T.toggleImportant(state, groupOf(state, "Morning").id);
    expect(groupOf(state, "Morning").important).toBe(false);
    expect(taskOf(state, "a").important).toBe(false);
    expect(taskOf(state, "b").important).toBe(false);
  });

  it("becomes important when the last of its items is marked", () => {
    let state = build(["# Morning", "a", "b"]);
    state = T.toggleImportant(state, taskOf(state, "a").id);
    expect(groupOf(state, "Morning").important).toBe(false);

    state = T.toggleImportant(state, taskOf(state, "b").id);
    expect(groupOf(state, "Morning").important).toBe(true);
  });

  it("stops being important the moment one of its items does", () => {
    let state = build(["# Morning", "a!", "b!"]);
    state = T.toggleImportant(state, taskOf(state, "a").id);

    expect(groupOf(state, "Morning").important).toBe(false);
    expect(taskOf(state, "a").important).toBe(false);
    // The other item keeps its own mark, and now shows it again.
    expect(taskOf(state, "b").important).toBe(true);
  });

  it("agrees across all three routes to the field", () => {
    // The composer's `!`, on the way in.
    const typed = build(["# Morning", "a!", "b!"]);
    expect(groupOf(typed, "Morning").important).toBe(true);

    // Inline editing, after the fact.
    let edited = build(["# Evening", "x", "y!"]);
    expect(groupOf(edited, "Evening").important).toBe(false);
    edited = T.retitle(edited, taskOf(edited, "x").id, "x!", false);
    expect(groupOf(edited, "Evening").important).toBe(true);

    // And editing the group's own title marks its items, like the menu does.
    let titled = build(["# Later", "p", "q"]);
    titled = T.retitle(titled, groupOf(titled, "Later").id, "Later!", true);
    expect(taskOf(titled, "p").important).toBe(true);
    expect(taskOf(titled, "q").important).toBe(true);
  });

  it("keeps an empty group's own mark, having nothing to read it from", () => {
    const state = build(["# Morning!"]);
    expect(groupOf(state, "Morning").important).toBe(true);
  });

  it("becomes important as soon as its only item is marked", () => {
    // One marked item is the whole of the group, so the group says the same.
    let state = build(["# Morning", "a"]);
    expect(groupOf(state, "Morning").important).toBe(false);

    state = T.toggleImportant(state, taskOf(state, "a").id);
    expect(groupOf(state, "Morning").important).toBe(true);
  });

  /*
   * Derived both ways, so the mark cannot depend on the order rows arrived in
   * and a plain row cannot become important without anyone saying so.
   */
  it("loses its mark when an ordinary item is added to it", () => {
    let state = build(["# Morning!"]);
    state = T.add(state, "errand", groupOf(state, "Morning").id, NOW).state;

    expect(groupOf(state, "Morning").important).toBe(false);
    expect(taskOf(state, "errand").important).toBe(false);
  });

  it("reads the same whichever order its rows arrived in", () => {
    const marksFirst = build(["# Morning", "a!", "b!", "plain"]);
    const plainFirst = build(["# Evening", "plain", "a!", "b!"]);

    expect(groupOf(marksFirst, "Morning").important).toBe(false);
    expect(groupOf(plainFirst, "Evening").important).toBe(false);
  });

  it("becomes important when the last ordinary item is deleted out of it", () => {
    let state = build(["# Morning", "plain", "a!", "b!"]);
    expect(groupOf(state, "Morning").important).toBe(false);

    state = T.remove(state, taskOf(state, "plain").id);
    expect(groupOf(state, "Morning").important).toBe(true);
  });

  it("follows an item moved into it, and again when it leaves", () => {
    let state = rows("# Morning", "  a", "loose");
    state = T.toggleImportant(state, taskOf(state, "a").id);
    expect(groupOf(state, "Morning").important).toBe(true);

    // A plain row moving in makes the group's statement untrue.
    state = T.move(state, taskOf(state, "loose").id, "in");
    expect(groupOf(state, "Morning").important).toBe(false);

    // And taking it back out makes it true again.
    state = T.move(state, taskOf(state, "loose").id, "out");
    expect(groupOf(state, "Morning").important).toBe(true);
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
    let state = rows("# Morning", "  a", "loose");
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
    const state = rows("a", "# Later");
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

  /*
   * The ⋯ menu asks this about groups too, where Tab only ever reached a task.
   * Answering yes would offer a nesting move that cannot happen.
   */
  it("never offers to nest one group inside another", () => {
    const state = rows("# Morning", "  a", "# Later");
    expect(T.groupAbove(state, "Later")).toBeUndefined();
    expect(T.canMove(state, "Later", "in")).toBe(false);
    expect(T.move(state, "Later", "in")).toBe(state);
  });

  it("has no group above a row that is not there", () => {
    expect(T.groupAbove(rows("# Morning", "  a"), "nope")).toBeUndefined();
  });
});

describe("reorder", () => {
  it("swaps two neighbours at the root", () => {
    const state = rows("a", "b", "c");
    expect(shape(T.reorder(state, "b", "up"))).toEqual(["b", "a", "c"]);
    expect(shape(T.reorder(state, "b", "down"))).toEqual(["a", "c", "b"]);
  });

  it("swaps two neighbours inside a group", () => {
    const state = rows("# Morning", "  a", "  b");
    expect(shape(T.reorder(state, "a", "down"))).toEqual(["# Morning", "  b", "  a"]);
  });

  it("steps out above the group when it runs off the top", () => {
    const state = rows("first", "# Morning", "  a", "  b");
    expect(shape(T.reorder(state, "a", "up"))).toEqual(["first", "a", "# Morning", "  b"]);
  });

  it("steps out below the group when it runs off the bottom", () => {
    const state = rows("# Morning", "  a", "  b", "last");
    expect(shape(T.reorder(state, "b", "down"))).toEqual(["# Morning", "  a", "b", "last"]);
  });

  it("enters the group above at its end, and the group below at its start", () => {
    const up = rows("# Morning", "  a", "loose");
    expect(shape(T.reorder(up, "loose", "up"))).toEqual(["# Morning", "  a", "  loose"]);

    const down = rows("loose", "# Morning", "  a");
    expect(shape(T.reorder(down, "loose", "down"))).toEqual(["# Morning", "  loose", "  a"]);
  });

  /*
   * The property that makes holding the key down feel like dragging: one step
   * back always undoes one step forward, whichever boundary it crossed.
   */
  it("makes every step its own inverse", () => {
    const start = rows("top", "# Morning", "  a", "  b", "middle", "# Later", "  c", "bottom");
    for (const id of ["top", "a", "b", "middle", "c", "bottom"]) {
      for (const dir of ["up", "down"] as const) {
        const back = dir === "up" ? "down" : "up";
        const moved = T.reorder(start, id, dir);
        // A row already at the end of the list has no step to invert.
        if (moved === start) continue;
        expect(shape(T.reorder(moved, id, back))).toEqual(shape(start));
      }
    }
  });

  it("moves a group as one block, and never into another group", () => {
    const state = rows("# Morning", "  a", "loose", "# Later", "  b");
    expect(shape(T.reorder(state, "Later", "up"))).toEqual([
      "# Morning",
      "  a",
      "# Later",
      "  b",
      "loose",
    ]);
    // Past a group, not inside it — groups do not nest.
    expect(shape(T.reorder(T.reorder(state, "Later", "up"), "Later", "up"))).toEqual([
      "# Later",
      "  b",
      "# Morning",
      "  a",
      "loose",
    ]);
  });

  it("expands a group it steps into, so the item does not just vanish", () => {
    let state = rows("# Morning", "  a", "loose");
    state = T.toggleCollapse(state, "Morning");
    expect(groupOf(state, "Morning").collapsed).toBe(true);

    state = T.reorder(state, "loose", "up");
    expect(groupOf(state, "Morning").collapsed).toBe(false);
  });

  it("has nowhere to go at either end of the list", () => {
    const state = rows("a", "b");
    expect(T.canReorder(state, "a", "up")).toBe(false);
    expect(T.reorder(state, "a", "up")).toBe(state);
    expect(T.canReorder(state, "b", "down")).toBe(false);
    expect(T.reorder(state, "b", "down")).toBe(state);
  });

  it("says yes exactly when the move would change something", () => {
    const state = rows("top", "# Morning", "  a", "  b", "middle", "# Later", "bottom");
    for (const id of ["top", "Morning", "a", "b", "middle", "Later", "bottom"]) {
      for (const dir of ["up", "down"] as const) {
        const moved = T.reorder(state, id, dir);
        expect([id, dir, T.canReorder(state, id, dir)]).toEqual([
          id,
          dir,
          shape(moved).join() !== shape(state).join(),
        ]);
      }
    }
  });

  it("leaves the state it was given alone", () => {
    const before = rows("# Morning", "  a", "loose");
    const snapshot = JSON.stringify(before);
    T.reorder(before, "a", "up");
    T.reorder(before, "loose", "up");
    expect(JSON.stringify(before)).toBe(snapshot);
  });
});

/*
 * The scope a step is asked for changes what "up" means. Dragging points at a
 * place and goes there, nesting included; "Move up" is a command about a row and
 * must not re-nest it behind the user's back.
 */
describe("reorder within a level", () => {
  it("stops at the ends of its group instead of stepping out", () => {
    const state = rows("top", "# Morning", "  a", "  b", "bottom");

    expect(T.canReorder(state, "a", "up", "level")).toBe(false);
    expect(T.reorder(state, "a", "up", "level")).toBe(state);
    expect(T.canReorder(state, "b", "down", "level")).toBe(false);
    expect(T.reorder(state, "b", "down", "level")).toBe(state);

    // ...while the same step in list scope leaves the group.
    expect(shape(T.reorder(state, "a", "up"))).toEqual(["top", "a", "# Morning", "  b", "bottom"]);
  });

  it("still swaps siblings inside the group", () => {
    const state = rows("# Morning", "  a", "  b");
    expect(shape(T.reorder(state, "a", "down", "level"))).toEqual(["# Morning", "  b", "  a"]);
  });

  it("steps a root item past a whole group rather than into it", () => {
    const state = rows("# Morning", "  a", "loose");
    expect(shape(T.reorder(state, "loose", "up", "level"))).toEqual(["loose", "# Morning", "  a"]);
  });

  it("moves groups exactly as list scope does — they only ever sit at the root", () => {
    const state = rows("# Morning", "  a", "loose", "# Later");
    expect(shape(T.reorder(state, "Later", "up", "level"))).toEqual(
      shape(T.reorder(state, "Later", "up")),
    );
  });

  it("is still its own inverse", () => {
    const start = rows("top", "# Morning", "  a", "  b", "middle", "# Later", "  c", "bottom");
    for (const id of ["top", "a", "b", "middle", "c", "bottom", "Morning", "Later"]) {
      for (const dir of ["up", "down"] as const) {
        const back = dir === "up" ? "down" : "up";
        const moved = T.reorder(start, id, dir, "level");
        if (moved === start) continue;
        expect(shape(T.reorder(moved, id, back, "level"))).toEqual(shape(start));
      }
    }
  });

  it("says yes exactly when the move would change something", () => {
    const state = rows("top", "# Morning", "  a", "  b", "middle", "# Later", "bottom");
    for (const id of ["top", "Morning", "a", "b", "middle", "Later", "bottom"]) {
      for (const dir of ["up", "down"] as const) {
        const moved = T.reorder(state, id, dir, "level");
        expect([id, dir, T.canReorder(state, id, dir, "level")]).toEqual([
          id,
          dir,
          shape(moved).join() !== shape(state).join(),
        ]);
      }
    }
  });

  it("never changes which group an item belongs to", () => {
    const state = rows("top", "# Morning", "  a", "  b", "middle", "# Later", "  c", "bottom");
    const owner = (s: State, id: string): string => T.ownerOf(s, id)?.title ?? "root";

    for (const id of ["top", "a", "b", "middle", "c", "bottom"]) {
      for (const dir of ["up", "down"] as const) {
        expect(owner(T.reorder(state, id, dir, "level"), id)).toBe(owner(state, id));
      }
    }
  });
});

describe("collapse", () => {
  it("folds an open group", () => {
    const state = T.collapse(rows("# Morning", "  a"), "Morning");
    expect(groupOf(state, "Morning").collapsed).toBe(true);
  });

  it("is a no-op on a group that is already folded, and on a missing one", () => {
    const folded = T.toggleCollapse(rows("# Morning", "  a"), "Morning");
    expect(T.collapse(folded, "Morning")).toBe(folded);
    expect(T.collapse(folded, "nope")).toBe(folded);
  });
});

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

describe("findRow", () => {
  it("finds a row of the list itself, and never a nested task", () => {
    const state = rows("a", "# Morning", "  b");
    expect(T.findRow(state, "a")?.id).toBe("a");
    expect(T.findRow(state, "Morning")?.id).toBe("Morning");
    expect(T.findRow(state, "b")).toBeUndefined();
  });
});

describe("clearTicks", () => {
  it("zeroes every count, keeps the list, and closes the day", () => {
    let state = build(["# Morning", "a", "make calls [3]"]);
    for (const task of allTasks(state.list)) state = T.bump(state, task.id, 2, NOW);
    expect(allTasks(state.list).some((t) => t.count > 0)).toBe(true);

    state = T.clearTicks(state);
    expect(allTasks(state.list).every((t) => t.count === 0)).toBe(true);
    expect(texts(state)).toEqual(["make calls", "a"]);
    expect(state.openedAt).toBeNull();
  });

  it("leaves group structure alone", () => {
    const state = T.clearTicks(build(["# Morning", "a", "b"]));
    expect(shape(state)).toEqual(["# Morning", "  b", "  a"]);
  });

  it("takes away a finished one-off", () => {
    let state = build(["a~", "b"]);
    state = T.bump(state, taskOf(state, "a").id, 1, NOW);
    state = T.clearTicks(state);
    expect(texts(state)).toEqual(["b"]);
  });

  it("keeps a one-off nobody got to", () => {
    // The mark is a convenience, not a trapdoor: an errand you did not do is
    // precisely the thing you most need to see in the morning.
    const state = T.clearTicks(build(["a~", "b"]));
    expect(texts(state)).toEqual(["b", "a"]);
  });

  it("keeps a finished item that was never marked one-off", () => {
    let state = build(["a", "b"]);
    state = T.bump(state, taskOf(state, "a").id, 1, NOW);
    expect(texts(T.clearTicks(state))).toEqual(["b", "a"]);
  });

  it("takes one out of a group and leaves the group behind", () => {
    let state = build(["# Morning", "  a~", "  b"]);
    state = T.bump(state, taskOf(state, "a").id, 1, NOW);
    expect(shape(T.clearTicks(state))).toEqual(["# Morning", "  b"]);
  });

  it("re-derives the group mark it just changed the membership of", () => {
    /*
     * Removing an item is a membership change, so the marks have to settle on
     * the way out. Alpha is unmarked only because of the plain one-off in it;
     * once that leaves, everything remaining is marked and the group is too.
     * Without the settle the group would be stuck disagreeing with its items
     * until some unrelated edit corrected it.
     */
    let state = build(["# Alpha", "  plain~", "  keep!"]);
    expect(groupOf(state, "Alpha").important).toBe(false);

    state = T.bump(state, taskOf(state, "plain").id, 1, NOW);
    state = T.clearTicks(state);

    expect(shape(state)).toEqual(["# Alpha", "  keep"]);
    expect(groupOf(state, "Alpha").important).toBe(true);
  });

  it("takes away a group its departing one-offs emptied", () => {
    // A heading with nothing under it says nothing about tomorrow, and leaving
    // it opens the morning on furniture.
    let state = build(["# Errands", "  a~"]);
    state = T.bump(state, taskOf(state, "a").id, 1, NOW);
    state = T.clearTicks(state);
    expect(shape(state)).toEqual([]);
  });

  it("takes away a group that was empty all along", () => {
    // Not only the ones emptied tonight: `# Work!` is a promise about a group
    // you have not filled, and the close is where promises expire. During the
    // day `settle` still keeps the mark it was given — this is the one place
    // that rule stops.
    let state = rows("# Work", "a");
    state = T.toggleImportant(state, groupOf(state, "Work").id);
    expect(groupOf(state, "Work").important).toBe(true);

    expect(shape(T.clearTicks(state))).toEqual(["a"]);
  });

  it("keeps a group that still holds something", () => {
    let state = build(["# Errands", "  a~", "  b"]);
    state = T.bump(state, taskOf(state, "a").id, 1, NOW);
    expect(shape(T.clearTicks(state))).toEqual(["# Errands", "  b"]);
  });

  it("unfolds every group, however it came to be folded", () => {
    let state = build(["# Morning", "a", "# Work", "b"]);
    for (const title of ["Morning", "Work"]) {
      state = T.toggleCollapse(state, groupOf(state, title).id);
    }
    state = T.clearTicks(state);
    expect(state.list.every((node) => node.kind !== "group" || !node.collapsed)).toBe(true);
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

/*
 * `settle` is called from eight places across six transitions, and the way that
 * goes wrong is a seventh transition being added without one. Rather than tidy
 * the call sites — there is no chokepoint to funnel them through — this asserts
 * the invariant itself after every step of an arbitrary run.
 *
 * The rule is written out here rather than imported, on purpose: asking the
 * implementation whether it agrees with itself would pass for the wrong reason.
 */
describe("the group mark holds under any sequence of transitions", () => {
  const unsettled = (state: State): string[] =>
    state.list
      .filter((node): node is Group => node.kind === "group" && node.items.length > 0)
      .filter((group) => group.important !== group.items.every((task) => task.important))
      .map((group) => group.title);

  const seed = (): State => {
    let state = T.add(T.blank(), "# Alpha", null, NOW).state;
    const alpha = groupOf(state, "Alpha").id;
    state = T.add(state, "a1", alpha, NOW).state;
    state = T.add(state, "a2!", alpha, NOW).state;
    state = T.add(state, "# Beta", null, NOW).state;
    const beta = groupOf(state, "Beta").id;
    state = T.add(state, "b1!", beta, NOW).state;
    state = T.add(state, "b2!", beta, NOW).state;
    state = T.add(state, "loose", null, NOW).state;
    state = T.add(state, "loose2!", null, NOW).state;
    state = T.add(state, "errand~", null, NOW).state;
    return T.add(state, "chore!~", alpha, NOW).state;
  };

  type Op =
    | { do: "mark"; at: number }
    | { do: "remove"; at: number }
    | { do: "in"; at: number }
    | { do: "out"; at: number }
    | { do: "up"; at: number }
    | { do: "down"; at: number }
    | { do: "addPlain"; at: number }
    | { do: "addMarked"; at: number }
    | { do: "renamePlain"; at: number }
    | { do: "renameMarked"; at: number }
    | { do: "once"; at: number }
    | { do: "tick"; at: number }
    | { do: "close"; at: number };

  const step = (state: State, op: Op, n: number): State => {
    const rows = [...state.list.map((node) => node.id), ...allTasks(state.list).map((t) => t.id)];
    if (rows.length === 0) return state;
    const id = rows[op.at % rows.length] as string;
    const isGroup = state.list.some((node) => node.kind === "group" && node.id === id);
    const groups = state.list.filter((node): node is Group => node.kind === "group");
    const dest = groups.length ? (groups[op.at % groups.length] as Group).id : null;

    switch (op.do) {
      case "mark":
        return T.toggleImportant(state, id);
      case "remove":
        return T.remove(state, id);
      case "in":
        return T.move(state, id, "in");
      case "out":
        return T.move(state, id, "out");
      case "up":
        return T.reorder(state, id, "up", "list");
      case "down":
        return T.reorder(state, id, "down", "list");
      case "addPlain":
        return T.add(state, `p${String(n)}`, dest, NOW).state;
      case "addMarked":
        return T.add(state, `m${String(n)}!`, dest, NOW).state;
      case "renamePlain":
        return T.retitle(state, id, `r${String(n)}`, isGroup);
      case "renameMarked":
        return T.retitle(state, id, `r${String(n)}!`, isGroup);
      case "once":
        return T.toggleOnce(state, id);
      case "tick":
        return T.bump(state, id, 1, NOW);
      /*
       * Closing the day removes finished one-offs, which makes it a transition
       * that changes a group's membership — the kind that has to re-derive the
       * marks. It is in this fold for exactly that reason.
       */
      case "close":
        return T.clearTicks(state);
    }
  };

  const anyOp = fc.record({
    do: fc.constantFrom<Op["do"]>(
      "mark",
      "remove",
      "in",
      "out",
      "up",
      "down",
      "addPlain",
      "addMarked",
      "renamePlain",
      "renameMarked",
      "once",
      "tick",
      "close",
    ),
    at: fc.nat({ max: 40 }),
  }) as fc.Arbitrary<Op>;

  it("never leaves a group disagreeing with its items", () => {
    fc.assert(
      fc.property(fc.array(anyOp, { minLength: 1, maxLength: 25 }), (ops) => {
        let state = seed();
        expect(unsettled(state)).toEqual([]);
        ops.forEach((op, n) => {
          state = step(state, op, n);
          expect(unsettled(state)).toEqual([]);
        });
      }),
      { numRuns: 300 },
    );
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
