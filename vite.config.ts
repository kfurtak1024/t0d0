// vitest/config re-exports Vite's defineConfig with the `test` block typed.
import { defineConfig } from "vitest/config";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  // Served from the root of a custom domain, so no subpath prefix.
  base: "/",
  build: {
    target: "es2022",
    // The app has no runtime dependencies; a single chunk keeps the cold start honest.
    modulePreload: { polyfill: false },
  },
  plugins: [
    VitePWA({
      registerType: "autoUpdate",
      includeAssets: ["favicon.svg", "apple-touch-icon.png", "robots.txt"],
      manifest: {
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
      include: ["src/parse.ts", "src/progress.ts", "src/normalize.ts", "src/transitions.ts"],
      thresholds: { lines: 95, functions: 95, branches: 90, statements: 95 },
    },
  },
});
