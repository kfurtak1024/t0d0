import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL: "http://localhost:4173",
    trace: "on-first-retry",
  },
  /*
   * WebKit runs without a service worker, on purpose.
   *
   * Playwright's bundled WebKit has no working service worker support — see the
   * note in tests/e2e/offline.spec.ts, which skips there for the same reason.
   * Left enabled, every `page.reload()` races the registration the app fires on
   * load, and the navigation occasionally dies with "WebKit encountered an
   * internal error". That is the harness, not the app, and it surfaces as a
   * flake in whichever test happens to lose the race.
   *
   * Blocking it costs no coverage: nothing outside the offline spec asserts
   * service worker behaviour, and that spec is Chromium-only already. Chromium
   * still exercises the real registration and the precache.
   */
  projects: [
    { name: "desktop-chromium", use: { ...devices["Desktop Chrome"] } },
    { name: "desktop-webkit", use: { ...devices["Desktop Safari"], serviceWorkers: "block" } },
    { name: "mobile-safari", use: { ...devices["iPhone 13"], serviceWorkers: "block" } },
  ],
  webServer: {
    command: "npm run build && npm run preview -- --port 4173 --strictPort",
    url: "http://localhost:4173",
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
