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
