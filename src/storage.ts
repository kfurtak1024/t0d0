import { normalize } from "./normalize";
import type { State } from "./types";

export const STORAGE_KEY = "t0d0/v1";

/**
 * localStorage throws in private modes and sandboxed frames. Falling back to
 * memory keeps the app usable for the session instead of dying on boot — the
 * list is disposable by design, so this is an acceptable degradation.
 */
let memory: string | null = null;
let warned = false;

/**
 * Returns false when the write only reached memory, so the caller can say so.
 * Silently degrading here would let someone believe a day's list is safe when
 * it will not survive the next reload.
 */
export function save(state: State): boolean {
  const raw = JSON.stringify(state);
  try {
    localStorage.setItem(STORAGE_KEY, raw);
    warned = false;
    return true;
  } catch {
    memory = raw;
    const first = !warned;
    warned = true;
    return !first;
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
