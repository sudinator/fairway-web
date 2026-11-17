/** 212.122: the app's own confirm sheet replaces the browser's confirm(). */
import { renderScreen, ok, report } from "./screen-harness";
import * as React from "react";
import { act } from "react";
import { ConfirmHost, askConfirm } from "@/components/confirm";

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
  t.unmount();
  report("confirm sheet");
})();
