import type { Page } from "@playwright/test";

export const STORAGE_KEY = "t0d0/v1";

/**
 * Write the store, then reload so the app boots from it.
 *
 * Deliberately not `addInitScript`: that re-runs on every navigation, which
 * would silently reset the store during any test that reloads the page.
 */
async function boot(page: Page, raw: string): Promise<void> {
  await page.goto("/");
  await page.evaluate(
    ([key, value]) => {
      localStorage.setItem(key!, value!);
    },
    [STORAGE_KEY, raw],
  );
  await page.reload();
}

/** Start from an explicitly empty list rather than the first-run seed. */
export async function clearStorage(page: Page): Promise<void> {
  await boot(page, JSON.stringify({ v: 1, openedAt: null, list: [] }));
}

export async function seedStorage(page: Page, state: unknown): Promise<void> {
  await boot(page, JSON.stringify(state));
}

export async function seedRaw(page: Page, raw: string): Promise<void> {
  await boot(page, raw);
}

export async function addItem(page: Page, text: string): Promise<void> {
  await page.locator("#input").fill(text);
  await page.locator("#input").press("Enter");
}

/**
 * The list as it reads on screen: "# X" is a group, two leading spaces mean
 * nested. Reordering tests are about arrangement, so this lets them assert
 * before-and-after pictures rather than poke at individual rows.
 */
export const shape = (page: Page): Promise<string[]> =>
  page.evaluate(() =>
    [...document.querySelectorAll("#list > li")].flatMap((row) =>
      row.classList.contains("group")
        ? [
            `# ${row.querySelector(".gtitle")?.textContent ?? ""}`,
            ...[...row.querySelectorAll(".items > li")].map(
              (item) => `  ${item.querySelector(".label")?.textContent ?? ""}`,
            ),
          ]
        : [row.querySelector(".label")?.textContent ?? ""],
    ),
  );

/**
 * Wait for the list to stop moving before measuring it.
 *
 * Rows enter with a transform, so a box read too early is the row's animated
 * position rather than the one it settles at — and a drag aimed at a midpoint
 * then lands on the wrong side of it, depending on the machine.
 */
export const settle = (page: Page): Promise<unknown> =>
  page.evaluate(() =>
    Promise.all(document.getAnimations().map((a) => a.finished.catch(() => undefined))),
  );

/** A stored task whose id is its text, so a seeded list reads as its shape. */
export const task = (text: string) => ({ kind: "task", id: text, text, target: 1, count: 0 });
