/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { load, onExternalChange, save, STORAGE_KEY } from "../src/storage";
import type { State } from "../src/types";

const state = (text = "shopping"): State => ({
  v: 1,
  openedAt: null,
  list: [{ kind: "task", id: "a", text, target: 1, count: 0 }],
});

const breakStorage = (): void => {
  const boom = (): never => {
    throw new DOMException("blocked", "SecurityError");
  };
  vi.spyOn(Storage.prototype, "setItem").mockImplementation(boom);
  vi.spyOn(Storage.prototype, "getItem").mockImplementation(boom);
};

beforeEach(() => {
  localStorage.clear();
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe("save", () => {
  it("writes and reports success", () => {
    expect(save(state())).toBe(true);
    expect(localStorage.getItem(STORAGE_KEY)).toContain("shopping");
  });

  it("reports failure for as long as storage is unavailable", () => {
    breakStorage();
    // The old version returned true from the second failure onward, which said
    // "saved" about a write that had not saved.
    expect(save(state("one"))).toBe(false);
    expect(save(state("two"))).toBe(false);
    expect(save(state("three"))).toBe(false);
  });

  it("keeps the session usable through an in-memory fallback", () => {
    breakStorage();
    save(state("only in memory"));

    const back = load();
    expect(back?.list).toHaveLength(1);
    expect((back?.list[0] as { text: string }).text).toBe("only in memory");
  });
});

describe("load", () => {
  it("returns null when nothing has been stored", () => {
    expect(load()).toBeNull();
  });

  it("returns null rather than throwing on corrupt JSON", () => {
    localStorage.setItem(STORAGE_KEY, "{ not json");
    expect(load()).toBeNull();
  });

  it("returns null for JSON that is not a t0d0 state", () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ hello: "world" }));
    expect(load()).toBeNull();
  });

  it("repairs damaged values on the way in", () => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        v: 1,
        openedAt: null,
        list: [{ kind: "task", id: "a", text: "calls", target: 3, count: 99 }],
      }),
    );

    expect(load()?.list[0]).toMatchObject({ target: 3, count: 3 });
  });

  it("round-trips a saved state", () => {
    save(state("there and back"));
    expect((load()?.list[0] as { text: string }).text).toBe("there and back");
  });
});

describe("onExternalChange", () => {
  it("reports another tab's write", () => {
    const seen: State[] = [];
    onExternalChange((next) => seen.push(next));

    const written = JSON.stringify({
      v: 1,
      openedAt: null,
      list: [{ kind: "task", id: "a", text: "from another tab", target: 1, count: 0 }],
    });
    localStorage.setItem(STORAGE_KEY, written);
    dispatchEvent(new StorageEvent("storage", { key: STORAGE_KEY, newValue: written }));

    expect(seen).toHaveLength(1);
    expect((seen[0]?.list[0] as { text: string }).text).toBe("from another tab");
  });

  it("ignores writes to other keys", () => {
    const seen: State[] = [];
    onExternalChange((next) => seen.push(next));
    dispatchEvent(new StorageEvent("storage", { key: "something-else", newValue: "{}" }));
    expect(seen).toHaveLength(0);
  });

  it("ignores a change that leaves the store unreadable", () => {
    const seen: State[] = [];
    onExternalChange((next) => seen.push(next));

    localStorage.setItem(STORAGE_KEY, "{ broken");
    dispatchEvent(new StorageEvent("storage", { key: STORAGE_KEY, newValue: "{ broken" }));

    expect(seen).toHaveLength(0);
  });
});
