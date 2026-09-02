import { describe, expect, it } from "vitest";
import { outstandingImportant, scoreDay, stepsToBar, summarise } from "../src/progress";
import {
  andMore,
  barAtClose,
  barSoFar,
  departingNote,
  didHeading,
  endLabel,
  NAMED,
  nextLine,
  shortlist,
  verdictOf,
} from "../src/words";
import type { State, Task } from "../src/types";

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

describe("departingNote", () => {
  it("says nothing when the close takes nothing away", () => {
    expect(departingNote([])).toBe("");
  });

  it("names them while naming them is short", () => {
    expect(departingNote(["post the parcel"])).toBe("“post the parcel” will be removed.");
    expect(departingNote(["post the parcel", "call back"])).toBe(
      "“post the parcel” and “call back” will be removed.",
    );
  });

  /* One line either way — this is the card that has to fit without scrolling. */
  it("counts them once naming them would not fit", () => {
    expect(departingNote(["a", "b", "c"])).toBe("3 finished one-off items will be removed.");
    expect(departingNote(Array.from({ length: 9 }, (_, i) => String(i)))).toBe(
      "9 finished one-off items will be removed.",
    );
    expect(departingNote(["a", "b", "c"]).split("\n")).toHaveLength(1);
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
