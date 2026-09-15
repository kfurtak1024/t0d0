import { expect, test } from "@playwright/test";
import { addItem, clearStorage } from "./helpers";

/**
 * "No network at runtime" is the second hard constraint, and the CSP meta tag is
 * what enforces it. Nothing was checking either half.
 *
 * Distinct from `offline.spec.ts`, which asks whether the app still works with
 * the network cut — a question about the service worker, and Chromium-only for
 * harness reasons. This asks whether the app ever wanted the network in the
 * first place, which every engine can answer.
 */

/*
 * The policy that ships, not the one the dev server serves.
 *
 * `relaxCspForDev` in vite.config.ts rewrites `style-src` to allow the inline
 * `<style>` tags Vite injects while serving, and `apply: "serve"` is the only
 * thing standing between that and the build. Playwright runs against
 * `npm run build`, so this is the real artefact — and a directive quietly
 * widened to admit a CDN, a font host or an analytics endpoint fails here
 * rather than at the first page load nobody was watching.
 *
 * The deploy workflow greps the served HTML for the header's *name*, which a
 * relaxed policy passes just as happily. This reads what it actually says.
 */
test("the policy that ships is the strict one", async ({ page }) => {
  await page.goto("/");

  const policy = await page
    .locator('meta[http-equiv="Content-Security-Policy"]')
    .getAttribute("content");

  expect(policy, "the app must ship a policy at all").not.toBeNull();
  // Nothing is allowed by default; every source below is an exception someone
  // wrote down, and all of them are 'self'.
  expect(policy).toContain("default-src 'none'");
  for (const directive of [
    "script-src 'self'",
    "style-src 'self'",
    "font-src 'self'",
    "connect-src 'self'",
    "manifest-src 'self'",
    "worker-src 'self'",
  ])
    expect(policy, directive).toContain(directive);

  // `img-src` is the one that takes more than 'self', and `data:` is the whole
  // of the extra — the icons are inline SVG, not a host.
  expect(policy).toContain("img-src 'self' data:");

  // No host anywhere, and nothing that would let an injected string run.
  expect(policy).not.toMatch(/https?:/);
  expect(policy).not.toContain("unsafe-inline");
  expect(policy).not.toContain("unsafe-eval");
});

/*
 * And the policy is a rule about what would be refused, which is not the same
 * as a claim that nothing is ever asked for. This is the claim: a whole
 * session — a list built, a row ticked, both dialogs opened — and every request
 * it makes is to the origin serving the app.
 */
test("nothing off-origin is ever asked for", async ({ page, baseURL }) => {
  const offsite: string[] = [];
  page.on("request", (request) => {
    if (!request.url().startsWith(baseURL ?? "")) offsite.push(request.url());
  });

  await clearStorage(page);
  await addItem(page, "# Morning");
  await addItem(page, "eat breakfast");
  await page.locator(".tick").first().click();

  await page.locator("#closeday").click();
  await expect(page.locator("#veil")).toBeVisible();
  await page.keyboard.press("Escape");

  await page.locator("#databtn").click();
  await expect(page.locator(".drawer")).toBeVisible();

  expect(offsite).toEqual([]);
});
