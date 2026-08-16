const FOCUSABLE = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "summary",
  '[tabindex]:not([tabindex="-1"])',
].join(",");

/**
 * Keep keyboard focus inside an open dialog and hand it back on close.
 *
 * `aria-modal` tells a screen reader the rest of the page is inert; it does
 * nothing for the Tab key. Without this, tabbing out of an open sheet lands on
 * the list behind it, where the app's own Tab handling then moves items around.
 */
export function trapFocus(container: HTMLElement): () => void {
  const restoreTo = document.activeElement instanceof HTMLElement ? document.activeElement : null;

  const targets = (): HTMLElement[] =>
    [...container.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
      (el) => !el.hidden && el.offsetParent !== null,
    );

  const first = targets()[0];
  if (first) first.focus();
  else container.focus();

  const onKeyDown = (event: KeyboardEvent): void => {
    if (event.key !== "Tab") return;
    const items = targets();
    const head = items[0];
    const tail = items[items.length - 1];
    if (!head || !tail) return;

    if (event.shiftKey && document.activeElement === head) {
      event.preventDefault();
      tail.focus();
    } else if (!event.shiftKey && document.activeElement === tail) {
      event.preventDefault();
      head.focus();
    }
  };

  container.addEventListener("keydown", onKeyDown);

  return () => {
    container.removeEventListener("keydown", onKeyDown);
    if (restoreTo) restoreTo.focus();
  };
}
