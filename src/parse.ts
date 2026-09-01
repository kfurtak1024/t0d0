import { LIMITS } from "./types";
import type { Group, Node, Task } from "./types";

export const uid = (): string =>
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `id${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;

/** Trailing `[n]`, e.g. "make calls [3]". Anchored so "[3] apples" stays literal text. */
const QUANTITY = /^(.*?)\s*\[(\d{1,3})\]$/;

/** Trailing `!`, the importance mark. */
const MARK = /^(.*?)\s*!$/;

/** Trailing `!` or `~` — the two row marks, either way round. */
const TRAILING = /^(.*?)\s*([!~])$/;

const clampTarget = (n: number): number => Math.min(LIMITS.target, Math.max(1, Math.trunc(n)));

/**
 * Lift **one** trailing `!` off a line, never a run of them.
 *
 * That ceiling is the whole design. It means "ship it!!" is an important "ship
 * it!" rather than an important "ship it", so {@link raw} can write a bang back
 * out by doubling it and the text survives a round-trip through the editor.
 *
 * Titles only. A task's line is read by {@link strip}, which lifts `~` as well;
 * a group cannot be one-off, so a `~` in a heading is just a character someone
 * typed and stays in the title.
 */
const unmark = (line: string): { text: string; important: boolean } => {
  const match = MARK.exec(line);
  return match ? { text: match[1] ?? "", important: true } : { text: line, important: false };
};

interface Marks {
  text: string;
  important: boolean;
  once: boolean;
}

/**
 * Lift the trailing marks off a task line — **at most one of each**, in
 * whichever order they were typed.
 *
 * The ceiling is what {@link unmark} always had, now holding for two sigils
 * instead of one: "ship it!!" is an important "ship it!", and "later~~" is a
 * one-off "later~". Stopping on a sigil that is already spent rather than
 * skipping past it is what keeps that true — otherwise "ship it!!" would eat
 * both bangs looking for a `~` and the text would not survive the editor.
 *
 * `taken` carries in what an earlier pass already found, so reading the line
 * and then reading the name inside it cannot spend the same mark twice.
 */
const strip = (line: string, taken?: { important: boolean; once: boolean }): Marks => {
  let text = line;
  let important = taken?.important ?? false;
  let once = taken?.once ?? false;

  for (;;) {
    const match = TRAILING.exec(text);
    if (!match) break;
    if (match[2] === "!" && !important) important = true;
    else if (match[2] === "~" && !once) once = true;
    else break;
    text = match[1] ?? "";
  }
  return { text, important, once };
};

/**
 * Read a group heading: `# Morning`, and `# Morning!` for an important one.
 *
 * Shared with {@link retitle} so the composer and inline editing agree on what a
 * title means — a group's text is not re-parsed by {@link parse} on the way back
 * in, and two copies of this rule would drift.
 */
export function parseTitle(input: string): { title: string; important: boolean } | null {
  const { text, important } = unmark(input.trim().replace(/^#\s*/, "").trim());
  const title = text.trim().slice(0, LIMITS.text);
  return title ? { title, important } : null;
}

/**
 * Whether a line will make a group rather than a task.
 *
 * Shared with the composer, which previews the answer while you type: a group
 * always lands at the root, so "Adding to" has to stop naming a group the
 * moment the `#` appears. Two copies of this test would drift.
 */
export const isGroupInput = (input: string): boolean => input.trim().startsWith("#");

/**
 * Turn one line of composer input into a node.
 *
 * `# Morning` becomes a group; anything else becomes a task, with a trailing
 * `[n]` lifted out of the text and stored as `target`. A trailing `!` marks
 * either kind as important. Returns null for input that would produce an empty
 * item.
 */
export function parse(input: string): Node | null {
  const line = input.trim();
  if (!line) return null;

  if (isGroupInput(line)) {
    const head = parseTitle(line);
    if (!head) return null;
    const group: Group = {
      kind: "group",
      id: uid(),
      title: head.title,
      collapsed: false,
      important: head.important,
      items: [],
    };
    return group;
  }

  /*
   * A mark may sit at the end of the line or at the end of the name, because
   * "make calls [3]!" and "make calls! [3]" are both what people type and
   * neither reading is more obviously right. So read the end of the line, then
   * read the end of the name inside it — carrying forward what the first pass
   * already found, so at most one of each sigil is ever consumed no matter
   * which side it came from. That ceiling is what keeps `raw` a true inverse.
   */
  const tail = strip(line);
  const quantity = QUANTITY.exec(tail.text);
  const body = (quantity?.[1] ?? tail.text).trim();
  const name = quantity ? strip(body, tail) : { ...tail, text: body };

  const text = name.text.trim().slice(0, LIMITS.text);
  if (!text) return null;

  const target = quantity?.[2] ? clampTarget(Number(quantity[2])) : 1;
  const task: Task = {
    kind: "task",
    id: uid(),
    text,
    target,
    count: 0,
    important: name.important,
    once: name.once,
  };
  return task;
}

/**
 * The inverse of {@link parse} for a row, so inline editing shows the bracket
 * and the marks again and all of them stay editable after creation.
 *
 * An important item whose text already ends in a bang writes two, which is
 * exactly the doubling {@link parse} undoes — and the same holds for a one-off
 * whose text ends in a tilde.
 *
 * The two marks are written in a fixed order, `!` then `~`, because `parse`
 * reads them from the right and does not care which order they arrive in: one
 * canonical spelling out, both spellings in.
 */
export function raw(node: Task | Group): string {
  if (node.kind === "group") return node.important ? `${node.title}!` : node.title;
  const body = `${node.text}${node.important ? "!" : ""}${node.once ? "~" : ""}`;
  return node.target > 1 ? `${body} [${String(node.target)}]` : body;
}
