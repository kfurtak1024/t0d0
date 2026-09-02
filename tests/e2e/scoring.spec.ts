import { expect, test, type Page } from "@playwright/test";
import { addItem, clearStorage, seedStorage } from "./helpers";

/**
 * How the day is scored, end to end. The gates and the rainbow are unit-tested
 * as pure functions; what only a browser can check is that the preference
 * reaches the scoring, that the ring wears the result, and that each milestone
 * is celebrated once.
 */

/**
 * A row's tick, by its exact accessible name.
 *
 * Not `hasText`, which is a substring match: "a" finds "call the bank" too, and
 * the resulting strict-mode violation is a confusing way to learn that.
 */
const tick = (page: Page, name: string) => page.getByRole("checkbox", { name, exact: true });

const openDrawer = async (page: Page): Promise<void> => {
  await page.locator("#databtn").click();
  await expect(page.locator(".drawer")).toBeVisible();
};

/**
 * The hue the day is currently painted, in degrees.
 *
 * Read off `--end-hue`, which the app sets from the same number it paints the
 * ring with. Parsing it back out of the stroke is not worth it: that is a
 * nested `oklch(calc(...))`, and the regex to unpick it would be testing the
 * colour syntax rather than the scoring.
 */
const dayHue = (page: Page): Promise<number> =>
  page.evaluate(() =>
    Number(
      getComputedStyle(document.querySelector("#closeday") as Element).getPropertyValue(
        "--end-hue",
      ),
    ),
  );

test.beforeEach(async ({ page }) => {
  await clearStorage(page);
});

test("the bar is 70% by default and survives a reload", async ({ page }) => {
  await openDrawer(page);
  const picker = page.locator('[data-pref-choice="successAt"]');
  await expect(picker).toHaveValue("70");

  await picker.selectOption("90");
  await page.reload();
  await openDrawer(page);
  await expect(page.locator('[data-pref-choice="successAt"]')).toHaveValue("90");
});

/*
 * The whole point of the rescoring: an almost-perfect day with one important
 * thing outstanding is not a success, and the ring must say so rather than
 * average it away.
 */
test("an outstanding important item holds the day back, however high the rest", async ({
  page,
}) => {
  await addItem(page, "call the bank!");
  for (const text of ["a", "b", "c"]) await addItem(page, text);
  for (const text of ["a", "b", "c"]) await tick(page, text).click();

  await expect(page.locator("#frac")).toHaveText("3 of 4");
  await expect(page.locator("#closeday")).not.toHaveClass(/ripe/);
  // Still in the red-to-green stretch: nothing important has landed.
  expect(await dayHue(page)).toBeLessThan(30);

  await tick(page, "call the bank, important").click();
  await expect(page.locator("#closeday")).toHaveClass(/ripe/);
});

test("the ring turns green the moment the important work lands", async ({ page }) => {
  await addItem(page, "call the bank!");
  for (const text of ["a", "b", "c"]) await addItem(page, text);

  await tick(page, "call the bank, important").click();
  expect(await dayHue(page)).toBeCloseTo(150, 0);
});

test("the bar the preference names is the one the day is judged by", async ({ page }) => {
  await seedStorage(page, {
    v: 1,
    openedAt: Date.now(),
    list: [
      { kind: "task", id: "a", text: "a", target: 1, count: 1, important: false },
      { kind: "task", id: "b", text: "b", target: 1, count: 1, important: false },
      { kind: "task", id: "c", text: "c", target: 1, count: 1, important: false },
      { kind: "task", id: "d", text: "d", target: 1, count: 0, important: false },
    ],
  });

  // 75% done: a success at 70%, not at 90%.
  await expect(page.locator("#closeday")).toHaveClass(/ripe/);

  await openDrawer(page);
  await page.locator('[data-pref-choice="successAt"]').selectOption("90");
  await page.locator(".drawer-close").click();
  await expect(page.locator("#closeday")).not.toHaveClass(/ripe/);

  await openDrawer(page);
  await page.locator('[data-pref-choice="successAt"]').selectOption("50");
  await page.locator(".drawer-close").click();
  await expect(page.locator("#closeday")).toHaveClass(/ripe/);
});

/*
 * A day with nothing marked must not open on green — green is a landmark only
 * when there was important work to earn it with.
 */
test("a day with nothing marked runs red to blue, not green first", async ({ page }) => {
  await addItem(page, "a");
  await addItem(page, "b");
  expect(await dayHue(page)).toBeLessThan(30);

  await tick(page, "a").click();
  // Half of the rest against a 70% bar: past red, nowhere near blue.
  const hue = await dayHue(page);
  expect(hue).toBeGreaterThan(100);
  expect(hue).toBeLessThan(200);
});

/*
 * The ring reports the day in hue, and hue is not a channel everyone has: red
 * and green are one colour to a deuteranope, and those are the two landmarks
 * that matter most. The closer says the same thing in words, on screen, without
 * having to open the card to read it.
 */
/**
 * The verdict, in words, on the main screen.
 *
 * Hue is not a channel everyone has: red and green come out at dE 4 for a
 * deuteranope and they are the rainbow's two most meaningful landmarks, so the
 * ring on its own was a WCAG 1.4.1 failure. This sentence is what answers it,
 * and it sits beside the button rather than being its label — a statement that
 * looked like a control, and left "End day" unsaid.
 */
test("the day's verdict is said in words, not only in hue", async ({ page }) => {
  await addItem(page, "call the bank!");
  for (const text of ["a", "b", "c", "d"]) await addItem(page, text);

  const closer = page.locator("#endlabel");
  // The button is the action and says so, whatever the day is doing.
  await expect(page.locator("#closeday")).toHaveText(/End day/);
  await expect(closer).toHaveText(/That's the day/);

  await tick(page, "call the bank, important").click();
  await expect(closer).toHaveText(/The important work is done/);

  // Three of four ordinary items is 75%, past the 70% bar.
  for (const text of ["a", "b", "c"]) await tick(page, text).click();
  await expect(closer).toHaveText(/That's a good day/);

  await tick(page, "d").click();
  await expect(closer).toHaveText(/Everything done/);

  // And back down again when the day is no longer that.
  await tick(page, "d").click();
  await expect(closer).toHaveText(/That's a good day/);
});

/**
 * The four states of the button, and the one that used to be missing.
 *
 * `lit` covered everything from the first tick to almost-done, so the moment
 * the day actually turns on — every marked thing finished, the minimum plan
 * met — looked exactly like a single tick. That moment is what `cleared` marks.
 */
test("the button marks the minimum plan landing, not just any progress", async ({ page }) => {
  await addItem(page, "call the bank!");
  for (const text of ["a", "b", "c", "d"]) await addItem(page, text);
  const closer = page.locator("#closeday");

  await expect(closer).not.toHaveClass(/lit/);
  await expect(closer).not.toHaveClass(/cleared/);

  // An ordinary tick lights it, and nothing more than that.
  await tick(page, "a").click();
  await expect(closer).toHaveClass(/lit/);
  await expect(closer).not.toHaveClass(/cleared/);

  // The marked work landing is its own state.
  await tick(page, "call the bank, important").click();
  await expect(closer).toHaveClass(/cleared/);
  await expect(closer).not.toHaveClass(/ripe/);

  // And clearing the bar on top of it is another.
  for (const text of ["b", "c"]) await tick(page, text).click();
  await expect(closer).toHaveClass(/ripe/);

  // Unticking the marked item takes the state back off.
  await tick(page, "call the bank, important").click();
  await expect(closer).not.toHaveClass(/cleared/);
});

/*
 * Vacuously cleared is not cleared: with nothing marked there is no minimum
 * plan to meet, and the ring does not draw its green landmark either.
 */
test("a day with nothing marked never reaches the cleared state", async ({ page }) => {
  for (const text of ["a", "b", "c"]) await addItem(page, text);
  const closer = page.locator("#closeday");

  await expect(closer).not.toHaveClass(/cleared/);
  await tick(page, "a").click();
  await expect(closer).toHaveClass(/lit/);
  await expect(closer).not.toHaveClass(/cleared/);
});

test("the day card reports the verdict before it clears anything", async ({ page }) => {
  await addItem(page, "call the bank!");
  await addItem(page, "a");
  await addItem(page, "b");

  await tick(page, "call the bank, important").click();
  await page.locator("#closeday").click();
  await expect(page.locator("#veil .verdict")).toHaveText("The important things are done.");
  await page.locator("#veil .dismiss").click();

  await tick(page, "a").click();
  await tick(page, "b").click();
  await page.locator("#closeday").click();
  await expect(page.locator("#veil .verdict")).toHaveText("Everything done.");
});

test("an unfinished day is given no verdict rather than a consoling one", async ({ page }) => {
  await addItem(page, "call the bank!");
  await addItem(page, "a");

  await page.locator("#closeday").click();
  await expect(page.locator("#veil .verdict")).toBeHidden();
  await expect(page.locator("#veil .score")).toHaveText("0 of 2");
});

/*
 * Every milestone is celebrated, but a single tick that crosses two lines at
 * once gets one celebration, not two on the same frame.
 *
 * Read through the haptics rather than the confetti: each moment buzzes its own
 * pattern, which says *which* milestone fired and when. Counting canvas frames
 * cannot — two showers that overlap in the air look exactly like one long one.
 */
test("each milestone is celebrated once, and a doubled crossing only once", async ({ page }) => {
  await page.addInitScript(() => {
    const log: (number | number[])[] = [];
    (window as unknown as { buzzes: (number | number[])[] }).buzzes = log;
    Object.defineProperty(navigator, "vibrate", {
      configurable: true,
      value: (pattern: number | number[]) => {
        log.push(pattern);
        return true;
      },
    });
  });
  await clearStorage(page);

  /*
   * Tidying off, because this test is about which moments fire and not about
   * where rows land — and with it on, every tick sends a row travelling under
   * FLIP while the next click is being aimed at a different one. That made the
   * test quietly depend on the timing of a reorder it never meant to exercise:
   * a tick that landed on the finished marked row instead would untick it, drop
   * the day back below the first gate, and leave the count one short for good.
   * Seen once on mobile-safari, which is the slowest project and so the one
   * where the gap between ticks outruns the tidy's own delay.
   *
   * The reordering has its own coverage in prefs.spec.ts and important.spec.ts.
   */
  await openDrawer(page);
  await page.locator('[data-pref="autoCollapseDone"]').click();
  await page.locator(".drawer-close").click();

  /** Milestone buzzes only: a finished tick buzzes a bare number. */
  const milestones = (): Promise<number> =>
    page.evaluate(
      () =>
        (window as unknown as { buzzes: (number | number[])[] }).buzzes.filter((p) =>
          Array.isArray(p),
        ).length,
    );

  await addItem(page, "call the bank!");
  for (const text of ["a", "b", "c", "d"]) await addItem(page, text);
  expect(await milestones()).toBe(0);

  // Ordinary work first, stopping short of the bar: no moment reached.
  await tick(page, "a").click();
  await tick(page, "b").click();
  expect(await milestones()).toBe(0);

  // The important item lands — and 2 of 4 is under the 70% bar, so this is the
  // first moment only.
  await tick(page, "call the bank, important").click();
  await expect.poll(milestones).toBe(1);

  // A third ordinary item takes the rest to 75%: the second moment.
  await tick(page, "c").click();
  await expect.poll(milestones).toBe(2);

  // And the last one: the third.
  await tick(page, "d").click();
  await expect.poll(milestones).toBe(3);

  // Unticking drops back below, and re-ticking earns it again rather than
  // staying spent for the rest of the day.
  await tick(page, "d").click();
  await tick(page, "d").click();
  await expect.poll(milestones).toBe(4);
});

/*
 * `navigator.vibrate` cancels whatever is already playing, so on a tick that
 * both finishes an item and crosses a milestone the order matters: the small
 * tick buzz has to go first, or it silences the celebration a moment later.
 * Counting calls cannot see this — only the last one actually plays.
 */
test("a milestone's own pattern is the haptic that survives the tick", async ({ page }) => {
  await page.addInitScript(() => {
    const log: (number | number[])[] = [];
    (window as unknown as { buzzes: (number | number[])[] }).buzzes = log;
    Object.defineProperty(navigator, "vibrate", {
      configurable: true,
      value: (pattern: number | number[]) => {
        log.push(pattern);
        return true;
      },
    });
  });
  await clearStorage(page);
  await addItem(page, "call the bank!");

  // One item, so this tick clears the important work, passes the bar and
  // finishes the day all at once.
  await tick(page, "call the bank, important").click();

  const buzzes = await page.evaluate(
    () => (window as unknown as { buzzes: (number | number[])[] }).buzzes,
  );
  // The tick's own buzz came first and the celebration came last, so the
  // celebration is what the device actually plays.
  expect(buzzes.at(0)).toBe(12);
  expect(Array.isArray(buzzes.at(-1))).toBe(true);
});

/*
 * A tick that crosses both gates at once is one moment, not two: the last
 * important item landing on a list whose rest is already past the bar.
 */
test("crossing two gates on one tick celebrates once", async ({ page }) => {
  await page.addInitScript(() => {
    const log: (number | number[])[] = [];
    (window as unknown as { buzzes: (number | number[])[] }).buzzes = log;
    Object.defineProperty(navigator, "vibrate", {
      configurable: true,
      value: (pattern: number | number[]) => {
        log.push(pattern);
        return true;
      },
    });
  });
  await seedStorage(page, {
    v: 1,
    openedAt: Date.now(),
    list: [
      { kind: "task", id: "k", text: "call the bank", target: 1, count: 0, important: true },
      { kind: "task", id: "a", text: "a", target: 1, count: 1, important: false },
      { kind: "task", id: "b", text: "b", target: 1, count: 1, important: false },
      { kind: "task", id: "c", text: "c", target: 1, count: 1, important: false },
      { kind: "task", id: "d", text: "d", target: 1, count: 0, important: false },
    ],
  });

  await tick(page, "call the bank, important").click();
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (window as unknown as { buzzes: (number | number[])[] }).buzzes.filter((p) =>
            Array.isArray(p),
          ).length,
      ),
    )
    .toBe(1);
});

/*
 * The case the closing card used to be silent about, and the reason it now
 * carries the gates: five of six done, and the one thing left was marked. The
 * number alone reads as a good day, the verdict line is deliberately blank, and
 * the next thing this card does is erase the evidence.
 */
test("the closing card names what held the day back", async ({ page }) => {
  await addItem(page, "call the bank!");
  await addItem(page, "ship the patch!");
  await addItem(page, "water plants");
  await addItem(page, "shopping");

  for (const name of ["ship the patch, important", "water plants", "shopping"])
    await tick(page, name).click();
  await page.locator("#closeday").click();

  const gates = page.locator("#veil .gate");
  await expect(gates).toHaveCount(2);
  await expect(gates.nth(0).locator(".gtally")).toHaveText("1 of 2");
  await expect(gates.nth(0)).toContainText("call the bank");
  await expect(gates.nth(1).locator(".gtally")).toHaveText("2 of 2");

  // Still no words of praise: the gates report, they do not console.
  await expect(page.locator("#veil .verdict")).toBeHidden();
  // And it is the same rail the ring is painted from, short of its first gate.
  const at = (sel: string) =>
    page.locator(sel).evaluate((el) => parseFloat((el as HTMLElement).style.left));
  expect(await at("#veil .you")).toBeLessThan(await at("#veil .rail .tick >> nth=0"));
});

/*
 * The card grew, and it is the one card with a destructive button. "Clear the
 * ticks" below the fold is how someone taps it without reading what it says.
 */
/**
 * The close counts off what got done, and keeps the count.
 *
 * The names used to sit under the gates as a static list. It was a quarter of
 * the card's height and the card overflowed its box on a phone because of it,
 * so they are counted off over the gates as the bars fill and then vaporise.
 * What survives is the one line — which is also all that reduced motion and a
 * screen reader ever see, so the record does not live only inside a flourish.
 */
test("the closing card counts what got done and keeps no list of it", async ({ page }) => {
  await seedStorage(page, {
    v: 1,
    openedAt: null,
    list: [
      { kind: "task", id: "a", text: "eat breakfast", target: 1, count: 1 },
      { kind: "task", id: "b", text: "walk the dog", target: 1, count: 1 },
      { kind: "task", id: "c", text: "water plants", target: 1, count: 0 },
    ],
  });
  await page.locator("#closeday").click();

  const did = page.locator("#veil .did");
  await expect(did).toBeVisible();
  await expect(did).toHaveText("Got done — 2 things");
  // No list under it any more; the names are the ceremony, not the record.
  await expect(did.locator("li")).toHaveCount(0);
});

/*
 * Every finished row gets its name shown, not the first four and a remainder —
 * they are sequential rather than stacked, so the count costs no height.
 */
test("every finished row is counted off over its own gate", async ({ page }) => {
  await seedStorage(page, {
    v: 1,
    openedAt: null,
    list: [
      { kind: "task", id: "k", text: "call the bank", target: 1, count: 1, important: true },
      ...Array.from({ length: 6 }, (_, i) => ({
        kind: "task",
        id: `r${String(i)}`,
        text: `finished thing ${String(i)}`,
        target: 1,
        count: 1,
      })),
    ],
  });
  await page.locator("#closeday").click();

  const gates = page.locator("#veil .gate");
  // The marked work is named over its own gate, the rest over theirs.
  await expect(gates.nth(0).locator(".gflash span")).toHaveText(["call the bank"]);
  await expect(gates.nth(1).locator(".gflash span")).toHaveCount(6);

  // And when it has all played out, nothing of it is left on the card.
  await expect
    .poll(async () =>
      page.evaluate(
        () =>
          [...document.querySelectorAll("#veil .gflash span")].filter(
            (el) => Number(getComputedStyle(el).opacity) > 0.05,
          ).length,
      ),
    )
    .toBe(0);
  await expect(page.locator("#veil .did")).toHaveText("Got done — 7 things");
});

/*
 * The stands card carries the same names and never wakes them: it is a status
 * check, and a flourish every time you glance at the day would wear out fast.
 */
test("the day-stands card shows no ceremony", async ({ page }) => {
  await seedStorage(page, A_MIXED_DAY);
  await page.locator("#totalring").click();
  await expect(page.locator(".stands")).toBeVisible();
  await page.waitForTimeout(400);

  const showing = await page.evaluate(
    () =>
      [...document.querySelectorAll(".stands .gflash span")].filter(
        (el) => Number(getComputedStyle(el).opacity) > 0.05,
      ).length,
  );
  expect(showing).toBe(0);
});

/*
 * The same silence `verdictOf` keeps on an unfinished day: an empty "Got done"
 * heading is a worse thing to read at the close than no heading at all.
 */
test("it says nothing at all on a day with nothing done", async ({ page }) => {
  await addItem(page, "water plants");
  await addItem(page, "shopping");
  await page.locator("#closeday").click();

  await expect(page.locator("#veil .score")).toHaveText("0 of 2");
  await expect(page.locator("#veil .did")).toBeHidden();
});

/**
 * The closing card's numbers arrive rather than simply being there.
 *
 * Everything only ever travels *to* a value already written into the DOM, which
 * is what makes reduced motion the same path skipped rather than a second one,
 * and what makes a run that is cut short land on the finished card.
 */
const A_MIXED_DAY = {
  v: 1,
  openedAt: Date.now() - 6 * 60 * 60 * 1000,
  list: [
    { kind: "task", id: "k1", text: "call the bank", target: 1, count: 1, important: true },
    { kind: "task", id: "k2", text: "book the tickets", target: 1, count: 1, important: true },
    { kind: "task", id: "r1", text: "water plants", target: 1, count: 1 },
    { kind: "task", id: "r2", text: "shopping", target: 1, count: 1 },
    { kind: "task", id: "r3", text: "sweep up", target: 1, count: 1 },
    { kind: "task", id: "r4", text: "stretch", target: 1, count: 0 },
  ],
};

test("the closing card counts up and grows its bars", async ({ page }) => {
  await seedStorage(page, A_MIXED_DAY);

  /*
   * Scrubbed, not sampled.
   *
   * Reading whatever frame happens to come first measures when the *sampler*
   * started, not whether the card travels: WebKit spends around 300ms painting
   * this card, and the first frame there already showed the bars 73% along.
   * Driving the animations by hand asks the question directly and gets the same
   * answer on every engine.
   */
  const shot = await page.evaluate(() => {
    document.getElementById("closeday")?.click();
    const opened = document.querySelector("#veil .score")?.textContent ?? "";

    const bars = [...document.querySelectorAll<HTMLElement>("#veil .gfill")];
    const runs = bars.map((bar) => bar.getAnimations()[0]);
    for (const run of runs) run?.pause();

    /*
     * Each bar on its own timeline. They run in phases now — the marked work
     * fills, then everything else — so one clock scrubbed across both would
     * find the first already finished while the second had not begun.
     */
    const at = (fraction: number): number[] =>
      bars.map((bar, i) => {
        const timing = runs[i]?.effect?.getComputedTiming();
        const delay = timing?.delay ?? 0;
        // `duration` widens to include "auto"; these are all set in milliseconds.
        const duration = Number(timing?.duration ?? 0);
        const run = runs[i];
        if (run) run.currentTime = delay + duration * fraction;
        return Math.round(parseFloat(getComputedStyle(bar).width));
      });
    return { opened, runs: runs.length, start: at(0), middle: at(0.5), finish: at(1) };
  });

  // The score is pinned before anything moves, so it cannot flash its answer.
  expect(shot.opened).toBe("0 of 6");
  expect(shot.runs).toBe(2);

  // Each bar begins at nothing and grows the whole way.
  expect(shot.start).toEqual([0, 0]);
  shot.middle.forEach((width, i) => {
    expect(width).toBeGreaterThan(shot.start[i] ?? 0);
    expect(width).toBeLessThan(shot.finish[i] ?? 0);
  });

  // And left to itself it arrives at the day.
  await expect(page.locator("#veil .score")).toHaveText("5 of 6");
  for (const width of shot.finish) expect(width).toBeGreaterThan(0);
});

/*
 * This is the one card with a destructive button. An animation you have to sit
 * through before you can read what "Clear the ticks" takes away is a worse
 * problem than a card that does not move, so any press lands the whole run.
 */
test("a press lands the reveal at once", async ({ page }) => {
  await seedStorage(page, A_MIXED_DAY);

  const landed = await page.evaluate(async () => {
    document.getElementById("closeday")?.click();
    await new Promise((done) => setTimeout(done, 120));
    const midway = document.querySelector("#veil .score")?.textContent ?? "";
    document
      .querySelector("#veil")
      ?.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
    await new Promise((done) => requestAnimationFrame(done));
    return {
      midway,
      score: document.querySelector("#veil .score")?.textContent ?? "",
      bars: [...document.querySelectorAll("#veil .gfill")].map((el) =>
        Math.round(parseFloat(getComputedStyle(el).width)),
      ),
    };
  });

  expect(landed.midway).not.toBe("5 of 6");
  expect(landed.score).toBe("5 of 6");
  for (const width of landed.bars) expect(width).toBeGreaterThan(0);
});

test("with motion turned off the card is finished on arrival", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await seedStorage(page, A_MIXED_DAY);

  const shown = await page.evaluate(async () => {
    document.getElementById("closeday")?.click();
    await new Promise((done) => requestAnimationFrame(done));
    return {
      score: document.querySelector("#veil .score")?.textContent ?? "",
      bars: [...document.querySelectorAll("#veil .gfill")].map((el) =>
        Math.round(parseFloat(getComputedStyle(el).width)),
      ),
    };
  });

  expect(shown.score).toBe("5 of 6");
  for (const width of shown.bars) expect(width).toBeGreaterThan(0);
});

/*
 * Proportional, not unconditional. The closing card is silent on a day that
 * earned nothing — the same rule that keeps `verdictOf` from consoling one —
 * so the shower has to be too, or it is praise for 2 of 9 in another channel.
 */
test("the closing shower is what the day earned, and nothing on a day that earned none", async ({
  page,
}) => {
  const day = (marked: number[], rest: number[]) => ({
    v: 1,
    openedAt: Date.now() - 6 * 60 * 60 * 1000,
    list: [
      ...marked.map((count, i) => ({
        kind: "task",
        id: `k${String(i)}`,
        text: `marked ${String(i)}`,
        target: 1,
        count,
        important: true,
      })),
      ...rest.map((count, i) => ({
        kind: "task",
        id: `r${String(i)}`,
        text: `plain ${String(i)}`,
        target: 1,
        count,
      })),
    ],
  });

  /*
   * Opened and counted, without assuming when the shower lands. It arrives at
   * the end of the ceremony, whose length follows how much the day finished —
   * a fixed wait here goes stale the moment the pacing is tuned, and did.
   */
  const open = async (state: unknown): Promise<void> => {
    await seedStorage(page, state);
    await page.evaluate(() => {
      (window as unknown as { draws: number }).draws = 0;
      const ctx = (document.getElementById("confetti") as HTMLCanvasElement).getContext("2d");
      if (!ctx) return;
      const original = ctx.fillRect.bind(ctx);
      ctx.fillRect = (...args: Parameters<typeof original>) => {
        (window as unknown as { draws: number }).draws++;
        original(...args);
      };
    });
    await page.locator("#closeday").click();
  };
  const drawn = (): Promise<number> =>
    page.evaluate(() => (window as unknown as { draws: number }).draws);

  // The marked work landing is worth something — waited for, not timed.
  await open(day([1, 1], [1, 0, 0, 0]));
  await expect.poll(drawn, { timeout: 8000 }).toBeGreaterThan(0);

  /*
   * Nothing marked done and the bar nowhere near: no moment was reached, so
   * nothing should ever arrive. Given long enough to have arrived if it were
   * going to — the whole ceremony, and then some.
   */
  await open(day([0, 0], [1, 0, 0, 0]));
  await page.waitForTimeout(5000);
  expect(await drawn()).toBe(0);
});

test("the closing card does not scroll on a roomy window", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await addItem(page, "call the bank!");
  await addItem(page, "water plants");
  await addItem(page, "shopping");
  await page.locator("#closeday").click();

  // Measured on `.sheet-body`, which is the box that actually scrolls. `.sheet`
  // is capped and holds a scroller, so asking *it* whether it overflows is a
  // question whose answer is always no — which is what the previous version of
  // this test was doing, on a card that had no cap at all and could not
  // overflow itself either.
  const fit = await page.locator("#veil .sheet-body").evaluate((el) => ({
    content: el.scrollHeight,
    box: el.clientHeight,
  }));
  expect(fit.content).toBeLessThanOrEqual(fit.box);
});

/**
 * The one card with a destructive button, at the sizes where it used to break.
 *
 * "Clear the ticks" below the fold is how someone taps it without reading what
 * it takes away — so the button and the note naming the loss sit outside the
 * scroller and have to be wholly on screen whatever the day looks like. At
 * 360x640 a full day used to put the confirm three pixels under the bottom
 * edge, and at 320x568 an ordinary one did.
 */
const HEAVY = {
  v: 1,
  openedAt: Date.now() - 6 * 60 * 60 * 1000,
  list: [
    {
      kind: "group",
      id: "g",
      title: "Morning",
      collapsed: false,
      important: false,
      items: [1, 2, 3].map((i) => ({
        kind: "task",
        id: `m${String(i)}`,
        text: `morning thing ${String(i)}`,
        target: 1,
        count: 1,
      })),
    },
    {
      kind: "group",
      id: "g2",
      title: "Work",
      collapsed: false,
      important: false,
      items: [1, 2].map((i) => ({
        kind: "task",
        id: `w${String(i)}`,
        text: `work thing ${String(i)}`,
        target: 1,
        count: 1,
      })),
    },
    ...Array.from({ length: 12 }, (_, i) => ({
      kind: "task",
      id: `r${String(i)}`,
      text: `loose thing ${String(i)}`,
      target: 1,
      count: i < 9 ? 1 : 0,
      important: i === 11,
    })),
    ...Array.from({ length: 3 }, (_, i) => ({
      kind: "task",
      id: `o${String(i)}`,
      text: `errand ${String(i)}`,
      target: 1,
      count: 1,
      once: true,
    })),
  ],
};

/*
 * A scroller with nothing focusable inside it is reachable by mouse and by
 * nobody else — the card's buttons sit outside it on purpose, so there is
 * nothing in there to tab to. It earns a tab stop only on the days it actually
 * scrolls; a permanent one would lead nowhere on almost every day.
 */
test("the summary takes a tab stop only when it has something to scroll", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 568 });
  await seedStorage(page, HEAVY);
  await page.locator("#closeday").click();
  const body = page.locator("#veil .sheet-body");
  await expect(body).toHaveAttribute("tabindex", "0");
  await page.keyboard.press("Escape");

  await page.setViewportSize({ width: 1280, height: 900 });
  await page.locator("#closeday").click();
  await expect(body).not.toHaveAttribute("tabindex", "0");
});

for (const [width, height] of [
  [1280, 900],
  [390, 844],
  [360, 640],
  [320, 568],
  [740, 360],
] as const) {
  test(`the confirm and its warning stay on screen at ${String(width)}x${String(height)}`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height });
    await seedStorage(page, HEAVY);
    await page.locator("#closeday").click();
    await expect(page.locator("#veil .departing")).toBeVisible();

    for (const selector of ["#veil .confirm", "#veil .departing"]) {
      const box = await page.locator(selector).boundingBox();
      expect(box, selector).not.toBeNull();
      expect(box?.y ?? -1, `${selector} above the top`).toBeGreaterThanOrEqual(0);
      expect((box?.y ?? 0) + (box?.height ?? 0), `${selector} below the fold`).toBeLessThanOrEqual(
        height,
      );
    }

    // The card itself never leaves the window either, so nothing above the
    // scroller is stranded off the top.
    const sheet = await page.locator("#veil .sheet").boundingBox();
    expect(sheet?.y ?? -1).toBeGreaterThanOrEqual(0);
  });
}

/*
 * A day left open overnight opens on its own card. With the list emptied since,
 * there are no gates to report and no rail worth reading.
 */
test("a stale day with nothing in it opens the card without a rail", async ({ page }) => {
  await seedStorage(page, {
    v: 1,
    openedAt: Date.now() - 20 * 60 * 60 * 1000,
    list: [],
  });

  await expect(page.locator("#veil")).toBeVisible();
  await expect(page.locator("#veil .score")).toHaveText("0 of 0");
  await expect(page.locator("#veil .track")).toBeHidden();
  await expect(page.locator("#veil .gate")).toHaveCount(0);
});
