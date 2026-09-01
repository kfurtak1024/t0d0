import { expect, test, type Page } from "@playwright/test";
import { clearStorage, seedStorage } from "./helpers";

/**
 * The ring's own card: where the day stands, mid-day, on the ring's terms.
 *
 * The numbers it reports are unit-tested in `progress`; what only a browser can
 * check is that pressing the ring opens it, that it names the gates the day
 * actually has, and that it cannot change anything — the closer is the only way
 * to end a day, and a second card that could clear the list would be a second
 * answer to the same question.
 */

const t = (id: string, text: string, important: boolean, count = 0, target = 1) => ({
  kind: "task",
  id,
  text,
  target,
  count,
  important,
});

/** One marked item done of three, and the rest one short of a 70% bar. */
const A_DAY = {
  v: 1,
  openedAt: Date.now() - 90 * 60_000,
  list: [
    {
      kind: "group",
      id: "g",
      title: "Admin",
      collapsed: false,
      important: false,
      items: [
        t("a1", "book the tickets", true),
        t("a2", "reply to Dana", true),
        t("a3", "tidy the desk", false, 1),
      ],
    },
    t("r1", "call the bank", true, 1),
    t("r2", "water plants", false, 1),
    t("r3", "make calls", false, 1, 3),
    t("r4", "shopping", false, 1),
    t("r5", "sweep up", false, 0),
  ],
};

const open = async (page: Page): Promise<void> => {
  await page.locator("#totalring").click();
  await expect(page.locator(".stands")).toBeVisible();
};

test("the ring opens the day's card, and the card only reports", async ({ page }) => {
  await seedStorage(page, A_DAY);
  await open(page);

  await expect(page.locator("#standsscore")).toHaveText("4 of 8");
  await expect(page.locator("#standsnext")).toHaveText(
    "2 important things left, then the day turns green.",
  );
  // The marked work still to do, named, so the card says what to do next.
  await expect(page.locator(".gate").first()).toContainText("book the tickets");
  await expect(page.locator(".gate").first()).toContainText("reply to Dana");
  await expect(page.locator("#standsdur")).toHaveText("1h 30m in");

  // Nothing here can change the list: one way out, and it is not a confirm.
  await expect(page.locator(".stands button")).toHaveCount(1);
  await expect(page.locator(".stands .dismiss")).toHaveText("Back to the list");
});

test("both gates are reported, because the day turns on both", async ({ page }) => {
  await seedStorage(page, A_DAY);
  await open(page);

  const gates = page.locator(".gate");
  await expect(gates).toHaveCount(2);
  await expect(gates.nth(0)).toContainText("Important");
  await expect(gates.nth(0).locator(".gtally")).toHaveText("1 of 3");
  await expect(gates.nth(1)).toContainText("Everything else");
  await expect(gates.nth(1).locator(".gtally")).toHaveText("3 of 5");
  await expect(gates.nth(1).locator(".gnote")).toHaveText("one more clears the bar, set at 70%");
});

/*
 * With nothing marked the day's sweep runs red straight to blue: green is a
 * colour it passes through, not a gate. The card has to say the same, or it
 * promises a landmark the ring is not keeping.
 */
test("a list with nothing marked has no green landmark and one gate", async ({ page }) => {
  await seedStorage(page, {
    v: 1,
    openedAt: null,
    list: [
      t("p1", "water plants", false, 1),
      t("p2", "shopping", false),
      t("p3", "sweep up", false),
    ],
  });
  await open(page);

  await expect(page.locator("#standsgreen")).toBeHidden();
  await expect(page.locator("#standsmarks span")).toHaveCount(1);
  await expect(page.locator("#standsmarks span")).toHaveText("the bar");

  const gates = page.locator(".gate");
  await expect(gates).toHaveCount(1);
  await expect(gates).toContainText("Everything");
  await expect(page.locator("#standsnext")).toHaveText("2 more and it's a good day.");
});

test("the dot sits where the ring's own hue says it does", async ({ page }) => {
  await seedStorage(page, A_DAY);
  await open(page);

  // Not a pixel assertion: the dot has to be short of the important gate, since
  // the marked work is not done, and the gates in their own order along the rail.
  const at = (sel: string) => page.locator(sel).evaluate((el) => parseFloat(el.style.left));
  expect(await at("#standsyou")).toBeLessThan(await at("#standsgreen"));
  expect(await at("#standsgreen")).toBeLessThan(await at("#standsblue"));
  expect(await at("#standsyou")).toBeGreaterThan(0);
});

test("an empty list has nothing to report, so the ring is not a button", async ({ page }) => {
  await clearStorage(page);

  await expect(page.locator("#totalring")).toBeDisabled();
  await expect(page.locator(".stands")).toBeHidden();
});

test("it closes on Escape, on the veil, and on the way back", async ({ page }) => {
  await seedStorage(page, A_DAY);

  await open(page);
  await page.keyboard.press("Escape");
  await expect(page.locator(".stands")).toBeHidden();

  await open(page);
  await page.locator(".stands .dismiss").click();
  await expect(page.locator(".stands")).toBeHidden();

  await open(page);
  // The veil itself, well clear of the card.
  await page.mouse.click(8, 8);
  await expect(page.locator(".stands")).toBeHidden();
});

test("focus is trapped while it is open and handed back when it closes", async ({ page }) => {
  await seedStorage(page, A_DAY);
  await open(page);

  await page.keyboard.press("Tab");
  await expect(page.locator(".stands .dismiss")).toBeFocused();
  await page.keyboard.press("Tab");
  // Nowhere else to go: the only control in the card keeps the focus.
  await expect(page.locator(".stands .dismiss")).toBeFocused();

  await page.keyboard.press("Escape");
  await expect(page.locator("#totalring")).toBeFocused();
});

test("the card reads the list as it stands now, not as it was opened", async ({ page }) => {
  await seedStorage(page, A_DAY);
  await open(page);
  await expect(page.locator("#standsscore")).toHaveText("4 of 8");
  await page.keyboard.press("Escape");

  await page.locator(".task", { hasText: "sweep up" }).locator(".tick").click();
  await open(page);
  await expect(page.locator("#standsscore")).toHaveText("5 of 8");
  await expect(page.locator(".gate").nth(1).locator(".gnote")).toHaveText(
    "past the bar, set at 70%",
  );
});
