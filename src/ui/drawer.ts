import { normalize } from "../normalize";
import { allTasks } from "../progress";
import { icon, type IconName } from "../render/context";
import type { State } from "../types";
import { loadTheme, saveTheme, THEMES, type Theme } from "../theme";
import { trapFocus } from "./focus";

const CONFIRM_MS = 5000;

const stamp = (date = new Date()): string => {
  const pad = (n: number): string => String(n).padStart(2, "0");
  return `${String(date.getFullYear())}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
};

const plural = (n: number, word: string): string => `${String(n)} ${word}${n === 1 ? "" : "s"}`;

export interface DrawerHandlers {
  current: () => State;
  onReplace: (state: State) => void;
  onErase: () => void;
}

/**
 * Everything that isn't the list: backup, reset, and provenance.
 *
 * Built as uniform rows rather than a bespoke layout per feature, so adding a
 * row later costs nothing. Destructive actions confirm in place — a second
 * press on the row itself — rather than opening a dialog on top of a dialog.
 */
export class Drawer {
  #veil: HTMLElement;
  #panel: HTMLElement;
  #file: HTMLInputElement;
  #handlers: DrawerHandlers;

  #pending: State | null = null;
  #release: (() => void) | null = null;
  #eraseTimer: ReturnType<typeof setTimeout> | undefined;
  #dragDepth = 0;

  constructor(veil: HTMLElement, handlers: DrawerHandlers) {
    this.#veil = veil;
    this.#handlers = handlers;
    this.#panel = this.#need(".drawer");
    this.#file = this.#need(".file") as HTMLInputElement;

    this.#paintIcon("save-end", "download");
    this.#paintIcon("restore-end", "upload");
    this.#paintIcon("erase-end", "trash");

    veil.addEventListener("click", (event) => {
      if (event.target === veil) this.hide();
    });
    this.#need(".drawer-close").addEventListener("click", () => {
      this.hide();
    });

    this.#panel.addEventListener("click", (event) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      const action = target.closest<HTMLElement>("[data-act]")?.dataset["act"];
      if (action) this.#run(action);
    });

    this.#file.addEventListener("change", () => {
      const file = this.#file.files?.[0];
      this.#file.value = "";
      if (file) void this.#take(file);
    });

    this.#wireDropTarget();
    this.#wireTheme();
  }

  #wireTheme(): void {
    for (const el of this.#veil.querySelectorAll("[data-theme-choice]")) {
      el.addEventListener("click", () => {
        const choice = el.getAttribute("data-theme-choice");
        if (!(THEMES as readonly string[]).includes(choice ?? "")) return;
        saveTheme(choice as Theme);
        this.#paintTheme();
      });
    }
  }

  #paintTheme(): void {
    const current = loadTheme();
    for (const el of this.#veil.querySelectorAll("[data-theme-choice]")) {
      el.setAttribute("aria-pressed", String(el.getAttribute("data-theme-choice") === current));
    }
  }

  get isOpen(): boolean {
    return !this.#veil.hidden;
  }

  show(): void {
    const state = this.#handlers.current();
    const items = allTasks(state.list).length;
    const groups = state.list.filter((node) => node.kind === "group").length;
    const counts = [plural(items, "item")];
    if (groups > 0) counts.push(plural(groups, "group"));
    this.#slot("counts").textContent = counts.join(" · ");

    this.#clearStaged();
    this.#clearErase();
    this.#paintTheme();
    this.#veil.hidden = false;
    this.#release = trapFocus(this.#panel);
  }

  hide(): void {
    if (this.#veil.hidden) return;
    this.#veil.hidden = true;
    this.#clearStaged();
    this.#clearErase();
    this.#release?.();
    this.#release = null;
  }

  /* ------------------------------------------------------------- plumbing */

  #need(selector: string): HTMLElement {
    const found = this.#veil.querySelector(selector);
    if (!(found instanceof HTMLElement)) throw new Error(`drawer is missing ${selector}`);
    return found;
  }

  #slot(name: string): HTMLElement {
    return this.#need(`[data-slot="${name}"]`);
  }

  #paintIcon(slot: string, name: IconName): void {
    this.#slot(slot).replaceChildren(icon(name));
  }

  #run(action: string): void {
    switch (action) {
      case "save":
        this.#download();
        break;
      case "restore":
        this.#file.click();
        break;
      case "import-cancel":
        this.#clearStaged();
        break;
      case "import-confirm":
        if (this.#pending) {
          this.#handlers.onReplace(this.#pending);
          this.hide();
        }
        break;
      case "erase":
        this.#armErase();
        break;
      case "erase-cancel":
        this.#clearErase();
        break;
      case "erase-go":
        this.#handlers.onErase();
        this.hide();
        break;
      default:
        break;
    }
  }

  /* --------------------------------------------------------------- export */

  #download(): void {
    const name = `t0d0-${stamp()}.json`;
    const json = JSON.stringify(this.#handlers.current(), null, 2);
    const url = URL.createObjectURL(new Blob([json], { type: "application/json" }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = name;
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => {
      URL.revokeObjectURL(url);
    }, 2000);
  }

  /* --------------------------------------------------------------- import */

  #wireDropTarget(): void {
    // Drop anywhere on the panel rather than into a dedicated box: the box was
    // dead weight on touch, where dragging a file isn't a gesture that exists.
    for (const type of ["dragenter", "dragover"]) {
      this.#panel.addEventListener(type, (event) => {
        event.preventDefault();
        if (type === "dragenter") this.#dragDepth++;
        this.#panel.classList.add("dragging");
      });
    }
    this.#panel.addEventListener("dragleave", () => {
      this.#dragDepth = Math.max(0, this.#dragDepth - 1);
      if (this.#dragDepth === 0) this.#panel.classList.remove("dragging");
    });
    this.#panel.addEventListener("drop", (event) => {
      event.preventDefault();
      this.#dragDepth = 0;
      this.#panel.classList.remove("dragging");
      const file = event.dataTransfer?.files[0];
      if (file) void this.#take(file);
    });
  }

  async #take(file: File): Promise<void> {
    try {
      this.#stage(await file.text(), file.name);
    } catch {
      this.#showStaged("Couldn't read that file", "Try a different one.", false);
    }
  }

  #stage(text: string, name: string): void {
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      this.#showStaged(name, "That isn't valid JSON.", false);
      return;
    }

    const next = normalize(parsed);
    if (!next) {
      this.#showStaged(name, 'Not a t0d0 backup — it needs "v": 1 and a "list" array.', false);
      return;
    }

    this.#pending = next;
    const items = allTasks(next.list).length;
    const groups = next.list.filter((node) => node.kind === "group").length;
    const parts = [plural(items, "item")];
    if (groups > 0) parts.push(plural(groups, "group"));
    this.#showStaged(name, `${parts.join(" · ")} — this replaces everything in your list.`, true);
  }

  #showStaged(name: string, detail: string, ok: boolean): void {
    const staged = this.#slot("staged");
    this.#need(".staged-name").textContent = name;
    this.#need(".staged-sum").textContent = detail;
    staged.classList.toggle("bad", !ok);
    if (!ok) this.#pending = null;
    staged.hidden = false;
    this.#slot("backup-note").hidden = true;
  }

  #clearStaged(): void {
    this.#pending = null;
    this.#slot("staged").hidden = true;
    this.#slot("backup-note").hidden = false;
  }

  /* ---------------------------------------------------------------- erase */

  #armErase(): void {
    const state = this.#handlers.current();
    const items = allTasks(state.list).length;
    if (items === 0 && state.list.length === 0) return;

    this.#need(".confirmbar-text").textContent = `Erase ${plural(items, "item")}?`;
    this.#slot("erase-confirm").hidden = false;
    this.#need('[data-act="erase"]').hidden = true;
    this.#need('[data-act="erase-go"]').focus();

    clearTimeout(this.#eraseTimer);
    this.#eraseTimer = setTimeout(() => {
      this.#clearErase();
    }, CONFIRM_MS);
  }

  #clearErase(): void {
    clearTimeout(this.#eraseTimer);
    this.#slot("erase-confirm").hidden = true;
    this.#need('[data-act="erase"]').hidden = false;
  }
}
