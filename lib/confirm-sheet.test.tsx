/** 212.122: the app's own confirm sheet replaces the browser's confirm(). */
import { renderScreen, ok, report } from "./screen-harness";
import * as React from "react";
import { act } from "react";
import { ConfirmHost, askConfirm, askText, questionFrom } from "@/components/confirm";

(async () => {
  const t = renderScreen(<ConfirmHost />);
  let answer: boolean | null = null;
  await act(async () => { void askConfirm({ title: "Remove this foursome?", message: "It can be added again.", confirmLabel: "Remove", danger: true }).then((v) => { answer = v; }); });
  ok(!!t.el.querySelector("[data-confirm-sheet]") && (t.el.textContent || "").includes("Remove this foursome?") && (t.el.textContent || "").includes("It can be added again."), "the question shows in the app's sheet, title and message");
  await act(async () => { (t.el.querySelector("[data-confirm-ok]") as HTMLElement).click(); });
  ok(answer === true && !t.el.querySelector("[data-confirm-sheet]"), "Remove answers yes and closes");
  answer = null;
  await act(async () => { void askConfirm("Discard this round?").then((v) => { answer = v; }); });
  await act(async () => { (t.el.querySelector("[data-confirm-cancel]") as HTMLElement).click(); });
  ok(answer === false && !t.el.querySelector("[data-confirm-sheet]"), "Cancel answers no and closes");
  answer = null;
  await act(async () => { void askConfirm("First?").then((v) => { answer = v; }); });
  let second: boolean | null = null;
  await act(async () => { void askConfirm("Second?").then((v) => { second = v; }); });
  ok(answer === false && (t.el.textContent || "").includes("Second?"), "a new question cancels an unanswered one");
  await act(async () => { (t.el.querySelector("[data-confirm-ok]") as HTMLElement).click(); });
  ok(second === true, "the second is answered");
  // 212.124: a plain-sentence question splits into title + detail, the verb becomes the button
  const q = questionFrom('Reset "Sunday game"? This clears every player\'s scores. Players and teams are kept.');
  ok(q.title === 'Reset "Sunday game"?' && q.message === "This clears every player's scores. Players and teams are kept." && q.confirmLabel === "Reset" && q.danger === true, `sentence split: ${JSON.stringify(q)}`);
  const q2 = questionFrom("Balance teams by playing handicap?\n\nSam moves to Reds.");
  ok(q2.title === "Balance teams by playing handicap?" && q2.message === "Sam moves to Reds." && !q2.danger, "a blank line separates title and detail; a neutral verb is not destructive");
  // typed input replaces prompt()
  let typed: string | null | undefined;
  await act(async () => { void askText("Suspend Sam? They can't sign in until restored.\n\nReason (shown in Admin):").then((v) => { typed = v; }); });
  ok(!!t.el.querySelector("[data-text-sheet]") && (t.el.textContent || "").includes("Suspend Sam?"), "the typed-input sheet shows the question");
  const input = t.el.querySelector("[data-text-input]") as HTMLInputElement;
  await act(async () => { const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(input), "value")!.set!; setter.call(input, "duplicate account"); input.dispatchEvent(new (input.ownerDocument.defaultView as any).Event("input", { bubbles: true })); });
  await act(async () => { (t.el.querySelector("[data-text-ok]") as HTMLElement).click(); });
  ok(typed === "duplicate account" && !t.el.querySelector("[data-text-sheet]"), `OK returns the typed text (got ${JSON.stringify(typed)})`);
  await act(async () => { void askText("Rename?", "Old").then((v) => { typed = v; }); });
  ok((t.el.querySelector("[data-text-input]") as HTMLInputElement).value === "Old", "the initial value is filled in");
  await act(async () => { (t.el.querySelector("[data-text-cancel]") as HTMLElement).click(); });
  ok(typed === null, "Cancel returns null, as prompt() did");
  t.unmount();
  report("confirm sheet");
})();
