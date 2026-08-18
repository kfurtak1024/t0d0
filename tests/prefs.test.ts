/**
 * @vitest-environment jsdom
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULTS, loadPrefs, savePrefs } from "../src/prefs";

const KEY = "t0d0/prefs";

beforeEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});

describe("loadPrefs", () => {
  it("starts from the defaults, with folding on", () => {
    expect(loadPrefs()).toEqual(DEFAULTS);
    expect(DEFAULTS.autoCollapseDone).toBe(true);
  });

  it("reads back what was saved", () => {
    savePrefs({ autoCollapseDone: false });
    expect(loadPrefs().autoCollapseDone).toBe(false);
  });

  /*
   * A half-written or hand-edited value must not leave the app in a state the
   * settings screen cannot describe, so anything that is not a boolean falls
   * back to the default rather than to "off".
   */
  it.each([
    ["not json at all", "{"],
    ["a bare value", '"yes"'],
    ["null", "null"],
    ["the wrong type", '{"autoCollapseDone":"true"}'],
    ["a missing key", "{}"],
  ])("falls back to the default for %s", (_name, raw) => {
    localStorage.setItem(KEY, raw);
    expect(loadPrefs()).toEqual(DEFAULTS);
  });

  it("ignores keys it does not know", () => {
    localStorage.setItem(KEY, '{"autoCollapseDone":false,"pomodoro":true}');
    expect(loadPrefs()).toEqual({ autoCollapseDone: false });
  });

  it("survives storage that throws", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("denied");
    });
    expect(loadPrefs()).toEqual(DEFAULTS);
  });
});

describe("savePrefs", () => {
  it("swallows a storage failure — the list is what matters", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("full");
    });
    expect(() => {
      savePrefs({ autoCollapseDone: false });
    }).not.toThrow();
  });

  it("keeps preferences out of the list's own key", () => {
    savePrefs({ autoCollapseDone: false });
    expect(localStorage.getItem("t0d0/v1")).toBeNull();
  });
});
