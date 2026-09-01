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
test("the closer says how the day is going, not only the ring", async ({ page }) => {
  await addItem(page, "call the bank!");
  for (const text of ["a", "b", "c", "d"]) await addItem(page, text);

  const closer = page.locator("#closeday");
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
