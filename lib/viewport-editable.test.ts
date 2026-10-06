function assertEqual(a: unknown, b: unknown, m: string) { if (a !== b) throw new Error(`${m}: expected ${String(b)}, got ${String(a)}`); }
import { isEditable } from "./viewport-editable";
// 199.3: the keyboard attribute is gated on a focused editable element. These are the exact
// shapes the gate must accept and refuse; the dashboard with nothing focused is the regression.
const mk = (tag: string, type?: string, ce = false) => ({ tagName: tag, type, isContentEditable: ce }) as unknown as Element;
assertEqual(isEditable(null), false, "nothing focused (the dashboard case)");
assertEqual(isEditable(mk("DIV")), false, "a plain div");
assertEqual(isEditable(mk("BUTTON")), false, "a button (New round, Use as my handicap)");
assertEqual(isEditable(mk("INPUT", "checkbox")), false, "checkbox");
assertEqual(isEditable(mk("INPUT", "range")), false, "range slider");
assertEqual(isEditable(mk("INPUT", "text")), true, "text input");
assertEqual(isEditable(mk("INPUT", "number")), true, "number input (scores)");
assertEqual(isEditable(mk("INPUT", "search")), true, "search");
assertEqual(isEditable(mk("INPUT")), true, "input with no type is text");
assertEqual(isEditable(mk("TEXTAREA")), true, "textarea");
assertEqual(isEditable(mk("DIV", undefined, true)), true, "contenteditable");
console.log("viewport-editable tests passed");
