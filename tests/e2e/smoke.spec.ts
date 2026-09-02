import { expect, test, type Locator, type Page } from "@playwright/test";
import { clearStorage, addItem } from "./helpers";

test.beforeEach(async ({ page }) => {
  await clearStorage(page);
});

/**
 * Delete a row through the ⋯ menu, which is the only route to it.
 *
 * It used to be a ✕ on the row, which cost every row a 25.6px column whether or
 * not it was visible — a fifth of a nested label on a phone. Undo is what makes
 * one press safe enough to need no confirm, and these tests lean on that.
 */
const deleteRow = async (page: Page, row: Locator): Promise<void> => {
  await row.locator(".dots").click();
  await page.getByRole("menuitem", { name: /^Delete/ }).click();
};

test("adds, ticks, and reports progress", async ({ page }) => {
  await addItem(page, "shopping");
  await addItem(page, "laundry");

  await expect(page.locator(".list .task")).toHaveCount(2);
  await expect(page.locator("#frac")).toHaveText("0 of 2");

  await page.locator(".task", { hasText: "shopping" }).locator(".tick").click();

  await expect(page.locator(".task", { hasText: "shopping" })).toHaveClass(/done/);
  await expect(page.locator("#frac")).toHaveText("1 of 2");
});

test("a counted item needs one tap per unit", async ({ page }) => {
  await addItem(page, "make calls [3]");

  const row = page.locator(".task", { hasText: "make calls" });
  await expect(row.locator(".count")).toHaveText("0/3");
  // The tally says the target; the label is the name and nothing else. `!` and
  // `~` do not survive into the text either — the bracket now matches them.
  await expect(row.locator(".label")).toHaveText("make calls");

  for (let i = 0; i < 3; i++) await row.locator(".tick").click();

  await expect(row.locator(".count")).toHaveText("3/3");
  await expect(row).toHaveClass(/done/);
});

/*
 * The three things the composer parses all leave the text on the way in, and
 * each is shown by something built for it: the accent edge, the tag, the tally.
 * The bracket was the odd one out — spelled into the label *and* counted in
 * `.count` — which made a counted row the only row whose text was not what you
 * typed. All three come back when you edit, which `raw()` covers.
 */
test("a row's label is its name, and none of the marks", async ({ page }) => {
  await addItem(page, "call the bank! [3]~");

  const row = page.locator(".task", { hasText: "call the bank" });
  await expect(row.locator(".label")).toHaveText("call the bank");

  // Each mark still shows, just not as text in the name.
  await expect(row).toHaveClass(/important/);
  await expect(row.locator(".once")).toBeVisible();
  await expect(row.locator(".count")).toHaveText("0/3");

  // And editing hands all three back.
  await row.locator(".label").click();
  await expect(row.locator(".label")).toHaveText("call the bank!~ [3]");
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

test("tapping a finished plain item unticks it", async ({ page }) => {
  await addItem(page, "shopping");
  const row = page.locator(".task", { hasText: "shopping" });
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
  const row = page.locator(".task", { hasText: "make calls" });

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
  const row = page.locator(".task", { hasText: "make calls" });

  await row.locator(".tick").click();
  await row.locator(".tick").click();
  await expect(row.locator(".count")).toHaveText("2/3");

  await row.locator(".count").click();
  await expect(row.locator(".count")).toHaveText("1/3");
});

test("groups hold their items and report their own count", async ({ page }) => {
  await addItem(page, "# Morning");
  await addItem(page, "eat breakfast");
  await addItem(page, "walk the dog");

  const group = page.locator(".group", { hasText: "Morning" });
  await expect(group.locator(".items .task")).toHaveCount(2);
  await expect(group.locator(".gcount")).toHaveText("0/2");

  await group.locator(".task", { hasText: "eat breakfast" }).locator(".tick").click();
  await expect(group.locator(".gcount")).toHaveText("1/2");
});

test("the destination picker appears with the first group and steers new items", async ({
  page,
}) => {
  await addItem(page, "shopping");
  await expect(page.locator("#destrow")).toBeHidden();

  await addItem(page, "# Morning");
  await expect(page.locator("#destrow")).toBeVisible();
  await expect(page.locator("#dest")).toHaveValue(/.+/);

  // Back to the root, and the next item lands outside the group.
  await page.locator("#dest").selectOption("");
  await addItem(page, "loose");
  await expect(page.locator(".list > .task", { hasText: "loose" })).toBeVisible();
});

test("the day closes with a summary and clears the ticks", async ({ page }) => {
  await addItem(page, "# Morning");
  await addItem(page, "eat breakfast");
  await addItem(page, "walk the dog");

  await page.locator(".task", { hasText: "eat breakfast" }).locator(".tick").click();
  await page.locator("#closeday").click();

  const sheet = page.locator("#veil");
  await expect(sheet).toBeVisible();
  await expect(sheet.locator(".score")).toHaveText("1 of 2");

  await sheet.locator(".confirm").click();
  await expect(sheet).toBeHidden();
  await expect(page.locator("#frac")).toHaveText("0 of 2");
  await expect(page.locator(".list .task")).toHaveCount(2);
});

test("deleting is undoable", async ({ page }) => {
  await addItem(page, "shopping");
  const row = page.locator(".task", { hasText: "shopping" });

  await deleteRow(page, row);
  await expect(page.locator(".list .task")).toHaveCount(0);

  await page.locator(".toast-action").click();
  await expect(page.locator(".task", { hasText: "shopping" })).toBeVisible();
});

/*
 * The row carries no ✕ of its own. It cost every row a 25.6px column whether or
 * not it was visible — opacity hides a control, it does not un-reserve its
 * space — which on a phone was a fifth of a nested row's label and a third of a
 * counted one's.
 */
test("a row has no delete button of its own", async ({ page }) => {
  await addItem(page, "# Morning");
  await addItem(page, "shopping");

  await expect(page.locator(".list .kill")).toHaveCount(0);
  await expect(page.locator(".list .dots")).toHaveCount(2);
});

/*
 * A group takes its items with it, and they do not come back on their own — so
 * the entry says so, the same way the one-off entry names its consequence
 * rather than its mark.
 */
test("the menu's delete entry names what a group takes with it", async ({ page }) => {
  await addItem(page, "# Morning");
  await addItem(page, "eat breakfast");
  await addItem(page, "walk the dog");

  await page.locator(".ghead > .dots").click();
  await expect(page.getByRole("menuitem", { name: /^Delete/ })).toHaveText(
    "Delete group and 2 items",
  );
  await page.keyboard.press("Escape");

  // A plain row has nothing to take with it, so it just says Delete.
  await page.locator(".items > .task").first().locator(".dots").click();
  await expect(page.getByRole("menuitem", { name: /^Delete/ })).toHaveText("Delete");
});

test("an empty group says only that it is a group", async ({ page }) => {
  await addItem(page, "# Later");

  await page.locator(".ghead > .dots").click();
  await expect(page.getByRole("menuitem", { name: /^Delete/ })).toHaveText("Delete group");
});

/*
 * The toast offers the undo and then gets out of the way. Nothing else takes it
 * down, so if the countdown stops working it would sit over the composer for
 * the rest of the session.
 */
test("the toast takes itself away", async ({ page }) => {
  await addItem(page, "shopping");
  const row = page.locator(".task", { hasText: "shopping" });

  await deleteRow(page, row);
  await expect(page.locator("#toast")).toBeVisible();

  /*
   * The toast fades out rather than leaving the layout — it keeps its box so it
   * can animate — so "gone" is opacity and pointer-events, not visibility.
   * Waits longer than the countdown, and resolves the moment it goes.
   */
  await expect
    .poll(
      () =>
        page
          .locator("#toast")
          .evaluate((el) => [getComputedStyle(el).opacity, getComputedStyle(el).pointerEvents]),
      { timeout: 9000 },
    )
    .toEqual(["0", "none"]);
  // The undo outlives its toast: the offer expired, the state did not.
  await page.keyboard.press("ControlOrMeta+z");
  await expect(page.locator(".task", { hasText: "shopping" })).toBeVisible();
});

test("the closer only appears once there is something to close", async ({ page }) => {
  await expect(page.locator("#closeday")).toBeHidden();
  await addItem(page, "shopping");
  await expect(page.locator("#closeday")).toBeVisible();
});

test("a finished top-level item gets the same green frame as a cleared group", async ({ page }) => {
  await addItem(page, "shopping");
  const row = page.locator(".list > .task", { hasText: "shopping" });

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

  const check = page.locator(".task", { hasText: "shopping" }).locator(".tick");
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

  const spin = page.locator(".task", { hasText: "make calls" }).locator(".tick");
  await expect(spin).toHaveRole("spinbutton");
  await expect(spin).toHaveAttribute("aria-valuemax", "3");

  await spin.focus();
  await page.keyboard.press("ArrowUp");
  await expect(spin).toHaveAttribute("aria-valuenow", "1");
  await page.keyboard.press("ArrowDown");
  await expect(spin).toHaveAttribute("aria-valuenow", "0");
});

test("the list is a list", async ({ page }) => {
  await addItem(page, "# Morning");
  await addItem(page, "eat breakfast");

  await expect(page.locator("#list")).toHaveRole("list");
  await expect(page.locator("#list > li")).toHaveCount(1);
  await expect(page.locator(".items > li")).toHaveCount(1);
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

  await page.locator(".task", { hasText: "one" }).locator(".tick").click();
  await expect(page.locator("#frac")).toHaveText("1 of 2");

  // The tween keeps rewriting #pct; #frac must settle at exactly one write.
  await expect
    .poll(() => page.evaluate(() => (window as unknown as { writes: number }).writes))
    .toBe(1);
});

test("a collapsed group leaves the tab order", async ({ page }) => {
  await addItem(page, "# Morning");
  await addItem(page, "eat breakfast");

  const hidden = page.locator(".items [data-id] .tick").first();
  await expect(hidden).toBeVisible();

  await page.locator(".chev").click();
  await expect(page.locator(".group")).toHaveClass(/collapsed/);
  await expect(page.locator(".gbody")).toHaveAttribute("inert", "");

  // Not merely invisible — unreachable.
  const reachable = await page.evaluate(() => {
    const tick = document.querySelector<HTMLElement>(".items [data-id] .tick");
    tick?.focus();
    return document.activeElement === tick;
  });
  expect(reachable).toBe(false);
});

test("the day card does not open with the destructive button focused", async ({ page }) => {
  await addItem(page, "shopping");
  await page.locator(".tick").first().click();
  await page.locator("#closeday").click();

  await expect(page.locator("#veil")).toBeVisible();
  const onConfirm = await page.evaluate(
    () => document.activeElement?.classList.contains("confirm") ?? false,
  );
  expect(onConfirm).toBe(false);

  // Enter on open must not clear the day.
  await page.keyboard.press("Enter");
  await expect(page.locator("#frac")).toHaveText("1 of 1");
});

test("undo during the delete animation puts the item back", async ({ page }) => {
  await addItem(page, "alpha");
  await addItem(page, "beta");

  const row = page.locator(".task", { hasText: "alpha" });
  await deleteRow(page, row);
  await page.keyboard.press("Control+z"); // inside the exit animation

  await expect(page.locator(".task", { hasText: "alpha" })).toBeVisible();
  await expect(page.locator(".task", { hasText: "alpha" })).not.toHaveClass(/leaving/);
  await expect(page.locator(".list .task")).toHaveCount(2);
});

test("deleting the last undone item still finishes the day", async ({ page }) => {
  await addItem(page, "done one");
  await addItem(page, "not yet");
  await page.locator(".task", { hasText: "done one" }).locator(".tick").click();

  await page.evaluate(() => {
    (window as unknown as { draws: number }).draws = 0;
    const ctx = (document.getElementById("confetti") as HTMLCanvasElement).getContext("2d");
    if (ctx) {
      const original = ctx.fillRect.bind(ctx);
      ctx.fillRect = (...args: Parameters<typeof original>) => {
        (window as unknown as { draws: number }).draws++;
        original(...args);
      };
    }
  });

  const row = page.locator(".task", { hasText: "not yet" });
  await deleteRow(page, row);

  await expect(page.locator("#frac")).toHaveText("1 of 1");
  await expect
    .poll(() => page.evaluate(() => (window as unknown as { draws: number }).draws))
    .toBeGreaterThan(0);
});

/*
 * Editing is the only place the app makes an element contenteditable, and it
 * asks for "plaintext-only" — a value a browser is entitled to reject with a
 * SyntaxError rather than ignore. Nothing else here would notice if it did.
 */
test("a label edits in place, commits on Enter and reverts on Escape", async ({ page }) => {
  await addItem(page, "shopping");
  const label = page.locator(".task .label");

  await label.click();
  await page.keyboard.press("ControlOrMeta+a");
  await page.keyboard.type("groceries");
  await page.keyboard.press("Enter");
  await expect(label).toHaveText("groceries");

  await label.click();
  await page.keyboard.press("ControlOrMeta+a");
  await page.keyboard.type("never mind");
  await page.keyboard.press("Escape");
  await expect(label).toHaveText("groceries");
});

test("editing keeps the [n] visible and round-trips it", async ({ page }) => {
  await addItem(page, "make calls [3]");
  const label = page.locator(".task .label");

  await label.click();
  // The raw form comes back with the bracket, so the quantity stays editable.
  await expect(label).toHaveText("make calls [3]");
  await page.keyboard.press("Escape");

  await expect(label).toContainText("make calls");
  await expect(page.locator(".task .count")).toHaveText("0/3");
});
