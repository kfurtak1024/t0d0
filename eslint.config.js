import js from "@eslint/js";
import { defineConfig, globalIgnores } from "eslint/config";
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
