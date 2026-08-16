# t0d0

An ephemeral day tracker, live at **[t0d0.krfu.dev](https://t0d0.krfu.dev)**.

One list you keep. Prune it each morning, tick through it during the day, clear the ticks
when you're done. No accounts, no sync, no history — it replaces a plain text file, and
losing it should cost nothing.

Everything lives in your browser's local storage. Nothing is ever sent anywhere; the page
makes no network requests at all after it loads.

## Using it

|                     |                                                       |
| ------------------- | ----------------------------------------------------- |
| `shopping`          | adds a task                                           |
| `make calls [3]`    | adds a task that takes three ticks                    |
| `# Morning`         | adds a group, and aims the composer at it             |
| Click a ring        | tick, or count up one                                 |
| Shift-click a ring  | count back down (or tap the `1/3` label on touch)     |
| Click any text      | edit in place; `Enter` commits, `Escape` reverts      |
| `Tab` / `Shift-Tab` | move a focused item into the group above, or back out |
| `Ctrl`/`Cmd` + `Z`  | undo a delete, an import, or a cleared day            |
| `⋯`                 | export a backup file, or import one                   |

Groups nest exactly one level deep. That is on purpose.

## Developing

```sh
npm ci
npm run dev
```

| Script             | Does                                          |
| ------------------ | --------------------------------------------- |
| `npm run dev`      | dev server with hot reload                    |
| `npm run build`    | typecheck, then production build into `dist/` |
| `npm run preview`  | serve the built output                        |
| `npm test`         | unit and DOM tests                            |
| `npm run test:e2e` | Playwright, desktop and mobile                |
| `npm run lint`     | ESLint                                        |
| `npm run icons`    | regenerate the favicon and PWA icons          |
| `npm run check`    | lint + typecheck + test — the gate CI runs    |

Node version is pinned in `.nvmrc`.

## How it is built

No runtime dependencies. No framework, no UI library, no animation library — the shipped
page contains no third-party code, and the CSP in `index.html` blocks external requests so
that stays true by construction rather than by discipline.

Motion comes from the platform: `@starting-style` for enter and exit, a shared spring
expressed as a CSS `linear()` easing curve, and a `stroke-dashoffset` transition for the
progress arcs. The one piece of machinery worth knowing about is `src/render/list.ts`, a
keyed patch that updates rows without destroying their DOM nodes — rebuilding the list
wholesale would cancel in-flight transitions and drop focus mid-edit.

Everything above `src/render/` is pure and DOM-free, which is why the unit tests are cheap
and the interesting rules (parsing, progress, repair, state transitions) are all covered
without a browser.

`prototype/index.html` is the original single-file prototype this was ported from. It is
kept as a reference and is not part of the build.

See [`CLAUDE.md`](./CLAUDE.md) for the design constraints and what is deliberately out of
scope.

## Deploying

Pushing to `main` runs the full gate and publishes to GitHub Pages. `public/CNAME` carries
the custom domain into every build.

## License

MIT — see [LICENSE](./LICENSE).
