/**
 * The app's delays, in one module with nothing else in it.
 *
 * The end-to-end tests run on a held clock and advance it on purpose, so they
 * need these numbers — and a test that restated 520 would go on passing, wrong,
 * the day the delay changed. Importing them is what keeps the two in step, and
 * this file having no side effects is what makes importing it from a test safe.
 */

/** Long enough for the tick to finish landing before the group folds over it. */
export const COLLAPSE_MS = 520;

/** A deleted row's exit, before it leaves the list. */
export const EXIT_MS = 200;

/** The header's percentage counts up to a new value over this, on animation frames. */
export const COUNT_UP_MS = 420;

/** The closing card's score counts up to the day over this, on animation frames. */
export const SCORE_COUNT_MS = 900;

/** How long the toast, and the undo it offers, stays up. */
export const TOAST_MS = 5000;

/** How long a destructive control waits in its confirm state before reverting. */
export const CONFIRM_MS = 5000;

/** A day left open longer than this is met with its own summary in the morning. */
export const STALE_MS = 16 * 60 * 60 * 1000;
