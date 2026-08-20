const KEY = "t0d0/prefs";

export interface Prefs {
  /**
   * Send finished rows down below the work that is left — folding a group shut
   * on the way, which is all this used to do and where the name comes from.
   * Renaming it would read as unset and quietly turn itself back on for anyone
   * who had switched it off, which is a poor trade for a tidier identifier.
   */
  autoCollapseDone: boolean;
}

export const DEFAULTS: Prefs = {
  autoCollapseDone: true,
};

/**
 * How this browser behaves, kept out of the list for the same reason the theme
 * is: preferences are a property of the device you are standing at, not of your
 * tasks. Folding them into `State` would export them in a backup and impose
 * them on whoever imported it.
 *
 * Unknown and malformed keys fall back to the default rather than disabling the
 * feature, so a half-written value can never leave the app in a shape the
 * settings screen cannot describe.
 */
export function loadPrefs(): Prefs {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(KEY) ?? "");
    if (typeof raw !== "object" || raw === null) return { ...DEFAULTS };
    const stored = raw as Record<string, unknown>;
    return {
      autoCollapseDone:
        typeof stored["autoCollapseDone"] === "boolean"
          ? stored["autoCollapseDone"]
          : DEFAULTS.autoCollapseDone,
    };
  } catch {
    return { ...DEFAULTS };
  }
}

export function savePrefs(prefs: Prefs): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(prefs));
  } catch {
    /* preferences are disposable; the list is what matters */
  }
}
