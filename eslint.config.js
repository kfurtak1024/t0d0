import js from "@eslint/js";
import { defineConfig, globalIgnores } from "eslint/config";
import playwright from "eslint-plugin-playwright";
import tseslint from "typescript-eslint";

export default defineConfig([
  globalIgnores(["dist/**", "dev-dist/**", "coverage/**", "playwright-report/**"]),
  js.configs.recommended,
  tseslint.configs.strictTypeChecked,
  {
    files: ["**/*.ts"],
    languageOptions: {
      parserOptions: {
        projectService: { allowDefaultProject: ["eslint.config.js"] },
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      "@typescript-eslint/no-non-null-assertion": "error",
      "@typescript-eslint/consistent-type-imports": "error",
      "no-console": ["warn", { allow: ["warn", "error"] }],
      eqeqeq: ["error", "smart"],
    },
  },
  {
    files: ["tests/**/*.ts"],
    rules: { "@typescript-eslint/no-non-null-assertion": "off" },
  },
  {
    files: ["tests/e2e/**/*.ts"],
    ...playwright.configs["flat/recommended"],
    rules: {
      ...playwright.configs["flat/recommended"].rules,
      // A held clock is advanced, never waited on: see tests/e2e/fixtures.ts.
      "playwright/no-wait-for-timeout": "error",
      // Every `if` in these specs is a null guard that throws, there to narrow a
      // type — not a test taking a different path, which is what this is for.
      "playwright/no-conditional-in-test": "off",
      // A skip that names its engine and its reason is a decision, not a stray.
      "playwright/no-skipped-test": ["warn", { allowConditional: true }],
    },
  },
  {
    /*
     * Every spec takes `test` from the fixture, which holds the page's clock.
     * Imported from Playwright directly, a spec silently runs on real time and
     * races the app's timers again — the failure this whole setup exists to
     * make impossible, and one nothing else would notice.
     */
    files: ["tests/e2e/**/*.spec.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "@playwright/test",
              importNames: ["test", "expect"],
              message: "Import test and expect from ./fixtures, which holds the page's clock.",
            },
          ],
        },
      ],
    },
  },
  {
    /*
     * Build-time Node scripts, with no type information to hang rules off. They
     * also contain page.evaluate callbacks, which run in the browser — hence
     * both sets of globals in one place.
     */
    files: ["scripts/**/*.mjs", "eslint.config.js"],
    extends: [tseslint.configs.disableTypeChecked],
    languageOptions: {
      globals: {
        console: "readonly",
        Buffer: "readonly",
        process: "readonly",
        fetch: "readonly",
        setTimeout: "readonly",
        document: "readonly",
        localStorage: "readonly",
        getComputedStyle: "readonly",
      },
    },
    rules: { "no-console": "off" },
  },
]);
