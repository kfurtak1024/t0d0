import { expect, test, passTidy, passCountUp } from "./fixtures";
import { clearStorage, addItem, seedStorage, task, rowOf, tickOf } from "./helpers";

/*
 * Ticking: plain and counted rows, the strike, the frame, and what a screen
 * reader is told.
 */

test.beforeEach(async ({ page }) => {
  await clearStorage(page);
});

/*
 * The header asks two questions and they have two answers.
 *
 * The arc and `#pct` report `progress()` — the mean of `count / target` over
 * every task — while `#frac` counts the rows that are actually finished. On a
 * list of plain items the two agree, which is every other assertion in this
 * file and is how they came to be mistaken for the same number. Put one
 * part-counted row in and they part company, and both are still right: a third
 * of a `[3]` is real progress and is not a finished row.
 */
test("a count and a proportion are different questions", async ({ page }) => {
  await seedStorage(page, {
    v: 1,
    openedAt: Date.now(),
    list: [
      { kind: "task", id: "spread", text: "spread the word", target: 3, count: 1 },
      ...["a", "b", "c"].map((text) => ({ ...task(text), count: 1 })),
      ...["d", "e", "f"].map((text) => task(text)),
    ],
  });

  // Three of the seven rows are done, and the third of a point the `[3]` has
  // earned belongs to the mean rather than to the tally.
  await expect(page.locator("#frac")).toHaveText("3 of 7");
  await passCountUp(page);
  await expect(page.locator("#pct")).toHaveText("48%");
});

test("a counted item needs one tap per unit", async ({ page }) => {
  await addItem(page, "make calls [3]");

  const row = rowOf(page, "make calls");
  await expect(row.locator(".count")).toHaveText("0/3");
  // The tally says the target; the label is the name and nothing else. `!` and
  // `~` do not survive into the text either — the bracket now matches them.
  await expect(row.locator(".label")).toHaveText("make calls");

  for (let i = 0; i < 3; i++) await row.locator(".tick").click();

  await expect(row.locator(".count")).toHaveText("3/3");
  await expect(row).toHaveClass(/done/);
});

/*
 * A mis-tap has to be recoverable with the same finger that made it. Shift-click
 * and the arrow keys do not exist on a phone, and a plain item has no count
 * label to tap, so the tick itself has to go both ways.
 */
/**
 * A finished row is struck through on every line it occupies.
 *
 * The strike used to be one absolutely positioned bar, which an inline span
 * that wraps does not have: it resolved against the union of both lines,
 * landing between them and reaching only as far as the first. A finished row
 * whose text wrapped — any task of a normal length on a phone — read as
 * underlined on line one and untouched on line two.
 *
 * Asserted through the run rather than by reading pixels: the strike is now a
 * background laid across the whole inline run, so covering it is the same fact
 * as covering every line of it. `rects` proves the label really did wrap, which
 * is the condition that used to break it.
 */
test("a finished row is struck through across a wrapped label", async ({ page }) => {
  await page.setViewportSize({ width: 380, height: 700 });
  await addItem(page, "walk the dog before it rains today");
  const line = page.locator(".task .label .line");

  const before = await line.evaluate((el) => ({
    rects: el.getClientRects().length,
    size: getComputedStyle(el).backgroundSize,
  }));
  expect(before.rects, "the label has to wrap for this to mean anything").toBeGreaterThan(1);
  expect(before.size).toBe("0% 1.5px");

  await page.locator(".task .tick").click();
  await expect(page.locator(".task")).toHaveClass(/done/);
  await expect
    .poll(() => line.evaluate((el) => getComputedStyle(el).backgroundSize))
    .toBe("100% 1.5px");
});

/*
 * And it actually wipes, rather than arriving already struck.
 *
 * The strike is a `background-size` transition, and a transition needs the
 * element it runs on to have been rendered with the old value. `writeLabel`
 * used to rebuild the `.line` span on every update, so the browser was handed a
 * fresh element already at its finished value: the wipe never played on any
 * row. The test above could not see it — it polls for the finished state, which
 * is exactly what a snap also reaches.
 *
 * Asked of the transition itself rather than by sampling a frame, for the same
 * reason the closing card's reveal is scrubbed: which frame a sampler catches
 * is a different number on every engine.
 */
test("the strike wipes across the words rather than arriving struck", async ({ page }) => {
  await addItem(page, "alpha");
  await addItem(page, "beta");

  // `beta` sits above `alpha`, so ticking it leaves it in the day's work.
  const wipe = await page.evaluate(() => {
    const row = [...document.querySelectorAll<HTMLElement>(".task")].find(
      (el) => el.querySelector(".label")?.textContent === "beta",
    );
    const line = row?.querySelector<HTMLElement>(".label .line");
    if (!row || !line) throw new Error("no row to tick");

    row.querySelector<HTMLElement>(".tick")?.click();
    // Read synchronously: a transition reports its starting value, a snap its
    // finished one, and the element is the same one either way.
    return {
      kept: row.querySelector(".label .line") === line,
      running: line.getAnimations().map((a) => a.constructor.name),
      size: getComputedStyle(line).backgroundSize,
    };
  });

  expect(wipe.kept, "the span has to survive the tick to transition at all").toBe(true);
  expect(wipe.running).toContain("CSSTransition");
  expect(wipe.size, "it starts where it was, not where it is going").toBe("0% 1.5px");

  // And it still gets there.
  await expect
    .poll(() =>
      rowOf(page, "beta")
        .locator(".line")
        .evaluate((el) => getComputedStyle(el).backgroundSize),
    )
    .toBe("100% 1.5px");
});

/*
 * The row at the foot of the work has the same wipe as any other.
 *
 * It is the row with no journey to make: `pileFrom` reads the trailing run of
 * finished rows, so a tick down there put it in the pile on the very frame it
 * landed. Crossing into `#donelist` is a removal and an insertion, which
 * restarts the label's style — so that one row, and only that one, arrived
 * already struck.
 */
test("the last row of the work wipes too, rather than crossing under the tick", async ({
  page,
}) => {
  await addItem(page, "alpha");
  await addItem(page, "beta");

  const wipe = await page.evaluate(() => {
    const row = [...document.querySelectorAll<HTMLElement>(".task")].find(
      (el) => el.querySelector(".label")?.textContent === "alpha",
    );
    const line = row?.querySelector<HTMLElement>(".label .line");
    if (!row || !line) throw new Error("no row to tick");

    row.querySelector<HTMLElement>(".tick")?.click();
    return {
      parent: row.parentElement?.id ?? "?",
      running: line.getAnimations().map((a) => a.constructor.name),
      size: getComputedStyle(line).backgroundSize,
    };
  });

  expect(wipe.parent, "it stays in the work while the tick plays out").toBe("list");
  expect(wipe.running).toContain("CSSTransition");
  expect(wipe.size).toBe("0% 1.5px");

  // And it does reach the pile, once the tidy lets it go.
  await passTidy(page);
  await expect(rowOf(page, "alpha", "#donelist .task")).toBeVisible();
});

/*
 * The delay is the reward playing out, and it covers every row — including the
 * one already sitting at the foot of the work, which used to cross at +0ms
 * because it needed no journey to get there.
 */
test("a row ticked at the foot of the work waits with the rest", async ({ page }) => {
  await addItem(page, "alpha");
  await addItem(page, "beta");

  const where = () =>
    rowOf(page, "alpha")
      .evaluate((el) => el.parentElement?.id ?? "?")
      .catch(() => "?");

  await tickOf(page, "alpha").click();
  expect(await where(), "in the work on the frame it was ticked").toBe("list");
  await page.clock.runFor(300);
  expect(await where(), "still in the work while the tick lands").toBe("list");
  await passTidy(page);
  await expect.poll(where, { timeout: 4000 }).toBe("donelist");
});

test("tapping a finished plain item unticks it", async ({ page }) => {
  await addItem(page, "shopping");
  const row = rowOf(page, "shopping");
  const tick = row.locator(".tick");

  await tick.click();
  await expect(row).toHaveClass(/done/);
  await expect(tick).toHaveAttribute("aria-checked", "true");
  await expect(page.locator("#frac")).toHaveText("1 of 1");

  await tick.click();
  await expect(row).not.toHaveClass(/done/);
  await expect(tick).toHaveAttribute("aria-checked", "false");
  await expect(page.locator("#frac")).toHaveText("0 of 1");
});

test("a counted item counts up instead of toggling, and resets from the menu", async ({ page }) => {
  await addItem(page, "make calls [3]");
  const row = rowOf(page, "make calls");

  for (let i = 0; i < 3; i++) await row.locator(".tick").click();
  await expect(row.locator(".count")).toHaveText("3/3");

  // Tapping a finished counted item must not wipe three taps of progress.
  await row.locator(".tick").click();
  await expect(row.locator(".count")).toHaveText("3/3");

  await row.locator(".dots").click();
  await page.getByRole("menuitem", { name: "Reset to 0" }).click();
  await expect(row.locator(".count")).toHaveText("0/3");
  await expect(row).not.toHaveClass(/done/);
});

test("tapping the count steps back down", async ({ page }) => {
  await addItem(page, "make calls [3]");
  const row = rowOf(page, "make calls");

  await row.locator(".tick").click();
  await row.locator(".tick").click();
  await expect(row.locator(".count")).toHaveText("2/3");

  await row.locator(".count").click();
  await expect(row.locator(".count")).toHaveText("1/3");
});

test("a finished top-level item gets the same green frame as a cleared group", async ({ page }) => {
  await addItem(page, "shopping");
  const row = rowOf(page, "shopping", ".list > .task");

  const plain = await row.evaluate((el) => getComputedStyle(el).boxShadow);
  await row.locator(".tick").click();
  await expect(row).toHaveClass(/done/);

  const finished = await row.evaluate((el) => getComputedStyle(el).boxShadow);
  expect(finished).not.toBe(plain);
  // Same completion green the group frame uses.
  expect(finished).toMatch(/oklch/);
});

test("the tick is a real control with the right role and state", async ({ page }) => {
  await addItem(page, "shopping");
  await addItem(page, "make calls [3]");

  const check = tickOf(page, "shopping");
  await expect(check).toHaveRole("checkbox");
  await expect(check).toHaveAttribute("aria-checked", "false");

  // Focusable, and activated by the keyboard like any button.
  await check.focus();
  await page.keyboard.press("Space");
  await expect(check).toHaveAttribute("aria-checked", "true");

  // Arrows are a spinbutton interaction. On a checkbox they must do nothing —
  // Space and Enter are already the way back, and the key table says arrows
  // count an [n] item.
  await page.keyboard.press("ArrowDown");
  await expect(check).toHaveAttribute("aria-checked", "true");

  const spin = tickOf(page, "make calls");
  await expect(spin).toHaveRole("spinbutton");
  await expect(spin).toHaveAttribute("aria-valuemax", "3");

  await spin.focus();
  await page.keyboard.press("ArrowUp");
  await expect(spin).toHaveAttribute("aria-valuenow", "1");
  await page.keyboard.press("ArrowDown");
  await expect(spin).toHaveAttribute("aria-valuenow", "0");
});

test("progress is announced once, not once per animation frame", async ({ page }) => {
  await addItem(page, "one");
  await addItem(page, "two");

  // The tweened percentage is decorative; the fraction is what gets announced.
  await expect(page.locator("#pct")).toHaveAttribute("aria-hidden", "true");
  await expect(page.locator("#frac")).toHaveRole("status");

  await page.evaluate(() => {
    (window as unknown as { writes: number }).writes = 0;
    const frac = document.getElementById("frac");
    if (frac) {
      new MutationObserver(() => {
        (window as unknown as { writes: number }).writes++;
      }).observe(frac, { childList: true, characterData: true, subtree: true });
    }
  });

  await tickOf(page, "one").click();
  await expect(page.locator("#frac")).toHaveText("1 of 2");

  // The tween keeps rewriting #pct; #frac must settle at exactly one write.
  await expect
    .poll(() => page.evaluate(() => (window as unknown as { writes: number }).writes))
    .toBe(1);
});
