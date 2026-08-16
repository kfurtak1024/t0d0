import { describe, expect, it } from "vitest";
import { normalize } from "../src/normalize";
import { allTasks } from "../src/progress";

const wrap = (list: unknown[], extra: Record<string, unknown> = {}): unknown => ({
  v: 1,
  openedAt: null,
  list,
  ...extra,
});

describe("normalize", () => {
  it("rejects anything that isn't a versioned list", () => {
    expect(normalize(null)).toBeNull();
    expect(normalize("nope")).toBeNull();
    expect(normalize({})).toBeNull();
    expect(normalize({ v: 2, list: [] })).toBeNull();
    expect(normalize({ v: 1, list: "not an array" })).toBeNull();
  });

  it("accepts an empty list", () => {
    expect(normalize(wrap([]))).toEqual({ v: 1, openedAt: null, list: [] });
  });

  it("clamps target and count into range", () => {
    const state = normalize(wrap([{ kind: "task", text: "a", target: 500, count: -3 }]));
    expect(state?.list[0]).toMatchObject({ target: 99, count: 0 });
  });

  it("clamps a count that exceeds its target", () => {
    const state = normalize(wrap([{ kind: "task", text: "a", target: 3, count: 99 }]));
    expect(state?.list[0]).toMatchObject({ target: 3, count: 3 });
  });

  it("defaults missing numbers rather than producing NaN", () => {
    const state = normalize(wrap([{ kind: "task", text: "a" }]));
    expect(state?.list[0]).toMatchObject({ target: 1, count: 0 });
  });

  it("drops items with no usable text", () => {
    const state = normalize(wrap([{ kind: "task", text: "   " }, { kind: "task" }, 42, null]));
    expect(state?.list).toEqual([]);
  });

  it("drops groups with no title but keeps their shape otherwise", () => {
    const state = normalize(
      wrap([
        { kind: "group", title: "", items: [] },
        { kind: "group", title: "Ok", items: [] },
      ]),
    );
    expect(state?.list).toHaveLength(1);
    expect(state?.list[0]).toMatchObject({ kind: "group", title: "Ok", collapsed: false });
  });

  it("regenerates duplicate ids so rows cannot share a DOM node", () => {
    const state = normalize(
      wrap([
        { kind: "task", id: "same", text: "a" },
        { kind: "task", id: "same", text: "b" },
        { kind: "group", id: "same", title: "G", items: [{ kind: "task", id: "same", text: "c" }] },
      ]),
    );
    const ids = [
      ...state!.list.filter((node) => node.kind === "group").map((node) => node.id),
      ...allTasks(state!.list).map((task) => task.id),
    ];
    expect(ids).toHaveLength(4);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("keeps a group's items and coerces collapsed to a boolean", () => {
    const state = normalize(
      wrap([
        {
          kind: "group",
          title: "Morning",
          collapsed: "yes",
          items: [{ kind: "task", text: "a" }, "junk"],
        },
      ]),
    );
    expect(state?.list[0]).toMatchObject({ collapsed: false });
    expect(allTasks(state!.list)).toHaveLength(1);
  });

  it("keeps a finite openedAt and discards anything else", () => {
    expect(normalize(wrap([], { openedAt: 1234 }))?.openedAt).toBe(1234);
    expect(normalize(wrap([], { openedAt: "soon" }))?.openedAt).toBeNull();
    expect(normalize(wrap([], { openedAt: Number.NaN }))?.openedAt).toBeNull();
  });

  it("truncates oversized text instead of rejecting the item", () => {
    const state = normalize(wrap([{ kind: "task", text: "x".repeat(1000) }]));
    expect((state?.list[0] as { text: string }).text).toHaveLength(200);
  });
});
