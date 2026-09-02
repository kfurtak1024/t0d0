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
  beyond the current list. A one-off removed at the close is deleted, not filed away —
  deleting is not archiving, which is why `once` does not breach this.
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
  once: boolean;
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
- **The day's verdict is in words as well as in hue, and it is not the button's label.**
  `#endlabel` follows `scoreDay()` — "That's the day" / "The important work is done" /
  "That's a good day" / "Everything done" — because hue is not a channel everyone has.
  Measured with a dichromacy simulation: red and green come out at ΔE 4 for a deuteranope,
  and they are the rainbow's two most meaningful landmarks, so the ring alone was a WCAG
  1.4.1 failure. It **was** the button's label, which made a statement look like a control
  and left the action unsaid; the button now says "End day" and the verdict sits above it,
  with `aria-describedby` keeping it on the button's own announcement so a screen reader
  does not lose what focusing the button used to say. Moving the words off the screen
  entirely re-opens the failure — `scoring.spec.ts` walks all four through `#endlabel`.
- **The button has four states, because the day has four.** `lit` used to cover everything
  from the first tick to almost-done, so the moment the day actually turns on — every
  marked thing finished, the minimum plan met — looked exactly like a single tick.
  `cleared` is that moment: a solid border in the day's own hue, which is green there by
  construction, since `dayHue` reaches its green landmark precisely when the marked work
  lands. `ripe` fills it, and stays distinct because clearing the bar on top is a further
  thing. `cleared` is gated on `hasImportant`: the flag is vacuously true with nothing
  marked, the same way `milestones` reads it, and a day with no minimum plan has none to
  meet.
- **A lightness ramp along the rainbow was tried as a second channel and rejected.**
  Measured, it broke white-on-`.ripe` contrast in light mode (4.71 → 3.99, against a 4.5
  floor), still left red/green confusable (ΔE 4 → 9, against a ~12 threshold), and made
  blue/violet _worse_ under protanopia (ΔE 8 → 2). Light mode's lightness headroom is
  bounded by contrast on a white card, so hue cannot be rescued there. Do not re-try it
  without re-running those three numbers.
- **Only the day ring wears the rainbow.** Row rings keep `hueAt`'s indigo→green sweep,
  which ends on the same hue as the finished frame — a row whose ring and outline
  disagreed would be a bug. `paintRing`'s `colour` argument is the seam.
- **The warm band of the rainbow is lifted by `--ring-lift`.** Yellow is inherently a
  light colour; held at `--ring-l` an OKLCH yellow renders olive and red→green reads as
  mud. This was checked by rendering the sweep, not by eye-balling the numbers.
- **The confetti is painted in the ring's own colour, converted rather than
  approximated.** A canvas takes a CSS colour but cannot resolve a `var()`, so
  `oklchToRgb` in `src/render/ring.ts` does the conversion and `ringOklch` is
  the single formula `dayStroke` also spells out as a `calc()`. It replaced
  `hsl()` fed the ring's **OKLCH hue number** — a different colour space, with
  neither the theme's lightness nor its chroma reaching the canvas at all: the
  blue milestone showered `rgb(124, 75, 221)`, a purple, while the ring beside
  it turned `rgb(60, 114, 203)`. The tokens are read per burst so a theme
  changed in Settings is honoured, and out-of-gamut channels are clipped, which
  is what the browser does displaying the same `oklch()` — so the clip is the
  ring's clip and not a second approximation. The conversion is checked against
  Chromium painting the same colour into a canvas and reading the pixel back;
  `tests/ring.test.ts` pins all eight landmarks, both themes.
- **All three moments are celebrated**, each once, on the transition into it, re-arming
  when the list falls back below. The arming lives in `src/milestones.ts` as a pure
  machine over `DayScore`; `app.ts` only owns what a celebration looks like. One tick can cross two gates at once — the last
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
- **A new group lands above the first finished row**, not at the end of the list. It is
  work, so it goes with the work — appending it buried a group you had just made under
  the ticks, and the first thing you did with it was drag it back up. With nothing
  finished there is nothing to go in front of, so it appends, which is where it always
  landed. Root tasks still append: the composer aims at a new group, so an item you add
  next goes inside it rather than needing a place of its own.
- **A finished row sinks to the foot of the unfinished list**, stopping above
  the run of finished rows already resting there — the pile keeps the order it
  was earned rather than each arrival burying the last. A ticked root item and a
  finished group travel alike; nested tasks stay put, because a group moves as
  one block. `sink()` gets there by repeating the same level-scoped `reorder()`
  step, not by computing an index.
- **An untick brings the row back, by the mirror rule.** `rise()` is `sink()` reflected:
  the same level-scoped step, repeated while the row _above_ is finished, so the row
  comes to rest directly under the last of the work. Unticking says "this is still to
  do", and leaving it buried in the pile makes that a lie. It is **not** a general
  inverse of `sink()` and must not become one: a row that sank past _unfinished_ work
  keeps its new place, because remembering where it came from would be a second idea of
  where a row belongs — the thing `reorder()` exists to prevent.
- **The rise is immediate where the tidy waits.** The delay protects the reward: the
  tick landing is the point, so nothing moves over it until it has played out. An untick
  is a correction with no reward to protect, and a row that took half a second to come
  back would feel stuck. Both are gated on `autoCollapseDone` — someone who turned off
  automatic tidying does not want automatic reordering in either direction.
- **A batch of tidies is applied bottom-most row first**, in `tidyAll()`. A row stops above
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
  the guarantee moving — and it since has: the mark stays, but it turns green.
- **A finished mark is green, at the hue the frame and the ring already end on.** A red
  strip inside a green frame was the card saying two things at once; one hue makes a
  completed card say one. It is the ramp again, `--flag-done-head` → `--flag-done-foot`,
  with `--flag-done` as its mid-tone — that mid is `oklch(--ring-l --ring-c 150)` written
  out, the same finished green `.gcount` and `.group.clear` already wear, so there is no
  third green to keep in step. The nested pill takes the mid, having no room for a ramp.
  Groups and top-level items turn together, because they share the unfinished treatment
  and splitting them here would read as two different marks. **It does not weaken the
  mark**: a finished marked card still carries a strip where a finished plain one carries
  none, which is the whole reason the mark stays on at all.
- **The green ramp steps less than the red one, and the tight end is not the same.**
  Green is the more luminous hue, so the red ramp's ±6 measured 3.39 at the head against a
  3:1 bar; it runs +4/−8 instead, for 3.70 and 6.09 in light. Which end is tight flips
  with the theme rather than the hue — the lighter head on a white card, the darker foot
  on a dark one — which is why the guard checks all six values the same way and names the
  one that failed.
- **A card wears the mark as its own left edge; a nested row wears a pill.** The card
  version is a background layer exactly `--r-card` wide, so the card's `border-radius`
  clips it and the strip's flat inner side lands precisely where the curve ends. It _is_
  the rounded corner rather than a bar sitting inside it, and it follows `--r-card` if
  that changes. Groups and top-level items share it, because they are the same kind of
  thing to the eye — two cards side by side in one list. A nested row has no card, and a
  strip that wide would swamp something half a card tall, so it takes a slim `::before`
  pill instead.
- **The strip is a ramp that deepens downward, and the hue never moves.** Two background
  layers — the strip, sized to `--r-card` and not repeated, over `--card` — so it is
  still a background and the two rules above still hold. The ramp runs
  `--flag-head` → `--flag-foot` down the card's own height, which means a tall group
  shows it gradually and a short row compressed; that is intended, since every card then
  shows the whole mark at the scale of the card. **Deepening rather than shifting hue is
  the load-bearing part**: `--flag` is the ramp's mid-tone and still paints the nested
  pill, the fold's `.gmark` pip and the day card's gate pip, so those stay flat and go on
  agreeing with the card beside them. A hue that travelled would leave all three
  disagreeing and turn one change into four. Five treatments were rendered and measured
  before this one; a strip fading to transparent looked the best of them and was ruled
  out on the numbers, at 1.53:1 in light and 1.42:1 in dark.
- **The strip is non-text, so 3:1 against `--card` is the bar, not 4.5:1** — and a ramp
  is two colours that can drift apart in two themes without anyone noticing. Both ends
  and both themes are measured in `tests/e2e/important.spec.ts`, `--flag` included since
  it still paints three other things. The foot is the end to watch: it is where a ramp
  that deepens runs out of contrast, and in dark it runs toward the card rather than away
  from it.
- **Every leading padding is derived from the mark, never hand-set.** `--mark-clear` is
  the gap a row's first control keeps from it, and `--lead-card` / `--lead-nested` add it
  to the mark's own width — `--r-card` for a card, a third of that for a nested row's
  pill. Hand-set, all three were wrong and none of it was visible on a pointer device,
  where the grip is out in the margin: a root row cleared the strip by two pixels, and a
  group's header, whose padding is spent twice over (the card's, then the header's), put
  its chevron and — on a phone, where the grip is in the flow — its grip _inside_ the
  colour. `.group` names its own `--card-pad` so `.ghead` can subtract it. The paddings
  are unconditional rather than only on a marked row, so nothing shifts when the mark
  goes on or comes off, and `tests/e2e/important.spec.ts` measures the clearance on
  whichever control actually leads the row.
- **Do not draw the group's strip any other way.** Both alternatives were tried and both
  fought the corner: an inset `box-shadow` curves _both_ sides and reads as a fragment
  of the frame, and a pseudo-element cannot match an 18px corner at all, because a
  border-radius is scaled down to fit its own box. The background approach also cannot
  intercept a tap — which is why the item's pill needs `pointer-events: none`, sitting
  as it does exactly where the grip's hit area reaches. Only the green finished outline
  is still a shadow slot (`--edge`).
- **A group's mark and its items' marks are one statement made two ways.** Setting the
  group sets every item; clearing it clears every item; changing an item's own mark
  re-reads the group from what is left. So an item inside an important group never wears
  its own pill — the group's edge already says it, and repeating it on every row says it
  several times over.
- **Clearing a group has to reach its items**, and that is not a nicety. Left marked,
  they would re-read the group as important on the next change and the group could never
  be told "no" — the trap a standing "all marked implies marked" rule sets.
- **A group's mark is derived from its items, in both directions.** `settle()` in
  `src/marks.ts` runs on every change to a mark or to membership, and on everything
  arriving through `normalize()`: a group is important exactly when everything in
  it is. Deriving one way only was tried and was wrong twice over — it made the mark
  depend on the order rows arrived in (`a! b! plain` left a group marked where
  `plain a! b!` did not), and it let a plain row dropped into a marked group become
  important without anyone saying so.
- **Deriving both ways is also what makes the mark removable.** Clearing a group clears
  its items, so nothing is left to put the mark straight back — the trap a one-directional
  "all marked implies marked" rule sets.
- **The derivation is enforced by a property test, not by tidy call sites.** It runs from
  eight places across six transitions and there is no chokepoint to funnel them through,
  so the way it goes wrong is a seventh transition arriving without one.
  `tests/transitions.test.ts` folds arbitrary runs of transitions and asserts the
  invariant after every step — removing any one of the eight calls fails it. The rule is
  written out again in that test rather than imported: asking the implementation whether
  it agrees with itself would pass for the wrong reason.
- **An empty group keeps the mark it was given.** `# Work!` is a promise about a group you
  have not filled yet and there is nothing in it to read; the first row you put in decides
  it from then on, which is why that `!` does not survive an ordinary first item.
- **The mark reaches a screen reader through the row's own handle** — the tick's
  `aria-label` for a task, the chevron's for a group, both as a trailing
  ", important". A bar and a font weight are a visual channel only. A folded
  group's handle also carries what it owes: ", 2 important left".
- **A fold speaks for what it hides; it does not leak rows.** A collapsed group
  is the one place a marked row can go out of sight while the day still turns on
  it — the ring refuses to go green and nothing says which group is the reason.
  So the header carries `.gmark`: the nested row's own pill, at `--r-card / 3` in
  `--flag`, and the number of items in there that are **marked and unfinished**.
  Only that count — every automatic fold is a group that has just finished, so
  counting finished rows would badge exactly the groups the tidy had cleared.
  The badge stays in the flow and fades with the fold, like the header's actions,
  so collapsing shifts nothing sideways, and it is `aria-hidden` because the
  chevron already says it. Letting the fold peek the rows instead was considered
  and rejected: it would put the _item_ back on screen in a group you had just
  put away, it would need a second rule about which rows a fold may show, and a
  group where _everything_ is marked would peek nothing while one with a single
  marked row peeked it — the priority exactly backwards.
- **`once` is the mark for work that is not part of the standing list.** The list persists
  and `clearTicks()` only zeroes counts, so an errand added today comes back tomorrow
  looking like work nobody has done — which is the defect the mark repairs. It is a flag
  on `Task`, not a third `kind`: a one-off task has the same shape as any other and only
  its fate at the close differs, where a union member would ripple through `allTasks`,
  `isFinished`, `reorder`'s group-swallowing branch and every renderer for nothing.
- **Only a _finished_ one-off departs.** An errand you did not get to is precisely the
  thing you most need to see in the morning, and taking it away because the day ended
  would make the mark a trapdoor rather than a convenience. It is one-off; it has not
  been done once yet. `tests/transitions.test.ts` pins both halves.
- **The day ends at the closer, never at the ring.** Removal hangs off `clearTicks()` —
  the one explicit end-of-day act. Hanging it off `scoreDay()` going complete would have
  rows vanishing under the pointer mid-afternoon.
- **`clearTicks()` changes a group's membership, so it settles.** Removing an item is the
  same obligation every other membership-changing transition carries, and it is exactly
  the "seventh transition arriving without a `settle()`" the property test exists for.
  The property fold reaches it rarely, so there is a named test for it as well — remove
  the call and `re-derives the group mark it just changed the membership of` fails.
- **A group cannot be one-off, and does not need to be.** A one-off group would ask the
  question `important` needed the whole two-way `settle()` to answer — whether the mark
  belongs to the card or to everything under it. A group emptied by departures stays,
  with the mark it was given: it is a heading you might refill, the same rule that keeps
  `# Work!` marked before its first item lands.
- **The closer names what it will not bring back.** Ticks return tomorrow; a removed
  one-off does not, and undo is one level that does not survive a reload — so the loss
  is stated above the button rather than discovered in the morning. Named while naming
  is short, counted once it would not be, and **one line either way**: this is the card
  that must fit without scrolling, and a note that grew with the day would be the thing
  that pushed the confirm under the fold. `tests/e2e/oneoff.spec.ts` re-measures the fit.
- **`raw()` is an inverse over the states `parse` can reach, which is the contract.** A
  line ending in `!` _is_ an important line, so text ending in a bang only ever comes
  with the mark set — there is no spelling of an unimportant task called "Sale!", and
  the same holds for `~`. `normalize()` deliberately leaves such a pair alone rather
  than flipping a mark on an imported list nobody asked it to change; both halves are
  pinned in `tests/parse.test.ts`.
- **The one-off tag sits beside the label, never inside it.** `.label` is the edit target
  and its `textContent` is what a rename commits, so a tag in there would be text you had
  to delete to rename the row. Outside `.line` too, because the strike is scoped to the
  words and a ticked one-off is exactly the row whose tag matters — it is the one the
  closer is about to take away. A word rather than a hue: the removal is the only thing
  on a row that tomorrow cannot undo, so the word is the channel and nothing else is
  asked to carry it.
- **The tag wears `.count`'s type and `.count`'s trailing box.** They are the two quiet
  things at the end of a row and they sit side by side on a counted one-off: at
  different sizes their baselines disagreed, and a dotted underline under the smaller
  one made it read as dropped. Only the _right_ padding is copied — that is what puts
  the tag in the count's column on a row that has no count, where the left padding would
  only take width off the label and cost a line of wrap on a narrow screen.
- **One trailing column for the whole list, via `--trail-card`.** A group's contents sit
  inside a second card, so a nested row and a `.ghead` spend that card's padding first
  and subtract it — the mirror of `--lead-card` at the other end. Hand-set at `0.5rem`
  they did not, and every `⋯` inside a group sat 4.8px left of the ones outside one:
  invisible for as long as only icons lived there, and plain the moment the one-off tag
  put a word in that column. `tests/e2e/oneoff.spec.ts` measures it, to within half a
  pixel — a group card lands on a fractional edge where a root card lands on a whole
  one, so everything inside carries about 0.02px of that.
- **Adding a field is not a schema bump.** `important` and `once` both default to `false`
  in `normalize()`, so a list written before either existed loads unmarked — and, for
  `once`, not primed to be deleted tonight. Moving `SCHEMA_VERSION` would have discarded
  every stored list — see the migration seam.
- **All external data goes through `normalize()`** — stored JSON and pasted imports alike.
  It repairs rather than trusts: clamps `target` to 1–99, clamps `count` to `target`, drops
  empty text, regenerates duplicate ids. Never parse straight into state.
- **Celebration fires only on the transition into complete**, and only for a non-empty
  list. Re-arm when progress drops below 100%.
- **Destructive actions confirm in place**, never in a dialog stacked on a dialog: the
  control swaps into a confirm state and reverts on a timeout. Erase, and replace-on-
  import, both follow this.
- **The ring reports; the closer ends the day.** Pressing the day ring opens the
  day-stands card, whose only button goes back to the list — a second card that could
  clear the ticks would be a second answer to the question the closer already answers.
  On an empty list the ring is `disabled`: it is already dimmed and has nothing to say.
- **The card's rail is the hue axis, and the gates are landmarks on it.** The dot sits at
  `hueMark(dayHue(...))` and wears `dayStroke` of the same hue, so the card and the ring
  cannot drift; the rail's gradient is sampled from `dayStroke` for the same reason. It
  follows that **the green landmark is drawn only when something is marked** — with
  nothing marked the sweep runs red straight to blue, and a tick there would promise a
  gate the ring is not keeping, though the dot may well be sitting on green.
- **"Two more clears the bar" is computed, not estimated.** `stepsToBar()` takes the
  largest remaining contributions first, which is the fewest by construction. The obvious
  `ceil(bar × n − sum)` is wrong: it counts every unfinished task as a whole point, so on
  a list of part-counted items it names a number that does not actually reach — and a card
  that says "one more" and is wrong is not believed twice.
- **The card names the next landmark, which is not the same as praising you.** The closing
  card deliberately says nothing to an unfinished day; this one always says what the next
  tick buys, because a card opened mid-morning that said nothing would be opened once.
  **Each branch of `nextLine` counts what its own gate is waiting on**, which is two
  numbers and not one: past the bar with the marked work done, the outstanding-important
  count is zero _by construction_ — that is what `succeeded` means — so the line offering
  a clean sweep has to read the unfinished total instead. Sharing one figure had it say
  "0 things left for a clean sweep" on every day that cleared the bar without finishing,
  which is the day the card is most often opened on. `tests/words.test.ts` walks every
  branch; `stands.spec.ts` proves the card hands both counts over.
- **The rail shows the stretch not yet reached as dimmed, and a gate's mark is drawn over
  everything — the dot included.** Both came from the same measured failure: at 95% of the
  way to the bar, an 18px dot with a 3px halo covered the bar's mark completely, in the
  card's own colour, so a day the gates called "short of the bar" read as a day sitting on
  it. The dot is 14px with a 2px ring, the marks are `--muted` lines standing clear of the
  rail, and the dimming is what turns "did it clear that gate?" into something you look at
  rather than judge by a dot's centre. Six treatments were rendered before this one; a
  smaller dot alone does not fix it, because the halo is what hides the mark.
- **The day's sentences live in `src/words.ts`, not in the cards that print
  them.** They are pure functions over a `DayScore` and a couple of counts, and
  `src/ui/**` and `app.ts` are excluded from coverage because Playwright owns
  the rendering layer — so a pure function that drifted in there was measured by
  nothing, and checked only by whichever browser test happened to assert its
  text. That is how `nextLine` kept a branch nobody had ever asked. The
  exclusion list is a claim that the excluded code needs a browser; anything
  decidable without a DOM has to sit outside it. The **numbers** are shared in
  `progress.ts` and the **words are not** — `barSoFar` and `barAtClose` are the
  same figure in two voices, one looking forward and one reporting a day that
  is over, and keeping both in one file is what makes that contrast visible.
- **A gate carries a bar, and the bar fills to the mean rather than the tally.**
  "3 of 5" and "12 of 20" read the same until you see them, which is the whole reason a
  number gets a bar. It fills to `progress()` — the measure the ring uses — so a
  part-counted item moves the bar where it does not move the tally: a gate can read
  "3 of 5" and sit at 67%. That is the first place partial progress is visible anywhere
  in the summary. It wears `hueAt`'s indigo→green and **not** the rainbow, because only
  the day ring wears that and a gate is a thing that gets finished, so it ends on the
  green a finished row's frame already wears. It is `aria-hidden`: the tally beside it
  says the number and the outstanding rows are named underneath, so the bar is the same
  fact a third time in the one channel not everyone has.
- **Only the second gate is marked with where it clears.** The marked work has no line
  short of finishing it — it simply has to be done — so `Gate.threshold` is null there
  and the notch is not drawn. The notch stands proud of the track at both ends and is one
  solid `--muted` line: the bar must not clip it, because a mark the fill can cover
  answers "did it get past?" wrongly at exactly the moment you are asking, which is the
  rail's own lesson. Outlined at 2px it read as two lines rather than one.
- **Which gates a day has is decided in `progress.ts`, not in the renderer.** `dayGates()`
  returns the model — which gates exist, their names, fills, thresholds and what is
  outstanding — and `src/ui/gates.ts` only draws it. The rules are not obvious (the
  Important gate is _absent_ rather than empty when nothing is marked; the second gate's
  name changes to "Everything" when it stands alone; an empty second gate is vacuously
  met) and every one of them is decidable without a DOM, so they belong where coverage
  reaches. `tests/progress.test.ts` pins them.
- **The day-stands card is a status check; the closing card is the event.** The stands
  card reported the day five times over — a 42px "4 of 8", the rail's dot, a bold two-line
  "what next", and both gates saying the halves that number is the sum of. Nothing was
  wrong and nothing was subordinate, so all five shouted at once. So its number is one
  quiet line, "what next" moved **below** the gates (stated above them it was a loud
  restatement of the panel directly beneath it), and the gates are the content. The
  closing card keeps the big number on purpose: there it is the moment, and the two cards
  reading differently is what tells them apart.
- **Both day cards wear the same rail and the same gates**, from `src/ui/rail.ts` and
  `src/ui/gates.ts`. Two copies would be two rainbows able to drift from `dayStroke` and
  from each other, and the rail's whole claim is that it cannot disagree with the ring.
  The _numbers_ are shared; the **words are not** — one card is looking forward ("one more
  clears the bar") and the other is reporting a day that is over ("short of the bar"), so
  each passes in its own note.
- **The close names what got done, not only how much.** The card reported a bare number,
  named what was still outstanding through the gates, and then wiped the evidence — so
  the one ritual the app exists for was a record of what you missed. `summarise().finished`
  names the work, and `didHeading` counts it; the pips are the finished green the ring and
  the frame already end on, against the gates' `--flag` red, so the two lists read as the
  two halves of one report. It replaced a list of cleared _group_ titles, which said less
  about a day than the rows themselves do. Silent when nothing got done, for the reason
  `verdictOf` is silent on an unfinished day: an empty "Got done" is worse than no heading.
- **Both lists are capped by one rule.** `shortlist()` in `words.ts` names the first four
  and counts the rest, for the gates and for the close alike — the card is bounded, so a
  list that grew with the day is exactly what would push the confirm off it, and two
  different caps would be the same kind of statement made in two voices.
- **The closing card carries them because it is the one card that erases something.** A
  day that finished 5 of 6 with the marked item outstanding used to read as a good day and
  then clear the evidence: the number is honest and says nothing about _which_ thing was
  left, and `verdictOf` is silent there on purpose. The rail and the gates are how the card
  is honest without praising a day that did not earn it — which is what lets that silence
  stand. Do not fill it with a consoling line instead; `tests/e2e/scoring.spec.ts` pins
  both halves.
- **An empty list gets no gates and no rail**, not "Everything 0 of 0" — reachable through
  the stale-day card, which opens on a day left overnight whose list has since been emptied.
- **The closing card's confirm and its warning are never below the fold.** It is the one
  card with a destructive button, and "Clear the ticks" out of sight is how someone taps
  it without reading what it takes away. This used to be written as "the card must fit
  without scrolling", which is not a promise that can be kept: a full day on a 320px-tall
  screen does not fit, and the card simply grew past the bottom of the window — three
  pixels at 360x640, further at 320x568. **The guard could not see it.** With nothing
  capping the height, a card's `scrollHeight` and `clientHeight` are the same number by
  construction, so `expect(content).toBeLessThanOrEqual(box)` passed on every day it was
  ever given, and the only real assertion ran at 1280x900 where nothing was going to fail.
  So the card is capped at the window and `.sheet-body` scrolls inside it, while the
  departing note and both buttons sit **outside** that scroller and are always on screen.
  `scoring.spec.ts` measures the confirm and the note against the viewport at five sizes,
  and it fails without the cap. Adding a row to this card means re-running it.
- **`.sheet-body` takes a tab stop only while it actually scrolls.** Nothing inside it is
  focusable — the buttons are outside, which is the point — so a scroller with no way in
  is content a mouse can reach and a keyboard cannot. Axe calls it
  `scrollable-region-focusable` and caught it the day the scroller appeared. Always-on
  would put a stop that leads nowhere in front of the buttons on almost every day, so
  `keyboardScrollable()` measures on open; `scrollHeight` is layout and so, unlike a
  bounding box, is not disturbed by the card's entry animation.
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
- **Deleting a row lives in the `⋯` menu, not on the row.** A ✕ beside the `⋯` held a
  25.6px column open on every row for an action taken in bursts and then not again:
  `opacity: 0` hides a control on a pointer device, it does not un-reserve its space, and
  on touch it was simply always there. Measured, giving it back is a fifth of a nested
  row's label on a phone (156.7px → 191.9px) and nearly a third of a counted one's
  (114.5 → 149.7). It was also the last row control that had not moved into the menu.
  **It deletes on the press.** The "destructive actions confirm in place" rule below is
  about the settings sheet; a confirm step inside a menu is the dialog-on-a-dialog that
  rule exists to prevent, and one level of undo — toast, plus the exit animation, which
  `Ctrl-Z` cancels outright — is what makes one press safe enough. A group's entry names
  what it takes with it, for the reason the one-off entry names its consequence: the
  items do not come back on their own.
- **Three routes reach the `important` field, and they must stay one meaning**: a
  trailing `!` in the composer, the same when editing the text, and the `⋯` menu's
  "Mark important" / "Unmark important". The menu exists because the other two mean
  typing, which is no use with a thumb on a row already in front of you. Do not give any
  of them a second behaviour, and keep the labels naming _important_ rather than "the
  mark" — nobody outside this file calls the accent bar that. **`once` has the same
  three**, with the menu reading "One-off, remove tonight" / "Keep for tomorrow" — a
  label naming the consequence, because "one-off" alone does not say that something
  gets deleted.
- **"Adding to" is a promise about the item you are about to add.** A group always lands
  at the root, so while the composer holds a `#` the row must read "Top level" — and
  display-only, because clearing the aim would cost you the group you picked when you
  delete one character. `isGroupInput()` is shared with `parse` so the preview and the
  outcome cannot disagree. The composer is also **emptied before the state is applied**,
  since the render triggered by the apply reads it.
- **A row's label is its name and none of the marks.** All three of the things the
  composer parses leave the text on the way in, and each is shown by something built for
  it: `!` is the accent edge, `~` is the tag, `[n]` is the tally. The bracket was the odd
  one out for a while — spelled into the label _and_ counted in `.count` — which said it
  twice and made a counted row the only row whose text was not what you typed. `raw()`
  hands all three back the moment you edit, which is where they are editable and where
  they belong.
- **`--accent-ink` is the app's blue at text size**, and one colour rather than three: the
  wordmark's zeros, an item's tally, and the one-off tag are all a small fact about the
  list rather than the list itself. It is two points darker than `--ring-l` because a
  nested row takes `--nest` on hover and the ring's own lightness measured 4.45 there —
  under the 4.5 floor by a margin nobody would ever see. `tests/e2e/a11y.spec.ts`
  measures it on `--card`, `--nest` and `--bg` in both themes, because axe only ever sees
  the resting surface.
- **A plain item's tick toggles; a counted one does not.** `role="checkbox"` promises a
  way back, and on a phone there is no Shift and no arrow key. `target > 1` counts up,
  and steps down via the count label or the row menu.

## Input syntax

The composer parses three things, and all of them must round-trip through inline editing:

- `# Morning` creates a group.
- `make calls [3]` creates a task with `target: 3`. The row is then named `make calls`;
  the target is the tally's business. Editing shows `make calls [3]` again.
- A trailing `!` marks either kind important. It may sit at the end of the line or at
  the end of the name — `make calls [3]!` and `make calls! [3]` both work, because both
  are what people type. **At most one `!` is ever consumed**, from wherever it came:
  that ceiling is what makes `raw()` a true inverse, so `ship it!!` is an important
  `ship it!` and round-trips as one. `raw()` covers groups too, which is why inline
  editing seeds itself from it rather than from `title`.
- A trailing `~` marks a task one-off, by the same rules: either side of the bracket,
  at most one consumed, and either order beside a `!` — `call back!~` and `call back~!`
  are the same row. `strip()` stops on a sigil already spent rather than reading past
  it, which is what keeps `ship it!!` an important `ship it!`. `raw()` writes one
  canonical order, `!` then `~`, because `parse` reads them from the right and does not
  care. Groups have no `~`: a tilde in a heading is a character someone typed.

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
src/marks.ts      a group's mark, derived from its items
src/storage.ts    load/save against one localStorage key
src/store.ts      the live state, persistence, and one level of undo
src/transitions.ts  every state change as State -> State
src/parse.ts      "# Title", "[n]", "!" and "~" parsing, and the raw() round-trip
src/progress.ts   the mean(count/target) formula, and how the day is scored
src/milestones.ts which of the day's moments a change just crossed
src/words.ts      every sentence the day is reported in, pure and DOM-free
src/render/       keyed DOM patching — list, task, group, ring, flip
src/ui/           toast, the two day cards and the rail and gates they share,
                  drawer, row menu, drag, inline edit, focus trap, confetti, dom
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

**Every pointer handler checks the pointer id**, both ends included, not just
`pointermove`. A phone is held with more than one finger: without the check, a stray
thumb touching the list and lifting ended the drag the first finger was still holding,
and a second press mid-gesture took the drag over. Neither is reachable with a mouse, so
neither shows up unless someone goes looking.

**Entering and leaving must read the same lines.** The pointer is always in exactly one of
above / inside / below, which is what stops a step undoing itself on the next frame. If
you widen one region, narrow the other by the same amount, and re-check by measurement —
this went wrong twice, in both directions, and neither was visible by eye.

**A grip measures from the card it belongs to**, which is why `.group` is positioned and
`.ghead` is not. The header sits inside the card's padding, so a grip anchored to it came
out 8.8px closer to its card than a row's did — a difference small enough to look like
nothing and read like a mistake. Nothing else in the header needs a containing block; the
controls all carry their own.

**A nested row's grip lives in a gutter, not the margin.** Outboard of the row means
inboard of the card, where the group's own left edge and its importance strip already
are — so on pointer devices `.items` is indented far enough to open a lane between the
strip and the rail, and the grip sits in it. Only there: where the grip stays in the flow
it takes real space in the row, and a phone keeps the tighter indent. Both numbers were
set by measuring the three clearances, not by eye.

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
- **Two day cards are in the DOM at once, and they share their classes** — `.sheet`,
  `.score`, `.dismiss`, `.gate`, `.track`. A spec must therefore say _which_ card it
  means, by scoping to `#veil` or `.stands`; an unscoped `.sheet .score` matched both and
  failed strict mode the moment the second card existed. The ones that still pass
  unscoped only do so because the other card has not been opened in that test, which is
  not a property to rely on.
- **Adding an entry to the `⋯` menu means re-running `reorder.spec.ts`.** Three tests
  there walk the menu with the arrow keys and with Home/End, so they name whichever
  entry is last. That is deliberate — a menu that grew an item nobody could reach by
  keyboard is exactly what those tests are for — but it does mean the names move.
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
- **The seeded day is a claim about what the picture shows, so check it against
  the app and not against the diff.** It goes in through `normalize()`, which
  means it goes through `settle()` — a group's mark written on the group alone
  is derived straight back off, and the screenshot silently stopped showing the
  accent bar it exists to show. Determinism is why nothing caught it: a seed
  that renders the wrong thing renders it byte-identically for months. Adding a
  mark to the model means adding it to the seed, spelled out on the items too.
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
