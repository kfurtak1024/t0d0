import { describe, expect, it } from "vitest";
import { outstandingImportant, scoreDay, stepsToBar, summarise } from "../src/progress";
import {
  andMore,
  barAtClose,
  barSoFar,
  count,
  deletedNote,
  deleteLabel,
  didHeading,
  endLabel,
  importedNote,
  NAMED,
  nextLine,
  plural,
  shortlist,
  verdictOf,
} from "../src/words";
import type { Group, State, Task } from "../src/types";

/**
 * Every sentence the day is reported in.
 *
 * These used to live in `src/app.ts` and `src/ui/**`, which coverage excludes
 * because Playwright owns the rendering layer — so they were checked only by
 * whichever end-to-end test happened to assert their text. `nextLine` had a
 * whole branch nothing had ever asked, and it told every day that cleared the
 * bar without finishing that it had "0 things left for a clean sweep".
 */

const task = (id: string, important: boolean, count: number, target = 1): Task => ({
  kind: "task",
  id,
  text: id,
  target,
  count,
  important,
  once: false,
});

const listOf = (...tasks: Task[]): State => ({ v: 1, openedAt: null, list: tasks });
const scoreOf = (state: State, bar = 0.7) => scoreDay(state, bar);

/** The card's own call, so the test cannot pass by handing in numbers by hand. */
const lineFor = (state: State, bar = 0.7): string => {
  const summary = summarise(state, bar);
  return nextLine(
    scoreOf(state, bar),
    {
      important: outstandingImportant(state.list).length,
      unfinished: summary.total - summary.done,
    },
    stepsToBar(state, bar),
  );
};

describe("endLabel", () => {
  it("says the biggest true thing and stops", () => {
    expect(endLabel(scoreOf(listOf(task("a", true, 1), task("b", false, 1))))).toBe(
      "Everything done",
    );
    expect(
      endLabel(
        scoreOf(
          listOf(
            task("a", true, 1),
            task("b", false, 1),
            task("c", false, 1),
            task("d", false, 1),
            task("e", false, 0),
          ),
        ),
      ),
    ).toBe("That's a good day");
    expect(
      endLabel(scoreOf(listOf(task("a", true, 1), task("b", false, 0), task("c", false, 0)))),
    ).toBe("The important work is done");
    expect(endLabel(scoreOf(listOf(task("a", true, 0), task("b", false, 0))))).toBe(
      "That's the day",
    );
  });

  /* Nothing marked means no green gate to report, however well the day went. */
  it("never claims important work on a list with none", () => {
    expect(endLabel(scoreOf(listOf(task("a", false, 0), task("b", false, 0))))).toBe(
      "That's the day",
    );
  });

  it("gives an empty list the plainest label rather than a boast", () => {
    expect(endLabel(scoreOf(listOf()))).toBe("That's the day");
  });
});

describe("verdictOf", () => {
  it("mirrors the closer's ranking, in the card's own voice", () => {
    expect(verdictOf(scoreOf(listOf(task("a", true, 1))))).toBe("Everything done.");
    expect(
      verdictOf(
        scoreOf(
          listOf(
            task("a", true, 1),
            task("b", false, 1),
            task("c", false, 1),
            task("d", false, 1),
            task("e", false, 0),
          ),
        ),
      ),
    ).toBe("That's a good day.");
    expect(
      verdictOf(scoreOf(listOf(task("a", true, 1), task("b", false, 0), task("c", false, 0)))),
    ).toBe("The important things are done.");
  });

  /*
   * The silence is the design: the score above it is honest, and the rail and
   * the gates say which thing was left. A consoling line here would undo that.
   */
  it("says nothing at all to an unfinished day", () => {
    expect(verdictOf(scoreOf(listOf(task("a", true, 0), task("b", false, 0))))).toBe("");
    expect(verdictOf(scoreOf(listOf()))).toBe("");
  });
});

describe("nextLine", () => {
  it("says nothing about an empty list", () => {
    expect(lineFor(listOf())).toBe("");
  });

  it("names the marked work while the green gate is shut", () => {
    expect(lineFor(listOf(task("m1", true, 0), task("m2", true, 0), task("r1", false, 1)))).toBe(
      "2 important things left, then the day turns green.",
    );
    expect(lineFor(listOf(task("m1", true, 0), task("r1", false, 1)))).toBe(
      "1 important thing left, then the day turns green.",
    );
  });

  it("names the bar once the marked work has landed", () => {
    expect(lineFor(listOf(task("m1", true, 1), task("r1", false, 0), task("r2", false, 0)))).toBe(
      "The important work is done. 2 more clears the bar.",
    );
    expect(lineFor(listOf(task("m1", true, 1), task("r1", false, 1), task("r2", false, 0)))).toBe(
      "The important work is done. One more clears the bar.",
    );
  });

  it("drops the important half when nothing is marked", () => {
    expect(lineFor(listOf(task("r1", false, 1), task("r2", false, 0), task("r3", false, 0)))).toBe(
      "2 more and it's a good day.",
    );
  });

  /*
   * The regression. Past the bar and not finished: `outstandingImportant` is
   * zero by construction here, so the line has to count everything left
   * instead — the one unmarked item still to do, not the nought marked ones.
   */
  it("counts everything left for a clean sweep, not the marked work", () => {
    const state = listOf(
      task("m1", true, 1),
      task("m2", true, 1),
      task("r1", false, 1),
      task("r2", false, 1),
      task("r3", false, 1),
      task("r4", false, 1),
      task("r5", false, 0),
    );
    const score = scoreOf(state);
    expect(score.succeeded).toBe(true);
    expect(score.complete).toBe(false);
    expect(outstandingImportant(state.list)).toHaveLength(0);
    expect(lineFor(state)).toBe("1 thing left for a clean sweep.");
  });

  it("counts a part-done item among what a clean sweep still owes", () => {
    const state = listOf(
      task("r1", false, 1),
      task("r2", false, 1),
      task("r3", false, 1),
      task("r4", false, 1),
      task("r5", false, 1, 3),
    );
    expect(scoreOf(state).succeeded).toBe(true);
    expect(lineFor(state)).toBe("1 thing left for a clean sweep.");
  });

  it("pluralises a clean sweep's own count", () => {
    const state = listOf(
      task("r1", false, 1),
      task("r2", false, 1),
      task("r3", false, 1),
      task("r4", false, 1),
      task("r5", false, 1),
      task("r6", false, 1),
      task("r7", false, 1),
      task("r8", false, 0),
      task("r9", false, 0),
    );
    expect(scoreOf(state).succeeded).toBe(true);
    expect(lineFor(state)).toBe("2 things left for a clean sweep.");
  });

  it("stops asking for anything once everything is done", () => {
    expect(lineFor(listOf(task("m1", true, 1), task("r1", false, 1)))).toBe("Everything done.");
  });
});

/*
 * The numbers are shared; the words are not. One card is looking forward at a
 * day still being spent, the other is reporting one that is over — so the same
 * `steps` reads differently in each, and that is the point.
 */
describe("the two bar notes", () => {
  it("agree once the bar is cleared", () => {
    expect(barSoFar(0, 0.7)).toBe("past the bar, set at 70%");
    expect(barAtClose(0, 0.7)).toBe("past the bar, set at 70%");
  });

  it("part company while there is still a day to spend", () => {
    expect(barSoFar(1, 0.7)).toBe("one more clears the bar, set at 70%");
    expect(barSoFar(3, 0.7)).toBe("3 more clear the bar, set at 70%");
    expect(barAtClose(1, 0.7)).toBe("short of the bar, set at 70%");
    expect(barAtClose(3, 0.7)).toBe("short of the bar, set at 70%");
  });

  it("report whichever bar the preference names", () => {
    expect(barSoFar(0, 0.5)).toContain("set at 50%");
    expect(barAtClose(2, 1)).toBe("short of the bar, set at 100%");
  });
});

/*
 * The cap the cards list under. One rule for both halves of the report: the
 * gates name what is still owed, "Got done" names what is behind you, and a
 * card that capped those differently would say the same kind of thing twice
 * in two voices.
 */
describe("shortlist", () => {
  const rows = (n: number): string[] => Array.from({ length: n }, (_, i) => `row ${String(i)}`);

  it("names everything while everything fits", () => {
    expect(shortlist(rows(NAMED))).toEqual({ named: rows(NAMED), more: 0 });
    expect(shortlist([])).toEqual({ named: [], more: 0 });
  });

  it("counts the rest once it stops naming them", () => {
    const { named, more } = shortlist(rows(NAMED + 3));
    expect(named).toHaveLength(NAMED);
    expect(more).toBe(3);
  });

  it("keeps the order the list keeps", () => {
    expect(shortlist(["c", "a", "b"], 2).named).toEqual(["c", "a"]);
  });

  it("never reports a negative remainder", () => {
    expect(shortlist(rows(1), 9).more).toBe(0);
  });

  it("says what it left out", () => {
    expect(andMore(3)).toBe("and 3 more");
    expect(andMore(1)).toBe("and 1 more");
  });
});

describe("didHeading", () => {
  it("counts the day's work in the heading itself", () => {
    expect(didHeading(1)).toBe("Got done — 1 thing");
    expect(didHeading(7)).toBe("Got done — 7 things");
  });

  /*
   * Silent on a day with nothing done, for the same reason `verdictOf` is
   * silent on an unfinished one: an empty "Got done" heading reads worse than
   * no heading at all.
   */
  it("says nothing at all when nothing got done", () => {
    expect(didHeading(0)).toBe("");
  });
});

/**
 * The sentences a change to the list says about it.
 *
 * They lived in `app.ts` and in the drawer, where coverage does not reach, as
 * four separate implementations of one agreement rule — two of them spelled
 * `n === 1 ? "" : "s"` and one `n > 1 ? "s" : ""`, which part company at zero.
 */
describe("plural", () => {
  it("agrees with its count", () => {
    expect(plural(1, "thing", "things")).toBe("1 thing");
    expect(plural(2, "thing", "things")).toBe("2 things");
  });

  /*
   * The case the two old spellings disagreed on. Nothing reached it, because
   * the `> 1` call site guarded on the count first — but "0 item" was one
   * refactor away from being printed.
   */
  it("treats zero as plural, which is what English does", () => {
    expect(plural(0, "thing", "things")).toBe("0 things");
    expect(count(0, "item")).toBe("0 items");
  });

  it("makes a regular plural for the drawer's nouns", () => {
    expect(count(1, "item")).toBe("1 item");
    expect(count(3, "group")).toBe("3 groups");
  });
});

describe("importedNote", () => {
  it("counts what arrived", () => {
    expect(importedNote(1)).toBe("Imported 1 item");
    expect(importedNote(12)).toBe("Imported 12 items");
  });

  it("says so even when the file was empty", () => {
    expect(importedNote(0)).toBe("Imported 0 items");
  });
});

const groupOf = (title: string, items: Task[]): Group => ({
  kind: "group",
  id: title,
  title,
  collapsed: false,
  important: false,
  items,
});

/*
 * A group names what it takes with it, before and after the fact. "Deleted"
 * alone does not mention the items, and they do not come back on their own.
 */
describe("deletedNote and deleteLabel", () => {
  it("says only that a row went, when it was only a row", () => {
    expect(deletedNote(undefined)).toBe("Deleted");
    expect(deleteLabel(undefined)).toBe("Delete");
  });

  it("names an empty group without promising it held anything", () => {
    const empty = groupOf("Later", []);
    expect(deletedNote(empty)).toBe("Deleted “Later”");
    expect(deleteLabel(empty)).toBe("Delete group");
  });

  it("counts what a group takes with it", () => {
    const one = groupOf("Work", [task("a", false, 0)]);
    expect(deletedNote(one)).toBe("Deleted “Work” and 1 item");
    expect(deleteLabel(one)).toBe("Delete group and 1 item");

    const several = groupOf("Work", [task("a", false, 0), task("b", false, 0)]);
    expect(deletedNote(several)).toBe("Deleted “Work” and 2 items");
    expect(deleteLabel(several)).toBe("Delete group and 2 items");
  });

  /*
   * The two say the same thing either side of the press, so a group that reads
   * "Delete group and 3 items" must not then report something else.
   */
  it("agrees with itself before and after", () => {
    const group = groupOf("Errands", [task("a", false, 0), task("b", false, 0)]);
    expect(deleteLabel(group)).toContain("2 items");
    expect(deletedNote(group)).toContain("2 items");
  });
});
