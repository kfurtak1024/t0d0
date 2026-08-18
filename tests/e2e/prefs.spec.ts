import { expect, test, type Page } from "@playwright/test";
import { addItem, clearStorage } from "./helpers";

const openDrawer = async (page: Page): Promise<void> => {
  await page.locator("#databtn").click();
  await expect(page.locator(".drawer")).toBeVisible();
};

const aDay = async (page: Page): Promise<void> => {
  await addItem(page, "# Morning");
  await addItem(page, "eat breakfast");
  await addItem(page, "walk the dog");
};

const tick = (page: Page, text: string) =>
  page.locator(".task", { hasText: text }).locator(".tick");

test.beforeEach(async ({ page }) => {
  await clearStorage(page);
});

test("a group folds itself once its last item is ticked", async ({ page }) => {
  await aDay(page);
  const group = page.locator(".group", { hasText: "Morning" });

  await tick(page, "eat breakfast").click();
  await expect(group).not.toHaveClass(/collapsed/);

  await tick(page, "walk the dog").click();
  await expect(group).toHaveClass(/collapsed/);
  // Folded, not finished with: the count still reports what is in there.
  await expect(group.locator(".gcount")).toHaveText("2/2");
});

test("folding waits for the tick to land rather than snatching the row away", async ({ page }) => {
  await aDay(page);
  const group = page.locator(".group", { hasText: "Morning" });

  await tick(page, "eat breakfast").click();
  await tick(page, "walk the dog").click();

  // The reward is watching the last tick complete, so the row is still there
  // for a beat afterwards.
  await expect(group).not.toHaveClass(/collapsed/);
  await expect(group).toHaveClass(/collapsed/);
});

test("re-opening a folded group by hand sticks", async ({ page }) => {
  await aDay(page);
  const group = page.locator(".group", { hasText: "Morning" });

  await tick(page, "eat breakfast").click();
  await tick(page, "walk the dog").click();
  await expect(group).toHaveClass(/collapsed/);

  await group.locator(".chev").click();
  await expect(group).not.toHaveClass(/collapsed/);
  // Nothing re-folds it behind your back a moment later.
  await page.waitForTimeout(800);
  await expect(group).not.toHaveClass(/collapsed/);
});

test("the preference turns it off, and survives a reload", async ({ page }) => {
  await aDay(page);
  await openDrawer(page);

  const toggle = page.getByRole("switch", { name: "Fold finished groups" });
  await expect(toggle).toHaveAttribute("aria-checked", "true");
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-checked", "false");
  await page.keyboard.press("Escape");

  await tick(page, "eat breakfast").click();
  await tick(page, "walk the dog").click();
  await page.waitForTimeout(800);
  await expect(page.locator(".group", { hasText: "Morning" })).not.toHaveClass(/collapsed/);

  await page.reload();
  await openDrawer(page);
  await expect(page.getByRole("switch", { name: "Fold finished groups" })).toHaveAttribute(
    "aria-checked",
    "false",
  );
});

/*
 * Reduced motion means instant, not absent. The fold still happens, the reorder
 * still lands — they just skip the travel. Anything that only ever "happened"
 * inside an animation would silently stop happening here.
 */
test.describe("with motion turned off", () => {
  test("a finished group still folds, and a move still lands", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.reload();
    await aDay(page);

    await tick(page, "eat breakfast").click();
    await tick(page, "walk the dog").click();
    // Instant, not merely eventual: with motion on, the fold waits out the
    // tick's animation first, and this window is far shorter than that wait.
    await expect(page.locator(".group", { hasText: "Morning" })).toHaveClass(/collapsed/, {
      timeout: 250,
    });

    await page.locator(".group", { hasText: "Morning" }).locator(".chev").click();
    await page.locator("#dest").selectOption("");
    await addItem(page, "loose");

    const row = page.locator(".list > .task", { hasText: "loose" });
    await row.locator(".dots").click();
    await page.getByRole("menuitem", { name: "Move up" }).click();
    await page.keyboard.press("Escape");

    // Landed in its finished position, and fully painted there — reduced motion
    // means the travel is skipped, not that a row is left half-faded.
    await expect(page.locator("#list > li").first()).toHaveText(/loose/);
    await expect
      .poll(() =>
        page.evaluate(() => {
          const el = document.querySelector<HTMLElement>("#list > li");
          return el ? getComputedStyle(el).opacity : "";
        }),
      )
      .toBe("1");
  });
});

test("a preference is not carried in a backup", async ({ page }) => {
  await addItem(page, "shopping");
  await openDrawer(page);
  await page.getByRole("switch", { name: "Fold finished groups" }).click();

  const download = page.waitForEvent("download");
  await page.locator('[data-act="save"]').click();
  const stream = await (await download).createReadStream();
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(chunk as Buffer);

  // Preferences belong to this browser, the way the theme does.
  expect(Buffer.concat(chunks).toString("utf8")).not.toContain("autoCollapse");
});
