import { LIMITS } from "./types";
import type { Group, Node, Task } from "./types";

export const uid = (): string =>
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `id${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;

/** Trailing `[n]`, e.g. "make calls [3]". Anchored so "[3] apples" stays literal text. */
const QUANTITY = /^(.*?)\s*\[(\d{1,3})\]$/;

const clampTarget = (n: number): number => Math.min(LIMITS.target, Math.max(1, Math.trunc(n)));

/**
 * Turn one line of composer input into a node.
 *
 * `# Morning` becomes a group; anything else becomes a task, with a trailing
 * `[n]` lifted out of the text and stored as `target`. Returns null for input
 * that would produce an empty item.
 */
export function parse(input: string): Node | null {
  const line = input.trim();
  if (!line) return null;

  if (line.startsWith("#")) {
    const title = line.slice(1).trim().slice(0, LIMITS.text);
    if (!title) return null;
    const group: Group = { kind: "group", id: uid(), title, collapsed: false, items: [] };
    return group;
  }

  const match = QUANTITY.exec(line);
  const text = (match?.[1] ?? line).trim().slice(0, LIMITS.text);
  if (!text) return null;

  const target = match?.[2] ? clampTarget(Number(match[2])) : 1;
  const task: Task = { kind: "task", id: uid(), text, target, count: 0 };
  return task;
}

/**
 * The inverse of {@link parse} for a task, so inline editing shows the bracket
 * again and the quantity stays editable after creation.
 */
export const raw = (task: Task): string =>
  task.target > 1 ? `${task.text} [${String(task.target)}]` : task.text;
