import { expect, test } from "@playwright/test";
import { clearStorage, addItem } from "./helpers";

test.beforeEach(async ({ page }) => {
  await clearStorage(page);
});

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
  await expect(row.locator(".label")).toContainText("[3]");

  for (let i = 0; i < 3; i++) await row.locator(".tick").click();

  await expect(row.locator(".count")).toHaveText("3/3");
  await expect(row).toHaveClass(/done/);
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

  await row.hover();
  await row.locator(".kill").click();
  await expect(page.locator(".list .task")).toHaveCount(0);

  await page.locator(".toast-action").click();
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
  await page.waitForTimeout(800);

  const writes = await page.evaluate(() => (window as unknown as { writes: number }).writes);
  expect(writes).toBe(1);
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
  await row.hover();
  await row.locator(".kill").click();
  await page.keyboard.press("Control+z"); // inside the exit animation

  await page.waitForTimeout(600);
  await expect(page.locator(".task", { hasText: "alpha" })).toBeVisible();
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
  await row.hover();
  await row.locator(".kill").click();
  await page.waitForTimeout(900);

  await expect(page.locator("#frac")).toHaveText("1 of 1");
  const draws = await page.evaluate(() => (window as unknown as { draws: number }).draws);
  expect(draws).toBeGreaterThan(0);
});
