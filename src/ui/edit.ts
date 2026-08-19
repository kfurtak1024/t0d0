/**
 * Inline editing. The element becomes contenteditable in place rather than
 * being swapped for an input, so nothing in the row moves and no transition is
 * interrupted mid-flight.
 */
export function beginEdit(
  element: HTMLElement,
  initial: string,
  commit: (value: string) => void,
  cancel: () => void,
): void {
  element.textContent = initial;
  // Not "true": the label holds one line of plain text, and a rich paste would
  // otherwise drop styled nodes into the row mid-edit, while a multi-line one
  // arrives back as its lines concatenated with no separator between them.
  element.contentEditable = "plaintext-only";
  element.spellcheck = false;
  element.focus();

  const range = document.createRange();
  range.selectNodeContents(element);
  const selection = getSelection();
  selection?.removeAllRanges();
  selection?.addRange(range);

  let finished = false;
  const finish = (save: boolean): void => {
    if (finished) return;
    finished = true;
    element.contentEditable = "false";
    const value = element.textContent;
    element.removeEventListener("keydown", onKey);
    element.removeEventListener("blur", onBlur);
    if (save) commit(value);
    else cancel();
  };

  function onKey(event: KeyboardEvent): void {
    if (event.key === "Enter") {
      event.preventDefault();
      finish(true);
    }
    if (event.key === "Escape") {
      event.preventDefault();
      finish(false);
    }
  }
  function onBlur(): void {
    finish(true);
  }

  element.addEventListener("keydown", onKey);
  element.addEventListener("blur", onBlur);
}
