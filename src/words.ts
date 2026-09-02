import type { DayScore } from "./progress";

/**
 * What the day is reported in: every sentence the two cards and the closer say
 * about how it is going.
 *
 * It lives here rather than beside the cards that print it because these are
 * pure functions over a `DayScore` and a couple of counts, and `src/ui/**` is
 * excluded from coverage — Playwright owns the rendering layer, and a browser
 * is a slow and roundabout place to ask what a sentence says. Sitting in there
 * meant they were only ever checked by whichever end-to-end test happened to
 * assert their text, which is how `nextLine` came to tell every day that had
 * cleared the bar without finishing that it had "0 things left for a clean
 * sweep".
 *
 * The *numbers* the two cards report are shared, in `progress.ts`. The words
 * are deliberately not: one card is looking forward at a day still being spent
 * and the other is reporting one that is over, so each gets its own note and
 * flattening them into one voice would make one of them wrong. Keeping both
 * here is what makes that contrast legible in a single place.
 */

const plural = (n: number, one: string, many: string): string =>
  `${String(n)} ${n === 1 ? one : many}`;

/**
 * How long the day has been open, without naming a unit nobody asked for.
 *
 * No suffix: the cards differ on what follows — "in" while the day runs,
 * "since you started" once it is over — so the sentence belongs to the caller
 * and only the duration is shared.
 */
export function elapsed(ms: number): string {
  const minutes = Math.round(ms / 60_000);
  if (minutes < 60) return `${String(minutes)} min`;
  return `${String(Math.floor(minutes / 60))}h ${String(minutes % 60).padStart(2, "0")}m`;
}

/**
 * What the closer says about the day so far.
 *
 * The ring reports the same thing in hue, and hue is not a channel everyone
 * has — red and green are one colour to a deuteranope, and those are the two
 * landmarks that matter most. This is the verdict in words, on screen, without
 * having to open a card to read it.
 *
 * Ordered by what outranks what, so a finished day is not also told the
 * important things are done.
 */
export function endLabel(score: DayScore): string {
  if (score.complete) return "Everything done";
  if (score.succeeded) return "That's a good day";
  if (score.hasImportant && score.cleared) return "The important work is done";
  return "That's the day";
}

/**
 * What the day amounted to, in one line, on the card that ends it.
 *
 * Ordered by what outranks what, so a perfect day is not also told that the
 * important things are done — it says the biggest true thing and stops. An
 * unfinished day says nothing rather than something consoling; the score above
 * it already reports honestly, and a card that praises 2 of 9 is not a card
 * anyone believes twice. The rail and the gates are what let that silence
 * stand without the card being evasive.
 */
export function verdictOf(score: DayScore): string {
  if (score.complete) return "Everything done.";
  if (score.succeeded) return "That's a good day.";
  if (score.hasImportant && score.cleared) return "The important things are done.";
  return "";
}

/**
 * What this close takes away for good, in one line.
 *
 * Ticks come back tomorrow; a removed one-off does not, and undo is a single
 * level that does not survive a reload — so the loss has to be visible at the
 * moment of pressing rather than discovered in the morning.
 *
 * Named while naming them is short, counted once it would not be. One line
 * either way: this is the card that must fit without scrolling, and a list
 * that grew with the day would be the thing that pushed the button under the
 * fold.
 */
export function departingNote(titles: string[]): string {
  const quoted = titles.map((title) => `“${title}”`);
  if (quoted.length === 0) return "";
  if (quoted.length === 1) return `${String(quoted[0])} will be removed.`;
  if (quoted.length === 2) return `${String(quoted[0])} and ${String(quoted[1])} will be removed.`;
  return `${String(quoted.length)} finished one-off items will be removed.`;
}

/**
 * What is still to do, counted the two different ways {@link nextLine} needs.
 *
 * They are genuinely two numbers, not one seen twice. Past the bar with the
 * marked work done, `important` is zero by construction — that is what
 * `succeeded` means — so a clean sweep has to be measured against everything
 * left, while the green gate is measured against the marked work alone.
 */
export interface Outstanding {
  /** Marked things still to do — what the green gate is waiting on. */
  important: number;
  /** Everything still to do, marked or not — what a clean sweep is waiting on. */
  unfinished: number;
}

/**
 * What the next tick buys, on the card the day ring opens.
 *
 * The closing card says nothing to an unfinished day, on the grounds that
 * praise for 2 of 9 is not believed twice. This is the other half of that rule
 * rather than a breach of it: naming the next landmark is not praise, and a
 * card opened mid-morning that said nothing would be worth opening once.
 *
 * Ordered by which gate is still shut, so it always names the nearest one —
 * and each branch reads the count its own gate is about. Sharing one figure
 * across them read "0 things left for a clean sweep" on every day that had
 * passed the bar without finishing, which is the day this card is most often
 * opened on.
 */
export function nextLine(score: DayScore, left: Outstanding, steps: number): string {
  if (score.total === 0) return "";
  if (score.complete) return "Everything done.";
  if (score.succeeded)
    return `${plural(left.unfinished, "thing", "things")} left for a clean sweep.`;
  if (score.hasImportant && !score.cleared)
    return `${plural(left.important, "important thing", "important things")} left, then the day turns green.`;
  const more = steps === 1 ? "One more" : `${String(steps)} more`;
  return score.hasImportant
    ? `The important work is done. ${more} clears the bar.`
    : `${more} and it's a good day.`;
}

const barAt = (bar: number): string => `set at ${String(Math.round(bar * 100))}%`;

/** What the rest of the list still owes the bar, while there is a day left to spend. */
export function barSoFar(steps: number, bar: number): string {
  if (steps === 0) return `past the bar, ${barAt(bar)}`;
  return steps === 1
    ? `one more clears the bar, ${barAt(bar)}`
    : `${String(steps)} more clear the bar, ${barAt(bar)}`;
}

/** How the rest of the list finished against the bar, for a day that is over. */
export const barAtClose = (steps: number, bar: number): string =>
  steps === 0 ? `past the bar, ${barAt(bar)}` : `short of the bar, ${barAt(bar)}`;
