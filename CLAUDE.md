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
  still run untouched in ten years. The one thing that ships and is not ours is Workbox's
  precache runtime (~5 kB gzipped), which `vite-plugin-pwa` emits into the service worker;
  the CI budget measures it, and `injectManifest` is the way out if it ever stops earning
  its place.
- **No network at runtime.** No fonts, analytics, CDNs, telemetry, or API calls. The CSP
  meta tag enforces this — if a change needs an exception, the change is wrong.
- **No dates.** `openedAt` is the only timestamp in the app, and it exists solely so the
  end-of-day card can report elapsed time. Nothing rolls over, expires, or resets itself.
- **No history.** Ticks are cleared, never archived. No streaks, no yesterday, no stats
  beyond the current list.
- **One level of grouping.** The type system forbids deeper nesting; keep it that way.
- **Offline-first.** The list lives in one `localStorage` key. It must work with the
  network off, and a write that cannot reach storage must say so rather than
  pretend — `save()` returns false and the app surfaces it.

## Domain model

```ts
type Task = {
  kind: "task";
  id: string;
  text: string;
  target: number;
  count: number;
  important: boolean;
};
type Group = {
  kind: "group";
  id: string;
  title: string;
  collapsed: boolean;
  important: boolean;
  items: Task[];
};

type State = { v: 1; openedAt: number | null; list: (Task | Group)[] };
```

Invariants worth defending in review:

- **`done` is derived**, never stored: `count >= target`. A plain checkbox is `target: 1`.
  Do not add a `done` field — it will drift.
- **`list` is one ordered array.** Position is the ordering. Ungrouped tasks sit at the
  root beside groups; there is no implicit "Inbox".
- **Progress is `mean(count / target)`** over tasks, so one `[20]` item cannot swamp the
  ring. Empty groups are excluded from totals and render no ring.
- **The arc measures the list; the colour judges the day.** They answer different
  questions and must not be conflated: `3 of 7` is what the arc and `#pct` report, while
  the hue reports `scoreDay()` — a list can be most of the way done and still have an
  important item outstanding, and the ring has to say so rather than average it away.
- **The day succeeds on two gates, not one number.** Every important thing finished,
  _and_ the rest past `prefs.successAt`. A task is important if it is marked or sits in
  an important group — finishing such a group means finishing its items, so they are the
  same obligation. An empty important group contributes no tasks and cannot block, the
  same rule that keeps empty groups out of the ring. An empty list is never a success.
- **The rainbow's landmarks are the gates**: red at nothing, green the moment the
  important work lands, blue the moment the rest clears the bar, violet at everything.
  Green is a landmark **only when something is marked** — with nothing important the
  sweep runs straight from red to blue, because a list with nothing marked would
  otherwise open on green and read as "you are safe" before a single tick.
- **Only the day ring wears the rainbow.** Row rings keep `hueAt`'s indigo→green sweep,
  which ends on the same hue as the finished frame — a row whose ring and outline
  disagreed would be a bug. `paintRing`'s `colour` argument is the seam.
- **The warm band of the rainbow is lifted by `--ring-lift`.** Yellow is inherently a
  light colour; held at `--ring-l` an OKLCH yellow renders olive and red→green reads as
  mud. This was checked by rendering the sweep, not by eye-balling the numbers.
- **All three moments are celebrated**, each once, on the transition into it, re-arming
  when the list falls back below. One tick can cross two gates at once — the last
  important item landing on a list already past the bar — and only the highest fires:
  two showers on one frame read as one messy shower. Moving the bar in Settings re-scores
  and repaints but deliberately does **not** celebrate; a milestone reached by moving
  your own goalposts was not earned.
- **The theme and the preferences live in their own storage keys**, never in the
  list. They are properties of this browser, so putting them in `State` would
  export them in a backup and import someone else's choices.
- **Tidying fires only on the transition into finished**, like the celebration,
  and after a delay — the tick landing is the reward, so nothing moves over it
  until it has played out. Folding a group by hand cancels that group's pending
  tidy, and only that one. The fold and the drop are **one state change**, so
  the card travels under FLIP instead of vanishing here and reappearing there.
- **A finished row sinks to the foot of the unfinished list**, stopping above
  the run of finished rows already resting there — the pile keeps the order it
  was earned rather than each arrival burying the last. A ticked root item and a
  finished group travel alike; nested tasks stay put, because a group moves as
  one block. `sink()` gets there by repeating the same level-scoped `reorder()`
  step, not by computing an index.
- **A batch of tidies is applied bottom-most row first.** A row stops above
  whatever finished rows are already below it, so sending the upper one first
  strands it on top of a sibling that has not travelled yet. Ordering by
  position is what makes two ticks in one breath land where the same two ticks
  spread over a minute would.
- **Closing the day reopens every fold.** The folds were earned by ticks that
  `clearTicks()` has just wiped; leaving them shut opens tomorrow on a list
  hiding most of itself.
- **The `autoCollapseDone` pref now governs the whole tidy**, folding included,
  which is why the switch reads "Tidy finished items". The stored key keeps its
  older name on purpose: renaming it reads as unset, and anyone who had turned
  it off would silently get it back.
- **`important` is a mark and nothing else.** It changes how a row reads — an accent
  bar and a heavier word — and never where it sits. No sorting, no exemption from
  `sink()`, no weight in the progress ring. A second notion of "where this belongs"
  is exactly what `reorder()` exists to prevent, and floating flagged rows to the top
  would be one.
- **The mark stays on when a row is finished.** It was suppressed there at first, on
  the grounds that the green frame was the state worth reading on the pile — which made
  a completed important row indistinguishable from any other completed row, so you could
  not see what you had actually got done. Recognition beats tidiness. (The muddiness
  that prompted the suppression came from _dimming_ the bar to 40%; at full strength it
  sits beside the green frame cleanly.) `tests/e2e/important.spec.ts` asserts the two
  are tellable apart rather than asserting a colour, so the treatment can change without
  the guarantee moving.
- **The mark reaches a screen reader through the row's own handle** — the tick's
  `aria-label` for a task, the chevron's for a group, both as a trailing
  ", important". A bar and a font weight are a visual channel only.
- **Adding a field is not a schema bump.** `important` defaults to `false` in
  `normalize()`, so a list written before it existed loads unmarked. Moving
  `SCHEMA_VERSION` would have discarded every stored list — see the migration seam.
- **All external data goes through `normalize()`** — stored JSON and pasted imports alike.
  It repairs rather than trusts: clamps `target` to 1–99, clamps `count` to `target`, drops
  empty text, regenerates duplicate ids. Never parse straight into state.
- **Celebration fires only on the transition into complete**, and only for a non-empty
  list. Re-arm when progress drops below 100%.
- **Destructive actions confirm in place**, never in a dialog stacked on a dialog: the
  control swaps into a confirm state and reverts on a timeout. Erase, and replace-on-
  import, both follow this.
- **Reordering is one step, applied repeatedly.** `reorder()` moves a row a single
  place and **is its own inverse**, so repeating it reaches any position. Everything else
  is a way of asking for that step — `Alt`+arrows, the `⋯` menu, and the drag, which just
  applies it each time the pointer crosses a row. Do not add a second, parallel notion of
  "where this should land"; the inverse property is unit-tested and is what keeps all
  three inputs agreeing.
- **A step's `scope` says whether it may change nesting, and the answer follows from
  how it was asked for.** Dragging is `"list"`: the pointer is over a place, so the row
  goes there, into or out of a group included. "Move up" is `"level"`: a command named
  after a direction moves the row among its own siblings and stops at the ends, because
  one that silently re-nested an item would be doing more than it said. Changing level is
  its own command — `Tab` / `Shift-Tab`, or the menu's "Into" / "Out of". The `⋯` menu
  prints `Alt+↑` beside "Move up", so **those two must stay the same command**; scoping
  one and not the other makes the hint a lie.
- **Three routes reach the `important` field, and they must stay one meaning**: a
  trailing `!` in the composer, the same when editing the text, and the `⋯` menu's
  "Mark important" / "Unmark important". The menu exists because the other two mean
  typing, which is no use with a thumb on a row already in front of you. Do not give any
  of them a second behaviour, and keep the labels naming _important_ rather than "the
  mark" — nobody outside this file calls the accent bar that.
- **"Adding to" is a promise about the item you are about to add.** A group always lands
  at the root, so while the composer holds a `#` the row must read "Top level" — and
  display-only, because clearing the aim would cost you the group you picked when you
  delete one character. `isGroupInput()` is shared with `parse` so the preview and the
  outcome cannot disagree. The composer is also **emptied before the state is applied**,
  since the render triggered by the apply reads it.
- **A plain item's tick toggles; a counted one does not.** `role="checkbox"` promises a
  way back, and on a phone there is no Shift and no arrow key. `target > 1` counts up,
  and steps down via the count label or the row menu.

## Input syntax

The composer parses three things, and all of them must round-trip through inline editing:

- `# Morning` creates a group.
- `make calls [3]` creates a task with `target: 3`. Editing shows `make calls [3]` again.
- A trailing `!` marks either kind important. It may sit at the end of the line or at
  the end of the name — `make calls [3]!` and `make calls! [3]` both work, because both
  are what people type. **At most one `!` is ever consumed**, from wherever it came:
  that ceiling is what makes `raw()` a true inverse, so `ship it!!` is an important
  `ship it!` and round-trips as one. `raw()` covers groups too, which is why inline
  editing seeds itself from it rather than from `title`.

## Commands

```
npm run dev        # vite dev server
npm run build      # typecheck, then production build
npm run preview    # serve dist/ locally
npm test           # vitest, unit + DOM
npm run test:coverage  # the same, with the thresholds CI enforces
npm run test:e2e   # playwright
npm run lint       # eslint
npm run format:check  # prettier, in check mode
npm run icons      # regenerate the favicon and PWA icons
npm run screenshots  # regenerate the README screenshots from the built app
npm run check      # lint + format + typecheck + test:coverage — exactly what CI runs
```

Node version is pinned in `.nvmrc`. Use `npm ci`, not `npm install`, in automation.

## Where things live

```
src/theme.ts      theme preference, in its own storage key
src/prefs.ts      behaviour preferences, in their own storage key
src/types.ts      Task, Group, State, and the limits
src/normalize.ts  the single gate for data arriving from outside
src/storage.ts    load/save against one localStorage key
src/store.ts      the live state, persistence, and one level of undo
src/transitions.ts  every state change as State -> State
src/parse.ts      "# Title", "[n]" and "!" parsing, and the raw() round-trip
src/progress.ts   the mean(count/target) formula, and how the day is scored
src/render/       keyed DOM patching — list, task, group, ring, flip
src/ui/           toast, day-summary sheet, drawer, row menu, drag, confetti, dom
src/styles/       tokens.css first, then base.css, then app.css
```

There is **no demo list**. A first run starts empty; `blank()` is what `load()` falls back
to. Seeding sample items puts someone else's day in the one place the app promises is
yours, and makes deleting them the first thing anyone does.

The drag decides by asking which row is under the pointer, and for a group the answer is
a band, not the card: **from the middle of its `.ghead` down to a sliver above its bottom
edge.** Above that line you are addressing the group as a row in the list; below it you
are addressing its contents. That one split is doing three jobs — dropping onto a title
puts the item in, dragging out over the same header takes it out, and a short card (an
empty group is barely taller than its header) still has a band left to drop into. The
sliver at the bottom is the matching exit downwards, which the last item of the last group
has no other route to.

**Entering and leaving must read the same lines.** The pointer is always in exactly one of
above / inside / below, which is what stops a step undoing itself on the next frame. If
you widen one region, narrow the other by the same amount, and re-check by measurement —
this went wrong twice, in both directions, and neither was visible by eye.

Hit areas are `::after` overlays, so **where two overlap, the later one in the DOM wins**.
That is why the grip's is asymmetric — a symmetric 44px box put the tick's overlay on top
of the grip's own dots. Changing a row's controls means re-checking this with
`elementFromPoint`, not by eye.

`src/render/list.ts` holds the keyed patch. It exists so editing a row never destroys its
DOM node — that would kill focus mid-edit and cancel in-flight transitions. If you find
yourself rebuilding `innerHTML`, stop; that is the bug this file prevents.

## Testing expectations

- `parse`, `progress`, and `normalize` are pure and should stay at full coverage. Most
  real bugs live there. `scoreDay` and `dayHue` are part of that: the gates and every
  landmark of the rainbow are unit-tested, so the browser tests only have to check that
  the preference reaches the scoring and the ring wears the result.
- State transitions (add, delete, move in/out of a group, clear ticks, undo) are tested as
  pure functions over `State`, without a DOM.
- The keyed patch has DOM tests asserting node identity survives an update.
- Playwright covers the paths a unit test cannot: persistence across reload, the mobile
  viewport, the export/import round-trip, and a cold start with the network off.
- `tests/e2e/a11y.spec.ts` is the net under the accessibility work: axe must report zero
  WCAG 2.1 AA violations on the list, both dialogs and the empty state, and an ARIA
  snapshot pins the roles, names and states of the whole list.
- **The settings sheet is measured, not eyeballed.** Two things went wrong there and
  neither was visible: it scrolled with a screenful of room around it because the
  _absolute_ `max-height` cap bound rather than the viewport one, and three of its
  controls sat under 44px. `tests/e2e/drawer.spec.ts` pins both — the fit via
  `scrollHeight` against `clientHeight` on a roomy window, the targets via
  `elementFromPoint`. Adding a row to that sheet means re-running them. The `<select>`
  earns its 44px with real height: a replaced element does not render an `::after`
  reliably, so the overlay trick every other control uses does not work on it.
- **Measure a control only after the sheet has settled.** The drawer arrives on a spring
  that overshoots, and `getBoundingClientRect` mid-flight returns the animated box —
  which reads as a 43px control that is really 44. `settle()` in the e2e helpers is the
  wait, and it cost a confusing failure before it was there.
- Text tokens must clear 4.5:1 on `--bg`, `--card` and `--nest`. Changing `--muted`,
  `--faint` or `--danger` means re-running the a11y spec, not eyeballing it.
- `normalize()` also gets property-based tests: over arbitrary JSON it never throws,
  returns null or a structurally valid state, and is idempotent.
- Coverage measures the pure and DOM-primitive layers only; `app.ts`, `src/ui/**` and the
  row renderers are excluded because Playwright owns them. Thresholds are in
  `vite.config.ts` and CI enforces them.
- Every animation must have a `prefers-reduced-motion` path that still lands in a finished
  visual state — reduced motion means instant, not absent.

## Keeping the README honest

Two committed artefacts are generated from the app, not drawn by hand, and
nothing in CI checks that they are current — so they are your job:

- **Run `npm run screenshots` whenever the list changes how it looks.** That
  means any edit to `src/styles/**` (especially the palette tokens), to the row
  or group markup, or to spacing in the list. The script builds, serves, and
  captures both themes into `.github/`. It is deterministic: re-running with no
  visual change rewrites the same bytes, so it never creates a noisy diff.
- **Run `npm run icons` if the ring mark changes.**

A screenshot diff is not worth gating in CI — across machines it is all font
antialiasing and no signal — which is exactly why it has to be a habit here.

Also treat these README claims as facts that rot, and check them when they
change: the scripts table, the keyboard table, and the module map under "How
it's built".

## Conventions

- TypeScript strict. No `any`; prefer discriminated unions over optional-field soup.
- Conventional Commits. Work on a branch, PR into `main`; pushing `main` deploys.
- Comments explain **why**, not what. The keyed patch and the celebration guard deserve
  comments; a `for` loop does not.
- Accessibility is not optional. The tick is a real `<button>` carrying
  `role="checkbox"` with `aria-checked`, or `role="spinbutton"` with
  `aria-valuenow`/`aria-valuemax` once an item is counted — the ring inside it is
  `aria-hidden`. The list is a `<ul>` of `<li>`. Every control clears 44px via an
  invisible `::after` hit area rather than by growing visually. `@media (hover: hover)` is the correct
  fork for pointer affordances — never a width breakpoint. Every dialog traps focus via
  `src/ui/focus.ts` and hands it back on close; `aria-modal` alone does nothing for Tab.

## Deliberately out of scope

Say no to these unless the user explicitly reopens the decision:

- Recurring items, templates, or scheduling
- Pomodoro countdowns, enforced breaks, or any timer that interrupts
- Streaks, history, archives, or completion stats over time
- Accounts, sync, or any server
- Merge-on-import — import replaces, and undo covers it
