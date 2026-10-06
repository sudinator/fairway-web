// Does this element summon the soft keyboard? Text-like inputs, textareas, contenteditable.
// Buttons, checkboxes, selects and ranges do not. The one definition ViewportSync gates the
// keyboard attribute on (199.3), kept in lib so it is unit-tested without a DOM.
export function isEditable(el: Element | null): boolean {
  if (!el) return false;
  if ((el as HTMLElement).isContentEditable) return true;
  const tag = el.tagName;
  if (tag === "TEXTAREA") return true;
  if (tag === "INPUT") {
    const t = ((el as HTMLInputElement).type || "text").toLowerCase();
    return !["button", "checkbox", "radio", "range", "submit", "reset", "file", "color", "hidden", "image"].includes(t);
  }
  return false;
}
