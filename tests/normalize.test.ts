import fc from "fast-check";
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

  it("replaces ids that would not survive being put in a selector", () => {
    // Ids are interpolated into `[data-id="…"]`, so a quote in one taken from an
    // imported backup makes querySelector throw and kills the drag outright.
    const hostile = ['a"b', "a]b", "a b", "a\\b", "", "x".repeat(65), "tab\tsep"];
    const state = normalize(
      wrap(hostile.map((id, i) => ({ kind: "task", id, text: `t${String(i)}` }))),
    );
    const ids = allTasks(state!.list).map((task) => task.id);

    expect(ids).toHaveLength(hostile.length);
    for (const id of ids) expect(id).toMatch(/^[A-Za-z0-9_-]{1,64}$/);
    // And a well-formed id is left exactly as it was.
    const kept = normalize(wrap([{ kind: "task", id: "keep-me_1", text: "a" }]));
    expect(allTasks(kept!.list)[0]?.id).toBe("keep-me_1");
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

  it("coerces important to a boolean on both kinds, defaulting to false", () => {
    // Lists written before the mark existed carry no field at all, and must not
    // come back flagged — which is also why the schema version does not move.
    const state = normalize(
      wrap([
        { kind: "task", text: "old" },
        { kind: "task", text: "yes", important: true },
        { kind: "task", text: "truthy", important: 1 },
        { kind: "group", title: "G", items: [], important: "yes" },
        { kind: "group", title: "H", items: [], important: true },
      ]),
    );
    expect(state?.list.map((node) => node.important)).toEqual([false, true, false, false, true]);
  });

  it("coerces once to a boolean on tasks, defaulting to false", () => {
    // Same reasoning as the mark above: a list written before one-offs existed
    // has no field, and must not load with items primed to be deleted tonight.
    const state = normalize(
      wrap([
        { kind: "task", text: "old" },
        { kind: "task", text: "yes", once: true },
        { kind: "task", text: "truthy", once: 1 },
        { kind: "group", title: "G", items: [{ kind: "task", text: "nested", once: true }] },
      ]),
    );
    expect(allTasks(state?.list ?? []).map((task) => task.once)).toEqual([
      false,
      true,
      false,
      true,
    ]);
  });

  it("does not put a mark on a task whose text merely ends in a sigil", () => {
    // normalize repairs structure, not spelling. "Sale!" is a name someone
    // chose, and flipping a flag on an imported list nobody asked it to change
    // would be a surprise rather than a repair — see the parse spec.
    const state = normalize(
      wrap([
        { kind: "task", text: "Sale!" },
        { kind: "task", text: "hm~" },
      ]),
    );
    expect(state?.list.map((node) => node.kind === "task" && node.important)).toEqual([
      false,
      false,
    ]);
    expect(state?.list.map((node) => node.kind === "task" && node.once)).toEqual([false, false]);
  });

  /*
   * A group's mark is derived from its items, so a backup that disagrees with
   * itself is repaired on the way in. Left alone, it would survive until some
   * unrelated edit ran the derivation and took the mark off a group nobody had
   * touched.
   */
  it("settles a group whose mark disagrees with its items", () => {
    const state = normalize(
      wrap([
        {
          kind: "group",
          title: "Claims to be important",
          important: true,
          items: [
            { kind: "task", text: "marked", important: true },
            { kind: "task", text: "plain" },
          ],
        },
        {
          kind: "group",
          title: "Does not, but is",
          important: false,
          items: [
            { kind: "task", text: "a", important: true },
            { kind: "task", text: "b", important: true },
          ],
        },
        // Nothing to read a mark from, so an empty group keeps the one it has.
        { kind: "group", title: "Empty", important: true, items: [] },
      ]),
    );

    expect(state?.list.map((node) => node.important)).toEqual([false, true, true]);
  });

  it("truncates oversized text instead of rejecting the item", () => {
    const state = normalize(wrap([{ kind: "task", text: "x".repeat(1000) }]));
    expect((state?.list[0] as { text: string }).text).toHaveLength(200);
  });
});

/*
 * normalize()'s whole job is surviving input it did not produce, so hand-picked
 * shapes only get us so far. These three properties hold for anything at all.
 */
describe("properties over arbitrary input", () => {
  const anyJson = fc.jsonValue();

  /** What an id has to look like to be safe inside `[data-id="…"]`. */
  const SAFE_ID = /^[A-Za-z0-9_-]{1,64}$/;

  /*
   * Deliberately takes `unknown` and re-checks everything the types promise.
   * Typing it as State would let TypeScript "prove" the assertions away, and
   * the point is to verify the runtime shape, not to trust the declaration.
   */
  const structurallyValid = (value: unknown): boolean => {
    const isRecord = (v: unknown): v is Record<string, unknown> =>
      typeof v === "object" && v !== null;
    if (!isRecord(value)) return false;
    if (value["v"] !== 1) return false;
    const openedAt = value["openedAt"];
    if (openedAt !== null && !Number.isFinite(openedAt)) return false;
    if (!Array.isArray(value["list"])) return false;

    const ids = new Set<string>();
    const okTask = (task: unknown): boolean => {
      if (!isRecord(task) || task["kind"] !== "task") return false;
      const text = task["text"];
      if (typeof text !== "string" || text.length === 0 || text.length > 200) return false;
      const target = task["target"];
      const count = task["count"];
      if (typeof target !== "number" || !Number.isInteger(target)) return false;
      if (target < 1 || target > 99) return false;
      if (typeof count !== "number" || !Number.isInteger(count)) return false;
      if (count < 0 || count > target) return false;
      const id = task["id"];
      if (typeof id !== "string" || ids.has(id) || !SAFE_ID.test(id)) return false;
      if (typeof task["important"] !== "boolean") return false;
      ids.add(id);
      return true;
    };

    for (const node of value["list"] as unknown[]) {
      if (!isRecord(node)) return false;
      if (node["kind"] === "group") {
        const title = node["title"];
        const id = node["id"];
        if (typeof title !== "string" || title.length === 0) return false;
        if (typeof id !== "string" || ids.has(id) || !SAFE_ID.test(id)) return false;
        ids.add(id);
        if (typeof node["collapsed"] !== "boolean") return false;
        if (typeof node["important"] !== "boolean") return false;
        if (!Array.isArray(node["items"]) || !(node["items"] as unknown[]).every(okTask)) {
          return false;
        }
      } else if (!okTask(node)) {
        return false;
      }
    }
    return true;
  };

  it("never throws, whatever it is handed", () => {
    fc.assert(
      fc.property(anyJson, (value) => {
        normalize(value);
      }),
      { numRuns: 500 },
    );
  });

  it("returns either null or a state that satisfies every invariant", () => {
    fc.assert(
      fc.property(anyJson, (value) => {
        const result = normalize(value);
        return result === null || structurallyValid(result);
      }),
      { numRuns: 500 },
    );
  });

  it("is idempotent — repairing a repaired state changes nothing", () => {
    fc.assert(
      fc.property(anyJson, (value) => {
        const once = normalize(value);
        if (once === null) return true;
        return JSON.stringify(normalize(once)) === JSON.stringify(once);
      }),
      { numRuns: 500 },
    );
  });

  it("keeps everything usable out of a plausible list", () => {
    const task = fc.record({
      kind: fc.constant("task"),
      id: fc.string({ minLength: 1, maxLength: 8 }),
      text: fc.string({ minLength: 1, maxLength: 30 }).filter((t) => t.trim().length > 0),
      target: fc.integer({ min: -5, max: 200 }),
      count: fc.integer({ min: -5, max: 200 }),
    });
    fc.assert(
      fc.property(fc.array(task, { maxLength: 12 }), (tasks) => {
        const result = normalize({ v: 1, openedAt: null, list: tasks });
        return result !== null && result.list.length === tasks.length;
      }),
      { numRuns: 200 },
    );
  });
});
