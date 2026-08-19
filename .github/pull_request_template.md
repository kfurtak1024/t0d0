## What changed

<!-- One or two lines. The commit subject is usually enough. -->

## Generated artefacts

Nothing in CI checks these — a screenshot diff across machines is all font
antialiasing and no signal — so they are checked here instead.

- [ ] Touched `src/styles/**`, the row or group markup, or list spacing? → ran `npm run screenshots`
- [ ] Changed the ring mark? → ran `npm run icons`

## README claims that rot

- [ ] Bundle size (badge **and** the prose in "No dependencies is a feature")
- [ ] Scripts table, keyboard table, module map under "How it's built"

## Constraints

- [ ] No runtime dependencies, no network at runtime, no new CSP exceptions
- [ ] Nothing from the "Deliberately out of scope" list in `CLAUDE.md`
- [ ] Every new animation has a `prefers-reduced-motion` path that still lands finished
