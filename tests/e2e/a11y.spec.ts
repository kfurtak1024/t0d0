import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { seedStorage } from "./helpers";

/**
 * The accessibility work was done by hand and by eye. This is the net under it:
 * axe catches the rule violations, the ARIA snapshot catches a silent slide back
 * to <div>s with click handlers.
 */

/*
 * Scan with reduced motion on. The helper below used to say reduced motion
 * "collapses the durations" while nothing actually enabled it, so the only
 * guard was the opacity poll — which a `border-color` or `background`
 * transition sails straight past, and axe then samples a blended colour and
 * reports a contrast failure that is gone a frame later. It cost a flaky
 * WebKit run. Reduced motion is also the honest state to judge contrast in:
 * the app's rule is that it lands in the finished visual state, instantly.
 *
 * Set on the context rather than per page, so it is in force from the very
 * first paint — emulating it after navigation is already too late.
 */
test.use({ contextOptions: { reducedMotion: "reduce" } });

const A_DAY = {
  v: 1,
  openedAt: Date.now() - 3 * 60 * 60 * 1000,
  list: [
    {
      kind: "group",
      id: "g1",
      title: "Morning",
      collapsed: false,
      items: [
        { kind: "task", id: "t1", text: "eat breakfast", target: 1, count: 1 },
        { kind: "task", id: "t2", text: "walk the dog", target: 1, count: 0 },
      ],
    },
    { kind: "group", id: "g2", title: "Later", collapsed: true, items: [] },
    { kind: "task", id: "t3", text: "make calls", target: 3, count: 1 },
    { kind: "task", id: "t4", text: "shopping", target: 1, count: 1 },
  ],
};

/**
 * Rows fade in via @starting-style, and scanning mid-transition reads blended
 * colours — reporting contrast failures that do not exist once settled. The
 * `test.use` above collapses the durations; this waits for the result to
 * actually land, and only looks at what is on screen (hidden dialogs sit at
 * opacity 0).
 */
const settled = async (page: Page): Promise<void> => {
  await expect
    .poll(() =>
      page.evaluate(() =>
        [...document.querySelectorAll(".task, .group, .drawer, .sheet, .rowmenu")]
          .filter((el) => el.checkVisibility())
          .every((el) => getComputedStyle(el).opacity === "1"),
      ),
    )
    .toBe(true);
};

const scan = async (page: Page) => {
  await settled(page);
  return new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
};

test.describe("no violations", () => {
  test("the list", async ({ page }) => {
    await seedStorage(page, A_DAY);
    const { violations } = await scan(page);
    expect(violations.map((v) => `${v.id}: ${String(v.nodes.length)}`)).toEqual([]);
  });

  test("the day card", async ({ page }) => {
    await seedStorage(page, A_DAY);
    await page.locator("#closeday").click();
    await expect(page.locator("#veil")).toBeVisible();

    const { violations } = await scan(page);
    expect(violations.map((v) => `${v.id}: ${String(v.nodes.length)}`)).toEqual([]);
  });

  test("the settings sheet", async ({ page }) => {
    await seedStorage(page, A_DAY);
    await page.locator("#databtn").click();
    await expect(page.locator(".drawer")).toBeVisible();

    const { violations } = await scan(page);
    expect(violations.map((v) => `${v.id}: ${String(v.nodes.length)}`)).toEqual([]);
  });

  test("an empty list", async ({ page }) => {
    await seedStorage(page, { v: 1, openedAt: null, list: [] });
    const { violations } = await scan(page);
    expect(violations.map((v) => `${v.id}: ${String(v.nodes.length)}`)).toEqual([]);
  });
});

test("the accessibility tree says what the screen says", async ({ page }) => {
  await seedStorage(page, A_DAY);

  // Locks roles, names and states. A row that stops being a checkbox, or loses
  // aria-checked, fails here rather than in someone's screen reader.
  await expect(page.locator("#list")).toMatchAriaSnapshot(`
    - list:
      - listitem:
        - button "Collapse Morning" [expanded]
        - text: Morning 1/2
        - button "Add to Morning": +
        - button "More for Morning": ⋯
        - button "Delete Morning"
        - list:
          - listitem:
            - checkbox "eat breakfast" [checked]
            - text: eat breakfast
            - button "More for eat breakfast": ⋯
            - button "Delete eat breakfast"
          - listitem:
            - checkbox "walk the dog"
            - text: walk the dog
            - button "More for walk the dog": ⋯
            - button "Delete walk the dog"
      - listitem:
        - button "Expand Later"
        - text: Later empty
        - button "Add to Later": +
        - button "More for Later": ⋯
        - button "Delete Later"
        - list
      - listitem:
        - spinbutton "make calls"
        - text: make calls [3]
        - 'button "make calls: one fewer"': 1/3
        - button "More for make calls": ⋯
        - button "Delete make calls"
      - listitem:
        - checkbox "shopping" [checked]
        - text: shopping
        - button "More for shopping": ⋯
        - button "Delete shopping"
  `);
});

test("the row menu is a menu, and axe agrees", async ({ page }) => {
  await seedStorage(page, A_DAY);
  await page.locator('.task:has-text("make calls") .dots').click();

  await expect(page.locator(".rowmenu")).toMatchAriaSnapshot(`
    - menu:
      - menuitem "Move up Alt+↑"
      - menuitem "Move down Alt+↓"
      - menuitem "Into “Later” Tab"
  `);

  const { violations } = await scan(page);
  expect(violations.map((v) => `${v.id}: ${String(v.nodes.length)}`)).toEqual([]);
});
