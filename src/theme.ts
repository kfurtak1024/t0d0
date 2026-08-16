export const THEMES = ["system", "light", "dark"] as const;
export type Theme = (typeof THEMES)[number];

const KEY = "t0d0/theme";
const DEFAULT: Theme = "system";

const isTheme = (value: unknown): value is Theme =>
  typeof value === "string" && (THEMES as readonly string[]).includes(value);

/**
 * Theme preference, kept in its own storage key rather than inside the list.
 *
 * It is a property of this browser, not of your tasks — putting it in the list
 * would mean exporting it in a backup and importing someone else's choice.
 */
export function loadTheme(): Theme {
  try {
    const raw = localStorage.getItem(KEY);
    return isTheme(raw) ? raw : DEFAULT;
  } catch {
    return DEFAULT;
  }
}

export function applyTheme(theme: Theme): void {
  const root = document.documentElement;
  if (theme === "system") root.removeAttribute("data-theme");
  else root.setAttribute("data-theme", theme);

  // Keep the browser's own chrome in step with the app.
  const dark =
    theme === "dark" || (theme === "system" && matchMedia("(prefers-color-scheme: dark)").matches);
  for (const meta of document.querySelectorAll('meta[name="theme-color"]')) {
    meta.setAttribute("content", dark ? "#0e1116" : "#ebeff6");
    meta.removeAttribute("media");
  }
}

export function saveTheme(theme: Theme): void {
  try {
    localStorage.setItem(KEY, theme);
  } catch {
    /* preference is disposable; the list is what matters */
  }
  applyTheme(theme);
}

/** Re-apply on OS change, so "system" keeps meaning system. */
export function watchSystemTheme(current: () => Theme): void {
  matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => {
    if (current() === "system") applyTheme("system");
  });
}
