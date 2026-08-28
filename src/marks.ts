import type { State } from "./types";

/**
 * Re-read every group's mark from the items it holds: important exactly when
 * all of them are.
 *
 * A group's mark and its items' marks are one statement made two ways, and the
 * items are the ones that carry it. So the group is derived rather than kept in
 * its own right, and anything that changes a mark or a group's membership runs
 * this afterwards.
 *
 * Total, in both directions, which is what keeps it honest. Deriving one way
 * only made the mark depend on the order rows arrived in — `a! b! plain` left a
 * group marked where `plain a! b!` did not — and let a plain row dropped into a
 * marked group become important without anyone saying so.
 *
 * Deriving both ways is also what makes the mark removable: clearing a group
 * clears its items, so nothing is left to put the mark straight back.
 *
 * An empty group keeps whatever it was given. `# Work!` is a promise about a
 * group you have not filled yet and there is nothing in it to read; the first
 * row you put in decides it from then on.
 *
 * It lives here rather than in transitions.ts because `normalize` needs it too,
 * and normalize sits below the transitions — a state arriving from outside has
 * to satisfy this before anything is allowed to reason about it.
 *
 * Mutates, because every caller is working on a state it owns.
 */
export function settle(state: State): void {
  for (const node of state.list) {
    if (node.kind !== "group" || node.items.length === 0) continue;
    node.important = node.items.every((task) => task.important);
  }
}
