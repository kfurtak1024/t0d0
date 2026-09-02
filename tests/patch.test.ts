/**
 * @vitest-environment jsdom
 */
import { beforeEach, describe, expect, it } from "vitest";
import { KeyedList, type Keyed } from "../src/render/list";

interface Row {
  id: string;
  text: string;
}

let container: HTMLElement;
let created: number;

const create = (row: Row): Keyed<Row> => {
  created++;
  const element = document.createElement("div");
  element.dataset["id"] = row.id;
  const input = document.createElement("input");
  element.append(input);
  return {
    key: row.id,
    element,
    update: (next) => {
      element.dataset["text"] = next.text;
    },
  };
};

const ids = (): string[] =>
  [...container.children].map((child) => child.getAttribute("data-id") ?? "");

beforeEach(() => {
  document.body.replaceChildren();
  container = document.createElement("div");
  document.body.append(container);
  created = 0;
});

describe("KeyedList", () => {
  it("creates one element per row", () => {
    new KeyedList(container, create).patch([
      { id: "a", text: "A" },
      { id: "b", text: "B" },
    ]);
    expect(ids()).toEqual(["a", "b"]);
    expect(created).toBe(2);
  });

  it("reuses elements across updates rather than rebuilding them", () => {
    const list = new KeyedList(container, create);
    list.patch([{ id: "a", text: "A" }]);
    const first = container.firstElementChild;

    list.patch([{ id: "a", text: "changed" }]);
    expect(container.firstElementChild).toBe(first);
    expect(created).toBe(1);
    expect(first?.getAttribute("data-text")).toBe("changed");
  });

  it("keeps focus through an update — the whole reason this class exists", () => {
    const list = new KeyedList(container, create);
    list.patch([{ id: "a", text: "A" }]);

    const input = container.querySelector("input")!;
    input.focus();
    expect(document.activeElement).toBe(input);

    list.patch([{ id: "a", text: "still here" }]);
    expect(document.activeElement).toBe(input);
  });

  it("moves existing nodes instead of recreating them when order changes", () => {
    const list = new KeyedList(container, create);
    list.patch([
      { id: "a", text: "A" },
      { id: "b", text: "B" },
    ]);
    const a = container.firstElementChild;

    list.patch([
      { id: "b", text: "B" },
      { id: "a", text: "A" },
    ]);
    expect(ids()).toEqual(["b", "a"]);
    expect(container.lastElementChild).toBe(a);
    expect(created).toBe(2);
  });

  it("inserts into the middle without disturbing its neighbours", () => {
    const list = new KeyedList(container, create);
    list.patch([
      { id: "a", text: "A" },
      { id: "c", text: "C" },
    ]);
    const a = container.firstElementChild;
    const c = container.lastElementChild;

    list.patch([
      { id: "a", text: "A" },
      { id: "b", text: "B" },
      { id: "c", text: "C" },
    ]);
    expect(ids()).toEqual(["a", "b", "c"]);
    expect(container.firstElementChild).toBe(a);
    expect(container.lastElementChild).toBe(c);
  });

  it("removes departed rows and forgets them", () => {
    const list = new KeyedList(container, create);
    list.patch([
      { id: "a", text: "A" },
      { id: "b", text: "B" },
    ]);
    list.patch([{ id: "b", text: "B" }]);

    expect(ids()).toEqual(["b"]);
    expect(list.get("a")).toBeUndefined();
  });

  it("rebuilds a row that comes back after being removed", () => {
    const list = new KeyedList(container, create);
    list.patch([{ id: "a", text: "A" }]);
    list.patch([]);
    list.patch([{ id: "a", text: "A" }]);

    expect(ids()).toEqual(["a"]);
    expect(created).toBe(2);
  });

  it("empties completely on clear", () => {
    const list = new KeyedList(container, create);
    list.patch([{ id: "a", text: "A" }]);
    list.clear();

    expect(container.children).toHaveLength(0);
    expect(list.get("a")).toBeUndefined();
  });
});

/**
 * One list drawn across two containers: the day's work above the ending, the
 * pile of finished rows below it.
 *
 * The reason this is a patch and not two lists is node identity — a row that
 * crosses between them has to keep its element, or FLIP has nothing to carry
 * over and any transition it was in the middle of is cancelled.
 */
describe("patching across two containers", () => {
  let work: HTMLElement;
  let pile: HTMLElement;
  let split: KeyedList<Row>;

  const shape = (): string[][] =>
    [work, pile].map((box) =>
      [...box.children].map((el) => (el as HTMLElement).dataset["id"] ?? ""),
    );

  beforeEach(() => {
    // Attached, because focus does not land on a detached tree — and focus
    // surviving a crossing is one of the things being asserted here.
    document.body.replaceChildren();
    work = document.createElement("div");
    pile = document.createElement("div");
    document.body.append(work, pile);
    created = 0;
    split = new KeyedList<Row>([work, pile], create);
  });

  const rows = (...ids: string[]): Row[] => ids.map((id) => ({ id, text: id }));

  it("sends everything to the first container when nothing is split off", () => {
    split.patch(rows("a", "b", "c"));
    expect(shape()).toEqual([["a", "b", "c"], []]);
  });

  it("draws the tail into the second container", () => {
    split.patch(rows("a", "b", "c", "d"), 2);
    expect(shape()).toEqual([
      ["a", "b"],
      ["c", "d"],
    ]);
  });

  /* The whole reason for one patch rather than two lists. */
  it("keeps a row's element when it crosses between containers", () => {
    split.patch(rows("a", "b", "c"), 3);
    const travelling = work.children[2] as HTMLElement;
    const madeSoFar = created;

    split.patch(rows("a", "b", "c"), 2);

    expect(shape()).toEqual([["a", "b"], ["c"]]);
    expect(pile.children[0]).toBe(travelling);
    expect(created).toBe(madeSoFar);
  });

  /*
   * Identity, not focus. Moving a node to another parent is a removal and an
   * insertion, and a browser blurs what it removes — so focus is not something
   * a crossing can promise. What it does promise is the same element, which is
   * what FLIP needs to carry the row over and what stops the row being rebuilt
   * from scratch mid-tick.
   */
  it("keeps the row's own children through a crossing", () => {
    split.patch(rows("a", "b"), 2);
    const input = (work.children[1] as HTMLElement).querySelector("input");

    split.patch(rows("a", "b"), 1);
    expect(pile.children[0]?.contains(input as Node)).toBe(true);
  });

  it("carries a row back the other way", () => {
    split.patch(rows("a", "b", "c"), 1);
    const returning = pile.children[1] as HTMLElement;

    split.patch(rows("a", "b", "c"), 3);
    expect(shape()).toEqual([["a", "b", "c"], []]);
    expect(work.children[2]).toBe(returning);
  });

  it("drops a row that has left the list from whichever container held it", () => {
    split.patch(rows("a", "b", "c"), 1);
    split.patch(rows("a", "c"), 1);
    expect(shape()).toEqual([["a"], ["c"]]);

    split.patch(rows("a"), 1);
    expect(shape()).toEqual([["a"], []]);
  });

  it("empties both containers when cleared", () => {
    split.patch(rows("a", "b", "c"), 1);
    split.clear();
    expect(shape()).toEqual([[], []]);
  });
});
