import type { DayScore } from "./progress";

/**
 * The day's three moments, in the order they can be reached.
 *
 * Order is load-bearing: it is what "highest first" means when one change
 * crosses more than one line at a time.
 */
export const MILESTONES = ["cleared", "succeeded", "complete"] as const;
export type Milestone = (typeof MILESTONES)[number];

/** Which moments are still owed a celebration. */
export type Arming = Record<Milestone, boolean>;

/**
 * Which moments the list has reached, right now.
 *
 * `cleared` is only a moment when there was something marked to clear: with
 * nothing important on the list the gate is vacuously true, and celebrating it
 * would fire on the very first tick of an ordinary day.
 */
function reached(score: DayScore): Arming {
  return {
    cleared: score.hasImportant && score.cleared && score.total > 0,
    succeeded: score.succeeded,
    complete: score.complete,
  };
}

/**
 * The highest moment this day has reached, or null when it has reached none.
 *
 * The closing card's ceremony is scaled by this, so the reward is proportional
 * rather than unconditional: a day that earned nothing gets no shower, which is
 * the same rule that keeps `verdictOf` silent on an unfinished day. Shared with
 * {@link cross} rather than written out again, because "which moment" having two
 * definitions is how a card comes to celebrate something the ring did not.
 */
export function highest(score: DayScore): Milestone | null {
  const now = reached(score);
  return [...MILESTONES].reverse().find((milestone) => now[milestone]) ?? null;
}

/** Armed for everything not currently reached, spent for everything that is. */
const armFor = (now: Arming): Arming => ({
  cleared: !now.cleared,
  succeeded: !now.succeeded,
  complete: !now.complete,
});

/**
 * Spend every moment the list has already reached, without celebrating it.
 *
 * For the moments a change did not earn: boot, an import, and moving the
 * success bar in Settings — a milestone reached by shifting your own goalposts
 * was not earned, so it arms silently and waits to be crossed properly.
 */
export const spend = (score: DayScore): Arming => armFor(reached(score));

/**
 * What this change just crossed, and the arming to carry forward.
 *
 * Highest first, and only ever one: a single tick can cross two lines at once —
 * the last important item landing on a list already past the bar — and two
 * showers on the same frame read as one messy shower rather than as two
 * rewards. The lower moments are still spent, so they cannot fire late.
 *
 * Everything not reached re-arms, which is what lets a moment be earned again
 * after the list falls back below it.
 */
export function cross(armed: Arming, score: DayScore): { fired: Milestone | null; armed: Arming } {
  const now = reached(score);
  const fired = [...MILESTONES].reverse().find((milestone) => now[milestone] && armed[milestone]);
  return { fired: fired ?? null, armed: armFor(now) };
}
