import { describe, expect, it } from "vitest";
import { isDone } from "../../src/progress";
import * as T from "../../src/transitions";
import type { State } from "../../src/types";
import { NOW, empty, build, texts, rows, shape, groupOf, taskOf } from "./shared";

/*
 * Adding, counting, renaming and removing rows, as State -> State.
 */

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
