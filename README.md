<div align="center">

<picture>
  <source media="(prefers-color-scheme: dark)" srcset=".github/banner-dark.svg">
  <img alt="t0d0 — one list you prune each morning and tick through the day" src=".github/banner-light.svg" width="100%">
</picture>

<br>

**An ephemeral day tracker.** Prune the list each morning, tick through it during the day,
clear it when you're done. No accounts, no sync, no history — it replaces a plain text
file, and losing it should cost nothing.

<br>

[![Deploy](https://github.com/kfurtak1024/t0d0/actions/workflows/deploy.yml/badge.svg)](https://github.com/kfurtak1024/t0d0/actions/workflows/deploy.yml) [![License: MIT](https://img.shields.io/badge/license-MIT-3B6FD6)](./LICENSE) [![Bundle](https://img.shields.io/badge/bundle-under_25_kB_gzipped-158A62)](./.github/actions/verify/action.yml) [![TypeScript](https://img.shields.io/badge/TypeScript-strict-1786B0)](./tsconfig.json) [![PWA](https://img.shields.io/badge/PWA-offline--first-1786B0)](./vite.config.ts)

### [**→ t0d0.krfu.dev**](https://t0d0.krfu.dev)

<br>

<picture>
  <source media="(prefers-color-scheme: dark)" srcset=".github/screenshot-dark.png">
  <img alt="The app: two groups, an important group and item, a counted item, and a progress ring" src=".github/screenshot-light.png" width="420">
</picture>

</div>

---

## What it does

Everything lives in your browser's local storage. Nothing is sent anywhere — after the
page loads it makes no network requests at all, and the Content Security Policy enforces
that rather than merely promising it.

- **One persistent list.** It's still there tomorrow. You edit it; nothing expires on its own.
- **Groups, one level deep.** Enough to separate _Morning_ from _Work_, not enough to become an outliner.
- **Counted items.** `make calls [3]` takes three ticks, and partial progress counts.
- **Important items.** A trailing `!` — `call the bank!`, `# Work!` — gives a row an accent bar and a heavier word, and the `⋯` menu marks one without typing. A mark and nothing more: it never reorders anything, and it stays on once the row is finished, so you can still see what you got done.
- **A day is scored on two gates.** Everything marked `!` has to be done, _and_ enough of the rest — 70% by default, and Settings → Behaviour moves the bar. So an almost-perfect day with one important thing still open is not a success, while a day with nothing marked is judged on the rest alone.
- **The day's ring runs a rainbow.** Red at nothing done, **green** the moment the important work lands, **blue** the moment the rest clears the bar, **violet** at everything. All three are celebrated. The arc still measures the whole list — the colour is the verdict on it.
- **A rewarding tick.** Springy rings that sweep indigo → green as each row fills in, a wiping strike-through, and confetti at every milestone.
- **An ending.** Closing the day reports what you actually did before clearing the ticks — so an ordinary 7-of-9 day gets an ending too, not just a perfect one. Tomorrow opens on the whole list, every fold reopened.
- **Reorderable, three ways.** Drag by the grip and the row goes where you point, in or out of a group. `Alt`+arrows and the `⋯` menu move it among its own siblings and stop there — changing level is its own command, so a move never re-nests anything behind your back. One undo puts a whole drag back.
- **Untickable.** Tap a finished item again and it comes back. A counted item counts up instead, and resets from its menu.
- **Finished work gets out of the way.** Tick something off and it drops below what's left, settling on top of whatever finished before it rather than burying it. A group waits for its last item, then folds shut as it goes. Untick something and it comes straight back up above the pile. On by default; Settings → Behaviour turns it off.
- **Offline and installable.** A real PWA; open it with the network off.
- **Light, dark, or whatever your device says.** Settings → Theme, remembered per browser.
- **Backups.** Save a `.json` copy, drop one back in. Loading previews what the file holds before replacing anything, and erasing takes two deliberate presses.

## Using it

| Type this         | To get                                        |
| ----------------- | --------------------------------------------- |
| `shopping`        | a task                                        |
| `make calls [3]`  | a task that takes three ticks                 |
| `# Morning`       | a group, with the composer aimed at it        |
| `call the bank!`  | an important task — `# Work!` marks a group   |
| `make calls! [3]` | both; `make calls [3]!` reads the same        |
| `ship it!!`       | an important `ship it!` — one `!` is the mark |

| Do this                                          | To                                                                                 |
| ------------------------------------------------ | ---------------------------------------------------------------------------------- |
| Click a ring                                     | tick it, or untick it — a counted item counts up instead                           |
| Shift-click a ring                               | count back down — on touch, tap the `1/3` label                                    |
| Drag the `⠿` grip                                | move a row, in and out of groups as it travels; `Escape` calls it off              |
| Click any text                                   | edit in place, `[3]` and `!` included; `Enter` commits, `Escape` reverts           |
| <kbd>Alt</kbd>+<kbd>↑</kbd> <kbd>↓</kbd>         | move the focused row up or down among its siblings                                 |
| <kbd>Tab</kbd> / <kbd>Shift</kbd>+<kbd>Tab</kbd> | with a tick focused, move that item into the group above or back out               |
| <kbd>Space</kbd> / <kbd>Enter</kbd>              | tick the focused item                                                              |
| <kbd>↑</kbd> <kbd>↓</kbd>                        | count a focused `[n]` item up or down                                              |
| <kbd>Ctrl</kbd>/<kbd>Cmd</kbd>+<kbd>Z</kbd>      | undo a delete, a move, an import, or a cleared day                                 |
| `⋯` on a row                                     | move it up or down; take it in or out of a group; reset a count; mark it important |
| `⋯` in the header                                | theme, tidying, the success bar, save a copy, load one back, erase everything      |

## Quick start

```sh
npm ci
npm run dev
```

| Script                  | Does                                                                                |
| ----------------------- | ----------------------------------------------------------------------------------- |
| `npm run dev`           | dev server with hot reload                                                          |
| `npm run build`         | typecheck, then production build into `dist/`                                       |
| `npm run preview`       | serve the built output                                                              |
| `npm test`              | unit and DOM tests                                                                  |
| `npm run test:watch`    | the same, on save                                                                   |
| `npm run test:coverage` | the same, with the thresholds CI enforces                                           |
| `npm run test:e2e`      | Playwright — Chromium, WebKit and mobile Safari, plus axe and an offline cold start |
| `npm run lint`          | ESLint                                                                              |
| `npm run format`        | Prettier, writing in place                                                          |
| `npm run format:check`  | Prettier in check mode — fails on anything unformatted                              |
| `npm run icons`         | regenerate the favicon and PWA icons                                                |
| `npm run screenshots`   | regenerate the README screenshots from the built app                                |
| **`npm run check`**     | **lint + format + typecheck + tests with coverage — the gate CI runs**              |

Node version is pinned in [`.nvmrc`](./.nvmrc).

## How it's built

```
src/
├─ types.ts parse.ts progress.ts normalize.ts   pure, DOM-free, heavily tested
├─ transitions.ts                               every state change as State → State
├─ storage.ts store.ts                          persistence and one level of undo
├─ theme.ts prefs.ts                            appearance and behaviour, own storage keys
├─ render/    list flip ring task group         keyed DOM patching, and FLIP
├─ ui/        drawer sheet menu drag toast edit focus confetti dom
└─ styles/    tokens.css base.css app.css
```

Three pieces are worth knowing about:

**[`src/render/list.ts`](./src/render/list.ts)** is a keyed patch. It exists so updating a
row never destroys its DOM node — rebuilding the list wholesale would cancel in-flight
transitions and drop focus mid-edit, which on a page whose entire point is how the ticking
feels is not a small bug.

**[`src/ui/drag.ts`](./src/ui/drag.ts)** is dragging built out of the reorder step rather
than beside it. A drag is not its own idea of where a row should land; it applies the same
single step the keyboard uses, each time the pointer crosses a row. Reversibility comes
along already tested, and one undo covers the whole gesture. The one thing it asks for
differently is `scope`: a drag may re-nest a row, because the pointer is already saying
where it goes, while "Move up" keeps it among its siblings.

**[`src/normalize.ts`](./src/normalize.ts)** is the single gate for data arriving from
outside, whether from local storage or a pasted import. It repairs rather than trusts:
clamps counts into range, drops empty text, regenerates duplicate ids. A corrupt store
yields a working app, not a blank page.

Everything above `render/` is pure, which is why the interesting rules — parsing, the
progress formula, repair, and every state transition — are covered without a browser.

The motion comes from the platform: `@starting-style` for enter and exit, one shared
spring expressed as a CSS [`linear()`](./src/styles/tokens.css) easing curve, a
`stroke-dashoffset` transition for the arcs, and the Web Animations API for the
[FLIP](./src/render/flip.ts) pass that makes a reordered row travel rather than teleport.
Dragging is Pointer Events, which is one code path for mouse, finger and pen.

## Deploying

Pushing to `main` runs the full gate, builds, and publishes to GitHub Pages via Actions.
Nothing is committed back to the repo; `public/CNAME` carries the custom domain into every
build. Pages **Source** must be set to _GitHub Actions_ — there is no directory to point at.

Publishing is not the same as being served, so a last job checks the live site: it polls
until `t0d0.krfu.dev` hands back the hashed asset _this_ build produced — proving it is not
a cached page — then that the CSP meta survived into the HTML and that the service worker,
the manifest and the favicon all answer 200. It cannot roll anything back. It tells you,
which beats finding out from the app not opening tomorrow morning.

## License

MIT © [Krzysztof Furtak](https://github.com/kfurtak1024) — see [LICENSE](./LICENSE).
