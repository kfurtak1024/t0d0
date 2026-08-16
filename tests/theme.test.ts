/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { applyTheme, loadTheme, saveTheme, THEMES, watchSystemTheme } from "../src/theme";

const themeColors = (): string[] =>
  [...document.querySelectorAll('meta[name="theme-color"]')].map(
    (meta) => meta.getAttribute("content") ?? "",
  );

beforeEach(() => {
  localStorage.clear();
  document.documentElement.removeAttribute("data-theme");
  document.head.replaceChildren();
  for (const scheme of ["light", "dark"]) {
    const meta = document.createElement("meta");
    meta.setAttribute("name", "theme-color");
    meta.setAttribute("media", `(prefers-color-scheme: ${scheme})`);
    document.head.append(meta);
  }
  // jsdom has no media engine; report "light OS" unless a test says otherwise.
  vi.stubGlobal(
    "matchMedia",
    vi.fn(() => ({ matches: false, addEventListener: vi.fn() })),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("loadTheme", () => {
  it("defaults to following the system", () => {
    expect(loadTheme()).toBe("system");
  });

  it("ignores a stored value that is not a theme", () => {
    localStorage.setItem("t0d0/theme", "neon");
    expect(loadTheme()).toBe("system");
  });

  it("survives storage being unavailable", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new DOMException("blocked", "SecurityError");
    });
    expect(loadTheme()).toBe("system");
  });
});

describe("applyTheme", () => {
  it("stamps the root for an explicit choice", () => {
    applyTheme("dark");
    expect(document.documentElement.getAttribute("data-theme")).toBe("dark");

    applyTheme("light");
    expect(document.documentElement.getAttribute("data-theme")).toBe("light");
  });

  it("leaves the root unstamped for system, so prefers-color-scheme decides", () => {
    applyTheme("dark");
    applyTheme("system");
    expect(document.documentElement.hasAttribute("data-theme")).toBe(false);
  });

  it("points the browser chrome at the chosen theme", () => {
    applyTheme("dark");
    expect(themeColors()).toEqual(["#0e1116", "#0e1116"]);

    applyTheme("light");
    expect(themeColors()).toEqual(["#ebeff6", "#ebeff6"]);
  });

  it("drops the media conditions once a choice overrides the system", () => {
    applyTheme("dark");
    const withMedia = [...document.querySelectorAll('meta[name="theme-color"]')].filter((meta) =>
      meta.hasAttribute("media"),
    );
    expect(withMedia).toHaveLength(0);
  });

  it("follows the system when set to system", () => {
    vi.stubGlobal(
      "matchMedia",
      vi.fn(() => ({ matches: true, addEventListener: vi.fn() })),
    );
    applyTheme("system");
    expect(themeColors()).toEqual(["#0e1116", "#0e1116"]);
  });
});

describe("saveTheme", () => {
  it("persists and applies in one step", () => {
    saveTheme("dark");
    expect(localStorage.getItem("t0d0/theme")).toBe("dark");
    expect(loadTheme()).toBe("dark");
    expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
  });

  it("still applies when the preference cannot be stored", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("blocked", "SecurityError");
    });
    expect(() => {
      saveTheme("dark");
    }).not.toThrow();
    expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
  });

  it("handles every theme it advertises", () => {
    for (const theme of THEMES) {
      saveTheme(theme);
      expect(loadTheme()).toBe(theme);
    }
  });
});

describe("watchSystemTheme", () => {
  it("re-applies when the OS flips and the choice is system", () => {
    let fire: (() => void) | undefined;
    vi.stubGlobal(
      "matchMedia",
      vi.fn(() => ({
        matches: true,
        addEventListener: (_: string, handler: () => void) => {
          fire = handler;
        },
      })),
    );

    watchSystemTheme(() => "system");
    fire?.();
    expect(themeColors()).toEqual(["#0e1116", "#0e1116"]);
  });

  it("leaves an explicit choice alone when the OS flips", () => {
    let fire: (() => void) | undefined;
    vi.stubGlobal(
      "matchMedia",
      vi.fn(() => ({
        matches: true,
        addEventListener: (_: string, handler: () => void) => {
          fire = handler;
        },
      })),
    );

    applyTheme("light");
    watchSystemTheme(() => "light");
    fire?.();

    expect(document.documentElement.getAttribute("data-theme")).toBe("light");
    expect(themeColors()).toEqual(["#ebeff6", "#ebeff6"]);
  });
});
