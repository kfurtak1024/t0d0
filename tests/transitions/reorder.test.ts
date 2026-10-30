import { describe, expect, it } from "vitest";
import * as T from "../../src/transitions";
import type { State } from "../../src/types";
import { build, rows, shape, groupOf, taskOf } from "./shared";

/*
 * Reordering: the one step, its scopes, and moving in and out of groups.
 */

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

describe("findRow", () => {
  it("finds a row of the list itself, and never a nested task", () => {
    const state = rows("a", "# Morning", "  b");
    expect(T.findRow(state, "a")?.id).toBe("a");
    expect(T.findRow(state, "Morning")?.id).toBe("Morning");
    expect(T.findRow(state, "b")).toBeUndefined();
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
