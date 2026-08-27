/**
 * @vitest-environment jsdom
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Store } from "../src/store";
import { STORAGE_KEY } from "../src/storage";
import type { State } from "../src/types";

const state = (text: string, count = 0): State => ({
  v: 1,
  openedAt: null,
  list: [{ kind: "task", id: "a", text, target: 1, count, important: false }],
});

beforeEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});

describe("apply", () => {
  it("swaps the state and notifies", () => {
    const store = new Store(state("before"));
    const seen: string[] = [];
    store.subscribe(() => {
      seen.push((store.state.list[0] as { text: string }).text);
    });

    store.apply(state("after"));
    expect(seen).toEqual(["after"]);
  });

  it("ignores a no-op transition so nothing re-renders", () => {
    const initial = state("same");
    const store = new Store(initial);
    const listener = vi.fn();
    store.subscribe(listener);

    store.apply(initial);
    expect(listener).not.toHaveBeenCalled();
  });

  it("persists on every change", () => {
    const store = new Store(state("one"));
    store.apply(state("two"));

    const raw = localStorage.getItem(STORAGE_KEY);
    expect(raw).toContain("two");
  });
});

describe("undo", () => {
  it("does nothing when there is nothing to undo", () => {
    const store = new Store(state("only"));
    expect(store.undo()).toBe(false);
  });

  it("restores the previous state for an undoable change", () => {
    const store = new Store(state("before"));
    store.apply(state("after"), { undoable: true });

    expect(store.undo()).toBe(true);
    expect((store.state.list[0] as { text: string }).text).toBe("before");
  });

  it("skips changes that were not marked undoable", () => {
    const store = new Store(state("before"));
    store.apply(state("after"));
    expect(store.undo()).toBe(false);
  });

  /*
   * A drag applies a run of cheap steps that are one gesture to the person
   * making it. Marking each undoable would spend the slot on the last
   * millimetre of the drag.
   */
  it("lets a caller nominate where a run of changes should undo to", () => {
    const store = new Store(state("start"));
    const before = store.state;

    store.apply(state("step one"));
    store.apply(state("step two"));
    expect(store.undo()).toBe(false);

    store.stageUndo(before);
    expect(store.undo()).toBe(true);
    expect((store.state.list[0] as { text: string }).text).toBe("start");
    // And still exactly one level: the staged point is spent, not a history.
    expect(store.undo()).toBe(false);
  });

  it("is exactly one level deep — undo cannot walk back a history", () => {
    const store = new Store(state("one"));
    store.apply(state("two"), { undoable: true });
    store.apply(state("three"), { undoable: true });

    expect(store.undo()).toBe(true);
    expect((store.state.list[0] as { text: string }).text).toBe("two");
    expect(store.undo()).toBe(false);
  });

  it("writes the restored state back to storage", () => {
    const store = new Store(state("before"));
    store.apply(state("after"), { undoable: true });
    store.undo();

    expect(localStorage.getItem(STORAGE_KEY)).toContain("before");
  });

  it("covers a replace when asked to", () => {
    const store = new Store(state("mine"));
    store.replace(state("imported"), { undoable: true });

    expect(store.undo()).toBe(true);
    expect((store.state.list[0] as { text: string }).text).toBe("mine");
  });
});

describe("subscribe", () => {
  it("stops notifying once unsubscribed", () => {
    const store = new Store(state("one"));
    const listener = vi.fn();
    const off = store.subscribe(listener);

    store.apply(state("two"));
    off();
    store.apply(state("three"));

    expect(listener).toHaveBeenCalledTimes(1);
  });
});

describe("persistence reporting", () => {
  it("reports success", () => {
    const store = new Store(state("one"));
    const persisted = vi.fn();
    store.onPersist(persisted);

    store.apply(state("two"));
    expect(persisted).toHaveBeenCalledWith(true);
  });

  it("reports failure honestly on every failed write, not just the first", () => {
    const store = new Store(state("one"));
    const persisted = vi.fn();
    store.onPersist(persisted);

    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("full", "QuotaExceededError");
    });

    store.apply(state("two"));
    store.apply(state("three"));

    // Warn-once is a UI policy; the store must not lie about what happened.
    expect(persisted).toHaveBeenNthCalledWith(1, false);
    expect(persisted).toHaveBeenNthCalledWith(2, false);
  });
});
