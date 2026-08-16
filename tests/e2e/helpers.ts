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
