import { normalize } from "./normalize";
import type { State } from "./types";

export const STORAGE_KEY = "t0d0/v1";

/**
 * localStorage throws in private modes and sandboxed frames. Falling back to
 * memory keeps the app usable for the session instead of dying on boot — the
 * list is disposable by design, so this is an acceptable degradation.
 */
let memory: string | null = null;

export function save(state: State): void {
  const raw = JSON.stringify(state);
  try {
    localStorage.setItem(STORAGE_KEY, raw);
  } catch {
    memory = raw;
  }
}

export function load(): State | null {
  let raw: string | null;
  try {
    raw = localStorage.getItem(STORAGE_KEY);
  } catch {
    raw = memory;
  }
  if (raw === null) return null;

  try {
    return normalize(JSON.parse(raw));
  } catch {
    return null;
  }
}

/** Fires when another tab writes; without it two open tabs silently clobber. */
export function onExternalChange(handler: (state: State) => void): void {
  addEventListener("storage", (event) => {
    if (event.key !== STORAGE_KEY) return;
    const next = load();
    if (next) handler(next);
  });
}
