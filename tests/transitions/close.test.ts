import { describe, expect, it } from "vitest";
import { allTasks } from "../../src/progress";
import * as T from "../../src/transitions";
import { NOW, build, texts, rows, shape, groupOf, taskOf } from "./shared";

/*
 * Closing the day.
 */

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
