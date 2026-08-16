import { expect, test } from "@playwright/test";
import { addItem, clearStorage } from "./helpers";

/**
 * "Offline-first" is a claim on the front of the README. This is what defends
 * it: the service worker has to precache enough that a cold reload with the
 * network cut still renders the app and the list survives.
 */
test("the app still opens with the network off", async ({ page, context }) => {
  await clearStorage(page);
  await addItem(page, "# Morning");
  await addItem(page, "eat breakfast");
  await page.locator(".tick").first().click();

  // Wait for the worker to take control, not just to register.
  await expect
    .poll(
      async () =>
        page.evaluate(async () => {
          const registration = await navigator.serviceWorker.getRegistration();
          return registration?.active?.state ?? "none";
        }),
      { timeout: 15_000 },
    )
    .toBe("activated");

  await context.setOffline(true);
  const response = await page.reload();

  // Served from the cache, not the network.
  expect(response?.status()).toBe(200);
  await expect(page.locator("#input")).toBeVisible();
  await expect(page.locator(".group", { hasText: "Morning" })).toBeVisible();
  await expect(page.locator("#frac")).toHaveText("1 of 1");

  // And it is still a working app, not a frozen snapshot.
  await addItem(page, "added while offline");
  await expect(page.locator(".task", { hasText: "added while offline" })).toBeVisible();

  await context.setOffline(false);
});
