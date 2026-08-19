import { need } from "./dom";

const VISIBLE_MS = 5000;

export class Toast {
  #root: HTMLElement;
  #text: HTMLElement;
  #action: HTMLElement;
  #timer: ReturnType<typeof setTimeout> | undefined;

  constructor(root: HTMLElement, onUndo: () => void) {
    this.#root = root;
    this.#text = need(root, ".toast-text");
    this.#action = need(root, ".toast-action");
    this.#action.addEventListener("click", () => {
      onUndo();
      this.hide();
    });
  }

  show(message: string): void {
    this.#text.textContent = message;
    this.#root.hidden = false;
    clearTimeout(this.#timer);
    this.#timer = setTimeout(() => {
      this.hide();
    }, VISIBLE_MS);
  }

  hide(): void {
    this.#root.hidden = true;
  }
}
