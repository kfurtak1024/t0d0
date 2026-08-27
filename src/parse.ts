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

const clampTarget = (n: number): number => Math.min(LIMITS.target, Math.max(1, Math.trunc(n)));

/**
 * Lift **one** trailing `!` off a line, never a run of them.
 *
 * That ceiling is the whole design. It means "ship it!!" is an important "ship
 * it!" rather than an important "ship it", so {@link raw} can write a bang back
 * out by doubling it and the text survives a round-trip through the editor.
 */
const unmark = (line: string): { text: string; important: boolean } => {
  const match = MARK.exec(line);
  return match ? { text: match[1] ?? "", important: true } : { text: line, important: false };
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

  if (line.startsWith("#")) {
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
   * The mark may sit at the end of the line or at the end of the name, because
   * "make calls [3]!" and "make calls! [3]" are both what people type and
   * neither reading is more obviously right. Look past the bracket only when
   * the end of the line had no mark of its own: at most one `!` is ever
   * consumed, from wherever it came, which is what keeps `raw` a true inverse.
   */
  const tail = unmark(line);
  const quantity = QUANTITY.exec(tail.text);
  const body = (quantity?.[1] ?? tail.text).trim();
  const name =
    tail.important || !quantity ? { text: body, important: tail.important } : unmark(body);

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
  };
  return task;
}

/**
 * The inverse of {@link parse} for a row, so inline editing shows the bracket
 * and the bang again and both stay editable after creation.
 *
 * An important item whose text already ends in a bang writes two, which is
 * exactly the doubling {@link parse} undoes.
 */
export function raw(node: Task | Group): string {
  if (node.kind === "group") return node.important ? `${node.title}!` : node.title;
  const body = node.important ? `${node.text}!` : node.text;
  return node.target > 1 ? `${body} [${String(node.target)}]` : body;
}
