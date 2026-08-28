import { normalize } from "./normalize";
import type { State } from "./types";

export const STORAGE_KEY = "t0d0/v1";

/**
 * localStorage throws in private modes and sandboxed frames. Falling back to
 * memory keeps the app usable for the session instead of dying on boot — the
 * list is disposable by design, so this is an acceptable degradation.
 */
let memory: string | null = null;

/**
 * True when the state reached real storage, false when it only reached memory.
 *
 * Nothing more: how often to tell the user is a UI policy, and folding it in
 * here once made this return true for a write that had not persisted.
 */
export function save(state: State): boolean {
  const raw = JSON.stringify(state);
  try {
    localStorage.setItem(STORAGE_KEY, raw);
    // Dropped on the way out: once a write lands, real storage is the truth and
    // a leftover copy here would shadow it with something older if reading ever
    // started throwing on its own.
    memory = null;
    return true;
  } catch {
    memory = raw;
    return false;
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
