import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { allTasks, progress } from "../../src/progress";
import * as T from "../../src/transitions";
import type { Group, State } from "../../src/types";
import { NOW, build, texts, rows, groupOf, taskOf } from "./shared";

/*
 * The important mark, and a group's mark derived from its items.
 */

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
