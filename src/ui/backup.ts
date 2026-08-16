import { normalize } from "../normalize";
import { allTasks } from "../progress";
import type { State } from "../types";

const stamp = (date = new Date()): string => {
  const pad = (n: number): string => String(n).padStart(2, "0");
  return `${String(date.getFullYear())}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
};

/**
 * Backup panel: download a file or copy the JSON, and import by dropping or
 * picking a file. Import is staged — you see what the file holds before
 * anything is replaced — because replacing is destructive even with undo.
 */
export class BackupPanel {
  #veil: HTMLElement;
  #json: HTMLTextAreaElement;
  #status: HTMLElement;
  #drop: HTMLElement;
  #preview: HTMLElement;
  #previewName: HTMLElement;
  #previewSummary: HTMLElement;
  #file: HTMLInputElement;
  #pending: State | null = null;
  #current: () => State;

  constructor(veil: HTMLElement, current: () => State, onReplace: (state: State) => void) {
    this.#veil = veil;
    this.#current = current;
    this.#json = veil.querySelector(".json") as HTMLTextAreaElement;
    this.#status = veil.querySelector(".status") as HTMLElement;
    this.#drop = veil.querySelector(".drop") as HTMLElement;
    this.#preview = veil.querySelector(".preview") as HTMLElement;
    this.#previewName = veil.querySelector(".pname") as HTMLElement;
    this.#previewSummary = veil.querySelector(".psum") as HTMLElement;
    this.#file = veil.querySelector(".file") as HTMLInputElement;

    veil.addEventListener("click", (event) => {
      if (event.target === veil) this.hide();
    });
    (veil.querySelector(".close") as HTMLButtonElement).addEventListener("click", () => {
      this.hide();
    });
    (veil.querySelector(".download") as HTMLButtonElement).addEventListener("click", () => {
      this.#download();
    });
    (veil.querySelector(".copy") as HTMLButtonElement).addEventListener("click", () => {
      void this.#copy();
    });
    (veil.querySelector(".cancel") as HTMLButtonElement).addEventListener("click", () => {
      this.#clearPending();
      this.#say("");
    });
    (veil.querySelector(".use-text") as HTMLButtonElement).addEventListener("click", () => {
      this.#stage(this.#json.value, "Pasted text");
    });
    (veil.querySelector(".replace") as HTMLButtonElement).addEventListener("click", () => {
      if (!this.#pending) return;
      onReplace(this.#pending);
      this.hide();
    });

    this.#drop.addEventListener("click", () => {
      this.#file.click();
    });
    this.#drop.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        this.#file.click();
      }
    });
    this.#file.addEventListener("change", () => {
      const file = this.#file.files?.[0];
      this.#file.value = "";
      if (file) void this.#take(file);
    });

    for (const type of ["dragenter", "dragover"]) {
      this.#drop.addEventListener(type, (event) => {
        event.preventDefault();
        this.#drop.classList.add("over");
      });
    }
    for (const type of ["dragleave", "dragend"]) {
      this.#drop.addEventListener(type, () => {
        this.#drop.classList.remove("over");
      });
    }
    this.#drop.addEventListener("drop", (event) => {
      event.preventDefault();
      this.#drop.classList.remove("over");
      const file = event.dataTransfer?.files[0];
      if (file) void this.#take(file);
    });
  }

  get isOpen(): boolean {
    return !this.#veil.hidden;
  }

  show(): void {
    this.#json.value = JSON.stringify(this.#current(), null, 2);
    this.#clearPending();
    this.#say("");
    this.#veil.hidden = false;
  }

  hide(): void {
    this.#veil.hidden = true;
    this.#clearPending();
  }

  #say(message: string, tone?: "good" | "bad"): void {
    this.#status.textContent = message;
    this.#status.className = tone ? `status ${tone}` : "status";
  }

  #clearPending(): void {
    this.#pending = null;
    this.#preview.hidden = true;
    this.#drop.hidden = false;
  }

  #stage(text: string, name: string): void {
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      this.#clearPending();
      this.#say("That isn't valid JSON.", "bad");
      return;
    }

    const next = normalize(parsed);
    if (!next) {
      this.#clearPending();
      this.#say('Valid JSON, but not a t0d0 backup — it needs "v": 1 and a "list" array.', "bad");
      return;
    }

    this.#pending = next;
    const groups = next.list.filter((node) => node.kind === "group").length;
    const items = allTasks(next.list).length;
    const parts = [`${String(items)} item${items === 1 ? "" : "s"}`];
    if (groups > 0) parts.push(`${String(groups)} group${groups === 1 ? "" : "s"}`);

    this.#previewName.textContent = name;
    this.#previewSummary.textContent = `${parts.join(" · ")} — this replaces everything currently in your list.`;
    this.#drop.hidden = true;
    this.#preview.hidden = false;
    this.#say("");
  }

  async #take(file: File): Promise<void> {
    try {
      this.#stage(await file.text(), file.name);
    } catch {
      this.#say("Couldn't read that file.", "bad");
    }
  }

  #download(): void {
    const name = `t0d0-${stamp()}.json`;
    const url = URL.createObjectURL(new Blob([this.#json.value], { type: "application/json" }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = name;
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => {
      URL.revokeObjectURL(url);
    }, 2000);
    this.#say(`Saved as ${name}.`, "good");
  }

  async #copy(): Promise<void> {
    try {
      await navigator.clipboard.writeText(this.#json.value);
      this.#say("Copied to clipboard.", "good");
    } catch {
      this.#json.select();
      this.#say("Selected — press Ctrl/Cmd-C to copy.", "bad");
    }
  }
}
