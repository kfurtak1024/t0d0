import { LIMITS, SCHEMA_VERSION } from "./types";
import type { Group, State, Task } from "./types";
import { uid } from "./parse";

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const text = (value: unknown): string =>
  typeof value === "string" ? value.trim().slice(0, LIMITS.text) : "";

/**
 * Ids are interpolated into `[data-id="…"]` selectors by the drag, the row menu
 * and the focus restore, so an imported id carrying a quote is not cosmetic:
 * `querySelector` throws and the gesture dies. Repairing the id here is the
 * single fix; escaping at every call site is four fixes and a future fifth.
 */
const ID = /^[A-Za-z0-9_-]{1,64}$/;

/**
 * The single gate for data entering the app from outside — stored JSON and
 * pasted imports alike.
 *
 * It repairs rather than trusts: clamps counts into range, drops empty text,
 * and regenerates duplicate ids (which would otherwise collide in the render
 * cache and make rows share a DOM node). Returns null only when the shape is
 * unusable, so a caller can fall back to a fresh list.
 */
export function normalize(input: unknown): State | null {
  if (!isRecord(input)) return null;
  /*
   * MIGRATION SEAM. Returning null here discards the store, which is correct
   * only while v1 is the sole version that has ever shipped. Before bumping
   * SCHEMA_VERSION, add an upgrade branch for every older version — otherwise
   * the first launch of the new build silently erases everyone's list.
   */
  if (input["v"] !== SCHEMA_VERSION) return null;
  if (!Array.isArray(input["list"])) return null;

  const seen = new Set<string>();
  const takeId = (value: unknown): string => {
    let id = typeof value === "string" && ID.test(value) ? value : uid();
    while (seen.has(id)) id = uid();
    seen.add(id);
    return id;
  };

  const toTask = (value: unknown): Task | null => {
    if (!isRecord(value)) return null;
    const label = text(value["text"]);
    if (!label) return null;
    const rawTarget = Math.trunc(Number(value["target"]));
    const target = Number.isFinite(rawTarget) ? Math.min(LIMITS.target, Math.max(1, rawTarget)) : 1;
    const rawCount = Math.trunc(Number(value["count"]));
    const count = Number.isFinite(rawCount) ? Math.min(target, Math.max(0, rawCount)) : 0;
    return {
      kind: "task",
      id: takeId(value["id"]),
      text: label,
      target,
      count,
      important: value["important"] === true,
    };
  };

  const list: State["list"] = [];
  for (const node of input["list"] as unknown[]) {
    if (!isRecord(node)) continue;

    if (node["kind"] === "group") {
      const title = text(node["title"]);
      if (!title) continue;
      const rawItems = Array.isArray(node["items"]) ? (node["items"] as unknown[]) : [];
      const group: Group = {
        kind: "group",
        id: takeId(node["id"]),
        title,
        collapsed: node["collapsed"] === true,
        important: node["important"] === true,
        items: rawItems.map(toTask).filter((task): task is Task => task !== null),
      };
      list.push(group);
      continue;
    }

    const task = toTask(node);
    if (task) list.push(task);
  }

  const openedAt = input["openedAt"];
  return {
    v: SCHEMA_VERSION,
    openedAt: typeof openedAt === "number" && Number.isFinite(openedAt) ? openedAt : null,
    list,
  };
}
