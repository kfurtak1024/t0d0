import { describe, expect, it } from "vitest";
import { isGroupInput, parse, raw } from "../src/parse";
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

describe("isGroupInput", () => {
  it.each([
    ["# Morning", true],
    ["#Errands", true],
    ["   # leading space", true],
    // Still group input even though `parse` rejects it for having no title:
    // the composer has to say "Top level" from the first keystroke.
    ["#", true],
    ["shopping", false],
    ["make calls [3]", false],
    ["ship it!", false],
    ["a # b", false],
    ["[3]", false],
    ["", false],
    ["   ", false],
  ])("reads %j as %s", (line, expected) => {
    expect(isGroupInput(line)).toBe(expected);
  });

  it("agrees with the branch parse actually takes", () => {
    // The composer previews this answer while you type, so a disagreement would
    // show "Top level" for something that lands in a group, or the reverse.
    // Only lines parse accepts, so the comparison is a real one.
    for (const line of ["# Morning", "#Errands", "shopping", "make calls [3]", "ship it!"]) {
      expect(isGroupInput(line)).toBe(parse(line)?.kind === "group");
    }
  });
});

describe("the importance mark", () => {
  it("lifts a trailing ! off a task", () => {
    expect(task("call the bank!")).toMatchObject({ text: "call the bank", important: true });
  });

  it("lifts a trailing ! off a group title", () => {
    expect(parse("# Morning!")).toMatchObject({ kind: "group", title: "Morning", important: true });
  });

  it("leaves everything else unmarked", () => {
    expect(task("call the bank").important).toBe(false);
    expect(parse("# Morning")).toMatchObject({ important: false });
    expect(task("wait! there's more").important).toBe(false);
  });

  it("takes the mark from either side of a quantity", () => {
    // Both are what people type, and neither reading is more obviously right.
    expect(task("make calls [3]!")).toMatchObject({
      text: "make calls",
      target: 3,
      important: true,
    });
    expect(task("make calls! [3]")).toMatchObject({
      text: "make calls",
      target: 3,
      important: true,
    });
  });

  it("consumes exactly one !, so a doubled one keeps a bang in the text", () => {
    expect(task("ship it!!")).toMatchObject({ text: "ship it!", important: true });
    expect(task("ship it!! [2]")).toMatchObject({ text: "ship it!", target: 2, important: true });
    expect(parse("# Go!!")).toMatchObject({ title: "Go!", important: true });
  });

  it("still rejects input that is only a mark", () => {
    expect(parse("!")).toBeNull();
    expect(parse("#!")).toBeNull();
    expect(parse("[3]!")).toBeNull();
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

  it("writes the mark back, and keeps it out of a plain item", () => {
    expect(raw(task("call the bank!"))).toBe("call the bank!");
    expect(raw(task("make calls! [3]"))).toBe("make calls! [3]");
    expect(raw(task("shopping"))).toBe("shopping");
  });

  it("round-trips text that itself ends in a bang, by doubling it", () => {
    const original = task("ship it!!");
    expect(original).toMatchObject({ text: "ship it!", important: true });
    expect(raw(original)).toBe("ship it!!");
    expect(task(raw(original))).toMatchObject({ text: "ship it!", important: true });
  });

  it("round-trips a group title, which is how inline editing seeds itself", () => {
    const group = parse("# Morning!");
    if (group?.kind !== "group") throw new Error("expected a group");
    expect(raw(group)).toBe("Morning!");
    expect(parse(`# ${raw(group)}`)).toMatchObject({ title: "Morning", important: true });

    const plain = parse("# Later");
    if (plain?.kind !== "group") throw new Error("expected a group");
    expect(raw(plain)).toBe("Later");
  });
});
