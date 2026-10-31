import { expect, test } from "./fixtures";
import { addItem, clearStorage, groupOf, rowOf } from "./helpers";

/**
 * "Offline-first" is a claim on the front of the README. This is what defends
 * it: the service worker has to precache enough that a cold reload with the
 * network cut still renders the app and the list survives.
 *
 * Chromium and Firefox, not WebKit. Playwright's bundled WebKit has no service
 * worker support, so `getRegistration()` resolves to undefined and an offline
 * reload fails inside the browser ("WebKit encountered an internal error"). That
 * is a limitation of the test harness, not of the app — real Safari has
 * supported service workers for years, and the precache manifest is
 * engine-independent, so two engines verifying it tell us what we need to know.
 */
test.skip(
  ({ browserName }) => browserName === "webkit",
  "Playwright's WebKit build has no service worker support",
);

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
  await expect(groupOf(page, "Morning")).toBeVisible();
  await expect(page.locator("#frac")).toHaveText("1 of 1");

  // And it is still a working app, not a frozen snapshot.
  await addItem(page, "added while offline");
  await expect(rowOf(page, "added while offline")).toBeVisible();

  await context.setOffline(false);
});
