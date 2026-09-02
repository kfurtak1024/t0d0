// vitest/config re-exports Vite's defineConfig with the `test` block typed.
import { defineConfig } from "vitest/config";
import type { Plugin } from "vite";
import { VitePWA } from "vite-plugin-pwa";

/**
 * The dev server serves every stylesheet as an injected inline `<style>`, which
 * the shipped `style-src 'self'` correctly refuses — so without this the dev
 * server renders unstyled.
 *
 * Relax exactly that one directive, and only while serving. The policy in
 * index.html stays strict and is what actually ships; `apply: "serve"` makes it
 * impossible for this to leak into a build.
 */
function relaxCspForDev(): Plugin {
  return {
    name: "t0d0:dev-csp",
    apply: "serve",
    transformIndexHtml: {
      order: "pre",
      handler: (html) => html.replace("style-src 'self';", "style-src 'self' 'unsafe-inline';"),
    },
  };
}

export default defineConfig({
  // Served from the root of a custom domain, so no subpath prefix.
  base: "/",
  build: {
    target: "es2022",
    // The app has no runtime dependencies; a single chunk keeps the cold start honest.
    modulePreload: { polyfill: false },
  },
  plugins: [
    relaxCspForDev(),
    VitePWA({
      registerType: "autoUpdate",
      includeAssets: ["favicon.svg", "apple-touch-icon.png", "robots.txt"],
      manifest: {
        id: "/",
        name: "t0d0",
        short_name: "t0d0",
        description: "One list you prune each morning and tick through the day.",
        start_url: "/",
        scope: "/",
        display: "standalone",
        background_color: "#EBEFF6",
        theme_color: "#EBEFF6",
        orientation: "portrait-primary",
        icons: [
          { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
          { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
          { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
        ],
      },
      workbox: {
        globPatterns: ["**/*.{js,css,html,svg,png,webmanifest}"],
        cleanupOutdatedCaches: true,
        // Nothing is fetched at runtime, so there is nothing to route.
        navigateFallback: "/index.html",
      },
    }),
  ],
  test: {
    include: ["tests/**/*.test.ts"],
    // Node by default; DOM tests opt in with a `@vitest-environment` docblock.
    environment: "node",
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      /*
       * The excluded files are not untested — they are tested end to end by
       * Playwright, where a rendering layer is worth testing. Listing them here
       * keeps the percentage about the code Vitest is actually responsible for,
       * instead of a number diluted into meaninglessness.
       *
       * The exclusion is a claim, though, and it only holds for code that
       * genuinely needs a browser. A pure function that had drifted in here
       * went unmeasured for exactly that reason — see `src/words.ts`, which is
       * where the day's sentences live now. Anything decidable without a DOM
       * belongs outside these paths.
       */
      exclude: [
        "src/main.ts",
        "src/types.ts",
        "src/app.ts",
        "src/ui/**",
        "src/render/context.ts",
        "src/render/group.ts",
        "src/render/task.ts",
      ],
      /*
       * A ratchet, not a target: set a point or so under what the suite
       * actually reaches, so coverage lost is coverage noticed. Raise them
       * when the real number rises; lowering one is a decision to argue for.
       */
      thresholds: { lines: 99, functions: 98, branches: 94, statements: 97 },
    },
  },
});
