import { describe, expect, it } from "vitest";
import { allTasks, isDone, overallProgress } from "../src/progress";
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
    const task: Task = { kind: "task", id: text, text, target: 1, count: 0, important: false };
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
    expect(groupOf(state, "Morning").important).toBe(true);
    expect(taskOf(state, "call the bank").important).toBe(true);
    expect(taskOf(state, "water plants").important).toBe(false);
  });

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
    let state = build(["a", "b!", "c"]);
    expect(texts(state)).toEqual(["a", "b", "c"]);

    const id = taskOf(state, "b").id;
    state = T.reorder(state, id, "up", "level");
    expect(texts(state)).toEqual(["b", "a", "c"]);

    state = T.bump(state, id, 1, NOW);
    expect(T.isFinished(taskOf(state, "b"))).toBe(true);
    state = T.sink(state, id);
    expect(texts(state)).toEqual(["a", "c", "b"]);
  });

  it("leaves progress alone", () => {
    const state = build(["a!", "b"]);
    expect(overallProgress(state)).toBe(0);
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

  it("leaves a nested task alone — a group travels as one block", () => {
    const state = done(rows("# Morning", "  a", "  b"), "a");
    expect(T.sink(state, "a")).toBe(state);
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
    expect(texts(state)).toEqual(["a", "make calls"]);
    expect(state.openedAt).toBeNull();
  });

  it("leaves group structure alone", () => {
    const state = T.clearTicks(build(["# Morning", "a", "b"]));
    expect(shape(state)).toEqual(["# Morning", "  a", "  b"]);
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
