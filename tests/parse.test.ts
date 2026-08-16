import { describe, expect, it } from "vitest";
import { parse, raw } from "../src/parse";
import type { Group, Task } from "../src/types";

const task = (input: string): Task => {
  const node = parse(input);
  if (node?.kind !== "task") throw new Error(`expected a task from ${JSON.stringify(input)}`);
  return node;
};

describe("parse", () => {
  it("makes a plain task with target 1", () => {
    expect(task("shopping")).toMatchObject({ text: "shopping", target: 1, count: 0 });
  });

  it("lifts a trailing [n] out of the text", () => {
    expect(task("make calls [3]")).toMatchObject({ text: "make calls", target: 3 });
  });

  it("only treats a trailing bracket as a quantity", () => {
    expect(task("[3] apples")).toMatchObject({ text: "[3] apples", target: 1 });
    expect(task("buy [3] apples")).toMatchObject({ text: "buy [3] apples", target: 1 });
  });

  it("clamps the quantity into range", () => {
    expect(task("x [0]").target).toBe(1);
    expect(task("x [999]").target).toBe(99);
  });

  it("makes a group from a leading hash", () => {
    const node = parse("# Morning");
    expect(node).toMatchObject({ kind: "group", title: "Morning", collapsed: false, items: [] });
    expect((node as Group).items).toHaveLength(0);
  });

  it("tolerates a hash with no space", () => {
    expect(parse("#Errands")).toMatchObject({ kind: "group", title: "Errands" });
  });

  it("rejects input that would make an empty item", () => {
    expect(parse("")).toBeNull();
    expect(parse("   ")).toBeNull();
    expect(parse("#")).toBeNull();
    expect(parse("#   ")).toBeNull();
    expect(parse("[3]")).toBeNull();
  });

  it("truncates absurd input rather than storing it", () => {
    expect(task("x".repeat(500)).text).toHaveLength(200);
  });

  it("gives every node a distinct id", () => {
    expect(parse("a")?.id).not.toBe(parse("a")?.id);
  });
});

describe("raw", () => {
  it("round-trips through parse so the quantity stays editable", () => {
    const original = task("make calls [3]");
    expect(raw(original)).toBe("make calls [3]");
    expect(task(raw(original))).toMatchObject({ text: "make calls", target: 3 });
  });

  it("omits the bracket for a plain task", () => {
    expect(raw(task("shopping"))).toBe("shopping");
  });
});
