import { describe, expect, it } from "vitest";
import { cross, highest, spend, type Arming } from "../src/milestones";
import type { DayScore } from "../src/progress";

/**
 * The arming machine, on its own. Every rule here was previously reachable only
 * through a browser with `navigator.vibrate` stubbed, which is a lot of
 * apparatus for a decision that is three booleans wide.
 *
 * Scores are built by hand rather than through `scoreDay`, so a change to how
 * the day is scored cannot quietly change what these say about *celebrating*.
 */
const score = (over: Partial<DayScore> = {}): DayScore => ({
  important: 0,
  rest: 0,
  hasImportant: true,
  cleared: false,
  succeeded: false,
  complete: false,
  total: 4,
  ...over,
});

const ALL_ARMED: Arming = { cleared: true, succeeded: true, complete: true };

describe("cross", () => {
  it("fires nothing while no line has been passed", () => {
    expect(cross(ALL_ARMED, score()).fired).toBeNull();
  });

  it("fires a moment once, and then stays quiet", () => {
    const first = cross(ALL_ARMED, score({ cleared: true }));
    expect(first.fired).toBe("cleared");

    // Still cleared, already spent.
    expect(cross(first.armed, score({ cleared: true })).fired).toBeNull();
  });

  it("re-arms when the list falls back below, and fires again", () => {
    const spent = cross(ALL_ARMED, score({ cleared: true })).armed;

    const dropped = cross(spent, score({ cleared: false }));
    expect(dropped.fired).toBeNull();
    expect(dropped.armed.cleared).toBe(true);

    expect(cross(dropped.armed, score({ cleared: true })).fired).toBe("cleared");
  });

  /*
   * One tick can cross two lines at once — the last important item landing on a
   * list already past the bar. Two showers on the same frame read as one messy
   * shower, so only the higher fires and the lower is spent rather than left to
   * go off late.
   */
  it("fires only the highest of a doubled crossing", () => {
    const both = cross(ALL_ARMED, score({ cleared: true, succeeded: true }));
    expect(both.fired).toBe("succeeded");
    expect(both.armed.cleared).toBe(false);

    // Dropping back below the bar must not now let `cleared` go off late.
    expect(cross(both.armed, score({ cleared: true })).fired).toBeNull();
  });

  it("fires only complete when a change crosses all three", () => {
    const all = cross(ALL_ARMED, score({ cleared: true, succeeded: true, complete: true }));
    expect(all.fired).toBe("complete");
    expect(all.armed).toEqual({ cleared: false, succeeded: false, complete: false });
  });

  /*
   * With nothing marked the gate is vacuously true, so celebrating it would go
   * off on the first tick of an ordinary day.
   */
  it("never calls clearing a moment when nothing is marked", () => {
    const none = score({ hasImportant: false, cleared: true });
    expect(cross(ALL_ARMED, none).fired).toBeNull();
    expect(cross(ALL_ARMED, none).armed.cleared).toBe(true);
  });

  it("has no moments to offer an empty list", () => {
    const empty = score({ total: 0, hasImportant: false, cleared: true });
    expect(cross(ALL_ARMED, empty).fired).toBeNull();
  });
});

describe("spend", () => {
  it("marks everything already reached, so a load never celebrates", () => {
    expect(spend(score({ cleared: true, succeeded: true }))).toEqual({
      cleared: false,
      succeeded: false,
      // Not reached, so still owed.
      complete: true,
    });
  });

  it("leaves unreached moments armed for later", () => {
    expect(spend(score())).toEqual(ALL_ARMED);
  });

  it("agrees with what a crossing would have left behind", () => {
    // The two must not drift: arming on boot and arming after a change are the
    // same question asked at different moments.
    const s = score({ cleared: true, succeeded: true });
    expect(spend(s)).toEqual(cross(ALL_ARMED, s).armed);
  });
});

/**
 * Which moment a day has reached, regardless of what it has already spent.
 *
 * The closing card's shower is scaled by this, so it is what keeps the reward
 * proportional rather than unconditional — a day that reached none of the three
 * gets nothing, the same silence `verdictOf` keeps on an unfinished day.
 */
describe("highest", () => {
  it("reaches nothing on a day that has done nothing", () => {
    expect(highest(score())).toBeNull();
  });

  it("names the top moment, not the first", () => {
    expect(highest(score({ cleared: true }))).toBe("cleared");
    expect(highest(score({ cleared: true, succeeded: true }))).toBe("succeeded");
    expect(highest(score({ cleared: true, succeeded: true, complete: true }))).toBe("complete");
  });

  /* Vacuously cleared is not cleared — the same gate `cross` puts on it. */
  it("does not count a cleared flag nobody earned", () => {
    expect(highest(score({ hasImportant: false, cleared: true }))).toBeNull();
    expect(highest(score({ hasImportant: false, cleared: true, succeeded: true }))).toBe(
      "succeeded",
    );
  });

  it("reaches nothing on an empty list, whatever the flags say", () => {
    expect(highest(score({ total: 0, cleared: true }))).toBeNull();
  });

  it("agrees with what cross would fire from a full arming", () => {
    for (const over of [
      {},
      { cleared: true },
      { cleared: true, succeeded: true },
      { cleared: true, succeeded: true, complete: true },
    ]) {
      const day = score(over);
      expect(highest(day)).toBe(cross(ALL_ARMED, day).fired);
    }
  });
});
