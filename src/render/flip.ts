/**
 * FLIP: First, Last, Invert, Play.
 *
 * The keyed patch relocates a row with `insertBefore`, which is instantaneous —
 * correct for the DOM, wrong for the eye. Reordering without this reads as the
 * list teleporting, which on a page whose whole point is how it feels is a bug
 * rather than a missing flourish.
 *
 * Measure where the rows are, let the caller rearrange them, measure again, then
 * put each row back where it started with a transform and animate that away. The
 * browser only ever paints transforms, so this stays on the compositor even when
 * the whole list shifts.
 */

const DURATION = 260;

/** Rows that moved far enough to be worth animating, in px. */
const THRESHOLD = 1;

export interface FlipOptions {
  /** Reduced motion means instant — the rearrangement still happens. */
  instant?: boolean;
  easing?: string;
}

export function flip(
  rows: Iterable<HTMLElement>,
  rearrange: () => void,
  options: FlipOptions = {},
) {
  if (options.instant) {
    rearrange();
    return;
  }

  const before = new Map<HTMLElement, DOMRect>();
  for (const row of rows) before.set(row, row.getBoundingClientRect());

  rearrange();

  for (const [row, first] of before) {
    // A row the patch removed has no box to travel to.
    if (!row.isConnected) continue;

    const last = row.getBoundingClientRect();
    const dx = first.left - last.left;
    const dy = first.top - last.top;
    if (Math.abs(dx) < THRESHOLD && Math.abs(dy) < THRESHOLD) continue;

    row.animate(
      [
        { transform: `translate(${String(dx)}px, ${String(dy)}px)` },
        { transform: "translate(0, 0)" },
      ],
      {
        duration: DURATION,
        easing: options.easing ?? "cubic-bezier(0.22, 0.68, 0.36, 1)",
        // Never composite with the row's own transitions — a row that is also
        // leaving is mid-transform already, and two owners fight.
        composite: "replace",
      },
    );
  }
}
