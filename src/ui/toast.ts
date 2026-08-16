const VISIBLE_MS = 5000;

export class Toast {
  #root: HTMLElement;
  #text: HTMLElement;
  #action: HTMLButtonElement;
  #timer: ReturnType<typeof setTimeout> | undefined;

  constructor(root: HTMLElement, onUndo: () => void) {
    this.#root = root;
    this.#text = root.querySelector(".toast-text") as HTMLElement;
    this.#action = root.querySelector(".toast-action") as HTMLButtonElement;
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
