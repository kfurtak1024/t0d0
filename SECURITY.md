# Security

## Reporting

Report a vulnerability privately through
[GitHub's advisory form](https://github.com/kfurtak1024/t0d0/security/advisories/new).
Please don't open a public issue for anything exploitable.

Expect a reply within a week. This is a personal project maintained by one
person, so there is no formal SLA beyond that.

## What the attack surface actually is

t0d0 is a static page with no server, no accounts, and no network access at
runtime:

- **Nothing is transmitted.** Your list lives in one `localStorage` key in your
  own browser. There is no backend to breach, and no telemetry.
- **No third-party code ships.** The bundle has zero runtime dependencies, and
  CI fails if a `dependencies` entry appears in `package.json`.
- **The CSP is the enforcement.** `index.html` sets
  `default-src 'none'` with no external origins allowed, so any stray request
  fails loudly rather than silently succeeding. A change that needs a CSP
  exception is a change that needs rethinking.
- **`frame-ancestors` is absent on purpose.** It is header-only and silently
  ignored in a `<meta>` tag, and GitHub Pages cannot set headers — so this
  deployment does not claim clickjacking protection it cannot provide.

The one place untrusted data enters is **import**: a `.json` backup dropped into
the settings drawer. Everything from there passes through `src/normalize.ts`,
which repairs rather than trusts — it validates ids, clamps counts, drops empty
text, and returns `null` for anything unusable. Bugs in that file are the ones
most worth reporting.

## Out of scope

- Anything requiring physical or already-authenticated access to the device.
  Someone at your unlocked browser can read your list; that is what a list in
  local storage is.
- Loss of the list. It is disposable by design — this is a tool that replaces a
  plain text file, and losing it should cost nothing.
