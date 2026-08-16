# t0d0

A static, single-screen day tracker at **t0d0.krfu.dev**. One persistent list you prune
each morning and tick through the day. It replaces a plain text file, and losing it should
cost nothing.

The rewarding feel of ticking things off is the product. Treat animation and visual
feedback as features, not polish.

## Hard constraints

These are decisions, not defaults. Changing one is a conversation, not a refactor.

- **Zero runtime dependencies.** No framework, no UI library, no animation library. Build
  and test tooling (Vite, TypeScript, Vitest, Playwright, ESLint) is fine. The app should
  still run untouched in ten years.
- **No network at runtime.** No fonts, analytics, CDNs, telemetry, or API calls. The CSP
  meta tag enforces this — if a change needs an exception, the change is wrong.
- **No dates.** `openedAt` is the only timestamp in the app, and it exists solely so the
  end-of-day card can report elapsed time. Nothing rolls over, expires, or resets itself.
- **No history.** Ticks are cleared, never archived. No streaks, no yesterday, no stats
  beyond the current list.
- **One level of grouping.** The type system forbids deeper nesting; keep it that way.
- **Offline-first.** Everything lives in one `localStorage` key. It must work with the
  network off, and never lose the list on a failed write.

## Domain model

```ts
type Task = { kind: "task"; id: string; text: string; target: number; count: number };
type Group = { kind: "group"; id: string; title: string; collapsed: boolean; items: Task[] };

type State = { v: 1; openedAt: number | null; list: (Task | Group)[] };
```

Invariants worth defending in review:

- **`done` is derived**, never stored: `count >= target`. A plain checkbox is `target: 1`.
  Do not add a `done` field — it will drift.
- **`list` is one ordered array.** Position is the ordering. Ungrouped tasks sit at the
  root beside groups; there is no implicit "Inbox".
- **Progress is `mean(count / target)`** over tasks, so one `[20]` item cannot swamp the
  ring. Empty groups are excluded from totals and render no ring.
- **All external data goes through `normalize()`** — stored JSON and pasted imports alike.
  It repairs rather than trusts: clamps `target` to 1–99, clamps `count` to `target`, drops
  empty text, regenerates duplicate ids. Never parse straight into state.
- **Celebration fires only on the transition into complete**, and only for a non-empty
  list. Re-arm when progress drops below 100%.
- **Destructive actions confirm in place**, never in a dialog stacked on a dialog: the
  control swaps into a confirm state and reverts on a timeout. Erase, and replace-on-
  import, both follow this.

## Input syntax

The composer parses two things, and both must round-trip through inline editing:

- `# Morning` creates a group.
- `make calls [3]` creates a task with `target: 3`. Editing shows `make calls [3]` again.

## Commands

```
npm run dev        # vite dev server
npm run build      # typecheck, then production build
npm run preview    # serve dist/ locally
npm test           # vitest, unit + DOM
npm run test:e2e   # playwright
npm run lint       # eslint
npm run check      # lint + typecheck + test — what CI runs
```

Node version is pinned in `.nvmrc`. Use `npm ci`, not `npm install`, in automation.

## Where things live

```
src/state.ts      types, normalize, load/save, all state transitions
src/parse.ts      "# Title" and "[n]" parsing, and the raw() round-trip
src/progress.ts   the mean(count/target) formula
src/render/       keyed DOM patching — list, task, group, ring
src/ui/           toast, day-summary sheet, drawer (backup/reset/about), confetti
src/styles/       tokens.css first, then base.css, then app.css
```

`src/render/list.ts` holds the keyed patch. It exists so editing a row never destroys its
DOM node — that would kill focus mid-edit and cancel in-flight transitions. If you find
yourself rebuilding `innerHTML`, stop; that is the bug this file prevents.

## Testing expectations

- `parse`, `progress`, and `normalize` are pure and should stay at full coverage. Most
  real bugs live there.
- State transitions (add, delete, move in/out of a group, clear ticks, undo) are tested as
  pure functions over `State`, without a DOM.
- The keyed patch has DOM tests asserting node identity survives an update.
- Playwright covers the paths a unit test cannot: persistence across reload, the mobile
  viewport, and the export/import round-trip.
- Every animation must have a `prefers-reduced-motion` path that still lands in a finished
  visual state — reduced motion means instant, not absent.

## Conventions

- TypeScript strict. No `any`; prefer discriminated unions over optional-field soup.
- Conventional Commits. Work on a branch, PR into `main`; pushing `main` deploys.
- Comments explain **why**, not what. The keyed patch and the celebration guard deserve
  comments; a `for` loop does not.
- Accessibility is not optional: real `<input type="checkbox">` semantics, visible focus,
  `aria-live` on progress, ≥44px touch targets. `@media (hover: hover)` is the correct
  fork for pointer affordances — never a width breakpoint. Every dialog traps focus via
  `src/ui/focus.ts` and hands it back on close; `aria-modal` alone does nothing for Tab.

## Deliberately out of scope

Say no to these unless the user explicitly reopens the decision:

- Recurring items, templates, or scheduling
- Pomodoro countdowns, enforced breaks, or any timer that interrupts
- Streaks, history, archives, or completion stats over time
- Accounts, sync, or any server
- Drag-and-drop reordering (Tab / Shift-Tab moves items; a `⋯` menu covers touch)
- Merge-on-import — import replaces, and undo covers it
